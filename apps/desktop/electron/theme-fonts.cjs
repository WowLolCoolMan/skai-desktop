// Theme fonts (main process): the user's custom font files in <userData>/fonts/
// and the installed-font fallback list. Font files are untrusted: only regular
// files with a font extension, a real font signature and a size cap are read,
// and their bytes are sent to the renderer, which loads them with the FontFace
// API (no file:// or remote URLs, so the CSP and audit:local-only stay as they are).
const fsp = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");

const MAX_FONT_BYTES = 10 * 1024 * 1024;
const MAX_FONT_FILES = 32;
const MAX_TOTAL_BYTES = 40 * 1024 * 1024;
const EXTENSIONS = new Set([".ttf", ".otf", ".woff2", ".woff"]);
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,62}$/;

// sfnt/WOFF signatures: TrueType 00010000 or "true", OpenType "OTTO", WOFF "wOFF", WOFF2 "wOF2".
function hasFontSignature(bytes) {
  if (!bytes || bytes.length < 12) return false;
  const tag = bytes.subarray(0, 4);
  return (tag[0] === 0 && tag[1] === 1 && tag[2] === 0 && tag[3] === 0) || ["true", "OTTO", "wOFF", "wOF2"].includes(tag.toString("latin1"));
}

// Family name for a custom font comes from its file name ("Inter-Variable.ttf" → "Inter Variable"),
// limited to the same safe characters as theme font names.
function familyFromFileName(file) {
  const stem = path.basename(file, path.extname(file)).replace(/[^A-Za-z0-9 _.-]+/g, " ").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 63);
  return SAFE_NAME.test(stem) ? stem : null;
}

async function listCustomFonts(fontsDir) {
  const fonts = [];
  const problems = [];
  let entries = [];
  try { entries = await fsp.readdir(fontsDir, { withFileTypes: true }); } catch (error) { if (error?.code !== "ENOENT") problems.push({ file: "fonts", key: "(folder)", problem: "could not be read" }); }
  const files = entries.filter((entry) => EXTENSIONS.has(path.extname(entry.name).toLowerCase())).map((entry) => entry.name).sort();
  if (files.length > MAX_FONT_FILES) problems.push({ file: "fonts", key: "(folder)", problem: `only the first ${MAX_FONT_FILES} font files are loaded` });
  let total = 0;
  for (const file of files.slice(0, MAX_FONT_FILES)) {
    const family = familyFromFileName(file);
    if (!family) { problems.push({ file, key: "(file)", problem: "has a name that can't be used as a font family; rename it with letters, digits, spaces, - or _" }); continue; }
    try {
      const stat = await fsp.lstat(path.join(fontsDir, file));
      if (!stat.isFile()) { problems.push({ file, key: "(file)", problem: "is not a regular file" }); continue; }
      if (stat.size > MAX_FONT_BYTES) { problems.push({ file, key: "(file)", problem: `is larger than ${MAX_FONT_BYTES / 1024 / 1024} MB` }); continue; }
      if (total + stat.size > MAX_TOTAL_BYTES) { problems.push({ file, key: "(file)", problem: "was skipped: custom fonts are limited to 40 MB in total" }); continue; }
      const handle = await fsp.open(path.join(fontsDir, file), "r");
      const head = Buffer.alloc(12);
      try { await handle.read(head, 0, 12, 0); } finally { await handle.close(); }
      if (!hasFontSignature(head)) { problems.push({ file, key: "(file)", problem: "is not a font file (TrueType, OpenType, WOFF or WOFF2)" }); continue; }
      total += stat.size;
      fonts.push({ family, file, bytes: stat.size });
    } catch {
      problems.push({ file, key: "(file)", problem: "could not be read" });
    }
  }
  return { fonts, problems };
}

async function readCustomFont(fontsDir, file) {
  if (typeof file !== "string" || file !== path.basename(file) || !EXTENSIONS.has(path.extname(file).toLowerCase())) throw new Error("Unknown font file.");
  const filePath = path.join(fontsDir, file);
  const stat = await fsp.lstat(filePath);
  if (!stat.isFile() || stat.size > MAX_FONT_BYTES) throw new Error("That font file can't be used.");
  const bytes = await fsp.readFile(filePath);
  if (!hasFontSignature(bytes)) throw new Error("That file is not a font.");
  return bytes.toString("base64");
}

// Fallback for the installed-font list where the renderer's queryLocalFonts()
// isn't available: fontconfig (Linux, and macOS with fontconfig installed).
// spacing=100 marks monospace fonts.
function listInstalledFonts() {
  return new Promise((resolve) => {
    execFile("fc-list", ["--format", "%{family[0]}|%{spacing}\n"], { timeout: 8000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error) { resolve({ fonts: [], source: "unavailable" }); return; }
      const byFamily = new Map();
      for (const line of String(stdout).split("\n")) {
        const [family, spacing] = line.split("|");
        const name = family?.trim();
        if (!name || !SAFE_NAME.test(name)) continue;
        byFamily.set(name, (byFamily.get(name) ?? false) || spacing?.trim() === "100");
      }
      resolve({ fonts: [...byFamily].map(([family, monospace]) => ({ family, monospace })).sort((a, b) => a.family.localeCompare(b.family)).slice(0, 2000), source: "fontconfig" });
    });
  });
}

module.exports = { listCustomFonts, readCustomFont, listInstalledFonts, hasFontSignature, familyFromFileName, MAX_FONT_BYTES };
