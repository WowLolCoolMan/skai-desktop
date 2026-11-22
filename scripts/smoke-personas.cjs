#!/usr/bin/env node
// Live persona-building smoke: for a set of hard names (typos, "X from Y", single names, famous and
// obscure characters, a real person) it runs the same Agent Host calls as the Personas page —
// discover, research, draft, save, one chat turn — and checks each against a pass bar.
//
// Needs the network (Wikipedia, Fandom, Wikiquote, web search) and a local model, so it is not part
// of CI; the offline logic is covered by PersonaKnowledgeTests in the Core test runner.
//
// usage: npm run smoke:personas [-- --only "Boog from Open Season"] [-- --no-chat] [-- --report out.json]
// env:   SKAI_PERSONA_SMOKE_ENDPOINT (default http://127.0.0.1:11434), SKAI_PERSONA_SMOKE_MODEL (default llama3.2),
//        SKAI_PERSONA_SMOKE_PROVIDER (default ollama)

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { spawn } = require("node:child_process");
const { ensureSmokeAgentHostBuild } = require("./smoke-agent-host-build.cjs");

const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const argValue = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : null; };
const only = argValue("--only");
const withChat = !args.includes("--no-chat");
const reportPath = argValue("--report");
const model = {
  provider: process.env.SKAI_PERSONA_SMOKE_PROVIDER || "ollama",
  endpoint: process.env.SKAI_PERSONA_SMOKE_ENDPOINT || "http://127.0.0.1:11434",
  model: process.env.SKAI_PERSONA_SMOKE_MODEL || "llama3.2",
};

// expect: canonical name pattern, the reference host it should come from, and words a good
// in-character reply is likely to use (any one counts).
const subjects = [
  { input: "Sam Hyde", subjectType: "person", expect: { name: /^Sam Hyde$/i, host: /wikipedia\.org/, chat: /comed|million dollar|world peace|adult swim|hyde/i } },
  { input: "Captain Jack Sparrow", subjectType: "character", expect: { name: /^(?:Captain )?Jack Sparrow$/i, host: /wikipedia\.org|pirates\.fandom\.com/, chat: /pearl|rum|savvy|pirate|captain|ship|sea/i } },
  { input: "Trevor Phillips", subjectType: "character", expect: { name: /^Trevor Philips$/i, host: /gta\.fandom\.com/, chat: /michael|franklin|sandy shores|meth|trevor|los santos|blaine/i } },
  { input: "Spongebob", subjectType: "character", expect: { name: /^SpongeBob SquarePants$/i, host: /wikipedia\.org|spongebob\.fandom\.com/, chat: /krusty|patrick|bikini bottom|krabs|squidward|jelly|pineapple/i } },
  { input: "David Lynch", subjectType: "person", expect: { name: /^David Lynch$/i, host: /wikipedia\.org/, deathDate: /^2025-01-16$/, chat: /film|twin peaks|eraserhead|coffee|meditat|dream|mulholland|blue velvet/i } },
  { input: "Joe Rogan", subjectType: "person", expect: { name: /^Joe Rogan$/i, host: /wikipedia\.org/, chat: /podcast|comedy|ufc|interview|rogan|jre/i } },
  { input: "Boog from Open Season", subjectType: "character", expect: { name: /^Boog$/i, host: /openseason\.fandom\.com/, chat: /elliot|beth|bear|timberline|forest|hunt/i } },
].filter((subject) => !only || subject.input.toLowerCase() === only.toLowerCase());

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "skai-persona-smoke-"));
const env = {
  ...process.env,
  SRAI_SETTINGS_PATH: path.join(profile, "settings.json"),
  SRAI_CONVERSATIONS_PATH: path.join(profile, "conversations.json"),
  SRAI_TASKS_PATH: path.join(profile, "agent-tasks.json"),
  SRAI_SCHEDULED_TASKS_PATH: path.join(profile, "scheduled-tasks.json"),
  SRAI_PROJECTS_PATH: path.join(profile, "projects.json"),
  SRAI_CORPUS_PATH: path.join(profile, "document-corpus.json"),
  SRAI_MCP_CONNECTIONS_PATH: path.join(profile, "mcp-connections.json"),
  SKAI_SKIP_LEGACY_DATA_MIGRATION: "true",
};
const hostAssembly = ensureSmokeAgentHostBuild(root);
const child = spawn(process.platform === "win32" ? hostAssembly.replace(/\.dll$/i, ".exe") : "dotnet", process.platform === "win32" ? ["--stdio"] : [hostAssembly, "--stdio"], { cwd: root, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
const pending = new Map();
let nextId = 1;
readline.createInterface({ input: child.stdout }).on("line", (line) => {
  let message; try { message = JSON.parse(line); } catch { return; }
  const waiter = pending.get(message.id);
  if (waiter) { pending.delete(message.id); waiter(message); }
});
child.stderr.resume();
const request = (method, params, timeoutMs) => new Promise((resolve) => {
  const id = `persona-${nextId++}`;
  const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: { message: `timed out after ${Math.round(timeoutMs / 1000)}s` } }); }, timeoutMs);
  pending.set(id, (message) => { clearTimeout(timer); resolve(message); });
  child.stdin.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
});
const timed = async (action) => { const started = Date.now(); const result = await action(); return [result, Math.round((Date.now() - started) / 1000)]; };

async function runSubject(subject) {
  const row = { input: subject.input, checks: {} };
  const [discover, discoverSecs] = await timed(() => request("persona.discover", { query: subject.input, subjectType: subject.subjectType, notes: "", sourceUrls: [] }, 90_000));
  const matches = discover.result?.matches ?? [];
  // A user picks the first resolved match, as the page lists them first.
  const pick = matches.find((match) => match.resolved) ?? matches.find((match) => !match.manualQuery && match.nameMatch) ?? matches[0];
  row.discover = { secs: discoverSecs, picked: pick ? { name: pick.canonicalName, url: pick.url, type: pick.subjectType } : null, error: discover.error?.message };
  row.checks.identity = Boolean(pick && subject.expect.name.test(pick.canonicalName ?? "") && subject.expect.host.test(pick.url ?? ""));
  const subjectName = pick?.canonicalName?.trim() || subject.input;
  const subjectType = pick?.resolved && ["person", "character"].includes(pick.subjectType) ? pick.subjectType : subject.subjectType;

  const [research, researchSecs] = await timed(() => request("persona.research", { query: subjectName, subjectType, notes: subjectName !== subject.input ? `Search name or alias: ${subject.input}` : "", cutoffDate: new Date().toISOString().slice(0, 10), sourceUrls: pick?.url ? [pick.url] : [] }, 240_000));
  const sources = research.result?.sources ?? [];
  const attributedTurns = sources.filter((source) => source.speakerAttribution === "subject-attributed").reduce((sum, source) => sum + (source.attributedTurnCount ?? 0), 0);
  row.research = { secs: researchSecs, sources: sources.length, attributedTurns, types: sources.map((source) => source.type), error: research.error?.message };
  row.checks.sources = sources.length >= 3;
  if (subject.expect.deathDate) row.checks.lifeDates = subject.expect.deathDate.test(research.result?.identity?.deathDate ?? "");
  row.checks.dialogue = subjectType === "person" ? attributedTurns >= 3 : attributedTurns >= 20;

  let draft = {};
  if (sources.length) {
    const [drafted, draftSecs] = await timed(() => request("persona.draft", { ...model, subject: subjectName, subjectType, description: research.result?.identity?.description ?? "", sources }, 900_000));
    draft = drafted.result?.draft ?? {};
    const filled = Object.entries(draft).filter(([, value]) => typeof value === "string" && value.trim().length >= 12).map(([key]) => key);
    row.draft = { secs: draftSecs, filled, failures: drafted.result?.failures ?? [], voice: drafted.result?.voiceCard?.summary ?? "", error: drafted.error?.message };
    row.checks.draft = filled.length >= 6;
  } else row.checks.draft = false;

  if (withChat && sources.length) {
    const saved = await request("persona.save", { persona: { name: subjectName, sourceMode: "public-research", subjectType, roles: draft.roles ?? "", voice: draft.speechPatterns ?? "", personality: draft.personality ?? "", thinkingStyle: draft.thinkingStyle ?? "", interactionStyle: draft.interactionStyle ?? "", values: draft.values ?? "", knowledge: draft.knowledge ?? "", evidenceBoundaries: draft.evidenceBoundaries ?? "", timeline: draft.timeline ?? "", sources } }, 30_000);
    const personaId = saved.result?.persona?.id;
    if (personaId) {
      const [chat, chatSecs] = await timed(() => request("chat.complete", { ...model, personaId, timeoutSeconds: 240, messages: [{ role: "user", content: "Hey! Who are you, and what's on your mind today?" }] }, 360_000));
      const reply = String(chat.result?.content ?? "");
      row.chat = { secs: chatSecs, reply: reply.slice(0, 600), error: chat.error?.message };
      row.checks.chat = chat.ok && reply.length > 40 && subject.expect.chat.test(reply);
    } else { row.chat = { error: saved.error?.message }; row.checks.chat = false; }
  }
  row.passed = Object.values(row.checks).every(Boolean);
  return row;
}

(async () => {
  const saved = await request("settings.save", { endpoint: model.endpoint, model: model.model, provider: model.provider }, 30_000);
  if (!saved.ok) throw new Error(`settings.save failed: ${saved.error?.message}`);
  const report = [];
  for (const subject of subjects) {
    const row = await runSubject(subject);
    report.push(row);
    const failed = Object.entries(row.checks).filter(([, ok]) => !ok).map(([name]) => name);
    console.log(`${row.passed ? "PASS" : "FAIL"} ${row.input} -> ${row.discover.picked?.name ?? "(no match)"} | ${row.research.sources} sources, ${row.research.attributedTurns} attributed lines | draft ${row.draft?.filled?.length ?? 0} fields${row.chat ? ` | chat ${row.chat.secs}s` : ""}${failed.length ? ` | failed: ${failed.join(", ")}` : ""}`);
  }
  if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  child.kill();
  fs.rmSync(profile, { recursive: true, force: true });
  const failures = report.filter((row) => !row.passed).length;
  console.log(failures ? `Persona smoke: ${failures} of ${report.length} subjects below the pass bar.` : `Persona smoke passed: ${report.length} subjects.`);
  process.exitCode = failures ? 1 : 0;
})().catch((error) => { console.error(error); child.kill(); process.exitCode = 1; });
