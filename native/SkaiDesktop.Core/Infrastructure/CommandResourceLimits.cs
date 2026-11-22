namespace SkaiDesktop.Core.Infrastructure;

/// <summary>Conservative memory budget for a Coding Agent command process tree.</summary>
public static class CommandResourceLimits
{
    public const ulong MinimumJobMemoryBytes = 256UL * 1024 * 1024;
    public const ulong MaximumJobMemoryBytes = 8UL * 1024 * 1024 * 1024;

    /// <summary>Use half of currently available physical memory, bounded for small and large hosts.</summary>
    public static ulong EstimateJobMemoryLimitBytes(ulong availablePhysicalBytes)
    {
        var halfAvailable = availablePhysicalBytes / 2;
        return Math.Clamp(halfAvailable, MinimumJobMemoryBytes, MaximumJobMemoryBytes);
    }
}
