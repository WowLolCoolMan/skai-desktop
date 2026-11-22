# Skai Desktop — To Do Next

This is the shared contributor handoff for work that is active or ready to pick
up. Use it to record **what is happening, what should happen next, and the
approach already agreed on**. Keep entries concrete enough that another
contributor can continue without rediscovering the plan.

This file is a working queue, not a replacement for the full [capability
matrix](CAPABILITY_MATRIX.md), [future feature backlog](FUTURE_FEATURES.md), or
[production readiness gaps](PRODUCTION_READINESS_GAPS.md). Link to those docs
and to any detailed plan rather than copying their full contents here.

## How contributors should use this file

- Add an entry before starting substantial work; update it as scope or findings
  change.
- Use one of these statuses: `Ready`, `In progress`, `Blocked`, `In review`, or
  `Done`.
- Record the agreed implementation approach and acceptance evidence. If the
  approach changes, explain why and update any linked plan.
- Add an owner or handle when work is claimed. Use `Unclaimed` otherwise.
- Keep private user data, credentials, and secret values out of entries.
- When work is done, add the commit/PR and verification evidence, then move the
  entry to **Recently completed**. Remove stale completed entries in a later
  cleanup pass; the changelog and Git history retain the permanent record.
- When proposing work that changes provider routing, permissions, or persisted
  data, link the decision record and update the implementation plan before
  changing the product boundary.

## Active and next-up work

### Skai Desktop professional and comfortable UI goal loop

- **Status:** In progress
- **Priority:** High, product quality
- **Owner:** Codex
- **Context:** The owner wants every page cleaned up so Skai feels professional,
  comfortable, calm, and welcoming. Settings and Coding Agent are the first
  priorities. The first styling pass is implemented; visual acceptance in the
  running Electron app is still open.
- **Agreed approach:** Work one page or tightly related page group at a time.
  Inspect its current behavior and relevant UI reference, improve hierarchy,
  spacing, navigation, and responsive behavior using the existing Electron +
  React components and theme tokens, and preserve working controls and honest
  states. Treat usefulness as a release requirement: every page needs a clear
  job, a real next action, and a truthful empty/loading/error/success state;
  remove copy and cards that only describe a future feature. Marketplace may
  receive a structural layout change; other pages keep their current layout
  while their content and actions become more useful. After each pass, run
  renderer typecheck/build, inspect the live UI at supported widths and themes,
  fix clipping or confusing states, and record evidence in
  `docs/SKAI_PREMIUM_UI_PROGRESS.md`. Repeat with the next page until the full
  route list is accepted.
- **Latest implementation:** Marketplace now includes a Voices destination and
  local voice runtime entries. Its Tools destination groups MCP servers,
  Skai built-ins, compatible plugins, and Installed inventory. The packaged
  artifact smoke confirms Models and Tools → Installed. General settings
  includes per-job preferred model assignments for chat, coding, prompt
  rewriting, vision, and voice; the Chat assignment is restored as the
  workspace default.
- **Acceptance:** Chat and Coding Agent, Projects, Models, Images, Marketplace,
  Plugins, Memory, Personas, Pet Workshop, Voice Workbench, Terminal, Usage,
  and Settings are reviewed in the running app. Each has readable hierarchy,
  comfortable density, visible keyboard focus, usable narrow layouts, and
  clear empty/loading/error/success states. Capture and inspect representative
  screenshots across 1920, 1440, 1280, 960, and 640 px plus dark, light, and
  system themes. In Pet Workshop, exercise Blaze's pounce and fire-breath
  animations and verify the lunge and flame align with the cursor target. Do
  not mark the goal complete based on compilation alone.
- **References:** [UI evidence and progress](SKAI_PREMIUM_UI_PROGRESS.md),
  [UI reference guide](UI_REFERENCE_GUIDE.md), and [design contract](../DESIGN.md).
- **Blockers / decisions:** Live visual review remains open; preserve the
  existing product shell and local-first behavior. The packaged matrix now
  passes all 17 routes across five window sizes and four theme/sidebar
  variants. Continue manual interaction and pet-animation review before
  considering the UI goal complete.

### 1. Cross-layer codebase refactor

- **Status:** Done
- **Priority:** High, maintainability and workflow quality
- **Owner:** Codex
- **Context:** The incremental renderer, Electron, Agent Host, and Core slices
  in the linked plan are complete. The remaining app entry points and workflow
  coordinators were reviewed and documented as intentional state-owning
  boundaries; they are candidates for future work only when their state can be
  moved cohesively.
- **Agreed approach:** Refactor incrementally by cohesive responsibility,
  preserve bridge/storage/runtime behavior, sync with `main` before each
  commit, and verify the layer being changed. Do not split files mechanically
  just to reduce line counts.
- **Acceptance:** Complete. Each touched boundary has layer-appropriate build,
  audit, syntax, or packaging evidence; product acceptance gaps remain tracked
  separately. See the
  [incremental codebase refactor](implementation-plans/codebase-refactor.md).

### 2. Complete local voice acceptance

- **Status:** Blocked
- **Priority:** High
- **Owner:** Unclaimed
- **Context:** Windows native speech output is present and verified. The local
  voice smoke created a valid PCM fixture and confirmed the OS voice runtime,
  but the en-US on-device recognition pack is unavailable. Installing that
  Windows capability requires elevation, which is not available in this
  session; no real microphone transcription has been claimed.
- **Agreed approach:** Test on a supported Windows profile with the required
  speech pack installed. Record a short local fixture and exercise one-shot
  dictation, hands-free turn completion, cancellation, unavailable-language,
  and device-error recovery. Keep audio processing local and do not upload
  recordings as test evidence.
- **Acceptance:** Still open: install the speech capability from an elevated
  Windows session, then verify transcription with a real microphone and audio
  fixture. The packaged app already fails closed with a clear unavailable-pack
  message and does not send audio to a remote service.
- **References:** [Capability matrix](CAPABILITY_MATRIX.md),
  [voice architecture](ELECTRON_CSHARP_VOICE_ARCHITECTURE.md),
  [production readiness](PRODUCTION_READINESS_GAPS.md).

### 3. Strengthen OS isolation for Coding Agent commands

- **Status:** Ready
- **Priority:** High, before unattended or parallel execution
- **Owner:** Unclaimed
- **Context:** The command runner bounds duration/output, removes
  secret-shaped environment variables, checks the working directory, and kills
  process trees on cancellation. Windows also attaches a kill-on-close Job
  Object when available. This does not sandbox filesystem or network access;
  Linux has no equivalent boundary yet. Unattended/parallel commands remain
  gated on a real OS sandbox.
- **Agreed approach:** Define the supported platform boundary first. Prototype
  a per-run restricted process with a project-root working directory, explicit
  environment allowlist, resource/time limits, and a clear cancellation path.
  Fail closed when isolation is unavailable; keep approvals and operation
  evidence visible. Do not expand unattended or parallel execution until the
  sandbox behavior is verified.
- **Acceptance:** Tests prove access outside the project is denied where the
  platform supports it, environment secrets are excluded, time/resource limits
  apply, child processes are handled on cancellation, and unsupported systems
  report that isolation is unavailable rather than implying it is active.
- **References:** [Capability matrix](CAPABILITY_MATRIX.md),
  [architecture and trust boundaries](ARCHITECTURE.md),
  [production readiness](PRODUCTION_READINESS_GAPS.md).

### 4. Finish image generation progress and cancellation

- **Status:** In progress
- **Priority:** High
- **Owner:** Unclaimed
- **Context:** The installed SD-Turbo runtime generated a real 512×512 CPU
  image and reported actual inference-step progress for both text-to-image
  (4/4) and image-to-image (2/2). Diffusers receives the Agent Host
  cancellation token. This pass fixed a cancellation race: the host no longer
  reports a job as stopped before the worker exits, so another generation
  cannot overlap the cancellation unwind. The Images page now displays the
  most recent runtime-reported progress and a stopping state. Automated
  provider tests cover ComfyUI queue polling, scoped cancellation, and local
  endpoint enforcement. A packaged renderer-to-host edit/history run and live
  cancellation during Diffusers inference remain open.
- **Agreed approach:** Exercise the supported local runtimes and expose real
  stage/progress state when the runtime provides it. Cancellation must stop the
  active operation, preserve completed outputs, and return the UI to a usable
  state. Clearly label unknown progress instead of inventing a percentage.
- **Acceptance:** Local generation and edit return valid output in the worker;
  ComfyUI queue polling/cancellation and local-only endpoint checks pass in
  automated tests. Still open: verify generation and edit from the packaged
  renderer through Agent Host into persistent history, and cancel a live
  Diffusers inference from the UI while confirming it has fully stopped before
  another job can start. Runtime errors and missing dependencies must remain
  actionable, completed images must remain available, and progress must reflect
  runtime evidence.
- **References:** [Capability matrix](CAPABILITY_MATRIX.md),
  [local image generation](LOCAL_IMAGE_GENERATION.md).

### 5. Close release signing and upgrade acceptance

- **Status:** In progress
- **Priority:** Release gate
- **Owner:** Unclaimed
- **Context:** The 0.1.4 Windows NSIS installer and `latest.yml` were built and
  metadata-verified unsigned on 2026-11-22. The owner has chosen to defer
  certificates; local unsigned validation can proceed. On 2026-11-22, the
  unsigned 0.1.4 installer installed into a disposable profile, launched the
  packaged app, passed its smoke checks, and silently uninstalled. A published
  0.1.3 installer is unavailable, so upgrade/data-retention/rollback remain
  unverified. Linux acceptance still requires a Linux runner.
- **Agreed approach:** Use the release checklist against exact packaged
  artifacts. Verify checksums, clean install and uninstall (now accepted for
  unsigned Windows 0.1.4), then upgrade with data retention and rollback on
  each supported target. Signing is intentionally deferred by the owner. Do not
  mark a platform ready based on development builds alone.
- **Acceptance:** Attach artifact identifiers and test evidence for each target;
  signing and update verification fail closed; upgrade and rollback preserve
  user data; all release blockers in the readiness doc are resolved or clearly
  documented as unsupported.
- **References:** [Release readiness](RELEASE_READINESS.md),
  [release guide](RELEASING.md),
  [production readiness gaps](PRODUCTION_READINESS_GAPS.md).

### 6. Finish evidence-grounded Persona dialogue research and chat

- **Status:** In progress
- **Priority:** High
- **Owner:** Unclaimed
- **Context:** Persona research now has bounded public PDF text extraction,
  explicit speaker-attribution gates, source-removal invalidation, and stricter
  checks against unsupported first-person memories. The DuckDuckGo timeout had
  prevented the Bing fallback from running; fallback now has its own bounded
  timeout and regression coverage. Name-only Joe research now returns 12 sources
  but still 0 attributed turns, while name-only Jack returns 0 sources. Given
  direct URLs, research extracted 77 Joe Rogan turns and 10 Captain Jack
  Sparrow turns; no guest lines or stage directions leaked into those excerpts.
  A separate Joe PDF transcript yielded 9 attributed turns. Mixed-speaker
  archives without labels remain excluded.
  Core checks and Agent Host build passed. A 14B local-model workflow completed
  profile and chat turns, and explicit childhood / backstory questions were
  safely blocked. The Joe answer still sounded generic and invented a
  hypothetical personal anecdote; Jack's answer was more characterful but
  verbose. The test profile draft for Jack did not parse with the abbreviated
  draft prompt used by the smoke harness; rerun using the full in-app profile
  drafting prompt before drawing a product-level conclusion.
- **Agreed approach:** Keep attribution strict: count only lines confidently
  tied to the requested speaker; prefer an explicit evidence gap over guessing.
  Improve name-only discovery so it finds dialogue sources without user-supplied
  URLs, and diversify sources before claiming a researched profile is ready.
  Continue rejecting promotional or irrelevant material. Exercise unsupported
  childhood, acquisition, intent, quote, and canon-memory questions through a
  local model. Keep source removal from leaving stale generated fields or chat
  influence. Do not claim persona realism from parser tests alone.
- **Acceptance:** Name-only Joe Rogan and Captain Jack Sparrow research finds
  usable, correctly attributed dialogue or clearly reports why none was found;
  source
  cards report evidence quality and gaps accurately; no screenplay action or
  other speaker's lines appear as the persona's speech; unsupported memories
  and quotations are not invented in multi-turn local-model conversations;
  removing evidence removes its profile and prompt influence. Recheck the full
  profile/chat workflow using a stronger local model within the user's 20B
  limit, and record source and workflow results. Then rerun Core checks, Agent
  Host build, desktop typecheck/build, and focused workflow smoke tests.
- **References:** [Smart Personas plan](implementation-plans/smart-personas.md),
  [dialogue attribution and memory guard](../native/SkaiDesktop.Core/Services/PersonaDialogueEvidence.cs),
  [web research and PDF fetching](../native/SkaiDesktop.Core/Services/WebSearchProvider.cs),
  [Persona research workflow](../services/agent-host/Protocol/AgentHostLoop.cs).
- **Blockers / decisions:** Name-only transcript discovery remains incomplete.
  Do not treat the goal as complete until the
  real-source and local-model acceptance evidence above is recorded.

### 7. Add the user-controlled local, cloud, and hybrid model gateway

- **Status:** In progress
- **Priority:** High
- **Owner:** Codex
- **Context:** Shipped model execution is currently local-only. The product
  direction now includes optional providers configured and paid for by users,
  plus intentional local/cloud combinations. Current settings normalization,
  route validation, and `audit:local-only` enforce the old local-only product
  boundary. API keys must never be persisted in `settings.json` or exposed to
  renderer code.
- **Agreed approach:** Follow the
  [provider gateway plan](implementation-plans/provider-gateway.md). Preserve
  the Electron + React + .NET architecture and local behavior; add typed
  provider connections and narrow adapters, store credentials through an OS
  credential facility, disclose remote data at route selection, and preserve
  offline-only mode. Never silently change provider or send data to a remote
  endpoint without the user's selected connection.
- **Progress:** Cloud voice keys now use per-provider OS-protected storage on
  Windows and the Linux desktop keyring. Core now has a shared `ISecretStore`
  contract; voice credentials use it without changing existing storage IDs.
  Speech requests no longer carry keys. Generic model-provider connection
  metadata/routing, macOS support, and live Linux keyring acceptance remain
  unfinished.
- **Acceptance:** Users can add, verify, select, and remove supported local and
  remote connections; secrets are stored by the OS and do not appear in
  renderer state, logs, settings files, or diagnostics; chat streams and
  cancels through the selected provider; provider/model capabilities and errors
  are truthful; hybrid routing is explicit per task; offline-only mode rejects
  all remote calls. Replace the blanket local-only audit only after these
  policy checks and regression tests pass.
- **References:** [Provider gateway plan](implementation-plans/provider-gateway.md),
  [reference implementation registry](research/REFERENCE_IMPLEMENTATION_REGISTRY.md),
  [capability matrix](CAPABILITY_MATRIX.md).
- **Blockers / decisions:** None. Remote provider connections are not
  implemented until the credential and consent gates are complete.
## Recently completed

Move finished entries here with their commit/PR and verification evidence.

- **2026-11-22 — Completed the planned cross-layer refactor cycle.** Added
  focused boundaries for Percy native window lifecycle, public web-page and
  transcript fetching, persona candidate discovery, Marketplace model
  filtering and catalog presentation, Agent Host protocol lifecycle, and
  Electron workspace request IPC. Renderer typecheck/build, Core and Agent Host
  Release builds, Electron syntax/package checks, bridge-method audit, and
  local-only audit pass. Commits: `111a79d9`, `9933b567`, `33ce9d63`,
  `b5739979`, `a98a6ffd`, `f96006e3`, `ba0f2e02`.

- **2026-11-22 — Completed the first all-layer codebase refactor pass.** Kept
  protocol, bridge, storage, and runtime behavior stable while extracting
  cohesive boundaries across the renderer, Electron shell, Agent Host, and
  Core. Final slices include the chat device-capacity panel, project-list and
  read-only preflight queries, persona retention cleanup, and pet IPC
  registration. Renderer typecheck/build, Agent Host/Core Release build,
  Electron syntax checks and packaging, bridge-method audit, and local-only
  audit pass. Follow-on candidates and unfinished product acceptance are
  listed separately in the [refactor plan](implementation-plans/codebase-refactor.md).
  Implementation commit: `b4b46cf1`.
- **2026-11-22 — Continued the all-layer refactor.** Separated persona evidence
  and progressive research, Git workspace process/status responsibilities,
  Agent Host Marketplace model handling and task-journal operations, Electron
  tray behavior, and workspace tab persistence. Agent Host/Core Release builds,
  renderer typecheck/build, and Electron syntax/package checks pass. Commits:
  `c96877f2`, `f39456f5`, `709343fa`, `8cb058ce`, `6c39cee5`, `c95fb359`.

- **2026-11-22 — Selected project checks with durable task evidence.** The
  Coding Agent already supports explicit detected-check selection, bounded
  output and exit-status evidence beside task diffs, and read-only preflight.
  Core verification evidence is covered in `ProjectVerificationTests`; the
  feature is recorded in the [capability matrix](CAPABILITY_MATRIX.md). See
  commit `746c9171`.
- **2026-11-22 — Refactor and Settings reliability slices.** Extracted the
  Voice Workbench from Marketplace, restored the Electron child-process
  launcher, and kept Settings Save controls visible above independently
  scrolling content. Verified with desktop typecheck/build, packaged app, and
  the 17-route UI matrix across five window sizes and four theme/sidebar
  variants, plus bridge and local-only audits. Commits `f223075d`, `81edaec4`,
  and `c4dc3575`.
- **2026-11-22 — Persona research Core boundaries.** Moved deterministic
  identity matching and MediaWiki HTML parsing into focused helpers while
  preserving the existing public research facade. Core and Agent Host Release
  builds pass with zero warnings. Bounded Wikipedia/Fandom fetching is now an
  injectable client with the same `HttpClient` test seam. Commits `a2a6d4e5`,
  `d2c0222f`, and `afe7cb07`.
- **2026-11-22 — Agent Host request validation boundary.** Moved protocol
  parameter checks, size limits, attachment validation, endpoint restrictions,
  and speech-text normalization into a dedicated partial module. Agent Host
  Release build passes with zero warnings. Commit `5bf18d30`.
- **2026-11-22 — Agent Host dispatch boundary.** Moved the stable protocol
  method table into its own module without changing method names or handlers.
  Agent Host Release build passes with zero warnings. Commit `0150d89e`.
- **2026-11-22 — Electron updater IPC boundary.** Moved updater channel
  registration into its own module while preserving sender checks and the
  external URL allow list. Electron packaging succeeded. Commit `0537223b`.

- **2026-11-18 — Coding Agent task journal, approval controls, and read-only
  project preflight.** Added task activity and restart reconciliation, approval
  review controls, preflight manifest/runtime detection, and focused smoke
  coverage. Verified with desktop typecheck/build, Agent Host build, task
  workflow smoke, syntax checks, and future-features audit. Full Agent Host
  smoke remains sensitive to local model/GPU telemetry; repository hygiene
  flags two pre-existing oversized pet images. See the [capability
  matrix](CAPABILITY_MATRIX.md) and commit `265ab84b`.

## New entry template

Copy this block for each new item:

```markdown
### Short outcome-oriented title

- **Status:** Ready | In progress | Blocked | In review | Done
- **Priority:** Release gate | High | Medium | Low
- **Owner:** Unclaimed
- **Context:** What exists now and what gap remains.
- **Agreed approach:** Concrete implementation steps and constraints.
- **Acceptance:** Observable behavior and evidence needed to call it done.
- **References:** Links to source, issue, capability row, and detailed plan.
- **Blockers / decisions:** None, or describe the external dependency/decision.
```
