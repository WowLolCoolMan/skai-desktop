import { useEffect, useRef, useState } from "react";
import type { ChatAttachment, DesktopQueuedMessage, DesktopScheduledTask, DesktopTask, LocalCapacitySnapshot, TaskEnvironment } from "../../../shared/contracts";
import type { Message, Model, Route } from "../../app/types";
import { Button, Card } from "../../components/ui/Primitives";
import { ModalDialog } from "../../components/ui/ModalDialog";
import { OverflowMenu } from "../../components/ui/OverflowMenu";
import { ModelPicker } from "../../components/ui/ModelPicker";
import { ChatMessageList } from "./ChatMessageList";
import { ChatThreadActivity } from "./ChatThreadActivity";
import { ChatComposer } from "./ChatComposer";
import { ChatTaskComposer } from "./ChatTaskComposer";
import { ChatSchedulesPanel } from "./ChatSchedulesPanel";
import type { ChatResponseMode, ConversationImportPreview } from "./useChatWorkspace";
import { useChatDraft } from "./useChatDraft";
import { ChatCapacityPopover } from "./ChatCapacityPopover";

const SKAI_WOLF_ICON = new URL("../../../../../assets/branding/skaiwolficon.png", import.meta.url).href;
type ChatPageProps = {
  workspaceTabId: string;
  capacity: LocalCapacitySnapshot | null;
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
  onTaskAction: (id: string, operation: "cancel" | "retry") => void;
  onOpenFile: (path: string) => void;
  onExport: () => void;
  onPreviewImport: () => Promise<ConversationImportPreview | null>;
  onApplyImport: (preview: ConversationImportPreview) => Promise<{ imported: number; skippedDuplicates: number; reassignedIds: number; total: number } | null>;
  onFork: () => void;
  onForkFromMessage: (index: number) => void;
  onRetryMessage: (index: number) => void;
  onEditMessage: (index: number, content: string) => Promise<boolean>;
  onTogglePinned: () => void;
  onArchive: () => void;
  onRenameConversation: (title: string) => Promise<boolean>;
  onPlanTask: (title: string, instruction: string, environment: TaskEnvironment, conversationId?: string | null, requiresApproval?: boolean, projectId?: string | null, gitHubIssueUrl?: string | null, acceptanceCriteria?: string | null) => Promise<boolean>;
  onScheduleTask: (draft: import("../../../shared/contracts").ScheduledTaskDraft) => Promise<boolean>;
  onTransitionScheduledTask: (id: string, operation: "pause" | "resume" | "cancel" | "runNow") => Promise<boolean>;
  workspaceMode?: "conversation" | "project";
  projectId?: string | null;
  worktreeAvailable?: boolean;
  onNewWorkspaceTab?: () => void;
};

export function ChatPage({ workspaceTabId, capacity, provider, model, responseMode, onResponseModeChange, endpoint, models, messages, busy, taskBusy, tasks, scheduledTasks, attachments, queuedMessages, conversationId, conversationTitle, pinned, archived, smartPromptRewritingEnabled, onRewritePrompt, onSend, onQueue, onRemoveQueued, onAttach, onFilesDropped, onRemoveAttachment, onSetAttachments, onModelChange, onStartTemporaryChat, onNavigate, onTaskAction, onOpenFile, onExport, onPreviewImport, onApplyImport, onFork, onForkFromMessage, onRetryMessage, onEditMessage, onTogglePinned, onArchive, onRenameConversation, onPlanTask, onScheduleTask, onTransitionScheduledTask, workspaceMode = "conversation", projectId, worktreeAvailable = false, onNewWorkspaceTab }: ChatPageProps) {
  const selectedModel = models.find((item) => item.model === model);
  const { draft, updateDraft, persistenceWarning: draftPersistenceWarning } = useChatDraft(workspaceTabId, conversationId, attachments, onSetAttachments);
  const [documentsOnly, setDocumentsOnly] = useState(false);
  const [temporaryChat, setTemporaryChat] = useState(false);
  const [copiedMessage, setCopiedMessage] = useState<number | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState(conversationTitle);
  const [renameBusy, setRenameBusy] = useState(false);
  const [importPreview, setImportPreview] = useState<ConversationImportPreview | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [rewriteBusy, setRewriteBusy] = useState(false);
  const [rewritePreview, setRewritePreview] = useState<{ original: string; candidate: string } | null>(null);
  const [showCodingWorkflowTools, setShowCodingWorkflowTools] = useState(false);
  const [showConversationDetails, setShowConversationDetails] = useState(false);
  const [showProjectTaskPlanner, setShowProjectTaskPlanner] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const threadTasks = tasks.filter((task) => task.conversationId === conversationId);
  useEffect(() => { if (!renameOpen) setRenameDraft(conversationTitle); }, [conversationTitle, renameOpen]);
  useEffect(() => { setDocumentsOnly(false); }, [conversationId]);
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
        if (!candidate) return;
        // A guarded rewrite returns the original draft for low-context prompts
        // and unsafe model suggestions. Send it directly instead of opening a
        // misleading review dialog.
        if (candidate.trim() === text) sendDraft(text);
        else setRewritePreview({ original: text, candidate });
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
    let copied = false;
    try { if (navigator.clipboard) { await navigator.clipboard.writeText(content); copied = true; } } catch { /* Try the protected Electron clipboard bridge below. */ }
    if (!copied) {
      try { copied = await window.skaiAgent?.clipboard?.writeText(content) ?? false; } catch { /* Clipboard access may be unavailable in this runtime. */ }
    }
    if (copied) {
      setCopiedMessage(index);
      window.setTimeout(() => setCopiedMessage((current) => current === index ? null : current), 1400);
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

  const beginConversationImport = async () => {
    if (importBusy) return;
    setImportBusy(true);
    setImportSummary(null);
    try { setImportPreview(await onPreviewImport()); }
    finally { setImportBusy(false); }
  };
  const confirmConversationImport = async () => {
    if (!importPreview || importBusy || importPreview.importCount === 0) return;
    setImportBusy(true);
    try {
      const result = await onApplyImport(importPreview);
      if (!result) return;
      setImportPreview(null);
      setImportSummary(`Imported ${result.imported} conversation${result.imported === 1 ? "" : "s"}; skipped ${result.skippedDuplicates} duplicate${result.skippedDuplicates === 1 ? "" : "s"}${result.reassignedIds ? `; reassigned ${result.reassignedIds} conflicting ID${result.reassignedIds === 1 ? "" : "s"}` : ""}.`);
    } finally { setImportBusy(false); }
  };

  const isCodingAgent = workspaceMode === "project" || responseMode === "coding";
  const activeTaskCount = threadTasks.filter((task) => task.status === "running" || task.status === "verifying").length;
  const queuedTaskCount = threadTasks.filter((task) => task.status === "queued").length;
  const changedFileCount = new Set(threadTasks.flatMap((task) => task.changedFiles ?? [])).size;
  return <div className={`feature-page chat-page ${workspaceMode === "project" ? "project-task-chat" : ""} ${isCodingAgent ? "is-coding-agent" : ""}`}>
    <div className="chat-context-bar">
      <div className="chat-heading-copy"><p className="section-kicker">{temporaryChat ? "TEMPORARY CHAT" : isCodingAgent ? "CODING AGENT" : "CHAT"}</p><strong>{conversationId ? conversationTitle : isCodingAgent ? "New coding thread" : "New chat"}</strong>{temporaryChat && <small className="chat-temporary-indicator">Temporary</small>}<span>{temporaryChat ? "This conversation won’t appear in Recents." : `Saved on this device · ${provider}`}</span></div>
      <div className="chat-header-actions">
        {!isCodingAgent && <label className="chat-response-mode" htmlFor="chat-response-mode-select"><span>Response</span><select id="chat-response-mode-select" value={responseMode} onChange={(event) => onResponseModeChange(event.target.value as ChatResponseMode)}><option value="think">Chat · balanced</option><option value="coding">Coding · implementation</option><option value="security">Security · risk review</option></select></label>}
        {isCodingAgent && workspaceMode !== "project" && <span className="coding-mode-badge">CODING AGENT</span>}
        {workspaceMode === "project" && <Button className="project-task-plan-trigger" variant={showProjectTaskPlanner ? "secondary" : "ghost"} type="button" aria-expanded={showProjectTaskPlanner} onClick={() => setShowProjectTaskPlanner((open) => !open)}>{showProjectTaskPlanner ? "Close planner" : "Plan task"}</Button>}
        {workspaceMode !== "project" && <Button variant={showConversationDetails ? "secondary" : "ghost"} type="button" aria-expanded={showConversationDetails} onClick={() => setShowConversationDetails((visible) => !visible)}>Details</Button>}
        <OverflowMenu label="Chat options" items={[{ label: temporaryChat ? "End temporary chat" : "Make temporary chat", onSelect: () => { if (!temporaryChat) onStartTemporaryChat(); setTemporaryChat((value) => !value); } }, { label: "Rename chat…", disabled: temporaryChat || !conversationId, onSelect: () => setRenameOpen(true) }, { label: "Import conversations…", onSelect: () => void beginConversationImport() }, { label: "Export conversations", onSelect: onExport }, { label: showCodingWorkflowTools ? "Hide task tools" : "Show task tools", onSelect: () => setShowCodingWorkflowTools((value) => !value) }, { label: pinned ? "Unpin chat" : "Pin chat", disabled: temporaryChat || !conversationId, onSelect: onTogglePinned }, { label: "Fork chat", disabled: temporaryChat || !conversationId, onSelect: onFork }, { label: archived ? "Unarchive chat" : "Archive chat", disabled: temporaryChat || !conversationId, onSelect: onArchive }]} />
      </div>
    </div>
    <div className={`chat-layout${messages.length === 0 ? " is-start-screen" : ""}${showCodingWorkflowTools ? " has-chat-tools" : ""}${showConversationDetails ? " has-chat-details" : ""}${threadTasks.length ? " has-thread-activity" : ""}`}>
      <main className="chat-column">
        <section className="conversation-surface" aria-label="Conversation">
          {messages.length === 0 ? (
            <div className="chat-empty-surface"><section className="chat-start-screen">
              <img src={SKAI_WOLF_ICON} alt="" /><p className="section-kicker">{isCodingAgent ? "CODING AGENT" : "SKAI DESKTOP"}</p>
              <h2>{isCodingAgent ? "What should the coding agent work on?" : "What would you like to work on?"}</h2><p>{isCodingAgent ? "Describe a change or ask the agent to inspect this project." : "Describe a task or ask a question to get started."}</p>
              {!isCodingAgent && <div className="chat-start-actions"><button type="button" onClick={() => onNavigate("projects")}><strong>Open a project</strong><span>Choose a folder and work with its files.</span></button><button type="button" onClick={() => onNavigate("models")}><strong>Choose a model</strong><span>Review models available on this computer.</span></button></div>}
            </section></div>
          ) : (
            <ChatMessageList conversationId={conversationId} messages={messages} busy={busy} model={model} copiedMessage={copiedMessage} onCopy={(content, itemIndex) => void copyMessage(content, itemIndex)} onRetry={onRetryMessage} onFork={onForkFromMessage} onEdit={onEditMessage} />
          )}
        </section>
        {workspaceMode === "project" ? <div className="project-task-planner-slot" hidden={!showProjectTaskPlanner}><ChatTaskComposer expanded={showProjectTaskPlanner} onExpand={() => setShowProjectTaskPlanner(true)} showToggle={false} busy={taskBusy === "planning"} worktreeAvailable={worktreeAvailable} onPlanTask={(title, instruction, environment, requiresApproval, gitHubIssueUrl, acceptanceCriteria) => onPlanTask(title, instruction, environment, conversationId, requiresApproval, projectId, gitHubIssueUrl, acceptanceCriteria)} /></div> : showCodingWorkflowTools && <ChatTaskComposer busy={taskBusy === "planning"} onPlanTask={(title, instruction, environment, requiresApproval, gitHubIssueUrl, acceptanceCriteria) => onPlanTask(title, instruction, environment, conversationId, requiresApproval, undefined, gitHubIssueUrl, acceptanceCriteria)} />}
        {draftPersistenceWarning && <p className="chat-draft-save-warning" role="status">{draftPersistenceWarning}</p>}
        <ChatComposer draft={draft} busy={busy} rewriteBusy={rewriteBusy} documentsOnly={documentsOnly} attachments={attachments} queuedMessages={queuedMessages} onDraftChange={updateDraft} onSubmit={submit} onQueueRemove={onRemoveQueued} onEditQueued={(index) => { const queued = queuedMessages.find((item) => item.index === index); if (!queued) return; if (queued.attachments?.length) return; updateDraft(queued.text); onRemoveQueued(index); }} onAttach={onAttach} onFilesDropped={onFilesDropped} onRemoveAttachment={onRemoveAttachment} onNavigate={onNavigate} onToggleDocumentsOnly={() => setDocumentsOnly((enabled) => !enabled)} onVoiceTranscript={submitVoiceTranscript} onAudioTranscript={(fileName, transcript) => onSetAttachments([...attachments, { fileName: `${fileName}.audio-transcript.txt`, mediaType: "text/plain", content: transcript }].slice(0, 5))} onSetAttachments={onSetAttachments} provider={provider} endpoint={endpoint} model={model} models={models} placeholder={isCodingAgent ? "Message your coding agent…" : undefined} accessLabel={isCodingAgent ? "Project access" : "Local access"} onOpenTaskPlanner={() => workspaceMode === "project" ? setShowProjectTaskPlanner(true) : setShowCodingWorkflowTools(true)} modelControl={<ModelPicker model={model} provider={provider} endpoint={endpoint} models={models} onChange={onModelChange} onOpenModels={() => onNavigate("models")} />} />
      </main>
      <aside className="chat-rail" hidden={!showConversationDetails && !showCodingWorkflowTools && !threadTasks.length}>
        {threadTasks.length > 0 && <section className="chat-activity-rail" aria-label="Task activity"><div className="chat-activity-heading"><div><p className="section-kicker">THREAD WORK</p><strong>Task activity</strong></div><span>{threadTasks.length} task{threadTasks.length === 1 ? "" : "s"}</span></div><ChatThreadActivity tasks={threadTasks} taskBusy={taskBusy} workspaceMode={workspaceMode} onTaskAction={onTaskAction} onOpenFile={onOpenFile} onNavigate={onNavigate} /></section>}
        {showConversationDetails && <>{workspaceMode !== "project" && capacity && <ChatCapacityPopover capacity={capacity} model={selectedModel} modelName={model} />}{(!isCodingAgent || showCodingWorkflowTools) && <ChatSchedulesPanel conversationId={conversationId} scheduled={scheduledTasks} busyTask={taskBusy} onSchedule={onScheduleTask} onTransition={onTransitionScheduledTask} />}{messages.length > 0 && (isCodingAgent ? <Card className="rail-card coding-context-card"><p className="section-kicker">CODING CONTEXT</p><strong>{conversationTitle}</strong><span>{messages.length} messages · {model}</span><div className="coding-context-row"><span>Changes</span><b>{changedFileCount ? `${changedFileCount} to review` : "None yet"}</b></div><div className="coding-context-row"><span>Background work</span><b>{activeTaskCount ? `${activeTaskCount} active` : queuedTaskCount ? `${queuedTaskCount} queued` : "Idle"}</b></div><div className="coding-context-row"><span>Storage</span><b>Saved locally</b></div></Card> : <Card className="rail-card chat-thread-summary"><p className="section-kicker">ACTIVE THREAD</p><strong>{conversationTitle}</strong><span>{messages.length} messages · {model}</span><small>Saved locally on this device.</small></Card>)}</>}
      </aside>
    </div>
    {importSummary && <p className="chat-import-summary" role="status">{importSummary}</p>}
    <ModalDialog open={renameOpen} onClose={() => setRenameOpen(false)} titleId="rename-conversation-title" initialFocusRef={renameInputRef}><form onSubmit={(event) => { event.preventDefault(); void renameConversation(); }}><div className="dialog-heading"><div><p className="section-kicker">CONVERSATION</p><h3 id="rename-conversation-title">Rename chat</h3><p>Use a short name that makes this thread easy to find later.</p></div><button type="button" onClick={() => setRenameOpen(false)} aria-label="Close rename dialog">×</button></div><label>Conversation name<input ref={renameInputRef} value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} maxLength={200} autoComplete="off" /></label><div className="dialog-actions"><Button variant="ghost" type="button" onClick={() => setRenameOpen(false)}>Cancel</Button><Button variant="primary" type="submit" disabled={renameBusy || !renameDraft.trim()}>{renameBusy ? "Saving…" : "Save name"}</Button></div></form></ModalDialog>
    <ModalDialog open={Boolean(importPreview)} onClose={() => { if (!importBusy) setImportPreview(null); }} titleId="conversation-import-title" className="ui-dialog conversation-import-dialog"><div className="dialog-heading"><div><p className="section-kicker">LOCAL ARCHIVE · PREVIEW</p><h3 id="conversation-import-title">Import conversations</h3><p>Review the merge plan before anything is written to this device.</p></div><button type="button" disabled={importBusy} onClick={() => setImportPreview(null)} aria-label="Close conversation import preview">×</button></div>{importPreview && <><div className="conversation-import-summary"><strong>{importPreview.fileName}</strong><dl><div><dt>Conversations in archive</dt><dd>{importPreview.total}</dd></div><div><dt>New conversations</dt><dd>{importPreview.importCount}</dd></div><div><dt>Duplicates skipped</dt><dd>{importPreview.skippedDuplicates}</dd></div><div><dt>Conflicting IDs reassigned</dt><dd>{importPreview.reassignedIds}</dd></div></dl>{importPreview.sampleTitles.length > 0 && <div><span>Examples to import</span><ul>{importPreview.sampleTitles.map((title, index) => <li key={`${title}-${index}`}>{title}</li>)}</ul></div>}{importPreview.importCount === 0 && <p>Everything in this archive already exists here. No changes are needed.</p>}<small>Imported conversations are merged into local history. Existing conversations are never overwritten; repeat imports skip duplicates.</small></div><div className="dialog-actions"><Button variant="ghost" type="button" disabled={importBusy} onClick={() => setImportPreview(null)}>Cancel</Button><Button variant="primary" type="button" disabled={importBusy || importPreview.importCount === 0} onClick={() => void confirmConversationImport()}>{importBusy ? "Importing…" : `Import ${importPreview.importCount} conversation${importPreview.importCount === 1 ? "" : "s"}`}</Button></div></>}</ModalDialog>
    <ModalDialog open={Boolean(rewritePreview)} onClose={() => setRewritePreview(null)} titleId="rewrite-prompt-title" className="ui-dialog rewrite-prompt-dialog"><div className="dialog-heading"><div><p className="section-kicker">LOCAL MODEL · REVIEW BEFORE SEND</p><h3 id="rewrite-prompt-title">Smart prompt rewrite</h3><p>Edit the suggestion, use your original draft, or cancel. Nothing is sent until you choose.</p></div><button type="button" onClick={() => setRewritePreview(null)} aria-label="Close prompt rewrite preview">×</button></div><div className="rewrite-prompt-fields"><label>Original draft<textarea value={rewritePreview?.original ?? ""} readOnly rows={4} /></label><label>Rewritten prompt<textarea value={rewritePreview?.candidate ?? ""} onChange={(event) => setRewritePreview((current) => current ? { ...current, candidate: event.target.value } : current)} maxLength={24_000} rows={7} /></label></div><div className="dialog-actions"><Button variant="ghost" type="button" onClick={() => setRewritePreview(null)}>Cancel</Button><Button variant="secondary" type="button" onClick={() => rewritePreview && sendDraft(rewritePreview.original)}>Use original</Button><Button variant="primary" type="button" disabled={!rewritePreview?.candidate.trim()} onClick={() => rewritePreview && sendDraft(rewritePreview.candidate.trim())}>Use rewritten prompt</Button></div></ModalDialog>
  </div>;
}
