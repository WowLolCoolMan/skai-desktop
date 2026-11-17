const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const desktopRoot = path.join(root, "apps", "desktop");
const prepackaged = path.resolve(process.argv[2] || path.join(root, "dist", "electron", "win-x64"));
const output = path.resolve(process.argv[3] || path.join(root, "dist", "installer", "win-x64"));
const cli = path.join(desktopRoot, "node_modules", "electron-builder", "cli.js");
const config = path.join(root, "packaging", "windows", "electron-builder.yml");

if (process.platform !== "win32") throw new Error("The Windows installer must be built on Windows.");
if (!fs.existsSync(cli)) throw new Error("electron-builder is missing. Run npm ci --prefix apps/desktop.");
if (!fs.existsSync(path.join(prepackaged, "Skai Desktop.exe")) || !fs.existsSync(path.join(prepackaged, "resources", "app", "package.json"))) {
  throw new Error(`The prepackaged Electron app is incomplete: ${prepackaged}`);
}

fs.mkdirSync(output, { recursive: true });
const version = JSON.parse(fs.readFileSync(path.join(prepackaged, "resources", "app", "package.json"), "utf8")).version;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`Invalid packaged app version: ${version}`);
const args = [cli, "--win", "nsis", "--x64", "--prepackaged", prepackaged, "--config", config, `--config.directories.output=${output}`, `--config.extraMetadata.version=${version}`];
if (process.env.SKAI_ALLOW_UNSIGNED_INSTALLER === "true") {
  args.push("--config.win.forceCodeSigning=false", "--config.win.signExecutable=false");
  console.warn("Building an unsigned installer for local lifecycle validation only.");
}
const result = spawnSync(process.execPath, args, { cwd: desktopRoot, stdio: "inherit", env: process.env, shell: false });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`electron-builder exited with status ${result.status}.`);

const installer = path.join(output, `Skai-Desktop-${version}-Setup-x64.exe`);
if (!fs.existsSync(installer)) throw new Error(`electron-builder did not produce the expected installer: ${installer}`);
const metadata = path.join(output, "latest.yml");
if (!fs.existsSync(metadata)) throw new Error("electron-builder did not produce latest.yml; the NSIS update feed cannot work without it.");
const metadataCheck = spawnSync(process.execPath, [path.join(root, "scripts", "validate-update-metadata.cjs"), metadata, output], { cwd: root, stdio: "inherit", shell: false });
if (metadataCheck.error) throw metadataCheck.error;
if (metadataCheck.status !== 0) throw new Error("Windows update metadata verification failed.");
console.log(`Windows installer ready: ${installer}`);
