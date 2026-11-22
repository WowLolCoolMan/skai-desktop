# Safe SVG artifact preview

## Outcome

Project workspaces should preview local SVG diagrams beside their source without leaving the project tab. SVG files remain editable text, previews reflect the current unsaved draft, and the preview has no script or Electron privileges.

## Integration plan

1. Treat `.svg` as a bounded project text format and expose it as a distinct `svg` file kind in the project tree.
2. Reuse the existing guarded text read/write and draft persistence path, rather than adding a second artifact store.
3. Add a Preview action for SVG files that renders the current draft in an empty-sandbox iframe, matching the existing HTML preview boundary.
4. Keep SVG preview source local and bounded; do not expose filesystem access, same-origin privileges, scripts, forms, or host APIs.
5. Add project-browser smoke coverage for SVG discovery and editor-compatible reads, plus a renderer typecheck/build gate.

## Boundaries

- SVG is limited to the existing readable/writable project-file limits.
- The preview is sandboxed with no `allow-scripts`, `allow-same-origin`, or Electron capability.
- SVG is not added to general chat attachment types in this slice.

## Verification

- Native agent-host build and project-browser smoke.
- Desktop typecheck and production build.
- Existing syntax, native, and hygiene checks remain green.
