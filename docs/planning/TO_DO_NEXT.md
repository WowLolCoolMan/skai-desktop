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

1. **UI and accessibility acceptance — In progress · Codex.** The freshly
   packaged audit passes all 14 routes with zero WCAG violations or incomplete
   checks; skip-link/main-landmark and popup relationships pass. The 17-route
   layout matrix passes five window sizes and four theme/sidebar variants with
   no runtime or layout failures. Packaged theme/contrast acceptance passes
   dark, light, system, custom-theme reload/recovery, and narrow-layout states;
   overflow acceptance passes 11 routes at five widths. Remaining work is
   manual visual review of routes and pet animations, full keyboard/focus
   review, and assistive technology checks. Packaged checks cannot validate
   spoken screen-reader output or user-perceived quality across routes. Owner:
   User. Next action: run Narrator or NVDA, review the remaining themes/routes,
   and report failures. Record screenshots and gaps in
   [UI progress](SKAI_PREMIUM_UI_PROGRESS.md).
2. **Real microphone voice — In progress · Codex.** Packaged Windows smoke
   feeds a deterministic spoken fixture through Chromium microphone capture,
   records/stops it, and verifies installed local Whisper creates a transcript
   attachment matching the expected phrase without logging transcript text.
   Kokoro, Piper, and Windows SAPI synthesis probes pass; they confirm audio
   output, not subjective quality. Chromium's native offline `en-US`
   recognition remains unavailable. Hands-free Voice Mode now uses local
   Whisper with pause-segmented microphone turns, reports live mic activity,
   stops capture while the model speaks, and cancels transcription when ended.
   Packaged acceptance now confirms a spoken fixture is transcribed and
   submitted through Voice Mode with a measurable input signal, and that End
   closes the session cleanly. A second packaged turn confirms End closes the
   session during Whisper transcription and no late chat turn appears during
   the following 10-second observation window. This checks renderer behavior;
   the Whisper adapter smoke separately verifies process cancellation.
   Packaged acceptance now also verifies the denied-permission message and a
   successful retry. The local Whisper adapter smoke confirms an active Python
   transcription is terminated by the cancel request and returns no transcript.
   During spoken replies, Voice Mode now monitors the local mic, cuts off
   playback after sustained user speech, retains a short pre-roll to capture
   the utterance onset, then records/transcribes that turn. Packaged Windows
   acceptance now uses a loopback model stub and separate speech fixtures to
   verify a long spoken reply, microphone monitoring during playback, sustained
   speech interruption, Whisper transcription of the interruption, and delivery
   of the follow-up to the model. Focused voice-activity, typecheck, and build
   checks pass. Streamed voice remains open. Keep the path local.
   See the
   [voice architecture](../engineering/ELECTRON_CSHARP_VOICE_ARCHITECTURE.md).
3. **Cross-profile Coding Agent sandbox — Done · Codex.** Windows PSEC and
   Ubuntu 24.04 WSL acceptance pass filesystem, network, process, memory,
   timeout, and cancellation checks. Unsupported macOS execution remains
   fail-closed by design. See [architecture](../engineering/ARCHITECTURE.md).
4. **Persona era acceptance — In progress · Codex.** Added an explicit prompt
   rule treating post-cutoff events as unknown even when they are already public.
   Native core acceptance passes, and a live David Lynch 2010-era multi-turn
   smoke passes on Qwen3 14B. The same case fails on LFM3 Omni 2B (weak identity
   and cutoff behavior). Product decision blocker: define the minimum supported
   local model tier for persona mode. Owner: User. Next action: confirm whether
   persona acceptance targets 14B-class models or must also pass on 2B-class
   models; Codex will add model gating or continue low-tier tuning accordingly.
   See the [Smart Personas plan](implementation-plans/smart-personas.md).
5. **Image runtime coverage — In progress · Codex.** Packaged Diffusers CPU
   acceptance passes. On 2026-11-23, live ComfyUI acceptance on this PC passed
   checkpoint discovery, workflow submission, progress polling, cancellation
   with an empty queue afterward, image-to-image source upload, edited PNG
    retrieval, and payload validation using `Juggernaut-XL_v9.safetensors` on
    the RX 7900 XTX. On 2026-11-23, Windows GPU Engine counters matched the
    ComfyUI Python process and measured compute-engine utilization peaking at
    86.89% during live generation, with copy-engine activity also observed.
    The same run passed cancellation with an empty queue and returned edited
    PNG `skai-live-acceptance_00007_.png` (356,943 bytes). ComfyUI reports
    PyTorch ROCm 10.1.0 and the AMD Radeon RX 7900 XTX with 25.75 GiB VRAM.
    Remaining: validate GPU/offload behavior on more hardware. Repeat with
    `npm run smoke:image:comfy-live`. See the
   [image guide](../guides/LOCAL_IMAGE_GENERATION.md).
6. **Windows update acceptance — Blocked on release · Owner: User / release
   owner.** The current-source loopback install passed. Read-only checks now
   confirm both public v0.1.4 feeds, SHA-512 metadata, and asset sizes, but that
   release predates rollback support. Next action: publish an approved release
   built with current updater and rollback code, then run isolated published-feed
   install and rollback acceptance.
7. **Native Linux release acceptance — Blocked on platform · Owner: User.** WSL
   and Xvfb evidence does not cover a native Linux desktop. Next action: provide
   a supported Linux desktop or VM where Codex can exercise AppImage install,
   updater, rollback, and window behavior. See
   [release readiness](../operations/RELEASE_READINESS.md).
8. **Credential-store recovery — Blocked on platform sessions · Owner: User.**
   Windows tests pass; WSL exposes D-Bus and `secret-tool` but has no running
   GNOME keyring daemon, and no macOS host is available to exercise Keychain.
   Next action: provide native Linux with an unlockable/lockable Secret Service
   and a macOS runner/device so the adapters and recovery flow can be verified
   before hosted chat routes.
9. **Marketplace end-to-end support — In progress · Codex.** Give every
   advertised entry a verified local install/setup, launch/use, and removal
   path; expose license/runtime requirements and never leave an entry looking
   usable when its adapter is missing. `npm run smoke:marketplace-host` passes:
   all 90 listings are accounted for, the 42 backed entries map to real local
   adapters, and the other 48 expose no install action. The curated
   `qwen3-coder:30b-a3b-q4_K_M` Ollama route now has update and removal actions
   in Installed; its install/remove contract smoke passes against a disposable
   loopback runtime and rejects hosted removal. Added the official
   [`qwen2.5:0.5b` model](https://ollama.com/library/qwen2.5%3A0.5b)
   (398 MB, Apache-2.0) as a low-footprint local option.
   `npm run smoke:marketplace-real-ollama` passed a real install, `chat.complete`
   inference, Marketplace removal, and post-removal inventory check against a
   temporary Ollama server and model directory; the normal user Ollama model
   inventory was unchanged afterward. `npm run smoke:rea-mcp` now installs
   pinned `rea-agents@6.7.0` into a disposable npm cache, connects through the
   Skai Agent Host, validates its 207-tool manifest, invokes one explicitly
   read-only tool, revokes the process, and confirms the revoked connection is
   unusable. REA data and npm cache are isolated from the normal user profile.
   Remaining: verify the other MCP and voice adapters against their documented
   license/runtime requirements.
   Saved ComfyUI workflows can be reviewed and activated inside Marketplace.
10. **GitHub workflow acceptance — Blocked on test account · Owner: User.** Core
    tests cover permission denial, network failure, request cancellation,
    pending/slow-down retry, stale branch/conflict detection, and protected-token
    persistence. Next action: provide an isolated test repository and scoped test
    credential/device authorization for live consent-denial, access, clone
    conflict, cancellation, and retry acceptance; no production repository will
    be used as the fixture.

## Next up

11. **Requested voice engines.** Marketplace now has verified install/use
    paths for Kokoro, Piper, Chatterbox Nano, and Pocket TTS; Whisper large-v3
    covers local transcription.
    User-provided working-pipeline reference: isolated Python 3.12.15 (~21 MB),
    speech packages (~319.5 MB), Whisper base.en (~140.9 MB), Kyutai Pocket TTS
    English (~208.9 MB), and the `alba` voice (~5.9 MB), each with its role and
    local footprint visible. Use it as the acceptance shape for a coherent
    voice setup and use flow; it does not by itself establish Skai compatibility.
    The Marketplace voice inspector now shows the verified pipeline roles for
    Whisper, Kokoro, Piper, Chatterbox, and Pocket TTS (private runtime, recognition or
    synthesis component, and local output/playback) beside each install action.
    The catalog smoke checks those role markers, while
    `npm run smoke:voice:acceptance` passes local Kokoro and Piper WAV
    container/non-silent signal checks. These are runtime and signal checks,
    not subjective speech-quality or live microphone acceptance.
    On 2026-11-23, `node scripts/smoke-pocket-tts.cjs` passed a clean isolated
    Marketplace install on Windows x64: it downloaded and hash-checked the
    runtime, warmed both standard and low-resource models, stopped an
    in-flight generation, and produced a fresh 113,324-byte local WAV. The
    first clean run exposed a Windows runtime failure when Hugging Face cache
    paths contained spaces; Skai now gives the runtime the cache's 8.3 path
    while retaining the normal storage location. The smoke terminates the
    Agent Host process tree and removes its isolated profile after success.
    A new `npm run smoke:voice:piper` acceptance now does the same for Piper:
    it installs into a disposable `SKAI_VOICE_ROOT`, verifies Marketplace
    readiness, synthesizes a nonempty WAV through the Agent Host, and removes
    the temporary profile after success. The Piper child process explicitly
    receives closed stdin so it cannot inherit and wait on the Agent Host's
    protocol pipe. The shared voice Stop action now kills active Piper
    synthesis, and the clean smoke interrupts a long utterance then verifies a
    later utterance succeeds. Focused `--voice-models` tests cover the
    isolated root and reject unregistered runtime directories.
    `npm run smoke:voice:kokoro` also installs the pinned Kokoro runtime and
    model files into a disposable root, verifies Marketplace readiness, and
    synthesizes a valid WAV through the Agent Host. Its subprocess closes
    inherited stdin to prevent protocol-pipe stalls.
    Cross-device speech quality and clean installs on other operating systems
    remain unverified.
    The isolated Voice Workbench UI smoke now builds its renderer before
    launching Electron, avoiding false failures against a stale `dist` tree.
    Its browser acceptance passes duplicate-name clip storage, local preview,
    IndexedDB reload, and individual removal. These synthetic fixtures do not
    exercise voice cloning or train a voice model.
    42 of 90 curated entries now have real adapters, and the catalog smoke
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
    are not a subjective speech-quality rating. Qwen3-TTS 0.6B CustomVoice now
    has an isolated CPU feasibility result on Windows: a clean Python 3.12
    environment installed `qwen-tts==0.1.1` with CPU-only PyTorch, loaded the
    English Ryan voice, and generated a valid 24 kHz WAV. Cold model load took
    56.8 seconds; load plus a short utterance took 75.5 seconds. The runtime
    emitted a missing SoX warning but synthesis still succeeded. This does not
    establish a real-time experience, voice cloning, interruption, streaming
    playback, or Skai integration; the test used the upstream Python API
    directly and the isolated dependency environment is substantially larger
    than Skai's existing voice adapters. Keep Qwen3-TTS out of the
    installable/ready catalog until a pinned, isolated installer and resident
    Skai adapter pass local install, synthesis, cancellation, cleanup, and
    resource acceptance. The upstream recommends an isolated Python 3.12
    environment and documents multiple model variants ([upstream setup](https://github.com/QwenLM/Qwen3-TTS#quickstart),
    [0.6B Base model card](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base));
    verify each variant's license and capabilities separately before listing
    cloning or other features.
    Keep credentialed hosted services clearly separated from local catalog
    entries.
12. **User-controlled provider gateway.** Add explicit local/cloud/hybrid chat
    routing only after OS-protected credentials, data disclosure, and an
    offline-only mode are verified. No silent provider fallback.
13. **MCP lifecycle — In progress · Codex.** Local-only smoke verifies hosted
    endpoint rejection, read-only Filesystem MCP, Playwright stdio, local
    PostgreSQL, approved tool calls, health, and revocation. It now reconnects
    Filesystem MCP after revocation with a fresh immutable connection ID,
   rechecks its read-only tool set, and performs another approved read. The
   smoke also exercises loopback Streamable HTTP session negotiation, protocol
   header continuity, approved reads, denied writes, revocation, and fresh
   session recovery. Figma and Supabase entries now state their exact local
   setup prerequisites and loopback routes; their live desktop/CLI servers
   were unavailable on the acceptance machine. Remaining: verify live setup,
   use, and revoke for those services when available, then cover additional
   curated MCP server adapters.
14. **Model fit and license guidance — In progress · Codex.** The model
    inspector now compares package size against current free RAM, reports GPU
    memory when telemetry exists, and labels the result as advisory. Hugging
    Face results now surface license metadata from the model card or license
    tag, and clearly prompt source review when neither is published. On
    2026-11-23, the focused Model Library suite passed license parsing and
    explicitly confirms that missing publisher metadata stays unknown; it also
    covers runtime inventories, exact model labels, bounded search/install,
    and resumable ModelScope downloads. The 32 GiB Windows host has two local
    model response samples in the feature backtest. Remaining: validate fit
    estimates across more hardware and compare GPU/offload behavior; this
    Windows host has no supported NVIDIA memory telemetry.
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

- **2026-11-23:** Voice Workbench now enumerates clips from local IndexedDB,
  assigns unique IDs so duplicate filenames do not overwrite one another,
  previews audio in place, and removes individual clips. Limits are 48 clips
  per profile, 12 per add, and 50 MB per clip. Typecheck and production renderer
  build pass. This does not implement reference-voice cloning or rebuilding.

- **2026-11-23:** Local audio cancellation now carries an operation ID from the
  composer through the Electron bridge to the Agent Host. Whisper kills the
  active Python process tree, removes its temporary audio, and returns a
  cancellation result; a bounded registry handles cancel-before-start races.
  `node scripts/smoke-whisper-adapter.cjs` verified a live transcription was
  running when canceled and returned no transcript. Agent Host build, desktop
  typecheck, bridge-method/local-only audits, and packaged Windows microphone
  smoke passed. This closes turn-based audio transcription cancellation only;
  real-time voice mode is still incomplete.

- **2026-11-23:** Packaged Windows voice smoke now forces a microphone
  `NotAllowedError`, verifies Skai's permission guidance, restores local capture,
  and confirms a successful retry. The subsequent System.Speech fixture reached
  local Whisper and produced one matching transcript attachment. Packaged
  hands-free acceptance verifies local Whisper submission and clean session
  cancellation; barge-in coverage is tracked separately.

- **2026-11-23:** Hands-free Voice Mode now supports acoustic barge-in during
  reply playback. It requires 180 ms of sustained microphone activity, discards
  assistant-playback audio while retaining the most recent 250 ms recording
  segment as pre-roll, stops speech, and starts a fresh local Whisper turn.
  Playback monitoring skips adaptive noise calibration so speech beginning
  immediately is not learned as background noise. Pending interruption
  transcripts wait for an in-flight response to settle before submission.
  Focused unit, typecheck, renderer build, and general packaged Electron smoke
  pass; packaged barge-in and streamed-response acceptance remain open.

- **2026-11-23:** Marketplace → Installed now exposes update and removal for
  Ollama models, with host requests pinned to the discovered local endpoint.
  `npm run smoke:marketplace-host` verified the exact curated Qwen3 Coder tag
  reaches Ollama pull/delete APIs on a disposable loopback server and that a
  hosted delete is rejected. This accepts the UI-to-runtime contract; a real
  model download/use/remove remains open under item 9.

- **2026-11-23:** Marketplace voice entries now disclose their local pipeline
  stages before install: isolated runtime, recognition or synthesis package,
  model/voice data, and local output. The supported Kokoro, Piper, Chatterbox,
  and Whisper entries retain their existing pinned installers. Marketplace
  host smoke validates the four role descriptions; the voice acceptance probe
  passes Kokoro and Piper WAV signal checks on this host. Microphone accuracy,
  hands-free speech-pack availability, and subjective voice quality remain
  external/device acceptance work under items 1, 2, and 11.

- **2026-11-23:** The local Coding Agent now accepts native Ollama tool calls or
  one bounded JSON action per turn. The isolated Agent Host smoke verifies the
  native tool schema, fenced-action completion, successful recovery from one
  malformed JSON action, failure after exactly three repair attempts, terminal
  failure when the model is unavailable, one-slot queued execution, and
  cancellation before dispatch. The full plan/verify/iterate/human-pause workflow
  remains open; see the AI planning mode entry in
  [Future Features](FUTURE_FEATURES.md).

- **2026-11-23:** Re-ran the focused Coding Agent sandbox acceptance on native
  Windows 11 and Ubuntu 24.04 under WSL. Windows passed PSEC/AppContainer
  project-only filesystem access, denied neighboring-file reads/writes and
  loopback networking, bounded process/memory use, timeout, and cancellation.
  Ubuntu WSL passed Bubblewrap/cgroup project filesystem isolation, network
  denial, 256 MiB memory and 128-process limits, timeout, and cancellation.
  Native Linux desktop and additional Windows profiles remain open.

- **2026-11-23:** Added a clean isolated Piper Marketplace installation and
  Agent Host speech acceptance. On Windows x64, Piper 1.5.0 and its pinned
  English voice installed in a disposable root, appeared available in the
  catalog, and synthesized a valid 97,324-byte WAV after cancellation. Fixed
  stdin inheritance that caused the Agent Host synthesis subprocess to stall.
  A follow-up acceptance interrupts a long Piper utterance through Stop and
  confirms a subsequent utterance succeeds. Focused voice root tests and
  `node --check` for the smoke script pass.

- **2026-11-23:** Added clean isolated Kokoro Marketplace installation and
  speech acceptance. The disposable Windows profile installed the pinned
  runtime and verified model files, showed Kokoro as available in Marketplace,
  and synthesized a valid 118,924-byte WAV through the Agent Host. Closed
  stdin for Kokoro subprocesses to avoid inheriting the Agent Host protocol
  pipe; its smoke script removes the disposable profile after success.

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
  The packaged theme contrast sweep is still required for visible text and
  themed native select options; gradients remain a manual visual check.

- **2026-11-23:** Packaged accessibility audit inspected 14 routes and found
  zero automated WCAG violations, zero serious/critical findings, a working
  skip link, and a working main landmark. Its remaining incomplete checks are
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
