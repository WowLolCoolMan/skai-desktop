#!/usr/bin/env node

/* Exercises electron-updater's AppImage flow against a disposable loopback feed. */
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const yaml = require(require.resolve("js-yaml", { paths: [path.join(__dirname, "..", "apps", "desktop")] }));

if (process.platform !== "linux") throw new Error("The Linux updater feed smoke must run on Linux.");
const [packagedArg, currentArg] = process.argv.slice(2);
const packagedApp = path.resolve(packagedArg || path.join(__dirname, "..", "dist", "electron", "linux-x64"));
const currentAppImage = path.resolve(currentArg || path.join(__dirname, "..", "dist", "installer", "linux-x64", "Skai-Desktop-0.1.4-x64.AppImage"));
if (!fs.existsSync(path.join(packagedApp, "Skai Desktop")) || !fs.existsSync(path.join(packagedApp, "resources", "app", "package.json"))) throw new Error(`Packaged app directory is incomplete: ${packagedApp}`);
if (!fs.existsSync(currentAppImage)) throw new Error(`Current AppImage not found: ${currentAppImage}`);

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "skai-linux-update-feed-"));
const feed = path.join(scratch, "feed");
const installed = path.join(scratch, "installed");
const configHome = path.join(scratch, "profile", "config");
const marker = path.join(configHome, "skai-desktop", "update-feed-marker.json");
const userDataDir = path.join(scratch, "profile", "chromium");
let devtoolsPort;
const currentVersion = "0.1.4";
const previousVersion = "0.1.3";
let server;
let serverRequests = 0;
let appProcess;
let installedAppImage;
let processOutput = "";
let mainTarget;
let stage = "initializing";
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.json();
}

async function getUnusedPort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => probe.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

async function waitForDevtoolsClosed(timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${devtoolsPort}/json/version`, { signal: AbortSignal.timeout(500) });
      if (!response.ok) return;
    } catch { return; }
    await sleep(250);
  }
  throw new Error(`The previous AppImage process kept its DevTools port ${devtoolsPort} open after the update install action.`);
}

function extractAppImage(appImage, destination, label) {
  fs.mkdirSync(destination, { recursive: true });
  const result = spawnSync(appImage, ["--appimage-extract"], {
    cwd: destination,
    env: { ...process.env, APPIMAGE_EXTRACT_AND_RUN: "" },
    stdio: "ignore",
    timeout: 90_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed (exit ${result.status}).`);
  const extracted = path.join(destination, "squashfs-root");
  const executable = path.join(extracted, "Skai Desktop");
  if (!fs.existsSync(executable) || !fs.existsSync(path.join(extracted, "resources", "app-update.yml"))) {
    throw new Error(`${label} did not contain the expected Electron app payload.`);
  }
  return executable;
}

async function evaluate(expression) {
  const socket = new WebSocket(mainTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error(`DevTools websocket unavailable during '${stage}'.`)), { once: true });
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error("Timed out calling the packaged updater bridge.")); }, 15_000);
    socket.addEventListener("message", event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result?.result?.value);
    });
    socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  });
}

async function waitForTarget() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const pages = (await getJson(`http://127.0.0.1:${devtoolsPort}/json/list`)).filter(page => page.type === "page" && !page.url?.includes("?pet=1"));
      for (const page of pages) {
        mainTarget = page;
        if (await evaluate("Boolean(window.skaiAgent?.updates?.state)")) return page;
      }
    } catch { /* The AppImage or renderer is still starting. */ }
    // Linux startup may relaunch once to select a single display backend; the
    // original AppImage process exits successfully while Electron restarts.
    if (appProcess?.exitCode !== null && appProcess?.exitCode !== undefined && appProcess.exitCode !== 0) {
      throw new Error(`The AppImage launcher exited before exposing its renderer (code ${appProcess.exitCode}). ${processOutput.slice(-2_000)}`);
    }
    await sleep(250);
  }
  throw new Error(`Packaged AppImage did not expose its renderer. ${processOutput.slice(-2_000)}`);
}

async function readUpdateState() {
  const raw = await evaluate("window.skaiAgent?.updates?.state?.().then(value => JSON.stringify(value)) ?? Promise.resolve('null')");
  return JSON.parse(raw || "null");
}

async function closeCurrentPage() {
  const socket = new WebSocket(mainTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("DevTools websocket unavailable while closing the rollback smoke app.")), { once: true });
  });
  socket.send(JSON.stringify({ id: 1, method: "Page.close" }));
  await new Promise(resolve => { socket.addEventListener("message", resolve, { once: true }); setTimeout(resolve, 1_000); });
  socket.close();
}

function processesUsingAppImage(appImage) {
  const matches = [];
  if (!fs.existsSync("/proc")) return;
  for (const entry of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
    try {
      const environment = fs.readFileSync(path.join("/proc", entry, "environ"));
      if (environment.toString("utf8").split("\0").includes(`APPIMAGE=${appImage}`)) matches.push(Number(entry));
    } catch { /* The process exited or procfs restricts inspection. */ }
  }
  return matches;
}

function stopProcessesUsingAppImage(appImage) {
  for (const processId of processesUsingAppImage(appImage) ?? []) {
    try { process.kill(processId, "SIGTERM"); } catch { /* The process exited during cleanup. */ }
  }
}

function linkPackageDirectory(source, destination, feedUrl) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(from);
      const resolvedTarget = path.resolve(path.dirname(from), target);
      if (path.isAbsolute(target) || (resolvedTarget !== packagedApp && !resolvedTarget.startsWith(packagedApp + path.sep))) {
        throw new Error(`Refusing a symlink that escapes the packaged AppImage fixture: ${from} -> ${target}`);
      }
      fs.symlinkSync(target, to);
    } else if (entry.isDirectory()) {
      linkPackageDirectory(from, to, feedUrl);
    } else if (entry.isFile() && path.relative(packagedApp, from).split(path.sep).join("/") === "resources/app/package.json") {
      const metadata = JSON.parse(fs.readFileSync(from, "utf8"));
      metadata.version = previousVersion;
      fs.writeFileSync(to, JSON.stringify(metadata, null, 2) + "\n");
    } else if (entry.isFile() && path.relative(packagedApp, from).split(path.sep).join("/") === "resources/app-update.yml") {
      fs.writeFileSync(to, `provider: generic\nurl: ${feedUrl}\n\n`);
    } else if (entry.isFile()) {
      try { fs.linkSync(from, to); }
      catch (error) {
        if (error.code !== "EXDEV" && error.code !== "EPERM" && error.code !== "EACCES") throw error;
        fs.copyFileSync(from, to);
      }
    } else {
      throw new Error(`Unsupported file in the packaged updater fixture: ${from}`);
    }
  }
}

async function main() {
  stage = "prepare isolated profile and loopback feed";
  fs.mkdirSync(feed, { recursive: true });
  fs.mkdirSync(installed, { recursive: true });
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, JSON.stringify({ purpose: "isolated AppImage update data-retention smoke", version: previousVersion }));

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
  const feedUrl = `http://127.0.0.1:${server.address().port}/`;
  devtoolsPort = await getUnusedPort();

  stage = "validate and stage 0.1.4 feed artifact";
  const metadataPath = path.join(path.dirname(currentAppImage), "latest-linux.yml");
  if (!fs.existsSync(metadataPath)) throw new Error(`Current Linux update metadata is missing: ${metadataPath}`);
  const metadata = yaml.load(fs.readFileSync(metadataPath, "utf8"));
  if (metadata.version !== currentVersion) throw new Error(`Expected the feed target to be ${currentVersion}, found ${metadata.version}.`);
  const currentName = path.basename(currentAppImage);
  const metadataEntry = metadata.files?.find(item => item.url === currentName);
  if (!metadataEntry) throw new Error(`latest-linux.yml does not describe ${currentName}.`);
  if (fs.statSync(currentAppImage).size !== metadataEntry.size) throw new Error("Current AppImage size differs from latest-linux.yml.");
  const baselinePackage = path.join(scratch, "baseline-package");
  linkPackageDirectory(packagedApp, baselinePackage, feedUrl);
  const baselineImageDirectory = path.join(scratch, "baseline-image");
  const buildBaseline = spawnSync(process.execPath, [path.join(__dirname, "package-linux-appimage.cjs"), baselinePackage, baselineImageDirectory, feedUrl], {
    cwd: path.join(__dirname, ".."), stdio: "inherit", shell: false,
  });
  if (buildBaseline.error) throw buildBaseline.error;
  if (buildBaseline.status !== 0) throw new Error(`The disposable ${previousVersion} AppImage build failed (exit ${buildBaseline.status}).`);
  const baselineAppImage = path.join(baselineImageDirectory, `Skai-Desktop-${previousVersion}-x64.AppImage`);
  if (!fs.existsSync(baselineAppImage)) throw new Error(`The ${previousVersion} AppImage baseline is missing: ${baselineAppImage}`);
  installedAppImage = path.join(installed, path.basename(baselineAppImage));
  fs.copyFileSync(baselineAppImage, installedAppImage);
  fs.chmodSync(installedAppImage, 0o755);
  const baselineExecutable = extractAppImage(installedAppImage, path.join(scratch, "baseline-extracted"), "Extract the synthetic baseline AppImage");
  try { fs.linkSync(currentAppImage, path.join(feed, currentName)); }
  catch (error) {
    if (error.code !== "EXDEV" && error.code !== "EPERM" && error.code !== "EACCES") throw error;
    fs.copyFileSync(currentAppImage, path.join(feed, currentName));
  }
  fs.writeFileSync(path.join(feed, "latest-linux.yml"), fs.readFileSync(metadataPath));
  const feedCopy = path.join(feed, currentName);
  if (fs.statSync(feedCopy).size !== metadataEntry.size) throw new Error("Staged update size differs from latest-linux.yml.");
  const latestHash = require("node:crypto").createHash("sha512").update(fs.readFileSync(feedCopy)).digest("base64");
  if (latestHash !== metadataEntry.sha512) throw new Error("Staged update SHA-512 differs from latest-linux.yml.");

  stage = `launch synthetic ${previousVersion} AppImage`;
  const env = {
    ...process.env,
    APPIMAGE: installedAppImage,
    APPIMAGE_EXTRACT_AND_RUN: "1",
    SKAI_SKIP_LEGACY_DATA_MIGRATION: "true",
    XDG_CONFIG_HOME: configHome,
    XDG_DATA_HOME: path.join(scratch, "profile", "data"),
  };
  appProcess = spawn(baselineExecutable, [...(process.getuid?.() === 0 ? ["--no-sandbox"] : []), "--ozone-platform=x11", `--remote-debugging-port=${devtoolsPort}`, `--user-data-dir=${userDataDir}`], {
    cwd: installed,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  appProcess.stdout.on("data", chunk => { processOutput += chunk.toString(); });
  appProcess.stderr.on("data", chunk => { processOutput += chunk.toString(); });
  appProcess.on("error", error => { processOutput += `\n[app-spawn-error ${error.message}]`; });
  appProcess.on("exit", (code, signal) => { processOutput += `\n[app-exit code=${code} signal=${signal}]`; });
  await waitForTarget();

  stage = "wait for verified 0.1.4 AppImage download";
  const deadline = Date.now() + 10 * 60_000;
  let state;
  while (Date.now() < deadline) {
    state = await readUpdateState();
    if (state?.status === "downloaded") break;
    if (state?.status === "error") throw new Error(`The real Linux updater failed: ${state.error || state.message}. ${processOutput.slice(-2_000)}`);
    await sleep(1_000);
  }
  if (state?.status !== "downloaded") throw new Error(`The updater did not stage ${currentVersion}; last state: ${JSON.stringify(state)}. ${processOutput.slice(-2_000)}`);
  if (serverRequests < 2) throw new Error(`The app did not contact the isolated update feed; requests=${serverRequests}.`);
  if (!state.message?.includes("verified")) throw new Error(`The update was not reported as verified: ${JSON.stringify(state)}`);

  stage = "invoke explicit in-app AppImage install";
  const installCall = await evaluate("window.skaiAgent.updates.install().then(value => String(value))");
  if (installCall !== "true") throw new Error(`The Settings update action did not authorize installation: ${installCall}`);
  await waitForDevtoolsClosed();
  const exitDeadline = Date.now() + 30_000;
  while (Date.now() < exitDeadline && appProcess.exitCode === null && appProcess.signalCode === null) await sleep(250);
  if (appProcess.exitCode === null && appProcess.signalCode === null) throw new Error(`The old AppImage process did not exit after installation. ${processOutput.slice(-2_000)}`);
  appProcess = undefined;

  stage = "verify installed AppImage and preserved data";
  const upgradedAppImage = path.join(installed, `Skai-Desktop-${currentVersion}-x64.AppImage`);
  const upgradeDeadline = Date.now() + 120_000;
  while (Date.now() < upgradeDeadline && !fs.existsSync(upgradedAppImage)) await sleep(500);
  if (!fs.existsSync(upgradedAppImage)) throw new Error(`The ${currentVersion} AppImage was not installed. Files: ${fs.readdirSync(installed).join(", ")}. ${processOutput.slice(-2_000)}`);
  if (fs.existsSync(installedAppImage)) throw new Error("The old versioned AppImage was expected to be replaced by the new versioned AppImage.");
  if (!fs.existsSync(marker) || JSON.parse(fs.readFileSync(marker, "utf8")).version !== previousVersion) throw new Error("The AppImage upgrade changed or removed the profile marker.");

  stage = `reopen ${currentVersion} AppImage`;
  const upgradedExecutable = extractAppImage(upgradedAppImage, path.join(scratch, "updated-extracted"), `Extract the installed ${currentVersion} AppImage`);
  const updatedProcess = spawn(upgradedExecutable, [...(process.getuid?.() === 0 ? ["--no-sandbox"] : []), "--ozone-platform=x11", `--remote-debugging-port=${devtoolsPort}`, `--user-data-dir=${userDataDir}`], {
    cwd: installed,
    env: { ...env, APPIMAGE: upgradedAppImage },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  appProcess = updatedProcess;
  updatedProcess.stdout.on("data", chunk => { processOutput += chunk.toString(); });
  updatedProcess.stderr.on("data", chunk => { processOutput += chunk.toString(); });
  updatedProcess.on("error", error => { processOutput += `\n[app-spawn-error ${error.message}]`; });
  await waitForTarget();
  const reopenedState = await readUpdateState();
  const updatedVersion = reopenedState?.currentVersion;
  if (updatedVersion !== currentVersion) throw new Error(`The installed AppImage opened as version ${updatedVersion}, expected ${currentVersion}.`);
  if (!fs.existsSync(marker)) throw new Error("The update marker was lost when reopening the new AppImage.");
  const rollbackImage = path.join(installed, `.skai-desktop-rollback-${previousVersion}.AppImage`);
  if (!fs.existsSync(rollbackImage)) throw new Error("The update did not preserve the previous AppImage for rollback.");
  if (!reopenedState.rollbackAvailable || reopenedState.rollbackVersion !== previousVersion) throw new Error(`The updated app did not advertise the matching rollback image: ${JSON.stringify(reopenedState)}.`);

  stage = `restore and reopen ${previousVersion} AppImage`;
  await evaluate("window.skaiAgent.updates.setEnabled(false).then(value => String(value))");
  const rollbackCall = await evaluate("window.skaiAgent.updates.rollback().then(value => String(value))");
  if (rollbackCall !== "true") throw new Error(`The in-app rollback action was rejected: ${rollbackCall}`);
  await waitForDevtoolsClosed();
  appProcess = undefined;
  const restoredExecutable = extractAppImage(installedAppImage, path.join(scratch, "rollback-extracted"), `Extract the restored ${previousVersion} AppImage`);
  const restoredMetadata = JSON.parse(fs.readFileSync(path.join(path.dirname(restoredExecutable), "resources", "app", "package.json"), "utf8"));
  if (restoredMetadata.version !== previousVersion) throw new Error(`The restored AppImage contains version ${restoredMetadata.version}, expected ${previousVersion}.`);
  const restoredLaunchDeadline = Date.now() + 30_000;
  let restoredProcesses = [];
  while (Date.now() < restoredLaunchDeadline) {
    restoredProcesses = processesUsingAppImage(installedAppImage) ?? [];
    if (restoredProcesses.length) break;
    await sleep(250);
  }
  if (!restoredProcesses.length) throw new Error(`The rollback restored ${previousVersion} but did not relaunch its AppImage. ${processOutput.slice(-2_000)}`);
  if (!fs.existsSync(marker)) throw new Error("The rollback changed or removed the user profile marker.");

  console.log(JSON.stringify({
    result: "passed",
    baseline: `${previousVersion} synthetic AppImage using current updater code`,
    updated: updatedVersion,
    feedRequests: serverRequests,
    stagedUpdateStatus: state.status,
    userDataMarkerRetained: true,
    updatedAppImageReopened: true,
    rollback: { previousVersion, restoredToOriginalPath: true, restoredPackageVersion: restoredMetadata.version, relaunchProcessIds: restoredProcesses, previousAppImageReopened: true },
  }, null, 2));
}

main().catch(error => { console.error(`Linux updater smoke failed during '${stage}':`, error); if (processOutput) console.error(processOutput.slice(-3_000)); process.exitCode = 1; }).finally(async () => {
  if (appProcess) {
    try { process.kill(-appProcess.pid, "SIGTERM"); } catch { /* The AppImage process group may already be gone. */ }
    if (appProcess.exitCode === null && appProcess.signalCode === null) appProcess.kill("SIGTERM");
  }
  stopProcessesUsingAppImage(installedAppImage);
  if (server) await new Promise(resolve => server.close(resolve));
  const resolved = path.resolve(scratch);
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error(`Refusing to remove a path outside the temporary directory: ${resolved}`);
  try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 12, retryDelay: 500 }); }
  catch (error) { console.warn(`Disposable Linux update test files remain at ${resolved}: ${error.message}`); }
});
