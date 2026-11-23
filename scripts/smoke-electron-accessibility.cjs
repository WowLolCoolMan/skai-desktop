const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { resolveDisplayBackend } = require("../apps/desktop/electron/linux-windowing.cjs");

const defaultName = process.platform === "win32" ? "Skai Desktop.exe" : "Skai Desktop";
const defaultRoot = path.join(__dirname, "..", "dist", "electron", `${process.platform === "win32" ? "win" : "linux"}-x64`);
const executable = path.resolve(process.argv[2] || path.join(defaultRoot, defaultName));
const axePath = path.join(__dirname, "..", "apps", "desktop", "node_modules", "axe-core", "axe.min.js");
const routes = ["chat", "settings", "marketplace", "plugins", "projects", "coding", "models", "images", "terminal", "memory", "usage", "pet-workshop", "voice-workbench", "workbench"];
const port = 19341;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "skai-accessibility-smoke-"));
const userData = path.join(temp, "electron-profile");
const env = { ...process.env, SKAI_SKIP_LEGACY_DATA_MIGRATION: "true", APPDATA: path.join(temp, "appdata"), LOCALAPPDATA: path.join(temp, "localappdata"), XDG_CONFIG_HOME: path.join(temp, "config"), XDG_DATA_HOME: path.join(temp, "data"), XDG_CACHE_HOME: path.join(temp, "cache") };
const display = resolveDisplayBackend({ argv: [] });
const displayArgs = display.switchValue ? [`--ozone-platform=${display.switchValue}`] : [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (!fs.existsSync(executable)) throw new Error(`Packaged Electron executable not found: ${executable}`);
if (!fs.existsSync(axePath)) throw new Error(`axe-core is missing: ${axePath}`);

let child;
let output = "";
let socket;
let sequence = 1;
let currentPhase = "launch";
const pending = new Map();

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.json();
}

async function command(method, params = {}) {
  const id = sequence++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Accessibility CDP command timed out during ${currentPhase}: ${method}`)); }, 45_000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(`Accessibility evaluation failed: ${result.exceptionDetails.text}`);
  return result.result?.value;
}

async function main() {
  console.log(`Accessibility smoke: launching ${executable}`);
  child = spawn(executable, [`--remote-debugging-port=${port}`, "--disable-gpu", ...displayArgs, `--user-data-dir=${userData}`], { cwd: path.dirname(executable), env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  let target;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const pages = (await fetchJson(`http://127.0.0.1:${port}/json/list`)).filter((item) => item.type === "page");
      target = pages.find((item) => item.title?.includes("Skai Desktop") && !item.url?.includes("?pet=1"));
      if (target) break;
    } catch { /* The Electron main window is still starting. */ }
    if (child.exitCode !== null) throw new Error(`Packaged Electron exited before the accessibility connection was ready. ${output.slice(-2000)}`);
    await sleep(200);
  }
  if (!target) throw new Error(`Packaged Electron did not expose its main page for accessibility inspection. ${output.slice(-2000)}`);

  socket = new WebSocket(target.webSocketDebuggerUrl);
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id); clearTimeout(waiter.timer);
    if (message.error) waiter.reject(new Error(`${message.error.message} (${message.error.code})`));
    else waiter.resolve(message.result ?? {});
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  currentPhase = "enabling Chrome DevTools Runtime";
  console.log(`Accessibility smoke: ${currentPhase}`);
  await command("Runtime.enable");
  const axeSource = fs.readFileSync(axePath, "utf8");
  currentPhase = "loading axe-core into the renderer";
  console.log(`Accessibility smoke: ${currentPhase}`);
  await evaluate(`${axeSource}\n; typeof axe === 'object' ? 'axe-ready' : 'axe-missing'`);

  const results = [];
  for (const route of routes) {
    currentPhase = `running WCAG checks on #/${route}`;
    console.log(`Accessibility smoke: ${currentPhase}`);
    const routeResult = await evaluate(`(async () => { location.hash = '#/${route}'; window.dispatchEvent(new PopStateEvent('popstate')); await new Promise((resolve) => setTimeout(resolve, 350)); const result = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } }); const css = getComputedStyle(document.documentElement); const button = document.querySelector('.new-chat-button'); const buttonCss = button ? getComputedStyle(button) : null; return JSON.stringify({ route: location.hash, theme: { scheme: document.documentElement.dataset.scheme, id: document.documentElement.dataset.themeId, accent: css.getPropertyValue('--skai-color-accent').trim(), onAccent: css.getPropertyValue('--skai-color-on-accent').trim(), text: css.getPropertyValue('--skai-color-text').trim(), raised: css.getPropertyValue('--skai-color-surface-raised').trim(), buttonBg: buttonCss?.backgroundColor, buttonText: buttonCss?.color, buttonVars: button ? [getComputedStyle(button).getPropertyValue('--skai-color-accent').trim(), getComputedStyle(button).getPropertyValue('--skai-color-on-accent').trim()] : [] }, violations: result.violations.map((item) => ({ id: item.id, impact: item.impact, help: item.help, nodes: item.nodes.slice(0, 8).map((node) => ({ target: node.target, summary: node.failureSummary?.slice(0, 500) })) })), incomplete: result.incomplete.map((item) => ({ id: item.id, impact: item.impact, help: item.help, nodes: item.nodes.slice(0, 5).map((node) => ({ target: node.target, summary: node.failureSummary?.slice(0, 300) })) })) }); })()`);
    results.push(JSON.parse(routeResult));
  }
  currentPhase = "checking keyboard landmarks";
  console.log(`Accessibility smoke: ${currentPhase}`);
  const navigationResult = await evaluate(`(() => { const skip = document.querySelector('.skip-link'); const main = document.querySelector('#main-content'); const controls = [...document.querySelectorAll('button,a,input,select,textarea,[tabindex]')].filter((el) => !el.disabled && el.tabIndex >= 0); skip?.focus(); return JSON.stringify({ skipLink: Boolean(skip && skip.getAttribute('href') === '#main-content'), skipFocusWorks: document.activeElement === skip, mainLandmark: Boolean(main?.closest('main')), focusableCount: controls.length }); })()`);
  const keyboard = JSON.parse(navigationResult);
  const inspectPopup = async (selector, expectedRole) => {
    currentPhase = `checking ${selector} accessibility relationship`;
    console.log(`Accessibility smoke: ${currentPhase}`);
    const result = await evaluate(`(async () => { location.hash = '#/chat'; window.dispatchEvent(new PopStateEvent('popstate')); await new Promise((resolve) => setTimeout(resolve, 300)); const trigger = document.querySelector(${JSON.stringify(selector)}); if (!trigger) return JSON.stringify({ selector: ${JSON.stringify(selector)}, exists: false, controlsValid: false }); trigger.click(); await new Promise((resolve) => setTimeout(resolve, 50)); const id = trigger.getAttribute('aria-controls'); const controlled = id ? document.getElementById(id) : null; const inspection = { selector: ${JSON.stringify(selector)}, exists: true, expanded: trigger.getAttribute('aria-expanded') === 'true', popupType: trigger.getAttribute('aria-haspopup'), controlsValid: Boolean(controlled && controlled.getAttribute('role') === ${JSON.stringify(expectedRole)}) }; trigger.click(); return JSON.stringify(inspection); })()`);
    return JSON.parse(result);
  };
  const popups = {
    modelPicker: await inspectPopup(".model-picker-trigger", "dialog"),
    overflowMenu: await inspectPopup(".overflow-menu-trigger", "menu"),
  };
  const violations = results.flatMap((result) => result.violations.map((violation) => ({ route: result.route, theme: result.theme, ...violation })));
  const incompleteByNode = new Map();
  for (const result of results) for (const check of result.incomplete) for (const node of check.nodes) {
    const key = JSON.stringify([check.id, node.target, node.summary]);
    const existing = incompleteByNode.get(key);
    if (existing) existing.routes.push(result.route);
    else incompleteByNode.set(key, { id: check.id, impact: check.impact, help: check.help, routes: [result.route], target: node.target, summary: node.summary });
  }
  const incomplete = [...incompleteByNode.values()];
  const critical = violations.filter((item) => item.impact === "critical");
  const serious = violations.filter((item) => item.impact === "serious");
  console.log(JSON.stringify({ routesInspected: results.length, wcagViolations: violations.length, serious: serious.length, critical: critical.length, keyboard, popups, violations, incompleteChecks: results.reduce((sum, result) => sum + result.incomplete.length, 0), uniqueIncompletePatterns: incomplete.length, incomplete }, null, 2));
  if (keyboard.skipLink !== true || keyboard.skipFocusWorks !== true || keyboard.mainLandmark !== true || keyboard.focusableCount < 1) throw new Error(`Keyboard navigation landmarks failed: ${JSON.stringify(keyboard)}`);
  if (!popups.modelPicker.controlsValid || popups.modelPicker.popupType !== "dialog" || !popups.overflowMenu.controlsValid || popups.overflowMenu.popupType !== "menu") throw new Error(`Expanded popover accessibility relationships failed: ${JSON.stringify(popups)}`);
  if (violations.length) throw new Error(`axe-core found ${violations.length} WCAG A/AA violation(s) across the packaged routes.`);
}

async function cleanup() {
  if (socket?.readyState === WebSocket.OPEN) socket.close();
  if (child && child.exitCode === null && child.signalCode === null) {
    if (process.platform === "win32") {
      await new Promise((resolve) => {
        const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.once("close", resolve); killer.once("error", resolve);
      });
    } else {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("close", resolve));
    }
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try { fs.rmSync(temp, { recursive: true, force: true }); return; }
    catch { await sleep(100); }
  }
  console.warn(`Windows kept an isolated accessibility test profile open: ${temp}`);
}

main().catch((error) => {
  console.error(error.message);
  if (output.trim()) console.error(`Packaged Electron output:\n${output.slice(-2000)}`);
  process.exitCode = 1;
}).finally(cleanup);
