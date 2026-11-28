const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const desktopRoot = path.join(root, "apps", "desktop");
const electronDist = path.join(desktopRoot, "node_modules", "electron", "dist");
const defaultOutputRoot = path.join(root, "dist", "electron", `${process.platform === "win32" ? "win" : process.platform}-x64`);
const finalOutputRoot = path.resolve(process.env.SKAI_ELECTRON_OUTPUT_ROOT || defaultOutputRoot);
const outputRoot = `${finalOutputRoot}.staging-${process.pid}-${Date.now()}`;
const appRoot = path.join(outputRoot, "resources", "app");
const hostRoot = path.join(outputRoot, "resources", "agent-host");
const runtime = process.platform === "win32" ? "win-x64" : process.platform === "linux" ? "linux-x64" : "osx-x64";
const electronBinary = process.platform === "win32" ? "electron.exe" : "electron";
const packagedBinary = process.platform === "win32" ? "Skai Desktop.exe" : "Skai Desktop";
const hostBinary = process.platform === "win32" ? "SkaiDesktop.AgentHost.exe" : "SkaiDesktop.AgentHost";
const desktopPackage = JSON.parse(fs.readFileSync(path.join(desktopRoot, "package.json"), "utf8"));
let committed = false;

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function removeDirectoryBestEffort(target) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      if (!fs.existsSync(target)) return true;
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 2, retryDelay: 150 });
      return !fs.existsSync(target);
    } catch (error) {
      if (!(["EPERM", "EBUSY", "ENOTEMPTY", "EACCES"].includes(error?.code))) throw error;
      sleepSync(250);
    }
  }
  return !fs.existsSync(target);
}

function cleanupPreviousOutputs() {
  const parent = path.dirname(finalOutputRoot);
  const prefix = `${path.basename(finalOutputRoot)}.previous-`;
  try {
    for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
      if (!entry.name.startsWith(prefix)) continue;
      const target = path.join(parent, entry.name);
      if (!removeDirectoryBestEffort(target)) console.warn(`Keeping locked previous Electron artifact for a later cleanup: ${target}`);
    }
  } catch { /* cleanup must never hide a successfully staged artifact */ }
}

process.on("exit", () => {
  if (!committed) {
    try { fs.rmSync(outputRoot, { recursive: true, force: true }); } catch { /* preserve the original failure */ }
  }
});

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}.`);
}

function resolveInstalledPackage(packageName, sourceNodeModules) {
  let searchDirectory = sourceNodeModules;
  while (true) {
    const candidate = path.join(searchDirectory, packageName);
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    const parent = path.dirname(searchDirectory);
    if (parent === searchDirectory) break;
    searchDirectory = path.join(parent, "node_modules");
  }
  throw new Error(`Offline packaging could not find installed dependency ${packageName}.`);
}

function stageOfflineProductionDependencies() {
  const sourceNodeModules = path.join(desktopRoot, "node_modules");
  const destinationNodeModules = path.join(appRoot, "node_modules");
  if (!fs.existsSync(sourceNodeModules)) throw new Error("Offline packaging requires apps/desktop/node_modules.");
  const pending = Object.keys(desktopPackage.dependencies ?? {});
  const copied = new Set();
  fs.mkdirSync(destinationNodeModules, { recursive: true });

  while (pending.length > 0) {
    const packageName = pending.pop();
    if (!packageName || copied.has(packageName)) continue;
    const sourcePackage = resolveInstalledPackage(packageName, sourceNodeModules);
    const manifest = JSON.parse(fs.readFileSync(path.join(sourcePackage, "package.json"), "utf8"));
    const destinationPackage = path.join(destinationNodeModules, packageName);
    fs.mkdirSync(path.dirname(destinationPackage), { recursive: true });
    fs.cpSync(sourcePackage, destinationPackage, {
      recursive: true,
      force: true,
      filter: (source) => path.basename(source) !== "node_modules",
    });
    copied.add(packageName);
    for (const dependency of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies })) pending.push(dependency);
  }
  console.warn(`Offline dependency staging used the existing installed production graph (${copied.size} packages).`);
}

if (!fs.existsSync(electronDist)) throw new Error("Electron dependencies are not installed. Run npm run desktop:install first.");
if (!fs.existsSync(path.join(desktopRoot, "dist", "index.html"))) throw new Error("Electron renderer is not built. Run npm run desktop:build first.");
// Refuse to package a renderer build that is older than its sources (e.g. after a pull without rebuilding).
{
  const newestMtime = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((latest, entry) => {
    const full = path.join(dir, entry.name);
    return Math.max(latest, entry.isDirectory() ? newestMtime(full) : fs.statSync(full).mtimeMs);
  }, 0);
  const sourceMtime = Math.max(...["src", "shared"].map((dir) => newestMtime(path.join(desktopRoot, dir))), fs.statSync(path.join(desktopRoot, "index.html")).mtimeMs);
  const builtMtime = newestMtime(path.join(desktopRoot, "dist"));
  if (builtMtime < sourceMtime) throw new Error("The Electron renderer build is older than apps/desktop/src. Run npm run desktop:build first so the package matches the sources.");
}

fs.mkdirSync(appRoot, { recursive: true });
fs.mkdirSync(hostRoot, { recursive: true });

run("dotnet", ["publish", path.join("services", "agent-host", "SkaiDesktop.AgentHost.csproj"), "-c", "Release", "-r", runtime, "--self-contained", "true", "-p:PublishSingleFile=true", "-p:PublishTrimmed=false", "-o", hostRoot]);
const airLlmWorkerSource = path.join(root, "services", "airllm");
const airLlmWorkerTarget = path.join(hostRoot, "airllm");
if (!fs.existsSync(path.join(airLlmWorkerSource, "skai_airllm.py"))) throw new Error("The AirLLM worker is missing from services/airllm.");
fs.cpSync(airLlmWorkerSource, airLlmWorkerTarget, { recursive: true, force: true });
const diffusersWorkerSource = path.join(root, "services", "diffusers");
const diffusersWorkerTarget = path.join(hostRoot, "diffusers");
if (!fs.existsSync(path.join(diffusersWorkerSource, "skai_diffusers.py")) || !fs.existsSync(path.join(diffusersWorkerSource, "requirements.txt"))) throw new Error("The optional local image workers are missing from services/diffusers.");
fs.cpSync(diffusersWorkerSource, diffusersWorkerTarget, { recursive: true, force: true });

fs.cpSync(electronDist, outputRoot, { recursive: true, force: true });
fs.cpSync(path.join(desktopRoot, "dist"), path.join(appRoot, "dist"), { recursive: true, force: true });
fs.cpSync(path.join(desktopRoot, "electron"), path.join(appRoot, "electron"), { recursive: true, force: true });
fs.cpSync(path.join(desktopRoot, "package.json"), path.join(appRoot, "package.json"), { force: true });
fs.cpSync(path.join(desktopRoot, "package-lock.json"), path.join(appRoot, "package-lock.json"), { force: true });
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run packaging through npm so the locked production dependencies can be staged reproducibly.");
try {
  run(process.execPath, [npmCli, "ci", "--omit=dev", "--ignore-scripts", "--prefix", appRoot]);
} catch (error) {
  console.warn(`Locked production dependency install failed (${error.message}); attempting the installed offline dependency graph.`);
  fs.rmSync(path.join(appRoot, "node_modules"), { recursive: true, force: true });
  stageOfflineProductionDependencies();
}
if (!fs.existsSync(path.join(appRoot, "node_modules", "electron-updater", "out", "main.js"))) {
  throw new Error("The runtime electron-updater dependency was not staged into the packaged app.");
}
fs.writeFileSync(path.join(outputRoot, "resources", "app-update.yml"), [
  "provider: github",
  "owner: WowLolCoolMan",
  "repo: skai-desktop",
  "releaseType: release",
  "",
].join("\n"), "utf8");
fs.mkdirSync(path.join(appRoot, "assets", "branding"), { recursive: true });
fs.copyFileSync(path.join(root, "assets", "branding", "skaiwolficon.png"), path.join(appRoot, "assets", "branding", "skaiwolficon.png"));
fs.renameSync(path.join(outputRoot, electronBinary), path.join(outputRoot, packagedBinary));

const publishedHost = path.join(hostRoot, hostBinary);
if (!fs.existsSync(publishedHost)) throw new Error(`The self-contained Agent Host was not published at ${publishedHost}.`);
if (!fs.existsSync(path.join(airLlmWorkerTarget, "skai_airllm.py"))) throw new Error(`The packaged AirLLM worker was not staged at ${path.join(airLlmWorkerTarget, "skai_airllm.py")}.`);
if (!fs.existsSync(path.join(diffusersWorkerTarget, "skai_diffusers.py")) || !fs.existsSync(path.join(diffusersWorkerTarget, "skai_pet_background.py"))) throw new Error(`The packaged Diffusers workers were not staged at ${diffusersWorkerTarget}.`);
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
fs.writeFileSync(path.join(outputRoot, "artifact-manifest.json"), JSON.stringify({
  product: "Skai Desktop",
  version: desktopPackage.version,
  platform: process.platform,
  architecture: "x64",
  executable: packagedBinary,
  files: {
    executable: sha256(path.join(outputRoot, packagedBinary)),
    agentHost: sha256(publishedHost),
    airLlmWorker: sha256(path.join(airLlmWorkerTarget, "skai_airllm.py")),
    diffusersWorker: sha256(path.join(diffusersWorkerTarget, "skai_diffusers.py")),
    petBackgroundWorker: sha256(path.join(diffusersWorkerTarget, "skai_pet_background.py")),
  },
}, null, 2) + "\n", "utf8");
// Linux: ship a per-user installer, app-launcher entry and icon alongside the portable folder.
if (process.platform === "linux") {
  for (const script of ["install.sh", "uninstall.sh"]) {
    const target = path.join(outputRoot, script);
    fs.copyFileSync(path.join(root, "packaging", "linux", script), target);
    fs.chmodSync(target, 0o755);
  }
  fs.copyFileSync(path.join(root, "assets", "branding", "skaiwolficon.png"), path.join(outputRoot, "skai-desktop.png"));
}
fs.writeFileSync(path.join(outputRoot, "README-release.txt"), [
  "Skai Desktop portable Electron artifact",
  "",
  `Run ${packagedBinary} from this folder. The bundled Agent Host is in resources/agent-host, including optional local model and pet image workers.`,
  ...(process.platform === "linux" ? [
    "",
    "Linux: run ./install.sh to install for your user (no root needed). It adds Skai Desktop to your app",
    "launcher and a `skai-desktop` command. On systems that restrict unprivileged user namespaces",
    "(for example Ubuntu 24.04+) it offers the one sudo step Chromium's sandbox needs. ./uninstall.sh",
    "removes the app and keeps your chats and settings in ~/.config/SkaiDesktop and ~/.config/skai-desktop.",
  ] : []),
  "This portable artifact is for release validation; signed installers require the release signing gate.",
  "",
].join("\n"), "utf8");

const previousOutputRoot = `${finalOutputRoot}.previous-${process.pid}`;
if (fs.existsSync(finalOutputRoot)) fs.renameSync(finalOutputRoot, previousOutputRoot);
try {
  fs.renameSync(outputRoot, finalOutputRoot);
  committed = true;
  cleanupPreviousOutputs();
} catch (error) {
  if (!fs.existsSync(finalOutputRoot) && fs.existsSync(previousOutputRoot)) fs.renameSync(previousOutputRoot, finalOutputRoot);
  throw error;
}
console.log(`Electron artifact staged: ${finalOutputRoot}`);
