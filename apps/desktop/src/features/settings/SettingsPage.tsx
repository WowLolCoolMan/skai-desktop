import { useEffect, useMemo, useState, type ChangeEvent, type CSSProperties } from "react";
import type { Model, ThemeMode } from "../../app/types";
import type { AgentResponse, CloseBehavior, UpdateCheckResult } from "../../../shared/contracts";
import { installedVoiceModels, saveVoiceSetting, selectedVoiceSettings, speakNativeResponse, stopNativeSpeech, voiceProfiles } from "../../services/nativeTts";
import { isLocalProvider, localProviderOrFallback } from "../../services/localOnly";
import { deletePetSpriteProfile, getPetSpriteProfile, listPetSpriteProfiles, PET_ANIMATIONS, savePetSpriteProfile, validatePetProfileImport, validatePetStrip, type PetAnimationId, type PetSpriteProfile, type PetStrip } from "./petSprites";
import { Button, PageHeader, StatusBadge } from "../../components/ui/Primitives";
import { NavIcon, type NavIconName } from "../../components/ui/NavIcon";

const categories = ["General", "Appearance", "Pet", "Models & Providers", "Voice & Audio", "Image Generation", "Agents", "Integrations", "Privacy & Security", "Storage", "Updates", "Advanced"] as const;
type Category = typeof categories[number];
type AirLlmRuntimeStatus = { workerAvailable: boolean; dependenciesAvailable: boolean; pythonCommand: string; status: string; message: string };
type AirLlmInstallSession = { id: string; status: string; progress: string[]; error?: string | null };
function petStripPreviewStyle(strip: PetStrip): CSSProperties {
  const scale = Math.min(64 / strip.frameWidth, 64 / strip.frameHeight);
  const frameWidth = strip.frameWidth * scale;
  const frameHeight = strip.frameHeight * scale;
  return {
    backgroundImage: `url(${strip.dataUrl})`,
    backgroundSize: `${frameWidth * 6}px ${frameHeight}px`,
    "--pet-preview-strip-end": `${-frameWidth * 5}px`,
  } as CSSProperties;
}
const categoryIcons: Record<Category, NavIconName> = {
  General: "settings",
  Appearance: "sparkle",
  Pet: "sparkle",
  "Models & Providers": "model",
  "Voice & Audio": "activity",
  "Image Generation": "image",
  Agents: "code",
  Integrations: "project",
  "Privacy & Security": "settings",
  Storage: "memory",
  Updates: "arrow-up-right",
  Advanced: "terminal",
};

const categorySearchText: Record<Category, string> = {
  General: "runtime provider model answer local preferred close window background tray quit linux",
  Appearance: "theme color accent density backdrop reduced motion pet companion animation",
  Pet: "companion Percy sprite sheet character walk wander always on top overlay custom",
  "Models & Providers": "endpoint runtime model discover Ollama LM Studio AirLLM provider local context window tokens 1M",
  "Voice & Audio": "voice speech audio low resource profile preview text to speech TTS",
  "Image Generation": "image ComfyUI workflow prompt endpoint generation",
  Agents: "task developer diagnostics memory prompts planning",
  Integrations: "GitHub local services ComfyUI integrations repository",
  "Privacy & Security": "privacy security local storage memory credentials data boundary",
  Storage: "export backup data workspace local memory",
  Updates: "release channel automatic update delivery",
  Advanced: "developer diagnostics motion routing provider",
};

const providerChoices = [
  { id: "Ollama", label: "Ollama", detail: "Run local models through Ollama on this computer." },
  { id: "LM Studio", label: "LM Studio", detail: "Use a local LM Studio server on this computer." },
  { id: "Local API", label: "OpenAI-compatible local server", detail: "Use a local GPT4All, Jan, llama.cpp, vLLM, or compatible server." },
  { id: "AirLLM", label: "AirLLM", detail: "Optional disk-streamed inference for compatible Hugging Face models; slower than Ollama." },
];

const builtInPetPreviews: Record<string, string> = {
  percy: new URL("../../../../../assets/pets/generated/percy-idle-frames.png", import.meta.url).href,
  byte: new URL("../../../../../assets/pets/generated/byte-idle-frames.png", import.meta.url).href,
  ember: new URL("../../../../../assets/pets/generated/ember-idle-frames.png", import.meta.url).href,
  nova: new URL("../../../../../assets/pets/generated/nova-idle-frames.png", import.meta.url).href,
  rocky: new URL("../../../../../assets/pets/generated/rocky-idle-frames.png", import.meta.url).href,
  sprout: new URL("../../../../../assets/pets/generated/sprout-idle-frames.png", import.meta.url).href,
};

type SettingsProps = {
  provider: string;
  endpoint: string;
  model: string;
  models: Model[];
  ollamaContextWindowTokens: number;
  themeMode: ThemeMode;
  accentColor: string;
  density: string;
  backdrop: string;
  reduceMotion: boolean;
  petVisible: boolean;
  petWander: boolean;
  petCharacter: string;
  petSpriteDataUrl: string;
  developerMode: boolean;
  memoryInjectionEnabled: boolean;
  imageEndpoint: string;
  imageWorkflow: string;
  onChange: (key: string, value: string | boolean) => void;
  onSave: () => Promise<boolean>;
  onDiscoverModels: () => void | Promise<boolean>;
  onImageChange: (key: "endpoint" | "prompt" | "workflow", value: string) => void;
  onExportMemory: () => void;
};

export function SettingsPage(props: SettingsProps) {
  const [activeCategory, setActiveCategory] = useState<Category>("General");
  const [query, setQuery] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [discoveringModels, setDiscoveringModels] = useState(false);
  const [airLlmStatus, setAirLlmStatus] = useState<AirLlmRuntimeStatus | null>(null);
  const [checkingAirLlm, setCheckingAirLlm] = useState(false);
  const [airLlmInstall, setAirLlmInstall] = useState<AirLlmInstallSession | null>(null);
  const [startingAirLlmInstall, setStartingAirLlmInstall] = useState(false);
  const [voiceSettings, setVoiceSettings] = useState(selectedVoiceSettings);
  const [updateState, setUpdateState] = useState<UpdateCheckResult | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleCategories = useMemo(() => categories.filter((category) => !normalizedQuery || `${category} ${categoryDescription(category)} ${categorySearchText[category]}`.toLowerCase().includes(normalizedQuery)), [normalizedQuery]);
  useEffect(() => {
    if (!normalizedQuery || visibleCategories.includes(activeCategory)) return;
    const nextCategory = visibleCategories[0];
    if (nextCategory) setActiveCategory(nextCategory);
  }, [activeCategory, normalizedQuery, visibleCategories]);
  useEffect(() => {
    const updates = window.serverRockAgent?.updates;
    if (!updates) return;
    void updates.check().then(setUpdateState);
    return updates.onAvailable(setUpdateState);
  }, []);
  const change = (key: string, value: string | boolean) => { setSaveState("idle"); props.onChange(key, value); };
  const selectedOllamaModel = props.models.find((entry) => entry.model === props.model && (entry.provider ?? "").toLowerCase() === "ollama");
  const currentModelChoice = props.models.find((entry) => entry.model === props.model && (entry.provider === "AirLLM" ? selectedProviderId === "AirLLM" : entry.endpoint === props.endpoint));
  const modelChoiceKey = (entry: Model) => `${entry.provider ?? ""}|${entry.endpoint ?? ""}|${entry.model}`;
  const selectModelChoice = (key: string) => {
    const entry = props.models.find((candidate) => modelChoiceKey(candidate) === key);
    if (!entry) return;
    const nextProvider = entry.provider === "AirLLM" || entry.provider === "Ollama" || entry.provider === "LM Studio" ? entry.provider : "Local API";
    change("provider", nextProvider);
    if (entry.endpoint) change("endpoint", entry.endpoint);
    change("model", entry.model);
  };
  const contextSupport = selectedOllamaModel?.contextLength == null ? "unknown" : selectedOllamaModel.contextLength >= 1_048_576 ? "supported" : "unsupported";
  const save = async () => { if (saveState === "saving") return; setSaveState("saving"); try { setSaveState(await props.onSave() ? "saved" : "idle"); } catch { setSaveState("idle"); } };
  const discoverModels = async () => { if (discoveringModels) return; setDiscoveringModels(true); await props.onDiscoverModels(); setDiscoveringModels(false); };
  const checkAirLlm = async () => {
    if (checkingAirLlm) return;
    setCheckingAirLlm(true);
    try {
      const response: AgentResponse | undefined = await window.serverRockAgent?.request("airllm.status");
      setAirLlmStatus(response?.ok ? response.result as AirLlmRuntimeStatus : { workerAvailable: false, dependenciesAvailable: false, pythonCommand: "", status: "unavailable", message: response?.error?.message ?? "The local Agent Host is unavailable." });
    } catch (error) {
      setAirLlmStatus({ workerAvailable: false, dependenciesAvailable: false, pythonCommand: "", status: "unavailable", message: error instanceof Error ? error.message : "AirLLM status could not be checked." });
    } finally { setCheckingAirLlm(false); }
  };
  const installAirLlm = async () => {
    if (startingAirLlmInstall || airLlmInstall?.status === "running") return;
    setStartingAirLlmInstall(true);
    setAirLlmInstall(null);
    try {
      const response = await window.serverRockAgent?.request("airllm.install.start");
      if (!response?.ok) throw new Error(response?.error?.message ?? "AirLLM setup could not start.");
      let session = response.result as AirLlmInstallSession;
      setAirLlmInstall(session);
      while (session.status === "running") {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        const status = await window.serverRockAgent?.request("airllm.install.status", { id: session.id });
        if (!status?.ok) throw new Error(status?.error?.message ?? "AirLLM setup status could not be read.");
        session = status.result as AirLlmInstallSession;
        setAirLlmInstall(session);
      }
      await checkAirLlm();
    } catch (installError) {
      setAirLlmInstall({ id: "", status: "failed", progress: [], error: installError instanceof Error ? installError.message : "AirLLM setup failed." });
    } finally { setStartingAirLlmInstall(false); }
  };
  const cancelAirLlmInstall = async () => {
    if (!airLlmInstall?.id || airLlmInstall.status !== "running") return;
    const response = await window.serverRockAgent?.request("airllm.install.cancel", { id: airLlmInstall.id });
    if (response?.ok) setAirLlmInstall(response.result as AirLlmInstallSession);
  };
  const updateVoice = (key: "profileId" | "primaryModelId" | "lowResourceModelId" | "lowResourceMode" | "voiceOutputEnabled", value: string | boolean) => { saveVoiceSetting(key, value); setVoiceSettings(selectedVoiceSettings()); };
  const checkUpdates = async () => {
    if (checkingUpdates || !window.serverRockAgent?.updates) return;
    setCheckingUpdates(true);
    setUpdateState(await window.serverRockAgent.updates.check());
    setCheckingUpdates(false);
  };
  const selectedProviderId = localProviderOrFallback(props.provider);
  const selectedProvider = providerChoices.find((choice) => choice.id === selectedProviderId) ?? providerChoices[0];
  const localRoute = isLocalProvider(selectedProviderId);

  return <div className="feature-page settings-page">
    <PageHeader className="settings-page-header" eyebrow="CONTROL CENTER" title="Workspace settings" description="Tune the local runtime, appearance, voice, media, memory, and workspace behavior." />
    <div className="settings-window">
      <aside className="settings-nav"><p className="section-kicker">SETTINGS</p><input className="settings-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search settings…" aria-label="Search settings" />{normalizedQuery && <p className="settings-search-status" role="status">{visibleCategories.length} matching {visibleCategories.length === 1 ? "section" : "sections"}</p>}{visibleCategories.map((category) => <button className={activeCategory === category ? "is-active" : ""} key={category} onClick={() => setActiveCategory(category)} type="button"><NavIcon name={categoryIcons[category]} /><span>{category}</span></button>)}{visibleCategories.length === 0 && <p className="settings-no-results">No settings match. Try a label such as endpoint, motion, or memory.</p>}</aside>
      <main className="settings-content">
        <div className="settings-section-heading"><div><p className="section-kicker">{activeCategory.toUpperCase()}</p><h3>{activeCategory}</h3><p>{categoryDescription(activeCategory)}</p></div><StatusBadge tone={activeCategory === "Integrations" ? "neutral" : "success"}>{activeCategory === "Integrations" ? "Review connections" : "Available"}</StatusBadge></div>

        {activeCategory === "General" && <><CloseBehaviorSetting /><div className="settings-callout"><strong>{selectedProvider.label}</strong><span>{selectedProvider.detail}</span></div><div className="settings-field"><label>How should Skai answer?<select value={selectedProviderId} onChange={(event) => change("provider", event.target.value)}>{providerChoices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</select></label><label>Preferred model<select value={currentModelChoice ? modelChoiceKey(currentModelChoice) : "__current"} onChange={(event) => selectModelChoice(event.target.value)}><option value="__current">{props.model} · current selection</option>{props.models.map((item) => <option key={modelChoiceKey(item)} value={modelChoiceKey(item)}>{item.displayName || item.model} · {item.provider || "Local runtime"}</option>)}</select></label></div><p className="settings-help">Choosing a discovered model also selects its local runtime and endpoint. All model runtimes run on this computer.</p></>}

        {activeCategory === "Appearance" && <><div className="settings-field"><label>Color theme<select value={props.themeMode} onChange={(event) => change("themeMode", event.target.value)}><option value="dark">Dark</option><option value="light">Light</option><option value="system">System</option></select></label><label>Accent<select value={props.accentColor} onChange={(event) => change("accentColor", event.target.value)}><option value="cyan">Cyan</option><option value="violet">Violet</option><option value="amber">Amber</option><option value="rose">Rose</option></select></label></div><div className="settings-field"><label>Interface density<select value={props.density} onChange={(event) => change("density", event.target.value)}><option value="compact">Compact</option><option value="comfortable">Comfortable</option><option value="spacious">Spacious</option></select></label><label>Backdrop<select value={props.backdrop} onChange={(event) => change("backdrop", event.target.value)}><option value="none">None</option><option value="deep-sea">Deep sea</option><option value="deep-space">Deep space</option></select></label></div><Toggle label="Reduced motion" detail="Minimize interface animations and decorative movement." checked={props.reduceMotion} onChange={(value) => change("reduceMotion", value)} /></>}

        {activeCategory === "Pet" && <PetSettings props={props} change={change} />}

        {activeCategory === "Models & Providers" && <><div className="settings-field"><label>Provider<select value={selectedProviderId} onChange={(event) => change("provider", event.target.value)}>{providerChoices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</select></label><label>Model endpoint<input value={props.endpoint} onChange={(event) => change("endpoint", event.target.value)} placeholder="http://localhost:11434/v1" /></label></div><div className="settings-field"><label>Ollama context window<select value={props.ollamaContextWindowTokens} disabled={props.provider !== "Ollama"} onChange={(event) => change("ollamaContextWindowTokens", event.target.value)}><option value={0}>Runtime default</option><option value={32768}>32K tokens</option><option value={131072}>128K tokens</option><option value={1048576}>1M tokens</option></select></label><span className="settings-help">For Ollama only. Runtime default leaves Ollama unchanged. Larger windows use substantially more memory and require a model that supports the selected context.</span></div>{props.provider === "Ollama" && <div className="settings-context-support" role="status"><StatusBadge tone={contextSupport === "supported" ? "success" : contextSupport === "unsupported" ? "warning" : "neutral"}>{contextSupport === "supported" ? "1M advertised" : contextSupport === "unsupported" ? "Below 1M" : "Context unknown"}</StatusBadge><span>{selectedOllamaModel?.contextLength == null ? "Discover local models to read Ollama model metadata for the selected model." : `${props.model} advertises a ${selectedOllamaModel.contextLength.toLocaleString()} token context. This is model metadata; available RAM and the runtime configuration still determine whether it can run.`}</span></div>}<div className="settings-model-actions"><Button variant="secondary" disabled={discoveringModels} onClick={() => void discoverModels()}>{discoveringModels ? "Discovering…" : "Discover local models"}</Button><span>AirLLM can take over when a selected model exceeds available memory.</span></div><div className="settings-callout airllm-callout"><strong>Optional AirLLM runtime</strong><span>{airLlmStatus ? `${airLlmStatus.message} ${airLlmStatus.pythonCommand ? `Python: ${airLlmStatus.pythonCommand}` : ""}` : "AirLLM is an optional, slower runtime for compatible Hugging Face models that exceed your usual local model's memory."} Installing it downloads Python dependencies and may use several gigabytes of disk. Model weights are separate and download only when you select a model.</span><div className="settings-model-actions"><StatusBadge tone={airLlmInstall?.status === "running" ? "warning" : airLlmStatus?.dependenciesAvailable ? "success" : airLlmStatus ? "warning" : "neutral"}>{airLlmInstall?.status === "running" ? "Installing" : airLlmStatus?.status ?? "Not checked"}</StatusBadge><Button variant="secondary" disabled={checkingAirLlm || startingAirLlmInstall} onClick={() => void checkAirLlm()}>{checkingAirLlm ? "Checking…" : "Check readiness"}</Button>{!airLlmStatus?.dependenciesAvailable && <Button variant="primary" disabled={startingAirLlmInstall || airLlmInstall?.status === "running"} onClick={() => void installAirLlm()}>{startingAirLlmInstall || airLlmInstall?.status === "running" ? "Installing…" : "Install optional runtime"}</Button>}{airLlmInstall?.status === "running" && <Button variant="ghost" onClick={() => void cancelAirLlmInstall()}>Cancel setup</Button>}</div>{airLlmInstall && <div className={`airllm-install-log${airLlmInstall.status === "failed" ? " is-error" : ""}`} role="status" aria-live="polite">{airLlmInstall.error && <strong>{airLlmInstall.error}</strong>}{airLlmInstall.progress.slice(-4).map((line, index) => <span key={`${index}-${line}`}>{line}</span>)}</div>}</div><details className="airllm-help"><summary>What is AirLLM?</summary><p>AirLLM can run some compatible Hugging Face models that do not fit in your usual runtime by streaming model layers from disk. It can be much slower and needs model storage space. Skai only uses the optional runtime after you install it; compatible model weights are downloaded separately when you choose them.</p></details><div className="settings-provider-list">{providerChoices.map((choice) => <div className="settings-provider-row" key={choice.id}><span><strong>{choice.label}</strong><small>{choice.detail}</small></span><StatusBadge tone="neutral">Supported locally</StatusBadge></div>)}</div></>}

        {activeCategory === "Voice & Audio" && <><div className="settings-field"><label>Primary voice runtime<select value={voiceSettings.primaryModelId} onChange={(event) => updateVoice("primaryModelId", event.target.value)}>{installedVoiceModels.map((voice) => <option key={voice.id} value={voice.id}>{voice.name}</option>)}</select></label>{installedVoiceModels.some((voice) => voice.lowResource && voice.id !== voiceSettings.primaryModelId) && <label>Low-resource runtime<select value={voiceSettings.lowResourceModelId} onChange={(event) => updateVoice("lowResourceModelId", event.target.value)}>{installedVoiceModels.filter((voice) => voice.lowResource).map((voice) => <option key={voice.id} value={voice.id}>{voice.name}</option>)}</select></label>}</div><div className="settings-field"><label>Voice profile<select value={voiceSettings.profileId} onChange={(event) => updateVoice("profileId", event.target.value)}>{voiceProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label><div className="settings-inline-action"><span>Preview the current system voice.</span><Button variant="secondary" onClick={() => void speakNativeResponse("Skai voice preview. Your voice settings are working.", true)}>Preview</Button><Button variant="ghost" onClick={stopNativeSpeech}>Stop</Button></div></div><Toggle label="Speak completed replies" detail="Voice output stays off until you turn it on." checked={voiceSettings.voiceOutputEnabled} onChange={(value) => updateVoice("voiceOutputEnabled", value)} />{installedVoiceModels.some((voice) => voice.lowResource && voice.id !== voiceSettings.primaryModelId) && <Toggle label="Use low-resource mode" detail="Prefer the smaller CPU-first voice runtime." checked={voiceSettings.lowResourceMode} onChange={(value) => updateVoice("lowResourceMode", value)} />}</>}

        {activeCategory === "Image Generation" && <><div className="settings-field"><label>ComfyUI endpoint<input value={props.imageEndpoint} onChange={(event) => props.onImageChange("endpoint", event.target.value)} placeholder="http://127.0.0.1:8188" /></label><label>Workflow JSON<input value={props.imageWorkflow} onChange={(event) => props.onImageChange("workflow", event.target.value)} placeholder="Paste a ComfyUI workflow JSON" /></label></div><p className="settings-help">Image Studio offers direct local Stable Diffusion Turbo generation after you install its optional runtime. ComfyUI remains available for custom workflows and image editing.</p></>}

        {activeCategory === "Agents" && <><Toggle label="Developer mode" detail="Show extra diagnostics and development controls." checked={props.developerMode} onChange={(value) => change("developerMode", value)} /><Toggle label="Use saved memory in prompts" detail="Inject enabled memory entries into local conversations." checked={props.memoryInjectionEnabled} onChange={(value) => change("memoryInjectionEnabled", value)} /><div className="settings-callout"><strong>Safe by default</strong><span>Agent tasks are proposed before they run, and the selected environment is shown before execution.</span></div></>}

        {activeCategory === "Integrations" && <><Integration title="GitHub project workflow" detail="Available from the Coding workspace through your local GitHub CLI session. Skai does not collect a separate token here." status="Available" /><Integration title="Local services" detail="Ollama, LM Studio, AirLLM, OS speech, and ComfyUI use local endpoints." status={localRoute ? "Available" : "Needs setup"} /></>}

        {activeCategory === "Privacy & Security" && <><div className="settings-callout"><strong>Local route in use</strong><span>Prompts, attachments, memory, voice, and image requests stay on this computer.</span></div><p className="settings-help">GitHub is used only for explicit project workflows. Local model and media endpoints are restricted to loopback addresses.</p><Toggle label="Use saved memory in prompts" detail="This is also available in Agents so the setting is easy to find." checked={props.memoryInjectionEnabled} onChange={(value) => change("memoryInjectionEnabled", value)} /></>}

        {activeCategory === "Storage" && <><div className="settings-callout"><strong>Workspace data is local</strong><span>Conversations, task plans, memory, and preferences are stored in the local Skai data directory.</span></div><div className="settings-model-actions"><Button variant="secondary" onClick={props.onExportMemory}>Export memory backup</Button><span>Exports a portable JSON backup without deleting anything.</span></div><p className="settings-help">There is no destructive “clear everything” button in the release candidate.</p></>}

        {activeCategory === "Updates" && <><div className="settings-callout"><strong>Automatic update checks</strong><span>Skai checks the official GitHub release channel when it starts and every six hours. Downloads always open from the verified project release page so you can review the version before replacing the portable app.</span></div><div className="settings-provider-list"><div className="settings-provider-row"><span><strong>Installed version</strong><small>{updateState?.currentVersion ?? "Checking…"}</small></span><StatusBadge tone="neutral">Electron</StatusBadge></div><div className="settings-provider-row"><span><strong>Update status</strong><small>{updateState?.error ?? updateState?.message ?? "Checking the stable release channel…"}</small></span><StatusBadge tone={updateState?.available ? "success" : updateState?.error ? "warning" : "neutral"}>{updateState?.available ? `v${updateState.version} ready` : updateState ? "Up to date" : "Checking"}</StatusBadge></div></div><div className="settings-model-actions"><Button variant="secondary" disabled={checkingUpdates} onClick={() => void checkUpdates()}>{checkingUpdates ? "Checking…" : "Check for updates"}</Button>{updateState?.available && updateState.downloadUrl && <Button variant="primary" onClick={() => void window.serverRockAgent?.updates?.open(updateState.downloadUrl!)}>Review download</Button>}</div><p className="settings-help">Portable Windows and Linux builds are delivered as signed release archives. Skai never installs an unverified artifact or runs a downloaded executable in the background.</p></>}

        {activeCategory === "Advanced" && <><Toggle label="Developer mode" detail="Show extra diagnostics and development controls." checked={props.developerMode} onChange={(value) => change("developerMode", value)} /><Toggle label="Reduced motion" detail="Also controls pet wandering defaults and decorative movement." checked={props.reduceMotion} onChange={(value) => change("reduceMotion", value)} /><p className="settings-help">Provider routing remains local-only. Diagnostics and motion settings apply across the workspace.</p></>}

        <div className="settings-footer"><span className={`settings-save-status settings-save-${saveState}`} role="status">{saveState === "saving" ? "Saving changes…" : saveState === "saved" ? "Saved locally" : "Changes apply across the workspace."}</span><Button variant="primary" disabled={saveState === "saving"} onClick={() => void save()}>{saveState === "saving" ? "Saving…" : "Save settings"}</Button></div>
      </main>
    </div>
  </div>;
}

function categoryDescription(category: Category) {
  const descriptions: Record<Category, string> = { General: "Choose the local runtime and model Skai should use first.", Appearance: "Tune the visual environment without changing companion settings.", Pet: "Choose, show, and personalize Percy as a separate desktop companion window.", "Models & Providers": "Choose a model runtime already running on this computer.", "Voice & Audio": "Choose local speech behavior and preview it safely.", "Image Generation": "Configure the local image workflow used by the Images workspace.", Agents: "Control task planning, diagnostics, and memory injection.", Integrations: "Review the local services and project integrations currently connected.", "Privacy & Security": "Review the local data boundary and storage controls.", Storage: "Back up local workspace data without destructive shortcuts.", Updates: "See the release channel and update delivery status.", Advanced: "Review controls that affect diagnostics and motion." };
  return descriptions[category];
}

// Linux only: what closing the main window does (see electron/main.cjs). Saved immediately in the shell.
function CloseBehaviorSetting() {
  const bridge = window.serverRockAgent?.window;
  const [behavior, setBehavior] = useState<CloseBehavior | null>(null);
  useEffect(() => { if (bridge?.platform === "linux") void bridge.getCloseBehavior().then(setBehavior); }, [bridge]);
  if (!bridge || bridge.platform !== "linux" || behavior === null) return null;
  const update = (event: ChangeEvent<HTMLSelectElement>) => { void bridge.setCloseBehavior(event.target.value as CloseBehavior).then(setBehavior); };
  return <div className="settings-field settings-field-single"><label>When you close the window<select value={behavior} onChange={update}><option value="ask">Ask every time</option><option value="background">Run in background</option><option value="quit">Fully close</option></select><small className="settings-help">Applies to window-manager close shortcuts such as Super+C. Quit any time from the tray menu.</small></label></div>;
}

function Toggle({ label, detail, checked, onChange }: { label: string; detail: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="settings-toggle"><span><strong>{label}</strong><small>{detail}</small></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>;
}

function PetSettings({ props, change }: { props: SettingsProps; change: (key: string, value: string | boolean) => void }) {
  const [character, setCharacter] = useState(props.petCharacter);
  const [profiles, setProfiles] = useState<PetSpriteProfile[]>([]);
  const [profileName, setProfileName] = useState("My companion");
  const [profileError, setProfileError] = useState<string | null>(null);
  const activeProfileId = character.startsWith("custom:") ? character.slice("custom:".length) : null;
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? null;
  useEffect(() => {
    let alive = true;
    void listPetSpriteProfiles().then(async (stored) => {
      let next = stored;
      const legacy = props.petSpriteDataUrl || localStorage.getItem("skai.pet.sprite") || "";
      if (legacy && !stored.some((profile) => profile.id === "legacy")) {
        const legacyBlob = await (await fetch(legacy)).blob();
        const strip = await validatePetStrip(new File([legacyBlob], `legacy.${legacyBlob.type === "image/webp" ? "webp" : "png"}`, { type: legacyBlob.type }));
        const migrated: PetSpriteProfile = { id: "legacy", name: "My companion", strips: { idle: strip } };
        await savePetSpriteProfile(migrated);
        next = [...stored, migrated];
        localStorage.setItem("skai.pet.character", "custom:legacy");
        localStorage.removeItem("skai.pet.sprite");
        setCharacter("custom:legacy");
        change("petSpriteDataUrl", "");
        change("petCharacter", "custom:legacy");
      }
      if (alive) setProfiles(next);
    }).catch((error) => { if (alive) setProfileError(error instanceof Error ? error.message : "Custom companions could not be loaded."); });
    return () => { alive = false; };
  }, []);
  const chooseCharacter = (value: string) => {
    setCharacter(value);
    localStorage.setItem("skai.pet.character", value);
    change("petCharacter", value);
  };
  const createProfile = async () => {
    const name = profileName.trim().slice(0, 48);
    if (!name) { setProfileError("Give your companion a name first."); return; }
    const profile = { id: crypto.randomUUID(), name, strips: {} } satisfies PetSpriteProfile;
    try {
      await savePetSpriteProfile(profile);
      setProfiles((current) => [...current, profile]);
      setProfileName("");
      setProfileError(null);
      chooseCharacter(`custom:${profile.id}`);
    } catch (error) { setProfileError(error instanceof Error ? error.message : "The companion profile could not be saved."); }
  };
  const importProfile = async (file?: File) => {
    if (!file) return;
    try {
      const profile = await validatePetProfileImport(file);
      await savePetSpriteProfile(profile);
      setProfiles((current) => [...current, profile]);
      setProfileError(null);
      chooseCharacter(`custom:${profile.id}`);
    } catch (error) { setProfileError(error instanceof Error ? error.message : "The companion profile could not be imported."); }
  };
  const updateStrip = async (animation: PetAnimationId, file?: File) => {
    if (!activeProfile || !file) return;
    setProfileError(null);
    try {
      const strip = await validatePetStrip(file);
      const updated = { ...activeProfile, strips: { ...activeProfile.strips, [animation]: strip } };
      await savePetSpriteProfile(updated);
      setProfiles((current) => current.map((profile) => profile.id === updated.id ? updated : profile));
    } catch (error) { setProfileError(error instanceof Error ? error.message : "This sprite strip could not be used."); }
  };
  const removeStrip = async (animation: PetAnimationId) => {
    if (!activeProfile) return;
    const strips = { ...activeProfile.strips };
    delete strips[animation];
    const updated = { ...activeProfile, strips };
    await savePetSpriteProfile(updated);
    setProfiles((current) => current.map((profile) => profile.id === updated.id ? updated : profile));
  };
  const removeProfile = async () => {
    if (!activeProfile) return;
    await deletePetSpriteProfile(activeProfile.id);
    setProfiles((current) => current.filter((profile) => profile.id !== activeProfile.id));
    chooseCharacter("percy");
  };
  return <>
    <div className="settings-callout"><strong>Separate desktop companion</strong><span>Percy is its own transparent, always-on-top window. It can be dragged anywhere and stays independent from the Skai workspace.</span></div>
    <Toggle label="Show Percy" detail="Open the companion above your other windows." checked={props.petVisible} onChange={(value) => change("petVisible", value)} />
    <Toggle label="Let Percy walk around" detail="Allow gentle ambient movement while Percy is idle. Dragging always pauses movement." checked={props.petWander} onChange={(value) => change("petWander", value)} />
    <div className="settings-field"><label>Companion<select value={character} onChange={(event) => chooseCharacter(event.target.value)}><option value="percy">Percy · Skai wolf</option><option value="byte">Byte · neon bot</option><option value="ember">Ember · ember fox</option><option value="nova">Nova · star cat</option><option value="rocky">Rocky · pocket rock</option><option value="sprout">Sprout · tiny plant</option>{profiles.map((profile) => <option key={profile.id} value={`custom:${profile.id}`}>{profile.name} · custom</option>)}</select></label><div className="pet-settings-preview"><img src={activeProfile?.strips.idle?.dataUrl || builtInPetPreviews[character] || builtInPetPreviews.percy} alt="" /><span>{activeProfile ? `${activeProfile.name} · custom profile` : "Built-in sprite set"}</span></div></div>
    <section className="pet-profile-builder" aria-label="Custom companion profiles"><div><p className="section-kicker">MAKE A COMPANION</p><h4>Create a custom pet</h4><p>Name a profile, then add the animation strips you have. Missing states fall back to the built-in pet animation until you add one.</p></div><div className="pet-profile-create"><input value={profileName} onChange={(event) => setProfileName(event.target.value)} maxLength={48} placeholder="Companion name" aria-label="Custom companion name" /><Button variant="secondary" onClick={() => void createProfile()}>Create profile</Button><label className="ui-button ui-button-secondary"><span>Import profile</span><input type="file" accept="application/json,.json" onChange={(event) => { void importProfile(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label></div>
      {activeProfile && <><div className="pet-profile-title"><strong>{activeProfile.name} animations</strong><Button variant="ghost" onClick={() => void removeProfile()}>Delete profile</Button></div><div className="pet-animation-grid">{PET_ANIMATIONS.map((animation) => { const strip = activeProfile.strips[animation.id]; return <article className="pet-animation-card" key={animation.id}><div className={`pet-animation-preview${strip ? " is-animated" : " is-fallback"}`} aria-label={`${animation.label} strip preview`} style={strip ? petStripPreviewStyle(strip) : undefined} /> <div className="pet-animation-copy"><strong>{animation.label}</strong><small>{strip ? `Preview · 6 frames · ${strip.frameWidth} × ${strip.frameHeight} each` : "Using built-in fallback"}</small><label className="ui-button ui-button-secondary"><span>{strip ? "Replace strip" : "Add strip"}</span><input type="file" accept="image/png,image/webp" onChange={(event) => { void updateStrip(animation.id, event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>{strip && <Button variant="ghost" onClick={() => void removeStrip(animation.id)}>Use fallback</Button>}</div></article>; })}</div><div className="pet-profile-actions"><Button variant="secondary" onClick={() => { const blob = new Blob([JSON.stringify(activeProfile)], { type: "application/json" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `${activeProfile.name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() || "skai-pet"}.json`; link.click(); window.setTimeout(() => URL.revokeObjectURL(link.href), 1000); }}>Export profile</Button></div></>}
      {profileError && <p className="form-error" role="alert">{profileError}</p>}
      <p className="settings-help">Each PNG or WebP must be a single horizontal row of six equal-width frames with transparent pixels. Strips can have different frame sizes; Skai scales them to fit. Each strip can be up to 5 MB.</p>
    </section>
  </>;
}

function Integration({ title, detail, status }: { title: string; detail: string; status: "Available" | "Needs setup" | "Planned" }) {
  return <div className="settings-provider-row"><span><strong>{title}</strong><small>{detail}</small></span><StatusBadge tone={status === "Available" ? "success" : status === "Needs setup" ? "warning" : "neutral"}>{status}</StatusBadge></div>;
}
