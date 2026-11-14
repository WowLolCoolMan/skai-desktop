const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("serverRockAgent", {
  request: (method, params) => ipcRenderer.invoke("agent:request", method, params),
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
  pet: {
    setVisible: (visible) => ipcRenderer.send("pet:set-visible", Boolean(visible)),
    setMotion: (settings) => ipcRenderer.send("pet:set-motion", settings),
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
  },
});
