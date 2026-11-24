#!/usr/bin/env node

/* Checks a real local-model answer against two isolated, synthetic documents. */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const { ensureSmokeAgentHostBuild } = require("./smoke-agent-host-build.cjs");

const root = path.resolve(__dirname, "..");
const model = process.env.SKAI_DOCUMENTS_SMOKE_MODEL || "qwen3:14b";
const endpoint = process.env.SKAI_DOCUMENTS_SMOKE_ENDPOINT || "http://127.0.0.1:11434";
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skai-documents-only-smoke-"));
const hostAssembly = ensureSmokeAgentHostBuild(root);
const child = spawn("dotnet", [hostAssembly, "--stdio"], {
  cwd: root,
  env: {
    ...process.env,
    SKAI_SKIP_LEGACY_DATA_MIGRATION: "true",
    SRAI_SETTINGS_PATH: path.join(tempRoot, "settings.json"),
    SRAI_CONVERSATIONS_PATH: path.join(tempRoot, "conversations.json"),
    SRAI_MEMORY_PATH: path.join(tempRoot, "memory.json"),
  },
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
const pending = new Map();
const reader = readline.createInterface({ input: child.stdout });
let nextId = 1;
let stderr = "";
child.stderr.on("data", chunk => { stderr += chunk.toString(); });
reader.on("line", line => {
  try {
    const response = JSON.parse(line);
    const resolve = pending.get(response.id);
    if (resolve) { pending.delete(response.id); resolve(response); }
  } catch { /* A request timeout reports malformed host output. */ }
});

function request(method, params, timeoutMs = 240_000) {
  const id = `documents-only-smoke-${nextId++}`;
  child.stdin.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out waiting for ${method}.`)); }, timeoutMs);
    pending.set(id, response => { clearTimeout(timer); resolve(response); });
  });
}

async function run() {
  const response = await request("chat.complete", {
    provider: "Ollama",
    endpoint,
    model,
    responseMode: "think",
    timeoutSeconds: 210,
    maxTokens: 600,
    documentsOnly: true,
    messages: [{
      role: "user",
      content: "Based only on Plan.pdf and Results.xlsx, did we meet each objective? State the goal and result, and cite each file name.",
      attachments: [
        { fileName: "Plan.pdf", mediaType: null, content: "Objectives: Deliver the MVP by the end of Q2. Reach at least 10,000 active users. Achieve a conversion rate of at least 5%." },
        { fileName: "Results.xlsx", mediaType: null, content: "Results\nMVP delivery: Q2\nActive users: 12,480\nConversion rate: 5.6%." },
      ],
    }],
  });
  if (!response.ok) throw new Error(response.error?.message ?? "The local model request failed.");
  const answer = String(response.result?.content ?? "");
  const checks = {
    q2: /\bQ2\b/i.test(answer),
    users: /12\s*,?\s*480/.test(answer),
    conversion: /5\.6\s*%/.test(answer),
    planCitation: /Plan\.pdf/i.test(answer),
    resultsCitation: /Results\.xlsx/i.test(answer),
  };
  if (Object.values(checks).some(value => !value)) throw new Error(`Documents-only answer missed a required fact or source citation: ${JSON.stringify({ model, checks, answer })}`);
  console.log(`Documents-only local inference passed with ${model}: the answer cited both attached files and matched all three recorded outcomes.`);
}

run().catch(error => {
  console.error(error.message);
  if (stderr.trim()) console.error(stderr.trim());
  process.exitCode = 1;
}).finally(() => {
  child.kill();
  reader.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
