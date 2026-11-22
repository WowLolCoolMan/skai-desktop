# Local scheduled dispatcher

## Outcome

Scheduled local prompts should run while Skai Desktop is open, without requiring a manual `scheduled.runNow` request. Each due entry is claimed durably, executed through the existing local `chat.complete` path, and completed with a bounded outcome. Recurring entries are rescheduled only after a successful run.

## Integration plan

1. Start one host-owned dispatcher loop alongside the stdio protocol loop.
2. Poll the durable scheduled-task store at a bounded interval and use `TryClaimDue` before any model call. The existing persisted `running` state prevents a claimed task from being replayed after restart.
3. Execute only loopback-configured local providers using the existing settings and `CompleteChatAsync`; pass the task workspace mode as the response mode so chat and coding schedules preserve their intent.
4. Persist a short success summary or a sanitized failure message with `ScheduledTaskStore.Complete`. A failed recurring run remains failed rather than silently rescheduling.
5. Keep the dispatcher single-flight, cancel it with host shutdown, and make scheduler errors observable through the task outcome without terminating the stdio protocol.
6. Extend the host smoke test with a short-due scheduled prompt against the existing mock local model and verify it reaches a terminal state and recurring success is rescheduled.

## Boundaries

- Local host lifecycle only; no cloud or external service execution.
- One scheduled run at a time, sharing the existing local model path.
- No automatic recovery of a task persisted as `running`; restart reconciliation remains the explicit safety boundary.
- Polling is bounded and does not change the public protocol surface.

## Verification

- Agent host build and syntax checks.
- Existing agent-host smoke suite plus unattended one-shot and recurring scheduler assertions.
- Native core tests, project/browser smoke tests, typecheck, and production build.
