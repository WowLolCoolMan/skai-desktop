# Skai Desktop release guide

This is the operational source of truth for preparing a public Skai Desktop
release. The release workflow is fail-closed; a green local build does not mean
the signed public release is ready.

## 0.1.4 targets

- Windows 11 x64: per-user NSIS installer, Authenticode signed.
- Ubuntu 24.04 x64: AppImage, with detached GPG signature and SHA-256 checksum.
- macOS and other Linux distributions are not release targets for 0.1.4.

The Windows installer and Linux AppImage are the auto-update packages. Their
electron-builder metadata (`latest.yml` and `latest-linux.yml`) must be
published with the exact files those manifests reference. A portable ZIP or
tarball may be offered as a supplementary download, but it is not the in-app
update path.

## Before tagging

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

The 0.1.4 tag must not be created while any required workflow gate or acceptance
item is unresolved. The `v0.1.4` workflow currently requires signing,
packaged-smoke, and Electron-packaging readiness variables, plus clean Windows
install/upgrade/uninstall evidence.

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

As of 2026-11-16, no public GitHub Release exists. The app update client and
release packaging are being prepared, but release readiness still depends on
trusted signing credentials and the exact-artifact/platform acceptance evidence
above. See [release readiness](RELEASE_READINESS.md) for current evidence and
open blockers.
