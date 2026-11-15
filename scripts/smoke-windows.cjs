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
    const child = spawn(npmCommand, args, { cwd: root, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${step} failed${signal ? ` with ${signal}` : ` with exit code ${code}`}.`));
    });
  });
}

async function main() {
  for (const step of steps) await run(step);
  console.log(`\nWindows smoke passed: ${steps.length} staged checks.`);
}

main().catch((error) => {
  console.error(`\nWindows smoke failed: ${error.message}`);
  process.exitCode = 1;
});
