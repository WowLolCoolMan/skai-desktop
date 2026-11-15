const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { resolveDisplayBackend } = require("../apps/desktop/electron/linux-windowing.cjs");
// Pick the Linux display backend up front; otherwise the app relaunches itself and the spawned PID is not the app.
const displayBackendArgs = ((decision) => decision.switchValue ? [`--ozone-platform=${decision.switchValue}`] : [])(resolveDisplayBackend({ argv: [] }));

const defaultName = process.platform === "win32" ? "Skai Desktop.exe" : "Skai Desktop";
const defaultRoot = path.join(__dirname, "..", "dist", "electron", `${process.platform === "win32" ? "win" : process.platform}-x64`);
const executable = path.resolve(process.argv[2] || path.join(defaultRoot, defaultName));
const artifactRoot = path.dirname(executable);
const port = 19321;
const timeoutMs = 20_000;

if (!fs.existsSync(executable)) {
  console.error(`Electron artifact does not exist: ${executable}`);
  process.exit(1);
}
const packagedAirLlmWorker = path.join(artifactRoot, "resources", "agent-host", "airllm", "skai_airllm.py");
if (!fs.existsSync(packagedAirLlmWorker)) {
  console.error(`Packaged AirLLM worker does not exist: ${packagedAirLlmWorker}`);
  process.exit(1);
}
const artifactManifestPath = path.join(artifactRoot, "artifact-manifest.json");
if (!fs.existsSync(artifactManifestPath)) {
  console.error(`Packaged artifact manifest does not exist: ${artifactManifestPath}`);
  process.exit(1);
}
const artifactManifest = JSON.parse(fs.readFileSync(artifactManifestPath, "utf8"));
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
if (artifactManifest.executable !== path.basename(executable) || artifactManifest.files?.executable !== sha256(executable) || artifactManifest.files?.agentHost !== sha256(path.join(artifactRoot, "resources", "agent-host", process.platform === "win32" ? "ServerRock.AgentHost.exe" : "ServerRock.AgentHost")) || artifactManifest.files?.airLlmWorker !== sha256(packagedAirLlmWorker)) {
  console.error(`Packaged artifact manifest does not match the staged files: ${artifactManifestPath}`);
  process.exit(1);
}

const smokeUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "skai-electron-smoke-"));
const child = spawn(executable, [`--remote-debugging-port=${port}`, "--disable-gpu", ...displayBackendArgs, `--user-data-dir=${smokeUserDataDir}`], { cwd: path.dirname(executable), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
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
    const seen = [];
    const timer = setTimeout(() => reject(new Error(`DevTools evaluation timed out. Messages seen: ${seen.join(" | ")}`)), 20_000);
    socket.addEventListener("message", (event) => {
      const raw = typeof event.data === "string" ? event.data : String(event.data);
      const message = JSON.parse(raw);
      seen.push(`id=${String(message.id)} method=${String(message.method)} hasResult=${Boolean(message.result)}`);
      if (message.id !== id) return;
      clearTimeout(timer);
      if (message.error) reject(new Error(message.error.message));
      else if (!message.result?.result) reject(new Error(`DevTools evaluation returned no result: ${JSON.stringify(message)}`));
      else resolve(message.result.result.value);
      socket.close();
    });
      socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
  });
  return result;
}

async function main() {
  const deadline = Date.now() + timeoutMs;
  let mainTarget;
  let petTarget;
  while (Date.now() < deadline) {
    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      const pages = targets.filter((item) => item.type === "page");
      mainTarget = pages.find((item) => item.title?.includes("Skai Desktop") && !item.url?.includes("?pet=1"));
      petTarget = pages.find((item) => item.title?.includes("Percy") || item.url?.includes("?pet=1"));
      if (mainTarget && petTarget) break;
    } catch { /* The packaged window is still starting. */ }
    await sleep(250);
  }
  if (!mainTarget || !petTarget) throw new Error(`Packaged Electron did not expose both main and Percy pages before timeout. Output: ${output.slice(-2_000)}`);
  console.log(`Packaged main target: ${JSON.stringify({ title: mainTarget.title, url: mainTarget.url, type: mainTarget.type, websocket: Boolean(mainTarget.webSocketDebuggerUrl) })}`);
  console.log(`Packaged Percy target: ${JSON.stringify({ url: petTarget.url, type: petTarget.type, websocket: Boolean(petTarget.webSocketDebuggerUrl) })}`);
  // The page target can appear before React mounts (slow CI runners); wait for the app shell before reading it.
  const mainResult = await evaluate(mainTarget, "(async () => { const ready = () => Boolean(document.querySelector('[aria-label=\\\"Primary navigation\\\"]')) && document.body.innerText.includes('Settings'); for (let waited = 0; !ready() && waited < 15000; waited += 100) await new Promise((resolve) => setTimeout(resolve, 100)); return JSON.stringify({ title: document.title, settings: document.body.innerText.includes('Settings'), navigation: Boolean(document.querySelector('[aria-label=\\\"Primary navigation\\\"]')) }); })()");
  const settingsResult = await evaluate(mainTarget, "(async () => { location.hash = '#/settings'; await new Promise((resolve) => setTimeout(resolve, 250)); const tab = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Models & Providers'); if (!tab) return JSON.stringify({ route: location.hash, tab: false, airLlmCheck: false, petControls: false }); tab.click(); await new Promise((resolve) => setTimeout(resolve, 100)); const airLlmCheck = [...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Check AirLLM'); const petTab = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Pet'); if (!petTab) return JSON.stringify({ route: location.hash, tab: true, airLlmCheck, petControls: false }); petTab.click(); await new Promise((resolve) => setTimeout(resolve, 100)); return JSON.stringify({ route: location.hash, tab: true, airLlmCheck, petControls: document.body.innerText.includes('Show Percy') && document.body.innerText.includes('Let Percy walk around') }); })()");
  const marketplaceResult = await evaluate(mainTarget, "(async () => { location.hash = '#/marketplace'; await new Promise((resolve) => setTimeout(resolve, 300)); const modelsTab = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Models'); if (!modelsTab) return JSON.stringify({ route: location.hash, modelsTab: false, reviewButton: false, reviewDialog: false, confirmButton: false }); modelsTab.click(); await new Promise((resolve) => setTimeout(resolve, 700)); const reviewButton = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Review install'); if (!reviewButton) return JSON.stringify({ route: location.hash, modelsTab: true, reviewButton: false, reviewDialog: false, confirmButton: false }); reviewButton.click(); await new Promise((resolve) => setTimeout(resolve, 100)); return JSON.stringify({ route: location.hash, modelsTab: true, reviewButton: true, reviewDialog: Boolean(document.querySelector('[role=\\\"dialog\\\"][aria-label=\\\"Verify model installation\\\"]')), confirmButton: [...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Confirm and install locally') }); })()");
  const installedResult = await evaluate(mainTarget, "(async () => { const installedTab = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Installed'); if (!installedTab) return JSON.stringify({ route: location.hash, installedTab: false, inventoryPane: false }); installedTab.click(); await new Promise((resolve) => setTimeout(resolve, 300)); return JSON.stringify({ route: location.hash, installedTab: true, inventoryPane: Boolean(document.querySelector('.marketplace-installed-pane')), inventoryHeading: document.body.innerText.includes('Installed models') }); })()");
  const modelsResult = await evaluate(mainTarget, "(async () => { location.hash = '#/models'; await new Promise((resolve) => setTimeout(resolve, 250)); const input = document.querySelector('input[aria-label=\\\"Ollama model name\\\"]'); if (!input) return JSON.stringify({ route: location.hash, input: false, reviewButton: false, reviewDialog: false, confirmButton: false }); const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setValue?.call(input, 'llama3.2:latest'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 100)); const reviewButton = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Review download'); if (!reviewButton) return JSON.stringify({ route: location.hash, input: true, reviewButton: false, reviewDialog: false, confirmButton: false }); reviewButton.click(); await new Promise((resolve) => setTimeout(resolve, 100)); return JSON.stringify({ route: location.hash, input: true, reviewButton: true, reviewDialog: Boolean(document.querySelector('[role=\\\"dialog\\\"][aria-label=\\\"Review local model download\\\"]')), confirmButton: [...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Confirm local download') }); })()");
  const petResult = await evaluate(petTarget, "JSON.stringify((() => { const root = document.querySelector('[aria-label=\\\"Percy desktop companion. Drag to move.\\\"]'); const sprite = document.querySelector('.pet-window-sprite'); const style = sprite ? getComputedStyle(sprite) : null; const transparent = getComputedStyle(document.body).backgroundColor === 'rgba(0, 0, 0, 0)'; const opaque = document.documentElement.dataset.petSurface === 'opaque' && !transparent; return { title: document.title, companion: Boolean(root), sprite: Boolean(sprite), transparent, opaque, animated: Boolean(style?.animationName && style.animationName !== 'none') }; })())");
  if (typeof mainResult !== "string" || typeof settingsResult !== "string" || typeof marketplaceResult !== "string" || typeof installedResult !== "string" || typeof modelsResult !== "string" || typeof petResult !== "string") throw new Error(`Packaged Electron returned an unexpected evaluation value: ${JSON.stringify({ mainResult, settingsResult, marketplaceResult, installedResult, modelsResult, petResult })}`);
  const mainState = JSON.parse(mainResult);
  const settingsState = JSON.parse(settingsResult);
  const marketplaceState = JSON.parse(marketplaceResult);
  const installedState = JSON.parse(installedResult);
  const modelsState = JSON.parse(modelsResult);
  const petState = JSON.parse(petResult);
  if (mainTarget.id === petTarget.id || !petTarget.url?.includes("pet=1") || !mainState.title.includes("Skai Desktop") || !mainState.settings || !mainState.navigation || settingsState.route !== "#/settings" || !settingsState.tab || !settingsState.airLlmCheck || !settingsState.petControls || marketplaceState.route !== "#/marketplace" || !marketplaceState.modelsTab || !marketplaceState.reviewButton || !marketplaceState.reviewDialog || !marketplaceState.confirmButton || installedState.route !== "#/marketplace" || !installedState.installedTab || !installedState.inventoryPane || !installedState.inventoryHeading || modelsState.route !== "#/models" || !modelsState.input || !modelsState.reviewButton || !modelsState.reviewDialog || !modelsState.confirmButton || !petState.title.includes("Percy") || !petState.companion || !petState.sprite || (!petState.transparent && !petState.opaque) || !petState.animated) {
    throw new Error(`Packaged Electron rendered incomplete surfaces: ${JSON.stringify({ mainState, settingsState, marketplaceState, installedState, modelsState, petState })}`);
  }
  console.log(`Packaged Electron smoke passed: ${mainState.title}; Marketplace review gate, Percy renderer title=${petState.title}, separate transparent surface with animated sprite; AirLLM worker staged.`);
}

async function cleanup() {
  if (child.exitCode === null && child.signalCode === null) {
    if (process.platform === "win32") {
      await new Promise((resolve) => {
        const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.once("close", resolve);
        killer.once("error", resolve);
      });
    } else {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("close", resolve));
    }
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(smokeUserDataDir, { recursive: true, force: true });
      return;
    } catch {
      await sleep(100);
    }
  }
  console.warn(`Unable to remove temporary Electron smoke data: ${smokeUserDataDir}`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(cleanup);
