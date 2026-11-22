#!/usr/bin/env node
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createUpdateManager } = require("../apps/desktop/electron/update-manager.cjs");

class FakeCancellationToken {
  cancelled = false;
  cancel() { this.cancelled = true; }
}

function createUpdater() {
  const updater = new EventEmitter();
  updater.downloadCalls = 0;
  updater.installCalls = 0;
  updater.checkForUpdates = async () => {
    updater.emit("checking-for-update");
    updater.emit("update-available", { version: "0.1.5" });
  };
  updater.downloadUpdate = async () => { updater.downloadCalls += 1; };
  updater.quitAndInstall = (...args) => { updater.installCalls += 1; updater.installArgs = args; };
  updater.updateInfo = { version: "0.1.5" };
  return updater;
}

async function run() {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "skai-update-manager-"));
  try {
    const updater = createUpdater();
    const app = { isPackaged: true, getPath: () => userData, getVersion: () => "0.1.4" };
    const sent = [];
    let intervalCallback;
    let clearedInterval = false;
    let preparedForInstall = false;
    let forceExitScheduled = false;
    const manager = createUpdateManager({
      app,
      autoUpdater: updater,
      CancellationToken: FakeCancellationToken,
      fs,
      path,
      prepareForUpdateInstall: () => { preparedForInstall = true; },
      forceExitAfterUpdateLaunch: () => { forceExitScheduled = true; },
      getMainWindow: () => ({ isDestroyed: () => false, webContents: { send: (...event) => sent.push(event) } }),
      now: () => new Date("2026-11-22T12:00:00.000Z"),
      setIntervalFn: (callback, delay) => { intervalCallback = callback; assert.equal(delay, 6 * 60 * 60 * 1000); return "timer"; },
      clearIntervalFn: (timer) => { assert.equal(timer, "timer"); clearedInterval = true; },
    });

    assert.equal(await manager.readUpdatePreference(), true, "missing preference defaults to enabled");
    assert.equal(await manager.writeUpdatePreference(false), false, "user can disable automatic update checks");
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(userData, "update-preferences.json"), "utf8")), { enabled: false });
    assert.match((await manager.checkForUpdates()).message, /turned off/i, "disabled automatic checks do not contact the updater");
    assert.equal(manager.installDownloadedUpdate(), false, "install is unavailable before an update is downloaded");

    manager.configureAutoUpdater();
    const manual = await manager.checkForUpdates(true);
    assert.equal(manual.status, "available", "manual checks still report available updates when automatic checks are off");
    assert.equal(updater.downloadCalls, 0, "manual availability does not start an automatic download when disabled");
    assert.equal(manager.beginUpdateDownload(), true, "the user can start a download explicitly");
    assert.equal(manager.getSnapshot().status, "downloading");
    assert.equal(manager.cancelUpdateDownload(), true, "active download can be cancelled");
    updater.emit("update-cancelled", { version: "0.1.5" });
    assert.equal(manager.getSnapshot().status, "available");
    assert(sent.some(([name]) => name === "updates:available"), "availability is sent through the existing UI event");

    assert.equal(await manager.writeUpdatePreference(true), true);
    assert.equal(typeof intervalCallback, "function", "enabling checks schedules periodic refresh");
    assert.equal(updater.downloadCalls, 2, "enabled automatic checks download available updates after the explicit download test");
    assert.equal(manager.getSnapshot().status, "downloading");
    updater.emit("download-progress", { percent: 47.6, transferred: 100, total: 211 });
    assert.equal(manager.getSnapshot().percent, 48, "download progress is rounded for the existing UI contract");
    updater.emit("update-downloaded", { version: "0.1.5" });
    assert.equal(manager.getSnapshot().status, "downloaded");
    assert.equal(manager.installDownloadedUpdate(), true, "a verified download can be installed");
    assert.deepEqual(updater.installArgs, [true, true]);
    assert.equal(updater.installCalls, 1);
    assert.equal(preparedForInstall, true, "app close-to-tray is bypassed before the updater closes the window");
    assert.equal(forceExitScheduled, true, "a fallback process exit is scheduled after the installer is launched");

    await manager.writeUpdatePreference(false);
    assert.equal(clearedInterval, true, "disabling checks clears the recurring timer");
    await manager.writeUpdatePreference(true);
    clearedInterval = false;
    manager.dispose();
    assert.equal(clearedInterval, true, "disposing the app clears the updater's interval so shutdown can finish");
    assert.equal(sent.every(([, state]) => state.currentVersion === "0.1.4"), true, "published update states include the running app version");

    const appImageDirectory = path.join(userData, "appimages");
    await fs.mkdir(appImageDirectory);
    const previousAppImage = path.join(appImageDirectory, "Skai-Desktop-0.1.4-x64.AppImage");
    const nextAppImage = path.join(appImageDirectory, "Skai-Desktop-0.1.5-x64.AppImage");
    await fs.writeFile(previousAppImage, "previous-appimage-bytes");
    const linuxUpdater = createUpdater();
    linuxUpdater.quitAndInstall = () => {
      fsSync.unlinkSync(previousAppImage);
      fsSync.writeFileSync(nextAppImage, "updated-appimage-bytes");
    };
    linuxUpdater.updateInfo.version = "0.1.5";
    const appImageApp = { isPackaged: true, getPath: () => userData, getVersion: () => "0.1.4" };
    const rollbackLaunches = [];
    const appImageManager = createUpdateManager({
      app: appImageApp, autoUpdater: linuxUpdater, CancellationToken: FakeCancellationToken, fs, path,
      platform: "linux", environment: { APPIMAGE: previousAppImage }, spawnProcess: (...args) => { rollbackLaunches.push(args); return { unref() {} }; },
      getMainWindow: () => null,
    });
    appImageManager.configureAutoUpdater();
    linuxUpdater.emit("update-available", { version: "0.1.5" });
    linuxUpdater.emit("update-downloaded", { version: "0.1.5" });
    assert.equal(appImageManager.installDownloadedUpdate(), true, "a Linux AppImage update starts after preserving its previous version");
    const rollbackPath = path.join(appImageDirectory, ".skai-desktop-rollback-0.1.4.AppImage");
    assert.equal(await fs.readFile(rollbackPath, "utf8"), "previous-appimage-bytes", "rollback artifact survives electron-updater deleting the old image");
    assert.equal(JSON.parse(await fs.readFile(path.join(userData, "appimage-rollback.json"), "utf8")).installedVersion, "0.1.5", "rollback manifest identifies the verified target version");

    const upgradedAppImageManager = createUpdateManager({
      app: { isPackaged: true, getPath: () => userData, getVersion: () => "0.1.5" },
      autoUpdater: createUpdater(), CancellationToken: FakeCancellationToken, fs, path,
      platform: "linux", environment: { APPIMAGE: nextAppImage }, spawnProcess: (...args) => { rollbackLaunches.push(args); return { unref() {} }; },
      getMainWindow: () => null,
    });
    assert.equal(await upgradedAppImageManager.readUpdatePreference(), true);
    assert.equal(upgradedAppImageManager.getCurrentSnapshot().rollbackAvailable, true, "the new AppImage exposes recovery only for its matching installed version");
    assert.equal(upgradedAppImageManager.rollbackPreviousAppImage(), true, "the user can launch the preserved previous AppImage");
    assert.equal(await fs.readFile(previousAppImage, "utf8"), "previous-appimage-bytes", "rollback restores the prior version to its original launch path");
    assert.equal(fsSync.existsSync(nextAppImage), true, "rollback leaves the failed newer image available for manual recovery");
    assert.equal(rollbackLaunches.length, 1, "rollback schedules one detached relaunch");
    assert.equal(rollbackLaunches[0][1][3], previousAppImage, "rollback uses a shell positional argument for the previous AppImage path");
    assert.equal(rollbackLaunches[0][2].env.APPIMAGE, previousAppImage, "the restored version receives the correct APPIMAGE path");
    assert.equal(upgradedAppImageManager.getCurrentSnapshot().rollbackAvailable, true, "the running upgraded app still has its recovery action until it exits");
    const restoredAppImageManager = createUpdateManager({
      app: appImageApp, autoUpdater: createUpdater(), CancellationToken: FakeCancellationToken, fs, path,
      platform: "linux", environment: { APPIMAGE: previousAppImage }, getMainWindow: () => null,
    });
    assert.equal(restoredAppImageManager.getCurrentSnapshot().rollbackAvailable, false, "the restored previous version does not offer rollback to itself");

    const unbackedUpdater = createUpdater();
    const noRollbackManager = createUpdateManager({
      app: { isPackaged: true, getPath: () => userData, getVersion: () => "0.1.4" }, autoUpdater: unbackedUpdater,
      CancellationToken: FakeCancellationToken, fs, path, platform: "linux", environment: {}, getMainWindow: () => null,
    });
    noRollbackManager.configureAutoUpdater();
    await noRollbackManager.checkForUpdates(true);
    unbackedUpdater.emit("update-downloaded", { version: "0.1.5" });
    assert.equal(noRollbackManager.installDownloadedUpdate(), false, "Linux update installation fails closed when APPIMAGE is unavailable");
    assert.equal(unbackedUpdater.installCalls, 0, "the updater is not allowed to replace the current image without a recovery copy");
    assert.match(noRollbackManager.getSnapshot().message, /rollback copy/i, "the unavailable rollback condition is explained");
    console.log("Update manager checks passed.");
  } finally {
    await fs.rm(userData, { recursive: true, force: true });
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
