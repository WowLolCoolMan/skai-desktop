const fs = require("node:fs");
const path = require("node:path");

const requiredWhenSigning = [
  'WINDOWS_CODESIGN_CERT_BASE64',
  'WINDOWS_CODESIGN_CERT_PASSWORD',
  'WINDOWS_CODESIGN_TIMESTAMP_URL',
  'RELEASE_GPG_PRIVATE_KEY',
];

const root = path.resolve(__dirname, "..");
const errors = [];
const semver = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

// Release metadata now comes from the Electron package.
for (const relative of ["package.json", path.join("apps", "desktop", "package.json")]) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
    if (typeof pkg.name !== "string" || !pkg.name.trim()) errors.push(`${relative} must declare a package name`);
    if (typeof pkg.version !== "string" || !semver.test(pkg.version)) errors.push(`${relative} must declare a semantic version (found ${JSON.stringify(pkg.version)})`);
  } catch (error) {
    errors.push(`Unable to read ${relative}: ${error.message}`);
  }
}

if (process.env.RELEASE_SIGNING_READY === 'true') {
  const missing = requiredWhenSigning.filter((name) => !String(process.env[name] || '').trim());
  if (missing.length) {
    console.error(`Release signing is enabled but required material is missing: ${missing.join(', ')}`);
    process.exit(1);
  }
}

const version = String(process.env.RELEASE_VERSION || '').replace(/^v/, '');
if (version && !semver.test(version)) {
  console.error(`Invalid release version: ${version}`);
  process.exit(1);
}

if (errors.length > 0) {
  console.error("Release configuration validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Release configuration is internally consistent, including package metadata.");
