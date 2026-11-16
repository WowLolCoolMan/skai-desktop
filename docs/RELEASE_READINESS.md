# Skai Desktop first-release readiness

Last audited: 2026-11-16

Status: **not ready to publish as the first major release**.

## Ready now

- Electron renderer typecheck and production build pass.
- The persistent Agent Host builds cleanly and its protocol smoke passes.
- Core tests pass, including AirLLM fallback policy and the pet behavior logic.
- The packaged Windows Electron artifact builds and passes bounded startup smoke, including the host-backed Marketplace catalog/search/install contract and AirLLM worker staging.
- The packaged voice smoke verifies that Electron exposes on-device recognition APIs and reports the expected privacy-preserving error when the en-US pack is unavailable; microphone acceptance still requires an installed pack.
- The Windows smoke gate passed all 19 staged checks on 2026-11-16, including core tests, Electron-only architecture/release audits, packaged companion/AirLLM verification, themes, task replanning, and responsive overflow coverage.
- `npm run check:pet-assets` passed for all 56 eleven-frame strips, exact rest-pose seams, visible motion, eleven-frame blinks, and Blaze's effects; `npm run test:pet` passed wander and attack behavior checks.
- Additional project, conversation, queue, memory, and PDF protocol smokes passed against the isolated Agent Host build.
- The portable Electron artifact now bundles the renderer, Electron runtime, and a self-contained Agent Host; its startup smoke verifies the rendered settings and pet surfaces.
- Packaged artifacts include a versioned executable/Agent Host/AirLLM SHA-256 manifest; the Windows release workflow refreshes and verifies the executable hash after Authenticode signing.
- Electron Settings now has a usable surface for general routing, appearance, model discovery, local voice, local image workflows, agent controls, privacy, storage, updates, and advanced controls.
- The optional companion window supports the built-in and custom pet profiles, position persistence, pointer dragging, keyboard movement, wandering, per-pet idle/walk actions, reduced motion, and hide controls. Blaze has a tested attack sequence and separate fire/impact sprite effects; visual timing and pointer behavior still need live acceptance.
- Model execution remains local-only; external model providers and cloud fallback are outside product scope.

## Hosted evidence

- [Electron replacement CI run 43728065347](https://github.com/WowLolCoolMan/skai-desktop/actions/runs/43728065347) passed the packaged Linux Electron smoke and Windows Electron smoke on 2026-11-15.

## Documentation site

GitHub Pages is configured to deploy from GitHub Actions. The public site last
returned HTTP 200 on 2026-11-15. The updated pet documentation and feature card
in this checkout still need to be pushed to `main` and deployed before they are
live. See [GitHub Pages setup](GITHUB_PAGES.md).

## Release blockers

1. A signed Electron installer/release asset and clean-machine install/upgrade/uninstall evidence are not available in this checkout. The release workflow now packages and smoke-tests Electron for Windows and Linux, but remains fail-closed until signing material and lifecycle evidence are supplied.
2. The extended packaged UI matrix still reports overlaps and unreachable controls at several narrow viewport sizes. Resolve those findings, then complete exact-artifact accessibility and platform acceptance. Cloud model routing is deliberately outside the product boundary and is not a release blocker.

The Windows smoke suite and pet-focused checks pass, but this is not an honest
candidate for a public release until the signing/lifecycle and narrow-layout
acceptance blockers above are closed.
