const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const workflowPath = path.join(root, ".github", "workflows", "release.yml");
const errors = [];

let workflow = "";
try {
  workflow = fs.readFileSync(workflowPath, "utf8");
} catch (error) {
  errors.push(`Unable to read .github/workflows/release.yml: ${error.message}`);
}

const requireContract = (label, pattern) => {
  if (workflow && !pattern.test(workflow)) errors.push(`Missing release contract: ${label}`);
};

requireContract("tag-triggered release workflow", /tags:\s*\[['\"]v\*['\"]\]/);
requireContract("diagnostic manual dispatch trigger", /workflow_dispatch:/);
requireContract("tag-only release job", /if:\s*startsWith\(github\.ref,\s*['\"]refs\/tags\/['\"]\)/);
requireContract("release signing gate", /RELEASE_SIGNING_READY/);
requireContract("packaged smoke gate", /PACKAGED_SMOKE_READY/);
requireContract("literal true gate enforcement", /\$\{!gate\}[\s\S]*!=[\s\S]*true/);
requireContract("Windows signing material", /WINDOWS_CODESIGN_CERT_BASE64/);
requireContract("Windows timestamp signing", /signtool\.exe[\s\S]*\/tr\s+\$env:WINDOWS_CODESIGN_TIMESTAMP_URL/);
requireContract("Windows manifest hash refresh after signing", /artifact-manifest\.json[\s\S]*manifest\.files\.executable[\s\S]*Get-FileHash/);
requireContract("Linux signing material", /RELEASE_GPG_PRIVATE_KEY/);
requireContract("Linux detached signature", /--detach-sign/);
requireContract("Electron release packaging job", /\n  electron:\s*\n\s+name:\s+Package Electron/);
requireContract("Electron Windows and Linux matrix", /rid:\s+win-x64[\s\S]*rid:\s+linux-x64/);
requireContract("Electron packaged smoke gate", /smoke:electron:artifact/);
requireContract("Electron Windows signature evidence", /SIGNATURES-electron-win-x64\.txt/);
requireContract("Electron Linux signature evidence", /SIGNATURES-electron-linux-x64\.txt/);
requireContract("Electron release readiness gate", /ELECTRON_PACKAGED_READY/);
requireContract("Release waits for Electron packaging", /needs:\s*\[electron\]/);
requireContract("no legacy Uno packaging", { test: (text) => !/SkaiDesktop\.Native|NATIVE_MIGRATION_COMPLETE|\n  package:/.test(text) });
requireContract("verify job runs Core tests", /run:\s+npm test/);
requireContract("Release downloads Electron artifacts", /pattern:\s+Skai-Desktop-\*/);
requireContract("release signature evidence gate", /Require signed artifact evidence/);
requireContract("non-empty signature evidence check", /if \[ ! -s "\$signature" \]/);
requireContract("every-artifact signature evidence check", /required_signatures=\([\s\S]*SIGNATURES-electron-linux-x64\.txt[\s\S]*if \[ ! -s "\$signature" \]/);
requireContract("release contents write permission", /contents:\s*write/);
requireContract("checksum generation", /sha256sum/);

if (errors.length > 0) {
  console.error("Release workflow audit failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Release workflow audit passed (Electron-only, tag-only, gated, signed-evidence contract).");
