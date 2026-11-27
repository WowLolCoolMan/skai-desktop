using SkaiDesktop.Core.Services;
using static TestSupport;

internal static class LocalExecutionCapacityPolicyTests
{
    public static void Run()
    {
        var unknown = LocalExecutionCapacityPolicy.Decide(new(DateTimeOffset.UtcNow, null, null, null, null, "unknown"));
        Check(unknown.SlotLimit == 1 && unknown.LimitingResource.Contains("unavailable", StringComparison.Ordinal), "unknown capacity telemetry stays single-slot");

        var unknownRamFullGpu = LocalExecutionCapacityPolicy.Decide(new(DateTimeOffset.UtcNow, null, null, null, new LocalGpuCapacity("Full GPU", 16L << 30, 0, 99), "RAM unavailable"));
        Check(unknownRamFullGpu.SlotLimit == 0 && unknownRamFullGpu.LimitingResource == "GPU memory", "measured full GPU still blocks admission when RAM telemetry is unavailable");

        var pressured = LocalExecutionCapacityPolicy.Decide(new(DateTimeOffset.UtcNow, 64L << 30, 48L << 30, 95, null, null));
        Check(pressured.SlotLimit == 0 && pressured.LimitingResource == "CPU pressure", "critical CPU pressure pauses new task admission");

        var insufficientRam = LocalExecutionCapacityPolicy.Decide(new(DateTimeOffset.UtcNow, 16L << 30, 3L << 30, 10, null, null));
        Check(insufficientRam.SlotLimit == 0 && insufficientRam.LimitingResource == "RAM headroom", "insufficient RAM headroom queues work until capacity improves");

        var memoryLimited = LocalExecutionCapacityPolicy.Decide(new(DateTimeOffset.UtcNow, 64L << 30, 26L << 30, 20, null, null));
        Check(memoryLimited.SlotLimit == 3 && memoryLimited.LimitingResource == "RAM headroom", "RAM headroom derives a conservative slot limit");

        var gpuLimited = LocalExecutionCapacityPolicy.Decide(new(DateTimeOffset.UtcNow, 128L << 30, 80L << 30, 20, new LocalGpuCapacity("Test GPU", 24L << 30, 7L << 30, 10), null));
        Check(gpuLimited.SlotLimit == 1 && gpuLimited.LimitingResource == "GPU memory", "GPU memory can lower the slot limit");

        var capped = LocalExecutionCapacityPolicy.Decide(new(DateTimeOffset.UtcNow, 128L << 30, 80L << 30, 20, null, null));
        Check(capped.SlotLimit == LocalExecutionCapacityPolicy.MaximumSlots, "capacity policy never exceeds the scheduler cap");

        var budgeted = LocalExecutionCapacityPolicy.Decide(new(DateTimeOffset.UtcNow, 64L << 30, 40L << 30, 20, null, null), 48L << 30);
        Check(budgeted.SlotLimit == 2 && budgeted.LimitingResource == "RAM headroom", "explicit RAM budget limits admission without exceeding remaining headroom");

        var airLlm = LocalExecutionCapacityPolicy.Decide(new(DateTimeOffset.UtcNow, 64L << 30, 24L << 30, 20, new LocalGpuCapacity("Test GPU", 16L << 30, 2L << 30, 10), null), modelSizeBytes: 24L << 30, modelContextLength: 131072, airLlmCompatible: true, airLlmAvailable: true);
        Check(airLlm.SlotLimit >= 2, "AirLLM-compatible admission uses the lower disk-streamed weight estimate when available");

        var zeroGpu = LocalExecutionCapacityPolicy.Decide(new(DateTimeOffset.UtcNow, 64L << 30, 40L << 30, 20, new LocalGpuCapacity("Full GPU", 16L << 30, 0, 99), null));
        Check(zeroGpu.SlotLimit == 0 && zeroGpu.LimitingResource == "GPU memory", "a measured full GPU blocks additional GPU-bound work");

        var measured = LocalExecutionCapacityPolicy.Decide(new(DateTimeOffset.UtcNow, 64L << 30, 40L << 30, 20, null, null), modelSizeBytes: 20L << 30, modelContextLength: 131072);
        Check(measured.SlotLimit == 1 && measured.EffectiveAvailableRamBytes == 40L << 30 && measured.EstimatedRamPerTaskBytes > 20L << 30 && measured.EstimateBasis.Contains("quantization", StringComparison.OrdinalIgnoreCase), "capacity estimate labels reported model size, context overhead, and measured available RAM without double-subtracting loaded weights");

        var extremeModel = LocalExecutionCapacityPolicy.Decide(new(DateTimeOffset.UtcNow, 64L << 30, 40L << 30, 20, null, null), modelSizeBytes: long.MaxValue, modelContextLength: int.MaxValue);
        Check(extremeModel.SlotLimit == 0 && extremeModel.EstimatedRamPerTaskBytes == long.MaxValue, "extreme model metadata saturates safely and pauses admission");
    }
}
