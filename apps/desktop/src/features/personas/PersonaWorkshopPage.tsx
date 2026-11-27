import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentResponse, DesktopConversation, DesktopPersona, DesktopPersonaSource } from "../../../shared/contracts";
import { Button, Card, EmptyState, PageHeader, StatusBadge } from "../../components/ui/Primitives";
import { navigatePersonaWorkshop, personaWorkshopLocation, type PersonaWorkshopPage as WorkshopPage } from "../../app/navigation";
import { voiceProfiles, speakNativeResponse, waitForLocalSpeechToFinish, selectedVoiceSettings } from "../../services/nativeTts";
import { PersonasPage } from "./PersonasPage";

type ThreadMessage = { role: "user" | "assistant"; content: string };
type GroupResult = { turns?: Array<{ personaId: string; personaName: string; content: string }>; researchFindings?: Array<{ title: string; url: string; excerpt: string }> };

export function PersonaWorkshopPage({ personas: initialPersonas, endpoint, model, provider }: { personas: DesktopPersona[]; endpoint: string; model: string; provider: string }) {
  const [personas, setPersonas] = useState(initialPersonas);
  const [personasLoading, setPersonasLoading] = useState(true);
  const [duplicatingPersonaId, setDuplicatingPersonaId] = useState<string | null>(null);
  const [location, setLocation] = useState(personaWorkshopLocation);
  const [selectedLibraryPersonaId, setSelectedLibraryPersonaId] = useState<string | null>(null);
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
  const [personaRetentionMinutes, setPersonaRetentionMinutes] = useState(60);
  const [retentionSaving, setRetentionSaving] = useState(false);
  const [retentionStatus, setRetentionStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const request = useCallback((method: string, params?: Record<string, unknown>): Promise<AgentResponse> => window.skaiAgent?.request(method, params) ?? Promise.resolve({ v: 1, id: `persona-${method}`, ok: false, error: { code: "BRIDGE_UNAVAILABLE", message: "The Electron agent bridge is unavailable." } }), []);
  const refreshPersonas = useCallback(async () => {
    setPersonasLoading(true);
    try {
      const response = await request("persona.list");
      if (response.ok) setPersonas((response.result as { personas?: DesktopPersona[] }).personas ?? []);
      else setError(response.error?.message ?? "Personas could not be refreshed.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Personas could not be refreshed.");
    } finally { setPersonasLoading(false); }
  }, [request]);
  const persona = personas.find((item) => item.id === location.personaId) ?? null;
  const libraryPersona = personas.find((item) => item.id === selectedLibraryPersonaId) ?? personas[0] ?? null;
  const activeThread = threads.find((item) => item.id === location.conversationId) ?? null;
  // The Workshop route is explicitly scoped to a persona. Keep that identity as
  // a recovery path for older or partially migrated conversation records that
  // have lost their PersonaId metadata; group threads remain metadata-only.
  const activePersonaId = activeThread && !activeThread.isPersonaGroup
    ? activeThread.personaId ?? location.personaId
    : null;
  const messages: ThreadMessage[] = (activeThread?.messages ?? []).filter((item) => item.role === "user" || item.role === "assistant").map((item) => ({ role: item.role as "user" | "assistant", content: item.content })).filter((item, index, all) => index === 0 || !(item.role === "user" && all[index - 1].role === "user" && item.content.trim() === all[index - 1].content.trim()));
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
    try {
      const response = await request("conversations.list", { scope: "persona", includeArchived });
      if (response.ok) { setThreads((response.result as DesktopConversation[]) ?? []); setThreadError(null); }
      else setThreadError(response.error?.message ?? "Persona conversations could not be loaded.");
    } catch (reason) {
      setThreadError(reason instanceof Error ? reason.message : "Persona conversations could not be loaded.");
    } finally { setThreadLoading(false); }
  }, [request]);
  useEffect(() => { void loadThreads(); }, [loadThreads]);
  useEffect(() => { void refreshPersonas(); }, [refreshPersonas]);
  useEffect(() => {
    let active = true;
    void request("settings.get").then((response) => {
      if (!active || !response.ok) return;
      const value = (response.result as { personaConversationRetentionMinutes?: number }).personaConversationRetentionMinutes;
      if ([15, 60, 240, 1440, 10080].includes(value ?? 60)) setPersonaRetentionMinutes(value ?? 60);
    });
    return () => { active = false; };
  }, [request]);

  const updatePersonaRetention = async (value: number) => {
    const previous = personaRetentionMinutes;
    setPersonaRetentionMinutes(value); setRetentionSaving(true); setRetentionStatus("");
    try {
      const settingsResponse = await request("settings.get");
      if (!settingsResponse.ok) throw new Error(settingsResponse.error?.message ?? "Current settings could not be read.");
      const settings = settingsResponse.result as { endpoint: string; model: string; provider: string };
      const response = await request("settings.save", { endpoint: settings.endpoint, model: settings.model, provider: settings.provider, personaConversationRetentionMinutes: value });
      if (!response.ok) throw new Error(response.error?.message ?? "Retention setting could not be saved.");
      setRetentionStatus("Saved locally");
    } catch (reason) {
      setPersonaRetentionMinutes(previous);
      setRetentionStatus(reason instanceof Error ? reason.message : "Retention setting could not be saved.");
    } finally { setRetentionSaving(false); }
  };
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
    if ((!group && selected.length !== 1) || (group && selected.length < 2)) {
      setError(group ? "One or more selected personas are no longer available. Refresh the library and choose them again." : "That persona is no longer available. Refresh the library and try again.");
      await refreshPersonas();
      return;
    }
    const title = group ? (groupName.trim() || selected.map((item) => item.name).join(" + ")) : `Chat with ${selected[0].name}`;
    const response = await request("conversation.save", { title, mode: "ChatBot", responseMode: "think", model, modelProvider: provider, messages: [], ...(group ? { isPersonaGroup: true, personaIds } : { personaId: personaIds[0] }) });
    if (!response.ok) { setError(response.error?.message ?? "A persona thread could not be created."); return; }
    const saved = response.result as { id: string; updatedAt?: string };
    const id = saved.id;
    const createdThread: DesktopConversation = {
      id, title, mode: "ChatBot", responseMode: "think", model, modelProvider: provider,
      personaId: group ? null : personaIds[0], personaName: group ? "Persona group" : selected[0].name,
      personaIds: group ? [...personaIds] : [], isPersonaGroup: group, messages: [],
      updatedAt: saved.updatedAt ?? new Date().toISOString(), pinned: false, archived: false, tags: [],
    };
    setThreads((current) => [createdThread, ...current.filter((thread) => thread.id !== id)]);
    setError(null);
    open("chat", group ? null : personaIds[0], id);
    void loadThreads(false);
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
    const nextMessages = [...messages, { role: "user" as const, content: text }].filter((item, index, all) => index === 0 || !(item.role === "user" && all[index - 1].role === "user" && item.content.trim() === all[index - 1].content.trim()));
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
  const duplicatePersona = async (source: DesktopPersona) => {
    if (duplicatingPersonaId) return;
    setDuplicatingPersonaId(source.id);
    setError(null);
    const response = await request("persona.save", { persona: {
      ...source,
      id: "",
      name: `${source.name} copy`,
      personalContinuityEnabled: false,
      interactionCount: 0,
      researchPassCount: 0,
      lastResearchAtUtc: null,
      lastResearchSummary: "",
      latestDistillation: null,
      researchHistory: [],
      updatedAtUtc: new Date().toISOString(),
    } });
    if (!response.ok) {
      setError(response.error?.message ?? "The persona could not be duplicated.");
      setDuplicatingPersonaId(null);
      return;
    }
    const duplicate = (response.result as { persona?: DesktopPersona }).persona;
    if (!duplicate?.id) {
      setError("The persona was saved, but Skai did not return the new profile.");
      setDuplicatingPersonaId(null);
      return;
    }
    setPersonas((current) => [duplicate, ...current.filter((item) => item.id !== duplicate.id)]);
    setSelectedLibraryPersonaId(duplicate.id);
    setDuplicatingPersonaId(null);
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
  const retentionControl = <label className="persona-retention-setting"><span>Keep locally</span><select aria-label="Persona conversation retention" value={personaRetentionMinutes} disabled={retentionSaving} onChange={(event) => void updatePersonaRetention(Number(event.target.value))}><option value={15}>15 minutes</option><option value={60}>1 hour · default</option><option value={240}>4 hours</option><option value={1440}>1 day</option><option value={10080}>7 days</option></select>{retentionStatus && <small role="status">{retentionSaving ? "Saving…" : retentionStatus}</small>}</label>;
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
      {personas.length && libraryPersona ? <div className="persona-library-detail-layout"><nav className="persona-library-picker" aria-label="Personas">{personas.map((item) => <button type="button" key={item.id} className={item.id === libraryPersona.id ? "is-selected" : ""} aria-pressed={item.id === libraryPersona.id} onClick={() => setSelectedLibraryPersonaId(item.id)}><span className="persona-avatar" aria-hidden="true">{item.name.trim().slice(0, 1).toUpperCase()}</span><span><strong>{item.name}</strong><small>{item.roles || item.personality || "A persona ready for a conversation."}</small></span></button>)}</nav><Card className="persona-library-detail"><div className="persona-library-detail-heading"><div className="persona-avatar" aria-hidden="true">{libraryPersona.name.trim().slice(0, 1).toUpperCase()}</div><div><h2>{libraryPersona.name}</h2><p>{libraryPersona.roles || libraryPersona.personality || "A persona ready for a conversation."}</p></div><div className="persona-library-profile-actions"><Button variant="ghost" type="button" disabled={duplicatingPersonaId !== null} onClick={() => void duplicatePersona(libraryPersona)}>{duplicatingPersonaId === libraryPersona.id ? "Duplicating…" : "Duplicate"}</Button><Button variant="ghost" type="button" aria-label={`Edit ${libraryPersona.name}`} onClick={() => open("settings", libraryPersona.id)}>Edit profile</Button></div></div><dl className="persona-library-profile-fields"><div><dt>Name</dt><dd>{libraryPersona.name}</dd></div><div><dt>Description</dt><dd>{libraryPersona.roles || libraryPersona.personality || "A reusable assistant for your conversations."}</dd></div><div><dt>Instructions</dt><dd>{libraryPersona.instructions || libraryPersona.interactionStyle || "Use the saved profile and source material to guide this conversation."}</dd></div></dl><div className="persona-library-effective-scope"><strong>Conversation scope</strong><span>Uses this profile, {libraryPersona.sources.length} saved source{libraryPersona.sources.length === 1 ? "" : "s"}, and the selected chat model. No project files or tools are attached.</span><small>{libraryPersona.personalContinuityEnabled ? "Personal continuity is enabled for this persona." : "Personal continuity is off."}</small></div><div className="persona-library-start"><Button type="button" onClick={() => { const existing = threads.find((thread) => thread.personaId === libraryPersona.id); existing ? open("chat", libraryPersona.id, existing.id) : void beginThread([libraryPersona.id], false); }}>Start conversation</Button><span>Starts a new conversation using this persona. The persona applies to this conversation only.</span></div></Card></div> : <Card><EmptyState title={personasLoading ? "Loading your personas" : "Your persona library is ready"} description={personasLoading ? "Checking your saved profiles on this device." : "Create a persona from your own material or add a carefully reviewed public research profile."} action={!personasLoading && <Button type="button" onClick={() => open("create")}>Create your first persona</Button>} /></Card>}</section>;
  } else if (location.page === "threads") {
    content = <section className="persona-workshop-content"><PageHeader eyebrow="PERSONA WORKSHOP" title="Conversations" description="Persona threads stay on this device for your chosen time, then expire automatically. They are separate from regular Chat and Coding history." actions={<div className="persona-retention-header-actions">{retentionControl}<Button type="button" onClick={() => open("library")}>Choose a persona</Button></div>} />{threadError && <p className="form-error" role="alert">{threadError}</p>}{threadLoading ? <Card><p className="settings-help">Loading persona conversations…</p></Card> : threadItems.length ? <div className="persona-thread-list">{threadItems.map((thread) => <button key={thread.id} type="button" onClick={() => openExistingThread(thread)}><span className="persona-thread-avatar">{thread.isPersonaGroup ? "✦" : (personas.find((item) => item.id === thread.personaId)?.name ?? "P").slice(0, 1)}</span><span><strong>{thread.title}</strong><small>{thread.isPersonaGroup ? (thread.personaIds ?? []).map((id) => personas.find((item) => item.id === id)?.name ?? "Persona").join(" · ") : personas.find((item) => item.id === thread.personaId)?.name ?? "Persona"}</small></span><time>{new Date(thread.updatedAt).toLocaleDateString()}</time></button>)}</div> : <Card><EmptyState title="No persona conversations yet" description="Start chatting from a persona card or create a group conversation." action={<Button type="button" onClick={() => open("library")}>Browse personas</Button>} /></Card>}</section>;
  } else if (location.page === "groups") {
    content = <section className="persona-workshop-content"><PageHeader eyebrow="PERSONA WORKSHOP" title="Persona groups" description="Bring two or more personas into a shared conversation. Group threads expire with your retention setting and never write into individual persona memories." actions={retentionControl} />
      <Card className="persona-group-setup"><div><h2>Choose your cast</h2><p>Select at least two personas to start a shared thread.</p></div>{personas.length ? <><div className="persona-group-picker" role="group" aria-label="Choose personas for this conversation">{personas.map((item) => <label className={`persona-group-choice${groupIds.includes(item.id) ? " is-selected" : ""}`} key={item.id}><input type="checkbox" checked={groupIds.includes(item.id)} onChange={() => toggleGroupPersona(item.id)} /><span className="persona-group-choice-avatar" aria-hidden="true">{item.name.trim().slice(0, 1).toUpperCase()}</span><span><strong>{item.name}</strong><small>{item.roles || item.personality || "Ready to join the conversation"}</small></span></label>)}</div><p className="settings-help" role="status">{groupIds.length} selected · choose at least 2 personas</p></> : <EmptyState title="Create your first persona" description="Persona groups need at least two personas. Create profiles first, then bring them together here." action={<Button type="button" onClick={() => open("create")}>Create a persona</Button>} />}<label className="settings-field"><span>Group thread name</span><input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder={groupIds.map((id) => personas.find((item) => item.id === id)?.name).filter(Boolean).join(" + ") || "A conversation with the group"} /></label><label className="persona-continuity-choice"><input type="checkbox" checked={research} onChange={(event) => setResearch(event.target.checked)} /><span><strong>Research shared context</strong><small>Temporary source-backed research. It is not added to persona memories.</small></span></label><label className="persona-continuity-choice"><input type="checkbox" checked={speakGroup} onChange={(event) => setSpeakGroup(event.target.checked)} /><span><strong>Read replies aloud</strong><small>Each reply uses that persona’s assigned voice.</small></span></label><Button type="button" disabled={groupIds.length < 2} onClick={() => void beginThread(groupIds, true)}>Start group conversation</Button></Card>
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
      <Card className="persona-chat-transcript">{messages.length ? messages.map((item, index) => <article className={`persona-chat-message is-${item.role}`} key={`${index}-${item.role}`}><strong>{item.role === "user" ? "You" : isGroup ? item.content.match(/^\[([^\]]+)\]:/)?.[1] ?? "Persona" : participants[0]?.name ?? "Persona"}</strong><p>{item.role === "assistant" && isGroup ? item.content.replace(/^\[[^\]]+\]:\s*/, "") : item.content}</p></article>) : <EmptyState title="Start the conversation" description="This thread is saved in Persona Workshop and stays separate from normal chats." />}{busy && <p className="settings-help">{isGroup ? "The group is replying…" : `${participants[0]?.name ?? "Your persona"} is thinking…`}</p>}</Card>
      {isGroup && findings?.length ? <section className="persona-group-findings" aria-label="Shared research"><div className="persona-group-findings-header"><div><p className="section-kicker">CONTEXT</p><h3>Shared research</h3></div><span>{findings.length} sources</span></div><div className="persona-group-findings-grid">{findings.map((finding) => <article key={finding.url}><a href={finding.url} target="_blank" rel="noreferrer">{finding.title}</a><p>{finding.excerpt || "Public source selected for group context."}</p><small>{finding.url}</small></article>)}</div></section> : null}
      {error && <p className="form-error" role="alert">{error}</p>}<form className="persona-chat-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={`Message ${isGroup ? "the group" : participants[0]?.name ?? "your persona"}…`} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} /><Button type="submit" disabled={busy || !draft.trim()}>{busy ? "Replying…" : "Send"}</Button></form>
      {!isGroup && persona && <div className="persona-chat-subnav"><Button variant="ghost" type="button" onClick={() => open("settings", persona.id)}>Settings</Button><Button variant="ghost" type="button" onClick={() => open("memories", persona.id)}>Memories</Button><Button variant="ghost" type="button" onClick={() => open("knowledge", persona.id)}>Knowledge base</Button></div>}
    </section>;
  } else if ((location.page === "chat" && threadLoading) || (location.personaId && personasLoading)) {
    content = <section className="persona-workshop-content"><PageHeader eyebrow="PERSONA WORKSHOP" title="Loading your workshop" description="Checking your saved personas and conversations on this device." /><Card><p className="settings-help">Your local workshop data is loading…</p></Card></section>;
  } else if (location.page === "chat") {
    content = <section className="persona-workshop-content"><PageHeader eyebrow="PERSONA WORKSHOP" title="Conversation unavailable" description={threadError || "This persona conversation may have expired or been removed."} actions={<><Button variant="secondary" type="button" onClick={() => open("groups")}>Persona groups</Button><Button type="button" onClick={() => open("threads")}>All conversations</Button></>} /><Card><p className="settings-help">Your personas are still in the library. You can start a new group conversation there.</p></Card></section>;
  } else if (location.personaId) {
    content = <section className="persona-workshop-content"><PageHeader eyebrow="PERSONA WORKSHOP" title="Persona unavailable" description={personasLoading ? "Checking your saved personas…" : "This persona may have been removed. Your other personas and group conversations are unchanged."} actions={<><Button variant="secondary" type="button" onClick={() => open("groups")}>Persona groups</Button><Button type="button" onClick={() => open("library")}>Back to library</Button></>} /></section>;
  } else {
    content = <section className="persona-workshop-content"><PageHeader eyebrow="PERSONA WORKSHOP" title="Page unavailable" description="This Persona Workshop page is unavailable." actions={<Button type="button" onClick={() => open("library")}>Back to library</Button>} /></section>;
  }

  return <main className="app-content feature-page persona-workshop-page"><header className="persona-workshop-header"><div><p className="section-kicker">SKAI PERSONAS</p><h1>Skai Personas</h1><span>Profiles, group stories, memories, and knowledge — together in one place.</span></div>{location.page !== "create" && <Button variant="ghost" type="button" onClick={() => open("create")}>＋ Create persona</Button>}</header><div className="persona-workshop-layout">{sidebar}<div className="persona-workshop-main">{content}</div></div>{error && location.page !== "chat" && <div className="persona-workshop-error" role="alert">{error}<button type="button" onClick={() => setError(null)} aria-label="Dismiss">×</button></div>}</main>;
}
