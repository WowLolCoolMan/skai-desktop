// Every agent method the renderer calls must be allowed by the Electron bridge
// (apps/desktop/electron/main.cjs `allowedMethods`, plus the few methods main.cjs
// handles itself) and implemented by the Agent Host. A method missing from the
// allowlist fails at runtime with METHOD_NOT_ALLOWED; this audit catches it in CI.
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
});

const main = read("apps/desktop/electron/main.cjs");
const allowBlock = main.match(/const allowedMethods = new Set\(\[([\s\S]*?)\]\);/);
if (!allowBlock) {
  console.error("Bridge method audit failed: allowedMethods was not found in apps/desktop/electron/main.cjs.");
  process.exit(1);
}
const allowed = new Set([...allowBlock[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]));
// Handled directly in main.cjs before requests reach the host.
const shellHandled = new Set([...main.matchAll(/method === "([a-zA-Z]+\.[a-zA-Z.]+)"/g)].map((match) => match[1]));

const hostLoop = read("services/agent-host/Protocol/AgentHostLoop.cs");
const hostMethods = new Set([...hostLoop.matchAll(/"([a-z]+(?:\.[a-zA-Z]+)+)"\s*=>/g)].map((match) => match[1]));

const called = new Map();
for (const file of walk(path.join(root, "apps", "desktop", "src"))) {
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(/\brequest(?:<[^>]*>)?\(\s*"([a-zA-Z]+\.[a-zA-Z.]+)"/g)) {
    if (!called.has(match[1])) called.set(match[1], path.relative(root, file));
  }
}

const failures = [];
for (const [method, file] of called) {
  if (shellHandled.has(method)) continue;
  if (!allowed.has(method)) failures.push(`${method} (called from ${file}) is not in the Electron bridge allowlist`);
  else if (hostMethods.size && !hostMethods.has(method)) failures.push(`${method} (called from ${file}) is allowed by the bridge but not implemented by the Agent Host`);
}
for (const method of allowed) {
  if (!shellHandled.has(method) && hostMethods.size && !hostMethods.has(method)) failures.push(`${method} is in the bridge allowlist but not implemented by the Agent Host`);
}

if (called.size < 20) failures.push(`only ${called.size} renderer agent calls were found; the audit pattern may be out of date`);
if (failures.length) {
  console.error("Bridge method audit failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Bridge method audit passed: ${called.size} renderer methods are allowed by the bridge and implemented by the Agent Host.`);
