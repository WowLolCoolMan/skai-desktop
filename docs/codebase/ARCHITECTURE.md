# Architecture

## Architectural Style

- Primary style: feature-oriented client with a local protocol host.
- The React client owns presentation and workflow state; the .NET host owns persistence, task execution, and local integrations.
- Constraints: local-first operation, typed request/response protocol, Electron desktop runtime.

## System Flow

```text
UI feature -> request bridge -> AgentHost dispatch -> domain/store -> typed response -> UI state
```

1. Feature hooks compose user state.
2. `request` sends protocol messages through the desktop bridge.
3. `AgentHostLoop.Dispatch.cs` selects a handler.
4. Conversation/task handlers load or mutate local state.
5. Responses update React state and local recovery state.

## Layer Responsibilities

| Layer | Owns | Must not own | Evidence |
|---|---|---|---|
| Feature UI | rendering and interaction state | file/database persistence | `apps/desktop/src/features` |
| Request bridge | transport and correlation | business rules | `apps/desktop/src/app` |
| Agent host | validation, orchestration, persistence | React rendering | `services/agent-host/Protocol` |
| Smoke scripts | black-box verification | production behavior | `scripts/smoke-*.cjs` |

## Known Risks

- Client and host request contracts can drift; `conversation.save` recently exposed this.
- Conversation persistence is file-backed and should gain stronger recovery/cleanup semantics.

## Evidence

- `apps/desktop/src/features/chat/useChatWorkspace.ts`
- `services/agent-host/Protocol/AgentHostLoop.Conversations.cs`
- `services/agent-host/Protocol/AgentHostLoop.Dispatch.cs`
