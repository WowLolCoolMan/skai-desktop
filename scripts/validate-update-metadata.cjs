const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const [metadataPath, artifactDirectory] = process.argv.slice(2);
if (!metadataPath || !artifactDirectory) throw new Error("Usage: node validate-update-metadata.cjs <latest.yml> <artifact-directory>");
const metadata = yaml.load(fs.readFileSync(metadataPath, "utf8"));
if (!metadata || typeof metadata.version !== "string" || !Array.isArray(metadata.files) || metadata.files.length === 0) throw new Error(`Update metadata has no version or files: ${metadataPath}`);
for (const entry of metadata.files) {
  if (!entry || typeof entry.url !== "string" || path.basename(entry.url) !== entry.url || !/^[A-Za-z0-9._-]+$/.test(entry.url)) throw new Error(`Update metadata contains an unsafe artifact URL: ${JSON.stringify(entry?.url)}`);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(String(entry.sha512 ?? "")) || !Number.isSafeInteger(entry.size) || entry.size <= 0) throw new Error(`Update metadata contains an invalid digest or size for ${entry.url}.`);
  const artifactPath = path.join(artifactDirectory, entry.url);
  const stat = fs.statSync(artifactPath);
  if (!stat.isFile() || stat.size !== entry.size) throw new Error(`Update artifact size differs from metadata: ${artifactPath}`);
  const digest = crypto.createHash("sha512").update(fs.readFileSync(artifactPath)).digest("base64");
  if (digest !== entry.sha512) throw new Error(`Update artifact SHA-512 differs from metadata: ${artifactPath}`);
}
console.log(`Update metadata verified: ${metadata.version}, ${metadata.files.length} artifact(s).`);
