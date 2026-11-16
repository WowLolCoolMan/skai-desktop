// Theme service (main process): reads the user's theme families from
// <userData>/themes/*.json and the theme picks from <userData>/appearance.json,
// validates them with theme-files.cjs, watches both for changes (live reload),
// and pushes the validated result to the renderer. The renderer never gets
// filesystem access; it only receives parsed, validated values.
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { parseThemeFile, MAX_FILE_BYTES } = require("./theme-files.cjs");

const MAX_THEME_FILES = 64;
const MAX_ID = 200;
const DEFAULT_PICKS = { lightTheme: "builtin:Skai/Skai Light", darkTheme: "builtin:Skai/Skai Dark" };

function createThemeService({ userDataPath, getWindow, shell }) {
  const themesDir = path.join(userDataPath, "themes");
  const appearancePath = path.join(userDataPath, "appearance.json");
  const lastGood = new Map(); // file name -> last valid family, kept while the file is broken
  let watchers = [];
  let reloadTimer = null;

  async function readPicks() {
    try {
      const stat = await fsp.stat(appearancePath);
      if (stat.size > 64 * 1024) return { picks: { ...DEFAULT_PICKS }, problem: { file: "appearance.json", key: "(file)", problem: "is larger than 64 KB" } };
      const json = JSON.parse(await fsp.readFile(appearancePath, "utf8"));
      const pick = (value, fallback) => (typeof value === "string" && value.length <= MAX_ID ? value : fallback);
      return { picks: { lightTheme: pick(json?.lightTheme, DEFAULT_PICKS.lightTheme), darkTheme: pick(json?.darkTheme, DEFAULT_PICKS.darkTheme) } };
    } catch (error) {
      if (error?.code === "ENOENT") return { picks: { ...DEFAULT_PICKS } };
      return { picks: { ...DEFAULT_PICKS }, problem: { file: "appearance.json", key: "(file)", problem: "is not valid JSON; using the default themes" } };
    }
  }

  async function readThemes() {
    const families = [];
    const problems = [];
    let names = [];
    try {
      names = (await fsp.readdir(themesDir, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json")).map((entry) => entry.name).sort();
    } catch (error) {
      if (error?.code !== "ENOENT") problems.push({ file: "themes", key: "(folder)", problem: "could not be read" });
    }
    if (names.length > MAX_THEME_FILES) problems.push({ file: "themes", key: "(folder)", problem: `only the first ${MAX_THEME_FILES} files are loaded` });
    for (const name of names.slice(0, MAX_THEME_FILES)) {
      const filePath = path.join(themesDir, name);
      let result;
      try {
        const stat = await fsp.lstat(filePath);
        // Symlinks could point anywhere on disk; theme files must be real files in the folder.
        if (!stat.isFile()) result = { family: null, problems: [{ file: name, key: "(file)", problem: "is not a regular file" }] };
        else if (stat.size > MAX_FILE_BYTES) result = { family: null, problems: [{ file: name, key: "(file)", problem: `is larger than ${MAX_FILE_BYTES / 1024} KB` }] };
        else result = parseThemeFile(await fsp.readFile(filePath, "utf8"), name);
      } catch {
        result = { family: null, problems: [{ file: name, key: "(file)", problem: "could not be read" }] };
      }
      problems.push(...result.problems);
      let family = result.family;
      if (family) lastGood.set(name, family);
      else if (lastGood.has(name)) {
        family = lastGood.get(name);
        problems.push({ file: name, key: "(file)", problem: "is invalid; still using its last good version" });
      }
      if (family) families.push({ ...family, file: name, themes: family.themes.map((theme) => ({ ...theme, id: `user:${name}/${theme.name}` })) });
    }
    for (const name of [...lastGood.keys()]) if (!names.includes(name)) lastGood.delete(name);
    return { families, problems };
  }

  async function snapshot() {
    const [{ families, problems }, { picks, problem }] = await Promise.all([readThemes(), readPicks()]);
    return { families, problems: problem ? [...problems, problem] : problems, picks, themesDir };
  }

  async function push() {
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    window.webContents.send("appearance:changed", await snapshot());
  }

  function scheduleReload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => { void push().catch(() => {}); }, 200);
  }

  function start() {
    stop();
    fs.mkdirSync(themesDir, { recursive: true });
    try { watchers.push(fs.watch(themesDir, scheduleReload)); } catch { /* no live reload; Reload themes still works */ }
    try { watchers.push(fs.watch(userDataPath, (_event, name) => { if (name === "appearance.json") scheduleReload(); })); } catch { /* ignore */ }
  }

  function stop() {
    for (const watcher of watchers) watcher.close();
    watchers = [];
    clearTimeout(reloadTimer);
  }

  async function savePicks(params) {
    const { picks } = await readPicks();
    for (const key of ["lightTheme", "darkTheme"]) {
      const value = params?.[key];
      if (value === undefined) continue;
      if (typeof value !== "string" || !value || value.length > MAX_ID) throw new Error(`${key} must be a theme id.`);
      picks[key] = value;
    }
    let existing = {};
    try { existing = JSON.parse(await fsp.readFile(appearancePath, "utf8")); } catch { /* new file */ }
    const next = { ...(existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {}), ...picks };
    await fsp.mkdir(userDataPath, { recursive: true });
    await fsp.writeFile(appearancePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return picks;
  }

  // Shell-handled bridge methods (see main.cjs agent:request).
  async function handle(method, params) {
    if (method === "appearance.getThemes") return { v: 1, ok: true, result: await snapshot() };
    if (method === "appearance.saveThemeSelection") return { v: 1, ok: true, result: await savePicks(params) };
    if (method === "appearance.openThemesFolder") {
      await fsp.mkdir(themesDir, { recursive: true });
      const error = await shell.openPath(themesDir);
      return error ? { v: 1, ok: false, error: { code: "OPEN_FAILED", message: error } } : { v: 1, ok: true, result: { path: themesDir } };
    }
    return null;
  }

  return { start, stop, handle, snapshot, themesDir, appearancePath };
}

module.exports = { createThemeService, DEFAULT_PICKS };
