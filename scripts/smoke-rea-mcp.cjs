#!/usr/bin/env node

/* Real REA Marketplace acceptance through the Skai Agent Host. REA runs under
 * a disposable home and npm cache; the only invoked REA tool is read-only. */

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const { ensureSmokeAgentHostBuild } = require("./smoke-agent-host-build.cjs");

const root = path.resolve(__dirname, "..");
const scratch = path.join(root, ".tmp");
fs.mkdirSync(scratch, { recursive: true });
const profile = fs.mkdtempSync(path.join(scratch, "rea-mcp-smoke-"));
const cache = path.join(profile, "npm-cache");
const isolatedEnv = {
  ...process.env,
  HERMES_HOME: profile,
  npm_config_cache: cache,
  NPM_CONFIG_CACHE: cache,
  SRAI_SETTINGS_PATH: path.join(profile, "settings.json"),
  SRAI_MCP_CONNECTIONS_PATH: path.join(profile, "mcp-connections.json"),
  SRAI_CONVERSATIONS_PATH: path.join(profile, "conversations.json"),
  SRAI_TASKS_PATH: path.join(profile, "agent-tasks.json"),
  SRAI_SCHEDULED_TASKS_PATH: path.join(profile, "scheduled-tasks.json"),
  SRAI_PROJECTS_PATH: path.join(profile, "projects.json"),
  SRAI_CORPUS_PATH: path.join(profile, "document-corpus.json"),
  SKAI_SKIP_LEGACY_DATA_MIGRATION: "true",
};

let child;
let stderr = "";
let nextId = 0;
let activeConnectionId;
const pending = new Map();

function request(method, params = {}, timeoutMs = 7 * 60_000) {
  const id = `rea-smoke-${++nextId}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for ${method}.`));
    }, timeoutMs);
    pending.set(id, response => {
      clearTimeout(timer);
      resolve(response);
    });
    child.stdin.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
  });
}

async function run() {
  const hostAssembly = ensureSmokeAgentHostBuild(root);
  const hostProgram = process.platform === "win32" ? hostAssembly.replace(/\.dll$/i, ".exe") : "dotnet";
  const hostArgs = process.platform === "win32" ? ["--stdio"] : [hostAssembly, "--stdio"];
  child = spawn(hostProgram, hostArgs, { cwd: root, env: isolatedEnv, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const reader = readline.createInterface({ input: child.stdout });
  child.stderr.on("data", chunk => { stderr += chunk.toString(); });
  reader.on("line", line => {
    try {
      const response = JSON.parse(line);
      const resolve = pending.get(response.id);
      if (resolve) {
        pending.delete(response.id);
        resolve(response);
      }
    } catch { /* protocol errors are surfaced as a timeout with host diagnostics */ }
  });

  const connected = await request("mcp.connection.connect", { serverId: "rea", transport: "stdio", profileId: "rea" });
  if (!connected.ok || connected.result?.connection?.state !== "healthy") {
    throw new Error(`REA did not connect through the Skai Agent Host: ${JSON.stringify(connected)}`);
  }
  const connectionId = connected.result.connection.connectionId;
  activeConnectionId = connectionId;
  const tools = connected.result.tools ?? [];
  if (tools.length < 100 || tools.length > 256) throw new Error(`REA returned an unexpected bounded tool manifest (${tools.length} tools).`);

  const safeRead = tools.find(tool => tool.toolName === "list_unknowns");
  if (!safeRead || safeRead.isMutating || !safeRead.requiredCapabilities?.includes("mcp.invoke.read")) {
    throw new Error("REA's read-only list_unknowns tool is missing or was not classified as read-only.");
  }
  const call = await request("mcp.tool.call", {
    connectionId,
    toolName: safeRead.toolName,
    approvalId: "rea-mcp-smoke-read-only",
    capabilities: ["mcp.invoke.read"],
    arguments: { limit: 1 },
  });
  if (!call.ok || call.result?.isError || typeof call.result?.text !== "string") {
    throw new Error(`REA's approved read-only tool call failed through Skai: ${JSON.stringify(call)}`);
  }

  const revoked = await request("mcp.connection.revoke", { connectionId });
  if (!revoked.ok || revoked.result?.state !== "revoked") throw new Error("Skai could not revoke the REA process cleanly.");
  activeConnectionId = undefined;
  const afterRevoke = await request("mcp.tools.list", { connectionId });
  if (!afterRevoke.ok || afterRevoke.result?.connected !== false || afterRevoke.result?.connection?.state !== "revoked") {
    throw new Error("The revoked REA connection remained available through Skai.");
  }

  const npxRoot = path.join(cache, "_npx");
  const installed = fs.existsSync(npxRoot) && fs.readdirSync(npxRoot).some(directory => {
    const packageJson = path.join(npxRoot, directory, "node_modules", "rea-agents", "package.json");
    if (!fs.existsSync(packageJson)) return false;
    try { return JSON.parse(fs.readFileSync(packageJson, "utf8")).version === "6.7.0"; }
    catch { return false; }
  });
  if (!installed) throw new Error("The pinned REA package was not installed in the smoke's isolated npm cache after Skai connected.");

  console.log(`REA Marketplace acceptance passed through Skai: ${tools.length} tools, read-only invocation, revoke, isolated npm cache.`);
}

run().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  if (stderr.trim()) console.error(stderr.trim());
  process.exitCode = 1;
}).finally(async () => {
  if (child && activeConnectionId) {
    try { await request("mcp.connection.revoke", { connectionId: activeConnectionId }, 5_000); } catch { /* host teardown still stops the smoke */ }
  }
  if (child && child.exitCode === null) {
    child.kill();
    await new Promise(resolve => child.once("exit", resolve));
  }
  fs.rmSync(profile, { recursive: true, force: true });
});
