import { useEffect, useState } from "react";
import { Button, Card } from "../../components/ui/Primitives";
import { NavIcon } from "../../components/ui/NavIcon";
import "./pluginsMcpHealth.css";
import { installedVoiceModels, refreshInstalledVoiceModels, saveVoiceSetting, selectedVoiceSettings, speakNativeResponse, stopNativeSpeech, voiceProfiles } from "../../services/nativeTts";
import { request } from "./marketplaceRequest";

type WorkbenchVoiceProfile = {
  id: string;
  name: string;
  engineId: string;
  clipNames: string[];
  status: "Ready" | "Changes pending" | "Building" | "Adapter unavailable";
  updatedAt: string;
};

type StoredVoiceClip = {
  key: string;
  profileId: string;
  name: string;
  blob: Blob;
  storedAt: string;
};

const WORKBENCH_PROFILES_KEY = "skai.voice.workbench.profiles";
const WORKBENCH_NOTICE_KEY = "skai.voice.workbench.rightsNoticeAcknowledged";
const VOICE_CLIPS_DB = "skai-voice-workbench";
const VOICE_CLIPS_STORE = "clips";

function openVoiceClipStore(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(VOICE_CLIPS_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(VOICE_CLIPS_STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function storeVoiceClip(profileId: string, file: File): Promise<boolean> {
  const database = await openVoiceClipStore();
  if (!database) return false;
  return new Promise((resolve) => {
    const transaction = database.transaction(VOICE_CLIPS_STORE, "readwrite");
    const clip: StoredVoiceClip = {
      key: `${profileId}:${file.name}`,
      profileId,
      name: file.name,
      blob: file,
      storedAt: new Date().toISOString(),
    };
    transaction.objectStore(VOICE_CLIPS_STORE).put(clip);
    transaction.oncomplete = () => { database.close(); resolve(true); };
    transaction.onerror = () => { database.close(); resolve(false); };
  });
}

function loadWorkbenchProfiles(): WorkbenchVoiceProfile[] {
  try {
    const value = JSON.parse(localStorage.getItem(WORKBENCH_PROFILES_KEY) ?? "[]") as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is WorkbenchVoiceProfile => Boolean(item && typeof item === "object" && typeof (item as WorkbenchVoiceProfile).id === "string" && typeof (item as WorkbenchVoiceProfile).name === "string"));
  } catch {
    return [];
  }
}

function saveWorkbenchProfiles(profiles: WorkbenchVoiceProfile[]) {
  localStorage.setItem(WORKBENCH_PROFILES_KEY, JSON.stringify(profiles.slice(0, 24)));
}

export function VoiceWorkbench({ onBack }: { onBack: () => void }) {
  const [settings, setSettings] = useState(selectedVoiceSettings);
  const [workbenchProfiles, setWorkbenchProfiles] = useState<WorkbenchVoiceProfile[]>(loadWorkbenchProfiles);
  const [activeWorkbenchId, setActiveWorkbenchId] = useState(() => loadWorkbenchProfiles()[0]?.id ?? "");
  const [newProfileName, setNewProfileName] = useState("");
  const [clipStorageNotice, setClipStorageNotice] = useState<string | null>(null);
  const [rightsNoticeOpen, setRightsNoticeOpen] = useState(() => localStorage.getItem(WORKBENCH_NOTICE_KEY) !== "true");
  useEffect(() => {
    let active = true;
    const refresh = async () => { await refreshInstalledVoiceModels(); if (active) setSettings(selectedVoiceSettings()); };
    void refresh();
    window.addEventListener("skai:voice-models-updated", refresh);
    return () => { active = false; window.removeEventListener("skai:voice-models-updated", refresh); };
  }, []);
  const activeWorkbench = workbenchProfiles.find((item) => item.id === activeWorkbenchId) ?? null;
  const activeRuntimeId = settings.lowResourceMode ? settings.lowResourceModelId : settings.primaryModelId;
  const activeRuntime = installedVoiceModels.find((voice) => voice.id === activeRuntimeId);
  const hasOptionalLowResourceRuntime = installedVoiceModels.some((voice) => voice.lowResource && voice.id !== settings.primaryModelId);
  const update = (
    key:
      "profileId" | "primaryModelId" | "lowResourceMode" | "voiceOutputEnabled",
    value: string | boolean,
  ) => {
    saveVoiceSetting(key, value);
    setSettings(selectedVoiceSettings());
  };
  const profile =
    voiceProfiles.find((item) => item.id === settings.profileId) ??
    voiceProfiles[0];
  const updateWorkbench = (change: Partial<WorkbenchVoiceProfile>) => {
    if (!activeWorkbench) return;
    const next = workbenchProfiles.map((item) => item.id === activeWorkbench.id ? { ...item, ...change, updatedAt: new Date().toISOString() } : item);
    setWorkbenchProfiles(next);
    saveWorkbenchProfiles(next);
  };
  const createWorkbenchProfile = () => {
    const name = newProfileName.trim();
    if (!name) return;
    const created: WorkbenchVoiceProfile = { id: `voice-${crypto.randomUUID()}`, name, engineId: settings.primaryModelId, clipNames: [], status: "Changes pending", updatedAt: new Date().toISOString() };
    const next = [...workbenchProfiles, created];
    setWorkbenchProfiles(next); saveWorkbenchProfiles(next); setActiveWorkbenchId(created.id); setNewProfileName("");
  };
  const addClips = async (files: FileList | null) => {
    if (!activeWorkbench || !files?.length) return;
    const selected = [...files].slice(0, 12).filter((file) => /\.(wav|mp3|m4a|ogg|flac)$/i.test(file.name));
    if (!selected.length) return;
    const names = selected.map((file) => file.name);
    const stored = await Promise.all(selected.map((file) => storeVoiceClip(activeWorkbench.id, file)));
    if (stored.some((value) => !value)) {
      setClipStorageNotice("Clip storage is unavailable; the file names were kept, but the audio bytes were not saved.");
    } else {
      setClipStorageNotice("Audio clips are stored locally on this device. No audio was uploaded.");
    }
    updateWorkbench({ clipNames: [...new Set([...activeWorkbench.clipNames, ...names])].slice(0, 48), status: "Changes pending" });
  };
  const acknowledgeRightsNotice = () => { localStorage.setItem(WORKBENCH_NOTICE_KEY, "true"); setRightsNoticeOpen(false); };
  return (
    <div className="voice-workbench-view">
      <header className="voice-workbench-header">
        <Button variant="ghost" onClick={onBack}>
          <NavIcon name="chevron-left" />
          Back to Marketplace
        </Button>
        <div>
          <p className="eyebrow">MARKETPLACE · VOICE</p>
          <h2>Voice Workbench</h2>
          <p>Shape Skai’s local voice without leaving the catalog.</p>
        </div>
      </header>
      {rightsNoticeOpen && <Card className="voice-workbench-notice"><p className="section-kicker">ONE-TIME NOTICE</p><h3>Use voice clips responsibly</h3><p>Only create an identifiable voice profile when you have the person’s permission or the rights to use the recordings. Skai keeps profile metadata local and does not treat a voice profile as proof of identity.</p><Button variant="primary" type="button" onClick={acknowledgeRightsNotice}>I understand</Button></Card>}
      <div className="voice-workbench-grid">
        <Card>
          <p className="section-kicker">VOICE PROFILES</p>
          <h3>Reusable voices</h3>
          <p className="marketplace-muted">Create a profile, add clips over time, and keep the last working version while a compatible adapter is pending.</p>
          <div className="voice-workbench-profile-list">{workbenchProfiles.length === 0 ? <p className="settings-help">No custom voice profiles yet.</p> : workbenchProfiles.map((item) => <button key={item.id} type="button" className={item.id === activeWorkbenchId ? "is-active" : ""} onClick={() => setActiveWorkbenchId(item.id)}><strong>{item.name}</strong><small>{item.clipNames.length} clips · {item.status}</small></button>)}</div>
          <div className="voice-workbench-create"><input value={newProfileName} onChange={(event) => setNewProfileName(event.target.value)} placeholder="New profile name" aria-label="New voice profile name" /><Button variant="secondary" type="button" onClick={createWorkbenchProfile} disabled={!newProfileName.trim()}>Create</Button></div>
        </Card>
        <Card>
          <p className="section-kicker">VOICE PROFILE</p>
          <h3>{profile.name}</h3>
          <p>{profile.description}</p>
          <p className="marketplace-muted">This profile adjusts pacing for {activeRuntime?.name ?? "the available local runtime"}; voice characteristics depend on that runtime.</p>
          <label className="marketplace-field">
            Profile
            <select
              value={settings.profileId}
              onChange={(event) => update("profileId", event.target.value)}
            >
              {voiceProfiles.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <div className="voice-workbench-actions">
            <Button
              variant="primary"
              onClick={() =>
                void speakNativeResponse(
                  "Skai voice preview. Your Voice Workbench settings are working.",
                  true,
                )
              }
            >
              Preview voice
            </Button>
            <Button variant="ghost" onClick={stopNativeSpeech}>
              Stop
            </Button>
          </div>
        </Card>
        <Card>
          <p className="section-kicker">LOCAL RUNTIME</p>
          <h3>Choose where speech runs</h3>
          <label className="marketplace-field">
            Primary runtime
            <select
              value={settings.primaryModelId}
              onChange={(event) => update("primaryModelId", event.target.value)}
            >
              {installedVoiceModels.length === 0 && <option value="">No installed local runtime is available</option>}
              {installedVoiceModels.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.name}
                </option>
              ))}
            </select>
          </label>
          <p className="marketplace-muted">
            Additional runtimes can be installed from the Voices catalog when
            available.
          </p>
          <label className="marketplace-toggle">
            <input
              type="checkbox"
              checked={settings.voiceOutputEnabled}
              onChange={(event) =>
                update("voiceOutputEnabled", event.target.checked)
              }
            />
            <span>
              <strong>Speak completed replies</strong>
              <small>Keep voice output opt-in.</small>
            </span>
          </label>
          {hasOptionalLowResourceRuntime && <label className="marketplace-toggle">
            <input
              type="checkbox"
              checked={settings.lowResourceMode}
              onChange={(event) =>
                update("lowResourceMode", event.target.checked)
              }
            />
            <span>
              <strong>Low-resource mode</strong>
              <small>Prefer a smaller CPU-first runtime.</small>
            </span>
          </label>}
        </Card>
        <Card>
          <p className="section-kicker">CLIPS</p>
          <h3>{activeWorkbench?.name ?? "Choose a profile"}</h3>
          {activeWorkbench ? <><p className="marketplace-muted">Add recordings incrementally. Leaving the page or first use can queue a rebuild once an adapter is connected.</p><input type="file" accept=".wav,.mp3,.m4a,.ogg,.flac,audio/*" multiple onChange={(event) => void addClips(event.target.files)} aria-label="Add voice clips" /><div className="voice-workbench-clip-list">{activeWorkbench.clipNames.length === 0 ? <p className="settings-help">No clips attached.</p> : activeWorkbench.clipNames.map((name) => <span key={name}>{name}</span>)}</div>{clipStorageNotice && <p className="settings-help" role="status">{clipStorageNotice}</p>}<div className="voice-workbench-status" role="status"><strong>{activeWorkbench.status}</strong><small>{activeWorkbench.status === "Changes pending" ? "A compatible voice adapter is required before a clone can be built." : "Profile metadata and selected audio clips are stored locally."}</small></div></> : <p className="settings-help">Create or choose a profile to add clips.</p>}
        </Card>
      </div>
    </div>
  );
}

