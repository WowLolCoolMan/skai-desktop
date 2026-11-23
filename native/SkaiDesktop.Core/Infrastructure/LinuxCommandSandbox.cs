using System.Diagnostics;

namespace SkaiDesktop.Core.Infrastructure;

/// <summary>Builds a fail-closed Bubblewrap command boundary for approved Linux workspace commands.</summary>
internal static class LinuxCommandSandbox
{
    public const string ExecutionStartedMarker = "__SKAI_LINUX_SANDBOX_READY_6C0F5147__";
    public const uint MaxActiveProcesses = 128;
    public const int MaxCpuCores = 4;
    private static readonly string[] ReadOnlySystemMounts = ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc"];

    public static ProcessStartInfo CreateStartInfo(
        string selectedRoot,
        string workingDirectory,
        string command,
        IEnumerable<KeyValuePair<string, string?>> inheritedEnvironment,
        ulong? memoryLimitBytesOverride)
    {
        var bubblewrap = FindBubblewrap();
        var systemdRun = FindSystemdRun();
        EnsureSafeWorkspacePath(selectedRoot);

        var startInfo = new ProcessStartInfo
        {
            FileName = bubblewrap,
            WorkingDirectory = selectedRoot,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = System.Text.Encoding.UTF8,
            StandardErrorEncoding = System.Text.Encoding.UTF8
        };
        startInfo.Environment.Clear();
        foreach (var (name, value) in inheritedEnvironment)
            if (value is not null) startInfo.Environment[name] = value;

        startInfo.ArgumentList.Add("--die-with-parent");
        startInfo.ArgumentList.Add("--new-session");
        startInfo.ArgumentList.Add("--unshare-user-try");
        startInfo.ArgumentList.Add("--unshare-pid");
        startInfo.ArgumentList.Add("--unshare-net");
        startInfo.ArgumentList.Add("--unshare-ipc");
        startInfo.ArgumentList.Add("--unshare-uts");
        foreach (var mount in ReadOnlySystemMounts)
        {
            startInfo.ArgumentList.Add("--ro-bind-try");
            startInfo.ArgumentList.Add(mount);
            startInfo.ArgumentList.Add(mount);
        }
        startInfo.ArgumentList.Add("--dev");
        startInfo.ArgumentList.Add("/dev");
        startInfo.ArgumentList.Add("--proc");
        startInfo.ArgumentList.Add("/proc");
        startInfo.ArgumentList.Add("--tmpfs");
        startInfo.ArgumentList.Add("/tmp");
        startInfo.ArgumentList.Add("--tmpfs");
        startInfo.ArgumentList.Add("/run");

        var environment = inheritedEnvironment.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.OrdinalIgnoreCase);
        // Do not mount arbitrary PATH entries: a broad or user-controlled entry
        // (for example /tmp or a home directory) would expose host data.
        const string executablePath = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

        startInfo.ArgumentList.Add("--bind");
        startInfo.ArgumentList.Add(selectedRoot);
        startInfo.ArgumentList.Add(selectedRoot);
        startInfo.ArgumentList.Add("--dir");
        startInfo.ArgumentList.Add("/tmp/skai-home");
        startInfo.ArgumentList.Add("--dir");
        startInfo.ArgumentList.Add("/tmp/skai-nuget");
        startInfo.ArgumentList.Add("--chdir");
        startInfo.ArgumentList.Add(workingDirectory);
        startInfo.ArgumentList.Add("--clearenv");
        startInfo.ArgumentList.Add("--setenv");
        startInfo.ArgumentList.Add("PATH");
        startInfo.ArgumentList.Add(executablePath);
        startInfo.ArgumentList.Add("--setenv");
        startInfo.ArgumentList.Add("HOME");
        startInfo.ArgumentList.Add("/tmp/skai-home");
        startInfo.ArgumentList.Add("--setenv");
        startInfo.ArgumentList.Add("TMPDIR");
        startInfo.ArgumentList.Add("/tmp");
        startInfo.ArgumentList.Add("--setenv");
        startInfo.ArgumentList.Add("TMP");
        startInfo.ArgumentList.Add("/tmp");
        startInfo.ArgumentList.Add("--setenv");
        startInfo.ArgumentList.Add("TEMP");
        startInfo.ArgumentList.Add("/tmp");
        startInfo.ArgumentList.Add("--setenv");
        startInfo.ArgumentList.Add("NUGET_PACKAGES");
        startInfo.ArgumentList.Add("/tmp/skai-nuget");
        foreach (var name in new[] { "LANG", "LC_ALL", "TERM", "CI", "DOTNET_ROOT", "DOTNET_ROOT_X64" })
        {
            if (!environment.TryGetValue(name, out var value) || string.IsNullOrWhiteSpace(value)) continue;
            if (name.StartsWith("DOTNET_ROOT", StringComparison.Ordinal) && !IsWithinReadOnlySystemTree(value)) continue;
            startInfo.ArgumentList.Add("--setenv");
            startInfo.ArgumentList.Add(name);
            startInfo.ArgumentList.Add(value);
        }
        startInfo.ArgumentList.Add("--");
        startInfo.ArgumentList.Add("/bin/sh");
        startInfo.ArgumentList.Add("-c");
        startInfo.ArgumentList.Add("printf '%s' \"$1\"; exec /bin/sh -c \"$2\"");
        startInfo.ArgumentList.Add("skai-linux-sandbox");
        startInfo.ArgumentList.Add(ExecutionStartedMarker);
        startInfo.ArgumentList.Add(command);
        return ApplyCgroupLimits(startInfo, systemdRun, inheritedEnvironment, memoryLimitBytesOverride);
    }

    public static string FindBubblewrap()
    {
        foreach (var candidate in new[] { "/usr/bin/bwrap", "/bin/bwrap" })
            if (File.Exists(candidate)) return candidate;
        throw new InvalidOperationException("Coding Agent commands require Bubblewrap (bwrap) on Linux. Install Bubblewrap and ensure user, PID, and network namespaces are available; Skai will not run this command without its Linux sandbox.");
    }

    public static string Status(ulong memoryLimitBytes) =>
        $"Linux Bubblewrap and systemd cgroup sandbox active (selected project writable; system paths read-only; temporary files isolated; network disabled; process-tree memory cap {FormatGigabytes(memoryLimitBytes)} GiB; maximum {MaxActiveProcesses} processes; CPU quota {GetCpuQuotaPercent()}%).";

    private static ProcessStartInfo ApplyCgroupLimits(
        ProcessStartInfo bubblewrap,
        string systemdRun,
        IEnumerable<KeyValuePair<string, string?>> inheritedEnvironment,
        ulong? memoryLimitBytesOverride)
    {
        var memoryLimit = GetMemoryLimitBytes(memoryLimitBytesOverride);
        var startInfo = new ProcessStartInfo
        {
            FileName = systemdRun,
            WorkingDirectory = bubblewrap.WorkingDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = System.Text.Encoding.UTF8,
            StandardErrorEncoding = System.Text.Encoding.UTF8
        };
        startInfo.Environment.Clear();
        foreach (var (name, value) in inheritedEnvironment)
            if (value is not null) startInfo.Environment[name] = value;

        startInfo.ArgumentList.Add("--user");
        startInfo.ArgumentList.Add("--scope");
        startInfo.ArgumentList.Add("--quiet");
        startInfo.ArgumentList.Add($"--unit=skai-coding-command-{Guid.NewGuid():N}.scope");
        startInfo.ArgumentList.Add($"--property=MemoryMax={memoryLimit}");
        startInfo.ArgumentList.Add("--property=MemorySwapMax=0");
        startInfo.ArgumentList.Add($"--property=TasksMax={MaxActiveProcesses}");
        startInfo.ArgumentList.Add($"--property=CPUQuota={GetCpuQuotaPercent()}%");
        startInfo.ArgumentList.Add("--");
        startInfo.ArgumentList.Add(bubblewrap.FileName);
        foreach (var argument in bubblewrap.ArgumentList) startInfo.ArgumentList.Add(argument);
        return startInfo;
    }

    private static string FindSystemdRun()
    {
        foreach (var candidate in new[] { "/usr/bin/systemd-run", "/bin/systemd-run" })
            if (File.Exists(candidate)) return candidate;
        throw new InvalidOperationException("Coding Agent commands require systemd-run and an active user systemd manager on Linux to enforce process-tree memory, process-count, and CPU limits. Skai will not run this command without those limits.");
    }

    private static int GetCpuQuotaPercent() => Math.Clamp(Environment.ProcessorCount, 1, MaxCpuCores) * 100;

    public static ulong GetMemoryLimitBytes(ulong? memoryLimitBytesOverride)
    {
        var availableMemory = GC.GetGCMemoryInfo().TotalAvailableMemoryBytes;
        var estimatedLimit = CommandResourceLimits.EstimateJobMemoryLimitBytes(availableMemory > 0 ? (ulong)availableMemory : 0);
        return memoryLimitBytesOverride is { } requestedLimit ? Math.Min(estimatedLimit, requestedLimit) : estimatedLimit;
    }

    private static string FormatGigabytes(ulong bytes) =>
        (bytes / (1024d * 1024 * 1024)).ToString("0.0", System.Globalization.CultureInfo.InvariantCulture);

    private static bool IsWithinReadOnlySystemTree(string path)
    {
        if (!Path.IsPathRooted(path)) return false;
        var fullPath = Path.GetFullPath(path);
        return ReadOnlySystemMounts.Any(root =>
            fullPath.Equals(root, StringComparison.Ordinal) ||
            fullPath.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.Ordinal));
    }

    private static void EnsureSafeWorkspacePath(string selectedRoot)
    {
        var root = Path.GetFullPath(selectedRoot);
        if (!Directory.Exists(root) || (File.GetAttributes(root) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidOperationException("The selected Linux project folder is unavailable or linked and cannot be mounted as a sandbox boundary.");
        if (root == Path.GetPathRoot(root))
            throw new InvalidOperationException("The Linux sandbox cannot expose a filesystem root as a writable project.");
        foreach (var protectedRoot in ReadOnlySystemMounts)
        {
            if (root.Equals(protectedRoot, StringComparison.Ordinal) ||
                root.StartsWith(protectedRoot.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.Ordinal))
                throw new InvalidOperationException("The selected project is inside a protected Linux system path and cannot be mounted writable.");
        }

    }
}
