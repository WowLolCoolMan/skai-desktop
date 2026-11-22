# Capacity-aware local run preflight — implementation plan

## Goal
Give users an honest, local-only estimate of whether the selected model can start with current device headroom, including model size and configured context. This is the first vertical slice toward capacity-aware concurrent runs; it does not pretend to know runtime allocations that providers do not report.

## Integration points
- `LocalCapacitySnapshot` from the Agent Host is already polled by the desktop and displayed in the chat header.
- `Model` includes optional model size and context metadata; Ollama's configured context is available in workspace state.
- Chat and Coding Agent share `ChatPage`; Coding Agent work is started by `useChatWorkspace.sendMessage` after planning and queuing a task.
- The existing capacity popover is the right place to explain estimates without adding a new destination or blocking the composer.

## This slice
1. Add a pure desktop estimator for known model weights and measured RAM headroom. Show model context metadata separately; do not invent a context-cache or GPU-offload formula when the runtime does not expose enough information.
2. Show selected model, estimated minimum memory, current available RAM/VRAM, a clear status (room available / tight / unknown), and the limiting resource in the existing capacity popover.
3. Keep the estimate advisory. Sending remains user-controlled; no silent model switch, hard block, or false guarantee is introduced.
4. Add focused unit-level coverage for known, tight, and unknown measurements; update the future-feature backlog with the exact boundary and remaining scheduler work.

## Deferred
Capacity budgets, per-run resource accounting, multiple active run scheduling, auto-queue dispatch, loaded model memory aggregation, runtime-specific context/KV-cache formulas, AirLLM compatibility/setup decisions, and tray-resident execution require additional provider/runtime contracts and will be separate slices. In particular, AirLLM's current worker serializes requests and does not report live allocation, so the UI must not advertise concurrent AirLLM capacity.

## Acceptance
- Typecheck and production build pass.
- Estimates are deterministic and bounded (model weight plus 25% rough startup headroom), and missing model or device data produces `Unknown` rather than a guessed pass.
- Chat and Coding Agent both show the same estimate and can still be used when telemetry is unknown.
- No telemetry leaves the machine; no existing preferences or credentials are migrated or altered.
