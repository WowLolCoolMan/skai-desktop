const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

if (process.platform !== "win32") throw new Error("The Windows installer lifecycle smoke must run on Windows.");
const [previousArg, currentArg, previousSmokeArg] = process.argv.slice(2);
if (!previousArg || !currentArg) throw new Error("Usage: node scripts/smoke-windows-installer.cjs <previous-installer.exe> <current-installer.exe>");
const previousInstaller = path.resolve(previousArg);
const currentInstaller = path.resolve(currentArg);
for (const installer of [previousInstaller, currentInstaller]) if (!fs.existsSync(installer)) throw new Error(`Installer not found: ${installer}`);

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "skai-windows-installer-lifecycle-"));
const installDir = path.join(scratch, "installed-app");
const roaming = path.join(scratch, "profile", "Roaming");
const local = path.join(scratch, "profile", "Local");
const marker = path.join(roaming, "skai-desktop", "release-lifecycle-marker.json");
const smokeScript = path.join(__dirname, "smoke-electron-artifact.cjs");
const previousSmokeScript = previousSmokeArg ? path.resolve(previousSmokeArg) : smokeScript;
const env = { ...process.env, APPDATA: roaming, LOCALAPPDATA: local, SKAI_SKIP_LEGACY_DATA_MIGRATION: "true" };
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const sleep = (milliseconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);

function run(file, args, label, extraEnv = env) {
  const result = spawnSync(file, args, { env: extraEnv, cwd: path.dirname(file), encoding: "utf8", windowsHide: true, timeout: 180_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed (exit ${result.status}).\n${result.stdout}\n${result.stderr}`);
  return `${result.stdout || ""}${result.stderr || ""}`;
}

function install(installer, label) {
  const output = run(installer, ["/S", `/D=${installDir}`], label);
  if (!fs.existsSync(path.join(installDir, "Skai Desktop.exe"))) throw new Error(`${label} did not install Skai Desktop.exe.`);
  return output;
}

function signature(file) {
  const command = [
    "$module=Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1'",
    "Import-Module $module -ErrorAction Stop",
    "$s=Get-AuthenticodeSignature -LiteralPath $env:SKAI_SIGNATURE_TARGET",
    "[pscustomobject]@{status=[string]($s.Status);subject=$s.SignerCertificate.Subject;issuer=$s.SignerCertificate.Issuer}|ConvertTo-Json -Compress",
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    env: { ...process.env, SKAI_SIGNATURE_TARGET: file }, encoding: "utf8", windowsHide: true, timeout: 20_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 || result.stderr.trim()) throw new Error(`Unable to verify Authenticode signature for ${file}: ${result.stderr || `PowerShell exited with ${result.status}`}`);
  const parsed = JSON.parse(result.stdout.trim());
  if (!parsed.status) throw new Error(`PowerShell returned no Authenticode status for ${file}.`);
  const evidence = { name: path.basename(file), status: parsed.status, subject: parsed.subject || null, issuer: parsed.issuer || null, sha256: sha256(file) };
  if (process.env.SKAI_REQUIRE_SIGNED_INSTALLER === "true" && evidence.status !== "Valid") throw new Error(`Expected a valid Authenticode signature for ${file}; found ${evidence.status}.`);
  return evidence;
}

function uninstallerPath() {
  const name = fs.readdirSync(installDir).find((entry) => /^uninstall.*\.exe$/i.test(entry));
  if (!name) throw new Error("Installed application did not include its NSIS uninstaller.");
  return path.join(installDir, name);
}

function assertInstalledVersion(expected) {
  const packagePath = path.join(installDir, "resources", "app", "package.json");
  const actual = JSON.parse(fs.readFileSync(packagePath, "utf8")).version;
  if (actual !== expected) throw new Error(`Expected installed version ${expected}, found ${actual}.`);
  return actual;
}

function verifyPackagedApp(label, script = smokeScript) {
  return run(process.execPath, [script, path.join(installDir, "Skai Desktop.exe")], `${label} packaged app smoke`);
}

try {
  fs.mkdirSync(roaming, { recursive: true });
  fs.mkdirSync(local, { recursive: true });
  const previousInstallerSignature = signature(previousInstaller);
  const currentInstallerSignature = signature(currentInstaller);
  const previousInstallLog = install(previousInstaller, "Clean install of previous version");
  const previousVersion = assertInstalledVersion("0.1.3");
  const previousUninstallerSignature = signature(uninstallerPath());
  const previousSmoke = verifyPackagedApp(`Installed ${previousVersion}`, previousSmokeScript);

  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, JSON.stringify({ createdBy: "Skai Desktop installer lifecycle smoke", previousVersion, createdAt: new Date().toISOString() }, null, 2));
  const currentInstallLog = install(currentInstaller, "Upgrade to current version");
  const currentVersion = assertInstalledVersion("0.1.4");
  const currentUninstallerSignature = signature(uninstallerPath());
  if (!fs.existsSync(marker)) throw new Error("Upgrade removed existing user data.");
  const currentSmoke = verifyPackagedApp(`Upgraded ${currentVersion}`);

  run(uninstallerPath(), ["/S"], "Uninstall Skai Desktop");
  for (let attempt = 0; attempt < 60 && fs.existsSync(installDir); attempt += 1) sleep(250);
  if (fs.existsSync(installDir)) {
    const remaining = fs.readdirSync(installDir);
    throw new Error(`Uninstall left application files behind after waiting: ${remaining.slice(0, 8).join(", ")}`);
  }
  if (!fs.existsSync(marker)) throw new Error("Uninstall removed user data; expected it to remain intact.");

  const evidence = {
    result: "passed",
    platform: `${os.type()} ${os.release()} ${os.arch()}`,
    previousVersion,
    currentVersion,
    previousInstaller: { name: path.basename(previousInstaller), sha256: sha256(previousInstaller) },
    currentInstaller: { name: path.basename(currentInstaller), sha256: sha256(currentInstaller) },
    checks: ["clean install", "packaged runtime smoke", "0.1.3 to 0.1.4 upgrade", "user data retained through upgrade", "silent uninstall", "application files removed", "user data retained through uninstall"],
    signatures: { previousInstaller: previousInstallerSignature, currentInstaller: currentInstallerSignature, previousUninstaller: previousUninstallerSignature, currentUninstaller: currentUninstallerSignature },
    userDataMarkerRetained: true,
    timestamp: new Date().toISOString(),
  };
  const evidencePath = process.env.SKAI_RELEASE_EVIDENCE_PATH
    ? path.resolve(process.env.SKAI_RELEASE_EVIDENCE_PATH)
    : path.join(scratch, "windows-install-lifecycle-evidence.json");
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify({ ...evidence, evidencePath, installLogBytes: previousInstallLog.length + currentInstallLog.length, appSmokePassed: previousSmoke.includes("Packaged Electron smoke passed") && currentSmoke.includes("Packaged Electron smoke passed") }, null, 2));
  if (!previousSmoke.includes("Packaged Electron smoke passed") || !currentSmoke.includes("Packaged Electron smoke passed")) throw new Error("Installed artifact did not pass its packaged smoke checks.");
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `evidence_path=${evidencePath}\n`);
} finally {
  try {
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  } catch (error) {
    console.warn(`Windows kept a temporary profile file open; lifecycle data remains isolated at ${scratch}: ${error.message}`);
  }
}
