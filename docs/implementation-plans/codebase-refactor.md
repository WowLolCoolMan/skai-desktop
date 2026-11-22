# Incremental codebase refactor

## Goal

Make Skai Desktop easier to change safely by giving its large mixed-responsibility
modules clear boundaries across the renderer, Electron shell, Agent Host, and
Core. Preserve shipped behavior and persisted data while improving the flows
that users touch as each slice is moved.

## Scope and rules

- Refactor all layers incrementally; do not rewrite the app in one pass.
- Keep IPC method names, serialized contracts, settings keys, local storage,
  task journals, and on-disk formats stable unless a separately reviewed
  migration is required.
- Separate code by responsibility and dependency direction. Prefer small
  focused modules with a clear owner over merely moving code into another
  oversized file.
- Keep local-only behavior and existing permission boundaries intact. Do not
  add cloud routing, automatic project checks, or unattended execution as a
  side effect of refactoring.
- Address workflow defects when they are directly inside the slice being
  refactored; avoid opportunistic product changes elsewhere.
- Work in reviewable slices. Before each integration, fetch the latest `main`,
  reconcile upstream work, run the checks appropriate to the changed boundary,
  commit with an outcome-focused description, and push to `main` without
  overwriting another developer's work.

## Layer plan

### Renderer

- Continue extracting pages and complex controls from mixed catalog and route
  modules. Voice Workbench has been separated from the Marketplace page; the
  Marketplace page and chat/coding workspace hooks remain large candidates.
- Keep route selection, page composition, and feature behavior in distinct
  modules. Consolidate repeated bridge request handling without changing the
  bridge contract.
- Preserve the three-pane project session, thread-centered task state, and
  contextual navigation. Reduce page transitions only where the existing
  feature can be embedded without duplicating state.
- Make settings and other responsive pages own their scroll regions so sticky
  actions never cover controls.

### Electron shell

- Keep the preload bridge as the renderer's only privileged boundary.
- Continue separating process lifecycle, update lifecycle, window/tray/menu
  behavior, and IPC registration from `main.cjs`.
- Keep child-process launch, shutdown, restart, and packaged-app behavior
  explicit and observable.

### Agent Host

- Keep protocol parsing/serialization and request dispatch separate from
  domain operations. Task execution, projects, conversations, personas, and
  marketplace handlers have already been extracted from the main loop.
- Next, reduce the remaining loop's process-wide state and routing by extracting
  focused protocol dispatch and shared lifecycle services while retaining the
  existing method surface.
- Avoid introducing a parallel implementation for any existing operation.

### Core services

- Split large research, model, Git, and workflow services along provider,
  parsing, persistence, and orchestration boundaries.
- Keep deterministic parsing and policy separate from network/runtime I/O.
- Preserve cancellation, timeouts, bounded response sizes, local-only rules,
  and existing source/evidence semantics.

## Ordered execution

1. Establish the baseline and keep project facts current in the capability
   matrix and To Do list. The selected-check feature was already implemented
   and is recorded as completed; do not rebuild it.
2. Complete high-value renderer boundaries and fix workflow/layout issues
   exposed by the packaged UI matrix.
3. Reduce the Agent Host protocol loop while preserving all current routes and
   lifecycle behavior.
4. Refactor Core services one responsibility at a time, starting with persona
   research because it combines identity matching, evidence gathering, remote
   providers, and HTML parsing.
5. Revisit the Electron shell for additional lifecycle/IPC separation.
6. Keep release and capability gaps visible; do not mark unrelated voice,
   image, isolation, or cross-platform acceptance complete without evidence.

## Work completed so far

- Extracted Agent Host task execution, project operations, chat/conversation
  handling, persona operations, and marketplace/integration handlers.
- Extracted Electron update management and Agent Host process control.
- Extracted Voice Workbench from the mixed Marketplace page and moved its
  bridge request fallback into a small shared helper.
- Extracted persona identity matching into a deterministic helper and moved
  MediaWiki HTML-to-text parsing behind its own parser, while retaining the
  existing `PersonaKnowledgeSources` public facade.
- Extracted bounded Wikipedia/Fandom requests, timeouts, host pacing, and
  retry handling into an injectable `PersonaWikiClient`; the coordinator still
  owns the existing research decisions and evidence selection.
- Moved Agent Host request-parameter validation, bounds, and local endpoint
  checks into `AgentHostLoop.RequestValidation.cs`; the public protocol and
  guard behavior are unchanged.
- Moved the stable protocol method-to-handler table into
  `AgentHostLoop.Dispatch.cs`, leaving process I/O and lifecycle in the main
  loop and request validation in its own module.
- Restored the Electron child-process launcher import required by the packaged
  app.
- Restructured Settings so its content scrolls above a separate persistent
  Save bar. Packaged UI matrix passed for 17 routes, five window sizes, and
  four theme/sidebar variants.

## Acceptance

- A refactor slice changes one clear boundary and has no unrelated data or
  product behavior changes.
- Renderer typecheck/build, Agent Host/Core builds, and relevant existing
  workflow checks pass for the touched layer.
- The packaged UI matrix remains clean for layout changes.
- Existing local-only, bridge-method, Electron-runtime, and repository
  integrity checks remain valid where the slice touches those boundaries.
- Main is fetched before integration, upstream commits are preserved, and each
  finished slice is committed and pushed separately.

## Remaining work

- Continue the renderer extraction; `PluginsPage.tsx`, `AgentHostLoop.cs`,
  `PersonaKnowledgeSources.cs`, and `ModelLibraryService.cs` are among the
  largest current mixed-responsibility files. Persona matching and HTML parsing
  and HTTP fetching are now separate, but research orchestration and evidence
  selection remain in `PersonaKnowledgeSources.cs`.
- Complete installed speech-pack and real audio acceptance for local voice.
- Keep OS isolation, image-runtime acceptance, and release/platform gaps in
  their existing capability entries; these are product completion work, not
  code-movement tasks.
