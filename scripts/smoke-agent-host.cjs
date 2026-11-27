#!/usr/bin/env node

/* Isolated replacement-shell protocol smoke. It exercises only disposable
 * settings/history files and never reads or writes the user's profile. */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const readline = require("node:readline");
const http = require("node:http");
const { ensureSmokeAgentHostBuild } = require("./smoke-agent-host-build.cjs");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skai-agent-host-smoke-"));
const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skai-agent-host-profile-"));
const env = {
  ...process.env,
  SRAI_SETTINGS_PATH: path.join(profileRoot, "settings.json"),
  SRAI_CONVERSATIONS_PATH: path.join(profileRoot, "conversations.json"),
  SRAI_TASKS_PATH: path.join(profileRoot, "agent-tasks.json"),
  SRAI_SCHEDULED_TASKS_PATH: path.join(profileRoot, "scheduled-tasks.json"),
  SRAI_PROJECTS_PATH: path.join(profileRoot, "projects.json"),
  SRAI_CORPUS_PATH: path.join(profileRoot, "document-corpus.json"),
  SRAI_MCP_CONNECTIONS_PATH: path.join(profileRoot, "mcp-connections.json"),
  SKAI_SKIP_LEGACY_DATA_MIGRATION: "true",
};
spawnSync("git", ["init", "--quiet", tempRoot], { cwd: tempRoot, windowsHide: true });
spawnSync("git", ["config", "user.email", "smoke@example.invalid"], { cwd: tempRoot, windowsHide: true });
spawnSync("git", ["config", "user.name", "Skai smoke"], { cwd: tempRoot, windowsHide: true });
fs.writeFileSync(path.join(tempRoot, ".gitkeep"), "smoke\n");
spawnSync("git", ["add", ".gitkeep"], { cwd: tempRoot, windowsHide: true });
spawnSync("git", ["commit", "--quiet", "-m", "Initial smoke state"], { cwd: tempRoot, windowsHide: true });
fs.writeFileSync(path.join(tempRoot, "status-smoke.txt"), "status\n");
const interruptedTaskId = "interrupted-smoke-task";
fs.writeFileSync(env.SRAI_TASKS_PATH, JSON.stringify([{
  id: interruptedTaskId,
  title: "Interrupted smoke task",
  instruction: "Verify restart recovery.",
  role: "specialist",
  status: "running",
  dependsOn: [],
  resultSummary: null,
  artifactLabels: [],
  worktreePath: null,
  worktreeBranch: null,
  worktreeRepositoryRoot: null,
  createdAtUtc: new Date().toISOString(),
  updatedAtUtc: new Date().toISOString(),
}], null, 2));
const hostAssembly = ensureSmokeAgentHostBuild(root);
const hostProgram = process.platform === "win32" ? hostAssembly.replace(/\.dll$/i, ".exe") : "dotnet";
const hostArgs = process.platform === "win32" ? ["--stdio"] : [hostAssembly, "--stdio"];
const child = spawn(hostProgram, hostArgs, {
  cwd: root,
  env,
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
const reader = readline.createInterface({ input: child.stdout });
let nextId = 1;
const pending = new Map();
let stderr = "";
const pendingSmokeServers = new Set();
const smokeWorktreePaths = new Set();

child.stderr.on("data", chunk => { stderr += chunk.toString(); });
reader.on("line", line => {
  try {
    const response = JSON.parse(line);
    const entry = pending.get(response.id);
    if (entry && response.kind === "progress") { entry.onProgress?.(response.result?.delta); return; }
    if (entry) { pending.delete(response.id); entry.resolve(response); }
  } catch { /* The host protocol response is validated by the request timeout. */ }
});

function request(method, params, onProgress) {
  const id = `smoke-${nextId++}`;
  child.stdin.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out waiting for ${method}.`)); }, method === "airllm.status" ? 30_000 : 10_000);
    pending.set(id, { onProgress, resolve: response => { clearTimeout(timer); resolve(response); } });
  });
}

function attachSmokeWorktree(taskId, dirty = false) {
  const branch = `smoke/release/${taskId.slice(0, 10)}`;
  const worktreePath = path.join(os.tmpdir(), `skai-worktree-smoke-${taskId}`);
  const added = spawnSync("git", ["worktree", "add", "-b", branch, worktreePath, "HEAD"], { cwd: tempRoot, encoding: "utf8", windowsHide: true });
  if (added.status !== 0) throw new Error(`Could not create the isolated worktree release fixture: ${added.stderr || added.stdout}`);
  smokeWorktreePaths.add(worktreePath);
  if (dirty) fs.writeFileSync(path.join(worktreePath, "uncommitted-smoke.txt"), "keep until reviewed\n");
  const records = JSON.parse(fs.readFileSync(env.SRAI_TASKS_PATH, "utf8"));
  const task = records.find(item => item.id === taskId);
  if (!task) throw new Error("The isolated worktree release task was not saved.");
  task.status = "completed";
  task.worktreeRepositoryRoot = tempRoot;
  task.worktreePath = worktreePath;
  task.worktreeBranch = branch;
  fs.writeFileSync(env.SRAI_TASKS_PATH, JSON.stringify(records, null, 2));
  return { branch, worktreePath };
}

async function run() {
  let capturedModelRequest = null;
  let modelStreamEnded = false;
  const chatDeltas = [];
  const modelServer = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", chunk => { body += chunk; });
    request.on("end", () => {
      capturedModelRequest = JSON.parse(body);
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write('data: {"choices":[{"delta":{"content":"mode "}}]}\n\n');
      setTimeout(() => {
        response.write('data: {"choices":[{"delta":{"content":"<think>hidden reasoning</think>"}}]}\n\n');
        setTimeout(() => {
          response.write('data: {"choices":[{"delta":{"content":"smoke reply"}}]}\n\n');
          modelStreamEnded = true;
          response.end("data: [DONE]\n\n");
        }, 200);
      }, 200);
    });
  });
  pendingSmokeServers.add(modelServer);
  await new Promise(resolve => modelServer.listen(0, "127.0.0.1", resolve));
  const modelPort = modelServer.address().port;
  let visibleDeltaBeforeModelEnd = false;
  const modeReply = await request("chat.complete", { provider: "Local API", endpoint: `http://127.0.0.1:${modelPort}/v1`, model: "mode-smoke-model", responseMode: "security", streamResponse: true, messages: [{ role: "user", content: "Review a local security test." }] }, delta => { chatDeltas.push(delta); if (!modelStreamEnded) visibleDeltaBeforeModelEnd = true; });
  await new Promise(resolve => modelServer.close(resolve));
  pendingSmokeServers.delete(modelServer);
  if (!modeReply.ok || modeReply.result?.content !== "mode smoke reply" || !capturedModelRequest?.messages?.some(message => message.role === "system" && message.content.includes("Security / Risky")))
    throw new Error("chat.complete did not forward the user-selected response mode to the selected local model.");
  if (chatDeltas.join("") !== "mode smoke reply") throw new Error(`chat.complete did not stream model deltas in order: ${JSON.stringify(chatDeltas)}`);
  if (!visibleDeltaBeforeModelEnd) throw new Error("chat.complete withheld visible text until after model generation ended.");
  const health = await request("runtime.health");
  if (!health.ok || !health.result?.capabilities?.includes("airllm.status") || !health.result?.capabilities?.includes("conversation.save") || !health.result?.capabilities?.includes("settings.save") || !health.result?.capabilities?.includes("voice.speak") || !health.result?.capabilities?.includes("tasks.execute") || !health.result?.capabilities?.includes("corpus.search") || !health.result?.capabilities?.includes("models.pull.start") || !health.result?.capabilities?.includes("models.pull.status") || !health.result?.capabilities?.includes("models.pull.cancel") || !health.result?.capabilities?.includes("skills.list") || !health.result?.capabilities?.includes("skills.read") || !health.result?.capabilities?.includes("mcp.connections.list") || !health.result?.capabilities?.includes("mcp.connection.connect") || !health.result?.capabilities?.includes("mcp.connection.revoke") || !health.result?.capabilities?.includes("mcp.tool.call") || !health.result?.capabilities?.includes("persona.discover"))
    throw new Error("runtime.health did not advertise the replacement persistence capabilities.");
  const capacity = await request("system.capacity");
  const reportedSlotLimit = capacity.result?.scheduler?.executionSlotLimit;
  if (!capacity.ok || capacity.result?.scheduler?.activeTaskCount !== 0 || capacity.result?.scheduler?.queuedTaskCount !== 0 || !Number.isInteger(reportedSlotLimit) || reportedSlotLimit < 1)
    throw new Error(`system.capacity did not expose the bounded local scheduler snapshot: ${JSON.stringify(capacity)}`);
  const mcpConnections = await request("mcp.connections.list");
  if (!mcpConnections.ok || !Array.isArray(mcpConnections.result?.connections) || mcpConnections.result.connections.length !== 0)
    throw new Error("mcp.connections.list did not return the isolated empty registry.");
  const skills = await request("skills.list");
  if (!skills.ok || !["product-audit", "project-audit", "release-readiness"].every(id => skills.result?.some(skill => skill.id === id && skill.enabled === true)) || skills.result?.some(skill => skill.id === "reverse-engineer"))
    throw new Error(`skills.list did not expose the requested read-only audit catalog: ${JSON.stringify(skills)}`);
  const skill = await request("skills.read", { id: "product-audit" });
  if (!skill.ok || !String(skill.result?.content ?? "").includes("Audit the selected product experience"))
    throw new Error(`skills.read did not lazily load the selected skill: ${JSON.stringify(skill)}`);
  const airLlm = await request("airllm.status");
  if (!airLlm.ok || airLlm.result?.workerAvailable !== true || typeof airLlm.result?.message !== "string")
    throw new Error(`airllm.status did not report the packaged worker: ${JSON.stringify(airLlm)}`);
  const pullStart = await request("models.pull.start", { endpoint: "http://127.0.0.1:1/v1", model: "smoke-model" });
  if (!pullStart.ok || typeof pullStart.result?.id !== "string") throw new Error("models.pull.start did not create a disposable local operation.");
  let pullStatus;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 100));
    pullStatus = await request("models.pull.status", { id: pullStart.result.id });
    if (["failed", "cancelled", "completed"].includes(pullStatus.result?.status)) break;
  }
  if (!pullStatus?.ok || pullStatus.result?.status !== "failed") throw new Error(`models.pull.status did not recover a closed local endpoint: ${JSON.stringify(pullStatus)}`);
  const recovered = await request("tasks.list");
  const interrupted = recovered.result?.find(task => task.id === interruptedTaskId);
  if (!recovered.ok || interrupted?.status !== "blocked" || !interrupted.resultSummary?.includes("interrupted"))
    throw new Error("Agent Host did not reconcile an interrupted task after restart.");
  const project = await request("project.save", { name: "Git status smoke", folderPaths: [tempRoot] });
  if (!project.ok || typeof project.result?.id !== "string") throw new Error("project.save did not create the Git status smoke project.");
  const terminal = await request("project.terminal.start", { id: project.result.id, relativeWorkingDirectory: ".", columns: 80, rows: 24 });
  if (!terminal.ok || typeof terminal.result?.sessionId !== "string") throw new Error("project.terminal.start did not create a persistent PTY session.");
  const terminalWrite = await request("project.terminal.write", { sessionId: terminal.result.sessionId, text: "echo terminal-smoke\r\n" });
  if (!terminalWrite.ok) throw new Error(`project.terminal.write did not accept input: ${JSON.stringify(terminalWrite)}`);
  // Shell start-up under a PTY can take several seconds on CI runners (PowerShell/ConPTY on Windows),
  // so poll for the echoed output instead of reading once after a fixed delay.
  let terminalRead;
  for (let waited = 0; waited <= 20_000; waited += 500) {
    await new Promise(resolve => setTimeout(resolve, 500));
    terminalRead = await request("project.terminal.read", { sessionId: terminal.result.sessionId });
    if (!terminalRead.ok || String(terminalRead.result?.screen ?? "").toLowerCase().includes("terminal-smoke")) break;
  }
  if (!terminalRead.ok || !String(terminalRead.result?.screen ?? "").toLowerCase().includes("terminal-smoke")) throw new Error(`project.terminal.read did not render the PTY response: ${JSON.stringify(terminalRead)}`);
  const terminalClosed = await request("project.terminal.close", { sessionId: terminal.result.sessionId });
  if (!terminalClosed.ok || terminalClosed.result?.closed !== true) throw new Error("project.terminal.close did not close the persistent session.");
  const gitStatus = await request("project.git.status", { id: project.result.id });
  if (!gitStatus.ok || gitStatus.result?.repository !== "local repository" || typeof gitStatus.result?.branch !== "string" || !Array.isArray(gitStatus.result?.changes))
    throw new Error("project.git.status did not return bounded local Git state.");
  const reviewPath = gitStatus.result.changes[0]?.path;
  if (!reviewPath) throw new Error("project.git.status did not report the disposable repository changes.");
  const diff = await request("project.git.diff", { id: project.result.id, paths: [reviewPath] });
  if (!diff.ok || typeof diff.result?.text !== "string" || diff.result.includedFiles !== 1) throw new Error("project.git.diff did not return the selected local diff.");
  const committed = await request("project.git.commit", { id: project.result.id, paths: [reviewPath], message: "Review local Git smoke" });
  if (!committed.ok || committed.result?.committed !== true) throw new Error("project.git.commit did not create the reviewed local commit.");
  spawnSync("git", ["reset", "--hard", "--quiet", "HEAD"], { cwd: tempRoot, windowsHide: true });
  const remoteRoot = path.join(tempRoot, "..", `${path.basename(tempRoot)}-remote.git`);
  spawnSync("git", ["init", "--bare", "--quiet", remoteRoot], { cwd: tempRoot, windowsHide: true });
  spawnSync("git", ["remote", "add", "origin", remoteRoot], { cwd: tempRoot, windowsHide: true });
  spawnSync("git", ["push", "--quiet", "--set-upstream", "origin", "HEAD"], { cwd: tempRoot, windowsHide: true });
  fs.writeFileSync(path.join(tempRoot, "push-smoke.txt"), "push through configured credential helper\n");
  const pushStatus = await request("project.git.status", { id: project.result.id });
  const pushPath = pushStatus.result?.changes?.find(change => change.path === "push-smoke.txt")?.path;
  if (!pushStatus.ok || !pushPath) throw new Error("project.git.status did not expose the disposable push change.");
  const pushCommit = await request("project.git.commit", { id: project.result.id, paths: [pushPath], message: "Prepare local push smoke" });
  if (!pushCommit.ok || pushCommit.result?.committed !== true) throw new Error("project.git.commit did not prepare the disposable push.");
  spawnSync("git", ["reset", "--hard", "--quiet", "HEAD"], { cwd: tempRoot, windowsHide: true });
  const cleanPushStatus = await request("project.git.status", { id: project.result.id });
  const pushed = await request("project.git.push", { id: project.result.id });
  if (!pushed.ok || pushed.result?.pushed !== true) throw new Error(`project.git.push did not push to the disposable local remote: ${JSON.stringify({ pushed, cleanPushStatus })}`);
  const corpusDocument = await request("corpus.upsert", { title: "Local retrieval smoke", source: "smoke://document", content: "Skai retrieves explicit local documents with bounded snippets.", tags: ["local", "retrieval"] });
  if (!corpusDocument.ok || typeof corpusDocument.result?.id !== "string") throw new Error("corpus.upsert did not persist a local document.");
  const corpusSearch = await request("corpus.search", { query: "bounded snippets" });
  if (!corpusSearch.ok || corpusSearch.result?.[0]?.document?.id !== corpusDocument.result.id || !corpusSearch.result?.[0]?.snippet?.includes("bounded") || corpusSearch.result?.[0]?.retrievalMode !== "hybrid-token-vector" || typeof corpusSearch.result?.[0]?.hybridScore !== "number") throw new Error("corpus.search did not return a matching hybrid bounded snippet.");
  const corpusRemoved = await request("corpus.remove", { id: corpusDocument.result.id });
  if (!corpusRemoved.ok || corpusRemoved.result?.removed !== true) throw new Error("corpus.remove did not remove the local document.");
  const voices = await request("voice.models");
  if (!voices.ok || !Array.isArray(voices.result?.models) || !voices.result.models.some(model => model.id === "os-native" && model.installed))
    throw new Error("voice.models did not advertise the installed OS-native voice engine.");
  const invalidSpeech = await request("voice.speak", { text: "   " });
  if (invalidSpeech.ok) throw new Error("voice.speak accepted empty text.");
  const stoppedVoice = await request("voice.stop");
  if (!stoppedVoice.ok || stoppedVoice.result?.stopped !== true) throw new Error("voice.stop did not acknowledge the idle interruption request.");
  const before = await request("conversations.list");
  if (!before.ok || !Array.isArray(before.result) || before.result.length !== 0)
    throw new Error("Disposable conversation history was not empty.");
  const saved = await request("conversation.save", { title: "Protocol smoke", responseMode: "security", messages: [{ role: "user", content: "hello" }, { role: "assistant", content: "world" }] });
  if (!saved.ok || typeof saved.result?.id !== "string") throw new Error("conversation.save did not return a local identity.");
  const after = await request("conversations.list");
  if (!after.ok || after.result.length !== 1 || after.result[0].title !== "Protocol smoke" || after.result[0].responseMode !== "security") throw new Error("conversation response mode persistence round-trip failed.");
  const persona = await request("persona.save", { persona: { name: "Workshop persona", sourceMode: "own-material", sourceMaterial: "A focused, kind persona used for workflow verification.", personalContinuityEnabled: true } });
  if (!persona.ok || !persona.result?.persona?.id) throw new Error("persona.save did not create a Workshop persona.");
  const personaId = persona.result.persona.id;
  const secondPersona = await request("persona.save", { persona: { name: "Group persona", sourceMode: "own-material", sourceMaterial: "A second group participant." } });
  if (!secondPersona.ok || !secondPersona.result?.persona?.id) throw new Error("persona.save did not create a second group persona.");
  const evidencePersona = await request("persona.save", { persona: { name: "Research character", sourceMode: "public-research", subjectType: "character", sources: [{ title: "Canon source", url: "https://example.org/canon", authorOrPublisher: "Example", publishedDate: "", type: "Canon reference", reliabilityNote: "Smoke test source.", excerpt: "A short evidence chunk." }] } });
  if (!evidencePersona.ok || evidencePersona.result?.persona?.subjectType !== "character") throw new Error("Persona subject type did not persist for fictional characters.");
  const sourceUrl = "https://example.org/canon";
  const removedChunk = await request("persona.source.remove", { personaId: evidencePersona.result.persona.id, url: sourceUrl, removeExcerpt: true });
  // persona.source.remove returns { persona, profileNeedsRebuild }.
  const chunkSources = removedChunk.result?.persona?.sources;
  if (!removedChunk.ok || chunkSources?.length !== 1 || chunkSources[0].excerpt !== "" || removedChunk.result.profileNeedsRebuild !== true) throw new Error("A saved research excerpt could not be removed independently of its source.");
  const removedSource = await request("persona.source.remove", { personaId: evidencePersona.result.persona.id, url: sourceUrl });
  if (!removedSource.ok || removedSource.result?.persona?.sources?.length !== 0) throw new Error("A research source and its remaining chunks could not be removed.");
  await request("persona.remove", { id: evidencePersona.result.persona.id });
  const personaThread = await request("conversation.save", { title: "Persona workshop thread", personaId, messages: [{ role: "user", content: "Keep this inside the workshop." }] });
  const groupThread = await request("conversation.save", { title: "Persona group thread", isPersonaGroup: true, personaIds: [personaId, secondPersona.result.persona.id], messages: [] });
  if (!personaThread.ok || !groupThread.ok) throw new Error("Persona and group conversations could not be saved.");
  const individualModelRequests = [];
  const individualModelServer = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", chunk => { body += chunk; });
    request.on("end", () => {
      individualModelRequests.push(JSON.parse(body));
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end('data: {"choices":[{"delta":{"content":"individual persona smoke reply"}}]}\n\ndata: [DONE]\n\n');
    });
  });
  pendingSmokeServers.add(individualModelServer);
  await new Promise(resolve => individualModelServer.listen(0, "127.0.0.1", resolve));
  const individualPort = individualModelServer.address().port;
  const individualReply = await request("chat.complete", { provider: "Local API", endpoint: `http://127.0.0.1:${individualPort}/v1`, model: "persona-individual-smoke-model", personaId, messages: [{ role: "user", content: "What do you know about this conversation?" }], responseMode: "think" });
  await new Promise(resolve => individualModelServer.close(resolve));
  pendingSmokeServers.delete(individualModelServer);
  if (!individualReply.ok || individualReply.result?.content !== "individual persona smoke reply" || individualModelRequests.length !== 1 || !individualModelRequests[0].messages.some(message => message.role === "system" && message.content.includes("AI simulation of Workshop persona")))
    throw new Error(`chat.complete did not use the selected persona profile: ${JSON.stringify(individualReply)}`);
  const completedPersonaThread = await request("conversation.save", { id: personaThread.result.id, title: "Persona workshop thread", personaId, messages: [{ role: "user", content: "Keep this inside the workshop." }, { role: "user", content: "What do you know about this conversation?" }, { role: "assistant", content: individualReply.result.content }] });
  const savedPersonaThreads = await request("conversations.list", { scope: "persona" });
  if (!completedPersonaThread.ok || !savedPersonaThreads.ok || !savedPersonaThreads.result.some(thread => thread.id === personaThread.result.id && thread.messages.some(message => message.content === "individual persona smoke reply")))
    throw new Error("The individual persona reply did not persist in its Persona Workshop thread.");
  const groupModelRequests = [];
  const groupModelServer = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", chunk => { body += chunk; });
    request.on("end", () => {
      groupModelRequests.push(JSON.parse(body));
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end('data: {"choices":[{"delta":{"content":"persona group smoke reply"}}]}\n\ndata: [DONE]\n\n');
    });
  });
  pendingSmokeServers.add(groupModelServer);
  await new Promise(resolve => groupModelServer.listen(0, "127.0.0.1", resolve));
  const groupPort = groupModelServer.address().port;
  const groupReply = await request("persona.group.complete", { personaIds: [personaId, secondPersona.result.persona.id], messages: [{ role: "user", content: "What should we make together?" }], provider: "Local API", endpoint: `http://127.0.0.1:${groupPort}/v1`, model: "persona-group-smoke-model" });
  await new Promise(resolve => groupModelServer.close(resolve));
  pendingSmokeServers.delete(groupModelServer);
  if (!groupReply.ok || groupReply.result?.turns?.length !== 2 || groupReply.result.turns.some(turn => turn.content !== "persona group smoke reply") || groupReply.result.memoryScope !== "group-only" || groupModelRequests.length !== 2 || groupModelRequests.some(modelRequest => !modelRequest.messages.some(message => message.role === "system" && message.content.includes("AI simulation of"))))
    throw new Error(`persona.group.complete did not produce isolated, labeled replies for each selected persona: ${JSON.stringify(groupReply)}`);
  const standardChats = await request("conversations.list");
  const personaChats = await request("conversations.list", { scope: "persona" });
  if (!standardChats.ok || standardChats.result.some(item => item.id === personaThread.result.id || item.id === groupThread.result.id) || !personaChats.ok || !personaChats.result.some(item => item.id === personaThread.result.id) || !personaChats.result.some(item => item.id === groupThread.result.id)) throw new Error(`Persona conversations were not isolated from standard chat history: standard=${JSON.stringify(standardChats.result)}, persona=${JSON.stringify(personaChats.result)}`);
  const memoryList = await request("persona.memory.list", { id: personaId });
  if (!memoryList.ok || memoryList.result.enabled !== true || !Array.isArray(memoryList.result.turns)) throw new Error("persona.memory.list did not return local persona continuity.");
  const memoryClear = await request("persona.memory.clear", { id: personaId });
  const memoryAfterClear = await request("persona.memory.list", { id: personaId });
  if (!memoryClear.ok || memoryClear.result.cleared !== true || !memoryAfterClear.ok || memoryAfterClear.result.turns.length !== 0) throw new Error("Persona memory clear did not persist.");
  const removedPersona = await request("persona.remove", { id: personaId });
  const remainingPersonas = await request("persona.list");
  const repeatedRemoval = await request("persona.remove", { id: personaId });
  if (!removedPersona.ok || removedPersona.result?.removed !== true || !remainingPersonas.ok || remainingPersonas.result?.personas?.some(item => item.id === personaId) || !repeatedRemoval.ok || repeatedRemoval.result?.removed !== false)
    throw new Error("persona.remove did not persist the deletion or report an already-removed persona accurately.");
  await request("persona.remove", { id: secondPersona.result.persona.id });
  const changedMode = await request("conversation.metadata.save", { id: saved.result.id, responseMode: "coding" });
  if (!changedMode.ok) throw new Error("conversation.metadata.save could not change response mode.");
  const forkedMode = await request("conversation.fork", { id: saved.result.id });
  const forkedList = await request("conversations.list");
  if (!forkedMode.ok || !forkedList.ok || forkedList.result.find(item => item.id === forkedMode.result.id)?.responseMode !== "coding") throw new Error("conversation fork did not preserve response mode.");
  const invalidMode = await request("conversation.metadata.save", { id: saved.result.id, responseMode: "automatic-classifier" });
  if (invalidMode.ok) throw new Error("conversation metadata accepted an unsupported response mode.");
  const settings = await request("settings.get");
  if (!settings.ok || typeof settings.result?.endpoint !== "string") throw new Error("settings.get did not return bounded settings.");
  const savedSettings = await request("settings.save", { endpoint: settings.result.endpoint, model: settings.result.model });
  if (!savedSettings.ok) throw new Error("settings.save failed in the disposable profile.");
  const remoteSettings = await request("settings.save", { endpoint: "https://api.example.invalid/v1", model: "remote-model", provider: "Hosted compatible" });
  if (remoteSettings.ok || !remoteSettings.error?.message.includes("local loopback")) throw new Error("settings.save accepted a non-local model endpoint.");
  const restoredSettings = await request("settings.save", { endpoint: settings.result.endpoint, model: settings.result.model, provider: "Ollama" });
  if (!restoredSettings.ok) throw new Error("settings.save could not restore the disposable local profile.");
  const planned = await request("tasks.plan", { title: "Protocol smoke task", instruction: "Review the local task workflow.", environment: "local", responseMode: "security" });
  if (!planned.ok || planned.result?.status !== "proposed") throw new Error("tasks.plan did not create a proposed local task.");
  const approvalTask = await request("tasks.plan", { title: "Approval smoke task", instruction: "Wait for explicit approval.", environment: "local", requiresApproval: true });
  if (!approvalTask.ok || approvalTask.result?.status !== "proposed" || approvalTask.result?.requiresApproval !== true) throw new Error("tasks.plan did not persist the approval requirement.");
  const queuedApproval = await request("tasks.queue", { id: approvalTask.result.id });
  if (!queuedApproval.ok || queuedApproval.result?.status !== "awaiting_approval") throw new Error("tasks.queue did not stop at the approval gate.");
  const approved = await request("tasks.approve", { id: approvalTask.result.id });
  if (!approved.ok || approved.result?.status !== "queued") throw new Error("tasks.approve did not release the task to the local queue.");
  const tasks = await request("tasks.list");
  const plannedTask = tasks.result?.find(task => task.id === planned.result.id);
  const approvalListed = tasks.result?.find(task => task.id === approvalTask.result.id);
  if (!tasks.ok || plannedTask?.title !== "Protocol smoke task" || plannedTask.instruction !== "Review the local task workflow." || plannedTask.responseMode !== "security" || !Array.isArray(plannedTask.artifactLabels) || approvalListed?.requiresApproval !== true) throw new Error("tasks.list did not preserve the task review metadata.");
  const queued = await request("tasks.queue", { id: planned.result.id });
  if (!queued.ok || queued.result?.status !== "queued") throw new Error("tasks.queue did not queue the local task.");
  const isolatedModelSettings = await request("settings.save", { endpoint: "http://127.0.0.1:1/v1", model: "protocol-smoke-model", provider: "Local API" });
  if (!isolatedModelSettings.ok) throw new Error("settings.save could not prepare the isolated task execution endpoint.");
  const execution = await request("tasks.execute", { id: planned.result.id });
  if (!execution.ok || execution.result?.id !== planned.result.id || !["running", "queued", "failed"].includes(execution.result?.status)) throw new Error(`tasks.execute did not start a background local execution: ${JSON.stringify(execution)}`);
  let terminalTask = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 100));
    const snapshot = await request("tasks.list");
    if (!snapshot.ok) throw new Error("tasks.list failed while observing local execution.");
    terminalTask = snapshot.result.find(item => item.id === planned.result.id) ?? null;
    if (terminalTask && ["completed", "failed", "cancelled", "blocked"].includes(terminalTask.status)) break;
  }
  if (!terminalTask || terminalTask.status !== "failed" || !terminalTask.resultSummary) throw new Error(`tasks.execute did not persist a terminal local-model failure: ${JSON.stringify(terminalTask)}`);
  let queueRequests = 0;
  let activeQueueRequests = 0;
  let maxActiveQueueRequests = 0;
  let fencedActionServed = false;
  let nativeToolRequests = 0;
  const nativeToolRequestBodies = [];
  let repairAttempts = 0;
  const repairRequestBodies = [];
  let exhaustedRepairAttempts = 0;
  const exhaustedRepairRequestBodies = [];
  const queueRequestBodies = [];
  const queueModelServer = http.createServer((request, response) => {
    let body = "";
    let requestNumber = 0;
    request.setEncoding("utf8");
    request.on("data", chunk => { body += chunk; });
    request.on("end", () => {
      if (request.method === "POST" && body.length > 0 && request.url === "/api/chat") {
        nativeToolRequests += 1;
        nativeToolRequestBodies.push(body.slice(0, 12000));
      } else if (request.method === "POST" && body.length > 0) {
        requestNumber = ++queueRequests;
        activeQueueRequests += 1;
        maxActiveQueueRequests = Math.max(maxActiveQueueRequests, activeQueueRequests);
        if (body.includes("malformed action JSON repair smoke")) {
          repairAttempts += 1;
          repairRequestBodies.push(body.slice(0, 12000));
        }
        if (body.includes("exhausted action JSON repair smoke")) {
          exhaustedRepairAttempts += 1;
          exhaustedRepairRequestBodies.push(body.slice(0, 12000));
        }
      }
      queueRequestBodies.push(body.slice(0, 1200));
      setTimeout(() => {
        if (request.url === "/api/chat") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ message: { role: "assistant", content: "", tool_calls: [{ id: "native-smoke-done", type: "function", function: { name: "done", arguments: { summary: "Native Ollama tool task completed." } } }] }, done: true }));
          return;
        }
        response.writeHead(200, { "content-type": "text/event-stream" });
        const action = JSON.stringify({ action: "done", summary: "Queued smoke task completed." });
        if (requestNumber === 1) fencedActionServed = true;
        const content = (body.includes("malformed action JSON repair smoke") && repairAttempts === 1)
          || body.includes("exhausted action JSON repair smoke")
          ? "```json\n{\"action\":\"done\",\"summary\": }\n```"
          : requestNumber === 1 ? `\`\`\`json\n${action}\n\`\`\`` : action;
        response.end(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`);
        if (request.method === "POST" && body.length > 0) activeQueueRequests -= 1;
      }, 750);
    });
  });
  pendingSmokeServers.add(queueModelServer);
  await new Promise(resolve => queueModelServer.listen(0, "127.0.0.1", resolve));
  const queueModelPort = queueModelServer.address().port;
  // Keep this fixture's capacity decision stable even if host CPU/RAM telemetry
  // changes while the two queued tasks are waiting for their execution slot.
  const queueSettings = await request("settings.save", { endpoint: `http://127.0.0.1:${queueModelPort}/v1`, model: "queue-smoke-model", provider: "Local API", localRamBudgetBytes: 1024 * 1024 * 1024 });
  if (!queueSettings.ok) throw new Error("settings.save could not prepare the queued task smoke endpoint.");
  const firstQueued = await request("tasks.plan", { title: "First queued task", instruction: "Complete the first queued smoke task.", environment: "local" });
  const secondQueued = await request("tasks.plan", { title: "Second queued task", instruction: "Complete the second queued smoke task.", environment: "local" });
  if (!firstQueued.ok || !secondQueued.ok) throw new Error("tasks.plan could not create the queued task pair.");
  for (const task of [firstQueued, secondQueued]) {
    const queuedTask = await request("tasks.queue", { id: task.result.id });
    if (!queuedTask.ok || queuedTask.result?.status !== "queued") throw new Error("tasks.queue did not queue the task pair.");
  }
  const firstExecution = await request("tasks.execute", { id: firstQueued.result.id });
  const secondExecution = await request("tasks.execute", { id: secondQueued.result.id });
  if (!firstExecution.ok || !["running", "queued"].includes(firstExecution.result?.status)) throw new Error(`First queued task did not enter the local scheduler: ${JSON.stringify(firstExecution)}`);
  if (!secondExecution.ok || !["running", "queued"].includes(secondExecution.result?.status)) throw new Error(`Second queued task did not enter the local scheduler: ${JSON.stringify(secondExecution)}`);
  let firstTerminal = null;
  let secondTerminal = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 100));
    const snapshot = await request("tasks.list");
    if (!snapshot.ok) throw new Error("tasks.list failed while observing queued task dispatch.");
    firstTerminal = snapshot.result.find(item => item.id === firstQueued.result.id) ?? null;
    secondTerminal = snapshot.result.find(item => item.id === secondQueued.result.id) ?? null;
    if ([firstTerminal, secondTerminal].every(task => task && ["completed", "failed", "cancelled", "blocked"].includes(task.status))) break;
  }
  if (!firstTerminal || firstTerminal.status !== "completed" || !secondTerminal || secondTerminal.status !== "completed" || queueRequests !== 2 || !fencedActionServed || maxActiveQueueRequests < 1 || maxActiveQueueRequests > reportedSlotLimit)
    throw new Error(`Queued task dispatch or fenced-action recovery failed: ${JSON.stringify({ firstTerminal, secondTerminal, queueRequests, fencedActionServed, maxActiveQueueRequests, reportedSlotLimit, queueRequestBodies })}`);
  const ollamaSettings = await request("settings.save", { endpoint: `http://127.0.0.1:${queueModelPort}/v1`, model: "native-tools-smoke-model", provider: "Ollama" });
  if (!ollamaSettings.ok) throw new Error("settings.save could not prepare the native Ollama tool smoke endpoint.");
  const nativeToolTask = await request("tasks.plan", { title: "Native Ollama tools", instruction: "Review the local task workflow.", environment: "local", projectId: project.result.id });
  if (!nativeToolTask.ok) throw new Error(`tasks.plan could not create the native Ollama tool task: ${JSON.stringify(nativeToolTask)}`);
  const nativeToolQueued = await request("tasks.queue", { id: nativeToolTask.result.id });
  if (!nativeToolQueued.ok || nativeToolQueued.result?.status !== "queued") throw new Error("tasks.queue could not queue the native Ollama tool task.");
  const nativeToolExecution = await request("tasks.execute", { id: nativeToolTask.result.id });
  if (!nativeToolExecution.ok) throw new Error(`tasks.execute could not start native Ollama tool execution: ${JSON.stringify(nativeToolExecution)}`);
  let nativeToolTerminal = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 100));
    const snapshot = await request("tasks.list");
    if (!snapshot.ok) throw new Error("tasks.list failed while observing native Ollama tool execution.");
    nativeToolTerminal = snapshot.result.find(item => item.id === nativeToolTask.result.id) ?? null;
    if (nativeToolTerminal && ["completed", "failed", "cancelled", "blocked"].includes(nativeToolTerminal.status)) break;
  }
  const nativeToolPayload = nativeToolRequestBodies.length === 1 ? JSON.parse(nativeToolRequestBodies[0]) : null;
  if (!nativeToolTerminal || nativeToolTerminal.status !== "completed" || nativeToolRequests !== 1 || nativeToolPayload?.model !== "native-tools-smoke-model" || !nativeToolPayload?.tools?.some(tool => tool.function?.name === "replace_text"))
    throw new Error(`Native Ollama coding tools did not complete with the expected local tool schema: ${JSON.stringify({ nativeToolTerminal, nativeToolRequests, nativeToolPayload })}`);
  let steeringFirstRequestReceived;
  const steeringFirstRequest = new Promise(resolve => { steeringFirstRequestReceived = resolve; });
  const steeringRequestBodies = [];
  let steeringFollowUpObserved = false;
  let releaseFirstSteeringResponse = null;
  const steeringServer = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", chunk => { body += chunk; });
    request.on("end", () => {
      if (!request.url?.endsWith("/chat/completions")) { response.writeHead(404).end(); return; }
      steeringRequestBodies.push(body);
      if (steeringRequestBodies.length === 1) {
        response.writeHead(200, { "content-type": "text/event-stream" });
        releaseFirstSteeringResponse = () => response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify({ action: "done", summary: "Initial task result." }) } }] })}\n\ndata: [DONE]\n\n`);
        steeringFirstRequestReceived();
        return;
      }
      if (steeringRequestBodies.length > 1 && body.includes("USER FOLLOW-UP #1") && body.includes("Keep the retry behavior compatible with 3.11")) steeringFollowUpObserved = true;
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify({ action: "done", summary: "Applied the live task follow-up." }) } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  pendingSmokeServers.add(steeringServer);
  await new Promise(resolve => steeringServer.listen(0, "127.0.0.1", resolve));
  const steeringSettings = await request("settings.save", { endpoint: `http://127.0.0.1:${steeringServer.address().port}/v1`, model: "steering-smoke-model", provider: "Local API" });
  if (!steeringSettings.ok) throw new Error("settings.save could not prepare the live task steering fixture.");
  const steeringTask = await request("tasks.plan", { title: "Live task steering", instruction: "Wait for a user follow-up before completing.", environment: "local", projectId: project.result.id, model: "steering-smoke-model", modelProvider: "Local API" });
  if (!steeringTask.ok) throw new Error(`Could not plan the live task steering fixture: ${JSON.stringify(steeringTask)}`);
  const steeringQueued = await request("tasks.queue", { id: steeringTask.result.id });
  if (!steeringQueued.ok) throw new Error("Could not queue the live task steering fixture.");
  const steeringExecution = await request("tasks.execute", { id: steeringTask.result.id });
  if (!steeringExecution.ok) throw new Error(`Could not start the live task steering fixture: ${JSON.stringify(steeringExecution)}`);
  await Promise.race([steeringFirstRequest, new Promise((_, reject) => setTimeout(() => reject(new Error("The live task steering model request did not start.")), 10_000))]);
  const steered = await request("tasks.steer", { id: steeringTask.result.id, instruction: "Keep the retry behavior compatible with 3.11." });
  if (!steered.ok || steered.result?.followUpInstructions?.length !== 1) throw new Error(`The host did not persist a live task follow-up: ${JSON.stringify(steered)}`);
  releaseFirstSteeringResponse?.();
  let steeredTerminal = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 100));
    const snapshot = await request("tasks.list");
    if (!snapshot.ok) throw new Error("tasks.list failed while observing live task steering.");
    steeredTerminal = snapshot.result.find(item => item.id === steeringTask.result.id) ?? null;
    if (steeredTerminal && ["completed", "failed", "cancelled", "blocked"].includes(steeredTerminal.status)) break;
  }
  await new Promise(resolve => steeringServer.close(resolve));
  pendingSmokeServers.delete(steeringServer);
  if (steeredTerminal?.status !== "completed" || !steeringFollowUpObserved || !steeredTerminal.activity?.some(item => item.type === "task.follow_up_applied"))
    throw new Error(`The coding agent did not apply a live follow-up before completion: ${JSON.stringify({ status: steeredTerminal?.status, steeringFollowUpObserved, followUpEvents: steeredTerminal?.activity?.filter(item => item.type.includes("follow_up")) })}`);
  const repairSettings = await request("settings.save", { endpoint: `http://127.0.0.1:${queueModelPort}/v1`, model: "action-repair-smoke-model", provider: "Local API" });
  if (!repairSettings.ok) throw new Error("settings.save could not prepare the malformed-action repair smoke endpoint.");
  const repairTask = await request("tasks.plan", { title: "Malformed action repair", instruction: "Complete the malformed action JSON repair smoke.", environment: "local" });
  if (!repairTask.ok) throw new Error(`tasks.plan could not create the malformed-action repair task: ${JSON.stringify(repairTask)}`);
  const repairQueued = await request("tasks.queue", { id: repairTask.result.id });
  if (!repairQueued.ok || repairQueued.result?.status !== "queued") throw new Error("tasks.queue could not queue the malformed-action repair task.");
  const repairExecution = await request("tasks.execute", { id: repairTask.result.id });
  if (!repairExecution.ok) throw new Error(`tasks.execute could not start malformed-action repair: ${JSON.stringify(repairExecution)}`);
  let repairTerminal = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 100));
    const snapshot = await request("tasks.list");
    if (!snapshot.ok) throw new Error("tasks.list failed while observing malformed-action repair.");
    repairTerminal = snapshot.result.find(item => item.id === repairTask.result.id) ?? null;
    if (repairTerminal && ["completed", "failed", "cancelled", "blocked"].includes(repairTerminal.status)) break;
  }
  const repairFollowup = repairRequestBodies[1] ? JSON.parse(repairRequestBodies[1]) : null;
  if (repairTerminal?.status !== "completed" || repairAttempts !== 2 || !repairFollowup?.messages?.some(message => typeof message.content === "string" && message.content.includes("Repeat the action as one valid JSON object"))) {
    throw new Error(`Coding Agent did not repair one malformed local action within its retry budget: ${JSON.stringify({ repairTerminal, repairAttempts, repairFollowup })}`);
  }
  const exhaustedRepairTask = await request("tasks.plan", { title: "Bounded action repair", instruction: "Complete the exhausted action JSON repair smoke.", environment: "local" });
  if (!exhaustedRepairTask.ok) throw new Error(`tasks.plan could not create the bounded repair task: ${JSON.stringify(exhaustedRepairTask)}`);
  const exhaustedRepairQueued = await request("tasks.queue", { id: exhaustedRepairTask.result.id });
  if (!exhaustedRepairQueued.ok || exhaustedRepairQueued.result?.status !== "queued") throw new Error("tasks.queue could not queue the bounded repair task.");
  const exhaustedRepairExecution = await request("tasks.execute", { id: exhaustedRepairTask.result.id });
  if (!exhaustedRepairExecution.ok) throw new Error(`tasks.execute could not start bounded repair: ${JSON.stringify(exhaustedRepairExecution)}`);
  let exhaustedRepairTerminal = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 100));
    const snapshot = await request("tasks.list");
    if (!snapshot.ok) throw new Error("tasks.list failed while observing the bounded repair task.");
    exhaustedRepairTerminal = snapshot.result.find(item => item.id === exhaustedRepairTask.result.id) ?? null;
    if (exhaustedRepairTerminal && ["completed", "failed", "cancelled", "blocked"].includes(exhaustedRepairTerminal.status)) break;
  }
  const finalRepairRequest = exhaustedRepairRequestBodies[3] ? JSON.parse(exhaustedRepairRequestBodies[3]) : null;
  const repairGuidanceCount = finalRepairRequest?.messages?.filter(message => typeof message.content === "string" && message.content.includes("Repeat the action as one valid JSON object")).length ?? 0;
  if (exhaustedRepairTerminal?.status !== "failed" || exhaustedRepairAttempts !== 4 || repairGuidanceCount !== 3 || !exhaustedRepairTerminal.resultSummary?.includes("after three repair attempts")) {
    throw new Error(`Coding Agent did not stop after exactly three malformed-action repairs: ${JSON.stringify({ exhaustedRepairTerminal, exhaustedRepairAttempts, repairGuidanceCount })}`);
  }
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const capacitySnapshot = await request("system.capacity");
    if (capacitySnapshot.ok && capacitySnapshot.result?.scheduler?.activeTaskCount === 0 && capacitySnapshot.result?.scheduler?.queuedTaskCount === 0) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  // Use an intentionally large model estimate so this pair exercises the
  // single-slot cancellation path even on hosts with room for multiple small
  // local runs.
  const cancellationModelSizeBytes = 60 * 1024 * 1024 * 1024;
  const cancellationLeader = await request("tasks.plan", { title: "Cancellation leader", instruction: "Keep the local slot occupied briefly.", environment: "local", modelSizeBytes: cancellationModelSizeBytes });
  const cancellationWaiter = await request("tasks.plan", { title: "Cancellation waiter", instruction: "Cancel while waiting for the local slot.", environment: "local", modelSizeBytes: cancellationModelSizeBytes });
  for (const task of [cancellationLeader, cancellationWaiter]) {
    const queuedTask = await request("tasks.queue", { id: task.result.id });
    if (!queuedTask.ok || queuedTask.result?.status !== "queued") throw new Error("tasks.queue did not queue the cancellation pair.");
  }
  const requestsBeforeCancellation = queueRequests;
  const leaderExecution = await request("tasks.execute", { id: cancellationLeader.result.id });
  for (let attempt = 0; attempt < 30 && queueRequests < requestsBeforeCancellation + 1; attempt += 1) await new Promise(resolve => setTimeout(resolve, 100));
  const waiterExecution = await request("tasks.execute", { id: cancellationWaiter.result.id });
  if (!leaderExecution.ok || !waiterExecution.ok || waiterExecution.result?.status !== "queued") throw new Error("The cancellation waiter did not enter the local queue.");
  const waiterCancelled = await request("tasks.cancel", { id: cancellationWaiter.result.id });
  if (!waiterCancelled.ok || waiterCancelled.result?.status !== "queued" || waiterCancelled.result?.cancellationRequested !== true) throw new Error(`Queued task cancellation was not acknowledged: ${JSON.stringify(waiterCancelled)}`);
  let cancelledTask = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 100));
    const snapshot = await request("tasks.list");
    if (!snapshot.ok) throw new Error("tasks.list failed while observing queued cancellation.");
    cancelledTask = snapshot.result.find(item => item.id === cancellationWaiter.result.id) ?? null;
    if (cancelledTask?.status === "cancelled") break;
  }
  await new Promise(resolve => queueModelServer.close(resolve));
  pendingSmokeServers.delete(queueModelServer);
  if (!cancelledTask || cancelledTask.status !== "cancelled" || queueRequests !== requestsBeforeCancellation + 1)
    throw new Error(`Queued task cancellation did not stop the waiting task before execution: ${JSON.stringify({ cancelledTask, queueRequests, requestsBeforeCancellation })}`);
  let heldModelRequestReceived = false;
  let resolveHeldModelRequestClosed;
  const heldModelRequestClosed = new Promise(resolve => { resolveHeldModelRequestClosed = resolve; });
  const heldModelServer = http.createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      heldModelRequestReceived = true;
      response.once("close", resolveHeldModelRequestClosed);
    });
  });
  pendingSmokeServers.add(heldModelServer);
  await new Promise(resolve => heldModelServer.listen(0, "127.0.0.1", resolve));
  const heldModelSettings = await request("settings.save", { endpoint: `http://127.0.0.1:${heldModelServer.address().port}/v1`, model: "held-model-smoke", provider: "Ollama" });
  if (!heldModelSettings.ok) throw new Error("settings.save could not prepare the held-model cancellation endpoint.");
  const heldModelTask = await request("tasks.plan", { title: "Running cancellation smoke", instruction: "Wait for the held local model request to be cancelled." });
  if (!heldModelTask.ok || !heldModelTask.result?.id) throw new Error(`Could not plan the held-model cancellation task: ${JSON.stringify(heldModelTask)}`);
  const heldModelQueued = await request("tasks.queue", { id: heldModelTask.result.id });
  if (!heldModelQueued.ok) throw new Error(`Could not queue the held-model cancellation task: ${JSON.stringify(heldModelQueued)}`);
  const heldModelExecution = await request("tasks.execute", { id: heldModelTask.result.id });
  if (!heldModelExecution.ok) throw new Error(`Could not execute the held-model cancellation task: ${JSON.stringify(heldModelExecution)}`);
  for (let attempt = 0; attempt < 100 && !heldModelRequestReceived; attempt += 1) await new Promise(resolve => setTimeout(resolve, 50));
  if (!heldModelRequestReceived) throw new Error("The held-model cancellation fixture never received a model request.");
  const runningCancellation = await request("tasks.cancel", { id: heldModelTask.result.id });
  if (!runningCancellation.ok || runningCancellation.result?.cancellationRequested !== true) throw new Error(`Running cancellation was not acknowledged: ${JSON.stringify(runningCancellation)}`);
  let heldModelTerminal = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 50));
    const snapshot = await request("tasks.list");
    heldModelTerminal = snapshot.result?.find(item => item.id === heldModelTask.result.id) ?? null;
    if (heldModelTerminal && ["cancelled", "failed", "completed"].includes(heldModelTerminal.status)) break;
  }
  await Promise.race([heldModelRequestClosed, new Promise((_, reject) => setTimeout(() => reject(new Error("Cancellation left the held model HTTP request open.")), 5_000))]);
  await new Promise(resolve => heldModelServer.close(resolve));
  pendingSmokeServers.delete(heldModelServer);
  if (heldModelTerminal?.status !== "cancelled") throw new Error(`Running cancellation did not reach its terminal state: ${JSON.stringify(heldModelTerminal)}`);
  const rejectedEnvironment = await request("tasks.plan", { title: "Unsupported environment", instruction: "Must be rejected.", environment: "remote-host" });
  if (rejectedEnvironment.ok || !rejectedEnvironment.error?.message.includes("Choose Local or isolated worktree")) throw new Error("tasks.plan accepted an unsupported environment.");
  const missingWorktreeProject = await request("tasks.plan", { title: "Missing worktree project", instruction: "Must be rejected.", environment: "worktree" });
  if (missingWorktreeProject.ok || !missingWorktreeProject.error?.message.includes("need one existing project folder")) throw new Error("tasks.plan accepted an isolated worktree without a selected project.");
  const worktreePlan = await request("tasks.plan", { title: "Isolated worktree plan", instruction: "Verify the isolated environment selection.", environment: "worktree", projectId: project.result.id });
  if (!worktreePlan.ok || worktreePlan.result?.environment !== "worktree" || worktreePlan.result?.projectId !== project.result.id)
    throw new Error(`tasks.plan did not preserve the isolated worktree and project selection: ${JSON.stringify(worktreePlan)}`);
  const worktreePlanList = await request("tasks.list");
  const persistedWorktreePlan = worktreePlanList.result?.find(task => task.id === worktreePlan.result.id);
  if (!worktreePlanList.ok || persistedWorktreePlan?.environment !== "worktree" || persistedWorktreePlan?.projectId !== project.result.id)
    throw new Error(`tasks.list did not preserve the isolated worktree plan: ${JSON.stringify(persistedWorktreePlan)}`);
  const delegationParent = await request("tasks.plan", { title: "Manual delegation smoke", instruction: "Coordinate two independent review tasks.", environment: "local", projectId: project.result.id });
  if (!delegationParent.ok) throw new Error(`Could not create the manual delegation parent: ${JSON.stringify(delegationParent)}`);
  const queuedDelegationParent = await request("tasks.queue", { id: delegationParent.result.id });
  if (!queuedDelegationParent.ok) throw new Error(`Could not queue the manual delegation parent: ${JSON.stringify(queuedDelegationParent)}`);
  const delegatedWorkers = await request("tasks.delegate", { parentId: delegationParent.result.id, workers: [
    { title: "Review reliability", instruction: "Inspect failure recovery behavior and report concrete findings.", role: "reviewer" },
    { title: "Review accessibility", instruction: "Inspect keyboard and screen reader behavior and report concrete findings.", role: "verifier" },
  ] });
  if (!delegatedWorkers.ok || delegatedWorkers.result?.length !== 2) throw new Error(`The host did not create the requested specialist tasks: ${JSON.stringify(delegatedWorkers)}`);
  const delegationSnapshot = await request("tasks.list");
  const persistedWorkers = delegationSnapshot.result?.filter(task => task.parentRunId === delegationParent.result.id) ?? [];
  if (!delegationSnapshot.ok || persistedWorkers.length !== 2 || persistedWorkers.some(task => task.status !== "proposed") || !persistedWorkers.some(task => task.role === "reviewer") || !persistedWorkers.some(task => task.role === "verifier"))
    throw new Error(`Manual specialist tasks were not persisted as reviewable proposed work: ${JSON.stringify(persistedWorkers)}`);
  const retainedCleanWorktree = attachSmokeWorktree(worktreePlan.result.id);
  const releasedWorktree = await request("tasks.worktree.release", { id: worktreePlan.result.id });
  if (!releasedWorktree.ok || releasedWorktree.result?.worktreePath !== null || fs.existsSync(retainedCleanWorktree.worktreePath))
    throw new Error(`The host did not release a clean retained worktree: ${JSON.stringify(releasedWorktree)}`);
  const dirtyWorktreePlan = await request("tasks.plan", { title: "Dirty worktree protection", instruction: "Keep uncommitted work safe.", environment: "worktree", projectId: project.result.id });
  if (!dirtyWorktreePlan.ok) throw new Error(`Could not plan the dirty worktree release fixture: ${JSON.stringify(dirtyWorktreePlan)}`);
  const retainedDirtyWorktree = attachSmokeWorktree(dirtyWorktreePlan.result.id, true);
  const refusedDirtyRelease = await request("tasks.worktree.release", { id: dirtyWorktreePlan.result.id });
  const dirtyStillExists = fs.existsSync(path.join(retainedDirtyWorktree.worktreePath, "uncommitted-smoke.txt"));
  if (refusedDirtyRelease.ok || !refusedDirtyRelease.error?.message.includes("uncommitted changes") || !dirtyStillExists)
    throw new Error(`The host did not preserve uncommitted work when refusing release: ${JSON.stringify({ refusedDirtyRelease, dirtyStillExists })}`);
  fs.rmSync(path.join(retainedDirtyWorktree.worktreePath, "uncommitted-smoke.txt"), { force: true });
  const releasedCleanAfterReview = await request("tasks.worktree.release", { id: dirtyWorktreePlan.result.id });
  if (!releasedCleanAfterReview.ok || fs.existsSync(retainedDirtyWorktree.worktreePath))
    throw new Error(`The reviewed clean worktree could not be released: ${JSON.stringify(releasedCleanAfterReview)}`);
  let scheduledRequests = 0;
  const scheduledModelServer = http.createServer((request, response) => {
    scheduledRequests += 1;
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end('data: {"choices":[{"delta":{"content":"scheduled smoke reply"}}]}\n\ndata: [DONE]\n\n');
  });
  pendingSmokeServers.add(scheduledModelServer);
  await new Promise(resolve => scheduledModelServer.listen(0, "127.0.0.1", resolve));
  const scheduledPort = scheduledModelServer.address().port;
  const scheduledSettings = await request("settings.save", { endpoint: `http://127.0.0.1:${scheduledPort}/v1`, model: "scheduled-smoke-model", provider: "Ollama" });
  if (!scheduledSettings.ok) throw new Error("settings.save could not prepare the unattended scheduler endpoint.");
  const scheduled = await request("scheduled.create", { prompt: "Run the local review", dueAt: new Date(Date.now() + 60_000).toISOString(), repeatEveryMinutes: 1 });
  if (!scheduled.ok || scheduled.result?.status !== "scheduled") throw new Error("scheduled.create did not persist a scheduled run.");
  const runNow = await request("scheduled.runNow", { id: scheduled.result.id });
  if (!runNow.ok || runNow.result?.id !== scheduled.result.id) throw new Error("scheduled.runNow did not update the scheduled run.");
  let completedScheduled = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 100));
    const snapshot = await request("scheduled.list");
    completedScheduled = snapshot.result?.find(item => item.id === scheduled.result.id) ?? null;
    if (completedScheduled?.status === "scheduled" && completedScheduled.outcome?.includes("scheduled smoke reply")) break;
  }
  if (!completedScheduled || completedScheduled.status !== "scheduled" || !completedScheduled.outcome?.includes("scheduled smoke reply") || scheduledRequests !== 1)
    throw new Error(`Unattended scheduled execution did not complete and reschedule exactly once: ${JSON.stringify({ completedScheduled, scheduledRequests })}`);
  const paused = await request("scheduled.pause", { id: scheduled.result.id });
  if (!paused.ok || paused.result?.status !== "paused") throw new Error("scheduled.pause did not pause the scheduled run.");
  const resumed = await request("scheduled.resume", { id: scheduled.result.id });
  if (!resumed.ok || resumed.result?.status !== "scheduled") throw new Error("scheduled.resume did not resume the scheduled run.");
  const cancelled = await request("scheduled.cancel", { id: scheduled.result.id });
  if (!cancelled.ok || cancelled.result?.status !== "cancelled") throw new Error("scheduled.cancel did not cancel the scheduled run.");
  await new Promise(resolve => scheduledModelServer.close(resolve));
  pendingSmokeServers.delete(scheduledModelServer);
  console.log("Agent host replacement smoke passed: health, voice protocol, disposable conversation/settings persistence, persona and group conversations, live task steering, explicit specialist delegation, task cancellation, isolated-worktree planning and guarded release, scheduled automation lifecycle, and direct host lifecycle.");
}

async function stopHost() {
  if (!child.stdin.destroyed) child.stdin.end();
  if (child.exitCode === null) {
    await new Promise(resolve => {
      const timeout = setTimeout(() => {
        if (child.exitCode !== null) return;
        if (process.platform === "win32" && child.pid) {
          const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
          killer.once("error", () => { if (!child.killed) child.kill(); });
        } else if (!child.killed) child.kill("SIGTERM");
      }, 1500);
      child.once("exit", () => { clearTimeout(timeout); resolve(); });
    });
  }
  reader.close();
  for (const worktreePath of smokeWorktreePaths) {
    const removed = spawnSync("git", ["worktree", "remove", "--force", "--", worktreePath], { cwd: tempRoot, stdio: "ignore", windowsHide: true });
    if (removed.status !== 0 && fs.existsSync(worktreePath)) fs.rmSync(worktreePath, { recursive: true, force: true });
  }
  fs.rmSync(tempRoot, { recursive: true, force: true });
  if (child.exitCode !== 0) throw new Error("The direct Agent Host did not exit cleanly after the smoke test.");
}

async function main() {
  try {
    await run();
  } catch (error) {
    console.error(error.message);
    if (stderr.trim()) console.error(stderr.trim());
    process.exitCode = 1;
  }
  try {
    await stopHost();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
  for (const server of pendingSmokeServers) {
    server.closeAllConnections?.();
    if (server.listening) server.close();
  }
}

void main();
