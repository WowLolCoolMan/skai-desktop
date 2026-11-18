import { useCallback, useEffect, useMemo, useState } from "react";
import type { DesktopConversation, DesktopPersona, DesktopPersonaSource } from "../../../shared/contracts";
import { Button, Card, EmptyState, PageHeader, StatusBadge } from "../../components/ui/Primitives";
import { navigatePersonaWorkshop, personaWorkshopLocation, type PersonaWorkshopPage as WorkshopPage } from "../../app/navigation";
import { voiceProfiles, speakNativeResponse, waitForLocalSpeechToFinish, selectedVoiceSettings } from "../../services/nativeTts";
import { PersonasPage } from "./PersonasPage";

type ThreadMessage = { role: "user" | "assistant"; content: string };
type GroupResult = { turns?: Array<{ personaId: string; personaName: string; content: string }>; researchFindings?: Array<{ title: string; url: string; excerpt: string }> };

export function PersonaWorkshopPage({ personas: initialPersonas, endpoint, model, provider }: { personas: DesktopPersona[]; endpoint: string; model: string; provider: string }) {
  const [personas, setPersonas] = useState(initialPersonas);
  const [location, setLocation] = useState(personaWorkshopLocation);
  const [threads, setThreads] = useState<DesktopConversation[]>([]);
  const [threadLoading, setThreadLoading] = useState(true);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [research, setResearch] = useState(false);
  const [speakGroup, setSpeakGroup] = useState(false);
  const [findings, setFindings] = useState<GroupResult["researchFindings"]>([]);
  const [memory, setMemory] = useState<{ enabled: boolean; turns: Array<{ atUtc: string; role: string; content: string }> } | null>(null);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [moreResearchOpen, setMoreResearchOpen] = useState(false);
  const [moreResearchFocus, setMoreResearchFocus] = useState("");
  const [moreResearchSources, setMoreResearchSources] = useState<DesktopPersonaSource[]>([]);
  const [moreResearchBusy, setMoreResearchBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useCallback((method: string, params?: Record<string, unknown>) => window.skaiAgent.request(method, params), []);
  const refreshPersonas = useCallback(async () => {
    const response = await request("persona.list");
    if (response.ok) setPersonas((response.result as { personas?: DesktopPersona[] }).personas ?? []);
    else setError(response.error?.message ?? "Personas could not be refreshed.");
  }, [request]);
  const persona = personas.find((item) => item.id === location.personaId) ?? null;
  const activeThread = threads.find((item) => item.id === location.conversationId) ?? null;
  // The Workshop route is explicitly scoped to a persona. Keep that identity as
  // a recovery path for older or partially migrated conversation records that
  // have lost their PersonaId metadata; group threads remain metadata-only.
  const activePersonaId = activeThread && !activeThread.isPersonaGroup
    ? activeThread.personaId ?? location.personaId
    : null;
  const messages: ThreadMessage[] = (activeThread?.messages ?? []).filter((item) => item.role === "user" || item.role === "assistant").map((item) => ({ role: item.role as "user" | "assistant", content: item.content }));
  useEffect(() => {
    setDraft("");
    setFindings([]);
    setResearch(false);
    setSpeakGroup(false);
  }, [location.conversationId]);

  useEffect(() => {
    const update = () => setLocation(personaWorkshopLocation());
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);

  const loadThreads = useCallback(async (includeArchived = true) => {
    setThreadLoading(true);
    const response = await request("conversations.list", { scope: "persona", includeArchived });
    if (response.ok) { setThreads((response.result as DesktopConversation[]) ?? []); setThreadError(null); }
    else setThreadError(response.error?.message ?? "Persona conversations could not be loaded.");
    setThreadLoading(false);
  }, [request]);
  useEffect(() => { void loadThreads(); }, [loadThreads]);
  useEffect(() => { void refreshPersonas(); }, [refreshPersonas]);
  useEffect(() => { if (location.page !== "chat") setError(null); }, [location.page]);

  useEffect(() => {
    if (location.page !== "memories" || !persona) return;
    let alive = true;
    setMemory(null);
    void request("persona.memory.list", { id: persona.id }).then((response) => {
      if (!alive) return;
      if (response.ok) setMemory(response.result as typeof memory);
      else setError(response.error?.message ?? "Persona memories could not be loaded.");
    }).catch(() => { if (alive) setError("Persona memories could not be loaded."); });
    return () => { alive = false; };
  }, [location.page, persona?.id, request]);

  const open = (page: WorkshopPage, personaId: string | null = null, conversationId: string | null = null) => navigatePersonaWorkshop(page, personaId, conversationId);
  const beginThread = async (personaIds: string[], group: boolean) => {
    const selected = personas.filter((item) => personaIds.includes(item.id));
    if ((!group && selected.length !== 1) || (group && selected.length < 2)) return;
    const title = group ? (groupName.trim() || selected.map((item) => item.name).join(" + ")) : `Chat with ${selected[0].name}`;
    const response = await request("conversation.save", { title, mode: "ChatBot", responseMode: "think", model, modelProvider: provider, messages: [], ...(group ? { isPersonaGroup: true, personaIds } : { personaId: personaIds[0] }) });
    if (!response.ok) { setError(response.error?.message ?? "A persona thread could not be created."); return; }
    const id = (response.result as { id: string }).id;
    await loadThreads(false);
    open("chat", group ? null : personaIds[0], id);
  };
  const openExistingThread = (thread: DesktopConversation) => open("chat", thread.personaId ?? null, thread.id);
  const saveMessages = async (id: string, title: string, next: ThreadMessage[], personaIds: string[], group: boolean) => {
    const response = await request("conversation.save", { id, title, mode: "ChatBot", responseMode: "think", model, modelProvider: provider, messages: next, ...(group ? { isPersonaGroup: true, personaIds } : { personaId: personaIds[0] }) });
    if (!response.ok) throw new Error(response.error?.message ?? "The persona conversation could not be saved.");
    await loadThreads(false);
  };
  const persistUserMessage = async (id: string, title: string, next: ThreadMessage[], personaIds: string[], group: boolean) => {
    const response = await request("conversation.save", { id, title, mode: "ChatBot", responseMode: "think", model, modelProvider: provider, messages: next, ...(group ? { isPersonaGroup: true, personaIds } : { personaId: personaIds[0] }) });
    if (!response.ok) throw new Error(response.error?.message ?? "The persona conversation could not be saved.");
  };
  const send = async () => {
    const text = draft.trim();
    if (!text || busy || !activeThread) return;
    const isGroup = Boolean(activeThread.isPersonaGroup);
    const personaIds = isGroup ? (activeThread.personaIds ?? []) : activePersonaId ? [activePersonaId] : [];
    const participants = personas.filter((item) => personaIds.includes(item.id));
    if (!participants.length) { setError("This thread no longer has an available persona."); return; }
    const nextMessages = [...messages, { role: "user" as const, content: text }];
    setBusy(true); setError(null); setDraft("");
    try {
      await persistUserMessage(activeThread.id, activeThread.title, nextMessages, personaIds, isGroup);
      if (isGroup) {
        const promptMessages = nextMessages.map((item) => ({ role: item.role, content: item.content }));
        const response = await request("persona.group.complete", { personaIds, research, messages: promptMessages, endpoint, model });
        if (!response.ok) throw new Error(response.error?.message ?? "The persona group could not respond.");
        const result = response.result as GroupResult;
        setFindings(result.researchFindings ?? []);
        const turns = result.turns ?? [];
        const complete = [...nextMessages, ...turns.map((turn) => ({ role: "assistant" as const, content: `[${turn.personaName}]: ${turn.content}` }))];
        await saveMessages(activeThread.id, activeThread.title, complete, personaIds, true);
        if (speakGroup) for (const turn of turns) { const voiceId = participants.find((item) => item.id === turn.personaId)?.voiceProfileId; await speakNativeResponse(turn.content, true, voiceId || selectedVoiceSettings().profileId); await waitForLocalSpeechToFinish(); }
      } else {
        const currentPersona = participants[0];
        const response = await request("chat.complete", { provider, endpoint, model, personaId: currentPersona.id, messages: [...nextMessages.map((item) => ({ role: item.role, content: item.content }))], responseMode: "think" });
        if (!response.ok) throw new Error(response.error?.message ?? "The persona could not respond.");
        const result = response.result as { content: string };
        const reply = result.content ?? "";
        await saveMessages(activeThread.id, activeThread.title, [...nextMessages, { role: "assistant", content: reply }], personaIds, false);
        if (currentPersona.voiceProfileId) void speakNativeResponse(reply, true, currentPersona.voiceProfileId);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The persona response failed."); setDraft(text); }
    finally { setBusy(false); }
  };
  const clearMemory = async () => {
    if (!persona) return;
    setMemoryBusy(true);
    const response = await request("persona.memory.clear", { id: persona.id });
    if (response.ok) {
      setClearConfirm(false);
      const refreshed = await request("persona.memory.list", { id: persona.id });
      if (refreshed.ok) setMemory(refreshed.result as typeof memory);
    }
    else setError(response.error?.message ?? "Persona memories could not be cleared.");
    setMemoryBusy(false);
  };
  const findMorePersonaSources = async () => {
    if (!persona || moreResearchBusy) return;
    setMoreResearchBusy(true); setError(null); setMoreResearchSources([]);
    const response = await request("persona.research", { query: persona.name, subjectType: persona.subjectType ?? "person", notes: moreResearchFocus.trim(), sourceUrls: [] });
    if (response.ok) {
      const result = response.result as { sources?: DesktopPersonaSource[] };
      const known = new Set(persona.sources.map((source) => source.url.toLowerCase()));
      setMoreResearchSources((result.sources ?? []).filter((source) => !known.has(source.url.toLowerCase())));
    } else setError(response.error?.message ?? "More sources could not be found.");
    setMoreResearchBusy(false);
  };
  const savePersonaSource = async (source: DesktopPersonaSource) => {
    if (!persona) return;
    const response = await request("persona.source.add", { personaId: persona.id, ...source });
    if (response.ok) { await refreshPersonas(); setMoreResearchSources((items) => items.filter((item) => item.url !== source.url)); }
    else setError(response.error?.message ?? "The source could not be saved.");
  };
  const removePersonaResearch = async (source: DesktopPersonaSource, removeExcerpt: boolean) => {
    if (!persona) return;
    const affectsProfile = !persona.profileEvidenceUrls?.length || persona.profileEvidenceUrls.includes(source.url);
    const resetNotice = affectsProfile ? " The generated profile fields will also be cleared so this evidence cannot keep influencing replies; rebuild them from the remaining sources." : "";
    const action = (removeExcerpt ? "Remove this saved research excerpt? The source link will stay." : "Remove this source and its saved research excerpt from the persona?") + resetNotice;
    if (!window.confirm(action)) return;
    const response = await request("persona.source.remove", { personaId: persona.id, url: source.url, removeExcerpt });
    if (response.ok) {
      const result = response.result as { profileNeedsRebuild?: boolean };
      if (result.profileNeedsRebuild) setError("The evidence changed, so generated profile fields were cleared. Rebuild the profile before starting another persona conversation.");
      await refreshPersonas();
    }
    else setError(response.error?.message ?? "The research source could not be changed.");
  };
  const deletePersona = async () => {
    if (!persona || !window.confirm(`Remove ${persona.name} and its persona card?`)) return;
    const response = await request("persona.remove", { id: persona.id });
    if (!response.ok) { setError(response.error?.message ?? "Persona could not be removed."); return; }
    if (!(response.result as { removed?: boolean }).removed) { setError("The persona was not found, so nothing was removed."); await refreshPersonas(); return; }
    const affected = threads.filter((thread) => thread.personaId === persona.id || thread.personaIds?.includes(persona.id));
    await Promise.all(affected.map((thread) => request("conversation.metadata.save", { id: thread.id, archived: true })));
    await Promise.all([refreshPersonas(), loadThreads()]); open("library");
  };
  const toggleGroupPersona = (id: string) => setGroupIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  const threadItems = useMemo(() => threads.filter((item) => location.page === "threads" || (location.personaId ? item.personaId === location.personaId || item.personaIds?.includes(location.personaId) : true)), [threads, location.page, location.personaId]);
  const sidebar = <nav className="persona-workshop-nav" aria-label="Skai Personas pages">
    <button type="button" className={location.page === "library" ? "is-active" : ""} onClick={() => open("library")}>Persona library</button>
    <button type="button" className={location.page === "threads" ? "is-active" : ""} onClick={() => open("threads")}>All conversations <span>{threads.length}</span></button>
    <button type="button" className={location.page === "groups" ? "is-active" : ""} onClick={() => open("groups")}>Persona groups</button>
    {location.personaId && <><p>{persona?.name ?? "Selected persona"}</p>{persona && <><button type="button" className={location.page === "chat" ? "is-active" : ""} onClick={() => { const existing = threads.find((item) => item.personaId === persona.id); existing ? open("chat", persona.id, existing.id) : void beginThread([persona.id], false); }}>Chat with {persona.name}</button><button type="button" className={location.page === "settings" || location.page === "knowledge" || location.page === "memories" ? "is-active" : ""} onClick={() => open("settings", persona.id)}>Persona settings</button><button type="button" className={location.page === "memories" ? "is-active" : ""} onClick={() => open("memories", persona.id)}>Memories</button><button type="button" className={location.page === "knowledge" ? "is-active" : ""} onClick={() => open("knowledge", persona.id)}>Knowledge base</button><button type="button" onClick={() => void deletePersona()}>Remove persona</button></>}</>}
    {location.conversationId && activeThread && <><p>THIS THREAD</p><button type="button" onClick={() => { const title = window.prompt("Rename this persona conversation", activeThread.title)?.trim(); if (!title) return; void request("conversation.metadata.save", { id: activeThread.id, title }).then((response) => { if (response.ok) void loadThreads(); else setError(response.error?.message ?? "The conversation could not be renamed."); }); }}>Rename conversation</button><button type="button" onClick={() => { if (!window.confirm("Remove this persona conversation?")) return; void request("conversation.metadata.save", { id: activeThread.id, archived: true }).then((response) => { if (response.ok) { void loadThreads(false); open("threads"); } else setError(response.error?.message ?? "The conversation could not be archived."); }); }}>Remove from Workshop</button></>}
  </nav>;

  let content;
  if (location.page === "create" || location.page === "settings") {
    content = <PersonasPage endpoint={endpoint} model={model} provider={provider} editingPersona={location.page === "settings" ? persona : null} onChanged={() => { void refreshPersonas(); void loadThreads(); }} onCancel={() => open("library", null)} onSaved={(saved) => { void refreshPersonas(); open("settings", saved.id); }} />;
  } else if (location.page === "library") {
    content = <section className="persona-workshop-content"><PageHeader eyebrow="PERSONA WORKSHOP" title="Meet your personas" description="Build a cast of characters, then give each one its own conversations, voice, memories, and reference material." />
      {personas.length ? <div className="persona-workshop-cards">{personas.map((item) => <Card className="persona-workshop-card" key={item.id}><div className="persona-workshop-card-top"><div className="persona-avatar" aria-hidden="true">{item.name.trim().slice(0, 1).toUpperCase()}</div><StatusBadge tone="neutral">{item.sourceMode === "public-research" ? "Research based" : "Your material"}</StatusBadge></div><h2>{item.name}</h2><p>{item.roles || item.personality || "A persona ready for a conversation."}</p><div className="persona-workshop-card-meta"><span>{threads.filter((thread) => thread.personaId === item.id).length} conversations</span><span>{item.voiceProfileId ? voiceProfiles.find((voice) => voice.id === item.voiceProfileId)?.name ?? "Custom voice" : "Default voice"}</span></div><div className="persona-workshop-card-actions"><Button type="button" onClick={() => { const existing = threads.find((thread) => thread.personaId === item.id); existing ? open("chat", item.id, existing.id) : void beginThread([item.id], false); }}>Start chatting</Button><Button variant="secondary" type="button" onClick={() => open("settings", item.id)}>Open profile</Button></div></Card>)}</div> : <Card><EmptyState title="Your persona library is ready" description="Create a persona from your own material or add a carefully reviewed public research profile." action={<Button type="button" onClick={() => open("create")}>Create your first persona</Button>} /></Card>}</section>;
  } else if (location.page === "threads") {
    content = <section className="persona-workshop-content"><PageHeader eyebrow="PERSONA WORKSHOP" title="Conversations" description="Persistent threads with individual personas and groups stay here, separate from your regular Chat and Coding history." actions={<Button type="button" onClick={() => open("library")}>Choose a persona</Button>} />{threadError && <p className="form-error" role="alert">{threadError}</p>}{threadLoading ? <Card><p className="settings-help">Loading persona conversations…</p></Card> : threadItems.length ? <div className="persona-thread-list">{threadItems.map((thread) => <button key={thread.id} type="button" onClick={() => openExistingThread(thread)}><span className="persona-thread-avatar">{thread.isPersonaGroup ? "✦" : (personas.find((item) => item.id === thread.personaId)?.name ?? "P").slice(0, 1)}</span><span><strong>{thread.title}</strong><small>{thread.isPersonaGroup ? (thread.personaIds ?? []).map((id) => personas.find((item) => item.id === id)?.name ?? "Persona").join(" · ") : personas.find((item) => item.id === thread.personaId)?.name ?? "Persona"}</small></span><time>{new Date(thread.updatedAt).toLocaleDateString()}</time></button>)}</div> : <Card><EmptyState title="No persona conversations yet" description="Start chatting from a persona card or create a group conversation." action={<Button type="button" onClick={() => open("library")}>Browse personas</Button>} /></Card>}</section>;
  } else if (location.page === "groups") {
    content = <section className="persona-workshop-content"><PageHeader eyebrow="PERSONA WORKSHOP" title="Persona groups" description="Bring two or more personas into a shared conversation. Group threads persist here and never write into individual persona memories." />
      <Card className="persona-group-setup"><div><h2>Choose your cast</h2><p>Select at least two personas to start a shared thread.</p></div><div className="persona-group-picker">{personas.map((item) => <label key={item.id}><input type="checkbox" checked={groupIds.includes(item.id)} onChange={() => toggleGroupPersona(item.id)} />{item.name}</label>)}</div><label className="settings-field"><span>Group thread name</span><input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder={groupIds.map((id) => personas.find((item) => item.id === id)?.name).filter(Boolean).join(" + ") || "A conversation with the group"} /></label><label className="persona-continuity-choice"><input type="checkbox" checked={research} onChange={(event) => setResearch(event.target.checked)} /><span><strong>Research shared context</strong><small>Temporary source-backed research. It is not added to persona memories.</small></span></label><label className="persona-continuity-choice"><input type="checkbox" checked={speakGroup} onChange={(event) => setSpeakGroup(event.target.checked)} /><span><strong>Read replies aloud</strong><small>Each reply uses that persona’s assigned voice.</small></span></label><Button type="button" disabled={groupIds.length < 2} onClick={() => void beginThread(groupIds, true)}>Create group conversation</Button></Card>
      <h2 className="persona-section-heading">Saved group conversations</h2><div className="persona-thread-list">{threads.filter((thread) => thread.isPersonaGroup).length ? threads.filter((thread) => thread.isPersonaGroup).map((thread) => <button key={thread.id} type="button" onClick={() => open("chat", null, thread.id)}><span className="persona-thread-avatar">✦</span><span><strong>{thread.title}</strong><small>{(thread.personaIds ?? []).map((id) => personas.find((item) => item.id === id)?.name ?? "Persona").join(" · ")}</small></span><time>{new Date(thread.updatedAt).toLocaleDateString()}</time></button>) : <p className="settings-help">No saved group conversations yet.</p>}</div>
    </section>;
  } else if (location.page === "memories" && persona) {
    content = <section className="persona-workshop-content"><PageHeader eyebrow={`PERSONA WORKSHOP · ${persona.name}`} title="Memories" description="Review this persona’s personal continuity. Group conversations and knowledge sources are stored separately." actions={<Button variant="secondary" type="button" onClick={() => setClearConfirm(true)} disabled={!memory?.turns.length || memoryBusy}>Clear all memories</Button>} />
      {!persona.personalContinuityEnabled ? <Card><EmptyState title="Personal memories are off" description="This persona was created without personal continuity. Its profile and source material still shape conversations." /></Card> : <Card>{memoryBusy || !memory ? <p className="settings-help">Loading saved memories…</p> : memory.turns.length ? <div className="persona-memory-list">{memory.turns.map((turn, index) => <article key={`${turn.atUtc}-${index}`}><span>{turn.role === "assistant" ? persona.name : "You"}</span><time>{new Date(turn.atUtc).toLocaleString()}</time><p>{turn.content}</p></article>)}</div> : <EmptyState title="No memories saved" description="As you chat, this persona’s enabled continuity can retain recent context here." />}</Card>}
      {clearConfirm && <div className="persona-confirm-backdrop" role="presentation"><section className="persona-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="clear-memory-title"><h2 id="clear-memory-title">Clear all memories for {persona.name}?</h2><p>This permanently removes the saved personal continuity turns. The persona profile and knowledge sources stay intact.</p><div><Button variant="ghost" type="button" onClick={() => setClearConfirm(false)}>Keep memories</Button><Button variant="danger" type="button" disabled={memoryBusy} onClick={() => void clearMemory()}>{memoryBusy ? "Clearing…" : "Clear all memories"}</Button></div></section></div>}
    </section>;
  } else if (location.page === "knowledge" && persona) {
    const records = [{ label: "Profile instructions", value: persona.instructions }, { label: "Personality and values", value: persona.personality }, { label: "Roles and subjects", value: persona.roles }, { label: "Timeline", value: persona.timeline }, { label: "Provided material", value: persona.sourceMaterial }].filter((record) => record.value.trim());
    content = <section className="persona-workshop-content"><PageHeader eyebrow={`PERSONA WORKSHOP · ${persona.name}`} title="Knowledge base" description="Review the profile information and sources that shape this persona’s replies." actions={<div className="persona-knowledge-actions"><Button variant="secondary" type="button" onClick={() => { setMoreResearchOpen((open) => !open); setMoreResearchSources([]); }}>Find more sources</Button><Button type="button" onClick={() => open("settings", persona.id)}>Edit profile</Button></div>} />
      {moreResearchOpen && <Card className="persona-more-research"><div><h2>Deepen this research</h2><p>Search more public material about {persona.name}. Skai checks multiple research angles; review each result before adding it.</p></div><div className="persona-more-research-form"><input value={moreResearchFocus} onChange={(event) => setMoreResearchFocus(event.target.value)} placeholder={persona.subjectType === "character" ? "e.g. film dialogue, canon history, character arc" : "e.g. podcast interviews, long-form conversations, public speeches"} /><Button type="button" disabled={moreResearchBusy || persona.sources.length >= 32} onClick={() => void findMorePersonaSources()}>{moreResearchBusy ? "Searching sources…" : "Search more"}</Button></div>{persona.sources.length >= 32 && <p className="settings-help">This persona has reached its 32-source limit. Remove a source before adding more.</p>}{moreResearchSources.length > 0 && <div className="persona-more-research-results">{moreResearchSources.map((source) => <article key={source.url}><div><strong>{source.title}</strong><small>{source.type} · {source.authorOrPublisher || source.url}</small>{source.excerpt && <p>{source.excerpt}</p>}</div><a href={source.url} target="_blank" rel="noreferrer">Open ↗</a><Button variant="secondary" type="button" disabled={persona.sources.length >= 32} onClick={() => void savePersonaSource(source)}>Add source</Button></article>)}</div>}</Card>}
      <p className="settings-help persona-evidence-note">Removing a source or excerpt removes it from saved research. It does not automatically rewrite profile details already reviewed; use Edit profile to update those.</p><div className="persona-knowledge-grid">{records.map((record) => <Card key={record.label}><h2>{record.label}</h2><p className="persona-knowledge-copy">{record.value}</p></Card>)}<Card><h2>Reference sources <small>({persona.sources.length}/32)</small></h2>{persona.sources.length ? <ul className="persona-source-list">{persona.sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title || source.url}</a><small>{source.type} · {source.reliabilityNote}</small>{source.excerpt && <p>{source.excerpt}</p>}<div className="persona-source-actions">{source.excerpt && <Button variant="ghost" type="button" onClick={() => void removePersonaResearch(source, true)}>Remove excerpt</Button>}<Button variant="ghost" type="button" onClick={() => void removePersonaResearch(source, false)}>Remove source</Button></div></li>)}</ul> : <p className="settings-help">No external sources. This persona uses only its saved profile and your material.</p>}</Card><Card><h2>Verified quotes</h2>{persona.verifiedQuotes.length ? persona.verifiedQuotes.map((quote) => <blockquote key={quote.sourceId}>{quote.text}<cite>{quote.attribution}</cite></blockquote>) : <p className="settings-help">No verified quotes have been added.</p>}</Card></div>
    </section>;
  } else if (location.page === "chat" && activeThread) {
    const isGroup = Boolean(activeThread.isPersonaGroup);
    const participants = personas.filter((item) => isGroup ? activeThread.personaIds?.includes(item.id) : item.id === activeThread.personaId);
    content = <section className="persona-workshop-content persona-chat-content"><PageHeader eyebrow={isGroup ? "PERSONA GROUP THREAD" : `PERSONA THREAD · ${persona?.name ?? participants[0]?.name ?? "Persona"}`} title={activeThread.title} description={participants.map((item) => item.name).join(" · ")} actions={<>{!isGroup && activePersonaId && <Button type="button" onClick={() => void beginThread([activePersonaId], false)}>New thread</Button>}<Button variant="ghost" type="button" onClick={() => open("threads")}>All conversations</Button></>} />
      {isGroup && <div className="persona-thread-controls"><label><input type="checkbox" checked={research} onChange={(event) => setResearch(event.target.checked)} /> Research shared context</label><label><input type="checkbox" checked={speakGroup} onChange={(event) => setSpeakGroup(event.target.checked)} /> Read replies aloud</label></div>}
      <Card className="persona-chat-transcript">{messages.length ? messages.map((item, index) => <article className={`persona-chat-message is-${item.role}`} key={`${index}-${item.role}`}><strong>{item.role === "user" ? "You" : isGroup ? item.content.match(/^\[([^\]]+)\]:/)?.[1] ?? "Persona" : participants[0]?.name ?? "Persona"}</strong><p>{item.role === "assistant" && isGroup ? item.content.replace(/^\[[^\]]+\]:\s*/, "") : item.content}</p></article>) : <EmptyState title="Start the conversation" description="This thread is saved in Persona Workshop and stays separate from normal chats." />}{busy && <p className="settings-help">{isGroup ? "The group is replying…" : `${participants[0]?.name ?? "Your persona"} is thinking…`}</p>}{isGroup && findings?.length ? <div className="persona-group-findings"><h3>Shared research</h3>{findings.map((finding) => <article key={finding.url}><a href={finding.url} target="_blank" rel="noreferrer">{finding.title}</a><p>{finding.excerpt}</p></article>)}</div> : null}</Card>
      {error && <p className="form-error" role="alert">{error}</p>}<form className="persona-chat-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={`Message ${isGroup ? "the group" : participants[0]?.name ?? "your persona"}…`} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} /><Button type="submit" disabled={busy || !draft.trim()}>{busy ? "Replying…" : "Send"}</Button></form>
      {!isGroup && persona && <div className="persona-chat-subnav"><Button variant="ghost" type="button" onClick={() => open("settings", persona.id)}>Settings</Button><Button variant="ghost" type="button" onClick={() => open("memories", persona.id)}>Memories</Button><Button variant="ghost" type="button" onClick={() => open("knowledge", persona.id)}>Knowledge base</Button></div>}
    </section>;
  } else {
    content = <section className="persona-workshop-content"><PageHeader eyebrow="PERSONA WORKSHOP" title="Persona not found" description="This persona or conversation may have been removed." actions={<Button type="button" onClick={() => open("library")}>Back to library</Button>} /></section>;
  }

  return <main className="app-content feature-page persona-workshop-page"><header className="persona-workshop-header"><div><p className="section-kicker">SKAI PERSONAS</p><h1>Skai Personas</h1><span>Profiles, group stories, memories, and knowledge — together in one place.</span></div>{location.page !== "create" && <Button variant="ghost" type="button" onClick={() => open("create")}>＋ Create persona</Button>}</header><div className="persona-workshop-layout">{sidebar}<div className="persona-workshop-main">{content}</div></div>{error && location.page !== "chat" && <div className="persona-workshop-error" role="alert">{error}<button type="button" onClick={() => setError(null)} aria-label="Dismiss">×</button></div>}</main>;
}
