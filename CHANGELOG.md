# Changelog

## [Unreleased]

### Added

- Added a Marketplace installer and local synthesis adapter for Chatterbox Nano
  using a pinned CPU runtime and checksum-verified model files. End-to-end
  installation and non-silent local WAV synthesis passed on Windows; warm
  throughput was near real time, cold model loading took about 24 seconds, and
  spoken-word quality is not yet reviewed.

### Fixed

- Selected NumPy 2 for Chatterbox installs on Python 3.13, matching upstream's
  dependency requirements, and made Marketplace recover when installed model
  files are missing.

## [0.1.4] - 2026-11-16

### Added

- Added a branded per-user Windows NSIS installer with a data-preserving upgrade
  path and an automated clean install, 0.1.3-to-0.1.4 upgrade, and uninstall
  lifecycle smoke.
- Added local MP4 and WebM chat input that samples four timestamped frames into
  JPEG attachments, with bounded size and duration, private temporary storage,
  and packaged Electron smoke coverage for WebM and H.264 MP4.
- Added local audio-file transcription for MP3, M4A, OGG, and WAV into the chat
  draft using an on-device speech track; packaged smoke verifies the fail-closed
  path when the runtime speech pack is unavailable.
- Added hands-free local voice turns that submit final on-device dictation and
  speak each reply and wait for local speech to finish before listening again,
  without changing the regular voice-output preference.
- Added per-turn documents-only chat grounding for currently attached files, with
  project, memory, and skill context excluded from those requests.
- Added local-model semantic summaries for oversized chat histories, with a
  deterministic fallback and explicit untrusted-summary handling.
- Added a responsive GitHub Pages project site, automated Pages deployment, and
  a curated documentation index.
- Added checkpoint discovery and built-in ComfyUI text-to-image and image-edit
  workflow templates to the Images workspace.
- Added an optional managed Diffusers environment and local Stable Diffusion
  Turbo worker, with runtime setup from the Images page and bounded JPEG results.
- Overhauled built-in pet sprites into eleven-cell looping strips with a stable
  rest-pose seam, per-pet blink duration controls, and seven inspectable built-in
  companions in Pet Workshop.
- Added per-pet idle and wandering actions plus Blaze's cursor-aware approach,
  pounce, fire-breath, and impact scene using separate large transparent effects.
- Added a guided Pet Workshop concept-generation flow for the local Diffusers
  runtime and ComfyUI, with explicit review before creating a companion draft.
- Hardened Agent Host writes against a closed Electron stdin pipe and made
  concurrent legacy-data migration tolerate another app instance winning the
  first-run file creation race.

- Added a pinned Electron installer toolchain and a patched minimatch override
  for a zero-vulnerability desktop dependency audit.

### Updated

- Refreshed capability and release-readiness docs to reflect the local-only
  model boundary, Monaco project editor, and current image workflow support.
- Synced the capability matrix, project site, voice architecture notes, and
  release docs with hands-free chat behavior and the Pages setup blocker.
- Updated image-generation docs to describe the implemented Diffusers runtime
  and clearly identify the real-model and packaged-runtime acceptance gaps.
- Added the pets and companions guide and refreshed the README, capability
  matrix, project site, architecture, and release notes with current pet behavior
  and test evidence.
- Updated the project browser and other protocol smoke scripts to use the
  isolated Agent Host smoke build instead of competing with an existing Debug
  host process in the checkout.

### Fixed

- Preserved the built-in project reverse-engineering skill and allowed normal
  line breaks in reviewed skill prompts after the plugin catalog update.
- Prevented an Electron main-process EPIPE from becoming an uncaught exception
  when the renderer closes while an Agent Host response is being written.

## [0.1.3] - 2026-11-14

### Fixed

- Accepted Percy’s intentional opaque-card fallback in packaged Linux smoke coverage when X11 has no compositor.
- Aligned the Electron package metadata with the root release version so artifact manifests identify the published version correctly.

## [0.1.2] - 2026-11-14

### Added

- Added the Electron-only desktop shell with a persistent Agent Host and guarded renderer bridge.
- Added local model discovery, Marketplace provider search, installed-model inventory, and review-first model installation.
- Added AirLLM packaging and runtime readiness checks for large local models.
- Added Percy as a separate transparent desktop companion with drag, wandering, state animation, and Windows/Linux windowing safeguards.
- Added packaged artifact manifests with SHA-256 hashes for the Electron executable, Agent Host, and AirLLM worker.

### Changed

- Expanded Windows smoke coverage to 18 checks spanning build, packaging, core tests, release audits, packaged UI, themes, and responsive overflow.
- Consolidated release evidence and removed retired desktop-architecture references from active project guidance.

### Fixed

- Prevented stale renderer builds from being packaged after source changes.
- Preserved the signed executable hash in the artifact manifest after Windows Authenticode signing.
- Improved Percy presentation on X11 systems without a compositor.

[0.1.2]: https://github.com/WowLolCoolMan/skai-desktop/compare/v0.1.1...v0.1.2
[0.1.3]: https://github.com/WowLolCoolMan/skai-desktop/compare/v0.1.2...v0.1.3
[0.1.4]: https://github.com/WowLolCoolMan/skai-desktop/compare/v0.1.3...v0.1.4
