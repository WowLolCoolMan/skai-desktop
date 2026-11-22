# Conversation-owned scheduled runs

## Goal

Keep scheduled work inside the conversation that created it. Users should be able to create and manage a local schedule from the thread, and completed results should be appended to that same thread instead of disappearing into a separate dashboard.

## Integration plan

1. Persist an optional conversation ID on scheduled tasks with backward-compatible loading for existing schedules.
2. Pass the active conversation ID through the renderer and Agent Host schedule-create protocol.
3. Filter the thread panel to its conversation and expose create, pause/resume, run-now, and cancel actions.
4. When a scheduled run completes, append a clearly labeled assistant result to the owning conversation.
5. Preserve unowned legacy schedules in the local store and keep the existing scheduler behavior.

## Acceptance criteria

- A schedule created in a chat is visible and manageable in that chat only.
- A completed run adds its bounded result to the owning conversation.
- Existing schedules without a conversation ID remain valid and executable.
- Typecheck, build, native tests, and Agent Host smoke pass.
