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

The planned first all-layer refactor pass is complete. This means each layer
received reviewable responsibility-boundary work and retained its existing
contracts; it does not mean every large file in the repository has been split.
Further candidates below are tracked as follow-on maintenance, with acceptance
checked per slice.

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
- Moved transcript-turn cleanup, speaker alias selection, and quote-line
  filtering into `PersonaQuoteEvidence`, retaining the old public speaker-label
  facade while keeping citation and evidence policy unchanged.
- Split identity resolution/scoring and persona research orchestration from the
  `PersonaKnowledgeSources` declaration into focused partials. The public
  service, candidate scoring, research ordering, and evidence selection remain
  unchanged; source retrieval remains behind `PersonaWikiClient`.
- Separated Wikipedia, Fandom, transcript, and Wikiquote document gathering
  into `PersonaKnowledgeSources.Sources.cs`; orchestration still calls the
  same bounded, best-effort provider operations and returns the same evidence
  records.
- Split `ModelLibraryService` into local runtime discovery/management and
  remote catalog search/download partials. The public service and serialized
  model records remain unchanged; catalog validation and download behavior
  stay with the remote catalog operations.
- Moved Agent Host request-parameter validation, bounds, and local endpoint
  checks into `AgentHostLoop.RequestValidation.cs`; the public protocol and
  guard behavior are unchanged.
- Moved the stable protocol method-to-handler table into
  `AgentHostLoop.Dispatch.cs`, leaving process I/O and lifecycle in the main
  loop and request validation in its own module.
- Moved user profile and app settings protocol handlers into
  `AgentHostLoop.Settings.cs`; response fields, validation, persistence, and the
  local endpoint restriction are unchanged.
- Moved mutable model-pull, AirLLM-install, image-runtime, image-generation,
  and Marketplace-download operation state containers into
  `AgentHostLoop.Operations.cs`; their locks, progress caps, cancellation,
  terminal states, and response serialization are unchanged.
- Moved image background removal, generation lifecycle, generation runtime,
  runtime setup/status, and checkpoint listing into `AgentHostLoop.Images.cs`;
  protocol methods, progress reporting, cancellation, and error responses are
  unchanged.
- Moved voice catalog serialization and native/cloud speech dispatch into
  `AgentHostLoop.Voice.cs`; method names, validation, and provider selection are
  unchanged.
- Moved local model inventory, capacity reporting, AirLLM setup, and model pull
  status/cancellation handlers into `AgentHostLoop.Models.cs`; runtime methods
  and response shapes are unchanged.
- Moved memory and document-corpus protocol handlers into
  `AgentHostLoop.Memory.cs`; local persistence operations and response fields
  remain the same.
- Moved scheduled-task dispatch, persistence responses, and task lifecycle
  handlers into `AgentHostLoop.Schedules.cs`; timing, completion, and the
  conversation-result behavior remain unchanged.
- Moved update IPC registration and its sender/URL checks into
  `update-ipc.cjs`; the existing updater manager remains responsible for update
  lifecycle and download state.
- Moved Marketplace catalog normalization, section filtering, and category
  grouping into `marketplaceEntries.ts`, keeping the React page focused on UI
  state and MCP operations.
- Moved MCP connection state and lifecycle actions (connect, inspect health,
  install/connect REA, disconnect, and revoke) into the focused
  `useMarketplaceMcp` hook. UI rendering and the existing confirmation and
  bridge behavior remain in the Marketplace page.
- Extracted the Marketplace MCP connection form, connection list, health state,
  and tool-manifest review into `McpConnectionsPanel`; the page supplies the
  same state and callbacks without changing the in-app review flow.
- Moved developer-curated Marketplace staff picks and their action routing into
  `StaffPicksPanel`, keeping curated navigation separate from catalog state.
- Moved Marketplace model tag facets, combined filtering, active-filter counts,
  and runtime compatibility checks into `marketplaceModelFilters.ts`; model
  results, install prompts, and Marketplace navigation keep the same behavior.
- Moved local media URL IPC registration, ownership checks, validation, and
  revocation into `local-media-ipc.cjs`; the renderer-visible channel names and
  local media behavior are unchanged.
- Moved desktop pet JSON persistence into `pet-state-store.cjs`; the existing
  file location, tolerant read behavior, and serialized state shape remain the
  same, while window positioning and pet lifecycle stay in the Electron shell.
- Moved close-choice, close-behavior, and native titlebar-theme IPC handlers
  into `window-ipc.cjs`; sender checks and return behavior are unchanged.
- Restored the Electron child-process launcher import required by the packaged
  app.
- Restructured Settings so its content scrolls above a separate persistent
  Save bar. Packaged UI matrix passed for 17 routes, five window sizes, and
  four theme/sidebar variants.
- Extracted the chat device-capacity details into `ChatCapacityPopover`, keeping
  capacity estimation and display together without changing the advisory or
  telemetry behavior.
- Moved Agent Host project listing and read-only preflight queries into
  `AgentHostLoop.ProjectQueries.cs`; the preflight still reports suggested
  checks without executing them.
- Moved persona-conversation retention cleanup into
  `AgentHostLoop.PersonaRetention.cs`, preserving the configured retention
  bounds and periodic cleanup lifecycle.
- Moved pet IPC channel registration and sender/point validation into
  `pet-ipc.cjs`. Pet movement, behavior, activity, and persistence callbacks
  remain in the Electron shell, with the same channel names and validation.
- Split Agent Host persona source/evidence classification, transcript cleanup,
  evidence excerpt selection, and evidence-boundary helpers into
  `AgentHostLoop.PersonaEvidence.cs`; research ordering and retrieval remain in
  `AgentHostLoop.PersonaResearch.cs`.
- Split `GitHubWorkspaceService` into local Git operations, status/security
  parsing, and bounded process/credential handling partials. Git invocation,
  credential isolation, safe-path filtering, and public method signatures are
  preserved.
- Split Agent Host Marketplace model discovery/install handlers away from MCP
  connection and skill handlers in `AgentHostLoop.MarketplaceModels.cs`.
- Moved task-operation journal creation, transitions, and activity reads into
  `AgentHostLoop.TaskJournal.cs`, separate from task planning and execution.
- Split progressive persona research and its saved-card enrichment from
  initial persona research orchestration into
  `AgentHostLoop.PersonaProgressiveResearch.cs`.
- Moved persona candidate discovery and name matching into
  `AgentHostLoop.PersonaDiscovery.cs`; selected-identity resolution and source
  research remain in `AgentHostLoop.PersonaResearch.cs`.
- Moved system-tray menu state, recent-chat items, refresh sequencing, and tray
  creation into `tray-controller.cjs`; Electron startup still supplies the
  existing window, pet, and Agent Host callbacks.
- Moved workspace tab schema validation, local persistence, recovery limits,
  and ID creation into `workspaceTabStore.ts`. Existing storage keys and the
  16-open/10-closed tab limits remain unchanged.
- Split `WebSearchProvider` public-page and transcript fetching into
  `WebSearchProvider.Fetching.cs`; search result parsing and URL policy remain
  in the original partial. Existing timeouts, response-size limits, transcript
  metadata, and public method signatures are unchanged.
- Moved Percy’s Electron window construction, display-surface fallback, load
  setup, and native window event wiring into `pet-window.cjs`. App startup still
  owns pet behavior and callbacks; Wayland positioning, X11 transparency,
  saved visibility, tray close behavior, and renderer query flags are preserved.
- Re-ran renderer typecheck/build, Agent Host/Core Release build, Electron
  syntax checks and packaging, bridge-method audit, and local-only audit after
  the final slices. The packaged renderer still reports the existing large
  Monaco/editor chunk advisory.

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

## Follow-on maintenance and product acceptance

- Continue with small, independently reviewable slices when these areas are
  next touched: remaining pet movement/behavior orchestration in `main.cjs`,
  remaining persona research orchestration in Agent Host, workspace
  coordination in `useDesktopWorkspace.ts`, Marketplace/Plugins page
  composition, and other model or workflow Core services. Their size alone is
  not a reason for mechanical splitting; extract only cohesive behavior with a
  clear owner.
- Keep the protocol entry point responsible for process I/O and lifecycle,
  Electron `main.cjs` responsible for app startup/orchestration, and feature
  pages responsible for composition. Continue moving domain behavior behind
  focused helpers as maintenance exposes concrete boundaries.
- Complete installed speech-pack and real audio acceptance for local voice.
- Keep OS isolation, image-runtime acceptance, and release/platform gaps in
  their existing capability entries; these are product completion work, not
  code-movement tasks and are not marked complete by this refactor pass.
