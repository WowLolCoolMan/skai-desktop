// Packaged UI matrix smoke: every route at window sizes from 1920x1080 down to 960x640 (tiling
// splits), light/dark themes, sidebar expanded/collapsed, with deliberately long seeded content.
// Fails on runtime errors, blank pages, page-level horizontal overflow, content off-screen or
// bleeding out of its card, clipped text, controls that cannot be reached, and overlapping
// controls. All data lives in a throwaway profile (XDG/APPDATA redirected, isolated user-data-dir).
//
//   node scripts/smoke-electron-ui-matrix.cjs [packaged executable]
//   (Linux CI: run under xvfb-run; set UI_MATRIX_QUICK=1 for a single theme/sidebar variant)
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
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
const exerciseTaskProgress = process.env.UI_MATRIX_EXERCISE_TASK_PROGRESS === "1";
const exerciseGitReview = process.env.UI_MATRIX_EXERCISE_GIT_REVIEW === "1";
const exerciseChatSchedule = process.env.UI_MATRIX_EXERCISE_CHAT_SCHEDULE === "1";
const exerciseScheduledPage = process.env.UI_MATRIX_EXERCISE_SCHEDULED_PAGE === "1";
const exerciseProjectCreate = process.env.UI_MATRIX_EXERCISE_PROJECT_CREATE === "1";
const exerciseFocusLayout = process.env.UI_MATRIX_EXERCISE_FOCUS_LAYOUT === "1";
const exerciseCodingPanels = process.env.UI_MATRIX_EXERCISE_CODING_PANELS === "1" || exerciseFocusLayout;
const exerciseSideChat = process.env.UI_MATRIX_EXERCISE_SIDE_CHAT === "1";
const exerciseProjectTerminal = process.env.UI_MATRIX_EXERCISE_PROJECT_TERMINAL === "1";
const exerciseMcpReview = process.env.UI_MATRIX_EXERCISE_MCP_REVIEW === "1";
const exerciseOnboarding = process.env.UI_MATRIX_EXERCISE_ONBOARDING === "1";
const exerciseWorkspaceSearch = process.env.UI_MATRIX_EXERCISE_WORKSPACE_SEARCH === "1";
const exerciseCodingCollapsedLayout = process.env.UI_MATRIX_EXERCISE_CODING_LAYOUT === "1";
const exerciseRetention = process.env.UI_MATRIX_EXERCISE_RETENTION === "1";
const exerciseBackup = process.env.UI_MATRIX_EXERCISE_BACKUP === "1";
const exerciseAccessibility = process.env.UI_MATRIX_EXERCISE_ACCESSIBILITY === "1";
const exerciseCapacity = process.env.UI_MATRIX_EXERCISE_CAPACITY === "1";
const exercisePersona = process.env.UI_MATRIX_EXERCISE_PERSONA === "1";
let taskProgressRequests = 0;
let taskProgressServerProblem = "";
let sideChatRequests = 0;
let sideChatServerProblem = "";
let resolveTaskProgressPaused;
let resolveTaskProgressCancelled;
const taskProgressCancelled = new Promise((resolve) => { resolveTaskProgressCancelled = resolve; });
const taskProgressPaused = new Promise((resolve) => { resolveTaskProgressPaused = resolve; });
const taskProgressServer = exerciseTaskProgress ? http.createServer((request, response) => {
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    if (!request.url?.endsWith("/chat/completions")) { taskProgressServerProblem = `Unexpected local model route ${request.url}`; response.writeHead(404).end(); return; }
    taskProgressRequests += 1;
    if (taskProgressRequests > 8) {
      resolveTaskProgressPaused();
      response.once("close", () => resolveTaskProgressCancelled());
      return;
    }
    const files = ["src/layout.ts", "src/plant.ts", "src/styles.css", "src/utils.ts"];
    const fileIndex = Math.floor((taskProgressRequests - 1) / 2);
    let action;
    if (taskProgressRequests % 2 === 1) action = { action: "read_file", path: files[fileIndex] };
    else {
      const parsed = JSON.parse(body);
      const readResult = [...(parsed.messages ?? [])].reverse().find((message) => message.role === "user" && String(message.content).includes(`READ RESULT for ${files[fileIndex]} `));
      const hash = String(readResult?.content ?? "").match(/SHA-256 ([A-Fa-f0-9]{64})/)?.[1];
      if (!hash) { taskProgressServerProblem = `Could not find current SHA-256 for ${files[fileIndex]} in messages: ${JSON.stringify(parsed.messages?.slice(-4))}`; response.writeHead(422).end("Expected read_file result with current SHA-256"); return; }
      const content = files[fileIndex].endsWith(".css")
        ? `:root { --garden-gap: ${12 + fileIndex * 4}px; }\n/* Reviewed local layout update */\n`
        : `export const gardenLayout = { file: ${JSON.stringify(files[fileIndex])}, columns: ${2 + fileIndex}, spacing: ${12 + fileIndex * 4} };\n`;
      action = { action: "write_file", path: files[fileIndex], content, expectedHash: hash };
    }
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(action) } }] })}\n\ndata: [DONE]\n\n`);
  });
}) : null;
let taskProgressEndpoint = "";
let taskProgressTaskId = "";
const taskProgressServerReady = taskProgressServer ? new Promise((resolve, reject) => {
  taskProgressServer.once("error", reject);
  taskProgressServer.listen(0, "127.0.0.1", () => {
    taskProgressEndpoint = `http://127.0.0.1:${taskProgressServer.address().port}/v1`;
    resolve();
  });
}) : Promise.resolve();
const sideChatServer = exerciseSideChat ? http.createServer((request, response) => {
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    if (request.url?.endsWith("/models")) {
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ id: "revision4-sidechat-fixture", object: "model" }] }));
      return;
    }
    if (!request.url?.endsWith("/chat/completions")) { sideChatServerProblem = `Unexpected local model route ${request.url}`; response.writeHead(404).end(); return; }
    sideChatRequests += 1;
    const messages = JSON.parse(body).messages ?? [];
    let action;
    if (sideChatRequests === 1) action = { action: "read_file", path: "README.md" };
    else if (messages.some((message) => message.role === "user" && String(message.content).includes("READ RESULT for README.md "))) {
      action = { action: "done", summary: "Side chat inspected README.md successfully using the isolated local model fixture." };
    } else {
      sideChatServerProblem = "The Side chat model fixture did not receive the README read result before completion.";
      response.writeHead(422).end(sideChatServerProblem);
      return;
    }
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(action) } }] })}\n\ndata: [DONE]\n\n`);
  });
}) : null;
let sideChatEndpoint = "";
const sideChatServerReady = sideChatServer ? new Promise((resolve, reject) => {
  sideChatServer.once("error", reject);
  sideChatServer.listen(0, "127.0.0.1", () => {
    sideChatEndpoint = `http://127.0.0.1:${sideChatServer.address().port}/v1`;
    resolve();
  });
}) : Promise.resolve();
let mcpReviewSession = "";
const mcpReviewServer = exerciseMcpReview ? http.createServer(async (incoming, response) => {
  const chunks = [];
  for await (const chunk of incoming) chunks.push(chunk);
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { response.writeHead(400).end(); return; }
  if (body.method === "initialize") {
    mcpReviewSession = "skai-ui-review-session";
    response.setHeader("Mcp-Session-Id", mcpReviewSession);
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "Skai revision 4 review fixture", version: "1" } } }));
    return;
  }
  if (incoming.headers["mcp-session-id"] !== mcpReviewSession) { response.writeHead(400).end("Missing MCP session"); return; }
  const result = body.method === "tools/list"
    ? { tools: [{ name: "read_garden_plan", description: "Read the fixture garden plan.", inputSchema: { type: "object", properties: { area: { type: "string" } }, required: ["area"] }, annotations: { readOnlyHint: true } }] }
    : body.method === "tools/call" && body.params?.name === "read_garden_plan"
      ? { content: [{ type: "text", text: `Fixture garden plan for ${body.params.arguments?.area ?? "unspecified area"}: inspect soil moisture before watering.` }] }
      : null;
  if (!result) { response.writeHead(404).end(); return; }
  response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
}) : null;
let mcpReviewEndpoint = "";
const mcpReviewServerReady = mcpReviewServer ? new Promise((resolve, reject) => {
  mcpReviewServer.once("error", reject);
  mcpReviewServer.listen(0, "127.0.0.1", () => {
    mcpReviewEndpoint = `http://127.0.0.1:${mcpReviewServer.address().port}/mcp`;
    resolve();
  });
}) : Promise.resolve();
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
const voiceFixtureArgs = process.env.UI_MATRIX_EXERCISE_VOICE === "1" ? ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] : [];
const child = spawn(executable, [`--remote-debugging-port=${port}`, `--user-data-dir=${path.join(temp, "electron")}`, `--skai-isolated-smoke-app-data=${path.join(temp, "appdata")}`, "--disable-gpu", ...voiceFixtureArgs, ...displayBackendArgs], { cwd: path.dirname(executable), env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
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
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (pending.delete(id)) reject(new Error(`Timed out: ${method}${method === "Runtime.evaluate" ? ` for ${String(params.expression ?? "").slice(0, 180)}` : ""}`)); }, 20000); });
  return {
    open: new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); }),
    send,
    on: (listener) => listeners.push(listener),
    evaluate: async (expression) => { const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(`evaluate: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text} in ${expression.slice(0, 260)}`); return result.result?.value; },
    evaluateWith: async (functionDeclaration, ...values) => {
      // Send runtime values as CDP arguments, never as generated JavaScript source.
      if (typeof functionDeclaration !== "function") throw new TypeError("evaluateWith requires a static function declaration.");
      const global = await send("Runtime.evaluate", { expression: "globalThis", returnByValue: false });
      const objectId = global.result?.objectId;
      if (!objectId) throw new Error("Could not access the renderer execution context.");
      try {
        const result = await send("Runtime.callFunctionOn", {
          objectId,
          functionDeclaration: functionDeclaration.toString(),
          arguments: values.map((value) => ({ value })),
          returnByValue: true,
          awaitPromise: true,
        });
        if (result.exceptionDetails) throw new Error(`evaluateWith: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
        return result.result?.value;
      } finally {
        try { await send("Runtime.releaseObject", { objectId }); } catch { /* Releasing a test-only remote handle is best effort. */ }
      }
    },
    close: () => socket.close(),
  };
}

async function clickInRenderer(cdp, selector) {
  const point = await cdp.evaluateWith(function (selector) { const element = document.querySelector(selector); if (!element) return null; element.scrollIntoView({ block: 'center', inline: 'nearest' }); const rect = element.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; }, selector);
  if (!point) throw new Error(`UI interaction target was not found: ${selector}`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
}

async function clickButtonText(cdp, text, scope = "body") {
  const point = await cdp.evaluateWith(function (text, scope) { const root = document.querySelector(scope); const element = [...(root?.querySelectorAll('button') ?? [])].find((button) => button.innerText.trim() === text); if (!element || element.disabled) return null; element.scrollIntoView({ block: 'center', inline: 'nearest' }); const rect = element.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; }, text, scope);
  if (!point) throw new Error(`UI button was not found or is disabled: ${text}`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
}

async function pressEnterOnButtonText(cdp, text, scope = "body", containingText = "") {
  const focused = await cdp.evaluateWith(function (text, scope, containingText) { const root = document.querySelector(scope); const container = containingText ? [...(root?.querySelectorAll('.coding-task-item') ?? [])].find((item) => item.innerText.includes(containingText)) : root; const button = [...(container?.querySelectorAll('button') ?? [])].find((item) => item.innerText.trim() === text && !item.disabled); if (!button) return false; button.scrollIntoView({ block: 'center', inline: 'nearest' }); button.focus(); return document.activeElement === button; }, text, scope, containingText);
  if (!focused) throw new Error(`UI button could not receive keyboard focus: ${text}`);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
}

async function clickButtonContainingText(cdp, text, scope = "body") {
  const point = await cdp.evaluateWith(function (text, scope) { const root = document.querySelector(scope); const element = [...(root?.querySelectorAll('button') ?? [])].find((button) => button.innerText.includes(text)); if (!element || element.disabled) return null; element.scrollIntoView({ block: 'center', inline: 'nearest' }); const rect = element.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; }, text, scope);
  if (!point) throw new Error(`UI button containing text was not found or is disabled: ${text}`);
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
            if (isBox(a) && !a.matches('.global-rail-more')) { const ar = a.getBoundingClientRect(); if (!positioned(el, a) && (r.right > ar.right + 2 || r.left < ar.left - 2)) issues.bleed.push({ ...describe(el), container: describe(a).el, by: Math.round(Math.max(r.right - ar.right, ar.left - r.left)) }); break; }
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
  const visibleControls = controls.map((el) => ({ el, rect: visibleRect(el) }))
    .filter(({ rect }) => rect.width > 0 && rect.height > 0)
    .sort((a, b) => a.rect.left - b.rect.left);
  for (let i = 0; i < visibleControls.length; i++) for (let j = i + 1; j < visibleControls.length; j++) {
    const { el: a, rect: ra } = visibleControls[i], { el: b, rect: rb } = visibleControls[j];
    if (rb.left >= ra.right) break;
    if (rb.top >= ra.bottom || rb.bottom <= ra.top || a.contains(b) || b.contains(a)) continue;
    const overlayA = overlayRoot(a), overlayB = overlayRoot(b);
    if (overlayA !== overlayB && (overlayA || overlayB)) continue;
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
let uiEvidenceContext = null;
const originalWriteFileSync = fs.writeFileSync.bind(fs);
fs.writeFileSync = (target, data, options) => {
  originalWriteFileSync(target, data, options);
  if (!uiEvidenceContext || typeof target !== "string" || !target.toLowerCase().endsWith(".png")) return;
  const repoRoot = path.join(__dirname, "..");
  const revision = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repoRoot, encoding: "utf8", windowsHide: true }).stdout?.trim();
  const worktreeDirty = spawnSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8", windowsHide: true }).stdout?.trim().length > 0;
  const evidence = {
    schema: "skai-ui-evidence/v1",
    file: path.basename(target),
    platform: process.platform,
    osRelease: os.release(),
    architecture: process.arch,
    viewport: uiEvidenceContext.viewport,
    theme: uiEvidenceContext.theme,
    sidebar: uiEvidenceContext.sidebar,
    runtime: "packaged-electron",
    route: uiEvidenceContext.route,
    appRevision: `${revision || process.env.GITHUB_SHA || "unknown"}${worktreeDirty ? "-dirty" : ""}`,
    capturedAt: new Date().toISOString(),
  };
  originalWriteFileSync(`${target}.evidence.json`, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
};
// The five native desktop sizes plus the requested 390 px renderer emulation.
const viewports = [[1920, 1080], [1440, 900], [1280, 720], [1100, 800], [960, 640]];
const testedRoutes = process.env.UI_MATRIX_ROUTE ? routes.filter((route) => process.env.UI_MATRIX_ROUTE.split(",").includes(route)) : routes;
const requestedViewport = /^(\d+)x(\d+)$/.exec(process.env.UI_MATRIX_VIEWPORT || "");
const testedViewports = requestedViewport ? [[Number(requestedViewport[1]), Number(requestedViewport[2])]] : viewports;
const variantParts = process.env.UI_MATRIX_VARIANT?.split(",");
const requestedVariant = variantParts?.length === 2 && ["dark", "light"].includes(variantParts[0]) && ["true", "false"].includes(variantParts[1]) ? variantParts : null;
const variants = requestedVariant ? [[requestedVariant[0], requestedVariant[1]]] : process.env.UI_MATRIX_QUICK === "1" ? [["dark", "false"]] : [["dark", "false"], ["light", "false"], ["dark", "true"], ["light", "true"]];

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
  if (exerciseOnboarding) {
    const firstRunRoute = await cdp.evaluate(`document.title.endsWith(' · onboarding')`);
    if (!firstRunRoute) throw new Error(`A clean profile did not open the first-run checklist; initial page was ${await cdp.evaluate("document.title")}.`);
  }

  // Long, awkward content: long titles, unbroken tokens, wide code, tables, many chats, long project names.
  phase = "seed";
  const captureMode = process.env.UI_MATRIX_CAPTURE === "1" || process.env.UI_MATRIX_EXERCISE_CHAT_COLLABORATION === "1" || exercisePersona;
  const exerciseChatActions = process.env.UI_MATRIX_EXERCISE_CHAT_ACTIONS === "1";
  const exerciseChatBase = process.env.UI_MATRIX_EXERCISE_CHAT_BASE === "1";
  const exerciseDocuments = process.env.UI_MATRIX_EXERCISE_DOCUMENTS === "1";
  const exerciseChatSearch = process.env.UI_MATRIX_EXERCISE_CHAT_SEARCH === "1";
  const exerciseTaskPlan = process.env.UI_MATRIX_EXERCISE_TASK_PLAN === "1";
  const includeCodingFixture = process.env.UI_MATRIX_EXERCISE_CHAT !== "1";
  const longWord = captureMode ? "" : "Supercalifragilisticexpialidocious_".repeat(5);
  const longTitle = captureMode ? "Plan a simple herb garden" : "Investigate why the tiled window squeezes the composer when the conversation title is extremely long and keeps going";
  const seedProject = fs.mkdtempSync(path.join(temp, captureMode ? "starter-project-" : "project-with-an-exceptionally-long-folder-name-for-layout-testing-"));
  fs.writeFileSync(path.join(seedProject, "README.md"), "# Starter project\n\nUse the Coding Agent thread to review the project, then inspect README.md in the docked editor.\n");
  fs.mkdirSync(path.join(seedProject, "src"), { recursive: true });
  fs.writeFileSync(path.join(seedProject, "src", "index.ts"), "export function greet(name: string) {\n  return `Hello, ${name}`;\n}\n");
  if (exerciseProjectTerminal) fs.writeFileSync(path.join(seedProject, "package.json"), JSON.stringify({ name: "terminal-preflight-smoke", private: true, scripts: { build: "node -e \"require('node:fs').writeFileSync('preflight-marker.tmp', 'unexpected')\"" } }, null, 2));
  if (exerciseTaskProgress) {
    fs.writeFileSync(path.join(seedProject, "src", "layout.ts"), "export const gardenLayout = { columns: 2, spacing: 12 };\n");
    fs.writeFileSync(path.join(seedProject, "src", "plant.ts"), "export const plants = ['basil', 'thyme'];\n");
    fs.writeFileSync(path.join(seedProject, "src", "styles.css"), ":root { --garden-gap: 12px; }\n");
    fs.writeFileSync(path.join(seedProject, "src", "utils.ts"), "export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));\n");
  }
  if (exerciseTaskProgress || exerciseGitReview) {
    if (exerciseGitReview) fs.writeFileSync(path.join(seedProject, "README.md"), ["# Starter project", "", ...Array.from({ length: 36 }, (_, index) => `Setup note ${index + 1}.`)].join("\n") + "\n");
    const runGit = (args) => {
      const result = spawnSync("git", args, { cwd: seedProject, encoding: "utf8", windowsHide: true });
      if (result.status !== 0) throw new Error(`Could not prepare the isolated Coding Git fixture (${args.join(" ")}): ${result.stderr || result.error?.message || result.status}`);
    };
    runGit(["init"]);
    runGit(["config", "user.name", "Revision 4 UI Smoke"]);
    runGit(["config", "user.email", "revision4-ui-smoke@localhost"]);
    runGit(["add", "."]);
    runGit(["commit", "-m", "Initial Revision 4 project fixture"]);
    if (exerciseGitReview) {
      const reviewReadme = fs.readFileSync(path.join(seedProject, "README.md"), "utf8").split(/\r?\n/);
      reviewReadme[0] = "# Reviewed starter project";
      reviewReadme[30] = "Local review note: clarify setup steps.";
      fs.writeFileSync(path.join(seedProject, "README.md"), reviewReadme.join("\n"));
      fs.appendFileSync(path.join(seedProject, "src", "index.ts"), "\nexport const gardenSpacing = 12;\n");
      fs.writeFileSync(path.join(seedProject, "src", "plan.ts"), "export const gardenPlan = { columns: 2, spacing: 12 };\n");
    }
  }
  const seeded = await cdp.evaluateWith(async function(captureMode, longTitle, longWord, seedProject, includeCodingFixture, exerciseChatSchedule, exerciseDocuments, exerciseChatSearch, exerciseChatActions, exerciseChatBase, exerciseWorkspaceSearch) {
    const r = (m, p) => window.skaiAgent.request(m, p);
    const results = [];
    results.push(await r("conversation.save", { title: longTitle, messages: [{ role: "user", content: captureMode ? "Help me plan a low-maintenance herb garden for a sunny patio." : `Unbroken token: ${longWord}` }, { role: "assistant", content: captureMode ? "Start with basil, thyme, and parsley in containers with good drainage. Check the soil before watering and group pots by sunlight needs." : "Code:\n\n```bash\necho " + "x".repeat(260) + "\n```\n\n| one | two | three | four | five |\n|---|---|---|---|---|\n| " + "data ".repeat(12) + "| b | c | d | e |\n\nURL https://example.invalid/" + "path/".repeat(40) }] }));
    if (!captureMode) {
      results.push(await r("conversation.save", { title: longWord, messages: [{ role: "user", content: "short" }] }));
      for (let i = 0; i < 25; i++) await r("conversation.save", { title: "Filler conversation number " + i, messages: [{ role: "user", content: "filler " + i }] });
    }
    results.push(await r("tasks.plan", { title: captureMode ? "Review garden layout options" : longTitle, instruction: captureMode ? "Compare container sizes and sunlight needs before suggesting a layout." : `Instruction ${longWord}`, environment: "local" }));
    results.push(await r("scheduled.create", { prompt: captureMode ? "Review the herb garden plan" : `${longTitle} ${longWord}`, dueAt: new Date(Date.now() + 3600000).toISOString(), repeatEveryMinutes: 60, dryRunCompleted: true, triggerType: "schedule", overlapPolicy: "skip" }));
    const project = await r("project.save", { name: captureMode ? "Skai Starter Project" : "Revision 4 coding fixture", folderPaths: [seedProject] });
    results.push(project);
    if (project.ok && includeCodingFixture) results.push(await r("conversation.save", { title: "Review the starter project", mode: "Coding Agent", responseMode: "coding", projectId: project.result?.id, messages: [{ role: "user", content: "Review this project structure and suggest the next small improvement." }, { role: "assistant", content: "I’ll inspect the existing files, then outline a focused change and how to verify it." }] }));
    if (captureMode && results[0]?.result?.id) results.push(await r("conversation.save", { id: results[0].result.id, title: longTitle, mode: "ChatBot", responseMode: "think", messages: [{ role: "user", content: "Help me plan a low-maintenance herb garden for a sunny patio." }, { role: "assistant", content: "Start with basil, thyme, and parsley in containers with good drainage. Check the soil before watering and group pots by sunlight needs." }] }));
    if (captureMode && exerciseChatSchedule && results[0]?.result?.id) results.push(await r("scheduled.create", { prompt: "Give me a weekly summary of key updates, progress, and next steps.", conversationId: results[0].result.id, dueAt: new Date(Date.now() + 86400000).toISOString(), repeatEveryMinutes: 10080, workspaceMode: "ChatBot", dryRunCompleted: true, triggerType: "schedule", overlapPolicy: "skip" }));
    if (captureMode && exerciseDocuments) results.push(await r("conversation.save", { title: "Plan and results summary", mode: "ChatBot", responseMode: "think", messages: [{ role: "user", content: "Based only on the attached plan and results, what were the objectives and did we meet them?", attachments: [{ fileName: "Plan.pdf", content: "Objectives: deliver the MVP by the end of Q2; reach at least 10,000 active users; achieve a conversion rate of at least 5%." }, { fileName: "Results.xlsx", content: "MVP delivered in Q2. Active users: 12,480. Conversion rate: 5.6%." }] }, { role: "assistant", content: "According to Plan.pdf, the objectives were to deliver the MVP by Q2, reach at least 10,000 active users, and reach a conversion rate of at least 5%. Results.xlsx reports delivery in Q2, 12,480 active users, and a 5.6% conversion rate, so all three objectives were met. Sources: Plan.pdf (objectives); Results.xlsx (outcomes)." }] }));
    if (captureMode && exerciseChatSearch) for (const item of [
      { title: "Garden planning", query: "What should I plant in my garden this spring?", answer: "Here is a simple garden plan with plant suggestions and timing." },
      { title: "Vegetable garden tips", query: "How can I improve my vegetable garden?", answer: "Focus on good soil, sunlight, and consistent watering." },
      { title: "Backyard garden ideas", query: "Share a few backyard garden ideas.", answer: "Try raised beds and low-maintenance plants for your backyard." },
    ]) results.push(await r("conversation.save", { title: item.title, messages: [{ role: "user", content: item.query }, { role: "assistant", content: item.answer }] }));
    if (captureMode && exerciseChatBase) for (const item of [
      { title: "Layout ideas", query: "How should I arrange the containers?", answer: "Group containers by sunlight needs and leave room to reach each plant." },
      { title: "Plant list", query: "Which herbs work well in pots?", answer: "Basil, thyme, parsley, and chives all grow well in containers." },
      { title: "Budget", query: "What supplies should I budget for?", answer: "Start with containers, potting mix, seeds or seedlings, and a watering can." },
    ]) results.push(await r("conversation.save", { title: item.title, messages: [{ role: "user", content: item.query }, { role: "assistant", content: item.answer }] }));
    if (exerciseWorkspaceSearch) results.push(await r("conversation.save", { title: "Workspace search fixture", messages: [{ role: "user", content: "Find the sunny patio herb garden plan and its local care notes." }, { role: "assistant", content: "Basil and thyme grow well in containers on a sunny patio." }] }));
    if (exerciseWorkspaceSearch) results.push(await r("corpus.upsert", { title: "Orchid care report", source: "Search smoke fixture", content: "The orchid report recommends bright indirect light and a light watering schedule.", scope: "workspace", tags: ["search-smoke"] }));
    if (captureMode && exerciseChatActions) for (const text of ["Add a week-by-week planting schedule.", "Include a simple materials checklist.", "Estimate the monthly watering routine."]) results.push(await r("chat.queue.enqueue", { text }));
    if (captureMode) for (const card of [
      { name: "Default", roles: "General-purpose assistant", instructions: "Be clear, practical, and adaptable to the user's task." },
      { name: "Release Engineer", roles: "Helps with releases, readiness, and ops", instructions: "Be concise, practical, and safety-minded. Focus on release planning, readiness checks, risk, and operations." },
      { name: "Code Reviewer", roles: "Reviews code and suggests improvements", instructions: "Prioritize correctness, security, and maintainability. Explain findings with file and line references." },
      { name: "Tech Writer", roles: "Drafts and edits clear technical docs", instructions: "Use plain language, organize information clearly, and preserve technical accuracy." },
    ]) results.push(await r("persona.save", { persona: { ...card, sourceMode: "own-material", subjectType: "character", voice: "Friendly and clear", personality: "Patient, focused, and direct", thinkingStyle: "Work step by step and explain important choices", interactionStyle: "Ask for missing context only when it affects the result", values: "Clarity, accuracy, and useful next steps", knowledge: "Use the supplied material and task context", evidenceBoundaries: "State uncertainty and do not invent unsupported facts", sourceMaterial: card.instructions } }));
    return results;
  }, captureMode, longTitle, longWord, seedProject, includeCodingFixture, exerciseChatSchedule, exerciseDocuments, exerciseChatSearch, exerciseChatActions, exerciseChatBase, exerciseWorkspaceSearch);
  if (!Array.isArray(seeded) || seeded.some((result) => result?.ok !== true)) throw new Error(`Seeding the throwaway profile failed: ${JSON.stringify(seeded)}`);

  const findings = [];
  for (const [theme, collapsed] of variants) {
    phase = `${theme}/${collapsed === "true" ? "collapsed" : "expanded"}`;
    await cdp.evaluate(`localStorage.setItem('skai.themeMode', '${theme}'); localStorage.setItem('skai.sidebar.collapsed', '${collapsed}'); location.reload(); 1`).catch(() => {});
    await sleep(500);
    await cdp.evaluate("(async () => { for (let i = 0; i < 150 && !document.querySelector('[aria-label=\"Primary navigation\"]'); i++) await new Promise((r) => setTimeout(r, 100)); return 1; })()");
    for (const [width, height] of testedViewports) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 960 });
      if (exerciseMcpReview) await mcpReviewServerReady;
      for (const route of testedRoutes) {
        uiEvidenceContext = {
          viewport: { width, height },
          theme,
          sidebar: collapsed === "true" ? "collapsed" : "expanded",
          route,
        };
        phase = `${theme}/${collapsed === "true" ? "collapsed" : "expanded"} ${width}x${height} #/${route}`;
        const renderedRoute = route === "personas" || route === "persona-groups" ? "persona-workshop" : route === "plugins" ? "marketplace" : route === "workbench" ? "chat" : route;
        await cdp.evaluate(`window.history.pushState({ ...(window.history.state ?? {}), skaiNavigation: { route: '${renderedRoute}', index: 0, length: 1 } }, '', '#/${route}'); window.dispatchEvent(new PopStateEvent('popstate')); 1`);
        const routeReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 40; i++) { if (document.title.endsWith(' · ${renderedRoute}')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
        if (!routeReady) throw new Error(`UI matrix did not render #/${route}; expected document title suffix "· ${renderedRoute}" and saw "${await cdp.evaluate("document.title")}".`);
        if (route === "onboarding" && exerciseOnboarding && width === 1440 && height === 900) {
          const beforeCounts = await cdp.evaluateWith(async function () {
            const request = (method, params = {}) => window.skaiAgent.request(method, params);
            const [projects, tasks, conversations] = await Promise.all([request("projects.list"), request("tasks.list"), request("conversations.list", { includeArchived: false })]);
            const length = (result) => Array.isArray(result) ? result.length : Array.isArray(result?.projects) ? result.projects.length : Array.isArray(result?.conversations) ? result.conversations.length : 0;
            return [length(projects.result), length(tasks.result), length(conversations.result)];
          });
          const originalProgress = await cdp.evaluate(`document.querySelector('.onboarding-progress')?.getAttribute('aria-valuenow')`);
          await clickButtonText(cdp, "Open demo workspace", ".onboarding-demo-card");
          const taskDemo = await cdp.evaluate(`document.querySelector('[role="tabpanel"] h3')?.innerText === 'Polish the README' && document.querySelector('.onboarding-demo-profile-note')?.innerText.includes('Ephemeral preview profile')`);
          if (!taskDemo) throw new Error("The isolated task demo did not open with its ephemeral-profile disclosure.");
          await clickButtonText(cdp, "Git review", ".onboarding-demo-tabs");
          const gitDemo = await cdp.evaluate(`document.querySelector('[role="tabpanel"] h3')?.innerText === 'Review proposed changes' && document.querySelectorAll('.onboarding-demo-files li').length === 3`);
          if (!gitDemo) throw new Error("The isolated Git demo did not show its sample review changes.");
          await clickButtonText(cdp, "Visuals", ".onboarding-demo-tabs");
          const mediaDemo = await cdp.evaluate(`document.querySelector('[role="tabpanel"] h3')?.innerText === 'Misty forest at sunrise' && document.querySelector('.onboarding-demo-media small')?.innerText.includes('no generation request')`);
          if (!mediaDemo) throw new Error("The isolated media demo did not disclose that it is a non-generating placeholder.");
          await clickButtonText(cdp, "Task", ".onboarding-demo-tabs");
          const privacy = await cdp.evaluateWith(function () { const button = [...document.querySelectorAll('.onboarding-checklist button')].find((item) => item.innerText.trim() === 'Mark reviewed'); if (!button) return false; button.click(); return true; });
          if (!privacy) throw new Error("The onboarding privacy review action was not available.");
          await clickButtonText(cdp, "Dismiss", ".onboarding-navigation-guide");
          const guideDismissed = await cdp.evaluate(`!document.querySelector('.onboarding-navigation-guide') && localStorage.getItem('skai.onboarding.navigation-guide-dismissed.v1') === 'true'`);
          if (!guideDismissed) throw new Error("The navigation guide did not dismiss and persist its local preference.");
          await clickButtonText(cdp, "Reset checklist", ".onboarding-checklist-card");
          const resetProgress = await cdp.evaluate(`document.querySelector('.onboarding-progress')?.getAttribute('aria-valuenow')`);
          const guideRestored = await cdp.evaluate(`Boolean(document.querySelector('.onboarding-navigation-guide'))`);
          if (String(resetProgress) !== String(originalProgress) || !guideRestored) throw new Error(`Resetting onboarding did not restore checklist-only state (${originalProgress} -> ${resetProgress}; guide ${guideRestored}).`);
          const afterCounts = await cdp.evaluateWith(async function () {
            const request = (method, params = {}) => window.skaiAgent.request(method, params);
            const [projects, tasks, conversations] = await Promise.all([request("projects.list"), request("tasks.list"), request("conversations.list", { includeArchived: false })]);
            const length = (result) => Array.isArray(result) ? result.length : Array.isArray(result?.projects) ? result.projects.length : Array.isArray(result?.conversations) ? result.conversations.length : 0;
            return [length(projects.result), length(tasks.result), length(conversations.result)];
          });
          if (JSON.stringify(beforeCounts) !== JSON.stringify(afterCounts)) throw new Error(`Preview/reset changed workspace data: ${JSON.stringify(beforeCounts)} -> ${JSON.stringify(afterCounts)}.`);
          await clickButtonText(cdp, "Skip for now", ".onboarding-page");
          const skippedToChat = await cdp.evaluate(`document.title.endsWith(' · chat') && localStorage.getItem('skai.onboarding.completed.v1') === 'true'`);
          if (!skippedToChat) throw new Error("Skipping onboarding did not return to Chat and persist the optional skip.");
          await clickInRenderer(cdp, '[aria-label="Extras"]');
          await clickButtonContainingText(cdp, "Getting started", ".global-rail-extras-panel");
          const reopened = await cdp.evaluate(`document.title.endsWith(' · onboarding')`);
          if (!reopened) throw new Error("Getting Started could not be reopened from Extras after skipping.");
          console.log(`[onboarding-workflow] ${JSON.stringify({ isolatedTaskGitMediaPreview: true, resetPreservedWorkspace: true, skipAndReopen: reopened, checklistProgress: resetProgress })}`);
        }
        if (route === "chat" && process.env.UI_MATRIX_CAPTURE === "1" && width === 390 && height === 844) {
          fs.mkdirSync(path.join(__dirname, "..", "docs", "design-review", "workflow-collection", "revision-4"), { recursive: true });
          const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
          fs.writeFileSync(path.join(__dirname, "..", "docs", "design-review", "workflow-collection", "revision-4", "evidence-chat-shell-390.png"), Buffer.from(screenshot.data, "base64"));
        }
        if (route === "search" && exerciseWorkspaceSearch && width === 1440 && height === 900 && theme === "dark" && collapsed === "false") {
          const searchInput = await cdp.evaluate(`(() => { const input = document.querySelector('.workspace-search-input input'); if (!input) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'sunny patio'); input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
          if (!searchInput) throw new Error("Workspace search did not render its main input.");
          const chatFound = await cdp.evaluate(`(async () => { for (let i = 0; i < 60; i++) { if ([...document.querySelectorAll('.workspace-search-result')].some((item) => item.innerText.includes('Workspace search fixture'))) return true; await new Promise((r) => setTimeout(r, 100)); } return false; })()`);
          if (!chatFound) throw new Error(`Global workspace search did not find the seeded conversation content: ${JSON.stringify(await cdp.evaluate(`({ heading: document.querySelector('.workspace-search-results-heading')?.innerText, rows: [...document.querySelectorAll('.workspace-search-result')].map((item) => item.innerText), input: document.querySelector('.workspace-search-input input')?.value, error: document.querySelector('.workspace-search-error')?.innerText })`))}`);
          await clickButtonText(cdp, "Save search", ".workspace-search-toolbar");
          const saved = await cdp.evaluate(`Boolean([...document.querySelectorAll('.workspace-saved-searches button')].find((item) => item.textContent?.trim() === 'sunny patio'))`);
          if (!saved) throw new Error("The workspace search query could not be saved as a local shortcut.");
          const typeFilter = await cdp.evaluate(`(() => { const select = document.querySelector('.workspace-search-filters label:first-child select'); if (!select) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'chat'); select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
          if (!typeFilter) throw new Error("The workspace search content-type filter was unavailable.");
          const onlyChat = await cdp.evaluate(`(async () => { await new Promise((r) => setTimeout(r, 100)); const items = [...document.querySelectorAll('.workspace-search-result')]; return items.length > 0 && items.every((item) => item.querySelector('.workspace-search-result-type')?.textContent?.trim() === 'Chat'); })()`);
          if (!onlyChat) throw new Error("The workspace content-type filter did not constrain the result list to chats.");
          if (process.env.UI_MATRIX_CAPTURE === "1") {
            const capture = await cdp.send("Page.captureScreenshot", { format: "png" });
            fs.writeFileSync(path.join(captureDirectory, "workspace-search-1440.png"), Buffer.from(capture.data, "base64"));
          }
          await cdp.evaluate(`document.querySelector('.workspace-search-result')?.click()`);
          const openedChat = await cdp.evaluate(`(async () => { for (let i = 0; i < 50; i++) { if (document.title.endsWith(' · chat')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
          if (!openedChat) throw new Error("Opening a global search result did not open its saved conversation.");
          await clickInRenderer(cdp, '[aria-label="Extras"]');
          const returnedToSearch = await cdp.evaluate(`(() => { const item = [...document.querySelectorAll('.global-rail-extras-panel .global-rail-extra')].find((button) => button.innerText.includes('Search & Activity')); item?.click(); return Boolean(item); })()`);
          if (!returnedToSearch) throw new Error("Search & Activity could not be reopened from Extras.");
          const restored = await cdp.evaluate(`(async () => { for (let i = 0; i < 50; i++) { const input = document.querySelector('.workspace-search-input input'); if (document.title.endsWith(' · search') && input?.value === 'sunny patio') return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
          if (!restored) throw new Error("Returning to workspace search did not restore the query.");
          const restoredFilter = await cdp.evaluate(`document.querySelector('.workspace-search-filters label:first-child select')?.value === 'chat'`);
          if (!restoredFilter) throw new Error("Returning to workspace search did not restore its filters.");
          const fileQueryEntered = await cdp.evaluate(`(() => { const type = document.querySelector('.workspace-search-filters label:first-child select'); const input = document.querySelector('.workspace-search-input input'); if (!type || !input) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(type, 'all'); type.dispatchEvent(new Event('change', { bubbles: true })); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'README.md'); input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
          if (!fileQueryEntered) throw new Error("The global filename search fixture could not be entered.");
          const fileFound = await cdp.evaluate(`(async () => { for (let i = 0; i < 60; i++) { if ([...document.querySelectorAll('.workspace-search-result')].some((item) => item.querySelector('.workspace-search-result-type')?.textContent?.trim() === 'File' && item.innerText.includes('README.md'))) return true; await new Promise((r) => setTimeout(r, 100)); } return false; })()`);
          if (!fileFound) throw new Error("Global search did not find a project file by its relative path.");
          await cdp.evaluate(`([...document.querySelectorAll('.workspace-search-result')].find((item) => item.querySelector('.workspace-search-result-type')?.textContent?.trim() === 'File' && item.innerText.includes('README.md'))?.click(), true)`);
          const fileOpened = await cdp.evaluate(`(async () => { for (let i = 0; i < 60; i++) { if (document.title.endsWith(' · coding') && document.querySelector('.coding-project-browser.is-editor-panel .file-editor-heading')?.innerText.includes('README.md')) return true; await new Promise((r) => setTimeout(r, 100)); } return false; })()`);
          if (!fileOpened) throw new Error("Opening a file search result did not select the owning project and open its editor.");
          await clickInRenderer(cdp, '[aria-label="Extras"]');
          const fileSearchReopened = await cdp.evaluate(`(() => { const item = [...document.querySelectorAll('.global-rail-extras-panel .global-rail-extra')].find((button) => button.innerText.includes('Search & Activity')); item?.click(); return Boolean(item); })()`);
          const fileQueryRestored = fileSearchReopened && await cdp.evaluate(`(async () => { for (let i = 0; i < 40; i++) { if (document.querySelector('.workspace-search-input input')?.value === 'README.md' && document.querySelector('.workspace-search-filters label:first-child select')?.value === 'all') return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
          if (!fileQueryRestored) throw new Error("Returning from the project file editor did not preserve the file query and type filter.");
          const corpusQueryEntered = await cdp.evaluate(`(() => { const input = document.querySelector('.workspace-search-input input'); if (!input) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'orchid report'); input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
          const referenceFound = corpusQueryEntered && await cdp.evaluate(`(async () => { for (let i = 0; i < 60; i++) { if ([...document.querySelectorAll('.workspace-search-result')].some((item) => item.querySelector('.workspace-search-result-type')?.textContent?.trim() === 'Reference' && item.innerText.includes('Orchid care report'))) return true; await new Promise((r) => setTimeout(r, 100)); } return false; })()`);
          if (!referenceFound) throw new Error("Global search did not find a saved local corpus document.");
          await cdp.evaluate(`([...document.querySelectorAll('.workspace-search-result')].find((item) => item.querySelector('.workspace-search-result-type')?.textContent?.trim() === 'Reference' && item.innerText.includes('Orchid care report'))?.click(), true)`);
          const referenceOpened = await cdp.evaluate(`(async () => { for (let i = 0; i < 40; i++) { if (document.title.endsWith(' · memory') && document.querySelector('.memory-view-tabs button[aria-current="page"]')?.innerText.includes('Document corpus') && document.querySelector('input[aria-label="Search document corpus"]')?.value === 'orchid report') return true; await new Promise((r) => setTimeout(r, 100)); } return false; })()`);
          if (!referenceOpened) throw new Error("Opening a corpus search result did not select and search the Document corpus view.");
          const referenceVisible = await cdp.evaluate(`(async () => { for (let i = 0; i < 40; i++) { if ([...document.querySelectorAll('.corpus-list .memory-entry')].some((item) => item.innerText.includes('Orchid care report'))) return true; await new Promise((r) => setTimeout(r, 100)); } return false; })()`);
          if (!referenceVisible) throw new Error("The selected corpus search result was not visible in its destination view.");
          await clickInRenderer(cdp, '[aria-label="Extras"]');
          const referenceSearchReopened = await cdp.evaluate(`(() => { const item = [...document.querySelectorAll('.global-rail-extras-panel .global-rail-extra')].find((button) => button.innerText.includes('Search & Activity')); item?.click(); return Boolean(item); })()`);
          const referenceQueryRestored = referenceSearchReopened && await cdp.evaluate(`(async () => { for (let i = 0; i < 40; i++) { if (document.querySelector('.workspace-search-input input')?.value === 'orchid report') return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
          if (!referenceQueryRestored) throw new Error("Returning from a corpus result did not preserve the workspace query.");
          await clickButtonText(cdp, "Activity", ".workspace-search-view-toggle");
          const boardReady = await cdp.evaluate(`Boolean(document.querySelector('.workspace-activity-board') && document.querySelector('.workspace-activity-controls select'))`);
          if (!boardReady) throw new Error("The activity board did not show its live lanes and activity filters.");
          const grouping = await cdp.evaluate(`(() => [...document.querySelectorAll('.workspace-activity-controls label select')].some((select) => [...select.options].some((option) => option.value === 'environment')))()`);
          if (!grouping) throw new Error("The activity board did not expose project, agent, and environment grouping options.");
          const groupedByProject = await cdp.evaluate(`(() => { const select = [...document.querySelectorAll('.workspace-activity-controls label select')].find((item) => [...item.options].some((option) => option.value === 'environment')); if (!select) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'project'); select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
          const groupHeadingReady = groupedByProject && await cdp.evaluate(`(async () => { for (let i = 0; i < 20; i++) { if ([...document.querySelectorAll('.workspace-activity-group h3')].some((item) => item.textContent?.trim() === 'Workspace')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
          if (!groupHeadingReady) throw new Error("Grouping the live activity board by project did not create project sections.");
          const decisionsFilter = await cdp.evaluate(`(() => { const select = [...document.querySelectorAll('.workspace-activity-controls label select')].find((item) => [...item.options].some((option) => option.value === 'decisions')); if (!select) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'decisions'); select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
          const decisionVisible = decisionsFilter && await cdp.evaluate(`(async () => { for (let i = 0; i < 20; i++) { if ([...document.querySelectorAll('.workspace-activity-task .usage-task-status')].some((item) => item.textContent?.trim() === 'Proposed')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
          if (!decisionVisible) throw new Error("Filtering live activity to user decisions hid the proposed task requiring a decision.");
          await cdp.evaluate(`(() => { const selects = [...document.querySelectorAll('.workspace-activity-controls label select')]; const group = selects.find((item) => [...item.options].some((option) => option.value === 'environment')); const filter = selects.find((item) => [...item.options].some((option) => option.value === 'decisions')); if (group) { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(group, 'status'); group.dispatchEvent(new Event('change', { bubbles: true })); } if (filter) { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(filter, 'all'); filter.dispatchEvent(new Event('change', { bubbles: true })); } return 1; })()`);
          const taskVisible = await cdp.evaluate(`document.querySelectorAll('.workspace-activity-task').length > 0`);
          if (!taskVisible) throw new Error("The activity board did not show tasks from the workspace.");
          if (process.env.UI_MATRIX_CAPTURE === "1") {
            const capture = await cdp.send("Page.captureScreenshot", { format: "png" });
            fs.writeFileSync(path.join(captureDirectory, "workspace-activity-1440.png"), Buffer.from(capture.data, "base64"));
          }
          console.log(`[workspace-search-activity] ${JSON.stringify({ globalContentSearch: chatFound, savedQuery: saved, typeFilter: onlyChat, preservedQueryAndFilters: restored && restoredFilter, projectFileSearchAndOpen: fileOpened && fileQueryRestored, corpusSearchAndOpen: referenceOpened && referenceVisible && referenceQueryRestored, activityBoard: boardReady, projectGrouping: groupHeadingReady, decisionFilter: decisionVisible, tasks: taskVisible })}`);
        }
        if (route === "terminal" && exerciseProjectTerminal && width === 1440 && height === 900) {
          const projectPicker = await cdp.evaluate(`Boolean(document.querySelector('.terminal-workspace-main .terminal-controls select'))`);
          if (!projectPicker) throw new Error("The standalone Terminal route did not render its project selector.");
          const selectedProject = await cdp.evaluateWith(function (name) {
            const select = document.querySelector('.terminal-workspace-main .terminal-controls select');
            const option = [...(select?.options ?? [])].find((item) => item.textContent?.trim() === name);
            if (!select || !option) return false;
            Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, option.value);
            select.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }, captureMode ? "Skai Starter Project" : "Revision 4 coding fixture");
          if (!selectedProject) throw new Error("Terminal could not select the seeded project.");
          const workspaceReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 100; i++) { const files = document.querySelector('.terminal-files-card'); if (files?.innerText.includes('README.md') && document.querySelector('.terminal-workspace-main input[aria-label="Terminal command"]')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
          if (!workspaceReady) throw new Error(`Terminal did not load the selected project's files and command field: ${JSON.stringify(await cdp.evaluate(`(() => ({ files: document.querySelector('.terminal-files-card')?.innerText, main: document.querySelector('.terminal-workspace-main')?.innerText?.slice(0, 400) }))()`))}`);
          const workspaceGeometry = await cdp.evaluate(`(() => { const main = document.querySelector('.terminal-workspace-main')?.getBoundingClientRect(); const inspector = document.querySelector('.terminal-workspace-inspector')?.getBoundingClientRect(); const rect = (r) => r && ({ x: r.x, y: r.y, width: r.width, height: r.height, right: r.right }); return { main: rect(main), inspector: rect(inspector), columns: getComputedStyle(document.querySelector('.terminal-workspace-grid')).gridTemplateColumns }; })()`);
          if (!workspaceGeometry.main || !workspaceGeometry.inspector || workspaceGeometry.main.width < 650 || workspaceGeometry.inspector.width < 260 || Math.abs(workspaceGeometry.main.y - workspaceGeometry.inspector.y) > 3) throw new Error(`Terminal, setup, and Files & Diffs did not share the intended workspace: ${JSON.stringify(workspaceGeometry)}`);
          const preflightButton = [...await cdp.evaluate(`([...document.querySelectorAll('.terminal-inspector-card button')].map((button) => button.textContent?.trim()))`)];
          if (!preflightButton.includes("Run preflight")) throw new Error(`Terminal setup did not offer preflight: ${JSON.stringify(preflightButton)}`);
          await clickButtonText(cdp, "Run preflight", ".terminal-inspector-card");
          const preflightReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 80; i++) { const text = document.querySelector('.terminal-inspector-card')?.innerText ?? ''; if (text.includes('package.json') && text.includes('run build') && text.includes('Suggested checks')) return text; await new Promise((r) => setTimeout(r, 100)); } return null; })()`);
          if (!preflightReady || fs.existsSync(path.join(seedProject, "preflight-marker.tmp"))) throw new Error(`Terminal preflight did not inspect read-only setup without executing suggestions: ${JSON.stringify(preflightReady)}`);
          const command = process.platform === "win32" ? "Write-Output terminal-workspace-smoke" : "printf terminal-workspace-smoke";
          await cdp.evaluateWith(function (value) { const input = document.querySelector('.terminal-workspace-main input[aria-label="Terminal command"]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }, command);
          await clickButtonText(cdp, "Run command", ".terminal-workspace-main");
          const result = await cdp.evaluate(`(async () => { for (let i = 0; i < 100; i++) { const text = document.querySelector('.terminal-workspace-main .terminal-result')?.innerText ?? ''; if (text.includes('terminal-workspace-smoke')) return text; await new Promise((r) => setTimeout(r, 100)); } return null; })()`);
          if (!result?.includes("exit 0")) throw new Error(`Standalone Terminal did not run the explicit project-bounded command: ${JSON.stringify(result)}`);
          if (process.env.UI_MATRIX_CAPTURE === "1") {
            fs.mkdirSync(path.join(__dirname, "..", "docs", "design-review", "workflow-collection", "revision-4"), { recursive: true });
            const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
            fs.writeFileSync(path.join(__dirname, "..", "docs", "design-review", "workflow-collection", "revision-4", "evidence-project-terminal-workspace-1440.png"), Buffer.from(screenshot.data, "base64"));
          }
          console.log(`[terminal-workspace] ${JSON.stringify({ layout: workspaceGeometry, preflight: "read-only", command, result: result.trim() })}`);
        }
        if (route === "models" && process.env.UI_MATRIX_EXERCISE_MODEL_REVIEW === "1" && width === 1440 && height === 900) {
          const modelName = "qwen3:8b";
          await cdp.evaluateWith(function (value) { const input = document.querySelector('input[aria-label="Ollama model name"]'); if (!input) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); return true; }, modelName);
          await clickButtonText(cdp, "Review download", ".model-install-card");
          const review = await cdp.evaluate(`(() => { const dialog = document.querySelector('[role="dialog"][aria-label="Review local model download"]'); return dialog?.innerText ?? null; })()`);
          if (!review?.includes(modelName) || !review.includes("local Ollama runtime") || !review.includes("No remote package verification")) throw new Error(`Local model download review did not disclose the target runtime and verification limits: ${JSON.stringify(review)}`);
          if (process.env.UI_MATRIX_CAPTURE === "1") {
            fs.mkdirSync(path.join(__dirname, "..", "docs", "design-review", "workflow-collection", "revision-4"), { recursive: true });
            const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
            fs.writeFileSync(path.join(__dirname, "..", "docs", "design-review", "workflow-collection", "revision-4", "evidence-model-download-review-1440.png"), Buffer.from(screenshot.data, "base64"));
          }
          await clickButtonText(cdp, "Cancel", '[role="dialog"][aria-label="Review local model download"]');
          if (await cdp.evaluate(`Boolean(document.querySelector('[role="dialog"][aria-label="Review local model download"]'))`)) throw new Error("Cancelling the model download review left its confirmation open.");
          console.log(`[model-download-review] ${JSON.stringify({ modelName, confirmation: "reviewed then cancelled; no download started" })}`);
        }
        if (route === "models" && process.env.UI_MATRIX_EXERCISE_MODEL_SELECTION === "1" && width === 1440 && height === 900 && theme === "dark" && collapsed === "false") {
          const installedModelReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 100; i++) { if ([...document.querySelectorAll('.models-library-layout .catalog-row')].some((row) => row.innerText.includes('Qwen3 14B'))) return true; await new Promise((r) => setTimeout(r, 100)); } return false; })()`);
          if (!installedModelReady) {
            const inventoryDetails = await cdp.evaluate(`(async () => { const settings = await window.skaiAgent.request('settings.get'); const current = settings.ok ? settings.result : settings; const models = await window.skaiAgent.request('models.list', { provider: current.provider, endpoint: current.endpoint }); return { rows: [...document.querySelectorAll('.models-library-layout .catalog-row')].map((row) => row.innerText), visibleError: document.querySelector('.global-error')?.innerText ?? '', settings: current, discovered: models.ok ? models.result?.map((model) => ({ model: model.model, provider: model.provider, endpoint: model.endpoint })) : models }; })()`);
            throw new Error(`The installed qwen3:14b model did not appear in the local Model Library: ${JSON.stringify(inventoryDetails)}`);
          }
          await cdp.evaluate(`([...document.querySelectorAll('.models-library-layout .catalog-row')].find((row) => row.innerText.includes('Qwen3 14B'))?.click(), 1)`);
          const selectedModelDetails = await cdp.evaluate(`document.querySelector('.model-inspector')?.innerText ?? ''`);
          if (!selectedModelDetails.includes('qwen3:14b') || !selectedModelDetails.includes('Ollama') || !selectedModelDetails.includes('Available locally')) throw new Error(`The installed-model inspector omitted its runtime or availability: ${JSON.stringify(selectedModelDetails)}`);
          if (process.env.UI_MATRIX_CAPTURE === "1") {
            fs.mkdirSync(path.join(__dirname, "..", "docs", "design-review", "workflow-collection", "revision-4"), { recursive: true });
            const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
            fs.writeFileSync(path.join(__dirname, "..", "docs", "design-review", "workflow-collection", "revision-4", "evidence-model-installed-1440.png"), Buffer.from(screenshot.data, "base64"));
          }
          await clickButtonText(cdp, "Use in chat", ".model-inspector");
          const modelApplied = await cdp.evaluate(`(async () => { for (let i = 0; i < 80; i++) { if (document.title.endsWith(' · chat') && localStorage.getItem('skai.model') === 'qwen3:14b') return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
          if (!modelApplied) throw new Error("Choosing Use in chat did not open Chat with qwen3:14b selected.");
          console.log(`[model-selection] ${JSON.stringify({ model: "qwen3:14b", runtime: "Ollama", available: true, selectedFor: "Chat" })}`);
        }
        if (route === "marketplace" && process.env.UI_MATRIX_EXERCISE_MARKETPLACE === "1" && width === 1440 && height === 900) {
          const searchReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 60; i++) { if (document.querySelector('.plugins-search input') && document.querySelector('.plugins-catalog-item')) return true; await new Promise((r) => setTimeout(r, 100)); } return false; })()`);
          if (!searchReady) throw new Error("Marketplace Discover did not load its searchable local catalog.");
          const searched = await cdp.evaluateWith(function (value) { const input = document.querySelector('.plugins-search input'); if (!input) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); return true; }, "Qwen3.6-27B");
          if (!searched) throw new Error("Marketplace Discover search field was unavailable.");
          const matchReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 40; i++) { if ([...document.querySelectorAll('.plugins-catalog-copy strong')].some((item) => item.textContent?.trim() === 'Qwen3.6-27B')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
          if (!matchReady) throw new Error(`Marketplace search did not filter to the known catalog listing: ${JSON.stringify(await cdp.evaluate(`document.querySelector('.plugins-catalog')?.innerText?.slice(0, 300)`))}`);
          await cdp.evaluate(`([...document.querySelectorAll('.plugins-catalog-copy')].find((button) => button.querySelector('strong')?.textContent?.trim() === 'Qwen3.6-27B')?.click(), 1)`);
          const details = await cdp.evaluate(`document.querySelector('.plugins-inspector')?.innerText ?? ''`);
          const detailText = details.toLowerCase();
          if (!details.includes("Qwen3.6-27B") || !detailText.includes("availability") || !detailText.includes("license")) throw new Error(`Marketplace listing details omitted the selected model's metadata: ${JSON.stringify(details.slice(0, 500))}`);
          if (process.env.UI_MATRIX_CAPTURE === "1") {
            fs.mkdirSync(path.join(__dirname, "..", "docs", "design-review", "workflow-collection", "revision-4"), { recursive: true });
            const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
            fs.writeFileSync(path.join(__dirname, "..", "docs", "design-review", "workflow-collection", "revision-4", "evidence-marketplace-discover-1440.png"), Buffer.from(screenshot.data, "base64"));
          }
          console.log(`[marketplace-discovery] ${JSON.stringify({ query: "Qwen3.6-27B", selected: true, details: "availability and license visible" })}`);
        }
        if (route === "marketplace" && exerciseMcpReview && width === 1440 && height === 900) {
          await cdp.evaluate(`(() => { const button = [...document.querySelectorAll('.plugins-customize-nav > button')].find((item) => item.textContent?.includes('Tools')); button?.click(); return Boolean(button); })()`);
          const mcpPageReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 50; i++) { if (document.querySelector('.plugins-mcp-form input[aria-label="MCP server ID"]')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
          if (!mcpPageReady) throw new Error("Marketplace did not open the MCP server connect workflow.");
          await cdp.evaluateWith(function (serverId, endpoint) {
            const set = (input, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); };
            set(document.querySelector('.plugins-mcp-form input[aria-label="MCP server ID"]'), serverId);
            set(document.querySelector('.plugins-mcp-form input[aria-label="Local MCP endpoint"]'), endpoint);
            return true;
          }, "revision4-review-fixture", mcpReviewEndpoint);
          await clickButtonText(cdp, "Connect and review tools", ".plugins-mcp-form");
          const connected = await cdp.evaluate(`(async () => { for (let i = 0; i < 80; i++) { const row = document.querySelector('.plugins-connection.is-selected'); if (row?.innerText.includes('read_garden_plan')) return row.innerText; await new Promise((r) => setTimeout(r, 75)); } return null; })()`);
          if (!connected?.includes("read_garden_plan") || !connected.includes("Explicit approval per call")) throw new Error(`The loopback MCP server did not connect and expose its tool for review: ${JSON.stringify(connected)}`);
          await clickButtonText(cdp, "Review & run", ".plugins-tool-review");
          const reviewed = await cdp.evaluate(`document.querySelector('.plugins-tool-call[aria-label="Review MCP tool call"]')?.innerText ?? ''`);
          if (!reviewed.includes("read_garden_plan") || !reviewed.includes("Arguments (JSON)") || !reviewed.includes("read-only call")) throw new Error(`MCP call review omitted the tool identity, arguments, or read-only boundary: ${JSON.stringify(reviewed)}`);
          await cdp.evaluate(`(() => { const field = document.querySelector('.plugins-tool-call textarea[aria-label="MCP tool arguments as JSON"]'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(field, '{"area":"north bed"}'); field.dispatchEvent(new Event('input', { bubbles: true })); return Boolean(field); })()`);
          const reviewedArguments = await cdp.evaluate(`(async () => { await new Promise((resolve) => setTimeout(resolve, 160)); return document.querySelector('.plugins-tool-call textarea[aria-label="MCP tool arguments as JSON"]')?.value ?? null; })()`);
          if (reviewedArguments !== '{"area":"north bed"}') throw new Error(`MCP review arguments did not remain visible before approval: ${JSON.stringify(reviewedArguments)}`);
          const reviewVisibility = await cdp.evaluate(`(() => { const panel = document.querySelector('.plugins-main'); const card = document.querySelector('.plugins-tool-call'); card?.scrollIntoView({ block: 'center' }); const p = panel?.getBoundingClientRect(); const r = card?.getBoundingClientRect(); return p && r ? { panel: [p.left, p.top, p.right, p.bottom], card: [r.left, r.top, r.right, r.bottom], visible: r.top >= p.top && r.bottom <= p.bottom } : null; })()`);
          if (!reviewVisibility?.visible) throw new Error(`MCP tool approval card could not be brought fully into view: ${JSON.stringify(reviewVisibility)}`);
          if (process.env.UI_MATRIX_CAPTURE === "1") {
            fs.mkdirSync(path.join(__dirname, "..", "docs", "design-review", "workflow-collection", "revision-4"), { recursive: true });
            const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
            fs.writeFileSync(path.join(__dirname, "..", "docs", "design-review", "workflow-collection", "revision-4", "evidence-mcp-tool-review-1440.png"), Buffer.from(screenshot.data, "base64"));
          }
          await clickButtonText(cdp, "Approve read and run", ".plugins-tool-call");
          const result = await cdp.evaluate(`(async () => { for (let i = 0; i < 80; i++) { const text = document.querySelector('.plugins-tool-call-result')?.innerText ?? ''; if (text.includes('north bed')) return text; await new Promise((r) => setTimeout(r, 75)); } return null; })()`);
          if (!result?.includes("inspect soil moisture before watering")) throw new Error(`The approved MCP read did not return its fixture result: ${JSON.stringify(result)}`);
          await cdp.evaluate(`(() => { window.scrollTo(0, 0); document.querySelectorAll('.app-content, .plugins-main').forEach((element) => { element.scrollTop = 0; }); return true; })()`);
          console.log(`[mcp-review] ${JSON.stringify({ connected: true, tool: "read_garden_plan", approval: "explicit read approval", result: result.trim() })}`);
        }
        if (route === "marketplace" && process.env.UI_MATRIX_EXERCISE_INSTALLED_VOICE === "1" && width === 1440 && height === 900) {
          const opened = await cdp.evaluate(`(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'Installed & updates'); if (!button) return false; button.click(); return true; })()`);
          if (!opened) throw new Error("Marketplace did not expose Installed & updates.");
          const inventoryReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 200; i++) { const layout = document.querySelector('.marketplace-installed-layout'); const refreshing = [...document.querySelectorAll('.marketplace-installed-pane .panel-heading .status-badge')].some((item) => item.innerText.includes('Refreshing')); if (layout && !refreshing) return true; await new Promise((r) => setTimeout(r, 100)); } return false; })()`);
          if (!inventoryReady) throw new Error(`Installed & updates did not settle its local inventory: ${JSON.stringify(await cdp.evaluate(`({ status: [...document.querySelectorAll('.marketplace-installed-pane .panel-heading .status-badge')].map((item) => item.innerText), alerts: [...document.querySelectorAll('[role="alert"], .marketplace-honesty')].map((item) => item.innerText) })`))}`);
          const voiceRows = await cdp.evaluate(`([...document.querySelectorAll('.marketplace-installed-group')].find((group) => group.querySelector('h4')?.textContent?.includes('Voice profiles'))?.innerText ?? '')`);
          const inventoryStatus = await cdp.evaluate(`({ status: [...document.querySelectorAll('.marketplace-installed-pane .panel-heading .status-badge')].map((item) => item.innerText).join(' '), checking: [...document.querySelectorAll('.marketplace-installed-pane .ui-empty')].some((item) => item.textContent?.includes('Checking installed items')), inspectorChecking: document.querySelector('.marketplace-installed-inspector')?.innerText.includes('Checking installed items') ?? false })`);
          if (inventoryStatus.status.includes('Refreshing') && (!inventoryStatus.checking || !inventoryStatus.inspectorChecking)) throw new Error(`Both inventory panes should show progress while local inventory is refreshing: ${JSON.stringify(inventoryStatus)}`);
          if (/Piper|Kokoro/i.test(voiceRows)) {
            const categoryChanged = await cdp.evaluate(`(() => { const select = document.querySelector('.marketplace-installed-filters select[aria-label="Filter installed items by category"]'); if (!select) return false; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(select, 'Voice profiles'); select.dispatchEvent(new Event('input', { bubbles: true })); select.dispatchEvent(new Event('change', { bubbles: true })); return select.value === 'Voice profiles'; })()`);
            if (!categoryChanged) throw new Error('Installed inventory did not expose its category filter.');
            const name = /Piper/i.test(voiceRows) ? "Piper" : "Kokoro";
            await cdp.evaluateWith(function (value) { const row = [...document.querySelectorAll('.marketplace-installed-model')].find((item) => item.querySelector('strong')?.textContent?.includes(value)); row?.click(); return Boolean(row); }, name);
            const inspector = await cdp.evaluate(`document.querySelector('.marketplace-installed-inspector')?.innerText ?? ''`);
            const layout = await cdp.evaluate(`(() => { const list = document.querySelector('.marketplace-installed-pane')?.getBoundingClientRect(); const inspector = document.querySelector('.marketplace-installed-inspector'); const detail = inspector?.getBoundingClientRect(); const preview = inspector?.querySelector('button[aria-label^="Preview "]'); const actions = inspector?.querySelector(':scope > .marketplace-model-actions'); const actionRect = actions?.getBoundingClientRect(); const availability = document.querySelector('.marketplace-installed-voice-status')?.innerText ?? ''; return list && detail ? { list: { left: list.left, right: list.right, width: list.width }, detail: { left: detail.left, right: detail.right, width: detail.width }, previewEnabled: Boolean(preview && !preview.disabled), actionPosition: actions ? getComputedStyle(actions).position : null, actionsVisible: Boolean(actionRect && actionRect.bottom <= window.innerHeight && actionRect.top >= detail.top), availability } : null; })()`);
            const inspectorText = inspector.toLowerCase();
            const expectedDetails = ["source", "version", "last updated", "disk use", "compatibility", "dependent workflows", "removal impact", "next step"];
            const missingDetails = expectedDetails.filter((label) => !inspectorText.includes(label));
            if (!inspectorText.includes(name.toLowerCase()) || missingDetails.length) throw new Error(`Installed voice ${name} did not show the shared inventory details ${missingDetails.join(", ")}: ${JSON.stringify(inspector)}`);
            if (!layout || layout.list.left >= layout.detail.left || layout.list.width <= layout.detail.width || !layout.previewEnabled || !layout.actionsVisible || !layout.availability.includes('Local runtime') || !layout.availability.includes('Local playback')) throw new Error(`Installed voice list/detail workflow did not match the expected list-left, detail-right layout or provide enabled, reachable actions: ${JSON.stringify(layout)}`);
          }
          if (process.env.UI_MATRIX_CAPTURE === "1") {
            fs.mkdirSync(path.join(__dirname, "..", "docs", "design-review", "workflow-collection", "revision-4"), { recursive: true });
            const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
            fs.writeFileSync(path.join(__dirname, "..", "docs", "design-review", "workflow-collection", "revision-4", "evidence-marketplace-installed-inventory-1440.png"), Buffer.from(screenshot.data, "base64"));
          }
          console.log(`[marketplace-installed-voice] ${JSON.stringify({ voiceRows: voiceRows.trim() || (inventoryStatus.status.includes('Refreshing') ? "Not loaded yet" : "No installed voice profiles returned by the local host"), inventoryStatus })}`);
        }
        if (exerciseCodingCollapsedLayout && route === "chat" && width >= 761) {
          const layout = await cdp.evaluate(`(() => {
            const shell = document.querySelector('.app-shell');
            const sidebar = document.querySelector('.app-sidebar');
            const tabs = shell?.querySelector(':scope > .workspace-tabs-hotkeys');
            const main = shell?.querySelector(':scope > .app-main');
            if (!shell || !sidebar || !tabs || !main) return null;
            const wasCollapsed = shell.classList.contains('workspace-sidebar-collapsed');
            const wasCodingAgent = sidebar.classList.contains('is-coding-agent');
            shell.classList.add('workspace-sidebar-collapsed');
            sidebar.classList.add('is-coding-agent');
            const tabRect = tabs.getBoundingClientRect();
            const mainRect = main.getBoundingClientRect();
            const shellRect = shell.getBoundingClientRect();
            return { shellWidth: shellRect.width, tabLeft: tabRect.left, tabRight: tabRect.right, mainLeft: mainRect.left, mainRight: mainRect.right, mainWidth: mainRect.width, gridColumns: getComputedStyle(shell).gridTemplateColumns, wasCollapsed, wasCodingAgent };
          })()`);
          if (!layout || Math.abs(layout.tabLeft - layout.mainLeft) > 1 || Math.abs(layout.tabRight - layout.mainRight) > 1 || layout.mainWidth < layout.shellWidth * 0.7) {
            throw new Error(`Collapsed Coding Agent tabs and chat do not share the same full-width grid track: ${JSON.stringify(layout)}`);
          }
          if (process.env.UI_MATRIX_CAPTURE === "1" && width === 1440 && height === 900) {
            fs.mkdirSync(captureDirectory, { recursive: true });
            const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
            fs.writeFileSync(path.join(captureDirectory, "coding-agent-collapsed-layout-1440.png"), Buffer.from(screenshot.data, "base64"));
          }
          await cdp.evaluateWith(function (previous) {
            const shell = document.querySelector('.app-shell');
            const sidebar = document.querySelector('.app-sidebar');
            if (!previous.wasCollapsed) shell?.classList.remove('workspace-sidebar-collapsed');
            if (!previous.wasCodingAgent) sidebar?.classList.remove('is-coding-agent');
            return true;
          }, layout);
        }
        if (route === "chat" && exerciseChatSchedule && width === 390 && height === 844 && theme === "dark" && collapsed === "false") {
          await clickInRenderer(cdp, '.toolbar-sidebar-toggle[aria-label="Show sidebar"]');
          const mobileNavigationOpen = await cdp.evaluate(`Boolean(document.querySelector('.workspace-sidebar.is-mobile-open'))`);
          if (!mobileNavigationOpen) throw new Error("The mobile workspace navigation drawer did not open for selecting a conversation.");
          await clickButtonText(cdp, "Plan a simple herb garden", ".sidebar-history-list");
          const conversationReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 60; i++) { if (document.querySelector('.chat-page .chat-thread-summary, .chat-page .chat-context-bar strong')?.textContent?.includes('Plan a simple herb garden')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
          if (!conversationReady) throw new Error("The seeded conversation did not open for the schedule workflow.");
          const navigationClosed = await cdp.evaluate(`!document.querySelector('.workspace-sidebar.is-mobile-open')`);
          if (!navigationClosed) throw new Error("Selecting a conversation did not dismiss the mobile navigation drawer.");
          await cdp.evaluate(`([...document.querySelectorAll('.chat-header-actions button')].find((button) => button.textContent?.trim() === 'Details')?.click())`);
          const schedulePanelReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 30; i++) { const rail = document.querySelector('.chat-rail'); if (rail && !rail.hidden && document.querySelector('.chat-schedules-panel')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
          if (!schedulePanelReady) throw new Error("Conversation Details did not show its local Scheduled runs panel.");
          await cdp.evaluate(`document.querySelector('.chat-schedules-panel .chat-schedules-heading button')?.click()`);
          const scheduleDraftReady = await cdp.evaluate(`Boolean(document.querySelector('.chat-schedule-form'))`);
          if (!scheduleDraftReady) throw new Error(`The conversation schedule form did not open: ${JSON.stringify(await cdp.evaluate(`(() => ({ panel: document.querySelector('.chat-schedules-panel')?.innerText, buttons: [...(document.querySelector('.chat-schedules-panel')?.querySelectorAll('button') ?? [])].map((button) => ({ text: button.innerText, expanded: button.getAttribute('aria-expanded') })), details: document.querySelector('.chat-rail')?.hidden }))()`))}`);
          await cdp.evaluate(`(() => { const form = document.querySelector('.chat-schedule-form'); const prompt = form?.querySelector('input'); const date = form?.querySelector('input[type="datetime-local"]'); const repeat = form?.querySelector('select'); const setValue = (element, value, prototype) => { if (!element) return; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); }; setValue(prompt, 'Create a weekly progress summary', HTMLInputElement.prototype); const due = new Date(Date.now() + 86400000); setValue(date, new Date(due.getTime() - due.getTimezoneOffset() * 60000).toISOString().slice(0, 16), HTMLInputElement.prototype); setValue(repeat, '10080', HTMLSelectElement.prototype); return true; })()`);
          const scheduleDraft = await cdp.evaluate(`(() => { const form = document.querySelector('.chat-schedule-form'); return { prompt: form?.querySelector('input')?.value, repeat: form?.querySelector('select')?.value, existing: document.querySelector('.chat-schedule-list')?.innerText ?? '' }; })()`);
          if (scheduleDraft.prompt !== "Create a weekly progress summary" || scheduleDraft.repeat !== "10080" || !scheduleDraft.existing.includes("weekly summary")) throw new Error(`The conversation schedule draft or existing run was not ready: ${JSON.stringify(scheduleDraft)}`);
          if (process.env.UI_MATRIX_CAPTURE === "1" && width === 1440 && height === 900) {
            fs.mkdirSync(captureDirectory, { recursive: true });
            const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
            fs.writeFileSync(path.join(captureDirectory, "chat-schedule-from-conversation-1440.png"), Buffer.from(screenshot.data, "base64"));
          }
          await cdp.evaluate(`document.querySelectorAll('.chat-schedule-form button')[0]?.click()`);
          const previewPassed = await cdp.evaluate(`(async () => { for (let i = 0; i < 60; i++) { if ((document.querySelector('.chat-schedule-preview')?.innerText ?? '').includes('Dry run passed')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
          if (!previewPassed) {
            const previewGateHeld = await cdp.evaluate(`(() => { const button = [...(document.querySelector('.chat-schedule-form')?.querySelectorAll('button') ?? [])].find((candidate) => /Preview first/.test(candidate.innerText ?? '')); return Boolean(button?.disabled); })()`);
            if (!previewGateHeld) throw new Error('The conversation schedule form enabled saving without a completed preview.');
            await cdp.evaluate(`document.querySelector('.chat-schedules-panel .chat-schedules-heading button')?.click()`);
          } else {
            await cdp.evaluate(`document.querySelectorAll('.chat-schedule-form button')[1]?.click()`);
            await cdp.evaluate(`(async () => { for (let i = 0; i < 40; i++) { if (!document.querySelector('.chat-schedule-form')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
            await cdp.evaluate(`document.querySelector('.chat-schedules-panel .chat-schedules-heading button')?.click()`);
            const savedSchedule = await cdp.evaluate(`(async () => { for (let i = 0; i < 60; i++) { if ((document.querySelector('.chat-schedule-list')?.innerText ?? '').includes('Create a weekly progress summary')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
            if (!savedSchedule) throw new Error(`Saving the conversation schedule did not add its row to Scheduled runs: ${JSON.stringify(await cdp.evaluate(`(() => ({ panel: document.querySelector('.chat-schedules-panel')?.innerText, form: document.querySelector('.chat-schedule-form')?.innerText, fields: [...(document.querySelector('.chat-schedule-form')?.querySelectorAll('input,select') ?? [])].map((field) => field.value), button: [...(document.querySelector('.chat-schedule-form')?.querySelectorAll('button') ?? [])].map((button) => ({ text: button.innerText, disabled: button.disabled })) }))()`))}`);
          }
        }
        if (route === "scheduled" && exerciseScheduledPage && width === 1440 && height === 900) {
          const seededScheduleVisible = await cdp.evaluate(`(async () => { for (let i = 0; i < 200; i++) { if (document.querySelector('.scheduled-detail-panel')?.innerText.includes('Review the herb garden plan')) return true; const item = [...(document.querySelectorAll('.scheduled-list-item') ?? [])].find((node) => node.innerText.includes('Review the herb garden plan')); if (item) { item.click(); await new Promise((r) => setTimeout(r, 100)); if (document.querySelector('.scheduled-detail-panel')?.innerText.includes('Review the herb garden plan')) return true; } await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
          if (!seededScheduleVisible) throw new Error(`The standalone schedule detail did not open from the seeded task list: ${JSON.stringify(await cdp.evaluate(`() => ({ list: document.querySelector('.scheduled-sidebar-list')?.innerText ?? '', content: document.querySelector('.scheduled-content')?.innerText ?? '' })()`))}`);
          const scheduleContext = await cdp.evaluate(`document.querySelector('.scheduled-detail-panel')?.innerText ?? ''`);
          if (!scheduleContext.includes('Time zone') || !scheduleContext.includes('Device requirement') || !scheduleContext.includes('Skai open') || !scheduleContext.includes('Configured model')) throw new Error(`Schedule detail omitted its local time zone, selected model, or required host state: ${scheduleContext}`);
          await cdp.evaluate(`([...document.querySelectorAll('.scheduled-detail-actions button')].find((button) => button.textContent?.trim() === 'Duplicate')?.click())`);
          const duplicatedScheduleDraft = await cdp.evaluate(`(() => { const selects = [...(document.querySelector('.scheduled-form-panel .scheduled-form-grid')?.querySelectorAll('select') ?? [])]; return { prompt: document.querySelector('.scheduled-form-panel textarea')?.value, trigger: selects[0]?.value, repeat: selects[1]?.value, mode: selects[2]?.value, missed: selects[3]?.value, due: document.querySelector('.scheduled-form-panel input[type="datetime-local"]')?.value, note: document.querySelector('.scheduled-form-note')?.innerText ?? '', access: document.querySelector('.scheduled-permission-preview')?.innerText ?? '' }; })()`);
          if (duplicatedScheduleDraft.prompt !== 'Review the herb garden plan' || duplicatedScheduleDraft.repeat !== '60' || duplicatedScheduleDraft.mode !== 'ChatBot' || duplicatedScheduleDraft.missed !== 'run_once' || !duplicatedScheduleDraft.due || !duplicatedScheduleDraft.note.includes('while Skai is open') || !duplicatedScheduleDraft.access.includes('no tools')) throw new Error(`Duplicating a schedule did not preserve its prompt, recurrence, and execution-scope context: ${JSON.stringify(duplicatedScheduleDraft)}`);
          await cdp.evaluate(`document.querySelector('.scheduled-form-panel .scheduled-form-heading button')?.click()`);
          if (process.env.UI_MATRIX_CAPTURE === "1" && width === 1440 && height === 900) {
            fs.mkdirSync(captureDirectory, { recursive: true });
            const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
            fs.writeFileSync(path.join(captureDirectory, "scheduled-standalone-1440.png"), Buffer.from(screenshot.data, "base64"));
          }
          await cdp.evaluate(`document.querySelector('.scheduled-new-button')?.click()`);
          const newScheduleForm = await cdp.evaluate(`Boolean(document.querySelector('.scheduled-form-panel'))`);
          if (!newScheduleForm) throw new Error("New task did not open the standalone schedule form.");
          await cdp.evaluate(`(() => { const form = document.querySelector('.scheduled-form-panel'); const prompt = form?.querySelector('textarea'); const date = form?.querySelector('input[type="datetime-local"]'); const selects = [...(form?.querySelector('.scheduled-form-grid')?.querySelectorAll('select') ?? [])]; const setValue = (element, value, prototype) => { if (!element) return; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); }; setValue(prompt, 'Review weekend meal plan', HTMLTextAreaElement.prototype); const due = new Date(Date.now() + 86400000); setValue(date, new Date(due.getTime() - due.getTimezoneOffset() * 60000).toISOString().slice(0, 16), HTMLInputElement.prototype); setValue(selects[1], '10080', HTMLSelectElement.prototype); setValue(selects[3], 'ask_first', HTMLSelectElement.prototype); return true; })()`);
          await cdp.evaluate(`document.querySelector('.scheduled-form-actions button:nth-child(2)')?.click()`);
          const standalonePreviewPassed = await cdp.evaluate(`(async () => { for (let i = 0; i < 60; i++) { if ((document.querySelector('.scheduled-dry-run-result')?.innerText ?? '').includes('One-time preview')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
          if (!standalonePreviewPassed) {
            const previewGateHeld = await cdp.evaluate(`(() => { const buttons = [...(document.querySelector('.scheduled-form-actions')?.querySelectorAll('button') ?? [])]; const enable = buttons[buttons.length - 1]; return Boolean(enable?.disabled); })()`);
            if (!previewGateHeld) throw new Error('The standalone schedule form enabled saving without a completed preview.');
            await cdp.evaluate(`document.querySelector('.scheduled-form-panel .scheduled-form-heading button')?.click()`);
          } else {
            await cdp.evaluate(`document.querySelector('.scheduled-form-actions button:last-child')?.click()`);
            const newScheduleVisible = await cdp.evaluate(`(async () => { for (let i = 0; i < 60; i++) { if ([...document.querySelectorAll('.scheduled-list-item')].some((item) => item.innerText.includes('Review weekend meal plan'))) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
            if (!newScheduleVisible) throw new Error(`Saving a standalone schedule did not add it to the task list: ${JSON.stringify(await cdp.evaluate(`(() => ({ panel: document.querySelector('.scheduled-form-panel')?.innerText ?? '', list: document.querySelector('.scheduled-sidebar-list')?.innerText ?? '', alert: document.querySelector('.scheduled-form-panel [role="alert"]')?.innerText ?? '', buttons: [...(document.querySelector('.scheduled-form-actions')?.querySelectorAll('button') ?? [])].map((button) => ({ text: button.innerText, disabled: button.disabled })) }))()`))}`);
            await cdp.evaluate(`([...document.querySelectorAll('.scheduled-list-item')].find((item) => item.innerText.includes('Review weekend meal plan'))?.click())`);
            const missedRunChoice = await cdp.evaluate(`document.querySelector('.scheduled-detail-panel')?.innerText ?? ''`);
            if (!missedRunChoice.includes('Ask first')) throw new Error(`The selected missed-run policy was not persisted: ${missedRunChoice}`);
            await cdp.evaluate(`([...document.querySelectorAll('.scheduled-detail-actions button')].find((button) => button.innerText.trim() === 'Pause')?.click())`);
            const paused = await cdp.evaluate(`(async () => { for (let i = 0; i < 40; i++) { if (document.querySelector('.scheduled-detail-panel')?.innerText.includes('paused')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
            if (!paused) throw new Error(`Pausing a standalone scheduled task did not update its detail state: ${JSON.stringify(await cdp.evaluate(`(() => ({ detail: document.querySelector('.scheduled-detail-panel')?.innerText, buttons: [...(document.querySelector('.scheduled-detail-actions')?.querySelectorAll('button') ?? [])].map((button) => ({ text: button.textContent?.trim(), disabled: button.disabled })), alert: document.querySelector('.scheduled-detail-panel [role="alert"]')?.textContent }))()`))}`);
            await cdp.evaluate(`([...document.querySelectorAll('.scheduled-detail-actions button')].find((button) => button.innerText.trim() === 'Resume')?.click())`);
            const resumed = await cdp.evaluate(`(async () => { for (let i = 0; i < 40; i++) { if (document.querySelector('.scheduled-detail-panel')?.innerText.includes('scheduled')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
            if (!resumed) throw new Error("Resuming a standalone scheduled task did not restore its active state.");
            await cdp.evaluate(`([...document.querySelectorAll('.scheduled-detail-actions button')].find((button) => button.innerText.trim() === 'Cancel schedule')?.click())`);
            const cancelled = await cdp.evaluate(`(async () => { for (let i = 0; i < 40; i++) { if (document.querySelector('.scheduled-detail-panel')?.innerText.includes('cancelled')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
            if (!cancelled) throw new Error("Cancel schedule did not move the standalone task into its terminal state.");
          }
        }
        if (route === "projects" && exerciseProjectCreate) {
          const projectEntryPoints = await cdp.evaluate(`(() => [...document.querySelectorAll('.project-directory-page .page-header button')].map((button) => button.textContent?.trim()))()`);
          if (!projectEntryPoints.includes("Open folder") || !projectEntryPoints.includes("New project")) throw new Error(`Projects page entry points did not match the expected create/open workflow: ${JSON.stringify(projectEntryPoints)}`);
          await cdp.evaluate(`([...document.querySelectorAll('.project-directory-page .page-header button')].find((button) => button.textContent?.includes('New project')))?.click()`);
          const createDialogReady = await cdp.evaluate(`Boolean(document.querySelector('#new-project-title')?.textContent?.trim() === 'Create project' && document.querySelector('.dialog-folders') && document.querySelector('.dialog-folders-heading')?.textContent?.includes('Folder') && [...document.querySelectorAll('.dialog-folders button')].some((button) => /Choose folder/.test(button.textContent ?? '')) && ![...document.querySelectorAll('[role="dialog"] label')].some((label) => label.textContent?.trim() === 'Instructions'))`);
          if (!createDialogReady) throw new Error(`Create did not open the new-project dialog: ${JSON.stringify(await cdp.evaluate(`(() => ({ page: document.querySelector('.project-directory-page')?.innerText?.slice(0, 300), header: document.querySelector('.project-directory-page .page-header')?.innerText, buttons: [...(document.querySelector('.project-directory-page .page-header')?.querySelectorAll('button') ?? [])].map((button) => button.innerText), title: document.querySelector('#new-project-title')?.textContent, dialog: document.querySelector('[role="dialog"]')?.innerText }))()`))}`);
          const folderPickerAvailable = await cdp.evaluate(`Boolean([...document.querySelectorAll('.dialog-folders button')].find((button) => button.textContent?.includes('Choose folder')))`);
          if (!folderPickerAvailable) throw new Error("The project dialog did not expose its Add folder action.");
          if (process.env.UI_MATRIX_CAPTURE === "1" && width === 1440 && height === 900) {
            fs.mkdirSync(captureDirectory, { recursive: true });
            const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
            fs.writeFileSync(path.join(captureDirectory, "project-create-dialog-1440.png"), Buffer.from(screenshot.data, "base64"));
          }
          await cdp.evaluate(`document.querySelector('.dialog-actions button[type="button"]')?.click()`);
          await cdp.evaluate(`document.querySelector('.project-directory-open-action')?.click()`);
          const projectWorkspaceReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 100; i++) { if (document.querySelector('.coding-project-heading strong') && document.querySelector('.coding-split-launcher button[aria-label="Add to split"]')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
          if (!projectWorkspaceReady) throw new Error("Projects could not open a selected project into its Coding workspace.");
          if (process.env.UI_MATRIX_CAPTURE === "1" && width === 1440 && height === 900) {
            const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
            fs.writeFileSync(path.join(captureDirectory, "project-open-workspace-1440.png"), Buffer.from(screenshot.data, "base64"));
          }
        }
        if (route === "coding" && process.env.UI_MATRIX_EXERCISE_CODING === "1") {
          const needsProject = await cdp.evaluate(`Boolean(document.querySelector('.coding-no-project button'))`);
          if (needsProject) {
            await clickInRenderer(cdp, ".coding-no-project button");
            const projectsReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 80; i++) { if (document.title.endsWith(' · projects')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
            if (!projectsReady) throw new Error("Coding workflow could not open Projects.");
            const projectActionReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 80; i++) { if (document.querySelector('.project-directory-open-action')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
            if (!projectActionReady) throw new Error(`Coding workflow could not render the seeded project row: ${JSON.stringify(await cdp.evaluate(`(() => ({ title: document.title, directory: document.querySelector('.project-directory')?.innerText ?? '', rows: [...document.querySelectorAll('.project-directory-row')].map((row) => row.innerText), body: document.body.innerText.slice(0, 500) }))()`))}`);
            await clickInRenderer(cdp, ".project-directory-open-action");
          }
          const projectReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 100; i++) { if (document.querySelector('.coding-project-heading') && (document.querySelector('.coding-project-browser') || document.querySelector('.project-thread-panel'))) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
          if (!projectReady) throw new Error(`Coding workflow could not open the seeded project: ${JSON.stringify(await cdp.evaluate(`(() => ({ title: document.title, url: location.href, body: document.body.innerText.slice(0, 900), projectHeading: document.querySelector('.coding-project-heading')?.innerText ?? null, noProject: document.querySelector('.coding-no-project')?.innerText ?? null, addToSplit: Boolean(document.querySelector('.coding-split-launcher button')), projects: [...document.querySelectorAll('.project-directory-row')].map((row) => row.innerText) }))()`))}`);
          await clickButtonContainingText(cdp, "Activity", ".coding-project-heading-actions");
          const projectActivityReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 60; i++) { if (document.querySelector('dialog [aria-label="Project activity"] h2')?.textContent === 'Recent activity') return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
          if (!projectActivityReady) throw new Error("Coding project did not open its local project activity timeline.");
          await clickInRenderer(cdp, 'dialog [aria-label="Close activity"]');
          const seededCodingThreadVisible = await cdp.evaluate(`Boolean([...document.querySelectorAll('.sidebar-project-thread')].find((button) => button.innerText.trim() === 'Review the starter project'))`);
          if (!seededCodingThreadVisible) await cdp.evaluate(`document.querySelector('button[aria-label="Expand Skai Starter Project"]')?.click(); 1`);
          const seededCodingThreadReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 40; i++) { if ([...document.querySelectorAll('.sidebar-project-thread')].some((button) => button.innerText.trim() === 'Review the starter project')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
          if (!seededCodingThreadReady) throw new Error("Coding workflow could not find the seeded project conversation.");
          await clickButtonText(cdp, "Review the starter project", ".sidebar-project-thread-list");
          const seededCodingThreadActive = await cdp.evaluate(`(async () => { for (let i = 0; i < 40; i++) { if (document.querySelector('.project-thread-panel .chat-page.is-coding-agent')?.innerText.includes('Review this project structure')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
          if (!seededCodingThreadActive) throw new Error("Coding workflow opened the project without restoring its linked Coding Agent conversation.");
          const projectThreadButtons = await cdp.evaluate(`(() => ({ header: [...document.querySelectorAll('.coding-project-heading-actions button')].some((button) => button.textContent?.trim() === 'New thread'), sidebar: Boolean(document.querySelector('.sidebar-project-new-thread')) }))()`);
          if (!projectThreadButtons.header || !projectThreadButtons.sidebar) throw new Error(`The active project did not expose project-scoped New thread actions in the header and sidebar: ${JSON.stringify(projectThreadButtons)}`);
          if (exerciseCodingPanels && width === 1440 && height === 900) {
            await clickInRenderer(cdp, 'button[aria-label="Project actions"]');
            const activityChoice = await cdp.evaluate(`(async () => { for (let i = 0; i < 20; i++) { const item = [...document.querySelectorAll('.overflow-menu-item')].find((entry) => entry.textContent?.trim() === 'Open activity'); if (item) { item.click(); return true; } await new Promise((resolve) => setTimeout(resolve, 25)); } return false; })()`);
            if (!activityChoice) throw new Error('Project actions did not expose Open activity for review checklist access.');
            const reviewPanelReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 40; i++) { if (document.querySelector('.coding-task-drawer [role="tab"]')) return true; await new Promise((resolve) => setTimeout(resolve, 50)); } return false; })()`);
            if (!reviewPanelReady) throw new Error('The project activity drawer did not open.');
            await cdp.evaluate(`([...document.querySelectorAll('.coding-task-drawer [role="tab"]')].find((tab) => tab.textContent?.trim().startsWith('Changes'))?.click())`);
            const reviewChecklistReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 40; i++) { if (document.querySelector('.coding-task-drawer .coding-review-checklist input')) return true; await new Promise((resolve) => setTimeout(resolve, 50)); } return false; })()`);
            if (!reviewChecklistReady) throw new Error('The Changes inspector did not show its review checklist.');
            await cdp.evaluate(`(() => { const input = document.querySelector('.coding-review-finding-form input'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, 'Smoke review finding'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); document.querySelector('.coding-review-finding-form button[type="submit"]')?.click(); return true; })()`);
            const reviewFindingAdded = await cdp.evaluate(`(async () => { for (let i = 0; i < 30; i++) { if (document.querySelector('.coding-review-findings li strong')?.textContent === 'Smoke review finding') return true; await new Promise((resolve) => setTimeout(resolve, 40)); } return false; })()`);
            if (!reviewFindingAdded) throw new Error('The review checklist did not add a new finding.');
            await cdp.evaluate(`(() => { const select = document.querySelector('.coding-review-findings select'); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(select, 'deferred'); select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
            const reviewFindingPersisted = await cdp.evaluate(`(async () => { for (let i = 0; i < 30; i++) { const entry = Object.entries(localStorage).find(([key]) => key.includes('coding.reviewChecklist.v1')); if (entry) { try { const rows = JSON.parse(entry[1]); if (rows.some((row) => row.title === 'Smoke review finding' && row.state === 'deferred')) return true; } catch {} } await new Promise((resolve) => setTimeout(resolve, 40)); } return false; })()`);
            if (!reviewFindingPersisted) throw new Error('The review checklist did not persist its finding status under a project/branch key.');
            if (process.env.UI_MATRIX_CAPTURE === "1") {
              fs.mkdirSync(captureDirectory, { recursive: true });
              const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
              fs.writeFileSync(path.join(captureDirectory, "coding-review-checklist-1440.png"), Buffer.from(screenshot.data, "base64"));
            }
            await clickInRenderer(cdp, 'button[aria-label="Close project panel"]');
          }
          if (exerciseProjectTerminal && width === 1440 && height === 900) {
            await clickInRenderer(cdp, 'button[aria-label="Project actions"]');
            const preflightChoice = await cdp.evaluate(`(async () => { for (let i = 0; i < 20; i++) { const item = [...document.querySelectorAll('.overflow-menu-item')].find((entry) => entry.textContent?.trim() === 'Run preflight'); if (item) { item.click(); return true; } await new Promise((resolve) => setTimeout(resolve, 25)); } return false; })()`);
            if (!preflightChoice) throw new Error("Project actions did not expose Run preflight.");
            const preflightReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 80; i++) { const card = document.querySelector('.project-preflight'); if (card) return card.innerText; await new Promise((resolve) => setTimeout(resolve, 100)); } return null; })()`);
            if (!preflightReady || !preflightReady.includes('package.json') || !preflightReady.includes('run build') || !preflightReady.includes('Suggested checks (not run)') || !preflightReady.includes('Node.js')) throw new Error(`Project preflight did not report the detected manifest, runtime, and unexecuted build check: ${JSON.stringify({ card: preflightReady, alerts: await cdp.evaluate(`([...document.querySelectorAll('[role="alert"],[role="status"]')].map((item) => item.innerText))`) })}`);
            if (fs.existsSync(path.join(seedProject, "preflight-marker.tmp"))) throw new Error("Read-only project preflight ran the fixture's package script.");
            if (process.env.UI_MATRIX_CAPTURE === "1") {
              fs.mkdirSync(captureDirectory, { recursive: true });
              const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
              fs.writeFileSync(path.join(captureDirectory, "coding-preflight-1440.png"), Buffer.from(screenshot.data, "base64"));
            }
            await clickInRenderer(cdp, 'button[aria-label="Project actions"]');
            const terminalChoice = await cdp.evaluate(`(async () => { for (let i = 0; i < 20; i++) { const item = [...document.querySelectorAll('.overflow-menu-item')].find((entry) => entry.textContent?.trim() === 'Open terminal'); if (item) { item.click(); return true; } await new Promise((resolve) => setTimeout(resolve, 25)); } return false; })()`);
            if (!terminalChoice) throw new Error("Project actions did not expose Open terminal.");
            const terminalReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 40; i++) { if (document.querySelector('.coding-terminal-inspector input[aria-label="Terminal command"]') && document.querySelector('.coding-terminal-inspector button')) return true; await new Promise((resolve) => setTimeout(resolve, 50)); } return false; })()`);
            if (!terminalReady) throw new Error("Open terminal did not show a command runner in the project workspace panel.");
            const command = process.platform === "win32" ? "Write-Output terminal-ui-smoke" : "printf terminal-ui-smoke";
            await cdp.evaluateWith(function (value) { const input = document.querySelector('.coding-terminal-inspector input[aria-label="Terminal command"]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); }, command);
            await clickButtonText(cdp, "Run command", ".coding-terminal-inspector");
            const terminalResult = await cdp.evaluate(`(async () => { for (let i = 0; i < 100; i++) { const result = document.querySelector('.coding-terminal-inspector .terminal-result'); if (result?.innerText.includes('terminal-ui-smoke')) return result.innerText; await new Promise((resolve) => setTimeout(resolve, 100)); } return null; })()`);
            if (!terminalResult || !terminalResult.includes('exit 0')) throw new Error(`The project terminal did not return a successful bounded command result: ${JSON.stringify(terminalResult)}`);
            const terminalOutputControls = await cdp.evaluate(`(() => [...document.querySelectorAll('.coding-terminal-inspector .terminal-output-actions button')].map((button) => button.textContent?.trim()))()`);
            if (!['Copy', 'Export', 'Clear'].every((label) => terminalOutputControls.includes(label))) throw new Error(`Terminal output is missing copy, bounded export, or clear controls: ${JSON.stringify(terminalOutputControls)}`);
            await clickButtonText(cdp, 'Clear', '.coding-terminal-inspector .terminal-output-actions');
            const terminalCleared = await cdp.evaluate(`Boolean(document.querySelector('.coding-terminal-inspector .terminal-output-actions') && !document.querySelector('.coding-terminal-inspector .terminal-output-block pre'))`);
            if (!terminalCleared) throw new Error('Clear did not hide the displayed terminal output.');
            await clickButtonText(cdp, 'Show', '.coding-terminal-inspector .terminal-output-actions');
            const terminalRestored = await cdp.evaluate(`document.querySelector('.coding-terminal-inspector .terminal-output-block pre')?.innerText.includes('terminal-ui-smoke')`);
            if (!terminalRestored) throw new Error('Show did not restore the buffered terminal output after Clear.');
            if (process.env.UI_MATRIX_CAPTURE === "1") {
              fs.mkdirSync(captureDirectory, { recursive: true });
              const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
              fs.writeFileSync(path.join(captureDirectory, "coding-terminal-1440.png"), Buffer.from(screenshot.data, "base64"));
            }
            console.log(`[coding-project-terminal] ${JSON.stringify({ preflight: "read-only", command, result: terminalResult.trim() })}`);
            await clickInRenderer(cdp, 'button[aria-label="Close project panel"]');
            await cdp.evaluate(`document.querySelector('.project-preflight button')?.click(); 1`);
            await cdp.evaluate(`(() => { for (const selector of ['.app-main', '.app-content-coding']) { const element = document.querySelector(selector); if (element) element.scrollTop = 0; } window.scrollTo(0, 0); return 1; })()`);
          }
          if (exerciseCodingPanels && ((width === 1440 && height === 900) || (width === 390 && height === 844))) {
            const compactCodingPanels = width < 640;
            const singlePane = await cdp.evaluate(`(() => { const grid = document.querySelector('.coding-session-grid.is-chat'); const main = document.querySelector('.project-thread-panel'); const side = document.querySelector('.coding-project-browser'); const addSplit = document.querySelector('.coding-split-launcher button[aria-label="Add to split"]'); return { splitOpen: grid?.classList.contains('is-split-open') ?? true, columns: grid && getComputedStyle(grid).gridTemplateColumns, mainWidth: main?.getBoundingClientRect().width ?? 0, mainX: main?.getBoundingClientRect().left ?? 0, sideX: side?.getBoundingClientRect().left ?? 0, sideDisplay: side && getComputedStyle(side).display, sideTabs: document.querySelectorAll('.coding-secondary-tab-group .workspace-tab').length, resizer: Boolean(grid?.querySelector('.coding-split-resizer')), addSplit: Boolean(addSplit), launcherWidth: addSplit?.getBoundingClientRect().width ?? 0, launcherText: addSplit?.textContent?.trim() ?? '' }; })()`);
            if (singlePane.splitOpen) {
              if (singlePane.mainWidth < 250 || singlePane.sideDisplay !== "flex" || singlePane.sideTabs < 1 || !singlePane.resizer || (width > 900 && singlePane.mainX >= singlePane.sideX)) throw new Error(`The existing Coding split should keep the main conversation and a resizable work pane visible: ${JSON.stringify(singlePane)}`);
            } else if (!singlePane.addSplit || singlePane.launcherWidth < (compactCodingPanels ? 60 : 90) || singlePane.launcherText !== "Add to split" || singlePane.sideDisplay !== "none" || singlePane.mainWidth < (compactCodingPanels ? 250 : 800)) {
              throw new Error(`A single-pane Coding Agent project should retain its optional split control: ${JSON.stringify(singlePane)}`);
            }
            await cdp.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', ctrlKey: true, bubbles: true })); true`);
            const shortcutSideChatReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 40; i++) { if (document.querySelector('.coding-pane-tab-strip.is-split-open') && document.querySelector('.coding-side-chat')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
            if (!shortcutSideChatReady) throw new Error("Ctrl+T did not open the project-scoped Side chat split.");
            await cdp.evaluate(`(() => { const trigger = document.querySelector('button[aria-label="Add a page to the split view"]'); trigger?.click(); return Boolean(trigger); })()`);
            const shortcutCloseSplitChoice = await cdp.evaluate(`(async () => { for (let i = 0; i < 20; i++) { const choice = [...document.querySelectorAll('.overflow-menu-panel [role="menuitem"]')].find((item) => item.textContent?.trim() === 'Close split view'); if (choice) { choice.click(); return true; } await new Promise((r) => setTimeout(r, 25)); } return false; })()`);
            if (!shortcutCloseSplitChoice) throw new Error("The split page menu did not expose Close split view after the Ctrl+T workflow.");
            const shortcutSplitClosed = await cdp.evaluate(`(async () => { for (let i = 0; i < 40; i++) { if (document.querySelector('.coding-split-launcher button[aria-label="Add to split"]')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
            if (!shortcutSplitClosed) throw new Error("Closing the Ctrl+T Side chat split did not restore the single-pane coding workspace.");
            const splitLauncher = await cdp.evaluate(`document.querySelector('.coding-split-launcher button[aria-label="Add to split"]')?.click(); true`);
            const sideChatChoice = await cdp.evaluate(`(async () => { for (let i = 0; i < 20; i++) { const choice = [...document.querySelectorAll('.overflow-menu-panel [role="menuitem"]')].find((item) => item.textContent.trim() === 'Side chat'); if (choice) { choice.click(); return true; } await new Promise((r) => setTimeout(r, 25)); } return false; })()`);
            if (!splitLauncher || !sideChatChoice) throw new Error("Could not add Side chat from the optional split control.");
            const splitReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 40; i++) { if (document.querySelector('.coding-pane-tab-strip.is-split-open .workspace-tab-select')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
            if (!splitReady) throw new Error("Adding Side chat did not open the second pane.");
            const chooseLayout = async (label) => {
              const opened = await cdp.evaluate(`(() => { const buttons = [...document.querySelectorAll('button[aria-label="Workspace layout"]')]; buttons.at(-1)?.click(); return buttons.length > 0; })()`);
              const selected = await cdp.evaluate(`(async (expected) => { for (let i = 0; i < 30; i++) { const choice = [...document.querySelectorAll('.overflow-menu-panel [role="menuitem"]')].find((item) => item.textContent?.trim() === expected); if (choice) { choice.click(); return true; } await new Promise((r) => setTimeout(r, 25)); } return false; })(${JSON.stringify(label)})`);
              if (!opened || !selected) throw new Error(`Could not apply the ${label} workspace preset.`);
              await new Promise((resolve) => setTimeout(resolve, 120));
            };
            await chooseLayout("Chat + files");
            const filesPreset = await cdp.evaluate(`(() => ({ split: document.querySelector('.coding-session-grid')?.classList.contains('is-split-open'), tabs: [...document.querySelectorAll('.coding-secondary-tab-group .workspace-tab-select')].map((item) => item.textContent?.trim()) }))()`);
            if (!filesPreset.split || !filesPreset.tabs.some((label) => label === 'Side chat') || !filesPreset.tabs.some((label) => label.startsWith('Files & Changes'))) throw new Error(`Chat + files preset did not restore the expected pages: ${JSON.stringify(filesPreset)}`);
            await chooseLayout("Chat + terminal");
            const terminalPreset = await cdp.evaluate(`(() => ({ split: document.querySelector('.coding-session-grid')?.classList.contains('is-split-open'), editor: [...document.querySelectorAll('.coding-secondary-tab-group .workspace-tab-select')].some((item) => item.textContent?.trim() === 'Editor'), terminal: Boolean(document.querySelector('.project-dock')) }))()`);
            if (!terminalPreset.split || !terminalPreset.editor || !terminalPreset.terminal) throw new Error(`Chat + terminal preset did not open a bounded terminal pane: ${JSON.stringify(terminalPreset)}`);
            await chooseLayout("Review changes");
            const reviewPreset = await cdp.evaluate(`(() => ({ split: document.querySelector('.coding-session-grid')?.classList.contains('is-split-open'), changes: [...document.querySelectorAll('.coding-secondary-tab-group .workspace-tab-select')].some((item) => item.textContent?.trim().startsWith('Files & Changes')) }))()`);
            if (!reviewPreset.split || !reviewPreset.changes) throw new Error(`Review changes preset did not expose the Changes page: ${JSON.stringify(reviewPreset)}`);
            const splitterStart = await cdp.evaluate(`(() => { const splitter = document.querySelector('.coding-split-resizer'); if (!splitter) return null; const start = Number(splitter.getAttribute('aria-valuenow')); splitter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); return { start, projectId: document.querySelector('.coding-project-heading-actions select')?.value ?? '' }; })()`);
            const splitterAdjusted = splitterStart && await cdp.evaluate(`(async (start, projectId) => { for (let i = 0; i < 40; i++) { const splitter = document.querySelector('.coding-split-resizer'); const value = Number(splitter?.getAttribute('aria-valuenow')); const saved = Number(localStorage.getItem('skai.coding.threadPanePercent.' + projectId)); if (value !== start && saved === value) { splitter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); return { adjusted: true, value, saved }; } await new Promise((r) => setTimeout(r, 25)); } return { adjusted: false, value: Number(document.querySelector('.coding-split-resizer')?.getAttribute('aria-valuenow')) }; })(${splitterStart.start}, ${JSON.stringify(splitterStart.projectId)})`);
            if (!splitterAdjusted?.adjusted) throw new Error(`The split divider did not resize and persist its per-project width: ${JSON.stringify({ splitterStart, splitterAdjusted })}`);
            const panelTabs = await cdp.evaluate(`([...document.querySelectorAll('.coding-secondary-tab-group .workspace-tab-select')].map((button) => button.textContent?.trim()))`);
            if (!['Editor', 'Files & Changes', 'Side chat'].every((tab) => panelTabs.some((label) => label.startsWith(tab))) || panelTabs.some((label) => label === 'Files' || label === 'Changes')) throw new Error(`The split should expose one project-scoped Files & Changes page beside Side chat and Editor: ${JSON.stringify(panelTabs)}`);
            const pageGroups = await cdp.evaluate(`(() => { const shell = document.querySelector('.workspace-tabs-hotkeys.is-coding-split'); const main = shell?.querySelector(':scope > .workspace-tab-strip')?.getBoundingClientRect(); const side = shell?.querySelector(':scope > .coding-secondary-tab-group')?.getBoundingClientRect(); const rect = (value) => value && ({ x: value.x, y: value.y, width: value.width, height: value.height, right: value.right }); return { shellClass: shell?.className, display: shell && getComputedStyle(shell).display, columns: shell && getComputedStyle(shell).gridTemplateColumns, main: rect(main), side: rect(side), sideTabs: shell?.querySelectorAll('.coding-secondary-tab-group .workspace-tab').length ?? 0 }; })()`);
            const pageGroupMinimum = compactCodingPanels ? 95 : 250;
            const pageGroupsReady = pageGroups.main && pageGroups.side && pageGroups.main.width > pageGroupMinimum && pageGroups.side.width > pageGroupMinimum && Math.abs(pageGroups.main.y - pageGroups.side.y) < 2 && pageGroups.main.right <= pageGroups.side.x + 2;
            if (!pageGroupsReady) throw new Error(`The main thread and right workspace pages are not managed as two aligned tab groups: ${JSON.stringify(pageGroups)}`);
            const tabActions = await cdp.evaluate(`(async () => {
              const list = document.querySelector('.workspace-tabs-hotkeys > .workspace-tab-strip .workspace-tab-list');
              const tabs = () => [...(list?.querySelectorAll(':scope > .workspace-tab') ?? [])];
              const before = tabs().map((tab) => tab.dataset.workspaceTabId);
              if (!list || before.length < 2 || before.some((id) => !id)) return { ok: false, reason: 'Expected at least two addressable workspace tabs.' };
              const drag = (sourceId, targetId) => {
                const source = tabs().find((tab) => tab.dataset.workspaceTabId === sourceId);
                const target = tabs().find((tab) => tab.dataset.workspaceTabId === targetId);
                const data = new DataTransfer();
                source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: data }));
                target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data }));
                target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
              };
              drag(before[0], before[1]);
              await new Promise((resolve) => setTimeout(resolve, 20));
              const moved = tabs().map((tab) => tab.dataset.workspaceTabId);
              const reorderWorked = moved[0] === before[1] && moved[1] === before[0];
              drag(before[0], before[1]);
              await new Promise((resolve) => setTimeout(resolve, 20));
              const restoredOrder = tabs().map((tab) => tab.dataset.workspaceTabId);
              const menuTab = tabs().find((tab) => tab.classList.contains('is-active'));
              menuTab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 120 }));
              await new Promise((resolve) => setTimeout(resolve, 20));
              const menu = document.querySelector('.workspace-tab-context-menu');
              const menuWorked = Boolean(menu?.querySelector('[role="menuitem"]') && [...menu.querySelectorAll('[role="menuitem"]')].some((item) => item.textContent.includes('Close other tabs')));
              window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
              const activeBefore = tabs().findIndex((tab) => tab.classList.contains('is-active'));
              window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, bubbles: true }));
              await new Promise((resolve) => setTimeout(resolve, 20));
              const switched = tabs().findIndex((tab) => tab.classList.contains('is-active')) !== activeBefore;
              window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, shiftKey: true, bubbles: true }));
              await new Promise((resolve) => setTimeout(resolve, 20));
              return { ok: reorderWorked && before.join('|') === restoredOrder.join('|') && menuWorked && switched, reorderWorked, orderRestored: before.join('|') === restoredOrder.join('|'), menuWorked, switched };
            })()`);
            if (!tabActions.ok) throw new Error(`Workspace tabs did not behave like a desktop tab bar: ${JSON.stringify(tabActions)}`);
            const assertMainChat = async (mode) => {
              const state = await cdp.evaluate(`(() => ({ visible: Boolean(document.querySelector('.project-thread-panel:not([hidden]) .chat-page.is-coding-agent')), thread: document.querySelector('.project-thread-panel:not([hidden])')?.innerText?.slice(0, 180) ?? '' }))()`);
              if (!state.visible) throw new Error(`Main coding chat was hidden after switching to ${mode}: ${JSON.stringify(state)}`);
            };
            const capturePanel = async (name) => {
              if (process.env.UI_MATRIX_CAPTURE !== "1") return;
              fs.mkdirSync(captureDirectory, { recursive: true });
              const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
              fs.writeFileSync(path.join(captureDirectory, `coding-panel-${name}-${width}.png`), Buffer.from(screenshot.data, "base64"));
            };
            const selectPanel = async (label) => {
              const selected = await cdp.evaluateWith(function (expected) { const button = [...document.querySelectorAll('.coding-secondary-tab-group .workspace-tab-select')].find((item) => item.textContent?.trim().startsWith(expected)); if (!button) return false; button.click(); return true; }, label);
              if (!selected) throw new Error(`Could not find the ${label} workspace page.`);
              const active = await cdp.evaluate(`(async (expected) => { for (let i = 0; i < 40; i++) { const tab = [...document.querySelectorAll('.coding-secondary-tab-group .workspace-tab')].find((item) => item.querySelector('.workspace-tab-select')?.textContent?.trim().startsWith(expected)); if (tab?.classList.contains('is-active')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })(${JSON.stringify(label)})`);
              if (!active) throw new Error(`${label} panel did not become active: ${JSON.stringify(await cdp.evaluate(`(() => [...document.querySelectorAll('.coding-secondary-tab-group .workspace-tab')].map((tab) => ({ label: tab.querySelector('.workspace-tab-select')?.textContent?.trim(), active: tab.classList.contains('is-active') })))()`))}`);
              await assertMainChat(label);
            };
            const addPanel = async (label) => {
              const opened = await cdp.evaluate(`document.querySelector('.coding-pane-tab-strip button[aria-label="Add a page to the split view"]')?.click(), true`);
              const selected = await cdp.evaluate(`(async (expected) => { for (let i = 0; i < 30; i++) { const choice = [...document.querySelectorAll('.overflow-menu-panel [role="menuitem"]')].find((item) => item.textContent?.trim() === expected); if (choice) { choice.click(); return true; } await new Promise((r) => setTimeout(r, 25)); } return false; })(${JSON.stringify(label)})`);
              if (!opened || !selected) throw new Error(`Could not add the ${label} workspace page.`);
              await selectPanel(label);
            };
            await selectPanel("Editor");
            if (exerciseFocusLayout && width === 1440 && height === 900) {
              await addPanel("Scratchpad");
              const scratchpadReady = await cdp.evaluate(`Boolean(document.querySelector('.coding-project-browser.is-scratchpad-panel #coding-project-scratchpad textarea'))`);
              if (!scratchpadReady) throw new Error("Scratchpad did not open as its own workspace page.");
              console.log("[coding-focus-layout] scratchpad page ready");
              await addPanel("Preview");
              const previewReady = await cdp.evaluate(`Boolean(document.querySelector('.coding-project-browser.is-preview-panel #coding-local-preview .skai-browser-preview'))`);
              if (!previewReady) throw new Error("Local Preview did not open as its own workspace page.");
              console.log("[coding-focus-layout] preview page ready");
              await selectPanel("Editor");
              const focusToggle = await cdp.evaluateWith(function () { const root = document.querySelector('.coding-project-browser.is-editor-panel'); const button = [...(root?.querySelectorAll('button') ?? [])].find((item) => item.textContent?.trim() === 'Focus layout'); if (!button) return false; button.click(); return true; });
              const focusedState = await cdp.evaluate(`(() => { const composer = document.querySelector('.project-thread-panel .composer-card')?.getBoundingClientRect(); const emptyEditor = document.querySelector('.coding-editor-empty-state')?.getBoundingClientRect(); return { active: document.querySelector('.coding-session-grid')?.classList.contains('is-focus-layout'), metadata: getComputedStyle(document.querySelector('.coding-project-context')).display, projectHeading: getComputedStyle(document.querySelector('.coding-project-heading')).display, projectOverview: getComputedStyle(document.querySelector('.coding-project-overview')).display, contextStrip: getComputedStyle(document.querySelector('.coding-context-strip')).display, harnessCatalog: getComputedStyle(document.querySelector('.coding-harness-adapters')).display, tree: getComputedStyle(document.querySelector('.coding-project-browser .project-file-explorer')).display, activePanel: document.querySelector('.coding-project-browser')?.className, emptyEditorHeight: emptyEditor?.height ?? null, composerTop: composer?.top ?? null, composerBottom: composer?.bottom ?? null, viewportHeight: innerHeight, composerReachable: Boolean(composer && composer.top >= 0 && composer.bottom <= innerHeight) }; })()`);
              if (!focusToggle || !focusedState.active || focusedState.metadata !== 'none' || focusedState.projectHeading !== 'none' || focusedState.projectOverview !== 'none' || focusedState.contextStrip !== 'none' || focusedState.harnessCatalog !== 'none' || focusedState.tree !== 'none' || !focusedState.activePanel?.includes('is-editor-panel') || !focusedState.composerReachable || focusedState.emptyEditorHeight > 220) throw new Error(`Focus layout did not hide secondary UI, compact the empty editor, and keep the active composer in the viewport: ${JSON.stringify(focusedState)}`);
              if (process.env.UI_MATRIX_CAPTURE === "1") {
                fs.mkdirSync(captureDirectory, { recursive: true });
                const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
                fs.writeFileSync(path.join(captureDirectory, "coding-focus-layout-1440.png"), Buffer.from(screenshot.data, "base64"));
              }
              await clickButtonText(cdp, "Exit focus", ".coding-project-browser.is-editor-panel");
              const restoredState = await cdp.evaluate(`(() => ({ active: document.querySelector('.coding-session-grid')?.classList.contains('is-focus-layout'), metadata: getComputedStyle(document.querySelector('.coding-project-context')).display, tree: getComputedStyle(document.querySelector('.coding-project-browser .project-file-explorer')).display, scratchpadTab: [...document.querySelectorAll('.coding-secondary-tab-group .workspace-tab-select')].some((button) => button.textContent?.trim() === 'Scratchpad'), previewTab: [...document.querySelectorAll('.coding-secondary-tab-group .workspace-tab-select')].some((button) => button.textContent?.trim() === 'Preview') }))()`);
              if (restoredState.active || restoredState.metadata === 'none' || restoredState.tree === 'none' || !restoredState.scratchpadTab || !restoredState.previewTab) throw new Error(`Exiting focus layout did not restore the workspace pages: ${JSON.stringify(restoredState)}`);
              console.log(`[coding-focus-layout] ${JSON.stringify({ focusedState, restoredState })}`);
            }
            if (exerciseFocusLayout) continue;
            const editorExplorerReady = await cdp.evaluate(`Boolean(document.querySelector('.coding-project-browser.is-editor-panel .project-file-layout .project-file-explorer') && document.querySelector('.coding-project-browser.is-editor-panel .coding-explorer-project-files'))`);
            if (!editorExplorerReady) throw new Error("Editor did not show the project file tree on its right side.");
            await capturePanel("editor-with-files");
            await selectPanel("Side chat");
            const sideChatReady = await cdp.evaluate(`Boolean(document.querySelector('.coding-side-chat') && document.querySelector('.coding-side-chat textarea[aria-label="Message the Coding side chat"]'))`);
            if (!sideChatReady) throw new Error("Side chat did not open its project-scoped subagent composer.");
            await cdp.evaluate(`(() => { const field = document.querySelector('.coding-side-chat textarea'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(field, 'Review the project architecture'); field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true })); return field.value; })()`);
            const sideDraftWorks = await cdp.evaluate(`document.querySelector('.coding-side-chat textarea')?.value === 'Review the project architecture' && !document.querySelector('.coding-side-chat button[type="submit"]')?.disabled`);
            if (!sideDraftWorks) throw new Error("Side chat did not accept a focused subagent instruction.");
            await capturePanel("side-chat");
            if (exerciseSideChat && width === 1440 && height === 900) {
              console.log("[coding-side-chat] exercising isolated model-backed subagent split");
              await sideChatServerReady;
              const sideChatConfigured = await cdp.evaluateWith(async function (endpoint) {
                const request = (method, params) => window.skaiAgent.request(method, params);
                const settings = await request("settings.save", { provider: "Local API", endpoint, model: "revision4-sidechat-fixture" });
                if (!settings.ok) return { error: settings.error?.message ?? "Could not configure isolated Side chat fixture." };
                return { ok: true };
              }, sideChatEndpoint);
              if (sideChatConfigured?.error || !sideChatConfigured?.ok) throw new Error(`Could not configure isolated Side chat execution: ${sideChatConfigured?.error ?? JSON.stringify(sideChatConfigured)}`);
              await cdp.send("Page.reload", { ignoreCache: true });
              const codingReadyAfterReload = await cdp.evaluate(`(async () => { for (let i = 0; i < 120; i++) { if (window.skaiAgent && document.querySelector('.coding-side-chat textarea[aria-label="Message the Coding side chat"]') && document.querySelector('.project-thread-panel .chat-page.is-coding-agent')) return true; await new Promise((resolve) => setTimeout(resolve, 100)); } return false; })()`);
              if (!codingReadyAfterReload) throw new Error("Coding workspace did not restore the Side chat and main thread after loading the isolated fixture model settings.");
              await cdp.evaluate(`(() => { const sideChatTab = [...document.querySelectorAll('.coding-secondary-tab-group .workspace-tab-select')].find((button) => button.textContent?.trim().startsWith('Side chat')); sideChatTab?.click(); const field = document.querySelector('.coding-side-chat textarea[aria-label="Message the Coding side chat"]'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(field, 'Inspect README.md and report what the starter project is for.'); field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true })); return Boolean(field); })()`);
              const actualSideChatDraft = await cdp.evaluate(`document.querySelector('.coding-side-chat textarea')?.value === 'Inspect README.md and report what the starter project is for.' && !document.querySelector('.coding-side-chat button[type="submit"]')?.disabled`);
              if (!actualSideChatDraft) throw new Error("Side chat could not prepare the model-backed workflow after loading the isolated fixture settings.");
              await clickButtonText(cdp, "Send task", ".coding-side-chat");
              const sideTask = await cdp.evaluate(`(async () => { for (let i = 0; i < 80; i++) { const response = await window.skaiAgent.request('tasks.list'); const task = response.ok ? response.result.find((item) => item.title === 'Side chat · Inspect README.md and report what the starter project is for.') : null; if (task && task.status !== 'draft') return { id: task.id, status: task.status }; await new Promise((resolve) => setTimeout(resolve, 100)); } const response = await window.skaiAgent.request('tasks.list'); const settings = await window.skaiAgent.request('settings.get'); return { error: true, tasks: response.ok ? response.result.map((item) => ({ title: item.title, status: item.status, error: item.resultSummary })) : response, settings: settings.ok ? settings.result : settings, panel: document.querySelector('.coding-side-chat')?.innerText, draft: document.querySelector('.coding-side-chat textarea')?.value, composer: document.querySelector('.project-thread-panel .chat-composer')?.innerText ?? null, alerts: [...document.querySelectorAll('[role="alert"]')].map((item) => item.innerText) }; })()`);
              if (sideTask?.error || !sideTask?.id) throw new Error(`Submitting the Side chat composer did not create and queue its project-scoped task: ${JSON.stringify(sideTask)}`);
              const completedSideTask = await cdp.evaluateWith(async function (taskId) {
                for (let i = 0; i < 200; i++) {
                  const response = await window.skaiAgent.request("tasks.list");
                  const task = response.ok ? response.result.find((item) => item.id === taskId) : null;
                  if (task && ["completed", "failed", "blocked", "cancelled"].includes(task.status)) return task;
                  await new Promise((resolve) => setTimeout(resolve, 100));
                }
                return null;
              }, sideTask.id);
              if (completedSideTask?.status !== "completed" || !completedSideTask.resultSummary?.includes("inspected README.md successfully")) throw new Error(`The isolated Side chat task did not complete with its model result: ${JSON.stringify(completedSideTask)}`);
              if (sideChatRequests !== 2 || sideChatServerProblem) throw new Error(`The isolated Side chat fixture did not complete the read-then-summary workflow: ${JSON.stringify({ requests: sideChatRequests, problem: sideChatServerProblem })}`);
              const sideTaskState = await cdp.evaluateWith(async function (summary, taskId) {
                for (let i = 0; i < 40; i++) {
                  const panel = document.querySelector('.coding-side-chat');
                  const mainThread = document.querySelector('.project-thread-panel .chat-page.is-coding-agent');
                  if (panel?.innerText.toLowerCase().includes("completed") && panel.innerText.includes(summary) && mainThread?.innerText.includes("Review this project structure")) { const mainRect = mainThread.getBoundingClientRect(); const sideRect = panel.getBoundingClientRect(); return { visible: true, mainX: mainRect.left, mainWidth: mainRect.width, sideX: sideRect.left, sideWidth: sideRect.width, overview: getComputedStyle(document.querySelector('.coding-project-overview')).display, projectHeading: getComputedStyle(document.querySelector('.coding-project-heading')).display, projectContext: getComputedStyle(document.querySelector('.coding-project-context')).display, contextStrip: getComputedStyle(document.querySelector('.coding-context-strip')).display, harness: getComputedStyle(document.querySelector('.coding-harness-adapters')).display, split: document.querySelector('.coding-session-grid')?.classList.contains('is-split-open') }; }
                  await new Promise((resolve) => setTimeout(resolve, 100));
                }
                const response = await window.skaiAgent.request("tasks.list");
                return { visible: false, projectId: document.querySelector('.coding-project-heading-actions select')?.value, panel: document.querySelector('.coding-side-chat')?.innerText ?? null, mainThreadFound: Boolean(document.querySelector('.project-thread-panel .chat-page.is-coding-agent')), mainThread: document.querySelector('.project-thread-panel .chat-page.is-coding-agent')?.innerText?.slice(0, 240) ?? null, task: response.ok ? response.result.find((item) => item.id === taskId) ?? null : response };
              }, completedSideTask.resultSummary, sideTask.id);
              if (!sideTaskState?.visible || sideTaskState.overview !== "none" || !sideTaskState.split) throw new Error(`The completed Side chat result did not appear in the Codex-style split beside the still-visible main Coding Agent thread: ${JSON.stringify(sideTaskState)}`);
              if (width >= 761 && (sideTaskState.mainX >= sideTaskState.sideX || sideTaskState.mainWidth < 300 || sideTaskState.sideWidth < 300)) throw new Error(`The main Coding Agent thread and subagent must occupy usable left and right panes: ${JSON.stringify(sideTaskState)}`);
              if (sideTaskState.projectHeading !== "none" || sideTaskState.projectContext !== "none" || sideTaskState.contextStrip !== "none" || sideTaskState.harness !== "none") throw new Error(`Side chat split retained secondary project chrome: ${JSON.stringify(sideTaskState)}`);
              await capturePanel("side-chat");
              console.log(`[coding-side-chat] ${JSON.stringify({ status: completedSideTask.status, requests: sideChatRequests, changedFiles: completedSideTask.changedFiles, summary: completedSideTask.resultSummary })}`);
            }
            if (exerciseSideChat) continue;
            await selectPanel("Editor");
            const readmeButton = await cdp.evaluate(`([...document.querySelectorAll('.coding-project-browser.is-editor-panel .project-file-item')].find((button) => button.innerText.includes('README.md'))?.getAttribute('title') ?? null)`);
            if (!readmeButton) throw new Error("The inline project file tree did not show the seeded README.md.");
            await cdp.evaluateWith(function (fileName) { [...document.querySelectorAll('.coding-project-browser.is-editor-panel .project-file-item')].find((item) => item.title === fileName)?.click(); return 1; }, readmeButton);
            const monacoReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 100; i++) { if (document.querySelector('.coding-project-browser.is-editor-panel .monaco-editor') && document.querySelector('.coding-project-browser.is-editor-panel .file-editor-heading')?.innerText.includes('README.md') && document.querySelector('.coding-project-browser.is-editor-panel .project-file-explorer')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
            if (!monacoReady) throw new Error("Selecting a project file did not open Monaco beside the file tree in the Editor pane.");
            const markdownPreviewButton = await cdp.evaluate(`([...document.querySelectorAll('.coding-project-browser.is-editor-panel .file-editor-heading button')].find((button) => button.textContent?.trim() === 'Preview')?.click(), Boolean([...document.querySelectorAll('.coding-project-browser.is-editor-panel .file-editor-heading button')].find((button) => button.textContent?.trim() === 'Preview')))`);
            if (!markdownPreviewButton) throw new Error("The Markdown editor did not expose its source/preview toggle.");
            const markdownPreviewReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 40; i++) { const preview = document.querySelector('.coding-project-browser.is-editor-panel .markdown-document-preview'); if (preview && (preview.querySelector('h1,h2,h3') || preview.textContent.trim())) return { ready: true, hasUnsafeHtml: Boolean(preview.querySelector('script,iframe,object')) }; await new Promise((r) => setTimeout(r, 50)); } return { ready: false }; })()`);
            if (!markdownPreviewReady.ready || markdownPreviewReady.hasUnsafeHtml) throw new Error(`The Markdown preview was missing content or rendered unsafe HTML: ${JSON.stringify(markdownPreviewReady)}`);
            await capturePanel("markdown-preview");
            await cdp.evaluate(`([...document.querySelectorAll('.coding-project-browser.is-editor-panel .file-editor-heading button')].find((button) => button.textContent?.trim() === 'Editor')?.click(), true)`);
            const markdownSourceRestored = await cdp.evaluate(`Boolean(document.querySelector('.coding-project-browser.is-editor-panel .monaco-editor'))`);
            if (!markdownSourceRestored) throw new Error("Returning from Markdown preview did not restore its editable source.");
            const hideFiles = await cdp.evaluate(`Boolean(document.querySelector('.coding-project-browser.is-editor-panel button[aria-label="Hide file explorer"]'))`);
            if (!hideFiles) throw new Error("The editor did not expose a hide control for the file tree.");
            await cdp.evaluate(`document.querySelector('.coding-project-browser.is-editor-panel button[aria-label="Hide file explorer"]')?.click()`);
            const filesHidden = await cdp.evaluate(`document.querySelector('.coding-project-browser.is-editor-panel')?.classList.contains('is-file-explorer-hidden') && !document.querySelector('.coding-project-browser.is-editor-panel .project-file-explorer')`);
            if (!filesHidden) throw new Error("Hiding the file explorer did not expand the editor pane.");
            await cdp.evaluate(`document.querySelector('.coding-project-browser.is-editor-panel button[aria-label="Show file explorer"]')?.click()`);
            const filesRestored = await cdp.evaluate(`(async () => { for (let i = 0; i < 30; i++) { const panel = document.querySelector('.coding-project-browser.is-editor-panel'); if (panel && !panel.classList.contains('is-file-explorer-hidden') && getComputedStyle(panel.querySelector('.project-file-explorer')).display !== 'none') return true; await new Promise((r) => setTimeout(r, 40)); } return false; })()`);
            if (!filesRestored) throw new Error("The file explorer could not be restored after hiding it.");
            await assertMainChat("Editor with Monaco and file tree");
            await capturePanel("monaco-with-files");
            await selectPanel("Files");
            const standaloneFilesReady = await cdp.evaluate(`Boolean(document.querySelector('.coding-project-browser.is-files-panel .is-standalone-files-page .coding-explorer-project-files'))`);
            if (!standaloneFilesReady) throw new Error("Files did not open as its own right-pane page.");
            await assertMainChat("Files");
            await capturePanel("files");
            await selectPanel("Changes");
            const changesReady = await cdp.evaluate(`Boolean(document.querySelector('.coding-project-browser.is-changes-panel h3')?.textContent === 'Changes' && (document.querySelector('.coding-project-browser.is-changes-panel .git-change-summary') || document.querySelector('.coding-project-browser.is-changes-panel [role="alert"]') || document.querySelector('.coding-project-browser.is-changes-panel [role="status"]') || document.querySelector('.coding-project-browser.is-changes-panel .coding-change-empty')))`);
            if (!changesReady) throw new Error("Changes panel did not show Git review status alongside the main chat.");
            await capturePanel("changes");
            const closeChanges = await cdp.evaluate(`Boolean(document.querySelector('.coding-secondary-tab-group .workspace-tab-close[aria-label="Close Changes"]'))`);
            if (!closeChanges) throw new Error("The Changes page was missing its close control.");
            await cdp.evaluate(`document.querySelector('.coding-secondary-tab-group .workspace-tab-close[aria-label="Close Changes"]')?.click()`);
            const changesClosed = await cdp.evaluate(`![...document.querySelectorAll('.coding-secondary-tab-group .workspace-tab-select')].some((button) => button.textContent?.trim().startsWith('Changes'))`);
            if (!changesClosed) throw new Error("Closing a right-side Changes page did not remove it from that tab group.");
            await cdp.evaluate(`document.querySelector('.coding-pane-tab-strip button[aria-label="Add a page to the split view"]')?.click()`);
            await cdp.evaluate(`([...document.querySelectorAll('.overflow-menu-item')].find((item) => item.textContent?.trim() === 'Changes')?.click(), 1)`);
            const changesReopened = await cdp.evaluate(`(async () => { for (let i = 0; i < 40; i++) { if ([...document.querySelectorAll('.coding-secondary-tab-group .workspace-tab-select')].some((button) => button.textContent?.trim().startsWith('Changes'))) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
            if (!changesReopened) throw new Error("The right-pane page menu did not reopen a closed Changes page.");
            await selectPanel("Editor");
            await cdp.evaluate(`document.querySelector('.coding-pane-tab-strip button[aria-label="Add a page to the split view"]')?.click()`);
            const closeSplitChoice = await cdp.evaluate(`(async () => { for (let i = 0; i < 20; i++) { const choice = [...document.querySelectorAll('.overflow-menu-panel [role="menuitem"]')].find((item) => item.textContent.trim() === 'Close split view'); if (choice) { choice.click(); return true; } await new Promise((r) => setTimeout(r, 25)); } return false; })()`);
            if (!closeSplitChoice) throw new Error("The split view could not be closed from its page menu.");
            const splitClosed = await cdp.evaluate(`(async () => { for (let i = 0; i < 40; i++) { const grid = document.querySelector('.coding-session-grid.is-chat'); if (grid && !grid.classList.contains('is-split-open') && getComputedStyle(document.querySelector('.coding-project-browser')).display === 'none' && document.querySelector('.coding-split-launcher button[aria-label="Add to split"]')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
            if (!splitClosed) throw new Error("Closing split view did not restore the full-width main chat.");
            await capturePanel("single-chat");
            await cdp.evaluate(`document.querySelector('.sidebar-project-new-thread')?.click(); true`);
            const projectThreadCreated = await cdp.evaluate(`(async () => { for (let i = 0; i < 60; i++) { const active = document.querySelector('.workspace-tab.is-active .workspace-tab-select')?.textContent?.trim(); const project = document.querySelector('.coding-project-heading strong')?.textContent?.trim(); if (project && (active === 'New coding thread' || active === project)) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
            if (!projectThreadCreated) throw new Error("The project New thread action did not open a new coding workspace tab.");
          }
          if (exerciseTaskProgress) {
            await taskProgressServerReady;
            const planned = await cdp.evaluateWith(async function (endpoint) { const request = (method, params) => window.skaiAgent.request(method, params); const projectId = document.querySelector('.coding-project-heading-actions select')?.value; if (!projectId) return { error: 'No active project ID.' }; const settings = await request('settings.save', { provider: 'Local API', endpoint, model: 'revision4-progress-fixture' }); if (!settings.ok) return { error: settings.error?.message ?? 'Could not configure isolated fixture model.' }; const task = await request('tasks.plan', { title: 'Update garden layout code', instruction: 'Review the garden layout files, make a focused update to each of the four source files, then pause before verification so the changes can be reviewed.', projectId, model: 'revision4-progress-fixture', modelProvider: 'Local API', modelSizeBytes: 1, modelContextLength: 4096, requiresApproval: false }); if (!task.ok) return { error: task.error?.message ?? 'Could not create project task.' }; const queued = await request('tasks.queue', { id: task.result.id }); if (!queued.ok) return { error: queued.error?.message ?? 'Could not queue project task.' }; const execution = await request('tasks.execute', { id: task.result.id }); if (!execution.ok) return { error: execution.error?.message ?? 'Could not start project task.' }; return { id: task.result.id, status: execution.result?.status }; }, taskProgressEndpoint);
            if (planned?.error || !planned?.id) throw new Error(`Could not start the isolated task progress workflow: ${planned?.error ?? JSON.stringify(planned)}`);
            taskProgressTaskId = planned.id;
            const pausedAtReview = await Promise.race([taskProgressPaused.then(() => true), sleep(10_000).then(() => false)]);
            if (!pausedAtReview) {
              const currentTasks = await cdp.evaluate(`(async () => { const response = await window.skaiAgent.request('tasks.list'); return response.ok ? response.result : response; })()`);
              throw new Error(`The local Coding Agent did not reach the review pause after writing four files (${taskProgressRequests} model calls; ${taskProgressServerProblem || "no server protocol error"}): ${JSON.stringify(currentTasks)}`);
            }
            const liveTask = await cdp.evaluateWith(async function (taskId) { const response = await window.skaiAgent.request('tasks.list'); return response.ok ? response.result.find((item) => item.id === taskId) : null; }, taskProgressTaskId);
            const expectedChangedFiles = ["src/layout.ts", "src/plant.ts", "src/styles.css", "src/utils.ts"];
            if (liveTask?.status !== "running" || expectedChangedFiles.some((file) => !liveTask.changedFiles?.includes(file)) || liveTask.activity?.filter((item) => item.type === "tool.write_file.completed").length !== 4) throw new Error(`The local task did not produce the expected running review state: ${JSON.stringify({ status: liveTask?.status, changedFiles: liveTask?.changedFiles, writeEvents: liveTask?.activity?.filter((item) => item.type === "tool.write_file.completed").length })}`);
            await clickInRenderer(cdp, 'button[aria-label="Project actions"]');
            await cdp.evaluate(`([...document.querySelectorAll('.overflow-menu-item')].find((item) => item.textContent?.includes('Refresh Git status'))?.click(), 1)`);
            const gitRefreshed = await cdp.evaluate(`(async () => { for (let i = 0; i < 80; i++) { if (document.querySelector('.coding-project-context .git-summary')?.innerText.includes('4 changes')) return true; await new Promise((r) => setTimeout(r, 100)); } return false; })()`);
            if (!gitRefreshed) throw new Error("The four agent-written files did not appear in the selected project's Git status.");
            await clickInRenderer(cdp, 'button[aria-label="Project actions"]');
            await cdp.evaluate(`([...document.querySelectorAll('.overflow-menu-item')].find((item) => item.textContent?.includes('Open activity'))?.click(), 1)`);
            const taskActivityVisible = await cdp.evaluate(`(async () => { for (let i = 0; i < 80; i++) { if (document.querySelector('.coding-task-drawer .coding-task-item')?.innerText.includes('Update garden layout code')) return true; await new Promise((r) => setTimeout(r, 100)); } return false; })()`);
            if (!taskActivityVisible) throw new Error("The active project task did not appear in the Coding Activity drawer.");
            await cdp.evaluate(`([...document.querySelectorAll('.coding-task-delegation summary')].find((item) => item.textContent?.includes('Delegate specialist work'))?.click(), 1)`);
            const delegationReady = await cdp.evaluate(`Boolean(document.querySelector('.coding-task-delegation form .coding-task-delegation-worker'))`);
            if (!delegationReady) throw new Error("A running manager task did not expose the specialist delegation form.");
            await cdp.evaluate(`(() => { const set = (element, value) => { const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); }; const first = document.querySelector('.coding-task-delegation-worker'); const fields = first.querySelectorAll('select,input,textarea'); set(fields[0], 'reviewer'); set(fields[2], 'Review API boundaries'); set(fields[3], 'Inspect API boundaries and report concrete risks without changing files.'); [...document.querySelectorAll('.coding-task-delegation-actions button')].find((button) => button.textContent?.includes('Add specialist'))?.click(); return true; })()`);
            const secondSpecialistReady = await cdp.evaluate(`document.querySelectorAll('.coding-task-delegation-worker').length === 2`);
            if (!secondSpecialistReady) throw new Error("The delegation form could not add a second specialist.");
            await cdp.evaluate(`(() => { const set = (element, value) => { const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); }; const second = document.querySelectorAll('.coding-task-delegation-worker')[1]; const fields = second.querySelectorAll('select,input,textarea'); set(fields[0], 'verifier'); set(fields[2], 'Verify layout checks'); set(fields[3], 'Inspect the available layout checks and report the best validation sequence.'); [...document.querySelectorAll('.coding-task-delegation-actions button')].find((button) => button.textContent?.includes('Create specialist tasks'))?.click(); return true; })()`);
            const specialistTreeReady = await cdp.evaluateWith(async function (parentId) { for (let i = 0; i < 80; i++) { const response = await window.skaiAgent.request('tasks.list'); const children = response.ok ? response.result.filter((task) => task.parentRunId === parentId) : []; if (children.length === 2 && children.every((task) => task.status === 'proposed') && children.some((task) => task.role === 'reviewer') && children.some((task) => task.role === 'verifier')) return true; await new Promise((r) => setTimeout(r, 100)); } return false; }, taskProgressTaskId);
            if (!specialistTreeReady) throw new Error("Delegation did not persist two proposed specialist tasks under the active parent.");
            await cdp.evaluate(`(() => { const summary = [...document.querySelectorAll('.coding-task-files summary')].find((item) => item.textContent?.includes('4 changed files')); summary?.click(); return Boolean(summary); })()`);
            const reviewState = await cdp.evaluate(`(() => ({ task: document.querySelector('.coding-task-drawer .coding-task-item')?.innerText ?? '', changedFiles: document.querySelector('.coding-task-drawer .coding-task-files')?.innerText ?? '', git: document.querySelector('.coding-project-context .git-summary')?.innerText ?? '' }))()`);
            if (!reviewState.task.toLowerCase().includes('running') || expectedChangedFiles.some((file) => !reviewState.changedFiles.includes(file)) || !reviewState.git.includes('4 changes')) throw new Error(`The project activity review did not show its live status and four changed files: ${JSON.stringify(reviewState)}`);
            if (process.env.UI_MATRIX_CAPTURE === "1" && width === 1440 && height === 900) {
              fs.mkdirSync(captureDirectory, { recursive: true });
              const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
              fs.writeFileSync(path.join(captureDirectory, "coding-task-progress-1440.png"), Buffer.from(screenshot.data, "base64"));
            }
            await cdp.evaluate(`document.querySelector('.coding-task-item-controls button')?.click()`);
            const stopFeedback = await cdp.evaluate(`(async () => { for (let i = 0; i < 20; i++) { if (document.querySelector('.coding-task-item-controls button')?.textContent?.includes('Stopping')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
            if (!stopFeedback) throw new Error("The Stop action did not show its cancellation-in-progress state.");
            const terminalTask = await cdp.evaluateWith(async function (taskId) { let lastResponse; for (let i = 0; i < 100; i++) { lastResponse = await window.skaiAgent.request('tasks.list', {}); const task = lastResponse.ok ? lastResponse.result.find((item) => item.id === taskId) : null; if (task && ['cancelled', 'failed', 'completed'].includes(task.status)) return { task, tasksOk: lastResponse.ok }; await new Promise((r) => setTimeout(r, 100)); } return { taskId, tasksOk: lastResponse?.ok, error: lastResponse?.error, tasks: lastResponse?.result?.map((item) => ({ id: item.id, status: item.status, title: item.title })) }; }, taskProgressTaskId);
            if (terminalTask?.task?.status !== "cancelled") throw new Error(`Stop did not move the held-model task to Cancelled: ${JSON.stringify(terminalTask)}`);
            await Promise.race([taskProgressCancelled, new Promise((_, reject) => setTimeout(() => reject(new Error("Stop marked the task cancelled but left the held model request open.")), 5_000))]);
          }
          // The task-progress fixture has its own assertions and screenshot; keep it isolated
          // from the editor keyboard smoke so failures in either workflow stay attributable.
          if (exerciseTaskProgress) continue;
          if (process.env.UI_MATRIX_EXERCISE_TASK_PLAN === "1") {
            await clickButtonText(cdp, "Plan task", ".project-thread-panel");
            const plannerReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 40; i++) { if (document.querySelector('.project-task-planner-slot:not([hidden]) form')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
            if (!plannerReady) throw new Error("The project Coding Agent thread did not open its local task planner.");
            await cdp.evaluate(`(() => { const fields = document.querySelectorAll('.project-task-planner-slot form input:not([type="checkbox"]), .project-task-planner-slot form textarea'); const set = (element, value) => { const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); }; set(fields[0], 'Add tests for API client'); set(fields[1], 'Write focused unit tests for the new API client, covering core methods, error handling, and edge cases.'); return fields.length; })()`);
            const planDraftReady = await cdp.evaluate(`(() => { const fields = document.querySelectorAll('.project-task-planner-slot form input:not([type="checkbox"]), .project-task-planner-slot form textarea'); return fields.length >= 2 && fields[0].value === 'Add tests for API client' && fields[1].value.includes('core methods'); })()`);
            if (!planDraftReady) throw new Error("The project task planner did not accept its task title and brief.");
            if (process.env.UI_MATRIX_CAPTURE === "1" && width === 1440 && height === 900) {
              fs.mkdirSync(captureDirectory, { recursive: true });
              const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
              fs.writeFileSync(path.join(captureDirectory, "coding-task-plan-1440.png"), Buffer.from(screenshot.data, "base64"));
            }
            await pressEnterOnButtonText(cdp, "Save plan in thread", ".project-task-planner-slot");
            const planSaved = await cdp.evaluate(`(async () => { for (let i = 0; i < 100; i++) { if (document.querySelector('.project-task-planner-slot [role="status"]')?.textContent.includes('Plan saved to this conversation for review')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
            if (!planSaved) throw new Error(`Saving the project task plan did not confirm it for review in the conversation: ${JSON.stringify(await cdp.evaluate(`(() => ({ status: document.querySelector('.project-task-planner-slot [role="status"]')?.textContent, planner: document.querySelector('.project-task-planner-slot')?.innerText, saveDisabled: document.querySelector('.project-task-planner-slot button[type="submit"]')?.disabled }))()`))}`);
            const approvalPlan = await cdp.evaluateWith(async function (title) { const response = await window.skaiAgent.request('tasks.list', {}); const task = response.ok ? response.result.find((item) => item.title === title) : null; return task ? { status: task.status, requiresApproval: task.requiresApproval } : null; }, "Add tests for API client");
            if (approvalPlan?.status !== "proposed" || approvalPlan.requiresApproval !== true) throw new Error(`A newly saved plan did not retain its required approval state: ${JSON.stringify(approvalPlan)}`);
            await cdp.evaluate(`document.querySelector('.coding-project-context-actions button')?.click()`);
            await clickButtonText(cdp, "Open activity", ".overflow-menu-item");
            const planActionReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 100; i++) { const item = [...document.querySelectorAll('.coding-task-drawer .coding-task-item')].find((node) => node.innerText.includes('Add tests for API client')); if (item?.innerText.includes('Queue plan')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
            if (!planActionReady) throw new Error("A saved task plan did not appear with an explicit Queue plan action in project activity.");
            await pressEnterOnButtonText(cdp, "Queue plan", ".coding-task-drawer", "Add tests for API client");
            const approvalActionReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 100; i++) { const item = [...document.querySelectorAll('.coding-task-drawer .coding-task-item')].find((node) => node.innerText.includes('Add tests for API client')); if (item?.innerText.includes('Approve') && item?.innerText.includes('Waiting for you')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
            if (!approvalActionReady) throw new Error("Queueing a plan that requires approval did not expose the explicit approval decision.");
            await pressEnterOnButtonText(cdp, "Approve", ".coding-task-drawer", "Add tests for API client");
            const queuedActionReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 100; i++) { const item = [...document.querySelectorAll('.coding-task-drawer .coding-task-item')].find((node) => node.innerText.includes('Add tests for API client')); if (item?.innerText.includes('Start task') && item?.innerText.toLowerCase().includes('queued')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
            if (!queuedActionReady) throw new Error("Queue plan did not transition the saved plan to an explicit Start task state.");
            if (width < 640) await clickButtonText(cdp, "Close planner", ".project-thread-panel");
          }
          const readme = await cdp.evaluate(`(() => [...document.querySelectorAll('.project-file-item')].find((button) => button.innerText.includes('README.md'))?.getAttribute('title') ?? null)()`);
          if (readme) await cdp.evaluateWith(function (fileName) { [...document.querySelectorAll('.project-file-item')].find((item) => item.title === fileName)?.click(); return 1; }, readme);
          const editorReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 80; i++) { if (document.querySelector('.monaco-editor-shell .monaco-editor')) return true; await new Promise((r) => setTimeout(r, 75)); } return false; })()`);
          if (!editorReady) throw new Error(`Coding workflow did not load Monaco beside its chat thread: ${JSON.stringify(await cdp.evaluate(`(() => ({ title: document.title, mode: document.querySelector('.sidebar-agent-trigger strong')?.textContent?.trim(), selectedFile: document.querySelector('.file-editor-heading span')?.textContent, files: [...document.querySelectorAll('.project-file-item')].map((item) => ({ text: item.innerText, title: item.title })), workspace: document.querySelector('.coding-session-grid')?.className, editor: document.querySelector('#coding-files-workspace')?.outerHTML.slice(0, 300), empty: document.querySelector('.project-file-preview')?.innerText }))()`))}`);
          if (process.env.UI_MATRIX_CAPTURE === "1" && width === 1440 && height === 900) {
            fs.mkdirSync(captureDirectory, { recursive: true });
            const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
            fs.writeFileSync(path.join(captureDirectory, "coding-project-session-1440.png"), Buffer.from(screenshot.data, "base64"));
          }
          await cdp.evaluate(`(() => { const workspace = document.querySelector('.coding-session-grid'); if (workspace) workspace.scrollTop = workspace.scrollHeight; return 1; })()`);
          await clickInRenderer(cdp, ".monaco-editor");
          await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Home", code: "Home", modifiers: 2 });
          await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Home", code: "Home", modifiers: 2 });
          await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "End", code: "End", modifiers: 8 });
          await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "End", code: "End", modifiers: 8 });
          await cdp.send("Input.insertText", { text: "# Revised starter project\n\nTemporary smoke edit for the isolated workspace." });
          const draftReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 30; i++) { if (document.querySelector('#coding-file-editor button:last-child')?.disabled === false) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
          if (!draftReady) throw new Error(`Monaco did not accept the isolated edit: ${JSON.stringify(await cdp.evaluate(`(() => { const selectors = ['.app-main','.app-content','.coding-session-grid','.coding-project-browser','.project-file-layout','.file-editor-panel','.monaco-editor-shell','.monaco-editor','.monaco-editor .view-lines']; return { viewport: [innerWidth, innerHeight], widths: Object.fromEntries(selectors.map((selector) => { const element = document.querySelector(selector); const rect = element?.getBoundingClientRect(); return [selector, rect && { x: rect.x, y: rect.y, w: rect.width, h: rect.height, client: [element.clientWidth, element.clientHeight], scroll: [element.scrollWidth, element.scrollHeight] }]; })), file: document.querySelector('#coding-file-editor')?.innerText, editor: document.querySelector('.monaco-editor')?.innerText?.slice(0, 140), active: document.activeElement?.outerHTML?.slice(0, 120), buttons: [...document.querySelectorAll('#coding-file-editor button')].map((button) => ({ text: button.innerText, disabled: button.disabled })) }; })()`))}`);
          await clickButtonText(cdp, "Review diff", "#coding-file-editor");
          await sleep(350);
          if (process.env.UI_MATRIX_CAPTURE === "1" && width === 1440 && height === 900) {
            fs.mkdirSync(captureDirectory, { recursive: true });
            const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
            fs.writeFileSync(path.join(captureDirectory, "coding-project-diff-1440.png"), Buffer.from(screenshot.data, "base64"));
          }
          const diffReady = await cdp.evaluate(`Boolean(document.querySelector('.coding-diff-cell.is-added') && document.querySelector('.coding-diff-cell.is-context') && document.querySelectorAll('.coding-diff-line > .coding-diff-cell').length >= 2 && document.querySelector('.coding-diff-header')?.innerText.includes('Original') && document.querySelector('.coding-diff-header')?.innerText.includes('Working copy'))`);
          if (!diffReady) throw new Error(`Review diff did not render a side-by-side comparison with additions and context beside the Coding Agent thread: ${JSON.stringify(await cdp.evaluate(`(() => ({ heading: document.querySelector('#coding-file-editor')?.innerText, editorText: document.querySelector('.monaco-editor .view-lines')?.innerText?.slice(0,160), shell: document.querySelector('.coding-diff-preview')?.innerText, buttons: [...document.querySelectorAll('#coding-file-editor button')].map((button) => ({ text: button.innerText, disabled: button.disabled })) }))()`))}`);
          const reviewLayout = await cdp.evaluate(`(() => { const thread = document.querySelector('.project-thread-panel')?.getBoundingClientRect(); const editor = document.querySelector('.coding-project-browser')?.getBoundingClientRect(); return { thread: thread?.width ?? 0, editor: editor?.width ?? 0 }; })()`);
          if (width >= 1100 && reviewLayout.editor <= reviewLayout.thread) throw new Error(`The Coding change view did not give its side-by-side diff more room than chat: ${JSON.stringify(reviewLayout)}`);
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
          const undoRestoredFile = await cdp.evaluate(`(async () => { for (let i = 0; i < 100; i++) { const buttons = [...document.querySelectorAll('#coding-file-editor button')]; const undo = buttons.find((button) => button.textContent?.trim() === 'Undo'); const save = buttons.find((button) => button.textContent?.trim() === 'Save edit'); const editor = document.querySelector('.monaco-editor-shell .monaco-editor'); if (editor && undo?.disabled && save?.disabled) return true; await new Promise((r) => setTimeout(r, 75)); } return false; })()`);
          if (!undoRestoredFile) throw new Error(`Undo did not return the Coding workspace to a clean editor state: ${JSON.stringify(await cdp.evaluate(`(() => ({ editor: document.querySelector('.monaco-editor')?.innerText?.slice(0, 180), heading: document.querySelector('#coding-file-editor')?.innerText, buttons: [...document.querySelectorAll('#coding-file-editor button')].map((button) => ({ text: button.textContent?.trim(), disabled: button.disabled })) }))()`))}`);
          if (exerciseGitReview) {
            await clickInRenderer(cdp, 'button[aria-label="Add a page to the split view"], .coding-split-launcher button[aria-label="Add to split"]');
            const changesChoice = await cdp.evaluate(`(async () => { for (let i = 0; i < 30; i++) { const item = [...document.querySelectorAll('.overflow-menu-item')].find((entry) => entry.textContent?.trim() === 'Changes'); if (item) { item.click(); return true; } await new Promise((resolve) => setTimeout(resolve, 25)); } return false; })()`);
            if (!changesChoice) throw new Error('The Coding workspace did not expose Changes as a pane to add to the split.');
            const gitChangesReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 100; i++) { if (document.querySelector('.git-change-summary')?.innerText.includes('3 changed files')) return true; await new Promise((r) => setTimeout(r, 75)); } return false; })()`);
            if (!gitChangesReady) throw new Error(`The seeded Git project did not show its three local changes: ${JSON.stringify(await cdp.evaluate(`document.querySelector('.git-change-summary')?.innerText ?? document.body.innerText.slice(0, 300)`))}`);
            const selectedChanges = await cdp.evaluate(`(() => { const rows = [...document.querySelectorAll('.git-change-list li')]; for (const row of rows) { const checkbox = row.querySelector('input[type="checkbox"]'); const shouldSelect = row.innerText.includes('README.md') || row.innerText.includes('src/index.ts'); if (!checkbox) return false; if (checkbox.checked !== shouldSelect) checkbox.click(); } return [...document.querySelectorAll('.git-change-list li')].map((row) => ({ path: row.innerText, checked: row.querySelector('input')?.checked })); })()`);
            if (!Array.isArray(selectedChanges) || selectedChanges.filter((item) => item.checked).length !== 2) throw new Error(`The Git review list did not allow two of three changes to be selected: ${JSON.stringify(selectedChanges)}`);
            const diffReviewStarted = await cdp.evaluate(`(() => { const button = [...(document.querySelector('.git-change-summary')?.querySelectorAll('button') ?? [])].find((item) => item.textContent?.trim() === 'Review diff'); if (!button || button.disabled) return false; button.click(); return true; })()`);
            if (!diffReviewStarted) throw new Error('The selected Git changes did not expose the Review diff action.');
            const gitDiffReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 100; i++) { const diff = document.querySelector('.git-review-workbench')?.innerText ?? ''; if (diff.includes('README.md') && diff.includes('gardenSpacing')) return true; await new Promise((r) => setTimeout(r, 75)); } return false; })()`);
            if (!gitDiffReady) throw new Error(`The selected Git changes did not produce a hunk review: ${JSON.stringify(await cdp.evaluate(`(() => ({ review: document.querySelector('.git-review-workbench')?.innerText ?? 'no diff review', changes: document.querySelector('.git-change-summary')?.innerText, buttons: [...(document.querySelector('.git-change-summary')?.querySelectorAll('button') ?? [])].map((button) => ({ text: button.innerText, disabled: button.disabled })), alerts: [...document.querySelectorAll('[role="alert"], [role="status"]')].map((item) => item.innerText) }))()`))}`);
            const selectedDiffOnly = await cdp.evaluate(`(() => { const diff = document.querySelector('.git-review-workbench')?.innerText ?? ''; return diff.includes('README.md') && diff.includes('gardenSpacing') && !diff.includes('src/plan.ts') && document.querySelectorAll('.git-review-hunk-toggle').length >= 3 && document.querySelectorAll('.git-review-toolbar-options input').length === 3; })()`);
            if (!selectedDiffOnly) throw new Error('The Git diff preview included a file outside the two selected changes.');
            const hunkSelectionReady = await cdp.evaluate(`(() => { const readme = [...document.querySelectorAll('.git-review-file')].find((card) => card.querySelector('.git-review-file-heading')?.innerText.includes('README.md')); const hunks = [...(readme?.querySelectorAll('.git-review-hunk-toggle input') ?? [])]; if (hunks.length < 2) return false; hunks[1].click(); return !hunks[1].checked; })()`);
            if (!hunkSelectionReady) throw new Error('The local Git review did not expose independently selectable hunks.');
            const commentReady = await cdp.evaluate(`(async () => { const line = [...document.querySelectorAll('.git-review-line.is-added')].find((row) => row.innerText.includes('Local review note')); if (!line) return false; line.querySelector('button')?.click(); for (let i = 0; i < 30; i++) { if (document.querySelector('.git-review-comment-form textarea')) return true; await new Promise((r) => setTimeout(r, 25)); } return false; })()`);
            if (!commentReady) throw new Error('The local Git review did not allow an anchored comment on an added line.');
            await cdp.evaluate(`(() => { const form = document.querySelector('.git-review-comment-form'); const textarea = form?.querySelector('textarea'); if (!textarea) return false; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, 'Keep the two independent changes reviewed separately.'); textarea.dispatchEvent(new Event('input', { bubbles: true })); form.querySelector('button[type="submit"]')?.click(); return true; })()`);
            const anchoredNote = await cdp.evaluate(`(async () => { for (let i = 0; i < 30; i++) { const note = document.querySelector('.git-review-note')?.innerText ?? ''; if (note) return note; await new Promise((r) => setTimeout(r, 25)); } return ''; })()`);
            if (!anchoredNote.includes('README.md') || !anchoredNote.includes('anchored')) throw new Error(`The review comment did not keep its file/line anchor: ${anchoredNote}`);
            const reviewEnhancementsReady = await cdp.evaluate(`(() => ({ openNote: [...document.querySelectorAll('.git-review-toolbar-options button')].some((button) => button.textContent?.includes('Send 1 open note')), reviewer: [...document.querySelectorAll('.git-review-toolbar-options button')].some((button) => button.textContent?.includes('Ask reviewer agent')), coverage: Boolean(document.querySelector('.git-review-check-coverage')), history: Boolean(document.querySelector('.git-review-note-actions details')) }))()`);
            if (!reviewEnhancementsReady.openNote || !reviewEnhancementsReady.reviewer || !reviewEnhancementsReady.coverage || !reviewEnhancementsReady.history) throw new Error(`The Git review enhancements were not visible: ${JSON.stringify(reviewEnhancementsReady)}`);
            await cdp.evaluate(`(() => { const resolve = [...document.querySelectorAll('.git-review-note-actions button')].find((button) => button.textContent?.trim() === 'Resolve'); resolve?.click(); return Boolean(resolve); })()`);
            const resolvedNoteVisible = await cdp.evaluate(`document.querySelector('.git-review-note')?.innerText?.includes('resolved') === true`);
            if (!resolvedNoteVisible) throw new Error('Review note resolution history did not persist its resolved status.');
            if (process.env.UI_MATRIX_CAPTURE === '1' && width === 1440 && height === 900) {
              fs.mkdirSync(captureDirectory, { recursive: true });
              await cdp.evaluate(`(() => { for (const selector of ['.git-review-workbench', '.git-review-file-list', '.git-change-summary']) { const element = document.querySelector(selector); if (element) element.scrollTop = 0; } return true; })()`);
              const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
              fs.writeFileSync(path.join(captureDirectory, 'coding-git-review-1440.png'), Buffer.from(screenshot.data, 'base64'));
            }
            const commitMessageSet = await cdp.evaluate(`(() => { const input = document.querySelector('.git-review-actions input[aria-label="Local Git commit message"]'); if (!input) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Review selected garden changes'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
            if (!commitMessageSet) throw new Error('The local Git review did not expose its commit message field.');
            await clickButtonText(cdp, 'Commit 2 selected · selected hunks', '.git-review-actions');
            const selectedCommitReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 100; i++) { const summary = document.querySelector('.git-change-summary')?.innerText ?? ''; const rows = [...document.querySelectorAll('.git-change-list li')].map((row) => row.innerText).join(' '); if (summary.includes('2 changed files') && rows.includes('README.md') && rows.includes('src/plan.ts') && !rows.includes('src/index.ts')) return true; await new Promise((r) => setTimeout(r, 100)); } return false; })()`);
            if (!selectedCommitReady) throw new Error(`Committing selected hunks did not leave the excluded hunk and unselected file in the workspace: ${JSON.stringify(await cdp.evaluate(`(() => ({ summary: document.querySelector('.git-change-summary')?.innerText, rows: [...document.querySelectorAll('.git-change-list li')].map((row) => row.innerText) }))()`))}`);
            await cdp.evaluate(`(() => { for (const element of document.querySelectorAll('*')) if (element.scrollTop) element.scrollTop = 0; window.scrollTo(0, 0); return 1; })()`);
          }
        }
        if (route === "persona-workshop" && process.env.UI_MATRIX_EXERCISE_PERSONA === "1") {
          const personaReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 60; i++) { if (document.querySelector('.persona-library-picker > button')) return true; await new Promise((r) => setTimeout(r, 100)); } return false; })()`);
          if (!personaReady) throw new Error("Persona workflow did not load the seeded persona list.");
          await cdp.evaluate(`([...document.querySelectorAll('.persona-library-picker > button')].find((button) => button.querySelector('strong')?.textContent?.trim() === 'Release Engineer')?.click(), 1)`);
          const selectedPersona = await cdp.evaluate(`document.querySelector('.persona-library-detail h2')?.textContent?.trim()`);
          if (selectedPersona !== "Release Engineer") throw new Error(`Persona profile selection failed: ${selectedPersona}`);
          const duplicateControl = await cdp.evaluate(`([...document.querySelectorAll('.persona-library-profile-actions button')].find((button) => button.textContent?.trim() === 'Duplicate')?.click(), Boolean([...document.querySelectorAll('.persona-library-profile-actions button')].find((button) => button.textContent?.trim() === 'Duplicate')))`);
          if (!duplicateControl) throw new Error('Persona details did not expose the Duplicate workflow.');
          const personaCopyReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 60; i++) { if (document.querySelector('.persona-library-detail h2')?.textContent?.trim() === 'Release Engineer copy') return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
          if (!personaCopyReady) throw new Error('Duplicating a persona did not select the new profile in the library.');
          const personaCopy = await cdp.evaluate(`(async () => { const response = await window.skaiAgent.request('persona.list'); const personas = response.ok ? response.result.personas : []; const copy = personas.find((item) => item.name === 'Release Engineer copy'); return copy && { id: copy.id, continuity: copy.personalContinuityEnabled, sourceCount: copy.sources.length, roles: copy.roles, scope: document.querySelector('.persona-library-effective-scope')?.innerText }; })()`);
          if (!personaCopy?.id || personaCopy.continuity || !personaCopy.roles || personaCopy.scope?.includes('no project-file, shell, or tool access') !== true) throw new Error(`Persona duplication did not copy its profile safely or explain its effective scope: ${JSON.stringify(personaCopy)}`);
          const personaWorkflow = await cdp.evaluate(`(() => ({ sandbox: Boolean(document.querySelector('.persona-test-sandbox')), provenance: Boolean(document.querySelector('.persona-instruction-provenance')), exportButton: [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === 'Export definition') }))()`);
          if (!personaWorkflow.sandbox || !personaWorkflow.provenance || !personaWorkflow.exportButton) throw new Error(`Persona preview, provenance, and export controls did not render: ${JSON.stringify(personaWorkflow)}`);
          if (process.env.UI_MATRIX_CAPTURE === "1" && width === 1440 && height === 900) {
            fs.mkdirSync(captureDirectory, { recursive: true });
            const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
            fs.writeFileSync(path.join(captureDirectory, "persona-library-duplicate-1440.png"), Buffer.from(screenshot.data, "base64"));
          }
          await clickButtonText(cdp, "New persona");
          const starterReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 60; i++) { if (document.querySelector('.persona-starter-templates')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
          if (!starterReady) throw new Error('The persona create page did not show starter templates.');
          const compositionReady = await cdp.evaluate(`(() => ({ card: Boolean(document.querySelector('.persona-composition-card')), scope: Boolean([...document.querySelectorAll('select')].find((select) => [...select.options].some((option) => option.textContent === 'Selected project'))), skills: Boolean(document.querySelector('.persona-skill-grid')) }))()`);
          if (!compositionReady.card || !compositionReady.scope || !compositionReady.skills) throw new Error(`Persona composition controls did not render: ${JSON.stringify(compositionReady)}`);
          const starterTemplates = await cdp.evaluate(`(() => [...document.querySelectorAll('.persona-starter-templates button')].map((button) => button.textContent.trim()))()`);
          if (!['Coding', 'Research', 'Writing', 'Support'].every((label) => starterTemplates.includes(label))) throw new Error(`Starter persona templates are incomplete: ${JSON.stringify(starterTemplates)}`);
          await clickButtonText(cdp, "Coding", ".persona-starter-templates");
          const codingStarterName = await cdp.evaluate(`document.querySelector('.persona-card-fields input')?.value`);
          if (codingStarterName !== "Coding partner") throw new Error(`Selecting the coding persona template did not prefill its profile: ${codingStarterName}`);
          await clickButtonText(cdp, "Back to Workshop");
        }
        await sleep(process.env.UI_MATRIX_CAPTURE === "1" ? 350 : 120);
        if (process.env.UI_MATRIX_CAPTURE === "1" && (route === "marketplace" || route === "memory")) {
          const settled = await cdp.evaluateWith(async function (pending) { for (let i = 0; i < 60; i++) { if (!document.body.innerText.includes(pending)) return true; await new Promise((r) => setTimeout(r, 100)); } return !document.body.innerText.includes(pending); }, route === "memory" ? "Loading memory…" : "Loading Marketplace…");
          if (!settled) console.warn(`[capture] #/${route} remained in its loading state after 6 seconds; checking the connected native feature.`);
        }
        if (route === "memory" && process.env.UI_MATRIX_EXERCISE_MEMORY === "1" && width === 1440 && height === 900 && theme === "dark" && collapsed === "false") {
          const noteText = "I prefer clear, practical workflow summaries with the next action stated first.";
          const noteEntered = await cdp.evaluateWith(function (value) { const input = document.querySelector('textarea[aria-label="Memory content"]'); if (!input) return false; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); return true; }, noteText);
          if (!noteEntered) throw new Error("Memory did not expose its explicit note editor.");
          await clickButtonText(cdp, "Save memory", ".memory-editor");
          const noteSaved = await cdp.evaluate(`(async () => { for (let i = 0; i < 60; i++) { if ([...document.querySelectorAll('.memory-entry')].some((entry) => entry.innerText.includes('clear, practical workflow summaries'))) return true; await new Promise((r) => setTimeout(r, 100)); } return false; })()`);
          if (!noteSaved) throw new Error("Saving an explicit memory note did not add it to the saved-memory list.");
          for (const supportingNote of ["Project context should stay scoped to its workspace.", "Use a friendly, direct tone."]) {
            const entered = await cdp.evaluateWith(function (value) { const input = document.querySelector('textarea[aria-label="Memory content"]'); if (!input) return false; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); return true; }, supportingNote);
            if (!entered) throw new Error("Memory did not accept the supporting reference notes.");
            await clickButtonText(cdp, "Save memory", ".memory-editor");
            const noteVisible = await cdp.evaluateWith(async function (value) { for (let i = 0; i < 60; i++) { if ([...document.querySelectorAll('.memory-entry')].some((entry) => entry.innerText.includes(value))) return true; await new Promise((r) => setTimeout(r, 100)); } return false; }, supportingNote);
            if (!noteVisible) throw new Error(`The supporting memory note was not saved: ${supportingNote}`);
          }
          await cdp.evaluate(`(() => { const entry = [...document.querySelectorAll('.memory-entry')].find((item) => item.innerText.includes('clear, practical workflow summaries')); entry?.querySelector('button')?.click(); return Boolean(entry); })()`);
          const selectedNote = await cdp.evaluate(`(() => ({ value: document.querySelector('textarea[aria-label="Memory content"]')?.value, editing: Boolean(document.querySelector('.memory-entry.is-editing')), title: document.querySelector('.memory-editor-heading')?.innerText }))()`);
          if (selectedNote.value !== noteText || !selectedNote.editing || !selectedNote.title?.includes('EDIT NOTE')) throw new Error(`Selecting the saved memory did not restore it to the editor: ${JSON.stringify(selectedNote)}`);
          const referenceDirectory = path.join(__dirname, "..", "docs", "design-review", "workflow-collection", "revision-4");
          fs.mkdirSync(referenceDirectory, { recursive: true });
          await cdp.evaluate(`(() => { for (const element of document.querySelectorAll('*')) if (element.scrollTop) element.scrollTop = 0; if (document.scrollingElement) document.scrollingElement.scrollTop = 0; window.scrollTo(0, 0); return 1; })()`);
          let screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
          fs.writeFileSync(path.join(referenceDirectory, "evidence-memory-note-1440.png"), Buffer.from(screenshot.data, "base64"));
          await cdp.evaluate(`([...document.querySelectorAll('.memory-view-tabs button')].find((button) => button.textContent.includes('Document corpus'))?.click(), 1)`);
          const corpusReady = await cdp.evaluate(`Boolean(document.querySelector('input[aria-label="Document title"]') && document.querySelector('input[aria-label="Document source"]'))`);
          if (!corpusReady) throw new Error("Memory did not open its separate document-corpus view.");
          const corpusFilled = await cdp.evaluate(`(() => { const set = (selector, value, prototype) => { const input = document.querySelector(selector); if (!input) return false; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); return true; }; return set('input[aria-label="Document title"]', 'Workflow acceptance notes', HTMLInputElement.prototype) && set('input[aria-label="Document source"]', 'Revision 4 smoke fixture', HTMLInputElement.prototype) && set('textarea[aria-label="Document content"]', 'Keep the saved workflow note distinct from the local document corpus.', HTMLTextAreaElement.prototype); })()`);
          if (!corpusFilled) throw new Error("The separate document-corpus form could not accept its local fixture.");
          await clickButtonText(cdp, "Add document", ".corpus-panel");
          const corpusSaved = await cdp.evaluate(`(async () => { for (let i = 0; i < 60; i++) { if ([...document.querySelectorAll('.corpus-list .memory-entry')].some((entry) => entry.innerText.includes('Workflow acceptance notes'))) return true; await new Promise((r) => setTimeout(r, 100)); } return false; })()`);
          if (!corpusSaved) throw new Error("Adding the explicit local document did not show it in the corpus list.");
          const corpusSearchSet = await cdp.evaluate(`(() => { const input = document.querySelector('input[aria-label="Search document corpus"]'); if (!input) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Workflow acceptance'); input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
          if (!corpusSearchSet) throw new Error("The document corpus did not expose its search field.");
          const corpusSearchWorks = await cdp.evaluate(`(async () => { for (let i = 0; i < 60; i++) { if ([...document.querySelectorAll('.corpus-list .memory-entry')].some((entry) => entry.innerText.includes('Workflow acceptance notes'))) return true; await new Promise((r) => setTimeout(r, 100)); } return false; })()`);
          if (!corpusSearchWorks) throw new Error("Searching the local document corpus did not return the matching document.");
          await cdp.evaluate(`(() => { const input = document.querySelector('input[aria-label="Search document corpus"]'); if (!input) return; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
          await cdp.evaluate(`(() => { for (const element of document.querySelectorAll('*')) if (element.scrollTop) element.scrollTop = 0; if (document.scrollingElement) document.scrollingElement.scrollTop = 0; window.scrollTo(0, 0); return 1; })()`);
          screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
          fs.writeFileSync(path.join(referenceDirectory, "evidence-memory-corpus-1440.png"), Buffer.from(screenshot.data, "base64"));
          await cdp.evaluate(`document.querySelector('.corpus-list .memory-entry button')?.click()`);
          const corpusRemoved = await cdp.evaluate(`(async () => { for (let i = 0; i < 60; i++) { if (document.querySelector('.corpus-panel')?.innerText.includes('No local documents')) return true; await new Promise((r) => setTimeout(r, 100)); } return false; })()`);
          if (!corpusRemoved) throw new Error("Removing the explicit local document did not clear it from the corpus.");
          console.log(`[memory-workflow] ${JSON.stringify({ notesSaved: 3, selectedForEdit: true, documentSaved: true, documentSearch: true, documentRemoved: true, noteText })}`);
        }
        if (process.env.UI_MATRIX_CAPTURE === "1" && route === "images") {
          await cdp.evaluate(`(async () => { const panel = document.querySelector('.visuals-runtime-settings'); if (!panel) return true; for (let i = 0; i < 50; i++) { const status = panel.querySelector('.status-badge')?.textContent?.trim().toLowerCase(); if (!status || status !== 'checking') return true; await new Promise((r) => setTimeout(r, 50)); } return true; })()`);
          fs.mkdirSync(captureDirectory, { recursive: true });
          const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
          fs.writeFileSync(path.join(captureDirectory, `visuals-workshop-${width}x${height}.png`), Buffer.from(screenshot.data, "base64"));
        }
        if (route === "images" && process.env.UI_MATRIX_EXERCISE_VISUALS === "1" && width === 1440 && height === 900 && theme === "dark" && collapsed === "false") {
          const before = await cdp.evaluate(`(() => { const canvas = document.querySelector('.visuals-stage'); const rect = canvas?.getBoundingClientRect(); const batch = document.querySelector('select[aria-label="Batch generation size"]'); return { canvas: Boolean(canvas && rect?.width > 500 && rect?.height > 250), prompt: Boolean(document.querySelector('#visuals-prompt')), preset: Boolean(document.querySelector('.visuals-presets > summary')), requirements: Boolean(document.querySelector('.visuals-requirements')), batchChoices: batch ? [...batch.options].map((option) => option.value) : [], batchBound: Boolean(batch && [...batch.options].at(-1)?.value === '4') }; })()`);
          if (!before.canvas || !before.prompt || !before.preset || !before.requirements || !before.batchBound || before.batchChoices.length !== 4) throw new Error(`Visuals Workshop did not provide its canvas, activation requirements, preset, and bounded batch controls: ${JSON.stringify(before)}`);
          await clickInRenderer(cdp, '.visuals-more-tools > summary');
          const moreTools = await cdp.evaluate(`(() => { const details = document.querySelector('.visuals-more-tools'); const menu = document.querySelector('.visuals-more-tools-menu'); const strip = document.querySelector('.visuals-toolstrip'); const scroll = document.querySelector('.visuals-toolstrip-scroll'); const rect = menu?.getBoundingClientRect(); const stripRect = strip?.getBoundingClientRect(); const menuStyle = menu ? getComputedStyle(menu) : null; return { open: Boolean(details?.open), buttons: menu?.querySelectorAll('button').length ?? 0, visible: Boolean(menu && rect && rect.width > 0 && rect.height > 0 && menuStyle?.visibility !== 'hidden'), escapesStrip: Boolean(menu && strip && rect && stripRect && (rect.bottom > stripRect.bottom || rect.top < stripRect.top)), scrollBoundary: scroll ? getComputedStyle(scroll).overflowX : null, stripOverflow: strip ? getComputedStyle(strip).overflowX : null }; })()`);
          if (!moreTools.open || moreTools.buttons < 1 || !moreTools.visible || !moreTools.escapesStrip || moreTools.scrollBoundary !== 'auto' || moreTools.stripOverflow !== 'visible') throw new Error(`Visuals Workshop More tools menu was not visible outside the scrolling tool row: ${JSON.stringify(moreTools)}`);
          if (process.env.UI_MATRIX_CAPTURE === "1") {
            fs.mkdirSync(captureDirectory, { recursive: true });
            const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
            fs.writeFileSync(path.join(captureDirectory, "visuals-workshop-more-tools-1440.png"), Buffer.from(screenshot.data, "base64"));
          }
          await clickInRenderer(cdp, '.visuals-more-tools > summary');
          await cdp.evaluate(`(() => { const input = document.querySelector('#visuals-prompt'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'A visual preset smoke fixture.'); input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
          await cdp.evaluate(`(() => { const engine = document.querySelector('.visuals-control-summary select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(engine, 'comfyui'); engine.dispatchEvent(new Event('change', { bubbles: true })); const settings = document.querySelector('.visuals-workflow-settings'); settings.open = true; const workflow = document.querySelector('.visuals-workflow-panel textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(workflow, '{"1":{"class_type":"CLIPTextEncode","inputs":{"text":"{{prompt}}"}}}'); workflow.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
          await clickInRenderer(cdp, '.visuals-presets > summary');
          await cdp.evaluate(`(() => { const input = document.querySelector('.visuals-presets-panel input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Smoke preset'); input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
          await clickButtonText(cdp, 'Save preset', '.visuals-presets-panel');
          const savedPreset = await cdp.evaluate(`(() => { const presets = JSON.parse(localStorage.getItem('skai.visuals.presets.v1') || '[]'); const preset = presets.find((item) => item.name === 'Smoke preset'); return { present: Boolean(preset), prompt: preset?.prompt, tool: preset?.tool, provider: preset?.provider, workflow: preset?.workflow, canvasStillVisible: Boolean(document.querySelector('.visuals-stage')) }; })()`);
          if (!savedPreset.present || savedPreset.prompt !== 'A visual preset smoke fixture.' || savedPreset.tool !== 'image' || savedPreset.provider !== 'comfyui' || !savedPreset.workflow?.includes('{{prompt}}') || !savedPreset.canvasStillVisible) throw new Error(`Visual generation preset did not persist the active setup while retaining the canvas: ${JSON.stringify(savedPreset)}`);
          await cdp.evaluate(`(() => { const prompt = document.querySelector('#visuals-prompt'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(prompt, 'Changed after save.'); prompt.dispatchEvent(new Event('input', { bubbles: true })); const engine = document.querySelector('.visuals-control-summary select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(engine, 'diffusers'); engine.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
          await cdp.evaluate(`(() => { const select = document.querySelector('.visuals-presets-panel select'); select.value = [...select.options].find((option) => option.textContent === 'Smoke preset').value; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
          await cdp.evaluate(`(async () => { for (let i = 0; i < 40; i++) { if (document.querySelector('.visuals-control-summary select')?.value === 'comfyui') break; await new Promise((r) => setTimeout(r, 25)); } const details = document.querySelector('.visuals-workflow-settings'); if (details && !details.open) details.querySelector('summary')?.click(); for (let i = 0; i < 40; i++) { if (document.querySelector('.visuals-workflow-panel textarea')) return true; await new Promise((r) => setTimeout(r, 25)); } return false; })()`);
          const presetRestored = await cdp.evaluate(`(() => ({ prompt: document.querySelector('#visuals-prompt')?.value, provider: document.querySelector('.visuals-control-summary select')?.value, workflow: document.querySelector('.visuals-workflow-panel textarea')?.value }))()`);
          if (presetRestored.prompt !== 'A visual preset smoke fixture.' || presetRestored.provider !== 'comfyui' || !presetRestored.workflow?.includes('{{prompt}}')) throw new Error(`Applying a saved visual preset did not restore its prompt, provider, and workflow: ${JSON.stringify(presetRestored)}`);
          await clickButtonText(cdp, 'Delete preset', '.visuals-presets-panel');
          const presetRemoved = await cdp.evaluate(`!JSON.parse(localStorage.getItem('skai.visuals.presets.v1') || '[]').some((item) => item.name === 'Smoke preset')`);
          if (!presetRemoved) throw new Error('Deleting a visual preset did not remove its local record.');
          await cdp.evaluate(`(() => { for (const selector of ['.visuals-presets', '.visuals-workflow-settings']) { const details = document.querySelector(selector); if (details?.open) details.querySelector('summary')?.click(); } for (const element of document.querySelectorAll('*')) if (element.scrollTop) element.scrollTop = 0; if (document.scrollingElement) document.scrollingElement.scrollTop = 0; window.scrollTo(0, 0); return true; })()`);
          console.log(`[visuals-preset] ${JSON.stringify({ ...before, saved: savedPreset.present, restored: true, deleted: presetRemoved })}`);
        }
        if (route === "chat" && process.env.UI_MATRIX_EXERCISE_CHAT_BASE === "1" && width === 1440 && height === 900 && theme === "dark" && collapsed === "false") {
          const selectedThread = await cdp.evaluate(`(() => { const row = [...document.querySelectorAll('.sidebar-history-row')].find((item) => item.innerText.includes('Plan a simple herb garden')); row?.querySelector('.sidebar-history-item')?.click(); return Boolean(row); })()`);
          if (!selectedThread) throw new Error("The shared-shell smoke could not find its seeded everyday conversation.");
          const threadReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 60; i++) { if (document.querySelector('.chat-message.assistant')?.innerText.includes('Start with basil, thyme, and parsley')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
          if (!threadReady) throw new Error("Selecting the seeded recent conversation did not open its everyday Chat thread.");
          const shellState = await cdp.evaluate(`({ active: document.querySelector('.sidebar-history-row.is-active .sidebar-history-item')?.innerText, title: document.querySelector('.chat-heading-copy strong')?.innerText, messages: document.querySelectorAll('.chat-message').length, composer: Boolean(document.querySelector('.composer-card textarea')), rail: Boolean(document.querySelector('.global-rail[aria-label="Global navigation"]')), recent: document.querySelectorAll('.sidebar-history-row').length })`);
          if (!shellState.active?.includes('Plan a simple herb garden') || !shellState.title?.includes('Plan a simple herb garden') || shellState.messages < 2 || !shellState.composer || !shellState.rail || shellState.recent < 4) throw new Error(`The shared-shell and everyday Chat state was incomplete: ${JSON.stringify(shellState)}`);
          if (process.env.UI_MATRIX_EXERCISE_CHAT_COLLABORATION === "1") {
            await cdp.evaluate(`(() => { window.__collaborationDownloads = []; URL.createObjectURL = ((create) => (blob) => { const url = create(blob); window.__collaborationDownloads.push({ url, blob }); return url; })(URL.createObjectURL.bind(URL)); HTMLAnchorElement.prototype.click = function () { const item = window.__collaborationDownloads.at(-1); if (item) item.name = this.download; }; return true; })()`);
            await clickButtonText(cdp, "Share", ".chat-header-actions");
            const shareDialog = await cdp.evaluate(`Boolean(document.querySelector('#chat-local-share-title') && document.querySelector('.chat-share-boundary')?.innerText.includes('Attachments') && document.querySelector('.chat-share-disabled')?.innerText.includes('Live LAN'))`);
            if (!shareDialog) throw new Error("The conversation sharing dialog did not disclose its read-only data boundary and disabled live access.");
            await cdp.evaluate(`document.querySelector('.chat-local-share-dialog .chat-share-form button')?.click(); 1`);
            const snapshot = await cdp.evaluate(`(async () => { for (let i = 0; i < 40; i++) { if (document.querySelector('.chat-share-notice')?.innerText.includes('snapshot downloaded')) break; await new Promise((r) => setTimeout(r, 25)); } const item = window.__collaborationDownloads?.[0]; return item ? { name: item.name, html: await item.blob.text() } : { count: window.__collaborationDownloads?.length ?? -1, notice: document.querySelector('.chat-share-notice')?.innerText ?? null, record: Object.keys(localStorage).filter((key) => key.startsWith('skai.collaboration.local.')), forms: [...document.querySelectorAll('.chat-local-share-dialog')].map((dialog) => ({ open: dialog.open, text: dialog.innerText.slice(0, 400), buttons: [...dialog.querySelectorAll('button')].map((button) => ({ text: button.innerText, disabled: button.disabled, rect: button.getBoundingClientRect().toJSON() })) })), chat: document.querySelector('.chat-heading-copy')?.innerText, activeId: localStorage.getItem('skai.conversation.active') }; })()`);
            if (!snapshot?.name?.endsWith(".html") || !snapshot.html.includes("Content-Security-Policy") || !snapshot.html.includes("textContent") || !snapshot.html.includes("Download a private fork") || !snapshot.html.includes("Start with basil, thyme, and parsley") || snapshot.html.includes("<script>alert")) throw new Error(`The offline snapshot did not include the expected safe, read-only transcript and fork workflow: ${JSON.stringify(snapshot && { name: snapshot.name, count: snapshot.count, notice: snapshot.notice, record: snapshot.record, forms: snapshot.forms, chat: snapshot.chat, activeId: snapshot.activeId, hasCsp: snapshot.html?.includes("Content-Security-Policy"), hasTranscript: snapshot.html?.includes("Start with basil, thyme, and parsley"), hasFork: snapshot.html?.includes("Download a private fork") })}`);
            const share = await cdp.evaluate(`(() => { const key = Object.keys(localStorage).find((item) => item.startsWith('skai.collaboration.local.')); return key ? JSON.parse(localStorage.getItem(key)) : null; })()`);
            const header = String(await cdp.evaluate(`(() => document.querySelector('.chat-share-header-status')?.textContent ?? '')()`));
            if (!header.includes('Shared locally') || !header.includes('Owner: You') || !header.includes('Read-only') || !header.includes('0 participant') || !header.includes('Expires')) throw new Error(`The active collaboration header did not expose owner, access, participant count, and expiration: ${header}`);
            const forkLiteral = snapshot.html.match(/const forkArchive=("(?:\\.|[^"\\])*");document/);
            if (!forkLiteral) throw new Error("The offline snapshot did not embed a parseable private-fork archive.");
            const fork = JSON.parse(JSON.parse(forkLiteral[1]));
            if (fork.length !== 1 || fork[0].ForkedFrom !== share?.conversationId || !fork[0].Id || fork[0].Messages?.length !== 2 || fork[0].Messages.some((message) => message.Attachments)) throw new Error(`The shared private fork did not preserve the transcript in a clean local archive: ${JSON.stringify(fork)}.`);
            if (!share?.shareId || share.participants.length || share.includesUserMessages !== true || share.includesAssistantMessages !== true) throw new Error(`The owner-side share record had unexpected participant or message-selection state: ${JSON.stringify(share)}`);
            const fileSet = await cdp.evaluateWith(function (suggestion) { const input = document.querySelector('.chat-local-share-dialog input[type="file"]'); if (!input) return false; const data = new DataTransfer(); data.items.add(new File([JSON.stringify(suggestion)], 'reviewed-suggestion.json', { type: 'application/json' })); input.files = data.files; input.dispatchEvent(new Event('change', { bubbles: true })); return true; }, { schema: "skai-session-suggestion/v1", shareId: share.shareId, conversationId: share.conversationId, createdAt: new Date().toISOString(), participant: "Review teammate", suggestion: "Please compare the watering options before sending." });
            const previewReady = fileSet && await cdp.evaluate(`(async () => { for (let i = 0; i < 40; i++) { if (document.querySelector('#chat-suggestion-preview-title')) return document.querySelector('.chat-suggestion-preview')?.innerText ?? ''; await new Promise((r) => setTimeout(r, 25)); } return ''; })()`);
            if (!previewReady?.includes("Review teammate") || !previewReady.includes("compare the watering options")) throw new Error(`A valid suggestion file was not shown for owner review: ${previewReady}`);
            await cdp.evaluate(`([...document.querySelectorAll('.chat-suggestion-preview-dialog button')].find((button) => button.textContent?.trim() === 'Add to composer draft')?.click(), 1)`);
            const acceptedSuggestion = await cdp.evaluate(`(async () => { for (let i = 0; i < 40; i++) { const draft = document.querySelector('.composer-card textarea')?.value ?? ''; if (draft.includes('Suggestion from Review teammate:') && draft.includes('compare the watering options')) return { draft, userMessages: document.querySelectorAll('.chat-message.user').length, notice: document.querySelector('.chat-share-notice')?.innerText }; await new Promise((r) => setTimeout(r, 25)); } return null; })()`);
            if (!acceptedSuggestion || acceptedSuggestion.userMessages !== 1 || !acceptedSuggestion.notice?.includes('Review it before sending')) throw new Error(`Accepting a suggestion should only add it to the unsent draft: ${JSON.stringify(acceptedSuggestion)}`);
            await cdp.evaluate(`([...document.querySelectorAll('.chat-local-share-dialog button')].find((button) => button.textContent?.trim() === 'Close sharing')?.click(), 1)`);
            const revoked = await cdp.evaluate(`(() => { const key = Object.keys(localStorage).find((item) => item.startsWith('skai.collaboration.local.')); const item = key && JSON.parse(localStorage.getItem(key)); return Boolean(item?.revokedAt); })()`);
            if (!revoked) throw new Error("Closing sharing did not revoke owner-side suggestion imports.");
            const revokedImport = await cdp.evaluateWith(function (suggestion) { const input = document.querySelector('.chat-local-share-dialog input[type="file"]'); if (!input) return false; const data = new DataTransfer(); data.items.add(new File([JSON.stringify(suggestion)], 'late-suggestion.json', { type: 'application/json' })); input.files = data.files; input.dispatchEvent(new Event('change', { bubbles: true })); return true; }, { schema: "skai-session-suggestion/v1", shareId: share.shareId, conversationId: share.conversationId, createdAt: new Date().toISOString(), participant: "Late teammate", suggestion: "This must be rejected after the owner closes sharing." });
            const revokedRejected = revokedImport && await cdp.evaluate(`(async () => { for (let i = 0; i < 40; i++) { const notice = document.querySelector('.chat-share-notice')?.innerText ?? ''; if (notice.includes('inactive') || notice.includes('too large')) return !document.querySelector('#chat-suggestion-preview-title'); await new Promise((r) => setTimeout(r, 25)); } return false; })()`);
            if (!revokedRejected) throw new Error("An incoming suggestion was still previewable after owner-side revocation.");
            console.log(`[chat-collaboration] ${JSON.stringify({ snapshot: "offline/read-only and CSP-constrained", excludedContextDisclosed: true, suggestion: "previewed then placed in unsent draft", toolExecution: "not invoked", ownerRevoke: revoked })}`);
          }
          const referenceDirectory = path.join(__dirname, "..", "docs", "design-review", "workflow-collection", "revision-4");
          fs.mkdirSync(referenceDirectory, { recursive: true });
          let screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
          fs.writeFileSync(path.join(referenceDirectory, "evidence-shared-workspace-shell-1440.png"), Buffer.from(screenshot.data, "base64"));
          fs.writeFileSync(path.join(referenceDirectory, "evidence-everyday-chat-thread-1440.png"), Buffer.from(screenshot.data, "base64"));
          await clickInRenderer(cdp, ".new-chat-button");
          const startReady = await cdp.evaluate(`(() => { const buttons = [...document.querySelectorAll('.chat-start-actions button')]; return Boolean(document.querySelector('.chat-start-screen h2') && buttons.length === 2 && buttons.every((button) => { const r = button.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(button).display !== 'none'; }) && document.querySelector('.composer-card textarea')); })()`);
          if (!startReady) throw new Error("New chat did not show the project/model shortcuts and composer together.");
          screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
          fs.writeFileSync(path.join(referenceDirectory, "evidence-new-chat-and-workspace-start-1440.png"), Buffer.from(screenshot.data, "base64"));
          await clickInRenderer(cdp, ".chat-start-actions button:nth-child(1)");
          const projectShortcut = await cdp.evaluate(`(async () => { for (let i = 0; i < 60; i++) { if (document.querySelector('.project-directory-page')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
          if (!projectShortcut) throw new Error(`Open a project did not navigate from the new-chat start screen to Projects: ${JSON.stringify(await cdp.evaluate(`({ page: document.querySelector('.feature-page')?.className, title: document.querySelector('.chat-heading-copy strong')?.innerText, action: document.querySelector('.chat-start-actions button')?.innerText })`))}`);
          await clickInRenderer(cdp, ".global-rail-destinations button[aria-label='Home']");
          const returnedToStart = await cdp.evaluate(`Boolean(document.querySelector('.chat-start-screen h2'))`);
          if (!returnedToStart) throw new Error("Returning from Projects did not restore the empty Chat start screen.");
          await cdp.evaluate(`document.querySelector('.chat-start-actions button:nth-child(2)')?.click(); 1`);
          const modelShortcut = await cdp.evaluate(`(async () => { for (let i = 0; i < 60; i++) { if (document.querySelector('.models-page')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
          if (!modelShortcut) throw new Error(`Choose a model did not navigate from the new-chat start screen to Model Library: ${JSON.stringify(await cdp.evaluate(`({ page: document.querySelector('.feature-page')?.className, title: document.title, actions: document.querySelector('.chat-start-actions')?.innerText })`))}`);
          await clickInRenderer(cdp, ".global-rail-destinations button[aria-label='Home']");
          console.log(`[chat-base] ${JSON.stringify({ shell: "active conversation and persistent navigation", newChat: "project and model shortcuts", projectShortcut, modelShortcut, ...shellState })}`);
          if (process.env.UI_MATRIX_EXERCISE_COMMAND_WORKFLOWS === "1") {
            const before = await cdp.evaluate(`(() => Object.fromEntries(['skai.command-workflows.v1','skai.command-workflows.v1.recent','skai.command-workflows.v1.pinned'].map((key) => [key, localStorage.getItem(key)])))()`);
            await cdp.evaluate(`(() => { localStorage.setItem('skai.command-workflows.v1', JSON.stringify({ shortcuts: { palette: 'Ctrl+Shift+J', newChat: 'Ctrl+N', settings: 'Ctrl+,', chat: 'Ctrl+1', coding: 'Ctrl+2', terminal: 'Ctrl+3' }, savedPrompts: [{ id: 'smoke-review-brief', name: 'Review Brief', alias: 'brief', prompt: 'Summarize the decision and list open questions.' }], sendBehavior: 'shift-enter-sends', toolbarLayout: 'compact' })); window.dispatchEvent(new Event('skai-command-workflows-changed')); return true; })()`);
            await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "J", code: "KeyJ", windowsVirtualKeyCode: 74, modifiers: 10 });
            await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "J", code: "KeyJ", windowsVirtualKeyCode: 74, modifiers: 10 });
            const paletteOpened = await cdp.evaluate(`(async () => { for (let i = 0; i < 40; i++) { if (document.querySelector('#command-palette-title')) return true; await new Promise((r) => setTimeout(r, 25)); } return false; })()`);
            if (!paletteOpened) throw new Error("The personalized command palette shortcut did not open the palette.");
            const pinnedVisible = await cdp.evaluate(`(async () => { const row = [...document.querySelectorAll('.command-row')].find((entry) => entry.innerText.includes('Open Memory')); if (!row) return { ok: false, reason: 'memory command missing', rows: [...document.querySelectorAll('.command-row')].map((entry) => entry.innerText) }; row.querySelector('.command-pin')?.click(); for (let i = 0; i < 40; i++) { if (document.querySelector('.command-filter-tabs [role=tab][aria-selected=true]')?.innerText.includes('Pinned') && [...document.querySelectorAll('.command-row')].some((entry) => entry.innerText.includes('Open Memory'))) return { ok: true }; await new Promise((r) => setTimeout(r, 25)); } return { ok: false, reason: 'pinned view did not update', tabs: document.querySelector('.command-filter-tabs')?.innerText, rows: [...document.querySelectorAll('.command-row')].map((entry) => entry.innerText) }; })()`);
            if (!pinnedVisible?.ok) throw new Error(`Pinning a frequent command did not add it to the pinned palette view: ${JSON.stringify(pinnedVisible)}`);
            await cdp.evaluate(`document.querySelector('.command-filter-tabs button[role=tab]:first-child')?.click(); 1`);
            await cdp.evaluate(`([...document.querySelectorAll('.command-row')].find((entry) => entry.innerText.includes('Open Memory'))?.querySelector('.command-row-open')?.click(), 1)`);
            const memoryOpened = await cdp.evaluate(`(async () => { for (let i = 0; i < 50; i++) { if (document.querySelector('.memory-page')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
            if (!memoryOpened) throw new Error("The command palette did not open the selected Memory destination.");
            await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "J", code: "KeyJ", windowsVirtualKeyCode: 74, modifiers: 10 });
            await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "J", code: "KeyJ", windowsVirtualKeyCode: 74, modifiers: 10 });
            await cdp.evaluate(`document.querySelector('.command-filter-tabs button[role=tab]:nth-child(2)')?.click(); 1`);
            const recentVisible = await cdp.evaluate(`([...document.querySelectorAll('.command-row')].some((entry) => entry.innerText.includes('Open Memory')))`);
            if (!recentVisible) throw new Error("The recently used Memory command did not appear in the command palette.");
            await cdp.evaluate(`document.querySelector('.command-heading button[aria-label="Close command palette"]')?.click(); 1`);
            await clickInRenderer(cdp, ".global-rail-destinations button[aria-label='Home']");
            await cdp.evaluate(`(() => { const field = document.querySelector('.composer-card textarea'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(field, '/brief'); field.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
            const slashPrompt = await cdp.evaluate(`(async () => { for (let i = 0; i < 40; i++) { const button = [...document.querySelectorAll('.composer-command-menu button')].find((item) => item.innerText.includes('Review Brief')); if (button) { button.click(); return true; } await new Promise((r) => setTimeout(r, 25)); } return false; })()`);
            const promptInserted = slashPrompt && await cdp.evaluate(`document.querySelector('.composer-card textarea')?.value === 'Summarize the decision and list open questions.'`);
            const composerPreferencesApplied = await cdp.evaluate(`document.querySelector('.composer-card')?.classList.contains('is-compact-toolbar') && document.querySelector('.composer-card')?.dataset.sendBehavior === 'shift-enter-sends'`);
            await cdp.evaluateWith(function (values) { for (const [key, value] of Object.entries(values)) value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); window.dispatchEvent(new Event('skai-command-workflows-changed')); return true; }, before);
            if (!promptInserted || !composerPreferencesApplied) throw new Error(`Saved slash prompts or composer preferences were not applied: ${JSON.stringify({ promptInserted, composerPreferencesApplied })}`);
            console.log(`[command-workflows] ${JSON.stringify({ personalizedShortcut: true, pinnedCommands: true, recentCommands: recentVisible, slashPromptInserted: promptInserted, compactToolbar: composerPreferencesApplied })}`);
          }
          if (process.env.UI_MATRIX_EXERCISE_TASK_NOTIFICATIONS === "1") {
            const notificationFlow = await cdp.evaluate(`(async () => {
              const keys = ['skai.taskNotifications.preferences.v1', 'skai.taskNotifications.history.v1', 'skai.taskNotifications.statuses.v1'];
              const previous = Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)]));
              let taskId = null;
              let notification = null;
              const originalNotification = Object.getOwnPropertyDescriptor(window, 'Notification');
              try {
                class MockNotification {
                  static permission = 'granted';
                  static calls = [];
                  constructor(title, options) { this.title = title; this.body = options?.body ?? ''; MockNotification.calls.push(this); }
                  close() {}
                }
                Object.defineProperty(window, 'Notification', { configurable: true, writable: true, value: MockNotification });
                localStorage.setItem(keys[0], JSON.stringify({ enabled: true, completed: true, failed: true, decisions: true, quietHours: false, quietStart: '22:00', quietEnd: '08:00', mutedProjectIds: [], showTaskTitles: false }));
                window.dispatchEvent(new Event('skai-task-notification-preferences-changed'));
                const planned = await window.skaiAgent.request('tasks.plan', { title: 'Notification smoke task', instruction: 'This task exists only to exercise private desktop notification delivery.', environment: 'local', requiresApproval: true });
                if (!planned.ok || !planned.result?.id) throw new Error(planned.error?.message ?? 'Could not create the notification fixture.');
                taskId = planned.result.id;
                let baseline = false;
                for (let i = 0; i < 100; i++) {
                  try { const state = JSON.parse(localStorage.getItem(keys[2]) ?? '{}'); if (state[taskId] === 'proposed') { baseline = true; break; } } catch {}
                  await new Promise((resolve) => setTimeout(resolve, 100));
                }
                if (!baseline) throw new Error('The monitor did not record the initial task state before its transition.');
                const queued = await window.skaiAgent.request('tasks.queue', { id: taskId });
                if (!queued.ok || queued.result?.status !== 'awaiting_approval') throw new Error(queued.error?.message ?? 'The notification fixture did not enter the approval state.');
                for (let i = 0; i < 120 && !MockNotification.calls.length; i++) await new Promise((resolve) => setTimeout(resolve, 100));
                notification = MockNotification.calls[0] ?? null;
                if (!notification || notification.title !== 'Skai task update' || !notification.body.includes('your attention') || notification.body.includes('Notification smoke task')) throw new Error('The grouped task alert was missing or exposed the task title by default: ' + JSON.stringify({ title: notification?.title, body: notification?.body, calls: MockNotification.calls.length, state: localStorage.getItem(keys[2]), preference: localStorage.getItem(keys[0]), taskId }));
                const history = JSON.parse(localStorage.getItem(keys[1]) ?? '[]');
                const item = history.find((entry) => entry.taskId === taskId);
                if (!item || item.delivery !== 'shown' || item.status !== 'awaiting_approval') throw new Error('The local notification delivery history did not record the approval alert.');
                notification.onclick?.();
                for (let i = 0; i < 50 && !document.querySelector('.usage-page'); i++) await new Promise((resolve) => setTimeout(resolve, 50));
                if (!document.querySelector('.usage-page')) throw new Error('Clicking the task alert did not return to the local task inbox.');
                return { taskStatus: item.status, privacyDefault: !notification.body.includes('Notification smoke task'), returnedToInbox: true, history: item.delivery };
              } finally {
                if (taskId) await window.skaiAgent.request('tasks.deny', { id: taskId }).catch(() => undefined);
                keys.forEach((key, index) => previous[key] === null ? localStorage.removeItem(key) : localStorage.setItem(key, previous[key]));
                window.dispatchEvent(new Event('skai-task-notification-preferences-changed'));
                if (originalNotification) Object.defineProperty(window, 'Notification', originalNotification);
              }
            })()`);
            if (!notificationFlow?.returnedToInbox) throw new Error(`The local task notification workflow was incomplete: ${JSON.stringify(notificationFlow)}`);
            console.log(`[task-notifications] ${JSON.stringify(notificationFlow)}`);
          }
        }
        if (route === "chat" && process.env.UI_MATRIX_EXERCISE_CHAT === "1") {
          const activeChatClass = await cdp.evaluate(`document.querySelector('.chat-page')?.className ?? ''`);
          if (!activeChatClass.includes("is-coding-agent") && process.env.UI_MATRIX_EXERCISE_CHAT_SEARCH !== "1") {
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
          if (process.env.UI_MATRIX_CAPTURE === "1" && process.env.UI_MATRIX_EXERCISE_CHAT_SEARCH === "1") {
            for (const title of ["Garden planning", "Vegetable garden tips", "Backyard garden ideas"]) if (!filteredHistory.includes(title)) throw new Error(`Conversation search omitted the matching result ${title}: ${filteredHistory}`);
            await cdp.evaluate(`([...document.querySelectorAll('.sidebar-history-row')].find((row) => row.innerText.includes('Garden planning'))?.querySelector('.sidebar-history-item')?.click(), 1)`);
            const selectedSearchResult = await cdp.evaluate(`(async () => { for (let i = 0; i < 40; i++) { if (document.querySelector('.chat-message.assistant')?.innerText.includes('simple garden plan')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
            if (!selectedSearchResult) throw new Error("Selecting a filtered conversation did not open its matching chat thread.");
            const activeSearch = await cdp.evaluate(`document.querySelector('.sidebar-search')?.value ?? ''`);
            if (activeSearch !== "garden") throw new Error(`Opening a search result unexpectedly cleared the search query: ${activeSearch}`);
            fs.mkdirSync(captureDirectory, { recursive: true });
            const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
            fs.writeFileSync(path.join(captureDirectory, "chat-search-1440.png"), Buffer.from(screenshot.data, "base64"));
          }
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
            await cdp.evaluateWith(function (title) { [...document.querySelectorAll('.sidebar-history-row')].find((row) => row.innerText.includes(title))?.querySelector('.sidebar-history-item')?.click(); return 1; }, chatTitle);
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
          if (process.env.UI_MATRIX_EXERCISE_DOCUMENTS_COMPOSER === "1" && width === 1440 && height === 900 && theme === "dark" && collapsed === "false") {
            await cdp.evaluate(`(() => { const target = document.querySelector('.composer-card'); if (!target) return false; const transfer = new DataTransfer(); transfer.items.add(new File(['Local workflow fixture: delivery met all targets.'], 'Revision4-Workflow.txt', { type: 'text/plain' })); target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })); return true; })()`);
            const dropped = await cdp.evaluate(`(async () => { for (let i = 0; i < 80; i++) { if (document.querySelector('.attachment-list-composer')?.innerText.includes('Revision4-Workflow.txt')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
            if (!dropped) throw new Error("Dropping the local text fixture did not attach it to the Chat composer.");
            await cdp.evaluate(`(() => { const input = document.querySelector('.composer-card textarea'); if (!input) return false; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Based only on this attached workflow note, summarize the result.'); input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
            await clickInRenderer(cdp, 'button[aria-label="Add to message"]');
            await clickInRenderer(cdp, '[role="menuitemcheckbox"]');
            await clickInRenderer(cdp, 'button[aria-label="Add to message"]');
            const documentsOnlyChecked = await cdp.evaluate(`document.querySelector('[role="menuitemcheckbox"]')?.getAttribute('aria-checked') === 'true'`);
            if (!documentsOnlyChecked) throw new Error("The Documents-only composer option did not remain checked after selection.");
            await clickInRenderer(cdp, 'button[aria-label="Add to message"]');
            const prepared = await cdp.evaluate(`(() => { const mode = document.querySelector('[role="menuitemcheckbox"]'); const send = document.querySelector('.composer-send-button[aria-label="Send message"]'); return { mode: mode?.getAttribute('aria-checked'), chip: document.querySelector('.composer-docs-chip')?.innerText ?? '', attachment: document.querySelector('.attachment-list-composer')?.innerText ?? '', prompt: document.querySelector('.composer-card textarea')?.value ?? '', sendEnabled: Boolean(send && !send.disabled) }; })()`);
            if (!prepared.chip.includes("Docs only") || !prepared.attachment.includes("Revision4-Workflow.txt") || !prepared.prompt.includes("attached workflow note") || !prepared.sendEnabled) throw new Error(`Documents-only composer preparation was incomplete: ${JSON.stringify(prepared)}`);
            if (process.env.UI_MATRIX_CAPTURE === "1") {
              await cdp.evaluate(`(() => { for (const selector of ['.app-main', '.app-content-chat', '.chat-column', '.message-list']) { const element = document.querySelector(selector); if (element) element.scrollTop = 0; } window.scrollTo(0, 0); return true; })()`);
              await sleep(120);
              fs.mkdirSync(path.join(__dirname, "..", "docs", "design-review", "workflow-collection", "revision-4"), { recursive: true });
              const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
              fs.writeFileSync(path.join(__dirname, "..", "docs", "design-review", "workflow-collection", "revision-4", "evidence-chat-documents-composer-1440.png"), Buffer.from(screenshot.data, "base64"));
            }
            await clickInRenderer(cdp, 'button[aria-label="Remove Revision4-Workflow.txt"]');
            await cdp.evaluate(`(() => { const input = document.querySelector('.composer-card textarea'); if (input) { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })); } return true; })()`);
            await clickInRenderer(cdp, 'button[aria-label="Add to message"]');
            await clickInRenderer(cdp, '[role="menuitemcheckbox"]');
            const cleanDraft = await cdp.evaluate(`!document.querySelector('.attachment-list-composer') && !document.querySelector('.composer-docs-chip')`);
            if (!cleanDraft) throw new Error("The document composer smoke did not clean up its local fixture draft.");
            console.log(`[documents-composer] ${JSON.stringify(prepared)}`);
          }
        }
        if (route === "chat" && process.env.UI_MATRIX_EXERCISE_VOICE === "1" && width === 1440 && height === 900) {
          await clickInRenderer(cdp, 'button[aria-label="Start voice mode"]');
          const voiceSessionReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 80; i++) { if (document.querySelector('.voice-mode-session[aria-label], .voice-mode-session') && document.querySelector('[aria-modal="true"] #voice-mode-title')) return true; await new Promise((r) => setTimeout(r, 100)); } return false; })()`);
          if (!voiceSessionReady) throw new Error(`Chat did not open its local Voice Mode session: ${JSON.stringify(await cdp.evaluate(`({ error: document.querySelector('.composer-voice-error,[role="status"]')?.textContent, active: document.querySelector('button[aria-label="End voice mode"]')?.getAttribute('aria-pressed') })`))}`);
          const voiceListeningReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 80; i++) { const status = document.querySelector('.voice-mode-state')?.textContent?.trim(); if (status === 'Listening on this device') return true; if (document.querySelector('.composer-voice-error,[role="status"]')?.textContent?.includes('Microphone access was denied')) return false; await new Promise((r) => setTimeout(r, 100)); } return false; })()`);
          if (!voiceListeningReady) throw new Error(`Voice Mode did not reach its local listening state: ${JSON.stringify(await cdp.evaluate(`({ status: document.querySelector('.voice-mode-state')?.textContent, error: document.querySelector('.composer-voice-error,[role="status"]')?.textContent })`))}`);
          const voiceState = await cdp.evaluate(`(() => { const end = [...document.querySelectorAll('.voice-mode-session button')].find((button) => button.textContent.includes('End voice mode')); const rect = end?.getBoundingClientRect(); const style = end && getComputedStyle(end); const heading = document.querySelector('#voice-mode-title')?.getBoundingClientRect(); const orb = document.querySelector('.voice-mode-orb')?.getBoundingClientRect(); const sliders = [...document.querySelectorAll('.voice-mode-expressiveness input')]; const sensitivity = sliders.find((input) => input.closest('label')?.innerText.includes('Mic sensitivity')); const meter = document.querySelector('.voice-mode-input-meter[role="meter"]'); return { title: document.querySelector('#voice-mode-title')?.textContent?.trim(), status: document.querySelector('.voice-mode-state')?.textContent?.trim(), liveStatus: document.querySelector('.voice-mode-state')?.getAttribute('aria-live'), end: Boolean(end), endText: end?.textContent, endBox: rect && [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)], headingBox: heading && [Math.round(heading.top), Math.round(heading.bottom)], orbBox: orb && [Math.round(orb.top), Math.round(orb.bottom)], endDisplay: style?.display, endOpacity: style?.opacity, viewportHeight: innerHeight, slider: sliders.length > 0, sensitivity: sensitivity && { value: sensitivity.value, label: sensitivity.closest('label')?.innerText }, meter: meter && { value: meter.getAttribute('aria-valuenow'), label: meter.getAttribute('aria-label') } }; })()`);
          if (voiceState.title !== "Voice conversation" || voiceState.status !== "Listening on this device" || voiceState.liveStatus !== "polite" || !voiceState.end || !voiceState.endBox?.[2] || voiceState.endBox[1] < 0 || voiceState.endBox[1] + voiceState.endBox[3] > voiceState.viewportHeight || !voiceState.headingBox || voiceState.headingBox[0] < 0 || voiceState.headingBox[1] > voiceState.viewportHeight || !voiceState.orbBox || voiceState.orbBox[0] < 0 || voiceState.orbBox[1] > voiceState.viewportHeight || !voiceState.slider || !voiceState.sensitivity || !voiceState.sensitivity.label.includes("Mic sensitivity") || !voiceState.meter || voiceState.meter.label !== "Microphone input level") throw new Error(`Voice Mode did not expose its accessible listening state, visible controls, sensitivity, and input meter: ${JSON.stringify(voiceState)}`);
          if (process.env.UI_MATRIX_CAPTURE === "1") {
            fs.mkdirSync(captureDirectory, { recursive: true });
            const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
            fs.writeFileSync(path.join(captureDirectory, `voice-mode-${width}.png`), Buffer.from(screenshot.data, "base64"));
          }
          const advancedVoiceControls = await cdp.evaluate(`(() => ({ input: Boolean(document.querySelector('[aria-label="Microphone input device"]')), output: Boolean(document.querySelector('[aria-label="Speaker output device"]')), outputMeter: Boolean(document.querySelector('[aria-label="Assistant audio output level"]')), handsFree: Boolean([...document.querySelectorAll('.voice-mode-toggle-row button')].find((button) => button.textContent.includes('Hands-free'))), pushToTalk: Boolean([...document.querySelectorAll('.voice-mode-toggle-row button')].find((button) => button.textContent.includes('Push to talk'))), calibration: Boolean([...document.querySelectorAll('.voice-mode-session button')].find((button) => button.textContent.includes('Calibrate microphone'))), transcript: Boolean(document.querySelector('[aria-label="Voice session transcript"]')), liveTranscriptRegion: document.querySelector('[aria-label="Voice session transcript"]')?.getAttribute('aria-live') === 'polite', review: Boolean(document.querySelector('input[type="checkbox"]')) }))()`);
          if (!advancedVoiceControls.input || !advancedVoiceControls.output || !advancedVoiceControls.outputMeter || !advancedVoiceControls.handsFree || !advancedVoiceControls.pushToTalk || !advancedVoiceControls.calibration || !advancedVoiceControls.transcript || !advancedVoiceControls.liveTranscriptRegion || !advancedVoiceControls.review) throw new Error(`Voice Mode is missing device, capture, calibration, or transcript controls: ${JSON.stringify(advancedVoiceControls)}`);
          await cdp.evaluate(`(() => { const checkbox = document.querySelector('.voice-mode-review input'); checkbox?.click(); return true; })()`);
          const reviewSaved = await cdp.evaluate(`localStorage.getItem('skai.voice.reviewBeforeSend') === 'true'`);
          await cdp.evaluate(`(() => { const checkbox = document.querySelector('.voice-mode-review input'); checkbox?.click(); return true; })()`);
          if (!reviewSaved) throw new Error("Transcript review preference did not persist locally.");
          await clickButtonText(cdp, "Push to talk", ".voice-mode-session");
          const pushToTalkMode = await cdp.evaluate(`({ stored: localStorage.getItem('skai.voice.interactionMode'), button: Boolean(document.querySelector('[aria-label="Hold to talk"]')), status: document.querySelector('.voice-mode-state')?.textContent?.trim() })`);
          if (pushToTalkMode.stored !== "push-to-talk" || !pushToTalkMode.button) throw new Error(`Push-to-talk mode did not expose a hold control: ${JSON.stringify(pushToTalkMode)}`);
          await clickButtonText(cdp, "Pause microphone", ".voice-mode-session");
          const pausedVoice = await cdp.evaluate(`document.querySelector('.voice-mode-state')?.textContent?.trim() === 'Microphone paused'`);
          await clickButtonText(cdp, "Resume microphone", ".voice-mode-session");
          await clickButtonText(cdp, "Hands-free", ".voice-mode-session");
          if (!pausedVoice || await cdp.evaluate(`localStorage.getItem('skai.voice.interactionMode') !== 'hands-free'`)) throw new Error("Voice Mode pause/resume or interaction-mode persistence failed.");
          const keyboardInterrupt = await cdp.evaluate(`(async () => { let stopped = false; window.addEventListener('skai:voice-playback-stopped', () => { stopped = true; }, { once: true }); window.dispatchEvent(new CustomEvent('skai:voice-playback', { detail: true })); let button = null; for (let i = 0; i < 20 && !button; i++) { button = [...document.querySelectorAll('.voice-mode-session button')].find((item) => item.textContent.includes('Ctrl+Shift+Space')); await new Promise((resolve) => setTimeout(resolve, 10)); } const event = new KeyboardEvent('keydown', { code: 'Space', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }); window.dispatchEvent(event); await new Promise((resolve) => setTimeout(resolve, 50)); return { stopped, button: Boolean(button), prevented: event.defaultPrevented }; })()`);
          if (!keyboardInterrupt.stopped || !keyboardInterrupt.button || !keyboardInterrupt.prevented) throw new Error(`Voice Mode keyboard interruption did not stop speech and expose its shortcut: ${JSON.stringify(keyboardInterrupt)}`);
          await cdp.evaluate(`(() => { const slider = [...document.querySelectorAll('.voice-mode-expressiveness input')].find((input) => input.closest('label')?.innerText.includes('Mic sensitivity')); if (!slider) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(slider, '75'); slider.dispatchEvent(new Event('input', { bubbles: true })); slider.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
          const sensitivitySaved = await cdp.evaluate(`localStorage.getItem('skai.voice.activitySensitivity') === '75'`);
          if (!sensitivitySaved) throw new Error("Voice Mode did not persist the selected microphone sensitivity.");
          console.log(`[voice] ${JSON.stringify(voiceState)}`);
          await cdp.evaluate(`(() => { for (const selector of ['.app-main', '.app-content-chat', '.chat-column', '.message-list']) { const element = document.querySelector(selector); if (element) element.scrollTop = 0; } window.scrollTo(0, 0); return 1; })()`);
          await sleep(350);
          await clickButtonText(cdp, "End voice mode", ".voice-mode-session");
          const voiceSessionClosed = await cdp.evaluate(`(async () => { for (let i = 0; i < 40; i++) { if (!document.querySelector('[aria-modal="true"] #voice-mode-title')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
          if (!voiceSessionClosed) throw new Error("End voice mode did not close the local voice session.");
        }
        if (route === "chat" && process.env.UI_MATRIX_EXERCISE_OMNIMODAL === "1" && width === 1440 && height === 900) {
          await clickInRenderer(cdp, 'button[aria-label="Add to message"]');
          const menu = await cdp.evaluate(`document.querySelector('[role="menu"][aria-label="Add to message"]')?.innerText ?? ''`);
          for (const label of ["Files and folders", "Audio file", "Documents only", "Voice input", "Voice Mode"]) {
            if (!menu.includes(label)) throw new Error(`The chat add menu omitted ${label}: ${JSON.stringify(menu)}`);
          }
          if (process.env.UI_MATRIX_CAPTURE === "1") {
            fs.mkdirSync(path.join(__dirname, "..", "docs", "design-review", "workflow-collection", "revision-4"), { recursive: true });
            const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
            fs.writeFileSync(path.join(__dirname, "..", "docs", "design-review", "workflow-collection", "revision-4", "evidence-chat-omnimodal-menu-1440.png"), Buffer.from(screenshot.data, "base64"));
          }
          await clickInRenderer(cdp, 'button[aria-label="Add to message"]');
          if (await cdp.evaluate(`Boolean(document.querySelector('[role="menu"][aria-label="Add to message"]'))`)) throw new Error("The chat add menu did not close after the second toggle.");
          console.log(`[chat-omnimodal] ${JSON.stringify({ menuItems: ["Files and folders", "Audio file", "Documents only", "Voice input", "Voice Mode"] })}`);
        }
        if (route === "usage" && process.env.UI_MATRIX_EXERCISE_SETTINGS_OVERLAY === "1" && width === 1440 && height === 900 && theme === "dark" && collapsed === "false") {
          await clickInRenderer(cdp, '.global-rail button[aria-label="Settings"]');
          const settingsOverlayReady = await cdp.evaluate(`(async () => { for (let i = 0; i < 60; i++) { if (document.querySelector('.usage-page') && document.querySelector('.settings-overlay [role="dialog"]')) return true; await new Promise((r) => setTimeout(r, 50)); } return false; })()`);
          if (!settingsOverlayReady) throw new Error("Settings did not open as a modal over the Usage page.");
          if (process.env.UI_MATRIX_CAPTURE === "1") {
            fs.mkdirSync(path.join(__dirname, "..", "docs", "design-review", "workflow-collection", "revision-4"), { recursive: true });
            const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
            fs.writeFileSync(path.join(__dirname, "..", "docs", "design-review", "workflow-collection", "revision-4", "evidence-settings-over-usage-1440.png"), Buffer.from(screenshot.data, "base64"));
          }
          await clickInRenderer(cdp, '.settings-overlay button[aria-label="Close settings"]');
          const usageRestored = await cdp.evaluate(`Boolean(document.querySelector('.usage-page') && !document.querySelector('.settings-overlay'))`);
          if (!usageRestored) throw new Error("Closing Settings did not return to the Usage page.");
          console.log(`[usage-settings-overlay] ${JSON.stringify({ modalOverUsage: true, returnToUsage: true })}`);
        }
        if (route === "usage" && exerciseCapacity && width === 1440 && height === 900 && theme === "dark" && collapsed === "false") {
          const capacityFlow = await cdp.evaluate(`(() => {
            const card = document.querySelector('.usage-capacity');
            card?.querySelector('details')?.setAttribute('open', '');
            const text = card?.textContent ?? '';
            const meters = [...(card?.querySelectorAll('[role="meter"]') ?? [])].map((meter) => meter.parentElement?.innerText ?? '');
            return { ok: Boolean(card) && text.includes('Capacity estimates and queue behavior') && text.includes('Measured locally:') && text.includes('Estimated:') && meters.some((meter) => meter.includes('Measured locally')), measured: meters.filter((meter) => meter.includes('Measured locally')).length, providerReported: meters.filter((meter) => meter.includes('Provider-reported')).length, estimated: text.includes('Estimated:') };
          })()`);
          if (!capacityFlow?.ok) throw new Error(`Usage capacity provenance labels were missing: ${JSON.stringify(capacityFlow)}`);
          console.log(`[capacity-provenance] ${JSON.stringify(capacityFlow)}`);
        }
        const states = route === "settings" ? settingsCategories : [null];
        for (const category of states) {
          if (category) {
            await cdp.evaluateWith(function (category) { [...document.querySelectorAll('.settings-nav button')].find((button) => button.textContent?.trim() === category)?.click(); return 1; }, category);
            await sleep(90);
            phase = `${theme}/${collapsed === "true" ? "collapsed" : "expanded"} ${width}x${height} #/settings (${category})`;
            if (route === "settings" && category === "Privacy & Security" && width === 1440 && height === 900 && theme === "dark" && collapsed === "false") {
              await cdp.evaluate(`(async () => { for (let i = 0; i < 60; i++) { const panel = document.querySelector('.permission-center'); if (panel?.innerText.includes('What is sandboxed') && panel.innerText.includes('CURRENT GRANT RULES') && panel.innerText.includes('Prompts do not grant access') && panel.innerText.includes('Permission audit')) return true; await new Promise((resolve) => setTimeout(resolve, 50)); } return false; })()`);
              const permissionCenter = await cdp.evaluate(`(() => { const panel = document.querySelector('.permission-center'); return { ready: Boolean(panel), heading: panel?.querySelector('h2')?.innerText, sandbox: panel?.innerText.includes('What is sandboxed'), grants: panel?.innerText.includes('CURRENT GRANT RULES'), injection: panel?.innerText.includes('Prompts do not grant access'), audit: panel?.innerText.includes('Permission audit') }; })()`);
              if (!permissionCenter.ready || permissionCenter.heading !== 'Permission center' || !permissionCenter.sandbox || !permissionCenter.grants || !permissionCenter.injection || !permissionCenter.audit) throw new Error(`Permission center did not disclose scopes, sandbox, untrusted-content boundaries, and audit history: ${JSON.stringify(permissionCenter)}`);
              console.log(`[permission-center] ${JSON.stringify(permissionCenter)}`);
              if (process.env.UI_MATRIX_EXERCISE_SUPPORT === '1') {
                const supportFlow = await cdp.evaluate(`(async () => {
                  const root = document.querySelector('.support-bundle-manager');
                  if (!root) return { ok: false, reason: 'support bundle manager is missing' };
                  const previewButton = [...root.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Preview bundle');
                  const downloadButton = [...root.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Download bundle');
                  const checkboxes = root.querySelectorAll('input[type="checkbox"]');
                  if (!previewButton || !downloadButton || checkboxes.length !== 4) return { ok: false, reason: 'support bundle controls are missing', checkboxCount: checkboxes.length };
                  previewButton.click();
                  let preview = null;
                  for (let i = 0; i < 80; i++) { preview = root.querySelector('.support-bundle-preview'); if (preview?.innerText.includes('Always excluded')) break; await new Promise((resolve) => setTimeout(resolve, 50)); }
                  const text = preview?.innerText ?? '';
                  return { ok: text.includes('Ready to review') && text.includes('Always excluded') && text.includes('Credentials') && text.includes('Machine paths') && downloadButton.disabled === false, redactions: text.includes('User content') && text.includes('Provider routes') };
                })()`);
                if (!supportFlow?.ok) throw new Error(`Support bundle workflow was not usable: ${JSON.stringify(supportFlow)}`);
                console.log(`[support-bundle-workflow] ${JSON.stringify(supportFlow)}`);
              }
            }
          }
          if (route === "settings" && category === "General" && process.env.UI_MATRIX_EXERCISE_TASK_NOTIFICATION_SETTINGS === "1" && width === 1440 && height === 900 && theme === "dark" && collapsed === "false") {
            const preferences = await cdp.evaluate(`(() => {
              const key = 'skai.taskNotifications.preferences.v1';
              const previous = localStorage.getItem(key);
              const panel = document.querySelector('.settings-notification-panel');
              const enabled = panel?.querySelector('.settings-notification-toggle input');
              const quiet = panel?.querySelector('.settings-notification-quiet input[type="checkbox"]');
              const times = panel?.querySelectorAll('.settings-notification-quiet input[type="time"]');
              const safePreview = [...(panel?.querySelectorAll('input[type="checkbox"]') ?? [])].find((input) => input.closest('label')?.innerText.includes('Show task titles'));
              const clear = () => { if (previous === null) localStorage.removeItem(key); else localStorage.setItem(key, previous); window.dispatchEvent(new Event('skai-task-notification-preferences-changed')); };
              const observation = panel?.querySelector('.settings-notification-observation');
              if (!panel || !enabled || !quiet || times?.length !== 2 || !safePreview || !observation?.innerText.includes('Local host status') || !observation.innerText.includes('local-only')) return { ok: false, reason: 'notification controls or local freshness disclosure are missing', panel: panel?.innerText.slice(0, 700) };
              const safeByDefault = !enabled.checked && !safePreview.checked;
              enabled.click(); quiet.click(); safePreview.click();
              const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
              setValue.call(times[0], '23:15'); times[0].dispatchEvent(new Event('input', { bubbles: true })); times[0].dispatchEvent(new Event('change', { bubbles: true }));
              const saved = JSON.parse(localStorage.getItem(key) ?? '{}');
              clear();
              return { ok: saved.enabled === true && saved.quietHours === true && saved.quietStart === '23:15' && saved.showTaskTitles === true, safeByDefault, quietWindow: saved.quietStart + '-' + saved.quietEnd };
            })()`);
            if (!preferences?.ok || !preferences.safeByDefault) throw new Error(`Task notification privacy and quiet-hour settings did not persist as expected: ${JSON.stringify(preferences)}`);
            console.log(`[task-notification-settings] ${JSON.stringify(preferences)}`);
          }
          if (route === "settings" && category === "Shortcuts" && process.env.UI_MATRIX_EXERCISE_COMMAND_WORKFLOWS === "1" && width === 1440 && height === 900 && theme === "dark" && collapsed === "false") {
            const workflow = await cdp.evaluate(`(async () => {
              const key = 'skai.command-workflows.v1';
              const previous = localStorage.getItem(key);
              const section = document.querySelector('.settings-command-workflows');
              const setValue = (element, value, prototype) => { Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); };
              if (!section || section.getAttribute('aria-labelledby') !== 'command-workflows-title') return { ok: false, reason: 'workflow settings missing', heading: document.querySelector('.settings-section-heading h1')?.textContent };
              section.querySelector('.settings-saved-prompts button')?.click();
              let prompt = section.querySelector('.settings-saved-prompt');
              for (let i = 0; i < 40 && !prompt; i++) { await new Promise((resolve) => setTimeout(resolve, 25)); prompt = section.querySelector('.settings-saved-prompt'); }
              if (!prompt) return { ok: false, reason: 'prompt create action missing' };
              const name = prompt.querySelector('.settings-command-fields input');
              setValue(name, 'Review Brief', HTMLInputElement.prototype);
              const alias = prompt.querySelector('input[aria-label="Slash alias for Review Brief"]');
              const body = prompt.querySelector('textarea');
              if (!alias || !body) return { ok: false, reason: 'prompt editor fields missing' };
              setValue(alias, 'brief', HTMLInputElement.prototype); setValue(body, 'Summarize the decision and list open questions.', HTMLTextAreaElement.prototype);
              const selectors = section.querySelectorAll('.settings-command-fields select');
              setValue(selectors[0], 'shift-enter-sends', HTMLSelectElement.prototype); setValue(selectors[1], 'compact', HTMLSelectElement.prototype);
              const shortcutButton = section.querySelector('button[aria-label="Change shortcut for New chat"]');
              shortcutButton?.click(); await new Promise((resolve) => setTimeout(resolve, 25)); shortcutButton?.dispatchEvent(new KeyboardEvent('keydown', { key: 'K', ctrlKey: true, bubbles: true, cancelable: true })); await new Promise((resolve) => setTimeout(resolve, 25));
              const conflictRejected = JSON.parse(localStorage.getItem(key) ?? '{}').shortcuts?.newChat !== 'Ctrl+K' && section.innerText.includes('already assigned');
              shortcutButton?.click(); await new Promise((resolve) => setTimeout(resolve, 25)); shortcutButton?.dispatchEvent(new KeyboardEvent('keydown', { key: 'J', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })); await new Promise((resolve) => setTimeout(resolve, 25));
              const capturedShortcut = JSON.parse(localStorage.getItem(key) ?? '{}').shortcuts?.newChat === 'Ctrl+Shift+J';
              const saved = JSON.parse(localStorage.getItem(key) ?? '{}');
              const promptSaved = saved.savedPrompts?.some((item) => item.name === 'Review Brief' && item.alias === 'brief' && item.prompt.startsWith('Summarize'));
              const customBehavior = saved.sendBehavior === 'shift-enter-sends' && saved.toolbarLayout === 'compact';
              if (previous === null) localStorage.removeItem(key); else localStorage.setItem(key, previous);
              window.dispatchEvent(new Event('skai-command-workflows-changed'));
              return { ok: promptSaved && customBehavior && conflictRejected && capturedShortcut, savedPrompt: promptSaved, sendAndToolbar: customBehavior, conflictRejected, capturedShortcut };
            })()`);
            if (!workflow?.ok) throw new Error(`Saved prompt aliases and composer preferences did not persist: ${JSON.stringify(workflow)}`);
            console.log(`[command-workflow-settings] ${JSON.stringify(workflow)}`);
          }
          if (route === "settings" && category === "Storage" && exerciseRetention && width === 1440 && height === 900 && theme === "dark" && collapsed === "false") {
            await cdp.evaluate(`(async () => { for (let i = 0; i < 60; i++) { const root = document.querySelector('.workspace-retention-card'); if (root?.querySelector('select[aria-label="Unpinned chats retention"]') && root.querySelector('select[aria-label="Generated media preview retention"]')) return true; await new Promise((resolve) => setTimeout(resolve, 50)); } return false; })()`);
            const retentionFlow = await cdp.evaluate(`(async () => {
              const root = document.querySelector('.workspace-retention-card');
              const chat = root?.querySelector('select[aria-label="Unpinned chats retention"]');
              const media = root?.querySelector('select[aria-label="Generated media preview retention"]');
              if (!chat || !media) return { ok: false, reason: 'retention controls are missing', heading: document.querySelector('.settings-section-heading h1')?.textContent, content: document.querySelector('.settings-content')?.innerText.slice(0, 500) };
              const setSelect = (select, value) => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, String(value)); select.dispatchEvent(new Event('change', { bubbles: true })); };
              const savedChat = Number(chat.value);
              setSelect(chat, 30);
              let saved = false;
              for (let i = 0; i < 40; i++) { const result = await window.skaiAgent.request('settings.get'); if (result.ok && result.result.chatRetentionDays === 30) { saved = true; break; } await new Promise((resolve) => setTimeout(resolve, 50)); }
              for (let i = 0; i < 40 && chat.disabled; i++) await new Promise((resolve) => setTimeout(resolve, 50));
              setSelect(chat, savedChat);
              let restored = false;
              for (let i = 0; i < 40; i++) { const result = await window.skaiAgent.request('settings.get'); if (result.ok && result.result.chatRetentionDays === savedChat) { restored = true; break; } await new Promise((resolve) => setTimeout(resolve, 50)); }
              const database = await new Promise((resolve, reject) => { const request = indexedDB.open('skai-image-history'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
              const oldId = 'retention-smoke-old'; const freshId = 'retention-smoke-fresh';
              await new Promise((resolve, reject) => { const tx = database.transaction('outputs', 'readwrite'); const store = tx.objectStore('outputs'); store.put({ id: oldId, url: 'data:image/png;base64,AA==', fileName: 'old.png', createdAt: new Date(Date.now() - 10 * 86400000).toISOString(), provider: 'comfyui', prompt: 'fixture' }); store.put({ id: freshId, url: 'data:image/png;base64,AA==', fileName: 'fresh.png', createdAt: new Date().toISOString(), provider: 'comfyui', prompt: 'fixture' }); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
              setSelect(media, 7);
              let mediaState = [];
              for (let i = 0; i < 40; i++) { mediaState = await new Promise((resolve, reject) => { const tx = database.transaction('outputs', 'readonly'); const request = tx.objectStore('outputs').getAll(); request.onsuccess = () => resolve(request.result.map((item) => item.id)); request.onerror = () => reject(request.error); }); if (!mediaState.includes(oldId) && mediaState.includes(freshId)) break; await new Promise((resolve) => setTimeout(resolve, 50)); }
              setSelect(media, 0);
              const mediaPruned = !mediaState.includes(oldId) && mediaState.includes(freshId);
              database.close();
              return { ok: saved && restored && mediaPruned, saved, restored, mediaPruned, controlCount: root.querySelectorAll('select').length };
            })()`);
            if (!retentionFlow?.ok) throw new Error(`Storage retention save/prune workflow failed: ${JSON.stringify(retentionFlow)}`);
            console.log(`[retention-workflow] ${JSON.stringify(retentionFlow)}`);
          }
          if (route === "settings" && category === "Storage" && exerciseBackup && width === 1440 && height === 900 && theme === "dark" && collapsed === "false") {
            const backupFlow = await cdp.evaluate(`(async () => {
              const root = document.querySelector('.workspace-backup-manager');
              if (!root) return { ok: false, reason: 'backup manager is missing' };
              const previewButton = [...root.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Preview export');
              const categories = root.querySelectorAll('.workspace-backup-categories input[type="checkbox"]');
              const restoreInput = root.querySelector('input[type="file"]');
              if (!previewButton || categories.length !== 4 || !restoreInput) return { ok: false, reason: 'backup controls are missing', categoryCount: categories.length };
              previewButton.click();
              let preview = null;
              for (let i = 0; i < 60; i++) { preview = root.querySelector('.workspace-backup-preview'); if (preview?.innerText.includes('Portable source:')) break; await new Promise((resolve) => setTimeout(resolve, 50)); }
              const text = preview?.innerText ?? '';
              const storage = root.querySelector('.workspace-storage-card')?.innerText ?? '';
              const retention = root.querySelector('.workspace-retention-card')?.innerText ?? '';
              return { ok: text.includes('Portable source:') && text.includes('Portable across Windows and Linux') && text.includes('Secret-like tokens are redacted') && storage.includes('Where Skai keeps data') && retention.includes('Automatic retention'), portable: text.includes('Portable across Windows and Linux'), redaction: text.includes('Secret-like tokens are redacted'), restore: Boolean(restoreInput), storage: storage.includes('What leaves this device'), retention: retention.includes('Automatic retention') };
            })()`);
            if (!backupFlow?.ok) throw new Error(`Workspace backup portability workflow failed: ${JSON.stringify(backupFlow)}`);
            console.log(`[workspace-backup-workflow] ${JSON.stringify(backupFlow)}`);
          }
          if (route === "settings" && category === "Appearance" && exerciseAccessibility && width === 1440 && height === 900 && theme === "dark" && collapsed === "false") {
            const accessibilityFlow = await cdp.evaluate(`(async () => {
              const gallery = document.querySelector('.theme-gallery');
              const search = gallery?.querySelector('input[aria-label="Search themes"]');
              if (!gallery || !search) return { ok: false, reason: 'theme gallery or accessible search is missing' };
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
              setter.call(search, 'High Contrast'); search.dispatchEvent(new Event('input', { bubbles: true }));
              let card = null;
              for (let i = 0; i < 60; i++) { card = [...gallery.querySelectorAll('.theme-card')].find((item) => item.innerText.includes('High Contrast Dark')); if (card) break; await new Promise((resolve) => setTimeout(resolve, 25)); }
              if (!card) return { ok: false, reason: 'high contrast theme was not discoverable' };
              card.focus(); card.click(); await new Promise((resolve) => setTimeout(resolve, 80));
              const previewed = Boolean(gallery.querySelector('.theme-gallery-preview-bar')) && card.classList.contains('is-previewing') && document.documentElement.dataset.themeId.toLowerCase().includes('high contrast');
              const status = gallery.querySelector('.theme-gallery-preview-bar[role="status"]');
              card.click(); await new Promise((resolve) => setTimeout(resolve, 40));
              const cancelled = !gallery.querySelector('.theme-gallery-preview-bar');
              return { ok: previewed && cancelled && Boolean(status), previewed, cancelled, hasStatus: Boolean(status), focused: document.activeElement === card };
            })()`);
            if (!accessibilityFlow?.ok) throw new Error(`Accessibility theme discovery workflow failed: ${JSON.stringify(accessibilityFlow)}`);
            console.log(`[accessibility-theme-workflow] ${JSON.stringify(accessibilityFlow)}`);
          }
          if (route === "settings" && category === "Voice & Audio" && process.env.UI_MATRIX_EXERCISE_VOICE_PRESETS === "1" && width === 1440 && height === 900 && theme === "dark" && collapsed === "false") {
            const presetWorkflow = await cdp.evaluate(`(async () => {
              const root = document.querySelector('.voice-preset-manager');
              if (!root) return { ok: false, reason: 'voice preset controls are missing' };
              localStorage.removeItem('skai.voice.presets.v1');
              window.dispatchEvent(new CustomEvent('skai:voice-presets-updated'));
              const name = root.querySelector('input');
              const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
              inputSetter.call(name, 'Matrix voice preset');
              name.dispatchEvent(new Event('input', { bubbles: true }));
              [...root.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Save preset')?.click();
              await new Promise((resolve) => setTimeout(resolve, 30));
              const preset = JSON.parse(localStorage.getItem('skai.voice.presets.v1') || '[]')[0];
              if (!preset || preset.name !== 'Matrix voice preset') return { ok: false, reason: 'save did not persist a named preset' };
              const slider = document.querySelector('#voice-expressiveness');
              if (!slider) return { ok: false, reason: 'expressiveness control is missing' };
              inputSetter.call(slider, String(preset.settings.expressiveness === 100 ? 0 : 100));
              slider.dispatchEvent(new Event('input', { bubbles: true }));
              slider.dispatchEvent(new Event('change', { bubbles: true }));
              const select = root.querySelector('select');
              Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, preset.id);
              select.dispatchEvent(new Event('change', { bubbles: true }));
              [...root.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Apply')?.click();
              await new Promise((resolve) => setTimeout(resolve, 60));
              const restored = Number(document.querySelector('#voice-expressiveness')?.value) === preset.settings.expressiveness;
              [...root.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Remove')?.click();
              await new Promise((resolve) => setTimeout(resolve, 30));
              return { ok: restored && JSON.parse(localStorage.getItem('skai.voice.presets.v1') || '[]').length === 0, restored, removed: JSON.parse(localStorage.getItem('skai.voice.presets.v1') || '[]').length === 0 };
            })()`);
            if (!presetWorkflow?.ok) throw new Error(`Voice preset save/apply/remove workflow failed: ${JSON.stringify(presetWorkflow)}`);
            console.log(`[voice-preset-workflow] ${JSON.stringify(presetWorkflow)}`);
          }
          if (route === "coding") {
            await cdp.evaluate(`(() => { for (const selector of ['.app-main', '.app-content-coding', '.coding-session-grid', '.project-thread-panel .message-list']) { const element = document.querySelector(selector); if (element) element.scrollTop = 0; } window.scrollTo(0, 0); return 1; })()`);
            const readHarnessCatalog = async () => cdp.evaluate(`(() => { const panel = document.querySelector('.coding-harness-adapters'); if (!panel) return null; if (!panel.open) panel.querySelector('summary')?.click(); const button = panel.querySelector('button'); return { available: panel.innerText.includes('Skai Local Agent'), summary: panel.querySelector('summary')?.innerText, externalNotClaimedReady: ![...panel.querySelectorAll('li')].some((item) => item.innerText.includes('Detected') && item.innerText.includes('not connected') && item.innerText.includes('Ready')), distinguishesNativeAndSkai: panel.innerText.includes('Skai integration') && panel.innerText.includes('not verified by Skai'), authUnknownIsDisclosed: panel.innerText.includes('Sign-in status is unknown.'), refreshAvailable: Boolean(button?.innerText.includes('Check harness health') && !button.disabled), probeDisclosure: panel.innerText.includes('--version') }; })()`);
            let harnessCatalog = null;
            for (let attempt = 0; attempt < 80; attempt += 1) {
              harnessCatalog = await readHarnessCatalog();
              if (harnessCatalog?.summary?.includes('1 ready') && harnessCatalog.refreshAvailable) break;
              await sleep(200);
            };
            if (!harnessCatalog) harnessCatalog = await cdp.evaluate(`(() => ({ available: false, page: document.querySelector(".feature-page")?.className, title: document.title, body: document.body.innerText.slice(0, 500) }))()`);
            if (!harnessCatalog?.available || !harnessCatalog.externalNotClaimedReady || !harnessCatalog.distinguishesNativeAndSkai || !harnessCatalog.authUnknownIsDisclosed || !harnessCatalog.refreshAvailable || !harnessCatalog.probeDisclosure || !harnessCatalog.summary.includes("contract v2")) throw new Error(`The Coding workspace did not show the versioned, honest harness capability/health catalog at ${phase}: ${JSON.stringify(harnessCatalog)}`);
            await clickButtonText(cdp, "Check harness health", ".coding-harness-adapters");
            let refreshedHarnesses = false;
            for (let attempt = 0; attempt < 80; attempt += 1) {
              refreshedHarnesses = await cdp.evaluate(`Boolean([...document.querySelectorAll(".coding-harness-adapters button")].find((item) => item.innerText.includes("Check harness health") && !item.disabled))`);
              if (refreshedHarnesses) break;
              await sleep(200);
            }
            if (!refreshedHarnesses) throw new Error("Refreshing executable detection did not return the harness catalog to its ready state.");
            if (process.env.UI_MATRIX_CAPTURE === "1" && width === 1440 && height === 900) {
              fs.mkdirSync(captureDirectory, { recursive: true });
              const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
              fs.writeFileSync(path.join(captureDirectory, "coding-harness-adapters-1440.png"), Buffer.from(screenshot.data, "base64"));
            }
          }
          if (((route === "marketplace" && exerciseMcpReview) || (route === "chat" && process.env.UI_MATRIX_EXERCISE_OMNIMODAL === "1")) && width === 1440 && height === 900) {
            await cdp.evaluate(`(() => { window.scrollTo(0, 0); document.querySelectorAll('*').forEach((element) => { if (element.scrollTop) element.scrollTop = 0; if (element.scrollLeft) element.scrollLeft = 0; }); return true; })()`);
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
  if (taskProgressServer) {
    taskProgressServer.closeAllConnections();
    await new Promise((resolve) => taskProgressServer.close(() => resolve()));
  }
  if (sideChatServer) {
    sideChatServer.closeAllConnections();
    await new Promise((resolve) => sideChatServer.close(() => resolve()));
  }
  if (mcpReviewServer) {
    mcpReviewServer.closeAllConnections();
    await new Promise((resolve) => mcpReviewServer.close(() => resolve()));
  }
  if (process.platform === "win32" && child.pid) {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    await Promise.race([
      new Promise((resolve) => { killer.once("close", resolve); killer.once("error", resolve); }),
      sleep(5000),
    ]);
    if (killer.exitCode === null && !killer.killed) killer.kill();
  } else if (!child.killed) child.kill("SIGTERM");
  await sleep(1500);
  try { fs.rmSync(temp, { recursive: true, force: true }); } catch { /* the app may release files shortly after exit */ }
});
