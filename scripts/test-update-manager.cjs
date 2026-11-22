#!/usr/bin/env node
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
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
    const manager = createUpdateManager({
      app,
      autoUpdater: updater,
      CancellationToken: FakeCancellationToken,
      fs,
      path,
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
    assert.deepEqual(updater.installArgs, [false, true]);
    assert.equal(updater.installCalls, 1);

    await manager.writeUpdatePreference(false);
    assert.equal(clearedInterval, true, "disabling checks clears the recurring timer");
    assert.equal(sent.every(([, state]) => state.currentVersion === "0.1.4"), true, "published update states include the running app version");
    console.log("Update manager checks passed.");
  } finally {
    await fs.rm(userData, { recursive: true, force: true });
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
