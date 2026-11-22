function registerUpdateIpc({ ipcMain, BrowserWindow, updateManager, shell }) {
  ipcMain.handle("updates:check", async (event) => {
    if (!BrowserWindow.fromWebContents(event.sender)) return { available: false, message: "Update checks are unavailable." };
    return updateManager.checkForUpdates(true);
  });
  ipcMain.handle("updates:get-state", (event) => BrowserWindow.fromWebContents(event.sender) ? updateManager.getCurrentSnapshot() : null);
  ipcMain.handle("updates:enabled", async (event) => {
    if (!BrowserWindow.fromWebContents(event.sender)) return false;
    return updateManager.getEnabled();
  });
  ipcMain.handle("updates:set-enabled", async (event, enabled) => {
    if (!BrowserWindow.fromWebContents(event.sender) || typeof enabled !== "boolean") return updateManager.getEnabled();
    return updateManager.writeUpdatePreference(enabled);
  });
  ipcMain.handle("updates:install", (event) => {
    if (!BrowserWindow.fromWebContents(event.sender)) return false;
    return updateManager.installDownloadedUpdate();
  });
  ipcMain.handle("updates:rollback", (event) => {
    if (!BrowserWindow.fromWebContents(event.sender)) return false;
    return updateManager.rollbackPreviousAppImage();
  });
  ipcMain.handle("updates:cancel-download", (event) => {
    if (!BrowserWindow.fromWebContents(event.sender)) return false;
    return updateManager.cancelUpdateDownload();
  });
  ipcMain.handle("updates:download", (event) => {
    if (!BrowserWindow.fromWebContents(event.sender)) return false;
    return updateManager.beginUpdateDownload();
  });
  ipcMain.handle("updates:retry", async (event) => {
    if (!BrowserWindow.fromWebContents(event.sender)) return updateManager.getSnapshot();
    return updateManager.checkForUpdates(true);
  });
  ipcMain.handle("updates:open", async (event, url) => {
    if (!BrowserWindow.fromWebContents(event.sender) || typeof url !== "string") return false;
    let parsed;
    try { parsed = new URL(url); } catch { return false; }
    if (parsed.protocol !== "https:" || !["github.com", "huggingface.co"].includes(parsed.hostname)) return false;
    await shell.openExternal(parsed.toString());
    return true;
  });
}

module.exports = { registerUpdateIpc };
