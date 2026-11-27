# Structure

## Major Areas

| Area | Responsibility | Evidence |
|---|---|---|
| `apps/desktop/src` | React desktop UI and feature workflows | `apps/desktop/src/App.tsx` |
| `apps/desktop/src/features/chat` | Chat state, streaming, persistence requests | `apps/desktop/src/features/chat/useChatWorkspace.ts` |
| `apps/desktop/src/features/coding` | Coding Agent, Monaco, project browser | `apps/desktop/src/features/coding/CodingSessionView.tsx` |
| `services/agent-host/Protocol` | Local request dispatch and domain operations | `services/agent-host/Protocol/AgentHostLoop.Dispatch.cs` |
| `scripts` | Smoke tests and packaging utilities | `scripts/smoke-agent-host.cjs` |

## Entry Points

- UI: `apps/desktop/src/main.tsx`, `apps/desktop/src/App.tsx`
- Host dispatch: `services/agent-host/Protocol/AgentHostLoop.Dispatch.cs`
- Electron packaging: `apps/desktop/electron/main.cjs`

## Evidence

- `apps/desktop/src`
- `services/agent-host`
- `scripts`
