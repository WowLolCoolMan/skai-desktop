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
const mp4FixtureBase64 = fs.readFileSync(path.join(__dirname, "fixtures", "video-frame-smoke.mp4")).toString("base64");

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
if (artifactManifest.executable !== path.basename(executable) || artifactManifest.files?.executable !== sha256(executable) || artifactManifest.files?.agentHost !== sha256(path.join(artifactRoot, "resources", "agent-host", process.platform === "win32" ? "SkaiDesktop.AgentHost.exe" : "SkaiDesktop.AgentHost")) || artifactManifest.files?.airLlmWorker !== sha256(packagedAirLlmWorker)) {
  console.error(`Packaged artifact manifest does not match the staged files: ${artifactManifestPath}`);
  process.exit(1);
}

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

// `setup` CDP commands run first on the same session (e.g. emulation, which ends when the session closes).
async function evaluate(target, expression, setup = []) {
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
      setup.forEach((command, index) => socket.send(JSON.stringify({ id: 100 + index, ...command })));
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
  const mainResult = await evaluate(mainTarget, "(async () => { const settingsControl = () => Boolean(document.querySelector('[aria-label=\\\"Settings\\\"], [title=\\\"Settings\\\"]')) || document.body.innerText.includes('Settings'); const ready = () => Boolean(document.querySelector('[aria-label=\\\"Primary navigation\\\"]')) && settingsControl(); for (let waited = 0; !ready() && waited < 15000; waited += 100) await new Promise((resolve) => setTimeout(resolve, 100)); return JSON.stringify({ title: document.title, settings: settingsControl(), navigation: Boolean(document.querySelector('[aria-label=\\\"Primary navigation\\\"]')) }); })()");
  const videoFixtureResult = await evaluate(mainTarget, "(async () => { if (!globalThis.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return JSON.stringify({ supported: false }); const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180; const context = canvas.getContext('2d'); const stream = canvas.captureStream(8); let recorder; try { recorder = new MediaRecorder(stream); } catch { stream.getTracks().forEach((track) => track.stop()); return JSON.stringify({ supported: false }); } const chunks = []; const stopped = new Promise((resolve) => { recorder.addEventListener('dataavailable', (event) => { if (event.data.size) chunks.push(event.data); }); recorder.addEventListener('stop', () => resolve(new Blob(chunks, { type: recorder.mimeType || 'video/webm' })), { once: true }); }); recorder.start(); let frame = 0; const paint = setInterval(() => { context.fillStyle = ['#e5484d', '#2e90fa', '#30a46c'][frame++ % 3]; context.fillRect(0, 0, canvas.width, canvas.height); }, 120); await new Promise((resolve) => setTimeout(resolve, 1800)); clearInterval(paint); recorder.stop(); const blob = await stopped; stream.getTracks().forEach((track) => track.stop()); if (!blob.size) return JSON.stringify({ supported: true, recorded: false }); const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); const probe = document.createElement('video'); probe.src = `data:${blob.type};base64,${btoa(binary)}`; const probeResult = await new Promise((resolve) => { const timeout = setTimeout(() => resolve('timeout'), 3000); probe.addEventListener('loadedmetadata', () => { clearTimeout(timeout); resolve('metadata'); }, { once: true }); probe.addEventListener('error', () => { clearTimeout(timeout); resolve(`error-${probe.error?.code ?? 'unknown'}`); }, { once: true }); }); const probeDetails = { mime: blob.type, probeResult, duration: probe.duration, readyState: probe.readyState, error: probe.error?.message ?? '', magic: [...new Uint8Array(await blob.slice(0, 8).arrayBuffer())] }; const file = new File([blob], 'smoke-video.webm', { type: blob.type }); const data = new DataTransfer(); data.items.add(file); const zone = document.querySelector('.composer-card'); if (!zone) return JSON.stringify({ supported: true, recorded: true, dropped: false, probeDetails }); zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data })); zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data })); return JSON.stringify({ supported: true, recorded: true, dropped: true, bytes: blob.size, probeDetails }); })()");
  const videoFixture = JSON.parse(videoFixtureResult);
  let videoResult = JSON.stringify({ frames: [], errors: [] });
  if (videoFixture.dropped) {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      videoResult = await evaluate(mainTarget, "(() => JSON.stringify({ frames: [...document.querySelectorAll('.attachment-list-composer .attachment-card')].map((card) => ({ name: card.querySelector('strong')?.textContent ?? '', kind: card.querySelector('small')?.textContent ?? '' })), errors: [...document.querySelectorAll('[role=\\\"alert\\\"]')].map((item) => item.textContent ?? '') }))()");
      if (JSON.parse(videoResult).frames.length || JSON.parse(videoResult).errors.some(Boolean)) break;
      await sleep(100);
    }
  }
  await evaluate(mainTarget, "(() => { [...document.querySelectorAll('.attachment-remove')].reverse().forEach((button) => button.click()); return 'cleared'; })()");
  await sleep(150);
  const mp4DropResult = await evaluate(mainTarget, `(() => { const binary = atob('${mp4FixtureBase64}'); const bytes = new Uint8Array(binary.length); for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index); const file = new File([bytes], 'smoke-video.mp4', { type: 'video/mp4' }); const data = new DataTransfer(); data.items.add(file); const zone = document.querySelector('.composer-card'); if (!zone) return 'missing-drop-zone'; zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data })); zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data })); return 'dropped'; })()`);
  let mp4VideoResult = JSON.stringify({ frames: [], errors: [] });
  if (mp4DropResult === "dropped") {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      mp4VideoResult = await evaluate(mainTarget, "(() => JSON.stringify({ frames: [...document.querySelectorAll('.attachment-list-composer .attachment-card')].map((card) => ({ name: card.querySelector('strong')?.textContent ?? '', kind: card.querySelector('small')?.textContent ?? '' })), errors: [...document.querySelectorAll('[role=\\\"alert\\\"]')].map((item) => item.textContent ?? '') }))()");
      if (JSON.parse(mp4VideoResult).frames.length || JSON.parse(mp4VideoResult).errors.some(Boolean)) break;
      await sleep(100);
    }
  }
  console.log(`Packaged local WebM sampling: ${videoFixtureResult} ${videoResult}`);
  console.log(`Packaged local H.264 MP4 sampling: drop=${mp4DropResult} ${mp4VideoResult}`);
  const voiceResult = await evaluate(mainTarget, "(async () => { const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition; if (!Recognition) return JSON.stringify({ api: false, processLocally: false, install: false, availability: 'unsupported' }); const recognition = new Recognition(); let availability = 'not-reported'; if (typeof Recognition.available === 'function') { try { availability = await Recognition.available({ langs: [navigator.language || 'en-US'], processLocally: true, quality: 'dictation' }); } catch (error) { availability = `error: ${error instanceof Error ? error.message : String(error)}`; } } return JSON.stringify({ api: true, processLocally: 'processLocally' in recognition, install: typeof Recognition.install === 'function', availability, language: navigator.language }); })()");
  console.log(`Packaged local voice capability: ${voiceResult}`);
  const localVoiceState = JSON.parse(voiceResult);
  const audioInputStarted = await evaluate(mainTarget, "(() => { const input = document.querySelector('input[accept^=\\\".mp3\\\"]'); if (!input) return 'missing'; const sampleRate = 16000; const buffer = new ArrayBuffer(44 + sampleRate * 2); const bytes = new Uint8Array(buffer); const view = new DataView(buffer); const write = (offset, value) => { for (let index = 0; index < value.length; index++) bytes[offset + index] = value.charCodeAt(index); }; write(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); write(8, 'WAVE'); write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, sampleRate * 2, true); const data = new DataTransfer(); data.items.add(new File([buffer], 'smoke-silence.wav', { type: 'audio/wav' })); input.files = data.files; input.dispatchEvent(new Event('change', { bubbles: true })); return 'selected'; })()");
  let localAudioResult = JSON.stringify({ input: audioInputStarted === "selected", transcribing: false, transcript: false, error: "" });
  if (audioInputStarted === "selected") {
    const audioDeadline = Date.now() + 5_000;
    while (Date.now() < audioDeadline) {
      localAudioResult = await evaluate(mainTarget, "(() => JSON.stringify({ input: Boolean(document.querySelector('input[accept^=\\\".mp3\\\"]')), transcribing: [...document.querySelectorAll('[role=\\\"status\\\"]')].some((item) => item.textContent?.includes('Transcribing the selected audio')), transcript: [...document.querySelectorAll('[role=\\\"status\\\"]')].some((item) => item.textContent?.includes('Local transcript added')), error: document.querySelector('.composer-voice-error')?.textContent ?? '' }))()");
      const audioState = JSON.parse(localAudioResult);
      if (!audioState.transcribing && (audioState.transcript || audioState.error)) break;
      await sleep(100);
    }
  }
  console.log(`Packaged local audio file handling: ${audioInputStarted} ${localAudioResult}`);
  let dictationResult;
  if (localVoiceState.api && localVoiceState.processLocally && localVoiceState.availability === "available") {
    dictationResult = JSON.stringify({ button: true, error: "", listening: false, skipped: true });
  } else {
    const dictationStarted = await evaluate(mainTarget, "(() => { const button = [...document.querySelectorAll('button')].find((item) => item.getAttribute('aria-label') === 'Start voice input'); if (!button) return 'missing'; button.click(); return 'clicked'; })()");
    dictationResult = JSON.stringify({ button: dictationStarted === "clicked", error: "", listening: false });
    const dictationDeadline = Date.now() + 5_000;
    while (Date.now() < dictationDeadline) {
      dictationResult = await evaluate(mainTarget, "(() => { const button = [...document.querySelectorAll('button')].find((item) => item.getAttribute('aria-label') === 'Start voice input' || item.getAttribute('aria-label') === 'Stop voice input'); return JSON.stringify({ button: Boolean(button), error: document.querySelector('.composer-voice-error')?.textContent ?? '', listening: button?.getAttribute('aria-pressed') === 'true' }); })()");
      const result = JSON.parse(dictationResult);
      if (result.error || result.listening) break;
      await sleep(100);
    }
  }
  console.log(`Packaged dictation outcome: ${dictationResult}`);
  const settingsResult = await evaluate(mainTarget, "(async () => { location.hash = '#/settings'; window.dispatchEvent(new PopStateEvent('popstate')); await new Promise((resolve) => setTimeout(resolve, 250)); const settingsNav = document.querySelector('.settings-nav'); const tabs = [...(settingsNav?.querySelectorAll('button') ?? [])]; const tab = tabs.find((button) => button.textContent?.trim() === 'Models & Providers'); if (!tab) return JSON.stringify({ route: location.hash, tab: false, airLlmCheck: false, petControls: false }); tab.click(); await new Promise((resolve) => setTimeout(resolve, 100)); const airLlmCheck = [...document.querySelectorAll('.settings-content button')].some((button) => button.textContent?.trim() === 'Check readiness'); const petTab = [...(settingsNav?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.trim() === 'Pet'); if (!petTab) return JSON.stringify({ route: location.hash, tab: true, airLlmCheck, petControls: false }); petTab.click(); await new Promise((resolve) => setTimeout(resolve, 100)); return JSON.stringify({ route: location.hash, tab: true, airLlmCheck, petControls: document.body.innerText.includes('Show all pets') && document.body.innerText.includes('Let the active pet walk around') }); })()");
  const marketplaceResult = await evaluate(mainTarget, "(async () => { const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)); const buttonIn = (root, labels) => root ? [...root.querySelectorAll('button')].find((button) => labels.includes(button.textContent?.trim())) : null; location.hash = '#/marketplace'; window.dispatchEvent(new PopStateEvent('popstate')); await wait(300); const nav = () => document.querySelector('.plugins-customize-nav'); const heading = nav()?.querySelector('.plugins-customize-title')?.textContent?.trim() || ''; const search = Boolean(document.querySelector('.plugins-search input, #marketplace-search')); const modelsLink = buttonIn(nav(), ['Models']); if (!modelsLink) return JSON.stringify({ route: location.hash, catalog: Boolean(nav()), heading, search, modelsLink: false, modelHub: false, searchProviders: false, backToCatalog: false }); modelsLink.click(); await wait(300); const modelsRoute = location.hash; const modelHeading = document.querySelector('.marketplace-header h2')?.textContent?.trim() || ''; const modelHub = Boolean(document.querySelector('.marketplace-page') && modelHeading === 'Local models'); const searchProviders = Boolean(document.querySelector('.marketplace-toolbar #marketplace-search') && document.querySelector('.marketplace-toolbar button')); const back = buttonIn(document.querySelector('.marketplace-header'), ['Marketplace']); back?.click(); await wait(300); return JSON.stringify({ route: location.hash, catalog: true, heading, search, modelsLink: true, modelsRoute, modelHub, searchProviders, backToCatalog: Boolean(document.querySelector('.plugins-customize-nav')) }); })()");
  const installedResult = await evaluate(mainTarget, "(async () => { location.hash = '#/models'; window.dispatchEvent(new PopStateEvent('popstate')); await new Promise((resolve) => setTimeout(resolve, 300)); return JSON.stringify({ route: location.hash, inventoryPane: Boolean(document.querySelector('.model-library-card')), inventoryHeading: document.body.innerText.includes('Choose your model') }); })()");
  const modelsResult = await evaluate(mainTarget, "(async () => { location.hash = '#/models'; await new Promise((resolve) => setTimeout(resolve, 250)); const input = document.querySelector('input[aria-label=\\\"Ollama model name\\\"]'); if (!input) return JSON.stringify({ route: location.hash, input: false, reviewButton: false, reviewDialog: false, confirmButton: false }); const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setValue?.call(input, 'llama3.2:latest'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 100)); const reviewButton = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Review download'); if (!reviewButton) return JSON.stringify({ route: location.hash, input: true, reviewButton: false, reviewDialog: false, confirmButton: false }); reviewButton.click(); await new Promise((resolve) => setTimeout(resolve, 100)); return JSON.stringify({ route: location.hash, input: true, reviewButton: true, reviewDialog: Boolean(document.querySelector('[role=\\\"dialog\\\"][aria-label=\\\"Review local model download\\\"]')), confirmButton: [...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Confirm local download') }); })()");
  // The animation check forces normal motion (CI runners may have animations turned off); reduced motion is checked separately.
  const petResult = await evaluate(petTarget, "(async () => { const root = document.querySelector('.pet-window-root'); let sprite = document.querySelector('.pet-window-sprite'); for (let waited = 0; waited < 3000 && !sprite; waited += 100) { await new Promise((resolve) => setTimeout(resolve, 100)); sprite = document.querySelector('.pet-window-sprite'); } const firstFrame = sprite?.dataset.frame; for (let waited = 0; waited < 4000 && sprite?.dataset.frame === firstFrame; waited += 100) await new Promise((resolve) => setTimeout(resolve, 100)); const transparent = getComputedStyle(document.body).backgroundColor === 'rgba(0, 0, 0, 0)'; const opaque = document.documentElement.dataset.petSurface === 'opaque' && !transparent; return JSON.stringify({ title: document.title, companion: Boolean(root && root.getAttribute('aria-label')?.includes('desktop companion')), sprite: Boolean(sprite), transparent, opaque, animated: Boolean(sprite?.dataset.frame !== undefined), framesAdvance: Boolean(firstFrame !== undefined && sprite?.dataset.frame !== firstFrame), stripSized: Boolean(sprite && sprite.width > 0 && sprite.height > 0), playState: sprite?.dataset.frame, frames: [firstFrame, sprite?.dataset.frame], visibility: document.visibilityState, focused: document.hasFocus(), window: [window.screenX, window.screenY, window.innerWidth, window.innerHeight], screen: [screen.availLeft, screen.availTop, screen.availWidth, screen.availHeight] }); })()", [{ method: "Emulation.setEmulatedMedia", params: { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] } }]);
  await evaluate(mainTarget, "window.skaiAgent?.pet?.setMotion({ wander: true, reduceMotion: true, interactionDemo: false })");
  const petReducedResult = await evaluate(petTarget, "(async () => { const sprite = document.querySelector('.pet-window-sprite'); await new Promise((resolve) => setTimeout(resolve, 400)); const before = sprite?.dataset.frame; await new Promise((resolve) => setTimeout(resolve, 400)); const after = sprite?.dataset.frame; return JSON.stringify({ sprite: Boolean(sprite), running: Boolean(before !== undefined && after !== before) }); })()", [{ method: "Emulation.setEmulatedMedia", params: { features: [{ name: "prefers-reduced-motion", value: "reduce" }] } }]);
  await evaluate(mainTarget, "window.skaiAgent?.pet?.setMotion({ wander: true, reduceMotion: false, interactionDemo: false })");
  if (typeof mainResult !== "string" || typeof videoResult !== "string" || typeof voiceResult !== "string" || typeof dictationResult !== "string" || typeof settingsResult !== "string" || typeof marketplaceResult !== "string" || typeof installedResult !== "string" || typeof modelsResult !== "string" || typeof petResult !== "string") throw new Error(`Packaged Electron returned an unexpected evaluation value: ${JSON.stringify({ mainResult, videoResult, voiceResult, dictationResult, settingsResult, marketplaceResult, installedResult, modelsResult, petResult })}`);
  const mainState = JSON.parse(mainResult);
  const videoState = JSON.parse(videoResult);
  const mp4VideoState = JSON.parse(mp4VideoResult);
  const voiceState = JSON.parse(voiceResult);
  const localAudioState = JSON.parse(localAudioResult);
  const dictationState = JSON.parse(dictationResult);
  const settingsState = JSON.parse(settingsResult);
  const marketplaceState = JSON.parse(marketplaceResult);
  const installedState = JSON.parse(installedResult);
  const modelsState = JSON.parse(modelsResult);
  const petState = JSON.parse(petResult);
  const petReducedState = JSON.parse(petReducedResult);
  const error = dictationState.error.toLowerCase();
  const dictationFailClosed = dictationState.skipped || (!voiceState.api && error.includes("system speech input is not available")) || (voiceState.api && !voiceState.processLocally && error.includes("cannot guarantee on-device")) || (voiceState.processLocally && voiceState.availability !== "available" && (error.includes("remote recognition is disabled") || error.includes("no on-device speech pack")));
  const videoSamplingWorked = (!videoFixture.supported || (videoFixture.recorded && videoFixture.dropped && videoState.frames.length === 4 && videoState.frames.every((frame) => frame.kind.startsWith("Video frame"))))
    && mp4DropResult === "dropped" && mp4VideoState.frames.length === 4 && mp4VideoState.frames.every((frame) => frame.kind.startsWith("Video frame"));
  const localAudioHandled = audioInputStarted === "selected" && localAudioState.input && !localAudioState.transcribing
    && (localAudioState.transcript || localAudioState.error.toLowerCase().includes("on-device speech pack") || localAudioState.error.toLowerCase().includes("no speech was recognized"));
  if (mainTarget.id === petTarget.id || !petTarget.url?.includes("pet=1") || !mainState.title.includes("Skai Desktop") || !mainState.settings || !mainState.navigation || !videoSamplingWorked || !localAudioHandled || !dictationFailClosed || settingsState.route !== "#/settings" || !settingsState.tab || !settingsState.airLlmCheck || !settingsState.petControls || marketplaceState.route !== "#/marketplace" || !marketplaceState.catalog || marketplaceState.heading !== "Marketplace" || !marketplaceState.search || !marketplaceState.modelsLink || marketplaceState.modelsRoute !== "#/marketplace" || !marketplaceState.modelHub || !marketplaceState.searchProviders || !marketplaceState.backToCatalog || installedState.route !== "#/models" || !installedState.inventoryPane || !installedState.inventoryHeading || modelsState.route !== "#/models" || !modelsState.input || !modelsState.reviewButton || !modelsState.reviewDialog || !modelsState.confirmButton || !petState.title.includes("Skai companion") || !petState.companion || !petState.sprite || (!petState.transparent && !petState.opaque) || !petState.animated || !petState.framesAdvance || !petState.stripSized || !petReducedState.sprite || petReducedState.running) {
    throw new Error(`Packaged Electron rendered incomplete surfaces: ${JSON.stringify({ mainState, settingsState, marketplaceState, installedState, modelsState, petState, petReducedState, dictationState, localAudioState, voiceState, mp4DropResult, videoFixture, videoState, mp4VideoState })}`);
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
