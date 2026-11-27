using System.Runtime.InteropServices;

namespace SkaiDesktop.Core.Services;

/// <summary>Reads per-adapter dedicated memory and the current Windows WDDM budget through DXGI.</summary>
internal static class WindowsDxgiGpuProbe
{
    private static readonly Guid Factory1Id = new("770AAE78-F26F-4DBA-A829-253C83D1B387");
    private static readonly Guid Adapter3Id = new("645967A4-1392-4310-A798-8053CE3E93FD");
    private const int AdapterNotFound = unchecked((int)0x887A0002);
    private const uint SoftwareAdapterFlag = 2;
    private const uint LocalMemorySegment = 0;
    private const int FactoryEnumAdapters1Slot = 12;
    private const int AdapterGetDesc1Slot = 10;
    private const int Adapter3QueryVideoMemoryInfoSlot = 14;

    public static IReadOnlyList<LocalGpuCapacity> ReadAdapters()
    {
        if (!OperatingSystem.IsWindows()) return [];

        IntPtr factory = IntPtr.Zero;
        try
        {
            var factoryId = Factory1Id;
            if (CreateDXGIFactory1(ref factoryId, out factory) < 0 || factory == IntPtr.Zero) return [];
            var enumerate = GetMethod<EnumAdapters1>(factory, FactoryEnumAdapters1Slot);
            var adapters = new List<LocalGpuCapacity>();
            for (uint index = 0; index < 16; index++)
            {
                var result = enumerate(factory, index, out var adapter);
                if (result == AdapterNotFound) break;
                if (result < 0 || adapter == IntPtr.Zero) continue;
                try
                {
                    var getDescription = GetMethod<GetDescription1>(adapter, AdapterGetDesc1Slot);
                    if (getDescription(adapter, out var description) < 0 || (description.Flags & SoftwareAdapterFlag) != 0) continue;
                    var totalBytes = ToNullableBytes(description.DedicatedVideoMemory);
                    if (totalBytes is null) continue;

                    IntPtr adapter3 = IntPtr.Zero;
                    try
                    {
                        var interfaceId = Adapter3Id;
                        if (Marshal.QueryInterface(adapter, in interfaceId, out adapter3) < 0 || adapter3 == IntPtr.Zero)
                        {
                            adapters.Add(new(description.Description.Trim(), totalBytes, null, null, MeasurementSource: "Windows DXGI", AvailabilityScope: "physical-total-only"));
                            continue;
                        }

                        var queryMemory = GetMethod<QueryVideoMemoryInfo>(adapter3, Adapter3QueryVideoMemoryInfoSlot);
                        if (queryMemory(adapter3, 0, LocalMemorySegment, out var memory) < 0 || memory.Budget == 0)
                        {
                            adapters.Add(new(description.Description.Trim(), totalBytes, null, null, MeasurementSource: "Windows DXGI", AvailabilityScope: "physical-total-only"));
                            continue;
                        }

                        var available = memory.CurrentUsage >= memory.Budget ? 0 : (long)(memory.Budget - memory.CurrentUsage);
                        adapters.Add(new(description.Description.Trim(), totalBytes, available, null, (long)memory.Budget, (long)memory.CurrentUsage, "Windows DXGI", "application-budget"));
                    }
                    finally
                    {
                        if (adapter3 != IntPtr.Zero) Marshal.Release(adapter3);
                    }
                }
                finally { Marshal.Release(adapter); }
            }
            return adapters;
        }
        catch (Exception error) when (error is DllNotFoundException or EntryPointNotFoundException or MarshalDirectiveException or COMException or InvalidOperationException)
        {
            return [];
        }
        finally
        {
            if (factory != IntPtr.Zero) Marshal.Release(factory);
        }
    }

    private static long? ToNullableBytes(UIntPtr value)
    {
        var bytes = value.ToUInt64();
        return bytes is > 0 and <= long.MaxValue ? (long)bytes : null;
    }

    private static T GetMethod<T>(IntPtr instance, int slot) where T : Delegate
    {
        var vtable = Marshal.ReadIntPtr(instance);
        return Marshal.GetDelegateForFunctionPointer<T>(Marshal.ReadIntPtr(vtable, slot * IntPtr.Size));
    }

    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int EnumAdapters1(IntPtr factory, uint index, out IntPtr adapter);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int GetDescription1(IntPtr adapter, out DxgiAdapterDescription1 description);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int QueryVideoMemoryInfo(IntPtr adapter, uint nodeIndex, uint segmentGroup, out DxgiQueryVideoMemoryInfo memoryInfo);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DxgiAdapterDescription1
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Description;
        public uint VendorId;
        public uint DeviceId;
        public uint SubSystemId;
        public uint Revision;
        public UIntPtr DedicatedVideoMemory;
        public UIntPtr DedicatedSystemMemory;
        public UIntPtr SharedSystemMemory;
        public long AdapterLowPartAndHighPart;
        public uint Flags;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DxgiQueryVideoMemoryInfo
    {
        public ulong Budget;
        public ulong CurrentUsage;
        public ulong AvailableForReservation;
        public ulong CurrentReservation;
    }

    [DllImport("dxgi.dll", ExactSpelling = true)]
    private static extern int CreateDXGIFactory1(ref Guid interfaceId, out IntPtr factory);
}
