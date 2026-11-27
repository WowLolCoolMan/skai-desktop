# Concerns

## Current Risks

- Conversation state is persisted through a local JSON store rather than a transactional database.
- Client/host contracts are not generated from a single schema.
- Long-running agent tasks need stronger resume/reconnect semantics.
- [TODO] Measure conversation-store growth and cleanup behavior on large histories.

## Donor-Informed Direction

- Adopt Odysseus-style durable sessions, message indexes, cleanup, and context compaction where compatible with Skai’s local desktop model.
- Adopt Agent Desktop-style explicit session identity and recovery boundaries.

## Evidence

- `services/agent-host/Protocol/AgentHostLoop.Conversations.cs`
- `scripts/smoke-agent-host.cjs`
- `docs/codebase/.codebase-scan.txt`
