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

## Active work

| Work | Status / owner | Next step | Agreed approach and acceptance | Detail |
| --- | --- | --- | --- | --- |
| Professional UI pass | In progress · Codex | Manually review the running app and close the visual, keyboard, and pet-animation gaps. | Improve one page at a time; preserve working actions and truthful states. Accept only after live review across supported widths and themes. | [UI progress](SKAI_PREMIUM_UI_PROGRESS.md), [references](UI_REFERENCE_GUIDE.md) |
| Local voice acceptance | Blocked · Unclaimed | Install or enable a local `en-US` recognition pack, then verify spoken dictation and a hands-free turn with a real microphone. | Keep processing local; cover speech accuracy, cancellation, and unavailable-language recovery. SAPI synthesis voices are installed, but packaged Electron currently reports local `en-US` recognition as unavailable and Skai correctly disables dictation without remote fallback. | [Voice architecture](../engineering/ELECTRON_CSHARP_VOICE_ARCHITECTURE.md), [capability matrix](CAPABILITY_MATRIX.md) |
| Coding Agent isolation | In progress · Codex | Verify cgroup controls on supported Linux desktop profiles and Windows PSEC on additional Windows profiles. | Linux approved commands require Bubblewrap and a user systemd cgroup scope with memory, swap, process-count, and CPU limits; setup fails closed. Ubuntu 24.04/WSL2 acceptance proves those limits, project-only writes, denied sibling access/network, timeout, and cancellation. Windows PSEC and Job Object acceptance passes on this Windows 11 host. Commands now refuse to run on macOS or any platform without a supported OS sandbox; no unattended or parallel commands before broader acceptance. | [Architecture](../engineering/ARCHITECTURE.md), [readiness gaps](../operations/PRODUCTION_READINESS_GAPS.md) |
| Image runtime coverage | In progress · Unclaimed | Exercise a live ComfyUI server and validate GPU or additional hardware. | Show only runtime-reported progress; cancellation must stop the job and leave the page usable. | [Image guide](../guides/LOCAL_IMAGE_GENERATION.md), [capability matrix](CAPABILITY_MATRIX.md) |
| Release validation | In progress · Unclaimed | Exercise an installed app updating through the published feed and complete native Linux desktop updater acceptance. | Headless Ubuntu 24.04/WSL2 acceptance covers AppImage update and in-app rollback from synthetic 0.1.3 to 0.1.4 and back, preserving user data. Published 0.1.4 Windows/Linux feed metadata and referenced asset sizes now verify over HTTPS; an installed app has not updated through GitHub. Signed metadata/signing are deferred by the owner, and native Linux desktop acceptance remains open. | [Release readiness](../operations/RELEASE_READINESS.md), [release guide](../operations/RELEASING.md) |
| Persona research and chat | In progress · Unclaimed | Resolve the local-model stream disconnect in the second turn of living-person era acceptance, then broaden multi-turn cutoff checks across persona types. | Dated source filtering applies the earlier knowledge/era cutoff to chat, quotes, voice evidence, and research synthesis. The live smoke now supports `--era-date`, filters research before drafting, and persists the date. The Joe Rogan 2010 run passed identity, research, card drafting, and its first reply, but Ollama closed all three cutoff follow-up streams without a response; do not count this as cutoff acceptance. | [Smart Personas plan](implementation-plans/smart-personas.md), [capability matrix](CAPABILITY_MATRIX.md) |
| Local, cloud, and hybrid gateway | In progress · Codex | Verify a native Linux desktop unlock/restart cycle and implement the macOS credential adapter before starting a cloud chat provider. | Require explicit routing, OS-protected secrets, clear data-destination disclosure, and a working offline-only mode. No silent fallback. Windows DPAPI and Linux GNOME Keyring round-trip/isolation are verified; absent-bus fail-closed and sanitized error guidance are covered. Actual locked/corrupted keyring recovery and macOS storage remain open. | [Provider gateway plan](implementation-plans/provider-gateway.md) |

## Recently completed

Current behavior and acceptance limits belong in the capability matrix and
feature backtest. The detailed 2026-11-22 queue snapshot preserves prior notes.

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
