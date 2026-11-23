# Skai Desktop feature backtest

Updated: 2026-11-22

This is the living acceptance matrix for the feature backtest goal. “Pass” means
the current repository check or packaged smoke test produced evidence for the
listed workflow. “Conditional” means the workflow is implemented but needs a
machine, credential, model, or release runner that is not available in this
worktree.

## Passing coverage

| Area | Evidence |
| --- | --- |
| Native core, persistence, capacity policy, memory, queues, task artifacts, persona knowledge | `npm test` |
| Agent Host protocol, voice protocol, persona/group lifecycle, task scheduler, AirLLM status | `npm run smoke:agent-host` |
| Capacity-aware concurrency and cancellation | Agent Host smoke with measured slot limit and oversized cancellation fixture |
| Marketplace catalog and model results | `npm run smoke:marketplace-host` |
| Project browser, terminal, editor, reviewed undo | `smoke-project-browser`, `smoke-project-terminal`, `smoke-project-editor` |
| Coding Agent command isolation | Windows Core acceptance proves project-only writes, denied neighboring host-file reads/writes, denied loopback networking, process-count and memory limits, timeout/cancellation, and fail-closed policy for unsupported OSes. Ubuntu 24.04/WSL2 acceptance for Bubblewrap and systemd cgroup limits is documented in [To Do Next](../../planning/TO_DO_NEXT.md); native Linux desktop and broader OS profile coverage remain open. |
| Chat queue, conversation search, metadata, fork/export/archive | `smoke-chat-queue`, `smoke-conversation-search`, `smoke-conversation-metadata` |
| Memory workflows | `smoke-memory` |
| PDF attachment policy | `smoke-pdf-attachment` |
| Local voice engines | Kokoro and Piper generated valid WAV audio through Skai's Agent Host; Whisper large-v3 transcribed a Piper-generated local audio fixture. |
| Installed AirLLM sidecar preflight | `npm run smoke:airllm` |
| Packaged Electron routes, Marketplace, Percy, video sampling, local audio transcription, and unavailable-language dictation behavior | `smoke:electron:artifact` |
| Accessibility | 14 routes, 0 WCAG violations in `smoke:electron:accessibility` |
| Responsive overflow | 11 routes × 5 viewport widths |
| UI matrix | 17 routes × 5 sizes × 4 theme/sidebar variants |
| Published update feeds | `npm run smoke:published-update-feed -- --version 0.1.4` validates both public metadata files, SHA-512 values, and referenced installer/AppImage HTTP status and byte sizes. `npm run smoke:linux:update-feed:published` additionally downloaded, verified, installed, and reopened the actual published 0.1.4 AppImage from an isolated synthetic 0.1.3 baseline and retained a disposable profile marker. The published 0.1.4 updater predates in-app rollback. |
| Themes and live reload | `smoke:electron:themes` |
| Pets, Linux windowing, update policy, bridge/runtime/tray/local-only audits | Corresponding `test:*` and `audit:*` scripts |
| Repository hygiene and release configuration | `check:hygiene`, `check:release-config`, `audit:future-features` |
| Windows 0.1.4 unsigned installer packaging and update metadata | `SKAI_ALLOW_UNSIGNED_INSTALLER=true node scripts/package-windows-installer.cjs` — NSIS artifact and `latest.yml` verified locally |
| Windows 0.1.3 → 0.1.4 installer lifecycle | Built the prior installer from the actual `v0.1.3` source tag in an isolated worktree. Both unsigned installers passed packaged app smoke; upgrade preserved a user-data marker; uninstall removed app files and retained user data. All installer/uninstaller signatures reported `NotSigned`. |
| Windows in-app updater feed/install | The actual 0.1.4 installer and `latest.yml` were served from an isolated loopback feed. A synthetic 0.1.3 package built from current updater-enabled code checked the feed, downloaded and SHA-512-verified the installer, ran the in-app install action, exited, upgraded to 0.1.4, retained a profile marker, and uninstalled with application files removed. Unsigned local test only; installed-app update through the published feed, rollback, and signing remain unverified. |
| Linux AppImage in-app updater feed/install/rollback | In Ubuntu 24.04/WSL2, the isolated loopback feed smoke validates update/install/reopen/rollback with the current source build. A separate published-feed run fetched and verified the real 0.1.4 AppImage, installed it from a synthetic 0.1.3 baseline, reopened 0.1.4, and retained the disposable profile marker. The public 0.1.4 updater predates rollback support; native Linux desktop acceptance remains open. |
| Real local Diffusers image generation and editing | Installed SD-Turbo runtime returned valid 512×512 CPU JPEGs for text-to-image (4/4 scheduler steps) and image-to-image with a 512×512 local PNG source (2/2 effective scheduler steps). The edit source was a disposable fixture. |
| Diffusers progress accuracy | Worker progress now uses Diffusers' actual effective timestep count; a real text run reported 1/4 through 4/4 and an edit run 1/2 through 2/2. Agent Host forwards step progress and cancellation to the image operation. |

## Conditional or incomplete coverage

| Area | Current evidence and next validation |
| --- | --- |
| AirLLM inference | AirLLM and Torch import successfully from `%LOCALAPPDATA%\\Skai\\AirLLM\\venv`; the worker’s CUDA preflight and malformed-input paths return structured errors. A real model run still requires an NVIDIA GPU and CUDA-capable PyTorch, plus a compatible Hugging Face model and enough disk/RAM/VRAM. |
| Microphone dictation and hands-free voice mode | Packaged Electron reports the `en-US` on-device speech pack unavailable and refuses remote recognition. Install the OS speech capability with elevation, then verify real microphone capture, one-shot dictation, live hands-free turns, cancellation, and device-error recovery. |
| Packaged Marketplace workflow | `smoke:electron:artifact` passes Models search/review and explicitly verifies Tools → Installed inventory in the packaged app. |
| Persona model quality | The David Lynch smoke passed identity, death-date, research, attributed-turn, draft, and chat checks with Qwen3 14B (3 sources, 60 attributed turns, 8 drafted fields). Existing one-subject Sam Hyde coverage also passes. These checks do not establish semantic fidelity or cutoff truthfulness across multiple turns and subjects. |
| Cloud voice playback | ElevenLabs adapter validation and failure paths are covered; an end-to-end successful request requires a user-provided API key and voice ID. |
| Release signing and lifecycle | Release audit and metadata checks pass. Local unsigned Windows install/upgrade/uninstall and loopback-feed updater acceptance pass; Linux local-feed update/install/reopen/rollback and published-feed update/install/reopen pass under WSL2. Production signing is deferred by the owner; signed updater metadata and native Linux acceptance remain open. |
| WebM video sampling | H.264 MP4 sampling passes. The smoke harness's data-URL WebM probe is rejected by Chromium's URL safety policy on this host, so the run reports this and leaves actual packaged WebM decoding unverified. |
| Diffusers GPU and ComfyUI acceptance | The packaged CPU path passes live cancellation, text-to-image, image-to-image, and history restoration after reload. This host has an AMD RX 7900 XTX, but the installed worker used CPU; GPU acceleration and a live ComfyUI server remain unverified. |
| Published `electron-updater` channel and rollback/recovery | The published Linux 0.1.4 feed successfully updated and reopened the released AppImage in an isolated WSL2 profile. The release updater predates rollback; current-source Linux rollback passes only in the loopback acceptance. Published Windows in-app update and native Linux desktop acceptance remain open. |

## Test-harness notes

The scheduler smoke originally assumed one slot and serial execution. Capacity
is now measured dynamically, and the cancellation fixture uses an oversized
model estimate to deterministically exercise the single-slot path. Tasks also
inherit the saved provider when no task-specific provider is supplied, keeping
AirLLM-aware admission consistent with `system.capacity`.

The update-metadata verifier resolves `js-yaml` from the desktop dependency
tree, matching the repository's install layout and allowing the local Windows
installer packaging check to run after `npm --prefix apps/desktop install`.
