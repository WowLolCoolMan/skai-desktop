#!/usr/bin/env node

/* Disposable marketplace protocol smoke. It validates the local catalog and
 * provider-backed response shape without downloading a model. */

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const net = require("node:net");
const readline = require("node:readline");
const http = require("node:http");
const { ensureSmokeAgentHostBuild } = require("./smoke-agent-host-build.cjs");

const root = path.resolve(__dirname, "..");
// Keep the allowed root under the checkout. Windows runners can expose TEMP
// through an 8.3 user-profile alias that the MCP server later expands, making
// an otherwise identical allowlist path fail its exact-root check.
const smokeTempRoot = path.join(root, ".tmp");
fs.mkdirSync(smokeTempRoot, { recursive: true });
const profileRoot = fs.mkdtempSync(path.join(smokeTempRoot, "marketplace-smoke-"));
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

async function getFreeLoopbackPort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", resolve); });
  const { port } = probe.address();
  await new Promise(resolve => probe.close(resolve));
  return port;
}

async function runMcpHttpLifecycleAcceptance() {
  const requests = [];
  let nextSession = 0;
  let currentSession = "";
  const fixture = http.createServer(async (incoming, response) => {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { response.writeHead(400).end(); return; }
    const method = body.method;
    const session = incoming.headers["mcp-session-id"] ?? "";
    requests.push({ method, session, protocol: incoming.headers["mcp-protocol-version"] ?? "" });
    if (method === "initialize") {
      currentSession = `mcp-smoke-session-${++nextSession}`;
      response.setHeader("Mcp-Session-Id", currentSession);
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
        jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "Skai local MCP smoke", version: "1" } },
      }));
      return;
    }
    if (session !== currentSession) {
      response.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "missing or stale MCP session" }));
      return;
    }
    const result = method === "tools/list"
      ? { tools: [
        { name: "read_fixture", description: "Read a fixture value.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
        { name: "write_fixture", description: "Mutate fixture state.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: false } },
      ] }
      : method === "tools/call"
        ? { content: [{ type: "text", text: `fixture read using ${session}` }] }
        : null;
    if (!result) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
  });
  await new Promise((resolve, reject) => { fixture.once("error", reject); fixture.listen(0, "127.0.0.1", resolve); });
  const endpoint = `http://127.0.0.1:${fixture.address().port}/mcp`;
  try {
    const connect = () => request("mcp.connection.connect", { serverId: "streamable-http-smoke", transport: "streamable-http", endpoint });
    const first = await connect();
    const firstTools = first.result?.tools ?? [];
    const read = firstTools.find(tool => tool.toolName === "read_fixture");
    const write = firstTools.find(tool => tool.toolName === "write_fixture");
    const firstId = first.result?.connection?.connectionId;
    if (!first.ok || first.result?.connection?.state !== "healthy" || !read || read.isMutating || !write?.isMutating)
      throw new Error(`Loopback Streamable HTTP MCP did not connect with classified tools: ${JSON.stringify(first)}`);
    const readCall = () => request("mcp.tool.call", {
      connectionId: firstId, toolName: read.toolName, approvalId: "mcp-http-smoke-read",
      capabilities: ["mcp.invoke.read"], arguments: {},
    });
    const readResult = await readCall();
    if (!readResult.ok || readResult.result?.isError || !readResult.result?.text?.includes("mcp-smoke-session-1"))
      throw new Error(`Loopback Streamable HTTP MCP did not execute the approved read: ${JSON.stringify(readResult)}`);
    const beforeDenied = requests.length;
    const deniedWrite = await request("mcp.tool.call", {
      connectionId: firstId, toolName: write.toolName, approvalId: "mcp-http-smoke-read-only",
      capabilities: ["mcp.invoke.read"], arguments: {},
    });
    if (deniedWrite.ok || requests.length !== beforeDenied)
      throw new Error("Loopback Streamable HTTP MCP sent a write after the user granted read-only access.");
    const revoked = await request("mcp.connection.revoke", { connectionId: firstId });
    if (!revoked.ok) throw new Error("Loopback Streamable HTTP MCP could not be revoked cleanly.");
    const beforeRevokedCall = requests.length;
    const afterRevoke = await readCall();
    if (afterRevoke.ok || requests.length !== beforeRevokedCall)
      throw new Error("A revoked Streamable HTTP MCP connection still reached its server.");

    const second = await connect();
    const secondId = second.result?.connection?.connectionId;
    if (!second.ok || second.result?.connection?.state !== "healthy" || secondId === firstId)
      throw new Error(`Streamable HTTP MCP did not recover with a new connection after revoke: ${JSON.stringify(second)}`);
    const secondRead = await request("mcp.tool.call", {
      connectionId: secondId, toolName: "read_fixture", approvalId: "mcp-http-smoke-reconnect-read",
      capabilities: ["mcp.invoke.read"], arguments: {},
    });
    if (!secondRead.ok || secondRead.result?.isError || !secondRead.result?.text?.includes("mcp-smoke-session-2"))
      throw new Error(`Reconnected Streamable HTTP MCP did not use its fresh negotiated session: ${JSON.stringify(secondRead)}`);
    const protocolRequests = requests.filter(item => item.method !== "initialize");
    if (protocolRequests.some(item => !item.protocol || !item.session) || nextSession !== 2)
      throw new Error(`Streamable HTTP MCP did not preserve protocol/session headers across reconnect: ${JSON.stringify(requests)}`);
    const secondRevoked = await request("mcp.connection.revoke", { connectionId: secondId });
    if (!secondRevoked.ok) throw new Error("Reconnected Streamable HTTP MCP could not be revoked cleanly.");
    console.log("MCP Streamable HTTP lifecycle passed: negotiated session, read-only grant, denied write, revoke, and fresh-session recovery.");
  } finally {
    await new Promise(resolve => fixture.close(resolve));
  }
}

async function waitForOllama(endpoint, server, getStderr) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Temporary Ollama exited before becoming ready: ${getStderr()}`);
    try {
      const response = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(3_000) });
      if (response.ok) return;
    } catch { /* The isolated runtime is still starting. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Temporary Ollama did not become ready: ${getStderr()}`);
}

async function stopProcess(processHandle) {
  if (!processHandle || processHandle.exitCode !== null) return;
  processHandle.kill();
  await Promise.race([
    new Promise(resolve => processHandle.once("exit", resolve)),
    new Promise(resolve => setTimeout(resolve, 10_000)),
  ]);
}

async function runRealOllamaMarketplaceAcceptance(model) {
  if (!process.argv.includes("--real-local-ollama")) return false;
  const modelRoot = path.join(profileRoot, "real-ollama-models");
  fs.mkdirSync(modelRoot, { recursive: true });
  const port = await getFreeLoopbackPort();
  const endpoint = `http://127.0.0.1:${port}`;
  const ollama = spawn(process.platform === "win32" ? "ollama.exe" : "ollama", ["serve"], {
    cwd: root,
    env: { ...process.env, OLLAMA_HOST: `127.0.0.1:${port}`, OLLAMA_MODELS: modelRoot, OLLAMA_NOPRUNE: "1" },
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });
  let ollamaStderr = "";
  ollama.stderr.on("data", chunk => { ollamaStderr += chunk.toString(); });
  let installId;
  let modelRemoved = false;
  try {
    await waitForOllama(endpoint, ollama, () => ollamaStderr.slice(-2_000));
    console.log(`Temporary Ollama is ready at ${endpoint}; model data is isolated under the smoke profile.`);

    const started = await request("marketplace.models.install.start", { source: "ollama", repository: model.repository, endpoint });
    if (!started.ok || !started.result?.id) throw new Error(`The real Marketplace model install did not start: ${JSON.stringify(started)}`);
    installId = started.result.id;
    const installDeadline = Date.now() + 10 * 60_000;
    let installStatus;
    let lastProgressCount = -1;
    while (Date.now() < installDeadline) {
      installStatus = await request("marketplace.models.install.status", { id: installId });
      if (!installStatus.ok || installStatus.result?.status !== "running") break;
      const progress = installStatus.result.progress ?? [];
      if (progress.length !== lastProgressCount) {
        lastProgressCount = progress.length;
        const latest = progress.at(-1);
        if (latest?.completed != null && latest?.total != null) console.log(`Marketplace pull: ${latest.completed}/${latest.total} bytes.`);
      }
      await new Promise(resolve => setTimeout(resolve, 1_000));
    }
    if (!installStatus?.ok || installStatus.result?.status !== "completed") throw new Error(`The real Marketplace model install did not complete: ${JSON.stringify(installStatus)}`);
    const installedTags = await (await fetch(`${endpoint}/api/tags`)).json();
    if (!installedTags.models?.some(item => item.name === model.repository || item.name.startsWith(`${model.repository}:`)))
      throw new Error(`Ollama did not list the installed model after Marketplace reported completion: ${JSON.stringify(installedTags)}`);

    const use = await request("chat.complete", {
      endpoint,
      model: model.repository,
      provider: "Ollama",
      timeoutSeconds: 285,
      maxTokens: 80,
      messages: [{ role: "user", content: "Reply with a brief greeting and say that local model inference works." }],
    }, 300_000);
    const responseText = use.result?.content;
    if (!use.ok || typeof responseText !== "string" || responseText.trim().length < 2)
      throw new Error(`The installed Marketplace model did not produce a local chat response: ${JSON.stringify(use)}`);
    console.log(`Real Marketplace model inference passed (${model.repository}; ${responseText.trim().slice(0, 160)}).`);

    const removed = await request("marketplace.models.remove", { endpoint, model: model.repository });
    if (!removed.ok || removed.result?.removed !== true || removed.result?.provider !== "Ollama")
      throw new Error(`The real Marketplace model removal did not complete: ${JSON.stringify(removed)}`);
    modelRemoved = true;
    const remainingTags = await (await fetch(`${endpoint}/api/tags`)).json();
    if (remainingTags.models?.some(item => item.name === model.repository || item.name.startsWith(`${model.repository}:`)))
      throw new Error(`Ollama still lists ${model.repository} after Marketplace removal.`);
    console.log(`Real Marketplace install/use/remove passed for ${model.repository}.`);
    return true;
  } finally {
    if (!modelRemoved && installId) {
      await request("marketplace.models.install.cancel", { id: installId }).catch(() => {});
      await request("marketplace.models.remove", { endpoint, model: model.repository }).catch(() => {});
    }
    await stopProcess(ollama);
    fs.rmSync(modelRoot, { recursive: true, force: true });
  }
}

async function run() {
  const health = await request("runtime.health");
  const capabilities = health.result?.capabilities ?? [];
  for (const capability of ["marketplace.catalog", "marketplace.models.search", "marketplace.models.install.start", "marketplace.models.install.status", "marketplace.models.install.cancel", "marketplace.models.remove", "voice.kokoro.install.start", "voice.kokoro.install.status", "voice.chatterbox.install.start", "voice.chatterbox.install.status", "voice.piper.install.start", "voice.piper.install.status", "voice.pocket.install.start", "voice.pocket.install.status", "voice.whisper.install.start", "voice.whisper.install.status", "voice.whisper.transcribe", "voice.whisper.transcribe.cancel"]) {
    if (!health.ok || !capabilities.includes(capability)) throw new Error(`runtime.health did not advertise ${capability}.`);
  }
  const catalog = await request("marketplace.catalog");
  const providers = catalog.result?.providers ?? [];
  if (!catalog.ok || !providers.some(provider => provider.id === "huggingface") || !providers.some(provider => provider.id === "modelscope") || !Array.isArray(catalog.result?.skills) || !Array.isArray(catalog.result?.tools)) throw new Error("marketplace.catalog did not return the provider and capability catalog.");
  const curated = catalog.result?.catalogEntries ?? [];
  if (curated.length !== 90) throw new Error(`Expected the 90 requested curated entries, got ${curated.length}.`);
  for (const entry of curated) {
    const expectedAdapter = entry.id === "filesystem-mcp"
      ? "local-mcp-filesystem"
      : entry.id === "playwright-mcp" ? "local-mcp-playwright"
      : entry.id === "postgres-mcp-pro" ? "local-mcp-postgres"
      : entry.id === "figma-mcp" ? "local-mcp-figma"
      : entry.id === "supabase-mcp" ? "local-mcp-supabase"
      : entry.id === "kokoro-82m" ? "local-voice-kokoro"
      : entry.id === "chatterbox" ? "local-voice-chatterbox"
      : entry.id === "pocket-tts" ? "local-voice-pocket-tts"
      : entry.id === "piper" ? "local-voice-piper"
      : entry.id === "whisper-large-v3" ? "local-voice-whisper"
      : entry.category === "Coding" || entry.category === "Chat / General LLM" ? "local-model-search" : "none";
    if (entry.localOnly !== true || entry.installable !== (expectedAdapter !== "none") || entry.adapter !== expectedAdapter) {
      throw new Error(`Marketplace adapter boundary is inconsistent for ${entry.name}.`);
    }
  }
  const backedEntries = curated.filter(entry => entry.installable === true);
  if (backedEntries.length !== 42) throw new Error(`Expected 42 entries with real local adapters; found ${backedEntries.length}.`);
  const voicePipelines = [
    ["kokoro-82m", "isolated Python", "INT8 Kokoro ONNX"],
    ["piper", "isolated Python", "pinned English voice"],
    ["chatterbox", "isolated Python", "Chatterbox-TTS source"],
    ["pocket-tts", "official v4.0.1 release", "built-in alba voice"],
    ["whisper-large-v3", "isolated Python", "faster-whisper"],
  ];
  for (const [id, runtimeMarker, componentMarker] of voicePipelines) {
    const entry = curated.find(item => item.id === id);
    if (!entry || !entry.installReview?.toLowerCase().includes(runtimeMarker.toLowerCase()) || !entry.installReview.toLowerCase().includes(componentMarker.toLowerCase())) {
      throw new Error(`Voice pipeline metadata is incomplete for ${id}: ${JSON.stringify(entry)}`);
    }
  }
  const kokoroStatus = await request("voice.kokoro.install.status");
  if (!kokoroStatus.ok || typeof kokoroStatus.result?.installed !== "boolean" || !["not-installed", "installing", "installed", "failed"].includes(kokoroStatus.result?.status)) {
    throw new Error(`Kokoro local runtime status is incomplete: ${JSON.stringify(kokoroStatus)}`);
  }
  const piperStatus = await request("voice.piper.install.status");
  if (!piperStatus.ok || typeof piperStatus.result?.installed !== "boolean" || !["not-installed", "installing", "installed", "failed"].includes(piperStatus.result?.status)) {
    throw new Error(`Piper local runtime status is incomplete: ${JSON.stringify(piperStatus)}`);
  }
  const chatterboxStatus = await request("voice.chatterbox.install.status");
  if (!chatterboxStatus.ok || typeof chatterboxStatus.result?.installed !== "boolean" || !["not-installed", "installing", "installed", "failed"].includes(chatterboxStatus.result?.status)) {
    throw new Error(`Chatterbox local runtime status is incomplete: ${JSON.stringify(chatterboxStatus)}`);
  }
  const pocketStatus = await request("voice.pocket.install.status");
  if (!pocketStatus.ok || typeof pocketStatus.result?.installed !== "boolean" || !["not-installed", "installing", "installed", "failed", "unavailable"].includes(pocketStatus.result?.status)) {
    throw new Error(`Pocket TTS local runtime status is incomplete: ${JSON.stringify(pocketStatus)}`);
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
  await runMcpHttpLifecycleAcceptance();
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
  const filesystemReconnected = await request("mcp.connection.connect", {
    serverId: "filesystem", transport: "stdio", profileId: "filesystem", folderPath: sharedFolder,
  }, 7 * 60_000);
  if (!filesystemReconnected.ok || filesystemReconnected.result?.connection?.state !== "healthy"
    || filesystemReconnected.result?.connection?.connectionId === filesystem.result.connection.connectionId) {
    throw new Error(`Filesystem MCP could not establish a fresh connection after revocation: ${JSON.stringify(filesystemReconnected)}`);
  }
  const reconnectTools = filesystemReconnected.result?.tools ?? [];
  const reconnectListTool = reconnectTools.find(tool => tool.toolName === "list_directory");
  if (!reconnectListTool || reconnectTools.some(tool => ["write_file", "edit_file", "create_directory", "delete_file"].includes(tool.toolName))) {
    throw new Error(`Filesystem MCP reconnect changed its read-only tool boundary: ${JSON.stringify(filesystemReconnected)}`);
  }
  const reconnectRead = await request("mcp.tool.call", {
    connectionId: filesystemReconnected.result.connection.connectionId,
    toolName: reconnectListTool.toolName,
    approvalId: "marketplace-smoke-filesystem-reconnect-read",
    capabilities: ["mcp.invoke.read"],
    arguments: { path: sharedFolder },
  });
  if (!reconnectRead.ok || reconnectRead.result?.isError || !reconnectRead.result?.text?.includes("sample.txt")) {
    throw new Error(`Filesystem MCP could not resume approved reads after reconnect: ${JSON.stringify(reconnectRead)}`);
  }
  const reconnectRevoked = await request("mcp.connection.revoke", { connectionId: filesystemReconnected.result.connection.connectionId });
  if (!reconnectRevoked.ok) throw new Error("Filesystem MCP could not be cleanly stopped after reconnect acceptance.");
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

  const ollama = await request("marketplace.models.search", { query: "qwen3 coder", provider: "Ollama", uncensored: false });
  const curatedModel = ollama.result?.models?.find(model => model.repository === "qwen3-coder:30b-a3b-q4_K_M");
  if (!ollama.ok || !curatedModel?.installable || curatedModel.installRoute !== "ollama-pull") {
    throw new Error(`The curated Ollama model does not expose its verified install route: ${JSON.stringify(ollama)}`);
  }

  const lightweightModel = ollama.result?.models?.find(model => model.repository === "qwen2.5:0.5b");
  if (!lightweightModel?.installable || lightweightModel.installRoute !== "ollama-pull" || lightweightModel.sizeBytes !== 398_000_000 || lightweightModel.license !== "Apache-2.0")
    throw new Error(`The lightweight curated Ollama model does not expose its bounded install route: ${JSON.stringify(lightweightModel)}`);

  // Verify the exact Marketplace protocol through a fake runtime by default;
  // pass --real-local-ollama for isolated install, inference, and removal.
  if (process.argv.includes("--real-local-ollama")) {
    await runRealOllamaMarketplaceAcceptance(lightweightModel);
    const remoteRemoval = await request("marketplace.models.remove", { endpoint: "https://example.com", model: lightweightModel.repository });
    if (remoteRemoval.ok || !remoteRemoval.error?.message?.includes("loopback")) throw new Error("Marketplace model removal accepted a hosted endpoint.");
  } else {
  const runtimeRequests = [];
  const runtime = http.createServer(async (incoming, outgoing) => {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    runtimeRequests.push({ method: incoming.method, url: incoming.url, body });
    outgoing.writeHead(200, { "content-type": incoming.url === "/api/pull" ? "application/x-ndjson" : "application/json" });
    outgoing.end(incoming.url === "/api/pull" ? '{"status":"success"}\n' : "{}");
  });
  await new Promise((resolve, reject) => { runtime.once("error", reject); runtime.listen(0, "127.0.0.1", resolve); });
  const endpoint = `http://127.0.0.1:${runtime.address().port}`;
  try {
    const started = await request("marketplace.models.install.start", { source: "ollama", repository: curatedModel.repository, endpoint });
    if (!started.ok || !started.result?.id) throw new Error(`The curated model install did not start: ${JSON.stringify(started)}`);
    let installStatus;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      installStatus = await request("marketplace.models.install.status", { id: started.result.id });
      if (!installStatus.ok || installStatus.result?.status !== "running") break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!installStatus?.ok || installStatus.result?.status !== "completed") throw new Error(`The curated model install did not complete: ${JSON.stringify(installStatus)}`);
    const removed = await request("marketplace.models.remove", { endpoint, model: curatedModel.repository });
    if (!removed.ok || removed.result?.removed !== true || removed.result?.provider !== "Ollama") throw new Error(`The curated model removal did not complete: ${JSON.stringify(removed)}`);
    if (!runtimeRequests.some(item => item.method === "POST" && item.url === "/api/pull" && item.body.name === curatedModel.repository)
      || !runtimeRequests.some(item => item.method === "DELETE" && item.url === "/api/delete" && item.body.name === curatedModel.repository)) {
      throw new Error(`The local runtime did not receive exact install and remove requests: ${JSON.stringify(runtimeRequests)}`);
    }
    const remoteRemoval = await request("marketplace.models.remove", { endpoint: "https://example.com", model: curatedModel.repository });
    if (remoteRemoval.ok || !remoteRemoval.error?.message?.includes("loopback")) throw new Error("Marketplace model removal accepted a hosted endpoint.");
  } finally {
    await new Promise(resolve => runtime.close(resolve));
  }
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
