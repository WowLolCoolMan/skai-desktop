// Packaged UI matrix smoke: every route at window sizes from 1920x1080 down to 400x500 (tiling
// splits), light/dark themes, sidebar expanded/collapsed, with deliberately long seeded content.
// Fails on runtime errors, blank pages, page-level horizontal overflow, content off-screen or
// bleeding out of its card, clipped text, controls that cannot be reached, and overlapping
// controls. All data lives in a throwaway profile (XDG/APPDATA redirected, isolated user-data-dir).
//
//   node scripts/smoke-electron-ui-matrix.cjs [packaged executable]
//   (Linux CI: run under xvfb-run; set UI_MATRIX_QUICK=1 for a single theme/sidebar variant)
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolveDisplayBackend } = require("../apps/desktop/electron/linux-windowing.cjs");

const defaultName = process.platform === "win32" ? "Skai Desktop.exe" : "Skai Desktop";
const defaultRoot = path.join(__dirname, "..", "dist", "electron", `${process.platform === "win32" ? "win" : "linux"}-x64`);
const executable = path.resolve(process.argv[2] || path.join(defaultRoot, defaultName));
if (!fs.existsSync(executable)) {
  console.error(`Packaged Electron executable not found: ${executable}. Run npm run package:electron first.`);
  process.exit(1);
}
const port = 19331;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "skai-ui-matrix-"));
const env = { ...process.env, XDG_CONFIG_HOME: path.join(temp, "config"), XDG_DATA_HOME: path.join(temp, "data"), XDG_CACHE_HOME: path.join(temp, "cache"), APPDATA: path.join(temp, "appdata"), LOCALAPPDATA: path.join(temp, "localappdata") };
for (const dir of ["config", "data", "cache", "appdata", "localappdata"]) fs.mkdirSync(path.join(temp, dir), { recursive: true });
const displayBackendArgs = ((decision) => decision.switchValue ? [`--ozone-platform=${decision.switchValue}`] : [])(resolveDisplayBackend({ argv: [] }));
const child = spawn(executable, [`--remote-debugging-port=${port}`, `--user-data-dir=${path.join(temp, "electron")}`, "--disable-gpu", ...displayBackendArgs], { cwd: path.dirname(executable), env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let appLog = "";
child.stdout.on("data", (chunk) => { appLog = (appLog + chunk).slice(-20000); });
child.stderr.on("data", (chunk) => { appLog = (appLog + chunk).slice(-20000); });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  const listeners = [];
  let nextId = 1;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) { const entry = pending.get(message.id); pending.delete(message.id); if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result); return; }
    for (const listener of listeners) listener(message);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (pending.delete(id)) reject(new Error(`Timed out: ${method}`)); }, 20000); });
  return {
    open: new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); }),
    send,
    on: (listener) => listeners.push(listener),
    evaluate: async (expression) => { const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(`evaluate: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`); return result.result?.value; },
    close: () => socket.close(),
  };
}

// Collected in the page: layout problems for the current route and viewport.
const PROBE = String.raw`(() => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const visible = (el) => { if (el.closest('details:not([open])') && !el.closest('summary')) return false; if (el.closest('.skip-link, .sr-only') && document.activeElement !== el) return false; const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const describe = (el) => { const r = el.getBoundingClientRect(); return { el: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''), text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 50), box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] }; };
  const scrollerX = (el) => { for (let a = el.parentElement; a; a = a.parentElement) { const s = getComputedStyle(a); if (/(auto|scroll)/.test(s.overflowX)) return a; } return null; };
  const positioned = (el, stop) => { for (let a = el; a && a !== stop; a = a.parentElement) { const p = getComputedStyle(a).position; if (p === 'absolute' || p === 'fixed' || p === 'sticky') return true; } return false; };
  const isBox = (el) => { const s = getComputedStyle(el); const bg = s.backgroundColor; const hasBg = bg && bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg); const hasBorder = ['Top','Right','Bottom','Left'].some((k) => parseFloat(s['border' + k + 'Width']) > 0); return hasBg || hasBorder; };
  const outOfView = (el) => { const r = el.getBoundingClientRect(); for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const s = getComputedStyle(a); if (/(auto|scroll|hidden|clip)/.test(s.overflow + s.overflowX + s.overflowY)) { const ar = a.getBoundingClientRect(); if (r.bottom <= ar.top + 1 || r.top >= ar.bottom - 1 || r.right <= ar.left + 1 || r.left >= ar.right - 1) return true; } } return false; };
  const issues = { pageOverflowX: 0, offscreen: [], clipped: [], bleed: [], unreachable: [], overlap: [], blank: false };
  issues.pageOverflowX = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - vw;
  const all = [...document.querySelectorAll('#root *')].filter(visible);
  const leafs = all.filter((el) => el.matches('button,input,select,textarea,a,img,svg,h1,h2,h3,h4,p,strong,small,label,code,pre,li,td,th,em,span') && !el.closest('svg *'));
  for (const el of leafs) {
    if (el.closest('.sr-only')) continue;
    const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    const sx = scrollerX(el);
    if (!sx && !positioned(el) && (r.left < -1 || r.right > vw + 1)) issues.offscreen.push(describe(el));
    const intentional = s.textOverflow === 'ellipsis' || el.matches('input,textarea,select,img,svg') ;
    if (!intentional && !sx && el.matches('button,a,h1,h2,h3,h4,p,strong,small,label,span,li,td,th') && el.scrollWidth > el.clientWidth + 1 && /(hidden|clip)/.test(s.overflowX + s.overflow)) issues.clipped.push(describe(el));
    // Bleed: content wider than the nearest boxed ancestor that does not clip or scroll it.
    if (!sx && !el.matches('img,svg')) {
      for (let a = el.parentElement; a && a.id !== 'root'; a = a.parentElement) {
        const as = getComputedStyle(a);
        if (/(hidden|clip|auto|scroll)/.test(as.overflowX)) break;
        if (isBox(a)) { const ar = a.getBoundingClientRect(); if (!positioned(el, a) && (r.right > ar.right + 2 || r.left < ar.left - 2)) issues.bleed.push({ ...describe(el), container: describe(a).el, by: Math.round(Math.max(r.right - ar.right, ar.left - r.left)) }); break; }
      }
    }
    // Unreachable: a control hidden by an ancestor that clips (not scrolls), or below the fold with nothing able to scroll.
    if (el.matches('button,input,select,textarea,a[href]') && !el.disabled) {
      let hidden = false, canScroll = false;
      for (let a = el.parentElement; a; a = a.parentElement) {
        const as = getComputedStyle(a); const ar = a.getBoundingClientRect();
        if (/(auto|scroll)/.test(as.overflowY) && a.scrollHeight > a.clientHeight + 1) canScroll = true;
        if (!canScroll && /(hidden|clip)/.test(as.overflowY + as.overflow) && (r.top >= ar.bottom - 1 || r.bottom <= ar.top + 1)) { hidden = true; break; }
      }
      const docScroll = document.scrollingElement.scrollHeight > vh + 1 && getComputedStyle(document.body).overflowY !== 'hidden';
      if (hidden || (!canScroll && !docScroll && r.top >= vh - 1)) issues.unreachable.push(describe(el));
    }
  }
  // Only the part of a control its scroll/clip ancestors actually show can overlap anything.
  const visibleRect = (el) => { const r = el.getBoundingClientRect(); let box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const s = getComputedStyle(a); if (/(auto|scroll|hidden|clip)/.test(s.overflow + s.overflowX + s.overflowY)) { const ar = a.getBoundingClientRect(); box = { left: Math.max(box.left, ar.left), top: Math.max(box.top, ar.top), right: Math.min(box.right, ar.right), bottom: Math.min(box.bottom, ar.bottom) }; } } return { left: box.left, top: box.top, right: Math.max(box.left, box.right), bottom: Math.max(box.top, box.bottom), width: Math.max(0, box.right - box.left), height: Math.max(0, box.bottom - box.top) }; };
  const controls = all.filter((el) => el.matches('button,input,select,textarea') && !el.closest('.sr-only') && !outOfView(el));
  for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
    const a = controls[i], b = controls[j]; if (a.contains(b) || b.contains(a)) continue;
    const ra = visibleRect(a), rb = visibleRect(b);
    const ix = Math.max(0, Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left)), iy = Math.max(0, Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top));
    const small = Math.min(ra.width * ra.height, rb.width * rb.height);
    if (small > 0 && ix * iy > small * 0.3) issues.overlap.push([describe(a), describe(b)]);
  }
  const main = document.querySelector('.app-content') || document.querySelector('#root');
  issues.blank = !main || main.innerText.trim().length < 15;
  for (const k of ['offscreen','clipped','bleed','unreachable','overlap']) issues[k] = issues[k].slice(0, 6);
  return issues;
})()`;

const routes = ["chat", "coding", "settings", "models", "images", "marketplace", "workbench", "terminal", "memory", "usage"];
const viewports = [[1920, 1080], [1440, 900], [1280, 720], [1100, 800], [945, 1033], [945, 515], [800, 600], [640, 900], [480, 700], [400, 500]];
const variants = process.env.UI_MATRIX_QUICK === "1" ? [["dark", "false"]] : [["dark", "false"], ["light", "false"], ["dark", "true"], ["light", "true"]];

async function main() {
  let target;
  for (let attempt = 0; attempt < 200 && !target; attempt += 1) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((item) => item.type === "page" && !item.url.includes("pet=1") && item.title.includes("Skai")); } catch { /* still starting */ }
    if (!target) await sleep(150);
  }
  if (!target) throw new Error(`Packaged Electron did not expose the main page. Output: ${appLog.slice(-1500)}`);
  const cdp = connect(target.webSocketDebuggerUrl);
  await cdp.open;
  const runtimeErrors = [];
  let phase = "startup";
  cdp.on((message) => {
    if (message.method === "Runtime.exceptionThrown") runtimeErrors.push(`${phase}: ${(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text ?? "").split("\n")[0]}`);
    if (message.method === "Runtime.consoleAPICalled" && (message.params.type === "error" || message.params.type === "assert")) runtimeErrors.push(`${phase}: console.error ${message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" ").slice(0, 200)}`);
  });
  await cdp.send("Runtime.enable");
  await cdp.evaluate("(async () => { for (let i = 0; i < 150 && !document.querySelector('[aria-label=\"Primary navigation\"]'); i++) await new Promise((r) => setTimeout(r, 100)); return 1; })()");

  // Long, awkward content: long titles, unbroken tokens, wide code, tables, many chats, long project names.
  phase = "seed";
  const longWord = "Supercalifragilisticexpialidocious_".repeat(5);
  const longTitle = "Investigate why the tiled window squeezes the composer when the conversation title is extremely long and keeps going";
  const seedProject = fs.mkdtempSync(path.join(temp, "project-with-an-exceptionally-long-folder-name-for-layout-testing-"));
  fs.writeFileSync(path.join(seedProject, "README.md"), `# Seed\n${longWord}\n`);
  const seeded = await cdp.evaluate(`(async () => {
    const r = (m, p) => window.serverRockAgent.request(m, p);
    const ok = [];
    ok.push((await r("conversation.save", { title: ${JSON.stringify(longTitle)}, messages: [{ role: "user", content: ${JSON.stringify(`Unbroken token: ${longWord}`)} }, { role: "assistant", content: ${JSON.stringify("Code:\n\n```bash\necho " + "x".repeat(260) + "\n```\n\n| one | two | three | four | five |\n|---|---|---|---|---|\n| " + "data ".repeat(12) + "| b | c | d | e |\n\nURL https://example.invalid/" + "path/".repeat(40))} }] })).ok);
    ok.push((await r("conversation.save", { title: ${JSON.stringify(longWord)}, messages: [{ role: "user", content: "short" }] })).ok);
    for (let i = 0; i < 25; i++) await r("conversation.save", { title: "Filler conversation number " + i, messages: [{ role: "user", content: "filler " + i }] });
    ok.push((await r("tasks.plan", { title: ${JSON.stringify(longTitle)}, instruction: ${JSON.stringify(`Instruction ${longWord}`)}, environment: "local" })).ok);
    ok.push((await r("scheduled.create", { prompt: ${JSON.stringify(`${longTitle} ${longWord}`)}, dueAt: new Date(Date.now() + 3600000).toISOString(), repeatEveryMinutes: 60 })).ok);
    ok.push((await r("project.save", { name: ${JSON.stringify(longTitle)}, folderPaths: [${JSON.stringify(seedProject)}] })).ok);
    return ok;
  })()`);
  if (!Array.isArray(seeded) || seeded.some((value) => value !== true)) throw new Error(`Seeding the throwaway profile failed: ${JSON.stringify(seeded)}`);

  const findings = [];
  for (const [theme, collapsed] of variants) {
    phase = `${theme}/${collapsed === "true" ? "collapsed" : "expanded"}`;
    await cdp.evaluate(`localStorage.setItem('skai.themeMode', '${theme}'); localStorage.setItem('skai.sidebar.collapsed', '${collapsed}'); location.reload(); 1`).catch(() => {});
    await sleep(500);
    await cdp.evaluate("(async () => { for (let i = 0; i < 150 && !document.querySelector('[aria-label=\"Primary navigation\"]'); i++) await new Promise((r) => setTimeout(r, 100)); return 1; })()");
    for (const [width, height] of viewports) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
      for (const route of routes) {
        phase = `${theme}/${collapsed === "true" ? "collapsed" : "expanded"} ${width}x${height} #/${route}`;
        await cdp.evaluate(`location.hash = '#/${route}'; 1`);
        await sleep(260);
        const issues = await cdp.evaluate(PROBE);
        const problems = [];
        if (issues.blank) problems.push("blank page");
        if (issues.pageOverflowX > 1) problems.push(`page scrolls sideways by ${issues.pageOverflowX}px`);
        for (const [kind, label] of [["offscreen", "off-screen"], ["clipped", "clipped"], ["bleed", "bleeds out of its card"], ["unreachable", "unreachable"]]) for (const item of issues[kind]) problems.push(`${label}: ${item.el} "${item.text}"${item.container ? ` in ${item.container}` : ""}`);
        for (const [a, b] of issues.overlap) problems.push(`overlap: ${a.el} "${a.text}" x ${b.el} "${b.text}"`);
        if (problems.length) findings.push(`${phase}\n    ${problems.join("\n    ")}`);
      }
    }
  }
  await cdp.send("Emulation.clearDeviceMetricsOverride");
  cdp.close();
  if (runtimeErrors.length) findings.push(`runtime errors:\n    ${[...new Set(runtimeErrors)].slice(0, 15).join("\n    ")}`);
  if (findings.length) throw new Error(`UI matrix smoke found ${findings.length} problem group(s):\n  ${findings.slice(0, 25).join("\n  ")}`);
  console.log(`Packaged UI matrix smoke passed: ${routes.length} routes x ${viewports.length} window sizes x ${variants.length} theme/sidebar variants, no runtime errors.`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  if (process.platform === "win32" && child.pid) {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    await new Promise((resolve) => { killer.once("close", resolve); killer.once("error", resolve); });
  } else if (!child.killed) child.kill("SIGTERM");
  await sleep(1500);
  try { fs.rmSync(temp, { recursive: true, force: true }); } catch { /* the app may release files shortly after exit */ }
});
