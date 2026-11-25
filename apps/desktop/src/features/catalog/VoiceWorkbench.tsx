import { useEffect, useRef, useState } from "react";
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

type PreviewableVoiceClip = StoredVoiceClip & { previewUrl: string };

const WORKBENCH_PROFILES_KEY = "skai.voice.workbench.profiles";
const WORKBENCH_NOTICE_KEY = "skai.voice.workbench.rightsNoticeAcknowledged";
const VOICE_CLIPS_DB = "skai-voice-workbench";
const VOICE_CLIPS_STORE = "clips";
const MAX_CLIPS_PER_PROFILE = 48;
const MAX_CLIPS_PER_ADD = 12;
const MAX_CLIP_BYTES = 50 * 1024 * 1024;

function audioMimeType(fileName: string, currentType: string): string {
  const byExtension: Record<string, string> = {
    wav: "audio/wav", mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg", flac: "audio/flac",
  };
  const extension = fileName.split(".").at(-1)?.toLowerCase() ?? "";
  return currentType.startsWith("audio/") ? currentType : byExtension[extension] ?? "application/octet-stream";
}

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

async function storeVoiceClip(profileId: string, file: File): Promise<StoredVoiceClip | null> {
  const database = await openVoiceClipStore();
  if (!database) return null;
  return new Promise((resolve) => {
    const transaction = database.transaction(VOICE_CLIPS_STORE, "readwrite");
    const clip: StoredVoiceClip = {
      key: `${profileId}:${crypto.randomUUID()}`,
      profileId,
      name: file.name,
      blob: new Blob([file], { type: audioMimeType(file.name, file.type) }),
      storedAt: new Date().toISOString(),
    };
    transaction.objectStore(VOICE_CLIPS_STORE).put(clip);
    transaction.oncomplete = () => { database.close(); resolve(clip); };
    transaction.onerror = () => { database.close(); resolve(null); };
    transaction.onabort = () => { database.close(); resolve(null); };
  });
}

async function listVoiceClips(profileId: string): Promise<StoredVoiceClip[] | null> {
  const database = await openVoiceClipStore();
  if (!database) return null;
  return new Promise((resolve) => {
    const transaction = database.transaction(VOICE_CLIPS_STORE, "readonly");
    const query = transaction.objectStore(VOICE_CLIPS_STORE).getAll();
    query.onsuccess = () => {
      const clips = (query.result as StoredVoiceClip[])
        .filter((clip) => clip.profileId === profileId && clip.blob instanceof Blob)
        .sort((left, right) => left.storedAt.localeCompare(right.storedAt));
      database.close();
      resolve(clips);
    };
    query.onerror = () => { database.close(); resolve(null); };
    transaction.onabort = () => { database.close(); resolve(null); };
  });
}

async function deleteVoiceClip(key: string): Promise<boolean> {
  const database = await openVoiceClipStore();
  if (!database) return false;
  return new Promise((resolve) => {
    const transaction = database.transaction(VOICE_CLIPS_STORE, "readwrite");
    transaction.objectStore(VOICE_CLIPS_STORE).delete(key);
    transaction.oncomplete = () => { database.close(); resolve(true); };
    transaction.onerror = () => { database.close(); resolve(false); };
    transaction.onabort = () => { database.close(); resolve(false); };
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
  const [storedClips, setStoredClips] = useState<PreviewableVoiceClip[]>([]);
  const [clipsLoading, setClipsLoading] = useState(false);
  const [clipQuery, setClipQuery] = useState("");
  const previewUrls = useRef(new Set<string>());
  const makePreviewable = (clip: StoredVoiceClip): PreviewableVoiceClip => {
    const blob = clip.blob.type.startsWith("audio/")
      ? clip.blob
      : clip.blob.slice(0, clip.blob.size, audioMimeType(clip.name, clip.blob.type));
    const previewUrl = URL.createObjectURL(blob);
    previewUrls.current.add(previewUrl);
    return { ...clip, blob, previewUrl };
  };
  const [rightsNoticeOpen, setRightsNoticeOpen] = useState(() => localStorage.getItem(WORKBENCH_NOTICE_KEY) !== "true");
  useEffect(() => {
    let active = true;
    const refresh = async () => { await refreshInstalledVoiceModels(); if (active) setSettings(selectedVoiceSettings()); };
    void refresh();
    window.addEventListener("skai:voice-models-updated", refresh);
    return () => { active = false; window.removeEventListener("skai:voice-models-updated", refresh); };
  }, []);
  const activeWorkbench = workbenchProfiles.find((item) => item.id === activeWorkbenchId) ?? null;
  const visibleClips = storedClips.filter((clip) => clip.name.toLocaleLowerCase().includes(clipQuery.trim().toLocaleLowerCase()));
  useEffect(() => {
    let current = true;
    setStoredClips([]);
    setClipStorageNotice(null);
    if (!activeWorkbenchId) return () => { current = false; };
    setClipsLoading(true);
    void listVoiceClips(activeWorkbenchId).then((clips) => {
      if (!current) return;
      setClipsLoading(false);
      if (!clips) {
        setClipStorageNotice("Local clip storage could not be opened. Check this app's storage space and try again.");
        return;
      }
      const previewable = clips.map(makePreviewable);
      setStoredClips(previewable);
      setWorkbenchProfiles((profiles) => {
        const next = profiles.map((item) => item.id === activeWorkbenchId
          ? { ...item, clipNames: clips.map((clip) => clip.name) }
          : item);
        saveWorkbenchProfiles(next);
        return next;
      });
    });
    return () => { current = false; };
  }, [activeWorkbenchId]);
  useEffect(() => () => {
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrls.current.clear();
  }, [activeWorkbenchId]);
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
  const createWorkbenchProfile = () => {
    const name = newProfileName.trim();
    if (!name) return;
    const created: WorkbenchVoiceProfile = { id: `voice-${crypto.randomUUID()}`, name, engineId: settings.primaryModelId, clipNames: [], status: "Changes pending", updatedAt: new Date().toISOString() };
    const next = [...workbenchProfiles, created];
    setWorkbenchProfiles(next); saveWorkbenchProfiles(next); setActiveWorkbenchId(created.id); setNewProfileName("");
  };
  const addClips = async (files: FileList | null) => {
    if (!activeWorkbench || !files?.length) return;
    const accepted = [...files].filter((file) => /\.(wav|mp3|m4a|ogg|flac)$/i.test(file.name));
    const oversized = accepted.filter((file) => file.size > MAX_CLIP_BYTES);
    const remaining = Math.max(0, MAX_CLIPS_PER_PROFILE - storedClips.length);
    const selected = accepted.filter((file) => file.size <= MAX_CLIP_BYTES).slice(0, Math.min(MAX_CLIPS_PER_ADD, remaining));
    if (!selected.length) {
      setClipStorageNotice(oversized.length
        ? `Each audio clip must be 50 MB or smaller. ${oversized.map((file) => file.name).join(", ")}`
        : remaining === 0 ? "This profile already has the maximum of 48 clips." : "Choose WAV, MP3, M4A, OGG, or FLAC audio files.");
      return;
    }
    const saved = (await Promise.all(selected.map((file) => storeVoiceClip(activeWorkbench.id, file))))
      .filter((clip): clip is StoredVoiceClip => clip !== null);
    const next = [...storedClips, ...saved.map(makePreviewable)];
    setStoredClips(next);
    const names = next.map((clip) => clip.name);
    setWorkbenchProfiles((profiles) => {
      const updated = profiles.map((item) => item.id === activeWorkbench.id
        ? { ...item, clipNames: names, status: "Changes pending" as const, updatedAt: new Date().toISOString() }
        : item);
      saveWorkbenchProfiles(updated);
      return updated;
    });
    setClipStorageNotice(saved.length === selected.length
      ? `Saved ${saved.length} clip${saved.length === 1 ? "" : "s"} locally. No audio was uploaded.`
      : `Saved ${saved.length} of ${selected.length} clips. The remaining files could not be written to local storage.`);
  };
  const removeClip = async (clip: PreviewableVoiceClip) => {
    if (!activeWorkbench || !(await deleteVoiceClip(clip.key))) {
      setClipStorageNotice("Could not remove this clip from local storage. Try again.");
      return;
    }
    URL.revokeObjectURL(clip.previewUrl);
    previewUrls.current.delete(clip.previewUrl);
    const next = storedClips.filter((item) => item.key !== clip.key);
    setStoredClips(next);
    setWorkbenchProfiles((profiles) => {
      const updated = profiles.map((item) => item.id === activeWorkbench.id
        ? { ...item, clipNames: next.map((item) => item.name), status: "Changes pending" as const, updatedAt: new Date().toISOString() }
        : item);
      saveWorkbenchProfiles(updated);
      return updated;
    });
    setClipStorageNotice(`Removed ${clip.name} from this voice profile.`);
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
          {activeWorkbench ? <><p className="marketplace-muted">Add recordings over time. Clips stay on this device and can be previewed or removed here. Voice cloning is unavailable until a compatible engine is installed.</p><div className="voice-workbench-clip-toolbar"><label>Voice profile<select value={activeWorkbenchId} onChange={(event) => setActiveWorkbenchId(event.target.value)} aria-label="Voice profile">{workbenchProfiles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><input value={clipQuery} onChange={(event) => setClipQuery(event.target.value)} placeholder="Search clips…" aria-label="Search clips" /><label className="voice-workbench-add-clips"><span>Add audio clips</span><input type="file" accept=".wav,.mp3,.m4a,.ogg,.flac,audio/wav,audio/mpeg,audio/mp4,audio/ogg,audio/flac" multiple onChange={(event) => { void addClips(event.target.files); event.currentTarget.value = ""; }} aria-label="Add voice clips" /></label></div><p className="settings-help">{storedClips.length} of {MAX_CLIPS_PER_PROFILE} clips · Up to 12 at once · 50 MB per clip</p><div className="voice-workbench-clip-list" aria-live="polite">{clipsLoading ? <p className="settings-help">Loading saved clips…</p> : storedClips.length === 0 ? <p className="settings-help">No clips attached.</p> : visibleClips.length === 0 ? <p className="settings-help">No clips match that name.</p> : visibleClips.map((clip) => <div className="voice-workbench-clip" key={clip.key}><div className="voice-workbench-clip-heading"><strong>{clip.name}</strong><span>{clip.blob.size >= 1024 * 1024 ? `${(clip.blob.size / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(clip.blob.size / 1024))} KB`}</span><Button variant="ghost" type="button" onClick={() => void removeClip(clip)} aria-label={`Remove ${clip.name}`}>Remove</Button></div><audio controls preload="none" src={clip.previewUrl} aria-label={`Preview ${clip.name}`} /></div>)}</div>{clipStorageNotice && <p className="settings-help" role="status">{clipStorageNotice}</p>}<div className="voice-workbench-status" role="status"><strong>{storedClips.length > 0 ? "Changes pending" : activeWorkbench.status}</strong><small>{storedClips.length > 0 ? "Clips are saved locally. Clone building will be enabled when a compatible adapter is installed." : "Profile metadata is stored locally on this device."}</small></div></> : <p className="settings-help">Create or choose a profile to add clips.</p>}
        </Card>
      </div>
    </div>
  );
}

