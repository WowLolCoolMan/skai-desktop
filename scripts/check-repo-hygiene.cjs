const { execFileSync } = require("node:child_process");
const fs = require("node:fs");

// New tracked files must stay under 1 MiB. These existing files are allowed until they are
// compressed or removed (see DEBLOAT_PROGRESS.md); take an entry out once its file shrinks.
const MAX_FILE_BYTES = 1024 * 1024;
const LARGE_FILE_ALLOWLIST = new Set([
  "assets/branding/skai-desktop-architecture.png",
  "assets/branding/skai-desktop-hero.png",
  "assets/branding/skai-desktop-mark.png",
  "assets/branding/skaiwolficon.png",
]);

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const forbidden = tracked.filter((file) => {
  const normalized = file.replaceAll("\\", "/");
  if (/(^|\/)\.env(?:\..*)?$/.test(normalized) && !normalized.endsWith("/.env.example") && normalized !== ".env.example") return true;
  if (/(^|\/)(?:credentials\.json|.*\.(?:pem|key|pfx|p12))$/i.test(normalized)) return true;
  if (/(^|\/)(?:bin|obj|artifacts|dist|release|node_modules|\.tmp|playwright-report|test-results)(?:\/|$)/i.test(normalized)) return true;
  return false;
});

const oversized = tracked
  .filter((file) => !LARGE_FILE_ALLOWLIST.has(file.replaceAll("\\", "/")))
  .map((file) => ({ file, bytes: fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0 }))
  .filter(({ bytes }) => bytes > MAX_FILE_BYTES);

if (forbidden.length) {
  console.error("Repository hygiene check failed. Remove generated or secret-shaped tracked files:");
  for (const file of forbidden) console.error(`- ${file}`);
  process.exitCode = 1;
}
if (oversized.length) {
  console.error(`Repository hygiene check failed. Tracked files over ${MAX_FILE_BYTES} bytes (compress them, or add to LARGE_FILE_ALLOWLIST with a reason):`);
  for (const { file, bytes } of oversized) console.error(`- ${file} (${bytes} bytes)`);
  process.exitCode = 1;
}
if (!forbidden.length && !oversized.length) {
  console.log(`Repository hygiene check passed (${tracked.length} tracked files).`);
}
