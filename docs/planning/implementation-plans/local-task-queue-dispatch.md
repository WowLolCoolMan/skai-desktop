# Automatic local task queue dispatch — implementation plan

## Goal

Make queued coding tasks start automatically when the current local task finishes, while preserving durable task state and cancellation.

## Integration

- `AgentTaskArtifactStore` already persists `queued`, `running`, and terminal states.
- `AgentHostLoop.StartTaskExecution` currently starts every request immediately and tracks it in `ActiveTaskExecutions`.
- The renderer already polls `tasks.list` and shows queued/running states on the conversation and workspace tab.

## This slice

1. Add one shared local execution slot in the Agent Host.
2. Let `tasks.execute` create a cancellable queued execution; start immediately when the slot is free, otherwise leave the durable task queued.
3. Release the slot after success, failure, or cancellation so the next submitted task starts automatically.
4. Make cancellation distinguish a task still waiting in the queue from a task already running.
5. Add a protocol test that submits two queued tasks and verifies the second waits, then starts after the first releases the slot.

## Deferred

Capacity-derived multi-slot concurrency, per-model weight/context reservations, live VRAM accounting, AirLLM compatibility selection, pause/continue generation, and user-configurable RAM/VRAM budgets require provider-specific runtime telemetry and remain separate slices.

## Acceptance

- At most one local coding task executes at a time in this conservative scheduler.
- A second task is reported as `queued`, remains durable, and starts without another user action after the first ends.
- Cancelling a waiting task marks it cancelled and it never claims execution.
- Cancelling a running task preserves the existing cancellation behavior.
- Native tests, typecheck, build, and bridge audit pass.
