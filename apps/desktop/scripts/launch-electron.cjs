// Launch Electron with the Linux display backend decided up front.
//
// Chromium chooses X11 vs Wayland before main.cjs runs, so the choice has to be
// a command-line flag. main.cjs can relaunch itself with the flag, but under
// `concurrently -k` (npm run dev) the exiting first process would tear down the
// dev server, so the npm scripts go through this launcher instead.
const { spawn } = require("node:child_process");
const path = require("node:path");
const { resolveDisplayBackend } = require("../electron/linux-windowing.cjs");

const desktopRoot = path.resolve(__dirname, "..");
const electronBinary = require("electron");
const extraArgs = process.argv.slice(2);
const decision = resolveDisplayBackend({ argv: extraArgs });
const args = [".", ...extraArgs];
if (decision.switchValue) args.push(`--ozone-platform=${decision.switchValue}`);

const child = spawn(electronBinary, args, { cwd: desktopRoot, env: process.env, stdio: "inherit", windowsHide: true });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => { if (!child.killed) child.kill(signal); });
}
child.on("error", (error) => {
  console.error(`Unable to start Electron: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = signal ? 1 : code ?? 1;
});
