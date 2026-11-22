# Safe HTML artifact preview

## Goal

Let users preview a project HTML artifact in the existing coding workspace,
beside the editor and diff views, without navigating away or executing project
scripts in the desktop app.

## Integration plan

1. Reuse the existing bounded project file editor and draft state; no new
   persistence or route is needed.
2. Add a Preview mode only for `.html` files, alongside Editor and Review
   diff.
3. Render the current draft through a sandboxed `iframe` with no permissions.
   The preview must not receive Electron APIs, parent DOM access, forms, or
   script execution privileges.
4. Keep Save edit as the explicit write-back action and make the preview update
   from the unsaved draft so users can inspect changes before saving.
5. Verify typecheck, production build, syntax/bridge audits, and the existing
   project/editor smoke coverage.

## Acceptance

- HTML previews stay in the project workspace and use the current draft.
- Scripts and privileged browser capabilities are disabled.
- Non-HTML files keep their existing editor/diff behavior.
- The user can switch back to editing without losing the draft.

## Deferred

Interactive JavaScript artifacts, server-backed previews, browser automation,
and full artifact export remain later work.
