#!/usr/bin/env node

/* Exercises Coding Agent approval and append-only task activity using a
 * disposable host profile, project, and local mock model server. */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const http = require("node:http");
const readline = require("node:readline");
const { ensureSmokeAgentHostBuild } = require("./smoke-agent-host-build.cjs");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skai-task-journal-smoke-"));
const profile = path.join(tempRoot, "profile");
const workspace = path.join(tempRoot, "workspace");
fs.mkdirSync(profile, { recursive: true });
fs.mkdirSync(workspace, { recursive: true });
fs.writeFileSync(path.join(workspace, "README.md"), "journal read fixture\n");
fs.writeFileSync(path.join(workspace, "package.json"), JSON.stringify({ scripts: { build: "node build.js", test: "node test.js" } }, null, 2));
const env = {
  ...process.env,
  SKAI_SKIP_LEGACY_DATA_MIGRATION: "true",
  SRAI_SETTINGS_PATH: path.join(profile, "settings.json"),
  SRAI_TASKS_PATH: path.join(profile, "tasks.json"),
  SRAI_OPERATIONS_PATH: path.join(profile, "operations.json"),
  SRAI_PROJECTS_PATH: path.join(profile, "projects.json"),
  SRAI_UNDO_PATH: path.join(profile, "undo.json"),
};
let modelCalls = 0;
let stallModel = false;
const modelServer = http.createServer((request, response) => {
  let body = "";
  request.setEncoding("utf8");
  request.on("data", chunk => { body += chunk; });
  request.on("end", () => {
    if (request.url !== "/v1/chat/completions") { response.writeHead(404).end(); return; }
    JSON.parse(body);
    modelCalls++;
    if (stallModel) return;
    const content = modelCalls === 1
      ? JSON.stringify({ action: "read_file", path: "README.md" })
      : JSON.stringify({ action: "done", summary: "Read the local project note." });
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`);
  });
});

const pending = new Map();
let nextId = 0;
let stderr = "";
const hostAssembly = ensureSmokeAgentHostBuild(root);
const hostProgram = process.platform === "win32" ? hostAssembly.replace(/\.dll$/i, ".exe") : "dotnet";
const hostArgs = process.platform === "win32" ? ["--stdio"] : [hostAssembly, "--stdio"];
let child;
let reader;

function startHost() {
  child = spawn(hostProgram, hostArgs, { cwd: root, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  child.stderr.on("data", chunk => { stderr += chunk.toString(); });
  reader = readline.createInterface({ input: child.stdout });
  reader.on("line", line => {
    try { const response = JSON.parse(line); const done = pending.get(response.id); if (done) { pending.delete(response.id); done(response); } }
    catch { /* A request timeout surfaces malformed output. */ }
  });
}

function call(method, params) {
  const id = `journal-smoke-${++nextId}`;
  child.stdin.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out waiting for ${method}.`)); }, 12_000);
    pending.set(id, result => { clearTimeout(timer); resolve(result); });
  });
}

async function run() {
  await new Promise(resolve => modelServer.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${modelServer.address().port}/v1`;
  env.SRAI_SETTINGS_PATH = path.join(profile, "settings.json");
  startHost();

  const gated = await call("tasks.plan", { title: "Approval journal smoke", instruction: "Wait for a human decision.", requiresApproval: true });
  if (!gated.ok) throw new Error(JSON.stringify(gated));
  const queued = await call("tasks.queue", { id: gated.result.id });
  if (!queued.ok || queued.result?.status !== "awaiting_approval") throw new Error("The approval-required task did not stop for review.");
  const denied = await call("tasks.deny", { id: gated.result.id });
  if (!denied.ok || denied.result?.status !== "cancelled") throw new Error("The denied task did not remain unexecuted.");
  const gatedList = await call("tasks.list");
  const gatedTask = gatedList.result?.find(item => item.id === gated.result.id);
  const gatedEvents = gatedTask?.activity?.map(item => item.type) ?? [];
  if (!gatedEvents.includes("task.approval_required") || !gatedEvents.includes("task.approval_denied")) throw new Error(`Approval events were not journaled: ${gatedEvents.join(", ")}`);
  const approvedTask = await call("tasks.plan", { title: "Approval grant smoke", instruction: "Wait for explicit approval.", requiresApproval: true });
  const approvalQueued = await call("tasks.queue", { id: approvedTask.result.id });
  const approvalGranted = await call("tasks.approve", { id: approvedTask.result.id });
  const approvedList = await call("tasks.list", {});
  const approvalEvents = approvedList.result?.find(item => item.id === approvedTask.result.id)?.activity?.map(item => item.type) ?? [];
  if (!approvedTask.ok || !approvalQueued.ok || !approvalGranted.ok || approvalGranted.result?.status !== "queued" || !approvalEvents.includes("task.approval_granted"))
    throw new Error(`Explicit approval was not captured before queueing: ${approvalEvents.join(", ")}`);

  const savedSettings = await call("settings.save", { endpoint, model: "journal-smoke-model", provider: "Local API" });
  if (!savedSettings.ok) throw new Error(`Could not set the disposable local model endpoint: ${JSON.stringify(savedSettings)}`);
  const project = await call("project.save", { name: "Journal smoke project", folderPaths: [workspace] });
  if (!project.ok) throw new Error(`Could not create the disposable project: ${JSON.stringify(project)}`);
  const preflight = await call("project.preflight", { id: project.result.id });
  if (!preflight.ok || !preflight.result?.manifests?.includes("package.json") || !preflight.result?.runtimes?.some(item => item.name === "Node.js") || !preflight.result?.suggestedChecks?.includes("npm run build") || !preflight.result?.executionNote?.includes("not been run"))
    throw new Error(`Project preflight did not report a local, review-first setup check: ${JSON.stringify(preflight)}`);
  const task = await call("tasks.plan", { title: "Read-file journal smoke", instruction: "Read README.md, then report a short summary.", projectId: project.result.id, model: "journal-smoke-model", modelProvider: "Local API", modelSizeBytes: 1, modelContextLength: 4096 });
  if (!task.ok) throw new Error(`Could not create the coding task: ${JSON.stringify(task)}`);
  const taskQueued = await call("tasks.queue", { id: task.result.id });
  if (!taskQueued.ok || taskQueued.result?.status !== "queued") throw new Error("The local coding task did not queue.");
  const started = await call("tasks.execute", { id: task.result.id });
  if (!started.ok) throw new Error(`Could not start the coding task: ${JSON.stringify(started)}`);
  let finalTask;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 250));
    const snapshot = await call("tasks.list", {});
    finalTask = snapshot.result?.find(item => item.id === task.result.id);
    if (["completed", "failed", "cancelled", "blocked"].includes(finalTask?.status)) break;
  }
  if (finalTask?.status !== "completed") throw new Error(`Coding smoke ended in ${finalTask?.status ?? "unknown"}: ${finalTask?.resultSummary ?? "no summary"}`);
  const events = finalTask.activity?.map(item => item.type) ?? [];
  if (!events.includes("tool.read_file.started") || !events.includes("tool.read_file.completed") || !events.includes("task.verification.completed"))
    throw new Error(`Task timeline did not preserve the read and verification events: ${events.join(", ")}`);
  const journalText = fs.readFileSync(env.SRAI_OPERATIONS_PATH, "utf8");
  if (journalText.includes("journal read fixture")) throw new Error("The operation journal recorded file contents instead of metadata.");

  const interrupted = await call("tasks.plan", { title: "Restart recovery smoke", instruction: "Wait for the local model response.", projectId: project.result.id, model: "journal-smoke-model", modelProvider: "Local API", modelSizeBytes: 1, modelContextLength: 4096 });
  if (!interrupted.ok) throw new Error(`Could not create restart recovery task: ${JSON.stringify(interrupted)}`);
  const interruptionQueued = await call("tasks.queue", { id: interrupted.result.id });
  if (!interruptionQueued.ok) throw new Error("The restart recovery task did not queue.");
  stallModel = true;
  const callsBeforeRestart = modelCalls;
  const interruptionStarted = await call("tasks.execute", { id: interrupted.result.id });
  if (!interruptionStarted.ok) throw new Error("The restart recovery task did not start.");
  for (let attempt = 0; attempt < 40 && modelCalls === callsBeforeRestart; attempt += 1) await new Promise(resolve => setTimeout(resolve, 100));
  if (modelCalls === callsBeforeRestart) throw new Error("The interrupted task never reached the local model request.");
  const callsAtShutdown = modelCalls;
  const oldChild = child;
  reader.close();
  oldChild.kill();
  await new Promise(resolve => oldChild.once("exit", resolve));
  startHost();
  const recoveredList = await call("tasks.list", {});
  const recoveredTask = recoveredList.result?.find(item => item.id === interrupted.result.id);
  if (recoveredTask?.status !== "blocked" || !recoveredTask.activity?.some(item => item.type === "run.needs_reconciliation"))
    throw new Error(`Restart did not mark the in-flight task for review: ${JSON.stringify(recoveredTask)}`);
  if (modelCalls !== callsAtShutdown) throw new Error(`Restart recovery replayed the local model request: ${callsAtShutdown} -> ${modelCalls}.`);
  console.log("Task workflow smoke passed: read-only preflight, approval review, safe file events, verification, redaction, and no-replay recovery.");
}

run().catch(error => {
  console.error(error.message);
  if (stderr.trim()) console.error(stderr.trim());
  process.exitCode = 1;
}).finally(() => {
  reader?.close();
  child?.kill();
  modelServer.close();
  modelServer.closeAllConnections?.();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

