#!/usr/bin/env node
// Live persona-building smoke: for a set of hard names (typos, "X from Y", single names, famous and
// obscure characters, a real person) it runs the same Agent Host calls as the Personas page —
// discover, research, draft, save, and chat — and checks each against a pass bar. For deceased
// people, it saves the discovered death date as the cutoff; --era-date additionally tests a
// living person's earlier era cutoff. Both paths probe a later turn beyond the effective date.
//
// Needs the network (Wikipedia, Fandom, Wikiquote, web search) and a local model, so it is not part
// of CI; the offline logic is covered by PersonaKnowledgeTests in the Core test runner.
//
// usage: npm run smoke:personas [-- --only "Boog from Open Season"] [-- --era-date 2010-12-31] [-- --no-chat] [-- --report out.json]
// env:   SKAI_PERSONA_SMOKE_ENDPOINT (default http://127.0.0.1:11434), SKAI_PERSONA_SMOKE_MODEL (auto-detected from Ollama),
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
const eraDate = argValue("--era-date") || "";
const withChat = !args.includes("--no-chat");
const reportPath = argValue("--report");
const parsedEraDate = eraDate ? new Date(`${eraDate}T00:00:00Z`) : null;
if (eraDate && (!/^\d{4}-\d{2}-\d{2}$/.test(eraDate) || Number.isNaN(parsedEraDate.getTime()) || parsedEraDate.toISOString().slice(0, 10) !== eraDate)) {
  throw new Error("--era-date must be a valid date in YYYY-MM-DD format.");
}
let model = {
  provider: process.env.SKAI_PERSONA_SMOKE_PROVIDER || "ollama",
  endpoint: process.env.SKAI_PERSONA_SMOKE_ENDPOINT || "http://127.0.0.1:11434",
  model: process.env.SKAI_PERSONA_SMOKE_MODEL || "",
};

async function resolveLocalModel() {
  if (model.model || model.provider !== "ollama") return;
  let response;
  try {
    response = await fetch(`${model.endpoint.replace(/\/$/, "")}/api/tags`);
  } catch (error) {
    throw new Error(`No persona smoke model was selected and Ollama is unavailable at ${model.endpoint}: ${error instanceof Error ? error.message : String(error)}. Set SKAI_PERSONA_SMOKE_MODEL to a locally installed model.`);
  }
  if (!response.ok) throw new Error(`Ollama model discovery failed with HTTP ${response.status}. Set SKAI_PERSONA_SMOKE_MODEL to a locally installed model.`);
  const payload = await response.json();
  const names = (Array.isArray(payload.models) ? payload.models : []).map((entry) => entry.name).filter(Boolean);
  const preferred = ["qwen3:14b", "qwen3-coder:30b", "qwen3:8b", "llama3.2"].find((name) => names.includes(name));
  model = { ...model, model: preferred || names[0] || "" };
  if (!model.model) throw new Error(`Ollama is reachable but has no installed models. Pull one or set SKAI_PERSONA_SMOKE_MODEL explicitly.`);
  console.log(`Persona smoke model: ${model.model} (auto-detected)`);
}

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

  const [research, researchSecs] = await timed(() => request("persona.research", { query: subjectName, subjectType, notes: subjectName !== subject.input ? `Search name or alias: ${subject.input}` : "", cutoffDate: eraDate || new Date().toISOString().slice(0, 10), sourceUrls: pick?.url ? [pick.url] : [] }, 240_000));
  const sources = research.result?.sources ?? [];
  const attributedTurns = sources.filter((source) => source.speakerAttribution === "subject-attributed").reduce((sum, source) => sum + (source.attributedTurnCount ?? 0), 0);
  row.research = { secs: researchSecs, sources: sources.length, attributedTurns, types: sources.map((source) => source.type), error: research.error?.message };
  row.checks.sources = sources.length >= 3;
  if (subject.expect.deathDate) row.checks.lifeDates = subject.expect.deathDate.test(research.result?.identity?.deathDate ?? "");
  row.checks.dialogue = subjectType === "person" ? attributedTurns >= 3 : attributedTurns >= 20;
  const deathDate = research.result?.identity?.deathDate ?? "";
  const knowledgeCutoffDate = deathDate || new Date().toISOString().slice(0, 10);
  const effectiveCutoffDate = [knowledgeCutoffDate, eraDate].filter(Boolean).sort()[0];

  let draft = {};
  if (sources.length) {
    const [drafted, draftSecs] = await timed(() => request("persona.draft", { ...model, subject: subjectName, subjectType, description: research.result?.identity?.description ?? "", sources }, 900_000));
    draft = drafted.result?.draft ?? {};
    const filled = Object.entries(draft).filter(([, value]) => typeof value === "string" && value.trim().length >= 12).map(([key]) => key);
    row.draft = { secs: draftSecs, filled, failures: drafted.result?.failures ?? [], voice: drafted.result?.voiceCard?.summary ?? "", error: drafted.error?.message };
    row.checks.draft = filled.length >= 6;
  } else row.checks.draft = false;

  if (withChat && sources.length) {
    const saved = await request("persona.save", { persona: { name: subjectName, sourceMode: "public-research", subjectType, birthDate: research.result?.identity?.birthDate ?? "", deathDate, knowledgeCutoffDate, eraDate, roles: draft.roles ?? "", voice: draft.speechPatterns ?? "", personality: draft.personality ?? "", thinkingStyle: draft.thinkingStyle ?? "", interactionStyle: draft.interactionStyle ?? "", values: draft.values ?? "", knowledge: draft.knowledge ?? "", evidenceBoundaries: draft.evidenceBoundaries ?? "", timeline: draft.timeline ?? "", sources } }, 30_000);
    const personaId = saved.result?.persona?.id;
    if (personaId) {
      const openingQuestion = "Hey! Who are you, and what's on your mind today?";
      const [chat, chatSecs] = await timed(() => request("chat.complete", { ...model, personaId, timeoutSeconds: 240, suppressProgressiveResearch: true, messages: [{ role: "user", content: openingQuestion }] }, 360_000));
      const reply = String(chat.result?.content ?? "");
      row.chat = { secs: chatSecs, reply: reply.slice(0, 600), error: chat.error?.message };
      row.checks.chat = chat.ok && reply.length > 40 && subject.expect.chat.test(reply);
      if ((deathDate || eraDate) && chat.ok) {
        const cutoffYear = Number(effectiveCutoffDate.slice(0, 4)) + 1;
        const cutoffQuestion = `What do you know about events in ${cutoffYear}, and how do you feel about them?`;
        const [followup, followupSecs] = await timed(() => request("chat.complete", {
          ...model,
          personaId,
          timeoutSeconds: 240,
          suppressProgressiveResearch: true,
          messages: [
            { role: "user", content: openingQuestion },
            { role: "assistant", content: reply.slice(0, 400) },
            { role: "user", content: cutoffQuestion },
          ],
        }, 360_000));
        const cutoffReply = String(followup.result?.content ?? "");
        const acknowledgesLimit = /\b(?:(?:don't|don’t|do not|can't|can’t|cannot) know|(?:don't|don’t|do not) have (?:any )?(?:information|knowledge)|have no (?:information|knowledge)|not aware|not sure|(?:can't|can’t|cannot) speak to|beyond my (?:knowledge|time)|outside my (?:knowledge|experience)|after my time|past my time|(?:i )?(?:wouldn't|wouldn’t|would not) know|i (?:do not|don't|don’t) claim to know|year that has not yet arrived)\b/i.test(cutoffReply);
        row.cutoffChat = { cutoff: effectiveCutoffDate, askedAbout: cutoffYear, secs: followupSecs, reply: cutoffReply.slice(0, 700), error: followup.error?.message };
        row.checks.cutoff = followup.ok && acknowledgesLimit;
      }
    } else { row.chat = { error: saved.error?.message }; row.checks.chat = false; }
  }
  row.passed = Object.values(row.checks).every(Boolean);
  return row;
}

(async () => {
  await resolveLocalModel();
  const saved = await request("settings.save", { endpoint: model.endpoint, model: model.model, provider: model.provider }, 30_000);
  if (!saved.ok) throw new Error(`settings.save failed: ${saved.error?.message}`);
  const report = [];
  for (const subject of subjects) {
    const row = await runSubject(subject);
    report.push(row);
    const failed = Object.entries(row.checks).filter(([, ok]) => !ok).map(([name]) => name);
    console.log(`${row.passed ? "PASS" : "FAIL"} ${row.input} -> ${row.discover.picked?.name ?? "(no match)"} | ${row.research.sources} sources, ${row.research.attributedTurns} attributed lines | draft ${row.draft?.filled?.length ?? 0} fields${row.chat ? ` | chat ${row.chat.secs}s` : ""}${row.cutoffChat ? ` | cutoff ${row.checks.cutoff ? "held" : "unverified"} (${row.cutoffChat.cutoff})` : ""}${failed.length ? ` | failed: ${failed.join(", ")}` : ""}`);
  }
  if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  child.kill();
  fs.rmSync(profile, { recursive: true, force: true });
  const failures = report.filter((row) => !row.passed).length;
  console.log(failures ? `Persona smoke: ${failures} of ${report.length} subjects below the pass bar.` : `Persona smoke passed: ${report.length} subjects.`);
  process.exitCode = failures ? 1 : 0;
})().catch((error) => { console.error(error); child.kill(); process.exitCode = 1; });
