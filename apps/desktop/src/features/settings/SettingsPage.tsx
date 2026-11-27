import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { Model, Route, ThemeMode } from "../../app/types";
import type { AgentResponse, CloseBehavior, UpdateCheckResult } from "../../../shared/contracts";
import { cloudVoiceProviders, installedVoiceModels, refreshInstalledVoiceModels, saveVoiceSetting, selectedVoiceSettings, speakNativeResponse, stopNativeSpeech, voiceProfiles } from "../../services/nativeTts";
import { isLocalProvider, localProviderOrFallback } from "../../services/localOnly";
import { listPetSpriteProfiles, savePetSpriteProfile, validatePetStrip, type PetSpriteProfile } from "./petSprites";
import { Button, PageHeader, StatusBadge } from "../../components/ui/Primitives";
import { NavIcon, type NavIconName } from "../../components/ui/NavIcon";
import { ThemeSettings } from "../../theme/ThemeSettings";
import { AppearancePreview } from "../../theme/AppearanceOptions";
import { enableRetroTheme, readAchievements, unlockAchievement, type SkaiAchievement } from "./easterEggs";
import { VoicePresetManager } from "./VoicePresetManager";
import { PermissionCenter } from "./PermissionCenter";
import { WorkspaceBackupManager } from "./WorkspaceBackupManager";

const categories = ["General", "Appearance", "Pet", "Models & Providers", "Voice & Audio", "Image Generation", "Agents", "Integrations", "Privacy & Security", "Storage", "Achievements", "Updates", "Advanced"] as const;
type Category = typeof categories[number];
type AirLlmRuntimeStatus = { workerAvailable: boolean; dependenciesAvailable: boolean; pythonCommand: string; status: string; message: string };
type AirLlmInstallSession = { id: string; status: string; progress: string[]; error?: string | null };
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
  Achievements: "sparkle",
  Advanced: "terminal",
};

const categorySearchText: Record<Category, string> = {
  General: "runtime provider model preferred chat coding rewrite vision voice answer local close window background tray quit linux",
  Appearance: "theme color accent density backdrop reduced motion pet companion animation",
  Pet: "pets companions sprite sheet character walk wander always on top overlay custom",
  "Models & Providers": "endpoint runtime model discover Ollama LM Studio AirLLM provider local context window tokens 1M",
  "Voice & Audio": "voice speech audio low resource profile preview text to speech TTS Chatterbox ElevenLabs Qwen3-TTS OmniVoice Kokoro Higgs Audio Inworld Cartesia Sonic",
  "Image Generation": "image ComfyUI workflow prompt endpoint generation",
  Agents: "task developer diagnostics memory prompts planning smart rewrite reengineering",
  Integrations: "GitHub local services ComfyUI integrations repository",
  "Privacy & Security": "privacy security permissions grants folder access sandbox audit revoke local storage memory credentials data boundary",
  Storage: "export backup data workspace local memory",
  Achievements: "achievements easter eggs unlocked badges secrets",
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
  percy: new URL("../../../../../assets/pets/generated/percy-idle-preview.png", import.meta.url).href,
  byte: new URL("../../../../../assets/pets/generated/byte-idle-preview.png", import.meta.url).href,
  ember: new URL("../../../../../assets/pets/generated/ember-motion-idle-preview.png", import.meta.url).href,
  blaze: new URL("../../../../../assets/pets/generated/blaze-idle-preview.png", import.meta.url).href,
  nova: new URL("../../../../../assets/pets/generated/nova-idle-preview.png", import.meta.url).href,
  rocky: new URL("../../../../../assets/pets/generated/rocky-idle-preview.png", import.meta.url).href,
  sprout: new URL("../../../../../assets/pets/generated/sprout-idle-preview.png", import.meta.url).href,
};

type SettingsProps = {
  provider: string;
  endpoint: string;
  model: string;
  subagentModel?: string;
  subagentModelProvider?: string;
  subagentModelSizeBytes?: number | null;
  subagentModelContextLength?: number | null;
  models: Model[];
  ollamaContextWindowTokens: number;
  localRamBudgetBytes: number;
  localGpuBudgetBytes: number;
  themeMode: ThemeMode;
  accentColor: string;
  density: string;
  backdrop: string;
  reduceMotion: boolean;
  petVisible: boolean;
  petWander: boolean;
  petInteractionDemo: boolean;
  petCharacter: string;
  petSpriteDataUrl: string;
  developerMode: boolean;
  memoryInjectionEnabled: boolean;
  smartPromptRewritingEnabled: boolean;
  imageEndpoint: string;
  imageWorkflow: string;
  threeDWorkflow: string;
  onChange: (key: string, value: string | boolean) => void;
  onSave: () => Promise<boolean>;
  onDiscoverModels: () => void | Promise<boolean>;
  onImageChange: (key: "endpoint" | "prompt" | "workflow" | "threeDWorkflow", value: string) => void;
  onImportWorkflow?: () => Promise<{ name: string; workflow: string } | null>;
  onExportMemory: () => void;
  onNavigate: (route: Route) => void;
};

export function SettingsPage(props: SettingsProps) {
  const [activeCategory, setActiveCategory] = useState<Category>("General");
  const [query, setQuery] = useState("");
  const settingsContentRef = useRef<HTMLDivElement>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [discoveringModels, setDiscoveringModels] = useState(false);
  const [subagentChoice, setSubagentChoice] = useState("");
  const [subagentSizeBytes, setSubagentSizeBytes] = useState<number | null>(props.subagentModelSizeBytes ?? null);
  const [subagentContextLength, setSubagentContextLength] = useState<number | null>(props.subagentModelContextLength ?? null);
  const [importingThreeDWorkflow, setImportingThreeDWorkflow] = useState(false);
  const [threeDWorkflowImportMessage, setThreeDWorkflowImportMessage] = useState("");
  const [airLlmStatus, setAirLlmStatus] = useState<AirLlmRuntimeStatus | null>(null);
  const [checkingAirLlm, setCheckingAirLlm] = useState(false);
  const [airLlmInstall, setAirLlmInstall] = useState<AirLlmInstallSession | null>(null);
  const [startingAirLlmInstall, setStartingAirLlmInstall] = useState(false);
  const [voiceSettings, setVoiceSettings] = useState(selectedVoiceSettings);
  const [cloudApiKey, setCloudApiKey] = useState("");
  const [cloudCredentialConfigured, setCloudCredentialConfigured] = useState(false);
  const [cloudCredentialAvailable, setCloudCredentialAvailable] = useState(false);
  const [cloudCredentialBusy, setCloudCredentialBusy] = useState(false);
  const [cloudCredentialError, setCloudCredentialError] = useState<string | null>(null);
  const [updateState, setUpdateState] = useState<UpdateCheckResult | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateChecksEnabled, setUpdateChecksEnabled] = useState(true);
  const [achievements, setAchievements] = useState<SkaiAchievement[]>(readAchievements);
  const normalizedQuery = query.trim().toLowerCase();
  useEffect(() => {
    let active = true;
    void window.skaiAgent?.request("settings.get").then((response) => {
      if (!active || !response?.ok) return;
      const settings = response.result as { subagentModel?: string; subagentModelProvider?: string; subagentModelSizeBytes?: number | null; subagentModelContextLength?: number | null };
      setSubagentChoice(settings.subagentModel ? `${settings.subagentModelProvider || props.provider}::${settings.subagentModel}` : "");
      setSubagentSizeBytes(settings.subagentModelSizeBytes ?? null);
      setSubagentContextLength(settings.subagentModelContextLength ?? null);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [props.provider]);
  const visibleCategories = useMemo(() => categories.filter((category) => !normalizedQuery || `${category} ${categoryDescription(category)} ${categorySearchText[category]}`.toLowerCase().includes(normalizedQuery)), [normalizedQuery]);
  const jumpToMatchingSetting = () => {
    if (!normalizedQuery) return;
    const root = settingsContentRef.current;
    if (!root) return;
    const target = [...root.querySelectorAll<HTMLElement>("label, [role=switch], button")]
      .find((element) => (element.innerText || element.getAttribute("aria-label") || "").toLowerCase().includes(normalizedQuery));
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("settings-search-highlight");
    window.setTimeout(() => target.classList.remove("settings-search-highlight"), 1400);
    target.querySelector<HTMLElement>("input, select, textarea, button")?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (!normalizedQuery || visibleCategories.includes(activeCategory)) return;
    const nextCategory = visibleCategories[0];
    if (nextCategory) setActiveCategory(nextCategory);
  }, [activeCategory, normalizedQuery, visibleCategories]);
  useEffect(() => { if (activeCategory !== "Voice & Audio") setCloudApiKey(""); }, [activeCategory]);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      await refreshInstalledVoiceModels();
      if (active) setVoiceSettings(selectedVoiceSettings());
    };
    void refresh();
    window.addEventListener("skai:voice-models-updated", refresh);
    return () => { active = false; window.removeEventListener("skai:voice-models-updated", refresh); };
  }, []);
  useEffect(() => {
    const updates = window.skaiAgent?.updates;
    if (!updates) return;
    void updates.enabled().then(setUpdateChecksEnabled).catch(() => undefined);
    void updates.state().then((state) => { if (state) setUpdateState(state); }).catch(() => undefined);
    return updates.onState(setUpdateState);
  }, []);
  useEffect(() => {
    if (localStorage.getItem("skai.easterEgg.retro") === "true") enableRetroTheme();
    const refresh = () => setAchievements(readAchievements());
    window.addEventListener("skai:achievement-unlocked", refresh);
    return () => window.removeEventListener("skai:achievement-unlocked", refresh);
  }, []);
  const change = (key: string, value: string | boolean) => { setSaveState("idle"); props.onChange(key, value); };
  useEffect(() => {
    let current = true;
    if (voiceSettings.source !== "cloud") return () => { current = false; };
    void window.skaiAgent?.request("voice.credentials.status", { provider: voiceSettings.cloudProvider }).then((response) => {
      if (!current) return;
      if (!response?.ok) { setCloudCredentialAvailable(false); setCloudCredentialConfigured(false); return; }
      const result = response.result as { available?: boolean; configured?: boolean };
      setCloudCredentialAvailable(Boolean(result.available));
      setCloudCredentialConfigured(Boolean(result.configured));
    }).catch(() => { if (current) { setCloudCredentialAvailable(false); setCloudCredentialConfigured(false); } });
    return () => { current = false; };
  }, [voiceSettings.cloudProvider, voiceSettings.source]);
  const saveCloudCredential = async () => {
    if (cloudCredentialBusy || !cloudApiKey.trim()) return;
    setCloudCredentialBusy(true);
    setCloudCredentialError(null);
    try {
      const response = await window.skaiAgent?.request("voice.credentials.save", { provider: voiceSettings.cloudProvider, apiKey: cloudApiKey.trim() });
      if (!response?.ok) throw new Error(response?.error?.message ?? "The provider key could not be saved.");
      setCloudApiKey("");
      setCloudCredentialConfigured(true);
    } catch (error) {
      setCloudCredentialError(error instanceof Error ? error.message : "The provider key could not be saved.");
    } finally { setCloudCredentialBusy(false); }
  };
  const removeCloudCredential = async () => {
    if (cloudCredentialBusy) return;
    setCloudCredentialBusy(true);
    setCloudCredentialError(null);
    try {
      const response = await window.skaiAgent?.request("voice.credentials.remove", { provider: voiceSettings.cloudProvider });
      if (!response?.ok) throw new Error(response?.error?.message ?? "The provider key could not be removed.");
      setCloudCredentialConfigured(false);
      setCloudApiKey("");
    } catch (error) {
      setCloudCredentialError(error instanceof Error ? error.message : "The provider key could not be removed.");
    } finally { setCloudCredentialBusy(false); }
  };
  const selectedOllamaModel = props.models.find((entry) => entry.model === props.model && (entry.provider ?? "").toLowerCase() === "ollama");
  const contextSupport = selectedOllamaModel?.contextLength == null ? "unknown" : selectedOllamaModel.contextLength >= 1_048_576 ? "supported" : "unsupported";
  const contextMismatch = props.provider === "Ollama" && props.ollamaContextWindowTokens > 0 && selectedOllamaModel?.contextLength != null && props.ollamaContextWindowTokens > selectedOllamaModel.contextLength;
  const save = async () => { if (saveState === "saving") return; setSaveState("saving"); try { if (!await props.onSave()) { setSaveState("idle"); return; } const selected = props.models.find((entry) => `${entry.provider ?? "Local API"}::${entry.model}` === subagentChoice); const separator = subagentChoice.indexOf("::"); const response = await window.skaiAgent?.request("settings.save", { provider: props.provider, endpoint: props.endpoint, model: props.model, comfyEndpoint: props.imageEndpoint, imageWorkflow: props.imageWorkflow, threeDWorkflow: props.threeDWorkflow, subagentModel: selected?.model ?? (separator >= 0 ? subagentChoice.slice(separator + 2) : ""), subagentModelProvider: selected?.provider ?? (separator >= 0 ? subagentChoice.slice(0, separator) : ""), subagentModelSizeBytes: selected?.sizeBytes ?? subagentSizeBytes, subagentModelContextLength: selected?.contextLength ?? subagentContextLength }); if (!response?.ok) throw new Error(response?.error?.message ?? "The subagent model preference could not be saved."); setSaveState("saved"); } catch { setSaveState("idle"); } };
  const discoverModels = async () => { if (discoveringModels) return; setDiscoveringModels(true); await props.onDiscoverModels(); setDiscoveringModels(false); };
  const importThreeDWorkflow = async () => { if (!props.onImportWorkflow || importingThreeDWorkflow) return; setImportingThreeDWorkflow(true); setThreeDWorkflowImportMessage(""); try { const workflow = await props.onImportWorkflow(); if (workflow) { props.onImageChange("threeDWorkflow", workflow.workflow); setThreeDWorkflowImportMessage(`Loaded ${workflow.name}. Save settings to enable 3D generation.`); } } catch (error) { setThreeDWorkflowImportMessage(error instanceof Error ? error.message : "The 3D workflow could not be imported."); } finally { setImportingThreeDWorkflow(false); } };
  const checkAirLlm = async () => {
    if (checkingAirLlm) return;
    setCheckingAirLlm(true);
    try {
      const response: AgentResponse | undefined = await window.skaiAgent?.request("airllm.status");
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
      const response = await window.skaiAgent?.request("airllm.install.start");
      if (!response?.ok) throw new Error(response?.error?.message ?? "AirLLM setup could not start.");
      let session = response.result as AirLlmInstallSession;
      setAirLlmInstall(session);
      while (session.status === "running") {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        const status = await window.skaiAgent?.request("airllm.install.status", { id: session.id });
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
    const response = await window.skaiAgent?.request("airllm.install.cancel", { id: airLlmInstall.id });
    if (response?.ok) setAirLlmInstall(response.result as AirLlmInstallSession);
  };
  const updateVoice = (key: "profileId" | "primaryModelId" | "lowResourceModelId" | "lowResourceMode" | "voiceOutputEnabled" | "source" | "cloudProvider" | "cloudModelId" | "cloudVoiceId" | "qwenSpeaker" | "expressiveness" | "voiceActivitySensitivity", value: string | boolean | number) => { if (key === "source" && value !== "cloud" || key === "cloudProvider") { setCloudApiKey(""); setCloudCredentialError(null); } saveVoiceSetting(key, value); setVoiceSettings(selectedVoiceSettings()); };
  const activeVoiceRuntime = installedVoiceModels.find((voice) => voice.id === (voiceSettings.lowResourceMode ? voiceSettings.lowResourceModelId : voiceSettings.primaryModelId));
  const checkUpdates = async () => {
    if (checkingUpdates || !window.skaiAgent?.updates) return;
    setCheckingUpdates(true);
    try { setUpdateState(await window.skaiAgent.updates.retry()); }
    finally { setCheckingUpdates(false); }
  };
  const selectedProviderId = localProviderOrFallback(props.provider);
  const selectedProvider = providerChoices.find((choice) => choice.id === selectedProviderId) ?? providerChoices[0];
  const localRoute = isLocalProvider(selectedProviderId);

  return <div className="feature-page settings-page">
    <PageHeader className="settings-page-header" eyebrow="CONTROL CENTER" title="Workspace settings" description="Tune the local runtime, appearance, voice, media, memory, and workspace behavior." />
    <div className="settings-window">
      <aside className="settings-nav" aria-label="Settings sections"><p className="section-kicker">PREFERENCES</p><label className="settings-search-wrap"><NavIcon name="search" /><input className="settings-search" value={query} onChange={(event) => { const value = event.target.value; setQuery(value); if (value.trim().toLowerCase() === "konami") { enableRetroTheme(); unlockAchievement("retro-search"); } }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); jumpToMatchingSetting(); } }} placeholder="Find a setting" aria-label="Search settings" /></label>{normalizedQuery && <><p className="settings-search-status" role="status">{visibleCategories.length} matching {visibleCategories.length === 1 ? "section" : "sections"}</p><Button className="settings-search-jump" variant="secondary" type="button" onClick={jumpToMatchingSetting}>Jump to matching control <kbd>Enter</kbd></Button></>}<nav className="settings-category-list" aria-label="Settings categories">{visibleCategories.map((category) => <button className={activeCategory === category ? "is-active" : ""} aria-current={activeCategory === category ? "page" : undefined} key={category} onClick={() => setActiveCategory(category)} type="button"><NavIcon name={categoryIcons[category]} /><span>{category}</span>{category === "Achievements" && achievements.length > 0 && <small className="settings-achievement-count">{achievements.length}</small>}</button>)}</nav>{visibleCategories.length === 0 && <p className="settings-no-results">No settings match. Try a label such as endpoint, motion, or memory.</p>}</aside>
      <main className="settings-content">
        <div className="settings-content-scroll" ref={settingsContentRef}>
        <div className="settings-section-heading"><div><p className="section-kicker">{activeCategory.toUpperCase()}</p><h1>{activeCategory}</h1><p>{categoryDescription(activeCategory)}</p></div></div>

        {activeCategory === "General" && <><AboutYouSetting /><PreferredModelsSetting props={props} change={change} /><CloseBehaviorSetting /><div className="settings-callout"><strong>Current model: {props.model}</strong><span>{selectedProvider.label} · {selectedProvider.detail} Model and endpoint controls are grouped under Models &amp; Providers.</span><Button variant="secondary" type="button" onClick={() => setActiveCategory("Models & Providers")}>Configure models &amp; providers</Button></div></>}

        {activeCategory === "Appearance" && <><AppearancePreview /><div className="settings-field"><label>Color theme<select value={props.themeMode} onChange={(event) => change("themeMode", event.target.value)}><option value="dark">Dark</option><option value="light">Light</option><option value="system">System</option></select></label>{/* Theme: the old Accent select (Cyan/Violet/Amber/Rose) was removed at the user's request: nothing read it. Appearance → Layout and motion → Accent sets the accent now. */}</div><ThemeSettings /><div className="settings-field"><label>Interface density<select value={props.density} onChange={(event) => change("density", event.target.value)}><option value="compact">Compact</option><option value="comfortable">Comfortable</option><option value="spacious">Spacious</option></select></label><label>Backdrop<select value={props.backdrop} onChange={(event) => change("backdrop", event.target.value)}><option value="none">None</option><option value="deep-sea">Deep sea</option><option value="deep-space">Deep space</option></select></label></div><Toggle label="Reduced motion" detail="Minimize interface animations and decorative movement." checked={props.reduceMotion} onChange={(value) => change("reduceMotion", value)} /></>}

        {activeCategory === "Pet" && <PetSettings props={props} change={change} />}

        {activeCategory === "Models & Providers" && <><div className="settings-field"><label>Provider<select value={selectedProviderId} onChange={(event) => change("provider", event.target.value)}>{providerChoices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</select></label><label>Model endpoint<input value={props.endpoint} onChange={(event) => change("endpoint", event.target.value)} placeholder="http://localhost:11434/v1" /></label></div><div className="settings-field"><label>Ollama context window<select value={props.ollamaContextWindowTokens} disabled={props.provider !== "Ollama"} onChange={(event) => change("ollamaContextWindowTokens", event.target.value)}><option value={0}>Runtime default</option><option value={32768}>32K tokens</option><option value={131072}>128K tokens</option><option value={1048576}>1M tokens</option></select></label><span className="settings-help">For Ollama only. Runtime default leaves Ollama unchanged. Larger windows use substantially more memory and require a model that supports the selected context.</span></div><div className="settings-field settings-budget-fields"><label>RAM budget (GiB)<input type="number" min="0" max="1024" step="1" value={props.localRamBudgetBytes ? Math.round(props.localRamBudgetBytes / 1073741824) : ""} onChange={(event) => { const value = Number(event.target.value); change("localRamBudgetBytes", Number.isFinite(value) && value > 0 ? String(Math.round(value * 1073741824)) : "0"); }} placeholder="Automatic" /></label><label>VRAM budget (GiB)<input type="number" min="0" max="1024" step="1" value={props.localGpuBudgetBytes ? Math.round(props.localGpuBudgetBytes / 1073741824) : ""} onChange={(event) => { const value = Number(event.target.value); change("localGpuBudgetBytes", Number.isFinite(value) && value > 0 ? String(Math.round(value * 1073741824)) : "0"); }} placeholder="Automatic" /></label><span className="settings-help">Optional caps for concurrent local coding tasks. Leave blank for automatic measurement; the scheduler stays conservative when telemetry is unavailable.</span></div>{props.provider === "Ollama" && <div className="settings-context-support" role="status"><StatusBadge tone={contextSupport === "supported" ? "success" : contextSupport === "unsupported" ? "warning" : "neutral"}>{contextSupport === "supported" ? "1M advertised" : contextSupport === "unsupported" ? "Below 1M" : "Context unknown"}</StatusBadge><span>{selectedOllamaModel?.contextLength == null ? "Discover local models to read Ollama model metadata for the selected model." : `${props.model} advertises a ${selectedOllamaModel.contextLength.toLocaleString()} token context. This is model metadata; available RAM and the runtime configuration still determine whether it can run.`}</span></div>}<div className="settings-model-actions"><Button variant="secondary" disabled={discoveringModels} onClick={() => void discoverModels()}>{discoveringModels ? "Discovering…" : "Discover local models"}</Button><span>AirLLM can take over when a selected model exceeds available memory.</span></div><div className="settings-callout airllm-callout"><strong>Optional AirLLM runtime</strong><span>{airLlmStatus ? `${airLlmStatus.message} ${airLlmStatus.pythonCommand ? `Python: ${airLlmStatus.pythonCommand}` : ""}` : "AirLLM is an optional, slower runtime for compatible Hugging Face models that exceed your usual local model's memory."} Installing it downloads Python dependencies and may use several gigabytes of disk. Model weights are separate and download only when you select a model.</span><div className="settings-model-actions"><StatusBadge tone={airLlmInstall?.status === "running" ? "warning" : airLlmStatus?.dependenciesAvailable ? "success" : airLlmStatus ? "warning" : "neutral"}>{airLlmInstall?.status === "running" ? "Installing" : airLlmStatus?.status ?? "Not checked"}</StatusBadge><Button variant="secondary" disabled={checkingAirLlm || startingAirLlmInstall} onClick={() => void checkAirLlm()}>{checkingAirLlm ? "Checking…" : "Check readiness"}</Button>{!airLlmStatus?.dependenciesAvailable && <Button variant="primary" disabled={startingAirLlmInstall || airLlmInstall?.status === "running"} onClick={() => void installAirLlm()}>{startingAirLlmInstall || airLlmInstall?.status === "running" ? "Installing…" : "Install optional runtime"}</Button>}{airLlmInstall?.status === "running" && <Button variant="ghost" onClick={() => void cancelAirLlmInstall()}>Cancel setup</Button>}</div>{airLlmInstall && <div className={`airllm-install-log${airLlmInstall.status === "failed" ? " is-error" : ""}`} role="status" aria-live="polite">{airLlmInstall.error && <strong>{airLlmInstall.error}</strong>}{airLlmInstall.progress.slice(-4).map((line, index) => <span key={`${index}-${line}`}>{line}</span>)}</div>}</div><details className="airllm-help"><summary>What is AirLLM?</summary><p>AirLLM can run some compatible Hugging Face models that do not fit in your usual runtime by streaming model layers from disk. It can be much slower and needs model storage space. Skai only uses the optional runtime after you install it; compatible model weights are downloaded separately when you choose them.</p></details><div className="settings-provider-list">{providerChoices.map((choice) => <div className="settings-provider-row" key={choice.id}><span><strong>{choice.label}</strong><small>{choice.detail}</small></span><StatusBadge tone="neutral">Supported locally</StatusBadge></div>)}</div></>}

        {activeCategory === "Voice & Audio" && <><VoicePresetManager onApplied={() => setVoiceSettings(selectedVoiceSettings())} /><div className="settings-field"><label>Voice source<select value={voiceSettings.source} onChange={(event) => updateVoice("source", event.target.value)}><option value="local">Local downloaded/system voice</option><option value="cloud">Hosted voice provider</option></select></label><span className="settings-help">Local keeps audio on this computer. Hosted providers send spoken reply text to the provider you choose.</span></div>{voiceSettings.source === "cloud" && <div className="settings-callout"><strong>{cloudVoiceProviders.find((provider) => provider.id === voiceSettings.cloudProvider)?.name ?? "Hosted voice"}</strong><span>The key is stored securely by your operating system and is used only by the local Agent Host for this provider.</span><div className="settings-field"><label>Provider<select value={voiceSettings.cloudProvider} onChange={(event) => { const provider = cloudVoiceProviders.find((item) => item.id === event.target.value) ?? cloudVoiceProviders[0]; updateVoice("cloudProvider", provider.id); updateVoice("cloudModelId", provider.model); updateVoice("cloudVoiceId", provider.defaultVoiceId); }} >{cloudVoiceProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label><label>API key<input type="password" value={cloudApiKey} onChange={(event) => { setCloudApiKey(event.target.value); }} placeholder={cloudCredentialConfigured ? "A key is saved securely on this device" : "Paste your provider API key"} autoComplete="off" /></label><label>Model ID<input value={voiceSettings.cloudModelId} onChange={(event) => updateVoice("cloudModelId", event.target.value)} /></label><label>Voice ID<input value={voiceSettings.cloudVoiceId} onChange={(event) => updateVoice("cloudVoiceId", event.target.value)} placeholder="Provider voice ID" /></label></div><div className="settings-inline-action"><Button variant="primary" disabled={cloudCredentialBusy || !cloudApiKey.trim() || !cloudCredentialAvailable} onClick={() => void saveCloudCredential()}>{cloudCredentialBusy ? "Saving…" : cloudCredentialConfigured ? "Replace saved key" : "Save key securely"}</Button>{cloudCredentialConfigured && <Button variant="ghost" disabled={cloudCredentialBusy} onClick={() => void removeCloudCredential()}>Remove saved key</Button>}<span>{cloudCredentialAvailable ? cloudCredentialConfigured ? "Key configured on this device." : "Secure key storage is available." : "Secure key storage is unavailable on this device."}</span></div>{cloudCredentialError && <p className="settings-error" role="alert">{cloudCredentialError}</p>}<p className="settings-help">Cloud voice requires a provider key and voice ID. If it fails, Skai announces the failure and uses the native fallback voice.</p></div>}<div className="settings-field"><label>Primary local runtime<select value={voiceSettings.primaryModelId} onChange={(event) => updateVoice("primaryModelId", event.target.value)} disabled={voiceSettings.source === "cloud"}>{installedVoiceModels.length === 0 && <option value="">No installed local runtime is available</option>}{installedVoiceModels.map((voice) => <option key={voice.id} value={voice.id}>{voice.name}</option>)}</select></label>{installedVoiceModels.some((voice) => voice.lowResource && voice.id !== voiceSettings.primaryModelId) && <label>Low-resource runtime<select value={voiceSettings.lowResourceModelId} onChange={(event) => updateVoice("lowResourceModelId", event.target.value)}>{installedVoiceModels.filter((voice) => voice.lowResource).map((voice) => <option key={voice.id} value={voice.id}>{voice.name}</option>)}</select></label>}</div><div className="settings-field"><label>Voice profile<select value={voiceSettings.profileId} onChange={(event) => updateVoice("profileId", event.target.value)}>{voiceProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label><span className="settings-help">{activeVoiceRuntime ? `Profiles adjust pacing for ${activeVoiceRuntime.name}; voice characteristics depend on that runtime.` : "Profiles adjust pacing for the runtime selected above."}</span><div className="settings-inline-action"><span>Preview the selected voice.</span><Button variant="secondary" disabled={!activeVoiceRuntime} onClick={() => void speakNativeResponse("Skai voice preview. Your voice settings are working.", true)}>Preview</Button><Button variant="ghost" onClick={stopNativeSpeech}>Stop</Button></div></div><div className="settings-field"><label htmlFor="voice-expressiveness">Expressiveness <span>{voiceSettings.expressiveness}%</span></label><input id="voice-expressiveness" type="range" min="0" max="100" step="5" value={voiceSettings.expressiveness} onChange={(event) => updateVoice("expressiveness", Number(event.target.value))} /><span className="settings-help">Adjusts spoken reply wording for any chat model and sampling or vocal variation where your local speech runtime supports it. Speech characteristics depend on the model.</span></div>{activeVoiceRuntime?.id === "qwen3-tts" && <div className="settings-field"><label>Qwen3-TTS preset speaker<select value={voiceSettings.qwenSpeaker} onChange={(event) => updateVoice("qwenSpeaker", event.target.value)}><option value="Ryan">Ryan · English male</option><option value="Aiden">Aiden · American English male</option><option value="Vivian">Vivian · Chinese female</option><option value="Serena">Serena · Chinese female</option><option value="Uncle_Fu">Uncle Fu · Chinese male</option><option value="Dylan">Dylan · Beijing Mandarin male</option><option value="Eric">Eric · Sichuan Mandarin male</option><option value="Ono_Anna">Ono Anna · Japanese female</option><option value="Sohee">Sohee · Korean female</option></select></label><span className="settings-help">This Qwen adapter uses preset speakers. Custom voice cloning is not included.</span></div>}<Toggle label="Speak completed replies" detail="Voice output stays off until you turn it on." checked={voiceSettings.voiceOutputEnabled} onChange={(value) => updateVoice("voiceOutputEnabled", value)} />{installedVoiceModels.some((voice) => voice.lowResource && voice.id !== voiceSettings.primaryModelId) && <Toggle label="Use low-resource mode" detail="Prefer the smaller CPU-first voice runtime." checked={voiceSettings.lowResourceMode} onChange={(value) => updateVoice("lowResourceMode", value)} />}</>}

        {activeCategory === "Image Generation" && <><div className="settings-field"><label>ComfyUI endpoint<input value={props.imageEndpoint} onChange={(event) => props.onImageChange("endpoint", event.target.value)} placeholder="http://127.0.0.1:8188" /></label><label>Image workflow JSON<textarea value={props.imageWorkflow} onChange={(event) => props.onImageChange("workflow", event.target.value)} placeholder="Paste a ComfyUI API workflow with {{prompt}}" rows={5} /></label><label>3D workflow JSON<textarea value={props.threeDWorkflow} onChange={(event) => props.onImageChange("threeDWorkflow", event.target.value)} placeholder="Paste a ComfyUI API workflow that saves a GLB and accepts {{prompt}}" rows={7} /></label></div>{props.onImportWorkflow && <Button variant="secondary" type="button" disabled={importingThreeDWorkflow} onClick={() => void importThreeDWorkflow()}>{importingThreeDWorkflow ? "Importing…" : "Import 3D workflow JSON"}</Button>}{threeDWorkflowImportMessage && <p className="settings-help" role="status">{threeDWorkflowImportMessage}</p>}<p className="settings-help">Save a separate ComfyUI API workflow for image generation and 3D GLB generation. The coding agent uses only the 3D workflow for generated assets; it validates and saves returned GLBs in the selected project.</p></>}

        {activeCategory === "Agents" && <><div className="settings-field"><label>Subagent model<select value={subagentChoice} onChange={(event) => { const value = event.target.value; setSubagentChoice(value); const selected = props.models.find((entry) => `${entry.provider ?? "Local API"}::${entry.model}` === value); setSubagentSizeBytes(selected?.sizeBytes ?? null); setSubagentContextLength(selected?.contextLength ?? null); }}><option value="">Use the main coding model</option>{subagentChoice && !props.models.some((entry) => `${entry.provider ?? "Local API"}::${entry.model}` === subagentChoice) && <option value={subagentChoice}>{subagentChoice.replace("::", " · ")} · not currently discovered</option>}{props.models.map((entry) => <option key={`${entry.provider ?? "Local API"}::${entry.model}`} value={`${entry.provider ?? "Local API"}::${entry.model}`}>{entry.displayName || entry.model} · {entry.provider ?? "Local API"}</option>)}</select><input aria-label="Custom subagent model ID" value={subagentChoice.includes("::") ? subagentChoice.slice(subagentChoice.indexOf("::") + 2) : ""} onChange={(event) => { setSubagentChoice(event.target.value.trim() ? `${props.provider}::${event.target.value.trim()}` : ""); setSubagentSizeBytes(null); setSubagentContextLength(null); }} placeholder="Or enter a runtime model ID" /></label><span className="settings-help">The main coding model stays assigned to the manager. Select an installed model or enter its exact provider model ID here. Bonsai 2 9B belongs in this field; save settings after choosing it.</span></div><Toggle label="Developer mode" detail="Show extra diagnostics and development controls." checked={props.developerMode} onChange={(value) => change("developerMode", value)} /><Toggle label="Use saved memory in prompts" detail="Inject enabled memory entries into local conversations." checked={props.memoryInjectionEnabled} onChange={(value) => change("memoryInjectionEnabled", value)} /><Toggle label="Rewrite typed prompts before sending" detail="Use the selected local model to improve a draft. Skai shows an editable preview; choose the rewrite, the original, or cancel before anything is sent." checked={props.smartPromptRewritingEnabled} onChange={(value) => change("smartPromptRewritingEnabled", value)} /><div className="settings-callout"><strong>Review stays in your hands</strong><span>Prompt rewriting uses the active local model and never replaces or sends your draft without your choice.</span></div><div className="settings-callout"><strong>Safe by default</strong><span>Agent tasks are proposed before they run, and the selected environment is shown before execution.</span></div></>}

        {activeCategory === "Integrations" && <><Integration title="GitHub project workflow" detail="Available from the Coding workspace through your local GitHub CLI session. Skai does not collect a separate token here." status="Available" /><Integration title="Local services" detail="Ollama, LM Studio, AirLLM, OS speech, and ComfyUI use local endpoints." status={localRoute ? "Available" : "Needs setup"} /></>}

        {activeCategory === "Privacy & Security" && <><div className="settings-callout"><strong>Local route in use</strong><span>Prompts, attachments, memory, voice, and image requests stay on this computer.</span></div><p className="settings-help">GitHub is used only for explicit project workflows. Local model and media endpoints are restricted to loopback addresses.</p><Toggle label="Use saved memory in prompts" detail="This is also available in Agents so the setting is easy to find." checked={props.memoryInjectionEnabled} onChange={(value) => change("memoryInjectionEnabled", value)} /><PermissionCenter /></>}

        {activeCategory === "Storage" && <WorkspaceBackupManager />}

        {activeCategory === "Achievements" && <AchievementsPanel achievements={achievements} />}

        {activeCategory === "Updates" && <><div className="settings-callout"><strong>Automatic updates</strong><span>Skai checks the official stable channel at startup and every six hours. Available updates download in the background and are verified by the updater before you choose when to restart.</span></div><Toggle label="Check for and download updates automatically" detail="Turn this off to stop background checks and downloads. Manual checks remain available below." checked={updateChecksEnabled} onChange={(enabled) => { setUpdateChecksEnabled(enabled); void window.skaiAgent?.updates?.setEnabled(enabled); }} /><div className="settings-provider-list"><div className="settings-provider-row"><span><strong>Installed version</strong><small>{updateState?.currentVersion ?? "Checking…"}</small></span><StatusBadge tone="neutral">Skai Desktop</StatusBadge></div><div className="settings-provider-row"><span><strong>Update status</strong><small>{updateState?.error ?? updateState?.message ?? "Checking the stable release channel…"}{updateState?.status === "downloading" && ` (${updateState.percent ?? 0}%)`}</small></span><StatusBadge tone={updateState?.status === "error" ? "warning" : updateState?.status === "downloaded" ? "success" : "neutral"}>{updateState?.status === "downloaded" ? "Ready to restart" : updateState?.status === "downloading" ? "Downloading" : updateState?.status === "available" ? "Available" : updateState?.status === "error" ? "Needs attention" : updateState?.status === "current" ? "Up to date" : "Checking"}</StatusBadge></div>{updateState?.rollbackAvailable && <div className="settings-provider-row"><span><strong>Previous version</strong><small>Skai kept version {updateState.rollbackVersion} so you can restore it if this update causes problems.</small></span><StatusBadge tone="success">Recovery ready</StatusBadge></div>}</div><div className="settings-model-actions"><Button variant="secondary" disabled={checkingUpdates} onClick={() => void checkUpdates()}>{checkingUpdates ? "Checking…" : updateState?.status === "error" ? "Retry update" : "Check for updates"}</Button>{updateState?.status === "downloading" && <Button variant="ghost" onClick={() => void window.skaiAgent?.updates?.cancelDownload()}>Cancel download</Button>}{updateState?.status === "downloaded" && <Button variant="primary" onClick={() => void window.skaiAgent?.updates?.install()}>Restart to update</Button>}{updateState?.rollbackAvailable && <Button variant="ghost" onClick={() => void window.skaiAgent?.updates?.rollback()}>Revert to {updateState.rollbackVersion}</Button>}</div><p className="settings-help">Updates are supported for packaged Windows x64 and Linux x64 builds. Downloaded updates are verified before staging; Skai never restarts without your confirmation. Linux AppImage updates keep one previous version for recovery.</p></>}

        {activeCategory === "Advanced" && <><Toggle label="Developer mode" detail="Show extra diagnostics and development controls." checked={props.developerMode} onChange={(value) => change("developerMode", value)} /><Toggle label="Reduced motion" detail="Also controls pet wandering defaults and decorative movement." checked={props.reduceMotion} onChange={(value) => change("reduceMotion", value)} /><p className="settings-help">Provider routing remains local-only. Diagnostics and motion settings apply across the workspace.</p></>}

        {activeCategory === "Models & Providers" && contextMismatch && <div className="settings-callout settings-callout-warning" role="alert"><strong>Selected context exceeds this model</strong><span>{props.model} advertises a {selectedOllamaModel?.contextLength?.toLocaleString()}-token context, but this setting requests {props.ollamaContextWindowTokens.toLocaleString()} tokens. Choose a smaller window or a compatible model before sending.</span></div>}
        </div>
        <div className="settings-footer"><span className={`settings-save-status settings-save-${saveState}`} role="status">{saveState === "saving" ? "Saving changes…" : saveState === "saved" ? "Saved locally" : "Changes apply across the workspace."}</span><Button variant="primary" disabled={saveState === "saving"} onClick={() => void save()}>{saveState === "saving" ? "Saving…" : "Save settings"}</Button></div>
      </main>
    </div>
  </div>;
}

function categoryDescription(category: Category) {
  const descriptions: Record<Category, string> = { General: "Choose the local runtime, default model, and preferred model for each kind of work.", Appearance: "Tune the visual environment without changing companion settings.", Pet: "Choose, show, and personalize your desktop pets.", "Models & Providers": "Choose a model runtime already running on this computer.", "Voice & Audio": "Choose local speech behavior and preview it safely.", "Image Generation": "Configure the local image workflow used by the Images workspace.", Agents: "Control task planning, prompt rewriting, diagnostics, and memory injection.", Integrations: "Review the local services and project integrations currently connected.", "Privacy & Security": "Review access grants, sandbox boundaries, and permission history.", Storage: "Back up local workspace data without destructive shortcuts.", Achievements: "A private collection of the little secrets you have found in Skai.", Updates: "See the release channel and update delivery status.", Advanced: "Review controls that affect diagnostics and motion." };
  return descriptions[category];
}

function AchievementsPanel({ achievements }: { achievements: SkaiAchievement[] }) {
  if (achievements.length === 0) return <div className="settings-achievements-empty"><span aria-hidden="true">{"\u2726"}</span><h2>No achievements unlocked yet</h2><p>Keep exploring Skai. Hidden discoveries will appear here once you find them.</p></div>;
  return <div className="settings-achievements-grid" aria-label="Unlocked achievements">{achievements.map((achievement) => <article className="settings-achievement-card" key={achievement.id}><span className="settings-achievement-icon" aria-hidden="true">{achievement.icon}</span><div><p className="section-kicker">UNLOCKED</p><h2>{achievement.title}</h2><p>{achievement.description}</p><small>{new Date(achievement.unlockedAt).toLocaleDateString()}</small></div></article>)}</div>;
}

// Linux only: what closing the main window does (see electron/main.cjs). Saved immediately in the shell.
type UserProfile = { name: string; gender: string; age: string };

type PreferredModelSlot = "chat" | "coding" | "rewrite" | "vision";
type PreferredModelChoice = { model: string; provider: string; endpoint?: string | null };
type PreferredModelMap = Partial<Record<PreferredModelSlot, PreferredModelChoice>>;
const PREFERRED_MODELS_KEY = "skai.preferredModels.v1";

function readPreferredModels(): PreferredModelMap {
  try {
    const stored = JSON.parse(localStorage.getItem(PREFERRED_MODELS_KEY) ?? "{}");
    if (!stored || typeof stored !== "object") return {};
    return stored as PreferredModelMap;
  } catch { return {}; }
}

function modelChoiceKey(model: Model) { return `${model.provider ?? "Local API"}::${model.model}`; }

function PreferredModelsSetting({ props, change }: { props: SettingsProps; change: (key: string, value: string | boolean) => void }) {
  const [preferred, setPreferred] = useState<PreferredModelMap>(readPreferredModels);
  const [codingModelId, setCodingModelId] = useState(() => readPreferredModels().coding?.model ?? "");
  const [codingModelStatus, setCodingModelStatus] = useState("");
  const [voiceSettings, setVoiceSettings] = useState(selectedVoiceSettings);
  const modelOptions = useMemo(() => {
    const options = [...props.models];
    if (props.model && !options.some((model) => model.model === props.model && (model.provider ?? "") === props.provider)) options.unshift({ model: props.model, displayName: props.model, provider: props.provider, endpoint: props.endpoint, vision: "unknown", capabilities: [] });
    return options;
  }, [props.endpoint, props.model, props.models, props.provider]);
  useEffect(() => {
    let active = true;
    void window.skaiAgent?.request("settings.get").then((response) => {
      if (!active || !response?.ok) return;
      const settings = response.result as { codingModel?: string };
      if (settings.codingModel) setCodingModelId(settings.codingModel);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  const savePreferred = (slot: PreferredModelSlot, key: string) => {
    const selected = modelOptions.find((model) => modelChoiceKey(model) === key);
    const next = { ...preferred };
    if (!selected) delete next[slot];
    else next[slot] = { model: selected.model, provider: selected.provider ?? "Local API", endpoint: selected.endpoint };
    setPreferred(next);
    localStorage.setItem(PREFERRED_MODELS_KEY, JSON.stringify(next));
    if (slot === "chat" && selected) {
      change("model", selected.model);
      change("provider", selected.provider ?? "Local API");
      if (selected.endpoint) change("endpoint", selected.endpoint);
    }
    if (slot === "coding") {
      setCodingModelId(selected?.model ?? "");
      setCodingModelStatus("Saving coding model…");
      void window.skaiAgent?.request("settings.save", {
        provider: props.provider,
        endpoint: props.endpoint,
        model: props.model,
        codingModel: selected?.model ?? "",
        codingModelProvider: selected?.provider ?? "",
        codingModelSizeBytes: selected?.sizeBytes ?? null,
        codingModelContextLength: selected?.contextLength ?? null,
      }).then((response) => setCodingModelStatus(response?.ok ? "Coding model saved." : response?.error?.message ?? "Coding model could not be saved."))
        .catch(() => setCodingModelStatus("Coding model could not be saved."));
    }
  };
  const selectedKey = (slot: PreferredModelSlot) => {
    const value = preferred[slot];
    return value ? `${value.provider}::${value.model}` : slot === "chat" ? `${props.provider}::${props.model}` : "";
  };
  const saveCustomCodingModel = async () => {
    const modelId = codingModelId.trim();
    const selected = modelOptions.find((model) => model.model === modelId && (model.provider ?? "") === props.provider);
    const next = { ...preferred };
    if (modelId) next.coding = { model: modelId, provider: selected?.provider ?? props.provider, endpoint: selected?.endpoint ?? props.endpoint };
    else delete next.coding;
    setPreferred(next);
    localStorage.setItem(PREFERRED_MODELS_KEY, JSON.stringify(next));
    setCodingModelStatus("Saving coding model…");
    try {
      const response = await window.skaiAgent?.request("settings.save", {
        provider: props.provider,
        endpoint: props.endpoint,
        model: props.model,
        codingModel: modelId,
        codingModelProvider: selected?.provider ?? props.provider,
        codingModelSizeBytes: selected?.sizeBytes ?? null,
        codingModelContextLength: selected?.contextLength ?? null,
      });
      setCodingModelStatus(response?.ok ? "Coding model saved." : response?.error?.message ?? "Coding model could not be saved.");
    } catch { setCodingModelStatus("Coding model could not be saved."); }
  };
  return <section className="settings-preferred-models" aria-labelledby="preferred-models-heading">
    <div className="settings-subsection-heading"><div><p className="section-kicker">PREFERRED MODELS</p><h3 id="preferred-models-heading">Choose a model for each job</h3><p>These assignments stay on this computer. Chat uses its assignment now; coding, rewriting, and vision assignments are saved for task-specific routing.</p></div><StatusBadge tone={modelOptions.length ? "success" : "warning"}>{modelOptions.length ? `${modelOptions.length} models available` : "Discover models first"}</StatusBadge></div>
    <div className="settings-field settings-preferred-model-grid">
      {([["chat", "Chat and reasoning", "The default model for everyday conversations."], ["coding", "Coding agent", "Use when working in a project or reviewing code."], ["rewrite", "Prompt rewriting", "Use for the optional rewrite preview before sending."], ["vision", "Image understanding", "Use when an image-capable model is needed."]] as const).map(([slot, label, detail]) => <label key={slot}>{label}<select value={selectedKey(slot)} onChange={(event) => savePreferred(slot, event.target.value)} disabled={!modelOptions.length}><option value="">Use the current chat model</option>{modelOptions.map((model) => <option value={modelChoiceKey(model)} key={modelChoiceKey(model)}>{model.displayName || model.model} · {model.provider ?? "Local API"}</option>)}</select><small className="settings-help">{detail}</small></label>)}
      <label>Voice runtime<select value={voiceSettings.primaryModelId} onChange={(event) => { saveVoiceSetting("primaryModelId", event.target.value); setVoiceSettings(selectedVoiceSettings()); }}><option value="">Use the installed default</option>{installedVoiceModels.map((voice) => <option key={voice.id} value={voice.id}>{voice.name} · {voice.detail}</option>)}</select><small className="settings-help">Voice engines are managed locally; browse Marketplace to see available voice adapters.</small></label>
    </div>
    <div className="settings-field"><label>Main coding model ID<input value={codingModelId} onChange={(event) => setCodingModelId(event.target.value)} placeholder="Select an installed model above or enter its exact runtime ID" /></label><Button type="button" variant="secondary" onClick={() => void saveCustomCodingModel()}>Save main coding model</Button><small className="settings-help">This model runs the coding manager. The selected provider must expose this exact model ID; if it is installed later, the saved role becomes active without changing subagent routing.</small></div>
    {codingModelStatus && <p className="settings-help" role="status">{codingModelStatus}</p>}
  </section>;
}

/** Optional details the user shares with every chat and persona, so the AI knows who it's talking to. */
function AboutYouSetting() {
  const bridge = window.skaiAgent as typeof window.skaiAgent | undefined;
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!bridge) return;
    void bridge.request("profile.get").then((response: AgentResponse) => {
      const result = response.ok ? response.result as { name?: string; gender?: string; age?: number | null } : {};
      setProfile({ name: result.name ?? "", gender: result.gender ?? "", age: result.age ? String(result.age) : "" });
    });
  }, [bridge]);
  if (!bridge || !profile) return null;
  const update = (key: keyof UserProfile) => (event: ChangeEvent<HTMLInputElement>) => { setProfile({ ...profile, [key]: event.target.value }); setStatus(null); };
  const ageValue = profile.age.trim();
  const ageInvalid = ageValue !== "" && !(/^\d{1,3}$/.test(ageValue) && Number(ageValue) >= 1 && Number(ageValue) <= 120);
  const save = async () => {
    if (ageInvalid) return;
    setSaving(true);
    const response = await bridge.request("profile.save", { name: profile.name.trim(), gender: profile.gender.trim(), age: ageValue ? Number(ageValue) : 0 });
    setSaving(false);
    setStatus(response.ok ? "Saved. Chats and personas will use these details." : response.error?.message ?? "Could not save your details.");
  };
  return <section className="settings-about-you" aria-labelledby="settings-about-you-heading">
    <h3 id="settings-about-you-heading">About you</h3>
    <p className="settings-about-you-note">Optional. Tell Skai and your personas who you are, so they can call you by name instead of “user”. Leave any field blank to keep it private. Stored only on this computer.</p>
    <div className="settings-about-you-fields">
      <label className="settings-field">Name<input value={profile.name} maxLength={60} autoComplete="given-name" placeholder="What should the AI call you?" onChange={update("name")} /></label>
      <label className="settings-field">Gender<input value={profile.gender} maxLength={40} placeholder="Optional" onChange={update("gender")} /></label>
      <label className="settings-field">Age<input value={profile.age} inputMode="numeric" maxLength={3} placeholder="Optional" aria-invalid={ageInvalid} onChange={update("age")} /></label>
    </div>
    {ageInvalid && <p className="settings-about-you-error" role="alert">Enter an age from 1 to 120, or leave it blank.</p>}
    <div className="settings-about-you-actions"><Button variant="secondary" disabled={saving || ageInvalid} onClick={() => void save()}>{saving ? "Saving…" : "Save details"}</Button>{status && <span role="status">{status}</span>}</div>
  </section>;
}

function CloseBehaviorSetting() {
  const bridge = window.skaiAgent?.window;
  const [behavior, setBehavior] = useState<CloseBehavior | null>(null);
  useEffect(() => { if (bridge?.platform === "linux") void bridge.getCloseBehavior().then(setBehavior); }, [bridge]);
  if (!bridge || bridge.platform !== "linux" || behavior === null) return null;
  const update = (event: ChangeEvent<HTMLSelectElement>) => { void bridge.setCloseBehavior(event.target.value as CloseBehavior).then(setBehavior); };
  return <div className="settings-field settings-field-single"><label>When you close the window<select value={behavior} onChange={update}><option value="ask">Ask every time</option><option value="background">Run in background</option><option value="quit">Fully close</option></select><small className="settings-help">Applies to window-manager close shortcuts such as Super+C. Quit any time from the tray menu.</small></label></div>;
}

function Toggle({ label, detail, checked, onChange, disabled = false }: { label: string; detail: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <label className={`settings-toggle${disabled ? " is-disabled" : ""}`}><span><strong>{label}</strong><small>{detail}</small></span><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /></label>;
}

function PetSettings({ props, change }: { props: SettingsProps; change: (key: string, value: string | boolean) => void }) {
  const [character, setCharacter] = useState(props.petCharacter);
  const [profiles, setProfiles] = useState<PetSpriteProfile[]>([]);
  const [workshopEnabled, setWorkshopEnabled] = useState(() => localStorage.getItem("skai.pet.workshop.enabled") === "true");
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
        const strip = await validatePetStrip(new File([legacyBlob], `legacy.${legacyBlob.type === "image/webp" ? "webp" : "png"}`, { type: legacyBlob.type }), true);
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
  const setWorkshop = (enabled: boolean) => { setWorkshopEnabled(enabled); localStorage.setItem("skai.pet.workshop.enabled", String(enabled)); window.dispatchEvent(new Event("skai:pet-workshop-setting")); };
  return <>
    <div className="settings-callout"><strong>Desktop pets</strong><span>Pets appear in a separate transparent, always-on-top window. Choose which pet appears below; visibility controls all pets together.</span></div>
    <Toggle label="Show all pets" detail="Show or hide desktop pets together above your other windows." checked={props.petVisible} onChange={(value) => change("petVisible", value)} />
    <Toggle label="Let the active pet walk around" detail="Allow gentle ambient movement while the selected pet is idle. Dragging always pauses movement." checked={props.petWander} onChange={(value) => change("petWander", value)} />
    <Toggle label="Show Pet Workshop" detail="Add Pet Workshop to Extras (Quick Actions) for sprite drawing and companion behavior." checked={workshopEnabled} onChange={setWorkshop} />
    {workshopEnabled && <div className="settings-field"><Button variant="secondary" onClick={() => props.onNavigate("pet-workshop")}>Open Pet Workshop</Button></div>}
    <Toggle label="DEMO - More Interaction" detail={window.skaiAgent?.pet?.interactionDemoAvailable ? "Occasionally perch on visible window tops and walk along the taskbar edge. Dragging pauses movement." : "Extra surface interactions are unavailable on this platform. Regular walking still works."} checked={props.petInteractionDemo} disabled={!window.skaiAgent?.pet?.interactionDemoAvailable || !props.petWander} onChange={(value) => change("petInteractionDemo", value)} />
    <div className="settings-field"><label>Companion<select value={character} onChange={(event) => chooseCharacter(event.target.value)}><option value="percy">Percy · Skai wolf</option><option value="byte">Byte · neon bot</option><option value="ember">Ember · fire dragon</option><option value="blaze">Blaze · fire companion</option><option value="nova">Nova · star cat</option><option value="rocky">Rocky · pocket rock</option><option value="sprout">Sprout · tiny plant</option>{profiles.map((profile) => <option key={profile.id} value={`custom:${profile.id}`}>{profile.name} · custom</option>)}</select></label><div className="pet-settings-preview"><img src={activeProfile?.strips.idle?.dataUrl || builtInPetPreviews[character] || builtInPetPreviews.percy} alt="" /><span>{activeProfile ? `${activeProfile.name} · custom profile` : character === "blaze" ? "All attack behaviors enabled" : "Built-in sprite set"}</span></div></div>
    {activeProfile && <div className="settings-callout"><strong>{activeProfile.name}</strong><span>Use Pet Workshop to draw 11-frame animation strips and customize this companion’s behavior. Legacy six- and ten-frame artwork remains stored until replaced.</span></div>}
    {profileError && <p className="form-error" role="alert">{profileError}</p>}
  </>;
}

function Integration({ title, detail, status }: { title: string; detail: string; status: "Available" | "Needs setup" | "Planned" }) {
  return <div className="settings-provider-row"><span><strong>{title}</strong><small>{detail}</small></span><StatusBadge tone={status === "Available" ? "success" : status === "Needs setup" ? "warning" : "neutral"}>{status}</StatusBadge></div>;
}
