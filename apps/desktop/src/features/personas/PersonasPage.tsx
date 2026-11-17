import { useEffect, useState } from "react";
import type { DesktopPersona, DesktopPersonaSource } from "../../../shared/contracts";
import { Button, Card, PageHeader, StatusBadge } from "../../components/ui/Primitives";
import { voiceProfiles } from "../../services/nativeTts";
import { navigatePersonaWorkshop } from "../../app/navigation";

type ResearchResult = { publicFigureQualified: boolean; qualification: string; sources: DesktopPersonaSource[]; categoryCounts?: { biographies: number; conversationTranscripts: number; interviews: number; videoCaptions: number; videoReferences: number; otherReferences: number; total: number } };
type PersonMatch = { id: string; title: string; snippet: string; url: string };
type DiscoveryResult = { matches: PersonMatch[] };

const today = () => new Date().toISOString().slice(0, 10);

export function PersonasPage({ onChanged, editingPersona, onCancel, onSaved }: { onChanged?: () => void; editingPersona?: DesktopPersona | null; onCancel?: () => void; onSaved?: (persona: DesktopPersona) => void }) {
  const [mode, setMode] = useState<"public-research" | "own-material">("public-research");
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
  const [timeline, setTimeline] = useState("");
  const [material, setMaterial] = useState("");
  const [quoteText, setQuoteText] = useState("");
  const [quoteSourceId, setQuoteSourceId] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [cutoff, setCutoff] = useState(today);
  const [deathDate, setDeathDate] = useState("");
  const [eraDate, setEraDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      const response = await request("persona.discover", { query: name.trim(), notes: notes.trim() });
      if (!response.ok) throw new Error(response.error?.message ?? "People search could not be completed.");
      const result = response.result as DiscoveryResult;
      setMatches(result.matches ?? []);
      if (!result.matches?.length) setError("No likely matches came back. Try a fuller name or add a clue such as a show, job, or country.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "People search could not be completed."); }
    finally { setBusy(false); }
  };

  const researchSelectedPerson = async () => {
    if (!selectedMatch) return;
    setStep("research");
    await runResearch();
  };

  const categoryCounts = research?.categoryCounts ?? {
    biographies: sources.filter((source) => source.type === "Biography").length,
    conversationTranscripts: sources.filter((source) => source.type === "Conversation transcript").length,
    interviews: sources.filter((source) => source.type === "Interview").length,
    videoCaptions: sources.filter((source) => source.type === "Video captions").length,
    videoReferences: sources.filter((source) => source.type === "Video reference").length,
    otherReferences: sources.filter((source) => source.type === "Other reference").length,
    total: sources.length,
  };

  const researchCounts = [
    ["Biographies", categoryCounts.biographies],
    ["Conversation transcripts", categoryCounts.conversationTranscripts],
    ["Interviews", categoryCounts.interviews],
    ["Video captions", categoryCounts.videoCaptions],
    ["Video sources", categoryCounts.videoReferences],
    ["Other references", categoryCounts.otherReferences],
  ] as const;

  const runResearch = async () => {
    if (!name.trim() || !selectedMatch || busy) return;
    setBusy(true); setError(null); setResearch(null);
    try {
      const prioritizedUrls = [selectedMatch.url, ...sourceUrls.split(/\r?\n/).map((url) => url.trim()).filter(Boolean)];
      const response = await request("persona.research", { query: name.trim(), notes: notes.trim(), cutoffDate: cutoff || today(), sourceUrls: prioritizedUrls });
      if (!response.ok) throw new Error(response.error?.message ?? "Research could not be completed.");
      const result = response.result as ResearchResult;
      setResearch(result);
      setSources(result.sources ?? []);
      setSelectedSourceUrls((result.sources ?? []).map((source) => source.url));
      setStep("profile");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Research could not be completed."); }
    finally { setBusy(false); }
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
    setBusy(true); setError(null);
    try {
      const existingPersona = editingId ? personas.find((item) => item.id === editingId) : undefined;
      const selectedSources = mode === "public-research"
        ? sources.filter((source) => selectedSourceUrls.includes(source.url))
        : sources;
      const selectedQuote = quoteText.trim() && quoteSourceId && selectedSources.some((source) => source.url === quoteSourceId)
        ? [{ text: quoteText.trim(), sourceId: quoteSourceId, attribution: "Verified source excerpt" }]
        : [];
      const response = await request("persona.save", { persona: { id: editingId ?? "", name: name.trim(), sourceMode: mode, isPublicFigure: mode === "public-research" && Boolean(research?.publicFigureQualified), personalContinuityEnabled: existingPersona?.personalContinuityEnabled ?? personalContinuityEnabled, progressiveResearchEnabled, deathDate: deathDate || null, knowledgeCutoffDate: cutoff || today(), eraDate: eraDate || null, roles, voiceProfileId, voice, personality, timeline, instructions: notes, sourceMaterial: material, verifiedQuotes: selectedQuote, sources: selectedSources } });
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
    setEditingId(persona.id); setMode(persona.sourceMode); setName(persona.name); setCutoff(persona.knowledgeCutoffDate ?? today()); setDeathDate(persona.deathDate ?? ""); setEraDate(persona.eraDate ?? ""); setRoles(persona.roles); setVoiceProfileId(persona.voiceProfileId ?? ""); setVoice(persona.voice); setPersonality(persona.personality); setTimeline(persona.timeline); setNotes(persona.instructions); setMaterial(persona.sourceMaterial); setSources(persona.sources); setResearch({ publicFigureQualified: persona.isPublicFigure, qualification: `${persona.sources.length} saved public sources`, sources: persona.sources }); setSelectedSourceUrls(persona.sources.map((source) => source.url)); setPersonalContinuityEnabled(persona.personalContinuityEnabled); setProgressiveResearchEnabled(persona.progressiveResearchEnabled); setQuoteText(persona.verifiedQuotes[0]?.text ?? ""); setQuoteSourceId(persona.verifiedQuotes[0]?.sourceId ?? ""); setStep("profile");
  };

  return <main className="app-content feature-page personas-page">
    <PageHeader eyebrow="PERSONA WORKSHOP" title={editingId ? "Persona settings" : "Create a persona"} description="Find the right person first. Then review the evidence and shape a source-backed simulation." actions={onCancel ? <Button variant="ghost" type="button" onClick={onCancel}>Back to Workshop</Button> : undefined} />
    <div className="persona-builder-grid">
      <Card className="persona-builder-card">
        {error && <p className="form-error" role="alert">{error}</p>}
        {mode === "public-research" && <div className="persona-research-steps" aria-label="Profile setup progress"><div className={step === "identify" ? "is-active" : "is-complete"}><span>1</span><strong>Identify</strong></div><i /><div className={step === "research" ? "is-active" : step === "profile" ? "is-complete" : ""}><span>2</span><strong>Research</strong></div><i /><div className={step === "profile" ? "is-active" : ""}><span>3</span><strong>Build profile</strong></div></div>}
        <div className="persona-mode-tabs" role="tablist" aria-label="Persona source mode"><button type="button" className={mode === "public-research" ? "is-active" : ""} onClick={() => { setMode("public-research"); setStep("identify"); setResearch(null); }}>Research a person</button><button type="button" className={mode === "own-material" ? "is-active" : ""} onClick={() => { setMode("own-material"); setStep("profile"); setResearch(null); }}>From my own material</button></div>
        {mode === "public-research" && step === "identify" && <section className="persona-identify-step">
          <label className="settings-field"><span>Who are you looking for?</span><input value={name} onChange={(event) => { setName(event.target.value); setMatches([]); setSelectedMatch(null); }} placeholder="Enter a name" /><small>Skai will show possible matches so you can choose the right person before it researches them.</small></label>
          <label className="settings-field"><span>Clues to narrow the search</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Rhett & Link, musician, actor, country…" /></label>
          <label className="settings-field"><span>Sources to prioritize (optional)</span><textarea value={sourceUrls} onChange={(event) => setSourceUrls(event.target.value)} placeholder="One public URL per line: interviews, podcast transcripts, official bios…" /><small>Skai also searches across biographies, conversation transcripts, interviews, and public video sources.</small></label>
          <Button type="button" onClick={() => void findPeople()} disabled={busy || !name.trim()}>{busy ? "Finding matches…" : "Find people"}</Button>
          {matches.length > 0 && <section className="persona-match-results"><div><div><p className="section-kicker">POSSIBLE MATCHES</p><h2>Choose the right person</h2></div><small>{matches.length} public search results</small></div><div className="persona-match-list">{matches.map((match) => <article key={match.id} className={selectedMatch?.id === match.id ? "is-selected" : ""}><button type="button" onClick={() => setSelectedMatch(match)}><span className="persona-match-radio" aria-hidden="true">{selectedMatch?.id === match.id ? "✓" : ""}</span><span><strong>{match.title}</strong><small>{match.snippet}</small></span></button><a href={match.url} target="_blank" rel="noreferrer">Review source ↗</a></article>)}</div>{selectedMatch && <div className="persona-match-confirm"><span>Selected source</span><strong>{selectedMatch.title}</strong><Button type="button" onClick={() => void researchSelectedPerson()} disabled={busy}>{busy ? "Researching…" : `Research ${name.trim()}`}</Button></div>}</section>}
        </section>}
        {mode === "public-research" && step === "research" && <section className="persona-research-loading"><div className="persona-research-spinner" aria-hidden="true" /><p className="section-kicker">RESEARCHING {name.toUpperCase()}</p><h2>Gathering the public record</h2><p>Checking biographies, long-form conversations, interviews, and video captions. Advertisement copy is filtered where it can be reliably detected.</p><Button variant="ghost" type="button" onClick={() => { setStep("identify"); setBusy(false); }}>Back to matches</Button></section>}
        {mode === "public-research" && step === "profile" && research && <section className="persona-evidence-summary"><div className="persona-evidence-heading"><div><p className="section-kicker">EVIDENCE REVIEW</p><h2>What we found for {name}</h2><p>{research.qualification}</p></div><StatusBadge tone={research.publicFigureQualified ? "success" : "warning"}>{research.publicFigureQualified ? "Coverage confirmed" : "Review identity"}</StatusBadge></div><div className="persona-research-counts">{researchCounts.map(([label, count]) => <article key={label}><strong>{count}</strong><span>{label}</span></article>)}</div><p className="persona-evidence-note">Transcript counts include pages that identify themselves as transcripts. Video-caption counts include captions that Skai could retrieve. Open and review sources before relying on a detail.</p><section className="persona-source-choices" aria-label="Evidence sources"><div><strong>Choose evidence to keep</strong><small>{selectedSourceUrls.length} of {sources.length} selected · unselected sources will not be saved</small></div>{sources.length ? sources.map((source) => <label key={source.url} className="persona-source-choice"><input type="checkbox" checked={selectedSourceUrls.includes(source.url)} onChange={() => toggleSource(source)} /><span><strong>{source.title || source.url}</strong><small>{source.type} · {source.authorOrPublisher || source.url}{source.publishedDate ? ` · ${source.publishedDate}` : ""}</small>{source.excerpt && <span>{source.excerpt}</span>}<em>{source.reliabilityNote}</em></span><a href={source.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>Open source</a></label>) : <p className="settings-help">No sources were returned. Go back, add a direct URL, and search again.</p>}</section><Button variant="ghost" type="button" onClick={() => { setStep("identify"); setResearch(null); setSelectedMatch(null); }}>Change person</Button></section>}
        {mode === "own-material" && <label className="settings-field"><span>Material you provide</span><textarea className="persona-material" value={material} onChange={(event) => setMaterial(event.target.value)} placeholder="Paste notes, messages, or a description of how they speak and think…" /><small>No web search is performed in this mode.</small></label>}
        {(mode === "own-material" || (mode === "public-research" && step === "profile" && research)) && <>
        <div className="persona-card-fields"><label className="settings-field"><span>Profile name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Persona name" /></label><label className="settings-field"><span>Knowledge cutoff</span><input type="date" value={cutoff} onChange={(event) => setCutoff(event.target.value)} /><small>Living people default to today. Set an earlier cutoff for an era profile.</small></label><label className="settings-field"><span>Date of death (if applicable)</span><input type="date" value={deathDate} onChange={(event) => { setDeathDate(event.target.value); if (event.target.value) setCutoff(event.target.value); }} /></label><label className="settings-field"><span>Era date (optional)</span><input type="date" value={eraDate} onChange={(event) => setEraDate(event.target.value)} /></label><label className="settings-field"><span>Roles and subjects</span><textarea value={roles} onChange={(event) => setRoles(event.target.value)} placeholder="Public work, expertise, recurring interests…" /></label><label className="settings-field"><span>Assigned voice</span><select value={voiceProfileId} onChange={(event) => setVoiceProfileId(event.target.value)}><option value="">Use Settings default voice</option>{voiceProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select><small>Uses an available app voice. Public figures’ voices are not cloned.</small></label><label className="settings-field"><span>Speech and response patterns</span><textarea value={voice} onChange={(event) => setVoice(event.target.value)} placeholder="Pacing, vocabulary, humor, conversational habits…" /></label><label className="settings-field"><span>Personality and values</span><textarea value={personality} onChange={(event) => setPersonality(event.target.value)} placeholder="Documented public traits; distinguish observation from inference…" /></label><label className="settings-field"><span>Life and career timeline</span><textarea value={timeline} onChange={(event) => setTimeline(event.target.value)} placeholder="Verified public events with dates and sources…" /></label><label className="settings-field"><span>Verified quote (optional)</span><textarea value={quoteText} onChange={(event) => setQuoteText(event.target.value)} placeholder="Only add a short quote you can cite…" /></label>{sources.length > 0 && <label className="settings-field"><span>Quote source</span><select value={quoteSourceId} onChange={(event) => setQuoteSourceId(event.target.value)}><option value="">Choose a selected source…</option>{sources.filter((source) => selectedSourceUrls.includes(source.url)).map((source) => <option key={source.url} value={source.url}>{source.title}</option>)}</select></label>}</div>
        <div className="persona-card-actions">{!editingId && <label className="persona-continuity-choice"><input type="checkbox" checked={personalContinuityEnabled} onChange={(event) => setPersonalContinuityEnabled(event.target.checked)} /><span><strong>Personal continuity</strong><small>Choose once at creation. If enabled, this persona can remember the user and ongoing context. You can review and clear those memories later.</small></span></label>}<label className="persona-continuity-choice"><input type="checkbox" checked={progressiveResearchEnabled} disabled={mode !== "public-research"} onChange={(event) => setProgressiveResearchEnabled(event.target.checked)} /><span><strong>Progressive public research</strong><small>Periodically refine public-source evidence in the background. Handcrafted personas never use web research.</small></span></label><Button type="button" onClick={() => void save()} disabled={busy || !name.trim() || (mode === "public-research" && selectedSourceUrls.length === 0)}>{busy ? "Saving…" : "Save persona"}</Button>{error && <span className="form-error" role="alert">{error}</span>}</div>
        </>}
      </Card>
      {!onSaved && <Card className="persona-library-card"><div className="panel-heading"><div><p className="section-kicker">LOCAL LIBRARY</p><h2>Saved personas</h2></div><StatusBadge tone="neutral">{personas.length} saved</StatusBadge></div>{personas.length === 0 ? <p className="settings-help">No persona cards yet. Start with your own material if the person is private or unclear.</p> : <div className="persona-library">{personas.map((persona) => <article key={persona.id} className="persona-library-item"><div><strong>{persona.name}</strong><small>{persona.sourceMode === "public-research" ? "Based on public sources" : "Based on your own material"}</small><span>AI simulation · cutoff {persona.knowledgeCutoffDate ?? "not set"}</span></div><div className="persona-library-actions"><Button variant="secondary" type="button" onClick={() => navigatePersonaWorkshop("settings", persona.id)}>Settings</Button><Button variant="ghost" type="button" onClick={() => edit(persona)}>Edit</Button><Button variant="ghost" type="button" onClick={() => void remove(persona.id)}>Remove</Button></div></article>)}</div>}</Card>}
    </div>
  </main>;
}
