function registerLocalMediaIpc({ ipcMain, app, fs, fsSync, path, pathToFileURL, randomUUID, isMp4, isWebm, isAudioSignature }) {
  const localMedia = new Map();
  ipcMain.handle("media:create-local-url", (event, payload) => {
    const mediaTypes = ["video/mp4", "video/webm", "audio/mp4", "audio/webm", "audio/mpeg", "audio/wav", "audio/ogg"];
    if (!payload || !mediaTypes.includes(payload.mediaType) || typeof payload.content !== "string" || payload.content.length > 28_000_000 || payload.content.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload.content))
      throw new Error("The local media payload is invalid or too large.");
    const bytes = Buffer.from(payload.content, "base64");
    const validSignature = payload.mediaType === "video/mp4" ? isMp4(bytes) : payload.mediaType === "video/webm" ? isWebm(bytes) : isAudioSignature(bytes, payload.mediaType);
    if (!bytes.length || bytes.length > 20 * 1024 * 1024 || !validSignature)
      throw new Error("The local media payload failed its size or signature check.");
    const extension = { "video/mp4": ".mp4", "video/webm": ".webm", "audio/mp4": ".m4a", "audio/webm": ".webm", "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/ogg": ".ogg" }[payload.mediaType];
    const directory = path.join(app.getPath("userData"), "media-samples");
    fsSync.mkdirSync(directory, { recursive: true });
    const filePath = path.join(directory, `${randomUUID()}${extension}`);
    fsSync.writeFileSync(filePath, bytes, { mode: 0o600, flag: "wx" });
    const url = pathToFileURL(filePath).href;
    localMedia.set(url, { filePath, webContentsId: event.sender.id });
    return url;
  });
  ipcMain.handle("media:revoke-local-url", (event, url) => {
    try {
      const entry = localMedia.get(String(url));
      if (entry?.webContentsId === event.sender.id) {
        localMedia.delete(String(url));
        void fs.unlink(entry.filePath).catch(() => {});
      }
    } catch { /* Ignore malformed cleanup requests. */ }
    return true;
  });
}

module.exports = { registerLocalMediaIpc };
