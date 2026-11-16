using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;

namespace SkaiDesktop.Core.Services;

public sealed record LocalGpuCapacity(string Name, long? TotalBytes, long? AvailableBytes, double? UtilizationPercent);

public sealed record LocalCapacitySnapshot(
    DateTimeOffset CapturedAtUtc,
    long? RamTotalBytes,
    long? RamAvailableBytes,
    double? CpuUtilizationPercent,
    LocalGpuCapacity? Gpu,
    string? MeasurementNote);

/// <summary>Reads local device capacity for advisory UI only. No measurements leave the machine.</summary>
public sealed class LocalCapacityProbe
{
    private static readonly TimeSpan CpuSampleInterval = TimeSpan.FromMilliseconds(180);
    private static readonly TimeSpan GpuTimeout = TimeSpan.FromMilliseconds(1200);
    private static readonly object CacheGate = new();
    private static DateTimeOffset _lastCapturedAt;
    private static LocalCapacitySnapshot? _lastSnapshot;

    public async Task<LocalCapacitySnapshot> GetSnapshotAsync(CancellationToken cancellationToken = default)
    {
        lock (CacheGate)
        {
            if (_lastSnapshot is not null && DateTimeOffset.UtcNow - _lastCapturedAt < TimeSpan.FromSeconds(4))
                return _lastSnapshot;
        }

        var memory = ReadMemory();
        var cpu = await ReadCpuUtilizationAsync(cancellationToken).ConfigureAwait(false);
        var gpu = await ReadNvidiaCapacityAsync(cancellationToken).ConfigureAwait(false);
        var note = gpu is null ? "GPU memory is unavailable from a supported local telemetry provider." : null;
        var snapshot = new LocalCapacitySnapshot(DateTimeOffset.UtcNow, memory.Total, memory.Available, cpu, gpu, note);
        lock (CacheGate)
        {
            _lastCapturedAt = snapshot.CapturedAtUtc;
            _lastSnapshot = snapshot;
        }
        return snapshot;
    }

    private static (long? Total, long? Available) ReadMemory()
    {
        if (OperatingSystem.IsWindows())
        {
            var status = new MemoryStatusEx { Length = (uint)Marshal.SizeOf<MemoryStatusEx>() };
            return GlobalMemoryStatusEx(ref status) ? ((long)status.TotalPhysical, (long)status.AvailablePhysical) : (null, null);
        }

        if (OperatingSystem.IsLinux())
        {
            try
            {
                var values = File.ReadLines("/proc/meminfo")
                    .Select(line => line.Split(':', 2))
                    .Where(parts => parts.Length == 2)
                    .Select(parts => (Name: parts[0], Value: ParseKilobytes(parts[1])))
                    .ToDictionary(item => item.Name, item => item.Value, StringComparer.Ordinal);
                if (!values.TryGetValue("MemTotal", out var total)) return (null, null);
                var available = values.TryGetValue("MemAvailable", out var memAvailable) ? memAvailable : values.GetValueOrDefault("MemFree");
                return (total * 1024, available * 1024);
            }
            catch (IOException) { return (null, null); }
            catch (UnauthorizedAccessException) { return (null, null); }
        }

        return (null, null);
    }

    private static async Task<double?> ReadCpuUtilizationAsync(CancellationToken cancellationToken)
    {
        if (OperatingSystem.IsLinux())
        {
            var first = ReadLinuxCpuCounters();
            if (first is null) return null;
            await Task.Delay(CpuSampleInterval, cancellationToken).ConfigureAwait(false);
            var second = ReadLinuxCpuCounters();
            if (second is null) return null;
            var elapsed = second.Value.Total - first.Value.Total;
            var idle = second.Value.Idle - first.Value.Idle;
            return elapsed <= 0 ? null : Math.Clamp((elapsed - idle) * 100d / elapsed, 0, 100);
        }

        if (OperatingSystem.IsWindows())
        {
            if (!GetSystemTimes(out var idleBefore, out var kernelBefore, out var userBefore)) return null;
            await Task.Delay(CpuSampleInterval, cancellationToken).ConfigureAwait(false);
            if (!GetSystemTimes(out var idleAfter, out var kernelAfter, out var userAfter)) return null;
            var idle = idleAfter.ToUInt64() - idleBefore.ToUInt64();
            var total = kernelAfter.ToUInt64() - kernelBefore.ToUInt64() + userAfter.ToUInt64() - userBefore.ToUInt64();
            return total == 0 ? null : Math.Clamp((total - idle) * 100d / total, 0, 100);
        }

        return null;
    }

    private static (ulong Total, ulong Idle)? ReadLinuxCpuCounters()
    {
        try
        {
            var fields = File.ReadLines("/proc/stat").FirstOrDefault()?.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (fields is null || fields.Length < 5 || fields[0] != "cpu") return null;
            var counters = fields.Skip(1).Select(value => ulong.Parse(value, CultureInfo.InvariantCulture)).ToArray();
            return (counters.Aggregate(0UL, (sum, value) => sum + value), counters[3] + (counters.Length > 4 ? counters[4] : 0));
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or FormatException or OverflowException) { return null; }
    }

    private static async Task<LocalGpuCapacity?> ReadNvidiaCapacityAsync(CancellationToken cancellationToken)
    {
        if (!OperatingSystem.IsWindows() && !OperatingSystem.IsLinux()) return null;
        using var process = new Process { StartInfo = new ProcessStartInfo
        {
            FileName = "nvidia-smi",
            Arguments = "--query-gpu=name,memory.total,memory.free,utilization.gpu --format=csv,noheader,nounits",
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        } };
        try
        {
            if (!process.Start()) return null;
            var outputTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(GpuTimeout);
            await process.WaitForExitAsync(timeout.Token).ConfigureAwait(false);
            if (process.ExitCode != 0) return null;
            var line = (await outputTask.ConfigureAwait(false)).Split('\n', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
            if (line is null) return null;
            var fields = line.Split(',').Select(value => value.Trim()).ToArray();
            if (fields.Length < 4) return null;
            var totalMb = ParseNumber(fields[1]);
            var freeMb = ParseNumber(fields[2]);
            var utilization = ParseNumber(fields[3]);
            return new LocalGpuCapacity(fields[0], totalMb is null ? null : (long)(totalMb.Value * 1024 * 1024), freeMb is null ? null : (long)(freeMb.Value * 1024 * 1024), utilization);
        }
        catch (Exception error) when (error is InvalidOperationException or System.ComponentModel.Win32Exception or IOException or OperationCanceledException)
        {
            try
            {
                if (!process.HasExited) process.Kill(entireProcessTree: true);
            }
            catch (InvalidOperationException) { }
            catch (System.ComponentModel.Win32Exception) { }
            return null;
        }
    }

    private static long ParseKilobytes(string value)
    {
        var number = value.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries)[0];
        return long.Parse(number, CultureInfo.InvariantCulture);
    }

    private static double? ParseNumber(string value) => double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var number) ? number : null;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
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
    private struct FileTime { public uint Low; public uint High; public readonly ulong ToUInt64() => ((ulong)High << 32) | Low; }

    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GlobalMemoryStatusEx(ref MemoryStatusEx buffer);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetSystemTimes(out FileTime idleTime, out FileTime kernelTime, out FileTime userTime);
}
