# Conventions

## Core

- React feature state is kept in hooks and page components.
- Host operations validate bounded strings and protocol enums before mutation.
- Errors are returned as protocol failures and surfaced through UI error state.
- Smoke tests use disposable profile paths and black-box protocol requests.

## Evidence

- `apps/desktop/src/features/chat/useChatWorkspace.ts`
- `services/agent-host/Protocol/AgentHostLoop.Conversations.cs`
- `scripts/smoke-agent-host.cjs`
