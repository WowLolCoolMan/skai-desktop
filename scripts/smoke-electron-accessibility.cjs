const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { resolveDisplayBackend } = require("../apps/desktop/electron/linux-windowing.cjs");

const defaultName = process.platform === "win32" ? "Skai Desktop.exe" : "Skai Desktop";
const defaultRoot = path.join(__dirname, "..", "dist", "electron", `${process.platform === "win32" ? "win" : "linux"}-x64`);
const executable = path.resolve(process.argv[2] || path.join(defaultRoot, defaultName));
const axePath = path.join(__dirname, "..", "apps", "desktop", "node_modules", "axe-core", "axe.min.js");
const defaultRoutes = ["chat", "settings", "marketplace", "plugins", "projects", "coding", "models", "compare", "images", "video", "terminal", "memory", "usage", "pet-workshop", "voice-workbench", "workbench"];
const requestedRoutes = process.env.ACCESSIBILITY_ROUTES?.split(",").map((route) => route.trim()).filter(Boolean);
const routes = requestedRoutes?.length ? requestedRoutes : defaultRoutes;
const unknownRoutes = routes.filter((route) => !defaultRoutes.includes(route));
if (unknownRoutes.length) throw new Error(`Unknown accessibility route(s): ${unknownRoutes.join(", ")}`);
const port = 0;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "skai-accessibility-smoke-"));
const userData = path.join(temp, "electron-profile");
const appData = path.join(temp, "appdata");
const env = { ...process.env, SKAI_ELECTRON_SMOKE: "true", SKAI_SKIP_LEGACY_DATA_MIGRATION: "true", APPDATA: appData, LOCALAPPDATA: path.join(temp, "localappdata"), XDG_CONFIG_HOME: path.join(temp, "config"), XDG_DATA_HOME: path.join(temp, "data"), XDG_CACHE_HOME: path.join(temp, "cache") };
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
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Accessibility CDP command timed out during ${currentPhase}: ${method}`)); }, 120_000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(`Accessibility evaluation failed: ${result.exceptionDetails.text}`);
  return result.result?.value;
}

async function callFunction(functionDeclaration, args = []) {
  // Keep inspected values in CDP's structured arguments; never splice them into JavaScript source.
  const windowResult = await command("Runtime.evaluate", { expression: "window", returnByValue: false });
  const objectId = windowResult.result?.objectId;
  if (!objectId) throw new Error("DevTools did not return a page object for the accessibility probe.");
  try {
    const result = await command("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: functionDeclaration.toString(),
      arguments: args.map((value) => ({ value })),
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error(`Accessibility function call failed: ${result.exceptionDetails.text}`);
    return result.result?.value;
  } finally {
    await command("Runtime.releaseObject", { objectId }).catch(() => {});
  }
}

async function main() {
  console.log(`Accessibility smoke: launching ${executable}`);
  child = spawn(executable, [`--remote-debugging-port=${port}`, "--disable-gpu", ...displayArgs, `--user-data-dir=${userData}`, `--skai-isolated-smoke-app-data=${appData}`], { cwd: path.dirname(executable), env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  let target;
  let debugPort;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const endpoint = output.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
    if (endpoint) debugPort = Number(endpoint[1]);
    if (debugPort) {
      try {
        const pages = (await fetchJson(`http://127.0.0.1:${debugPort}/json/list`)).filter((item) => item.type === "page");
        target = pages.find((item) => item.title?.includes("Skai Desktop") && !item.url?.includes("?pet=1"));
        if (target) break;
      } catch { /* The Electron main window is still starting. */ }
    }
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
  console.log(`Injecting Axe into packaged renderer (${routes.length} route${routes.length === 1 ? "" : "s"})...`);
  await evaluate(`${axeSource}\n; typeof axe === 'object' ? 'axe-ready' : 'axe-missing'`);

  const results = [];
  for (const route of routes) {
    currentPhase = `running WCAG checks on #/${route}`;
    console.log(`Accessibility smoke: ${currentPhase}`);
    const routeResult = await callFunction(async function (route) { location.hash = `#/${route}`; window.dispatchEvent(new PopStateEvent("popstate")); await new Promise((resolve) => setTimeout(resolve, 350)); const result = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } }); const css = getComputedStyle(document.documentElement); const button = document.querySelector(".new-chat-button"); const buttonCss = button ? getComputedStyle(button) : null; return JSON.stringify({ route: location.hash, theme: { scheme: document.documentElement.dataset.scheme, id: document.documentElement.dataset.themeId, accent: css.getPropertyValue("--skai-color-accent").trim(), onAccent: css.getPropertyValue("--skai-color-on-accent").trim(), text: css.getPropertyValue("--skai-color-text").trim(), raised: css.getPropertyValue("--skai-color-surface-raised").trim(), buttonBg: buttonCss?.backgroundColor, buttonText: buttonCss?.color, buttonVars: button ? [getComputedStyle(button).getPropertyValue("--skai-color-accent").trim(), getComputedStyle(button).getPropertyValue("--skai-color-on-accent").trim()] : [] }, violations: result.violations.map((item) => ({ id: item.id, impact: item.impact, help: item.help, nodes: item.nodes.slice(0, 8).map((node) => ({ target: node.target, summary: node.failureSummary?.slice(0, 500) })) })), incomplete: result.incomplete.map((item) => ({ id: item.id, impact: item.impact, help: item.help, nodes: item.nodes.slice(0, 5).map((node) => { const element = document.querySelector(node.target[0]); const backgrounds = []; for (let current = element; current; current = current.parentElement) { const style = getComputedStyle(current); if (style.backgroundImage !== "none" || style.backgroundColor !== "rgba(0, 0, 0, 0)") backgrounds.push({ element: String(current.className || current.tagName).slice(0, 70), color: style.backgroundColor, image: style.backgroundImage }); } return { target: node.target, summary: node.failureSummary?.slice(0, 300), backgrounds: backgrounds.slice(0, 6) }; }) })) }); }, [route]);
    results.push(JSON.parse(routeResult));
    console.log(`Finished #/${route}: ${results.at(-1).violations.length} violations, ${results.at(-1).incomplete.length} incomplete checks.`);
  }
  currentPhase = "checking keyboard landmarks";
  console.log(`Accessibility smoke: ${currentPhase}`);
  const navigationResult = JSON.parse(await evaluate(`(() => { const skip = document.querySelector('.skip-link'); const main = document.querySelector('#main-content'); const controls = [...document.querySelectorAll('button,a,input,select,textarea,[tabindex]')].filter((el) => !el.disabled && el.tabIndex >= 0); skip?.focus(); const skipFocusWorks = document.activeElement === skip; const fixture = document.createElement('div'); fixture.tabIndex = 0; fixture.style.cssText = 'position:fixed;z-index:99999;left:4px;top:4px;width:180px;height:48px;overflow:hidden;border-radius:12px;background:var(--skai-color-surface-raised)'; const clippedButton = document.createElement('button'); clippedButton.type = 'button'; clippedButton.textContent = 'Focus ring fixture'; clippedButton.style.cssText = 'display:block;box-sizing:border-box;width:180px;height:48px;margin:0;padding:0;border-radius:12px'; fixture.append(clippedButton); document.body.append(fixture); fixture.focus(); window.__skaiFocusFixture = fixture; window.__skaiFocusButton = clippedButton; return JSON.stringify({ skipLink: Boolean(skip && skip.getAttribute('href') === '#main-content'), skipFocusWorks, mainLandmark: Boolean(main?.closest('main')), focusableCount: controls.length }); })()`));
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
  const focusResult = JSON.parse(await evaluate(`(() => { const fixture = window.__skaiFocusFixture; const clippedButton = window.__skaiFocusButton; const focusStyle = getComputedStyle(clippedButton); const focusOutline = focusStyle.outline; const insetFocusRing = focusStyle.boxShadow; const clippedFocusRingWorks = document.activeElement === clippedButton && focusStyle.outlineStyle !== 'none' && insetFocusRing.includes('inset') && fixture.scrollWidth === fixture.clientWidth && fixture.scrollHeight === fixture.clientHeight; fixture.remove(); delete window.__skaiFocusFixture; delete window.__skaiFocusButton; return JSON.stringify({ clippedFocusRingWorks, focusOutline, insetFocusRing }); })()`));
  const keyboard = { ...navigationResult, ...focusResult };
  console.log("Checking skip link, main landmark, and keyboard focus...");
  currentPhase = "checking reduced-motion preference propagation";
  console.log(`Accessibility smoke: ${currentPhase}`);
  await command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  const motion = JSON.parse(await evaluate(`(() => { const main = document.querySelector('.app-main'); const duration = main ? getComputedStyle(main).transitionDuration : ''; return JSON.stringify({ preference: matchMedia('(prefers-reduced-motion: reduce)').matches, explicitFullMotion: document.documentElement.dataset.motion === 'full', duration }); })()`));
  await command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  let popups = { skipped: true };
  if (process.env.ACCESSIBILITY_SKIP_INTERACTION_CHECKS !== "1") {
    const inspectPopup = async (selector, expectedRole) => {
      currentPhase = `checking ${selector} accessibility relationship`;
      console.log(`Accessibility smoke: ${currentPhase}`);
      const result = await callFunction(async function (popupSelector, role) { location.hash = "#/chat"; window.dispatchEvent(new PopStateEvent("popstate")); await new Promise((resolve) => setTimeout(resolve, 300)); const trigger = document.querySelector(popupSelector); if (!trigger) return JSON.stringify({ selector: popupSelector, exists: false, controlsValid: false }); trigger.click(); await new Promise((resolve) => setTimeout(resolve, 50)); const id = trigger.getAttribute("aria-controls"); const controlled = id ? document.getElementById(id) : null; const inspection = { selector: popupSelector, exists: true, expanded: trigger.getAttribute("aria-expanded") === "true", popupType: trigger.getAttribute("aria-haspopup"), controlsValid: Boolean(controlled && controlled.getAttribute("role") === role) }; trigger.click(); return JSON.stringify(inspection); }, [selector, expectedRole]);
      return JSON.parse(result);
    };
    popups = {
      modelPicker: await inspectPopup(".model-picker-trigger", "dialog"),
      overflowMenu: await inspectPopup(".overflow-menu-trigger", "menu"),
    };
  }
  const violations = results.flatMap((result) => result.violations.map((violation) => ({ route: result.route, theme: result.theme, ...violation })));
  const incompleteByNode = new Map();
  for (const result of results) for (const check of result.incomplete) for (const node of check.nodes) {
    const key = JSON.stringify([check.id, node.target, node.summary]);
    const existing = incompleteByNode.get(key);
    if (existing) existing.routes.push(result.route);
    else incompleteByNode.set(key, { id: check.id, impact: check.impact, help: check.help, routes: [result.route], target: node.target, summary: node.summary, backgrounds: node.backgrounds ?? [] });
  }
  const incomplete = [...incompleteByNode.values()];
  const critical = violations.filter((item) => item.impact === "critical");
  const serious = violations.filter((item) => item.impact === "serious");
  console.log(JSON.stringify({ routesInspected: results.length, wcagViolations: violations.length, serious: serious.length, critical: critical.length, keyboard, motion, popups, violations, incompleteChecks: results.reduce((sum, result) => sum + result.incomplete.length, 0), uniqueIncompletePatterns: incomplete.length, incomplete }, null, 2));
  if (keyboard.skipLink !== true || keyboard.skipFocusWorks !== true || keyboard.mainLandmark !== true || keyboard.focusableCount < 1 || keyboard.clippedFocusRingWorks !== true) throw new Error(`Keyboard navigation landmarks or clipped focus ring failed: ${JSON.stringify(keyboard)}`);
  if (!motion.preference || !motion.explicitFullMotion && !motion.duration.split(",").some((duration) => Number.parseFloat(duration) <= 0.01)) throw new Error(`Reduced-motion preference was not applied: ${JSON.stringify(motion)}`);
  if (!popups.skipped && (!popups.modelPicker.controlsValid || popups.modelPicker.popupType !== "dialog" || !popups.overflowMenu.controlsValid || popups.overflowMenu.popupType !== "menu")) throw new Error(`Expanded popover accessibility relationships failed: ${JSON.stringify(popups)}`);
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
