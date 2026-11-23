using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace SkaiDesktop.Core.Infrastructure;

/// <summary>
/// Attaches Windows command processes to a kill-on-close Job Object for descendant and memory limits.
/// WindowsCommandSandbox supplies the AppContainer filesystem and network boundary before launch.
/// </summary>
internal sealed class OsProcessIsolation : IDisposable
{
    public const uint MaxActiveProcesses = 128;
    public const int MaxCpuCores = 4;
    private const uint CpuRateControlEnable = 0x1;
    private const uint CpuRateControlHardCap = 0x4;
    private readonly SafeFileHandle? jobHandle;
    private readonly ulong? jobMemoryLimitBytes;

    private OsProcessIsolation(SafeFileHandle? jobHandle, ulong? jobMemoryLimitBytes = null, int? cpuQuotaPercent = null)
    {
        this.jobHandle = jobHandle;
        this.jobMemoryLimitBytes = jobMemoryLimitBytes;
        CpuQuotaPercent = cpuQuotaPercent;
    }

    public bool IsAttached => jobHandle is not null && !jobHandle.IsInvalid;
    public ulong? JobMemoryLimitBytes => IsAttached ? jobMemoryLimitBytes : null;
    public int? CpuQuotaPercent { get; }

    public static OsProcessIsolation Attach(Process process, ulong? memoryLimitBytesOverride = null)
    {
        if (!OperatingSystem.IsWindows()) return new OsProcessIsolation(null);
        if (memoryLimitBytesOverride is { } requestedLimit &&
            (requestedLimit < CommandResourceLimits.MinimumJobMemoryBytes || requestedLimit > CommandResourceLimits.MaximumJobMemoryBytes))
            throw new ArgumentOutOfRangeException(nameof(memoryLimitBytesOverride));
        try
        {
            var job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) return new OsProcessIsolation(null);
            var handle = new SafeFileHandle(job, ownsHandle: true);
            var availablePhysicalBytes = GetAvailablePhysicalMemoryBytes();
            var estimatedMemoryLimitBytes = CommandResourceLimits.EstimateJobMemoryLimitBytes(availablePhysicalBytes);
            var memoryLimitBytes = memoryLimitBytesOverride is { } requestedBudget
                ? Math.Min(estimatedMemoryLimitBytes, requestedBudget)
                : estimatedMemoryLimitBytes;
            var limits = new JobObjectExtendedLimitInformation
            {
                BasicLimitInformation = new JobObjectBasicLimitInformation
                {
                    LimitFlags = JobObjectLimitFlags.KillOnJobClose | JobObjectLimitFlags.ActiveProcess | JobObjectLimitFlags.JobMemory,
                    ActiveProcessLimit = MaxActiveProcesses
                },
                JobMemoryLimit = UIntPtr.Size == 4
                    ? new UIntPtr((uint)Math.Min(memoryLimitBytes, uint.MaxValue))
                    : new UIntPtr(memoryLimitBytes),
            };
            var size = Marshal.SizeOf<JobObjectExtendedLimitInformation>();
            if (!SetInformationJobObject(handle, JobObjectInfoType.ExtendedLimitInformation, ref limits, (uint)size))
            {
                handle.Dispose();
                return new OsProcessIsolation(null);
            }

            var cpuQuotaPercent = Math.Clamp(Environment.ProcessorCount, 1, MaxCpuCores) * 100;
            var cpuRate = new JobObjectCpuRateControlInformation
            {
                ControlFlags = CpuRateControlEnable | CpuRateControlHardCap,
                CpuRate = checked((uint)(cpuQuotaPercent * 100 / Math.Max(Environment.ProcessorCount, 1))),
            };
            if (!SetCpuRateControlInformation(handle, JobObjectInfoType.CpuRateControlInformation, ref cpuRate, (uint)Marshal.SizeOf<JobObjectCpuRateControlInformation>()) ||
                !AssignProcessToJobObject(handle, process.Handle))
            {
                handle.Dispose();
                return new OsProcessIsolation(null);
            }
            return new OsProcessIsolation(handle, memoryLimitBytes, cpuQuotaPercent);
        }
        catch (Win32Exception)
        {
            return new OsProcessIsolation(null);
        }
        catch (InvalidOperationException)
        {
            return new OsProcessIsolation(null);
        }
    }

    public static string DescribeCurrentPlatform(bool attached, ulong? memoryLimitBytes) => OperatingSystem.IsWindows()
        ? attached
            ? $"Windows Job Object process containment active (maximum {MaxActiveProcesses} processes; CPU quota {Math.Clamp(Environment.ProcessorCount, 1, MaxCpuCores) * 100}% ({Math.Clamp(Environment.ProcessorCount, 1, MaxCpuCores)} cores); job memory cap {FormatGigabytes(memoryLimitBytes ?? 0)} GiB)."
            : "Windows Job Object process containment could not be enabled; filesystem and network access are not sandboxed."
        : "OS process containment is unavailable on this platform; filesystem and network access are not sandboxed.";

    public void Dispose() => jobHandle?.Dispose();

    private static ulong GetAvailablePhysicalMemoryBytes()
    {
        var status = new MemoryStatusEx { Length = (uint)Marshal.SizeOf<MemoryStatusEx>() };
        return GlobalMemoryStatusEx(ref status) && status.AvailablePhysical > 0
            ? status.AvailablePhysical
            : 4UL * 1024 * 1024 * 1024;
    }

    private static string FormatGigabytes(ulong bytes) =>
        (bytes / (1024d * 1024 * 1024)).ToString("0.0", System.Globalization.CultureInfo.InvariantCulture);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr attributes, string? name);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetInformationJobObject(SafeHandle job, JobObjectInfoType infoType, ref JobObjectExtendedLimitInformation jobObjectInfo, uint jobObjectInfoLength);

    [DllImport("kernel32.dll", EntryPoint = "SetInformationJobObject", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetCpuRateControlInformation(SafeHandle job, JobObjectInfoType infoType, ref JobObjectCpuRateControlInformation jobObjectInfo, uint jobObjectInfoLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AssignProcessToJobObject(SafeHandle job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GlobalMemoryStatusEx(ref MemoryStatusEx buffer);

    private enum JobObjectInfoType
    {
        ExtendedLimitInformation = 9,
        CpuRateControlInformation = 15
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectCpuRateControlInformation
    {
        public uint ControlFlags;
        public uint CpuRate;
    }

    [Flags]
    private enum JobObjectLimitFlags : uint
    {
        ActiveProcess = 0x00000008,
        JobMemory = 0x00000200,
        KillOnJobClose = 0x00002000
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MemoryStatusEx
    {
        public uint Length;
        public uint MemoryLoad;
        public ulong TotalPhysical;
        public ulong AvailablePhysical;
        public ulong TotalPageFile;
        public ulong AvailablePageFile;
        public ulong TotalVirtual;
        public ulong AvailableVirtual;
        public ulong AvailableExtendedVirtual;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectBasicLimitInformation
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public JobObjectLimitFlags LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectExtendedLimitInformation
    {
        public JobObjectBasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }
}
