import { useState } from "react";
import type { DesktopPersona } from "../../../shared/contracts";
import { Button, Card, PageHeader } from "../../components/ui/Primitives";

export function PersonaGroupsPage({ personas, endpoint, model }: { personas: DesktopPersona[]; endpoint: string; model: string }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Array<{ name: string; content: string }>>([]);
  const [findings, setFindings] = useState<Array<{ title: string; url: string; excerpt: string }>>([]);
  const [research, setResearch] = useState(false);
  const [busy, setBusy] = useState(false);
  const request = (method: string, params?: Record<string, unknown>) => window.skaiAgent.request(method, params);
  const approveFinding = async (personaId: string, finding: { title: string; url: string; excerpt: string }) => {
    await request("persona.source.add", { personaId, title: finding.title, url: finding.url, excerpt: finding.excerpt });
  };
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const send = async () => {
    if (selected.length < 2 || !draft.trim() || busy) return;
    setBusy(true);
    const userMessage = { role: "user", content: draft.trim() };
    const response = await request("persona.group.complete", { personaIds: selected, research, messages: [...messages.map((message) => ({ role: "assistant", content: `[${message.name}]: ${message.content}` })), userMessage], endpoint, model });
    if (response.ok) {
      const result = response.result as { turns?: Array<{ personaName: string; content: string }>; researchFindings?: Array<{ title: string; url: string; excerpt: string }> };
      setFindings(result.researchFindings ?? []);
      setMessages((current) => [...current, { name: "You", content: draft.trim() }, ...(result.turns ?? []).map((turn) => ({ name: turn.personaName, content: turn.content }))]);
      setDraft("");
    }
    setBusy(false);
  };
  return <main className="app-content feature-page personas-page"><PageHeader eyebrow="EXTRAS · PERSONAS" title="Persona groups" description="Start a temporary shared simulation. Group context is isolated and is never added to individual persona memory." /><div className="persona-builder-grid"><Card><h2>Choose personas</h2><div className="persona-group-picker">{personas.map((persona) => <label key={persona.id}><input type="checkbox" checked={selected.includes(persona.id)} onChange={() => toggle(persona.id)} />{persona.name}</label>)}</div><label className="persona-continuity-choice"><input type="checkbox" checked={research} onChange={(event) => setResearch(event.target.checked)} /><span><strong>Research relationships for this group</strong><small>Uses a temporary, source-backed research branch. It does not modify persona cards.</small></span></label></Card><Card><div className="persona-group-transcript">{messages.length === 0 ? <p className="settings-help">Select at least two personas to begin a shared conversation.</p> : messages.map((message, index) => <article key={`${message.name}-${index}`}><strong>{message.name}</strong><p>{message.content}</p></article>)}</div>{findings.length > 0 && <section className="persona-group-findings"><h3>Research findings</h3><p className="settings-help">These are temporary until you explicitly add one to an individual persona.</p>{findings.map((finding) => <article key={finding.url}><strong>{finding.title}</strong><small>{finding.excerpt}</small><a href={finding.url} target="_blank" rel="noreferrer">Open source</a><div>{selected.map((personaId) => <Button key={personaId} variant="ghost" type="button" onClick={() => void approveFinding(personaId, finding)}>Save to {personas.find((persona) => persona.id === personaId)?.name ?? "persona"}</Button>)}</div></article>)}</section>}<textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Talk to the group…" /><Button type="button" onClick={() => void send()} disabled={busy || selected.length < 2 || !draft.trim()}>{busy ? "The group is responding…" : "Send to group"}</Button></Card></div></main>;
}
