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

1. **UI and accessibility acceptance — In progress · Codex.** Manually review
   the 17-route matrix, keyboard/focus behavior, assistive technology, narrow
   layouts, and pet animations. Record screenshots and gaps in
   [UI progress](SKAI_PREMIUM_UI_PROGRESS.md).
2. **Real microphone voice — In progress · Codex.** Exercise the new local
   Whisper microphone path with a real device; verify draft insertion,
   cancellation, permissions, and recovery, then test hands-free on a local
   speech pack. Keep the path local. See the
   [voice architecture](../engineering/ELECTRON_CSHARP_VOICE_ARCHITECTURE.md).
3. **Cross-profile Coding Agent sandbox — In progress · Codex.** Verify Windows
   PSEC and Linux Bubblewrap/cgroup behavior on more supported profiles. Keep
   failing closed where sandbox setup is unavailable; no macOS command path
   without a sandbox. See [architecture](../engineering/ARCHITECTURE.md).
4. **Persona era acceptance — In progress · Unclaimed.** Resolve the Ollama
   stream disconnect during follow-up turns, then test date cutoffs across
   living and deceased personas and multiple model runs. See the
   [Smart Personas plan](implementation-plans/smart-personas.md).
5. **Image runtime coverage — In progress · Unclaimed.** Exercise a live
   ComfyUI server and GPU/additional hardware; verify truthful progress,
   cancellation, and recovery. See the
   [image guide](../guides/LOCAL_IMAGE_GENERATION.md).
6. **Windows update acceptance — In progress · Unclaimed.** Update an installed
   app through the published feed; validate rollback on a release built with
   current updater support. Preserve user data.
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
10. **GitHub workflow acceptance — Next · Unclaimed.** Exercise empty/denied
    permissions, network failure, clone conflicts, cancellation, and retry in
    isolated profiles with real credentials.

## Next up

11. **Requested voice engines.** Complete install/use/stop/error acceptance for
    requested local engines such as Chatterbox, Qwen3-TTS, OmniVoice, and Higgs
    Audio; keep credentialed hosted services clearly separated from local
    catalog entries.
12. **User-controlled provider gateway.** Add explicit local/cloud/hybrid chat
    routing only after OS-protected credentials, data disclosure, and an
    offline-only mode are verified. No silent provider fallback.
13. **MCP lifecycle.** Finish server setup, permission review/revocation,
    health reporting, and recovery for supported stdio/HTTP servers.
14. **Model fit and license guidance — In progress · Codex.** The model
    inspector now compares package size against current free RAM, reports GPU
    memory when telemetry exists, and labels the result as advisory. Hugging
    Face results now surface license metadata from the model card or license
    tag, and clearly prompt source review when neither is published. Remaining:
    validate fit against real models and runtimes.
15. **Resumable model installs — In progress · Codex.** The Skai-managed
    ModelScope GGUF installer now persists checksum-keyed partial shards,
    resumes with HTTP Range, validates the complete size/hash/signature, and
    removes its cache only after successful Ollama import. Remaining:
    acceptance of cancellation and retries, plus retry behavior delegated to
    Ollama/LM Studio.
16. **Legacy conversation import.** Add preview, cancel-without-writing,
    duplicate protection, restart recovery, and preservation of edited chats.
17. **Scanned documents and data files.** Add local OCR for scanned PDFs and
    capability-aware handling for spreadsheets and other unsupported content.
18. **Packaged media coverage.** Verify real WebM and audio fixtures in the
    packaged app; make format and model capability errors clear.
19. **Context and run capacity.** Verify actual 1M-token execution with a
    compatible model; improve runtime-aware estimates and safe concurrency.
20. **Production update trust.** Add signed update metadata and prepare trusted
    installer signing/clean-machine validation. Code-signing certificates were
    previously deferred; do not publish unsigned testing builds as production.

## Recently completed

Current behavior and acceptance limits belong in the capability matrix and
feature backtest. The detailed 2026-11-22 queue snapshot preserves prior notes.

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

- **2026-11-22:** Marketplace model details now include a device-fit advisory
  based on the live local RAM/GPU capacity probe and catalog package size. It
  clearly reports when memory telemetry is missing, warns when package size is
  larger than current free RAM, and explains runtime/context overhead. It does
  not claim package size guarantees that a model will fit.

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

- **2026-11-22:** Windows Coding Agent Job Object acceptance and the full native
  core suite pass when the sandbox stress group runs before longer test groups.
  The allocation control now respects the OS-clamped available memory cap; the
  suite continues to verify a 320 MiB allocation where capacity permits,
  256 MiB memory denial, filesystem/network isolation, timeout, and cancellation.

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
