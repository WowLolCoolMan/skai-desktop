function registerClipboardIpc({ ipcMain, clipboard, getMainWindow }) {
  ipcMain.handle("clipboard:write-text", (event, value) => {
    const window = getMainWindow();
    if (!window || event.sender !== window.webContents || typeof value !== "string" || value.length > 100_000) return false;
    clipboard.writeText(value);
    return true;
  });
}

module.exports = { registerClipboardIpc };
