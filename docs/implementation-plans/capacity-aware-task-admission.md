# Capacity-aware local task admission

## Goal

Allow more than one local coding task only when the device has enough measured headroom, while keeping unknown telemetry conservative and preserving the existing durable queue.

## Integration

1. Add a pure capacity policy over the existing local RAM, GPU, and CPU snapshot.
2. Use a small fixed upper bound of four admitted tasks; derive the active limit from available memory and CPU pressure.
3. Keep one slot when RAM or GPU telemetry is unavailable, or when CPU load is critically high.
4. Replace the hard-coded host semaphore with an admission gate that re-evaluates capacity while queued tasks wait.
5. Report the same dynamic limit through `system.capacity`, so the UI does not advertise a different scheduler than the executor uses.
6. Leave direct chat generation and runtime-specific model allocation unchanged; this slice governs durable coding-task execution only.

## Acceptance criteria

- A known healthy device can admit more than one task when the policy permits it.
- Unknown or pressured devices remain single-slot and queue additional tasks.
- A queued task starts after capacity becomes available or a running task finishes.
- Cancellation while waiting does not leak an admission slot.
- Unit tests cover unknown telemetry, CPU pressure, memory-derived limits, and the four-slot cap.
