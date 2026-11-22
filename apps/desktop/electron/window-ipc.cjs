function registerWindowIpc({ ipcMain, getMainWindow, isClosePromptOpen, applyCloseChoice, readCloseBehavior, writeCloseBehavior }) {
  ipcMain.on("window:close-choice", (event, response) => {
    const window = getMainWindow();
    if (!window || event.sender !== window.webContents || !isClosePromptOpen()) return;
    const choice = response?.choice;
    applyCloseChoice(choice === "background" || choice === "quit" ? choice : "cancel", Boolean(response?.remember));
  });

  ipcMain.handle("window:get-close-behavior", (event) => {
    const window = getMainWindow();
    if (!window || event.sender !== window.webContents) return "background";
    return readCloseBehavior();
  });

  ipcMain.handle("window:set-close-behavior", (event, behavior) => {
    const window = getMainWindow();
    if (!window || event.sender !== window.webContents) return readCloseBehavior();
    return writeCloseBehavior(behavior);
  });

  ipcMain.handle("window:set-titlebar-theme", (event, background, foreground) => {
    const window = getMainWindow();
    if (process.platform !== "win32" || !window || event.sender !== window.webContents || typeof window.setTitleBarOverlay !== "function") return false;
    const isHexColor = (value) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
    if (!isHexColor(background) || !isHexColor(foreground)) return false;
    window.setTitleBarOverlay({ color: background, symbolColor: foreground, height: 48 });
    return true;
  });
}

module.exports = { registerWindowIpc };
