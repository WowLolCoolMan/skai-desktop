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
   active task in `docs/TO_DO_NEXT.md`.

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
7. Ten packaged routes across 1920, 1440, 1280, 960, and 640 pixel widths.

Additional evidence commands:

- `npm test` — headless Core behavior and persistence checks.
- `npm run check:hygiene` — repository hygiene.
- `npm run audit:electron-runtime` — single-architecture and secure-boundary
  guard, including rejection of XAML/Uno/WinUI/native desktop artifacts.
- `npm run audit:release-workflow` — Electron-only gated release workflow.
- `npm run audit:local-only` — local transport boundary.

## Known boundaries

Hosted model routing is not implemented in the current release. The approved provider-gateway direction is tracked in
`docs/implementation-plans/provider-gateway.md`. Signed installer lifecycle evidence, background model
dispatch, resumable downloads, and Worktree task execution remain explicitly
partial or planned in `docs/CAPABILITY_MATRIX.md` and
`docs/PRODUCTION_READINESS_GAPS.md`. They must not be represented as working
controls until their host contracts and packaged acceptance evidence exist.

The full `smoke:windows` run passed on 2026-11-16. Pet asset and behavior checks
passed as well. The packaged UI matrix also passed across fourteen routes, five
supported sizes, and four theme/sidebar variants. Live accessibility and
cross-platform visual acceptance remain open.
