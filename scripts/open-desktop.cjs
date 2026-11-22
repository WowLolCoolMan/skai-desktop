const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const desktopRoot = path.join(projectRoot, "apps", "desktop");
const electronBinary = process.platform === "win32"
  ? path.join(desktopRoot, "node_modules", "electron", "dist", "electron.exe")
  : path.join(desktopRoot, "node_modules", ".bin", "electron");

if (!fs.existsSync(electronBinary)) {
  console.error(`Unable to open the Electron desktop: ${electronBinary} does not exist.`);
  console.error("Run npm install, then try again.");
  process.exitCode = 1;
  return;
}

if (process.platform === "win32") {
  const electronDist = path.dirname(electronBinary);
  try {
    const acl = execFileSync("icacls.exe", [electronDist], { encoding: "utf8", windowsHide: true });
    if (!acl.includes("S-1-15-2-1")) {
      console.warn("Electron may be blocked by Windows AppContainer ACLs.");
      console.warn(`Repair with: icacls "${electronDist}" /grant *S-1-15-2-1:(OI)(CI)(RX) /T`);
    }
  } catch {
    // The preflight is diagnostic only; Electron remains responsible for the
    // definitive launch result.
  }
}

const child = spawn(electronBinary, ["."], {
  cwd: desktopRoot,
  env: process.env,
  stdio: ["ignore", "ignore", "pipe"],
  windowsHide: true,
  detached: true,
});

let stderr = "";
child.stderr?.setEncoding("utf8");
child.stderr?.on("data", (chunk) => {
  stderr = `${stderr}${chunk}`.slice(-4000);
});

const earlyFailure = new Promise((resolve) => {
  let settled = false;
  const finish = (result) => {
    if (settled) return;
    settled = true;
    resolve(result);
  };
  child.once("error", (error) => finish({ error }));
  child.once("exit", (code, signal) => finish({ code, signal }));
  setTimeout(() => finish(null), 3500).unref();
});

(async () => {
  const result = await earlyFailure;
  if (!result) {
    child.stderr?.destroy();
    child.on("error", () => undefined);
    child.unref();
    return;
  }

  const detail = result.error?.message
    ?? `Electron exited before the desktop opened${result.signal ? ` with ${result.signal}` : ` (code ${result.code ?? "unknown"})`}.`;
  console.error(`Unable to open the Electron desktop: ${detail}`);
  if (result.code === 2147483651) console.error("Electron terminated during native Windows startup; check the AppContainer ACL warning above and launch from a normal interactive desktop session.");
  if (stderr.trim()) console.error(stderr.trim());
  console.error("Run npm run desktop:build, then try again.");
  process.exitCode = 1;
})();

