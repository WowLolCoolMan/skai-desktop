// Local workspace file selection and Agent Host request IPC.
const { extractPdfAttachmentText } = require("./pdf-ocr.cjs");

function registerWorkspaceIpc({
  ipcMain, BrowserWindow, dialog, fs, path, attachmentTextExtensions,
  isBlockedAttachmentName, isPng, isJpeg, isMp4, isWebm, decodeDroppedAttachment,
  themeService, nativeTheme, requestAgent,
}) {
  ipcMain.handle("agent:request", async (event, method, params) => {
    if (method === "workspace.attachment.extract") {
      const response = await requestAgent(method, params);
      const needsOcr = (response?.ok && response.result?.ocrRequired === true)
        || (!response?.ok && /no selectable text was found in this pdf/i.test(response?.error?.message ?? ""));
      if (!needsOcr) return response;
      try {
        const extraction = await extractPdfAttachmentText({
          fileName: params?.fileName,
          content: params?.content,
          dependenciesPath: path.resolve(__dirname, "..", "node_modules"),
        });
        return {
          ...response,
          ok: true,
          error: undefined,
          result: {
            fileName: params.fileName,
            mediaType: null,
            content: extraction.content,
            ocr: extraction.ocrPages.length > 0,
            ocrPages: extraction.ocrPages,
            pageCount: extraction.pageCount,
          },
        };
      } catch (error) {
        return { ...response, ok: false, error: { code: "OCR_FAILED", message: error instanceof Error ? error.message : "Local PDF OCR failed." } };
      }
    }
    if (method === "appearance.getThemes" || method === "appearance.saveThemeSelection" || method === "appearance.openThemesFolder" || method === "appearance.editTheme" || method === "appearance.duplicateTheme" || method === "appearance.importBase16" || method === "appearance.exportTheme" || method === "appearance.saveFonts" || method === "appearance.listFonts" || method === "appearance.readCustomFont" || method === "appearance.openFontsFolder" || method === "appearance.saveAppearanceOptions" || method === "appearance.saveThemeGradient" || method === "appearance.resetAppearance") return themeService.handle(method, params);
    // Theme: follow the app's Light/Dark/System choice instead of the OS, so native
    // pieces (select popups, scrollbars, file dialogs, tray menu, window frame) match.
    if (method === "appearance.setNativeTheme") {
      const mode = params?.mode;
      if (mode !== "light" && mode !== "dark" && mode !== "system") return { v: 1, ok: false, error: { code: "INVALID_PARAMS", message: "Theme mode must be light, dark, or system." } };
      nativeTheme.themeSource = mode;
      return { v: 1, ok: true, result: { mode, dark: nativeTheme.shouldUseDarkColors } };
    }
    if (method === "workspace.pickFolder") {
      const window = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showOpenDialog(window, { properties: ["openDirectory"] });
      return { v: 1, ok: true, result: { path: result.canceled ? null : result.filePaths[0] ?? null } };
    }
    if (method === "workspace.pickConversationArchive") {
      const window = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showOpenDialog(window, { properties: ["openFile"], filters: [{ name: "Conversation archive", extensions: ["json"] }] });
      if (result.canceled || !result.filePaths[0]) return { v: 1, ok: true, result: { fileName: null, content: null } };
      const filePath = result.filePaths[0];
      if (path.extname(filePath).toLowerCase() !== ".json") throw new Error("Choose a JSON conversation archive.");
      const bytes = await fs.readFile(filePath);
      const maxBytes = 25 * 1024 * 1024;
      if (bytes.length === 0 || bytes.length > maxBytes) throw new Error("The conversation archive must be between 1 byte and 25 MB.");
      let content;
      try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, ""); }
      catch { throw new Error("The conversation archive must be valid UTF-8 JSON."); }
      return { v: 1, ok: true, result: { fileName: path.basename(filePath), content } };
    }
    if (method === "workspace.pickFiles") {
      const window = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showOpenDialog(window, { properties: ["openFile", "multiSelections"], filters: [{ name: "Chat files", extensions: ["txt", "md", "markdown", "csv", "xlsx", "json", "xml", "yaml", "yml", "toml", "html", "css", "js", "ts", "jsx", "tsx", "cs", "py", "java", "go", "rs", "c", "h", "cpp", "hpp", "sh", "sql", "log", "pdf", "png", "jpg", "jpeg", "mp4", "webm"] }] });
      if (result.canceled) return { v: 1, ok: true, result: { attachments: [] } };
      const attachments = [];
      let textCharacters = 0;
      let imageBytes = 0;
      let videoBytes = 0;
      for (const filePath of result.filePaths.slice(0, 5)) {
        const fileName = path.basename(filePath);
        const extension = path.extname(fileName).toLowerCase();
        if (isBlockedAttachmentName(fileName)) throw new Error(`That file name cannot be attached: ${fileName}`);
        const imageType = extension === ".png" ? "image/png" : [".jpg", ".jpeg"].includes(extension) ? "image/jpeg" : null;
        const isPdf = extension === ".pdf";
        const isSpreadsheet = extension === ".xlsx";
        const videoType = extension === ".mp4" ? "video/mp4" : extension === ".webm" ? "video/webm" : null;
        if (!imageType && !isPdf && !isSpreadsheet && !videoType && !attachmentTextExtensions.has(extension)) throw new Error(`That file type cannot be attached: ${fileName}`);
        const bytes = await fs.readFile(filePath);
        if (bytes.length > (isPdf || isSpreadsheet || videoType ? 20 * 1024 * 1024 : 2 * 1024 * 1024)) throw new Error(`The selected file is too large: ${fileName}`);
        if (imageType) {
          if (!(imageType === "image/png" ? isPng(bytes) : isJpeg(bytes))) throw new Error(`The selected image is not valid: ${fileName}`);
          imageBytes += bytes.length;
          if (imageBytes > 6 * 1024 * 1024) throw new Error("Selected images exceed the combined size limit.");
          attachments.push({ fileName, mediaType: imageType, content: bytes.toString("base64") });
        } else if (isPdf) {
          attachments.push({ fileName, mediaType: null, content: bytes.toString("base64") });
        } else if (videoType) {
          if (!(videoType === "video/mp4" ? isMp4(bytes) : isWebm(bytes))) throw new Error(`The selected video is not a valid ${videoType} file: ${fileName}`);
          videoBytes += bytes.length;
          if (videoBytes > 40 * 1024 * 1024) throw new Error("Selected videos exceed the combined 40 MB limit.");
          attachments.push({ fileName, mediaType: videoType, content: bytes.toString("base64") });
        } else if (isSpreadsheet) {
          if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error(`The selected spreadsheet is not a valid Open XML file: ${fileName}`);
          const extracted = await requestAgent("workspace.attachment.extractSpreadsheet", { fileName, content: bytes.toString("base64") });
          if (!extracted.ok) throw new Error(extracted.error?.message ?? `Could not extract ${fileName}.`);
          const content = extracted.result?.content ?? "";
          textCharacters += content.length;
          if (textCharacters > 48_000) throw new Error("Selected text files exceed the combined character limit.");
          attachments.push({ fileName, mediaType: null, content });
        } else {
          const content = bytes.toString("utf8").slice(0, 16000);
          textCharacters += content.length;
          if (textCharacters > 48_000) throw new Error("Selected text files exceed the combined character limit.");
          attachments.push({ fileName, mediaType: null, content });
        }
      }
      return { v: 1, ok: true, result: { attachments } };
    }
    if (method === "workspace.importDroppedFiles") {
      if (!params || !Array.isArray(params.attachments)) throw new Error("Dropped attachments were not provided.");
      const attachments = [];
      let textCharacters = 0;
      let imageBytes = 0;
      for (const candidate of params.attachments.slice(0, 5)) {
        const attachment = decodeDroppedAttachment(candidate);
        textCharacters += attachment.textLength;
        imageBytes += attachment.mediaType ? attachment.byteLength : 0;
        if (textCharacters > 48_000) throw new Error("Dropped text files exceed the combined character limit.");
        if (imageBytes > 6 * 1024 * 1024) throw new Error("Dropped images exceed the combined size limit.");
        const { byteLength, textLength, ...safeAttachment } = attachment;
        attachments.push(safeAttachment);
      }
      return { v: 1, ok: true, result: { attachments } };
    }
    return requestAgent(method, params);
  });
}

module.exports = { registerWorkspaceIpc };
