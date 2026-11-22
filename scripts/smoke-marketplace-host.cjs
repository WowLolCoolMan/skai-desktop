#!/usr/bin/env node

/* Disposable marketplace protocol smoke. It validates the local catalog and
 * provider-backed response shape without downloading a model. */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const { ensureSmokeAgentHostBuild } = require("./smoke-agent-host-build.cjs");

const root = path.resolve(__dirname, "..");
const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skai-marketplace-smoke-"));
const env = {
  ...process.env,
  SRAI_SETTINGS_PATH: path.join(profileRoot, "settings.json"),
  SRAI_MCP_CONNECTIONS_PATH: path.join(profileRoot, "mcp-connections.json"),
  SRAI_CONVERSATIONS_PATH: path.join(profileRoot, "conversations.json"),
  SRAI_TASKS_PATH: path.join(profileRoot, "agent-tasks.json"),
  SRAI_SCHEDULED_TASKS_PATH: path.join(profileRoot, "scheduled-tasks.json"),
  SRAI_PROJECTS_PATH: path.join(profileRoot, "projects.json"),
  SRAI_CORPUS_PATH: path.join(profileRoot, "document-corpus.json"),
  SKAI_SKIP_LEGACY_DATA_MIGRATION: "true",
};
const hostAssembly = ensureSmokeAgentHostBuild(root);
const hostProgram = process.platform === "win32" ? hostAssembly.replace(/\.dll$/i, ".exe") : "dotnet";
const hostArgs = process.platform === "win32" ? ["--stdio"] : [hostAssembly, "--stdio"];
const child = spawn(hostProgram, hostArgs, { cwd: root, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
const reader = readline.createInterface({ input: child.stdout });
const pending = new Map();
let nextId = 1;
let stderr = "";

child.stderr.on("data", chunk => { stderr += chunk.toString(); });
reader.on("line", line => {
  try {
    const response = JSON.parse(line);
    const resolve = pending.get(response.id);
    if (resolve) { pending.delete(response.id); resolve(response); }
  } catch { /* protocol failures are reported by timeout */ }
});

function request(method, params, timeoutMs = 45_000) {
  const id = `marketplace-${nextId++}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out waiting for ${method}.`)); }, timeoutMs);
    pending.set(id, response => { clearTimeout(timer); resolve(response); });
    child.stdin.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
  });
}

async function run() {
  const health = await request("runtime.health");
  const capabilities = health.result?.capabilities ?? [];
  for (const capability of ["marketplace.catalog", "marketplace.models.search", "marketplace.models.install.start", "marketplace.models.install.status", "marketplace.models.install.cancel", "voice.kokoro.install.start", "voice.kokoro.install.status", "voice.piper.install.start", "voice.piper.install.status", "voice.whisper.install.start", "voice.whisper.install.status", "voice.whisper.transcribe"]) {
    if (!health.ok || !capabilities.includes(capability)) throw new Error(`runtime.health did not advertise ${capability}.`);
  }
  const catalog = await request("marketplace.catalog");
  const providers = catalog.result?.providers ?? [];
  if (!catalog.ok || !providers.some(provider => provider.id === "huggingface") || !providers.some(provider => provider.id === "modelscope") || !Array.isArray(catalog.result?.skills) || !Array.isArray(catalog.result?.tools)) throw new Error("marketplace.catalog did not return the provider and capability catalog.");
  const curated = catalog.result?.catalogEntries ?? [];
  if (curated.length !== 89) throw new Error(`Expected the 89 requested curated entries, got ${curated.length}.`);
  for (const entry of curated) {
    const expectedAdapter = entry.id === "filesystem-mcp"
      ? "local-mcp-filesystem"
      : entry.id === "playwright-mcp" ? "local-mcp-playwright"
      : entry.id === "postgres-mcp-pro" ? "local-mcp-postgres"
      : entry.id === "figma-mcp" ? "local-mcp-figma"
      : entry.id === "supabase-mcp" ? "local-mcp-supabase"
      : entry.id === "kokoro-82m" ? "local-voice-kokoro"
      : entry.id === "piper" ? "local-voice-piper"
      : entry.id === "whisper-large-v3" ? "local-voice-whisper"
      : entry.category === "Coding" || entry.category === "Chat / General LLM" ? "local-model-search" : "none";
    if (entry.localOnly !== true || entry.installable !== (expectedAdapter !== "none") || entry.adapter !== expectedAdapter) {
      throw new Error(`Marketplace adapter boundary is inconsistent for ${entry.name}.`);
    }
  }
  const backedEntries = curated.filter(entry => entry.installable === true);
  if (backedEntries.length !== 40) throw new Error(`Expected 40 entries with real local adapters; found ${backedEntries.length}.`);
  const kokoroStatus = await request("voice.kokoro.install.status");
  if (!kokoroStatus.ok || typeof kokoroStatus.result?.installed !== "boolean" || !["not-installed", "installing", "installed", "failed"].includes(kokoroStatus.result?.status)) {
    throw new Error(`Kokoro local runtime status is incomplete: ${JSON.stringify(kokoroStatus)}`);
  }
  const piperStatus = await request("voice.piper.install.status");
  if (!piperStatus.ok || typeof piperStatus.result?.installed !== "boolean" || !["not-installed", "installing", "installed", "failed"].includes(piperStatus.result?.status)) {
    throw new Error(`Piper local runtime status is incomplete: ${JSON.stringify(piperStatus)}`);
  }
  const whisperStatus = await request("voice.whisper.install.status");
  if (!whisperStatus.ok || typeof whisperStatus.result?.installed !== "boolean" || !["not-installed", "installing", "installed", "failed"].includes(whisperStatus.result?.status)) {
    throw new Error(`Whisper local runtime status is incomplete: ${JSON.stringify(whisperStatus)}`);
  }
  const hostedMcp = await request("mcp.connection.connect", {
    serverId: "hosted-check", transport: "streamable-http", endpoint: "https://example.com/mcp",
  });
  if (hostedMcp.ok || !hostedMcp.error?.message?.includes("local server")) {
    throw new Error("Marketplace accepted a hosted MCP endpoint despite its local-only boundary.");
  }
  const sharedFolder = path.join(profileRoot, "filesystem-mcp-share");
  fs.mkdirSync(sharedFolder);
  fs.writeFileSync(path.join(sharedFolder, "sample.txt"), "read-only MCP smoke\n");
  const filesystem = await request("mcp.connection.connect", {
    serverId: "filesystem", transport: "stdio", profileId: "filesystem", folderPath: sharedFolder,
  }, 7 * 60_000);
  const filesystemTools = filesystem.result?.tools ?? [];
  if (!filesystem.ok || filesystem.result?.connection?.state !== "healthy" || !filesystemTools.some(tool => tool.toolName === "list_directory") || filesystemTools.some(tool => ["write_file", "edit_file", "create_directory", "delete_file"].includes(tool.toolName))) {
    throw new Error(`Filesystem MCP did not connect with read-only tools: ${JSON.stringify(filesystem)}`);
  }
  const listDirectory = filesystemTools.find(tool => tool.toolName === "list_directory");
  const listed = await request("mcp.tool.call", {
    connectionId: filesystem.result.connection.connectionId,
    toolName: listDirectory.toolName,
    approvalId: "marketplace-smoke-filesystem-read",
    capabilities: ["mcp.invoke.read"],
    arguments: { path: sharedFolder },
  });
  if (!listed.ok || listed.result?.isError || !listed.result?.text?.includes("sample.txt")) {
    throw new Error(`Filesystem MCP could not execute its approved read-only list tool: ${JSON.stringify(listed)}`);
  }
  const revoked = await request("mcp.connection.revoke", { connectionId: filesystem.result.connection.connectionId });
  if (!revoked.ok) throw new Error("Filesystem MCP could not be cleanly stopped after the smoke check.");
  const playwright = await request("mcp.connection.connect", {
    serverId: "playwright", transport: "stdio", profileId: "playwright",
  }, 7 * 60_000);
  if (!playwright.ok || playwright.result?.connection?.state !== "healthy" || !playwright.result?.tools?.length) {
    throw new Error(`Playwright MCP did not connect with a local tool manifest: ${JSON.stringify(playwright)}`);
  }
  const playwrightTools = playwright.result.tools;
  const navigate = playwrightTools.find(tool => tool.toolName === "browser_navigate");
  const snapshot = playwrightTools.find(tool => tool.toolName === "browser_snapshot");
  if (!navigate || !snapshot) throw new Error("Playwright MCP did not advertise its local navigation and snapshot tools.");
  const navigated = await request("mcp.tool.call", {
    connectionId: playwright.result.connection.connectionId,
    toolName: navigate.toolName,
    approvalId: "marketplace-smoke-playwright-navigation",
    capabilities: navigate.requiredCapabilities?.length ? navigate.requiredCapabilities : ["mcp.invoke.write"],
    arguments: { url: "about:blank" },
  }, 7 * 60_000);
  if (!navigated.ok || navigated.result?.isError) throw new Error(`Playwright MCP could not navigate to a local blank page: ${JSON.stringify(navigated)}`);
  const captured = await request("mcp.tool.call", {
    connectionId: playwright.result.connection.connectionId,
    toolName: snapshot.toolName,
    approvalId: "marketplace-smoke-playwright-snapshot",
    capabilities: snapshot.requiredCapabilities?.length ? snapshot.requiredCapabilities : ["mcp.invoke.read"],
    arguments: {},
  }, 7 * 60_000);
  if (!captured.ok || captured.result?.isError || !captured.result?.text?.includes("about:blank")) {
    throw new Error(`Playwright MCP could not read the local blank page snapshot: ${JSON.stringify(captured)}`);
  }
  const playwrightRevoked = await request("mcp.connection.revoke", { connectionId: playwright.result.connection.connectionId });
  if (!playwrightRevoked.ok) throw new Error("Playwright MCP could not be cleanly stopped after the smoke check.");
  const hostedPostgres = await request("mcp.connection.connect", {
    serverId: "postgres-mcp-pro", transport: "stdio", profileId: "postgres",
    connectionString: "postgresql://user:password@db.example.com:5432/test",
  });
  if (hostedPostgres.ok || !hostedPostgres.error?.message?.includes("local database")) {
    throw new Error("Marketplace accepted a hosted PostgreSQL connection despite its local-only boundary.");
  }
  const postgres = await request("mcp.connection.connect", {
    serverId: "postgres-mcp-pro", transport: "stdio", profileId: "postgres",
    connectionString: "postgresql://smoke:smoke@127.0.0.1:1/smoke",
  }, 7 * 60_000);
  const postgresTools = postgres.result?.tools ?? [];
  if (!postgres.ok || postgres.result?.connection?.state !== "healthy" || !postgresTools.some(tool => tool.toolName === "postgres_mcp_query")) {
    throw new Error(`PostgreSQL MCP did not connect with its local tool manifest: ${JSON.stringify(postgres)}`);
  }
  const postgresRevoked = await request("mcp.connection.revoke", { connectionId: postgres.result.connection.connectionId });
  if (!postgresRevoked.ok) throw new Error("PostgreSQL MCP could not be cleanly stopped after the smoke check.");
  const search = await request("marketplace.models.search", { query: "qwen", uncensored: false });
  if (!search.ok || !Array.isArray(search.result?.models) || !search.result?.providers || typeof search.result.providers !== "object") throw new Error(`marketplace.models.search returned an invalid provider response: ${JSON.stringify(search)}`);
  for (const model of search.result.models) {
    if (typeof model.id !== "string" || typeof model.repository !== "string" || typeof model.source !== "string" || typeof model.installable !== "boolean") throw new Error("marketplace.models.search returned an incomplete model record.");
  }
  const gemma = await request("marketplace.models.search", { query: "gemma 4 31b", uncensored: true });
  const reviewedGemma = gemma.result?.models?.find(model => model.repository === "Kooten/gemma-4-31b-abliterated-v1.1-GGUF");
  if (!gemma.ok || !reviewedGemma || reviewedGemma.installRoute !== "lm-studio" || reviewedGemma.installable !== true || !reviewedGemma.tags?.includes("dense") || !reviewedGemma.tags?.includes("abliterated")) {
    throw new Error(`The reviewed Gemma 4 31B dense abliterated entry is missing or incomplete: ${JSON.stringify(gemma)}`);
  }
  console.log(`Marketplace host smoke passed (${providers.length} providers, ${search.result.models.length} model results).`);
}

run().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  if (stderr.trim()) console.error(stderr.trim());
  process.exitCode = 1;
}).finally(() => {
  child.kill();
});
