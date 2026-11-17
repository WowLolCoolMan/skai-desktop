import { useEffect, useState } from "react";
import type { DesktopPersona, DesktopPersonaSource } from "../../../shared/contracts";
import { Button, Card, PageHeader, StatusBadge } from "../../components/ui/Primitives";

type ResearchResult = { publicFigureQualified: boolean; qualification: string; candidates: Array<{ id: string; name: string; description: string; evidence: string; url: string }>; sources: DesktopPersonaSource[] };

const today = () => new Date().toISOString().slice(0, 10);

export function PersonasPage({ onChanged }: { onChanged?: () => void }) {
  const [mode, setMode] = useState<"public-research" | "own-material">("public-research");
  const [personas, setPersonas] = useState<DesktopPersona[]>([]);
  const [activePersonaId, setActivePersonaId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [sourceUrls, setSourceUrls] = useState("");
  const [personalContinuityEnabled, setPersonalContinuityEnabled] = useState(false);
  const [progressiveResearchEnabled, setProgressiveResearchEnabled] = useState(true);
  const [research, setResearch] = useState<ResearchResult | null>(null);
  const [sources, setSources] = useState<DesktopPersonaSource[]>([]);
  const [roles, setRoles] = useState("");
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
      const result = response.result as { personas: DesktopPersona[]; activePersonaId?: string | null };
      setPersonas(result.personas ?? []);
      setActivePersonaId(result.activePersonaId ?? null);
    }
  };
  useEffect(() => { void load(); }, []);

  const runResearch = async () => {
    if (!name.trim() || busy) return;
    setBusy(true); setError(null); setResearch(null);
    try {
      const response = await request("persona.research", { query: name.trim(), notes: notes.trim(), sourceUrls: sourceUrls.split(/\r?\n/).map((url) => url.trim()).filter(Boolean) });
      if (!response.ok) throw new Error(response.error?.message ?? "Research could not be completed.");
      const result = response.result as ResearchResult;
      setResearch(result); setSources(result.sources ?? []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Research could not be completed."); }
    finally { setBusy(false); }
  };

  const chooseCandidate = (candidate: ResearchResult["candidates"][number]) => {
    setName(candidate.name.replace(/\s+[-|].*$/, "").trim());
    setSources((research?.sources ?? []).filter((source) => source.url === candidate.url));
  };

  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const response = await request("persona.save", { persona: { id: editingId ?? "", name: name.trim(), sourceMode: mode, isPublicFigure: mode === "public-research", personalContinuityEnabled: editingId ? undefined : personalContinuityEnabled, progressiveResearchEnabled, deathDate: deathDate || null, knowledgeCutoffDate: cutoff || today(), eraDate: eraDate || null, roles, voice, personality, timeline, instructions: notes, sourceMaterial: material, verifiedQuotes: quoteText.trim() && quoteSourceId ? [{ text: quoteText.trim(), sourceId: quoteSourceId, attribution: "Verified source excerpt" }] : [], sources } });
      if (!response.ok) throw new Error(response.error?.message ?? "Persona could not be saved.");
      setResearch(null); setSources([]); setMaterial(""); setQuoteText(""); setQuoteSourceId(""); setEditingId(null); await load(); onChanged?.();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Persona could not be saved."); }
    finally { setBusy(false); }
  };

  const activate = async (id: string | null) => {
    const response = await request("persona.activate", { id });
    if (response.ok) { setActivePersonaId(id); onChanged?.(); }
  };
  const remove = async (id: string) => {
    if (!window.confirm("Remove this persona? Its local card and supplied material will be deleted.")) return;
    const response = await request("persona.remove", { id });
    if (response.ok) { await load(); onChanged?.(); }
  };

  const edit = (persona: DesktopPersona) => {
    setEditingId(persona.id); setMode(persona.sourceMode); setName(persona.name); setCutoff(persona.knowledgeCutoffDate ?? today()); setDeathDate(persona.deathDate ?? ""); setEraDate(persona.eraDate ?? ""); setRoles(persona.roles); setVoice(persona.voice); setPersonality(persona.personality); setTimeline(persona.timeline); setNotes(persona.instructions); setMaterial(persona.sourceMaterial); setSources(persona.sources); setPersonalContinuityEnabled(persona.personalContinuityEnabled); setProgressiveResearchEnabled(persona.progressiveResearchEnabled); setQuoteText(persona.verifiedQuotes[0]?.text ?? ""); setQuoteSourceId(persona.verifiedQuotes[0]?.sourceId ?? ""); window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return <main className="app-content feature-page personas-page">
    <PageHeader eyebrow="EXTRAS · SMART PERSONAS" title="Build a persona" description="Create a clearly labeled AI simulation from public research or material you provide. Private people are never researched on the web." />
    <div className="persona-builder-grid">
      <Card className="persona-builder-card">
        <div className="persona-mode-tabs" role="tablist" aria-label="Persona source mode"><button type="button" className={mode === "public-research" ? "is-active" : ""} onClick={() => { setMode("public-research"); setResearch(null); }}>Research a public figure</button><button type="button" className={mode === "own-material" ? "is-active" : ""} onClick={() => { setMode("own-material"); setResearch(null); }}>From my own material</button></div>
        {mode === "public-research" ? <>
          <label className="settings-field"><span>Person’s name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Ada Lovelace" /><small>Add a disambiguating note if needed. Only continue when the evidence clearly identifies a public figure.</small></label>
          <label className="settings-field"><span>Disambiguation notes</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="The author, not the athlete…" /></label><label className="settings-field"><span>Prioritized public sources</span><textarea value={sourceUrls} onChange={(event) => setSourceUrls(event.target.value)} placeholder="One public URL per line (official sites, interviews, transcripts…)" /><small>Public sources are bounded and reviewed for identity and cutoff before saving.</small></label>
          <Button type="button" onClick={() => void runResearch()} disabled={busy || !name.trim()}>{busy ? "Researching…" : "Search public sources"}</Button>
          {research && <div className="persona-research-result"><StatusBadge tone={research.publicFigureQualified ? "success" : "warning"}>{research.publicFigureQualified ? "Public coverage found" : "Public status unclear"}</StatusBadge><p>{research.qualification}</p><div className="persona-candidates">{research.candidates.map((candidate) => <button type="button" key={candidate.id} onClick={() => chooseCandidate(candidate)}><strong>{candidate.name}</strong><span>{candidate.description}</span><small>{candidate.evidence}</small></button>)}</div></div>}
        </> : <label className="settings-field"><span>Material you provide</span><textarea className="persona-material" value={material} onChange={(event) => setMaterial(event.target.value)} placeholder="Paste notes, letters, messages, memories, or a description of how they spoke and thought…" /><small>No web search is performed in this mode. This is the right path for a private person or anyone whose public status is unclear.</small></label>}
        <div className="persona-card-fields"><label className="settings-field"><span>Name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Persona name" /></label><label className="settings-field"><span>Knowledge cutoff</span><input type="date" value={cutoff} onChange={(event) => setCutoff(event.target.value)} /><small>Living defaults to today. Use an earlier date for an era simulation.</small></label><label className="settings-field"><span>Date of death (if applicable)</span><input type="date" value={deathDate} onChange={(event) => { setDeathDate(event.target.value); if (event.target.value) setCutoff(event.target.value); }} /></label><label className="settings-field"><span>Era date (optional)</span><input type="date" value={eraDate} onChange={(event) => setEraDate(event.target.value)} /></label><label className="settings-field"><span>Roles and subjects</span><textarea value={roles} onChange={(event) => setRoles(event.target.value)} placeholder="Roles, work, favorite subjects…" /></label><label className="settings-field"><span>Voice</span><textarea value={voice} onChange={(event) => setVoice(event.target.value)} placeholder="Vocabulary, rhythm, humor, languages…" /></label><label className="settings-field"><span>Personality and values</span><textarea value={personality} onChange={(event) => setPersonality(event.target.value)} placeholder="Temperament, beliefs, changes over time…" /></label><label className="settings-field"><span>Life timeline</span><textarea value={timeline} onChange={(event) => setTimeline(event.target.value)} placeholder="Key events with dates…" /></label><label className="settings-field"><span>Verified quote (optional)</span><textarea value={quoteText} onChange={(event) => setQuoteText(event.target.value)} placeholder="Only paste a short quote you can cite…" /></label>{sources.length > 0 && <label className="settings-field"><span>Quote source</span><select value={quoteSourceId} onChange={(event) => setQuoteSourceId(event.target.value)}><option value="">Choose a saved source…</option>{sources.map((source) => <option key={source.url} value={source.url}>{source.title}</option>)}</select></label>}</div>
        <div className="persona-card-actions"><label className="persona-continuity-choice"><input type="checkbox" checked={personalContinuityEnabled} disabled={Boolean(editingId)} onChange={(event) => setPersonalContinuityEnabled(event.target.checked)} /><span><strong>Personal continuity</strong><small>Choose once at creation. If enabled, this persona can remember the user and ongoing context. This choice cannot be changed later.</small></span></label><label className="persona-continuity-choice"><input type="checkbox" checked={progressiveResearchEnabled} disabled={mode !== "public-research"} onChange={(event) => setProgressiveResearchEnabled(event.target.checked)} /><span><strong>Progressive public research</strong><small>Periodically refine public-source evidence in the background. Handcrafted personas never use web research.</small></span></label><Button type="button" onClick={() => void save()} disabled={busy || !name.trim()}>{busy ? "Saving…" : "Save persona card"}</Button>{error && <span className="form-error" role="alert">{error}</span>}</div>
      </Card>
      <Card className="persona-library-card"><div className="panel-heading"><div><p className="section-kicker">LOCAL LIBRARY</p><h2>Saved personas</h2></div><StatusBadge tone="neutral">{personas.length} saved</StatusBadge></div>{personas.length === 0 ? <p className="settings-help">No persona cards yet. Start with your own material if the person is private or unclear.</p> : <div className="persona-library">{personas.map((persona) => <article key={persona.id} className={persona.id === activePersonaId ? "persona-library-item is-active" : "persona-library-item"}><div><strong>{persona.name}</strong><small>{persona.sourceMode === "public-research" ? "Based on public sources" : "Based on your own material"}</small><span>AI simulation · cutoff {persona.knowledgeCutoffDate ?? "not set"}</span></div><div className="persona-library-actions"><Button variant={persona.id === activePersonaId ? "primary" : "secondary"} type="button" onClick={() => void activate(persona.id)}>{persona.id === activePersonaId ? "Active" : "Use in chat"}</Button><Button variant="ghost" type="button" onClick={() => edit(persona)}>Edit</Button><Button variant="ghost" type="button" onClick={() => void remove(persona.id)}>Remove</Button></div></article>)}</div>}</Card>
    </div>
  </main>;
}
