const { spawn } = require("node:child_process");

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
    audioBase64: audioUrl.slice("data:audio/wav;base64,".length), fileName: "adapter-check.wav", language: "en-US",
  }, 30 * 60_000);
  const transcript = transcribed.result?.transcript;
  if (!transcribed.ok || transcribed.result?.engine !== "whisper-large-v3-local" || typeof transcript !== "string" || transcript.length < 8) {
    throw new Error(`Whisper local transcription failed: ${JSON.stringify(transcribed)}`);
  }
  process.stdout.write(`Whisper large-v3 local install and transcription smoke passed: ${transcript}\n`);
}

run().catch(error => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; }).finally(() => { child.stdin.end(); child.kill(); });
