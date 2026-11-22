"use strict";

const crypto = require("node:crypto");
const fsSync = require("node:fs");
const { spawn } = require("node:child_process");
const { shouldDownloadAvailableUpdate } = require("./update-policy.cjs");

const UPDATE_REPOSITORY = "WowLolCoolMan/skai-desktop";
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

function createUpdateManager({ app, autoUpdater, CancellationToken, fs, path, getMainWindow, prepareForUpdateInstall = () => {}, forceExitAfterUpdateLaunch = () => {}, now = () => new Date(), setIntervalFn = setInterval, clearIntervalFn = clearInterval, platform = process.platform, environment = process.env, spawnProcess = spawn }) {
  let updateCheckTimer;
  let updateSnapshot = { status: "idle", available: false, message: "Updates have not been checked yet." };
  let updateChecksEnabled = true;
  let updateDownloadToken = null;
  let updateCheckInFlight = false;

  function updatePreferencesPath() {
    return path.join(app.getPath("userData"), "update-preferences.json");
  }

  function rollbackManifestPath() {
    return path.join(app.getPath("userData"), "appimage-rollback.json");
  }

  function readRollbackRecord() {
    if (platform !== "linux") return null;
    try {
      const record = JSON.parse(fsSync.readFileSync(rollbackManifestPath(), "utf8"));
      if (typeof record.previousVersion !== "string" || typeof record.installedVersion !== "string" ||
          !path.isAbsolute(record.originalPath) || !path.isAbsolute(record.backupPath)) return null;
      const expectedBackup = path.join(path.dirname(record.originalPath), `.skai-desktop-rollback-${record.previousVersion}.AppImage`);
      if (record.backupPath !== expectedBackup || record.installedVersion !== app.getVersion() || !fsSync.statSync(record.backupPath).isFile()) return null;
      return record;
    } catch { return null; }
  }

  function rollbackState() {
    const record = readRollbackRecord();
    return record ? { rollbackAvailable: true, rollbackVersion: record.previousVersion } : { rollbackAvailable: false, rollbackVersion: undefined };
  }

  function writeRollbackManifest(record) {
    const target = rollbackManifestPath();
    fsSync.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      fsSync.writeFileSync(temporary, JSON.stringify(record, null, 2) + "\n", { mode: 0o600, flag: "wx" });
      fsSync.renameSync(temporary, target);
    } finally {
      try { fsSync.rmSync(temporary, { force: true }); } catch { /* The atomic rename already consumed it. */ }
    }
  }

  function linkOrCopy(source, destination) {
    try { fsSync.linkSync(source, destination); }
    catch (error) {
      if (!new Set(["EXDEV", "EPERM", "EACCES", "ENOTSUP", "EMLINK"]).has(error.code)) throw error;
      fsSync.copyFileSync(source, destination, fsSync.constants.COPYFILE_EXCL);
      fsSync.chmodSync(destination, fsSync.statSync(source).mode & 0o777);
    }
  }

  function preservePreviousAppImage() {
    if (platform !== "linux") return;
    const originalPath = environment.APPIMAGE;
    if (typeof originalPath !== "string" || !path.isAbsolute(originalPath) || !fsSync.statSync(originalPath).isFile()) {
      throw new Error("Skai could not locate the running AppImage, so the update was not installed. Launch the downloaded AppImage directly and retry.");
    }
    const previousVersion = app.getVersion();
    const installedVersion = updateSnapshot.version ?? autoUpdater.updateInfo?.version;
    if (typeof installedVersion !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(installedVersion)) {
      throw new Error("The downloaded update version is unavailable, so Skai could not prepare rollback.");
    }
    const backupPath = path.join(path.dirname(originalPath), `.skai-desktop-rollback-${previousVersion}.AppImage`);
    const temporaryBackup = `${backupPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      linkOrCopy(originalPath, temporaryBackup);
      fsSync.renameSync(temporaryBackup, backupPath);
      writeRollbackManifest({ previousVersion, installedVersion, originalPath, backupPath, createdAt: now().toISOString() });
    } finally {
      try { fsSync.rmSync(temporaryBackup, { force: true }); } catch { /* Best-effort cleanup of the staging link. */ }
    }
  }

  async function readUpdatePreference() {
    try {
      const preferences = JSON.parse(await fs.readFile(updatePreferencesPath(), "utf8"));
      updateChecksEnabled = preferences?.enabled !== false;
    } catch { updateChecksEnabled = true; }
    return updateChecksEnabled;
  }

  async function writeUpdatePreference(enabled) {
    updateChecksEnabled = Boolean(enabled);
    await fs.mkdir(app.getPath("userData"), { recursive: true });
    const target = updatePreferencesPath();
    const temporary = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify({ enabled: updateChecksEnabled }, null, 2), { mode: 0o600 });
    await fs.rename(temporary, target);
    if (!updateChecksEnabled && updateDownloadToken && !updateDownloadToken.cancelled) updateDownloadToken.cancel();
    if (updateCheckTimer) { clearIntervalFn(updateCheckTimer); updateCheckTimer = undefined; }
    if (updateChecksEnabled) scheduleUpdateCheck();
    return updateChecksEnabled;
  }

  function publishUpdateState(status, details = {}) {
    updateSnapshot = { status, available: ["available", "downloading", "downloaded"].includes(status), currentVersion: app.getVersion(), checkedAt: now().toISOString(), ...rollbackState(), ...details };
    const window = getMainWindow();
    if (window && !window.isDestroyed()) window.webContents.send("updates:state", updateSnapshot);
    if (status === "available" && window && !window.isDestroyed()) window.webContents.send("updates:available", updateSnapshot);
  }

  function beginUpdateDownload() {
    if (!app.isPackaged || process.platform === "darwin" || updateSnapshot.status !== "available") return false;
    if (updateDownloadToken && !updateDownloadToken.cancelled) return false;
    const token = new CancellationToken();
    updateDownloadToken = token;
    publishUpdateState("downloading", { available: true, version: updateSnapshot.version ?? autoUpdater.updateInfo?.version, percent: 0, message: "Downloading the verified update." });
    void autoUpdater.downloadUpdate(token).catch((error) => {
      if (token.cancelled) return;
      if (updateDownloadToken === token) updateDownloadToken = null;
      publishUpdateState("error", { version: updateSnapshot.version, error: error instanceof Error ? error.message : String(error), message: "The update download failed. You can retry from Settings." });
    });
    return true;
  }

  function configureAutoUpdater() {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.on("checking-for-update", () => publishUpdateState("checking", { message: "Checking the stable release channel…" }));
    autoUpdater.on("update-available", (info) => {
      if (!shouldDownloadAvailableUpdate({ enabled: updateChecksEnabled })) {
        publishUpdateState("available", { available: true, version: info.version, message: `Skai Desktop ${info.version} is available. Select Download update when you are ready.` });
        return;
      }
      publishUpdateState("available", { available: true, version: info.version, message: `Skai Desktop ${info.version} is available. Starting a background download…` });
      beginUpdateDownload();
    });
    autoUpdater.on("update-not-available", () => publishUpdateState("current", { available: false, message: "You are running the latest stable version." }));
    autoUpdater.on("download-progress", (progress) => publishUpdateState("downloading", { available: true, version: autoUpdater.updateInfo?.version, percent: Math.round(progress.percent), transferred: progress.transferred, total: progress.total, message: `Downloading update… ${Math.round(progress.percent)}%` }));
    autoUpdater.on("update-downloaded", (info) => {
      updateDownloadToken = null;
      publishUpdateState("downloaded", { available: true, version: info.version, message: `Version ${info.version} is verified and ready to install. Restart Skai to finish.` });
    });
    autoUpdater.on("update-cancelled", (info) => {
      updateDownloadToken = null;
      publishUpdateState("available", { available: true, version: info.version, message: "The update download was cancelled. You can check again to retry." });
    });
    autoUpdater.on("error", (error) => {
      if (updateDownloadToken?.cancelled) return;
      publishUpdateState("error", { error: error instanceof Error ? error.message : String(error), message: "Update check or download failed. You can retry from Settings." });
    });
  }

  async function checkForUpdates(force = false) {
    const currentVersion = app.getVersion();
    const releaseUrl = `https://github.com/${UPDATE_REPOSITORY}/releases/latest`;
    if (!updateChecksEnabled && !force) return { ...updateSnapshot, available: false, currentVersion, releaseUrl, message: "Automatic update checks are turned off." };
    if (!app.isPackaged || process.platform === "darwin") return { ...updateSnapshot, available: false, currentVersion, releaseUrl, message: "Updates are available in packaged Windows and Linux builds." };
    if (updateCheckInFlight || ["downloading", "downloaded"].includes(updateSnapshot.status)) return { ...updateSnapshot, currentVersion, releaseUrl };
    updateCheckInFlight = true;
    try {
      await autoUpdater.checkForUpdates();
      return { ...updateSnapshot, currentVersion, releaseUrl };
    } catch (error) {
      publishUpdateState("error", { error: error instanceof Error ? error.message : String(error), message: "Update check failed. You can retry from Settings." });
      return { ...updateSnapshot, currentVersion, releaseUrl };
    } finally { updateCheckInFlight = false; }
  }

  function scheduleUpdateCheck() {
    if (updateCheckTimer) clearIntervalFn(updateCheckTimer);
    if (!updateChecksEnabled || !app.isPackaged || process.platform === "darwin") return;
    void checkForUpdates();
    updateCheckTimer = setIntervalFn(() => { void checkForUpdates(); }, UPDATE_CHECK_INTERVAL_MS);
  }

  function dispose() {
    if (updateCheckTimer) clearIntervalFn(updateCheckTimer);
    updateCheckTimer = undefined;
    if (updateDownloadToken && !updateDownloadToken.cancelled) updateDownloadToken.cancel();
  }

  function cancelUpdateDownload() {
    if (updateSnapshot.status !== "downloading" || !updateDownloadToken) return false;
    updateDownloadToken.cancel();
    return true;
  }

  function installDownloadedUpdate() {
    if (updateSnapshot.status !== "downloaded") return false;
    // electron-updater deletes the running AppImage before it moves the new
    // artifact into place. Preserve a same-filesystem recovery copy first.
    try { preservePreviousAppImage(); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      publishUpdateState("downloaded", { error: message, message: "The update is ready, but Skai could not create its rollback copy. The current version is still running." });
      return false;
    }
    prepareForUpdateInstall();
    autoUpdater.quitAndInstall(true, true);
    forceExitAfterUpdateLaunch();
    return true;
  }

  function rollbackPreviousAppImage() {
    const record = readRollbackRecord();
    if (!record) return false;
    let temporary;
    try {
      if (fsSync.existsSync(record.originalPath) && path.resolve(environment.APPIMAGE ?? "") !== record.originalPath)
        throw new Error("The previous AppImage launch path is occupied by another file; Skai left it untouched.");
      temporary = `${record.originalPath}.${process.pid}.${crypto.randomUUID()}.rollback.tmp`;
      linkOrCopy(record.backupPath, temporary);
      fsSync.renameSync(temporary, record.originalPath);
      const childEnvironment = { ...environment, APPIMAGE: record.originalPath };
      delete childEnvironment.APPIMAGE_EXIT_AFTER_INSTALL;
      delete childEnvironment.APPIMAGE_SILENT_INSTALL;
      const launcher = spawnProcess("/bin/sh", ["-c", "sleep 3; exec \"$1\"", "skai-desktop-rollback", record.originalPath], {
        detached: true, stdio: "ignore", env: childEnvironment,
      });
      launcher.unref();
      prepareForUpdateInstall();
      forceExitAfterUpdateLaunch();
      return true;
    } catch (error) {
      if (temporary) try { fsSync.rmSync(temporary, { force: true }); } catch { /* Best-effort temporary link cleanup. */ }
      publishUpdateState(updateSnapshot.status, { error: error instanceof Error ? error.message : String(error), message: "Skai could not restore the previous AppImage. The current version is still running." });
      return false;
    }
  }

  return {
    beginUpdateDownload,
    cancelUpdateDownload,
    checkForUpdates,
    configureAutoUpdater,
    dispose,
    getCurrentSnapshot: () => ({ ...updateSnapshot, currentVersion: app.getVersion(), ...rollbackState() }),
    getEnabled: () => updateChecksEnabled,
    getSnapshot: () => ({ ...updateSnapshot, ...rollbackState() }),
    installDownloadedUpdate,
    rollbackPreviousAppImage,
    readUpdatePreference,
    scheduleUpdateCheck,
    writeUpdatePreference,
  };
}

module.exports = { createUpdateManager };
