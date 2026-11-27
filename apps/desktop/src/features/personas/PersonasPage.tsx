import { useEffect, useState } from "react";
import type { DesktopPersona, DesktopPersonaSource } from "../../../shared/contracts";
import { Button, Card, PageHeader, StatusBadge } from "../../components/ui/Primitives";
import { voiceProfiles } from "../../services/nativeTts";
import { navigatePersonaWorkshop } from "../../app/navigation";

type ResearchResult = { subjectType?: "person" | "character"; publicFigureQualified: boolean; qualification: string; fetchWarnings?: string[]; sources: DesktopPersonaSource[]; categoryCounts?: { biographies: number; conversationTranscripts: number; unattributedConversationTranscripts?: number; interviews: number; videoCaptions: number; videoReferences: number; otherReferences: number; canonReferences?: number; characterDialogues?: number; characterAnalysis?: number; total: number } };
type PersonMatch = { id: string; title: string; canonicalName?: string; snippet: string; url: string; nameMatch?: boolean; manualQuery?: boolean; resolved?: boolean; subjectType?: string; franchise?: string | null };
type DraftResult = { draft?: Record<string, string>; voiceCard?: { turnCount: number; summary: string; examples: Array<{ text: string; sourceUrl: string }> }; failures?: string[] };
type DiscoveryResult = { matches: PersonMatch[] };

const today = () => new Date().toISOString().slice(0, 10);

function sourceIsAfterCutoff(source: DesktopPersonaSource, cutoffDate: string): boolean {
  const timestamp = Date.parse(source.publishedDate);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) > cutoffDate;
}

type ProfileDraft = { roles?: string; speechPatterns?: string; personality?: string; thinkingStyle?: string; interactionStyle?: string; values?: string; knowledge?: string; evidenceBoundaries?: string; timeline?: string; quoteText?: string; quoteSourceUrl?: string };

function hasRepeatedSpeakerAttribution(sources: DesktopPersonaSource[], subject: string): boolean {
  if (sources.some((source) => source.speakerAttribution === "subject-attributed" && (source.attributedTurnCount ?? 0) >= 3)) return true;
  if (sources.some((source) => source.speakerAttribution === "unattributed-mixed-speakers" || source.evidenceQuality === "dialogue-present-speaker-unverified")) return false;
  const names = subject.trim().split(/\s+/).filter((part) => part.length > 2 && !/^(captain|sir|mr|mrs|ms|dr)$/i.test(part));
  if (!names.length) return false;
  const aliases = [...new Set([names.join(" "), names[0], names[names.length - 1]])];
  const escapedAliases = aliases.map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const label = new RegExp(`(?:^|[\\n.!?]\\s*|\\s)(?:${escapedAliases.map((alias) => `\\[\\s*${alias}\\s*\\]|${alias}\\s*:`).join("|")})\\s*[^\\n.!?]{12,}`, "i");
  const attributedLines = sources.flatMap((source) => source.excerpt.split(/\r?\n|(?<=[.!?])\s+/)).filter((line) => label.test(line));
  return attributedLines.length >= 3;
}

function parseProfileDraft(content: string): ProfileDraft | null {
  const cleaned = content.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  const json = cleaned.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const value = JSON.parse(json) as Record<string, unknown>;
    const text = (...keys: string[]) => {
      const found = keys.map((key) => value[key]).find((item) => typeof item === "string" || Array.isArray(item));
      return typeof found === "string" ? found.trim() : Array.isArray(found) ? found.filter((item): item is string => typeof item === "string").join("\n").trim() : "";
    };
    return { roles: text("roles"), speechPatterns: text("speechPatterns", "speech_patterns", "voice"), personality: text("personality", "personalityAndValues"), thinkingStyle: text("thinkingStyle", "thinking_style"), interactionStyle: text("interactionStyle", "interaction_style"), values: text("values"), knowledge: text("knowledge", "knownTopics"), evidenceBoundaries: text("evidenceBoundaries", "boundaries"), timeline: text("timeline", "lifeAndCareerTimeline"), quoteText: text("quoteText"), quoteSourceUrl: text("quoteSourceUrl") };
  } catch { return null; }
}

export function PersonasPage({ onChanged, editingPersona, onCancel, onSaved, endpoint, model, provider }: { onChanged?: () => void; editingPersona?: DesktopPersona | null; onCancel?: () => void; onSaved?: (persona: DesktopPersona) => void; endpoint: string; model: string; provider: string }) {
  const [mode, setMode] = useState<"public-research" | "own-material">("public-research");
  const [subjectType, setSubjectType] = useState<"person" | "character">("person");
  const [personas, setPersonas] = useState<DesktopPersona[]>([]);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [sourceUrls, setSourceUrls] = useState("");
  const [personalContinuityEnabled, setPersonalContinuityEnabled] = useState(false);
  const [progressiveResearchEnabled, setProgressiveResearchEnabled] = useState(true);
  const [step, setStep] = useState<"identify" | "research" | "profile">("identify");
  const [matches, setMatches] = useState<PersonMatch[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<PersonMatch | null>(null);
  const [research, setResearch] = useState<ResearchResult | null>(null);
  const [sources, setSources] = useState<DesktopPersonaSource[]>([]);
  const [selectedSourceUrls, setSelectedSourceUrls] = useState<string[]>([]);
  const [roles, setRoles] = useState("");
  const [voiceProfileId, setVoiceProfileId] = useState("");
  const [voice, setVoice] = useState("");
  const [personality, setPersonality] = useState("");
  const [thinkingStyle, setThinkingStyle] = useState("");
  const [interactionStyle, setInteractionStyle] = useState("");
  const [values, setValues] = useState("");
  const [knowledge, setKnowledge] = useState("");
  const [evidenceBoundaries, setEvidenceBoundaries] = useState("");
  const [timeline, setTimeline] = useState("");
  const [material, setMaterial] = useState("");
  const [quoteText, setQuoteText] = useState("");
  const [quoteSourceId, setQuoteSourceId] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [cutoff, setCutoff] = useState(today);
  const [deathDate, setDeathDate] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [eraDate, setEraDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [forceResearchBusy, setForceResearchBusy] = useState(false);
  const [forceResearchFocus, setForceResearchFocus] = useState("");
  const [forceResearchStatus, setForceResearchStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profileDraftStatus, setProfileDraftStatus] = useState<string | null>(null);
  const applyStarter = (template: "coding" | "research" | "writing" | "support") => {
    const starters = {
      coding: { name: "Coding partner", roles: "Software development, debugging, and code review.", notes: "Work from the user's stated goal. Inspect relevant code before proposing changes. Explain tradeoffs clearly, preserve existing behavior, and call out what you verified.", material: "Help me plan, implement, debug, and review software. Prefer small, well-scoped changes and concrete evidence." },
      research: { name: "Research analyst", roles: "Evidence-led research and synthesis.", notes: "Separate verified facts from inference. Prefer primary sources, identify uncertainty, and summarize the strongest evidence before drawing conclusions.", material: "Help me research questions, compare evidence, and produce useful, source-aware summaries." },
      writing: { name: "Writing coach", roles: "Clear writing, revision, and editorial feedback.", notes: "Preserve the author's intent and voice. Give specific edits, explain the highest-impact changes, and avoid polishing away useful personality.", material: "Help me draft, revise, and strengthen writing for its intended audience." },
      support: { name: "Support guide", roles: "Patient, practical troubleshooting and customer support.", notes: "Acknowledge the issue briefly, ask only for essential missing details, and give safe steps in a clear order. Do not claim an action succeeded unless it did.", material: "Help me solve practical problems with clear, respectful guidance." },
    };
    const selected = starters[template];
    setMode("own-material"); setStep("profile"); setName(selected.name); setRoles(selected.roles); setNotes(selected.notes); setMaterial(selected.material); setError(null);
  };
  const request = async (method: string, params?: Record<string, unknown>) => window.skaiAgent.request(method, params);

  const load = async () => {
    const response = await request("persona.list");
    if (response.ok) {
      const result = response.result as { personas: DesktopPersona[] };
      setPersonas(result.personas ?? []);
    }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (editingPersona) edit(editingPersona); }, [editingPersona?.id]);

  const findPeople = async () => {
    if (!name.trim() || busy) return;
    setBusy(true); setError(null); setResearch(null); setMatches([]); setSelectedMatch(null); setSources([]); setSelectedSourceUrls([]);
    try {
      const prioritizedUrls = sourceUrls.split(/\r?\n/).map((url) => url.trim()).filter(Boolean);
      const response = await request("persona.discover", { query: name.trim(), notes: notes.trim(), subjectType, sourceUrls: prioritizedUrls });
      if (!response.ok) throw new Error(response.error?.message ?? "People search could not be completed.");
      const result = response.result as DiscoveryResult;
      setMatches(result.matches ?? []);
      if (!result.matches?.length) setError("Search returned no candidates. Check the spelling, try another name they use, or add a clue such as their work or community.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "People search could not be completed."); }
    finally { setBusy(false); }
  };

  const prepareResearch = (match: PersonMatch) => {
    setSelectedMatch(match);
    if (match.canonicalName?.trim()) setName(match.canonicalName.trim());
    // A resolved match knows whether it is a real person or a fictional character.
    if (match.resolved && (match.subjectType === "person" || match.subjectType === "character")) setSubjectType(match.subjectType);
    setProfileDraftStatus(null);
    setRoles(""); setVoice(""); setPersonality(""); setThinkingStyle(""); setInteractionStyle(""); setValues(""); setKnowledge(""); setEvidenceBoundaries(""); setTimeline(""); setQuoteText(""); setQuoteSourceId("");
    setDeathDate(""); setBirthDate(""); setEraDate(""); setCutoff(today());
    setStep("research");
  };

  const researchSelectedPerson = async (match = selectedMatch) => {
    if (!match || busy) return;
    prepareResearch(match);
    await runResearch(match);
  };

  const categoryCounts = research?.categoryCounts ?? {
    biographies: sources.filter((source) => source.type === "Biography").length,
    conversationTranscripts: sources.filter((source) => source.type === "Conversation transcript").length,
    interviews: sources.filter((source) => source.type === "Interview").length,
    videoCaptions: sources.filter((source) => source.type === "Video captions").length,
    videoReferences: sources.filter((source) => source.type === "Video reference").length,
    otherReferences: sources.filter((source) => source.type === "Other reference").length,
    canonReferences: sources.filter((source) => source.type === "Canon reference" || source.type === "Official source").length,
    characterDialogues: sources.filter((source) => source.type === "Character dialogue" || source.type === "Story transcript").length,
    characterAnalysis: sources.filter((source) => source.type === "Character analysis").length,
    total: sources.length,
  };

  const researchCounts = subjectType === "character" ? [
    ["Canon references", categoryCounts.canonReferences ?? 0],
    ["Dialogue / story transcripts", categoryCounts.characterDialogues ?? 0],
    ["Character analysis", categoryCounts.characterAnalysis ?? 0],
    ["Video sources", categoryCounts.videoReferences],
    ["Other references", categoryCounts.otherReferences],
  ] as const : [
    ["Biographies", categoryCounts.biographies],
    ["Speaker-attributed transcripts", categoryCounts.conversationTranscripts],
    ["Unattributed dialogue sources", categoryCounts.unattributedConversationTranscripts ?? 0],
    ["Interviews", categoryCounts.interviews],
    ["Video captions", categoryCounts.videoCaptions],
    ["Video sources", categoryCounts.videoReferences],
    ["Other references", categoryCounts.otherReferences],
  ] as const;
  const hasSpeechEvidence = (categoryCounts.conversationTranscripts + categoryCounts.interviews + categoryCounts.videoCaptions + (categoryCounts.characterDialogues ?? 0)) > 0;

  const runResearch = async (match = selectedMatch, alreadyBusy = false) => {
    if (!name.trim() || !match || (busy && !alreadyBusy)) return;
    const subjectName = match.canonicalName?.trim() || name.trim();
    const identityClues = [notes.trim(), name.trim() && name.trim() !== subjectName ? `Search name or alias: ${name.trim()}` : ""]
      .filter(Boolean)
      .join("\n");
    if (!alreadyBusy) setBusy(true);
    setError(null); setResearch(null);
    try {
      const prioritizedUrls = [match.url, ...sourceUrls.split(/\r?\n/).map((url) => url.trim()).filter(Boolean)].filter(Boolean);
      const response = await request("persona.research", { query: subjectName, notes: identityClues, subjectType, cutoffDate: cutoff || today(), sourceUrls: prioritizedUrls });
      if (!response.ok) throw new Error(response.error?.message ?? "Research could not be completed.");
      const result = response.result as ResearchResult;
      setResearch(result);
      // Real people resolved through Wikipedia carry Wikidata life dates. Someone who has died should
      // not know anything after their death, so their knowledge cutoff defaults to that date.
      const lifeDates = (result as ResearchResult & { identity?: { birthDate?: string | null; deathDate?: string | null } }).identity;
      const fullDate = (value?: string | null) => !value ? "" : /^\d{4}$/.test(value) ? `${value}-12-31` : /^\d{4}-\d{2}$/.test(value) ? `${value}-28` : value;
      if (lifeDates?.birthDate) setBirthDate(fullDate(lifeDates.birthDate));
      if (lifeDates?.deathDate) { setDeathDate(fullDate(lifeDates.deathDate)); setCutoff(fullDate(lifeDates.deathDate)); }
      setSources(result.sources ?? []);
      setSelectedSourceUrls((result.sources ?? []).map((source) => source.url));
      setProfileDraftStatus("Drafting a source-backed profile…");
      let generated: ProfileDraft | null = null;
      let draftFailure = "";
      let voiceExample: { text: string; sourceUrl: string } | undefined;
      try {
        // The host drafts in two small schema-constrained passes plus a computed voice card, which
        // keeps small local models on valid, filled fields.
        const draftResponse = await request("persona.draft", { provider, endpoint, model, subject: subjectName, subjectType: match.resolved && (match.subjectType === "person" || match.subjectType === "character") ? match.subjectType : subjectType, description: (result as ResearchResult & { identity?: { description?: string } }).identity?.description ?? "", sources: result.sources ?? [] });
        if (draftResponse.ok) {
          const drafted = draftResponse.result as DraftResult;
          generated = drafted.draft ? parseProfileDraft(JSON.stringify(drafted.draft)) : null;
          voiceExample = drafted.voiceCard?.examples?.[0];
          if (!generated) draftFailure = "The selected model returned a response that could not be read as a profile draft.";
          else if (drafted.failures?.length) draftFailure = drafted.failures.join(" ");
        } else draftFailure = draftResponse.error?.message ?? "The selected model could not draft this profile.";
      } catch (reason) { draftFailure = reason instanceof Error ? reason.message : "The selected model could not draft this profile."; }
      // Keep evidence in the source review panel. A model failure must never
      // turn raw snippets or page chrome into claims in the saved persona.
      const draft = generated ?? {};
      const hasGeneratedContent = Boolean(generated && [generated.roles, generated.speechPatterns, generated.personality, generated.thinkingStyle, generated.interactionStyle, generated.values, generated.knowledge, generated.evidenceBoundaries, generated.timeline].some((field) => field?.trim()));
      setRoles(draft.roles ?? "");
      const hasAttributedSpeechSamples = hasRepeatedSpeakerAttribution(result.sources ?? [], subjectName);
      setVoice(hasAttributedSpeechSamples ? draft.speechPatterns ?? "" : "");
      setPersonality(draft.personality ?? "");
      setThinkingStyle(draft.thinkingStyle ?? "");
      setInteractionStyle(draft.interactionStyle ?? "");
      setValues(draft.values ?? "");
      setKnowledge(draft.knowledge ?? "");
      setEvidenceBoundaries(draft.evidenceBoundaries ?? "");
      setTimeline(draft.timeline ?? "");
      // Voice-card examples are verbatim lines from an attributed source, so one can be kept as a verified quote.
      const quoteSource = (result.sources ?? []).find((source) => source.url === voiceExample?.sourceUrl);
      const quoteIsVerbatim = Boolean(voiceExample && voiceExample.text.length <= 200 && quoteSource?.excerpt.includes(voiceExample.text));
      setQuoteText(quoteIsVerbatim ? voiceExample?.text ?? "" : "");
      setQuoteSourceId(quoteIsVerbatim ? voiceExample?.sourceUrl ?? "" : "");
      setProfileDraftStatus(hasGeneratedContent
        ? `AI draft filled from gathered sources. Treat every field as a suggestion: check its [S#] citations against the selected evidence and edit or remove unsupported claims before saving.${hasAttributedSpeechSamples ? "" : " Speech patterns were left blank because the sources do not contain enough clearly attributed lines from this subject."}`
        : `Profile drafting did not complete${draftFailure ? `: ${draftFailure}` : "."} Your selected sources remain available below. No evidence has been copied into the persona fields.`);
      setStep("profile");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Research could not be completed."); setStep("identify"); }
    finally { if (!alreadyBusy) setBusy(false); }
  };

  const toggleSource = (source: DesktopPersonaSource) => {
    setSelectedSourceUrls((current) => {
      if (current.includes(source.url)) {
        const next = current.filter((url) => url !== source.url);
        if (quoteSourceId === source.url) setQuoteSourceId("");
        return next;
      }
      setSources((existing) => existing.some((item) => item.url === source.url) ? existing : [...existing, source]);
      return [...current, source.url];
    });
  };

  const save = async () => {
    if (!name.trim() || busy) return;
    if (mode === "public-research" && selectedSourceUrls.length === 0 && sources.length > 0) {
      setError("Keep at least one source with this researched persona, or remove sources from the knowledge page after saving.");
      return;
    }
    setBusy(true); setError(null);
    try {
      const existingPersona = editingId ? personas.find((item) => item.id === editingId) : undefined;
      const selectedSources = mode === "public-research"
        ? sources.filter((source) => selectedSourceUrls.includes(source.url))
        : sources;
      const selectedQuote = quoteText.trim() && quoteSourceId && selectedSources.some((source) => source.url === quoteSourceId)
        ? [{ text: quoteText.trim(), sourceId: quoteSourceId, attribution: "Verified source excerpt" }]
        : [];
      const response = await request("persona.save", { persona: { id: editingId ?? "", name: name.trim(), sourceMode: mode, subjectType, isPublicFigure: mode === "public-research" && subjectType === "person" && Boolean(research?.publicFigureQualified), personalContinuityEnabled: existingPersona?.personalContinuityEnabled ?? personalContinuityEnabled, progressiveResearchEnabled, birthDate: birthDate || null, deathDate: deathDate || null, knowledgeCutoffDate: cutoff || today(), eraDate: eraDate || null, roles, voiceProfileId, voice, personality, thinkingStyle, interactionStyle, values, knowledge, evidenceBoundaries, timeline, instructions: notes, sourceMaterial: material, verifiedQuotes: selectedQuote, sources: selectedSources, profileEvidenceUrls: selectedSources.map((source) => source.url) } });
      if (!response.ok) throw new Error(response.error?.message ?? "Persona could not be saved.");
      const savedPersona = (response.result as { persona?: DesktopPersona }).persona;
      setResearch(null); setSources([]); setSelectedSourceUrls([]); setMaterial(""); setQuoteText(""); setQuoteSourceId(""); setEditingId(null); await load(); onChanged?.();
      if (savedPersona) { if (onSaved) onSaved(savedPersona); else navigatePersonaWorkshop("settings", savedPersona.id); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Persona could not be saved."); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Remove this persona? Its local card and supplied material will be deleted.")) return;
    const response = await request("persona.remove", { id });
    if (response.ok) { await load(); onChanged?.(); }
  };

  const edit = (persona: DesktopPersona) => {
    setEditingId(persona.id); setMode(persona.sourceMode); setSubjectType(persona.subjectType ?? "person"); setName(persona.name); setCutoff(persona.knowledgeCutoffDate ?? today()); setDeathDate(persona.deathDate ?? ""); setBirthDate(persona.birthDate ?? ""); setEraDate(persona.eraDate ?? ""); setRoles(persona.roles); setVoiceProfileId(persona.voiceProfileId ?? ""); setVoice(persona.voice); setPersonality(persona.personality); setThinkingStyle(persona.thinkingStyle ?? ""); setInteractionStyle(persona.interactionStyle ?? ""); setValues(persona.values ?? ""); setKnowledge(persona.knowledge ?? ""); setEvidenceBoundaries(persona.evidenceBoundaries ?? ""); setTimeline(persona.timeline); setNotes(persona.instructions); setMaterial(persona.sourceMaterial); setSources(persona.sources); setResearch({ subjectType: persona.subjectType ?? "person", publicFigureQualified: persona.isPublicFigure, qualification: `${persona.sources.length} saved public sources`, sources: persona.sources }); setSelectedSourceUrls(persona.sources.map((source) => source.url)); setPersonalContinuityEnabled(persona.personalContinuityEnabled); setProgressiveResearchEnabled(persona.progressiveResearchEnabled); setQuoteText(persona.verifiedQuotes[0]?.text ?? ""); setQuoteSourceId(persona.verifiedQuotes[0]?.sourceId ?? ""); setStep("profile");
  };

  const forceMoreResearch = async () => {
    if (!editingId || forceResearchBusy) return;
    setForceResearchBusy(true); setForceResearchStatus(null); setError(null);
    try {
      const response = await request("persona.research.force", { personaId: editingId, focus: forceResearchFocus.trim() });
      if (!response.ok) throw new Error(response.error?.message ?? "More research could not be completed.");
      const result = response.result as { persona: DesktopPersona; summary: string; sourcesAdded: number; synthesisUpdated: boolean };
      const updated = result.persona;
      setSources(updated.sources ?? []); setSelectedSourceUrls((updated.sources ?? []).map((source) => source.url));
      setResearch({ subjectType: updated.subjectType ?? "person", publicFigureQualified: updated.isPublicFigure, qualification: `${updated.sources.length} saved public sources`, sources: updated.sources ?? [] });
      setForceResearchStatus(`${result.summary}${result.synthesisUpdated ? " You can review the updated evidence under Knowledge base." : ""}`);
      onChanged?.();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "More research could not be completed."); }
    finally { setForceResearchBusy(false); }
  };

  const effectiveCutoffDate = [cutoff, eraDate].filter(Boolean).sort()[0];
  const sourcesAfterCutoff = mode === "public-research" && effectiveCutoffDate
    ? sources.filter((source) => sourceIsAfterCutoff(source, effectiveCutoffDate))
    : [];
  const profileUsesLaterEvidence = editingId !== null && sourcesAfterCutoff.some((source) => editingPersona?.profileEvidenceUrls?.includes(source.url));

  return <main className="app-content feature-page personas-page">
    <PageHeader eyebrow="PERSONA WORKSHOP" title={editingId ? "Persona settings" : "Create a persona"} description="Build a conversation-ready profile for a real person or a fictional character, grounded in sources you choose." actions={onCancel ? <Button variant="ghost" type="button" onClick={onCancel}>Back to Workshop</Button> : undefined} />
    {sourcesAfterCutoff.length > 0 && <p className="persona-research-gap" role="status">{sourcesAfterCutoff.length} source{sourcesAfterCutoff.length === 1 ? " is" : "s are"} published after the effective cutoff ({effectiveCutoffDate}) and will be left out of persona chats.{profileUsesLaterEvidence ? " Generated profile fields citing later evidence are omitted until you rebuild from sources within the cutoff." : ""}</p>}
    <div className="persona-builder-grid">
      <Card className={`persona-builder-card${onSaved ? " persona-builder-card-full" : ""}`}>
        {error && <p className="form-error" role="alert">{error}</p>}
        {!editingId && <section className="persona-starter-templates" aria-label="Starter persona templates"><strong>Start from a template</strong><div>{(["coding", "research", "writing", "support"] as const).map((template) => <Button key={template} variant="secondary" type="button" onClick={() => applyStarter(template)}>{template[0].toUpperCase() + template.slice(1)}</Button>)}</div><small>Templates are editable profiles; they do not grant tools, project access, or memory.</small></section>}
        {!editingId && mode === "public-research" && <div className="persona-research-steps" aria-label="Profile setup progress"><div className={step === "identify" ? "is-active" : "is-complete"}><span>1</span><strong>Identify</strong></div><i /><div className={step === "research" ? "is-active" : step === "profile" ? "is-complete" : ""}><span>2</span><strong>Research</strong></div><i /><div className={step === "profile" ? "is-active" : ""}><span>3</span><strong>Build profile</strong></div></div>}
        <div className="persona-mode-tabs" role="tablist" aria-label="Persona source mode"><button type="button" className={mode === "public-research" ? "is-active" : ""} onClick={() => { setMode("public-research"); setStep("identify"); setResearch(null); }}>Research public sources</button><button type="button" className={mode === "own-material" ? "is-active" : ""} onClick={() => { setMode("own-material"); setStep("profile"); setResearch(null); }}>From my own material</button></div>
        {mode === "public-research" && <div className="persona-subject-tabs" role="group" aria-label="What are you creating?"><button type="button" className={subjectType === "person" ? "is-active" : ""} onClick={() => { setSubjectType("person"); setMatches([]); setSelectedMatch(null); setResearch(null); setSources([]); }}>Real person</button><button type="button" className={subjectType === "character" ? "is-active" : ""} onClick={() => { setSubjectType("character"); setMatches([]); setSelectedMatch(null); setResearch(null); setSources([]); }}>Fictional character</button><small>{subjectType === "character" ? "Searches canon, character dialogue, story transcripts, and lore." : "Searches biographies, interviews, public conversations, and video captions."}</small></div>}
        {mode === "public-research" && step === "identify" && <section className="persona-identify-step">
          <label className="settings-field"><span>{subjectType === "character" ? "Which character are you looking for?" : "Who are you looking for?"}</span><input value={name} onChange={(event) => { setName(event.target.value); setMatches([]); setSelectedMatch(null); }} placeholder="Enter a name" /><small>Enter a name. Skai finds likely matches, researches the selected identity, and drafts the profile automatically.</small></label>
          <details className="persona-advanced-research"><summary>Advanced research options</summary><label className="settings-field"><span>Identity clues (optional)</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={subjectType === "character" ? "Series, film, franchise, or canon era…" : "Profession, country, organization, or known work…"} /></label><label className="settings-field"><span>Prioritize sources (optional)</span><textarea value={sourceUrls} onChange={(event) => setSourceUrls(event.target.value)} placeholder="One public URL per line" /><small>{subjectType === "character" ? "Searches include canon, dialogue, story transcripts, and lore." : "Searches include biographies, conversations, interviews, speeches, and video captions."}</small></label></details>
          <Button type="button" onClick={() => void findPeople()} disabled={busy || !name.trim()}>{busy ? "Researching identity and sources…" : subjectType === "character" ? "Find and build character" : "Find and build persona"}</Button>
          {matches.length > 0 && <section className="persona-match-results"><div><div><p className="section-kicker">SEARCH RESULTS</p><h2>{subjectType === "character" ? "Choose the right character" : "Choose the right person"}</h2></div><small>{matches.filter((match) => !match.manualQuery).length} public results · all candidates shown</small></div><p className="settings-help">Results may include aliases, niche names, and unrelated matches. Review any result, or continue with the name you entered; Skai won’t start research until you choose.</p><div className="persona-match-list">{matches.map((match) => <article key={match.id} className={`${selectedMatch?.id === match.id ? "is-selected" : ""}${match.manualQuery ? " is-manual-query" : ""}`}><button type="button" onClick={() => void researchSelectedPerson(match)}><span className="persona-match-radio" aria-hidden="true">{selectedMatch?.id === match.id ? "✓" : ""}</span><span><strong>{match.manualQuery ? `Use this name: ${match.canonicalName}` : match.title}</strong><small>{match.manualQuery ? "Search the entered name and aliases with the clues you provided." : `${match.canonicalName && match.canonicalName !== match.title ? `Profile name suggestion: ${match.canonicalName} · ` : ""}${match.nameMatch ? "Name appears in result" : "Possible result · verify identity"} · ${match.snippet}`}</small></span></button>{match.url && <a href={match.url} target="_blank" rel="noreferrer">Review source ↗</a>}</article>)}</div><p className="settings-help">Selecting a public result uses its source as an identity clue, then gathers more evidence for the profile.</p></section>}
        </section>}
        {mode === "public-research" && step === "research" && busy && <section className="persona-research-loading"><div className="persona-research-spinner" aria-hidden="true" /><p className="section-kicker">RESEARCHING {name.toUpperCase()}</p><h2>Gathering the public record</h2><p>Checking multiple focused sources, including transcripts and captions where available. Search results and identity clues are reviewed separately.</p></section>}
        {mode === "public-research" && step === "research" && !busy && research && <section className="persona-evidence-summary"><div className="persona-evidence-heading"><div><p className="section-kicker">STEP 2 · RESEARCH</p><h2>What we found for {name}</h2><p>{research.qualification}</p>{research.fetchWarnings?.map((warning) => <p className="persona-research-gap" role="status" key={warning}>{warning}</p>)}</div><StatusBadge tone={research.publicFigureQualified && hasSpeechEvidence ? "success" : "warning"}>{!research.publicFigureQualified ? "Review identity" : subjectType === "character" ? hasSpeechEvidence ? "Dialogue found" : "Limited dialogue" : hasSpeechEvidence ? "Speech evidence found" : "Limited speech evidence"}</StatusBadge></div><div className="persona-research-counts">{researchCounts.map(([label, count]) => <article key={label}><strong>{count}</strong><span>{label}</span></article>)}</div><p className="persona-evidence-note">Counts show the source types Skai found in this research pass. Open sources and review evidence before relying on a detail.</p>{!hasSpeechEvidence && <p className="persona-research-gap" role="status">{subjectType === "character" ? "No character dialogue or story transcripts were found. The dialogue field will stay empty until you add a suitable source." : "No conversation transcripts, interviews, or usable video captions were found. Speech-style fields will stay empty until you add suitable sources."}</p>}<section className="persona-source-choices" aria-label="Evidence sources"><div><strong>Choose evidence to keep</strong><small>{selectedSourceUrls.length} of {sources.length} selected · unselected sources will not be saved</small></div>{sources.length ? sources.map((source) => <label key={source.url} className="persona-source-choice"><input type="checkbox" checked={selectedSourceUrls.includes(source.url)} onChange={() => toggleSource(source)} /><span><strong>{source.title || source.url}</strong><small>{source.type} · {source.authorOrPublisher || source.url}{source.publishedDate ? ` · ${source.publishedDate}` : ""}{source.speakerAttribution === "subject-attributed" ? ` · ${source.attributedTurnCount ?? 0} subject-labeled turns` : source.speakerAttribution === "unattributed-mixed-speakers" ? " · speakers not separated" : ""}</small>{source.excerpt && <span>{source.excerpt}</span>}<em>{source.reliabilityNote}</em></span><a href={source.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>Open source</a></label>) : <p className="settings-help">No sources were returned. Go back, add a direct URL, and search again.</p>}</section><div className="persona-step-actions"><Button variant="ghost" type="button" onClick={() => { setStep("identify"); setResearch(null); setSelectedMatch(null); }}>Back to matches</Button><Button type="button" onClick={() => setStep("profile")} disabled={sources.length === 0}>Build profile</Button></div></section>}
        {editingId && mode === "public-research" && personas.find((persona) => persona.id === editingId)?.latestDistillation && <details className="persona-profile-evidence"><summary>Latest learning pass · {personas.find((persona) => persona.id === editingId)?.latestDistillation?.updatedAtUtc ? new Date(personas.find((persona) => persona.id === editingId)!.latestDistillation!.updatedAtUtc).toLocaleDateString() : "recent"}</summary><div><p>Focus: {personas.find((persona) => persona.id === editingId)?.latestDistillation?.focus}</p><p>{personas.find((persona) => persona.id === editingId)?.latestDistillation?.speechPatterns}</p><p>{personas.find((persona) => persona.id === editingId)?.latestDistillation?.thinkingStyle}</p><p>{personas.find((persona) => persona.id === editingId)?.latestDistillation?.interactionStyle}</p><p>{personas.find((persona) => persona.id === editingId)?.latestDistillation?.knowledge}</p><small>Based on {personas.find((persona) => persona.id === editingId)?.latestDistillation?.sourceUrls.length ?? 0} saved sources. This synthesis never overwrites the editable fields above.</small></div></details>}\n        {mode === "own-material" && <label className="settings-field"><span>Material you provide</span><textarea className="persona-material" value={material} onChange={(event) => setMaterial(event.target.value)} placeholder="Paste notes, messages, or a description of how they speak and think…" /><small>No web search is performed in this mode.</small></label>}
        {(mode === "own-material" || (mode === "public-research" && step === "profile" && research)) && <>
        {mode === "public-research" && <section className="persona-profile-build"><p className="section-kicker">STEP 3 · BUILD PROFILE</p><h2>Build the profile</h2><p>Skai drafted this profile from your chosen identity. Review the evidence, edit anything you want, then save to your Persona Workshop.</p>{research && <><p className="persona-evidence-note">{research.qualification}</p>{research.fetchWarnings?.map((warning) => <p className="persona-research-gap" role="status" key={warning}>{warning}</p>)}<div className="persona-research-counts">{researchCounts.map(([label, count]) => <article key={label}><strong>{count}</strong><span>{label}</span></article>)}</div></>}{!hasSpeechEvidence && <p className="persona-research-gap" role="status">No usable speech samples were found. Speech and response patterns is left blank so you can add verified examples yourself.</p>}{profileDraftStatus && <p className="persona-profile-draft-status" role="status">{profileDraftStatus}</p>}{sources.length > 0 && <details className="persona-profile-evidence"><summary>Review selected evidence ({sources.filter((source) => selectedSourceUrls.includes(source.url)).length})</summary><div>{sources.filter((source) => selectedSourceUrls.includes(source.url)).map((source) => <article key={source.url}><strong>{source.title}</strong><small>{source.type} · {source.authorOrPublisher}</small><p>{source.excerpt}</p><a href={source.url} target="_blank" rel="noreferrer">Open source ↗</a></article>)}</div></details>}</section>}
        {mode === "public-research" && <Button variant="ghost" type="button" onClick={() => setStep("research")}>Back to research</Button>}
        <div className="persona-card-fields"><label className="settings-field"><span>Profile name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Persona name" /></label><label className="settings-field"><span>Knowledge cutoff</span><input type="date" value={cutoff} onChange={(event) => setCutoff(event.target.value)} /><small>Living people default to today. Set an earlier cutoff for an era profile.</small></label><label className="settings-field"><span>Date of death (if applicable)</span><input type="date" value={deathDate} onChange={(event) => { setDeathDate(event.target.value); if (event.target.value) setCutoff(event.target.value); }} /></label><label className="settings-field"><span>Era date (optional)</span><input type="date" value={eraDate} onChange={(event) => setEraDate(event.target.value)} /></label><label className="settings-field"><span>Roles and subjects</span><textarea value={roles} onChange={(event) => setRoles(event.target.value)} placeholder="Public work, expertise, recurring interests…" /></label><label className="settings-field"><span>Assigned voice</span><select value={voiceProfileId} onChange={(event) => setVoiceProfileId(event.target.value)}><option value="">Use Settings default voice</option>{voiceProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select><small>Uses an available app voice. Public figures’ voices are not cloned.</small></label><label className="settings-field"><span>Speech and response patterns</span><textarea value={voice} onChange={(event) => setVoice(event.target.value)} placeholder="Pacing, vocabulary, humor, conversational habits…" /></label><label className="settings-field"><span>How they think and decide</span><textarea value={thinkingStyle} onChange={(event) => setThinkingStyle(event.target.value)} placeholder="Repeated reasoning patterns, decision habits, and how they handle uncertainty…" /></label><label className="settings-field"><span>How they interact</span><textarea value={interactionStyle} onChange={(event) => setInteractionStyle(event.target.value)} placeholder="Listening, humor, disagreement, empathy, and shifts between conversational modes…" /></label><label className="settings-field"><span>Values and belief changes</span><textarea value={values} onChange={(event) => setValues(event.target.value)} placeholder="Evidence-backed values, confidence, and changes over time…" /></label><label className="settings-field"><span>What they know</span><textarea value={knowledge} onChange={(event) => setKnowledge(event.target.value)} placeholder="Topics supported by the research, plus areas the profile should treat as unknown…" /></label><label className="settings-field"><span>Research limits</span><textarea value={evidenceBoundaries} onChange={(event) => setEvidenceBoundaries(event.target.value)} placeholder="Disputed claims, weak sources, and important evidence gaps…" /></label><label className="settings-field"><span>Personality and values</span><textarea value={personality} onChange={(event) => setPersonality(event.target.value)} placeholder="Documented public traits; distinguish observation from inference…" /></label><label className="settings-field"><span>Life and career timeline</span><textarea value={timeline} onChange={(event) => setTimeline(event.target.value)} placeholder="Verified public events with dates and sources…" /></label><label className="settings-field"><span>Verified quote (optional)</span><textarea value={quoteText} onChange={(event) => setQuoteText(event.target.value)} placeholder="Only add a short quote you can cite…" /></label>{sources.length > 0 && <label className="settings-field"><span>Quote source</span><select value={quoteSourceId} onChange={(event) => setQuoteSourceId(event.target.value)}><option value="">Choose a selected source…</option>{sources.filter((source) => selectedSourceUrls.includes(source.url)).map((source) => <option key={source.url} value={source.url}>{source.title}</option>)}</select></label>}</div>
        {editingId && mode === "public-research" && <Card className="persona-force-research"><div><p className="section-kicker">PROFILE LEARNING</p><h2>Force more research</h2><p>Search for additional public evidence, save relevant new sources, and refresh the evidence-backed synthesis. Sources removed from this profile stay excluded.</p></div><label className="settings-field"><span>Optional research focus</span><input value={forceResearchFocus} onChange={(event) => setForceResearchFocus(event.target.value)} placeholder={subjectType === "character" ? "e.g. childhood canon, dialogue, relationships" : "e.g. long-form interviews, early career, public speaking"} /></label><Button type="button" variant="secondary" onClick={() => void forceMoreResearch()} disabled={forceResearchBusy || (sources.length >= 32)}>{forceResearchBusy ? "Researching and refining…" : "Force more research"}</Button>{sources.length >= 32 && <small>This profile has reached its 32-source limit. Remove a source before researching more.</small>}{forceResearchStatus && <p role="status">{forceResearchStatus}</p>}</Card>}
        <div className="persona-card-actions">{!editingId && <label className="persona-continuity-choice"><input type="checkbox" checked={personalContinuityEnabled} onChange={(event) => setPersonalContinuityEnabled(event.target.checked)} /><span><strong>Personal continuity</strong><small>Choose once at creation. If enabled, this persona can remember the user and ongoing context. You can review and clear those memories later.</small></span></label>}<label className="persona-continuity-choice"><input type="checkbox" checked={progressiveResearchEnabled} disabled={mode !== "public-research"} onChange={(event) => setProgressiveResearchEnabled(event.target.checked)} /><span><strong>Progressive public research</strong><small>Periodically refine public-source evidence in the background. Handcrafted personas never use web research.</small></span></label><Button type="button" onClick={() => void save()} disabled={busy || !name.trim() || (mode === "public-research" && selectedSourceUrls.length === 0 && sources.length > 0)}>{busy ? "Saving…" : "Save persona"}</Button>{error && <span className="form-error" role="alert">{error}</span>}</div>
        </>}
      </Card>
      {!onSaved && <Card className="persona-library-card"><div className="panel-heading"><div><p className="section-kicker">LOCAL LIBRARY</p><h2>Saved personas</h2></div><StatusBadge tone="neutral">{personas.length} saved</StatusBadge></div>{personas.length === 0 ? <p className="settings-help">No persona cards yet. Start with your own material if the person is private or unclear.</p> : <div className="persona-library">{personas.map((persona) => <article key={persona.id} className="persona-library-item"><div><strong>{persona.name}</strong><small>{persona.sourceMode === "public-research" ? "Based on public sources" : "Based on your own material"}</small><span>AI simulation · cutoff {persona.knowledgeCutoffDate ?? "not set"}</span></div><div className="persona-library-actions"><Button variant="secondary" type="button" onClick={() => navigatePersonaWorkshop("settings", persona.id)}>Settings</Button><Button variant="ghost" type="button" onClick={() => edit(persona)}>Edit</Button><Button variant="ghost" type="button" onClick={() => void remove(persona.id)}>Remove</Button></div></article>)}</div>}</Card>}
    </div>
  </main>;
}
