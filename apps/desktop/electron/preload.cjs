const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("skaiAgent", {
  request: (method, params) => ipcRenderer.invoke("agent:request", method, params),
  media: {
    createLocalUrl: (mediaType, content) => ipcRenderer.invoke("media:create-local-url", { mediaType: String(mediaType), content: String(content) }),
    revokeLocalUrl: (url) => ipcRenderer.invoke("media:revoke-local-url", String(url)),
  },
  onTrayOpenConversation: (handler) => {
    const listener = (_event, id) => handler(String(id));
    ipcRenderer.on("tray:open-conversation", listener);
    return () => ipcRenderer.removeListener("tray:open-conversation", listener);
  },
  onTrayNewChat: (handler) => {
    const listener = () => handler();
    ipcRenderer.on("tray:new-chat", listener);
    return () => ipcRenderer.removeListener("tray:new-chat", listener);
  },
  window: {
    platform: process.platform,
    onCloseRequested: (handler) => {
      const listener = (_event, request) => handler({ trayAvailable: Boolean(request?.trayAvailable) });
      ipcRenderer.on("window:close-requested", listener);
      return () => ipcRenderer.removeListener("window:close-requested", listener);
    },
    respondToClose: (choice, remember) => ipcRenderer.send("window:close-choice", { choice: String(choice), remember: Boolean(remember) }),
    getCloseBehavior: () => ipcRenderer.invoke("window:get-close-behavior"),
    setCloseBehavior: (behavior) => ipcRenderer.invoke("window:set-close-behavior", String(behavior)),
  },
  updates: {
    check: () => ipcRenderer.invoke("updates:check"),
    state: () => ipcRenderer.invoke("updates:get-state"),
    open: (url) => ipcRenderer.invoke("updates:open", String(url)),
    enabled: () => ipcRenderer.invoke("updates:enabled"),
    setEnabled: (enabled) => ipcRenderer.invoke("updates:set-enabled", Boolean(enabled)),
    install: () => ipcRenderer.invoke("updates:install"),
    cancelDownload: () => ipcRenderer.invoke("updates:cancel-download"),
    retry: () => ipcRenderer.invoke("updates:retry"),
    onState: (handler) => {
      const listener = (_event, result) => handler(result);
      ipcRenderer.on("updates:state", listener);
      return () => ipcRenderer.removeListener("updates:state", listener);
    },
    onAvailable: (handler) => {
      const listener = (_event, result) => handler(result);
      ipcRenderer.on("updates:available", listener);
      return () => ipcRenderer.removeListener("updates:available", listener);
    },
  },
  // Theme: validated theme families and picks pushed by the main process on live reload.
  appearance: {
    onChanged: (handler) => {
      const listener = (_event, snapshot) => handler(snapshot);
      ipcRenderer.on("appearance:changed", listener);
      return () => ipcRenderer.removeListener("appearance:changed", listener);
    },
  },
  pluginDownloads: {
    openFolder: () => ipcRenderer.invoke("plugins:open-downloads"),
  },
  pet: {
    interactionDemoAvailable: process.platform === "win32",
    setVisible: (visible) => ipcRenderer.send("pet:set-visible", Boolean(visible)),
    setMotion: (settings) => ipcRenderer.send("pet:set-motion", settings),
    setBehaviorSettings: (settings) => ipcRenderer.send("pet:set-behavior", settings),
    setState: (state) => ipcRenderer.send("pet:set-state", state),
    beginDrag: (point) => ipcRenderer.send("pet:drag-start", point),
    moveDrag: (point) => ipcRenderer.send("pet:drag-move", point),
    endDrag: () => ipcRenderer.send("pet:drag-end"),
    hide: () => ipcRenderer.send("pet:set-visible", false),
    onMessage: (handler) => {
      const listener = (_event, message) => handler(message);
      ipcRenderer.on("pet:message", listener);
      return () => ipcRenderer.removeListener("pet:message", listener);
    },
    onVisibilityChange: (handler) => {
      const listener = (_event, visible) => handler(Boolean(visible));
      ipcRenderer.on("pet:visibility", listener);
      return () => ipcRenderer.removeListener("pet:visibility", listener);
    },
    onMotionChange: (handler) => {
      const listener = (_event, settings) => handler(settings);
      ipcRenderer.on("pet:motion", listener);
      return () => ipcRenderer.removeListener("pet:motion", listener);
    },
    onActivityChange: (handler) => {
      const listener = (_event, activity) => handler(activity);
      ipcRenderer.on("pet:activity", listener);
      return () => ipcRenderer.removeListener("pet:activity", listener);
    },
    onEntrance: (handler) => {
      const listener = (_event, entering) => handler(Boolean(entering));
      ipcRenderer.on("pet:entrance", listener);
      return () => ipcRenderer.removeListener("pet:entrance", listener);
    },
  },
  tray: {
    refresh: () => ipcRenderer.send("tray:refresh"),
    onNewChat: (listener) => {
      const handler = () => listener();
      ipcRenderer.on("tray:new-chat", handler);
      return () => ipcRenderer.removeListener("tray:new-chat", handler);
    },
    onOpenConversation: (listener) => {
      const handler = (_event, id) => listener(id);
      ipcRenderer.on("tray:open-conversation", handler);
      return () => ipcRenderer.removeListener("tray:open-conversation", handler);
    },
    onNavigate: (listener) => {
      const handler = (_event, route) => listener(route);
      ipcRenderer.on("tray:navigate", handler);
      return () => ipcRenderer.removeListener("tray:navigate", handler);
    },
  },
});
