import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import type { ChatAttachment, DesktopProject, DesktopQueuedMessage } from "../../../shared/contracts";
import type { Model, Route } from "../../app/types";
import { Button } from "../../components/ui/Primitives";
import { NavIcon } from "../../components/ui/NavIcon";
import { ModalDialog } from "../../components/ui/ModalDialog";
import { ComposerCommandMenu } from "../../components/ui/ComposerCommandMenu";
import { AttachmentList } from "./AttachmentList";
import { composerCommands, type ComposerCommand } from "./composerCommands";
import { saveVoiceSetting, stopNativeSpeech } from "../../services/nativeTts";
import { isLocalEndpoint } from "../../services/localOnly";
import { useChatComposerVoice } from "./useChatComposerVoice";
import { commandPreferencesEvent, readCommandPreferences, type CommandPreferences } from "../commands/preferences";
import "./VoiceTranscriptControls.css";
import "./ComposerIntentControls.css";
import "./VoiceTimeline.css";

export type ComposerTarget = "answer" | "edit" | "review" | "research" | "media";

const composerTargetLabels: Record<ComposerTarget, string> = {
  answer: "Answer",
  edit: "Edit",
  review: "Review",
  research: "Research",
  media: "Media",
};

const composerTargetDescriptions: Record<ComposerTarget, string> = {
  answer: "Explain or solve without changing project files.",
  edit: "Work toward an approved implementation or file change.",
  review: "Inspect for risks and findings without writing changes.",
  research: "Collect and synthesize evidence before recommending a path.",
  media: "Open Visuals Workshop for image and media generation.",
};

type RecommendedComposerTool = "files" | "audio" | "voice" | "computer" | "plan" | "marketplace";

type ComposerSkill = { id: string; name: string; description?: string; category?: string; permissions?: string[]; enabled?: boolean; source?: string };
type ComposerContextItem = { id: string; label: string; detail: string; shortcut: string; prompt: string };

const recommendedComposerTools: Record<RecommendedComposerTool, { label: string; detail: string }> = {
  files: { label: "Add files", detail: "Attach local source material" },
  audio: { label: "Transcribe audio", detail: "Use local audio transcription" },
  voice: { label: "Voice Mode", detail: "Start a hands-free local conversation" },
  computer: { label: "Computer use", detail: "Inspect or control a local display" },
  plan: { label: "Plan a task", detail: "Draft an approval-gated work plan" },
  marketplace: { label: "Browse tools", detail: "Review local skills and integrations" },
};

type ChatComposerProps = {
  draft: string;
  busy: boolean;
  rewriteBusy?: boolean;
  documentsOnly: boolean;
  attachments: ChatAttachment[];
  queuedMessages: DesktopQueuedMessage[];
  onDraftChange: (draft: string) => void;
  onSubmit: (selectedToolIds?: string[]) => void;
  onStop: () => Promise<boolean>;
  onQueueRemove: (index: number) => void;
  onUpdateQueued: (index: number, text: string) => Promise<boolean>;
  onMoveQueued: (fromIndex: number, toIndex: number) => Promise<boolean>;
  onAttach: () => void;
  onFilesDropped: (files: File[]) => void;
  onRemoveAttachment: (index: number) => void;
  onNavigate: (route: Route) => void;
  onToggleDocumentsOnly: () => void;
  onVoiceTranscript: (transcript: string) => boolean;
  onAudioTranscript: (fileName: string, transcript: string) => void;
  onSetAttachments: (attachments: ChatAttachment[]) => void;
  provider: string;
  endpoint: string;
  model: string;
  models: Model[];
  placeholder?: string;
  modelControl?: ReactNode;
  onOpenTaskPlanner?: () => void;
  accessLabel?: string;
  projects?: DesktopProject[];
  projectId?: string | null;
  onOpenProject?: (project: DesktopProject) => void;
  modeLabel?: string;
  modeDescription?: string;
  target?: ComposerTarget;
  onTargetChange?: (target: ComposerTarget) => void;
  contextItems?: ComposerContextItem[];
};

type PlannedComputerAction =
  | { action: "click"; x: number; y: number; button: "left" | "right" }
  | { action: "type"; text: string }
  | { action: "key"; key: string }
  | { action: "scroll"; x: number; y: number; delta: number };

function parsePlannedComputerAction(value: Record<string, unknown>): PlannedComputerAction {
  const coordinate = (key: "x" | "y") => {
    const number = value[key];
    if (typeof number !== "number" || !Number.isFinite(number) || number < 0 || number > 1) throw new Error("The model proposed an invalid screen coordinate. No input was sent.");
    return number;
  };
  if (value.action === "click") {
    const button = value.button === undefined ? "left" : value.button;
    if (button !== "left" && button !== "right") throw new Error("The model proposed an unsupported mouse button. No input was sent.");
    return { action: "click", x: coordinate("x"), y: coordinate("y"), button };
  }
  if (value.action === "type") {
    if (typeof value.text !== "string" || !value.text.trim() || value.text.length > 2_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value.text)) throw new Error("The model proposed invalid text. No input was sent.");
    return { action: "type", text: value.text };
  }
  if (value.action === "key") {
    const allowed = ["Enter", "Tab", "Escape", "Backspace", "Delete", "Up", "Down", "Left", "Right", "Home", "End", "PageUp", "PageDown", "Space"];
    if (typeof value.key !== "string" || !allowed.includes(value.key)) throw new Error("The model proposed an unsupported key. No input was sent.");
    return { action: "key", key: value.key };
  }
  if (value.action === "scroll") {
    if (typeof value.delta !== "number" || !Number.isFinite(value.delta) || Math.abs(value.delta) > 2_000) throw new Error("The model proposed an unsupported scroll distance. No input was sent.");
    return { action: "scroll", x: coordinate("x"), y: coordinate("y"), delta: value.delta };
  }
  throw new Error("The model proposed an unsupported action. No input was sent.");
}



export function ChatComposer({ draft, busy, rewriteBusy = false, documentsOnly, attachments, queuedMessages, onDraftChange, onSubmit, onStop, onQueueRemove, onUpdateQueued, onMoveQueued, onAttach, onFilesDropped, onRemoveAttachment, onNavigate, onToggleDocumentsOnly, onVoiceTranscript, onAudioTranscript, onSetAttachments, provider, endpoint, model, models, placeholder = "Message your model…", modelControl, onOpenTaskPlanner, accessLabel = "Local access", projects = [], projectId = null, onOpenProject, modeLabel = "Chat", modeDescription = "Local response", target = "answer", onTargetChange, contextItems = [] }: ChatComposerProps) {
  const [commandIndex, setCommandIndex] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [editingQueueIndex, setEditingQueueIndex] = useState<number | null>(null);
  const [queueEditDraft, setQueueEditDraft] = useState("");
  const [queueUpdateBusy, setQueueUpdateBusy] = useState(false);
  const [workflowPreferences, setWorkflowPreferences] = useState<CommandPreferences>(readCommandPreferences);

  const [omniOpen, setOmniOpen] = useState(false);
  const [toolPickerOpen, setToolPickerOpen] = useState(false);
  const [toolQuery, setToolQuery] = useState("");
  const [availableSkills, setAvailableSkills] = useState<ComposerSkill[]>([]);
  const [toolLoadStatus, setToolLoadStatus] = useState<string | null>(null);
  const [toolScope, setToolScope] = useState<"turn" | "persistent">("turn");
  const [oneTurnToolIds, setOneTurnToolIds] = useState<string[]>([]);
  const [persistentToolIds, setPersistentToolIds] = useState<string[]>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem("skai.composer.tools") ?? "[]");
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(0, 12) : [];
    } catch { return []; }
  });
  const [accessOpen, setAccessOpen] = useState(false);
  const [contextSnapshot, setContextSnapshot] = useState<{ draft: string; attachments: ChatAttachment[]; toolIds: string[]; persistentToolIds: string[]; capturedAt: string } | null>(null);
  const [computerOpen, setComputerOpen] = useState(false);
  const [computerScreens, setComputerScreens] = useState<Awaited<ReturnType<NonNullable<typeof window.skaiAgent.computer>['capture']>>>([]);
  const [computerScreenId, setComputerScreenId] = useState("");
  const [computerPoint, setComputerPoint] = useState<{ x: number; y: number } | null>(null);
  const [computerText, setComputerText] = useState("");
  const [computerKey, setComputerKey] = useState("Enter");
  const [computerStatus, setComputerStatus] = useState<string | null>(null);
  const [computerBusy, setComputerBusy] = useState(false);
  const [computerTask, setComputerTask] = useState("");
  const [computerSteps, setComputerSteps] = useState<string[]>([]);
  const [computerRequireApproval, setComputerRequireApproval] = useState(true);
  const [pendingComputerAction, setPendingComputerAction] = useState<PlannedComputerAction | null>(null);
  const voice = useChatComposerVoice({ draft, busy, onDraftChange, onVoiceTranscript, onAudioTranscript, onFilesDropped });
  const { voiceListening, handsFreeActive, voiceSessionStatus, voiceExpressiveness, setVoiceExpressiveness, voiceActivitySensitivity, voiceInputLevel, voiceOutputLevel, voiceError, voiceFallbackNotice, setVoiceFallbackNotice, voicePackNeeded, voicePackInstalling, audioTranscribing, voiceTurnTranscribing, voicePlaybackActive, audioTranscriptReady, audioPickerRef, whisperRecorderRef, toggleVoiceInput, toggleHandsFree, endVoiceMode, transcribeAudioFile, handleAudioDrop, installLocalSpeechPack, voiceInputDevices, voiceOutputDevices, voiceInputDeviceId, voiceOutputDeviceId, setVoiceInputDevice, setVoiceOutputDevice, voiceInteractionMode, setVoiceMode, pushToTalkHeld, startPushToTalk, stopPushToTalk, voiceCalibration, calibrateVoice, voiceTranscriptPreview, voiceSessionTranscript, voiceInterruptions, voiceAudioEvidence, voiceEvidenceRetention, updateVoiceEvidenceRetention, clearVoiceSessionEvidence, voiceReviewBeforeSend, setVoiceReview, pendingVoiceTranscript, submitReviewedVoiceTranscript, discardReviewedVoiceTranscript, voicePaused, pauseVoiceMode, voicePreflight, checkVoicePreflight } = voice;
  const computerStopRef = useRef(false);
  const computerApprovalResolver = useRef<((approved: boolean) => void) | null>(null);
  const draftTextareaRef = useRef<HTMLTextAreaElement>(null);
  const draftSelectionRef = useRef({ start: draft.length, end: draft.length });
  const attachmentCountRef = useRef(attachments.length);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const accessMenuRef = useRef<HTMLDivElement>(null);
  const addTriggerRef = useRef<HTMLButtonElement>(null);
  const accessTriggerRef = useRef<HTMLButtonElement>(null);
  const voiceDialogTitleRef = useRef<HTMLHeadingElement>(null);
  const commandQuery = draft.match(/^\/([^\s]*)$/)?.[1] ?? null;
  const contextQuery = draft.match(/(?:^|\s)@([^\s]*)$/)?.[1] ?? null;
  useEffect(() => {
    const onVoiceShortcut = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.altKey || event.repeat || event.key.toLowerCase() !== "v") return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("[role=dialog]") && !target.closest(".voice-mode-dialog")) return;
      event.preventDefault();
      if (handsFreeActive) {
        endVoiceMode();
      } else if (!busy && !rewriteBusy && !voiceListening && !audioTranscribing) {
        toggleHandsFree();
      }
    };
    window.addEventListener("keydown", onVoiceShortcut);
    return () => window.removeEventListener("keydown", onVoiceShortcut);
  }, [audioTranscribing, busy, endVoiceMode, handsFreeActive, rewriteBusy, toggleHandsFree, voiceListening]);
  useEffect(() => {
    const textarea = draftTextareaRef.current;
    if (!textarea) return;
    const resize = () => {
      const maximum = Math.max(100, Math.floor(window.innerHeight * 0.32));
      textarea.style.height = "auto";
      const height = Math.min(textarea.scrollHeight, maximum);
      textarea.style.height = `${height}px`;
      textarea.style.overflowY = textarea.scrollHeight > maximum ? "auto" : "hidden";
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [draft]);
  useEffect(() => {
    if (attachmentCountRef.current === attachments.length) return;
    attachmentCountRef.current = attachments.length;
    window.requestAnimationFrame(() => {
      const textarea = draftTextareaRef.current;
      if (!textarea) return;
      const start = Math.min(draftSelectionRef.current.start, textarea.value.length);
      const end = Math.min(draftSelectionRef.current.end, textarea.value.length);
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(start, Math.max(start, end));
    });
  }, [attachments.length]);
  const rememberDraftSelection = (textarea: HTMLTextAreaElement) => { draftSelectionRef.current = { start: textarea.selectionStart, end: textarea.selectionEnd }; };
  const commandMatches = useMemo(() => commandQuery === null ? [] : [...composerCommands, ...workflowPreferences.savedPrompts.map((prompt) => ({ id: prompt.id, label: prompt.name, detail: prompt.prompt.slice(0, 100) || "Saved prompt template", shortcut: `/${prompt.alias}`, prompt: prompt.prompt }))].filter((command) => `${command.label} ${command.detail} ${command.shortcut}`.toLowerCase().includes(commandQuery.toLowerCase())), [commandQuery, workflowPreferences.savedPrompts]);
  const contextMatches = useMemo(() => {
    if (contextQuery === null) return [];
    const candidates: ComposerCommand[] = [
      ...projects.slice(0, 8).map((project) => ({ id: `project:${project.id}`, label: project.name, detail: project.folderPaths.join(" · ") || "Project workspace", shortcut: `@project:${project.name}`, prompt: `@project:${project.name}` })),
      ...attachments.slice(0, 8).map((attachment) => ({ id: `file:${attachment.fileName}`, label: attachment.fileName, detail: "Attached file in this turn", shortcut: `@file:${attachment.fileName}`, prompt: `@file:${attachment.fileName}` })),
      { id: "skills", label: "Skills", detail: "Reference an installed skill by id", shortcut: "@skills", prompt: "@skills" },
      { id: "tools", label: "Tools", detail: "Reference enabled local tools", shortcut: "@tools", prompt: "@tools" },
      { id: "memory", label: "Memory", detail: "Reference approved local memory", shortcut: "@memory", prompt: "@memory" },
      ...contextItems,
    ];
    const query = contextQuery.toLowerCase();
    return candidates.filter((candidate) => `${candidate.label} ${candidate.detail} ${candidate.shortcut}`.toLowerCase().includes(query)).slice(0, 12);
  }, [attachments, contextItems, contextQuery, projects]);
  const activeCommandId = commandMatches[commandIndex] ? `composer-command-${commandMatches[commandIndex].id}` : undefined;
  const activeContextId = contextMatches[commandIndex] ? `composer-command-${contextMatches[commandIndex].id}` : undefined;
  const computerVisionModel = useMemo(() => {
    const fallback: Model = { model, provider, endpoint, vision: "unknown", capabilities: [] };
    let preferred: { model?: unknown; provider?: unknown; endpoint?: unknown } = {};
    try {
      const stored = JSON.parse(localStorage.getItem("skai.preferredModels.v1") ?? "{}");
      if (stored && typeof stored === "object" && stored.vision && typeof stored.vision === "object") preferred = stored.vision;
    } catch { /* A missing or malformed preference falls back to discovered models. */ }
    const preferredInventory = typeof preferred.model === "string"
      ? models.find((item) => item.model === preferred.model && (!preferred.provider || item.provider === preferred.provider))
      : undefined;
    const supported = models.filter((item) => item.vision.toLowerCase() === "supported");
    const sameProviderVision = supported.find((item) => (item.provider ?? provider) === provider);
    if (preferredInventory?.vision.toLowerCase() === "supported") return preferredInventory;
    if (sameProviderVision) return sameProviderVision;
    if (supported[0]) return supported[0];
    if (typeof preferred.model === "string") return {
      ...fallback,
      model: preferred.model,
      provider: typeof preferred.provider === "string" ? preferred.provider : provider,
      endpoint: typeof preferred.endpoint === "string" && preferred.endpoint ? preferred.endpoint : endpoint,
    };
    return preferredInventory ?? fallback;
  }, [endpoint, model, models, provider]);

  useEffect(() => { setCommandIndex(0); }, [commandQuery, contextQuery]);
  useEffect(() => { const refresh = () => setWorkflowPreferences(readCommandPreferences()); window.addEventListener(commandPreferencesEvent, refresh); return () => window.removeEventListener(commandPreferencesEvent, refresh); }, []);
  useEffect(() => {
    const addProjectFileContext = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string; path?: string; mode?: "context" | "compare" }>).detail;
      if (!detail?.path || (detail.projectId && projectId && detail.projectId !== projectId)) return;
      const token = `@file:${detail.path}`;
      const next = detail.mode === "compare"
        ? `${draft.trim() ? `${draft.trim()}\n\n` : ""}Compare ${token} with the current conversation. `
        : `${draft.trimEnd()}${draft.trim() ? " " : ""}${token} `;
      onDraftChange(next);
      window.requestAnimationFrame(() => draftTextareaRef.current?.focus());
    };
    window.addEventListener("skai:composer-file-context", addProjectFileContext);
    return () => window.removeEventListener("skai:composer-file-context", addProjectFileContext);
  }, [draft, onDraftChange, projectId]);
  useEffect(() => {
    if (!omniOpen && !accessOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (omniOpen && !addMenuRef.current?.contains(target)) setOmniOpen(false);
      if (accessOpen && !accessMenuRef.current?.contains(target)) setAccessOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (omniOpen) { setOmniOpen(false); addTriggerRef.current?.focus(); }
      if (accessOpen) { setAccessOpen(false); accessTriggerRef.current?.focus(); }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, [accessOpen, omniOpen]);
  useEffect(() => {
    if (!omniOpen || !toolPickerOpen) return;
    let cancelled = false;
    setToolLoadStatus("Loading installed skills…");
    void window.skaiAgent.request("skills.list").then((response) => {
      if (cancelled) return;
      const result = response.ok ? response.result : null;
      const items = Array.isArray(result) ? result : (result && typeof result === "object" && Array.isArray((result as { skills?: unknown }).skills) ? (result as { skills: unknown[] }).skills : []);
      const skills = items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")).map((item) => ({
        id: typeof item.id === "string" ? item.id : "",
        name: typeof item.name === "string" ? item.name : typeof item.id === "string" ? item.id : "",
        description: typeof item.description === "string" ? item.description : "",
        category: typeof item.category === "string" ? item.category : "",
        permissions: Array.isArray(item.permissions) ? item.permissions.filter((permission): permission is string => typeof permission === "string") : [],
        enabled: item.enabled !== false,
        source: typeof item.source === "string" ? item.source : "",
      })).filter((skill) => skill.id && skill.enabled);
      setAvailableSkills(skills);
      setToolLoadStatus(response.ok ? (skills.length ? null : "No enabled local skills yet. Browse Marketplace to install one.") : (response.error?.message ?? "Installed skills could not be loaded."));
    }).catch((error) => { if (!cancelled) setToolLoadStatus(error instanceof Error ? error.message : "Installed skills could not be loaded."); });
    return () => { cancelled = true; };
  }, [omniOpen, toolPickerOpen]);
  useEffect(() => {
    if (commandQuery === null && contextQuery === null) return;
    const activeId = commandQuery !== null ? activeCommandId : activeContextId;
    window.requestAnimationFrame(() => document.getElementById(activeId ?? "")?.scrollIntoView({ block: "nearest" }));
  }, [activeCommandId, activeContextId, commandMatches.length, commandQuery, contextMatches.length, contextQuery]);




  const openFilePickerFromOmni = () => {
    setOmniOpen(false);
    onAttach();
  };

  const openAudioPickerFromOmni = () => {
    setOmniOpen(false);
    voice.audioPickerRef.current?.click();
  };

  const startVoiceFromOmni = () => { setOmniOpen(false); voice.toggleVoiceInput(); };
  const startHandsFreeFromOmni = () => { setOmniOpen(false); voice.toggleHandsFree(); };







  const selectComposerCommand = (command: ComposerCommand) => {
    onDraftChange(command.prompt ?? "");
    if (command.route) onNavigate(command.route);
  };

  const selectContextCommand = (command: ComposerCommand) => {
    const match = draft.match(/(?:^|\s)@([^\s]*)$/);
    if (!match) return;
    onDraftChange(`${draft.slice(0, draft.length - match[0].length)}${command.prompt ?? command.shortcut} `);
  };

  const captureComputerScreens = async () => {
    if (!window.skaiAgent?.computer) { setComputerStatus("Computer use is unavailable in this app build."); return; }
    setComputerBusy(true); setComputerStatus("Capturing displays…");
    try {
      const screens = await window.skaiAgent.computer.capture();
      setComputerScreens(screens);
      setComputerScreenId((current) => screens.some((screen) => screen.id === current) ? current : screens[0]?.id ?? "");
      setComputerPoint(null);
      setComputerStatus(screens.length ? null : "No displays were found.");
    } catch (error) { setComputerStatus(error instanceof Error ? error.message : "The display could not be captured."); }
    finally { setComputerBusy(false); }
  };

  const selectedComputerScreen = computerScreens.find((screen) => screen.id === computerScreenId);
  const runComputerAction = async (action: { action: "click" | "scroll" | "type" | "key"; x?: number; y?: number; button?: "left" | "right"; delta?: number; text?: string; key?: string }) => {
    if (!selectedComputerScreen) return;
    setComputerBusy(true); setComputerStatus("Sending input to the selected display…");
    try {
      await window.skaiAgent.computer?.action({ ...action, displayId: selectedComputerScreen.displayId });
      setComputerStatus("Input sent. Refresh the display to inspect the result.");
      await captureComputerScreens();
    } catch (error) { setComputerStatus(error instanceof Error ? error.message : "Computer input failed."); }
    finally { setComputerBusy(false); }
  };

  const attachComputerScreenshot = () => {
    if (!selectedComputerScreen || attachments.length >= 5) return;
    onSetAttachments([...attachments, { fileName: `screen-${new Date().toISOString().replace(/[:.]/g, "-")}.png`, mediaType: "image/png", content: selectedComputerScreen.content }]);
    setOmniOpen(false); setComputerOpen(false); setComputerStatus("Screen image attached. Review it in the composer before sending.");
  };

  const stopComputerTask = () => { computerStopRef.current = true; setComputerStatus("Stopping after the current model response…"); computerApprovalResolver.current?.(false); computerApprovalResolver.current = null; setPendingComputerAction(null); };
  const approveComputerAction = () => { const resolve = computerApprovalResolver.current; computerApprovalResolver.current = null; setPendingComputerAction(null); resolve?.(true); };
  const skipComputerAction = () => { computerStopRef.current = true; const resolve = computerApprovalResolver.current; computerApprovalResolver.current = null; setPendingComputerAction(null); resolve?.(false); setComputerStatus("Session stopped before the proposed action was sent."); };
  const startComputerTask = async () => {
    if (!computerTask.trim() || !selectedComputerScreen || computerBusy) return;
    if (!isLocalEndpoint(endpoint)) { setComputerStatus("Computer-use model calls require a local endpoint so screen contents stay on this device."); return; }
    if (computerVisionModel.vision.toLowerCase() === "unsupported") {
      setComputerStatus("Computer use needs a vision-capable model. Choose one in Models, then start the session again.");
      return;
    }
    computerStopRef.current = false;
    setComputerBusy(true); setComputerSteps([]); setComputerStatus("Starting a local computer-use session…");
    let currentScreen = selectedComputerScreen;
    let taskFinished = false;
    let reachedLimit = false;
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string; attachments?: ChatAttachment[] }> = [
      { role: "system", content: `You control the user's selected desktop display. Follow their task instruction by selecting one concrete mouse or keyboard action per turn. The user explicitly started this computer-use session. You can click normalized coordinates from 0 to 1 relative to the screenshot, type text, press one supported key, or scroll (positive delta scrolls up). Do not claim an action succeeded until a later screenshot confirms it. Never invent screen contents. Return only one JSON object, with no markdown: {"action":"click","x":0.5,"y":0.5,"button":"left"}, {"action":"type","text":"..."}, {"action":"key","key":"Enter"}, {"action":"scroll","x":0.5,"y":0.5,"delta":480}, or {"action":"done","summary":"..."}. Supported keys: Enter, Tab, Escape, Backspace, Delete, Up, Down, Left, Right, Home, End, PageUp, PageDown, Space. Do at most 12 actions. Keep typed text to what the user requested.` },
      { role: "user", content: computerTask.trim(), attachments: [{ fileName: "current-screen.png", mediaType: "image/png", content: currentScreen.content }] },
    ];
    try {
      for (let step = 0; step < 12; step += 1) {
        if (computerStopRef.current) break;
        setComputerStatus(`Model planning action ${step + 1} of 12…`);
        const response = await window.skaiAgent.request("chat.complete", { provider: computerVisionModel.provider ?? provider, endpoint: computerVisionModel.endpoint ?? endpoint, model: computerVisionModel.model, modelContextLength: computerVisionModel.contextLength ?? null, messages, responseMode: "think", maxTokens: 350, timeoutSeconds: 60 });
        if (!response.ok) throw new Error(response.error?.message ?? "The local model could not plan a computer action.");
        const raw = (response.result as { content?: unknown }).content;
        if (typeof raw !== "string") throw new Error("The local model returned no action.");
        const json = raw.match(/\{[\s\S]*\}/)?.[0];
        if (!json) throw new Error("The model response was not a computer action. No action was sent.");
        const action = JSON.parse(json) as Record<string, unknown>;
        if (action.action === "done") { taskFinished = true; const summary = typeof action.summary === "string" ? action.summary.slice(0, 300) : "Task complete"; setComputerSteps((steps) => [...steps, `Finished: ${summary}`]); setComputerStatus("Computer-use task finished."); break; }
        const plannedAction = parsePlannedComputerAction(action);
        if (computerStopRef.current) break;
        if (computerRequireApproval) {
          setPendingComputerAction(plannedAction);
          setComputerStatus("Review the proposed action before it is sent.");
          const approved = await new Promise<boolean>((resolve) => { computerApprovalResolver.current = resolve; });
          if (!approved || computerStopRef.current) break;
        }
        const bounded = plannedAction;
        setComputerStatus(`Sending action ${step + 1} of 12…`);
        await window.skaiAgent.computer?.action({ ...bounded, displayId: currentScreen.displayId } as Parameters<NonNullable<typeof window.skaiAgent.computer>["action"]>[0]);
        const label = plannedAction.action === "click" ? `Click at ${plannedAction.x.toFixed(2)}, ${plannedAction.y.toFixed(2)}` : plannedAction.action === "type" ? `Type: ${plannedAction.text.slice(0, 80)}` : plannedAction.action === "key" ? `Press ${plannedAction.key}` : `Scroll ${plannedAction.delta < 0 ? "down" : "up"}`;
        setComputerSteps((steps) => [...steps, label]);
        const freshScreens = await window.skaiAgent.computer?.capture();
        const refreshed = freshScreens?.find((screen) => screen.id === currentScreen.id) ?? freshScreens?.[0];
        if (!refreshed) throw new Error("The selected display could not be recaptured.");
        currentScreen = refreshed; setComputerScreens(freshScreens ?? []); setComputerScreenId(refreshed.id);
        messages.push({ role: "assistant", content: raw }, { role: "user", content: "Inspect the updated screen and choose the next action, or return done. Do not repeat an action unless the new screenshot shows it did not take effect.", attachments: [{ fileName: "current-screen.png", mediaType: "image/png", content: refreshed.content }] });
        if (step === 11) reachedLimit = true;
      }
      if (computerStopRef.current) setComputerStatus("Computer-use session stopped.");
      else if (reachedLimit) setComputerStatus("Stopped at the 12-action session limit. Review the display before starting another session.");
      else if (!taskFinished) setComputerStatus("Computer-use session ended.");
    } catch (error) { setComputerStatus(error instanceof Error ? error.message : "Computer-use session failed."); }
    finally { computerStopRef.current = false; computerApprovalResolver.current = null; setPendingComputerAction(null); setComputerBusy(false); }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (contextQuery !== null && contextMatches.length > 0) {
      if (event.key === "ArrowDown") { event.preventDefault(); setCommandIndex((index) => (index + 1) % contextMatches.length); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); setCommandIndex((index) => (index - 1 + contextMatches.length) % contextMatches.length); return; }
      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); selectContextCommand(contextMatches[commandIndex]); return; }
    }
    if (commandQuery !== null && commandMatches.length > 0) {
      if (event.key === "ArrowDown") { event.preventDefault(); setCommandIndex((index) => (index + 1) % commandMatches.length); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); setCommandIndex((index) => (index - 1 + commandMatches.length) % commandMatches.length); return; }
      if (event.key === "Home") { event.preventDefault(); setCommandIndex(0); return; }
      if (event.key === "End") { event.preventDefault(); setCommandIndex(commandMatches.length - 1); return; }
      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); selectComposerCommand(commandMatches[commandIndex]); return; }
    }
    if (event.key === "Escape" && (commandQuery !== null || contextQuery !== null)) { event.preventDefault(); onDraftChange(""); return; }
    if (workflowPreferences.sendBehavior === "enter-sends" && event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onSubmit(); }
    else if (workflowPreferences.sendBehavior === "shift-enter-sends" && event.key === "Enter" && event.shiftKey) { event.preventDefault(); onSubmit(); }
  };

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragActive(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget;
    if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) setDragActive(false);
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragActive(false);
    if (event.dataTransfer.files.length > 0) handleAudioDrop(Array.from(event.dataTransfer.files));
  };

  const hasMessageContent = draft.trim().length > 0 || attachments.length > 0;
  const selectedModel = models.find((item) => item.model === model && (item.provider ?? provider) === provider);
  const contextBudget = selectedModel?.contextLength && selectedModel.contextLength > 0 ? selectedModel.contextLength : 8_192;
  const estimatedContextTokens = Math.max(0, Math.ceil((draft.length + attachments.reduce((total, attachment) => total + attachment.content.length, 0)) / 4));
  const contextBudgetPercent = Math.min(100, Math.round((estimatedContextTokens / contextBudget) * 100));
  const contextBudgetLabel = estimatedContextTokens > 0 ? `Context · ~${estimatedContextTokens.toLocaleString()} / ${contextBudget.toLocaleString()}` : `Context · ${contextBudget.toLocaleString()} available`;
  const contextCoverageLabel = projectId ? `Project workspace${attachments.length ? ` + ${attachments.length} attachment${attachments.length === 1 ? "" : "s"}` : ""}` : attachments.length ? `${attachments.length} attached source${attachments.length === 1 ? "" : "s"}` : "Prompt only";
  const duplicateAttachmentCount = attachments.length - new Set(attachments.map((attachment) => `${attachment.fileName}\u0000${attachment.mediaType}`)).size;
  const recommendedTools = useMemo<RecommendedComposerTool[]>(() => {
    const text = draft.trim().toLowerCase();
    if (!text) return [];
    const next: RecommendedComposerTool[] = [];
    const add = (tool: RecommendedComposerTool) => { if (!next.includes(tool)) next.push(tool); };
    if (/\b(file|files|folder|folders|document|documents|pdf|image|images|screenshot|attach|source|readme|codebase)\b/.test(text)) add("files");
    if (/\b(audio|recording|podcast|transcrib|meeting|voice memo)\b/.test(text)) add("audio");
    if (/\b(speak|voice|talk|conversation|listen|dictat)\b/.test(text)) add("voice");
    if (/\b(screen|desktop|browser|click|type into|computer|app window)\b/.test(text)) add("computer");
    if (/\b(plan|implement|build|refactor|fix|task|acceptance|checklist)\b/.test(text)) add("plan");
    if (/\b(tool|skill|mcp|integration|plugin|marketplace)\b/.test(text)) add("marketplace");
    return next.slice(0, 3);
  }, [draft]);
  const draftQualityHints = useMemo(() => {
    const text = draft.trim();
    if (!text || busy || rewriteBusy) return [];
    const hints: string[] = [];
    if ((target === "edit" || modeLabel === "Coding") && !projectId) {
      hints.push("Choose a project folder so approved edits have a clear target.");
    }
    if (text.length < 18) {
      hints.push("Add a little more detail about the desired outcome or constraints.");
    }
    if ((target === "edit" || target === "review" || modeLabel === "Coding") && /\b(build|implement|change|fix|refactor|review|update)\b/i.test(text) && !/\b(acceptance|criteria|expect|should|must|verify|test)\b/i.test(text)) {
      hints.push("Consider adding an acceptance check or test expectation.");
    }
    return hints.slice(0, 2);
  }, [busy, draft, modeLabel, projectId, rewriteBusy, target]);
  const activateRecommendedTool = (tool: RecommendedComposerTool) => {
    if (tool === "files") openFilePickerFromOmni();
    else if (tool === "audio") openAudioPickerFromOmni();
    else if (tool === "voice") startHandsFreeFromOmni();
    else if (tool === "computer") { setComputerOpen(true); void captureComputerScreens(); }
    else if (tool === "plan") { setOmniOpen(false); onOpenTaskPlanner?.(); }
    else { setOmniOpen(false); onNavigate("marketplace"); }
  };
  const selectedToolIds = [...new Set([...persistentToolIds, ...oneTurnToolIds])];
  const effectivePolicyLabel = `${projectId ? "Connected project folders" : "Attached sources only"} · ${modeLabel === "Review" || target === "review" || target === "research" ? "read-only" : "approval-gated changes"} · ${selectedToolIds.length ? `${selectedToolIds.length} selected tool${selectedToolIds.length === 1 ? "" : "s"}` : "no extra tools"}`;
  const freezeContext = () => setContextSnapshot({ draft, attachments: attachments.map((attachment) => ({ ...attachment })), toolIds: selectedToolIds, persistentToolIds: [...persistentToolIds], capturedAt: new Date().toISOString() });
  const restoreContext = () => {
    if (!contextSnapshot) return;
    onDraftChange(contextSnapshot.draft);
    onSetAttachments(contextSnapshot.attachments.map((attachment) => ({ ...attachment })));
    setPersistentToolIds(contextSnapshot.persistentToolIds);
    setOneTurnToolIds(contextSnapshot.toolIds.filter((id) => !contextSnapshot.persistentToolIds.includes(id)));
  };
  const filteredSkills = availableSkills.filter((skill) => `${skill.name} ${skill.id} ${skill.description ?? ""} ${skill.category ?? ""}`.toLowerCase().includes(toolQuery.trim().toLowerCase()));
  const toolPolicyLabel = target === "review" || target === "research" || modeLabel === "Review" ? "Read-only skills only" : target === "edit" || modeLabel === "Coding" || modeLabel === "Agent" ? "Mutating skills require approval" : "Conversation skills stay local";
  const skillBlockedByMode = (skill: ComposerSkill) => (target === "review" || target === "research" || modeLabel === "Review") && (skill.permissions ?? []).some((permission) => /write|execute|shell|desktop|network|mutat/i.test(permission));
  const toggleComposerSkill = (skillId: string) => {
    if (toolScope === "persistent") {
      setPersistentToolIds((current) => {
        const next = current.includes(skillId) ? current.filter((id) => id !== skillId) : [...current, skillId].slice(-12);
        localStorage.setItem("skai.composer.tools", JSON.stringify(next));
        return next;
      });
      return;
    }
    setOneTurnToolIds((current) => current.includes(skillId) ? current.filter((id) => id !== skillId) : [...current, skillId].slice(-12));
  };
  const closeToolPicker = () => { setToolPickerOpen(false); setToolQuery(""); };
  const removeDuplicateAttachments = () => {
    const seen = new Set<string>();
    onSetAttachments(attachments.filter((attachment) => {
      const key = `${attachment.fileName}\u0000${attachment.mediaType}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }));
  };
  const saveQueuedEdit = async (index: number) => {
    setQueueUpdateBusy(true);
    try {
      if (await onUpdateQueued(index, queueEditDraft)) setEditingQueueIndex(null);
    } finally {
      setQueueUpdateBusy(false);
    }
  };
  const downloadVoiceTranscript = () => {
    if (!voiceSessionTranscript.length) return;
    const content = voiceSessionTranscript.map((line) => `${line.speaker === "you" ? "You" : "Skai"}: ${line.text}`).join("\n\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `skai-voice-transcript-${new Date().toISOString().replace(/[.:]/g, "-")}.txt`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const downloadVoiceAudioEvidence = () => {
    if (!voiceAudioEvidence) return;
    const url = URL.createObjectURL(voiceAudioEvidence.blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = voiceAudioEvidence.fileName;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const downloadContextManifest = () => {
    const manifest = {
      format: "skai-context-manifest.v1",
      capturedAt: new Date().toISOString(),
      mode: modeLabel,
      target,
      policy: effectivePolicyLabel,
      project: projectId ? projects.find((project) => project.id === projectId)?.name ?? projectId : null,
      folders: projectId ? projects.find((project) => project.id === projectId)?.folderPaths ?? [] : [],
      attachments: attachments.map((attachment) => ({ fileName: attachment.fileName, mediaType: attachment.mediaType, contentCharacters: attachment.content.length })),
      selectedTools: selectedToolIds,
      persistentTools: persistentToolIds,
      memoryEnabled: localStorage.getItem("skai.memoryInjectionEnabled") === "true",
      draftCharacters: draft.length,
      contextCoverage: contextCoverageLabel,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `skai-context-manifest-${new Date().toISOString().replace(/[.:]/g, "-")}.json`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return <section className={`composer-card${dragActive ? " is-drag-active" : ""}${workflowPreferences.toolbarLayout === "compact" ? " is-compact-toolbar" : ""}`} aria-busy={rewriteBusy} data-send-behavior={workflowPreferences.sendBehavior} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
    {dragActive && <div className="composer-drop-overlay" role="status">Drop files to attach</div>}
    {commandQuery !== null ? <ComposerCommandMenu commands={commandMatches} activeIndex={commandIndex} onActiveIndexChange={setCommandIndex} onSelect={selectComposerCommand} /> : contextQuery !== null && <ComposerCommandMenu commands={contextMatches} activeIndex={commandIndex} onActiveIndexChange={setCommandIndex} onSelect={selectContextCommand} />}
    {queuedMessages.length > 0 && <div className="queued-messages" aria-label="Queued messages"><div className="queued-heading"><span className="section-kicker">UP NEXT</span><span>{queuedMessages.length}/8 queued</span></div>{queuedMessages.map((queued) => <div className="queued-message" key={queued.index}>{editingQueueIndex === queued.index ? <div className="queued-message-edit"><textarea autoFocus value={queueEditDraft} maxLength={50_000} aria-label={`Edit queued message ${queued.index + 1}`} onChange={(event) => setQueueEditDraft(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void saveQueuedEdit(queued.index); } if (event.key === "Escape") { setEditingQueueIndex(null); setQueueEditDraft(""); } }} /><div><button type="button" disabled={queueUpdateBusy || !queueEditDraft.trim()} onClick={() => void saveQueuedEdit(queued.index)}>Save</button><button type="button" disabled={queueUpdateBusy} onClick={() => { setEditingQueueIndex(null); setQueueEditDraft(""); }}>Cancel</button></div><small>Ctrl+Enter saves · Esc cancels</small></div> : <span>{queued.text}</span>}{queued.attachments?.length ? <small>{queued.attachments.map((attachment) => attachment.fileName).join(", ")}</small> : null}<div className="queued-message-actions"><button type="button" disabled={queueUpdateBusy} title="Edit this queued prompt" onClick={() => { if (editingQueueIndex !== queued.index) { setEditingQueueIndex(queued.index); setQueueEditDraft(queued.text); } }} aria-label={`Edit queued message ${queued.index + 1}`}>Edit</button><button type="button" disabled={queued.index === 0} onClick={() => void onMoveQueued(queued.index, queued.index - 1)} aria-label={`Move queued message ${queued.index + 1} up`} title="Move up">↑</button><button type="button" disabled={queued.index === queuedMessages.length - 1} onClick={() => void onMoveQueued(queued.index, queued.index + 1)} aria-label={`Move queued message ${queued.index + 1} down`} title="Move down">↓</button><button type="button" onClick={() => onQueueRemove(queued.index)} aria-label={`Remove queued message ${queued.index + 1}`} title="Remove queued message">×</button></div></div>)}</div>}
    <AttachmentList attachments={attachments} onRemove={onRemoveAttachment} trustLabel="User content · local-only" />
    <input ref={audioPickerRef} className="sr-only" type="file" accept=".mp3,.m4a,.ogg,.wav,.webm,audio/mpeg,audio/mp4,audio/ogg,audio/wav,audio/webm" tabIndex={-1} aria-hidden="true" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void transcribeAudioFile(file); }} />
    <textarea ref={draftTextareaRef} value={draft} disabled={rewriteBusy} onChange={(event) => { rememberDraftSelection(event.currentTarget); onDraftChange(event.target.value); }} onSelect={(event) => rememberDraftSelection(event.currentTarget)} onClick={(event) => rememberDraftSelection(event.currentTarget)} onKeyUp={(event) => rememberDraftSelection(event.currentTarget)} onKeyDown={handleKeyDown} placeholder={rewriteBusy ? "Rewriting with the selected local model…" : busy ? "Type a follow-up while the model responds…" : placeholder} aria-label={placeholder.replace(/…$/, "")} aria-controls={commandQuery !== null || contextQuery !== null ? "composer-command-menu" : undefined} aria-activedescendant={commandQuery !== null ? activeCommandId : contextQuery !== null ? activeContextId : undefined} aria-autocomplete={commandQuery !== null || contextQuery !== null ? "list" : undefined} aria-expanded={commandQuery !== null ? commandMatches.length > 0 : contextQuery !== null ? contextMatches.length > 0 : undefined} rows={3} />
    {recommendedTools.length > 0 && !busy && !rewriteBusy && <div className="composer-tool-recommendations" aria-label="Recommended local tools"><span>Suggested for this draft</span>{recommendedTools.map((tool) => <button type="button" key={tool} title={recommendedComposerTools[tool].detail} onClick={() => activateRecommendedTool(tool)}><NavIcon name={tool === "files" ? "document" : tool === "audio" || tool === "voice" ? "microphone" : tool === "computer" ? "image" : tool === "plan" ? "code" : "marketplace"} /><span>{recommendedComposerTools[tool].label}</span></button>)}</div>}
     {draftQualityHints.length > 0 && <div className="composer-draft-hints" role="status" aria-label="Draft quality suggestions"><span className="composer-draft-hints-label">Draft check</span>{draftQualityHints.map((hint) => <span className="composer-draft-hint" key={hint}>{hint}</span>)}</div>}
    {documentsOnly && attachments.length === 0 && <p className="composer-hint" role="status">Attach at least one document before sending in Documents-only mode.</p>}
    {voiceListening && whisperRecorderRef.current && <p className="composer-hint" role="status">Recording locally. Select the microphone again to transcribe, or leave it to stop automatically after five minutes.</p>}
    {audioTranscribing && <p className="composer-hint" role="status">Transcribing audio with local Whisper on this device…</p>}
    {audioTranscriptReady && <p className="composer-hint" role="status">Local transcript added to the draft. Review it before sending.</p>}
    {voiceError && <div className="composer-voice-status"><p className="composer-voice-error" role="status">{voiceError}</p>{voicePackNeeded && <div className="composer-voice-install"><Button variant="secondary" type="button" disabled={voicePackInstalling} onClick={() => void installLocalSpeechPack()}>{voicePackInstalling ? "Installing local pack…" : "Install local speech pack"}</Button><span>The pack downloads once; dictation is processed on this device.</span></div>}</div>}
    {voiceFallbackNotice && <p className="composer-hint" role="status" onClick={() => setVoiceFallbackNotice(null)}>{voiceFallbackNotice}</p>}
    <div className="composer-actions">
      <div className="composer-action-left">
        <div className="composer-add-anchor" ref={addMenuRef}>
          <button ref={addTriggerRef} className="composer-tool-button composer-add-button" type="button" onClick={() => setOmniOpen((open) => !open)} disabled={rewriteBusy} aria-label="Add to message" title="Add to message" aria-haspopup="menu" aria-expanded={omniOpen}><NavIcon name="plus" /><span className="composer-toolbar-label">Add</span></button>
          {omniOpen && <div className="composer-add-menu" role="menu" aria-label="Add to message">
            {toolPickerOpen ? <div className="composer-tool-picker" role="group" aria-label="Skills and tools for the next turn">
              <div className="composer-tool-picker-heading"><button type="button" className="composer-tool-picker-back" onClick={closeToolPicker} aria-label="Back to add menu">‹</button><div><strong>Skills and tools</strong><small>{selectedToolIds.length ? `${selectedToolIds.length} selected` : "None selected"} · {modeLabel} mode · {toolPolicyLabel}</small></div></div>
              <input className="composer-tool-search" value={toolQuery} onChange={(event) => setToolQuery(event.target.value)} placeholder="Search installed skills…" aria-label="Search installed skills" autoFocus />
              <label className="composer-tool-scope"><span>Apply selection</span><select value={toolScope} onChange={(event) => setToolScope(event.target.value as "turn" | "persistent")} aria-label="Tool selection scope"><option value="turn">This turn only</option><option value="persistent">Remember for future turns</option></select></label>
              <div className="composer-tool-list">{filteredSkills.map((skill) => { const blocked = skillBlockedByMode(skill); const checked = selectedToolIds.includes(skill.id); return <label className={`composer-tool-row${checked ? " is-selected" : ""}${blocked ? " is-blocked" : ""}`} key={skill.id}><input type="checkbox" checked={checked} disabled={blocked} onChange={() => toggleComposerSkill(skill.id)} /><span><strong>{skill.name}</strong><small>{blocked ? "Unavailable in this read-only mode" : skill.description || skill.category || skill.id}</small></span><em>{blocked ? "Read-only" : skill.permissions?.length ? "Approval" : (skill.source || "Local")}</em></label>; })}</div>
              {toolLoadStatus && <p className="composer-tool-empty" role="status">{toolLoadStatus}</p>}
              <div className="composer-tool-picker-actions"><button type="button" onClick={() => { closeToolPicker(); onNavigate("marketplace"); }}>Browse Marketplace</button><button type="button" onClick={closeToolPicker}>Done</button></div>
            </div> : <>
              <p className="composer-menu-label">Add to this message</p>
              <button className="composer-menu-option" type="button" role="menuitem" onClick={openFilePickerFromOmni} disabled={attachments.length >= 5}><NavIcon name="document" /><span><strong>Files and folders</strong><small>Attach up to 5 images, documents, PDFs, or videos</small></span></button>
              <button className="composer-menu-option" type="button" role="menuitem" onClick={openAudioPickerFromOmni} disabled={busy || voiceListening || handsFreeActive}><NavIcon name="audio" /><span><strong>Audio file</strong><small>Transcribe audio on this device</small></span></button>
              <button className="composer-menu-option" type="button" role="menuitemcheckbox" aria-checked={documentsOnly} onClick={() => { onToggleDocumentsOnly(); setOmniOpen(false); }} disabled={busy || rewriteBusy}><NavIcon name="document" /><span><strong>Documents only</strong><small>Use attached documents as evidence</small></span>{documentsOnly && <b aria-hidden="true">✓</b>}</button>
              <button className="composer-menu-option" type="button" role="menuitem" onClick={startVoiceFromOmni} disabled={rewriteBusy || handsFreeActive || audioTranscribing}><NavIcon name="microphone" /><span><strong>Voice input</strong><small>Dictate one message on this device</small></span></button>
              <button className="composer-menu-option" type="button" role="menuitem" onClick={startHandsFreeFromOmni} disabled={rewriteBusy || voiceListening || audioTranscribing}><NavIcon name="headset" /><span><strong>Voice Mode</strong><small>Start a hands-free conversation</small></span></button>
              <button className="composer-menu-option" type="button" role="menuitem" onClick={() => { setOmniOpen(false); setComputerOpen(true); void captureComputerScreens(); }}><NavIcon name="image" /><span><strong>Computer use</strong><small>Capture a screen or control a local app</small></span></button>
              {onOpenTaskPlanner && <button className="composer-menu-option" type="button" role="menuitem" onClick={() => { setOmniOpen(false); onOpenTaskPlanner(); }}><NavIcon name="code" /><span><strong>Plan a task</strong><small>Prepare a plan for review</small></span></button>}
              <button className="composer-menu-option" type="button" role="menuitem" onClick={() => setToolPickerOpen(true)}><NavIcon name="sparkle" /><span><strong>Skills and tools</strong><small>{selectedToolIds.length ? `${selectedToolIds.length} selected · configure scope` : "Choose local skills for this turn"}</small></span></button>
              <button className="composer-menu-option" type="button" role="menuitem" onClick={() => { setOmniOpen(false); onNavigate("marketplace"); }}><NavIcon name="marketplace" /><span><strong>Browse tools and skills</strong><small>Explore available local integrations</small></span></button>
            </>}
          </div>}
        </div>
        {projects.length > 0 && onOpenProject && <label className="composer-project-switcher"><NavIcon name="project" /><span className="sr-only">Open a project workspace</span><select aria-label="Open a project workspace" value={projectId ?? ""} onChange={(event) => { const project = projects.find((item) => item.id === event.target.value); if (project) onOpenProject(project); }}><option value="">Open project…</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}
        <span className="composer-mode-chip" title={modeDescription}><span className="composer-mode-chip-dot" aria-hidden="true" />{modeLabel}</span>
        {onTargetChange && <label className="composer-target-selector" title={composerTargetDescriptions[target]}><span>Target</span><select aria-label="Response target" value={target} onChange={(event) => onTargetChange(event.target.value as ComposerTarget)}>{(Object.keys(composerTargetLabels) as ComposerTarget[]).map((value) => <option key={value} value={value}>{composerTargetLabels[value]}</option>)}</select></label>}
         {target === "edit" && onOpenTaskPlanner && draft.trim() && <button className="composer-plan-first" type="button" onClick={onOpenTaskPlanner} title="Turn this edit request into an approval-gated plan">Plan before changing</button>}
        <div className="composer-access-anchor" ref={accessMenuRef}>
          <button ref={accessTriggerRef} type="button" className="composer-access-button" onClick={() => setAccessOpen((open) => !open)} aria-haspopup="dialog" aria-expanded={accessOpen}>{accessLabel}<span aria-hidden="true">⌄</span></button>
          {accessOpen && <section className="composer-access-popover" role="dialog" aria-label={`${accessLabel} and available tools`}>
            <strong>{accessLabel}</strong>
            <p>Skai’s project tools can access folders you connect to a workspace. Skai does not provide unrestricted access to the whole computer.</p>
            <div className="composer-capability-list" aria-label="Current context and tool availability">
              <div><span>Workspace files</span><span>{projectId ? (projects.find((project) => project.id === projectId)?.folderPaths.join(" · ") || "No folders connected") : "Only files you attach"}</span></div>
              <div><span>Attached context</span><span>{attachments.length ? `${attachments.length} user-provided source${attachments.length === 1 ? "" : "s"} · ${attachments.map((attachment) => attachment.fileName).join(" · ")}` : "No attachments in this turn"}</span></div>
              <div><span>Context coverage</span><span>{contextCoverageLabel}</span></div>
              <div><span>Context freeze</span><span>{contextSnapshot ? `Captured ${new Date(contextSnapshot.capturedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · restore available` : "Not captured"}</span></div>
              <div><span>Skills and tools</span><span>{selectedToolIds.length ? `${selectedToolIds.length} selected for ${toolScope === "persistent" ? "future turns" : "this turn"}` : ([...new Set(draft.match(/\$([A-Za-z0-9._-]{1,80})\b/g) ?? [])].slice(0, 4).join(", ").replaceAll("$", "") || "Add a $skill-id or choose Skills and tools")}</span></div>
              <div><span>Memory</span><span>{localStorage.getItem("skai.memoryInjectionEnabled") === "true" ? "Enabled · approved local notes only" : "Off for this workspace"}</span></div>
              <div><span>Mode policy</span><span>{modeLabel === "Agent" || modeLabel === "Coding" ? "Mutating tools require approval" : modeLabel === "Review" ? "Read-only review · no writes" : "Conversation tools stay local and explicit"}</span></div>
              <div><span>Effective policy</span><span>{effectivePolicyLabel}</span></div>
              <div><span>Connected tools</span><span>MCP tools require explicit review in Marketplace; they are not silently called from chat.</span></div>
              <div><span>Computer use</span><span>Starts only from Add to message and requires a local vision model.</span></div>
            </div>
            {duplicateAttachmentCount > 0 && <div className="composer-context-dedup" role="status"><span>{duplicateAttachmentCount} duplicate attachment{duplicateAttachmentCount === 1 ? "" : "s"} will be sent more than once.</span><Button variant="ghost" type="button" onClick={removeDuplicateAttachments}>Remove duplicates</Button></div>}
            <div className="composer-context-freeze-actions"><Button variant="ghost" type="button" onClick={freezeContext}>{contextSnapshot ? "Recapture context" : "Freeze context"}</Button>{contextSnapshot && <><Button variant="ghost" type="button" onClick={restoreContext}>Restore frozen context</Button><Button variant="ghost" type="button" onClick={() => setContextSnapshot(null)}>Clear</Button></>}<Button variant="ghost" type="button" onClick={downloadContextManifest}>Export manifest</Button></div>
            {projectId && <p className="composer-capability-footnote">Project context is limited to the connected folders shown above.</p>}
          </section>}
        </div>
        {documentsOnly && <span className="composer-docs-chip"><NavIcon name="document" /> Docs only</span>}
        <span className={`composer-context-meter${contextBudgetPercent >= 85 ? " is-near-limit" : ""}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={contextBudgetPercent} aria-valuetext={`${contextBudgetLabel}; approximate estimate based on this draft and attached content`} title="Approximate context estimate based on this draft and attached content"><span className="composer-context-meter-label">{contextBudgetLabel}</span><span className="composer-context-meter-track" aria-hidden="true"><span style={{ width: `${contextBudgetPercent}%` }} /></span></span>
        <span id="attachment-help" className="sr-only">{attachments.length} of 5 attachments. {workflowPreferences.sendBehavior === "enter-sends" ? "Enter" : "Shift+Enter"} to {busy ? "queue" : "send"}; {workflowPreferences.sendBehavior === "enter-sends" ? "Shift+Enter" : "Enter"} starts a new line.</span>
      </div>
      <div className="composer-action-right">
        {modelControl}
        {busy && modeLabel !== "Coding" && <button className="composer-tool-button composer-stop-button" type="button" onClick={() => void onStop()} aria-label="Stop local response" title="Stop the active local response"><NavIcon name="stop" /><span className="composer-toolbar-label">Stop</span></button>}
        <button className={`composer-tool-button composer-microphone-button${voiceListening ? " is-active" : ""}`} type="button" onClick={toggleVoiceInput} disabled={rewriteBusy || handsFreeActive || audioTranscribing} aria-pressed={voiceListening} aria-label={voiceListening ? "Stop dictation" : "Dictate a message"} title={voiceListening ? "Stop dictation" : "Dictate a message on this device"}><NavIcon name={voiceListening ? "stop" : "microphone"} /><span className="composer-toolbar-label">{voiceListening ? "Stop" : "Dictate"}</span></button>
        {!hasMessageContent ? <button className={`composer-send-button composer-voice-mode-button${handsFreeActive ? " is-active" : ""}`} type="button" disabled={rewriteBusy || (busy && !handsFreeActive) || (voiceListening && !handsFreeActive) || audioTranscribing} onClick={toggleHandsFree} aria-pressed={handsFreeActive} aria-keyshortcuts="Control+Alt+V Meta+Alt+V" aria-label={handsFreeActive ? "End voice mode" : "Start voice mode"} title={handsFreeActive ? "End voice conversation · Ctrl+Alt+V" : busy ? "Voice Mode is available after the response finishes" : "Start a hands-free voice conversation · Ctrl+Alt+V"}><NavIcon name={handsFreeActive ? "stop" : "microphone"} /><span className="composer-toolbar-label">{handsFreeActive ? "End voice" : "Voice"}</span></button> : <button className="composer-send-button" type="button" disabled={rewriteBusy || (documentsOnly && attachments.length === 0)} onClick={() => { onSubmit(selectedToolIds); setOneTurnToolIds([]); }} aria-label={rewriteBusy ? "Rewriting message" : busy ? "Queue message" : "Send message"} title={`${rewriteBusy ? "Rewriting…" : busy ? "Queue message" : "Send message"} · ${workflowPreferences.sendBehavior === "enter-sends" ? "Enter" : "Shift+Enter"}`}>{rewriteBusy ? <NavIcon name="stop" /> : <span aria-hidden="true">↑</span>}</button>}
      </div>
    </div>
    <ModalDialog open={computerOpen} onClose={() => { if (computerBusy) stopComputerTask(); setComputerOpen(false); }} titleId="computer-use-title" className="ui-dialog computer-use-dialog">
      <div className="dialog-heading">
        <div>
          <p className="section-kicker">LOCAL COMPUTER CONTROL</p>
          <h3 id="computer-use-title">Computer use</h3>
          <p>Ask Skai to operate the selected display, or use the direct controls. Every action is followed by a fresh screen capture.</p>
        </div>
        <button type="button" onClick={() => { if (computerBusy) stopComputerTask(); setComputerOpen(false); }} aria-label="Close computer use">×</button>
      </div>
      <div className="computer-use-model" role="status">
        <span>Vision model</span>
        <strong>{computerVisionModel.displayName || computerVisionModel.model}</strong>
        <small>{computerVisionModel.provider ?? provider} · local screenshot reasoning</small>
      </div>
      <label className="computer-use-approval"><input type="checkbox" checked={computerRequireApproval} disabled={computerBusy} onChange={(event) => setComputerRequireApproval(event.target.checked)} /><span><strong>Review every action before it runs</strong><small>Default on · Skai pauses after planning each click, keypress, scroll, or text entry.</small></span></label>
      {computerScreens.length > 1 && <label className="computer-screen-picker">Display<select value={computerScreenId} onChange={(event) => { setComputerScreenId(event.target.value); setComputerPoint(null); }} aria-label="Select display">{computerScreens.map((screen) => <option value={screen.id} key={screen.id}>{screen.name}</option>)}</select></label>}
      {selectedComputerScreen && <button type="button" className="computer-screen-preview" onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const imageRatio = selectedComputerScreen.previewWidth / selectedComputerScreen.previewHeight;
        const boxRatio = rect.width / rect.height;
        const imageWidth = boxRatio > imageRatio ? rect.height * imageRatio : rect.width;
        const imageHeight = boxRatio > imageRatio ? rect.height : rect.width / imageRatio;
        const offsetX = (rect.width - imageWidth) / 2;
        const offsetY = (rect.height - imageHeight) / 2;
        setComputerPoint({ x: Math.max(0, Math.min(1, (event.clientX - rect.left - offsetX) / imageWidth)), y: Math.max(0, Math.min(1, (event.clientY - rect.top - offsetY) / imageHeight)) });
      }} aria-label="Choose a point on the captured display">
        <img src={`data:image/png;base64,${selectedComputerScreen.content}`} alt={`Captured display: ${selectedComputerScreen.name}`} />
        {computerPoint && <span className="computer-point-marker" style={{ left: `${computerPoint.x * 100}%`, top: `${computerPoint.y * 100}%` }} />}
      </button>}
      {!selectedComputerScreen && <p className="settings-help">Capture a display to begin.</p>}
      <div className="computer-use-controls computer-use-agent">
        <input value={computerTask} onChange={(event) => setComputerTask(event.target.value)} maxLength={2000} placeholder="Describe what you want Skai to do…" aria-label="Computer-use task" />
        <Button variant={computerBusy ? "secondary" : "primary"} type="button" disabled={!selectedComputerScreen || !computerTask.trim()} onClick={() => computerBusy ? stopComputerTask() : void startComputerTask()}>{computerBusy ? "Stop session" : "Start session"}</Button>
        <Button variant="secondary" type="button" disabled={computerBusy} onClick={() => void captureComputerScreens()}>Refresh screen</Button>
        <Button variant="secondary" type="button" disabled={!selectedComputerScreen || attachments.length >= 5 || computerBusy} onClick={attachComputerScreenshot}>Attach screenshot</Button>
      </div>
      {pendingComputerAction && <section className="computer-use-review" aria-label="Review proposed computer action"><div><p className="section-kicker">ACTION PREVIEW</p><strong>{pendingComputerAction.action === "click" ? `${pendingComputerAction.button === "right" ? "Right click" : "Click"} at ${Math.round(pendingComputerAction.x * 100)}%, ${Math.round(pendingComputerAction.y * 100)}%` : pendingComputerAction.action === "type" ? "Type this text" : pendingComputerAction.action === "key" ? `Press ${pendingComputerAction.key}` : `Scroll ${pendingComputerAction.delta < 0 ? "down" : "up"} at ${Math.round(pendingComputerAction.x * 100)}%, ${Math.round(pendingComputerAction.y * 100)}%`}</strong>{pendingComputerAction.action === "type" && <pre>{pendingComputerAction.text}</pre>}</div><div><Button variant="primary" type="button" onClick={approveComputerAction}>Approve action</Button><Button variant="secondary" type="button" onClick={skipComputerAction}>Stop session</Button></div></section>}
      <div className="computer-use-controls">
        <Button variant="secondary" type="button" disabled={!selectedComputerScreen || !computerPoint || computerBusy} onClick={() => void runComputerAction({ action: "click", ...computerPoint, button: "left" })}>Click point</Button>
        <Button variant="ghost" type="button" disabled={!selectedComputerScreen || !computerPoint || computerBusy} onClick={() => void runComputerAction({ action: "click", ...computerPoint, button: "right" })}>Right click</Button>
        <input value={computerText} onChange={(event) => setComputerText(event.target.value)} maxLength={2000} placeholder="Text to type into the selected app" aria-label="Text to type" />
        <Button variant="secondary" type="button" disabled={!selectedComputerScreen || !computerText || computerBusy} onClick={() => void runComputerAction({ action: "type", text: computerText })}>Type text</Button>
        <select value={computerKey} onChange={(event) => setComputerKey(event.target.value)} aria-label="Key to press">{["Enter", "Tab", "Escape", "Backspace", "Delete", "Up", "Down", "Left", "Right", "Home", "End", "PageUp", "PageDown", "Space"].map((key) => <option key={key}>{key}</option>)}</select>
        <Button variant="secondary" type="button" disabled={!selectedComputerScreen || computerBusy} onClick={() => void runComputerAction({ action: "key", key: computerKey })}>Press key</Button>
        <Button variant="ghost" type="button" disabled={!selectedComputerScreen || !computerPoint || computerBusy} onClick={() => void runComputerAction({ action: "scroll", ...computerPoint!, delta: 480 })}>Scroll up</Button>
        <Button variant="ghost" type="button" disabled={!selectedComputerScreen || !computerPoint || computerBusy} onClick={() => void runComputerAction({ action: "scroll", ...computerPoint!, delta: -480 })}>Scroll down</Button>
      </div>
      {computerSteps.length > 0 && <ol className="computer-use-steps" aria-label="Computer-use actions">{computerSteps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}</ol>}
      {computerStatus && <p className="computer-use-status" role="status" aria-live="polite">{computerBusy ? "Working… " : ""}{computerStatus}</p>}
      <div className="dialog-actions"><Button variant="ghost" type="button" onClick={() => setComputerOpen(false)}>Close</Button></div>
    </ModalDialog>
    <ModalDialog open={handsFreeActive} onClose={endVoiceMode} titleId="voice-mode-title" initialFocusRef={voiceDialogTitleRef} className="ui-dialog voice-mode-dialog">
      <div className="voice-mode-session">
        <div className={`voice-mode-orb ${voiceListening ? "is-listening" : busy || voicePlaybackActive ? "is-speaking" : "is-preparing"}`} aria-hidden="true"><span /><span /><span /></div>
        <p className="section-kicker">LOCAL VOICE MODE</p>
        <h3 id="voice-mode-title" ref={voiceDialogTitleRef} tabIndex={-1}>Voice conversation</h3>
        <p className="voice-mode-state" role="status" aria-live="polite">{voicePaused ? "Microphone paused" : pendingVoiceTranscript ? "Review your transcript" : voiceTurnTranscribing ? "Transcribing on this device" : voiceListening && voicePlaybackActive ? "Listening for an interruption" : voiceListening ? voiceInteractionMode === "push-to-talk" ? "Listening · hold to talk" : "Listening on this device" : voicePlaybackActive ? "Skai is speaking" : busy ? "Skai is responding" : "Ready for your next turn"}</p>
        <p className="voice-mode-detail" role="status" aria-live="polite">Session {voiceSessionStatus === "reconnecting" ? "reconnecting microphone…" : voiceSessionStatus === "suspended" ? "paused while Skai was in the background" : "active locally"}</p>
        <p className="voice-mode-detail">{voiceInteractionMode === "push-to-talk" ? "Hold the microphone button while you speak. Your audio is transcribed locally." : "Speak naturally, then pause. Local Whisper transcribes your words before they are sent."}</p>
        <section className="voice-mode-detail" aria-label="Voice mode preflight"><strong>Local preflight</strong><div role="status" aria-live="polite">Microphone: {voicePreflight?.microphone ?? "checking when started"} · Whisper runtime: {voicePreflight?.runtime ?? "checking when started"} · Speaker routing: {voicePreflight?.speaker ?? "not checked"} · Browser fallback: {voicePreflight?.fallback ?? "not checked"}</div><Button variant="ghost" type="button" onClick={() => void checkVoicePreflight()}>Check again</Button></section>
        <label className="voice-mode-select">Microphone<select aria-label="Microphone input device" value={voiceInputDeviceId} onChange={(event) => setVoiceInputDevice(event.target.value)}><option value="default">System default</option>{voiceInputDevices.filter((device) => device.deviceId && device.deviceId !== "default").map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}</select></label>
        <label className="voice-mode-select">Speaker output<select aria-label="Speaker output device" value={voiceOutputDeviceId} onChange={(event) => setVoiceOutputDevice(event.target.value)}><option value="default">System default</option>{voiceOutputDevices.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}</select></label>
        <p className="voice-mode-detail">Speaker routing and its level meter work with generated audio where this runtime supports it. Native voice engines use the Windows sound output.</p>
        <div className="voice-mode-meter-group"><span>Microphone</span><div className="voice-mode-input-meter" role="meter" aria-label="Microphone input level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(voiceInputLevel * 100)}><span style={{ transform: `scaleX(${voiceInputLevel})` }} /></div><span>Assistant audio</span><div className="voice-mode-input-meter" role="meter" aria-label="Assistant audio output level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(voiceOutputLevel * 100)}><span style={{ transform: `scaleX(${voiceOutputLevel})` }} /></div></div>
        <div className="voice-mode-toggle-row" role="group" aria-label="Voice interaction mode"><Button variant={voiceInteractionMode === "hands-free" ? "primary" : "secondary"} type="button" aria-pressed={voiceInteractionMode === "hands-free"} onClick={() => setVoiceMode("hands-free")}>Hands-free</Button><Button variant={voiceInteractionMode === "push-to-talk" ? "primary" : "secondary"} type="button" aria-pressed={voiceInteractionMode === "push-to-talk"} onClick={() => setVoiceMode("push-to-talk")}>Push to talk</Button></div>
        {voiceInteractionMode === "push-to-talk" && <button className={`voice-mode-ptt${pushToTalkHeld ? " is-active" : ""}`} type="button" disabled={busy || voiceTurnTranscribing || voicePaused} aria-pressed={pushToTalkHeld} aria-label={pushToTalkHeld ? "Release to transcribe" : "Hold to talk"} onPointerDown={(event) => { event.preventDefault(); startPushToTalk(); }} onPointerUp={stopPushToTalk} onPointerLeave={stopPushToTalk} onPointerCancel={stopPushToTalk} onKeyDown={(event) => { if ((event.code === "Space" || event.code === "Enter") && !event.repeat) { event.preventDefault(); startPushToTalk(); } }} onKeyUp={(event) => { if (event.code === "Space" || event.code === "Enter") { event.preventDefault(); stopPushToTalk(); } }} onBlur={stopPushToTalk}><NavIcon name="microphone" />{pushToTalkHeld ? "Release to transcribe" : "Hold to talk"}</button>}
        <div className="voice-mode-toggle-row"><Button variant="secondary" type="button" onClick={pauseVoiceMode}>{voicePaused ? "Resume microphone" : "Pause microphone"}</Button><Button variant="ghost" type="button" onClick={() => void calibrateVoice()}>{voiceCalibration === "not-calibrated" ? "Calibrate microphone" : "Recalibrate microphone"}</Button></div>
        <p className="voice-mode-detail" role="status" aria-live="polite">{voiceCalibration === "ready" ? "Microphone check passed." : voiceCalibration === "quiet" ? "Microphone signal is very quiet." : voiceCalibration === "noisy" ? "Background noise is high." : voiceCalibration === "permission-denied" ? "Microphone permission is needed to calibrate." : "Calibration checks permission and ambient input; no audio is saved."}</p>
        <label className="voice-mode-review"><input type="checkbox" checked={voiceReviewBeforeSend} onChange={(event) => setVoiceReview(event.target.checked)} />Review transcript before sending</label>
        {pendingVoiceTranscript && <section className="voice-mode-transcript-review" aria-label="Transcript awaiting confirmation"><strong>Transcript to send</strong><p>{pendingVoiceTranscript}</p><div><Button variant="primary" type="button" onClick={submitReviewedVoiceTranscript}>Send transcript</Button><Button variant="secondary" type="button" onClick={discardReviewedVoiceTranscript}>Discard</Button></div></section>}
        <section className="voice-mode-transcript" aria-label="Voice session transcript" aria-live="polite"><div className="voice-mode-transcript-heading"><strong>Session transcript</strong><span><Button variant="ghost" type="button" disabled={!voiceSessionTranscript.length} onClick={downloadVoiceTranscript}>Download transcript</Button><Button variant="ghost" type="button" disabled={!voiceAudioEvidence} onClick={downloadVoiceAudioEvidence}>Download audio</Button><Button variant="ghost" type="button" disabled={!voiceSessionTranscript.length && !voiceAudioEvidence} onClick={clearVoiceSessionEvidence}>Clear evidence</Button></span></div><label className="voice-mode-retention"><span>Keep evidence until</span><select aria-label="Voice evidence retention" value={voiceEvidenceRetention} onChange={(event) => updateVoiceEvidenceRetention(event.target.value as "voice-session" | "app-session")}><option value="voice-session">Voice mode ends</option><option value="app-session">App session ends</option></select></label>{voiceSessionTranscript.length ? voiceSessionTranscript.map((line) => <p key={line.id}><b>{line.speaker === "you" ? "You" : "Skai"}</b>{line.text}</p>) : <p className="voice-mode-detail">Your voice turns and Skai’s spoken replies will appear here. Nothing leaves this device unless you export or clear evidence.</p>}{voiceTranscriptPreview && !pendingVoiceTranscript && <p className="voice-mode-transcript-preview" data-live-transcript={voiceListening ? "true" : "false"} aria-live="polite"><b>{voiceListening ? "Live transcript" : "Latest transcript"}</b>{voiceTranscriptPreview}</p>}</section>
        {voiceInterruptions.length > 0 && <section className="voice-mode-timeline" aria-label="Voice interruption timeline"><div className="voice-mode-timeline-heading"><strong>Interrupt timeline</strong><small>{voiceInterruptions.length} local event{voiceInterruptions.length === 1 ? "" : "s"}</small></div><ol>{voiceInterruptions.map((event) => <li key={event.id}><time dateTime={new Date(event.timestamp).toISOString()}>{new Date(event.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</time><span>{event.detail}</span></li>)}</ol></section>}
        <label className="voice-mode-expressiveness">Expressiveness <span>{voiceExpressiveness}%</span><input type="range" min="0" max="100" step="5" value={voiceExpressiveness} onChange={(event) => { const next = Number(event.target.value); setVoiceExpressiveness(next); saveVoiceSetting("expressiveness", next); }} /></label>
        <label className="voice-mode-expressiveness">Mic sensitivity <span>{voiceActivitySensitivity}%</span><input type="range" min="0" max="100" step="5" value={voiceActivitySensitivity} onChange={(event) => saveVoiceSetting("voiceActivitySensitivity", Number(event.target.value))} /></label>
        <p className="voice-mode-detail">Higher sensitivity detects quieter speech. Applies to voice turns and interruption detection.</p>
        <p className="voice-mode-detail">Expressiveness affects spoken reply style with any chat model. Voice tone controls vary by local speech engine.</p>
        {voiceError && <p className="composer-voice-error" role="status" aria-live="polite">{voiceError}</p>}
        <div className="voice-mode-session-actions">{(busy || voicePlaybackActive) && <Button variant="ghost" type="button" aria-keyshortcuts="Control+Shift+Space" onClick={stopNativeSpeech}>Stop speaking · Ctrl+Shift+Space</Button>}<Button variant="secondary" type="button" onClick={endVoiceMode}>End voice mode</Button></div>
      </div>
    </ModalDialog>
  </section>;
}
