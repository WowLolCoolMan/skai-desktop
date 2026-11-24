#!/usr/bin/env node

/* Clean-profile acceptance for the pinned Qwen3-TTS 0.6B local adapter. */
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const readline = require("node:readline");
const { ensureSmokeAgentHostBuild } = require("./smoke-agent-host-build.cjs");

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("Qwen3-TTS acceptance requires Windows x64.");
}

const root = path.resolve(__dirname, "..");
const tempRoot = path.join(root, ".tmp");
fs.mkdirSync(tempRoot, { recursive: true });
const profileRoot = fs.mkdtempSync(path.join(tempRoot, "qwen3-tts-smoke-"));
const voiceRoot = path.join(profileRoot, "voice");
const env = {
  ...process.env,
  SRAI_SETTINGS_PATH: path.join(profileRoot, "settings.json"),
  SRAI_MCP_CONNECTIONS_PATH: path.join(profileRoot, "mcp-connections.json"),
  SRAI_CONVERSATIONS_PATH: path.join(profileRoot, "conversations.json"),
  SRAI_TASKS_PATH: path.join(profileRoot, "agent-tasks.json"),
  SRAI_SCHEDULED_TASKS_PATH: path.join(profileRoot, "scheduled-tasks.json"),
  SRAI_PROJECTS_PATH: path.join(profileRoot, "projects.json"),
  SRAI_CORPUS_PATH: path.join(profileRoot, "document-corpus.json"),
  SKAI_VOICE_ROOT: voiceRoot,
  SKAI_SKIP_LEGACY_DATA_MIGRATION: "true",
};
const hostAssembly = ensureSmokeAgentHostBuild(root);
const child = spawn(hostAssembly.replace(/\.dll$/i, ".exe"), ["--stdio"], { cwd: root, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
const reader = readline.createInterface({ input: child.stdout });
const pending = new Map();
let nextId = 1;
let stderr = "";
child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-12_000); });
reader.on("line", line => {
  try {
    const response = JSON.parse(line);
    const resolve = pending.get(response.id);
    if (resolve) { pending.delete(response.id); resolve(response); }
  } catch { /* surfaced as a protocol timeout */ }
});

function request(method, params, timeoutMs = 60_000) {
  const id = `qwen3-tts-${nextId++}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out waiting for ${method}.`)); }, timeoutMs);
    pending.set(id, response => { clearTimeout(timer); resolve(response); });
    child.stdin.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
  });
}

function assertWav(response, label) {
  const dataUrl = response.result?.audioDataUrl;
  if (!response.ok || response.result?.engine !== "qwen3-tts-local" || typeof dataUrl !== "string" || !dataUrl.startsWith("data:audio/wav;base64,")) {
    throw new Error(`${label} synthesis failed: ${JSON.stringify(response)}`);
  }
  const wav = Buffer.from(dataUrl.slice("data:audio/wav;base64,".length), "base64");
  if (wav.length < 44 || wav.subarray(0, 4).toString("ascii") !== "RIFF" || wav.subarray(8, 12).toString("ascii") !== "WAVE") {
    throw new Error(`${label} returned invalid WAV data.`);
  }
  return wav;
}

async function run() {
  const health = await request("runtime.health");
  const capabilities = health.result?.capabilities ?? [];
  for (const capability of ["voice.qwen3.install.start", "voice.qwen3.install.status", "voice.qwen3.remove", "voice.speak", "voice.stop"]) {
    if (!health.ok || !capabilities.includes(capability)) throw new Error(`Agent Host did not advertise ${capability}.`);
  }

  const started = await request("voice.qwen3.install.start");
  if (!started.ok) throw new Error(`Qwen3-TTS installation failed to start: ${started.error?.message}`);
  let state = started.result;
  const deadline = Date.now() + 90 * 60_000;
  let previousStep = "";
  while (Date.now() < deadline && state?.status === "installing") {
    await new Promise(resolve => setTimeout(resolve, 2_000));
    const status = await request("voice.qwen3.install.status");
    if (!status.ok) throw new Error(`Qwen3-TTS install status failed: ${status.error?.message}`);
    state = status.result;
    if (state.step && state.step !== previousStep) { console.log(state.step); previousStep = state.step; }
  }
  if (!state?.installed || state.status !== "installed") throw new Error(`Qwen3-TTS did not install successfully: ${JSON.stringify(state)}`);

  const voices = await request("voice.models");
  const model = voices.result?.models?.find(item => item.id === "qwen3-tts");
  if (!voices.ok || !model?.installed || !model.adapterAvailable || model.supportsEmotion || model.supportsStreaming || model.supportsVoiceCloning || model.supportsAudioEffects) {
    throw new Error(`Qwen3-TTS readiness or capability reporting was incorrect: ${JSON.stringify(model)}`);
  }

  const first = assertWav(await request("voice.speak", { text: "Skai local speech acceptance passed.", modelId: "qwen3-tts", speaker: "Ryan", expressiveness: 20 }, 5 * 60_000), "Ryan low expressiveness");
  const second = assertWav(await request("voice.speak", { text: "Local speech is ready.", modelId: "qwen3-tts", speaker: "Aiden", expressiveness: 85 }, 5 * 60_000), "Aiden high expressiveness");

  const ongoing = request("voice.speak", { text: "Cancellation check. ".repeat(250), modelId: "qwen3-tts", speaker: "Ryan" }, 5 * 60_000);
  await new Promise(resolve => setTimeout(resolve, 1_000));
  const stopped = await request("voice.stop");
  if (!stopped.ok || stopped.result?.stopped !== true) throw new Error("voice.stop did not acknowledge the Qwen3-TTS interruption.");
  if ((await ongoing).ok) throw new Error("Qwen3-TTS generation continued after voice.stop.");
  const afterCancel = assertWav(await request("voice.speak", { text: "Speech works after cancellation.", modelId: "qwen3-tts", speaker: "Ryan" }, 5 * 60_000), "post-cancellation");

  const removed = await request("voice.qwen3.remove");
  if (!removed.ok || removed.result?.removed !== true) throw new Error(`Qwen3-TTS could not be removed from the isolated profile: ${JSON.stringify(removed)}`);
  const afterRemove = await request("voice.models");
  if (afterRemove.result?.models?.find(item => item.id === "qwen3-tts")?.installed) throw new Error("Qwen3-TTS remained marked installed after removal.");
  console.log(`Qwen3-TTS acceptance passed: isolated install, 2 speakers, cancellation/recovery, removal; WAV sizes ${first.length}/${second.length}/${afterCancel.length} bytes.`);
}

run().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  if (stderr.trim()) console.error(stderr.trim());
  process.exitCode = 1;
}).finally(async () => {
  if (child.exitCode === null && child.signalCode === null) {
    try { execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); }
    catch { child.kill(); }
    await Promise.race([new Promise(resolve => child.once("exit", resolve)), new Promise(resolve => setTimeout(resolve, 5_000))]);
  }
  const expectedTempRoot = path.resolve(tempRoot) + path.sep;
  const isolatedProfile = path.resolve(profileRoot);
  if (!isolatedProfile.startsWith(expectedTempRoot) || path.dirname(path.resolve(voiceRoot)) !== isolatedProfile) {
    throw new Error("Refusing to clean an unexpected Qwen3-TTS smoke path.");
  }
  if (!process.exitCode) fs.rmSync(isolatedProfile, { recursive: true, force: true });
  else console.error(`Preserved isolated Qwen3-TTS profile for diagnosis: ${isolatedProfile}`);
});
