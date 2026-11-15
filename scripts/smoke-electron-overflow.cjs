const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { resolveDisplayBackend } = require("../apps/desktop/electron/linux-windowing.cjs");
// Pick the Linux display backend up front; otherwise the app relaunches itself and the spawned PID is not the app.
const displayBackendArgs = ((decision) => decision.switchValue ? [`--ozone-platform=${decision.switchValue}`] : [])(resolveDisplayBackend({ argv: [] }));

const executable = path.resolve(process.argv[2] || path.join(__dirname, "..", "dist", "electron", `${process.platform === "win32" ? "win" : "linux"}-x64`, process.platform === "win32" ? "Skai Desktop.exe" : "Skai Desktop"));
const port = 19324;
const routes = ["chat", "coding", "settings", "models", "images", "marketplace", "plugins", "workbench", "terminal", "memory", "usage"];
const widths = [1920, 1440, 1280, 960, 640];
// Isolated profile: a running Skai instance would otherwise take the single-instance lock and the smoke launch would exit.
const smokeUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "skai-electron-smoke-"));
const child = spawn(executable, [`--remote-debugging-port=${port}`, "--disable-gpu", ...displayBackendArgs, `--user-data-dir=${smokeUserDataDir}`], { cwd: path.dirname(executable), windowsHide: true, stdio: "ignore" });
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function fetchJson(url) { const response = await fetch(url); if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); }
function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;
  socket.addEventListener("message", (event) => { const message = JSON.parse(typeof event.data === "string" ? event.data : String(event.data)); const resolve = pending.get(message.id); if (typeof resolve !== "function") return; pending.delete(message.id); resolve(message); });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, (message) => message.error ? reject(new Error(message.error.message)) : resolve(message.result)); socket.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (pending.delete(id)) reject(new Error(`Timed out: ${method}`)); }, 8000); });
  return { open: new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); }), send, evaluate: async (expression) => { const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); return result?.result?.value; }, close: () => socket.close() };
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
async function main() {
  let target;
  for (let attempt = 0; attempt < 100 && !target; attempt += 1) { try { target = (await fetchJson(`http://127.0.0.1:${port}/json/list`)).find((item) => item.type === "page" && item.title?.includes("Skai Desktop")); } catch {} if (!target) await sleep(100); }
  if (!target) throw new Error("Packaged Electron did not expose the main page for overflow acceptance.");
  const devtools = connect(target); await devtools.open;
  const failures = [];
  for (const width of widths) {
    await devtools.send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
    for (const route of routes) {
      await devtools.evaluate(`location.hash = '#/${route}'`);
      await sleep(180);
      const result = await devtools.evaluate(`(() => { const viewport = window.innerWidth; const nodes = [...document.querySelectorAll('body *')].map((element) => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); let ancestor = element.parentElement; let containedByScroll = false; while (ancestor) { const ancestorStyle = getComputedStyle(ancestor); if (ancestorStyle.overflowX === 'auto' || ancestorStyle.overflowX === 'scroll' || ancestorStyle.overflow === 'auto' || ancestorStyle.overflow === 'scroll') { containedByScroll = true; break; } ancestor = ancestor.parentElement; } const isControl = element.matches('button,input,select,textarea,[role="button"]'); const isText = element.matches('h1,h2,h3,h4,p,strong,span,label,a,small'); const intentional = element.classList.contains('sr-only') || (style.textOverflow === 'ellipsis' && style.whiteSpace === 'nowrap'); const clipped = !intentional && !containedByScroll && (isControl || isText) && element.scrollWidth > element.clientWidth + 1; return { tag: element.tagName.toLowerCase(), className: typeof element.className === 'string' ? element.className.slice(0, 80) : '', right: Math.round(rect.right), left: Math.round(rect.left), width: Math.round(rect.width), text: (element.textContent || element.value || '').trim().replace(/\\s+/g, ' ').slice(0, 60), display: style.display, containedByScroll, clipped }; }).filter((node) => node.display !== 'none' && node.width > 0 && !node.containedByScroll && (node.left < -1 || node.right > viewport + 1 || node.clipped)); return { viewport, bodyWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), offenders: nodes.slice(0, 8) }; })()`);
      if (result.offenders.length > 0 || result.bodyWidth > width + 1) failures.push({ width, route, result });
    }
  }
  await devtools.send("Emulation.clearDeviceMetricsOverride"); devtools.close();
  if (failures.length) throw new Error(`Overflow acceptance failed: ${JSON.stringify(failures.slice(0, 12))}`);
  console.log(`Packaged overflow acceptance passed: ${routes.length} routes × ${widths.length} viewport widths.`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(async () => { await terminateChild();
  setTimeout(() => { try { fs.rmSync(smokeUserDataDir, { recursive: true, force: true }); } catch { /* best effort */ } }, 1500); });
