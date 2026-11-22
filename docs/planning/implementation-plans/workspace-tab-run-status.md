# Workspace tab run-status badges — implementation plan

## Goal
Make background work discoverable without a separate task dashboard by reflecting task state on the workspace tab that owns its conversation.

## Integration
- The persisted `WorkspaceSessionTab` already stores conversation IDs.
- `App.tsx` owns the workspace tab strip and has access to `routeState.tasks`.
- `DesktopTask` already stores conversation ID and statuses; `ChatPage` uses queued/running/verifying and completed as reviewable states.

## This slice
1. Pass current persisted tasks to `WorkspaceTabs`.
2. Derive the highest-priority state per tab conversation: running/verifying, queued, completed/needs review, then failed/attention.
3. Render a compact accessible label on each matching tab, with a title and text for assistive technology. Tabs without linked tasks remain visually unchanged.
4. Update the backlog. No new task state or persistence format is needed.

## Acceptance
- Only tasks linked to that tab's conversation affect its badge.
- Running outranks queued; queued outranks needs review; failed is shown only when no active/queued/review task exists.
- Typecheck/build pass; chat and project tabs still compile and retain existing keyboard behavior.
