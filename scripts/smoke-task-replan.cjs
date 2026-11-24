const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { resolveDisplayBackend } = require("../apps/desktop/electron/linux-windowing.cjs");
// Pick the Linux display backend up front; otherwise the app relaunches itself and the spawned PID is not the app.
const displayBackendArgs = ((decision) => decision.switchValue ? [`--ozone-platform=${decision.switchValue}`] : [])(resolveDisplayBackend({ argv: [] }));

const defaultName = process.platform === "win32" ? "Skai Desktop.exe" : "Skai Desktop";
const defaultRoot = path.join(__dirname, "..", "dist", "electron", `${process.platform === "win32" ? "win" : process.platform}-x64`);
const executable = path.resolve(process.argv[2] || path.join(defaultRoot, defaultName));
const port = 19322;
const timeoutMs = 20_000;
const prefillKey = "skai.chat.taskPrefill";
const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skai-task-replan-"));
const appDataDir = path.join(profileRoot, "appdata");
const electronDataDir = path.join(profileRoot, "electron");
const agentProfile = path.join(profileRoot, "agent-profile");
for (const directory of [appDataDir, electronDataDir, agentProfile]) fs.mkdirSync(directory, { recursive: true });

if (!fs.existsSync(executable)) {
  console.error(`Electron artifact does not exist: ${executable}`);
  process.exit(1);
}

const child = spawn(executable, [`--remote-debugging-port=${port}`, `--user-data-dir=${electronDataDir}`, `--skai-isolated-smoke-app-data=${appDataDir}`, "--disable-gpu", ...displayBackendArgs], { cwd: path.dirname(executable), env: {
  ...process.env,
  SKAI_ELECTRON_SMOKE: "true",
  SKAI_SKIP_LEGACY_DATA_MIGRATION: "true",
  APPDATA: appDataDir,
  LOCALAPPDATA: path.join(profileRoot, "localappdata"),
  XDG_CONFIG_HOME: path.join(profileRoot, "config"),
  XDG_DATA_HOME: path.join(profileRoot, "data"),
  XDG_CACHE_HOME: path.join(profileRoot, "cache"),
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
}, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
child.stdout.on("data", (chunk) => { output += chunk.toString(); });
child.stderr.on("data", (chunk) => { output += chunk.toString(); });

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.json();
}

async function evaluate(target, expression) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  const result = await new Promise((resolve, reject) => {
    const id = 1;
    const timer = setTimeout(() => reject(new Error("DevTools evaluation timed out.")), 5_000);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
      if (message.id !== id) return;
      clearTimeout(timer);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result?.result?.value);
      socket.close();
    });
    socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
  });
  return result;
}

async function main() {
  const deadline = Date.now() + timeoutMs;
  let target;
  while (Date.now() < deadline) {
    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      target = targets.find((item) => item.type === "page" && item.title?.includes("Skai") && !item.url?.includes("?pet=1"));
      if (target) break;
    } catch { /* The packaged window is still starting. */ }
    await sleep(250);
  }
  if (!target) throw new Error(`Packaged Electron did not expose the main page before timeout. Output: ${output.slice(-2_000)}`);

  const readyChat = await evaluate(target, `(async () => {
    location.hash = "#/chat"; window.dispatchEvent(new PopStateEvent("popstate"));
    for (let i = 0; i < 40 && !document.querySelector('.chat-page'); i++) await new Promise((resolve) => setTimeout(resolve, 100));
    const trigger = document.querySelector(".overflow-menu-trigger[aria-label='Chat options']");
    if (!document.querySelector('.chat-layout.has-chat-tools')) {
      if (!trigger) return false;
      trigger.click();
      for (let i = 0; i < 30 && !document.querySelector('.overflow-menu-item'); i++) await new Promise((resolve) => setTimeout(resolve, 50));
      [...document.querySelectorAll('.overflow-menu-item')].find((item) => item.textContent.includes('Show task tools'))?.click();
    }
    for (let i = 0; i < 30 && !document.querySelector('.chat-task-composer'); i++) await new Promise((resolve) => setTimeout(resolve, 50));
    return Boolean(document.querySelector('.chat-task-composer'));
  })()`);
  if (!readyChat) throw new Error("Could not enable the Chat task planner from Chat options.");
  const staged = await evaluate(target, `localStorage.setItem(${JSON.stringify(prefillKey)}, JSON.stringify({ title: "Recover local task", instruction: "Review the failed result and produce a verified local plan.", environment: "local" })); window.dispatchEvent(new Event('skai:task-prefill')); "staged"`);
  if (staged !== "staged") throw new Error(`Could not stage the task handoff: ${JSON.stringify(staged)}`);

  let state;
  const renderDeadline = Date.now() + 8_000;
  while (Date.now() < renderDeadline) {
    await sleep(250);
    const raw = await evaluate(target, `JSON.stringify({ hash: location.hash, title: document.querySelector("#chat-task-composer-fields input")?.value || "", instruction: document.querySelector("#chat-task-composer-fields textarea")?.value || "", open: Boolean(document.querySelector("#chat-task-composer-fields")), consumed: localStorage.getItem(${JSON.stringify(prefillKey)}) === null })`);
    if (typeof raw === "string") state = JSON.parse(raw);
    if (state?.hash === "#/chat" && state.open && state.title && state.instruction && state.consumed) break;
  }
  if (!state?.open || state.title !== "Recover local task" || !state.instruction.includes("verified local plan") || !state.consumed) {
    throw new Error(`Task re-plan handoff did not render as expected: ${JSON.stringify(state)}`);
  }
  console.log(`Packaged task re-plan smoke passed: ${JSON.stringify({ route: state.hash, title: state.title, composerOpen: state.open, prefillConsumed: state.consumed })}`);
}

async function stopChild() {
  if (child.exitCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    await new Promise((resolve) => { killer.once("close", resolve); killer.once("error", resolve); });
  } else if (!child.killed) {
    child.kill("SIGTERM");
  }
  await new Promise((resolve) => child.once("exit", resolve));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  await stopChild();
  try { fs.rmSync(profileRoot, { recursive: true, force: true }); } catch { /* Electron may release the profile shortly after exit. */ }
});
