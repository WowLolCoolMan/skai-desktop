# Changelog

## [Unreleased]

### Added

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

### Updated

- Refreshed capability and release-readiness docs to reflect the local-only
  model boundary, Monaco project editor, and current image workflow support.
- Synced the capability matrix, project site, voice architecture notes, and
  release docs with hands-free chat behavior and the Pages setup blocker.

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
