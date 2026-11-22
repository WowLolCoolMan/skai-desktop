# Project session status bar

## Goal

Make the project workspace communicate its active context at a glance, without sending the user to a separate workbench or status page.

## Existing boundary

- `CodingPage` already owns the project workspace header and shortcut strip.
- `CodingSessionView` already receives Git status/diff, selected file state, and the project file draft.
- `AppRouteView` already owns the live `DesktopTask[]` collection.
- Project-linked tasks identify their project with `projectId` and expose `running`, `verifying`, `queued`, `completed`, `failed`, and `blocked` states.

## Integration

1. Pass the existing task collection into `CodingPage`; do not create a second task query.
2. Replace the shortcut-only strip with a compact status bar that reports:
   - active project and connected-folder count;
   - working-tree changes and unsaved editor state;
   - whether a diff is ready for review;
   - project-linked background task counts and the highest-priority state.
3. Keep keyboard shortcuts in the same bar so the workspace remains discoverable.
4. Keep the bar informational. Existing editor, Git review, and conversation controls remain the source of truth for actions.
5. Preserve responsive behavior: metrics may wrap on narrow windows, while shortcuts can collapse as they do today.

## Acceptance criteria

- Opening a project shows its folder count, Git change count, unsaved-file state, and linked task status without navigation.
- A project with no linked work clearly says there are no background tasks; stale tasks from another project are excluded.
- The bar reflects an edited file and a loaded diff immediately from existing props.
- Existing shortcuts and all existing project actions remain unchanged.
- Typecheck, build, project-browser smoke, syntax, hygiene, and diff checks pass.
