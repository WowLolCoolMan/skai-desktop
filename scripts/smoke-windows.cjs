const { spawn } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const npmCommand = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npm";
const steps = [
  "check:syntax",
  "check:hygiene",
  "audit:electron-runtime",
  "audit:electron-tray",
  "audit:bridge-methods",
  "audit:local-only",
  "check:release-config",
  "audit:release-workflow",
  "desktop:typecheck",
  "desktop:build",
  "package:electron",
  "smoke:agent-host",
  "smoke:marketplace-host",
  "test",
  "smoke:task-replan",
  "smoke:electron:artifact",
  "smoke:electron:themes",
  "smoke:electron:overflow",
];

function run(step) {
  return new Promise((resolve, reject) => {
    console.log(`\n[smoke:windows] npm run ${step}`);
    const args = process.platform === "win32" ? ["/d", "/s", "/c", `npm.cmd run ${step}`] : ["run", step];
    // Mirror output to the console and keep the tail, so a failure can be reported as a
    // GitHub Actions annotation (annotations are readable without access to the job log).
    const child = spawn(npmCommand, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let tail = "";
    const keep = (chunk, stream) => { stream.write(chunk); tail = (tail + chunk.toString()).slice(-6000); };
    child.stdout.on("data", (chunk) => keep(chunk, process.stdout));
    child.stderr.on("data", (chunk) => keep(chunk, process.stderr));
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) { resolve(); return; }
      const error = new Error(`${step} failed${signal ? ` with ${signal}` : ` with exit code ${code}`}.`);
      error.step = step;
      error.tail = tail;
      reject(error);
    });
  });
}

async function main() {
  for (const step of steps) await run(step);
  console.log(`\nWindows smoke passed: ${steps.length} staged checks.`);
}

const annotationEscape = (text) => text.replace(/%/g, "%25").replace(/\r/g, "").replace(/\n/g, "%0A");

main().catch((error) => {
  console.error(`\nWindows smoke failed: ${error.message}`);
  if (process.env.GITHUB_ACTIONS === "true") {
    const lines = String(error.tail || "").split(/\r?\n/).filter((line) => line.trim()).slice(-25).join("\n");
    console.log(`::error title=smoke:windows ${error.step || "step"} failed::${annotationEscape(`${error.message}\n${lines}`)}`);
  }
  process.exitCode = 1;
});
