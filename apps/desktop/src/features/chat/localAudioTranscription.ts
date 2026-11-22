type AudioMediaType = "audio/mp4" | "audio/mpeg" | "audio/ogg" | "audio/wav";
type RecognitionResultEvent = Event & { resultIndex: number; results: { [index: number]: { [index: number]: { transcript: string }; isFinal: boolean }; length: number } };
type LocalRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  processLocally?: boolean;
  onend: (() => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  start: (audioTrack?: MediaStreamTrack) => void;
  stop: () => void;
  abort: () => void;
};
type RecognitionConstructor = (new () => LocalRecognition) & {
  available?: (options: { langs: string[]; processLocally: boolean; quality: "dictation" }) => Promise<string>;
};

const maxAudioBytes = 20 * 1024 * 1024;
const maxAudioDurationSeconds = 15 * 60;
const audioTypes: Record<string, AudioMediaType> = { m4a: "audio/mp4", mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav" };

export function isLocalAudioFile(file: File) {
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  const expected = audioTypes[extension];
  return Boolean(expected && (!file.type || file.type === "application/octet-stream" || file.type === expected || (extension === "wav" && file.type === "audio/x-wav")));
}

export async function transcribeLocalAudioFile(file: File, signal: AbortSignal) {
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  const mediaType = audioTypes[extension];
  if (!mediaType || !isLocalAudioFile(file)) throw new Error("Choose an MP3, M4A, OGG, or WAV audio file.");
  if (!file.size || file.size > maxAudioBytes) throw new Error("Audio files must be smaller than 20 MB to transcribe locally.");
  const whisperStatus = await window.skaiAgent?.request("voice.whisper.install.status");
  if (whisperStatus?.ok && (whisperStatus.result as { installed?: boolean } | undefined)?.installed) {
    throwIfAborted(signal);
    const audioBase64 = await fileToBase64(file);
    throwIfAborted(signal);
    const response = await window.skaiAgent?.request("voice.whisper.transcribe", {
      audioBase64, fileName: file.name, language: navigator.language || "en-US",
    });
    throwIfAborted(signal);
    if (!response?.ok) throw new Error(response?.error?.message ?? "Local Whisper transcription failed.");
    const transcript = (response.result as { transcript?: unknown } | undefined)?.transcript;
    if (typeof transcript !== "string" || !transcript.trim()) throw new Error("Whisper did not recognize speech in this audio.");
    return transcript.trim();
  }
  const bridge = window.skaiAgent?.media;
  if (!bridge) throw new Error("Local audio processing is unavailable in this desktop runtime.");
  const speechWindow = window as Window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
  if (!Recognition || !Recognition.available) throw new Error("This desktop runtime cannot verify on-device audio transcription; audio stays local and was not processed.");

  const language = navigator.language || "en-US";
  const context = new AudioContext();
  const contextResumed = context.resume().catch(() => undefined);
  const audio = document.createElement("audio");
  let source: MediaElementAudioSourceNode | undefined;
  let destination: MediaStreamAudioDestinationNode | undefined;
  let url: string | undefined;
  let recognition: LocalRecognition | undefined;
  let finishTranscription: (error?: Error) => void = () => {};
  const tracks: MediaStreamTrack[] = [];
  try {
    const availability = await Recognition.available({ langs: [language], processLocally: true, quality: "dictation" });
    if (availability !== "available") {
      const error = new Error(availability === "downloadable" || availability === "downloading"
        ? "Install the on-device speech pack before transcribing audio."
        : "This desktop runtime has no on-device speech pack for this language. Audio was not sent to a remote service.");
      Object.assign(error, { speechPackDownloadable: availability === "downloadable" || availability === "downloading" });
      throw error;
    }
    await contextResumed;
    if (context.state !== "running") throw new Error("Audio playback could not start inside the local transcription engine.");
    throwIfAborted(signal);
    const base64 = await fileToBase64(file);
    throwIfAborted(signal);
    url = await bridge.createLocalUrl(mediaType, base64);
    throwIfAborted(signal);
    audio.preload = "metadata";
    audio.src = url;
    await waitForAudioEvent(audio, "loadedmetadata", signal);
    if (!Number.isFinite(audio.duration) || audio.duration <= 0 || audio.duration > maxAudioDurationSeconds)
      throw new Error("Audio files must be 15 minutes or shorter to transcribe locally.");
    source = context.createMediaElementSource(audio);
    destination = context.createMediaStreamDestination();
    source.connect(destination);
    const track = destination.stream.getAudioTracks()[0];
    if (!track || track.readyState !== "live") throw new Error("The selected audio file did not provide a readable audio track.");
    tracks.push(...destination.stream.getTracks());

    recognition = new Recognition();
    recognition.processLocally = true;
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = language;
    const transcript: string[] = [];
    const result = new Promise<string>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        clearTimeout(timeout);
        error ? reject(error) : resolve(transcript.join(" ").trim());
      };
      finishTranscription = finish;
      const onAbort = () => { recognition?.abort(); finish(new DOMException("Audio transcription cancelled.", "AbortError")); };
      const timeout = window.setTimeout(() => { recognition?.abort(); finish(new Error("Local audio transcription timed out.")); }, maxAudioDurationSeconds * 1000 + 15_000);
      signal.addEventListener("abort", onAbort, { once: true });
      recognition!.onresult = (event) => {
        for (let index = event.resultIndex; index < event.results.length; index++) {
          const item = event.results[index];
          const text = item?.[0]?.transcript?.trim();
          if (item?.isFinal && text) transcript.push(text);
        }
      };
      recognition!.onerror = (event) => finish(new Error(event.error === "language-not-supported"
        ? "The local speech pack for this language is not installed. Install it, then try again."
        : "On-device audio transcription could not be completed."));
      recognition!.onend = () => finish();
    });
    void result.catch(() => {});

    audio.addEventListener("ended", () => recognition?.stop(), { once: true });
    try { recognition.start(track); }
    catch {
      const error = new Error("This desktop runtime cannot transcribe audio tracks locally.");
      finishTranscription(error);
      throw error;
    }
    await audio.play();
    const text = await result;
    if (!text) throw new Error("No speech was recognized in this audio file.");
    return text;
  } finally {
    audio.pause();
    try { recognition?.abort(); } catch { /* It may already have ended. */ }
    finishTranscription(new DOMException("Audio transcription ended.", "AbortError"));
    for (const track of tracks) track.stop();
    source?.disconnect();
    destination?.disconnect();
    audio.removeAttribute("src");
    audio.load();
    await context.close().catch(() => {});
    if (url) await bridge.revokeLocalUrl(url).catch(() => {});
  }
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result ?? "");
      resolve(value.slice(value.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function waitForAudioEvent(audio: HTMLAudioElement, eventName: "loadedmetadata", signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("Audio transcription cancelled.", "AbortError")); return; }
    const cleanup = () => {
      clearTimeout(timeout);
      audio.removeEventListener(eventName, onReady);
      audio.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    const onReady = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error("The local audio file could not be decoded.")); };
    const onAbort = () => { cleanup(); reject(new DOMException("Audio transcription cancelled.", "AbortError")); };
    const timeout = window.setTimeout(() => { cleanup(); reject(new Error("Reading local audio metadata timed out.")); }, 10_000);
    audio.addEventListener(eventName, onReady, { once: true });
    audio.addEventListener("error", onError, { once: true });
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("Audio transcription cancelled.", "AbortError");
}
