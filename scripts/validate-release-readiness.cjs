const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "release.yml"), "utf8");
const required = [
  ["Windows signing gate", "RELEASE_SIGNING_READY"],
  ["Windows installer lifecycle", "Install, upgrade, and uninstall the exact signed installers"],
  ["Linux AppImage packaging", "package:linux:appimage"],
  ["Linux exact-artifact smoke", "Smoke-test exact packaged Electron artifact on Linux"],
  ["Updater metadata verification", "validate-update-metadata.cjs"],
];
for (const [label, marker] of required) if (!workflow.includes(marker)) throw new Error(`Release workflow is missing the ${label} gate.`);
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (packageJson.version !== "0.1.4") throw new Error(`Release version must remain 0.1.4; found ${packageJson.version}.`);
console.log("Release workflow contains signing, Windows lifecycle, Linux AppImage, exact-artifact, and updater-metadata gates.");
console.log("Cryptographic signing and clean-machine upgrade/rollback evidence still require the configured CI secrets and Windows/Ubuntu runners.");
