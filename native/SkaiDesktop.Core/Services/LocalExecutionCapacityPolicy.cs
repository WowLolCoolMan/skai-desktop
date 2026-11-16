namespace SkaiDesktop.Core.Services;

public sealed record LocalExecutionCapacityDecision(int SlotLimit, string LimitingResource);

/// <summary>Conservative local-only admission policy for durable coding tasks.</summary>
public static class LocalExecutionCapacityPolicy
{
    public const int MaximumSlots = 4;
    private const long ReservedRamBytes = 2L * 1024 * 1024 * 1024;
    private const long RamPerTaskBytes = 8L * 1024 * 1024 * 1024;
    private const long GpuPerTaskBytes = 6L * 1024 * 1024 * 1024;

    public static LocalExecutionCapacityDecision Decide(LocalCapacitySnapshot snapshot, long? ramBudgetBytes = null, long? gpuBudgetBytes = null, long? modelSizeBytes = null, int? modelContextLength = null, bool airLlmCompatible = false, bool airLlmAvailable = false, long? loadedRamBytes = null, long? loadedGpuBytes = null)
    {
        if (snapshot.RamAvailableBytes is not > 0)
            return new(1, "RAM telemetry unavailable");
        if (snapshot.CpuUtilizationPercent is > 90)
            return new(1, "CPU pressure");

        var availableRam = ApplyBudget(snapshot.RamAvailableBytes.Value, snapshot.RamTotalBytes, ramBudgetBytes);
        if (loadedRamBytes is > 0) availableRam = Math.Max(0, availableRam - loadedRamBytes.Value);
        if (availableRam <= 0) return new(1, "RAM budget");
        var perTaskRam = EstimateRamPerTask(modelSizeBytes, modelContextLength, airLlmCompatible && airLlmAvailable);
        var ramSlots = Math.Max(1, (int)((availableRam - ReservedRamBytes) / perTaskRam));
        var slotLimit = Math.Clamp(ramSlots, 1, MaximumSlots);
        var limitingResource = "RAM headroom";

        if (snapshot.Gpu?.AvailableBytes is > 0)
        {
            var availableGpu = ApplyBudget(snapshot.Gpu.AvailableBytes.Value, snapshot.Gpu.TotalBytes, gpuBudgetBytes);
            if (loadedGpuBytes is > 0) availableGpu = Math.Max(0, availableGpu - loadedGpuBytes.Value);
            var gpuSlots = Math.Max(1, (int)(availableGpu / (airLlmCompatible && airLlmAvailable ? 1L * 1024 * 1024 * 1024 : GpuPerTaskBytes)));
            if (gpuSlots < slotLimit) { slotLimit = gpuSlots; limitingResource = "GPU memory"; }
        }

        return new(Math.Clamp(slotLimit, 1, MaximumSlots), limitingResource);
    }

    private static long EstimateRamPerTask(long? modelSizeBytes, int? contextLength, bool useAirLlm)
    {
        var weights = modelSizeBytes is > 0 ? (long)(modelSizeBytes.Value * (useAirLlm ? 0.35 : 1.25)) : RamPerTaskBytes;
        var context = contextLength is > 0 ? Math.Clamp((long)contextLength.Value * 4, 256L * 1024 * 1024, 8L * 1024 * 1024 * 1024) : 0;
        return Math.Max(1L * 1024 * 1024 * 1024, weights + context);
    }

    private static long ApplyBudget(long availableBytes, long? totalBytes, long? budgetBytes)
    {
        if (budgetBytes is not > 0) return availableBytes;
        if (totalBytes is not > 0) return Math.Min(availableBytes, budgetBytes.Value);
        var usedBytes = Math.Max(0, totalBytes.Value - availableBytes);
        return Math.Min(availableBytes, budgetBytes.Value - usedBytes);
    }
}
