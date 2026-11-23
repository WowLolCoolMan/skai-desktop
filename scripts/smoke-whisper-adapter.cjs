const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");

const child = spawn("dotnet", ["run", "--no-build", "--no-restore", "--project", "services/agent-host/SkaiDesktop.AgentHost.csproj", "--", "--stdio"], {
  cwd: process.cwd(), windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
});
let buffer = "";
let nextId = 1;
const pending = new Map();
child.stdout.setEncoding("utf8");
child.stdout.on("data", chunk => {
  buffer += chunk;
  for (;;) {
    const newline = buffer.indexOf("\n");
    if (newline < 0) break;
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    const resolve = pending.get(message.id);
    if (resolve) { pending.delete(message.id); resolve(message); }
  }
});
child.stderr.on("data", chunk => process.stderr.write(chunk));

function request(method, params = {}, timeoutMs = 120 * 60_000) {
  const id = `whisper-${nextId++}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out waiting for ${method}.`)); }, timeoutMs);
    pending.set(id, message => { clearTimeout(timer); resolve(message); });
    child.stdin.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
  });
}

function repeatPcmWave(audioBase64, repeats) {
  const wave = Buffer.from(audioBase64, "base64");
  if (wave.toString("ascii", 0, 4) !== "RIFF" || wave.toString("ascii", 8, 12) !== "WAVE") throw new Error("Piper did not return a RIFF/WAVE fixture.");
  let formatChunk;
  let audioChunk;
  for (let offset = 12; offset + 8 <= wave.length;) {
    const name = wave.toString("ascii", offset, offset + 4);
    const size = wave.readUInt32LE(offset + 4);
    const end = offset + 8 + size;
    if (end > wave.length) throw new Error("The Piper WAV fixture contains a malformed chunk.");
    if (name === "fmt ") formatChunk = wave.subarray(offset, end + (size & 1));
    if (name === "data") audioChunk = wave.subarray(offset + 8, end);
    offset = end + (size & 1);
  }
  if (!formatChunk || !audioChunk?.length) throw new Error("The Piper WAV fixture has no PCM format or data chunk.");
  const repeatedAudio = Buffer.concat(Array.from({ length: repeats }, () => audioChunk));
  const dataHeader = Buffer.alloc(8);
  dataHeader.write("data", 0, "ascii");
  dataHeader.writeUInt32LE(repeatedAudio.length, 4);
  const body = Buffer.concat([Buffer.from("WAVE", "ascii"), formatChunk, dataHeader, repeatedAudio]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]).toString("base64");
}

async function run() {
  const started = await request("voice.whisper.install.start");
  if (!started.ok) throw new Error(started.error?.message ?? "Whisper install did not start.");
  let status;
  do {
    await new Promise(resolve => setTimeout(resolve, 2_000));
    status = await request("voice.whisper.install.status");
    if (!status.ok) throw new Error(status.error?.message ?? "Could not read Whisper install status.");
    if (status.result?.status === "failed") throw new Error(status.result.error ?? "Whisper installation failed.");
    process.stdout.write(`Whisper: ${status.result?.step || status.result?.status}\n`);
  } while (!status.result?.installed);

  const speech = await request("voice.speak", { text: "Skai local Whisper transcription test.", modelId: "piper", rate: 1 }, 5 * 60_000);
  const audioUrl = speech.result?.audioDataUrl;
  if (!speech.ok || typeof audioUrl !== "string" || !audioUrl.startsWith("data:audio/wav;base64,")) throw new Error("Could not prepare the local Piper audio fixture.");
  const transcribed = await request("voice.whisper.transcribe", {
    audioBase64: audioUrl.slice("data:audio/wav;base64,".length), fileName: "adapter-check.wav", language: "en-US", operationId: randomUUID(),
  }, 30 * 60_000);
  const transcript = transcribed.result?.transcript;
  if (!transcribed.ok || transcribed.result?.engine !== "whisper-large-v3-local" || typeof transcript !== "string" || transcript.length < 8) {
    throw new Error(`Whisper local transcription failed: ${JSON.stringify(transcribed)}`);
  }
  process.stdout.write(`Whisper large-v3 local install and transcription smoke passed: ${transcript}\n`);

  const operationId = randomUUID();
  const longAudio = repeatPcmWave(audioUrl.slice("data:audio/wav;base64,".length), 48);
  if (Buffer.byteLength(longAudio, "base64") > 20 * 1024 * 1024) throw new Error("Cancellation fixture exceeds the local audio size limit.");
  const pendingTranscription = request("voice.whisper.transcribe", {
    audioBase64: longAudio, fileName: "cancellation-check.wav", language: "en-US", operationId,
  }, 30 * 60_000);
  await new Promise(resolve => setTimeout(resolve, 1_000));
  const cancellation = await request("voice.whisper.transcribe.cancel", { operationId });
  const cancelledTranscription = await pendingTranscription;
  if (!cancellation.ok || cancellation.result?.cancellationRequested !== true || cancellation.result?.wasRunning !== true || cancelledTranscription.ok || !cancelledTranscription.error?.message?.toLowerCase().includes("cancel")) {
    throw new Error(`Whisper cancellation did not stop the local transcription: ${JSON.stringify({ cancellation, cancelled: cancelledTranscription.ok, error: cancelledTranscription.error?.message })}`);
  }
  process.stdout.write("Whisper cancellation smoke passed: active local transcription stopped without returning a transcript.\n");
}

run().catch(error => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; }).finally(() => { child.stdin.end(); child.kill(); });
