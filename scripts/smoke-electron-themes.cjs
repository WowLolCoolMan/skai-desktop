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
    const selected = await devtools.callFunction("function (theme, backdrop) { const labels = [...document.querySelectorAll('.settings-content label')]; const set = (labelText, value) => { const select = labels.find((label) => label.textContent?.includes(labelText))?.querySelector('select'); if (!select) return false; select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); return true; }; return { theme: set('Color theme', theme), backdrop: set('Backdrop', backdrop) } }", [theme, backdrop]);
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
    fs.mkdirSync(outputDir, { recursive: true });
    const screenshot = await devtools.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(outputDir, `${theme}-${backdrop}.png`), Buffer.from(screenshot.data, "base64"));
    return parsed;
  };

  const states = [];
  for (const [theme, backdrop] of [["dark", "none"], ["light", "deep-sea"], ["system", "deep-space"]]) states.push(await setAppearance(theme, backdrop));
  await devtools.send("Emulation.setDeviceMetricsOverride", { width: 960, height: 640, deviceScaleFactor: 1, mobile: false });
  const constrained = await setAppearance("light", "deep-space");
  await devtools.send("Emulation.clearDeviceMetricsOverride");
  devtools.close();
  console.log(`Packaged theme acceptance passed: ${JSON.stringify({ states, constrained })}`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  await terminateChild();
  setTimeout(() => { try { fs.rmSync(smokeUserDataDir, { recursive: true, force: true }); } catch { /* best effort */ } }, 1500);
});
