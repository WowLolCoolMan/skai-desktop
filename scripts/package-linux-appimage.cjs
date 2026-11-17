const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const desktopRoot = path.join(root, "apps", "desktop");
const prepackaged = path.resolve(process.argv[2] || path.join(root, "dist", "electron", "linux-x64"));
const output = path.resolve(process.argv[3] || path.join(root, "dist", "installer", "linux-x64"));
const cli = path.join(desktopRoot, "node_modules", "electron-builder", "cli.js");
const config = path.join(root, "packaging", "linux", "electron-builder.yml");

if (process.platform !== "linux") throw new Error("The Linux AppImage must be built on Linux.");
if (!fs.existsSync(cli)) throw new Error("electron-builder is missing. Run npm ci --prefix apps/desktop.");
if (!fs.existsSync(path.join(prepackaged, "Skai Desktop")) || !fs.existsSync(path.join(prepackaged, "resources", "app", "package.json"))) {
  throw new Error(`The prepackaged Electron app is incomplete: ${prepackaged}`);
}
fs.mkdirSync(output, { recursive: true });
const version = JSON.parse(fs.readFileSync(path.join(prepackaged, "resources", "app", "package.json"), "utf8")).version;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`Invalid packaged app version: ${version}`);
const result = spawnSync(process.execPath, [cli, "--linux", "AppImage", "--x64", "--prepackaged", prepackaged, "--config", config, `--config.directories.output=${output}`, `--config.extraMetadata.version=${version}`], { cwd: desktopRoot, stdio: "inherit", env: process.env, shell: false });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`electron-builder exited with status ${result.status}.`);
const image = path.join(output, `Skai-Desktop-${version}-x64.AppImage`);
if (!fs.existsSync(image)) throw new Error(`electron-builder did not produce the expected AppImage: ${image}`);
const metadata = path.join(output, "latest-linux.yml");
if (!fs.existsSync(metadata)) throw new Error("electron-builder did not produce latest-linux.yml; the AppImage updater metadata is required.");
const metadataCheck = spawnSync(process.execPath, [path.join(root, "scripts", "validate-update-metadata.cjs"), metadata, output], { cwd: root, stdio: "inherit", shell: false });
if (metadataCheck.error) throw metadataCheck.error;
if (metadataCheck.status !== 0) throw new Error("Linux update metadata verification failed.");
console.log(`Linux AppImage ready: ${image}`);
