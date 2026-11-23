# Skai Desktop first-release readiness

Last audited: 2026-11-22

Target release: **0.1.4**. Status: **published as an unsigned testing release; not ready for a broad production rollout**.

## Ready now

- Electron renderer typecheck and production build pass.
- The persistent Agent Host builds cleanly and its protocol smoke passes.
- Core tests pass, including AirLLM fallback policy and the pet behavior logic.
- The packaged Windows Electron artifact builds and passes bounded startup smoke, including the host-backed Marketplace catalog/search/install contract and AirLLM worker staging. The unsigned 0.1.4 per-user NSIS installer and `latest.yml` are metadata-verified. The actual `v0.1.3` source tag was built as an unsigned baseline in a disposable worktree; the packaged 0.1.3 and 0.1.4 installers both passed app smoke, 0.1.3 → 0.1.4 upgrade preserved a user-data marker, and uninstall removed app files while preserving user data. Both installers and uninstallers reported `NotSigned`, as expected for local unsigned validation. Installer SHA-256: v0.1.3 `a5a35c7f1e3a0da397cbc6ee658a6f737cdc005e7b40a13fa180d0108751d31a`; rebuilt post-sync v0.1.4 `01d73e4b99f122d0313f2e9ed511d95871c3a41643a5b8e11659997e46d70fe4`.
- The packaged voice smoke verifies that Electron exposes on-device recognition APIs and reports the expected privacy-preserving error when the en-US pack is unavailable; microphone acceptance still requires an installed pack.
- `npm run smoke:voice:acceptance` creates a synthetic PCM tone and validates its WAV container, then probes native speech synthesis (Windows SAPI or a supported Linux speech command). It does not validate speech-recognition packs, microphone capture, transcription accuracy, or cancellation. `--require-native-tts` gates synthesis only. The packaged Electron smoke separately probes Chromium's local recognition API and fail-closed unavailable-language path; on the current Windows host it reports `en-US` recognition unavailable while keeping dictation local. Real microphone, spoken-audio accuracy, and cancellation acceptance remain open.
- The Windows smoke gate passed all 19 staged checks on 2026-11-16, including core tests, Electron-only architecture/release audits, packaged companion/AirLLM verification, themes, task replanning, and responsive overflow coverage.
- The latest packaged UI matrix passed on 2026-11-22: 17 routes × 5 supported window sizes × 4 theme/sidebar variants. Live visual, keyboard, and cross-platform acceptance remain open.
- `npm run check:pet-assets` passed for all 56 eleven-frame strips, exact rest-pose seams, visible motion, eleven-frame blinks, and Blaze's effects; `npm run test:pet` passed wander and attack behavior checks.
- Additional project, conversation, queue, memory, and PDF protocol smokes passed against the isolated Agent Host build.
- The portable Electron artifact now bundles the renderer, Electron runtime, and a self-contained Agent Host; its startup smoke verifies the rendered settings and pet surfaces.
- The Windows x64 NSIS package was built locally in unsigned validation mode on 2026-11-16. Its `latest.yml` was checked against the installer’s actual size and SHA-512, and the packaged startup smoke passed with `electron-updater` and `app-update.yml` staged inside the app.
- Linux x64 Electron artifact and unsigned 0.1.4 AppImage were built in Ubuntu 24.04 on WSL2. The AppImage builder verified `latest-linux.yml` against the artifact. The staged Electron app and the extracted payload from the actual AppImage both passed the packaged UI smoke as an unprivileged user under Xvfb, including Marketplace → Tools → Installed, Percy, MP4 frame sampling, and AirLLM worker staging. The local-feed updater smoke passed both directions: a synthetic 0.1.3 AppImage downloaded and verified the actual 0.1.4 artifact, installed it, retained a profile marker, and reopened 0.1.4; the in-app rollback then restored and relaunched 0.1.3 while preserving the same marker. This is headless WSL acceptance; native Linux desktop/compositor behavior and published-feed behavior remain unverified.
- On 2026-11-22, the published GitHub `latest.yml` and `latest-linux.yml` were fetched over HTTPS. Both advertise version 0.1.4, include SHA-512 and byte-size metadata, and their referenced Windows installer and Linux AppImage returned HTTP 200 with sizes matching the feeds. This verifies live feed metadata and asset availability, not an installed app updating through the published feed.
- Packaged Windows production dependencies are installed from the pinned lockfile; build tools and renderer libraries are no longer shipped as runtime dependencies.
- Automatic update checks, background downloads, progress reporting, a persistent opt-out, retry, verified staging, and an explicit restart action are wired for packaged Windows NSIS and Linux AppImage builds.
- `npm run check:release-readiness` verifies that the release workflow still contains the signing, Windows lifecycle, Linux AppImage, exact-artifact, and updater-metadata gates.
- Packaged artifacts include a versioned executable/Agent Host/AirLLM SHA-256 manifest; the Windows release workflow refreshes and verifies the executable hash after Authenticode signing.
- Electron Settings now has a usable surface for general routing, appearance, model discovery, local voice, local image workflows, agent controls, privacy, storage, updates, and advanced controls.
- The optional companion window supports the built-in and custom pet profiles, position persistence, pointer dragging, keyboard movement, wandering, per-pet idle/walk actions, reduced motion, and hide controls. Blaze has a tested attack sequence and separate fire/impact sprite effects; visual timing and pointer behavior still need live acceptance.
- The current release executes models locally. User-connected remote model routes are an approved direction but remain unavailable until the provider-gateway security and release acceptance plan is complete. Silent cloud fallback is not allowed.

## Hosted evidence

- [Electron replacement CI run 43728065347](https://github.com/WowLolCoolMan/skai-desktop/actions/runs/43728065347) passed the packaged Linux Electron smoke and Windows Electron smoke on 2026-11-15.

## Documentation site

GitHub Pages is configured to deploy from GitHub Actions. The public site
returned HTTP 200 on 2026-11-16 and served the updated companion feature card and
documentation link after commit `21cb70f8` was pushed to `main`. See
[GitHub Pages setup](GITHUB_PAGES.md).

## Release blockers

1. Code signing is intentionally deferred by the owner until the app is more complete. The published 0.1.4 installers are unsigned testing artifacts; trusted Authenticode and Linux signing keys plus signed-artifact lifecycle validation remain future production work.
2. Add a fail-closed cryptographic signature for update metadata; currently the binary digest is checked against metadata delivered over GitHub HTTPS, while GPG signatures are not checked by the app's updater.
3. Exercise the Linux AppImage updater on a supported desktop and through the published feed. The isolated loopback-feed smoke validates a synthetic 0.1.3 baseline using current updater-enabled code downloading and verifying the actual 0.1.4 AppImage, installing it, retaining the disposable profile marker, reopening 0.1.4, and using Settings rollback to restore/relaunch 0.1.3 with the marker intact. Published 0.1.4 metadata and asset availability now pass read-only checks, but no installed app has updated through GitHub; a historical 0.1.3 updater did not exist, and native Linux desktop behavior remains unverified.
4. Complete exact-artifact keyboard, accessibility, contrast, Linux compositor, and platform acceptance. Cloud model routing is deliberately outside the product boundary and is not a release blocker.

The Windows smoke suite, pet-focused checks, packaged UI matrix, unsigned installer lifecycle, local-feed Windows and Linux in-app update/install/rollback smokes, and headless Linux AppImage smoke pass. Release 0.1.4 remains a local validation build; production readiness still needs signing, signed updater metadata, published-channel acceptance, native Linux desktop/updater acceptance, and remaining live platform/accessibility review. The packaged Linux voice smoke also found no installed on-device `en-US` speech pack; recognition correctly stayed local and reported unavailable.
