function registerPetIpc({
  ipcMain,
  BrowserWindow,
  getPetWindow,
  canPositionWindows,
  onSetVisible,
  onSetMotion,
  onSetBehavior,
  onSetActivity,
  onDragStart,
  onDragMove,
  onDragEnd,
}) {
  const senderWindow = (event) => BrowserWindow.fromWebContents(event.sender);
  const isPetSender = (event) => senderWindow(event) === getPetWindow();

  ipcMain.on("pet:set-visible", (event, visible) => {
    if (senderWindow(event)) onSetVisible(Boolean(visible));
  });

  ipcMain.on("pet:set-motion", (event, settings) => {
    if (!senderWindow(event) || !settings || typeof settings !== "object") return;
    onSetMotion(settings);
  });

  ipcMain.on("pet:set-behavior", (event, settings) => {
    if (isPetSender(event)) onSetBehavior(settings);
  });

  ipcMain.on("pet:set-state", (event, state) => {
    if (!senderWindow(event)) return;
    const allowedStates = new Set(["idle", "thinking", "coding", "coding_malicious", "stuck", "needs-attention"]);
    if (typeof state === "string" && allowedStates.has(state)) onSetActivity(state);
  });

  ipcMain.on("pet:drag-start", (event, point) => {
    if (!canPositionWindows || !isPetSender(event) || !isPoint(point)) return;
    onDragStart(point);
  });

  ipcMain.on("pet:drag-move", (event, point) => {
    if (!isPetSender(event) || !isPoint(point)) return;
    onDragMove(point);
  });

  ipcMain.on("pet:drag-end", (event) => {
    if (isPetSender(event)) onDragEnd();
  });
}

function isPoint(point) {
  return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y));
}

module.exports = { registerPetIpc };
