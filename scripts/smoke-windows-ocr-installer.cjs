const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

if (process.platform !== "win32") throw new Error("The installed OCR smoke must run on Windows.");
const installer = path.resolve(process.argv[2] || path.join(__dirname, "..", "dist", "installer", "win-x64", "Skai-Desktop-0.1.4-Setup-x64.exe"));
if (!fs.existsSync(installer)) throw new Error(`Windows installer not found: ${installer}`);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "skai-windows-ocr-installer-"));
const installDir = path.join(scratch, "installed-app");
const appData = path.join(scratch, "AppData", "Roaming");
const localAppData = path.join(scratch, "AppData", "Local");
const smokeScript = path.join(__dirname, "smoke-electron-artifact.cjs");
const env = { ...process.env, APPDATA: appData, LOCALAPPDATA: localAppData, SKAI_SKIP_LEGACY_DATA_MIGRATION: "true" };

function run(file, args, label, timeout = 180_000) {
  const result = spawnSync(file, args, { env, cwd: path.dirname(file), encoding: "utf8", windowsHide: true, timeout });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed (exit ${result.status}).\n${result.stdout}\n${result.stderr}`);
  return `${result.stdout || ""}${result.stderr || ""}`;
}

try {
  fs.mkdirSync(appData, { recursive: true });
  fs.mkdirSync(localAppData, { recursive: true });
  run(installer, ["/S", `/D=${installDir}`], "Isolated Windows installer setup");
  const executable = path.join(installDir, "Skai Desktop.exe");
  const host = path.join(installDir, "resources", "agent-host", "SkaiDesktop.AgentHost.exe");
  const manifest = path.join(installDir, "artifact-manifest.json");
  if (!fs.existsSync(executable) || !fs.existsSync(host) || !fs.existsSync(manifest)) {
    const contents = fs.existsSync(installDir) ? fs.readdirSync(installDir, { recursive: true }).filter((entry) => /(?:app\.asar|agent-host|artifact-manifest|SkaiDesktop\.AgentHost)/i.test(entry)).join("\n") : "<install directory missing>";
    throw new Error(`The installer did not preserve the app, Agent Host, and artifact manifest under ${installDir}. Found:\n${contents}`);
  }
  const smoke = run(process.execPath, [smokeScript, executable], "Installed app OCR smoke");
  if (!smoke.includes('Packaged local scanned-PDF OCR: {"ok":true,"ocr":true,"recognizedFixtureText":true'))
    throw new Error(`Installed app smoke did not confirm local PDF OCR.\n${smoke}`);
  console.log("Installed app OCR smoke passed: a scanned PDF was OCRed locally with the bundled English model.");

  const uninstaller = fs.readdirSync(installDir).find((entry) => /^uninstall.*\.exe$/i.test(entry));
  if (!uninstaller) throw new Error("The isolated installer did not include its uninstaller.");
  run(path.join(installDir, uninstaller), ["/S"], "Isolated Windows app uninstall");
  console.log("Installed app OCR smoke and silent uninstaller launch passed; no real Skai user profile was used.");
} finally {
  const expectedPrefix = `${os.tmpdir()}${path.sep}`.toLowerCase();
  const resolvedScratch = path.resolve(scratch);
  if (!resolvedScratch.toLowerCase().startsWith(expectedPrefix)) throw new Error("Refusing to clean a path outside the temporary directory.");
  let lastError;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      fs.rmSync(resolvedScratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
  if (lastError) throw new Error(`The isolated installer passed, but Windows kept a lock on its temporary profile: ${lastError.message}`);
}
