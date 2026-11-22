#!/usr/bin/env node

/* Runs a genuine NSIS auto-update against a disposable loopback feed/profile. */
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const yaml = require(require.resolve("js-yaml", { paths: [path.join(__dirname, "..", "apps", "desktop")] }));

if (process.platform !== "win32") throw new Error("The Windows updater feed smoke must run on Windows.");
const [packagedArg, currentArg] = process.argv.slice(2);
if (!packagedArg || !currentArg) throw new Error("Usage: node scripts/smoke-windows-update-feed.cjs <packaged-app-directory> <current-installer.exe>");
const packagedApp = path.resolve(packagedArg);
const currentInstaller = path.resolve(currentArg);
if (!fs.existsSync(path.join(packagedApp, "Skai Desktop.exe")) || !fs.existsSync(path.join(packagedApp, "resources", "app", "package.json"))) throw new Error(`Packaged app directory is incomplete: ${packagedApp}`);
if (!fs.existsSync(currentInstaller)) throw new Error(`Current installer not found: ${currentInstaller}`);

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "skai-update-feed-smoke-"));
const installDir = path.join(scratch, "installed-app");
const roaming = path.join(scratch, "profile", "Roaming");
const local = path.join(scratch, "profile", "Local");
const marker = path.join(roaming, "skai-desktop", "update-feed-marker.json");
const feed = path.join(scratch, "feed");
const appExecutable = path.join(installDir, "Skai Desktop.exe");
let smokePort;
const devtoolsPort = 19328;
let appProcess;
let server;
let serverRequests = 0;
let processOutput = "";
let mainTarget;
let stage = "initializing";
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function run(file, args, label, env) {
  const result = spawnSync(file, args, { env, cwd: path.dirname(file), encoding: "utf8", windowsHide: true, timeout: 180_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed (exit ${result.status}).\n${result.stdout}\n${result.stderr}`);
  return result.stdout || "";
}

async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.json();
}

async function evaluate(expression) {
  const socket = new WebSocket(mainTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error(`DevTools websocket could not connect at stage '${stage}'.`)), { once: true });
  });
  return new Promise((resolve, reject) => {
    const id = 1;
    const timer = setTimeout(() => { socket.close(); reject(new Error("Timed out calling the packaged update bridge.")); }, 15_000);
    socket.addEventListener("message", event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      clearTimeout(timer);
      socket.close();
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result?.result?.value);
    });
    socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  });
}

function installDirectoryVersion() {
  const packageJson = path.join(installDir, "resources", "app", "package.json");
  return JSON.parse(fs.readFileSync(packageJson, "utf8")).version;
}

async function waitForTarget() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const pages = (await json(`http://127.0.0.1:${devtoolsPort}/json/list`)).filter(item => item.type === "page" && !item.url?.includes("?pet=1"));
      for (const page of pages) {
        mainTarget = page;
        if (await evaluate("Boolean(window.skaiAgent?.updates?.state)")) return page;
      }
    } catch { /* Packaged window is starting. */ }
    await sleep(250);
  }
  throw new Error(`Packaged updater baseline did not expose its renderer. ${processOutput.slice(-2_000)}`);
}

async function readUpdateState() {
  const bridge = await evaluate("Boolean(window.skaiAgent?.updates?.state)");
  if (!bridge) throw new Error(`Packaged renderer has no updater bridge at ${mainTarget.url}. The baseline fixture must include current updater code. ${processOutput.slice(-2_000)}`);
  const raw = await evaluate("window.skaiAgent?.updates?.state?.().then(value => JSON.stringify(value)) ?? Promise.resolve('null')");
  return JSON.parse(raw || "null");
}

async function main() {
  stage = "prepare local feed";
  fs.mkdirSync(roaming, { recursive: true });
  fs.mkdirSync(local, { recursive: true });
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, JSON.stringify({ purpose: "isolated in-app update data-retention smoke", version: "0.1.3" }));
  fs.mkdirSync(feed, { recursive: true });

  const baselinePackage = path.join(scratch, "baseline-package");
  function linkPackageDirectory(source, destination) {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      const from = path.join(source, entry.name);
      const to = path.join(destination, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Refusing a symlink in the packaged updater fixture: ${from}`);
      if (entry.isDirectory()) linkPackageDirectory(from, to);
      else if (entry.isFile() && ["resources\\app\\package.json", "artifact-manifest.json"].includes(path.relative(packagedApp, from).toLowerCase())) {
        const sourceText = fs.readFileSync(from, "utf8");
        const metadata = JSON.parse(sourceText);
        metadata.version = "0.1.3";
        fs.writeFileSync(to, JSON.stringify(metadata, null, 2) + "\n");
      } else if (entry.isFile()) fs.linkSync(from, to);
      else throw new Error(`Unsupported entry in the packaged updater fixture: ${from}`);
    }
  }
  linkPackageDirectory(packagedApp, baselinePackage);
  const baselineInstallerDirectory = path.join(scratch, "baseline-installer");
  const buildBaseline = spawnSync(process.execPath, [path.join(__dirname, "package-windows-installer.cjs"), baselinePackage, baselineInstallerDirectory], {
    cwd: path.join(__dirname, ".."), env: { ...process.env, SKAI_ALLOW_UNSIGNED_INSTALLER: "true" }, stdio: "inherit", shell: false,
  });
  if (buildBaseline.error) throw buildBaseline.error;
  if (buildBaseline.status !== 0) throw new Error(`The disposable 0.1.3 updater baseline build failed (exit ${buildBaseline.status}).`);
  const previousInstaller = path.join(baselineInstallerDirectory, "Skai-Desktop-0.1.3-Setup-x64.exe");
  if (!fs.existsSync(previousInstaller)) throw new Error("The disposable 0.1.3 updater baseline installer is missing.");

  const metadataPath = path.join(path.dirname(currentInstaller), "latest.yml");
  if (!fs.existsSync(metadataPath)) throw new Error(`Current update metadata is missing: ${metadataPath}`);
  const metadata = yaml.load(fs.readFileSync(metadataPath, "utf8"));
  if (metadata.version !== "0.1.4") throw new Error(`Expected the feed target to be 0.1.4, found ${metadata.version}.`);
  const currentName = path.basename(currentInstaller);
  const metadataEntry = metadata.files.find(item => item.url === currentName);
  if (!metadataEntry) throw new Error(`latest.yml does not describe ${currentName}.`);
  const stagedInstaller = path.join(feed, currentName);
  fs.copyFileSync(currentInstaller, stagedInstaller);
  if (fs.statSync(stagedInstaller).size !== metadataEntry.size) throw new Error("Staged update size differs from latest.yml.");
  const latestText = fs.readFileSync(metadataPath, "utf8");
  fs.writeFileSync(path.join(feed, "latest.yml"), latestText);
  const blockmapPath = `${currentInstaller}.blockmap`;
  if (fs.existsSync(blockmapPath)) fs.copyFileSync(blockmapPath, `${stagedInstaller}.blockmap`);

  server = http.createServer((request, response) => {
    serverRequests++;
    let name;
    try { name = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname).replace(/^\/+/, ""); }
    catch { response.writeHead(400).end(); return; }
    if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) { response.writeHead(404).end(); return; }
    const file = path.join(feed, name);
    if (!fs.existsSync(file)) { response.writeHead(404).end(); return; }
    const stat = fs.statSync(file);
    const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Math.min(range[2] ? Number(range[2]) : stat.size - 1, stat.size - 1);
      if (start > end || start >= stat.size) { response.writeHead(416, { "Content-Range": `bytes */${stat.size}` }).end(); return; }
      response.writeHead(206, { "Accept-Ranges": "bytes", "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${stat.size}` });
      fs.createReadStream(file, { start, end }).pipe(response);
      return;
    }
    response.writeHead(200, { "Accept-Ranges": "bytes", "Content-Length": stat.size, "Content-Type": name.endsWith(".yml") ? "text/yaml" : "application/octet-stream" });
    if (request.method === "HEAD") response.end();
    else fs.createReadStream(file).pipe(response);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  smokePort = server.address().port;

  const env = { ...process.env, APPDATA: roaming, LOCALAPPDATA: local, SKAI_SKIP_LEGACY_DATA_MIGRATION: "true" };
  stage = "install 0.1.3 baseline";
  run(previousInstaller, ["/S", `/D=${installDir}`], "Install disposable 0.1.3 updater baseline", env);
  if (installDirectoryVersion() !== "0.1.3") throw new Error("The disposable baseline installer did not install version 0.1.3.");
  const updateConfig = path.join(installDir, "resources", "app-update.yml");
  fs.writeFileSync(updateConfig, `provider: generic\nurl: http://127.0.0.1:${smokePort}/\n`);
  appProcess = spawn(appExecutable, [`--remote-debugging-port=${devtoolsPort}`, `--user-data-dir=${path.join(scratch, "chromium-profile")}`], { cwd: installDir, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  appProcess.stdout.on("data", chunk => { processOutput += chunk.toString(); });
  appProcess.stderr.on("data", chunk => { processOutput += chunk.toString(); });
  appProcess.on("exit", (code, signal) => { processOutput += `\n[app-exit code=${code} signal=${signal}]`; });
  stage = "connect to packaged renderer";
  await waitForTarget();

  stage = "wait for verified update download";
  const deadline = Date.now() + 8 * 60_000;
  let state;
  while (Date.now() < deadline) {
    state = await readUpdateState();
    if (state?.status !== "checking" && state?.status !== "downloading" && state?.status !== "idle") console.log(`Updater state: ${JSON.stringify(state)}`);
    if (state?.status === "downloaded") break;
    if (state?.status === "error") throw new Error(`The real updater failed: ${state.error || state.message}. ${processOutput.slice(-2_000)}`);
    await sleep(1500);
  }
  if (state?.status !== "downloaded") throw new Error(`The updater did not stage 0.1.4 before timeout; last state: ${JSON.stringify(state)}. ${processOutput.slice(-2_000)}`);
  if (serverRequests < 2) throw new Error(`The app did not contact the isolated update feed; requests=${serverRequests}.`);
  if (!state.message?.includes("verified")) throw new Error(`The downloaded update is not reported as verified: ${JSON.stringify(state)}`);

  stage = "invoke in-app install action";
  const installCall = await evaluate("window.skaiAgent.updates.install().then(value => String(value))");
  if (installCall !== "true") throw new Error(`The Settings update action did not authorize installation: ${installCall}`);
  const oldProcessPid = appProcess.pid;
  const exitDeadline = Date.now() + 30_000;
  let oldExitResult = null;
  while (Date.now() < exitDeadline) {
    if (appProcess.exitCode !== null || appProcess.signalCode !== null) { oldExitResult = true; break; }
    try { process.kill(oldProcessPid, 0); }
    catch (error) {
      if (error.code !== "ESRCH") throw error;
      oldExitResult = true;
      break;
    }
    await sleep(250);
  }
  if (!oldExitResult) {
    const command = "$root=[IO.Path]::GetFullPath($env:SKAI_TEST_ROOT)+'\\'; Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath).StartsWith($root,[StringComparison]::OrdinalIgnoreCase) } | Select-Object ProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress";
    const processes = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { env: { ...process.env, SKAI_TEST_ROOT: scratch }, encoding: "utf8", windowsHide: true, timeout: 10_000 });
    throw new Error(`The old app process ${oldProcessPid} did not exit after the user-confirmed update action. Remaining test processes: ${processes.stdout || processes.stderr}. ${processOutput.slice(-2_000)}`);
  }
  appProcess = undefined;

  const upgradeDeadline = Date.now() + 120_000;
  let upgradedVersion;
  while (Date.now() < upgradeDeadline) {
    try { upgradedVersion = installDirectoryVersion(); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (upgradedVersion === "0.1.4") break;
    await sleep(1000);
  }
  if (upgradedVersion !== "0.1.4") throw new Error(`The in-app update installer did not upgrade the disposable directory; found ${upgradedVersion}. ${processOutput.slice(-2_000)}`);
  if (!fs.existsSync(marker)) throw new Error("The in-app update removed the user's disposable profile marker.");

  stage = "uninstall disposable updated app";
  const uninstallerDeadline = Date.now() + 120_000;
  let uninstallerName;
  while (Date.now() < uninstallerDeadline) {
    uninstallerName = fs.readdirSync(installDir).find(entry => /^uninstall.*\.exe$/i.test(entry));
    if (uninstallerName) break;
    await sleep(500);
  }
  if (!uninstallerName) throw new Error(`The updated installation did not restore its NSIS uninstaller. Files: ${fs.readdirSync(installDir).slice(0, 16).join(", ")}`);
  const uninstaller = path.join(installDir, uninstallerName);
  run(uninstaller, ["/S"], "Uninstall disposable updated app");
  const uninstallDeadline = Date.now() + 30_000;
  while (Date.now() < uninstallDeadline && fs.existsSync(installDir)) await sleep(250);
  if (fs.existsSync(installDir)) throw new Error("Silent uninstall left application files behind after the update smoke.");
  if (!fs.existsSync(marker)) throw new Error("Uninstall removed the disposable user profile marker.");

  console.log(JSON.stringify({ result: "passed", baseline: "0.1.3 synthetic package using current updater code", updated: upgradedVersion, feedRequests: serverRequests, stagedUpdateStatus: state.status, userDataMarkerRetained: true, applicationFilesRemovedAfterward: true, installerSignature: "NotSigned (local-only test)" }, null, 2));
}

main().catch(error => { console.error(`Updater smoke failed during '${stage}':`, error); if (processOutput) console.error(processOutput.slice(-3_000)); process.exitCode = 1; }).finally(async () => {
  if (appProcess && !appProcess.killed) appProcess.kill();
  if (server) await new Promise(resolve => server.close(resolve));
  if (fs.existsSync(installDir)) {
    const command = "$ErrorActionPreference='Stop'; $root=[IO.Path]::GetFullPath($env:SKAI_TEST_ROOT) + '\\'; Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath).StartsWith($root, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
    const stop = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { env: { ...process.env, SKAI_TEST_ROOT: scratch }, encoding: "utf8", windowsHide: true, timeout: 20_000 });
    if (stop.error || stop.status !== 0 || stop.stderr.trim()) console.warn(`Could not close the disposable updated app: ${stop.error?.message || stop.stderr || `PowerShell exited ${stop.status}`}`);
    const uninstallerName = fs.readdirSync(installDir).find(entry => /^uninstall.*\.exe$/i.test(entry));
    if (uninstallerName) {
      const uninstaller = path.resolve(installDir, uninstallerName);
      if (!uninstaller.startsWith(path.resolve(installDir) + path.sep)) throw new Error(`Refusing to run an uninstaller outside the isolated install directory: ${uninstaller}`);
      const uninstall = spawnSync(uninstaller, ["/S"], { env: process.env, cwd: installDir, encoding: "utf8", windowsHide: true, timeout: 60_000 });
      if (uninstall.error || uninstall.status !== 0) console.warn(`Could not uninstall the disposable app: ${uninstall.error?.message || uninstall.stderr || `uninstaller exited ${uninstall.status}`}`);
    }
  }
  const resolved = path.resolve(scratch);
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error(`Refusing to remove a path outside the temporary directory: ${resolved}`);
  try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 12, retryDelay: 500 }); }
  catch (error) { console.warn(`Disposable update test files remain at ${resolved}: ${error.message}`); }
});
