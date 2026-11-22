const { spawn } = require("node:child_process");
const path = require("node:path");

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const projectRoot = path.resolve(__dirname, "..");
// Windows can reject spawning a .cmd shim directly from some Node hosts with
// EINVAL. Invoke the platform command interpreter explicitly instead of using
// Node's shell option, which also avoids its argument-escaping warning.
const command = `${npmCommand} --prefix apps/desktop run dev`;
const child = spawn(process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : npmCommand,
  process.platform === "win32" ? ["/d", "/s", "/c", command] : ["--prefix", "apps/desktop", "run", "dev"], {
  cwd: projectRoot,
  env: process.env,
  stdio: "inherit",
  windowsHide: true,
});

const forwardSignal = (signal) => {
  if (!child.killed) child.kill(signal);
};

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

child.on("error", (error) => {
  console.error(`Unable to start the Electron desktop: ${error.message}`);
  console.error("Run npm run desktop:install, then try again.");
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
