# Skai Desktop first-release readiness

Last audited: 2026-11-16

Target release: **0.1.4**. Status: **not ready to publish**.

## Ready now

- Electron renderer typecheck and production build pass.
- The persistent Agent Host builds cleanly and its protocol smoke passes.
- Core tests pass, including AirLLM fallback policy and the pet behavior logic.
- The packaged Windows Electron artifact builds and passes bounded startup smoke, including the host-backed Marketplace catalog/search/install contract and AirLLM worker staging. The 0.1.4 per-user NSIS installer configuration and install/upgrade/uninstall smoke are prepared; local lifecycle evidence used unsigned development artifacts only.
- The packaged voice smoke verifies that Electron exposes on-device recognition APIs and reports the expected privacy-preserving error when the en-US pack is unavailable; microphone acceptance still requires an installed pack.
- `npm run smoke:voice:acceptance` now creates and validates a real PCM audio fixture, probes the native speech runtime, and records the explicit cancellation, unavailable-language, and microphone acceptance boundaries. Use `--require-installed-pack` on a release-validation host with the speech pack installed.
- The Windows smoke gate passed all 19 staged checks on 2026-11-16, including core tests, Electron-only architecture/release audits, packaged companion/AirLLM verification, themes, task replanning, and responsive overflow coverage.
- The full packaged UI matrix passed on 2026-11-16: 14 routes × 5 supported window sizes × 4 theme/sidebar variants.
- `npm run check:pet-assets` passed for all 56 eleven-frame strips, exact rest-pose seams, visible motion, eleven-frame blinks, and Blaze's effects; `npm run test:pet` passed wander and attack behavior checks.
- Additional project, conversation, queue, memory, and PDF protocol smokes passed against the isolated Agent Host build.
- The portable Electron artifact now bundles the renderer, Electron runtime, and a self-contained Agent Host; its startup smoke verifies the rendered settings and pet surfaces.
- The Windows x64 NSIS package was built locally in unsigned validation mode on 2026-11-16. Its `latest.yml` was checked against the installer’s actual size and SHA-512, and the packaged startup smoke passed with `electron-updater` and `app-update.yml` staged inside the app.
- Packaged Windows production dependencies are installed from the pinned lockfile; build tools and renderer libraries are no longer shipped as runtime dependencies.
- Automatic update checks, background downloads, progress reporting, a persistent opt-out, retry, verified staging, and an explicit restart action are wired for packaged Windows NSIS and Linux AppImage builds.
- `npm run check:release-readiness` verifies that the release workflow still contains the signing, Windows lifecycle, Linux AppImage, exact-artifact, and updater-metadata gates.
- Packaged artifacts include a versioned executable/Agent Host/AirLLM SHA-256 manifest; the Windows release workflow refreshes and verifies the executable hash after Authenticode signing.
- Electron Settings now has a usable surface for general routing, appearance, model discovery, local voice, local image workflows, agent controls, privacy, storage, updates, and advanced controls.
- The optional companion window supports the built-in and custom pet profiles, position persistence, pointer dragging, keyboard movement, wandering, per-pet idle/walk actions, reduced motion, and hide controls. Blaze has a tested attack sequence and separate fire/impact sprite effects; visual timing and pointer behavior still need live acceptance.
- Model execution remains local-only; external model providers and cloud fallback are outside product scope.

## Hosted evidence

- [Electron replacement CI run 43728065347](https://github.com/WowLolCoolMan/skai-desktop/actions/runs/43728065347) passed the packaged Linux Electron smoke and Windows Electron smoke on 2026-11-15.

## Documentation site

GitHub Pages is configured to deploy from GitHub Actions. The public site
returned HTTP 200 on 2026-11-16 and served the updated companion feature card and
documentation link after commit `21cb70f8` was pushed to `main`. See
[GitHub Pages setup](GITHUB_PAGES.md).

## Release blockers

1. The Windows installer produced here is unsigned and local-only. Configure a trusted Authenticode certificate and Linux signing key, then produce and validate signed release artifacts and clean-machine install/upgrade/rollback/uninstall evidence.
2. Add a fail-closed cryptographic signature for update metadata; currently the binary digest is checked against metadata delivered over GitHub HTTPS, while GPG signatures are not checked by the app's updater.
3. Build and run the Linux AppImage in Ubuntu 24.04, then exercise a real update from 0.1.3 to 0.1.4 and a rollback/recovery path on both platforms. The Windows installer and startup smoke pass locally, but the full download/install update loop and Linux target are not validated in this Windows checkout.
4. Complete exact-artifact keyboard, accessibility, contrast, Linux compositor, and platform acceptance. Cloud model routing is deliberately outside the product boundary and is not a release blocker.

The Windows smoke suite, pet-focused checks, and packaged UI matrix pass. Release 0.1.4 is still blocked until signing and lifecycle evidence are produced, signed updater metadata is implemented, the update loop passes on clean Windows and Ubuntu installs, the current automated contrast failures are fixed, and the remaining live platform/accessibility acceptance is recorded.
