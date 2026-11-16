namespace SkaiDesktop.Core.Services;

public sealed record LocalExecutionCapacityDecision(int SlotLimit, string LimitingResource);

/// <summary>Conservative local-only admission policy for durable coding tasks.</summary>
public static class LocalExecutionCapacityPolicy
{
    public const int MaximumSlots = 4;
    private const long ReservedRamBytes = 2L * 1024 * 1024 * 1024;
    private const long RamPerTaskBytes = 8L * 1024 * 1024 * 1024;
    private const long GpuPerTaskBytes = 6L * 1024 * 1024 * 1024;

    public static LocalExecutionCapacityDecision Decide(LocalCapacitySnapshot snapshot)
    {
        if (snapshot.RamAvailableBytes is not > 0)
            return new(1, "RAM telemetry unavailable");
        if (snapshot.CpuUtilizationPercent is > 90)
            return new(1, "CPU pressure");

        var ramSlots = Math.Max(1, (int)((snapshot.RamAvailableBytes.Value - ReservedRamBytes) / RamPerTaskBytes));
        var slotLimit = Math.Clamp(ramSlots, 1, MaximumSlots);
        var limitingResource = "RAM headroom";

        if (snapshot.Gpu?.AvailableBytes is > 0)
        {
            var gpuSlots = Math.Max(1, (int)(snapshot.Gpu.AvailableBytes.Value / GpuPerTaskBytes));
            if (gpuSlots < slotLimit) { slotLimit = gpuSlots; limitingResource = "GPU memory"; }
        }

        return new(Math.Clamp(slotLimit, 1, MaximumSlots), limitingResource);
    }
}
