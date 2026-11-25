import { useEffect, useRef, useState } from "react";
import type { ChatAttachment } from "../../../shared/contracts";
import { selectedVoiceSettings, stopNativeSpeech, waitForLocalSpeechToFinish } from "../../services/nativeTts";
import { isLocalAudioFile, transcribeLocalAudioFile } from "./localAudioTranscription";
import { audioRms, isSustainedVoiceActivity, voiceActivityThreshold } from "./voiceActivity";

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

type UseChatComposerVoiceOptions = {
  draft: string;
  busy: boolean;
  onDraftChange: (draft: string) => void;
  onVoiceTranscript: (transcript: string) => boolean;
  onAudioTranscript: (fileName: string, transcript: string) => void;
  onFilesDropped: (files: File[]) => void;
};

export function useChatComposerVoice({ draft, busy, onDraftChange, onVoiceTranscript, onAudioTranscript, onFilesDropped }: UseChatComposerVoiceOptions) {
  const [voiceListening, setVoiceListening] = useState(false);
  const [handsFreeActive, setHandsFreeActive] = useState(false);
  const [voiceExpressiveness, setVoiceExpressiveness] = useState(() => selectedVoiceSettings().expressiveness);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceFallbackNotice, setVoiceFallbackNotice] = useState<string | null>(null);
  const [voicePackNeeded, setVoicePackNeeded] = useState(false);
  const [voicePackInstalling, setVoicePackInstalling] = useState(false);
  const [audioTranscribing, setAudioTranscribing] = useState(false);
  const [voiceTurnTranscribing, setVoiceTurnTranscribing] = useState(false);
  const [voicePlaybackActive, setVoicePlaybackActive] = useState(false);
  const [audioTranscriptReady, setAudioTranscriptReady] = useState(false);
  const audioPickerRef = useRef<HTMLInputElement>(null);
  const audioAbortRef = useRef<AbortController | null>(null);
  const whisperRecorderRef = useRef<{ recorder: MediaRecorder; stream: MediaStream; chunks: Blob[] } | null>(null);
  const whisperRecorderTimerRef = useRef<number | null>(null);
  const handsFreeCaptureRef = useRef<{ stream: MediaStream; context: AudioContext; frame: number; recorder: MediaRecorder | null; chunks: Blob[]; recentMonitorChunk: Blob | null; abort: AbortController | null; startedAt: number; lastSpeechAt: number; speechStartedAt: number; noiseFloor: number; monitorDuringPlayback: boolean; bargeInTriggered: boolean } | null>(null);
  const handsFreeAbortRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const handsFreeRef = useRef(false);
  const awaitingResponseRef = useRef(false);
  const pendingBargeInTranscriptRef = useRef<string | null>(null);
  const voicePlaybackActiveRef = useRef(false);
  const startHandsFreeListeningRef = useRef<(monitorDuringPlayback?: boolean) => Promise<void>>(async () => {});
  const sawBusyRef = useRef(false);
  const busyRef = useRef(busy);
  const draftRef = useRef(draft);
  const restartTimerRef = useRef<number | null>(null);
  const resumingRef = useRef(false);
  busyRef.current = busy;
  draftRef.current = draft;
  useEffect(() => () => {
    handsFreeRef.current = false;
    audioAbortRef.current?.abort();
    handsFreeAbortRef.current?.abort();
    pendingBargeInTranscriptRef.current = null;
    stopHandsFreeCapture(false);
    if (whisperRecorderTimerRef.current !== null) window.clearTimeout(whisperRecorderTimerRef.current);
    const recorder = whisperRecorderRef.current;
    whisperRecorderRef.current = null;
    if (recorder) { recorder.recorder.onstop = null; try { recorder.recorder.stop(); } catch { /* It may already have stopped. */ } recorder.stream.getTracks().forEach((track) => track.stop()); }
    if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
    recognitionRef.current?.stop();
    recognitionRef.current = null;
  }, []);

  useEffect(() => {
    const refreshVoiceSettings = () => setVoiceExpressiveness(selectedVoiceSettings().expressiveness);
    window.addEventListener("skai:voice-settings-updated", refreshVoiceSettings);
    return () => window.removeEventListener("skai:voice-settings-updated", refreshVoiceSettings);
  }, []);

  useEffect(() => {
    const onPlayback = (event: Event) => {
      const active = (event as CustomEvent<boolean>).detail === true;
      voicePlaybackActiveRef.current = active;
      setVoicePlaybackActive(active);
      const capture = handsFreeCaptureRef.current;
      if (active && handsFreeRef.current && awaitingResponseRef.current) {
        void startHandsFreeListeningRef.current(true);
      } else if (!active && capture?.monitorDuringPlayback && !capture.bargeInTriggered) {
        setVoiceListening(false);
        stopHandsFreeCapture(false);
      }
    };
    window.addEventListener("skai:voice-playback", onPlayback);
    return () => window.removeEventListener("skai:voice-playback", onPlayback);
  }, []);

  useEffect(() => {
    if (!busy && pendingBargeInTranscriptRef.current && handsFreeRef.current) {
      const transcript = pendingBargeInTranscriptRef.current;
      pendingBargeInTranscriptRef.current = null;
      awaitingResponseRef.current = false;
      sawBusyRef.current = false;
      if (!onVoiceTranscript(transcript)) {
        setVoiceError("The interrupted voice turn could not be submitted. Try again.");
        void startHandsFreeListening();
      }
      return;
    }
    if (busy && handsFreeRef.current && !awaitingResponseRef.current) {
      awaitingResponseRef.current = true;
      sawBusyRef.current = true;
      recognitionRef.current?.stop();
      if (!handsFreeCaptureRef.current?.monitorDuringPlayback) stopHandsFreeCapture(false);
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
      void startHandsFreeListening();
    });
    return () => { cancelled = true; };
  }, [busy]);

  useEffect(() => {
    const handleFallback = (event: Event) => setVoiceFallbackNotice((event as CustomEvent<{ message?: string }>).detail?.message ?? "The selected voice model failed to load. Using the native fallback voice.");
    window.addEventListener("skai:voice-fallback", handleFallback);
    return () => window.removeEventListener("skai:voice-fallback", handleFallback);
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

  const startWhisperMicrophone = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { void startVoiceRecognition(false); return; }
    try {
      const whisper = await window.skaiAgent?.request("voice.whisper.install.status");
      if (!whisper?.ok || !(whisper.result as { installed?: boolean } | undefined)?.installed) { void startVoiceRecognition(false); return; }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ["audio/webm;codecs=opus", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) { stream.getTracks().forEach((track) => track.stop()); setVoiceError("This desktop runtime cannot record a supported local audio format."); return; }
      const recorder = new MediaRecorder(stream, { mimeType });
      const recording = { recorder, stream, chunks: [] as Blob[] };
      whisperRecorderRef.current = recording;
      setVoiceError(null);
      setVoiceListening(true);
      recorder.ondataavailable = (event) => { if (event.data.size) recording.chunks.push(event.data); };
      recorder.onerror = () => {
        if (whisperRecorderRef.current === recording) whisperRecorderRef.current = null;
        stream.getTracks().forEach((track) => track.stop());
        setVoiceListening(false);
        setVoiceError("Local microphone recording failed. Check microphone permissions and try again.");
      };
      recorder.onstop = () => {
        if (whisperRecorderTimerRef.current !== null) window.clearTimeout(whisperRecorderTimerRef.current);
        whisperRecorderTimerRef.current = null;
        if (whisperRecorderRef.current === recording) whisperRecorderRef.current = null;
        stream.getTracks().forEach((track) => track.stop());
        setVoiceListening(false);
        const blob = new Blob(recording.chunks, { type: mimeType });
        if (!blob.size) { setVoiceError("No microphone audio was captured."); return; }
        if (blob.size > 20 * 1024 * 1024) { setVoiceError("This recording exceeded the 20 MB local transcription limit. Try a shorter recording."); return; }
        void transcribeAudioFile(new File([blob], `microphone-${Date.now()}.webm`, { type: "audio/webm" }));
      };
      recorder.start(1000);
      whisperRecorderTimerRef.current = window.setTimeout(() => { if (recorder.state === "recording") recorder.stop(); }, 5 * 60 * 1000);
    } catch (error) {
      setVoiceListening(false);
      setVoiceError(error instanceof Error && error.name === "NotAllowedError" ? "Microphone access was denied. Allow it in desktop app permissions and try again." : "The local microphone could not start. Check device permissions and try again.");
    }
  };

  const toggleVoiceInput = () => {
    const recording = whisperRecorderRef.current;
    if (recording) { try { recording.recorder.stop(); } catch { /* It may already have stopped. */ } return; }
    if (voiceListening) { recognitionRef.current?.stop(); return; }
    void startWhisperMicrophone();
  };

  const toggleHandsFree = () => {
    if (handsFreeRef.current) {
      handsFreeRef.current = false;
      awaitingResponseRef.current = false;
      sawBusyRef.current = false;
      pendingBargeInTranscriptRef.current = null;
      setHandsFreeActive(false);
      stopNativeSpeech();
      if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
      recognitionRef.current?.stop();
      handsFreeAbortRef.current?.abort();
      stopHandsFreeCapture(false);
      setVoiceTurnTranscribing(false);
      return;
    }
    if (busyRef.current || voiceListening) return;
    handsFreeRef.current = true;
    awaitingResponseRef.current = false;
    setHandsFreeActive(true);
    void startHandsFreeListening();
  };

  const endVoiceMode = () => {
    handsFreeRef.current = false;
    awaitingResponseRef.current = false;
    sawBusyRef.current = false;
    pendingBargeInTranscriptRef.current = null;
    setHandsFreeActive(false);
    stopNativeSpeech();
    if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
    recognitionRef.current?.stop();
    handsFreeAbortRef.current?.abort();
    stopHandsFreeCapture(false);
    setVoiceTurnTranscribing(false);
  };

  const stopHandsFreeCapture = (finishUtterance: boolean) => {
    const capture = handsFreeCaptureRef.current;
    if (!capture) return;
    handsFreeCaptureRef.current = null;
    window.clearInterval(capture.frame);
    capture.stream.getTracks().forEach((track) => track.stop());
    void capture.context.close().catch(() => {});
    if (capture.recorder && capture.recorder.state !== "inactive") {
      capture.recorder.onstop = finishUtterance ? capture.recorder.onstop : null;
      try { capture.recorder.stop(); } catch { /* It may already have stopped. */ }
    }
  };

  const startHandsFreeListening = async (monitorDuringPlayback = false) => {
    if (!handsFreeRef.current || (!monitorDuringPlayback && (busyRef.current || awaitingResponseRef.current)) || (monitorDuringPlayback && !voicePlaybackActiveRef.current) || handsFreeCaptureRef.current || handsFreeAbortRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined" || typeof AudioContext === "undefined") {
      setVoiceError("This desktop runtime cannot capture local Voice Mode audio.");
      endVoiceMode();
      return;
    }
    let pendingStream: MediaStream | null = null;
    let pendingContext: AudioContext | null = null;
    try {
      const whisper = await window.skaiAgent?.request("voice.whisper.install.status");
      if (!handsFreeRef.current) return;
      if (!whisper?.ok || !(whisper.result as { installed?: boolean } | undefined)?.installed) {
        setVoiceError("Install the local Whisper voice runtime before starting hands-free Voice Mode. Speech is never sent to a remote service.");
        endVoiceMode();
        return;
      }
      const stream = pendingStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (!handsFreeRef.current || (monitorDuringPlayback && !voicePlaybackActiveRef.current)) { stream.getTracks().forEach((track) => track.stop()); return; }
      const context = pendingContext = new AudioContext();
      await context.resume();
      if (!handsFreeRef.current || (monitorDuringPlayback && !voicePlaybackActiveRef.current)) {
        stream.getTracks().forEach((track) => track.stop());
        await context.close().catch(() => {});
        pendingStream = null;
        pendingContext = null;
        return;
      }
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      const silentMonitor = context.createGain();
      analyser.fftSize = 1024;
      silentMonitor.gain.value = 0;
      source.connect(analyser);
      analyser.connect(silentMonitor);
      silentMonitor.connect(context.destination);
      const samples = new Float32Array(analyser.fftSize);
      const mimeType = ["audio/webm;codecs=opus", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error("This desktop runtime cannot record a supported local audio format.");
      const capture = { stream, context, frame: 0, recorder: null as MediaRecorder | null, chunks: [] as Blob[], recentMonitorChunk: null as Blob | null, abort: null as AbortController | null, startedAt: performance.now(), lastSpeechAt: 0, speechStartedAt: 0, speechDetected: false, calibrationStartedAt: performance.now(), noiseFloor: 0.001, monitorDuringPlayback, bargeInTriggered: false };
      handsFreeCaptureRef.current = capture;
      capture.recorder = new MediaRecorder(stream, { mimeType });
      capture.recorder.ondataavailable = (event) => {
        if (!event.data.size) return;
        if (capture.monitorDuringPlayback) capture.recentMonitorChunk = event.data;
        else capture.chunks.push(event.data);
      };
      capture.recorder.start(250);
      setVoiceError(null);
      setVoiceListening(true);
      const finalize = () => {
        const recorder = capture.recorder;
        if (!recorder || recorder.state === "inactive") return;
        window.clearInterval(capture.frame);
        handsFreeCaptureRef.current = null;
        stream.getTracks().forEach((track) => track.stop());
        void context.close().catch(() => {});
        recorder.onstop = () => {
          if (!handsFreeRef.current) return;
          const blob = new Blob(capture.chunks, { type: mimeType });
          if (!blob.size || blob.size > 20 * 1024 * 1024) {
            if (blob.size > 20 * 1024 * 1024) setVoiceError("That voice turn exceeded the 20 MB local transcription limit. Try a shorter turn.");
            setVoiceListening(false);
            window.setTimeout(() => void startHandsFreeListening(), 400);
            return;
          }
          setVoiceListening(false);
          setVoiceTurnTranscribing(true);
          awaitingResponseRef.current = true;
          sawBusyRef.current = false;
          const controller = new AbortController();
          handsFreeAbortRef.current = controller;
          void transcribeLocalAudioFile(new File([blob], `voice-turn-${Date.now()}.webm`, { type: "audio/webm" }), controller.signal).then((transcript) => {
            if (!handsFreeRef.current || controller.signal.aborted) return;
            if (busyRef.current) {
              pendingBargeInTranscriptRef.current = transcript;
              return;
            }
            if (!onVoiceTranscript(transcript)) {
              awaitingResponseRef.current = false;
              setVoiceError("Add a document before speaking a Documents-only request.");
              window.setTimeout(() => void startHandsFreeListening(), 400);
            }
          }).catch((error) => {
            if (!handsFreeRef.current || controller.signal.aborted) return;
            const message = error instanceof Error ? error.message : "Local Whisper could not transcribe that voice turn.";
            if (!message.includes("did not recognize speech")) setVoiceError(message);
            awaitingResponseRef.current = false;
            window.setTimeout(() => void startHandsFreeListening(), 500);
          }).finally(() => {
            if (handsFreeAbortRef.current === controller) handsFreeAbortRef.current = null;
            setVoiceTurnTranscribing(false);
          });
        };
        recorder.stop();
      };
      const inspect = () => {
        if (!handsFreeRef.current || handsFreeCaptureRef.current !== capture) return;
        analyser.getFloatTimeDomainData(samples);
        const level = audioRms(samples);
        document.querySelector(".voice-mode-session")?.setAttribute("data-input-level", level.toFixed(6));
        const now = performance.now();
        const threshold = voiceActivityThreshold(capture.noiseFloor, capture.monitorDuringPlayback);
        if (!capture.monitorDuringPlayback && !capture.speechDetected && now - capture.calibrationStartedAt < 350) capture.noiseFloor = Math.min(0.02, capture.noiseFloor * 0.9 + level * 0.1);
        if (level > threshold) {
          capture.lastSpeechAt = now;
          if (!capture.speechStartedAt) capture.speechStartedAt = now;
          if (!capture.monitorDuringPlayback) capture.speechDetected = true;
          else if (!capture.bargeInTriggered && isSustainedVoiceActivity(level, threshold, capture.speechStartedAt, now)) {
            capture.bargeInTriggered = true;
            capture.speechDetected = true;
            capture.monitorDuringPlayback = false;
            capture.startedAt = now;
            capture.chunks.length = 0;
            if (capture.recentMonitorChunk) capture.chunks.push(capture.recentMonitorChunk);
            capture.recentMonitorChunk = null;
            const previousRecorder = capture.recorder;
            if (previousRecorder && previousRecorder.state !== "inactive") {
              previousRecorder.ondataavailable = null;
              previousRecorder.onstop = null;
              try { previousRecorder.stop(); } catch { /* It may already have stopped. */ }
            }
            const resumedRecorder = new MediaRecorder(stream, { mimeType });
            resumedRecorder.ondataavailable = (event) => { if (event.data.size) capture.chunks.push(event.data); };
            resumedRecorder.start(250);
            capture.recorder = resumedRecorder;
            setVoiceError(null);
            stopNativeSpeech();
          }
        } else if (capture.monitorDuringPlayback && !capture.bargeInTriggered) {
          capture.speechStartedAt = 0;
        }
        if ((!capture.monitorDuringPlayback && now - capture.startedAt > 30_000) || (capture.speechDetected && now - capture.lastSpeechAt > 900 && now - capture.speechStartedAt > 300)) { finalize(); return; }
        if (capture.context.state !== "running") void capture.context.resume();
      };
      capture.frame = window.setInterval(inspect, 40);
    } catch (error) {
      pendingStream?.getTracks().forEach((track) => track.stop());
      if (pendingContext && pendingContext.state !== "closed") await pendingContext.close().catch(() => {});
      setVoiceListening(false);
      setVoiceError(error instanceof Error && error.name === "NotAllowedError" ? "Microphone access was denied. Allow it in desktop app permissions and try again." : error instanceof Error ? error.message : "Local microphone capture failed.");
      endVoiceMode();
    }
  };
  startHandsFreeListeningRef.current = startHandsFreeListening;


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
  return { voiceListening, handsFreeActive, voiceExpressiveness, setVoiceExpressiveness, voiceError, voiceFallbackNotice, setVoiceFallbackNotice, voicePackNeeded, voicePackInstalling, audioTranscribing, voiceTurnTranscribing, voicePlaybackActive, audioTranscriptReady, audioPickerRef, whisperRecorderRef, toggleVoiceInput, toggleHandsFree, endVoiceMode, transcribeAudioFile, handleAudioDrop, installLocalSpeechPack };
}
