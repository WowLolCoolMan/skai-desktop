import { useEffect, useRef, useState } from "react";
import type { ChatAttachment, DesktopProject, DesktopQueuedMessage, DesktopScheduledTask, DesktopTask, LocalCapacitySnapshot, TaskEnvironment } from "../../../shared/contracts";
import type { Message, Model, Route } from "../../app/types";
import { Button, Card } from "../../components/ui/Primitives";
import { ModalDialog } from "../../components/ui/ModalDialog";
import { OverflowMenu } from "../../components/ui/OverflowMenu";
import { ModelPicker } from "../../components/ui/ModelPicker";
import { ChatMessageList } from "./ChatMessageList";
import "./ChatResponsiveLayout.css";
import { ChatThreadActivity } from "./ChatThreadActivity";
import { ChatComposer, type ComposerTarget } from "./ChatComposer";
import { ChatTaskComposer } from "./ChatTaskComposer";
import { ChatSchedulesPanel } from "./ChatSchedulesPanel";
import type { ChatResponseMode, ConversationImportPreview, ConversationResponseBranch } from "./useChatWorkspace";
import { useChatDraft } from "./useChatDraft";
import { ChatCapacityPopover } from "./ChatCapacityPopover";
import { ChatCollaboration } from "./ChatCollaboration";

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
  onSend: (text: string, attachments: ChatAttachment[], documentsOnly: boolean, speakReply?: boolean, temporary?: boolean, selectedToolIds?: string[]) => void;
  onStop: () => Promise<boolean>;
  onStartTemporaryChat: () => void;
  onQueue: (text: string, attachments: ChatAttachment[]) => void;
  onRemoveQueued: (index: number) => void;
  onUpdateQueued: (index: number, text: string) => Promise<boolean>;
  onMoveQueued: (fromIndex: number, toIndex: number) => Promise<boolean>;
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
  onRetryMessage: (index: number, model?: string) => void;
  onRestoreConversationMessages: (messages: Message[]) => Promise<boolean>;
  onEditMessage: (index: number, content: string, attachments: ChatAttachment[]) => Promise<boolean>;
  onTogglePinned: () => void;
  onArchive: () => void;
  onRenameConversation: (title: string) => Promise<boolean>;
  onPlanTask: (title: string, instruction: string, environment: TaskEnvironment, conversationId?: string | null, requiresApproval?: boolean, projectId?: string | null, gitHubIssueUrl?: string | null, acceptanceCriteria?: string | null) => Promise<boolean>;
  onScheduleTask: (draft: import("../../../shared/contracts").ScheduledTaskDraft) => Promise<boolean>;
  onPreviewScheduledTask: (prompt: string, workspaceMode?: "ChatBot" | "Coding Agent") => Promise<string | null>;
  onTransitionScheduledTask: (id: string, operation: "pause" | "resume" | "cancel" | "runNow") => Promise<boolean>;
  workspaceMode?: "conversation" | "project";
  projectId?: string | null;
  worktreeAvailable?: boolean;
  onNewWorkspaceTab?: () => void;
  projects: DesktopProject[];
  onOpenProject: (project: DesktopProject) => void;
};

type ConversationCheckpoint = {
  id: string;
  label: string;
  createdAtUtc: string;
  messages: Message[];
  attachmentCount: number;
};

const CHECKPOINT_STORAGE_PREFIX = "skai.conversation.checkpoints.v1:";
const RESPONSE_BRANCH_STORAGE_PREFIX = "skai.conversation.response-branches.v1:";

export function ChatPage({ workspaceTabId, capacity, provider, model, responseMode, onResponseModeChange, endpoint, models, messages, busy, taskBusy, tasks, scheduledTasks, attachments, queuedMessages, conversationId, conversationTitle, pinned, archived, smartPromptRewritingEnabled, onRewritePrompt, onSend, onStop, onQueue, onRemoveQueued, onUpdateQueued, onMoveQueued, onAttach, onFilesDropped, onRemoveAttachment, onSetAttachments, onModelChange, onStartTemporaryChat, onNavigate, onTaskAction, onOpenFile, onExport, onPreviewImport, onApplyImport, onFork, onForkFromMessage, onRetryMessage, onRestoreConversationMessages, onEditMessage, onTogglePinned, onArchive, onRenameConversation, onPlanTask, onScheduleTask, onPreviewScheduledTask, onTransitionScheduledTask, workspaceMode = "conversation", projectId, worktreeAvailable = false, onNewWorkspaceTab, projects, onOpenProject }: ChatPageProps) {
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
  const [rewriteToolIds, setRewriteToolIds] = useState<string[]>([]);
  const [checkpoints, setCheckpoints] = useState<ConversationCheckpoint[]>([]);
  const [checkpointOpen, setCheckpointOpen] = useState(false);
  const [checkpointLabelDraft, setCheckpointLabelDraft] = useState("Before next change");
  const [checkpointRestoreId, setCheckpointRestoreId] = useState<string | null>(null);
  const [checkpointRestoreBusy, setCheckpointRestoreBusy] = useState(false);
  const checkpointLabelRef = useRef<HTMLInputElement>(null);
  const [responseBranches, setResponseBranches] = useState<ConversationResponseBranch[]>([]);
  const [responseBranchesOpen, setResponseBranchesOpen] = useState(false);
  const [composerTarget, setComposerTarget] = useState<ComposerTarget>(() => {
    const stored = localStorage.getItem("skai.composer.target");
    return stored === "answer" || stored === "plan" || stored === "edit" || stored === "review" || stored === "research" || stored === "media"
      ? stored
      : responseMode === "coding" ? "edit" : responseMode === "security" ? "review" : "answer";
  });
  const [showCodingWorkflowTools, setShowCodingWorkflowTools] = useState(false);
  const [showConversationDetails, setShowConversationDetails] = useState(false);
  const [showProjectTaskPlanner, setShowProjectTaskPlanner] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const threadTasks = tasks.filter((task) => task.conversationId === conversationId);
  useEffect(() => {
    if (!conversationId) { setCheckpoints([]); setCheckpointRestoreId(null); return; }
    try {
      const parsed = JSON.parse(localStorage.getItem(`${CHECKPOINT_STORAGE_PREFIX}${conversationId}`) ?? "[]") as unknown;
      setCheckpoints(Array.isArray(parsed) ? parsed.filter((item): item is ConversationCheckpoint => Boolean(item && typeof item === "object" && typeof (item as ConversationCheckpoint).id === "string" && typeof (item as ConversationCheckpoint).label === "string" && Array.isArray((item as ConversationCheckpoint).messages))).slice(0, 8) : []);
    } catch { setCheckpoints([]); }
  }, [conversationId]);
  useEffect(() => {
    const loadBranches = () => {
      if (!conversationId) { setResponseBranches([]); return; }
      try {
        const parsed = JSON.parse(localStorage.getItem(`${RESPONSE_BRANCH_STORAGE_PREFIX}${conversationId}`) ?? "[]") as unknown;
        setResponseBranches(Array.isArray(parsed) ? parsed.filter((item): item is ConversationResponseBranch => Boolean(item && typeof item === "object" && typeof (item as ConversationResponseBranch).id === "string" && typeof (item as ConversationResponseBranch).originalContent === "string" && typeof (item as ConversationResponseBranch).alternateContent === "string")).slice(0, 8) : []);
      } catch { setResponseBranches([]); }
    };
    loadBranches();
    window.addEventListener("skai-response-branch-changed", loadBranches);
    return () => window.removeEventListener("skai-response-branch-changed", loadBranches);
  }, [conversationId]);
  useEffect(() => { if (!renameOpen) setRenameDraft(conversationTitle); }, [conversationTitle, renameOpen]);
  useEffect(() => { setDocumentsOnly(false); }, [conversationId]);
  useEffect(() => {
    if (workspaceMode === "project") setComposerTarget("edit");
    else if (responseMode === "coding") setComposerTarget("edit");
    else if (responseMode === "security") setComposerTarget("review");
  }, [responseMode, workspaceMode]);
  const changeComposerTarget = (target: ComposerTarget) => {
    setComposerTarget(target);
    localStorage.setItem("skai.composer.target", target);
    if (target === "media") {
      onNavigate("images");
      return;
    }
    if (workspaceMode === "project") return;
    if (target === "plan") onResponseModeChange("think");
    else if (target === "edit") onResponseModeChange("coding");
    else if (target === "review") onResponseModeChange("security");
    else if (target === "answer" || target === "research") onResponseModeChange("think");
  };
  const changeResponseMode = (mode: ChatResponseMode) => {
    onResponseModeChange(mode);
    const target: ComposerTarget = mode === "coding" ? "edit" : mode === "security" ? "review" : "answer";
    setComposerTarget(target);
    localStorage.setItem("skai.composer.target", target);
  };
  const sendDraft = (text: string, selectedToolIds: string[] = []) => {
    onSend(text, attachments, documentsOnly, false, temporaryChat, selectedToolIds);
    updateDraft("");
    setDocumentsOnly(false);
    setRewritePreview(null);
    setRewriteToolIds([]);
  };

  const submit = (selectedToolIds: string[] = []) => {
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
        if (candidate.trim() === text) sendDraft(text, selectedToolIds);
        else { setRewriteToolIds(selectedToolIds); setRewritePreview({ original: text, candidate }); }
      }).finally(() => setRewriteBusy(false));
      return;
    } else { sendDraft(text, selectedToolIds); return; }
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

  const persistCheckpoints = (next: ConversationCheckpoint[]) => {
    let bounded = next.slice(0, 8);
    let serialized = JSON.stringify(bounded);
    while (serialized.length > 900_000 && bounded.length > 1) {
      bounded = bounded.slice(0, -1);
      serialized = JSON.stringify(bounded);
    }
    setCheckpoints(bounded);
    if (!conversationId) return;
    try { localStorage.setItem(`${CHECKPOINT_STORAGE_PREFIX}${conversationId}`, serialized); } catch { /* Checkpoints remain visible for this session when storage is full. */ }
  };
  const createCheckpoint = () => {
    if (!conversationId || messages.length === 0) return;
    const snapshotMessages = messages.map((message) => ({ role: message.role, content: message.content, createdAtUtc: message.createdAtUtc }));
    const checkpoint: ConversationCheckpoint = {
      id: typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      label: checkpointLabelDraft.trim().slice(0, 120) || "Before next change",
      createdAtUtc: new Date().toISOString(),
      messages: snapshotMessages,
      attachmentCount: messages.reduce((count, message) => count + (message.attachments?.length ?? 0), 0),
    };
    persistCheckpoints([checkpoint, ...checkpoints].slice(0, 8));
    setCheckpointLabelDraft("Before next change");
  };
  const restoreCheckpoint = async (checkpoint: ConversationCheckpoint) => {
    if (checkpointRestoreId !== checkpoint.id) { setCheckpointRestoreId(checkpoint.id); return; }
    if (checkpointRestoreBusy || busy) return;
    setCheckpointRestoreBusy(true);
    const restored = await onRestoreConversationMessages(checkpoint.messages);
    setCheckpointRestoreBusy(false);
    if (restored) { setCheckpointRestoreId(null); setCheckpointOpen(false); }
  };
  const deleteCheckpoint = (id: string) => {
    persistCheckpoints(checkpoints.filter((checkpoint) => checkpoint.id !== id));
    if (checkpointRestoreId === id) setCheckpointRestoreId(null);
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
  const activeProject = projectId ? projects.find((project) => project.id === projectId) : null;
  const modeLabel = composerTarget === "plan" ? "Plan" : workspaceMode === "project" ? "Agent" : responseMode === "coding" ? "Coding" : responseMode === "security" ? "Review" : "Chat";
  const modeDescription = composerTarget === "plan" ? "Read-only planning · no file writes or commands" : workspaceMode === "project" ? "Project tools are available with approval" : responseMode === "coding" ? "Implementation-focused response" : responseMode === "security" ? "Risk-focused read-only review" : "Local conversation";
  const activeTaskCount = threadTasks.filter((task) => task.status === "running" || task.status === "verifying").length;
  const queuedTaskCount = threadTasks.filter((task) => task.status === "queued").length;
  const changedFileCount = new Set(threadTasks.flatMap((task) => task.changedFiles ?? [])).size;
  const composerContextItems = [
    ...threadTasks.map((task) => ({ id: `task:${task.id}`, label: task.title, detail: `${task.status} task · local task context`, shortcut: `@task:${task.title}`, prompt: `@task:${task.title}` })),
    ...scheduledTasks.slice(0, 8).map((task) => ({ id: `schedule:${task.id}`, label: task.prompt, detail: `scheduled task · ${task.status}`, shortcut: `@schedule:${task.prompt}`, prompt: `@schedule:${task.prompt}` })),
    ...(activeProject?.folderPaths ?? []).slice(0, 8).map((folderPath) => ({ id: `folder:${folderPath}`, label: folderPath.split(/[\\/]/).filter(Boolean).pop() || folderPath, detail: `Connected folder · ${folderPath}`, shortcut: `@folder:${folderPath}`, prompt: `@folder:${folderPath}` })),
    ...(conversationId ? [{ id: `chat:${conversationId}`, label: conversationTitle || "Current chat", detail: "Current conversation thread", shortcut: `@chat:${conversationTitle || "current"}`, prompt: `@chat:${conversationTitle || "current"}` }] : []),
    { id: "files", label: "Project files", detail: "Reference a file from the project viewer", shortcut: "@files", prompt: "@files" },
    { id: "folders", label: "Folders", detail: "Reference a connected project folder", shortcut: "@folders", prompt: "@folders" },
    { id: "chats", label: "Chats", detail: "Reference a saved conversation thread", shortcut: "@chats", prompt: "@chats" },
    { id: "web", label: "Web sources", detail: "Reference a web source when network access is enabled", shortcut: "@web", prompt: "@web" },
  ];
  return <div className={`feature-page chat-page ${workspaceMode === "project" ? "project-task-chat" : ""} ${isCodingAgent ? "is-coding-agent" : ""}`}>
    <div className="chat-context-bar">
      <div className="chat-heading-copy"><p className="section-kicker">{temporaryChat ? "TEMPORARY CHAT" : isCodingAgent ? "CODING AGENT" : "CHAT"}</p><strong>{conversationId ? conversationTitle : isCodingAgent ? "New coding thread" : "New chat"}</strong>{temporaryChat && <small className="chat-temporary-indicator">Temporary</small>}<span>{temporaryChat ? "This conversation won’t appear in Recents." : `Saved on this device · ${provider}`}</span><span className="chat-working-context" aria-label={`Working in ${activeProject?.name ?? (isCodingAgent ? "coding workspace" : "local workspace")}`}><b>Working in</b><strong>{activeProject?.name ?? (isCodingAgent ? "Coding workspace" : "Local workspace")}</strong><small>{modeDescription}</small></span></div>
      <div className="chat-header-actions">
        {!isCodingAgent && <label className="chat-response-mode" htmlFor="chat-response-mode-select"><span>Response</span><select id="chat-response-mode-select" value={responseMode} onChange={(event) => changeResponseMode(event.target.value as ChatResponseMode)}><option value="think">Chat · balanced</option><option value="coding">Coding · implementation</option><option value="security">Security · risk review</option></select></label>}
        {isCodingAgent && workspaceMode !== "project" && <span className="coding-mode-badge">CODING AGENT</span>}
        {workspaceMode === "project" && <Button className="project-task-plan-trigger" variant={showProjectTaskPlanner ? "secondary" : "ghost"} type="button" aria-expanded={showProjectTaskPlanner} onClick={() => setShowProjectTaskPlanner((open) => !open)}>{showProjectTaskPlanner ? "Close planner" : "Plan task"}</Button>}
        {workspaceMode !== "project" && <Button variant={showConversationDetails ? "secondary" : "ghost"} type="button" aria-expanded={showConversationDetails} onClick={() => setShowConversationDetails((visible) => !visible)}>Details</Button>}
        {conversationId && messages.length > 0 && <Button variant={checkpointOpen ? "secondary" : "ghost"} type="button" onClick={() => setCheckpointOpen(true)}>Checkpoint{checkpoints.length ? ` · ${checkpoints.length}` : ""}</Button>}
        {conversationId && responseBranches.length > 0 && <Button variant={responseBranchesOpen ? "secondary" : "ghost"} type="button" onClick={() => setResponseBranchesOpen(true)}>Compare{responseBranches.length > 1 ? ` · ${responseBranches.length}` : ""}</Button>}
        <ChatCollaboration conversationId={conversationId} title={conversationTitle} messages={messages} onAddToDraft={(text) => updateDraft(`${draft.trimEnd()}${draft.trim() ? "\n\n" : ""}${text}`)} />
        <OverflowMenu label="Chat options" items={[{ label: temporaryChat ? "End temporary chat" : "Make temporary chat", onSelect: () => { if (!temporaryChat) onStartTemporaryChat(); setTemporaryChat((value) => !value); } }, { label: "Rename chat…", disabled: temporaryChat || !conversationId, onSelect: () => setRenameOpen(true) }, { label: "Save checkpoint…", disabled: temporaryChat || !conversationId || messages.length === 0, onSelect: () => setCheckpointOpen(true) }, { label: "Compare response branches", disabled: responseBranches.length === 0, onSelect: () => setResponseBranchesOpen(true) }, { label: "Import conversations…", onSelect: () => void beginConversationImport() }, { label: "Export conversations", onSelect: onExport }, { label: showCodingWorkflowTools ? "Hide task tools" : "Show task tools", onSelect: () => setShowCodingWorkflowTools((value) => !value) }, { label: pinned ? "Unpin chat" : "Pin chat", disabled: temporaryChat || !conversationId, onSelect: onTogglePinned }, { label: "Fork chat", disabled: temporaryChat || !conversationId, onSelect: onFork }, { label: archived ? "Unarchive chat" : "Archive chat", disabled: temporaryChat || !conversationId, onSelect: onArchive }]} />
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
            <ChatMessageList conversationId={conversationId} messages={messages} busy={busy} model={model} models={models} copiedMessage={copiedMessage} onCopy={(content, itemIndex) => void copyMessage(content, itemIndex)} onRetry={onRetryMessage} onFork={onForkFromMessage} onEdit={onEditMessage} />
          )}
        </section>
        {workspaceMode === "project" ? <div className="project-task-planner-slot" hidden={!showProjectTaskPlanner}><ChatTaskComposer expanded={showProjectTaskPlanner} onExpand={() => setShowProjectTaskPlanner(true)} showToggle={false} busy={taskBusy === "planning"} worktreeAvailable={worktreeAvailable} onPlanTask={(title, instruction, environment, requiresApproval, gitHubIssueUrl, acceptanceCriteria) => onPlanTask(title, instruction, environment, conversationId, requiresApproval, projectId, gitHubIssueUrl, acceptanceCriteria)} /></div> : showCodingWorkflowTools && <ChatTaskComposer busy={taskBusy === "planning"} onPlanTask={(title, instruction, environment, requiresApproval, gitHubIssueUrl, acceptanceCriteria) => onPlanTask(title, instruction, environment, conversationId, requiresApproval, undefined, gitHubIssueUrl, acceptanceCriteria)} />}
        {draftPersistenceWarning && <p className="chat-draft-save-warning" role="status">{draftPersistenceWarning}</p>}
    <ChatComposer draft={draft} busy={busy} rewriteBusy={rewriteBusy} documentsOnly={documentsOnly} attachments={attachments} queuedMessages={queuedMessages} onDraftChange={updateDraft} onSubmit={submit} onStop={onStop} onQueueRemove={onRemoveQueued} onUpdateQueued={onUpdateQueued} onMoveQueued={onMoveQueued} onAttach={onAttach} onFilesDropped={onFilesDropped} onRemoveAttachment={onRemoveAttachment} onNavigate={onNavigate} onToggleDocumentsOnly={() => setDocumentsOnly((enabled) => !enabled)} onVoiceTranscript={submitVoiceTranscript} onAudioTranscript={(fileName, transcript) => onSetAttachments([...attachments, { fileName: `${fileName}.audio-transcript.txt`, mediaType: "text/plain", content: transcript }].slice(0, 5))} onSetAttachments={onSetAttachments} provider={provider} endpoint={endpoint} model={model} models={models} placeholder={isCodingAgent ? "Message your coding agent…" : undefined} accessLabel={isCodingAgent ? "Project access" : "Local access"} projects={projects} projectId={projectId} onOpenProject={onOpenProject} modeLabel={modeLabel} modeDescription={modeDescription} target={composerTarget} onTargetChange={changeComposerTarget} contextItems={composerContextItems} onOpenTaskPlanner={() => workspaceMode === "project" ? setShowProjectTaskPlanner(true) : setShowCodingWorkflowTools(true)} modelControl={<ModelPicker model={model} provider={provider} endpoint={endpoint} models={models} onChange={onModelChange} onOpenModels={() => onNavigate("models")} />} />
      </main>
      <aside className="chat-rail" hidden={!showConversationDetails && !showCodingWorkflowTools && !threadTasks.length}>
        {threadTasks.length > 0 && <section className="chat-activity-rail" aria-label="Task and conversation activity"><div className="chat-activity-heading"><div><p className="section-kicker">THREAD WORK</p><strong>Activity</strong></div><span>{threadTasks.length} task{threadTasks.length === 1 ? "" : "s"}</span></div><ChatThreadActivity tasks={threadTasks} messages={messages} taskBusy={taskBusy} workspaceMode={workspaceMode} onTaskAction={onTaskAction} onOpenFile={onOpenFile} onNavigate={onNavigate} /></section>}
        {showConversationDetails && <>{workspaceMode !== "project" && capacity && <ChatCapacityPopover capacity={capacity} model={selectedModel} modelName={model} />}{(!isCodingAgent || showCodingWorkflowTools) && <ChatSchedulesPanel conversationId={conversationId} scheduled={scheduledTasks} busyTask={taskBusy} onSchedule={onScheduleTask} onPreview={onPreviewScheduledTask} onTransition={onTransitionScheduledTask} />}{messages.length > 0 && (isCodingAgent ? <Card className="rail-card coding-context-card"><p className="section-kicker">CODING CONTEXT</p><strong>{conversationTitle}</strong><span>{messages.length} messages · {model}</span><div className="coding-context-row"><span>Changes</span><b>{changedFileCount ? `${changedFileCount} to review` : "None yet"}</b></div><div className="coding-context-row"><span>Background work</span><b>{activeTaskCount ? `${activeTaskCount} active` : queuedTaskCount ? `${queuedTaskCount} queued` : "Idle"}</b></div><div className="coding-context-row"><span>Storage</span><b>Saved locally</b></div></Card> : <Card className="rail-card chat-thread-summary"><p className="section-kicker">ACTIVE THREAD</p><strong>{conversationTitle}</strong><span>{messages.length} messages · {model}</span><small>Saved locally on this device.</small></Card>)}</>}
      </aside>
    </div>
    {importSummary && <p className="chat-import-summary" role="status">{importSummary}</p>}
    <ModalDialog open={responseBranchesOpen} onClose={() => setResponseBranchesOpen(false)} titleId="response-branches-title" className="ui-dialog response-branches-dialog"><div className="dialog-heading"><div><p className="section-kicker">LOCAL REVIEW</p><h3 id="response-branches-title">Compare response branches</h3><p>Retrying a turn keeps the prior answer here so you can review both outputs before choosing a direction.</p></div><button type="button" onClick={() => setResponseBranchesOpen(false)} aria-label="Close response branch comparison">×</button></div>{responseBranches.length === 0 ? <p className="conversation-checkpoints-empty">No alternate responses have been recorded for this conversation.</p> : <div className="response-branch-list" aria-label="Response branch comparisons">{responseBranches.map((branch) => <article className="response-branch-card" key={branch.id}><div className="response-branch-heading"><strong>{new Date(branch.createdAtUtc).toLocaleString()}</strong><small>Message {branch.messageIndex + 1} · {branch.originalModel} → {branch.retryModel}</small></div><div className="response-branch-columns"><section><span>Original response</span><pre>{branch.originalContent}</pre></section><section><span>Retried response</span><pre>{branch.alternateContent}</pre></section></div></article>)}</div>}</ModalDialog>
    <ModalDialog open={checkpointOpen} onClose={() => { if (!checkpointRestoreBusy) { setCheckpointOpen(false); setCheckpointRestoreId(null); } }} titleId="conversation-checkpoints-title" className="ui-dialog conversation-checkpoints-dialog" initialFocusRef={checkpointLabelRef}><div className="dialog-heading"><div><p className="section-kicker">LOCAL RECOVERY</p><h3 id="conversation-checkpoints-title">Conversation checkpoints</h3><p>Save a named transcript before a major change. Checkpoints stay on this device and never call a model.</p></div><button type="button" disabled={checkpointRestoreBusy} onClick={() => { setCheckpointOpen(false); setCheckpointRestoreId(null); }} aria-label="Close checkpoints dialog">×</button></div><form className="conversation-checkpoint-form" onSubmit={(event) => { event.preventDefault(); createCheckpoint(); }}><label>Checkpoint name<input ref={checkpointLabelRef} value={checkpointLabelDraft} onChange={(event) => setCheckpointLabelDraft(event.target.value)} maxLength={120} autoComplete="off" /></label><Button variant="primary" type="submit" disabled={!conversationId || messages.length === 0}>Save current transcript</Button></form>{checkpoints.length === 0 ? <p className="conversation-checkpoints-empty">No checkpoints yet. Save one before retrying, editing, or changing direction.</p> : <div className="conversation-checkpoint-list" aria-label="Saved conversation checkpoints">{checkpoints.map((checkpoint) => <article className="conversation-checkpoint-card" key={checkpoint.id}><div><strong>{checkpoint.label}</strong><small>{new Date(checkpoint.createdAtUtc).toLocaleString()} · {checkpoint.messages.length} messages{checkpoint.attachmentCount ? ` · ${checkpoint.attachmentCount} attachment${checkpoint.attachmentCount === 1 ? "" : "s"} omitted from the snapshot` : ""}</small></div>{checkpointRestoreId === checkpoint.id ? <div className="conversation-checkpoint-actions"><Button variant="primary" type="button" disabled={checkpointRestoreBusy || busy} onClick={() => void restoreCheckpoint(checkpoint)}>{checkpointRestoreBusy ? "Restoring…" : "Confirm restore"}</Button><Button variant="ghost" type="button" disabled={checkpointRestoreBusy} onClick={() => setCheckpointRestoreId(null)}>Cancel</Button></div> : <div className="conversation-checkpoint-actions"><Button variant="secondary" type="button" disabled={checkpointRestoreBusy || busy} onClick={() => void restoreCheckpoint(checkpoint)}>Restore</Button><Button variant="ghost" type="button" disabled={checkpointRestoreBusy} onClick={() => deleteCheckpoint(checkpoint.id)}>Delete</Button></div>}</article>)}</div>}</ModalDialog>
    <ModalDialog open={renameOpen} onClose={() => setRenameOpen(false)} titleId="rename-conversation-title" initialFocusRef={renameInputRef}><form onSubmit={(event) => { event.preventDefault(); void renameConversation(); }}><div className="dialog-heading"><div><p className="section-kicker">CONVERSATION</p><h3 id="rename-conversation-title">Rename chat</h3><p>Use a short name that makes this thread easy to find later.</p></div><button type="button" onClick={() => setRenameOpen(false)} aria-label="Close rename dialog">×</button></div><label>Conversation name<input ref={renameInputRef} value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} maxLength={200} autoComplete="off" /></label><div className="dialog-actions"><Button variant="ghost" type="button" onClick={() => setRenameOpen(false)}>Cancel</Button><Button variant="primary" type="submit" disabled={renameBusy || !renameDraft.trim()}>{renameBusy ? "Saving…" : "Save name"}</Button></div></form></ModalDialog>
    <ModalDialog open={Boolean(importPreview)} onClose={() => { if (!importBusy) setImportPreview(null); }} titleId="conversation-import-title" className="ui-dialog conversation-import-dialog"><div className="dialog-heading"><div><p className="section-kicker">LOCAL ARCHIVE · PREVIEW</p><h3 id="conversation-import-title">Import conversations</h3><p>Review the merge plan before anything is written to this device.</p></div><button type="button" disabled={importBusy} onClick={() => setImportPreview(null)} aria-label="Close conversation import preview">×</button></div>{importPreview && <><div className="conversation-import-summary"><strong>{importPreview.fileName}</strong><dl><div><dt>Conversations in archive</dt><dd>{importPreview.total}</dd></div><div><dt>New conversations</dt><dd>{importPreview.importCount}</dd></div><div><dt>Duplicates skipped</dt><dd>{importPreview.skippedDuplicates}</dd></div><div><dt>Conflicting IDs reassigned</dt><dd>{importPreview.reassignedIds}</dd></div></dl>{importPreview.sampleTitles.length > 0 && <div><span>Examples to import</span><ul>{importPreview.sampleTitles.map((title, index) => <li key={`${title}-${index}`}>{title}</li>)}</ul></div>}{importPreview.importCount === 0 && <p>Everything in this archive already exists here. No changes are needed.</p>}<small>Imported conversations are merged into local history. Existing conversations are never overwritten; repeat imports skip duplicates.</small></div><div className="dialog-actions"><Button variant="ghost" type="button" disabled={importBusy} onClick={() => setImportPreview(null)}>Cancel</Button><Button variant="primary" type="button" disabled={importBusy || importPreview.importCount === 0} onClick={() => void confirmConversationImport()}>{importBusy ? "Importing…" : `Import ${importPreview.importCount} conversation${importPreview.importCount === 1 ? "" : "s"}`}</Button></div></>}</ModalDialog>
    <ModalDialog open={Boolean(rewritePreview)} onClose={() => setRewritePreview(null)} titleId="rewrite-prompt-title" className="ui-dialog rewrite-prompt-dialog"><div className="dialog-heading"><div><p className="section-kicker">LOCAL MODEL · REVIEW BEFORE SEND</p><h3 id="rewrite-prompt-title">Smart prompt rewrite</h3><p>Edit the suggestion, use your original draft, or cancel. Nothing is sent until you choose.</p></div><button type="button" onClick={() => setRewritePreview(null)} aria-label="Close prompt rewrite preview">×</button></div><div className="rewrite-prompt-fields"><label>Original draft<textarea value={rewritePreview?.original ?? ""} readOnly rows={4} /></label><label>Rewritten prompt<textarea value={rewritePreview?.candidate ?? ""} onChange={(event) => setRewritePreview((current) => current ? { ...current, candidate: event.target.value } : current)} maxLength={24_000} rows={7} /></label></div><div className="dialog-actions"><Button variant="ghost" type="button" onClick={() => setRewritePreview(null)}>Cancel</Button><Button variant="secondary" type="button" onClick={() => rewritePreview && sendDraft(rewritePreview.original, rewriteToolIds)}>Use original</Button><Button variant="primary" type="button" disabled={!rewritePreview?.candidate.trim()} onClick={() => rewritePreview && sendDraft(rewritePreview.candidate.trim(), rewriteToolIds)}>Use rewritten prompt</Button></div></ModalDialog>
  </div>;
}
