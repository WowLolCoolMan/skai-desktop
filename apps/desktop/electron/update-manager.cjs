"use strict";

const { shouldDownloadAvailableUpdate } = require("./update-policy.cjs");

const UPDATE_REPOSITORY = "WowLolCoolMan/skai-desktop";
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

function createUpdateManager({ app, autoUpdater, CancellationToken, fs, path, getMainWindow, now = () => new Date(), setIntervalFn = setInterval, clearIntervalFn = clearInterval }) {
  let updateCheckTimer;
  let updateSnapshot = { status: "idle", available: false, message: "Updates have not been checked yet." };
  let updateChecksEnabled = true;
  let updateDownloadToken = null;
  let updateCheckInFlight = false;

  function updatePreferencesPath() {
    return path.join(app.getPath("userData"), "update-preferences.json");
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
    updateSnapshot = { status, available: ["available", "downloading", "downloaded"].includes(status), currentVersion: app.getVersion(), checkedAt: now().toISOString(), ...details };
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

  function cancelUpdateDownload() {
    if (updateSnapshot.status !== "downloading" || !updateDownloadToken) return false;
    updateDownloadToken.cancel();
    return true;
  }

  function installDownloadedUpdate() {
    if (updateSnapshot.status !== "downloaded") return false;
    autoUpdater.quitAndInstall(false, true);
    return true;
  }

  return {
    beginUpdateDownload,
    cancelUpdateDownload,
    checkForUpdates,
    configureAutoUpdater,
    getCurrentSnapshot: () => ({ ...updateSnapshot, currentVersion: app.getVersion() }),
    getEnabled: () => updateChecksEnabled,
    getSnapshot: () => ({ ...updateSnapshot }),
    installDownloadedUpdate,
    readUpdatePreference,
    scheduleUpdateCheck,
    writeUpdatePreference,
  };
}

module.exports = { createUpdateManager };
