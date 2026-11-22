# Remove the Agent Workbench destination

## Goal

Align the visible task workflow with the chosen product model: the
conversation that starts work is the task surface. Task status, changed files,
retry/stop actions, and review links remain in that thread; there is no second
Agent Workbench destination competing for the same job.

## Integration plan

1. Keep the persisted task and scheduled-run APIs intact because thread cards
   and future conversation scheduling still use them.
2. Remove the obsolete Agent Workbench command-palette entry and user-facing
   labels from the active navigation surfaces.
3. Keep old `/workbench` deep links backward-compatible by resolving them to
   the current Chat or Coding route, never rendering a workbench page.
4. Reword task planning and activity copy so users understand that the plan
   stays in the originating thread and can be reviewed there.
5. Update the backlog and verify navigation, typecheck, build, syntax,
   hygiene, native tests, and Agent Host smoke before syncing and pushing.

## Acceptance criteria

- No active navigation or command search advertises Agent Workbench.
- Existing `/workbench` links resolve safely without a dead or duplicate page.
- Chat task cards remain the visible place for status, stop/retry, and review.
- Task persistence and execution APIs are unchanged.
