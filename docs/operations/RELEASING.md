# Skai Desktop release guide

This is the operational source of truth for preparing a public Skai Desktop
release. A green local build does not establish that an installed app can update
through the published feed or that every desktop platform is accepted.

## 0.1.4 targets

- Windows 11 x64: unsigned per-user NSIS installer for testing.
- Ubuntu 24.04 x64: unsigned AppImage for testing, with SHA-256 checksum.
- macOS and other Linux distributions are not release targets for 0.1.4.

The owner has deferred code signing until the app is more complete. Do not
describe the 0.1.4 test artifacts as signed or as a trusted production release.

The Windows installer and Linux AppImage are the auto-update packages. Their
electron-builder metadata (`latest.yml` and `latest-linux.yml`) must be
published with the exact files those manifests reference. A portable ZIP or
tarball may be offered as a supplementary download, but it is not the in-app
update path.

## Before tagging a future version

1. Set the matching `0.1.4` version in the root and desktop package metadata.
2. Run `npm ci`, `npm ci --prefix apps/desktop`, `npm run check:syntax`,
   `npm run check:hygiene`, `npm run check:release-config`,
   `npm run audit:release-workflow`, `npm test`,
   `npm run desktop:typecheck`, `npm run desktop:build`, and
   `npm run agent-host:build`.
3. Exercise the exact packaged artifacts on clean Windows and Ubuntu machines;
   retain install, upgrade, uninstall, startup, update, and rollback evidence.
4. Complete keyboard, accessibility, contrast, and platform acceptance recorded
   in [release readiness](RELEASE_READINESS.md).
5. Confirm the repository Actions variables and secrets listed in
   [Windows installer release evidence](WINDOWS_INSTALLER.md) are configured.

Do not tag a future version while its required workflow gates or acceptance
items are unresolved. Keep the unsigned testing path explicit; production
signing is deferred by the owner.

## Update publishing contract

The Windows NSIS package and Linux AppImage are built from the same versioned
Electron payload as the rest of the release. The builder creates SHA-512 update
metadata. The workflow attaches each metadata file beside its corresponding
installer or AppImage. Do not rename those referenced assets after building.
Checksums, signatures, and supplementary archives are additional release
assets; they do not replace the updater metadata. The current updater validates
the downloaded artifact against SHA-512 metadata served over GitHub HTTPS, but
does not cryptographically verify the metadata itself. Treat signed updater
metadata as a remaining hardening item; do not describe this path as a signed
manifest until a supported, fail-closed verification path is shipped.

Automatic checking and background downloading are enabled by default in
packaged builds. Users can disable them or run an explicit manual check in
Settings. The app verifies downloads before staging them and asks the user to
restart. Release tags and update files must remain immutable after publication.

## Current status

Version 0.1.4 was published on 2026-11-22 as an unsigned testing release. The
published Windows and Linux feeds and their referenced installer/AppImage sizes
pass `npm run smoke:published-update-feed`. In an isolated WSL2/Xvfb profile,
the published Linux feed also downloaded, verified, installed, and reopened the
actual 0.1.4 AppImage from a synthetic 0.1.3 baseline. The public 0.1.4 updater
predates in-app rollback; current-source Linux rollback is separately covered
by the loopback smoke. See [release readiness](RELEASE_READINESS.md) for exact-
artifact evidence and remaining platform and updater gaps.
