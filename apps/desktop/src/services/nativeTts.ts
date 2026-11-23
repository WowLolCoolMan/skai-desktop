export type VoiceProfile = {
  id: string;
  name: string;
  description: string;
  rate: number;
  pitch: number;
};

export type VoiceCapabilities = {
  supportsAudioEffects?: boolean;
  supportsEmotion?: boolean;
};

export type VoiceSource = "local" | "cloud";
export type CloudVoiceProviderId = "elevenlabs" | "inworld" | "cartesia";

/**
 * Speech controls are deliberately structured tags, not free-form prompts for
 * a voice engine. Engines may implement a cue, but unsupported cues are
 * removed before fallback speech so the user never hears "cough" or "laugh".
 */
export type SpeechCue = "laugh" | "cough" | "clear-throat" | "breath" | "sigh";

const speechCuePattern = /\[(laugh|cough|clear[- ]?throat|breath|sigh)(?::[^\]]+)?\]/gi;

export function removeUnsupportedSpeechCues(text: string, capabilities: VoiceCapabilities = {}) {
  if (capabilities.supportsAudioEffects) return text;
  return text.replace(speechCuePattern, "").replace(/[ \t]{2,}/g, " ").trim();
}

export const voiceProfiles: VoiceProfile[] = [
  { id: "skai-neutral", name: "Skai Neutral", description: "Balanced speed and clarity.", rate: 1, pitch: 1 },
  { id: "skai-warm", name: "Skai Warm", description: "Softer pacing for longer conversations.", rate: 0.95, pitch: 1.02 },
  { id: "skai-direct", name: "Skai Direct", description: "Crisp, quicker responses.", rate: 1.08, pitch: 1 },
  { id: "skai-calm", name: "Skai Calm", description: "Slower pacing for focused listening.", rate: 0.88, pitch: 0.98 },
];

export type InstalledVoiceModel = { id: string; name: string; detail: string; size: string; installed: boolean; lowResource: boolean; supportsAudioEffects?: boolean; supportsEmotion?: boolean };

export const voiceModels: InstalledVoiceModel[] = [
  { id: "os-native", name: "OS-native speech", detail: "Windows and Linux system voices", size: "No model", installed: true, lowResource: true },
  { id: "kokoro-82m-onnx", name: "Kokoro 82M ONNX", detail: "English offline local speech", size: "~136 MB INT8 model + voices", installed: false, lowResource: false },
  { id: "piper", name: "Piper English", detail: "Compact offline English speech", size: "~64 MB voice model", installed: false, lowResource: true },
  { id: "chatterbox", name: "Chatterbox Nano", detail: "English local speech; CPU-only runtime with resident model worker", size: "~1.9 GB weights + CPU runtime", installed: false, lowResource: false },
  { id: "qwen3-tts", name: "Qwen3-TTS 0.6B CustomVoice", detail: "Offline multilingual speech · 9 preset speakers · style control", size: "~2.5 GB model + runtime", installed: false, lowResource: false },
  { id: "omnivoice", name: "OmniVoice", detail: "Omnilingual zero-shot local speech", size: "Model-dependent", installed: false, lowResource: false },
  { id: "higgs-audio-v2", name: "Higgs Audio v2", detail: "Expressive local multi-speaker audio generation", size: "3B model", installed: false, lowResource: false },
  { id: "pocket-tts", name: "Pocket TTS", detail: "CPU-first offline English runtime", size: "~209 MB model + shared runtime", installed: false, lowResource: false },
  { id: "pocket-tts-low-resource", name: "Pocket TTS Low Resource", detail: "Small CPU-first English runtime", size: "~20 MB model", installed: false, lowResource: true },
];

export const cloudVoiceProviders = [
  { id: "elevenlabs" as const, name: "ElevenLabs", model: "eleven_v4", defaultVoiceId: "21m00Tcm4TlvDq8ikWAM", detail: "Hosted expressive speech and voice library", supportsStreaming: true },
  { id: "inworld" as const, name: "Inworld Realtime TTS-2", model: "inworld-tts-2", defaultVoiceId: "Ashley", detail: "Hosted realtime conversational speech", supportsStreaming: true },
  { id: "cartesia" as const, name: "Cartesia Sonic 3.5", model: "sonic-3.5", defaultVoiceId: "f786b574-daa5-4673-aa0c-cbe3e8534c02", detail: "Hosted low-latency speech", supportsStreaming: true },
] as const;

// The Agent Host is authoritative: a persisted browser flag can outlive an
// uninstall or point at a runtime that is unavailable on this host.
export const installedVoiceModels: InstalledVoiceModel[] = [];

export async function refreshInstalledVoiceModels() {
  try {
    const response = await window.skaiAgent?.request("voice.models");
    if (!response?.ok) return installedVoiceModels;
    const result = response.result as { models?: Array<InstalledVoiceModel & { adapterAvailable?: boolean }> };
    const discovered = (result.models ?? []).filter((voice) => voice.installed && voice.adapterAvailable);
    const next = discovered.map(({ adapterAvailable: _adapterAvailable, ...voice }) => voice);
    const changed = JSON.stringify(installedVoiceModels) !== JSON.stringify(next);
    installedVoiceModels.splice(0, installedVoiceModels.length, ...next);
    if (changed) window.dispatchEvent(new CustomEvent("skai:voice-models-updated"));
  } catch {
    // Leave the inventory empty when the local host cannot be queried.
  }
  return installedVoiceModels;
}

export function registerInstalledVoiceModel(id: string) {
  const voice = voiceModels.find((item) => item.id === id);
  if (!voice || installedVoiceModels.some((item) => item.id === id)) return;
  installedVoiceModels.push({ ...voice, installed: true });
  window.dispatchEvent(new CustomEvent("skai:voice-models-updated"));
}

export function unregisterInstalledVoiceModel(id: string) {
  const index = installedVoiceModels.findIndex((item) => item.id === id);
  if (index >= 0) installedVoiceModels.splice(index, 1);
  window.dispatchEvent(new CustomEvent("skai:voice-models-updated"));
}

function resolveInstalledVoiceModel(value: string | null, lowResourceOnly = false) {
  const candidates = lowResourceOnly ? installedVoiceModels.filter((voice) => voice.lowResource) : installedVoiceModels;
  return candidates.find((voice) => voice.id === value)?.id ?? candidates[0]?.id ?? "";
}

const selectedProfileKey = "skai.voice.profile";
const primaryModelKey = "skai.voice.primaryModel";
const lowResourceModelKey = "skai.voice.lowResourceModel";
const lowResourceModeKey = "skai.voice.lowResourceMode";
const voiceOutputKey = "skai.voice.outputEnabled";
const voiceSourceKey = "skai.voice.source";
const cloudProviderKey = "skai.voice.cloudProvider";
const cloudVoiceIdKey = "skai.voice.cloudVoiceId";
const cloudModelIdKey = "skai.voice.cloudModelId";
const qwenSpeakerKey = "skai.voice.qwenSpeaker";
let activeCloudAudio: HTMLAudioElement | null = null;
let speechGeneration = 0;
function setVoicePlaybackActive(active: boolean) {
  window.dispatchEvent(new CustomEvent("skai:voice-playback", { detail: active }));
}

export function selectedVoiceSettings() {
  const selectedProvider = cloudVoiceProviders.find((provider) => provider.id === localStorage.getItem(cloudProviderKey)) ?? cloudVoiceProviders[0];
  return {
    profileId: localStorage.getItem(selectedProfileKey) ?? "skai-neutral",
    primaryModelId: resolveInstalledVoiceModel(localStorage.getItem(primaryModelKey)),
    lowResourceModelId: resolveInstalledVoiceModel(localStorage.getItem(lowResourceModelKey), true),
    lowResourceMode: localStorage.getItem(lowResourceModeKey) === "true"
      && Boolean(resolveInstalledVoiceModel(localStorage.getItem(lowResourceModelKey), true))
      && resolveInstalledVoiceModel(localStorage.getItem(lowResourceModelKey), true) !== resolveInstalledVoiceModel(localStorage.getItem(primaryModelKey)),
    voiceOutputEnabled: localStorage.getItem(voiceOutputKey) === "true",
    source: localStorage.getItem(voiceSourceKey) === "cloud" ? "cloud" as VoiceSource : "local" as VoiceSource,
    cloudProvider: selectedProvider.id,
    cloudModelId: localStorage.getItem(cloudModelIdKey) ?? selectedProvider.model,
    cloudVoiceId: localStorage.getItem(cloudVoiceIdKey) ?? selectedProvider.defaultVoiceId,
    qwenSpeaker: localStorage.getItem(qwenSpeakerKey) ?? "Ryan",
  };
}

export function saveVoiceSetting(key: "profileId" | "primaryModelId" | "lowResourceModelId" | "lowResourceMode" | "voiceOutputEnabled" | "source" | "cloudProvider" | "cloudModelId" | "cloudVoiceId" | "qwenSpeaker", value: string | boolean) {
  const storageKey = { profileId: selectedProfileKey, primaryModelId: primaryModelKey, lowResourceModelId: lowResourceModelKey, lowResourceMode: lowResourceModeKey, voiceOutputEnabled: voiceOutputKey, source: voiceSourceKey, cloudProvider: cloudProviderKey, cloudModelId: cloudModelIdKey, cloudVoiceId: cloudVoiceIdKey, qwenSpeaker: qwenSpeakerKey }[key];
  const safeValue = key === "primaryModelId" ? resolveInstalledVoiceModel(String(value)) : key === "lowResourceModelId" ? resolveInstalledVoiceModel(String(value), true) : value;
  localStorage.setItem(storageKey, String(safeValue));
}

export function stopNativeSpeech() {
  speechGeneration += 1;
  void window.skaiAgent?.request("voice.stop");
  activeCloudAudio?.pause();
  activeCloudAudio = null;
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  setVoicePlaybackActive(false);
  window.dispatchEvent(new CustomEvent("skai:voice-playback-stopped"));
}

export function currentSpeechGeneration() { return speechGeneration; }

export async function waitForLocalSpeechToFinish(maxWaitMs = 120_000) {
  const deadline = Date.now() + maxWaitMs;
  await new Promise((resolve) => window.setTimeout(resolve, 180));
  while (Date.now() < deadline) {
    let nativeSpeaking = false;
    try {
      const response = await window.skaiAgent?.request("voice.status");
      if (response?.ok) nativeSpeaking = Boolean((response.result as { speaking?: unknown } | undefined)?.speaking);
    } catch {
      // The system speech process may not be available in this runtime.
    }
    const browserSpeaking = "speechSynthesis" in window && (window.speechSynthesis.speaking || window.speechSynthesis.pending);
    const cloudSpeaking = Boolean(activeCloudAudio && !activeCloudAudio.paused && !activeCloudAudio.ended);
    if (!nativeSpeaking && !browserSpeaking && !cloudSpeaking) return;
    await new Promise((resolve) => window.setTimeout(resolve, 250));
  }
}

export async function speakNativeResponse(text: string, force = false, profileId?: string) {
  if (!text.trim()) return false;
  const settings = selectedVoiceSettings();
  if (!force && !settings.voiceOutputEnabled) return false;
  const profile = voiceProfiles.find((item) => item.id === (profileId || settings.profileId)) ?? voiceProfiles[0];
  const generation = speechGeneration;
  const runtimeId = settings.lowResourceMode ? settings.lowResourceModelId : settings.primaryModelId;
  const runtime = installedVoiceModels.find((voice) => voice.id === runtimeId);
  const safeText = removeUnsupportedSpeechCues(text, runtime);
  if (!safeText) return false;
  // Skai profiles control pacing on every engine. Pitch is applied only by the
  // browser's native fallback; local model runtimes do not expose pitch control.
  const fallbackPitch = settings.source === "local" && runtimeId === "os-native" ? profile.pitch : 1;
  try {
    const speech = settings.source === "cloud"
      ? await window.skaiAgent?.request("voice.speak", { text: safeText, profileId: profile.id, rate: profile.rate, provider: settings.cloudProvider, modelId: settings.cloudModelId, voiceId: settings.cloudVoiceId })
      : await window.skaiAgent?.request("voice.speak", { text: safeText, profileId: profile.id, rate: profile.rate, modelId: runtimeId, speaker: runtimeId === "qwen3-tts" ? settings.qwenSpeaker : undefined });
    if (speech?.ok) {
      if (generation !== speechGeneration) return false;
      const audioDataUrl = (speech.result as { audioDataUrl?: unknown } | undefined)?.audioDataUrl;
      if (typeof audioDataUrl === "string" && audioDataUrl.startsWith("data:audio/")) {
        activeCloudAudio?.pause();
        activeCloudAudio = new Audio(audioDataUrl);
        const audio = activeCloudAudio;
        let finishPlayback!: () => void;
        const playbackFinished = new Promise<void>((resolve) => { finishPlayback = resolve; });
        const playbackEnded = () => {
          if (activeCloudAudio === audio) activeCloudAudio = null;
          setVoicePlaybackActive(false);
          finishPlayback();
        };
        audio.addEventListener("playing", () => setVoicePlaybackActive(true), { once: true });
        audio.addEventListener("ended", playbackEnded, { once: true });
        audio.addEventListener("pause", playbackEnded, { once: true });
        audio.addEventListener("error", playbackEnded, { once: true });
        if (["chatterbox-nano-local", "pocket-tts-local", "qwen3-tts-local"].includes((speech.result as { engine?: unknown }).engine as string)) {
          audio.preservesPitch = true;
          audio.playbackRate = profile.rate;
        }
        await audio.play();
        await playbackFinished;
      } else {
        setVoicePlaybackActive(true);
        await waitForLocalSpeechToFinish().finally(() => setVoicePlaybackActive(false));
      }
      return true;
    }
    window.dispatchEvent(new CustomEvent("skai:voice-fallback", { detail: { message: "The selected voice model failed to load. Using the native fallback voice." } }));
  } catch {
    window.dispatchEvent(new CustomEvent("skai:voice-fallback", { detail: { message: "The selected voice model failed to load. Using the native fallback voice." } }));
  }
  if (generation !== speechGeneration) return false;
  if (!("speechSynthesis" in window)) return false;
  const localVoice = window.speechSynthesis.getVoices().find((voice) => voice.localService);
  if (!localVoice) {
    window.dispatchEvent(new CustomEvent("skai:voice-fallback", { detail: { message: "The voice model failed to load, and no native fallback voice is available on this device." } }));
    return false;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(safeText.replace(/[`*_>#]/g, "").replace(/\s+/g, " ").trim().slice(0, 4000));
  utterance.voice = localVoice;
  utterance.rate = profile.rate;
  utterance.pitch = fallbackPitch;
  utterance.onstart = () => setVoicePlaybackActive(true);
  const browserPlaybackFinished = new Promise<void>((resolve) => {
    utterance.onend = () => { setVoicePlaybackActive(false); resolve(); };
    utterance.onerror = () => { setVoicePlaybackActive(false); resolve(); };
  });
  window.speechSynthesis.speak(utterance);
  await browserPlaybackFinished;
  return true;
}
