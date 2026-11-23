# To Do Next

The active contributor queue: each entry records the next step and agreed
constraints. Use the [capability matrix](CAPABILITY_MATRIX.md) for current
status, focused guides for workflows, and [implementation plans](implementation-plans/README.md)
for technical detail. Keep this file short; link to canonical detail instead
of repeating it.

## Contributor notes

- Add substantial work here with an owner, status, next step, and acceptance
evidence. Use `Unclaimed` when nobody owns it.
- Record decisions that change provider routing, permissions, or stored data in
the relevant plan before implementation.
- Move finished work to [the archive](../archive/README.md) or the changelog;
keep this queue focused on unfinished work.

## Finish the current work

Ordered around open acceptance blockers and the user's explicit priorities.
Mark an item done only when the linked workflow has evidence.

1. **UI and accessibility acceptance — In progress · Codex.** The packaged
   audit covers 14 routes with zero WCAG violations. Fourteen Axe checks remain
   inconclusive across eight contrast patterns because text sits over gradients;
   review those gradients visually. A 1440×900 dark-theme spot check of Chat
   and Marketplace found no obviously unreadable text; Marketplace was in its
   host-unavailable recovery state. This does not cover all gradient patterns.
   Popup relationships and named regions now pass. Responsive overflow passes
   11 routes at five widths. Review the
   17-route matrix, keyboard/focus behavior, assistive technology, narrow
   layouts, and pet animations. Record screenshots and gaps in
   [UI progress](SKAI_PREMIUM_UI_PROGRESS.md).
2. **Real microphone voice — In progress · Codex.** Packaged Windows smoke now
   records and stops a short microphone clip and confirms local Whisper returns
   a reviewable transcript on this host. Still verify intelligible speech,
   permission denial/recovery, cancellation, and hands-free on a local speech
   pack. Keep the path local. See the
   [voice architecture](../engineering/ELECTRON_CSHARP_VOICE_ARCHITECTURE.md).
3. **Cross-profile Coding Agent sandbox — In progress · Codex.** Verify Windows
  PSEC and Linux Bubblewrap/cgroup behavior on more supported profiles. Windows
  and Ubuntu 24.04 WSL acceptance now pass filesystem, network, process, memory,
  timeout, and cancellation checks. Keep failing closed where sandbox setup is
  unavailable; no macOS command path without a sandbox. See
  [architecture](../engineering/ARCHITECTURE.md).
4. **Persona era acceptance — In progress · Unclaimed.** Run multi-turn
   date-cutoff checks across living and deceased personas and multiple models.
   A Qwen3 14B David Lynch follow-up completed; 2010-era persona quality was
   weak, so the evidence and cutoff behavior still need broader acceptance.
   See the
   [Smart Personas plan](implementation-plans/smart-personas.md).
5. **Image runtime coverage — In progress · Unclaimed.** Exercise a live
   ComfyUI server and GPU/additional hardware; verify truthful progress,
   cancellation, and recovery. See the
   [image guide](../guides/LOCAL_IMAGE_GENERATION.md).
6. **Windows update acceptance — In progress · Codex.** The isolated current-
   source updater smoke now installs a disposable 0.1.3 baseline, verifies and
   applies the 0.1.4 installer from loopback, preserves a profile marker, and
   removes the temporary app files. Remaining: published-feed install and
   rollback acceptance on a release built with current updater support.
7. **Native Linux release acceptance — In progress · Unclaimed.** Exercise the
   AppImage, updater, rollback, and window behavior on a supported desktop, not
   only WSL/Xvfb. See [release readiness](../operations/RELEASE_READINESS.md).
8. **Credential-store recovery — In progress · Codex.** Test Linux desktop
   unlock/restart and locked/corrupted keyring recovery; implement and verify a
   macOS credential adapter before hosted chat routes.
9. **Marketplace end-to-end support — In progress · Codex.** Give every
   advertised entry a verified local install/setup, launch/use, and removal
   path; expose license/runtime requirements and never leave an entry looking
   usable when its adapter is missing. Saved ComfyUI workflows can now be
   reviewed and activated inside Marketplace; exact model packages and the
   remaining MCP/voice adapters still need end-to-end support.
10. **GitHub workflow acceptance — In progress · Codex.** Core tests now cover
    permission denial, network failure, request cancellation, pending/slow-down
    retry, stale branch/conflict detection, and protected-token persistence.
    Remaining: isolated live acceptance for consent denial, repository access,
    clone conflicts, cancellation, and retry with a real test credential.

## Next up

11. **Requested voice engines.** Marketplace currently has verified install/use
    paths for Kokoro and Piper; Whisper large-v3 covers local transcription.
    41 of 89 curated entries now have real adapters, and the catalog smoke
    asserts that boundary. Chatterbox Nano has a pinned isolated CPU installer,
    verified model downloads, a resident worker, and Marketplace/voice
    selection wiring. The end-to-end smoke passed install, hash checks, and
    non-silent local WAV synthesis on this Ryzen 7 5800X3D: the warm path made
    3.04 seconds of audio in 3.36 seconds; cold startup plus synthesis took
    23.64 seconds for 2.56 seconds of audio. This shows near-real-time warm
    throughput on one phrase, with slow first-use model loading; spoken quality
    and other hardware remain unreviewed. Earlier host smoke measured Piper at
    3.53 seconds of audio in 0.83 seconds and Kokoro at 3.26 seconds in 8.91
    seconds on the 32 GiB Windows/RX 7900 XTX machine; those one-phrase timings
    are not a subjective speech-quality rating. Qwen3-TTS is not an obvious realtime fit here: its
    upstream recommends an isolated Python 3.12 environment, while its example
    accelerator path uses CUDA; verify model-card terms and an actual local run
    before enabling it ([upstream setup](https://github.com/QwenLM/Qwen3-TTS#quickstart)).
    Keep credentialed hosted services clearly separated from local catalog
    entries.
12. **User-controlled provider gateway.** Add explicit local/cloud/hybrid chat
    routing only after OS-protected credentials, data disclosure, and an
    offline-only mode are verified. No silent provider fallback.
13. **MCP lifecycle — In progress · Codex.** Local-only smoke verifies hosted
    endpoint rejection, read-only Filesystem MCP, Playwright stdio, local
    PostgreSQL, approved tool calls, health, and revocation. Revoked IDs are
    immutable. Remaining: verified adapters and setup for the other curated
    MCP servers, plus reconnect and recovery acceptance across supported
    transports.
14. **Model fit and license guidance — In progress · Codex.** The model
    inspector now compares package size against current free RAM, reports GPU
    memory when telemetry exists, and labels the result as advisory. Hugging
    Face results now surface license metadata from the model card or license
    tag, and clearly prompt source review when neither is published. Remaining:
    validate across more hardware and compare GPU/offload behavior; this Windows
    host has no supported NVIDIA memory telemetry.
15. **Resumable model installs — In progress · Codex.** The Skai-managed
    ModelScope GGUF installer now persists checksum-keyed partial shards,
  resumes with HTTP Range, preserves partial bytes on cancellation, validates
  the complete size/hash/signature, and removes its cache only after successful
  Ollama import. Remaining: retry behavior delegated to Ollama/LM Studio.
16. **Legacy conversation import — Done · Codex.** JSON archive import now
    previews the merge, requires confirmation, keeps repeat imports idempotent,
    reassigns colliding IDs, strips legacy project context, and leaves existing
    conversations intact. Verified by the disposable Agent Host smoke; see
    [conversation import](../guides/CONVERSATION_IMPORT.md).
17. **Scanned documents and data files — Done · Codex.** `.xlsx` attachments
    extract bounded cached cell values locally without running formulas.
    Packaged English OCR handles PDFs locally, preserving selectable text and
    OCRing only image-only pages in mixed documents. It is limited to 20 pages
    and 16,000 characters; OCR text remains labeled and untrusted. The packaged
    Windows smoke verifies both selectable-text preservation and scanned-page
    recognition.
18. **Packaged media coverage — Done · Codex.** The packaged Windows smoke
    records and decodes VP8 WebM through the local file bridge and verifies its
    four extracted frame attachments. This Chromium-generated WebM reports a
    near-zero duration, so only the H.264 MP4 fixture currently verifies
    timestamped frame labels. WAV reaches local Whisper; spoken-word quality
    remains tracked under item 2.
19. **Context and run capacity.** Verify actual 1M-token execution with a
    compatible model; improve runtime-aware estimates and safe concurrency.
20. **Production update trust.** Add signed update metadata and prepare trusted
    installer signing/clean-machine validation. Code-signing certificates were
    previously deferred; do not publish unsigned testing builds as production.

## Recently completed

Current behavior and acceptance limits belong in the capability matrix and
feature backtest. The detailed 2026-11-22 queue snapshot preserves prior notes.

- **2026-11-23:** Added a pinned Chatterbox Nano Marketplace installer and
  local synthesis adapter. Setup uses an isolated CPU-only Python environment,
  verifies every downloaded model file, and checks local speech before marking
  the engine installed. Python 3.13 setup selects NumPy 2 to match upstream's
  dependency metadata. The warm worker remains local to the Agent Host. The
  end-to-end install and WAV smoke passed, including non-silent 24 kHz output.
  On the Ryzen 7 5800X3D, cold load plus a 2.64-second sample took 20.31 seconds;
  a warm 3.12-second sample took 3.27 seconds. First-use latency and spoken
  quality remain open; see the capability matrix for the acceptance boundary.

- **2026-11-23:** If the local Agent Host exits or its request pipe breaks
  unexpectedly, Electron now retires the unusable child and relaunches on the
  next request so Retry can recover Marketplace and other host-backed screens.
  Intentional shutdown and initial startup failure still remain stopped/offline.
  The Agent Host client test verifies recovery after both exit and pipe failure.

- **2026-11-23:** MCP connection IDs are now immutable. A revoked ID cannot be
  overwritten through `mcp.connection.connect` to restore access; reconnecting
  requires creating a new reviewed connection. The Core registry test now
  checks this revocation bypass is refused.

- **2026-11-23:** Windows in-app update smoke now passes on the current updater
  code: a disposable 0.1.3 baseline verified and installed the 0.1.4 loopback
  update, retained its user-data marker, and removed its temporary app files.
  It builds the baseline fixture with hard links when possible and safely falls
  back to copies across Windows volumes. The test installer is unsigned; this is
  local acceptance only.

- **2026-11-23:** `smoke:voice:acceptance` now invokes installed Kokoro and
  Piper runtimes with network access disabled, validates the produced WAV and
  non-silent signal, and reports full cold one-shot timing. On this Windows
  host, Piper produced 3.53 seconds of audio in 0.83 seconds; Kokoro produced
  3.26 seconds in 8.91 seconds. This does not assess how natural the generated
  speech sounds. The check skips engines that are not installed.

- **2026-11-23:** Packaged accessibility audit now reports 14 routes, zero WCAG
  violations, a working skip link/main landmark, and valid expanded Model
  Picker and overflow-menu relationships. Fixed the dialog/listbox mismatch,
  stale `aria-controls` references, and unlabeled non-semantic regions.
  Fourteen contrast checks across eight patterns remain inconclusive because
  Axe cannot resolve the app's gradient backgrounds; verify those visually.

- **2026-11-23:** Packaged accessibility audit inspected 14 routes and found
  zero automated WCAG violations, zero serious/critical findings, a working
  skip link, and a working main landmark. Twenty-nine checks remain incomplete
  for manual review; this does not close the 17-route visual and assistive
  technology acceptance item.

- **2026-11-23:** Fixed the Settings footer extending beyond the content panel
  at wide and narrow widths. Rebuilt the Windows artifact; responsive overflow
  passed 11 routes × 5 widths, and the full packaged artifact smoke passed.

- **2026-11-22:** Marketplace now lists saved local ComfyUI workflows, identifies
  the active workflow, and lets users activate one without leaving Marketplace.
  The workflow remains in the existing app profile storage and is ready to use
  in Image Studio. No remote workflow downloads were added.

- **2026-11-22:** One-shot mic dictation now prefers the installed local Whisper
  runtime, captures WebM in the renderer, limits recordings to five minutes and
  20 MB, and inserts the local transcript into the draft for review. WebM is
  accepted by the existing offline Whisper path. A live microphone acceptance
  run is still required; hands-free mode continues to require local browser
  speech recognition.

- **2026-11-22:** Packaged Windows smoke now exercises one-shot microphone
  dictation through start, stop, and local Whisper completion. It passed on this
  host while Chromium's separate on-device speech pack remained unavailable.
  This confirms the local Whisper route only; intelligible spoken-word quality,
  microphone permission denial/recovery, and hands-free acceptance remain open.

- **2026-11-22:** Marketplace model details now include a device-fit advisory
  based on the live local RAM/GPU capacity probe and catalog package size. It
  clearly reports when memory telemetry is missing, warns when package size is
  larger than current free RAM, and explains runtime/context overhead. It does
  not claim package size guarantees that a model will fit.

- **2026-11-23:** Local Ollama fit acceptance passed for two installed GGUF
  models on a 32 GiB Windows host. `lfm3-omni:2b-q4_K_M` (2.05 GB on disk)
  generated a five-token response; `qwen3:14b` (14.8B Q4_K_M, 9.28 GB on disk)
  generated a six-token response with thinking disabled. Qwen's measured loaded
  allocation was 9.66 GB; free RAM was 21.8 GiB before load and 13.2 GiB while
  loaded. Both models were unloaded after the check. This validates those RAM
  cases through Ollama, not GPU telemetry or the advisory across other hardware.

- **2026-11-22:** Marketplace search carries Hugging Face license metadata from
  the model card, falling back to the repository's license tag. When neither is
  present, the model inspector says that license metadata is unavailable and
  directs users to review the source repository before use. Full-weight results
  also retain published context length, including 1M-token values.

- **2026-11-22:** ModelScope GGUF downloads now resume from a checksum-keyed
  local partial file when the server supports byte ranges. The adapter checks
  the returned range, expected size, full SHA-256, and GGUF signature before
  upload; interrupted transfers preserve their partial for retry, invalid
  content is removed, and successful import cleans the resume cache. Ollama
  and LM Studio still own their respective upstream download and retry state.
  A cancellation check confirms ModelScope preserves only the downloaded local
  partial and does not upload the cancelled model.

- **2026-11-22:** Windows Coding Agent Job Object acceptance and the full native
  core suite pass when the sandbox stress group runs before longer test groups.
  The allocation control now respects the OS-clamped available memory cap; the
  suite continues to verify a 320 MiB allocation where capacity permits,
  256 MiB memory denial, filesystem/network isolation, timeout, and cancellation.

- **2026-11-23:** Focused Windows sandbox acceptance also verifies that drive
  roots, protected Windows/Program Files/ProgramData roots, and a system folder
  reached through a directory junction alias are rejected before command launch.
  Linux system-root and namespace acceptance remains covered by the Ubuntu
  24.04 WSL run below; cross-profile verification is still open.

- **2026-11-22:** Ubuntu 24.04 WSL sandbox acceptance passed Bubblewrap and
  cgroup checks for project-only filesystem writes, host-file isolation,
  disabled network, memory and process caps, timeout, and cancellation. Native
  Linux desktop/compositor acceptance remains open.

- **2026-11-22:** Conversation import is available from Chat → More. A native
  picker reads bounded UTF-8 JSON archives; users review the merge plan before
  applying it. Existing chats are never overwritten, conflicting IDs are
  reassigned, legacy project context is stripped, and repeated imports skip
  prior chats. A disposable Agent Host smoke verifies preview-without-writing,
  collision handling, project-context stripping, and idempotence.

- **2026-11-22:** Chat can attach `.xlsx` files up to 20 MB. The Agent Host
  reads bounded Open XML workbook, relationship, shared-string, and worksheet
  parts locally; it includes sheet names and cell references, never executes
  formulas, and returns at most the normal per-file text budget. CSV remains a
  plain local text attachment.

- **2026-11-23:** Packaged Windows smoke confirmed the bundled local PDF.js and
  Tesseract.js runtime rendered an image-only PDF and recovered its known English
  text without a hosted OCR route. OCR is limited to the first 20 pages and
  16,000 characters; resulting text is labeled OCR and untrusted. Page-level
  extraction now also preserves selectable text and OCRs only scanned pages in
  mixed PDFs. Other OCR languages remain unsupported.

- **2026-11-23:** Packaged Windows media smoke now stores a generated VP8 WebM
  through Skai's scoped local media bridge, decodes its metadata, and verifies
  four extracted frame attachments. Some generated clips report a near-zero
  duration, so H.264 MP4 currently provides the reliable timestamp-label check.
  WAV file transcription reaches local Whisper. The synthetic silent WAV
  verifies the processing path only; intelligible speech quality remains open
  under voice acceptance.

- **2026-11-22:** Linux Core credential tests now run against GNOME Keyring's
  real Secret Service in an isolated D-Bus session. Ubuntu 24.04/WSL2 passed
  missing lookup, save/read, per-connection and per-service isolation, removal,
  unsafe identifier checks, absent-bus fail-closed behavior, and sanitized
  recovery guidance for a simulated keyring command failure. The checks skip
  when `secret-tool` or an active D-Bus session is absent; native desktop
  unlock/restart, actual locked/corrupted keyring recovery, and macOS storage
  remain open. Windows `npm test` also passed.
- **2026-11-22:** Read-only checks against published 0.1.4 GitHub update feeds
  passed for Windows NSIS and Linux AppImage: both feed files advertise 0.1.4,
  carry SHA-512 and byte-size metadata, and reference assets returning HTTP 200
  with matching sizes. Installed-app update through GitHub and native Linux
  desktop acceptance remain open; see [release readiness](../operations/RELEASE_READINESS.md).

- **2026-11-22:** Extended the Persona live smoke with strict `--era-date`
  validation, era-filtered research before drafting, persisted era metadata,
  and a follow-up question beyond the selected date. Joe Rogan's 2010 run
  passed identity, research, drafting, and its first response. Three subsequent
  cutoff turns were inconclusive because Ollama closed the stream; living-era
  cutoff behavior remains open.

- **2026-11-23:** Isolated Qwen3 14B David Lynch runs completed research,
  nine-field drafting, initial chat, and a posthumous follow-up without an
  Ollama stream disconnect. The 2025 cutoff reply explicitly said it did not
  claim knowledge beyond the future boundary; the smoke checker now recognizes
  that wording, including curly-apostrophe contractions. A 2010-era run had a
  generic opening persona reply and still failed the quality bar, so broader
  era/persona acceptance remains open.

- **2026-11-22:** Name-only Persona research now accepts a confirmed first-name
  speaker label when a page also contains the full public-person name and clear
  transcript structure. The live Joe Rogan workflow passed with no supplied URLs:
  identity resolved, 13 sources, 59 attributed lines, and all nine profile fields
  drafted. The added alias path rejects prose-only mentions and transcripts that
  do not identify the full subject.
- **2026-11-22:** Persona chats and progressive research now filter dated evidence
  by the earlier knowledge/era cutoff; mixed-era syntheses and unsupported
  generated profile fields are withheld. Core regression coverage, Agent Host
  Release build, desktop typecheck/build pass. The live local-model workflow
  was intermittent: research and drafting passed, but one repeated chat returned
  an incomplete reply. Semantic cutoff fidelity still needs a multi-turn
  evaluation.
- **2026-11-22:** Linux Coding Agent commands now fail closed unless Bubblewrap
  provides process, network, IPC, and UTS isolation and a user systemd cgroup
  enforces process-tree memory/swap, process-count, and CPU limits. Ubuntu
  24.04/WSL2 acceptance verified the 256 MiB memory ceiling against a touched
  320 MiB allocation, the 128-process cap against 160 spawn attempts, project
  filesystem boundaries, network denial, timeout, and cancellation.
- **2026-11-22:** Repaired a race in packaged theme acceptance so gallery-theme
  saves are polled until `appearance.json` is valid. Packaged theme acceptance
  passed dark/light/system, alternate backdrops, 960×640 layout, Settings/Chat
  contrast, and custom-theme reload/recovery. One Settings screenshot was
  visually inspected; the broader live UI review remains open.
- **2026-11-22:** Corrected voice acceptance wording and its gate: the host probe
  measures native synthesis and a synthetic WAV container only; it no longer
  calls SAPI voices an installed recognition pack or claims to exercise
  microphone/cancellation behavior. Packaged Electron on this Windows host
  reports local `en-US` recognition unavailable, and Skai fails closed with a
  clear error instead of remote dictation.
- **2026-11-22:** The live Persona smoke now persists discovered birth/death
  dates and the effective cutoff into the saved card. On `qwen3:14b`, Joe Rogan
  passed research/draft/chat (3 sources, 59 attributed turns, 9 card fields),
  and David Lynch passed the same flow plus a multi-turn 2026 knowledge-boundary
  probe using the 2025-01-16 death cutoff (3 sources, 60 attributed turns, 9
  fields). Additional living/era profiles and model evaluations remain open.
- **2026-11-22:** Windows Coding Agent commands now use Windows Process Security
  Environment (PSEC) filesystem grants and a capability-free AppContainer. On
  the current Windows 11 host, native acceptance confirms nested project writes,
  neighboring host file read/write denial, loopback networking denial, no
  project ACL changes, Job Object memory limits, and command cancellation. PSEC
  or Job Object setup failure prevents command execution. Wider Windows-profile
  and Linux desktop-profile acceptance remain open.
- **2026-11-22:** Linux x64 0.1.4 AppImage and updater metadata built and validated
  in Ubuntu 24.04/WSL2. The staged Electron app and extracted AppImage passed the
  unprivileged Xvfb UI smoke. A local-feed 0.1.3 → 0.1.4 update smoke verified
  download, digest, installation, user-data retention, reopening, and in-app
  rollback to 0.1.3 with the profile marker retained. Native desktop and
  published-feed acceptance remain open. The runtime had no local en-US speech
  pack.
- **2026-11-22:** Approved commands now receive an explicit runtime environment
  allowlist instead of arbitrary application variables.
- **2026-11-22:** Windows memory-limit and explicit project-check evidence;
  persona research/drafting/chat workflow improvements.
- **2026-11-22:** Cross-layer refactor slices across the renderer, Electron,
  Agent Host, and Core. Follow-up candidates remain in the
  [refactor plan](implementation-plans/codebase-refactor.md).
- **2026-11-22:** Packaged image generation, editing, cancellation, history
  restoration, and missing-runtime/model recovery.
- **2026-11-22:** Unsigned Windows 0.1.3 → 0.1.4 install, upgrade, and uninstall
  lifecycle with user-data retention.

## New entry template

```markdown
### Outcome-oriented title

- **Status / owner:** In progress · Unclaimed
- **Next step:** One concrete action.
- **Approach and acceptance:** Constraints and observable completion evidence.
- **References:** Capability row, focused guide, or implementation plan.
```

Detailed notes from before this cleanup are preserved in the [2026-11-22 snapshot](../archive/planning/TO_DO_NEXT-2026-11-22.md).
