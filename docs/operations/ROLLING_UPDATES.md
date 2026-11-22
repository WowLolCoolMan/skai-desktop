# In-app updates

Packaged Windows x64 (per-user NSIS) and Linux x64 (AppImage) builds use
`electron-updater` with the public GitHub Releases feed. The release workflow
must attach the generated `latest.yml` / `latest-linux.yml` metadata and the
matching installer / AppImage to the same immutable release.

Automatic checks and background downloads are enabled by default. Users can
turn them off in **Settings → Updates**; a manual check remains available.
Skai displays download progress, supports cancelling an active download, lets
users defer installation, and restarts only after they choose **Restart to
update**. `electron-updater` validates the download against the SHA-512 digest
in the release metadata before staging. The current electron-builder 26 release
does not cryptographically sign that metadata, so the manifest is authenticated
by GitHub HTTPS. Windows binaries and installers also require Authenticode
signing in the release workflow. Linux release artifacts are accompanied by
detached GPG signatures and checksums; the app's updater does not currently
verify those detached signatures itself.

On Linux AppImage installs, Skai preserves one local copy of the currently
running image before installing a downloaded update. **Settings → Updates**
offers **Revert to previous version** while that copy matches the running
version and the saved update record. Reverting restores the prior image at its
original launch path and starts it; the newer image remains available. The
rollback copy and manifest stay in the local install/profile locations and are
not uploaded. If Skai cannot find or preserve the running AppImage, it fails
closed and leaves the current version running. This recovery action is
AppImage-specific; Windows NSIS rollback remains governed by installer policy.

Updates are disabled for development runs and unsupported platforms. See the
[release guide](RELEASING.md) for artifact names, workflow gates, and acceptance
requirements. Keep published tags and their update metadata immutable.
