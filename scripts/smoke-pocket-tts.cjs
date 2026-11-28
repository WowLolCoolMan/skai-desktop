#!/usr/bin/env node

/* Full isolated clean-install acceptance for the pinned Pocket TTS adapter.
 * Installs into a disposable profile, warms both models, checks cancellation,
 * synthesizes and validates WAV, then removes only that isolated profile. */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const readline = require("node:readline");
const { ensureSmokeAgentHostBuild } = require("./smoke-agent-host-build.cjs");

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("Pocket TTS in-app acceptance requires Windows x64.");
}

const root = path.resolve(__dirname, "..");
// Pocket TTS' Windows loader still resolves model files through an 8.3 short
// path. Keep the disposable runtime outside the workspace so a repo path such
// as `E:\Skai Desktop` cannot make a valid install fail.
const smokeTempRoot = os.tmpdir();
fs.mkdirSync(smokeTempRoot, { recursive: true });
const profileRoot = fs.mkdtempSync(path.join(smokeTempRoot, "pocket-tts-smoke-"));
const voiceRoot = path.join(profileRoot, "voice", "PocketTTS");
const env = {
  ...process.env,
  SRAI_SETTINGS_PATH: path.join(profileRoot, "settings.json"),
  SRAI_MCP_CONNECTIONS_PATH: path.join(profileRoot, "mcp-connections.json"),
  SRAI_CONVERSATIONS_PATH: path.join(profileRoot, "conversations.json"),
  SRAI_TASKS_PATH: path.join(profileRoot, "agent-tasks.json"),
  SRAI_SCHEDULED_TASKS_PATH: path.join(profileRoot, "scheduled-tasks.json"),
  SRAI_PROJECTS_PATH: path.join(profileRoot, "projects.json"),
  SRAI_CORPUS_PATH: path.join(profileRoot, "document-corpus.json"),
  SKAI_POCKET_TTS_ROOT: voiceRoot,
  SKAI_SKIP_LEGACY_DATA_MIGRATION: "true",
};
const hostAssembly = ensureSmokeAgentHostBuild(root);
const hostProgram = hostAssembly.replace(/\.dll$/i, ".exe");
const child = spawn(hostProgram, ["--stdio"], { cwd: root, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
const reader = readline.createInterface({ input: child.stdout });
const pending = new Map();
let nextId = 1;
let stderr = "";
child.stderr.on("data", chunk => { stderr += chunk.toString(); });
reader.on("line", line => {
  try {
    const response = JSON.parse(line);
    const resolve = pending.get(response.id);
    if (resolve) { pending.delete(response.id); resolve(response); }
  } catch { /* invalid protocol output is reported as a timeout */ }
});

function request(method, params, timeoutMs = 60_000) {
  const id = `pocket-tts-${nextId++}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out waiting for ${method}.`)); }, timeoutMs);
    pending.set(id, response => { clearTimeout(timer); resolve(response); });
    child.stdin.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
  });
}

async function run() {
  const health = await request("runtime.health");
  const capabilities = health.result?.capabilities ?? [];
  for (const capability of ["voice.pocket.install.start", "voice.pocket.install.status", "voice.speak"]) {
    if (!health.ok || !capabilities.includes(capability)) throw new Error(`Agent Host did not advertise ${capability}.`);
  }

  const started = await request("voice.pocket.install.start");
  if (!started.ok) throw new Error(`Pocket TTS Marketplace installation failed to start: ${started.error?.message}`);
  const deadline = Date.now() + 35 * 60_000;
  let state = started.result;
  while (Date.now() < deadline && state?.status === "installing") {
    await new Promise(resolve => setTimeout(resolve, 1_000));
    const status = await request("voice.pocket.install.status");
    if (!status.ok) throw new Error(`Pocket TTS install status failed: ${status.error?.message}`);
    state = status.result;
    if (state.step) process.stdout.write(`${state.step}\n`);
  }
  if (!state?.installed || state.status !== "installed") {
    throw new Error(`Pocket TTS did not install successfully: ${JSON.stringify(state)}`);
  }

  const voices = await request("voice.models");
  const full = voices.result?.models?.find(model => model.id === "pocket-tts");
  const low = voices.result?.models?.find(model => model.id === "pocket-tts-low-resource");
  if (!voices.ok || !full?.installed || !low?.installed || !full.adapterAvailable || !low.adapterAvailable) {
    throw new Error(`Installed Pocket TTS models were not exposed as ready: ${JSON.stringify(voices)}`);
  }

  const ongoingSpeech = request("voice.speak", {
    text: "Pocket TTS cancellation check. ".repeat(80),
    modelId: "pocket-tts",
  }, 5 * 60_000);
  await new Promise(resolve => setTimeout(resolve, 1_500));
  const stopped = await request("voice.stop");
  if (!stopped.ok || stopped.result?.stopped !== true) throw new Error("voice.stop did not acknowledge the Pocket TTS interruption.");
  const cancelledSpeech = await ongoingSpeech;
  if (cancelledSpeech.ok) throw new Error("Pocket TTS generation continued after voice.stop.");

  const spoken = await request("voice.speak", { text: "Skai local voice acceptance passed.", modelId: "pocket-tts" }, 5 * 60_000);
  const dataUrl = spoken.result?.audioDataUrl;
  if (!spoken.ok || spoken.result?.engine !== "pocket-tts-local" || typeof dataUrl !== "string" || !dataUrl.startsWith("data:audio/wav;base64,")) {
    throw new Error(`Pocket TTS local synthesis failed: ${JSON.stringify(spoken)}`);
  }
  const wav = Buffer.from(dataUrl.slice("data:audio/wav;base64,".length), "base64");
  if (wav.length < 44 || wav.subarray(0, 4).toString("ascii") !== "RIFF" || wav.subarray(8, 12).toString("ascii") !== "WAVE") {
    throw new Error("Pocket TTS returned invalid WAV data.");
  }
  console.log(`Pocket TTS in-app acceptance passed (runtime installed; 2 models ready; ${wav.length} byte local WAV).`);
}

run().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  if (stderr.trim()) console.error(stderr.trim());
  process.exitCode = 1;
}).finally(async () => {
  if (child.exitCode === null && child.signalCode === null) {
    if (process.platform === "win32" && child.pid) {
      try { execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); }
      catch { child.kill(); }
    } else child.kill();
    if (child.exitCode === null && child.signalCode === null) {
      await Promise.race([new Promise(resolve => child.once("exit", resolve)), new Promise(resolve => setTimeout(resolve, 5_000))]);
    }
  }
  const tempRoot = path.resolve(smokeTempRoot) + path.sep;
  const isolatedProfile = path.resolve(profileRoot);
  const isolatedVoiceRoot = path.resolve(voiceRoot);
  if (!isolatedProfile.startsWith(tempRoot) || path.dirname(path.dirname(isolatedVoiceRoot)) !== isolatedProfile) {
    throw new Error("Refusing to clean an unexpected Pocket TTS smoke path.");
  }
  if (process.exitCode === undefined || process.exitCode === 0) fs.rmSync(isolatedProfile, { recursive: true, force: true });
  else console.error(`Preserved isolated Pocket TTS profile for diagnosis: ${isolatedProfile}`);
});
