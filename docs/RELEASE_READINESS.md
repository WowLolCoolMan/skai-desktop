# Skai Desktop first-release readiness

Last audited: 2026-11-15

Status: **not ready to publish as the first major release**.

## Ready now

- Electron renderer typecheck and production build pass.
- The persistent Agent Host builds cleanly and its protocol smoke passes.
- Core tests pass, including AirLLM fallback policy and the pet wander planner.
- The packaged Windows Electron artifact builds and passes bounded startup smoke, including the host-backed Marketplace catalog/search/install contract and AirLLM worker staging.
- The Windows smoke gate runs 19 staged checks, including core tests, Electron-only architecture/release audits, packaged Percy/AirLLM verification, and responsive overflow coverage.
- The portable Electron artifact now bundles the renderer, Electron runtime, and a self-contained Agent Host; its startup smoke verifies the rendered settings and pet surfaces.
- Packaged artifacts include a versioned executable/Agent Host/AirLLM SHA-256 manifest; the Windows release workflow refreshes and verifies the executable hash after Authenticode signing.
- Electron Settings now has a usable surface for general routing, appearance, model discovery, local voice, local image workflows, agent controls, privacy, storage, updates, and advanced controls.
- The Electron pet uses the existing Byte asset pack, persists its position, supports pointer drag-and-drop, keyboard arrows, wandering, reduced-motion behavior, and a hide control.
- Model execution remains local-only; external model providers and cloud fallback are outside product scope.

## Hosted evidence

- [Electron replacement CI run 43728065347](https://github.com/WowLolCoolMan/skai-desktop/actions/runs/43728065347) passed the packaged Linux Electron smoke and Windows Electron smoke on 2026-11-15.

## Documentation site

The Pages source and deployment workflow are present, but the first deployment
is not yet enabled for this repository. The latest Pages run fails at
**Configure Pages** because GitHub returns `404 Not Found` for the Pages site.
An administrator must set **Settings → Pages → Build and deployment → Source**
to **GitHub Actions**, then rerun the deployment workflow. See
[GitHub Pages setup](GITHUB_PAGES.md).

## Release blockers

1. A signed Electron installer/release asset and clean-machine install/upgrade/uninstall evidence are not available in this checkout. The release workflow now packages and smoke-tests Electron for Windows and Linux, but remains fail-closed until signing material and lifecycle evidence are supplied.
2. Complete the exact packaged-artifact accessibility, platform, and clean-install acceptance matrix. Cloud model routing is deliberately outside the product boundary and is not a release blocker.

The current `main` branch is suitable for continuing release work, but it is not an honest candidate for a public release until the blockers above are closed.
