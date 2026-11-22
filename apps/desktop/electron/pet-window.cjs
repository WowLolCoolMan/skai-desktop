function createPetWindowController({
  BrowserWindow,
  process,
  displayBackend,
  isWaylandSession,
  x11HasCompositor,
  canPositionWindows,
  getPetWindow,
  setPetWindow,
  getSavedState,
  getPetBounds,
  getIsQuitting,
  getPetOpaque,
  setPetOpaque,
  setPetReady,
  onMoved,
  onLoaded,
  onClose,
  onClosed,
  onReadyToShow,
  rendererRoot,
  getRendererUrl,
  getRigPetEnabled,
  preloadPath,
  rendererIndexPath,
  logger = console,
}) {
  async function resolveSurface() {
    if (process.platform !== "linux" || displayBackend.backend !== "x11" || isWaylandSession(process.env)) return;
    const composited = await x11HasCompositor();
    setPetOpaque(composited === false);
    if (getPetOpaque()) logger.log("[windowing] no X11 compositor detected; Percy uses an opaque window.");
  }

  function create() {
    const current = getPetWindow();
    if (current && !current.isDestroyed()) return current;
    const savedState = getSavedState();
    const opaque = getPetOpaque();
    setPetReady(false);
    const petWindow = new BrowserWindow({
      // Native Wayland ignores client-chosen positions; let the compositor place it.
      ...(canPositionWindows ? getPetBounds() : { width: 220, height: 190 }),
      // _NET_WM_WINDOW_TYPE_TOOLBAR makes tiling X11 window managers float Percy.
      ...(process.platform === "linux" ? { type: "toolbar" } : {}),
      title: "Skai Desktop · Pets",
      transparent: !opaque,
      frame: false,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      closable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      backgroundColor: opaque ? "#10141d" : "#00000000",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // Keep sprite animation running while the unfocused companion is occluded.
        backgroundThrottling: false,
        preload: preloadPath,
      },
    });
    setPetWindow(petWindow);
    petWindow.setAlwaysOnTop(true, "floating");
    petWindow.on("moved", onMoved);
    petWindow.webContents.on("did-finish-load", onLoaded);
    // Some window managers close windows directly despite closable:false.
    petWindow.on("close", (event) => {
      if (getIsQuitting()) return;
      event.preventDefault();
      onClose();
    });
    petWindow.on("closed", onClosed);
    if (typeof petWindow.setVisibleOnAllWorkspaces === "function") {
      petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }

    const petQuery = {
      pet: "1",
      ...(getRigPetEnabled() ? { rig: "1" } : {}),
      ...(canPositionWindows ? {} : { drag: "compositor" }),
      ...(opaque ? { surface: "opaque" } : {}),
    };
    const devUrl = getRendererUrl();
    if (devUrl) {
      const url = new URL(devUrl);
      for (const [key, value] of Object.entries(petQuery)) url.searchParams.set(key, value);
      void petWindow.loadURL(url.toString());
    } else {
      void petWindow.loadFile(rendererIndexPath, { query: petQuery });
    }
    petWindow.once("ready-to-show", () => onReadyToShow(savedState));
    return petWindow;
  }

  return { create, resolveSurface };
}

module.exports = { createPetWindowController };
