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

function request(method, params = {}, timeoutMs = 20 * 60_000) {
  const id = `piper-${nextId++}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out waiting for ${method}.`)); }, timeoutMs);
    pending.set(id, message => { clearTimeout(timer); resolve(message); });
    child.stdin.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
  });
}

async function run() {
  const started = await request("voice.piper.install.start");
  if (!started.ok) throw new Error(started.error?.message ?? "Piper install did not start.");
  let status;
  do {
    await new Promise(resolve => setTimeout(resolve, 1_500));
    status = await request("voice.piper.install.status");
    if (!status.ok) throw new Error(status.error?.message ?? "Could not read Piper install status.");
    if (status.result?.status === "failed") throw new Error(status.result.error ?? "Piper installation failed.");
    process.stdout.write(`Piper: ${status.result?.step || status.result?.status}\n`);
  } while (!status.result?.installed);

  const speech = await request("voice.speak", { text: "Skai local voice adapter capability check.", modelId: "piper", rate: 1 }, 5 * 60_000);
  const url = speech.result?.audioDataUrl;
  if (!speech.ok || speech.result?.engine !== "piper-local" || typeof url !== "string" || !url.startsWith("data:audio/wav;base64,")) {
    throw new Error(`Piper speech generation failed: ${JSON.stringify(speech)}`);
  }
  const audio = Buffer.from(url.slice("data:audio/wav;base64,".length), "base64");
  if (audio.length < 16_000 || audio.subarray(0, 4).toString() !== "RIFF" || audio.subarray(8, 12).toString() !== "WAVE") {
    throw new Error("Piper returned an invalid or empty WAV sample.");
  }
  process.stdout.write(`Piper local install and speech smoke passed (${audio.length.toLocaleString()} WAV bytes).\n`);
}

run().catch(error => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; }).finally(() => { child.stdin.end(); child.kill(); });
