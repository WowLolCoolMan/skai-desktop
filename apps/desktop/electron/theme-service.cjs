// Theme service (main process): reads the user's theme families from
// <userData>/themes/*.json and the theme picks from <userData>/appearance.json,
// validates them with theme-files.cjs, watches both for changes (live reload),
// and pushes the validated result to the renderer. The renderer never gets
// filesystem access; it only receives parsed, validated values.
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { parseThemeFile, parseFont, parseGradient, GRADIENT_SURFACES, validateThemeFamily, buildSchema, colorKeyForToken, FONT_ROLES, MAX_FILE_BYTES } = require("./theme-files.cjs");
const { listCustomFonts, readCustomFont, listInstalledFonts } = require("./theme-fonts.cjs");
const { base16ToFamily } = require("./theme-base16.cjs");

const MAX_THEME_FILES = 64;
const MAX_ID = 200;
const SCHEMA_FILE = "theme.schema.json";
const DEFAULT_PICKS = { lightTheme: "builtin:Skai/Skai Light", darkTheme: "builtin:Skai/Skai Dark" };

function createThemeService({ userDataPath, getWindow, shell, dialog }) {
  const themesDir = path.join(userDataPath, "themes");
  const appearancePath = path.join(userDataPath, "appearance.json");
  const fontsDir = path.join(userDataPath, "fonts");
  const lastGood = new Map(); // file name -> last valid family, kept while the file is broken
  let watchers = [];
  let reloadTimer = null;

  // appearance.json: theme picks plus the user's font role overrides (validated like theme fonts).
  async function readAppearance() {
    const defaults = { picks: { ...DEFAULT_PICKS }, fonts: {}, animateBackground: false };
    let json;
    try {
      const stat = await fsp.stat(appearancePath);
      if (stat.size > 64 * 1024) return { ...defaults, problems: [{ file: "appearance.json", key: "(file)", problem: "is larger than 64 KB" }] };
      json = JSON.parse(await fsp.readFile(appearancePath, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return { ...defaults, problems: [] };
      return { ...defaults, problems: [{ file: "appearance.json", key: "(file)", problem: "is not valid JSON; using the default themes" }] };
    }
    const problems = [];
    const pick = (value, fallback) => (typeof value === "string" && value.length <= MAX_ID ? value : fallback);
    const fonts = {};
    for (const [role, value] of Object.entries(json?.fonts && typeof json.fonts === "object" ? json.fonts : {})) {
      const font = FONT_ROLES.includes(role) ? parseFont(value) : null;
      if (font) fonts[role] = font;
      else problems.push({ file: "appearance.json", key: `fonts.${role}`, problem: "was ignored (unknown role or invalid values)" });
    }
    return { picks: { lightTheme: pick(json?.lightTheme, DEFAULT_PICKS.lightTheme), darkTheme: pick(json?.darkTheme, DEFAULT_PICKS.darkTheme) }, fonts, animateBackground: json?.animateBackground === true, problems };
  }
  const readPicks = async () => ({ picks: (await readAppearance()).picks });

  async function writeAppearance(patch) {
    let existing = {};
    try { existing = JSON.parse(await fsp.readFile(appearancePath, "utf8")); } catch { /* new file */ }
    const next = { ...(existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {}), ...patch };
    await fsp.mkdir(userDataPath, { recursive: true });
    await fsp.writeFile(appearancePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return next;
  }

  async function readThemes() {
    const families = [];
    const problems = [];
    let names = [];
    try {
      names = (await fsp.readdir(themesDir, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json") && entry.name !== SCHEMA_FILE).map((entry) => entry.name).sort();
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
    const [{ families, problems }, appearance, custom] = await Promise.all([readThemes(), readAppearance(), listCustomFonts(fontsDir)]);
    return { families, problems: [...problems, ...appearance.problems, ...custom.problems], picks: appearance.picks, fonts: appearance.fonts, animateBackground: appearance.animateBackground, customFonts: custom.fonts, themesDir, fontsDir };
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
    // A schema copy next to the themes gives editors completion ("$schema": "./theme.schema.json").
    try { fs.writeFileSync(path.join(themesDir, SCHEMA_FILE), `${JSON.stringify(buildSchema(), null, 2)}\n`); } catch { /* optional */ }
    fs.mkdirSync(fontsDir, { recursive: true });
    try { watchers.push(fs.watch(themesDir, scheduleReload)); } catch { /* no live reload; Reload themes still works */ }
    try { watchers.push(fs.watch(fontsDir, scheduleReload)); } catch { /* ignore */ }
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
    await writeAppearance(picks);
    return picks;
  }

  // Font role overrides from Appearance: { role: font | null } (null clears the role).
  async function saveFonts(params) {
    const { fonts } = await readAppearance();
    for (const [role, value] of Object.entries(params?.fonts && typeof params.fonts === "object" ? params.fonts : {})) {
      if (!FONT_ROLES.includes(role)) throw new Error(`Unknown font role: ${role}`);
      if (value === null) { delete fonts[role]; continue; }
      const font = parseFont(value);
      if (!font) throw new Error(`The ${role} font settings are not valid.`);
      fonts[role] = font;
    }
    await writeAppearance({ fonts });
    return fonts;
  }

  // Theme: turn a renderer theme definition (tokens) back into theme-file JSON.
  // Everything is re-validated before it touches the disk.
  function familyFromDefinition(definition, familyName, nameOverride) {
    if (!definition || typeof definition !== "object") throw new Error("A theme is required.");
    const colors = {};
    for (const [token, value] of Object.entries(definition.colors ?? {})) {
      const key = colorKeyForToken(token);
      if (key) colors[key] = value;
    }
    const gradients = {};
    for (const [surface, gradient] of Object.entries(definition.gradients ?? {})) gradients[surface] = gradient?.gradient === "solid" ? gradient.color : gradient;
    const theme = { name: nameOverride ?? definition.name, appearance: definition.appearance, colors, gradients, fonts: definition.fonts ?? {} };
    const { family, problems } = validateThemeFamily({ name: familyName, author: "", license: "", themes: [theme] }, "theme");
    // Strict: write only if every value passed validation (nothing silently dropped).
    if (!family || problems.length) throw new Error(problems[0] ? `${problems[0].key} ${problems[0].problem}` : "The theme is not valid.");
    return { $schema: `./${SCHEMA_FILE}`, name: family.name, author: "", license: "Your own theme", themes: [{ ...theme, colors, gradients }] };
  }

  const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "theme";
  async function uniqueFile(base) {
    for (let index = 1; index < 1000; index += 1) {
      const name = `${base}${index === 1 ? "" : `-${index}`}.json`;
      try { await fsp.access(path.join(themesDir, name)); } catch { return name; }
    }
    throw new Error("Too many theme files with that name.");
  }
  async function writeNewFamily(family, base) {
    await fsp.mkdir(themesDir, { recursive: true });
    const file = await uniqueFile(base);
    await fsp.writeFile(path.join(themesDir, file), `${JSON.stringify(family, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    scheduleReload();
    return { file, id: `user:${file}/${family.themes[0].name}` };
  }
  // A user theme id is "user:<file>/<theme name>"; the file must be a plain name in the folder.
  function userFile(id) {
    const match = /^user:([^/\\]+\.json)\//.exec(String(id ?? ""));
    if (!match || match[1] !== path.basename(match[1]) || match[1] === SCHEMA_FILE) return null;
    return path.join(themesDir, match[1]);
  }

  // Shell-handled bridge methods (see main.cjs agent:request).
  async function handle(method, params) {
    if (method === "appearance.editTheme") {
      const file = userFile(params?.id);
      if (!file) return { v: 1, ok: false, error: { code: "BUILT_IN_THEME", message: "Built-in themes are read-only. Duplicate it as your theme first." } };
      const error = await shell.openPath(file);
      return error ? { v: 1, ok: false, error: { code: "OPEN_FAILED", message: error } } : { v: 1, ok: true, result: { path: file } };
    }
    if (method === "appearance.duplicateTheme") {
      const name = `${String(params?.theme?.name ?? "Theme").slice(0, 52)} (mine)`;
      const family = familyFromDefinition(params?.theme, name, name);
      return { v: 1, ok: true, result: await writeNewFamily(family, `my-${slug(params?.theme?.name)}`) };
    }
    if (method === "appearance.importBase16") {
      const window = getWindow();
      const picked = await dialog.showOpenDialog(window, { title: "Import a Base16 or Base24 scheme", properties: ["openFile"], filters: [{ name: "Base16/Base24 scheme", extensions: ["yaml", "yml"] }] });
      if (picked.canceled || !picked.filePaths[0]) return { v: 1, ok: true, result: null };
      const stat = await fsp.stat(picked.filePaths[0]);
      if (stat.size > 64 * 1024) return { v: 1, ok: false, error: { code: "TOO_LARGE", message: "The scheme file is larger than 64 KB." } };
      let family;
      try { family = base16ToFamily(await fsp.readFile(picked.filePaths[0], "utf8")); } catch (error) { return { v: 1, ok: false, error: { code: "INVALID_SCHEME", message: error.message } }; }
      const checked = validateThemeFamily(family, path.basename(picked.filePaths[0]));
      if (!checked.family || checked.problems.length) return { v: 1, ok: false, error: { code: "INVALID_SCHEME", message: checked.problems[0]?.problem ?? "The scheme could not be converted." } };
      return { v: 1, ok: true, result: await writeNewFamily({ $schema: `./${SCHEMA_FILE}`, ...family }, slug(family.name)) };
    }
    if (method === "appearance.exportTheme") {
      const family = familyFromDefinition(params?.theme, String(params?.familyName ?? params?.theme?.name ?? "Theme").slice(0, 64));
      family.license = String(params?.license ?? "").slice(0, 160) || family.license;
      const window = getWindow();
      const saved = await dialog.showSaveDialog(window, { title: "Export theme", defaultPath: `${slug(params?.theme?.name)}.json`, filters: [{ name: "Skai theme", extensions: ["json"] }] });
      if (saved.canceled || !saved.filePath) return { v: 1, ok: true, result: null };
      delete family.$schema;
      await fsp.writeFile(saved.filePath, `${JSON.stringify(family, null, 2)}\n`, "utf8");
      return { v: 1, ok: true, result: { path: saved.filePath } };
    }
    if (method === "appearance.getThemes") return { v: 1, ok: true, result: await snapshot() };
    if (method === "appearance.saveThemeSelection") return { v: 1, ok: true, result: await savePicks(params) };
    // Gradient editor: set (or clear) one surface's gradient in the user's own theme file.
    if (method === "appearance.saveThemeGradient") {
      const file = userFile(params?.id);
      const themeName = String(params?.id ?? "").replace(/^user:[^/]+\//, "");
      if (!file) return { v: 1, ok: false, error: { code: "BUILT_IN_THEME", message: "Built-in themes are read-only. Duplicate it as your theme first." } };
      if (!GRADIENT_SURFACES.includes(params?.surface)) throw new Error("Unknown gradient surface.");
      let gradientValue = null;
      if (params?.gradient !== null) {
        const parsed = parseGradient(params?.gradient);
        if (!parsed) throw new Error("The gradient is not valid.");
        gradientValue = parsed.gradient === "solid" ? parsed.color : { gradient: parsed.gradient, angle: parsed.angle, stops: parsed.stops };
      }
      const stat = await fsp.lstat(file);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error("That theme file can't be edited.");
      const raw = JSON.parse(await fsp.readFile(file, "utf8"));
      const theme = Array.isArray(raw?.themes) ? raw.themes.find((entry) => entry?.name === themeName) : null;
      if (!theme) throw new Error("That theme was not found in its file.");
      theme.gradients = theme.gradients && typeof theme.gradients === "object" && !Array.isArray(theme.gradients) ? theme.gradients : {};
      if (gradientValue === null) delete theme.gradients[params.surface]; else theme.gradients[params.surface] = gradientValue;
      const checked = validateThemeFamily(raw, path.basename(file));
      if (!checked.family) throw new Error(checked.problems[0]?.problem ?? "The theme file would become invalid.");
      await fsp.writeFile(file, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
      scheduleReload();
      return { v: 1, ok: true, result: { surface: params.surface } };
    }
    if (method === "appearance.saveAppearanceOptions") {
      if (typeof params?.animateBackground !== "boolean") throw new Error("animateBackground must be true or false.");
      await writeAppearance({ animateBackground: params.animateBackground });
      return { v: 1, ok: true, result: { animateBackground: params.animateBackground } };
    }
    if (method === "appearance.saveFonts") return { v: 1, ok: true, result: await saveFonts(params) };
    if (method === "appearance.listFonts") return { v: 1, ok: true, result: await listInstalledFonts() };
    if (method === "appearance.readCustomFont") {
      try { return { v: 1, ok: true, result: { data: await readCustomFont(fontsDir, params?.file) } }; } catch (error) { return { v: 1, ok: false, error: { code: "FONT_UNAVAILABLE", message: error.message } }; }
    }
    if (method === "appearance.openFontsFolder") {
      await fsp.mkdir(fontsDir, { recursive: true });
      const error = await shell.openPath(fontsDir);
      return error ? { v: 1, ok: false, error: { code: "OPEN_FAILED", message: error } } : { v: 1, ok: true, result: { path: fontsDir } };
    }
    if (method === "appearance.openThemesFolder") {
      await fsp.mkdir(themesDir, { recursive: true });
      const error = await shell.openPath(themesDir);
      return error ? { v: 1, ok: false, error: { code: "OPEN_FAILED", message: error } } : { v: 1, ok: true, result: { path: themesDir } };
    }
    return null;
  }

  return { start, stop, handle, snapshot, themesDir, fontsDir, appearancePath };
}

module.exports = { createThemeService, DEFAULT_PICKS };
