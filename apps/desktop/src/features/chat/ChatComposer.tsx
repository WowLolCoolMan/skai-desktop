import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import type { ChatAttachment, DesktopQueuedMessage } from "../../../shared/contracts";
import type { Route } from "../../app/types";
import { Button } from "../../components/ui/Primitives";
import { ModalDialog } from "../../components/ui/ModalDialog";
import { ComposerCommandMenu } from "../../components/ui/ComposerCommandMenu";
import { AttachmentList } from "./AttachmentList";
import { composerCommands, type ComposerCommand } from "./composerCommands";
import { stopNativeSpeech, waitForLocalSpeechToFinish } from "../../services/nativeTts";
import { isLocalAudioFile, transcribeLocalAudioFile } from "./localAudioTranscription";

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
};

type SpeechRecognitionResultEvent = Event & { resultIndex: number; results: { [index: number]: { [index: number]: { transcript: string }; isFinal: boolean }; length: number } };
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  processLocally?: boolean;
  onend: (() => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionConstructor = (new () => SpeechRecognitionLike) & {
  available?: (options: { langs: string[]; processLocally: boolean; quality?: "dictation" }) => Promise<string>;
  install?: (options: { langs: string[]; processLocally: boolean; quality?: "dictation" }) => Promise<boolean>;
};
type SpeechWindow = Window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };

export function ChatComposer({ draft, busy, rewriteBusy = false, documentsOnly, attachments, queuedMessages, onDraftChange, onSubmit, onQueueRemove, onAttach, onFilesDropped, onRemoveAttachment, onNavigate, onToggleDocumentsOnly, onVoiceTranscript, onAudioTranscript }: ChatComposerProps) {
  const [commandIndex, setCommandIndex] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [handsFreeActive, setHandsFreeActive] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voicePackNeeded, setVoicePackNeeded] = useState(false);
  const [voicePackInstalling, setVoicePackInstalling] = useState(false);
  const [audioTranscribing, setAudioTranscribing] = useState(false);
  const [audioTranscriptReady, setAudioTranscriptReady] = useState(false);
  const [omniOpen, setOmniOpen] = useState(false);
  const audioPickerRef = useRef<HTMLInputElement>(null);
  const audioAbortRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const handsFreeRef = useRef(false);
  const awaitingResponseRef = useRef(false);
  const sawBusyRef = useRef(false);
  const busyRef = useRef(busy);
  const draftRef = useRef(draft);
  const restartTimerRef = useRef<number | null>(null);
  const resumingRef = useRef(false);
  busyRef.current = busy;
  draftRef.current = draft;
  const commandQuery = draft.match(/^\/([^\s]*)$/)?.[1] ?? null;
  const commandMatches = useMemo(() => commandQuery === null ? [] : composerCommands.filter((command) => `${command.label} ${command.detail} ${command.shortcut}`.toLowerCase().includes(commandQuery.toLowerCase())), [commandQuery]);
  const activeCommandId = commandMatches[commandIndex] ? `composer-command-${commandMatches[commandIndex].id}` : undefined;

  useEffect(() => { setCommandIndex(0); }, [commandQuery]);
  useEffect(() => {
    if (commandQuery === null || commandMatches.length === 0) return;
    window.requestAnimationFrame(() => document.getElementById(activeCommandId ?? "")?.scrollIntoView({ block: "nearest" }));
  }, [activeCommandId, commandMatches.length, commandQuery]);
  useEffect(() => () => {
    handsFreeRef.current = false;
    audioAbortRef.current?.abort();
    if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
    recognitionRef.current?.stop();
    recognitionRef.current = null;
  }, []);

  const startVoiceRecognition = async (handsFree: boolean) => {
    const speechWindow = window as SpeechWindow;
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceError("System speech input is not available in this desktop runtime.");
      if (handsFree) { handsFreeRef.current = false; setHandsFreeActive(false); }
      return;
    }
    setVoiceError(null);
    setVoicePackNeeded(false);
    const recognition = new Recognition();
    if (!("processLocally" in recognition)) {
      setVoiceError("This desktop runtime cannot guarantee on-device speech recognition, so voice input is unavailable to keep dictation private.");
      if (handsFree) { handsFreeRef.current = false; setHandsFreeActive(false); }
      return;
    }
    recognition.processLocally = true;
    recognition.continuous = handsFree;
    recognition.interimResults = false;
    recognition.lang = navigator.language || "en-US";
    if (Recognition.available) {
      try {
        const availability = await Recognition.available({ langs: [recognition.lang], processLocally: true, quality: "dictation" });
        if (availability !== "available") {
          const canInstall = availability === "downloadable" || availability === "downloading";
          setVoicePackNeeded(canInstall);
          setVoiceError(canInstall ? "An on-device speech pack is required for this language." : "This desktop runtime has no on-device speech pack for this language. Remote recognition is disabled to keep dictation private.");
          if (handsFree) { handsFreeRef.current = false; setHandsFreeActive(false); }
          return;
        }
      } catch {
        setVoiceError("On-device speech availability could not be checked. Remote recognition is disabled to keep dictation private.");
        if (handsFree) { handsFreeRef.current = false; setHandsFreeActive(false); }
        return;
      }
    }
    if (handsFree && (!handsFreeRef.current || busyRef.current)) return;
    if (!handsFree && handsFreeRef.current) return;
    recognition.onresult = (event) => {
      const finalSegments: string[] = [];
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript?.trim();
        if (result?.isFinal && transcript) finalSegments.push(transcript);
      }
      const transcript = finalSegments.join(" ").trim();
      if (!transcript) return;
      if (handsFree) {
        if (!handsFreeRef.current || busyRef.current || awaitingResponseRef.current) return;
        awaitingResponseRef.current = true;
        sawBusyRef.current = false;
        recognition.stop();
        if (!onVoiceTranscript(transcript)) {
          awaitingResponseRef.current = false;
          setVoiceError("Add a document before speaking a Documents-only request.");
        } else {
          restartTimerRef.current = window.setTimeout(() => {
            if (awaitingResponseRef.current && !sawBusyRef.current && !busyRef.current && handsFreeRef.current) {
              awaitingResponseRef.current = false;
              void startVoiceRecognition(true);
            }
          }, 1200);
        }
      } else {
        const currentDraft = draftRef.current.trim();
        const nextDraft = `${currentDraft}${currentDraft ? " " : ""}${transcript}`;
        draftRef.current = nextDraft;
        onDraftChange(nextDraft);
      }
    };
    recognition.onerror = (event) => {
      if (handsFree && event.error === "no-speech") return;
      setVoicePackNeeded(event.error === "language-not-supported");
      setVoiceError(event.error === "not-allowed" ? "Microphone access was denied. Allow it in the desktop app permissions and try again." : event.error === "language-not-supported" ? "The local speech pack for this language is not installed. Install an on-device speech pack in this desktop runtime, then try again." : "On-device speech input could not be completed.");
      setVoiceListening(false);
      recognitionRef.current = null;
      if (handsFree) { handsFreeRef.current = false; setHandsFreeActive(false); awaitingResponseRef.current = false; }
    };
    recognition.onend = () => {
      setVoiceListening(false);
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      if (handsFreeRef.current && !awaitingResponseRef.current && !busyRef.current) {
        if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
        restartTimerRef.current = window.setTimeout(() => void startVoiceRecognition(true), 350);
      }
    };
    recognitionRef.current = recognition;
    setVoiceListening(true);
    try { recognition.start(); } catch {
      setVoiceListening(false);
      recognitionRef.current = null;
      setVoiceError("System speech input could not start.");
      if (handsFree) { handsFreeRef.current = false; setHandsFreeActive(false); }
    }
  };

  const toggleVoiceInput = () => {
    if (voiceListening) { recognitionRef.current?.stop(); return; }
    void startVoiceRecognition(false);
  };

  const toggleHandsFree = () => {
    if (handsFreeRef.current) {
      handsFreeRef.current = false;
      awaitingResponseRef.current = false;
      sawBusyRef.current = false;
      setHandsFreeActive(false);
      stopNativeSpeech();
      if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
      recognitionRef.current?.stop();
      return;
    }
    if (busyRef.current || voiceListening) return;
    handsFreeRef.current = true;
    awaitingResponseRef.current = false;
    setHandsFreeActive(true);
    void startVoiceRecognition(true);
  };

  const endVoiceMode = () => {
    handsFreeRef.current = false;
    awaitingResponseRef.current = false;
    sawBusyRef.current = false;
    setHandsFreeActive(false);
    stopNativeSpeech();
    if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
    recognitionRef.current?.stop();
  };

  const openFilePickerFromOmni = () => {
    setOmniOpen(false);
    onAttach();
  };

  const openAudioPickerFromOmni = () => {
    setOmniOpen(false);
    audioPickerRef.current?.click();
  };

  const startVoiceFromOmni = () => {
    setOmniOpen(false);
    toggleVoiceInput();
  };

  const startHandsFreeFromOmni = () => {
    setOmniOpen(false);
    toggleHandsFree();
  };

  const transcribeAudioFile = async (file: File) => {
    if (audioAbortRef.current || voiceListening || handsFreeRef.current || busyRef.current) return;
    const controller = new AbortController();
    audioAbortRef.current = controller;
    setAudioTranscribing(true);
    setAudioTranscriptReady(false);
    setVoiceError(null);
    setVoicePackNeeded(false);
    try {
      const transcript = await transcribeLocalAudioFile(file, controller.signal);
      const safeName = file.name.replace(/[^a-z0-9._-]+/gi, "-").replace(/-+/g, "-").slice(0, 120) || "audio";
      onAudioTranscript(safeName, transcript);
      setAudioTranscriptReady(true);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error("Local audio transcription failed.");
      setVoicePackNeeded(Boolean((failure as Error & { speechPackDownloadable?: boolean }).speechPackDownloadable));
      setVoiceError(failure.name === "AbortError" ? "Audio transcription cancelled." : failure.message);
    } finally {
      if (audioAbortRef.current === controller) audioAbortRef.current = null;
      setAudioTranscribing(false);
    }
  };

  const handleAudioDrop = (files: File[]) => {
    const audioFiles = files.filter(isLocalAudioFile);
    const otherFiles = files.filter((file) => !isLocalAudioFile(file));
    if (otherFiles.length > 0) onFilesDropped(otherFiles);
    for (const file of audioFiles) void transcribeAudioFile(file);
  };

  useEffect(() => {
    if (busy && handsFreeRef.current && !awaitingResponseRef.current) {
      awaitingResponseRef.current = true;
      sawBusyRef.current = true;
      recognitionRef.current?.stop();
    } else if (busy) {
      sawBusyRef.current = true;
    }
    if (busy || !handsFreeRef.current || !awaitingResponseRef.current || resumingRef.current) return;
    let cancelled = false;
    resumingRef.current = true;
    void waitForLocalSpeechToFinish().finally(() => {
      resumingRef.current = false;
      if (cancelled || !handsFreeRef.current) return;
      awaitingResponseRef.current = false;
      sawBusyRef.current = false;
      if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
      void startVoiceRecognition(true);
    });
    return () => { cancelled = true; };
  }, [busy]);

  const installLocalSpeechPack = async () => {
    const speechWindow = window as SpeechWindow;
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition?.install || voicePackInstalling) {
      setVoiceError("This desktop runtime cannot install an on-device speech pack. Dictation remains disabled to prevent remote processing.");
      setVoicePackNeeded(false);
      return;
    }
    setVoicePackInstalling(true);
    setVoiceError("Downloading the selected language pack for local speech recognition…");
    try {
      const installed = await Recognition.install({ langs: [navigator.language || "en-US"], processLocally: true, quality: "dictation" });
      if (!installed) throw new Error("The desktop runtime could not install this language pack.");
      setVoicePackNeeded(false);
      setVoiceError("The speech pack is installed on this device. Start Voice again when you’re ready to dictate.");
    } catch (error) {
      setVoicePackNeeded(true);
      setVoiceError(error instanceof Error ? error.message : "The local speech pack could not be installed.");
    } finally {
      setVoicePackInstalling(false);
    }
  };

  const selectComposerCommand = (command: ComposerCommand) => {
    onDraftChange("");
    if (command.route) onNavigate(command.route);
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

  return <section className={`composer-card ${dragActive ? "is-drag-active" : ""}`} aria-busy={rewriteBusy} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
    {dragActive && <div className="composer-drop-overlay" role="status">Drop files to attach</div>}
    {commandQuery !== null && <ComposerCommandMenu commands={commandMatches} activeIndex={commandIndex} onActiveIndexChange={setCommandIndex} onSelect={selectComposerCommand} />}
    {queuedMessages.length > 0 && <div className="queued-messages" aria-label="Queued messages"><div className="queued-heading"><span className="section-kicker">UP NEXT</span><span>{queuedMessages.length}/8 queued</span></div>{queuedMessages.map((queued) => <div className="queued-message" key={queued.index}><span>{queued.text}</span>{queued.attachments?.length ? <small>{queued.attachments.map((attachment) => attachment.fileName).join(", ")}</small> : null}<button type="button" onClick={() => onQueueRemove(queued.index)} aria-label={`Remove queued message ${queued.index + 1}`}>×</button></div>)}</div>}
    <AttachmentList attachments={attachments} onRemove={onRemoveAttachment} />
    <input ref={audioPickerRef} className="sr-only" type="file" accept=".mp3,.m4a,.ogg,.wav,audio/mpeg,audio/mp4,audio/ogg,audio/wav" tabIndex={-1} aria-hidden="true" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void transcribeAudioFile(file); }} />
    <textarea value={draft} disabled={rewriteBusy} onChange={(event) => onDraftChange(event.target.value)} onKeyDown={handleKeyDown} placeholder={rewriteBusy ? "Rewriting with the selected local model…" : busy ? "Type a follow-up while the model responds…" : "Message your model…"} aria-label="Message your model" aria-controls={commandQuery !== null ? "composer-command-menu" : undefined} aria-activedescendant={commandQuery !== null ? activeCommandId : undefined} aria-autocomplete={commandQuery !== null ? "list" : undefined} aria-expanded={commandQuery !== null ? commandMatches.length > 0 : undefined} rows={3} />
    {documentsOnly && attachments.length === 0 && <p className="composer-hint" role="status">Attach at least one document before sending in Documents-only mode.</p>}
    {audioTranscribing && <p className="composer-hint" role="status">Transcribing the selected audio on this device…</p>}
    {audioTranscriptReady && <p className="composer-hint" role="status">Local transcript added to the draft. Review it before sending.</p>}
    {voiceError && <div className="composer-voice-status"><p className="composer-voice-error" role="status">{voiceError}</p>{voicePackNeeded && <div className="composer-voice-install"><Button variant="secondary" type="button" disabled={voicePackInstalling} onClick={() => void installLocalSpeechPack()}>{voicePackInstalling ? "Installing local pack…" : "Install local speech pack"}</Button><span>The pack downloads once; dictation is processed on this device.</span></div>}</div>}
    <div className="composer-actions"><Button variant={documentsOnly ? "secondary" : "ghost"} type="button" onClick={onToggleDocumentsOnly} disabled={busy || rewriteBusy} aria-pressed={documentsOnly} title="Use only documents attached to this message as evidence">{documentsOnly ? "Docs only: on" : "Docs only"}</Button><Button variant="ghost" type="button" onClick={() => setOmniOpen(true)} disabled={rewriteBusy || (attachments.length >= 5 && !audioTranscribing)} aria-haspopup="dialog" aria-expanded={omniOpen} aria-describedby="attachment-help">Add</Button><Button variant={audioTranscribing ? "secondary" : "ghost"} type="button" onClick={() => audioAbortRef.current ? audioAbortRef.current.abort() : audioPickerRef.current?.click()} disabled={busy || rewriteBusy || voiceListening || handsFreeActive} title="Transcribe MP3, M4A, OGG, or WAV locally">{audioTranscribing ? "Stop audio" : "Audio"}</Button><Button variant={voiceListening ? "secondary" : "ghost"} type="button" onClick={toggleVoiceInput} disabled={rewriteBusy || handsFreeActive || audioTranscribing} aria-pressed={voiceListening} aria-label={voiceListening ? "Stop voice input" : "Start voice input"}>{voiceListening && !handsFreeActive ? "Stop mic" : "Voice"}</Button><Button variant={handsFreeActive ? "secondary" : "ghost"} type="button" onClick={toggleHandsFree} disabled={rewriteBusy || (voiceListening && !handsFreeActive) || audioTranscribing} aria-pressed={handsFreeActive} title="Start a local turn-based voice conversation">{handsFreeActive ? "Voice mode: on" : "Voice mode"}</Button><div><span id="attachment-help" className="composer-hint">{documentsOnly ? "Answers use only the documents attached to this message · " : ""}{attachments.length}/5 attached · Enter to {busy ? "queue" : "send"} · Shift+Enter for a new line · / for commands · $skill-id for a local skill · drop files here</span><Button variant={busy ? "secondary" : "primary"} disabled={rewriteBusy || (!draft.trim() && attachments.length === 0) || (documentsOnly && attachments.length === 0)} onClick={onSubmit}>{rewriteBusy ? "Rewriting…" : busy ? "Queue ↗" : "Send ↗"}</Button></div></div>
    <ModalDialog open={omniOpen} onClose={() => setOmniOpen(false)} titleId="omni-input-title" className="ui-dialog omni-input-dialog"><div className="dialog-heading"><div><p className="section-kicker">ADD TO THIS MESSAGE</p><h3 id="omni-input-title">Choose an input</h3><p>Attach local media or start a private voice turn. You can review attachments before sending.</p></div><button type="button" onClick={() => setOmniOpen(false)} aria-label="Close input menu">×</button></div><div className="omni-input-options"><button type="button" onClick={openFilePickerFromOmni} disabled={attachments.length >= 5}><strong>Files and folders</strong><span>Images, documents, PDFs, and videos</span><small>{attachments.length}/5 attachments</small></button><button type="button" onClick={openAudioPickerFromOmni} disabled={busy || voiceListening || handsFreeActive}><strong>Audio file</strong><span>Transcribe MP3, M4A, OGG, or WAV on this device</span><small>No raw audio is sent</small></button><button type="button" onClick={startVoiceFromOmni} disabled={rewriteBusy || handsFreeActive || audioTranscribing}><strong>Voice input</strong><span>Dictate one message into the composer</span><small>On-device speech recognition</small></button><button type="button" onClick={startHandsFreeFromOmni} disabled={rewriteBusy || voiceListening || audioTranscribing}><strong>Voice Mode</strong><span>Have a turn-based hands-free conversation</span><small>End anytime</small></button></div><div className="dialog-actions"><Button variant="ghost" type="button" onClick={() => setOmniOpen(false)}>Cancel</Button></div></ModalDialog>
    <ModalDialog open={handsFreeActive} onClose={endVoiceMode} titleId="voice-mode-title" className="ui-dialog voice-mode-dialog"><div className="voice-mode-session"><div className={`voice-mode-orb ${voiceListening ? "is-listening" : busy ? "is-speaking" : "is-preparing"}`} aria-hidden="true"><span /><span /><span /></div><p className="section-kicker">LOCAL VOICE MODE</p><h3 id="voice-mode-title">Voice conversation</h3><p className="voice-mode-state">{voiceListening ? "Listening on this device" : busy ? "Skai is responding" : "Preparing the next turn"}</p><p className="voice-mode-detail">{voiceListening ? "Speak naturally, then pause. Your words are transcribed locally before they are sent." : busy ? "The microphone is paused while the local model responds." : "The next listening turn will start after local speech finishes."}</p><div className="voice-mode-session-actions">{busy && <Button variant="ghost" type="button" onClick={stopNativeSpeech}>Stop speaking</Button>}<Button variant="secondary" type="button" onClick={endVoiceMode}>End voice mode</Button></div></div></ModalDialog>
  </section>;
}
