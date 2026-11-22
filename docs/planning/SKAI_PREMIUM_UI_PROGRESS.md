# Skai Desktop UI evidence

This file is the current UI evidence index. It replaces historical agent
handoffs and temporary screenshot paths. The live Electron artifact and the
automated acceptance scripts are authoritative; this document only summarizes
what they cover.

## Current shell

- Electron + React + TypeScript is the only desktop UI architecture.
- The narrow global rail owns Home, Image Gen, Usage, and Settings.
- The adjacent sidebar owns projects, conversations, search, and the active
  session context.
- Secondary tools are opened through the searchable command launcher rather
  than being permanently listed in the thread sidebar.
- Pets use a separate transparent always-on-top Electron window with drag,
  bounded placement, optional wandering, sprite customization, and reduced
  motion support. All seven built-ins are inspectable in Pet Workshop.

## Current feature surfaces

- Chat has persisted conversations, attachments, drag-and-drop, queueing,
  keyboard-accessible commands, retry/edit flows, and local task planning.
- Marketplace has host-backed catalog/search, model filters, selected-item
  details, verified local install review, and installed/update states.
- Settings has searchable categories, Pet controls, model/provider settings,
  AirLLM readiness checks, voice, image, agent, storage, privacy, and update
  states.
- Models uses inspect-first rows and a selected-model details inspector.
- Coding, Workbench, Terminal, Memory, Images, Usage, and project/GitHub flows
  expose honest empty, unavailable, loading, and failure states.

## Professional and comfortable UI goal loop

The product owner wants every Skai Desktop page to feel professional and
comfortable, with Settings and Coding Agent as the first priorities. Keep this
work in the existing Electron + React design system and preserve the behavior
behind every control.

For each page or closely related page group, repeat this loop:

1. Inspect the live page, its behavior, the relevant UI reference, and its
   empty, loading, error, and success states.
2. Make a focused hierarchy, spacing, navigation, and responsive-layout pass
   with existing components and theme tokens.
3. Run renderer typecheck/build. Inspect the Electron page at 1920, 1440,
   1280, 960, and 640 px in dark, light, and system themes; fix overflow,
   clipped controls, poor contrast, and confusing states.
4. Record evidence and remaining gaps here, then pick the next page from the
   active task in [`TO_DO_NEXT.md`](TO_DO_NEXT.md).

The goal is complete after every listed route has been reviewed in the live
app and representative screenshots and interaction evidence are recorded.

### First pass completed

- Settings now has a clearer modal header, searchable preference navigation,
  active-category state, stronger section hierarchy, and responsive layouts.
  Existing categories, save behavior, runtime controls, and platform states are
  preserved.
- The Coding Agent project session now separates conversation, project files,
  Git review, and task inspection more clearly. The repeated project title was
  removed from the status strip, and the workspace adapts at narrower widths.
- Shared page headers, panel headings, empty states, and form controls received
  a consistent spacing and hierarchy pass.
- Marketplace Discover now starts with a concrete local-workspace action strip,
  reports the active runtime and local inventory, routes directly to model
  search or installed inventory, and labels catalog entries as ready, setup
  required, or limited instead of presenting every card as an available
  feature. Its catalog cards now describe the actual next action. The main
  Marketplace hub also has direct starting actions for model discovery, MCP
  connection, and installed inventory; Updates now performs a real release
  channel check through the existing update bridge. Usage now reports truthful
  local workspace counts and selected provider/model context while keeping
  unmeasured token, cost, GPU, and latency values out.
- Marketplace now exposes Voices as a first-class destination, includes locally
  installed voice runtimes when the host catalog has no voice entries, and
  General settings now stores per-job preferred model assignments for chat,
  coding, prompt rewriting, vision, and voice. The Chat assignment is restored
  as the default model on the next workspace start.
- `npm run desktop:typecheck` and `npm run desktop:build` passed after these
  changes. Vite still reports its existing large-chunk warning.
- `npm run package:electron` published the Agent Host but could not finish
  staging runtime dependencies because `registry.npmjs.org` was unreachable
  while fetching `universalify@2.0.1`. Retrying the UI matrix against that
  partial package failed before the renderer opened, so it is not acceptance
  evidence.

### Remaining visual review

The first pass has not been visually accepted in a running Electron window.
Continue the route-by-route review with Chat and the Coding Agent, then Projects,
Models, Images, Marketplace, Plugins, Memory, Personas, Pet Workshop, Voice
Workbench, Terminal, Usage, and the remaining Settings sections. Check the
supported widths and dark, light, and system themes; retain the existing shell
and verify that each page's controls and empty, loading, error, and success
states remain clear.

## Acceptance evidence

Run `npm run smoke:windows` from the repository root. It currently runs:

1. JavaScript syntax validation.
2. Renderer typecheck and production build.
3. Portable Electron packaging with the self-contained Agent Host and AirLLM
   worker.
4. Agent Host, Marketplace, and task-replan protocol smoke.
5. Packaged Electron shell and separate companion surface smoke.
6. Dark/light/system theme acceptance.
7. Packaged route, viewport, and theme/sidebar acceptance. The latest recorded
   matrix covers 17 routes × 5 widths × 4 variants; manual visual review remains
   open.

Additional evidence commands:

- `npm test` — headless Core behavior and persistence checks.
- `npm run check:hygiene` — repository hygiene.
- `npm run audit:electron-runtime` — single-architecture and secure-boundary
  guard, including rejection of XAML/Uno/WinUI/native desktop artifacts.
- `npm run audit:release-workflow` — Electron-only gated release workflow.
- `npm run audit:local-only` — local transport boundary.

## Known boundaries

Hosted model routing is not implemented in the current release. The approved
provider-gateway direction is tracked in
[`implementation-plans/provider-gateway.md`](implementation-plans/provider-gateway.md).
Signed installer lifecycle evidence, background model dispatch, resumable
downloads, and Worktree task execution remain explicitly partial or planned in
[`CAPABILITY_MATRIX.md`](CAPABILITY_MATRIX.md) and
[`PRODUCTION_READINESS_GAPS.md`](../operations/PRODUCTION_READINESS_GAPS.md).
They must not be represented as working
controls until their host contracts and packaged acceptance evidence exist.

The full `smoke:windows` run passed on 2026-11-16. Pet asset and behavior checks
passed as well. The latest packaged UI matrix passed on 2026-11-22 across 17
routes, five supported sizes, and four theme/sidebar variants. Automated
coverage does not replace the open live visual, keyboard, assistive-technology,
and cross-platform acceptance.

### Marketplace focused rebuild — 2026-11-22

- Reduced the Marketplace navigation to Discover, Models, Voices, MCP, Installed,
  and Updates. Staff Picks, Skills, and Plugins are no longer promoted as primary
  destinations.
- Replaced the Discover pitch panel with direct model search, MCP connection,
  Installed, and Updates actions. Added Voice, Coding, Chat, Image, and MCP
  category shortcuts. The hub reports the configured local runtime and whether
  its existing local model inventory endpoint responds.
- Normalized catalog availability labels to ready, limited, installed, or
  unavailable, and disclose when model source metadata has no license value.
- Kept catalog discovery and model installation on the existing Agent Host
  contracts. Model installs still require review, poll host progress, allow
  cancellation, verify through the host, and move to Installed on completion.
- Removed cloud voice connectors from the local voice catalog surface. Model
  results include an explicit license disclosure when the source catalog does not
  publish one. Updates run the existing signed release check when opened from the
  Marketplace action.
- Installed inventory now supports locally stored pins, MCP health checks and
  revocation, and image asset removal. The existing host protocol does not expose
  model deletion, so model rows do not claim to offer removal.
- Added compact theme-token-based styling and focus states for the action strip,
  category shortcuts, and installed rows at narrow widths. The Electron shell,
  command palette, theme system, and Agent Host contracts were not changed.
- Verification on 2026-11-22: `npm run desktop:typecheck` passed and
  `npm run desktop:build` passed. Vite emitted its existing large-chunk warning.
  A live Electron width/theme matrix was not run for this pass.

### Marketplace three-panel refinement — 2026-11-22

- Removed the embedded Marketplace section rail from Models, Voices, Installed,
  and Updates. The Marketplace browse navigation is now the sole page menu.
- Kept the content and selected-item inspector side by side. Installed inventory
  now uses a compact selectable list in the center and a details/actions card on
  the right; pin, MCP health/revoke, and image asset removal are in that card.
- Added a route key so switching from Installed to Updates (or another catalog
  page) resets the content page to the selected destination instead of retaining
  the previous section state.
- Verification: `desktop:typecheck` and `desktop:build` passed. No live visual
  matrix was run after this refinement.
