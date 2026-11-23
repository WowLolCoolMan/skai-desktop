#!/usr/bin/env node

/* Clean-install acceptance for the pinned Kokoro Marketplace adapter. */

const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const readline = require("node:readline");
const { ensureSmokeAgentHostBuild } = require("./smoke-agent-host-build.cjs");

const root = path.resolve(__dirname, "..");
const smokeTempRoot = path.join(root, ".tmp");
fs.mkdirSync(smokeTempRoot, { recursive: true });
const profileRoot = fs.mkdtempSync(path.join(smokeTempRoot, "kokoro-clean-smoke-"));
const env = {
  ...process.env,
  SRAI_SETTINGS_PATH: path.join(profileRoot, "settings.json"),
  SRAI_MCP_CONNECTIONS_PATH: path.join(profileRoot, "mcp-connections.json"),
  SRAI_CONVERSATIONS_PATH: path.join(profileRoot, "conversations.json"),
  SRAI_TASKS_PATH: path.join(profileRoot, "agent-tasks.json"),
  SRAI_SCHEDULED_TASKS_PATH: path.join(profileRoot, "scheduled-tasks.json"),
  SRAI_PROJECTS_PATH: path.join(profileRoot, "projects.json"),
  SRAI_CORPUS_PATH: path.join(profileRoot, "document-corpus.json"),
  SKAI_VOICE_ROOT: path.join(profileRoot, "voice"),
  SKAI_SKIP_LEGACY_DATA_MIGRATION: "true",
};
const hostAssembly = ensureSmokeAgentHostBuild(root);
const hostProgram = process.platform === "win32" ? hostAssembly.replace(/\.dll$/i, ".exe") : "dotnet";
const hostArgs = process.platform === "win32" ? ["--stdio"] : [hostAssembly, "--stdio"];
const child = spawn(hostProgram, hostArgs, { cwd: root, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
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
  } catch { /* protocol failures are reported by timeout */ }
});

function request(method, params = {}, timeoutMs = 60_000) {
  const id = `kokoro-${nextId++}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out waiting for ${method}.`)); }, timeoutMs);
    pending.set(id, response => { clearTimeout(timer); resolve(response); });
    child.stdin.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
  });
}

async function run() {
  const health = await request("runtime.health");
  for (const capability of ["voice.kokoro.install.start", "voice.kokoro.install.status", "voice.speak"]) {
    if (!health.ok || !health.result?.capabilities?.includes(capability)) throw new Error(`Agent Host did not advertise ${capability}.`);
  }
  const started = await request("voice.kokoro.install.start");
  if (!started.ok) throw new Error(started.error?.message ?? "Kokoro install did not start.");
  let status = started.result;
  const deadline = Date.now() + 20 * 60_000;
  while (status?.status === "installing" && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1_000));
    const response = await request("voice.kokoro.install.status");
    if (!response.ok) throw new Error(response.error?.message ?? "Could not read Kokoro install status.");
    status = response.result;
    if (status.step) process.stdout.write(`Kokoro: ${status.step}\n`);
  }
  if (!status?.installed || status.status !== "installed") throw new Error(`Kokoro clean install failed: ${JSON.stringify(status)}`);

  const models = await request("voice.models");
  const kokoro = models.result?.models?.find(model => model.id === "kokoro-82m-onnx");
  if (!models.ok || !kokoro?.installed || !kokoro.adapterAvailable) throw new Error(`Installed Kokoro was not exposed as ready: ${JSON.stringify(models)}`);
  const speech = await request("voice.speak", { text: "Skai local Kokoro acceptance passed.", modelId: "kokoro-82m-onnx", rate: 1 }, 5 * 60_000);
  const dataUrl = speech.result?.audioDataUrl;
  if (!speech.ok || speech.result?.engine !== "kokoro-onnx-local" || typeof dataUrl !== "string" || !dataUrl.startsWith("data:audio/wav;base64,")) {
    throw new Error(`Kokoro local synthesis failed: ${JSON.stringify(speech)}`);
  }
  const wav = Buffer.from(dataUrl.slice("data:audio/wav;base64,".length), "base64");
  if (wav.length < 16_000 || wav.subarray(0, 4).toString("ascii") !== "RIFF" || wav.subarray(8, 12).toString("ascii") !== "WAVE") {
    throw new Error("Kokoro returned invalid or empty WAV data.");
  }
  console.log(`Kokoro clean Marketplace install and speech acceptance passed (${wav.length.toLocaleString()} WAV bytes).`);
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
  if (!isolatedProfile.startsWith(tempRoot) || path.dirname(isolatedProfile) !== path.resolve(smokeTempRoot)) {
    throw new Error("Refusing to clean an unexpected Kokoro smoke path.");
  }
  if (process.exitCode === undefined || process.exitCode === 0) fs.rmSync(isolatedProfile, { recursive: true, force: true });
  else console.error(`Preserved isolated Kokoro profile for diagnosis: ${isolatedProfile}`);
});
