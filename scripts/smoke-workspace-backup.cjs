#!/usr/bin/env node

/* Exercises portable workspace export, encryption, integrity, preview, and safe restore. */
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const { ensureSmokeAgentHostBuild } = require("./smoke-agent-host-build.cjs");

const root = path.resolve(__dirname, "..");
const tempRoot = path.join(root, ".tmp");
fs.mkdirSync(tempRoot, { recursive: true });
const profile = fs.mkdtempSync(path.join(tempRoot, "workspace-backup-smoke-"));
const projectFolder = path.join(profile, "private-project-folder");
fs.mkdirSync(projectFolder, { recursive: true });
const env = {
  ...process.env,
  SKAI_SKIP_LEGACY_DATA_MIGRATION: "true",
  SRAI_CONVERSATIONS_PATH: path.join(profile, "conversations.json"),
  SRAI_SETTINGS_PATH: path.join(profile, "settings.json"),
  SRAI_PROJECTS_PATH: path.join(profile, "projects.json"),
  SRAI_TASKS_PATH: path.join(profile, "agent-tasks.json"),
  SRAI_SCHEDULED_TASKS_PATH: path.join(profile, "scheduled-tasks.json"),
  SRAI_OPERATIONS_PATH: path.join(profile, "operations.json"),
  SRAI_UNDO_PATH: path.join(profile, "undo.json"),
  SRAI_MEMORY_PATH: path.join(profile, "memory.json"),
  SRAI_CORPUS_PATH: path.join(profile, "corpus.json"),
};
const assembly = ensureSmokeAgentHostBuild(root);
const child = spawn("dotnet", [assembly, "--stdio"], { cwd: root, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
const reader = readline.createInterface({ input: child.stdout });
const pending = new Map();
let nextId = 1;
let stderr = "";
child.stderr.on("data", chunk => { stderr += chunk.toString(); });
reader.on("line", line => {
  try { const response = JSON.parse(line); const resolve = pending.get(response.id); if (resolve) { pending.delete(response.id); resolve(response); } }
  catch { /* The request timeout reports malformed host output. */ }
});
function request(method, params = {}) {
  const id = `backup-smoke-${nextId++}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out waiting for ${method}.`)); }, 20_000);
    pending.set(id, response => { clearTimeout(timer); resolve(response); });
    child.stdin.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
  });
}
function assert(condition, message) { if (!condition) throw new Error(message); }
async function ok(method, params = {}) {
  const response = await request(method, params);
  assert(response.ok, `${method} failed: ${response.error?.message ?? JSON.stringify(response)}`);
  return response.result;
}

async function run() {
  const health = await ok("runtime.health");
  for (const method of ["workspace.backup.preview", "workspace.backup.export", "workspace.backup.restore.preview", "workspace.backup.restore.apply", "workspace.storage.overview"])
    assert(health.capabilities.includes(method), `runtime.health did not advertise ${method}.`);

  const project = await ok("project.save", { name: "Portable smoke project", instructions: "Do not export this private instruction.", folderPaths: [projectFolder] });
  const chat = await ok("conversation.save", {
    title: "Portable smoke conversation", mode: "ChatBot", projectId: project.id,
    messages: [{ role: "user", content: "secret sk-abcdefghijklmnopqrstuvwxyz and api_key=private-secret-12345" }],
  });
  await ok("settings.save", { endpoint: "http://127.0.0.1:11435/v1", model: "backup-smoke", provider: "Ollama", themeMode: "light", interfaceDensity: "compact" });
  await ok("settings.save", { chatRetentionDays: 30, taskRetentionDays: 90, taskLogRetentionDays: 7 });
  const retentionSettings = await ok("settings.get");
  assert(retentionSettings.chatRetentionDays === 30 && retentionSettings.taskRetentionDays === 90 && retentionSettings.taskLogRetentionDays === 7, "Partial retention settings were not persisted.");
  assert(retentionSettings.endpoint === "http://127.0.0.1:11435/v1" && retentionSettings.model === "backup-smoke", "Saving retention preferences overwrote unrelated runtime settings.");
  const invalidRetention = await request("settings.save", { taskRetentionDays: 14 });
  assert(!invalidRetention.ok, "Unsupported retention duration was accepted.");

  const categories = ["conversations", "settings", "personas", "projects"];
  const preview = await ok("workspace.backup.preview", { categories });
  assert(preview.categories.length === 4 && preview.privacyNote, "Export preview omitted category or privacy disclosure.");
  const exported = await ok("workspace.backup.export", { categories });
  const envelope = JSON.parse(exported.content);
  const portable = JSON.parse(Buffer.from(envelope.data, "base64").toString("utf8"));
  const text = JSON.stringify(portable);
  assert(!text.includes("sk-abcdefghijklmnopqrstuvwxyz") && !text.includes("private-secret-12345"), "Secret-like values were not redacted.");
  assert(!text.includes(projectFolder) && !text.includes("Do not export this private instruction."), "Project path or instructions leaked into the portable backup.");
  assert(portable.settings.endpoint === "http://localhost:11434/v1", "Provider endpoint was not reset to a portable local default.");
  assert(portable.settings.chatRetentionDays === 30 && portable.settings.taskRetentionDays === 90 && portable.settings.taskLogRetentionDays === 7, "Retention preferences were not included in the portable settings backup.");
  const backedUpChat = portable.conversations.find(item => item.id === chat.id);
  assert(backedUpChat && backedUpChat.projectId === null && backedUpChat.projectInstructions === null && backedUpChat.includeProjectFilesInChat === false, "Project trust context remained attached to the exported conversation.");

  const encrypted = await ok("workspace.backup.export", { categories, passphrase: "backup-passphrase-test" });
  assert(JSON.parse(encrypted.content).encrypted === true, "Encrypted backup was not marked encrypted.");
  const wrongPass = await request("workspace.backup.restore.preview", { content: encrypted.content, passphrase: "wrong-passphrase" });
  assert(!wrongPass.ok, "Wrong passphrase was accepted.");
  const integrityTamper = JSON.parse(exported.content); integrityTamper.digest = "0".repeat(64);
  const corrupt = await request("workspace.backup.restore.preview", { content: JSON.stringify(integrityTamper) });
  assert(!corrupt.ok, "Corrupt archive digest was accepted.");

  await ok("conversation.save", { id: chat.id, title: "Destination chat wins", mode: "ChatBot", messages: [{ role: "user", content: "Keep destination by default." }] });
  await ok("project.save", { id: project.id, name: "Destination project wins", instructions: "Local instructions stay local.", folderPaths: [projectFolder] });
  const restorePreview = await ok("workspace.backup.restore.preview", { content: exported.content, fileName: exported.fileName });
  assert(restorePreview.integrity === "verified" && restorePreview.categories.find(item => item.id === "projects").collisions === 1, "Restore preview did not verify integrity or report conflicts.");

  await ok("workspace.backup.restore.apply", { content: exported.content, categories: ["conversations"], archiveDigest: restorePreview.archiveDigest, stateFingerprint: restorePreview.stateFingerprint, policies: { conversations: "keep" } });
  let chats = await ok("conversations.list", { includeArchived: true });
  assert(chats.find(item => item.id === chat.id)?.title === "Destination chat wins", "Keep policy overwrote the destination chat.");

  const freshPreview = await ok("workspace.backup.restore.preview", { content: exported.content });
  await ok("workspace.backup.restore.apply", { content: exported.content, categories: ["conversations", "settings", "projects"], archiveDigest: freshPreview.archiveDigest, stateFingerprint: freshPreview.stateFingerprint, policies: { conversations: "replace", settings: "replace", projects: "replace" } });
  chats = await ok("conversations.list", { includeArchived: true });
  assert(chats.find(item => item.id === chat.id)?.title === "Portable smoke conversation", "Replace policy did not restore the backed-up chat.");
  const restoredSettings = await ok("settings.get");
  assert(restoredSettings.endpoint === "http://127.0.0.1:11435/v1" && restoredSettings.interfaceDensity === "compact", "Settings restore overwrote local machine endpoint or failed to restore portable preference.");
  const projects = await ok("projects.list");
  const restoredProject = projects.find(item => item.id === project.id);
  assert(restoredProject?.name === "Portable smoke project" && restoredProject.folderPaths.includes(projectFolder), "Project metadata restore failed to retain local folder roots.");

  const storage = await ok("workspace.storage.overview");
  assert(storage.rows.some(row => row.label === "Conversations" && row.exists) && storage.totalBytes > 0 && storage.privacy.length >= 3, "Storage overview omitted owned data or integration privacy details.");
  const stalePreview = await ok("workspace.backup.restore.preview", { content: exported.content });
  await ok("conversation.save", { id: chat.id, title: "Changed after preview", mode: "ChatBot", messages: [{ role: "user", content: "Concurrent change." }] });
  const staleApply = await request("workspace.backup.restore.apply", { content: exported.content, categories: ["conversations"], archiveDigest: stalePreview.archiveDigest, stateFingerprint: stalePreview.stateFingerprint, policies: { conversations: "replace" } });
  assert(!staleApply.ok, "Restore applied after workspace changed since preview.");
  console.log("Workspace backup smoke passed: category preview, redaction and portability, AES-GCM encryption, wrong-passphrase rejection, integrity validation, keep/replace collision policies, endpoint/path preservation, storage ownership, and stale-preview rejection.");
}

run().catch(error => { console.error(error instanceof Error ? error.message : error); if (stderr.trim()) console.error(stderr.trim()); process.exitCode = 1; }).finally(() => {
  child.kill(); reader.close();
  try { const resolved = path.resolve(profile); if (!resolved.startsWith(`${tempRoot}${path.sep}`)) throw new Error("Refusing to remove a smoke profile outside .tmp."); fs.rmSync(resolved, { recursive: true, force: true }); }
  catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
});
