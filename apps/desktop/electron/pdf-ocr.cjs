"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_OCR_PAGES = 20;
const MAX_PAGE_PIXELS = 2_500_000;

async function extractScannedPdfText({ fileName, content, dependenciesPath, maxCharacters = 16_000 }) {
  if (typeof fileName !== "string" || path.extname(fileName).toLowerCase() !== ".pdf") throw new Error("Choose a PDF file to read with local OCR.");
  if (!Number.isInteger(maxCharacters) || maxCharacters < 1 || maxCharacters > 16_000) throw new Error("The local OCR text limit is invalid.");
  if (typeof content !== "string" || content.length === 0 || content.length > Math.ceil(MAX_PDF_BYTES / 3) * 4 + 4 || content.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(content)) throw new Error("The PDF attachment encoding is invalid.");
  const bytes = Buffer.from(content, "base64");
  if (bytes.length === 0 || bytes.length > MAX_PDF_BYTES || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("The PDF attachment is invalid or exceeds the 20 MB local OCR limit.");

  const modules = path.resolve(dependenciesPath);
  const moduleFile = (name, ...parts) => {
    const target = path.join(modules, name, ...parts);
    if (!fs.existsSync(target)) throw new Error("The bundled local OCR runtime is incomplete. Repair or reinstall Skai Desktop, then try again.");
    return target;
  };
  const { createCanvas } = require(moduleFile("@napi-rs", "canvas", "index.js"));
  const { createWorker } = require(moduleFile("tesseract.js", "src", "index.js"));
  const pdfjsPath = moduleFile("pdfjs-dist", "legacy", "build", "pdf.mjs");
  const corePath = path.dirname(moduleFile("tesseract.js-core", "tesseract-core-lstm.wasm.js"));
  const languagePath = path.dirname(moduleFile("@tesseract.js-data", "eng", "4.0.0_best_int", "eng.traineddata.gz"));
  const pdfjs = await import(pathToFileURL(pdfjsPath).href);
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false, enableXfa: false, stopAtErrors: true, verbosity: 0 });
  let document;
  let worker;
  try {
    document = await loadingTask.promise;
    if (document.numPages < 1) throw new Error("The PDF does not contain any pages.");
    worker = await createWorker("eng", 1, {
      corePath,
      langPath: languagePath,
      gzip: true,
      cacheMethod: "none",
      logger: () => {},
    });

    const output = [];
    let outputLength = 0;
    const pageLimit = Math.min(document.numPages, MAX_OCR_PAGES);
    for (let pageNumber = 1; pageNumber <= pageLimit && outputLength < maxCharacters; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const initialViewport = page.getViewport({ scale: 1 });
      const pageArea = Math.max(1, initialViewport.width * initialViewport.height);
      const scale = Math.min(2, Math.sqrt(MAX_PAGE_PIXELS / pageArea));
      const viewport = page.getViewport({ scale });
      const width = Math.max(1, Math.ceil(viewport.width));
      const height = Math.max(1, Math.ceil(viewport.height));
      const canvas = createCanvas(width, height);
      const context = canvas.getContext("2d");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, width, height);
      await page.render({ canvasContext: context, viewport, background: "#fff" }).promise;
      const result = await worker.recognize(canvas.toBuffer("image/png"));
      const text = String(result.data?.text ?? "").replace(/\r\n?/g, "\n").trim();
      page.cleanup();
      if (!text) continue;
      const section = `[Page ${pageNumber}]\n${text}`;
      const room = maxCharacters - outputLength;
      const bounded = section.length <= room ? section : section.slice(0, room);
      output.push(bounded);
      outputLength += bounded.length;
    }
    if (document.numPages > pageLimit && outputLength < maxCharacters) {
      const notice = `\n[Local OCR included the first ${pageLimit} pages only.]`;
      output.push(notice.slice(0, maxCharacters - outputLength));
    }
    const extracted = output.join("\n\n").slice(0, maxCharacters).trim();
    if (!extracted) throw new Error("No readable English text was found in the scanned PDF.");
    return extracted;
  } catch (error) {
    if (error instanceof Error && /^(?:The PDF|No readable English text|The bundled local OCR)/.test(error.message)) throw error;
    throw new Error("Skai could not read this scanned PDF with its bundled local English OCR engine. Try a clearer or smaller scan.");
  } finally {
    if (worker) await worker.terminate().catch(() => {});
    await loadingTask.destroy().catch(() => {});
  }
}

module.exports = { extractScannedPdfText, MAX_OCR_PAGES };
