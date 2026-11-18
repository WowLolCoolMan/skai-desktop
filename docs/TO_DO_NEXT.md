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
- When proposing work that changes the local-only boundary, permissions, or
  persisted data, link the decision record or request that product decision
  before implementation.

## Active and next-up work

### 1. Run selected project checks and keep their evidence with the task

- **Status:** Ready
- **Priority:** Highest capability gap
- **Owner:** Unclaimed
- **Context:** The Coding Agent now has a read-only project preflight that finds
  manifests, checks local runtimes, and suggests checks. It intentionally does
  not execute them. The task journal already records approval and operation
  outcomes.
- **Agreed approach:** Let the user select one of the detected safe checks,
  review the exact command and working directory, and explicitly approve its
  execution. Capture exit status and bounded output in the task timeline and
  show the result beside the diff. Keep preflight read-only; never auto-run
  checks. Preserve existing command guardrails and do not record secrets or
  unrestricted command output.
- **Acceptance:** Preflight still runs no commands; the user can review and
  approve a selected check; success, failure, timeout, and cancellation are
  visible with exit information; task evidence survives host restart; tests
  cover redaction and no-replay behavior.
- **References:** [Capability matrix](CAPABILITY_MATRIX.md#highest-priority-remaining-work),
  [Coding task timeline and approval](../native/SkaiDesktop.Core/Infrastructure/OperationJournal.cs),
  [project preflight](../native/SkaiDesktop.Core/Services/ProjectPreflightService.cs).

### 2. Complete local voice acceptance

- **Status:** Ready
- **Priority:** High
- **Owner:** Unclaimed
- **Context:** Voice input and output paths exist, but a successful installed
  speech-pack and real microphone/audio acceptance run is still missing.
- **Agreed approach:** Test on a supported Windows profile with the required
  speech pack installed. Record a short local fixture and exercise one-shot
  dictation, hands-free turn completion, cancellation, unavailable-language,
  and device-error recovery. Keep audio processing local and do not upload
  recordings as test evidence.
- **Acceptance:** The pack installation outcome and actual transcription are
  verified; cancellation and missing-pack failures are actionable; no audio or
  transcript leaves the device; evidence identifies OS/runtime versions.
- **References:** [Capability matrix](CAPABILITY_MATRIX.md),
  [voice architecture](ELECTRON_CSHARP_VOICE_ARCHITECTURE.md),
  [production readiness](PRODUCTION_READINESS_GAPS.md).

### 3. Strengthen OS isolation for Coding Agent commands

- **Status:** Ready
- **Priority:** High, before unattended or parallel execution
- **Owner:** Unclaimed
- **Context:** The Agent Host has bounded local file and command tools, user
  approval, and an operation journal. These controls are not a substitute for
  OS-level isolation.
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

- **Status:** Ready
- **Priority:** High
- **Owner:** Unclaimed
- **Context:** Local Diffusers and ComfyUI generation/edit flows exist; live
  runtime acceptance and robust progress/cancel behavior remain incomplete.
- **Agreed approach:** Exercise the supported local runtimes and expose real
  stage/progress state when the runtime provides it. Cancellation must stop the
  active operation, preserve completed outputs, and return the UI to a usable
  state. Clearly label unknown progress instead of inventing a percentage.
- **Acceptance:** A local generation and edit can be started, monitored, and
  cancelled; runtime errors and missing dependencies are actionable; completed
  images remain available; progress reflects runtime evidence.
- **References:** [Capability matrix](CAPABILITY_MATRIX.md),
  [local image generation](LOCAL_IMAGE_GENERATION.md).

### 5. Close release signing and upgrade acceptance

- **Status:** Ready
- **Priority:** Release gate
- **Owner:** Unclaimed
- **Context:** Packaging and signed-manifest checks exist, but trusted signing,
  upgrade/rollback, and packaged cross-platform acceptance remain open.
- **Agreed approach:** Use the release checklist against exact packaged
  artifacts. Verify signatures, checksums, clean install, upgrade with data
  retention, uninstall, and rollback on each supported target. Do not mark a
  platform ready based on development builds alone.
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
- **Blockers / decisions:** Name-only transcript discovery remains incomplete.`r`n  Do not treat the goal as complete until the
  real-source and local-model acceptance evidence above is recorded.
## Recently completed

Move finished entries here with their commit/PR and verification evidence.

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
