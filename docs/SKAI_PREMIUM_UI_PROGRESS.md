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
- Percy is a separate transparent always-on-top Electron window with drag,
  bounded placement, optional wandering, sprite customization, and reduced
  motion support.

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

## Acceptance evidence

Run `npm run smoke:windows` from the repository root. It currently runs:

1. JavaScript syntax validation.
2. Renderer typecheck and production build.
3. Portable Electron packaging with the self-contained Agent Host and AirLLM
   worker.
4. Agent Host, Marketplace, and task-replan protocol smoke.
5. Packaged Electron shell and separate Percy surface smoke.
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

Cloud provider routing, signed installer lifecycle evidence, background model
dispatch, resumable downloads, and Worktree task execution remain explicitly
partial or planned in `docs/CAPABILITY_MATRIX.md` and
`docs/PRODUCTION_READINESS_GAPS.md`. They must not be represented as working
controls until their host contracts and packaged acceptance evidence exist.
