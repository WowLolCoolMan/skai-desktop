using SkaiDesktop.Core.Services;
using static TestSupport;

internal static class LocalExecutionCapacityPolicyTests
{
    public static void Run()
    {
        var unknown = LocalExecutionCapacityPolicy.Decide(new(DateTimeOffset.UtcNow, null, null, null, null, "unknown"));
        Check(unknown.SlotLimit == 1 && unknown.LimitingResource.Contains("unavailable", StringComparison.Ordinal), "unknown capacity telemetry stays single-slot");

        var pressured = LocalExecutionCapacityPolicy.Decide(new(DateTimeOffset.UtcNow, 64L << 30, 48L << 30, 95, null, null));
        Check(pressured.SlotLimit == 1 && pressured.LimitingResource == "CPU pressure", "critical CPU pressure stays single-slot");

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

        var loaded = LocalExecutionCapacityPolicy.Decide(new(DateTimeOffset.UtcNow, 64L << 30, 24L << 30, 20, null, null), loadedRamBytes: 12L << 30);
        Check(loaded.SlotLimit == 1 && loaded.LimitingResource == "RAM headroom", "reported loaded model memory reduces available admission headroom");
    }
}
