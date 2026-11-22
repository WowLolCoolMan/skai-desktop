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

/**
 * Speech controls are deliberately structured tags, not free-form prompts for
 * a voice engine. Engines may implement a cue, but unsupported cues are
 * removed before fallback speech so the user never hears "cough" or "laugh".
 */
export type SpeechCue = "laugh" | "cough" | "clear-throat" | "breath" | "sigh";

const speechCuePattern = /\[(laugh|cough|clear[- ]?throat|breath|sigh)(?::[^\]]+)?\]/gi;

export function removeUnsupportedSpeechCues(text: string, capabilities: VoiceCapabilities = {}) {
  if (capabilities.supportsAudioEffects || capabilities.supportsEmotion) return text;
  return text.replace(speechCuePattern, "").replace(/[ \t]{2,}/g, " ").trim();
}

export const voiceProfiles: VoiceProfile[] = [
  { id: "skai-neutral", name: "Skai Neutral", description: "Balanced speed and clarity.", rate: 1, pitch: 1 },
  { id: "skai-warm", name: "Skai Warm", description: "Softer pacing for longer conversations.", rate: 0.95, pitch: 1.02 },
  { id: "skai-direct", name: "Skai Direct", description: "Crisp, quicker responses.", rate: 1.08, pitch: 1 },
  { id: "skai-calm", name: "Skai Calm", description: "Slower pacing for focused listening.", rate: 0.88, pitch: 0.98 },
];

export const voiceModels = [
  { id: "os-native", name: "OS-native speech", detail: "Windows and Linux system voices", size: "No model", installed: true, lowResource: true },
  { id: "kokoro-82m-onnx", name: "Kokoro 82M ONNX", detail: "Natural multi-voice local runtime", size: "~163 MB fp16 model + voices", installed: false, lowResource: false },
  { id: "pocket-tts", name: "Pocket TTS", detail: "CPU-first streaming voice runtime", size: "Model-dependent", installed: false, lowResource: false },
  { id: "pocket-tts-low-resource", name: "Pocket TTS Low Resource", detail: "Small CPU-first English runtime", size: "Small model", installed: false, lowResource: true },
] as const;

export const installedVoiceModels = voiceModels.filter((voice) => voice.installed);

function resolveInstalledVoiceModel(value: string | null) {
  return installedVoiceModels.find((voice) => voice.id === value)?.id ?? installedVoiceModels[0]?.id ?? "os-native";
}

const selectedProfileKey = "skai.voice.profile";
const primaryModelKey = "skai.voice.primaryModel";
const lowResourceModelKey = "skai.voice.lowResourceModel";
const lowResourceModeKey = "skai.voice.lowResourceMode";
const voiceOutputKey = "skai.voice.outputEnabled";
const voiceSourceKey = "skai.voice.source";
const cloudVoiceIdKey = "skai.voice.cloudVoiceId";
const cloudVoiceEndpoint = "https://api.elevenlabs.io/v1/text-to-speech";
let sessionCloudApiKey = "";
let activeCloudAudio: HTMLAudioElement | null = null;

export function selectedVoiceSettings() {
  return {
    profileId: localStorage.getItem(selectedProfileKey) ?? "skai-neutral",
    primaryModelId: resolveInstalledVoiceModel(localStorage.getItem(primaryModelKey)),
    lowResourceModelId: resolveInstalledVoiceModel(localStorage.getItem(lowResourceModelKey)),
    lowResourceMode: localStorage.getItem(lowResourceModeKey) === "true",
    voiceOutputEnabled: localStorage.getItem(voiceOutputKey) === "true",
    source: localStorage.getItem(voiceSourceKey) === "cloud" ? "cloud" as VoiceSource : "local" as VoiceSource,
    cloudVoiceId: localStorage.getItem(cloudVoiceIdKey) ?? "21m00Tcm4TlvDq8ikWAM",
  };
}

export function saveVoiceSetting(key: "profileId" | "primaryModelId" | "lowResourceModelId" | "lowResourceMode" | "voiceOutputEnabled" | "source" | "cloudVoiceId", value: string | boolean) {
  const storageKey = { profileId: selectedProfileKey, primaryModelId: primaryModelKey, lowResourceModelId: lowResourceModelKey, lowResourceMode: lowResourceModeKey, voiceOutputEnabled: voiceOutputKey, source: voiceSourceKey, cloudVoiceId: cloudVoiceIdKey }[key];
  const safeValue = key === "primaryModelId" || key === "lowResourceModelId" ? resolveInstalledVoiceModel(String(value)) : value;
  localStorage.setItem(storageKey, String(safeValue));
}

export function setCloudVoiceApiKey(value: string) { sessionCloudApiKey = value.trim(); }
export function cloudVoiceApiKeyConfigured() { return sessionCloudApiKey.length >= 8; }

export function stopNativeSpeech() {
  void window.skaiAgent?.request("voice.stop");
  activeCloudAudio?.pause();
  activeCloudAudio = null;
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

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
  const safeText = removeUnsupportedSpeechCues(text);
  if (!safeText) return false;
  const settings = selectedVoiceSettings();
  if (!force && !settings.voiceOutputEnabled) return false;
  const profile = voiceProfiles.find((item) => item.id === (profileId || settings.profileId)) ?? voiceProfiles[0];
  try {
    const speech = settings.source === "cloud"
      ? await window.skaiAgent?.request("voice.speak", { text: safeText, profileId: profile.id, rate: profile.rate, provider: "elevenlabs", endpoint: cloudVoiceEndpoint, voiceId: settings.cloudVoiceId, apiKey: sessionCloudApiKey })
      : await window.skaiAgent?.request("voice.speak", { text: safeText, profileId: profile.id, rate: profile.rate });
    if (speech?.ok) {
      const audioDataUrl = (speech.result as { audioDataUrl?: unknown } | undefined)?.audioDataUrl;
      if (typeof audioDataUrl === "string" && audioDataUrl.startsWith("data:audio/mpeg;base64,")) {
        activeCloudAudio?.pause();
        activeCloudAudio = new Audio(audioDataUrl);
        activeCloudAudio.addEventListener("ended", () => { activeCloudAudio = null; }, { once: true });
        await activeCloudAudio.play();
      }
      return true;
    }
    window.dispatchEvent(new CustomEvent("skai:voice-fallback", { detail: { message: "The selected voice model failed to load. Using the native fallback voice." } }));
  } catch {
    window.dispatchEvent(new CustomEvent("skai:voice-fallback", { detail: { message: "The selected voice model failed to load. Using the native fallback voice." } }));
  }
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
  utterance.pitch = profile.pitch;
  window.speechSynthesis.speak(utterance);
  return true;
}
