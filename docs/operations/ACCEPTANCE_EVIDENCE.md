# Acceptance evidence contract

Feature completion is based on observable behavior. A build or route screenshot
alone does not prove a user workflow works. Each roadmap slice and release
claim must be reviewable from its implementation, a focused success and failure
path, and the evidence recorded below.

## Per-slice checklist

Copy this checklist into the slice's review record before calling it complete:

- [ ] State the user-visible outcome and affected route/workflow.
- [ ] Verify one representative success path and record the exact command or
  manual steps, result, and artifact.
- [ ] Verify one representative failure, disconnected, or denied path and
  record the expected recovery and result.
- [ ] Use a disposable profile for tests that create, modify, delete, import,
  or persist app data. Never point destructive acceptance at the user's profile.
- [ ] For a UI change, name the owner-approved reference, record the before and
  after screenshots, and describe matches and remaining differences.
- [ ] Record platform and OS version, viewport, theme, sidebar state, packaged
  or development runtime, and app revision for every screenshot.
- [ ] Check page/tab context, keyboard access, error state, and Settings return
  behavior when the slice changes navigation or settings.
- [ ] State whether the test stayed local or made an explicit network request;
  identify the request boundary and prove credentials or private content were
  not included when the test does not require them.
- [ ] List platforms, integrations, and hardware that were not verified.
- [ ] Link capability-matrix claims to the commands or manual evidence that
  supports them. Keep unverified claims `partial` or `planned`.

## Evidence record template

```markdown
### Slice N — short name

- Outcome:
- Reference / workflow:
- Success check (command or steps):
- Failure check (command or steps):
- Disposable profile / cleanup:
- Platform / OS:
- Viewport / theme / sidebar:
- Runtime / app revision:
- Network and privacy boundary:
- Before screenshot:
- After screenshot:
- Comparison: matches / differences / follow-up:
- Unverified platforms, integrations, or hardware:
```

## UI screenshot metadata

`npm run smoke:electron:ui-matrix` uses a throwaway app profile. When run with
`UI_MATRIX_CAPTURE=1`, every captured PNG gets an adjacent
`<image>.png.evidence.json` sidecar. The sidecar records the exact test platform,
viewport, theme, sidebar state, packaged Electron runtime, route, and capture
time. Screenshots are evidence only; they do not silently replace approved
reference images. Reviewers compare the before/after pair and note visual and
workflow differences in the corresponding Revision 4 workflow README section.

Older screenshots without sidecars are historical evidence. Their README text
states the known capture context and remaining comparison gap; do not infer a
platform or theme that was not recorded.

## Failure and privacy evidence register

| Scenario | Existing focused evidence | Current boundary |
| --- | --- | --- |
| Local image runtime/model unavailable | [`smoke:image:runtime-unavailable`](../../package.json), [`smoke:image:model-unavailable`](../../package.json) | Covers image runtime/model setup recovery; does not establish recovery for every chat provider. |

### Slice 19 — composable personas and agent presets

- Outcome: persona cards can bind a saved instruction preset, installed local
  skills, auditable tool IDs, and persona/project/workspace memory scope. Chat
  layers bounded preset and skill guidance, discloses tool bindings without
  invoking them, and gates project continuity to the matching project identity.
- Reference / workflow: Persona Workshop composition bindings, effective-access
  panel, instruction provenance, duplicate/import/export, and private test
  sandbox.
- Success check: `npm test`; `npm run desktop:typecheck`; `npm run desktop:build`;
  `npm run smoke:agent-host`; packaged Electron UI matrix with the Persona
  Workshop exercise enabled.
- Failure check: project-scoped continuity with a different or missing project
  identity is omitted; disabled or missing persona skills are rejected before a
  model request; tool bindings remain visible metadata and are not executed by
  the private sandbox.
- Disposable profile / cleanup: core tests use temporary settings stores;
  Agent Host smoke uses its isolated loopback profile; packaged UI smoke uses a
  throwaway Electron profile. No user persona, skill, model, or tool data is
  modified.
- Platform / OS: Windows x64 packaged acceptance; native Linux/macOS remains
  unverified.
- Viewport / theme / sidebar: 1440×900 dark expanded-sidebar matrix plus the
  responsive widths already covered by the shared UI smoke.
- Runtime / app revision: local Agent Host and packaged Electron production
  build for the Slice 19 commit.
- Network and privacy boundary: persona core/host checks are local and use no
  hosted inference; public-research paths are not exercised by this acceptance
  record. Export excludes project identity, credentials, memory, and tool
  permissions.
- Before screenshot: Persona Workshop before composition bindings and scope
  disclosure.
- After screenshot: Persona Workshop with preset/skill/tool binding controls,
  explicit memory scope, effective access, and provenance details.
- Comparison: matches the roadmap's composable-persona workflow while keeping
  the existing all-model support and non-mutating sandbox boundary. A future
  tool-capable persona surface is still required before bindings can execute.
- Unverified platforms, integrations, or hardware: native Linux/macOS UI,
  external MCP/GitHub tool execution from personas, and user-specific local
  model/voice combinations.

### Slice 20 — live voice transcript and accessibility

- Outcome: local Voice Mode exposes a live transcript region while a turn is
  being captured. An optional on-device speech recognizer renders interim text
  without taking ownership of submission; local Whisper remains the source of
  truth for the final turn. Existing device selectors, meters, push-to-talk,
  calibration, captions, stable controls, and assistive status remain covered.
- Reference / workflow: Revision 4 local voice-mode workflow and the Chat
  composer microphone affordance.
- Success check: `npm run desktop:typecheck`; `npm run desktop:build`; focused
  packaged UI matrix with `UI_MATRIX_EXERCISE_VOICE=1`, `UI_MATRIX_QUICK=1`,
  and `UI_MATRIX_ROUTE=chat`.
- Failure check: interim recognition is unavailable or errors without ending
  Voice Mode or sending a remote request; Whisper submission and transcript
  review continue to work; the dialog keeps a polite live status and reachable
  End control.
- Disposable profile / cleanup: packaged UI matrix uses fake media devices and
  a throwaway Electron profile. No microphone audio is saved by the preview
  recognizer or calibration flow.
- Platform / OS: Windows x64 packaged Electron; native Linux/macOS and real
  hardware remain unverified.
- Viewport / theme / sidebar: focused 1440×900 dark expanded-sidebar voice
  exercise plus the shared five-size Chat matrix.
- Runtime / app revision: packaged Electron production build for the Slice 20
  commit.
- Network and privacy boundary: `processLocally=true` is required when the
  runtime exposes local speech recognition. Preview errors are non-fatal, and
  no hosted speech endpoint is used.
- Before screenshot: Voice Mode with session transcript placeholder while the
  microphone is listening.
- After screenshot: same dialog with the live-transcript region and accessible
  status controls; no visual screenshot is treated as proof of speech quality.
- Comparison: closes the prior interim-preview gap while preserving the
  turn-based Whisper privacy boundary. True audio-frame streaming, native
  output routing/levels, and representative voice/hardware quality fixtures
  are still explicit release boundaries.

### Slice 21 — Visuals Workshop queue and activation readiness

- Outcome: Visuals Workshop keeps its large canvas and gallery while making
  generation jobs durable and honest about local prerequisites. Queue records
  are bounded to twelve, pending work to eight, and batches to four. A job that
  was running during shutdown is marked recoverable instead of replayed; queued
  work can be resumed explicitly.
- Reference / workflow: Revision 4 Visuals Workshop canvas/gallery/composer
  layout and local image-generation workflow.
- Success check: `npm run desktop:typecheck`; `npm run desktop:build`;
  `npm run package:electron`; focused packaged UI matrix with
  `UI_MATRIX_EXERCISE_VISUALS=1`, `UI_MATRIX_QUICK=1`, and
  `UI_MATRIX_ROUTE=images`.
- Failure check: malformed persisted jobs are ignored; oversized prompt or
  workflow records are rejected; interrupted jobs are not silently rerun; the
  activation panel names the runtime, model, disk, license, endpoint,
  checkpoint, and custom-node boundary before setup.
- Disposable profile / cleanup: packaged UI matrix uses a throwaway Electron
  profile. Queue state is local to that profile and no user gallery or model
  cache is modified.
- Platform / OS: Windows x64 packaged Electron; live ComfyUI/GPU acceptance and
  native Linux/macOS remain unverified.
- Viewport / theme / sidebar: focused 1440×900 dark expanded-sidebar image
  exercise plus the shared five-size matrix.
- Runtime / app revision: packaged Electron production build for the Slice 21
  commit.
- Network and privacy boundary: activation text clearly distinguishes one-time
  runtime/model downloads from on-device generation; arbitrary ComfyUI model
  and custom-node licenses remain upstream responsibilities.
- Before screenshot: Visuals Workshop empty canvas with preset, batch, and
  workflow controls.
- After screenshot: same layout with activation-requirements disclosure and a
  recoverable generation queue action; screenshot evidence does not claim live
  GPU or ComfyUI compatibility.
- Comparison: closes durable queue and pre-activation-readiness gaps while
  preserving the honest Video/Music placeholders. Arbitrary local-media
  browsing and runtime-specific failure diagnostics remain open.
| MCP denied access, revoke, reconnect, delayed response | [`smoke:marketplace-host`](../../package.json), [`MCP client tests`](../../native/SkaiDesktop.Core.Tests/McpStreamableHttpClientTests.cs) | Loopback lifecycle verifies denied writes, revocation, and fresh-session reconnect; core test injects a delayed handler and checks the request deadline. Packaged timeout UI recovery remains unverified. |
| GitHub authentication expiry | [`GitHub integration guide`](../guides/GITHUB_INTEGRATION.md), [`GitHub core tests`](../../native/SkaiDesktop.Core.Tests/GitHubTests.cs) | Device-flow expiry/polling and an injected HTTP 401 are covered; end-to-end refresh failure in the packaged UI remains unverified. |
| Disk full / storage exhaustion | [`Atomic file writer fault-injection test`](../../native/SkaiDesktop.Core.Tests/AtomicFileWriterTests.cs), [`Agent Host smoke`](../../scripts/smoke-agent-host.cjs) | A deterministic injected ENOSPC write failure verifies that the last complete file is preserved and the partial temp file is cleaned up. It does not fill a real disk or verify the packaged UI recovery message; disk-growth quota remains unenforced. |
| Privacy / explicit network boundary | [`Local-only audit`](../../package.json), [`Marketplace host smoke`](../../package.json) | Release audit rejects unapproved hosted inference and host smoke rejects hosted MCP/model removal paths. Provider-specific outbound request inspection remains scoped to the relevant integration smoke. |

### Slice 17 completion — review workflow affordances

- Outcome: the local Git review surface now keeps anchored notes with open,
  resolved, or deferred status and a local history, offers an explicit reviewer
  agent handoff, maps changed files to detected checks as advisory coverage,
  and gives media/document/rename/binary changes a clear before-versus-working
  copy review path.
- Reference / workflow: packaged Coding Changes pane and the Revision 4 Git
  review workflow reference.
- Success check: `npm run desktop:typecheck`; `npm run desktop:build`; focused
  packaged UI matrix with `UI_MATRIX_ROUTE=coding`,
  `UI_MATRIX_VIEWPORT=1440x900`, and `UI_MATRIX_QUICK=1`.
- Failure check: the review UI preserves stale anchors, labels unavailable
  binary bytes as metadata-only, and does not claim a check or reviewer ran;
  all actions remain disabled or advisory where the required evidence is absent.
- Disposable profile / cleanup: packaged UI matrix uses a throwaway Electron
  profile and local fixture project; no user repository is modified.
- Platform / OS: Windows x64 packaged Electron.
- Viewport / theme / sidebar: 1440×900, dark theme, expanded sidebar.
- Runtime / app revision: packaged frontend production build; smoke completed
  against the current local revision before commit.
- Network and privacy boundary: local-only project fixture and local Agent Host;
  reviewer handoff creates a local chat prompt and sends no source externally.
- Before screenshot: prior Git review surface with anchored notes and hunk
  selection only.
- After screenshot: review surface includes advisory check coverage, explicit
  before/working-copy cards, reviewer-agent handoff, and note status/history
  controls. The existing UI matrix capture remains the interaction evidence.

### Slice 18 completion — safer local automations

- Outcome: schedules now require a successful one-time dry run before
  activation, retain trigger/overlap/source provenance, disclose model/access,
  and surface bounded local notification history for completed, failed, or
  decision-waiting runs.
- Reference / workflow: Scheduled task page and the conversation scheduling
  panel, with schedule/manual/project-event/local-webhook trigger choices.
- Success check: `npm run desktop:typecheck`; `npm run desktop:build`; `npm test`.
- Failure check: activation is blocked until preview succeeds; project-event and
  webhook identifiers remain local metadata and no public listener is implied;
  legacy schedules are migrated with their creation time as the historical
  dry-run marker.
- Disposable profile / cleanup: native scheduled-store tests use a temporary
  directory; packaged UI profiles remain throwaway and no user schedule is
  mutated.
- Platform / OS: Windows x64 development host and local Agent Host.
- Viewport / theme / sidebar: renderer build/type checks cover the responsive
  schedule form; focused packaged visual capture remains follow-up evidence.
- Runtime / app revision: Agent Host scheduler with prompt-only execution and
  the existing local notification preference/history surface.
- Network and privacy boundary: no public webhook server or remote tool access;
  the scheduled prompt uses the configured provider under the existing local
  transport policy.
- Before screenshot: schedule form offered save after a non-persisting preview
  but did not retain trigger/source/overlap metadata.
- After screenshot: form offers trigger, overlap, successful-task/workflow
  provenance, and an explicit “Enable automation” dry-run gate; details show
  the stored activation evidence and notification boundary.
- Comparison: changed-file selection and hunk staging remain unchanged; new
  controls add review context without implying unavailable binary or CI data.
- Unverified platforms, integrations, or hardware: native Linux/macOS visual
  review; native binary-content rendering; remote CI result correlation.

### Slice 33 — safer Marketplace and installed inventory

- Outcome: one category-filtered installed inventory feeds a shared inspector
  with source, version, update date, disk use, compatibility, known dependents,
  and removal impact; supported local removals are confirmed and guard active
  model, voice, and image-workflow dependencies.
- Reference / workflow: compare the [previous installed inventory](../design-review/workflow-collection/revision-4/evidence-marketplace-installed-voices-1440.png)
  with the [updated inventory and inspector](../design-review/workflow-collection/revision-4/evidence-marketplace-installed-inventory-1440.png).
- Success check: `npm test`; `npm run desktop:typecheck`; `npm run desktop:build`;
  `npm run package:electron`; `npm run smoke:marketplace-host`; focused packaged
  UI matrix with `UI_MATRIX_ROUTE=marketplace`, `UI_MATRIX_VIEWPORT=1440x900`,
  `UI_MATRIX_QUICK=1`, `UI_MATRIX_CAPTURE=1`, and
  `UI_MATRIX_EXERCISE_INSTALLED_VOICE=1`. Skill installer tests verify
  provenance, digest, install/update timestamps, size, and removal of only the
  selected package and its rollback copies. The packaged route verifies category
  filtering, the common inspector metadata, voice availability, and sticky
  action reachability.
- Failure check: the UI matrix rejects missing inspector details or unreachable
  actions; installer tests reject missing packages and unsafe package content;
  removal handlers refuse selected chat/subagent models, assigned Qwen voices,
  and LoRAs referenced by saved or active image workflows.
- Disposable profile / cleanup: packaged UI matrix uses a throwaway Electron
  profile; marketplace host smoke uses isolated loopback fixtures; native skill
  tests use temporary source and install directories. No user-installed model,
  voice, skill, or project data is changed.
- Platform / OS: Windows x64; packaged UI smoke reports Windows build 26200.
- Viewport / theme / sidebar: 1440×900, dark theme, expanded sidebar; screenshot
  sidecar records the test context and marks its source revision as dirty because
  it captures this slice before commit.
- Runtime / app revision: packaged Electron; frontend production build and
  Windows Electron packaging completed successfully.
- Network and privacy boundary: Marketplace host smoke uses a local fixture;
  packaged UI uses the local Agent Host. No hosted inference or remote model
  download was performed by the acceptance run.
- Before screenshot: earlier installed-voice inspector showing Source,
  Requirements, and Next step only.
- After screenshot: shared installed-item inspector with provenance, size,
  compatibility, dependency, removal-impact, and workflow guidance fields.
- Comparison: the voice list/detail split and category controls remain in place;
  the inspector now carries the same operational context for every inventory
  category. The primary action row remains reachable while the inspector scrolls.
  List rows avoid repeating version and size already available in the inspector.
- Unverified platforms, integrations, or hardware: native Linux/macOS UI; live
  deletion/update against the user's installed runtimes; install/update/remove
  recovery for every Marketplace category; third-party item dependency metadata
  not reported by its owning runtime.

Known gaps in this table are intentionally explicit release limitations. A
future slice may close them with bounded deterministic fixtures; do not simulate
an OS-level disk-full condition by filling a developer or CI volume.

### Slice 22 — agent harness adapter health

- Outcome: keep external harness discovery honest while making local health
  visible. The catalog remains contract v2; external adapters never become
  executable merely because a binary is on PATH.
- Success check: `npm run smoke:agent-host`; packaged Coding-route smoke with
  `UI_MATRIX_QUICK=1 UI_MATRIX_ROUTE=coding` verifies the catalog, `Check harness health`,
  native-vs-Skai capability labels, and the bounded `--version` disclosure.
- Safety boundary: the probe accepts only a catalog adapter ID, launches its
  discovered executable with `--version`, redirects output, caps captured text
  to 400 characters, and kills the process after four seconds. It never opens
  a project, imports a session, authenticates, or executes a task.
- Unverified: external login state, session import/resume, native terminal
  sessions, and compatibility execution fixtures remain intentionally open.

### Slice 23 — first-run onboarding and capability discovery

- Outcome: guide a new local profile to a useful first chat without making
  external setup or demo content look real.
- Success check: packaged route smoke with
  `UI_MATRIX_QUICK=1 UI_MATRIX_ROUTE=onboarding UI_MATRIX_EXERCISE_ONBOARDING=1`
  passed the isolated task/Git/Visuals previews, model readiness advisory,
  navigation-guide dismissal, checklist reset, optional skip, and re-entry.
- Safety boundary: the demo remains page-local state; it makes no provider,
  tool, project, file, or media-generation call. Checklist reset only clears
  device-local onboarding keys and preserves chats, projects, and models.
- Unverified: first-run acceptance on native Linux/macOS and manual
  assistive-technology review.

### Slice 25 — safety and permission policy

- Outcome: make local permissions, sandbox boundaries, and untrusted-content
  handling inspectable from one settings surface.
- Success check: packaged Settings-route matrix verifies the Permission Center
  renders selected project roots, revoke-all controls, exact grant scope and
  duration, platform sandbox disclosure, enforced task bounds, local audit
  history, and the “Prompts do not grant access” boundary.
- Safety boundary: the UI states that files, webpages, model output, MCP
  metadata, and imported transcripts cannot widen grants or disable sandboxing;
  project revocation remains the explicit cancellation/recovery action.
- Unverified: real OS prompt-injection fixtures, disk-growth enforcement, and
  a second-review gate for future unattended high-risk actions.

### Slice 26 — backup, migration, and data ownership

- Outcome: make selected workspace data portable without exporting credentials,
  machine paths, runtime caches, or project access grants. Backup previews now
  identify the source platform; restore previews identify source and target
  platforms and keep machine-specific settings local.
- Success check: `npm run desktop:typecheck`; `npm run desktop:build`;
  `npm run package:electron`; packaged Settings-route smoke with
  `UI_MATRIX_QUICK=1 UI_MATRIX_ROUTE=settings UI_MATRIX_EXERCISE_BACKUP=1`
  verifies the export preview, Windows/Linux portability disclosure, redaction
  disclosure, restore file affordance, storage ownership panel, and retention
  controls.
- Failure check: the host continues to verify archive digest and payload before
  restore; no backup preview or portability label grants access to project
  folders or credentials.
- Disposable profile / cleanup: the packaged matrix uses a throwaway Electron
  profile and only opens the local export preview; it does not write a backup,
  restore user data, or touch installed runtime caches.
- Platform / OS: Windows x64 packaged Electron; cross-OS restore remains
  unverified and is represented as a portability disclosure rather than a claim
  of native Linux/macOS acceptance.
- Network and privacy boundary: all backup operations use the local Agent Host;
  the data-flow panel names the integrations that can leave the device.
- Remaining: live Windows-to-Linux restore, disk quota enforcement, and runtime
  provider cache cleanup remain open follow-up work.

### Slice 27 — accessibility and cross-platform polish

- Outcome: make the existing accessibility affordances discoverable and
  regression-tested. The Appearance gallery exposes the built-in High Contrast
  theme, keyboard focus reaches its search and card controls, and preview state
  is announced through the existing `role="status"` region. Reduced-motion
  controls and screen-reader task summaries remain part of the shared shell.
- Success check: packaged Settings-route matrix with
  `UI_MATRIX_QUICK=1 UI_MATRIX_ROUTE=settings
  UI_MATRIX_EXERCISE_ACCESSIBILITY=1` verifies keyboard focus, High Contrast
  discovery/preview/cancel, and the status announcement at five window sizes.
- Failure check: the smoke fails if the accessible search/card is missing, the
  High Contrast preview cannot be reached by keyboard, or cancel leaves a
  preview active.
- Disposable profile / cleanup: the packaged matrix uses a throwaway Electron
  profile and cancels the preview; no theme files or user appearance settings
  are changed.
- Unverified: native Linux/macOS startup and input capture, manual screen-reader
  review, high-DPI/fractional scaling, and long-translation layout acceptance.

### Slice 28 — capacity-aware scheduling and performance

- Outcome: distinguish facts from estimates in the local capacity surface. Usage
  now labels OS measurements as measured locally, runtime/GPU details as
  provider-reported, and admission/slot/headroom values as estimated; the host
  continues to keep admission conservative when telemetry is unavailable.
- Success check: `npm run desktop:typecheck`; `npm run desktop:build`;
  `npm run package:electron`; packaged Usage-route smoke with
  `UI_MATRIX_QUICK=1 UI_MATRIX_ROUTE=usage UI_MATRIX_EXERCISE_CAPACITY=1`
  opens the capacity details and verifies measured/provider/estimated labels.
- Failure check: capacity labels cannot imply measured precision for estimates;
  the scheduler remains FIFO and does not unload models automatically.
- Disposable profile / cleanup: the packaged matrix uses a throwaway Electron
  profile and only reads local capacity; no model is unloaded or task started.
- Unverified: user-selected priority policies, runtime-observed parallelism,
  separate first-token/stream/completion timing samples, and hardware-class
  acceptance beyond the current host.

### Slice 29 — privacy-first collaboration

- Outcome: make optional shared work local and reviewable. Chat collaboration
  creates an offline, read-only HTML snapshot with an explicit included/excluded
  boundary; the snapshot can export a suggestion or private fork, while the
  owner imports suggestions into an unsent draft and can revoke future imports.
  The active chat header visibly reports owner, access level, participant count,
  and expiration.
- Success check: `npm run desktop:typecheck`; `npm run desktop:build`;
  `npm run package:electron`; packaged Chat-route smoke with
  `UI_MATRIX_QUICK=1 UI_MATRIX_ROUTE=chat UI_MATRIX_EXERCISE_CHAT_BASE=1
  UI_MATRIX_EXERCISE_CHAT_COLLABORATION=1` verifies the CSP-constrained
  snapshot, excluded context disclosure, private-fork archive, suggestion
  preview and draft-only acceptance, owner-side revocation, and the session
  header fields.
- Failure check: the smoke fails if sharing starts a network host, the snapshot
  omits its read-only boundary, suggestions bypass review or execute tools, a
  revoked share still previews imports, or the header hides ownership/access /
  participant/expiry state.
- Disposable profile / cleanup: the packaged matrix uses a throwaway Electron
  profile and intercepts snapshot downloads in memory; no network listener,
  companion device, project file, or tool execution is created.
- Network and privacy boundary: live LAN, QR pairing, encrypted relay sync, and
  remote tool actions remain disabled until a trusted host/device identity and
  separate tool opt-in protocol are implemented and threat-modeled. Downloaded
  snapshots cannot be remotely erased, which is disclosed to the owner.
- Unverified: native LAN transport, QR key rotation, relay encryption review,
  companion-device UX, and remote action approval are intentionally open.

### Slice 30 — notifications and mobile follow-up

- Outcome: keep local task notifications useful without implying a remote
  control plane. Existing delivery groups repeated transitions, defaults to
  private previews, supports quiet hours and project muting, deep-links back to
  the local task inbox, and retains bounded delivery history. Settings now shows
  the last local task observation, marks it stale after five minutes, and
  explicitly says the status is not a remote/mobile connection.
- Success check: `npm run desktop:typecheck`; `npm run desktop:build`;
  `npm run package:electron`; packaged Settings-route smoke with
  `UI_MATRIX_QUICK=1 UI_MATRIX_ROUTE=settings
  UI_MATRIX_EXERCISE_TASK_NOTIFICATION_SETTINGS=1` verifies privacy-safe
  defaults, quiet-hour persistence, and the local freshness disclosure. Native
  `npm test` also passes.
- Failure check: the settings panel must not present cached task state as live,
  notification titles must remain hidden by default, and the local history must
  continue recording delivery failures and quiet-hour decisions.
- Disposable profile / cleanup: the packaged matrix uses a throwaway Electron
  profile and restores notification preferences; no OS notification permission
  is requested and no remote host is started.
- Network and privacy boundary: desktop notifications are local browser/OS
  delivery only. Mobile approvals, lock-screen pause/cancel actions, and local
  network status links remain disabled until a trusted host and task-scoped
  approval protocol are implemented.
- Unverified: native OS notification action buttons, lock-screen privacy across
  platforms, companion-device transport, and offline mobile reconciliation.

### Slice 31 — shortcuts and command workflows

- Outcome: make frequent commands faster without hiding the workflow from new
  users. The command palette already supports search, contextual relevance,
  recent/pinned actions, and keyboard navigation; Settings owns conflict-aware
  shortcuts, saved slash aliases, toolbar density, and Enter/Shift+Enter
  behavior. Menus and palette actions now expose the same shortcuts through
  tooltips and `aria-keyshortcuts`.
- Success check: `npm run desktop:typecheck`; `npm run desktop:build`;
  `npm run package:electron`; packaged Settings-route smoke with
  `UI_MATRIX_QUICK=1 UI_MATRIX_ROUTE=settings UI_MATRIX_VIEWPORT=1440x900
  UI_MATRIX_EXERCISE_COMMAND_WORKFLOWS=1` verifies saved aliases, conflict
  rejection, custom shortcut capture, and toolbar/send persistence. The same
  matrix waits for the asynchronous Permission Center data before asserting
  its disclosures, and `npm run check:acceptance-evidence` passes.
- Failure check: shortcut conflicts must be rejected without overwriting the
  existing binding; imported aliases must not contain credentials; menu and
  palette actions must keep their visible shortcut, tooltip, and accessible
  shortcut name aligned.
- Disposable profile / cleanup: the packaged matrix uses a throwaway Electron
  profile and restores the command-workflow preference key after exercising
  the controls; no project files, credentials, or network services are used.
- Network and privacy boundary: aliases and shortcut preferences remain local;
  command discovery does not grant tool access or execute a tool during the
  settings workflow.
- Unverified: selection-aware command dispatch, native OS menu accelerators,
  and platform-specific keyboard layouts outside the Windows packaged run.

### Slice 32 — evidence-driven completion

- Outcome: link each capability status to an executable check and record
  acceptance context and release boundaries.
- Success check: `npm run check:acceptance-evidence`; `npm test`; focused
  packaged UI matrix with `UI_MATRIX_EXERCISE_SETTINGS_OVERLAY=1`.
- Failure check: missing image runtime smoke; delayed MCP response deadline;
  injected GitHub HTTP 401; injected ENOSPC temporary-file write.
- Disposable profile / cleanup: UI matrix and image workflow create temporary
  Electron user-data and Agent Host profiles. Fixtures are removed by smoke
  cleanup; the installed model cache is not modified.
- Platform / OS: current acceptance run is Windows 11 x64; release CI also
  executes the Linux packaged artifact gates listed in release readiness.
- Viewport / theme / sidebar: focused Settings-return test at 1440×900, dark,
  expanded sidebar; screenshot metadata sidecars capture actual test values.
- Runtime / app revision: packaged Electron artifact, with revision recorded
  in each newly captured screenshot sidecar.
- Network and privacy boundary: test uses local host fixtures. GitHub 401 is
  returned by an in-memory HTTP handler; no GitHub credential or network call is
  used. Existing local-only audit and marketplace smoke remain the network
  boundary gates.
- Before/after screenshots: no visual redesign in this slice; UI matrix
  captures are regression evidence, not a new design reference comparison.
- Unverified platforms, integrations, or hardware: native macOS; native Linux
  desktop; packaged MCP timeout display; full GitHub refresh failure UI; app UI
  response to actual disk exhaustion; user hardware/model/GPU combinations.
