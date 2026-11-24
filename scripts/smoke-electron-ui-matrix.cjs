// Packaged UI matrix smoke: every route at window sizes from 1920x1080 down to 960x640 (tiling
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
const env = { ...process.env, SKAI_ELECTRON_SMOKE: "true", SKAI_SKIP_LEGACY_DATA_MIGRATION: "true", XDG_CONFIG_HOME: path.join(temp, "config"), XDG_DATA_HOME: path.join(temp, "data"), XDG_CACHE_HOME: path.join(temp, "cache"), APPDATA: path.join(temp, "appdata"), LOCALAPPDATA: path.join(temp, "localappdata") };
for (const dir of ["config", "data", "cache", "appdata", "localappdata"]) fs.mkdirSync(path.join(temp, dir), { recursive: true });
const agentProfile = path.join(temp, "agent-profile");
fs.mkdirSync(agentProfile, { recursive: true });
Object.assign(env, {
  SRAI_SETTINGS_PATH: path.join(agentProfile, "settings.json"),
  SRAI_MCP_CONNECTIONS_PATH: path.join(agentProfile, "mcp-connections.json"),
  SRAI_CONVERSATIONS_PATH: path.join(agentProfile, "conversations.json"),
  SRAI_MEMORY_PATH: path.join(agentProfile, "memory.json"),
  SRAI_CORPUS_PATH: path.join(agentProfile, "document-corpus.json"),
  SRAI_CHAT_QUEUE_PATH: path.join(agentProfile, "chat-queue.json"),
  SRAI_TASKS_PATH: path.join(agentProfile, "agent-tasks.json"),
  SRAI_SCHEDULED_TASKS_PATH: path.join(agentProfile, "scheduled-tasks.json"),
  SRAI_PROJECTS_PATH: path.join(agentProfile, "projects.json"),
  SRAI_UNDO_PATH: path.join(agentProfile, "workspace-undo.json"),
  SRAI_OPERATIONS_PATH: path.join(agentProfile, "operations.json"),
});
fs.writeFileSync(env.SRAI_SETTINGS_PATH, JSON.stringify({ themeMode: "dark" }));
const displayBackendArgs = ((decision) => decision.switchValue ? [`--ozone-platform=${decision.switchValue}`] : [])(resolveDisplayBackend({ argv: [] }));
const child = spawn(executable, [`--remote-debugging-port=${port}`, `--user-data-dir=${path.join(temp, "electron")}`, `--skai-isolated-smoke-app-data=${path.join(temp, "appdata")}`, "--disable-gpu", ...displayBackendArgs], { cwd: path.dirname(executable), env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
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
    evaluate: async (expression) => { const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(`evaluate: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text} in ${expression.slice(0, 260)}`); return result.result?.value; },
    close: () => socket.close(),
  };
}

async function clickInRenderer(cdp, selector) {
  const point = await cdp.evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return null; const rect = element.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; })()`);
  if (!point) throw new Error(`UI interaction target was not found: ${selector}`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
}

async function clickButtonText(cdp, text, scope = "body") {
  const point = await cdp.evaluate(`(() => { const root = document.querySelector(${JSON.stringify(scope)}); const element = [...(root?.querySelectorAll('button') ?? [])].find((button) => button.innerText.trim() === ${JSON.stringify(text)}); if (!element || element.disabled) return null; const rect = element.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; })()`);
  if (!point) throw new Error(`UI button was not found or is disabled: ${text}`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
}

// Collected in the page: layout problems for the current route and viewport.
const PROBE = String.raw`(() => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const modal = document.querySelector('[aria-modal="true"]');
  const visible = (el) => { if (modal && !el.closest('[aria-modal="true"]')) return false; if (el.closest('details:not([open])') && !el.closest('summary')) return false; if (el.closest('.skip-link, .sr-only') && document.activeElement !== el) return false; const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const describe = (el) => { const r = el.getBoundingClientRect(); const card = el.closest('.ui-card'); const cr = card?.getBoundingClientRect(); const clips = []; for (let a = el.parentElement; a; a = a.parentElement) { const cs = getComputedStyle(a); if (/(hidden|clip|auto|scroll)/.test(cs.overflowY + cs.overflow)) { const ar = a.getBoundingClientRect(); clips.push([a.className || a.tagName, Math.round(ar.top), Math.round(ar.bottom), cs.overflowY]); } } return { el: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''), text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 50), box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], card: card ? [Math.round(cr.left), Math.round(cr.top), Math.round(cr.width), Math.round(cr.height)] : null, clips }; };
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
  const overlayRoot = (el) => el.closest('[role="dialog"], [role="menu"], [role="listbox"], .global-rail-extras-panel');
  for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
    const a = controls[i], b = controls[j]; if (a.contains(b) || b.contains(a)) continue;
    const overlayA = overlayRoot(a), overlayB = overlayRoot(b);
    if (overlayA !== overlayB && (overlayA || overlayB)) continue;
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

// Every route the app declares, so new pages are covered without editing this list.
const routeType = fs.readFileSync(path.join(__dirname, "..", "apps", "desktop", "src", "app", "types.ts"), "utf8").match(/export type Route = ([^;]+);/);
const routes = routeType ? [...routeType[1].matchAll(/"([a-z-]+)"/g)].map((match) => match[1]) : [];
if (routes.length < 5) throw new Error("Could not read the Route union from apps/desktop/src/app/types.ts.");
const settingsSource = fs.readFileSync(path.join(__dirname, "..", "apps", "desktop", "src", "features", "settings", "SettingsPage.tsx"), "utf8");
const settingsCategorySource = settingsSource.match(/const categories = \[([^\]]+)\] as const;/)?.[1] ?? "";
const settingsCategories = [...settingsCategorySource.matchAll(/"([^\"]+)"/g)].map((match) => match[1]);
if (settingsCategories.length < 5) throw new Error("Could not read the settings categories from SettingsPage.tsx.");
const captureDirectory = path.join(__dirname, "..", ".tmp", "ui-matrix-review");
// The five native desktop sizes plus the requested 390 px renderer emulation.
const viewports = [[1920, 1080], [1440, 900], [1280, 720], [1100, 800], [960, 640]];
const testedRoutes = process.env.UI_MATRIX_ROUTE ? routes.filter((route) => process.env.UI_MATRIX_ROUTE.split(",").includes(route)) : routes;
const requestedViewport = /^(\d+)x(\d+)$/.exec(process.env.UI_MATRIX_VIEWPORT || "");
const testedViewports = requestedViewport ? [[Number(requestedViewport[1]), Number(requestedViewport[2])]] : viewports;
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
    if (message.method === "Runtime.exceptionThrown") {
      const details = message.params.exceptionDetails;
      const summary = (details.exception?.description ?? details.text ?? "").split("\n")[0];
      const frame = details.stackTrace?.callFrames?.[0];
      runtimeErrors.push(`${phase}: ${summary}${frame ? ` @ ${frame.url}:${frame.lineNumber + 1}:${frame.columnNumber + 1}` : ""}`);
    }
    if (message.method === "Runtime.consoleAPICalled" && (message.params.type === "error" || message.params.type === "assert")) runtimeErrors.push(`${phase}: console.error ${message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" ").slice(0, 200)}`);
  });
  await cdp.send("Runtime.enable");
  await cdp.evaluate("(async () => { for (let i = 0; i < 150 && !document.querySelector('[aria-label=\"Primary navigation\"]'); i++) await new Promise((r) => setTimeout(r, 100)); return 1; })()");

  // Long, awkward content: long titles, unbroken tokens, wide code, tables, many chats, long project names.
  phase = "seed";
  const captureMode = process.env.UI_MATRIX_CAPTURE === "1";
  const exerciseChatActions = process.env.UI_MATRIX_EXERCISE_CHAT_ACTIONS === "1";
  const exerciseDocuments = process.env.UI_MATRIX_EXERCISE_DOCUMENTS === "1";
  const includeCodingFixture = process.env.UI_MATRIX_EXERCISE_CHAT !== "1";
  const longWord = captureMode ? "" : "Supercalifragilisticexpialidocious_".repeat(5);
  const longTitle = captureMode ? "Plan a simple herb garden" : "Investigate why the tiled window squeezes the composer when the conversation title is extremely long and keeps going";
  const seedProject = fs.mkdtempSync(path.join(temp, captureMode ? "starter-project-" : "project-with-an-exceptionally-long-folder-name-for-layout-testing-"));
  fs.writeFileSync(path.join(seedProject, "README.md"), "# Starter project\n\nUse the Coding Agent thread to review the project, then inspect README.md in the docked editor.\n");
  fs.mkdirSync(path.join(seedProject, "src"), { recursive: true });
  fs.writeFileSync(path.join(seedProject, "src", "index.ts"), "export function greet(name: string) {\n  return `Hello, ${name}`;\n}\n");
  const seeded = await cdp.evaluate(`(async () => {
    const r = (m, p) => window.skaiAgent.request(m, p);
    const results = [];
    results.push(await r("conversation.save", { title: ${JSON.stringify(longTitle)}, messages: [{ role: "user", content: ${JSON.stringify(captureMode ? "Help me plan a low-maintenance herb garden for a sunny patio." : `Unbroken token: ${longWord}`)} }, { role: "assistant", content: ${JSON.stringify(captureMode ? "Start with basil, thyme, and parsley in containers with good drainage. Check the soil before watering and group pots by sunlight needs." : "Code:\n\n```bash\necho " + "x".repeat(260) + "\n```\n\n| one | two | three | four | five |\n|---|---|---|---|---|\n| " + "data ".repeat(12) + "| b | c | d | e |\n\nURL https://example.invalid/" + "path/".repeat(40))} }] }));
    if (!${captureMode}) {
      results.push(await r("conversation.save", { title: ${JSON.stringify(longWord)}, messages: [{ role: "user", content: "short" }] }));
      for (let i = 0; i < 25; i++) await r("conversation.save", { title: "Filler conversation number " + i, messages: [{ role: "user", content: "filler " + i }] });
    }
    results.push(await r("tasks.plan", { title: ${JSON.stringify(captureMode ? "Review garden layout options" : longTitle)}, instruction: ${JSON.stringify(captureMode ? "Compare container sizes and sunlight needs before suggesting a layout." : `Instruction ${longWord}`)}, environment: "local" }));
    results.push(await r("scheduled.create", { prompt: ${JSON.stringify(captureMode ? "Review the herb garden plan" : `${longTitle} ${longWord}`)}, dueAt: new Date(Date.now() + 3600000).toISOString(), repeatEveryMinutes: 60 }));
    const project = await r("project.save", { name: ${JSON.stringify(captureMode ? "Skai Starter Project" : "Revision 4 coding fixture")}, folderPaths: [${JSON.stringify(seedProject)}] });
    results.push(project);
    if (project.ok && ${includeCodingFixture}) results.push(await r("conversation.save", { title: "Review the starter project", mode: "Coding Agent", responseMode: "coding", projectId: project.result?.id, messages: [{ role: "user", content: "Review this project structure and suggest the next small improvement." }, { role: "assistant", content: "I’ll inspect the existing files, then outline a focused change and how to verify it." }] }));
    if (${captureMode} && results[0]?.result?.id) results.push(await r("conversation.save", { id: results[0].result.id, title: ${JSON.stringify(longTitle)}, mode: "ChatBot", responseMode: "think", messages: [{ role: "user", content: "Help me plan a low-maintenance herb garden for a sunny patio." }, { role: "assistant", content: "Start with basil, thyme, and parsley in containers with good drainage. Check the soil before watering and group pots by sunlight needs." }] }));
    if (${captureMode} && ${exerciseDocuments}) results.push(await r("conversation.save", { title: "Plan and results summary", mode: "ChatBot", responseMode: "think", messages: [{ role: "user", content: "Based only on the attached plan and results, what were the objectives and did we meet them?", attachments: [{ fileName: "Plan.pdf", content: "Objectives: deliver the MVP by the end of Q2; reach at least 10,000 active users; achieve a conversion rate of at least 5%." }, { fileName: "Results.xlsx", content: "MVP delivered in Q2. Active users: 12,480. Conversion rate: 5.6%." }] }, { role: "assistant", content: "According to Plan.pdf, the objectives were to deliver the MVP by Q2, reach at least 10,000 active users, and reach a conversion rate of at least 5%. Results.xlsx reports delivery in Q2, 12,480 active users, and a 5.6% conversion rate, so all three objectives were met. Sources: Plan.pdf (objectives); Results.xlsx (outcomes)." }] }));
    if (${captureMode} && ${exerciseChatActions}) for (const text of ["Add a week-by-week planting schedule.", "Include a simple materials checklist.", "Estimate the monthly watering routine."]) results.push(await r("chat.queue.enqueue", { text }));
    if (${captureMode}) for (const card of [
      { name: "Default", roles: "General-purpose assistant", instructions: "Be clear, practical, and adaptable to the user's task." },
      { name: "Release Engineer", roles: "Helps with releases, readiness, and ops", instructions: "Be concise, practical, and safety-minded. Focus on release planning, readiness checks, risk, and operations." },
      { name: "Code Reviewer", roles: "Reviews code and suggests improvements", instructions: "Prioritize correctness, security, and maintainability. Explain findings with file and line references." },
      { name: "Tech Writer", roles: "Drafts and edits clear technical docs", instructions: "Use plain language, organize information clearly, and preserve technical accuracy." },
    ]) results.push(await r("persona.save", { persona: { ...card, sourceMode: "own-material", subjectType: "character", voice: "Friendly and clear", personality: "Patient, focused, and direct", thinkingStyle: "Work step by step and explain important choices", interactionStyle: "Ask for missing context only when it affects the result", values: "Clarity, accuracy, and useful next steps", knowledge: "Use the supplied material and task context", evidenceBoundaries: "State uncertainty and do not invent unsupported facts", sourceMaterial: card.instructions } }));
    return results;
  })()`);
  if (!Array.isArray(seeded) || seeded.some((result) => result?.ok !== true)) throw new Error(`Seeding the throwaway profile failed: ${JSON.stringify(seeded)}`);

  const findings = [];
  for (const [theme, collapsed] of variants) {
    phase = `${theme}/${collapsed === "true" ? "collapsed" : "expanded"}`;
    await cdp.evaluate(`localStorage.setItem('skai.themeMode', '${theme}'); localStorage.setItem('skai.sidebar.collapsed', '${collapsed}'); location.reload(); 1`).catch(() => {});
    await sleep(500);
    await cdp.evaluate("(async () => { for (let i = 0; i < 150 && !document.querySelector('[aria-label=\"Primary navigation\"]'); i++) await new Promise((r) => setTimeout(r, 100)); return 1; })()");
    for (const [width, height] of testedViewports) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 960 });
      for (const route of testedRoutes) {
        phase = `${theme}/${collapsed === "true" ? "collapsed" : "expanded"} ${width}x${height} #/${route}`;
        const renderedRoute = route === "personas" || route === "persona-groups" ? "persona-workshop" : route === "plugins" ? "marketplace" : route === "workbench" ? "chat" : route;
        await cdp.evaluate(`window.history.pushState({ ...(window.history.state ?? {}), skaiNavigation: { route: '${renderedRoute}', index: 0, length: 1 } }, '', '#/${route}'); window.dispatchEvent(new PopStateEvent('popstate')); 1`);
        const routeReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 40; i++) { if (document.title.endsWith(' · ${renderedRoute}')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
        if (!routeReady) throw new Error(`UI matrix did not render #/${route}; expected document title suffix "· ${renderedRoute}" and saw "${await cdp.evaluate("document.title")}".`);
        if (route === "coding" && process.env.UI_MATRIX_EXERCISE_CODING === "1") {
          await clickInRenderer(cdp, ".coding-no-project button");
          const projectsReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 80; i++) { if (document.title.endsWith(' · projects')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
          if (!projectsReady) throw new Error("Coding workflow could not open Projects.");
          await clickInRenderer(cdp, ".project-directory-open-action");
          const projectReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 100; i++) { if (document.querySelector('.coding-workspace-tabs')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
          if (!projectReady) throw new Error("Coding workflow could not open the seeded project.");
          const seededCodingThreadVisible = await cdp.evaluate(`Boolean([...document.querySelectorAll('.sidebar-project-thread')].find((button) => button.innerText.trim() === 'Review the starter project'))`);
          if (!seededCodingThreadVisible) await cdp.evaluate(`document.querySelector('button[aria-label="Expand Skai Starter Project"]')?.click(); 1`);
          const seededCodingThreadReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 40; i++) { if ([...document.querySelectorAll('.sidebar-project-thread')].some((button) => button.innerText.trim() === 'Review the starter project')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
          if (!seededCodingThreadReady) throw new Error("Coding workflow could not find the seeded project conversation.");
          await clickButtonText(cdp, "Review the starter project", ".sidebar-project-thread-list");
          const seededCodingThreadActive = await cdp.evaluate(`(async () => { for (let i = 0; i < 40; i++) { if (document.querySelector('.project-thread-panel .chat-page.is-coding-agent')?.innerText.includes('Review this project structure')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
          if (!seededCodingThreadActive) throw new Error("Coding workflow opened the project without restoring its linked Coding Agent conversation.");
          const readme = await cdp.evaluate(`(() => [...document.querySelectorAll('.project-file-item')].find((button) => button.innerText.includes('README.md'))?.getAttribute('title') ?? null)()`);
          if (readme) await cdp.evaluate(`document.querySelector('.project-file-item[title=${JSON.stringify(readme)}]')?.click(); 1`);
          await sleep(500);
          const editorReady = await cdp.evaluate(`Boolean(document.querySelector('.monaco-editor-shell .monaco-editor'))`);
          if (!editorReady) throw new Error(`Coding workflow did not load Monaco beside its chat thread: ${JSON.stringify(await cdp.evaluate(`(() => ({ title: document.title, mode: document.querySelector('.sidebar-agent-trigger strong')?.textContent?.trim(), selectedFile: document.querySelector('.file-editor-heading span')?.textContent, files: [...document.querySelectorAll('.project-file-item')].map((item) => ({ text: item.innerText, title: item.title })), workspace: document.querySelector('.coding-session-grid')?.className, editor: document.querySelector('#coding-files-workspace')?.outerHTML.slice(0, 300), empty: document.querySelector('.project-file-preview')?.innerText }))()`))}`);
          await cdp.evaluate(`(() => { const workspace = document.querySelector('.coding-session-grid'); if (workspace) workspace.scrollTop = workspace.scrollHeight; return 1; })()`);
          await clickInRenderer(cdp, ".monaco-editor");
          await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Control", code: "ControlLeft", modifiers: 2 });
          await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 2 });
          await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2 });
          await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Control", code: "ControlLeft" });
          await cdp.send("Input.insertText", { text: "# Revision 4 editor review\n\nTemporary smoke edit for the isolated workspace.\n" });
          const draftReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 30; i++) { if (document.querySelector('#coding-file-editor button:last-child')?.disabled === false) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
          if (!draftReady) throw new Error(`Monaco did not accept the isolated edit: ${JSON.stringify(await cdp.evaluate(`(() => { const selectors = ['.app-main','.app-content','.coding-session-grid','.coding-project-browser','.project-file-layout','.file-editor-panel','.monaco-editor-shell','.monaco-editor','.monaco-editor .view-lines']; return { viewport: [innerWidth, innerHeight], widths: Object.fromEntries(selectors.map((selector) => { const element = document.querySelector(selector); const rect = element?.getBoundingClientRect(); return [selector, rect && { x: rect.x, y: rect.y, w: rect.width, h: rect.height, client: [element.clientWidth, element.clientHeight], scroll: [element.scrollWidth, element.scrollHeight] }]; })), file: document.querySelector('#coding-file-editor')?.innerText, editor: document.querySelector('.monaco-editor')?.innerText?.slice(0, 140), active: document.activeElement?.outerHTML?.slice(0, 120), buttons: [...document.querySelectorAll('#coding-file-editor button')].map((button) => ({ text: button.innerText, disabled: button.disabled })) }; })()`))}`);
          await clickButtonText(cdp, "Review diff", "#coding-file-editor");
          const diffReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 80; i++) { if (document.querySelector('.coding-diff-preview section[aria-label="Original file"]') && document.querySelector('.coding-diff-preview section[aria-label="Working copy"]')) return true; await new Promise((r) => setTimeout(r, 75)); } return false; })()`);
          if (!diffReady) throw new Error(`Review diff did not open the side-by-side file comparison while keeping the coding thread visible: ${JSON.stringify(await cdp.evaluate(`(() => ({ heading: document.querySelector('#coding-file-editor')?.innerText, editorText: document.querySelector('.monaco-editor .view-lines')?.innerText?.slice(0,160), shell: document.querySelector('.coding-diff-preview')?.innerText, buttons: [...document.querySelectorAll('#coding-file-editor button')].map((button) => ({ text: button.innerText, disabled: button.disabled })) }))()`))}`);
          const threadStillVisible = await cdp.evaluate(`Boolean(document.querySelector('.project-thread-panel .chat-page.is-coding-agent'))`);
          if (!threadStillVisible) throw new Error("Opening the file diff hid the Coding Agent conversation.");
          await clickButtonText(cdp, "Editor", "#coding-file-editor");
          const editorRestored = await cdp.evaluate(`(async () => { for (let i = 0; i < 80; i++) { if (document.querySelector('.monaco-editor-shell .monaco-editor')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
          if (!editorRestored) throw new Error("Switching back from Review diff did not restore Monaco editor.");
          await sleep(350);
          await clickButtonText(cdp, "Save edit", "#coding-file-editor");
          const undoReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 40; i++) { const undo = [...document.querySelectorAll('#coding-file-editor button')].find((button) => button.textContent?.trim() === 'Undo'); if (undo && !undo.disabled) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
          if (!undoReady) throw new Error("Saving the isolated Monaco edit did not enable Undo.");
          await cdp.evaluate(`([...document.querySelectorAll('#coding-file-editor button')].find((button) => button.textContent?.trim() === 'Undo')?.click(), 1)`);
          const restoredEditor = await cdp.evaluate(`(async () => { for (let i = 0; i < 60; i++) { if (document.querySelector('.monaco-editor')?.innerText?.replace(/\\s+/g, ' ')?.includes('Starter project')) return true; await new Promise((r) => setTimeout(r, 75)); } return false; })()`);
          if (!restoredEditor) throw new Error(`Undo did not restore the starter file in Monaco: ${JSON.stringify(await cdp.evaluate(`(() => ({ editor: document.querySelector('.monaco-editor')?.innerText?.slice(0, 180), heading: document.querySelector('#coding-file-editor')?.innerText, undo: [...document.querySelectorAll('#coding-file-editor button')].find((button) => button.textContent?.trim() === 'Undo')?.disabled }))()`))}`);
        }
        if (route === "persona-workshop" && process.env.UI_MATRIX_EXERCISE_PERSONA === "1") {
          const personaReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 60; i++) { if (document.querySelector('.persona-library-picker > button')) return true; await new Promise((r) => setTimeout(r, 100)); } return false; })()`);
          if (!personaReady) throw new Error("Persona workflow did not load the seeded persona list.");
          await cdp.evaluate(`([...document.querySelectorAll('.persona-library-picker > button')].find((button) => button.innerText.includes('Release Engineer'))?.click(), 1)`);
          const selectedPersona = await cdp.evaluate(`document.querySelector('.persona-library-detail h2')?.textContent?.trim()`);
          if (selectedPersona !== "Release Engineer") throw new Error(`Persona profile selection failed: ${selectedPersona}`);
        }
        await sleep(process.env.UI_MATRIX_CAPTURE === "1" ? 350 : 120);
        if (process.env.UI_MATRIX_CAPTURE === "1" && (route === "marketplace" || route === "memory")) {
          const settled = await cdp.evaluate(`(async () => { const pending = ${JSON.stringify(route === "memory" ? "Loading memory…" : "Loading Marketplace…")}; for (let i = 0; i < 60; i++) { if (!document.body.innerText.includes(pending)) return true; await new Promise((r) => setTimeout(r, 100)); } return !document.body.innerText.includes(pending); })()`);
          if (!settled) console.warn(`[capture] #/${route} remained in its loading state after 6 seconds; checking the connected native feature.`);
        }
        if (process.env.UI_MATRIX_CAPTURE === "1" && route === "images") {
          await cdp.evaluate(`(async () => { for (let i = 0; i < 300; i++) { const status = document.querySelector('.visuals-runtime-settings .status-badge')?.textContent?.trim().toLowerCase(); if (status && status !== 'checking') return true; await new Promise((r) => setTimeout(r, 100)); } return false; })()`);
        }
        if (route === "chat" && process.env.UI_MATRIX_EXERCISE_CHAT === "1") {
          const activeChatClass = await cdp.evaluate(`document.querySelector('.chat-page')?.className ?? ''`);
          if (!activeChatClass.includes("is-coding-agent")) {
            const responseButtons = await cdp.evaluate(`([...document.querySelectorAll('.chat-response-mode-options button')].map((button) => button.textContent?.trim()))`);
            if (!responseButtons.includes("Coding")) throw new Error("A regular Chat thread did not render its response-mode controls.");
            await cdp.evaluate(`([...document.querySelectorAll('.chat-response-mode-options button')].find((button) => button.textContent?.trim() === 'Coding')?.click(), 1)`);
            await sleep(80);
            const codingModeOpened = await cdp.evaluate(`Boolean(document.querySelector('.chat-page.is-coding-agent'))`);
            if (!codingModeOpened) throw new Error("Selecting Coding response mode did not switch the thread into Coding Agent context.");
          }
          await cdp.evaluate(`(() => { const input = document.querySelector('.sidebar-search'); if (!input) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, 'garden'); input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
          const filteredHistory = await cdp.evaluate(`document.querySelector('.sidebar-history-list')?.innerText ?? ''`);
          if (!filteredHistory.includes("Plan a simple herb garden") || filteredHistory.includes("Review the starter project")) throw new Error(`Conversation search did not filter the local history as expected: ${filteredHistory}`);
          await cdp.evaluate(`(() => { const input = document.querySelector('.sidebar-search'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
          await clickInRenderer(cdp, ".overflow-menu-trigger[aria-label='Chat options']");
          await cdp.evaluate(`([...document.querySelectorAll('.overflow-menu-item')].find((item) => item.textContent?.includes('Show task tools'))?.click(), 1)`);
          const toolsVisible = await cdp.evaluate(`document.querySelector('.chat-layout')?.classList.contains('has-chat-tools')`);
          if (!toolsVisible) throw new Error("Chat options did not open its task planning tools.");
          await clickInRenderer(cdp, ".overflow-menu-trigger[aria-label='Chat options']");
          await cdp.evaluate(`([...document.querySelectorAll('.overflow-menu-item')].find((item) => item.textContent?.includes('Hide task tools'))?.click(), 1)`);
          const toolsHidden = await cdp.evaluate(`!document.querySelector('.chat-layout')?.classList.contains('has-chat-tools')`);
          if (!toolsHidden) throw new Error("Chat task planning tools did not close from Chat options.");
          await clickInRenderer(cdp, ".chat-header-actions button[aria-label='Chat options']");
          const importAvailable = await cdp.evaluate(`Boolean([...document.querySelectorAll('.overflow-menu-item')].find((item) => item.textContent?.includes('Import conversations')))`).catch(() => false);
          if (!importAvailable) throw new Error("Chat options did not expose conversation import.");
          await clickInRenderer(cdp, ".overflow-menu-trigger[aria-label='Chat options']");
            const chatTitle = process.env.UI_MATRIX_EXERCISE_DOCUMENTS === "1" ? "Plan and results summary" : "Plan a simple herb garden";
            await cdp.evaluate(`([...document.querySelectorAll('.sidebar-history-row')].find((row) => row.innerText.includes(${JSON.stringify(chatTitle)}))?.querySelector('.sidebar-history-item')?.click(), 1)`);
          if (process.env.UI_MATRIX_CAPTURE === "1" && process.env.UI_MATRIX_EXERCISE_CHAT_ACTIONS === "1") {
            const initialQueue = await cdp.evaluate(`document.querySelector('.queued-messages')?.innerText ?? ''`);
            if (!initialQueue.includes("Add a week-by-week planting schedule.") || !initialQueue.includes("Estimate the monthly watering routine.")) throw new Error(`Chat reference flow did not restore its queued follow-ups: ${initialQueue}`);
            await cdp.evaluate(`document.querySelector("button[aria-label='Edit queued message 1']")?.click(); 1`);
            await sleep(180);
            const editedQueue = await cdp.evaluate(`(async () => { for (let i = 0; i < 40; i++) { const value = document.querySelector('textarea[aria-label="Message your model"]')?.value ?? ''; const queue = document.querySelector('.queued-messages')?.innerText ?? ''; if (value === "Add a week-by-week planting schedule." && !queue.includes("Add a week-by-week planting schedule.")) return { value, remaining: queue }; await new Promise((r) => setTimeout(r, 50)); } return { value: document.querySelector('textarea[aria-label="Message your model"]')?.value ?? '', remaining: document.querySelector('.queued-messages')?.innerText ?? '' }; })()`);
            if (editedQueue.value !== "Add a week-by-week planting schedule." || !editedQueue.remaining.includes("Include a simple materials checklist.") || editedQueue.remaining.includes("Add a week-by-week planting schedule.")) throw new Error(`Editing a queued prompt did not move its text into the composer and remove only that queue item: ${JSON.stringify(editedQueue)}`);
            await cdp.evaluate(`document.querySelector("button[aria-label='Remove queued message 2']")?.click(); 1`);
            await sleep(180);
            const removedQueue = await cdp.evaluate(`document.querySelector('.queued-messages')?.innerText ?? ''`);
            if (!removedQueue.includes("Include a simple materials checklist.") || removedQueue.includes("Estimate the monthly watering routine.")) throw new Error(`Removing a queued follow-up removed the wrong item: ${removedQueue}`);
            const composerReady = await cdp.evaluate(`Boolean(document.querySelector('textarea[aria-label="Message your model"]'))`);
            if (!composerReady) throw new Error("Chat composer was not available after editing its queued prompt.");
            await cdp.evaluate(`(() => { const input = document.querySelector('textarea[aria-label="Message your model"]'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
            const userMessage = await cdp.evaluate(`Boolean(document.querySelector('.chat-message.user'))`);
            if (!userMessage) throw new Error("The seeded user message was missing from the active chat.");
            await clickButtonText(cdp, "Edit", ".chat-message.user");
            const userEditOpened = await cdp.evaluate(`Boolean(document.querySelector('.message-edit-form textarea[aria-label="Edit user message"]'))`);
            if (!userEditOpened) throw new Error("The user message Edit action did not open its inline editor.");
            await cdp.evaluate(`([...document.querySelectorAll('.message-edit-form button')].find((button) => button.innerText.trim() === 'Cancel')?.click(), 1)`);
            const userEditClosed = await cdp.evaluate(`(async () => { for (let i = 0; i < 20; i++) { if (!document.querySelector('.message-edit-form')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
            if (!userEditClosed) throw new Error("Cancel did not close the inline user-message editor.");
            const assistant = await cdp.evaluate(`Boolean(document.querySelector('.chat-message.assistant'))`);
            if (!assistant) throw new Error("The seeded assistant response was missing from the active chat.");
            const assistantPoint = await cdp.evaluate(`(() => { const r = document.querySelector('.chat-message.assistant').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
            await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: assistantPoint.x, y: assistantPoint.y });
            const assistantActions = await cdp.evaluate(`([...document.querySelectorAll('.chat-message.assistant .message-actions button')].map((button) => button.innerText.trim()))`);
            if (!assistantActions.includes("Copy") || !assistantActions.includes("Retry") || !assistantActions.includes("Fork from here")) throw new Error(`Assistant message actions were incomplete: ${assistantActions.join(", ")}`);
            const pageOrigin = await cdp.evaluate("location.origin");
            await cdp.send("Browser.grantPermissions", { origin: pageOrigin, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
            const bridgeCopy = await cdp.evaluate(`(async () => { try { return await window.skaiAgent?.clipboard?.writeText("Revision 4 clipboard smoke"); } catch (error) { return { error: error.message }; } })()`);
            if (bridgeCopy !== true) throw new Error(`Electron clipboard bridge did not confirm a write: ${JSON.stringify(bridgeCopy)} (exposed ${await cdp.evaluate("Boolean(window.skaiAgent?.clipboard?.writeText)")}).`);
            await cdp.evaluate(`([...document.querySelectorAll('.chat-message.assistant .message-actions button')].find((button) => button.innerText.trim() === 'Copy')?.click(), 1)`);
            const copyConfirmed = await cdp.evaluate(`(async () => { for (let i = 0; i < 20; i++) { if (document.querySelector('.chat-message.assistant .message-actions')?.innerText.includes('Copied')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
            if (!copyConfirmed) throw new Error(`Copy did not provide message-level confirmation (origin ${pageOrigin}, clipboard API ${await cdp.evaluate("Boolean(navigator.clipboard?.writeText)")}).`);
            await sleep(1500); // Capture the resting Copy label, after its confirmation has been verified.
          }
          if (process.env.UI_MATRIX_CAPTURE === "1" && process.env.UI_MATRIX_EXERCISE_DOCUMENTS === "1") {
            const groundedState = await cdp.evaluate(`({ thread: document.querySelector('.chat-layout')?.innerText ?? '', attachments: [...document.querySelectorAll('.chat-message.user')].flatMap((message) => [...message.querySelectorAll('.attachment-list')].map((item) => item.innerText)).join(' ') })`);
            if (!groundedState.thread.includes("12,480") || !groundedState.thread.includes("5.6%") || !groundedState.thread.includes("Plan.pdf") || !groundedState.thread.includes("Results.xlsx") || !groundedState.attachments.includes("Plan.pdf") || !groundedState.attachments.includes("Results.xlsx")) throw new Error(`The document-grounded Chat reference state did not restore both attachments, outcomes, and source names: ${JSON.stringify(groundedState)}`);
          }
        }
        const states = route === "settings" ? settingsCategories : [null];
        for (const category of states) {
          if (category) {
            await cdp.evaluate(`([...document.querySelectorAll('.settings-nav button')].find((button) => button.textContent?.trim() === ${JSON.stringify(category)})?.click(), 1)`);
            await sleep(90);
            phase = `${theme}/${collapsed === "true" ? "collapsed" : "expanded"} ${width}x${height} #/settings (${category})`;
          }
          const issues = await cdp.evaluate(PROBE);
          if (process.env.UI_MATRIX_LAYOUT_DEBUG === "1" && width < 640) {
            const layout = await cdp.evaluate(`(() => { const layout = [...document.querySelectorAll('.app-shell,.global-rail,.workspace-sidebar,.thread-sidebar,.app-main,.app-content,.chat-page,.chat-layout,.chat-column,.conversation-surface,.message-list,.message-content,.coding-page-active,.coding-session-grid,.project-thread-panel,.coding-project-browser,.monaco-editor-shell')].filter((el) => getComputedStyle(el).display !== 'none').map((el) => { const r = el.getBoundingClientRect(); return { el: el.className?.toString?.() || el.tagName, box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], client: [el.clientWidth, el.clientHeight], scroll: [el.scrollWidth, el.scrollHeight], overflow: [getComputedStyle(el).overflowX, getComputedStyle(el).overflowY] }; }); const overflows = [...document.querySelectorAll('body *')].filter((el) => { const s=getComputedStyle(el),r=el.getBoundingClientRect(); return s.display!=='none'&&r.width>0&&el.scrollWidth>el.clientWidth+2; }).map((el)=>({el:el.className?.toString?.()||el.tagName,client:el.clientWidth,scroll:el.scrollWidth,box:[Math.round(el.getBoundingClientRect().left),Math.round(el.getBoundingClientRect().width)],overflow:getComputedStyle(el).overflowX})); return { layout, overflows: overflows.slice(0,30) }; })()`);
            console.log(`[layout] ${phase}: ${JSON.stringify(layout)}`);
            if (route === "chat") console.log(`[header] ${JSON.stringify(await cdp.evaluate(`(() => {const h=document.querySelector('.chat-context-bar'),hs=getComputedStyle(h); return {direction:hs.flexDirection,align:hs.alignItems,children:[...h.children].map((el) => { const r=el.getBoundingClientRect(),s=getComputedStyle(el); return {el:el.className?.toString?.()||el.tagName,box:[Math.round(r.left),Math.round(r.width)],display:s.display,minWidth:s.minWidth,flex:s.flex,margin:s.margin,position:s.position,left:s.left,right:s.right,transform:s.transform,alignSelf:s.alignSelf,gridColumn:s.gridColumn}; })}; })()`))}`);
          }
          const captureDesktop = width === 1440 && height === 900 && theme === "dark" && collapsed === "false";
          const captureMobile = width === 390 && height === 844 && process.env.UI_MATRIX_CAPTURE_MOBILE === "1";
          if (process.env.UI_MATRIX_CAPTURE === "1" && (captureDesktop || captureMobile)) {
            fs.mkdirSync(captureDirectory, { recursive: true });
            const name = category ? `settings-${category}` : captureMobile ? `${route}-390` : route;
            const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
            const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
            fs.writeFileSync(path.join(captureDirectory, `${safeName}.png`), Buffer.from(screenshot.data, "base64"));
          }
          if (route === "persona-workshop" && process.env.UI_MATRIX_EXERCISE_PERSONA === "1") {
            await clickInRenderer(cdp, ".persona-library-start button");
            const chatReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 80; i++) { if (document.querySelector('.persona-chat-content')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
            if (!chatReady) throw new Error("Persona workflow could not start a conversation from the selected profile.");
          }
          const problems = [];
          if (issues.blank) problems.push("blank page");
          if (issues.pageOverflowX > 1) problems.push(`page scrolls sideways by ${issues.pageOverflowX}px`);
          for (const [kind, label] of [["offscreen", "off-screen"], ["clipped", "clipped"], ["bleed", "bleeds out of its card"], ["unreachable", "unreachable"]]) for (const item of issues[kind]) problems.push(`${label}: ${item.el} "${item.text}" at ${item.box.join(",")}${item.container ? ` in ${item.container}` : ""}${kind === "unreachable" ? ` clip-chain ${JSON.stringify(item.clips)}` : ""}`);
          for (const [a, b] of issues.overlap) problems.push(`overlap: ${a.el} "${a.text}" ${JSON.stringify(a.box)} in ${JSON.stringify(a.card)} x ${b.el} "${b.text}" ${JSON.stringify(b.box)} in ${JSON.stringify(b.card)}`);
          if (problems.length) findings.push(`${phase}\n    ${problems.join("\n    ")}`);
          if (route === "pet-workshop" && process.env.UI_MATRIX_EXERCISE_PET === "1" && !category) {
            await clickInRenderer(cdp, ".pet-workshop-quick-picks button:nth-child(2)");
            await sleep(120);
            const selected = await cdp.evaluate(`({ name: document.querySelector('.pet-workshop-overview-preview h2')?.textContent?.trim(), current: localStorage.getItem('skai.pet.character') })`);
            if (selected.name !== "Byte" || selected.current !== "byte") throw new Error(`Companion selection did not persist: ${JSON.stringify(selected)}`);
            const initiallyVisible = await cdp.evaluate(`document.querySelector('.pet-workshop-show-toggle input')?.checked === true`);
            await clickInRenderer(cdp, ".pet-workshop-show-toggle input");
            await sleep(100);
            const hiddenState = await cdp.evaluate(`({ checked: document.querySelector('.pet-workshop-show-toggle input')?.checked, saved: localStorage.getItem('skai.pet.visible') })`);
            if (hiddenState.checked !== !initiallyVisible || hiddenState.saved !== String(!initiallyVisible)) throw new Error(`Companion visibility did not toggle off: ${JSON.stringify(hiddenState)}`);
            await clickInRenderer(cdp, ".pet-workshop-show-toggle input");
            await sleep(100);
            const restoredState = await cdp.evaluate(`({ checked: document.querySelector('.pet-workshop-show-toggle input')?.checked, saved: localStorage.getItem('skai.pet.visible') })`);
            if (restoredState.checked !== initiallyVisible || restoredState.saved !== String(initiallyVisible)) throw new Error(`Companion visibility did not restore: ${JSON.stringify(restoredState)}`);
            await clickInRenderer(cdp, ".pet-workshop-action-card");
            await sleep(150);
            if (!(await cdp.evaluate(`document.querySelector('.pet-workshop-full-editor')?.open === true`))) throw new Error("Customize appearance did not open the pet editor.");
            await cdp.evaluate(`document.querySelector('.pet-workshop-return')?.scrollIntoView({ block: 'center' }); 1`);
            await sleep(100);
            await clickInRenderer(cdp, ".pet-workshop-return");
            let returned = await cdp.evaluate(`(async () => { for (let i = 0; i < 30; i++) { if (document.title.endsWith(' · chat')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
            if (!returned) {
              await cdp.evaluate(`document.querySelector('.pet-workshop-return')?.click(); 1`);
              returned = await cdp.evaluate(`(async () => { for (let i = 0; i < 30; i++) { if (document.title.endsWith(' · chat')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
            }
            if (!returned) throw new Error(`Return to work did not navigate back to Chat; state is ${JSON.stringify(await cdp.evaluate(`(() => ({ title: document.title, href: location.href, activeWorkspace: document.querySelector('[aria-label="Workspace navigation"] .is-active')?.textContent?.trim() ?? '' }))()`))}.`);
          }
        }
      }
    }
  }
  await cdp.send("Emulation.clearDeviceMetricsOverride");
  cdp.close();
  if (runtimeErrors.length) findings.push(`runtime errors:\n    ${[...new Set(runtimeErrors)].slice(0, 15).join("\n    ")}`);
  if (findings.length) throw new Error(`UI matrix smoke found ${findings.length} problem group(s):\n  ${findings.slice(0, 25).join("\n  ")}`);
  console.log(`Packaged UI matrix smoke passed: ${testedRoutes.length} routes x ${testedViewports.length} window sizes x ${variants.length} theme/sidebar variants, including ${settingsCategories.length} settings categories; no runtime errors.`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  if (process.platform === "win32" && child.pid) {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    await new Promise((resolve) => { killer.once("close", resolve); killer.once("error", resolve); });
  } else if (!child.killed) child.kill("SIGTERM");
  await sleep(1500);
  try { fs.rmSync(temp, { recursive: true, force: true }); } catch { /* the app may release files shortly after exit */ }
});
