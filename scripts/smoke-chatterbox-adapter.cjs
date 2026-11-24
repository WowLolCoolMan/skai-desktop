#!/usr/bin/env node

/* End-to-end local Chatterbox Nano install and speech acceptance. This installs
 * the pinned model under the current user's Skai voice data directory. */

const { spawn } = require("node:child_process");
const readline = require("node:readline");
const { ensureSmokeAgentHostBuild } = require("./smoke-agent-host-build.cjs");

const root = require("node:path").resolve(__dirname, "..");
const hostAssembly = ensureSmokeAgentHostBuild(root);
const hostProgram = process.platform === "win32" ? hostAssembly.replace(/\.dll$/i, ".exe") : "dotnet";
const hostArgs = process.platform === "win32" ? ["--stdio"] : [hostAssembly, "--stdio"];
const child = spawn(hostProgram, hostArgs, { cwd: root, env: { ...process.env, SKAI_SKIP_LEGACY_DATA_MIGRATION: "true" }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
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
  } catch { /* protocol noise is reported by the request timeout */ }
});

function request(method, params = {}, timeoutMs = 45 * 60_000) {
  const id = `chatterbox-${nextId++}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out waiting for ${method}.`)); }, timeoutMs);
    pending.set(id, response => { clearTimeout(timer); resolve(response); });
    child.stdin.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
  });
}

function validateSpeech(response) {
  const url = response.result?.audioDataUrl;
  if (!response.ok || response.result?.engine !== "chatterbox-nano-local" || typeof url !== "string" || !url.startsWith("data:audio/wav;base64,"))
    throw new Error(`Chatterbox speech generation failed: ${JSON.stringify(response)}`);
  const wav = Buffer.from(url.slice("data:audio/wav;base64,".length), "base64");
  if (wav.length < 16_000 || wav.subarray(0, 4).toString() !== "RIFF" || wav.subarray(8, 12).toString() !== "WAVE") throw new Error("Chatterbox returned an invalid or empty WAV sample.");
  const sampleRate = wav.readUInt32LE(24);
  const durationSeconds = Math.round(wav.readUInt32LE(40) / wav.readUInt32LE(28) * 100) / 100;
  let sumSquares = 0;
  let peak = 0;
  let samples = 0;
  for (let offset = 44; offset + 1 < wav.length; offset += 2) {
    const sample = wav.readInt16LE(offset) / 32768;
    sumSquares += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
    samples++;
  }
  const rms = Math.sqrt(sumSquares / Math.max(1, samples));
  if (sampleRate !== 24_000 || durationSeconds < 0.25 || rms < 0.005 || peak < 0.05) throw new Error("Chatterbox WAV was silent or failed its sample-rate/audio-content checks.");
  return { bytes: wav.length, durationSeconds, sampleRate, rms: Math.round(rms * 10_000) / 10_000, peak: Math.round(peak * 10_000) / 10_000 };
}

async function run() {
  const statusBefore = await request("voice.chatterbox.install.status", {}, 45_000);
  if (!statusBefore.ok) throw new Error(statusBefore.error?.message ?? "Chatterbox install status could not be read.");
  if (!statusBefore.result.installed) {
    const started = await request("voice.chatterbox.install.start", {}, 45_000);
    if (!started.ok) throw new Error(started.error?.message ?? "Chatterbox install did not start.");
    let status;
    do {
      await new Promise(resolve => setTimeout(resolve, 2_000));
      status = await request("voice.chatterbox.install.status", {}, 45_000);
      if (!status.ok) throw new Error(status.error?.message ?? "Could not read Chatterbox install status.");
      if (status.result?.status === "failed") throw new Error(status.result.error ?? "Chatterbox installation failed.");
      process.stdout.write(`Chatterbox Nano: ${status.result?.step || status.result?.status}\n`);
    } while (!status.result?.installed);
  }

  const firstStart = Date.now();
  const first = validateSpeech(await request("voice.speak", { text: "Skai local voice adapter capability check.", modelId: "chatterbox", rate: 1, expressiveness: 20 }, 12 * 60_000));
  const firstMs = Date.now() - firstStart;
  const warmStart = Date.now();
  const warm = validateSpeech(await request("voice.speak", { text: "This second sample checks the expressive local worker [chuckle].", modelId: "chatterbox", rate: 1, expressiveness: 85 }, 5 * 60_000));
  const warmMs = Date.now() - warmStart;
  process.stdout.write(`Chatterbox Nano local install and speech smoke passed: first ${first.durationSeconds}s (${first.bytes.toLocaleString()} bytes, RMS ${first.rms}, ${firstMs}ms), warm ${warm.durationSeconds}s (${warm.bytes.toLocaleString()} bytes, RMS ${warm.rms}, ${warmMs}ms), ${first.sampleRate}Hz.\n`);
}

run().catch(error => { process.stderr.write(`${error.stack ?? error}\n${stderr.slice(-2_000)}\n`); process.exitCode = 1; }).finally(() => { child.stdin.end(); child.kill(); });
