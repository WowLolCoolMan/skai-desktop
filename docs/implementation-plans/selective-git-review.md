# Selective Git review

## Goal

Make the project workspace's Git review match the existing guarded backend:
users can choose exactly which changed files to inspect and commit, while
unselected work remains untouched.

## Integration plan

1. Keep the existing project Git status and path validation as the source of
   truth; do not add a second staging store.
2. Track the selected changed paths only in the workspace view, defaulting to
   all current changes whenever Git status refreshes.
3. Pass the selected paths to both diff preview and commit requests. Keep
   conflict blocking, bounded path limits, and secret-file protections in the
   existing native service.
4. Show explicit selection controls, select-all/clear actions, and the count
   in the commit button so a partial commit is never ambiguous.
5. Verify the renderer typecheck/build and the existing native selective-Git
   tests, then run Agent Host/syntax/bridge smoke checks.

## Acceptance

- A user can review and commit a subset of changed files in the project tab.
- Unselected changes remain in the working tree after commit.
- Empty selection disables review and commit actions.
- Conflict and protected-path safeguards remain unchanged.
- Selection resets when Git status reports a different change set.

## Deferred

Interactive hunk staging, partial-line staging, and a persistent staging area
remain later work.
