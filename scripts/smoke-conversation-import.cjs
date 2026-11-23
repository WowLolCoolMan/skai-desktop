#!/usr/bin/env node

/* Disposable Agent Host protocol smoke for archive preview, apply, and dedupe. */

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const { ensureSmokeAgentHostBuild } = require("./smoke-agent-host-build.cjs");

const root = path.resolve(__dirname, "..");
const tempRoot = path.join(root, ".tmp");
fs.mkdirSync(tempRoot, { recursive: true });
const profile = fs.mkdtempSync(path.join(tempRoot, "conversation-import-smoke-"));
const archivePath = path.join(profile, "conversations.json");
const existingId = "legacy-collision-0001";
fs.writeFileSync(archivePath, JSON.stringify([{
  id: existingId,
  title: "Existing native chat",
  mode: "ChatBot",
  updatedAt: "2026-01-10T10:00:00Z",
  messages: [{ role: "user", content: "Keep the native history intact." }],
}]));
const env = {
  ...process.env,
  SRAI_CONVERSATIONS_PATH: archivePath,
  SRAI_SETTINGS_PATH: path.join(profile, "settings.json"),
  SRAI_PROJECTS_PATH: path.join(profile, "projects.json"),
  SRAI_TASKS_PATH: path.join(profile, "tasks.json"),
  SRAI_SCHEDULED_TASKS_PATH: path.join(profile, "scheduled.json"),
  SKAI_SKIP_LEGACY_DATA_MIGRATION: "true",
};
const assembly = ensureSmokeAgentHostBuild(root);
const executable = process.platform === "win32" ? assembly.replace(/\.dll$/i, ".exe") : "dotnet";
const args = process.platform === "win32" ? ["--stdio"] : [assembly, "--stdio"];
const child = spawn(executable, args, { cwd: root, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
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
  } catch { /* malformed protocol output is caught by the request timeout */ }
});

function request(method, params = {}) {
  const id = `conversation-import-${nextId++}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out waiting for ${method}.`)); }, 30_000);
    pending.set(id, response => { clearTimeout(timer); resolve(response); });
    child.stdin.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
  });
}

async function run() {
  const health = await request("runtime.health");
  for (const method of ["conversations.import.preview", "conversations.import.apply"]) {
    if (!health.ok || !health.result?.capabilities?.includes(method)) throw new Error(`runtime.health did not advertise ${method}.`);
  }

  const archive = JSON.stringify({
    chats: [{
      id: existingId,
      title: "Imported legacy chat",
      mode: "ChatBot",
      updatedAt: "2026-01-12T10:00:00Z",
      projectId: "legacy-project-id",
      projectName: "Legacy project",
      projectInstructions: "Must not become trusted native project context.",
      includeProjectFilesInChat: true,
      messages: [
        { role: "user", content: "A legacy question." },
        { role: "assistant", content: "A legacy answer." },
      ],
    }],
    projects: [{ id: "ignored" }],
  });

  const beforePreview = await request("conversations.list", { includeArchived: true });
  const preview = await request("conversations.import.preview", { fileName: "legacy.json", content: archive });
  if (!preview.ok || preview.result?.total !== 1 || preview.result?.importCount !== 1 || preview.result?.reassignedIds !== 1) {
    throw new Error(`The legacy archive preview plan was not accurate: ${JSON.stringify(preview)}`);
  }
  const afterPreview = await request("conversations.list", { includeArchived: true });
  if (!beforePreview.ok || !afterPreview.ok || beforePreview.result.length !== afterPreview.result.length || !fs.existsSync(archivePath)) {
    throw new Error("Previewing the legacy archive changed local conversation history.");
  }

  const applied = await request("conversations.import.apply", {
    content: archive,
    expectedImportCount: preview.result.importCount,
    expectedSkippedDuplicates: preview.result.skippedDuplicates,
    expectedReassignedIds: preview.result.reassignedIds,
  });
  if (!applied.ok || applied.result?.imported !== 1 || applied.result?.reassignedIds !== 1) {
    throw new Error(`The previewed archive could not be merged: ${JSON.stringify(applied)}`);
  }
  const importedHistory = await request("conversations.list", { includeArchived: true });
  const imported = importedHistory.result?.find(chat => chat.title === "Imported legacy chat");
  if (!importedHistory.ok || importedHistory.result.length !== 2 || !imported || imported.id === existingId || imported.projectId || imported.projectName) {
    throw new Error("The imported legacy chat did not preserve data or isolate legacy project context.");
  }

  const repeatedPreview = await request("conversations.import.preview", { fileName: "legacy.json", content: archive });
  if (!repeatedPreview.ok || repeatedPreview.result?.importCount !== 0 || repeatedPreview.result?.skippedDuplicates !== 1) {
    throw new Error(`Repeating an import did not skip its duplicate: ${JSON.stringify(repeatedPreview)}`);
  }
  console.log("Conversation import smoke passed (preview is read-only, ID collision is preserved, legacy context is stripped, re-import is idempotent).");
}

run().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  if (stderr.trim()) console.error(stderr.trim());
  process.exitCode = 1;
}).finally(() => {
  child.kill();
  try {
    const resolved = path.resolve(profile);
    if (!resolved.startsWith(`${tempRoot}${path.sep}`)) throw new Error("Refusing to remove a smoke profile outside .tmp.");
    fs.rmSync(resolved, { recursive: true, force: true });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
});
