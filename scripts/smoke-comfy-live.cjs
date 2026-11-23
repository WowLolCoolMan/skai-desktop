#!/usr/bin/env node

// Exercises Skai's real ComfyUI Agent Host route against an already-running
// local ComfyUI service. Requires a user-installed checkpoint and leaves the
// successful edited result in the ComfyUI output directory.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const readline = require("node:readline");
const { spawn } = require("node:child_process");
const { ensureSmokeAgentHostBuild } = require("./smoke-agent-host-build.cjs");

const root = path.resolve(__dirname, "..");
const endpoint = (process.env.SKAI_COMFY_ENDPOINT || "http://127.0.0.1:8188").replace(/\/$/, "");
const checkpoint = process.env.SKAI_COMFY_CHECKPOINT || "Juggernaut-XL_v9.safetensors";
const tempRoot = path.join(root, ".tmp");
fs.mkdirSync(tempRoot, { recursive: true });
const profile = fs.mkdtempSync(path.join(tempRoot, "comfy-live-smoke-"));
const env = {
  ...process.env,
  SRAI_SETTINGS_PATH: path.join(profile, "settings.json"),
  SRAI_MCP_CONNECTIONS_PATH: path.join(profile, "mcp-connections.json"),
  SRAI_CONVERSATIONS_PATH: path.join(profile, "conversations.json"),
  SRAI_TASKS_PATH: path.join(profile, "agent-tasks.json"),
  SRAI_SCHEDULED_TASKS_PATH: path.join(profile, "scheduled-tasks.json"),
  SRAI_PROJECTS_PATH: path.join(profile, "projects.json"),
  SRAI_CORPUS_PATH: path.join(profile, "document-corpus.json"),
  SKAI_SKIP_LEGACY_DATA_MIGRATION: "true",
};
const assembly = ensureSmokeAgentHostBuild(root);
const hostProgram = process.platform === "win32" ? assembly.replace(/\.dll$/i, ".exe") : "dotnet";
const hostArgs = process.platform === "win32" ? ["--stdio"] : [assembly, "--stdio"];
const child = spawn(hostProgram, hostArgs, { cwd: root, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
const reader = readline.createInterface({ input: child.stdout });
const pending = new Map();
let nextId = 1;
let stderr = "";
child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-8_000); });
reader.on("line", line => {
  try {
    const response = JSON.parse(line);
    const resolve = pending.get(response.id);
    if (resolve) { pending.delete(response.id); resolve(response); }
  } catch { /* surfaced as a request timeout */ }
});

function request(method, params = {}, timeoutMs = 30_000) {
  const id = `comfy-live-${nextId++}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out waiting for ${method}.`)); }, timeoutMs);
    pending.set(id, response => { clearTimeout(timer); resolve(response); });
    child.stdin.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
  });
}

function assertOk(response, method) {
  if (!response.ok) throw new Error(`${method} failed: ${response.error?.message || JSON.stringify(response)}`);
  return response.result;
}

function workflow({ steps, denoise = 1, edit = false }) {
  const loadImage = edit ? `,"8":{"class_type":"LoadImage","inputs":{"image":"{{image}}"}},"9":{"class_type":"VAEEncode","inputs":{"pixels":["8",0],"vae":["1",2]}}` : "";
  const latent = edit ? '["9",0]' : '["4",0]';
  const emptyLatent = edit ? "" : ',"4":{"class_type":"EmptyLatentImage","inputs":{"width":512,"height":512,"batch_size":1}}';
  const negative = '"3":{"class_type":"CLIPTextEncode","inputs":{"text":"blurry, low quality","clip":["1",1]}}';
  return `{"1":{"class_type":"CheckpointLoaderSimple","inputs":{"ckpt_name":${JSON.stringify(checkpoint)}}},"2":{"class_type":"CLIPTextEncode","inputs":{"text":"{{prompt}}","clip":["1",1]}},${negative}${emptyLatent}${loadImage},"5":{"class_type":"KSampler","inputs":{"seed":{{seed}},"steps":${steps},"cfg":2,"sampler_name":"euler","scheduler":"normal","denoise":${denoise},"model":["1",0],"positive":["2",0],"negative":["3",0],"latent_image":${latent}}},"6":{"class_type":"VAEDecode","inputs":{"samples":["5",0],"vae":["1",2]}},"7":{"class_type":"SaveImage","inputs":{"filename_prefix":"skai-live-acceptance","images":["6",0]}}}`;
}

async function startGeneration(params) {
  return assertOk(await request("image.generate.start", params), "image.generate.start");
}

async function getStatus(id) {
  return assertOk(await request("image.generate.status", { id }), "image.generate.status");
}

async function waitForStatus(id, accepted, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await getStatus(id);
    if (accepted.includes(status.status)) return status;
    if (status.status === "failed") throw new Error(`Image generation failed: ${status.error}`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for image run ${id} to reach ${accepted.join(" or ")}.`);
}

async function main() {
  const server = new URL(endpoint);
  if (server.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(server.hostname))
    throw new Error("Live ComfyUI acceptance only allows a loopback HTTP endpoint.");
  const checkpoints = await (await fetch(`${endpoint}/models/checkpoints`)).json();
  if (!Array.isArray(checkpoints) || !checkpoints.includes(checkpoint))
    throw new Error(`ComfyUI does not report checkpoint ${checkpoint}. Available: ${JSON.stringify(checkpoints)}`);
  const queue = await (await fetch(`${endpoint}/queue`)).json();
  if (queue.queue_running?.length || queue.queue_pending?.length)
    throw new Error("ComfyUI already has queued work. Wait for it to finish before running this acceptance check.");

  const start = assertOk(await request("runtime.health"), "runtime.health");
  if (start.status !== "ready") throw new Error("Skai Agent Host is not ready.");

  const cancellation = await startGeneration({
    provider: "comfyui", endpoint, workflow: workflow({ steps: 40 }),
    prompt: "A small amber glass vase on a plain cream studio backdrop, centered product photo.",
  });
  const cancelDeadline = Date.now() + 90_000;
  let cancellationStatus;
  while (Date.now() < cancelDeadline) {
    cancellationStatus = await getStatus(cancellation.id);
    if (cancellationStatus.status === "failed") throw new Error(`Cancellation setup failed before cancellation: ${cancellationStatus.error}`);
    if (cancellationStatus.progress?.some(item => item.includes("Generating media locally"))) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!cancellationStatus?.progress?.some(item => item.includes("Generating media locally")))
    throw new Error("Skai did not report active ComfyUI progress in time to cancel the run.");
  assertOk(await request("image.generate.cancel", { id: cancellation.id }), "image.generate.cancel");
  cancellationStatus = await waitForStatus(cancellation.id, ["cancelled"], 60_000);
  const afterCancel = await (await fetch(`${endpoint}/queue`)).json();
  if (afterCancel.queue_running?.length || afterCancel.queue_pending?.length)
    throw new Error(`ComfyUI queue was not clear after Skai cancelled its job: ${JSON.stringify(afterCancel)}`);
  console.log(`Skai ComfyUI cancellation passed (${cancellationStatus.status}); ComfyUI queue is clear.`);

  const editWorkflow = workflow({ steps: 4, denoise: 0.35, edit: true });
  const generated = await startGeneration({
    provider: "comfyui", endpoint, workflow: workflow({ steps: 4 }),
    prompt: "A tiny orange fox sitting beneath a fern, warm watercolor illustration, uncluttered composition.",
  });
  const generatedStatus = await waitForStatus(generated.id, ["completed"], 20 * 60_000);
  const source = generatedStatus.images?.[0];
  if (!source?.url || source.mediaType !== "image") throw new Error("Skai's ComfyUI run returned no image to use as an edit source.");
  const sourceResponse = await fetch(source.url);
  if (!sourceResponse.ok) throw new Error(`Could not fetch Skai's generated source image (${sourceResponse.status}).`);
  const sourceBytes = Buffer.from(await sourceResponse.arrayBuffer());
  if (!sourceBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    throw new Error("The source image returned by ComfyUI is not a PNG.");

  const edited = await startGeneration({
    provider: "comfyui", endpoint, workflow: editWorkflow,
    prompt: "Keep the same fox and composition, add tiny blue flowers in the foreground, watercolor illustration.",
    sourceImage: sourceBytes.toString("base64"), sourceImageMediaType: "image/png",
  });
  const editedStatus = await waitForStatus(edited.id, ["completed"], 20 * 60_000);
  const result = editedStatus.images?.[0];
  if (!result?.url || result.mediaType !== "image") throw new Error("Skai's ComfyUI edit returned no image result.");
  const resultResponse = await fetch(result.url);
  if (!resultResponse.ok) throw new Error(`Could not fetch the ComfyUI edit result (${resultResponse.status}).`);
  const resultBytes = Buffer.from(await resultResponse.arrayBuffer());
  if (resultBytes.length < 1_000 || !resultBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    throw new Error("The ComfyUI edit result was not a valid PNG payload.");
  console.log(`Skai ComfyUI image-to-image passed: ${source.fileName} → ${result.fileName} (${resultBytes.length} bytes).`);
}

main().catch(error => {
  console.error(`${error.message}${stderr ? `\nAgent Host stderr: ${stderr}` : ""}`);
  process.exitCode = 1;
}).finally(async () => {
  if (child.exitCode === null && child.signalCode === null) {
    child.stdin.end();
    if (process.platform === "win32") {
      await new Promise(resolve => {
        const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.once("close", resolve); killer.once("error", resolve);
      });
    } else {
      child.kill("SIGTERM");
      await new Promise(resolve => child.once("close", resolve));
    }
  }
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  catch (error) { console.error(`Could not remove isolated profile ${profile}: ${error.message}`); process.exitCode = 1; }
});
