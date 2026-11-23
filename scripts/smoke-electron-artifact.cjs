const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
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
const scannedPdfFixtureBase64 = fs.readFileSync(path.join(__dirname, "fixtures", "scanned-text-smoke.pdf")).toString("base64");

function makePdfStream(dictionary, bytes) {
  return Buffer.concat([Buffer.from(`<< ${dictionary} /Length ${bytes.length} >>\nstream\n`), bytes, Buffer.from("\nendstream")]);
}

function createMixedPdfFixture() {
  const canvasPackage = path.join(artifactRoot, "resources", "app", "node_modules", "@napi-rs", "canvas");
  const { createCanvas } = require(canvasPackage);
  const canvas = createCanvas(1400, 180);
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, 1400, 180);
  context.fillStyle = "#000";
  context.font = "bold 56px Arial";
  context.fillText("Mixed PDF scanned page OCR proof 67890", 35, 110);
  const image = canvas.toBuffer("image/jpeg");

  const objects = [];
  objects[1] = Buffer.from("<< /Type /Catalog /Pages 2 0 R >>");
  objects[2] = Buffer.from("<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>");
  objects[3] = Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 6 0 R >> >> /Contents 4 0 R >>");
  objects[4] = makePdfStream("", Buffer.from("BT /F1 24 Tf 60 700 Td (Selectable PDF page one proof.) Tj ET", "ascii"));
  objects[5] = Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 8 0 R >> >> /Contents 7 0 R >>");
  objects[6] = Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects[7] = makePdfStream("", Buffer.from("q 500 0 0 90 56 610 cm /Im1 Do Q", "ascii"));
  objects[8] = makePdfStream("/Type /XObject /Subtype /Image /Width 1400 /Height 180 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode", image);

  const parts = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "binary")];
  const offsets = [0];
  let length = parts[0].length;
  for (let number = 1; number < objects.length; number += 1) {
    offsets[number] = length;
    const part = Buffer.concat([Buffer.from(`${number} 0 obj\n`), objects[number], Buffer.from("\nendobj\n")]);
    parts.push(part);
    length += part.length;
  }
  const xrefOffset = length;
  let xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let number = 1; number < objects.length; number += 1) xref += `${String(offsets[number]).padStart(10, "0")} 00000 n \n`;
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`));
  return Buffer.concat(parts).toString("base64");
}

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
const smokeAppDataDir = path.join(smokeUserDataDir, "appdata");
fs.mkdirSync(smokeAppDataDir, { recursive: true });
const microphoneFixturePath = path.join(smokeUserDataDir, "microphone-voice-fixture.wav");
let microphoneFixtureReady = false;
if (process.platform === "win32") {
  const powershellScript = `$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.Speech; $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer; if ($synth.GetInstalledVoices().Count -gt 0) { $synth.SetOutputToWaveFile('${microphoneFixturePath.replace(/'/g, "''")}'); $synth.Speak('Skai voice fixture one two three.'); $synth.SetOutputToNull(); $synth.Dispose(); 'fixture-ready' }`;
  const encodedScript = Buffer.from(powershellScript, "utf16le").toString("base64");
  const synthesis = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodedScript], { encoding: "utf8", timeout: 30_000, windowsHide: true });
  microphoneFixtureReady = synthesis.status === 0 && fs.existsSync(microphoneFixturePath)
    && fs.readFileSync(microphoneFixturePath).subarray(0, 4).toString("ascii") === "RIFF";
  if (!microphoneFixtureReady && synthesis.error) console.warn(`Speech fixture unavailable; microphone smoke will use the active device: ${synthesis.error.message}`);
}
const microphoneFixtureArgs = microphoneFixtureReady
  ? ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${microphoneFixturePath}`]
  : [];
console.log(`Packaged microphone fixture: ${microphoneFixtureReady ? "Windows System.Speech WAV via Chromium microphone device" : "no deterministic speech fixture; using the active microphone device"}`);
const child = spawn(executable, [`--remote-debugging-port=${port}`, "--disable-gpu", ...displayBackendArgs, ...microphoneFixtureArgs, `--user-data-dir=${smokeUserDataDir}`, `--skai-isolated-smoke-app-data=${smokeAppDataDir}`], { cwd: path.dirname(executable), env: { ...process.env, SKAI_ELECTRON_SMOKE: "true", SKAI_SKIP_LEGACY_DATA_MIGRATION: "true" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
let childExit = null;
child.stdout.on("data", (chunk) => { output += chunk.toString(); });
child.stderr.on("data", (chunk) => { output += chunk.toString(); });
child.on("exit", (code, signal) => { childExit = { code, signal }; });

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
  if (!mainTarget || !petTarget) throw new Error(`Packaged Electron did not expose both main and Percy pages before timeout. Exit: ${JSON.stringify(childExit)}. Output: ${output.slice(-2_000)}`);
  console.log(`Packaged main target: ${JSON.stringify({ title: mainTarget.title, url: mainTarget.url, type: mainTarget.type, websocket: Boolean(mainTarget.webSocketDebuggerUrl) })}`);
  console.log(`Packaged Percy target: ${JSON.stringify({ url: petTarget.url, type: petTarget.type, websocket: Boolean(petTarget.webSocketDebuggerUrl) })}`);
  // The page target can appear before React mounts (slow CI runners); wait for the app shell before reading it.
  const mainResult = await evaluate(mainTarget, "(async () => { const settingsControl = () => Boolean(document.querySelector('[aria-label=\\\"Settings\\\"], [title=\\\"Settings\\\"]')) || document.body.innerText.includes('Settings'); const ready = () => Boolean(document.querySelector('[aria-label=\\\"Primary navigation\\\"]')) && settingsControl(); for (let waited = 0; !ready() && waited < 15000; waited += 100) await new Promise((resolve) => setTimeout(resolve, 100)); return JSON.stringify({ title: document.title, settings: settingsControl(), navigation: Boolean(document.querySelector('[aria-label=\\\"Primary navigation\\\"]')) }); })()");
  const voiceResult = await evaluate(mainTarget, "(async () => { const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition; if (!Recognition) return JSON.stringify({ api: false, processLocally: false, install: false, availability: 'unsupported' }); const recognition = new Recognition(); let availability = 'not-reported'; if (typeof Recognition.available === 'function') { try { availability = await Recognition.available({ langs: [navigator.language || 'en-US'], processLocally: true, quality: 'dictation' }); } catch (error) { availability = `error: ${error instanceof Error ? error.message : String(error)}`; } } return JSON.stringify({ api: true, processLocally: 'processLocally' in recognition, install: typeof Recognition.install === 'function', availability, language: navigator.language }); })()");
  const localVoiceState = JSON.parse(voiceResult);
  const whisperStatusRaw = await evaluate(mainTarget, "(async () => JSON.stringify(await window.skaiAgent.request('voice.whisper.install.status')))()");
  const whisperStatus = JSON.parse(whisperStatusRaw);
  const whisperInstalled = whisperStatus.ok === true && whisperStatus.result?.installed === true;

  await evaluate(mainTarget, "location.hash = '#/usage'; window.dispatchEvent(new PopStateEvent('popstate')); 'usage'");
  await sleep(250);
  await evaluate(mainTarget, "location.hash = '#/chat'; window.dispatchEvent(new PopStateEvent('popstate')); 'chat'");
  await evaluate(mainTarget, "(async () => { for (let waited = 0; waited < 10000; waited += 100) { if (document.querySelector('button[aria-label=\\\"Start voice input\\\"]')) return true; await new Promise((resolve) => setTimeout(resolve, 100)); } return false; })()");
  const microphoneDenialResult = await evaluate(mainTarget, `(async () => {
    const devices = navigator.mediaDevices;
    const originalDescriptor = Object.getOwnPropertyDescriptor(devices, 'getUserMedia');
    const originalGetUserMedia = devices.getUserMedia;
    Object.defineProperty(devices, 'getUserMedia', { configurable: true, value: async () => { throw new DOMException('Permission denied', 'NotAllowedError'); } });
    try {
      const button = [...document.querySelectorAll('button')].find((item) => item.getAttribute('aria-label') === 'Start voice input');
      if (!button) return JSON.stringify({ button: false, message: '' });
      button.click();
      for (let waited = 0; waited < 5000; waited += 50) {
        const message = document.querySelector('.composer-voice-error')?.textContent ?? '';
        if (message) return JSON.stringify({ button: true, denied: message.includes('Microphone access was denied'), message });
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return JSON.stringify({ button: true, denied: false, message: '' });
    } finally {
      if (originalDescriptor) Object.defineProperty(devices, 'getUserMedia', originalDescriptor);
      else { delete devices.getUserMedia; if (devices.getUserMedia !== originalGetUserMedia) Object.defineProperty(devices, 'getUserMedia', { configurable: true, writable: true, value: originalGetUserMedia }); }
    }
  })()`);
  const microphoneDenialState = JSON.parse(microphoneDenialResult);
  console.log(`Packaged microphone permission denial/retry path: ${JSON.stringify({ button: microphoneDenialState.button, denied: microphoneDenialState.denied })}`);
  const microphoneRecoveryResult = await evaluate(mainTarget, `(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      return JSON.stringify({ recovered: true });
    } catch (error) { return JSON.stringify({ recovered: false, error: error?.name ?? 'unknown' }); }
  })()`);
  const microphoneRecoveryState = JSON.parse(microphoneRecoveryResult);
  console.log(`Packaged microphone permission recovery probe: ${JSON.stringify(microphoneRecoveryState)}`);
  await evaluate(mainTarget, "location.hash = '#/usage'; window.dispatchEvent(new PopStateEvent('popstate')); 'usage'");
  await sleep(250);
  await evaluate(mainTarget, "location.hash = '#/chat'; window.dispatchEvent(new PopStateEvent('popstate')); 'chat'");
  const permissionRecoveryRemount = await evaluate(mainTarget, "(async () => { for (let waited = 0; waited < 10000; waited += 100) { if (document.querySelector('.composer-card') && document.querySelector('button[aria-label=\"Start voice input\"]')) return true; await new Promise((resolve) => setTimeout(resolve, 100)); } return false; })()");
  const dictationStarted = await evaluate(mainTarget, "(() => { const button = [...document.querySelectorAll('button')].find((item) => item.getAttribute('aria-label') === 'Start voice input'); if (!button) return 'missing'; button.click(); return 'clicked'; })()");
  console.log(`Packaged microphone recording: ${dictationStarted === "clicked" ? "start requested" : dictationStarted}`);
  let dictationResult = JSON.stringify({ button: dictationStarted === "clicked", started: false, stopped: false, settled: false, error: "", listening: false, transcribingObserved: false, transcript: false, whisperInstalled, localRecognition: localVoiceState.availability });
  let recorderStarted = false;
  let recorderStopped = false;
  const dictationStartDeadline = Date.now() + 10_000;
  const dictationStartAt = Date.now();
  while (Date.now() < dictationStartDeadline) {
    const state = JSON.parse(await evaluate(mainTarget, "(() => JSON.stringify({ listening: [...document.querySelectorAll('button')].some((item) => item.getAttribute('aria-label') === 'Stop voice input' && item.getAttribute('aria-pressed') === 'true'), transcribing: [...document.querySelectorAll('[role=\"status\"]')].some((item) => item.textContent?.includes('Transcribing audio with local Whisper')), transcript: [...document.querySelectorAll('[role=\"status\"]')].some((item) => item.textContent?.includes('Local transcript added')), error: document.querySelector('.composer-voice-error')?.textContent ?? '' }))()"));
    if (state.listening) { recorderStarted = true; break; }
    if (state.error && Date.now() - dictationStartAt >= 5_000) break;
    await sleep(100);
  }
  if (recorderStarted) {
    await sleep(microphoneFixtureReady ? 3_000 : 300);
    const stopResult = await evaluate(mainTarget, "(() => { const button = [...document.querySelectorAll('button')].find((item) => item.getAttribute('aria-label') === 'Stop voice input'); if (!button) return 'missing'; button.click(); return 'clicked'; })()");
    recorderStopped = stopResult === "clicked";
    console.log(`Packaged microphone recording: started=${recorderStarted}, stop=${stopResult}, fixture=${microphoneFixtureReady}`);
  }
  const dictationDeadline = Date.now() + (microphoneFixtureReady ? 180_000 : 60_000);
  let microphoneTranscriptionObserved = false;
  let lastProgressLog = Date.now();
  while (Date.now() < dictationDeadline) {
    const state = JSON.parse(await evaluate(mainTarget, `(() => { const transcriptAttachments = [...document.querySelectorAll('.attachment-list-composer .attachment-card')].filter((card) => card.querySelector('strong')?.textContent?.toLowerCase().endsWith('.audio-transcript.txt')); const snippets = [...document.querySelectorAll('.attachment-list-composer .attachment-snippet')].map((item) => item.textContent ?? '').join(' ').toLowerCase(); return JSON.stringify({ button: Boolean([...document.querySelectorAll('button')].find((item) => ['Start voice input', 'Stop voice input'].includes(item.getAttribute('aria-label')))), error: document.querySelector('.composer-voice-error')?.textContent ?? '', listening: [...document.querySelectorAll('button')].some((item) => item.getAttribute('aria-label') === 'Stop voice input' && item.getAttribute('aria-pressed') === 'true'), transcribing: [...document.querySelectorAll('[role=\"status\"]')].some((item) => item.textContent?.includes('Transcribing audio with local Whisper')), transcript: [...document.querySelectorAll('[role=\"status\"]')].some((item) => item.textContent?.includes('Local transcript added')), transcriptAttachments: transcriptAttachments.length, fixtureMatched: ${microphoneFixtureReady ? "snippets.includes('voice fixture')" : "false"} }); })()`));
    microphoneTranscriptionObserved ||= state.transcribing;
    const freshTranscript = state.transcript && microphoneTranscriptionObserved && state.transcriptAttachments > 0;
    const settled = !state.listening && !state.transcribing && Boolean(freshTranscript || state.error || microphoneTranscriptionObserved);
    dictationResult = JSON.stringify({ button: dictationStarted === "clicked", started: recorderStarted, stopped: recorderStopped, settled, error: state.error, listening: state.listening, transcribingObserved: microphoneTranscriptionObserved, transcript: freshTranscript, transcriptAttachments: state.transcriptAttachments, fixtureMatched: state.fixtureMatched, microphoneFixtureReady, whisperInstalled, localRecognition: localVoiceState.availability });
    if (settled) break;
    if (Date.now() - lastProgressLog >= 30_000) { console.log(`Packaged microphone transcription still running: ${JSON.stringify({ transcribing: state.transcribing, observed: microphoneTranscriptionObserved, whisperInstalled })}`); lastProgressLog = Date.now(); }
    await sleep(50);
  }
  console.log(`Packaged dictation outcome: ${dictationResult}`);
  await evaluate(mainTarget, "(() => { [...document.querySelectorAll('.attachment-remove')].reverse().forEach((button) => button.click()); return 'cleared'; })()");

  const videoFixtureResult = await evaluate(mainTarget, "(async () => { if (!globalThis.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return JSON.stringify({ supported: false }); const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180; const context = canvas.getContext('2d'); const stream = canvas.captureStream(8); let recorder; try { recorder = new MediaRecorder(stream); } catch { stream.getTracks().forEach((track) => track.stop()); return JSON.stringify({ supported: false }); } const chunks = []; const stopped = new Promise((resolve) => { recorder.addEventListener('dataavailable', (event) => { if (event.data.size) chunks.push(event.data); }); recorder.addEventListener('stop', () => resolve(new Blob(chunks, { type: recorder.mimeType || 'video/webm' })), { once: true }); }); recorder.start(); let frame = 0; const paint = setInterval(() => { context.fillStyle = ['#e5484d', '#2e90fa', '#30a46c'][frame++ % 3]; context.fillRect(0, 0, canvas.width, canvas.height); }, 120); await new Promise((resolve) => setTimeout(resolve, 1800)); clearInterval(paint); recorder.stop(); const blob = await stopped; stream.getTracks().forEach((track) => track.stop()); if (!blob.size) return JSON.stringify({ supported: true, recorded: false }); const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); const bridge = window.skaiAgent?.media; if (!bridge) return JSON.stringify({ supported: true, recorded: true, dropped: false, error: 'local media bridge unavailable' }); const localUrl = await bridge.createLocalUrl(\"video/webm\", btoa(binary)); const probe = document.createElement('video'); probe.preload = 'metadata'; probe.src = localUrl; const probeResult = await new Promise((resolve) => { const timeout = setTimeout(() => resolve('timeout'), 5000); probe.addEventListener('loadedmetadata', () => { clearTimeout(timeout); resolve('metadata'); }, { once: true }); probe.addEventListener('error', () => { clearTimeout(timeout); resolve(`error-${probe.error?.code ?? 'unknown'}`); }, { once: true }); }); const probeDetails = { mime: blob.type, probeResult, duration: probe.duration, readyState: probe.readyState, error: probe.error?.message ?? '', magic: [...new Uint8Array(await blob.slice(0, 8).arrayBuffer())] }; probe.removeAttribute('src'); probe.load(); await bridge.revokeLocalUrl(localUrl); const file = new File([blob], 'smoke-video.webm', { type: blob.type }); const data = new DataTransfer(); data.items.add(file); const zone = document.querySelector('.composer-card'); if (!zone) return JSON.stringify({ supported: true, recorded: true, dropped: false, probeDetails }); zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data })); zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data })); return JSON.stringify({ supported: true, recorded: true, dropped: true, bytes: blob.size, probeDetails }); })()");
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
  console.log(`Packaged local voice capability: ${voiceResult}`);
  const audioInputStarted = await evaluate(mainTarget, "(() => { const input = document.querySelector('input[accept^=\\\".mp3\\\"]'); if (!input) return 'missing'; const sampleRate = 16000; const buffer = new ArrayBuffer(44 + sampleRate * 2); const bytes = new Uint8Array(buffer); const view = new DataView(buffer); const write = (offset, value) => { for (let index = 0; index < value.length; index++) bytes[offset + index] = value.charCodeAt(index); }; write(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); write(8, 'WAVE'); write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, sampleRate * 2, true); const data = new DataTransfer(); data.items.add(new File([buffer], 'smoke-silence.wav', { type: 'audio/wav' })); input.files = data.files; input.dispatchEvent(new Event('change', { bubbles: true })); return 'selected'; })()");
  let localAudioResult = JSON.stringify({ input: audioInputStarted === "selected", transcribing: false, transcript: false, error: "" });
  if (audioInputStarted === "selected") {
    // The local Whisper path loads a multi-gigabyte model on CPU. Give the
    // packaged worker enough time to report a transcript or a real error.
    const audioDeadline = Date.now() + 60_000;
    while (Date.now() < audioDeadline) {
      localAudioResult = await evaluate(mainTarget, "(() => JSON.stringify({ input: Boolean(document.querySelector('input[accept^=\\\".mp3\\\"]')), transcribing: [...document.querySelectorAll('[role=\\\"status\\\"]')].some((item) => item.textContent?.includes('Transcribing the selected audio')), transcript: [...document.querySelectorAll('[role=\\\"status\\\"]')].some((item) => item.textContent?.includes('Local transcript added')), error: document.querySelector('.composer-voice-error')?.textContent ?? '' }))()");
      const audioState = JSON.parse(localAudioResult);
      if (!audioState.transcribing && (audioState.transcript || audioState.error)) break;
      await sleep(100);
    }
  }
  console.log(`Packaged local audio file handling: ${audioInputStarted} ${localAudioResult}`);
  const pdfOcrRaw = await evaluate(mainTarget, `(async () => JSON.stringify(await window.skaiAgent.request('workspace.attachment.extract', { fileName: 'scanned-text-smoke.pdf', content: '${scannedPdfFixtureBase64}' })))()`);
  const pdfOcrResponse = JSON.parse(pdfOcrRaw);
  const pdfOcrState = { ok: pdfOcrResponse.ok === true, ocr: pdfOcrResponse.result?.ocr === true, recognizedFixtureText: String(pdfOcrResponse.result?.content ?? "").includes("Skai offline OCR proof 12345"), error: pdfOcrResponse.error?.message ?? "" };
  console.log(`Packaged local scanned-PDF OCR: ${JSON.stringify(pdfOcrState)}`);
  const mixedPdfFixtureBase64 = createMixedPdfFixture();
  const mixedPdfRaw = await evaluate(mainTarget, `(async () => JSON.stringify(await window.skaiAgent.request('workspace.attachment.extract', { fileName: 'mixed-text-scanned-smoke.pdf', content: '${mixedPdfFixtureBase64}' })))()`);
  const mixedPdfResponse = JSON.parse(mixedPdfRaw);
  const mixedPdfState = {
    ok: mixedPdfResponse.ok === true,
    ocrPages: mixedPdfResponse.result?.ocrPages ?? [],
    selectableText: String(mixedPdfResponse.result?.content ?? "").includes("Selectable PDF page one proof."),
    scannedText: String(mixedPdfResponse.result?.content ?? "").includes("Mixed PDF scanned page OCR proof 67890"),
    error: mixedPdfResponse.error?.message ?? "",
  };
  console.log(`Packaged mixed-PDF text and OCR: ${JSON.stringify(mixedPdfState)}`);
  await evaluate(mainTarget, "(() => { [...document.querySelectorAll('.attachment-remove')].reverse().forEach((button) => button.click()); return 'cleared'; })()");
  // Remount ChatComposer so the earlier audio-file transcript status cannot be
  // mistaken for a result from the microphone recording below.
  await evaluate(mainTarget, "location.hash = '#/usage'; window.dispatchEvent(new PopStateEvent('popstate')); 'usage'");
  await sleep(250);
  await evaluate(mainTarget, "location.hash = '#/chat'; window.dispatchEvent(new PopStateEvent('popstate')); 'chat'");
  const remountedChat = await evaluate(mainTarget, "(async () => { for (let waited = 0; waited < 10000; waited += 100) { if (document.querySelector('.composer-card') && document.querySelector('button[aria-label=\"Start voice input\"]')) return true; await new Promise((resolve) => setTimeout(resolve, 100)); } return false; })()");
  if (remountedChat !== true) throw new Error("Chat composer did not remount before microphone acceptance.");
  await sleep(150);

  const settingsResult = await evaluate(mainTarget, "(async () => { location.hash = '#/settings'; window.dispatchEvent(new PopStateEvent('popstate')); await new Promise((resolve) => setTimeout(resolve, 250)); const settingsNav = document.querySelector('.settings-nav'); const tabs = [...(settingsNav?.querySelectorAll('button') ?? [])]; const tab = tabs.find((button) => button.textContent?.trim() === 'Models & Providers'); if (!tab) return JSON.stringify({ route: location.hash, tab: false, airLlmCheck: false, petControls: false }); tab.click(); await new Promise((resolve) => setTimeout(resolve, 100)); const airLlmCheck = [...document.querySelectorAll('.settings-content button')].some((button) => button.textContent?.trim() === 'Check readiness'); const petTab = [...(settingsNav?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.trim() === 'Pet'); if (!petTab) return JSON.stringify({ route: location.hash, tab: true, airLlmCheck, petControls: false }); petTab.click(); await new Promise((resolve) => setTimeout(resolve, 100)); return JSON.stringify({ route: location.hash, tab: true, airLlmCheck, petControls: document.body.innerText.includes('Show all pets') && document.body.innerText.includes('Let the active pet walk around') }); })()");
  const marketplaceResult = await evaluate(mainTarget, "(async () => { const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)); const buttonIn = (root, labels) => root ? [...root.querySelectorAll('button')].find((button) => labels.includes(button.textContent?.trim())) : null; location.hash = '#/marketplace'; window.dispatchEvent(new PopStateEvent('popstate')); await wait(300); const nav = () => document.querySelector('.plugins-customize-nav'); const heading = document.querySelector('.plugins-topbar h2')?.textContent?.trim() || ''; const search = Boolean(document.querySelector('.plugins-search input, #marketplace-search')); const modelsLink = [...(nav()?.querySelectorAll('button') ?? [])].find((button) => button.querySelector('span')?.textContent?.trim() === 'Models'); if (!modelsLink) return JSON.stringify({ route: location.hash, catalog: Boolean(nav()), heading, search, modelsLink: false, modelHub: false, searchProviders: false, backToCatalog: false }); modelsLink.click(); await wait(300); const modelsRoute = location.hash; const modelHeading = document.querySelector('.marketplace-header h2')?.textContent?.trim() || ''; const modelHub = Boolean(document.querySelector('.marketplace-page') && modelHeading === 'Local models'); const searchProviders = Boolean(document.querySelector('.marketplace-toolbar #marketplace-search') && document.querySelector('.marketplace-toolbar button')); const back = buttonIn(document.querySelector('.marketplace-header'), ['Marketplace']); back?.click(); await wait(300); return JSON.stringify({ route: location.hash, catalog: true, heading, search, modelsLink: true, modelsRoute, modelHub, searchProviders, backToCatalog: Boolean(document.querySelector('.plugins-customize-nav')) }); })()");
  const toolsInstalledResult = await evaluate(mainTarget, "(async () => { const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)); const nav = document.querySelector('.plugins-customize-nav'); const installed = [...(nav?.querySelectorAll('button') ?? [])].find((button) => button.querySelector('span')?.textContent?.trim() === 'Installed'); if (!installed) return JSON.stringify({ inTools: Boolean(nav), installedTab: false, inventoryVisible: false }); installed.click(); await wait(300); return JSON.stringify({ inTools: Boolean(document.querySelector('.plugins-customize-nav')), installedTab: installed.getAttribute('aria-current') === 'page', inventoryVisible: document.body.innerText.includes('Installed and connected') }); })()" );
  const toolsInstalledState = JSON.parse(toolsInstalledResult);
  const installedResult = await evaluate(mainTarget, "(async () => { location.hash = '#/models'; window.dispatchEvent(new PopStateEvent('popstate')); await new Promise((resolve) => setTimeout(resolve, 300)); return JSON.stringify({ route: location.hash, inventoryPane: Boolean(document.querySelector('.model-library-card')), inventoryHeading: document.body.innerText.includes('Choose your model') }); })()");
  const modelsResult = await evaluate(mainTarget, "(async () => { location.hash = '#/models'; await new Promise((resolve) => setTimeout(resolve, 250)); const input = document.querySelector('input[aria-label=\\\"Ollama model name\\\"]'); if (!input) return JSON.stringify({ route: location.hash, input: false, reviewButton: false, reviewDialog: false, confirmButton: false }); const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setValue?.call(input, 'llama3.2:latest'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 100)); const reviewButton = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Review download'); if (!reviewButton) return JSON.stringify({ route: location.hash, input: true, reviewButton: false, reviewDialog: false, confirmButton: false }); reviewButton.click(); await new Promise((resolve) => setTimeout(resolve, 100)); return JSON.stringify({ route: location.hash, input: true, reviewButton: true, reviewDialog: Boolean(document.querySelector('[role=\\\"dialog\\\"][aria-label=\\\"Review local model download\\\"]')), confirmButton: [...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Confirm local download') }); })()");
  // The animation check forces normal motion (CI runners may have animations turned off); reduced motion is checked separately.
  const petResult = await evaluate(petTarget, "(async () => { const root = document.querySelector('.pet-window-root'); let sprite = document.querySelector('.pet-window-sprite'); for (let waited = 0; waited < 3000 && !sprite; waited += 100) { await new Promise((resolve) => setTimeout(resolve, 100)); sprite = document.querySelector('.pet-window-sprite'); } const firstFrame = sprite?.dataset.frame; for (let waited = 0; waited < 4000 && sprite?.dataset.frame === firstFrame; waited += 100) await new Promise((resolve) => setTimeout(resolve, 100)); const transparent = getComputedStyle(document.body).backgroundColor === 'rgba(0, 0, 0, 0)'; const opaque = document.documentElement.dataset.petSurface === 'opaque' && !transparent; return JSON.stringify({ title: document.title, companion: Boolean(root && root.getAttribute('aria-label')?.includes('desktop companion')), sprite: Boolean(sprite), transparent, opaque, animated: Boolean(sprite?.dataset.frame !== undefined), framesAdvance: Boolean(firstFrame !== undefined && sprite?.dataset.frame !== firstFrame), stripSized: Boolean(sprite && sprite.width > 0 && sprite.height > 0), playState: sprite?.dataset.frame, frames: [firstFrame, sprite?.dataset.frame], visibility: document.visibilityState, focused: document.hasFocus(), window: [window.screenX, window.screenY, window.innerWidth, window.innerHeight], screen: [screen.availLeft, screen.availTop, screen.availWidth, screen.availHeight] }); })()", [{ method: "Emulation.setEmulatedMedia", params: { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] } }]);
  await evaluate(mainTarget, "window.skaiAgent?.pet?.setMotion({ wander: true, reduceMotion: true, interactionDemo: false })");
  const petReducedResult = await evaluate(petTarget, "(async () => { const sprite = document.querySelector('.pet-window-sprite'); await new Promise((resolve) => setTimeout(resolve, 400)); const before = sprite?.dataset.frame; await new Promise((resolve) => setTimeout(resolve, 400)); const after = sprite?.dataset.frame; return JSON.stringify({ sprite: Boolean(sprite), running: Boolean(before !== undefined && after !== before) }); })()", [{ method: "Emulation.setEmulatedMedia", params: { features: [{ name: "prefers-reduced-motion", value: "reduce" }] } }]);
  await evaluate(mainTarget, "window.skaiAgent?.pet?.setMotion({ wander: true, reduceMotion: false, interactionDemo: false })");
  if (typeof mainResult !== "string" || typeof videoResult !== "string" || typeof voiceResult !== "string" || typeof dictationResult !== "string" || typeof settingsResult !== "string" || typeof marketplaceResult !== "string" || typeof toolsInstalledResult !== "string" || typeof installedResult !== "string" || typeof modelsResult !== "string" || typeof petResult !== "string") throw new Error(`Packaged Electron returned an unexpected evaluation value: ${JSON.stringify({ mainResult, videoResult, voiceResult, dictationResult, settingsResult, marketplaceResult, toolsInstalledResult, installedResult, modelsResult, petResult })}`);
  const mainState = JSON.parse(mainResult);
  const videoState = JSON.parse(videoResult);
  const mp4VideoState = JSON.parse(mp4VideoResult);
  const voiceState = JSON.parse(voiceResult);
  const localAudioState = JSON.parse(localAudioResult);
  const dictationState = JSON.parse(dictationResult);
  const settingsState = JSON.parse(settingsResult);
  const marketplaceState = JSON.parse(marketplaceResult);
  console.log(`Tools Installed tab: ${toolsInstalledResult}`);
  const installedState = JSON.parse(installedResult);
  const modelsState = JSON.parse(modelsResult);
  const petState = JSON.parse(petResult);
  const petReducedState = JSON.parse(petReducedResult);
  const error = dictationState.error.toLowerCase();
  const dictationFailClosed = dictationState.button && dictationState.started && dictationState.stopped && dictationState.settled
    && (microphoneFixtureReady
      ? dictationState.transcript && dictationState.fixtureMatched
      : dictationState.transcript || !error.includes("remote"));
  const webmHasUsableDuration = Number(videoFixture.probeDetails?.duration) > 0.1;
  const webmSamplingWorked = !videoFixture.supported || (videoFixture.recorded && videoFixture.dropped && videoState.frames.length === 4
    && videoState.frames.every((frame) => webmHasUsableDuration ? frame.kind.startsWith("Video frame") : frame.name.includes(".frame-")));
  const videoSamplingWorked = webmSamplingWorked
    && mp4DropResult === "dropped" && mp4VideoState.frames.length === 4 && mp4VideoState.frames.every((frame) => frame.kind.startsWith("Video frame"));
  const localAudioHandled = audioInputStarted === "selected" && localAudioState.input && !localAudioState.transcribing
    && (localAudioState.transcript || localAudioState.error.toLowerCase().includes("on-device speech pack") || localAudioState.error.toLowerCase().includes("no speech was recognized"));
  await evaluate(mainTarget, "location.hash = '#/chat'; window.dispatchEvent(new PopStateEvent('popstate')); 'chat'");
  await sleep(250);
  let handsFreeState = { available: whisperInstalled && microphoneFixtureReady, started: false, listening: false, transcribing: false, submitted: false, ended: false, peakInputLevel: 0 };
  if (handsFreeState.available) {
    await evaluate(mainTarget, "(() => { [...document.querySelectorAll('.attachment-remove')].reverse().forEach((button) => button.click()); return 'cleared'; })()");
    const beforeTurns = await evaluate(mainTarget, "document.querySelectorAll('.chat-message.user').length");
    const startHandsFree = await evaluate(mainTarget, "(() => { const button = [...document.querySelectorAll('button')].find((item) => item.getAttribute('aria-label') === 'Start voice mode'); if (!button) return false; button.click(); return true; })()");
    handsFreeState.started = startHandsFree === true;
    const handsFreeDeadline = Date.now() + 60_000;
    while (Date.now() < handsFreeDeadline && handsFreeState.started && !handsFreeState.submitted) {
      const current = JSON.parse(await evaluate(mainTarget, `(() => JSON.stringify({ modal: Boolean(document.querySelector('.voice-mode-dialog')), state: document.querySelector('.voice-mode-state')?.textContent ?? '', detail: document.querySelector('.voice-mode-detail')?.textContent ?? '', level: Number(document.querySelector('.voice-mode-session')?.dataset.inputLevel ?? 0), turns: [...document.querySelectorAll('.chat-message.user')].slice(${beforeTurns}).map((item) => item.innerText.toLowerCase()).join(' ') }))()`));
      handsFreeState.peakInputLevel = Math.max(handsFreeState.peakInputLevel, current.level);
      handsFreeState.listening ||= current.state.includes("Listening");
      handsFreeState.transcribing ||= current.state.includes("Transcribing");
      handsFreeState.submitted = current.turns.includes("voice fixture");
      if (!current.modal && (current.detail.includes("Whisper") || current.turns)) break;
      await sleep(100);
    }
    if (handsFreeState.started) {
      const ended = await evaluate(mainTarget, "(() => { const button = [...document.querySelectorAll('button')].find((item) => item.getAttribute('aria-label') === 'End voice mode'); if (!button) return false; button.click(); return true; })()");
      handsFreeState.ended = ended === true && await evaluate(mainTarget, "!document.querySelector('.voice-mode-dialog')") === true;
    }
    console.log(`Packaged local Whisper hands-free Voice Mode: ${JSON.stringify(handsFreeState)}`);
  } else {
    console.log(`Packaged local Whisper hands-free Voice Mode skipped: ${JSON.stringify(handsFreeState)}`);
  }
  if (mainTarget.id === petTarget.id || !petTarget.url?.includes("pet=1") || !mainState.title.includes("Skai Desktop") || !mainState.settings || !mainState.navigation || !videoSamplingWorked || !localAudioHandled || !pdfOcrState.ok || !pdfOcrState.ocr || !pdfOcrState.recognizedFixtureText || !mixedPdfState.ok || mixedPdfState.ocrPages.join(",") !== "2" || !mixedPdfState.selectableText || !mixedPdfState.scannedText || !microphoneDenialState.button || !microphoneDenialState.denied || !microphoneRecoveryState.recovered || !permissionRecoveryRemount || !dictationFailClosed || (handsFreeState.available && (!handsFreeState.started || !handsFreeState.listening || !handsFreeState.transcribing || !handsFreeState.submitted || !handsFreeState.ended)) || settingsState.route !== "#/settings" || !settingsState.tab || !settingsState.airLlmCheck || !settingsState.petControls || marketplaceState.route !== "#/marketplace" || !marketplaceState.catalog || marketplaceState.heading !== "Discover" || !marketplaceState.search || !marketplaceState.modelsLink || marketplaceState.modelsRoute !== "#/marketplace" || !marketplaceState.modelHub || !marketplaceState.searchProviders || !marketplaceState.backToCatalog || !toolsInstalledState.inTools || !toolsInstalledState.installedTab || !toolsInstalledState.inventoryVisible || installedState.route !== "#/models" || !installedState.inventoryPane || !installedState.inventoryHeading || modelsState.route !== "#/models" || !modelsState.input || !modelsState.reviewButton || !modelsState.reviewDialog || !modelsState.confirmButton || !petState.title.includes("Skai companion") || !petState.companion || !petState.sprite || (!petState.transparent && !petState.opaque) || !petState.animated || !petState.framesAdvance || !petState.stripSized || !petReducedState.sprite || petReducedState.running) {
    throw new Error(`Packaged Electron rendered incomplete surfaces: ${JSON.stringify({ mainState, settingsState, marketplaceState, installedState, modelsState, petState, petReducedState, dictationState, handsFreeState, microphoneDenialState, microphoneRecoveryState, permissionRecoveryRemount, localAudioState, pdfOcrState, mixedPdfState, voiceState, mp4DropResult, videoFixture, videoState, mp4VideoState })}`);
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

main().catch((error) => { console.error(error?.stack || String(error)); process.exitCode = 1; }).finally(cleanup);
