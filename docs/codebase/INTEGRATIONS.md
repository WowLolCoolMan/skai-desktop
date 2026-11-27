# Integrations

## Local Integrations

| Integration | Purpose | Evidence |
|---|---|---|
| Electron | desktop shell and native bridge | `apps/desktop/electron/main.cjs` |
| Local Agent Host | model, task, conversation, and settings protocol | `services/agent-host` |
| Monaco | code editing | `apps/desktop/src/features/coding` |
| Local voice runtimes | speech input/output | `services/agent-host/Protocol`, `scripts/start-skai-realtime-voice.ps1` |

## Evidence

- `apps/desktop/electron/main.cjs`
- `services/agent-host/Protocol/AgentHostLoop.Dispatch.cs`
- `scripts/start-skai-realtime-voice.ps1`
