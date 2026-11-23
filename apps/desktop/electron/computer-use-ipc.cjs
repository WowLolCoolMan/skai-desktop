const { performWindowsAction } = require("./computer-use.cjs");

function registerComputerUseIpc({ ipcMain, desktopCapturer, screen, process, getMainWindow }) {
  let operation = Promise.resolve();
  const withSkaiMinimized = async (callback) => {
    const window = getMainWindow?.();
    const shouldRestore = Boolean(window && !window.isDestroyed() && !window.isMinimized());
    if (shouldRestore) {
      window.minimize();
      await new Promise((resolve) => setTimeout(resolve, 220));
    }
    try { return await callback(); }
    finally {
      if (shouldRestore && !window.isDestroyed()) {
        window.restore();
        window.focus();
      }
    }
  };
  const serialize = (callback) => {
    const result = operation.then(callback, callback);
    operation = result.then(() => undefined, () => undefined);
    return result;
  };
  ipcMain.handle("computer:capture", async () => {
    return serialize(() => withSkaiMinimized(async () => {
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 1280, height: 800 },
        fetchWindowIcons: false,
      });
      return sources.map((source) => {
        const display = screen.getAllDisplays().find((item) => String(item.id) === source.display_id);
        const thumbnail = source.thumbnail;
        return {
          id: source.id,
          name: source.name,
          displayId: source.display_id,
          display: display ? { x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height } : null,
          previewWidth: thumbnail.getSize().width,
          previewHeight: thumbnail.getSize().height,
          content: thumbnail.toPNG().toString("base64"),
          mediaType: "image/png",
        };
      });
    }));
  });

  ipcMain.handle("computer:action", async (_event, request) => {
    if (process.platform !== "win32") throw new Error("Computer input is currently supported on Windows only.");
    const display = screen.getAllDisplays().find((item) => String(item.id) === String(request?.displayId));
    if (!display) throw new Error("The selected display is no longer available. Capture the screen again.");
    return serialize(() => withSkaiMinimized(() => performWindowsAction(request, { x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height })));
  });
}

module.exports = { registerComputerUseIpc };
