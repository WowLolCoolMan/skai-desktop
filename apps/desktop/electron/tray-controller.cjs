function createTrayController({
  app,
  Tray,
  Menu,
  nativeImage,
  process,
  requestAgent,
  getPetWindow,
  setPetVisible,
  showMainWindow,
  sendTrayEvent,
  resolveTrayIconPath,
  isQuitting,
}) {
  let tray;
  let refreshSequence = 0;

  function recentConversationMenuItems(conversations) {
    if (!conversations.length) return [{ label: "No recent chats", enabled: false }];
    return conversations.slice(0, 8).map((conversation) => {
      const title = String(conversation.title || "Untitled chat").replace(/\s+/g, " ").trim().slice(0, 72) || "Untitled chat";
      const project = conversation.projectName ? ` · ${String(conversation.projectName).slice(0, 28)}` : "";
      return { label: `${title}${project}`, click: () => sendTrayEvent("tray:open-conversation", String(conversation.id)) };
    });
  }

  function setTrayMenu(conversations = []) {
    if (!tray || tray.isDestroyed()) return;
    const petWindow = getPetWindow();
    const petVisible = Boolean(petWindow && !petWindow.isDestroyed() && petWindow.isVisible());
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Show Skai Desktop", click: showMainWindow },
      { label: "New chat", click: () => sendTrayEvent("tray:new-chat") },
      { type: "separator" },
      { label: "Recent chats", submenu: recentConversationMenuItems(conversations) },
      { type: "separator" },
      { label: petVisible ? "Hide all pets" : "Show all pets", click: () => setPetVisible(!petVisible) },
      { type: "separator" },
      { label: "Quit Skai Desktop", click: () => app.quit() },
    ]));
  }

  async function refreshTrayMenu(popUp = false) {
    if (!tray || tray.isDestroyed()) return;
    const sequence = ++refreshSequence;
    const response = await requestAgent("conversations.list", { includeArchived: false });
    if (sequence !== refreshSequence || !tray || tray.isDestroyed()) return;
    const conversations = response.ok && Array.isArray(response.result) ? response.result : [];
    setTrayMenu(conversations);
    if (popUp && !isQuitting()) tray.popUpContextMenu();
  }

  function createTray() {
    if (tray && !tray.isDestroyed()) return tray;
    const iconPath = resolveTrayIconPath();
    const source = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
    tray = new Tray(process.platform === "win32" ? source.resize({ width: 16, height: 16 }) : source);
    tray.setToolTip("Skai Desktop");
    setTrayMenu();
    tray.on("click", showMainWindow);
    tray.on("right-click", () => { void refreshTrayMenu(true); });
    tray.on("double-click", showMainWindow);
    void refreshTrayMenu();
    return tray;
  }

  return { createTray, refreshTrayMenu };
}

module.exports = { createTrayController };
