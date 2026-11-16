import { useEffect, useRef, useState } from "react";
import type { ChatAttachment, DesktopConversation, DesktopQueuedMessage, DesktopScheduledTask, DesktopTask, LocalCapacitySnapshot } from "../../../shared/contracts";
import type { Message, Model, Route } from "../../app/types";
import { Button, Card, EmptyState, StatusBadge } from "../../components/ui/Primitives";
import { ModalDialog } from "../../components/ui/ModalDialog";
import { OverflowMenu } from "../../components/ui/OverflowMenu";
import { ModelPicker } from "../../components/ui/ModelPicker";
import { ChatMessage } from "./ChatMessage";
import { ChatComposer } from "./ChatComposer";
import { ChatTaskComposer } from "./ChatTaskComposer";
import { ChatSchedulesPanel } from "./ChatSchedulesPanel";
import type { TaskEnvironment } from "../../../shared/contracts";
import type { ChatResponseMode } from "./useChatWorkspace";
import { loadChatDraft, saveChatDraft } from "./chatDraftStore";
import { estimateModelCapacity } from "./capacityEstimate";

const SKAI_WOLF_ICON = new URL("../../../../../assets/branding/skaiwolficon.png", import.meta.url).href;
const CHAT_SCROLL_KEY_PREFIX = "skai.chat.scroll.";
const CHAT_DRAFT_KEY_PREFIX = "skai.chat.draft.";
const LEGACY_CHAT_DRAFT_KEY = "skai.chat.draft";

function formatCapacityBytes(value: number | null | undefined) {
  if (value == null) return "Unknown";
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  return `${(value / 1024 ** 2).toFixed(0)} MB`;
}

function chatScrollKey(conversationId: string | null) {
  return `${CHAT_SCROLL_KEY_PREFIX}${conversationId ?? "new"}`;
}

function chatDraftKey(tabId: string) {
  return `${CHAT_DRAFT_KEY_PREFIX}tab.${tabId}`;
}

function readChatDraft(tabId: string, conversationId: string | null) {
  const scopedKey = chatDraftKey(tabId);
  const scoped = localStorage.getItem(scopedKey);
  if (scoped !== null) return scoped;
  const legacyKey = `${CHAT_DRAFT_KEY_PREFIX}${conversationId ?? "new"}`;
  const legacy = localStorage.getItem(legacyKey) ?? localStorage.getItem(LEGACY_CHAT_DRAFT_KEY);
  if (legacy !== null) {
    localStorage.setItem(scopedKey, legacy);
    if (legacyKey !== scopedKey) localStorage.removeItem(legacyKey);
    localStorage.removeItem(LEGACY_CHAT_DRAFT_KEY);
    return legacy;
  }
  return "";
}

type ChatPageProps = {
  workspaceTabId: string;
  capacity: LocalCapacitySnapshot | null;
  recentConversations: DesktopConversation[];
  provider: string;
  model: string;
  responseMode: ChatResponseMode;
  onResponseModeChange: (mode: ChatResponseMode) => void;
  endpoint: string;
  models: Model[];
  messages: Message[];
  busy: boolean;
  taskBusy: string | null;
  tasks: DesktopTask[];
  scheduledTasks: DesktopScheduledTask[];
  attachments: ChatAttachment[];
  queuedMessages: DesktopQueuedMessage[];
  conversationId: string | null;
  conversationTitle: string;
  pinned: boolean;
  archived: boolean;
  smartPromptRewritingEnabled: boolean;
  onRewritePrompt: (draft: string) => Promise<string | null>;
  onSend: (text: string, attachments: ChatAttachment[], documentsOnly: boolean, speakReply?: boolean, temporary?: boolean) => void;
  onStartTemporaryChat: () => void;
  onQueue: (text: string, attachments: ChatAttachment[]) => void;
  onRemoveQueued: (index: number) => void;
  onAttach: () => void;
  onFilesDropped: (files: File[]) => void;
  onRemoveAttachment: (index: number) => void;
  onSetAttachments: (attachments: ChatAttachment[]) => void;
  onModelChange: (model: Model) => void;
  onNavigate: (route: Route) => void;
  onSelectConversation: (id: string) => void;
  onNewWorkspaceTab: () => void;
  onTaskAction: (id: string, operation: "cancel" | "retry") => void;
  onExport: () => void;
  onFork: () => void;
  onForkFromMessage: (index: number) => void;
  onRetryMessage: (index: number) => void;
  onEditMessage: (index: number, content: string) => Promise<boolean>;
  onTogglePinned: () => void;
  onArchive: () => void;
  onRenameConversation: (title: string) => Promise<boolean>;
  onPlanTask: (title: string, instruction: string, environment: TaskEnvironment, conversationId?: string | null) => Promise<boolean>;
  onScheduleTask: (draft: import("../../../shared/contracts").ScheduledTaskDraft) => Promise<boolean>;
  onTransitionScheduledTask: (id: string, operation: "pause" | "resume" | "cancel" | "runNow") => Promise<boolean>;
  workspaceMode?: "conversation" | "project";
};

export function ChatPage({ workspaceTabId, capacity, recentConversations, provider, model, responseMode, onResponseModeChange, endpoint, models, messages, busy, taskBusy, tasks, scheduledTasks, attachments, queuedMessages, conversationId, conversationTitle, pinned, archived, smartPromptRewritingEnabled, onRewritePrompt, onSend, onQueue, onRemoveQueued, onAttach, onFilesDropped, onRemoveAttachment, onSetAttachments, onModelChange, onStartTemporaryChat, onNavigate, onSelectConversation, onNewWorkspaceTab, onTaskAction, onExport, onFork, onForkFromMessage, onRetryMessage, onEditMessage, onTogglePinned, onArchive, onRenameConversation, onPlanTask, onScheduleTask, onTransitionScheduledTask, workspaceMode = "conversation" }: ChatPageProps) {
  const capacityEstimate = estimateModelCapacity(models.find((item) => item.model === model), capacity);
  const [draft, setDraft] = useState(() => readChatDraft(workspaceTabId, conversationId));
  const latestDraftRef = useRef(draft);
  const updateDraft = (value: string) => { latestDraftRef.current = value; setDraft(value); };
  const [draftPersistenceWarning, setDraftPersistenceWarning] = useState<string | null>(null);
  const [documentsOnly, setDocumentsOnly] = useState(false);
  const [temporaryChat, setTemporaryChat] = useState(false);
  const [copiedMessage, setCopiedMessage] = useState<number | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState(conversationTitle);
  const [renameBusy, setRenameBusy] = useState(false);
  const [rewriteBusy, setRewriteBusy] = useState(false);
  const [rewritePreview, setRewritePreview] = useState<{ original: string; candidate: string } | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const previousConversationIdRef = useRef(conversationId);
  const restoreScrollPendingRef = useRef(false);
  const stickToLatestRef = useRef(true);
  const draftTabRef = useRef(workspaceTabId);
  const draftHydrationRef = useRef("");
  const latestAttachmentsRef = useRef(attachments);
  latestAttachmentsRef.current = attachments;
  const threadTasks = tasks.filter((task) => task.conversationId === conversationId);
  useEffect(() => {
    if (draftTabRef.current !== workspaceTabId) {
      draftTabRef.current = workspaceTabId;
      draftHydrationRef.current = "";
      const tabDraft = readChatDraft(workspaceTabId, conversationId);
      latestDraftRef.current = tabDraft;
      setDraft(tabDraft);
      onSetAttachments([]);
    }
    let active = true;
    const startingDraft = readChatDraft(workspaceTabId, conversationId);
    void loadChatDraft(workspaceTabId).then((record) => {
      if (!active || draftTabRef.current !== workspaceTabId) return;
      const restoredDraft = localStorage.getItem(chatDraftKey(workspaceTabId)) ?? record?.draft ?? latestDraftRef.current;
      if (latestDraftRef.current === startingDraft) updateDraft(restoredDraft);
      if (record) onSetAttachments(record.attachments);
      draftHydrationRef.current = workspaceTabId;
      localStorage.setItem(chatDraftKey(workspaceTabId), restoredDraft);
      void saveChatDraft({ tabId: workspaceTabId, draft: restoredDraft, attachments: record?.attachments ?? latestAttachmentsRef.current, updatedAt: Date.now() }).then((saved) => {
        if (draftTabRef.current === workspaceTabId) setDraftPersistenceWarning(saved ? null : "This draft could not be saved locally. It may be too large or local storage may be unavailable.");
      });
    });
    return () => { active = false; };
  // Hydrate only when the workspace tab changes. Draft/attachment edits are persisted below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceTabId]);
  useEffect(() => {
    localStorage.setItem(chatDraftKey(workspaceTabId), draft);
    if (draftHydrationRef.current !== workspaceTabId) return;
    const timer = window.setTimeout(() => {
      void saveChatDraft({ tabId: workspaceTabId, draft: latestDraftRef.current, attachments: latestAttachmentsRef.current, updatedAt: Date.now() }).then((saved) => {
        if (draftTabRef.current === workspaceTabId) setDraftPersistenceWarning(saved ? null : "This draft could not be saved locally. It may be too large or local storage may be unavailable.");
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draft, workspaceTabId]);
  useEffect(() => {
    if (draftHydrationRef.current !== workspaceTabId) return;
    void saveChatDraft({ tabId: workspaceTabId, draft: latestDraftRef.current, attachments, updatedAt: Date.now() }).then((saved) => {
      if (draftTabRef.current === workspaceTabId) setDraftPersistenceWarning(saved ? null : "This draft could not be saved locally. It may be too large or local storage may be unavailable.");
    });
  }, [attachments, workspaceTabId]);
  useEffect(() => { if (!renameOpen) setRenameDraft(conversationTitle); }, [conversationTitle, renameOpen]);
  useEffect(() => { setDocumentsOnly(false); }, [conversationId]);
  useEffect(() => {
    const key = chatScrollKey(conversationId);
    return () => { localStorage.setItem(key, String(Math.max(0, Math.round(messageListRef.current?.scrollTop ?? 0)))); };
  }, [conversationId]);
  useEffect(() => {
    const node = messageListRef.current;
    if (!node) return;
    const updateScrollState = () => {
      const distanceFromLatest = node.scrollHeight - node.scrollTop - node.clientHeight;
      const atLatest = distanceFromLatest < 56;
      stickToLatestRef.current = atLatest;
      setShowJumpToLatest(!atLatest && node.scrollHeight > node.clientHeight + 12);
    };
    node.addEventListener("scroll", updateScrollState, { passive: true });
    updateScrollState();
    return () => node.removeEventListener("scroll", updateScrollState);
  }, [messages.length > 0]);
  useEffect(() => {
    const conversationChanged = previousConversationIdRef.current !== conversationId;
    if (conversationChanged) {
      previousConversationIdRef.current = conversationId;
      restoreScrollPendingRef.current = true;
    }
    if (conversationChanged || restoreScrollPendingRef.current) {
      restoreScrollPendingRef.current = false;
      const saved = Number(localStorage.getItem(chatScrollKey(conversationId)) ?? "0");
      const top = Number.isFinite(saved) ? Math.max(0, saved) : 0;
      window.requestAnimationFrame(() => { if (messageListRef.current) messageListRef.current.scrollTop = top; });
      return;
    }
    if (!stickToLatestRef.current) return;
    window.requestAnimationFrame(() => { if (messageListRef.current) messageListRef.current.scrollTo({ top: messageListRef.current.scrollHeight, behavior: "smooth" }); });
  }, [conversationId, messages.length, busy]);

  const jumpToLatest = () => {
    stickToLatestRef.current = true;
    setShowJumpToLatest(false);
    messageListRef.current?.scrollTo({ top: messageListRef.current.scrollHeight, behavior: "smooth" });
  };

  const sendDraft = (text: string) => {
    onSend(text, attachments, documentsOnly, false, temporaryChat);
    updateDraft("");
    setDocumentsOnly(false);
    setRewritePreview(null);
  };

  const submit = () => {
    const text = draft.trim();
    if (rewriteBusy || (!text && attachments.length === 0) || (documentsOnly && attachments.length === 0)) return;
    if (busy) onQueue(text, attachments);
    else if (smartPromptRewritingEnabled && text) {
      setRewriteBusy(true);
      void onRewritePrompt(text).then((candidate) => {
        if (candidate) setRewritePreview({ original: text, candidate });
      }).finally(() => setRewriteBusy(false));
      return;
    } else { sendDraft(text); return; }
    updateDraft("");
    setDocumentsOnly(false);
  };

  const submitVoiceTranscript = (transcript: string) => {
    const currentDraft = draft.trim();
    const text = `${currentDraft}${currentDraft ? " " : ""}${transcript}`.trim();
    if (busy || !text || (documentsOnly && attachments.length === 0)) return false;
    onSend(text, attachments, documentsOnly, true, temporaryChat);
    updateDraft("");
    setDocumentsOnly(false);
    return true;
  };

  const copyMessage = async (content: string, index: number) => {
    if (!navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessage(index);
      window.setTimeout(() => setCopiedMessage((current) => current === index ? null : current), 1400);
    } catch {
      // Clipboard access can be unavailable in a hardened desktop context.
    }
  };

  const renameConversation = async () => {
    const title = renameDraft.trim();
    if (!title || !conversationId || renameBusy) return;
    setRenameBusy(true);
    const saved = await onRenameConversation(title);
    setRenameBusy(false);
    if (saved) setRenameOpen(false);
  };

  return <div className={`feature-page chat-page ${workspaceMode === "project" ? "project-task-chat" : ""}`}>
    <div className="chat-context-bar">
      <div><p className="section-kicker">{temporaryChat ? "TEMPORARY CHAT" : "CONVERSATION"}</p><strong>{conversationId ? conversationTitle : "New chat"}</strong><span>{temporaryChat ? "This chat stays in memory only and won’t appear in Recents." : `${provider} · saved on this device · keep the thread focused, then turn work into a reviewed task when needed.`}</span></div>
      <div className="chat-header-actions"><div className="chat-response-mode" role="group" aria-label="Conversation response mode"><span>MODE</span><div className="chat-response-mode-options">{([{ id: "think", label: "Chat" }, { id: "coding", label: "Coding" }, { id: "security", label: "Security" }] as Array<{ id: ChatResponseMode; label: string }>).map((item) => <button type="button" key={item.id} className={responseMode === item.id ? "is-active" : ""} aria-pressed={responseMode === item.id} onClick={() => onResponseModeChange(item.id)}>{item.label}</button>)}</div></div><ModelPicker model={model} provider={provider} endpoint={endpoint} models={models} onChange={onModelChange} onOpenModels={() => onNavigate("models")} /><details className="capacity-popover"><summary><StatusBadge tone={capacityEstimate.state === "room" ? "success" : capacityEstimate.state === "tight" ? "warning" : "neutral"}>Device capacity · {capacityEstimate.state === "room" ? "rough fit" : capacityEstimate.state === "tight" ? "tight" : "unknown"}</StatusBadge></summary><div className="capacity-popover-content"><strong>Local device · measurements stay here</strong><span>Selected model: {model || "None selected"}</span><span>Model size: {formatCapacityBytes(capacityEstimate.modelBytes)}</span><span>Rough startup RAM floor: {formatCapacityBytes(capacityEstimate.startupRamBytes)}</span><span>Available RAM after loaded models: {formatCapacityBytes(capacityEstimate.availableRamBytes)}</span><span>Model context: {capacityEstimate.contextLength ? `${capacityEstimate.contextLength.toLocaleString()} tokens` : "Unknown"}</span><span>CPU load: {capacity?.cpuUtilizationPercent == null ? "Unknown" : `${capacity.cpuUtilizationPercent.toFixed(0)}%`}</span><span>GPU: {capacity?.gpu?.name ?? "Not detected"}</span><span>GPU memory: {formatCapacityBytes(capacityEstimate.gpuAvailableBytes)}</span>{capacity?.runtime && <span>Loaded models: {capacity.runtime.loadedModelsKnown ? `${capacity.runtime.loadedModels.length} reported · ${formatCapacityBytes(capacity.runtime.loadedRamBytes)} RAM` : "Not reported by this runtime"}</span>}{capacity?.runtime?.airLlmReady !== null && capacity?.runtime?.airLlmReady !== undefined && <span>AirLLM readiness: {capacity.runtime.airLlmReady ? "Ready" : "Not ready"}</span>}{capacity?.scheduler && <span>Local runs: {capacity.scheduler.activeTaskCount} active · {capacity.scheduler.queuedTaskCount} queued · {capacity.scheduler.executionSlotLimit} slot</span>}{capacity?.scheduler?.queuedTaskCount ? <small>Queued coding tasks start automatically when the current local run finishes.</small> : null}<small>{capacityEstimate.note}</small>{capacity?.runtime?.loadedModelNote && <small>{capacity.runtime.loadedModelNote}</small>}{capacity?.measurementNote && <small>{capacity.measurementNote}</small>}</div></details><Button variant={temporaryChat ? "primary" : "ghost"} type="button" onClick={() => { if (!temporaryChat) onStartTemporaryChat(); setTemporaryChat((value) => !value); }}>{temporaryChat ? "Temporary · On" : "Temporary chat"}</Button><Button variant="ghost" disabled={temporaryChat || !conversationId} onClick={() => setRenameOpen(true)}>Rename</Button><Button variant="ghost" onClick={onExport}>Export</Button><OverflowMenu label="More" items={[{ label: pinned ? "Unpin chat" : "Pin chat", disabled: temporaryChat || !conversationId, onSelect: onTogglePinned }, { label: "Fork chat", disabled: temporaryChat || !conversationId, onSelect: onFork }, { label: archived ? "Unarchive chat" : "Archive chat", disabled: temporaryChat || !conversationId, onSelect: onArchive }]} /></div>
    </div>
    <div className={`chat-layout${messages.length === 0 ? " is-start-screen" : ""}`}>
      <main className="chat-column">
        <section className="conversation-surface" aria-label="Conversation">
          {threadTasks.map((task) => <article className={`thread-run-card thread-run-${task.status}`} key={task.id}><div className="thread-run-heading"><strong>{task.title}</strong><span>{task.status.replaceAll("_", " ")}</span></div>{task.resultSummary && <p>{task.resultSummary}</p>}{(task.changedFiles?.length || task.artifactLabels?.length) ? <div className="thread-run-files">{(task.changedFiles?.length ? task.changedFiles : task.artifactLabels ?? []).map((file) => <code key={file}>{file}</code>)}</div> : null}<div className="thread-run-actions">{["queued", "running", "verifying"].includes(task.status) && <Button variant="ghost" type="button" disabled={taskBusy === task.id} onClick={() => onTaskAction(task.id, "cancel")}>Stop</Button>}{["failed", "blocked"].includes(task.status) && <Button variant="secondary" type="button" disabled={taskBusy === task.id} onClick={() => onTaskAction(task.id, "retry")}>Retry</Button>}{task.status === "completed" && <Button variant="secondary" type="button" onClick={() => onNavigate("coding")}>Review changes</Button>}</div></article>)}
          {messages.length === 0 ? (
            <div className="chat-empty-surface"><section className="chat-start-screen">
              <img src={SKAI_WOLF_ICON} alt="" /><p className="section-kicker">SKAI DESKTOP</p>
              <h2>What would you like to work on?</h2><p>Start a conversation or bring a project into the thread.</p>
              <div className="chat-start-actions">
                <button type="button" onClick={onNewWorkspaceTab}><strong>New chat</strong><span>Open a fresh conversation tab</span></button>
                <button type="button" onClick={() => onNavigate("projects")}><strong>Open project</strong><span>Browse folders and coding sessions</span></button>
              </div>
              {recentConversations.filter((item) => !item.archived && item.id !== conversationId).slice(0, 4).length > 0 && <div className="chat-start-recent"><h3>Recent</h3>
                {recentConversations.filter((item) => !item.archived && item.id !== conversationId).slice(0, 4).map((item) => <button type="button" key={item.id} onClick={() => onSelectConversation(item.id)}><span>{item.title}</span><small>{item.mode === "Coding Agent" ? "Coding" : "Chat"} · {new Date(item.updatedAt).toLocaleDateString()}</small></button>)}
              </div>}
            </section></div>
          ) : (
            <><div className="message-list" ref={messageListRef}>{messages.map((message, index) => <ChatMessage key={index} message={message} index={index} model={model} busy={busy} conversationId={conversationId} copied={copiedMessage === index} onCopy={(content, itemIndex) => void copyMessage(content, itemIndex)} onRetry={onRetryMessage} onFork={onForkFromMessage} onEdit={onEditMessage} />)}{busy ? <article className="message-bubble chat-message assistant"><p className="typing">Thinking…</p></article> : null}</div>{showJumpToLatest && <div className="chat-latest-action"><Button variant="secondary" type="button" onClick={jumpToLatest}>Jump to latest ↓</Button></div>}</>
          )}
        </section>
        <ChatTaskComposer busy={taskBusy === "planning"} onPlanTask={(title, instruction, environment) => onPlanTask(title, instruction, environment, conversationId)} />
        <ChatSchedulesPanel conversationId={conversationId} scheduled={scheduledTasks} busyTask={taskBusy} onSchedule={onScheduleTask} onTransition={onTransitionScheduledTask} />
        {draftPersistenceWarning && <p className="chat-draft-save-warning" role="status">{draftPersistenceWarning}</p>}
        <ChatComposer draft={draft} busy={busy} rewriteBusy={rewriteBusy} documentsOnly={documentsOnly} attachments={attachments} queuedMessages={queuedMessages} onDraftChange={updateDraft} onSubmit={submit} onQueueRemove={onRemoveQueued} onAttach={onAttach} onFilesDropped={onFilesDropped} onRemoveAttachment={onRemoveAttachment} onNavigate={onNavigate} onToggleDocumentsOnly={() => setDocumentsOnly((enabled) => !enabled)} onVoiceTranscript={submitVoiceTranscript} onAudioTranscript={(fileName, transcript) => onSetAttachments([...attachments, { fileName: `${fileName}.audio-transcript.txt`, mediaType: "text/plain", content: transcript }].slice(0, 5))} />
      </main>
      <aside className="chat-rail">{messages.length === 0 ? <Card className="rail-card"><p className="section-kicker">QUICK START</p><button onClick={() => onNavigate("coding")} type="button"><strong>Build in a project</strong><span>Open files, terminal, and agent tasks</span></button><button onClick={() => onNavigate("images")} type="button"><strong>Create an image</strong><span>Use a local image workflow</span></button><button onClick={() => onNavigate("marketplace")} type="button"><strong>Find a model or tool</strong><span>Browse voices, image models, skills, and runtimes</span></button></Card> : <Card className="rail-card chat-thread-summary"><p className="section-kicker">ACTIVE THREAD</p><strong>{conversationTitle}</strong><span>{messages.length} messages · {model}</span><small>Saved locally on this device.</small></Card>}</aside>
    </div>
    <ModalDialog open={renameOpen} onClose={() => setRenameOpen(false)} titleId="rename-conversation-title" initialFocusRef={renameInputRef}><form onSubmit={(event) => { event.preventDefault(); void renameConversation(); }}><div className="dialog-heading"><div><p className="section-kicker">CONVERSATION</p><h3 id="rename-conversation-title">Rename chat</h3><p>Use a short name that makes this thread easy to find later.</p></div><button type="button" onClick={() => setRenameOpen(false)} aria-label="Close rename dialog">×</button></div><label>Conversation name<input ref={renameInputRef} value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} maxLength={200} autoComplete="off" /></label><div className="dialog-actions"><Button variant="ghost" type="button" onClick={() => setRenameOpen(false)}>Cancel</Button><Button variant="primary" type="submit" disabled={renameBusy || !renameDraft.trim()}>{renameBusy ? "Saving…" : "Save name"}</Button></div></form></ModalDialog>
    <ModalDialog open={Boolean(rewritePreview)} onClose={() => setRewritePreview(null)} titleId="rewrite-prompt-title" className="ui-dialog rewrite-prompt-dialog"><div className="dialog-heading"><div><p className="section-kicker">LOCAL MODEL · REVIEW BEFORE SEND</p><h3 id="rewrite-prompt-title">Smart prompt rewrite</h3><p>Edit the suggestion, use your original draft, or cancel. Nothing is sent until you choose.</p></div><button type="button" onClick={() => setRewritePreview(null)} aria-label="Close prompt rewrite preview">×</button></div><div className="rewrite-prompt-fields"><label>Original draft<textarea value={rewritePreview?.original ?? ""} readOnly rows={4} /></label><label>Rewritten prompt<textarea value={rewritePreview?.candidate ?? ""} onChange={(event) => setRewritePreview((current) => current ? { ...current, candidate: event.target.value } : current)} maxLength={24_000} rows={7} /></label></div><div className="dialog-actions"><Button variant="ghost" type="button" onClick={() => setRewritePreview(null)}>Cancel</Button><Button variant="secondary" type="button" onClick={() => rewritePreview && sendDraft(rewritePreview.original)}>Use original</Button><Button variant="primary" type="button" disabled={!rewritePreview?.candidate.trim()} onClick={() => rewritePreview && sendDraft(rewritePreview.candidate.trim())}>Use rewritten prompt</Button></div></ModalDialog>
  </div>;
}
