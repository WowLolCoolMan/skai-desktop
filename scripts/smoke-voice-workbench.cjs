const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");

const desktopRoot = path.join(__dirname, "..", "apps", "desktop");
const electronBinary = require(path.join(desktopRoot, "node_modules", "electron"));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "skai-voice-workbench-smoke-"));
const profileDir = path.join(temp, "profile");
const fixturesDir = path.join(temp, "fixtures");
fs.mkdirSync(fixturesDir, { recursive: true });
const env = {
  ...process.env,
  SKAI_ELECTRON_SMOKE: "true",
  SKAI_SKIP_LEGACY_DATA_MIGRATION: "true",
  APPDATA: path.join(temp, "appdata"),
  LOCALAPPDATA: path.join(temp, "localappdata"),
  XDG_CONFIG_HOME: path.join(temp, "config"),
  XDG_DATA_HOME: path.join(temp, "data"),
  XDG_CACHE_HOME: path.join(temp, "cache"),
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeWav(filePath, frequency = 440) {
  const sampleRate = 16_000;
  const samples = sampleRate / 2;
  const dataBytes = samples * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + dataBytes, 4); wav.write("WAVE", 8);
  wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < samples; index += 1) wav.writeInt16LE(Math.round(Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 8000), 44 + index * 2);
  fs.writeFileSync(filePath, wav);
}

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

let child;
let socket;
let sequence = 1;
const pending = new Map();
let output = "";

async function command(method, params = {}) {
  const id = sequence++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timed out: ${method}`)); }, 15_000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(`Renderer evaluation failed: ${result.exceptionDetails.text}`);
  return result.result?.value;
}

async function waitFor(predicate, label, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(predicate)) return;
    await sleep(150);
  }
  const excerpt = await evaluate("document.body.innerText.slice(-1200)").catch(() => "");
  throw new Error(`Timed out waiting for ${label}. Renderer text: ${excerpt}`);
}

async function setInputFiles(selector, files) {
  const { root } = await command("DOM.getDocument", { depth: -1 });
  const { nodeId } = await command("DOM.querySelector", { nodeId: root.nodeId, selector });
  if (!nodeId) throw new Error(`Could not find file input: ${selector}`);
  const { node } = await command("DOM.describeNode", { nodeId });
  await command("DOM.setFileInputFiles", { files, backendNodeId: node.backendNodeId });
}

async function main() {
  const port = await getFreePort();
  child = spawn(electronBinary, [".", `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`], {
    cwd: desktopRoot, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });

  let target;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const pages = await response.json();
      target = pages.find((page) => page.type === "page" && page.title?.includes("Skai Desktop"));
      if (target) break;
    } catch { /* Electron is still starting. */ }
    if (child.exitCode !== null) throw new Error(`Electron exited during startup. ${output.slice(-2500)}`);
    await sleep(150);
  }
  if (!target) throw new Error(`Electron did not expose the Skai window. ${output.slice(-2500)}`);

  socket = new WebSocket(target.webSocketDebuggerUrl);
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id); clearTimeout(waiter.timer);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result ?? {});
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  await command("Runtime.enable");
  await command("DOM.enable");

  await evaluate("location.hash = '#/voice-workbench'");
  await waitFor("Boolean(document.querySelector('.voice-workbench-view'))", "Voice Workbench page");
  const noticeButton = await evaluate("[...document.querySelectorAll('button')].find((button) => button.textContent.includes('I understand'))?.textContent || ''");
  if (noticeButton) await evaluate("[...document.querySelectorAll('button')].find((button) => button.textContent.includes('I understand'))?.click()");
  await evaluate("(() => { const input = document.querySelector('[aria-label=\"New voice profile name\"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Clip library acceptance'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Create')?.click(); })()");
  await waitFor("document.querySelector('.voice-workbench-add-clips input') !== null", "new voice profile");

  const firstDir = path.join(fixturesDir, "first");
  const secondDir = path.join(fixturesDir, "second");
  fs.mkdirSync(firstDir); fs.mkdirSync(secondDir);
  const firstClip = path.join(firstDir, "same-name.wav");
  const secondClip = path.join(secondDir, "same-name.wav");
  makeWav(firstClip, 440); makeWav(secondClip, 660);
  await setInputFiles(".voice-workbench-add-clips input", [firstClip, secondClip]);
  await waitFor("document.querySelectorAll('.voice-workbench-clip').length === 2", "both same-named clips to be saved");
  const previewMetadata = await evaluate("(async () => { const players = [...document.querySelectorAll('.voice-workbench-clip audio')]; if (players.length !== 2 || players.some((audio) => !audio.src.startsWith('blob:'))) return []; return Promise.all(players.map((audio) => new Promise((resolve) => { const timer = setTimeout(() => resolve(0), 5000); audio.addEventListener('loadedmetadata', () => { clearTimeout(timer); resolve(audio.duration); }, { once: true }); audio.addEventListener('error', () => { clearTimeout(timer); resolve(0); }, { once: true }); audio.load(); }))); })()");
  if (!Array.isArray(previewMetadata) || previewMetadata.length !== 2 || previewMetadata.some((duration) => duration < 0.4)) {
    const diagnostics = await evaluate("(async () => { const db = await new Promise((resolve, reject) => { const request = indexedDB.open('skai-voice-workbench', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); const records = await new Promise((resolve, reject) => { const request = db.transaction('clips').objectStore('clips').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); db.close(); const current = [...document.querySelectorAll('.voice-workbench-clip audio')].map((audio) => ({ src: audio.src.slice(0, 40), error: audio.error?.code, networkState: audio.networkState, readyState: audio.readyState, duration: audio.duration })); const fresh = await Promise.all(records.map(async (record) => { const bytes = [...new Uint8Array(await record.blob.slice(0, 48).arrayBuffer())]; const previewUrl = URL.createObjectURL(record.blob); const preview = await new Promise((resolve) => { const audio = new Audio(); const timer = setTimeout(() => resolve({ type: record.blob.type, size: record.blob.size, error: 'timeout', bytes }), 5000); audio.addEventListener('loadedmetadata', () => { clearTimeout(timer); resolve({ type: record.blob.type, size: record.blob.size, duration: audio.duration, bytes }); }, { once: true }); audio.addEventListener('error', () => { clearTimeout(timer); resolve({ type: record.blob.type, size: record.blob.size, error: audio.error?.code, bytes }); }, { once: true }); audio.src = previewUrl; audio.load(); }); URL.revokeObjectURL(previewUrl); return preview; })); return { current, fresh }; })()");
    throw new Error(`Saved clips did not decode for local preview: ${JSON.stringify(previewMetadata)}; ${JSON.stringify(diagnostics)}`);
  }

  await evaluate("location.hash = '#/marketplace'");
  await waitFor("!document.querySelector('.voice-workbench-view')", "leaving Voice Workbench");
  await evaluate("location.hash = '#/voice-workbench'");
  await waitFor("document.querySelectorAll('.voice-workbench-clip').length === 2", "clips to reload from IndexedDB");
  await evaluate("document.querySelector('.voice-workbench-clip button[aria-label=\"Remove same-name.wav\"]')?.click()");
  await waitFor("document.querySelectorAll('.voice-workbench-clip').length === 1", "one clip to be removed");
  await evaluate("location.hash = '#/marketplace'");
  await waitFor("!document.querySelector('.voice-workbench-view')", "leaving after clip removal");
  await evaluate("location.hash = '#/voice-workbench'");
  await waitFor("document.querySelectorAll('.voice-workbench-clip').length === 1", "remaining clip to persist after reload");

  console.log("Voice Workbench clip smoke passed (duplicate names remain distinct; IndexedDB reload, local preview, and individual removal verified).");
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
    catch { await sleep(150); }
  }
  console.warn(`Windows kept the isolated voice-workbench smoke profile open: ${temp}`);
}

main().catch((error) => {
  console.error(error.message);
  if (output.trim()) console.error(`Electron output:\n${output.slice(-2500)}`);
  process.exitCode = 1;
}).finally(cleanup);
