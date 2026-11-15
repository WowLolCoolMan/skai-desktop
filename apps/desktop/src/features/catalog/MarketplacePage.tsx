import { useEffect, useMemo, useState } from "react";
import type { Model, Route } from "../../app/types";
import type { AgentResponse } from "../../../shared/contracts";
import { Button, EmptyState, StatusBadge } from "../../components/ui/Primitives";
import { NavIcon, type NavIconName } from "../../components/ui/NavIcon";
import { installedVoiceModels, saveVoiceSetting, selectedVoiceSettings, speakNativeResponse, stopNativeSpeech, voiceProfiles } from "../../services/nativeTts";

export type MarketplaceSection = Section;
type Section = "Discover" | "Models" | "Image models" | "Voices" | "Image workflows" | "Skills" | "Tools" | "Installed" | "Updates";
type Filter = "All" | "Local models" | "Voices" | "Image workflows" | "Skills" | "Tools";
type CatalogItem = { id: string; title: string; filter: Filter; description: string; detail: string; icon: NavIconName; status: string; tone: "neutral" | "success" | "warning"; publisher: string; version: string; compatibility: string; nextStep: string; installable: boolean };
type MarketplaceModel = { id: string; repository: string; name?: string; source: string; kind: string; downloads: number; likes: number; uncensored: boolean; tags: string[]; sizeBytes?: number | null; installRoute: string; installable: boolean; requiresAirLlm?: boolean; files?: Array<{ path: string; sizeBytes: number; sha256?: string | null }> };
type MarketplaceCatalog = { providers: Array<{ id: string; name: string; kinds: string[]; remote: boolean }>; voices: Array<{ id: string; name: string; description: string; runtime: string; license: string; size: string; installed: boolean; lowResource: boolean; sourceUrl: string; installable: boolean }>; skills: Array<{ id: string; name: string; description: string; category: string; permissions: string[]; source: string; installed: boolean; enabled: boolean; installable: boolean }>; tools: Array<{ id: string; name: string; description: string; category: string; access: string; builtIn: boolean; status: string; source?: string | null; installable: boolean }> };

const items: CatalogItem[] = [
  { id: "local-models", title: "Local models", filter: "Local models", description: "Search Hugging Face and ModelScope for local GGUF models.", detail: "Remote catalog discovery is separated from inference. Every result shows its provider, provenance, safety label, size when available, and the verified local install route.", icon: "model", status: "Remote discovery", tone: "success", publisher: "Hugging Face · ModelScope", version: "Live catalog", compatibility: "Local runtime required", nextStep: "Search, filter, inspect the source, then start a verified local download.", installable: false },
  { id: "image-workflows", title: "Image workflows", filter: "Image workflows", description: "Reuse reviewed ComfyUI workflows from Image Studio.", detail: "Workflow JSON is kept in the local profile. Marketplace does not download or activate remote image packages.", icon: "image", status: "Local source needed", tone: "warning", publisher: "Local profile", version: "User-managed", compatibility: "ComfyUI API workflow", nextStep: "Open Image Studio and save a workflow for reuse.", installable: false },
  { id: "mcp:rea", title: "REA · Reverse Engineering Agent", filter: "Tools", description: "A local MCP server for reverse engineering software and application behavior.", detail: "REA is published by morluto as the rea-agents npm package. Skai can download the pinned package or launch its MCP server locally over stdio. Tool actions remain subject to Skai's per-tool approval gate.", icon: "terminal", status: "Downloadable MCP", tone: "success", publisher: "morluto · github.com/morluto/rea", version: "rea-agents 6.9.0", compatibility: "Node.js 22.23.4+, 24.22.1+, or 26.12.1+", nextStep: "Download the verified package or start REA in Skai after reviewing the local runtime requirement.", installable: true },
];

function request(method: string, params?: Record<string, unknown>): Promise<AgentResponse> {
  return window.serverRockAgent?.request(method, params) ?? Promise.resolve({ v: 1, id: `marketplace-${method}`, ok: false, error: { code: "BRIDGE_UNAVAILABLE", message: "The Electron agent bridge is unavailable." } });
}

function formatSize(bytes?: number | null) {
  if (!bytes || bytes <= 0) return "Size unavailable";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

function normalizeSource(value: string) {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

// Embedded in the unified Marketplace catalog (PluginsPage) for the hub sections that catalog
// does not cover itself: remote model search/install, Diffusers LoRAs and the local inventory.
const EMBEDDED_SECTIONS: Section[] = ["Models", "Image models", "Installed"];

export function MarketplacePage({ onSelectAirLlmModel, onNavigate, initialSection = "Discover", onBack }: { onSelectAirLlmModel?: (model: Model) => void; onNavigate?: (route: Route) => void; initialSection?: Section; onBack?: () => void }) {
  const [section, setSection] = useState<Section>(initialSection);
  const [filter, setFilter] = useState<Filter>("All");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(items[0].id);
  const [voiceSettings, setVoiceSettings] = useState(selectedVoiceSettings);
  const [catalog, setCatalog] = useState<MarketplaceCatalog | null>(null);
  const [models, setModels] = useState<MarketplaceModel[]>([]);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [uncensored, setUncensored] = useState(false);
  const [provider, setProvider] = useState("All providers");
  const [size, setSize] = useState("Any size");
  const [installing, setInstalling] = useState<string | null>(null);
  const [installStatus, setInstallStatus] = useState<string | null>(null);
  const [reviewModel, setReviewModel] = useState<MarketplaceModel | null>(null);
  const [installedModels, setInstalledModels] = useState<Array<{ model: string; vision: string; capabilities: string[]; provider?: string }>>([]);
  const [installedLoading, setInstalledLoading] = useState(false);
  const [installedError, setInstalledError] = useState<string | null>(null);
  const [selectedRemoteModelId, setSelectedRemoteModelId] = useState<string | null>(null);
  const [mcpMarketplaceBusy, setMcpMarketplaceBusy] = useState(false);
  const [mcpMarketplaceStatus, setMcpMarketplaceStatus] = useState<string | null>(null);
  const [imageAssets, setImageAssets] = useState<Array<{ repository: string; downloads: number; files: Array<{ path: string; sizeBytes: number }> }>>([]);
  const [installedImageAssets, setInstalledImageAssets] = useState<Array<{ id: string; repository: string; sizeBytes: number }>>([]);
  const [imageAssetsLoading, setImageAssetsLoading] = useState(false);
  const [imageAssetStatus, setImageAssetStatus] = useState<string | null>(null);
  const [airLlmReady, setAirLlmReady] = useState<boolean | null>(null);

  const useAirLlmModel = (model: MarketplaceModel) => {
    if (!model.requiresAirLlm || !onSelectAirLlmModel) return;
    onSelectAirLlmModel({ model: model.repository, displayName: model.repository, vision: "unsupported", capabilities: ["Text generation"], provider: "AirLLM", endpoint: null, sizeBytes: model.sizeBytes });
  };

  useEffect(() => {
    void request("marketplace.catalog").then((response) => {
      if (response.ok) setCatalog(response.result as MarketplaceCatalog);
      else setModelError(response.error?.message ?? "Marketplace catalog could not be loaded.");
    });
    void request("airllm.status").then((response) => {
      if (response.ok) setAirLlmReady(Boolean((response.result as { dependenciesAvailable?: boolean }).dependenciesAvailable));
      else setAirLlmReady(false);
    }).catch(() => setAirLlmReady(false));
    void searchModels("");
  }, []);

  const marketplaceItems = useMemo<CatalogItem[]>(() => {
    const voiceItems: CatalogItem[] = (catalog?.voices ?? []).map((voice) => ({
      id: `voice:${voice.id}`, title: voice.name, filter: "Voices", description: voice.description,
      detail: `${voice.description} Runtime: ${voice.runtime}. License: ${voice.license}. ${voice.size}.`,
      icon: "activity", status: voice.installed ? "Available locally" : "Not installed", tone: voice.installed ? "success" : "neutral",
      publisher: voice.runtime, version: voice.size, compatibility: voice.license,
      nextStep: voice.installed ? "Select this voice in the voice controls and preview it." : voice.installable ? `Review the source before installing from ${voice.sourceUrl}.` : "No verified local installer is connected for this voice.", installable: false,
    }));
    const skillItems: CatalogItem[] = (catalog?.skills ?? []).map((skill) => ({
      id: `skill:${skill.id}`, title: skill.name, filter: "Skills", description: skill.description,
      detail: `${skill.description} Permission scope: ${skill.permissions.join(", ") || "No extra permissions"}.`,
      icon: "sparkle", status: skill.enabled ? "Enabled" : skill.installed ? "Installed" : "Catalog entry",
      tone: skill.enabled ? "success" : "neutral", publisher: skill.source, version: skill.installed ? "Available locally" : "Catalog entry",
      compatibility: skill.permissions.join(", ") || "No extra permissions",
      nextStep: skill.enabled ? "This skill is available to the local agent." : skill.installable ? "Review the publisher and permission scope before installing." : "This catalog entry is not currently installable.", installable: false,
    }));
    const toolItems: CatalogItem[] = (catalog?.tools ?? []).map((tool) => ({
      id: `tool:${tool.id}`, title: tool.name, filter: "Tools", description: tool.description,
      detail: `${tool.description} Access: ${tool.access}.`, icon: "terminal",
      status: tool.builtIn ? "Built in" : tool.status, tone: tool.builtIn ? "success" : "warning",
      publisher: tool.source || "Local capability catalog", version: tool.builtIn ? "Available locally" : "Not connected",
      compatibility: tool.access,
      nextStep: tool.builtIn ? "Open the listed local workflow to use this capability." : "Connect and review a compatible local integration before use.", installable: false,
    }));
    return [...items, ...voiceItems, ...skillItems, ...toolItems];
  }, [catalog]);

  const loadInstalledModels = async () => {
    setInstalledLoading(true);
    setInstalledError(null);
    const endpoint = localStorage.getItem("skai.endpoint") ?? "http://localhost:11434/v1";
    const provider = localStorage.getItem("skai.provider") ?? "Ollama";
    try {
      const response = await request("models.list", { endpoint, provider });
      if (!response.ok) {
        setInstalledError(response.error?.message ?? "The local model inventory could not be loaded.");
        setInstalledModels([]);
      } else setInstalledModels((response.result as Array<{ model: string; vision: string; capabilities: string[]; provider?: string }>) ?? []);
    } catch { setInstalledError("The local model inventory could not be loaded."); }
    finally { setInstalledLoading(false); }
  };

  useEffect(() => { if (section === "Installed") void loadInstalledModels(); }, [section]);
  const searchImageAssets = async () => {
    setImageAssetsLoading(true); setImageAssetStatus(null);
    const response = await request("marketplace.image-assets.search", { query });
    if (response.ok) setImageAssets((response.result as typeof imageAssets) ?? []);
    else setImageAssetStatus(response.error?.message ?? "Image asset search failed.");
    const inventory = await request("marketplace.image-assets.list");
    if (inventory.ok) setInstalledImageAssets((inventory.result as typeof installedImageAssets) ?? []);
    setImageAssetsLoading(false);
  };
  const installImageAsset = async (repository: string, file: string) => {
    setImageAssetStatus(`Downloading ${file}…`);
    const response = await request("marketplace.image-assets.install", { repository, file });
    if (!response.ok) { setImageAssetStatus(response.error?.message ?? "LoRA download failed."); return; }
    const inventory = await request("marketplace.image-assets.list");
    if (inventory.ok) setInstalledImageAssets((inventory.result as typeof installedImageAssets) ?? []);
    setImageAssetStatus(`${file} installed locally. Restart image generation to load it.`);
  };
  const removeImageAsset = async (id: string) => {
    const response = await request("marketplace.image-assets.remove", { id });
    if (!response.ok) { setImageAssetStatus(response.error?.message ?? "LoRA removal failed."); return; }
    setInstalledImageAssets((current) => current.filter((asset) => asset.id !== id));
    setImageAssetStatus(`${id} removed from this PC.`);
  };

  const sectionCategory: Partial<Record<Section, Filter>> = { Models: "Local models", Voices: "Voices", "Image workflows": "Image workflows", Skills: "Skills", Tools: "Tools" };
  const visible = useMemo(() => marketplaceItems.filter((item) => {
    const category = sectionCategory[section];
    const filterMatch = filter === "All" || item.filter === filter;
    return (!category || item.filter === category) && filterMatch && `${item.title} ${item.description} ${item.detail} ${item.publisher}`.toLowerCase().includes(query.trim().toLowerCase());
  }), [filter, marketplaceItems, query, section]);
  const selected = visible.find((item) => item.id === selectedId) ?? visible[0] ?? null;
  // Live provider search gets the full width under Models; Discover stays a capability overview.
  const showModels = section === "Models";
  const filteredModels = useMemo(() => models.filter((model) => {
    const matchesProvider = provider === "All providers" || (provider === "AirLLM" ? model.requiresAirLlm === true : model.source === provider && !model.requiresAirLlm);
    const sizeLimit = size === "Any size" ? Number.POSITIVE_INFINITY : Number(size);
    const matchesSize = size === "Any size" || (model.sizeBytes != null && model.sizeBytes <= sizeLimit * 1024 ** 3);
    return matchesProvider && matchesSize;
  }), [models, provider, size]);
  const selectedRemoteModel = filteredModels.find((model) => model.id === selectedRemoteModelId) ?? filteredModels[0] ?? null;

  async function searchModels(nextQuery = query, nextUncensored = uncensored) {
    setModelLoading(true);
    setModelError(null);
    const response = await request("marketplace.models.search", { query: nextQuery.trim(), uncensored: nextUncensored });
    setModelLoading(false);
    if (!response.ok) {
      setModelError(response.error?.message ?? "Remote model discovery failed.");
      return;
    }
    const result = response.result as { models?: MarketplaceModel[] };
    setModels(result.models ?? []);
  }

  async function installModel(model: MarketplaceModel) {
    const endpoint = localStorage.getItem("skai.endpoint") ?? "http://localhost:11434/v1";
    const source = normalizeSource(model.source);
    setInstalling(model.id);
    setInstallStatus("Starting verified local download…");
    const started = await request("marketplace.models.install.start", { source, repository: model.repository, name: model.name, endpoint, downloads: model.downloads, uncensored: model.uncensored, files: model.files });
    if (!started.ok) {
      setInstallStatus(started.error?.message ?? "The download could not start.");
      setInstalling(null);
      return;
    }
    const operationId = (started.result as { id?: string }).id;
    if (!operationId) {
      setInstallStatus("The host did not return a download operation.");
      setInstalling(null);
      return;
    }
    for (let attempt = 0; attempt < 600; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 750));
      const status = await request("marketplace.models.install.status", { id: operationId });
      if (!status.ok) {
        setInstallStatus(status.error?.message ?? "Download status was unavailable.");
        break;
      }
      const result = status.result as { status: string; progress?: string[]; error?: string };
      setInstallStatus(result.progress?.at(-1) ?? result.status);
      if (result.status === "completed" || result.status === "failed" || result.status === "cancelled") {
        if (result.error) setInstallStatus(result.error);
        break;
      }
    }
    setInstalling(null);
  }

  async function downloadReaPackage() {
    if (mcpMarketplaceBusy) return;
    setMcpMarketplaceBusy(true); setMcpMarketplaceStatus("Downloading pinned REA package and verifying npm SHA-512 integrity…");
    try {
      const response = await request("mcp.marketplace.download", { id: "rea" });
      if (!response.ok) throw new Error(response.error?.message ?? "REA package download failed.");
      const result = response.result as { fileName: string; filePath: string; sha256: string; version: string };
      setMcpMarketplaceStatus(`Downloaded ${result.fileName} · v${result.version} · SHA-256 ${result.sha256} · ${result.filePath}`);
    } catch (error) { setMcpMarketplaceStatus(error instanceof Error ? error.message : "REA package download failed."); }
    finally { setMcpMarketplaceBusy(false); }
  }

  async function connectRea() {
    if (mcpMarketplaceBusy) return;
    setMcpMarketplaceBusy(true); setMcpMarketplaceStatus("Starting REA locally. npm may download the pinned package on first use…");
    try {
      const response = await request("mcp.connection.connect", { serverId: "rea", transport: "stdio", profileId: "rea" });
      if (!response.ok) throw new Error(response.error?.message ?? "REA could not be started.");
      const result = response.result as { tools?: Array<{ toolName: string }> };
      setMcpMarketplaceStatus(`REA is connected locally with ${result.tools?.length ?? 0} tools. Each tool call still requires its configured approval.`);
    } catch (error) { setMcpMarketplaceStatus(error instanceof Error ? error.message : "REA could not be started."); }
    finally { setMcpMarketplaceBusy(false); }
  }

  const updateVoice = (key: "profileId" | "primaryModelId" | "lowResourceModelId" | "lowResourceMode" | "voiceOutputEnabled", value: string | boolean) => { saveVoiceSetting(key, value); setVoiceSettings(selectedVoiceSettings()); };
  const sectionDescription: Record<Section, string> = {
    Discover: "Choose a category to browse the local and reviewed capabilities available in Skai.",
    Models: "Browse quantized local model downloads and full Transformers models through the optional AirLLM route. AirLLM weights download only when first used.",
    "Image models": "Search Hugging Face for safetensors LoRAs compatible with local Diffusers image generation. Downloads stay in Skai’s local image-model folder.",
    Voices: "Choose a local speech profile. Voice output stays off until you enable it.",
    "Image workflows": "Review local ComfyUI workflows and configure them in Image Studio.",
    Skills: "Browse local agent instructions and review their permission scope.",
    Tools: "See built-in capabilities and integrations that can be connected.",
    Installed: "Models reported by the configured local runtime appear here.",
    Updates: "Updates appear here only when a verified local source reports them.",
  };

  const sectionHeading: Record<Section, string> = { Discover: "Explore the marketplace", Models: "Local models", "Image models": "Image models & LoRAs", Voices: "Voice profiles", "Image workflows": "Image workflows", Skills: "Agent skills", Tools: "Tools & integrations", Installed: "Installed models", Updates: "Updates" };
  const categoryCards: Array<{ title: string; description: string; section: Section; icon: NavIconName; count: string }> = [
    { title: "Local models", description: "Browse Hugging Face and ModelScope downloads, plus Transformers models for AirLLM.", section: "Models", icon: "model", count: catalog ? `${catalog.providers.filter((item) => item.remote && item.kinds.includes("llm")).length} sources · AirLLM` : "Loading providers…" },
    { title: "Image models & LoRAs", description: "Search and manage local Diffusers LoRA files.", section: "Image models", icon: "image", count: `${installedImageAssets.length} installed` },
    { title: "Agent skills", description: "Browse reusable instructions with clear permissions.", section: "Skills", icon: "sparkle", count: catalog ? `${catalog.skills.length} skills` : "Loading skills…" },
    { title: "Tools & integrations", description: "Review built-in tools and available connectors.", section: "Tools", icon: "terminal", count: catalog ? `${catalog.tools.length} tools` : "Loading tools…" },
    { title: "Voice profiles", description: "Configure local speech and voice models.", section: "Voices", icon: "activity", count: catalog ? `${catalog.voices.length} profiles` : "Loading profiles…" },
    { title: "Image workflows", description: "Use reviewed workflows with your local ComfyUI setup.", section: "Image workflows", icon: "image", count: "Local workflows" },
  ];
  const modelResults = <section className="marketplace-remote-results" aria-label="Remote model sources">
    <div className="panel-heading"><div><p className="section-kicker">REMOTE MODEL SOURCES</p><h3>Models for local runtimes</h3><p className="panel-subtitle">GGUF packages install through compatible runtimes. Transformers repositories use the optional AirLLM route and download weights on first use.</p></div><StatusBadge tone={modelError ? "warning" : "success"}>{modelLoading ? "Polling" : modelError ? "Partial" : "Live catalog"}</StatusBadge></div>
    <div className="marketplace-model-controls"><label>Provider<select value={provider} onChange={(event) => setProvider(event.target.value)}><option>All providers</option><option>Hugging Face</option><option>ModelScope</option><option>AirLLM</option></select></label><label>Maximum size<select value={size} onChange={(event) => setSize(event.target.value)}><option>Any size</option><option value="8">8 GB</option><option value="14">14 GB</option><option value="24">24 GB</option><option value="40">40 GB</option></select></label><label className="settings-toggle"><span><strong>Include abliterated</strong><small>Only show explicit uncensored/abliterated labels.</small></span><input type="checkbox" checked={uncensored} onChange={(event) => { setUncensored(event.target.checked); void searchModels(query, event.target.checked); }} /></label></div>
    {modelError && <p className="marketplace-honesty" role="status">{modelError}</p>}
    {installStatus && <p className="marketplace-honesty" role="status">{installStatus}</p>}
    {reviewModel && <div className="marketplace-install-review marketplace-model-review" role="dialog" aria-label={reviewModel.requiresAirLlm ? "Review AirLLM model route" : "Verify model installation"}><p className="section-kicker">{reviewModel.requiresAirLlm ? "AIRLLM ROUTE REVIEW" : "INSTALLATION REVIEW"}</p><strong>{reviewModel.repository}</strong><span>{reviewModel.source} · {formatSize(reviewModel.sizeBytes)} · {reviewModel.downloads.toLocaleString()} downloads</span><span>{reviewModel.requiresAirLlm ? `This Transformers model will use the optional AirLLM route. ${airLlmReady === true ? "AirLLM is ready." : airLlmReady === false ? "Install AirLLM in Settings before using this route." : "Checking AirLLM readiness…"} Model weights download from Hugging Face on first use and may require substantial disk space. Inference can be much slower than Ollama or LM Studio.` : `Skai will use the verified ${reviewModel.installRoute} route. No download starts until you confirm this local installation.`}</span><div className="marketplace-model-actions">{reviewModel.requiresAirLlm && onNavigate && <Button variant="secondary" type="button" onClick={() => { setReviewModel(null); onNavigate("settings"); }}>Manage AirLLM</Button>}<Button variant="ghost" type="button" onClick={() => setReviewModel(null)}>Cancel</Button><Button variant="primary" type="button" disabled={reviewModel.requiresAirLlm ? !onSelectAirLlmModel || airLlmReady !== true : !reviewModel.installable || installing !== null} onClick={() => { const model = reviewModel; setReviewModel(null); if (model.requiresAirLlm) useAirLlmModel(model); else void installModel(model); }}>{reviewModel.requiresAirLlm ? "Use with AirLLM" : "Confirm and install locally"}</Button></div></div>}
    {filteredModels.length === 0 ? <EmptyState title={modelLoading ? "Polling providers…" : "No matching models"} description="Change the search or filters. Unknown sizes are hidden only when a maximum size is selected." /> : <div className="marketplace-model-layout"><div className="marketplace-model-list" aria-label="Marketplace model results">{filteredModels.slice(0, 36).map((model) => <button className={`marketplace-model-row${selectedRemoteModel?.id === model.id ? " is-selected" : ""}`} type="button" key={model.id} aria-pressed={selectedRemoteModel?.id === model.id} onClick={() => setSelectedRemoteModelId(model.id)}><span className="marketplace-row-icon"><NavIcon name="model" /></span><span className="marketplace-model-copy"><strong>{model.repository}</strong><small>{model.source} · {formatSize(model.sizeBytes)} · {model.downloads.toLocaleString()} downloads · {model.tags.slice(0, 3).join(" · ") || (model.requiresAirLlm ? "Transformers weights" : "GGUF")}</small></span><span className="marketplace-model-actions">{model.requiresAirLlm && <StatusBadge tone="warning">Requires AirLLM</StatusBadge>}{model.uncensored && <StatusBadge tone="warning">Abliterated</StatusBadge>}</span></button>)}</div>{selectedRemoteModel && <aside className="marketplace-detail marketplace-model-inspector" aria-label="Selected model details"><div className="marketplace-detail-heading"><div><p className="section-kicker">SELECTED MODEL</p><h3>{selectedRemoteModel.repository}</h3></div><StatusBadge tone={selectedRemoteModel.requiresAirLlm ? "warning" : "success"}>{selectedRemoteModel.requiresAirLlm ? "Requires AirLLM" : "Local runtime"}</StatusBadge></div><p>{selectedRemoteModel.requiresAirLlm ? "Full Transformers weights use the optional AirLLM runtime. The model downloads on first use, so check the listed size and available disk space." : "This quantized model uses a local runtime install route. Review the source, size, and destination before downloading."}</p><dl className="marketplace-detail-list"><div><dt>Source</dt><dd>{selectedRemoteModel.source}</dd></div><div><dt>Route</dt><dd>{selectedRemoteModel.requiresAirLlm ? `AirLLM · ${airLlmReady === null ? "checking readiness" : airLlmReady ? "ready" : "setup needed"}` : selectedRemoteModel.installRoute}</dd></div><div><dt>Estimated size</dt><dd>{formatSize(selectedRemoteModel.sizeBytes)}</dd></div><div><dt>Downloads</dt><dd>{selectedRemoteModel.downloads.toLocaleString()}</dd></div><div><dt>Likes</dt><dd>{selectedRemoteModel.likes.toLocaleString()}</dd></div><div><dt>Next step</dt><dd>{selectedRemoteModel.requiresAirLlm ? "Install the optional runtime in Settings, then choose Use with AirLLM. Weights download when chat first starts." : "Review the local installer before confirming the download."}</dd></div></dl><div className="marketplace-model-actions">{selectedRemoteModel.requiresAirLlm && onNavigate && <Button variant="secondary" type="button" onClick={() => onNavigate("settings")}>Manage AirLLM</Button>}<Button variant="primary" type="button" disabled={selectedRemoteModel.requiresAirLlm ? !onSelectAirLlmModel || airLlmReady !== true : !selectedRemoteModel.installable || installing !== null} onClick={() => setReviewModel(selectedRemoteModel)}>{selectedRemoteModel.requiresAirLlm ? "Review AirLLM route" : "Review install"}</Button></div></aside>}</div>}
  </section>;

  const filteredCategories = categoryCards.filter((category) => {
    const categoryItems = marketplaceItems.filter((item) => item.filter === sectionCategory[category.section]);
    const searchable = (category.title + " " + category.description + " " + categoryItems.map((item) => item.title + " " + item.description).join(" ")).toLowerCase();
    return searchable.includes(query.trim().toLowerCase());
  });

  return (
    <div className="feature-page marketplace-page">
      <header className="marketplace-header">
        <div><p className="eyebrow">MARKETPLACE</p><h2>{sectionHeading[section]}</h2><p className="page-description">{sectionDescription[section]}</p></div>
        <div className="marketplace-header-actions">{onBack && <Button variant="ghost" type="button" onClick={onBack}><NavIcon name="chevron-left" />Marketplace</Button>}{section !== "Installed" && <Button variant="ghost" type="button" onClick={() => { setSection("Installed"); setQuery(""); }}>View installed</Button>}</div>
      </header>
      <div className="marketplace-browser">
        <nav className="marketplace-sections" aria-label="Marketplace sections">
          {(onBack ? EMBEDDED_SECTIONS : ["Discover", "Models", "Image models", "Voices", "Image workflows", "Skills", "Tools", "Installed", "Updates"] as Section[]).map((item) => (
            <button key={item} className={section === item ? "is-active" : ""} type="button" aria-current={section === item ? "page" : undefined} onClick={() => { setSection(item); setQuery(""); }}>{item}</button>
          ))}
        </nav>

        {section === "Discover" ? (
          <div className="marketplace-discover">
            <div className="marketplace-search-row"><label className="sr-only" htmlFor="marketplace-search">Search marketplace</label><input id="marketplace-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search categories, skills, tools, and capabilities…" /><span>{filteredCategories.length} categories</span></div>
            {filteredCategories.length === 0 ? <EmptyState title="No matching categories" description="Try a different search term." action={<Button variant="ghost" onClick={() => setQuery("")}>Clear search</Button>} /> : (
              <div className="marketplace-category-grid" aria-label="Marketplace categories">
                {filteredCategories.map((category) => (
                  <button key={category.section} type="button" className="marketplace-category-card" onClick={() => { setSection(category.section); setQuery(""); }}>
                    <span className="marketplace-category-icon"><NavIcon name={category.icon} /></span>
                    <span className="marketplace-category-copy"><strong>{category.title}</strong><small>{category.description}</small><em>{category.count}</em></span><NavIcon name="arrow-right" className="marketplace-category-arrow" />
                  </button>
                ))}
              </div>
            )}
            <p className="marketplace-discover-note">Everything is labeled by source. Downloads and integrations require review before they are enabled.</p>
          </div>
        ) : section === "Updates" ? (
          <div className="marketplace-empty-pane"><EmptyState title="No verified updates available" description="Updates appear when a trusted local source provides version and integrity details." /></div>
        ) : section === "Image models" ? (
          <section className="marketplace-installed-pane"><div className="panel-heading"><div><p className="section-kicker">DIFFUSERS IMAGE ASSETS</p><h3>LoRAs</h3><p className="panel-subtitle">Search Hugging Face safetensors LoRAs, then install or remove them from Skai’s local Diffusers asset folder. Downloads are capped at 8 GB.</p></div><Button variant="secondary" onClick={() => void searchImageAssets()} disabled={imageAssetsLoading}>{imageAssetsLoading ? "Searching…" : "Search LoRAs"}</Button></div>
            <div className="marketplace-search-row"><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchImageAssets(); }} placeholder="Search LoRAs by style or subject…" aria-label="Search image LoRAs" /></div>
            {imageAssetStatus && <p className="marketplace-honesty" role="status">{imageAssetStatus}</p>}
            <h4>Installed on this PC ({installedImageAssets.length})</h4>
            {installedImageAssets.map((asset) => <article className="marketplace-model-row" key={asset.id}><div><strong>{asset.id}</strong><small>{asset.repository} · {formatSize(asset.sizeBytes)}</small></div><Button variant="danger" onClick={() => void removeImageAsset(asset.id)}>Remove</Button></article>)}
            <h4>Available LoRAs</h4>
            {imageAssets.map((asset) => <article className="marketplace-model-row" key={asset.repository}><div><strong>{asset.repository}</strong><small>{asset.downloads.toLocaleString()} downloads · {asset.files.length} safetensors files</small>{asset.files.map((file) => <p key={file.path}>{file.path} · {formatSize(file.sizeBytes)}</p>)}</div><div>{asset.files.map((file) => <Button key={file.path} variant="secondary" disabled={Boolean(installing)} onClick={() => void installImageAsset(asset.repository, file.path)}>{file.path.split("/").at(-1)}</Button>)}</div></article>)}
            {!imageAssets.length && !imageAssetsLoading && <EmptyState title="Search image LoRAs" description="Results are filtered to repositories that publish safetensors files. Review the source repository before installing." />}
          </section>
        ) : section === "Installed" ? (
          <div className="marketplace-installed-pane">
            <div className="panel-heading"><div><p className="section-kicker">LOCAL INVENTORY</p><h3>Installed models</h3><p className="panel-subtitle">Models available from the local runtime configured in Settings.</p></div><div className="marketplace-model-actions"><StatusBadge tone={installedError ? "warning" : installedLoading ? "neutral" : "success"}>{installedLoading ? "Discovering" : installedError ? "Needs attention" : installedModels.length + " installed"}</StatusBadge><Button variant="secondary" disabled={installedLoading} onClick={() => void loadInstalledModels()}>{installedLoading ? "Discovering…" : "Discover local models"}</Button></div></div>
            <label className="marketplace-installed-search"><span className="sr-only">Search installed models</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search installed models…" aria-label="Search installed models" /></label>
            {installedError ? <div className="marketplace-honesty" role="alert">{installedError}</div> : installedLoading ? <EmptyState title="Discovering local models…" description="Checking the configured runtime for models available on this PC." /> : installedModels.filter((model) => (model.model + " " + (model.provider ?? "") + " " + model.capabilities.join(" ")).toLowerCase().includes(query.trim().toLowerCase())).length === 0 ? <EmptyState title={installedModels.length === 0 ? "No models discovered yet" : "No matching installed models"} description={installedModels.length === 0 ? "Start your local model runtime, then discover its available models here." : "Try another search, or clear it to see all installed models."} action={installedModels.length === 0 ? <Button variant="secondary" disabled={installedLoading} onClick={() => void loadInstalledModels()}>Discover local models</Button> : <Button variant="ghost" onClick={() => setQuery("")}>Clear search</Button>} /> : (
              <div className="marketplace-installed-list" aria-label="Installed local models">
                {installedModels.filter((model) => (model.model + " " + (model.provider ?? "") + " " + model.capabilities.join(" ")).toLowerCase().includes(query.trim().toLowerCase())).map((model) => (
                  <article className="marketplace-installed-model" key={(model.provider ?? "local") + "-" + model.model}><span className="marketplace-installed-model-icon"><NavIcon name="model" /></span><div className="marketplace-installed-model-copy"><strong>{model.model}</strong><small>{model.provider ?? "Local runtime"} · {model.vision.toLowerCase() === "supported" ? "Vision" : "Text"}</small><span>{model.capabilities.join(" · ") || "Text generation"}</span></div><StatusBadge tone="success">Available locally</StatusBadge></article>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="marketplace-toolbar"><div className="marketplace-search-row"><label className="sr-only" htmlFor="marketplace-search">Search {section.toLowerCase()}</label><input id="marketplace-search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && showModels) void searchModels(); }} placeholder={showModels ? "Search models by name or provider…" : "Search " + section.toLowerCase() + "…"} />{showModels && <Button variant="secondary" disabled={modelLoading} onClick={() => void searchModels()}>{modelLoading ? "Searching…" : "Search providers"}</Button>}<span>{showModels ? models.length + " remote results" : visible.length + " results"}</span></div></div>
            {showModels ? <div className="marketplace-models-pane">{modelResults}</div> : (
              <div className="marketplace-layout">
                <div className="marketplace-results" aria-label={section + " results"}>
                  {visible.length === 0 ? <EmptyState title={query ? "No matching results" : "Nothing to show yet"} description={query ? "Try another search term." : "This category has no entries in the local catalog yet."} action={query ? <Button variant="ghost" onClick={() => setQuery("")}>Clear search</Button> : undefined} /> : visible.map((item) => (
                    <button className={"marketplace-row" + (selected?.id === item.id ? " is-selected" : "")} key={item.id} type="button" onClick={() => setSelectedId(item.id)} aria-pressed={selected?.id === item.id}><span className="marketplace-row-icon"><NavIcon name={item.icon} /></span><span className="marketplace-row-copy"><strong>{item.title}</strong><small>{item.description}</small><em>{item.publisher} · {item.version}</em></span><StatusBadge tone={item.tone}>{item.status}</StatusBadge></button>
                  ))}
                </div>
                {selected && <aside className="marketplace-detail" aria-label="Selected capability details">
                  <div className="marketplace-detail-heading"><div><p className="section-kicker">CAPABILITY DETAILS</p><h3>{selected.title}</h3></div><StatusBadge tone={selected.tone}>{selected.status}</StatusBadge></div>
                  <p>{selected.detail}</p>
                  <dl className="marketplace-detail-list"><div><dt>Source</dt><dd>{selected.publisher}</dd></div><div><dt>Version / size</dt><dd>{selected.version}</dd></div><div><dt>Compatibility / access</dt><dd>{selected.compatibility}</dd></div><div><dt>Next step</dt><dd>{selected.nextStep}</dd></div></dl>
                  {selected.filter === "Voices" && <div className="marketplace-voice-controls">
                    <label>Primary conversational voice<select value={voiceSettings.primaryModelId} onChange={(event) => updateVoice("primaryModelId", event.target.value)}>{installedVoiceModels.map((voice) => <option key={voice.id} value={voice.id}>{voice.name} · {voice.size}</option>)}</select></label>
                    {installedVoiceModels.some((voice) => voice.lowResource && voice.id !== voiceSettings.primaryModelId) && <label>Low-resource mode voice<select value={voiceSettings.lowResourceModelId} onChange={(event) => updateVoice("lowResourceModelId", event.target.value)}>{installedVoiceModels.filter((voice) => voice.lowResource).map((voice) => <option key={voice.id} value={voice.id}>{voice.name} · {voice.size}</option>)}</select></label>}
                    <label>Voice profile<select value={voiceSettings.profileId} onChange={(event) => updateVoice("profileId", event.target.value)}>{voiceProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.description}</option>)}</select></label>
                    <label className="settings-toggle"><span><strong>Speak completed replies</strong><small>Voice output stays off until enabled.</small></span><input type="checkbox" checked={voiceSettings.voiceOutputEnabled} onChange={(event) => updateVoice("voiceOutputEnabled", event.target.checked)} /></label>
                    {installedVoiceModels.some((voice) => voice.lowResource && voice.id !== voiceSettings.primaryModelId) && <label className="settings-toggle"><span><strong>Use low-resource mode</strong><small>Use the separately assigned voice model.</small></span><input type="checkbox" checked={voiceSettings.lowResourceMode} onChange={(event) => updateVoice("lowResourceMode", event.target.checked)} /></label>}
                    <div className="marketplace-voice-actions"><Button variant="secondary" onClick={() => void speakNativeResponse("Skai voice preview. This uses the operating system voice service.", true)}>Preview voice</Button><Button variant="ghost" onClick={stopNativeSpeech}>Stop</Button></div>
                  </div>}
                  {selected.filter === "Local models" ? <p className="marketplace-honesty" role="status">{installStatus ?? "Review the provider, size, and source before confirming a local model download."}</p> : selected.id === "mcp:rea" ? <div className="marketplace-install-review"><p className="section-kicker">MCP PACKAGE</p><strong>Pinned package · verified before save</strong><span>{mcpMarketplaceStatus ?? "Downloading saves the package only. Connect starts the reviewed local REA stdio server; no arbitrary commands are accepted."}</span><div className="marketplace-model-actions"><Button variant="primary" disabled={mcpMarketplaceBusy} onClick={() => void downloadReaPackage()}>{mcpMarketplaceBusy ? "Working…" : "Download package"}</Button><Button variant="secondary" disabled={mcpMarketplaceBusy} onClick={() => void connectRea()}>{mcpMarketplaceBusy ? "Working…" : "Connect in Skai"}</Button><Button variant="ghost" onClick={() => void window.serverRockAgent?.updates?.open("https://github.com/morluto/rea")}>View source</Button></div></div> : <div className="marketplace-install-review"><p className="section-kicker">INSTALL STATUS</p><strong>{selected.installable ? "Review required" : "No installer connected"}</strong><span>Install actions appear only when a verified local installer is available. Nothing is downloaded from this item.</span></div>}
                </aside>}
              </div>
            )}
          </>
        )}
      </div>
      <p className="marketplace-footer-note">{sectionDescription[section]}</p>
    </div>
  );
}
