# Keep project terminal actions in the workspace — implementation plan

## Goal
Prevent a project user from leaving the coding session just to access the terminal. The project workspace already owns the correct bottom dock.

## Integration
- `CodingSessionView` contains both a dock toggle and an “Open terminal” page-navigation button.
- `terminalOpen` is already persisted per project, and `TerminalPanel` is rendered in the workspace's bottom dock.
- Navigation to the global terminal remains useful from other app destinations, but should not be the primary project workflow.

## This slice
1. Remove the redundant second terminal action and the `CodingSessionView` route callback used only by that action.
2. Keep one clear “Show terminal” / “Hide terminal” toggle wired to the existing project dock.
3. Preserve terminal state per project and leave the global terminal destination untouched for its other entry points.
4. Update the backlog with the in-project behavior.

## Acceptance
- Opening the terminal from a project does not change route or active workspace tab.
- Closing/hiding the dock does not discard its project selection or output.
- Typecheck/build pass and unrelated project navigation remains available.
