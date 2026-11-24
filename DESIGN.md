# Skai Desktop design contract

These rules govern the Electron + React renderer in `apps/desktop`. Keep work
surfaces calm, dense, and content-first; use the existing visual assets and
tokens instead of adding decorative controls or a second UI architecture.

## Architecture

- The desktop UI is Electron + React + TypeScript.
- `apps/desktop/src/styles.css` and the shared UI primitives are the visual
  foundation. Do not introduce Uno/XAML, a second desktop shell, or direct
  filesystem/Node access in the renderer.
- Use the typed preload bridge for host-backed behavior. A control is not
  complete until its loading, error, empty, disabled, and success states are
  honest and connected to a real host route.

## Visual language

- Preserve the dark Skai workspace palette, restrained cyan/violet accents,
  compact system typography, and existing Skai wolf/companion assets.
- Use the CSS custom properties already defined in `styles.css`; add a shared
  token before introducing a new color, spacing, radius, or shadow.
- Prefer one clear page header, one primary action, and shallow surfaces. Avoid
  duplicated titles, nested cards, decorative gradients, and fake metrics.
- Use semantic headings, visible focus, `aria-label`/descriptions for icon-only
  controls, and readable text at every supported width.

## Shell and layout

- Use one persistent workspace sidebar beside the active work surface. Keep
  Chat, Projects, Coding, the main tools, recent projects, and recent chats
  visible there so navigation and context remain available on every route.
- Keep the top bar compact for desktop controls, navigation history, and
  connection status. Show the active route or thread title once in its work
  surface; avoid a second global icon rail and duplicate empty-state shortcuts.
- Put thread-specific model and response controls near the conversation.
  Keep optional task planning and schedules available from the thread options.
- In a Coding project, keep the agent thread visible beside Monaco by default;
  allow the full Files workspace when the user wants to focus on project files.
  At phone widths, stack the chat and editor workspace vertically and keep the
  workspace itself scrollable so project controls stay reachable. The file
  editor's Review diff view compares read-only Original and Working copy
  panes; use Git review for line-level diffs.
- Video is a planned destination only. Keep the page clearly labeled as planned
  until local generation, editing, and export are implemented.
- Collapse the workspace sidebar on narrow windows and provide a persistent
  top-bar control to reopen it. Use the same sidebar hierarchy on tool routes
  instead of removing navigation when the main work surface changes.
- Main pages fill the remaining viewport. Only Settings and long chat threads
  should need page-level scrolling; use bounded internal regions for long lists,
  diffs, and inspectors.
- Verify at 1920, 1440, 1280, 960, and 640 px widths. Never allow body-level
  horizontal overflow or controls clipped outside their owning surface.
- Percy is a separate transparent always-on-top window. Keep its safe dock and
  collision guard independent from the app window so it cannot cover primary
  results or composer controls.

## Interaction and honesty

- Primary labels describe the action: “New chat”, “Run locally”, “Review
  install”, and “Save settings”.
- Marketplace installs require a visible verified review before download;
  preserve the host-backed catalog, provider identity, progress, cancellation,
  and failure details.
- Local, cloud, and AirLLM routes must be visibly distinct. Never silently
  switch route, invent model metadata, or claim a feature is available when its
  host capability is missing.
- Keep destructive actions explicit and reversible where possible. Preserve
  unsaved drafts and focus when navigating between surfaces.

## Evidence before handoff

Run the relevant checks after UI changes, including:

```text
npm run desktop:typecheck
npm run desktop:build
npm run package:electron
npm run smoke:electron:artifact
npm run smoke:electron:themes
npm run smoke:electron:overflow
```

Inspect a real packaged Electron screenshot or interaction trace; compilation
alone is not visual acceptance.
