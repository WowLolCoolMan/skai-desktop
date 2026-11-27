#!/usr/bin/env node

/* Verifies the local support bundle stays summary-only and redacts private state. */
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const { ensureSmokeAgentHostBuild } = require("./smoke-agent-host-build.cjs");

const root = path.resolve(__dirname, "..");
const tempRoot = path.join(root, ".tmp");
fs.mkdirSync(tempRoot, { recursive: true });
const profile = fs.mkdtempSync(path.join(tempRoot, "support-bundle-smoke-"));
const projectFolder = path.join(profile, "secret-project-root");
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
  const id = `support-bundle-smoke-${nextId++}`;
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
  assert(health.capabilities.includes("support.bundle.preview") && health.capabilities.includes("support.bundle.export"), "Support bundle methods were not advertised.");
  await ok("project.save", { name: "Private smoke project", instructions: "Do not leak this instruction.", folderPaths: [projectFolder] });
  await ok("conversation.save", { title: "Private smoke chat", mode: "ChatBot", messages: [{ role: "user", content: "secret sk-abcdefghijklmnopqrstuvwxyz api_key=do-not-export" }] });
  const sections = ["runtime", "storage", "security", "activity"];
  const preview = await ok("support.bundle.preview", { sections });
  assert(preview.sections.length === sections.length && preview.redactions.length >= 5, "Support bundle preview omitted sections or redaction disclosures.");
  const exported = await ok("support.bundle.export", { sections });
  const bundle = JSON.parse(exported.content);
  const text = JSON.stringify(bundle);
  assert(bundle.format === "skai.support-bundle" && bundle.privacy.localOnly === true, "Support bundle envelope is not local-only.");
  assert(bundle.privacy.includesUserContent === false && bundle.privacy.includesCredentials === false, "Support bundle privacy flags were not strict.");
  assert(!text.includes("sk-abcdefghijklmnopqrstuvwxyz") && !text.includes("do-not-export") && !text.includes(projectFolder) && !text.includes("Do not leak this instruction."), "Support bundle leaked secret-like content or a machine path.");
  const invalid = await request("support.bundle.export", { sections: ["runtime", "runtime"] });
  assert(!invalid.ok, "Duplicate support-bundle sections were accepted.");
  console.log("Support bundle smoke passed: local-only summary, explicit section preview, redaction disclosure, path/content/credential exclusion, and invalid-selection rejection.");
}

run().catch(error => { console.error(error instanceof Error ? error.message : error); if (stderr.trim()) console.error(stderr.trim()); process.exitCode = 1; }).finally(() => {
  child.kill(); reader.close();
  try { const resolved = path.resolve(profile); if (!resolved.startsWith(`${tempRoot}${path.sep}`)) throw new Error("Refusing to remove a smoke profile outside .tmp."); fs.rmSync(resolved, { recursive: true, force: true }); }
  catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
});
