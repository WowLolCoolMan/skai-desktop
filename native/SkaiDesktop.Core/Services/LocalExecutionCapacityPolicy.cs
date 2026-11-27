namespace SkaiDesktop.Core.Services;

public sealed record LocalExecutionCapacityDecision(
    int SlotLimit,
    string LimitingResource,
    long? EstimatedRamPerTaskBytes,
    long? EffectiveAvailableRamBytes,
    long? EffectiveAvailableGpuBytes,
    string EstimateBasis);

/// <summary>Conservative local-only admission policy for durable coding tasks.</summary>
public static class LocalExecutionCapacityPolicy
{
    public const int MaximumSlots = 4;
    private const long ReservedRamBytes = 2L * 1024 * 1024 * 1024;
    private const long RamPerTaskBytes = 8L * 1024 * 1024 * 1024;
    private const long GpuPerTaskBytes = 6L * 1024 * 1024 * 1024;

    public static LocalExecutionCapacityDecision Decide(LocalCapacitySnapshot snapshot, long? ramBudgetBytes = null, long? gpuBudgetBytes = null, long? modelSizeBytes = null, int? modelContextLength = null, bool airLlmCompatible = false, bool airLlmAvailable = false)
    {
        if (snapshot.CpuUtilizationPercent is > 90)
            return Decision(0, "CPU pressure", null, snapshot.RamAvailableBytes, snapshot.Gpu?.AvailableBytes, modelSizeBytes, modelContextLength, airLlmCompatible && airLlmAvailable);
        if (snapshot.RamAvailableBytes is not > 0)
        {
            var gpuWithoutRam = snapshot.Gpu?.AvailableBytes is >= 0
                ? GetEffectiveGpuBytes(snapshot.Gpu, gpuBudgetBytes)
                : (long?)null;
            return gpuWithoutRam is <= 0
                ? Decision(0, "GPU memory", null, null, gpuWithoutRam, modelSizeBytes, modelContextLength, airLlmCompatible && airLlmAvailable)
                : Decision(1, "RAM telemetry unavailable", null, null, gpuWithoutRam, modelSizeBytes, modelContextLength, airLlmCompatible && airLlmAvailable);
        }

        var availableRam = ApplyBudget(snapshot.RamAvailableBytes.Value, snapshot.RamTotalBytes, ramBudgetBytes);
        // OS available-memory measurements already include resident model and
        // competing-process allocations. Runtime-reported loaded sizes remain
        // useful telemetry, but subtracting them here would count them twice.
        if (availableRam <= 0) return Decision(0, "RAM budget", null, availableRam, snapshot.Gpu?.AvailableBytes, modelSizeBytes, modelContextLength, airLlmCompatible && airLlmAvailable);
        var perTaskRam = EstimateRamPerTask(modelSizeBytes, modelContextLength, airLlmCompatible && airLlmAvailable);
        var ramSlots = Math.Max(0, (int)((availableRam - ReservedRamBytes) / perTaskRam));
        var slotLimit = Math.Clamp(ramSlots, 0, MaximumSlots);
        var limitingResource = "RAM headroom";

        if (snapshot.Gpu?.AvailableBytes is >= 0)
        {
            var availableGpu = GetEffectiveGpuBytes(snapshot.Gpu, gpuBudgetBytes);
            var gpuSlots = Math.Max(0, (int)(availableGpu / (airLlmCompatible && airLlmAvailable ? 1L * 1024 * 1024 * 1024 : GpuPerTaskBytes)));
            if (gpuSlots < slotLimit) { slotLimit = gpuSlots; limitingResource = "GPU memory"; }
        }

        long? effectiveGpu = snapshot.Gpu?.AvailableBytes is >= 0
            ? GetEffectiveGpuBytes(snapshot.Gpu, gpuBudgetBytes)
            : null;
        return Decision(Math.Clamp(slotLimit, 0, MaximumSlots), limitingResource, perTaskRam, availableRam, effectiveGpu, modelSizeBytes, modelContextLength, airLlmCompatible && airLlmAvailable);
    }

    private static LocalExecutionCapacityDecision Decision(int slots, string limiter, long? ramPerTask, long? availableRam, long? availableGpu, long? modelSizeBytes, int? contextLength, bool diskStreamed)
    {
        var modelBasis = modelSizeBytes is > 0
            ? "Model file size reported; it reflects the selected quantization."
            : "Conservative default estimate because model size is unavailable.";
        var contextBasis = contextLength is > 0 ? " Context cache is conservatively estimated from the configured context window." : " Context cache is not estimated because the active context window is unknown; advertised maximum context is not treated as active.";
        var backendBasis = diskStreamed ? " Disk-streamed backend estimate is active." : " Standard runtime overhead estimate is active.";
        return new(slots, limiter, ramPerTask, availableRam, availableGpu, modelBasis + contextBasis + backendBasis);
    }

    private static long EstimateRamPerTask(long? modelSizeBytes, int? contextLength, bool useAirLlm)
    {
        var weightMultiplier = useAirLlm ? 0.35 : 1.25;
        var weights = modelSizeBytes is > 0
            ? modelSizeBytes.Value >= long.MaxValue / weightMultiplier
                ? long.MaxValue
                : (long)(modelSizeBytes.Value * weightMultiplier)
            : RamPerTaskBytes;
        // Keep context overhead bounded and proportional to the active window;
        // the runtime's loaded-weight telemetry is already represented by the
        // model-size estimate above. AirLLM uses the same conservative cache
        // bound because its disk-streamed weights do not imply zero KV cache.
        const long cacheBytesPerToken = 4L;
        var context = contextLength is > 0
            ? Math.Clamp((long)contextLength.Value * cacheBytesPerToken, 256L * 1024 * 1024, 8L * 1024 * 1024 * 1024)
            : 0;
        return Math.Max(1L * 1024 * 1024 * 1024, weights > long.MaxValue - context ? long.MaxValue : weights + context);
    }

    private static long ApplyBudget(long availableBytes, long? totalBytes, long? budgetBytes)
    {
        if (budgetBytes is not > 0) return availableBytes;
        if (totalBytes is not > 0) return Math.Min(availableBytes, budgetBytes.Value);
        var usedBytes = Math.Max(0, totalBytes.Value - availableBytes);
        return Math.Max(0, Math.Min(availableBytes, budgetBytes.Value - usedBytes));
    }

    private static long GetEffectiveGpuBytes(LocalGpuCapacity gpu, long? userBudgetBytes)
    {
        if (gpu.AvailabilityScope != "application-budget" || gpu.BudgetBytes is not > 0 || gpu.ProcessUsageBytes is not >= 0)
            return ApplyBudget(gpu.AvailableBytes ?? 0, gpu.TotalBytes, userBudgetBytes);

        var budget = userBudgetBytes is > 0 ? Math.Min(gpu.BudgetBytes.Value, userBudgetBytes.Value) : gpu.BudgetBytes.Value;
        return Math.Max(0, budget - gpu.ProcessUsageBytes.Value);
    }
}
