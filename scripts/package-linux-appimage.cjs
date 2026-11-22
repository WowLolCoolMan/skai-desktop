const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const desktopRoot = path.join(root, "apps", "desktop");
const prepackaged = path.resolve(process.argv[2] || path.join(root, "dist", "electron", "linux-x64"));
const output = path.resolve(process.argv[3] || path.join(root, "dist", "installer", "linux-x64"));
const updateFeedUrl = process.argv[4];
const cli = path.join(desktopRoot, "node_modules", "electron-builder", "cli.js");
const config = path.join(root, "packaging", "linux", "electron-builder.yml");

if (process.platform !== "linux") throw new Error("The Linux AppImage must be built on Linux.");
if (!fs.existsSync(cli)) throw new Error("electron-builder is missing. Run npm ci --prefix apps/desktop.");
if (!fs.existsSync(path.join(prepackaged, "Skai Desktop")) || !fs.existsSync(path.join(prepackaged, "resources", "app", "package.json"))) {
  throw new Error(`The prepackaged Electron app is incomplete: ${prepackaged}`);
}
// electron-builder's Linux AppRun/desktop entry launches the appId-derived
// `skai-desktop` command, while our portable Electron staging names the binary
// after the product. Keep both entry points in the AppImage payload.
const appImageExecutable = path.join(prepackaged, "Skai Desktop");
const appImageLauncher = path.join(prepackaged, "skai-desktop");
if (!fs.existsSync(appImageLauncher)) fs.symlinkSync(path.basename(appImageExecutable), appImageLauncher);
else if (fs.realpathSync(appImageLauncher) !== fs.realpathSync(appImageExecutable)) {
  throw new Error(`The Linux launcher alias does not resolve to the packaged executable: ${appImageLauncher}`);
}
fs.mkdirSync(output, { recursive: true });
const version = JSON.parse(fs.readFileSync(path.join(prepackaged, "resources", "app", "package.json"), "utf8")).version;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`Invalid packaged app version: ${version}`);
let builderConfig = config;
if (updateFeedUrl) {
  const parsedFeed = new URL(updateFeedUrl);
  if (parsedFeed.protocol !== "http:" && parsedFeed.protocol !== "https:") throw new Error("The update feed URL must use HTTP or HTTPS.");
  const yaml = require(require.resolve("js-yaml", { paths: [desktopRoot] }));
  const configObject = yaml.load(fs.readFileSync(config, "utf8"));
  configObject.publish = [{ provider: "generic", url: updateFeedUrl }];
  builderConfig = path.join(path.dirname(config), `.electron-builder-local-feed-${process.pid}.yml`);
  fs.writeFileSync(builderConfig, yaml.dump(configObject));
}
const builderArgs = [cli, "--linux", "AppImage", "--x64", "--publish", "never", "--prepackaged", prepackaged, "--config", builderConfig, `--config.directories.output=${output}`, `--config.extraMetadata.version=${version}`];
let result;
try {
  result = spawnSync(process.execPath, builderArgs, { cwd: desktopRoot, stdio: "inherit", env: process.env, shell: false });
} finally {
  if (builderConfig !== config && fs.existsSync(builderConfig)) fs.unlinkSync(builderConfig);
}
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
