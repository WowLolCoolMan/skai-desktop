const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { resolveDisplayBackend } = require("../apps/desktop/electron/linux-windowing.cjs");
// Pick the Linux display backend up front; otherwise the app relaunches itself and the spawned PID is not the app.
const displayBackendArgs = ((decision) => decision.switchValue ? [`--ozone-platform=${decision.switchValue}`] : [])(resolveDisplayBackend({ argv: [] }));

const defaultName = process.platform === "win32" ? "Skai Desktop.exe" : "Skai Desktop";
const defaultRoot = path.join(__dirname, "..", "dist", "electron", `${process.platform === "win32" ? "win" : "linux"}-x64`);
const executable = path.resolve(process.argv[2] || path.join(defaultRoot, defaultName));
const port = 19323;
const timeoutMs = 25_000;
const outputDir = path.join(__dirname, "..", ".tmp", "theme-acceptance");

if (!fs.existsSync(executable)) {
  console.error(`Electron artifact does not exist: ${executable}`);
  process.exit(1);
}

// Isolated profile: a running Skai instance would otherwise take the single-instance lock and the smoke launch would exit.
const smokeUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "skai-electron-smoke-"));
const child = spawn(executable, [`--remote-debugging-port=${port}`, "--disable-gpu", ...displayBackendArgs, `--user-data-dir=${smokeUserDataDir}`], { cwd: path.dirname(executable), env: { ...process.env, SKAI_SKIP_LEGACY_DATA_MIGRATION: "true" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
child.stdout.on("data", (chunk) => { output += chunk.toString(); });
child.stderr.on("data", (chunk) => { output += chunk.toString(); });

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.json();
}

function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
    const resolve = pending.get(message.id);
    if (typeof resolve !== "function") return;
    pending.delete(message.id);
    resolve(message);
  });
  const send = async (method, params = {}) => {
    const id = nextId++;
    const result = new Promise((resolve, reject) => {
      pending.set(id, (message) => message.error ? reject(new Error(message.error.message)) : resolve(message.result));
      setTimeout(() => { if (pending.delete(id)) reject(new Error(`DevTools command timed out: ${method}`)); }, 5_000);
    });
    socket.send(JSON.stringify({ id, method, params }));
    return result;
  };
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    return result?.result?.value;
  };
  const callFunction = async (functionDeclaration, args = []) => {
    const windowResult = await send("Runtime.evaluate", { expression: "window", returnByValue: false });
    const objectId = windowResult?.result?.objectId;
    if (!objectId) throw new Error("DevTools did not return a page object for the probe.");
    try {
      const result = await send("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration,
        arguments: args.map((value) => ({ value })),
        returnByValue: true,
        awaitPromise: true,
      });
      if (result?.exceptionDetails) throw new Error("The page probe failed.");
      return result?.result?.value;
    } finally {
      await send("Runtime.releaseObject", { objectId }).catch(() => {});
    }
  };
  const close = () => socket.close();
  return { open: new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); }), send, evaluate, callFunction, close };
}
async function terminateChild() {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    if (process.platform === "win32") {
      const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      killer.once("close", resolve);
      killer.once("error", resolve);
      return;
    }
    child.once("close", resolve);
    child.kill("SIGTERM");
  });
}

async function waitFor(evaluate, expression, predicate, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(expression);
    if (predicate(value)) return value;
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function main() {
  const deadline = Date.now() + timeoutMs;
  let target;
  while (Date.now() < deadline) {
    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      target = targets.find((item) => item.type === "page" && item.title?.includes("Skai Desktop") && !item.url?.includes("?pet=1"));
      if (target) break;
    } catch { /* The packaged window is still starting. */ }
    await sleep(250);
  }
  if (!target) throw new Error(`Packaged Electron did not expose the main page. Output: ${output.slice(-2_000)}`);

  const devtools = connect(target);
  await devtools.open;
  await devtools.evaluate("(document.querySelector('.sidebar-settings') ?? document.querySelector('[aria-label=\"Settings\"]'))?.click(); if (!location.hash.includes('settings')) { location.hash = '#/settings'; window.dispatchEvent(new PopStateEvent('popstate')); } 'settings'");
  await waitFor(devtools.evaluate, "document.querySelector('.settings-content')?.textContent || ''", (value) => typeof value === "string" && value.includes("General"), "Settings page");
  await devtools.evaluate("[...document.querySelectorAll('.settings-nav button')].find((button) => button.textContent?.trim() === 'Appearance')?.click(); 'appearance'");
  await waitFor(devtools.evaluate, "document.querySelector('.settings-content select')?.value", (value) => typeof value === "string", "Appearance controls");

  const setAppearance = async (theme, backdrop) => {
    const selected = await devtools.callFunction("function (theme, backdrop) { const labels = [...document.querySelectorAll('.settings-content label')]; const set = (labelText, value) => { const select = labels.find((label) => label.firstChild?.nodeType === Node.TEXT_NODE && label.firstChild.textContent?.trim() === labelText)?.querySelector('select'); if (!select) return false; select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); return true; }; return { theme: set('Color theme', theme), backdrop: set('Backdrop', backdrop) } }", [theme, backdrop]);
    if (!selected?.theme || !selected?.backdrop) throw new Error(`Appearance controls were not found for ${theme}/${backdrop}`);
    const state = await waitFor(devtools.evaluate, "JSON.stringify((() => { const root = document.documentElement; const styles = getComputedStyle(root); return { theme: root.dataset.theme, backdrop: root.dataset.backdrop, canvas: styles.getPropertyValue('--skai-color-canvas').trim(), accent: styles.getPropertyValue('--skai-color-accent').trim(), overflow: Math.max(root.scrollWidth, document.body.scrollWidth) <= window.innerWidth + 1, width: window.innerWidth }; })())", (value) => { try { const parsed = JSON.parse(value); return parsed.theme === theme && parsed.backdrop === backdrop; } catch { return false; } }, `${theme}/${backdrop} state`);
    const parsed = JSON.parse(state);
    if (!parsed.overflow || !parsed.canvas || !parsed.accent) throw new Error(`Appearance state overflowed or lacked tokens: ${state}`);
    // Theme: native popups. Linux draws <select> popups from each <option>'s own colors
    // (a transparent option paints white), and nativeTheme decides the native scheme.
    // Fail when an option is unthemed or unreadable, or the native scheme disagrees with
    // the app (light/dark only: "system" follows the OS on purpose).
    const popups = await waitFor(devtools.evaluate, `JSON.stringify((() => {
      const channels = (value) => (value.match(/[\\d.]+/g) || []).map(Number);
      const luminance = ([r, g, b]) => [r, g, b].map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
      const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
      const problems = [];
      for (const option of document.querySelectorAll('select option, select optgroup')) {
        const styles = getComputedStyle(option);
        const background = channels(styles.backgroundColor);
        const name = '"' + (option.label || option.textContent || '').trim() + '"';
        if (background.length === 4 && background[3] < 1) { problems.push('transparent ' + option.tagName.toLowerCase() + ' ' + name); continue; }
        const ratio = contrast(channels(styles.color), background);
        if (ratio < 4.5) problems.push(name + ' contrast ' + ratio.toFixed(2));
      }
      return { options: document.querySelectorAll('select option').length, nativeDark: matchMedia('(prefers-color-scheme: dark)').matches, problems };
    })())`, (value) => { try { const probe = JSON.parse(value); return theme === "system" || probe.nativeDark === (theme === "dark"); } catch { return false; } }, `${theme} native color scheme`).catch(() => null);
    if (!popups) throw new Error(`The native color scheme did not follow the ${theme} theme (nativeTheme.themeSource is out of sync).`);
    const popupState = JSON.parse(popups);
    if (!popupState.options) throw new Error(`No <option> elements were found on Appearance for ${theme}/${backdrop}.`);
    if (popupState.problems.length) throw new Error(`Select popups are unthemed or unreadable in ${theme}/${backdrop}: ${popupState.problems.join("; ")}`);
    parsed.nativeDark = popupState.nativeDark;
    // Theme: the resolved scheme (data-scheme) must agree with the theme mode, and in
    // System mode with the native scheme.
    const expectedScheme = theme === "system" ? (popupState.nativeDark ? "dark" : "light") : theme;
    parsed.canvas = JSON.parse(await waitFor(devtools.evaluate, "JSON.stringify({ scheme: document.documentElement.dataset.scheme, canvas: getComputedStyle(document.documentElement).getPropertyValue('--skai-color-canvas').trim() })", (value) => JSON.parse(value).scheme === expectedScheme, `${theme} to resolve to the ${expectedScheme} scheme`)).canvas;
    fs.mkdirSync(outputDir, { recursive: true });
    // Best effort: screenshots are evidence, not assertions, and on a busy desktop the
    // compositor sometimes doesn't hand over a frame within the DevTools timeout.
    await devtools.send("Page.captureScreenshot", { format: "png" }).then((screenshot) => fs.writeFileSync(path.join(outputDir, `${theme}-${backdrop}.png`), Buffer.from(screenshot.data, "base64"))).catch(() => console.warn(`Screenshot skipped for ${theme}/${backdrop}.`));
    return parsed;
  };

  const states = [];
  for (const [theme, backdrop] of [["dark", "none"], ["light", "deep-sea"], ["system", "deep-space"]]) states.push(await setAppearance(theme, backdrop));
  await devtools.send("Emulation.setDeviceMetricsOverride", { width: 960, height: 640, deviceScaleFactor: 1, mobile: false });
  const constrained = await setAppearance("light", "deep-space");
  await devtools.send("Emulation.clearDeviceMetricsOverride");

  // Theme files: drop a user theme into <userData>/themes, pick it, edit it while the
  // app runs (live reload), then break it (the last good version must stay applied
  // and a problem must be shown), and check the pick was saved to appearance.json.
  const themesDir = path.join(smokeUserDataDir, "themes");
  const themeFile = path.join(themesDir, "smoke.json");
  const writeTheme = (canvas) => fs.writeFileSync(themeFile, JSON.stringify({ name: "Smoke", license: "CC0-1.0", themes: [{ name: "Smoke Dark", appearance: "dark", colors: { canvas }, fonts: { reading: { family: "Smoke Missing Serif, DejaVu Serif", size: 15, lineHeight: 1.7 }, code: { family: "DejaVu Sans Mono", size: 13 } }, gradients: { canvas: { gradient: "linear", angle: 135, stops: [{ color: "#304050", at: 1 }, { color: canvas, at: 0 }] }, "primary-button": { gradient: "radial", stops: [{ color: "#17131f", at: 0 }, { color: "#b39af5", at: 1 }] } } }] }));
  const canvasToken = "getComputedStyle(document.documentElement).getPropertyValue('--skai-color-canvas').trim()";
  await setAppearance("dark", "none");
  // Built-in gradient preset: picking it paints its canvas gradient with no contrast warnings.
  const pickDark = (id) => devtools.callFunction("function (id) { const select = [...document.querySelectorAll('.settings-content label')].find((label) => label.textContent?.startsWith('Dark theme'))?.querySelector('select'); if (!select) return false; select.value = id; select.dispatchEvent(new Event('change', { bubbles: true })); return select.value === id; }", [id]);
  if (!(await pickDark("builtin:Synthwave/Synthwave Dark"))) throw new Error("The Synthwave Dark preset is missing from the Dark theme picker.");
  const preset = JSON.parse(await waitFor(devtools.evaluate, "JSON.stringify({ flag: document.documentElement.hasAttribute('data-skai-gradient-canvas'), painted: getComputedStyle(document.querySelector('.app-main')).backgroundImage, warning: Boolean(document.querySelector('.theme-settings-contrast')) })", (value) => JSON.parse(value).flag, "Synthwave Dark gradient to apply"));
  if (!preset.painted.startsWith("linear-gradient") || preset.warning) throw new Error(`Synthwave Dark did not apply cleanly: ${JSON.stringify(preset)}`);
  // Gradient editor: switch the canvas to radial (previews live), save. A built-in theme is
  // duplicated first, then the change is written into the copy and that copy is active.
  await devtools.evaluate("[...document.querySelectorAll('.gradient-editor-kinds button')].find((button) => button.textContent === 'Radial')?.click(); 1");
  await waitFor(devtools.evaluate, "getComputedStyle(document.querySelector('.app-main')).backgroundImage", (value) => typeof value === "string" && value.startsWith("radial-gradient"), "radial draft to preview live");
  await devtools.evaluate("[...document.querySelectorAll('.gradient-editor-actions button')].find((button) => button.textContent?.startsWith('Save'))?.click(); 1");
  const copyFile = path.join(smokeUserDataDir, "themes", "my-synthwave-dark.json");
  const savedCopy = JSON.parse(await waitFor(async () => (fs.existsSync(copyFile) ? fs.readFileSync(copyFile, "utf8") : "null"), "", (value) => { try { return JSON.parse(value)?.themes?.[0]?.gradients?.canvas?.gradient === "radial"; } catch { return false; } }, "edited gradient saved into a duplicated theme"));
  await waitFor(devtools.evaluate, "document.documentElement.dataset.themeId", (value) => value === "user:my-synthwave-dark.json/Synthwave Dark (mine)", "duplicated theme to become active");
  if (savedCopy.themes[0].gradients["primary-button"]?.gradient !== "linear") throw new Error("Duplicating lost the preset's other gradients.");
  fs.mkdirSync(themesDir, { recursive: true });
  writeTheme("#102030");
  await waitFor(devtools.evaluate, "[...document.querySelectorAll('.settings-content option')].some((option) => option.value === 'user:smoke.json/Smoke Dark')", Boolean, "user theme to load from the themes folder");
  const picked = await devtools.callFunction("function (id) { const select = [...document.querySelectorAll('.settings-content label')].find((label) => label.textContent?.startsWith('Dark theme'))?.querySelector('select'); if (!select) return false; select.value = id; select.dispatchEvent(new Event('change', { bubbles: true })); return true; }", ["user:smoke.json/Smoke Dark"]);
  if (!picked) throw new Error("The Dark theme picker was not found on Appearance.");
  await waitFor(devtools.evaluate, canvasToken, (value) => value === "#102030", "picked user theme to apply");
  // Theme fonts: a family stack built by Skai (chosen fonts first, then fallbacks), a code
  // size scale, and generated role rules. A missing first font must not break the stack.
  const fontState = JSON.parse(await devtools.evaluate("JSON.stringify({ reading: getComputedStyle(document.documentElement).getPropertyValue('--skai-font-reading').trim(), codeScale: getComputedStyle(document.documentElement).getPropertyValue('--skai-code-scale').trim(), roles: document.getElementById('skai-font-roles')?.textContent || '', messageFont: (() => { const probe = document.createElement('div'); probe.className = 'message-content'; document.body.append(probe); const style = getComputedStyle(probe); const result = { family: style.fontFamily, size: style.fontSize, lineHeight: style.lineHeight }; probe.remove(); return result; })() })"));
  if (!fontState.reading.startsWith('"Smoke Missing Serif", "DejaVu Serif",') || !/sans-serif$/.test(fontState.reading)) throw new Error(`Reading font stack is wrong: ${fontState.reading}`);
  // Theme gradients: built by Skai from the validated stops (sorted by position), painted on
  // the canvas, and checked for contrast against EVERY stop (dark on-accent text vs the dark
  // first stop of the button gradient must be reported).
  const gradientState = JSON.parse(await waitFor(devtools.evaluate, "JSON.stringify({ token: getComputedStyle(document.documentElement).getPropertyValue('--skai-bg-canvas').trim(), flag: document.documentElement.hasAttribute('data-skai-gradient-canvas'), painted: getComputedStyle(document.querySelector('.app-main')).backgroundImage, warning: document.querySelector('.theme-settings-contrast')?.textContent || '' })", (value) => JSON.parse(value).warning.includes("primary-button"), "gradient contrast warning"));
  if (gradientState.token !== "linear-gradient(135deg, #102030 0%, #304050 100%)" || !gradientState.flag || !gradientState.painted.startsWith("linear-gradient")) throw new Error(`Canvas gradient was not applied: ${JSON.stringify(gradientState)}`);
  if (fontState.codeScale !== "1.0833") throw new Error(`Code size scale is wrong: ${fontState.codeScale}`);
  if (fontState.messageFont.size !== "15px" || !fontState.roles.includes("line-height: 1.7 !important")) throw new Error(`Reading role rules were not applied: ${JSON.stringify(fontState)}`);
  writeTheme("#203040");
  await waitFor(devtools.evaluate, canvasToken, (value) => value === "#203040", "edited theme file to live-reload");
  fs.writeFileSync(themeFile, "{ broken");
  await waitFor(devtools.evaluate, "document.querySelector('.theme-settings-problems')?.textContent || ''", (value) => value.includes("smoke.json"), "problem report for a broken theme file");
  const keptCanvas = await devtools.evaluate(canvasToken);
  if (keptCanvas !== "#203040") throw new Error(`A broken theme file replaced the last good theme (canvas ${keptCanvas}).`);
  // Custom fonts: a real font file dropped into <userData>/fonts loads through FontFace and
  // can be chosen for a role; a junk file is reported and skipped.
  const sampleFont = path.join(__dirname, "..", "apps", "desktop", "node_modules", "monaco-editor", "esm", "vs", "base", "browser", "ui", "codicons", "codicon", "codicon.ttf");
  if (fs.existsSync(sampleFont)) {
    const fontsDir = path.join(smokeUserDataDir, "fonts");
    fs.mkdirSync(fontsDir, { recursive: true });
    fs.copyFileSync(sampleFont, path.join(fontsDir, "Smoke-Icons.ttf"));
    fs.writeFileSync(path.join(fontsDir, "Broken.ttf"), "not a font");
    await waitFor(devtools.evaluate, "[...document.fonts].some((face) => face.family.replace(/\"/g, '') === 'Smoke Icons' && face.status === 'loaded')", Boolean, "custom font to load with FontFace");
    await devtools.evaluate("window.skaiAgent.request('appearance.saveFonts', { fonts: { ui: { family: ['Smoke Icons'], weight: 500 } } }).then((response) => response.ok)");
    await waitFor(devtools.evaluate, "getComputedStyle(document.documentElement).getPropertyValue('--skai-font-ui').trim()", (value) => value.startsWith('"Smoke Icons",'), "Appearance font override to apply");
    await waitFor(devtools.evaluate, "document.querySelector('.theme-settings-problems')?.textContent || ''", (value) => value.includes("Broken.ttf"), "problem report for a junk font file");
    await devtools.evaluate("window.skaiAgent.request('appearance.saveFonts', { fonts: { ui: null } }).then((response) => response.ok)");
    await waitFor(devtools.evaluate, "getComputedStyle(document.documentElement).getPropertyValue('--skai-font-ui').trim()", (value) => !value.startsWith('"Smoke Icons"'), "font override to clear");
  }
  const savedPicks = JSON.parse(fs.readFileSync(path.join(smokeUserDataDir, "appearance.json"), "utf8"));
  if (savedPicks.darkTheme !== "user:smoke.json/Smoke Dark") throw new Error(`The theme pick was not saved to appearance.json: ${JSON.stringify(savedPicks)}`);
  fs.mkdirSync(outputDir, { recursive: true });
  // Best effort: on a busy desktop the compositor may not hand over a frame in time.
  await devtools.send("Page.captureScreenshot", { format: "png" }).then((shot) => fs.writeFileSync(path.join(outputDir, "user-theme-problem.png"), Buffer.from(shot.data, "base64"))).catch(() => {});

  devtools.close();
  console.log(`Packaged theme acceptance passed: ${JSON.stringify({ states, constrained, userTheme: { liveReload: true, keptLastGood: keptCanvas } })}`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  await terminateChild();
  setTimeout(() => { try { fs.rmSync(smokeUserDataDir, { recursive: true, force: true }); } catch { /* best effort */ } }, 1500);
});
