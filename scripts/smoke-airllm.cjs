const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.join(__dirname, "..");
const candidates = process.platform === "win32"
  ? [path.join(process.env.LOCALAPPDATA || "", "Skai", "AirLLM", "venv", "Scripts", "python.exe")]
  : [path.join(os.homedir(), ".local", "share", "skai", "AirLLM", "venv", "bin", "python")];
const python = candidates.find((candidate) => candidate && fs.existsSync(candidate));

if (!python) {
  console.log("AirLLM smoke skipped: no user-local AirLLM Python environment is installed.");
  process.exit(0);
}

function run(command, args, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
    child.stdin.end(input);
  });
}

async function main() {
  const environment = await run(python, ["-c", "import airllm, torch; print(torch.cuda.is_available())"]);
  if (environment.code !== 0) throw new Error(`AirLLM environment import failed: ${environment.stderr.trim() || environment.stdout.trim()}`);
  const cudaAvailable = environment.stdout.trim().split(/\r?\n/).at(-1) === "True";
  if (cudaAvailable) {
    console.log("AirLLM smoke passed: installed environment imports and CUDA is available; real model inference remains an explicit download test.");
    return;
  }

  const worker = path.join(root, "services", "airllm", "skai_airllm.py");
  const result = await run(python, [worker], `${JSON.stringify({ model: "hf-internal-testing/tiny-random-LlamaForCausalLM", device: "cuda:0", messages: [{ role: "user", content: "smoke" }], max_new_tokens: 1 })}\n`);
  const event = result.stdout.trim().split(/\r?\n/).map((line) => { try { return JSON.parse(line); } catch { return null; } }).find((item) => item?.type === "error");
  if (result.code === 0 || !event || !event.message.includes("configured to use CUDA") || !event.message.includes("no available CUDA device")) {
    throw new Error(`AirLLM worker did not fail closed before inference: ${JSON.stringify({ code: result.code, event, stdout: result.stdout, stderr: result.stderr })}`);
  }
  console.log("AirLLM smoke passed: installed worker returns a structured CUDA/NVIDIA preflight error without downloading model weights.");
}

main().catch((error) => { console.error(error.message); process.exit(1); });
