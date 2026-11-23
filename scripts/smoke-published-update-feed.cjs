#!/usr/bin/env node

// Read-only check of published electron-updater metadata and referenced assets.
// It does not download installers or modify an installed app.
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const args = process.argv.slice(2);
const argValue = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const version = argValue("--version") || process.env.SKAI_PUBLISHED_RELEASE_VERSION || packageJson.version;
const repository = argValue("--repo") || "WowLolCoolMan/skai-desktop";

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error("Use a valid release version, for example --version 0.1.4.");
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("Repository must use owner/name format.");

async function fetchChecked(url, options, label) {
  const response = await fetch(url, { ...options, redirect: "follow", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}.`);
  const finalUrl = new URL(response.url);
  if (finalUrl.protocol !== "https:" || !["github.com", "release-assets.githubusercontent.com"].includes(finalUrl.hostname)) {
    throw new Error(`${label} redirected to an unexpected host.`);
  }
  return response;
}

async function checkFeed(feedName) {
  const base = `https://github.com/${repository}/releases/download/v${version}/`;
  const feedResponse = await fetchChecked(`${base}${feedName}`, {}, feedName);
  const body = await feedResponse.text();
  const feedVersion = body.match(/^version:[ \t]*(\S+)\s*$/m)?.[1];
  const assetName = body.match(/^path:[ \t]*(\S+)\s*$/m)?.[1];
  const sha512 = body.match(/^sha512:[ \t]*([A-Za-z0-9+/]+={0,2})\s*$/m)?.[1];
  const sizeText = body.match(/^[ \t]*size:[ \t]*(\d+)\s*$/m)?.[1];
  const size = Number(sizeText);
  const digest = sha512 ? Buffer.from(sha512, "base64") : null;
  if (feedVersion !== version) throw new Error(`${feedName} advertises ${feedVersion || "no version"}, expected ${version}.`);
  if (!assetName || path.basename(assetName) !== assetName || assetName.includes("..")) throw new Error(`${feedName} contains an unsafe or missing asset path.`);
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error(`${feedName} contains an invalid asset size.`);
  if (!digest || digest.length !== 64 || digest.toString("base64") !== sha512) throw new Error(`${feedName} contains invalid SHA-512 metadata.`);

  const assetResponse = await fetchChecked(`${base}${encodeURIComponent(assetName)}`, { method: "HEAD" }, assetName);
  const remoteSize = Number(assetResponse.headers.get("content-length"));
  if (!Number.isSafeInteger(remoteSize) || remoteSize !== size) throw new Error(`${assetName} size mismatch: feed ${size}, published asset ${assetResponse.headers.get("content-length") || "unknown"}.`);
  console.log(`PASS ${feedName}: v${version}, ${assetName}, ${size} bytes, SHA-512 valid, asset HTTP ${assetResponse.status}.`);
}

(async () => {
  await checkFeed("latest.yml");
  await checkFeed("latest-linux.yml");
})().catch((error) => {
  console.error(`Published update feed smoke failed: ${error.message}`);
  process.exitCode = 1;
});
