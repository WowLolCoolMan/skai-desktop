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

type ChatComposerProps = {
  draft: string;
  busy: boolean;
  rewriteBusy?: boolean;
  documentsOnly: boolean;
  attachments: ChatAttachment[];
  queuedMessages: DesktopQueuedMessage[];
  onDraftChange: (draft: string) => void;
  onSubmit: () => void;
  onQueueRemove: (index: number) => void;
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
  onEditQueued?: (index: number) => void;
  onOpenTaskPlanner?: () => void;
  accessLabel?: string;
  projects?: DesktopProject[];
  projectId?: string | null;
  onOpenProject?: (project: DesktopProject) => void;
};



export function ChatComposer({ draft, busy, rewriteBusy = false, documentsOnly, attachments, queuedMessages, onDraftChange, onSubmit, onQueueRemove, onEditQueued, onAttach, onFilesDropped, onRemoveAttachment, onNavigate, onToggleDocumentsOnly, onVoiceTranscript, onAudioTranscript, onSetAttachments, provider, endpoint, model, models, placeholder = "Message your model…", modelControl, onOpenTaskPlanner, accessLabel = "Local access", projects = [], projectId = null, onOpenProject }: ChatComposerProps) {
  const [commandIndex, setCommandIndex] = useState(0);
  const [dragActive, setDragActive] = useState(false);

  const [omniOpen, setOmniOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
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
  const voice = useChatComposerVoice({ draft, busy, onDraftChange, onVoiceTranscript, onAudioTranscript, onFilesDropped });
  const { voiceListening, handsFreeActive, voiceExpressiveness, setVoiceExpressiveness, voiceError, voiceFallbackNotice, setVoiceFallbackNotice, voicePackNeeded, voicePackInstalling, audioTranscribing, voiceTurnTranscribing, voicePlaybackActive, audioTranscriptReady, audioPickerRef, whisperRecorderRef, toggleVoiceInput, toggleHandsFree, endVoiceMode, transcribeAudioFile, handleAudioDrop, installLocalSpeechPack } = voice;
  const computerStopRef = useRef(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const accessMenuRef = useRef<HTMLDivElement>(null);
  const addTriggerRef = useRef<HTMLButtonElement>(null);
  const accessTriggerRef = useRef<HTMLButtonElement>(null);
  const commandQuery = draft.match(/^\/([^\s]*)$/)?.[1] ?? null;
  const commandMatches = useMemo(() => commandQuery === null ? [] : composerCommands.filter((command) => `${command.label} ${command.detail} ${command.shortcut}`.toLowerCase().includes(commandQuery.toLowerCase())), [commandQuery]);
  const activeCommandId = commandMatches[commandIndex] ? `composer-command-${commandMatches[commandIndex].id}` : undefined;
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

  useEffect(() => { setCommandIndex(0); }, [commandQuery]);
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
    if (commandQuery === null || commandMatches.length === 0) return;
    window.requestAnimationFrame(() => document.getElementById(activeCommandId ?? "")?.scrollIntoView({ block: "nearest" }));
  }, [activeCommandId, commandMatches.length, commandQuery]);




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
    onDraftChange("");
    if (command.route) onNavigate(command.route);
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

  const stopComputerTask = () => { computerStopRef.current = true; setComputerStatus("Stopping after the current model response…"); };
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
        if (action.action === "done") { taskFinished = true; setComputerSteps((steps) => [...steps, `Finished: ${String(action.summary ?? "Task complete")}`]); setComputerStatus("Computer-use task finished."); break; }
        if (computerStopRef.current) break;
        const bounded = { action: action.action, x: action.x, y: action.y, button: action.button, text: action.text, key: action.key, delta: action.delta };
        setComputerStatus(`Sending action ${step + 1} of 12…`);
        await window.skaiAgent.computer?.action({ ...bounded, displayId: currentScreen.displayId } as Parameters<NonNullable<typeof window.skaiAgent.computer>["action"]>[0]);
        const label = action.action === "click" ? `Click at ${Number(action.x).toFixed(2)}, ${Number(action.y).toFixed(2)}` : action.action === "type" ? `Type: ${String(action.text).slice(0, 80)}` : action.action === "key" ? `Press ${String(action.key)}` : `Scroll ${Number(action.delta) < 0 ? "up" : "down"}`;
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
    finally { computerStopRef.current = false; setComputerBusy(false); }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (commandQuery !== null && commandMatches.length > 0) {
      if (event.key === "ArrowDown") { event.preventDefault(); setCommandIndex((index) => (index + 1) % commandMatches.length); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); setCommandIndex((index) => (index - 1 + commandMatches.length) % commandMatches.length); return; }
      if (event.key === "Home") { event.preventDefault(); setCommandIndex(0); return; }
      if (event.key === "End") { event.preventDefault(); setCommandIndex(commandMatches.length - 1); return; }
      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); selectComposerCommand(commandMatches[commandIndex]); return; }
    }
    if (event.key === "Escape" && commandQuery !== null) { event.preventDefault(); onDraftChange(""); return; }
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onSubmit(); }
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

  return <section className={`composer-card ${dragActive ? "is-drag-active" : ""}`} aria-busy={rewriteBusy} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
    {dragActive && <div className="composer-drop-overlay" role="status">Drop files to attach</div>}
    {commandQuery !== null && <ComposerCommandMenu commands={commandMatches} activeIndex={commandIndex} onActiveIndexChange={setCommandIndex} onSelect={selectComposerCommand} />}
    {queuedMessages.length > 0 && <div className="queued-messages" aria-label="Queued messages"><div className="queued-heading"><span className="section-kicker">UP NEXT</span><span>{queuedMessages.length}/8 queued</span></div>{queuedMessages.map((queued) => <div className="queued-message" key={queued.index}><span>{queued.text}</span>{queued.attachments?.length ? <small>{queued.attachments.map((attachment) => attachment.fileName).join(", ")}</small> : null}<div className="queued-message-actions">{onEditQueued && <button type="button" disabled={Boolean(queued.attachments?.length)} title={queued.attachments?.length ? "Queued file contents cannot be restored for editing" : "Edit this queued prompt"} onClick={() => onEditQueued(queued.index)} aria-label={`Edit queued message ${queued.index + 1}`}>Edit</button>}<button type="button" onClick={() => onQueueRemove(queued.index)} aria-label={`Remove queued message ${queued.index + 1}`} title="Remove queued message">×</button></div></div>)}</div>}
    <AttachmentList attachments={attachments} onRemove={onRemoveAttachment} />
    <input ref={audioPickerRef} className="sr-only" type="file" accept=".mp3,.m4a,.ogg,.wav,.webm,audio/mpeg,audio/mp4,audio/ogg,audio/wav,audio/webm" tabIndex={-1} aria-hidden="true" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void transcribeAudioFile(file); }} />
    <textarea value={draft} disabled={rewriteBusy} onChange={(event) => onDraftChange(event.target.value)} onKeyDown={handleKeyDown} placeholder={rewriteBusy ? "Rewriting with the selected local model…" : busy ? "Type a follow-up while the model responds…" : placeholder} aria-label={placeholder.replace(/…$/, "")} aria-controls={commandQuery !== null ? "composer-command-menu" : undefined} aria-activedescendant={commandQuery !== null ? activeCommandId : undefined} aria-autocomplete={commandQuery !== null ? "list" : undefined} aria-expanded={commandQuery !== null ? commandMatches.length > 0 : undefined} rows={3} />
    {documentsOnly && attachments.length === 0 && <p className="composer-hint" role="status">Attach at least one document before sending in Documents-only mode.</p>}
    {voiceListening && whisperRecorderRef.current && <p className="composer-hint" role="status">Recording locally. Select the microphone again to transcribe, or leave it to stop automatically after five minutes.</p>}
    {audioTranscribing && <p className="composer-hint" role="status">Transcribing audio with local Whisper on this device…</p>}
    {audioTranscriptReady && <p className="composer-hint" role="status">Local transcript added to the draft. Review it before sending.</p>}
    {voiceError && <div className="composer-voice-status"><p className="composer-voice-error" role="status">{voiceError}</p>{voicePackNeeded && <div className="composer-voice-install"><Button variant="secondary" type="button" disabled={voicePackInstalling} onClick={() => void installLocalSpeechPack()}>{voicePackInstalling ? "Installing local pack…" : "Install local speech pack"}</Button><span>The pack downloads once; dictation is processed on this device.</span></div>}</div>}
    {voiceFallbackNotice && <p className="composer-hint" role="status" onClick={() => setVoiceFallbackNotice(null)}>{voiceFallbackNotice}</p>}
    <div className="composer-actions">
      <div className="composer-action-left">
        <div className="composer-add-anchor" ref={addMenuRef}>
          <button ref={addTriggerRef} className="composer-tool-button composer-add-button" type="button" onClick={() => setOmniOpen((open) => !open)} disabled={rewriteBusy} aria-label="Add to message" title="Add to message" aria-haspopup="menu" aria-expanded={omniOpen}><NavIcon name="plus" /></button>
          {omniOpen && <div className="composer-add-menu" role="menu" aria-label="Add to message">
            <p className="composer-menu-label">Add to this message</p>
            <button className="composer-menu-option" type="button" role="menuitem" onClick={openFilePickerFromOmni} disabled={attachments.length >= 5}><NavIcon name="document" /><span><strong>Files and folders</strong><small>Attach up to 5 images, documents, PDFs, or videos</small></span></button>
            <button className="composer-menu-option" type="button" role="menuitem" onClick={openAudioPickerFromOmni} disabled={busy || voiceListening || handsFreeActive}><NavIcon name="audio" /><span><strong>Audio file</strong><small>Transcribe audio on this device</small></span></button>
            <button className="composer-menu-option" type="button" role="menuitemcheckbox" aria-checked={documentsOnly} onClick={() => { onToggleDocumentsOnly(); setOmniOpen(false); }} disabled={busy || rewriteBusy}><NavIcon name="document" /><span><strong>Documents only</strong><small>Use attached documents as evidence</small></span>{documentsOnly && <b aria-hidden="true">✓</b>}</button>
            <button className="composer-menu-option" type="button" role="menuitem" onClick={startVoiceFromOmni} disabled={rewriteBusy || handsFreeActive || audioTranscribing}><NavIcon name="microphone" /><span><strong>Voice input</strong><small>Dictate one message on this device</small></span></button>
            <button className="composer-menu-option" type="button" role="menuitem" onClick={startHandsFreeFromOmni} disabled={rewriteBusy || voiceListening || audioTranscribing}><NavIcon name="headset" /><span><strong>Voice Mode</strong><small>Start a hands-free conversation</small></span></button>
            <button className="composer-menu-option" type="button" role="menuitem" onClick={() => { setOmniOpen(false); setComputerOpen(true); void captureComputerScreens(); }}><NavIcon name="image" /><span><strong>Computer use</strong><small>Capture a screen or control a local app</small></span></button>
            {onOpenTaskPlanner && <button className="composer-menu-option" type="button" role="menuitem" onClick={() => { setOmniOpen(false); onOpenTaskPlanner(); }}><NavIcon name="code" /><span><strong>Plan a task</strong><small>Prepare a plan for review</small></span></button>}
            <button className="composer-menu-option" type="button" role="menuitem" onClick={() => { setOmniOpen(false); onNavigate("marketplace"); }}><NavIcon name="marketplace" /><span><strong>Browse tools and skills</strong><small>Explore available local integrations</small></span></button>
          </div>}
        </div>
        {projects.length > 0 && onOpenProject && <label className="composer-project-switcher"><NavIcon name="project" /><span className="sr-only">Open a project workspace</span><select aria-label="Open a project workspace" value={projectId ?? ""} onChange={(event) => { const project = projects.find((item) => item.id === event.target.value); if (project) onOpenProject(project); }}><option value="">Open project…</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}
        <div className="composer-access-anchor" ref={accessMenuRef}>
          <button ref={accessTriggerRef} type="button" className="composer-access-button" onClick={() => setAccessOpen((open) => !open)} aria-haspopup="dialog" aria-expanded={accessOpen}>{accessLabel}<span aria-hidden="true">⌄</span></button>
          {accessOpen && <section className="composer-access-popover" role="dialog" aria-label={accessLabel}><strong>{accessLabel}</strong><p>Skai’s project tools can access folders you connect to a workspace. Skai does not provide unrestricted access to the whole computer.</p></section>}
        </div>
        {documentsOnly && <span className="composer-docs-chip"><NavIcon name="document" /> Docs only</span>}
        <span id="attachment-help" className="sr-only">{attachments.length} of 5 attachments. Press Enter to {busy ? "queue" : "send"}; Shift+Enter starts a new line.</span>
      </div>
      <div className="composer-action-right">
        {modelControl}
        <button className={`composer-tool-button composer-microphone-button${voiceListening ? " is-active" : ""}`} type="button" onClick={toggleVoiceInput} disabled={rewriteBusy || handsFreeActive || audioTranscribing} aria-pressed={voiceListening} aria-label={voiceListening ? "Stop voice input" : "Start voice input"} title={voiceListening ? "Stop voice input" : "Dictate a message on this device"}><NavIcon name={voiceListening ? "stop" : "microphone"} /></button>
        {!hasMessageContent ? <button className={`composer-send-button composer-voice-mode-button${handsFreeActive ? " is-active" : ""}`} type="button" disabled={rewriteBusy || (busy && !handsFreeActive) || (voiceListening && !handsFreeActive) || audioTranscribing} onClick={toggleHandsFree} aria-pressed={handsFreeActive} aria-label={handsFreeActive ? "End voice mode" : "Start voice mode"} title={handsFreeActive ? "End voice conversation" : busy ? "Voice Mode is available after the response finishes" : "Start a hands-free voice conversation"}><NavIcon name={handsFreeActive ? "stop" : "microphone"} /></button> : <button className="composer-send-button" type="button" disabled={rewriteBusy || (documentsOnly && attachments.length === 0)} onClick={onSubmit} aria-label={rewriteBusy ? "Rewriting message" : busy ? "Queue message" : "Send message"} title={rewriteBusy ? "Rewriting…" : busy ? "Queue message" : "Send message"}>{rewriteBusy ? <NavIcon name="stop" /> : <span aria-hidden="true">↑</span>}</button>}
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
    <ModalDialog open={handsFreeActive} onClose={endVoiceMode} titleId="voice-mode-title" className="ui-dialog voice-mode-dialog"><div className="voice-mode-session"><div className={`voice-mode-orb ${voiceListening ? "is-listening" : busy || voicePlaybackActive ? "is-speaking" : "is-preparing"}`} aria-hidden="true"><span /><span /><span /></div><p className="section-kicker">LOCAL VOICE MODE</p><h3 id="voice-mode-title">Voice conversation</h3><p className="voice-mode-state">{voiceTurnTranscribing ? "Transcribing on this device" : voiceListening && voicePlaybackActive ? "Listening for an interruption" : voiceListening ? "Listening on this device" : voicePlaybackActive ? "Skai is speaking" : busy ? "Skai is responding" : "Preparing the next turn"}</p><p className="voice-mode-detail">{voiceTurnTranscribing ? "Your microphone is paused while local Whisper transcribes this turn." : voiceListening && voicePlaybackActive ? "Start speaking to interrupt Skai. Your speech stays on this device." : voiceListening ? "Speak naturally, then pause. Local Whisper transcribes your words before they are sent." : voicePlaybackActive ? "Speak at any time to interrupt the spoken reply." : busy ? "The microphone will listen once the spoken reply starts." : "The next listening turn will start after local speech finishes."}</p><label className="voice-mode-expressiveness">Expressiveness <span>{voiceExpressiveness}%</span><input type="range" min="0" max="100" step="5" value={voiceExpressiveness} onChange={(event) => { const next = Number(event.target.value); setVoiceExpressiveness(next); saveVoiceSetting("expressiveness", next); }} /></label><p className="voice-mode-detail">Affects spoken reply style with any chat model. Voice tone controls vary by local speech engine.</p>{voiceError && <p className="composer-voice-error" role="status">{voiceError}</p>}<div className="voice-mode-session-actions">{(busy || voicePlaybackActive) && <Button variant="ghost" type="button" onClick={stopNativeSpeech}>Stop speaking</Button>}<Button variant="secondary" type="button" onClick={endVoiceMode}>End voice mode</Button></div></div></ModalDialog>
  </section>;
}
