import { useEffect, useMemo, useRef, useState } from "react";
import type { Model, Route } from "../../app/types";
import type { AgentResponse, DesktopPersona } from "../../../shared/contracts";
import { Button, EmptyState, StatusBadge } from "../../components/ui/Primitives";
import { NavIcon, type NavIconName } from "../../components/ui/NavIcon";
import { installedVoiceModels, saveVoiceSetting, selectedVoiceSettings, speakNativeResponse, stopNativeSpeech, voiceProfiles } from "../../services/nativeTts";

export type MarketplaceSection = Section;
type Section = "Discover" | "Models" | "Image models" | "Voices" | "Image workflows" | "Skills" | "Tools" | "Installed" | "Updates";
type Filter = "All" | "Local models" | "Voices" | "Image workflows" | "Skills" | "Tools";
type CatalogItem = { id: string; title: string; filter: Filter; description: string; detail: string; icon: NavIconName; status: string; tone: "neutral" | "success" | "warning"; publisher: string; version: string; compatibility: string; nextStep: string; installable: boolean };
type MarketplaceModel = { id: string; repository: string; name?: string; source: string; kind: string; downloads: number; likes: number; uncensored: boolean; tags: string[]; sizeBytes?: number | null; contextLength?: number | null; installRoute: string; installable: boolean; requiresAirLlm?: boolean; files?: Array<{ path: string; sizeBytes: number; sha256?: string | null }> };
type MarketplaceCatalog = { providers: Array<{ id: string; name: string; kinds: string[]; remote: boolean }>; voiceProviders?: Array<{ id: string; name: string; kind: string; requiresUserKey: boolean; status: string }>; voices: Array<{ id: string; name: string; description: string; runtime: string; license: string; size: string; installed: boolean; lowResource: boolean; sourceUrl: string; adapterAvailable: boolean; supportsStreaming: boolean; supportsVoiceCloning: boolean; supportsEmotion: boolean; supportsAudioEffects: boolean; availabilityNote: string; installable: boolean }>; skills: Array<{ id: string; name: string; description: string; category: string; permissions: string[]; source: string; installed: boolean; enabled: boolean; installable: boolean }>; tools: Array<{ id: string; name: string; description: string; category: string; access: string; builtIn: boolean; status: string; source?: string | null; installable: boolean }> };

const items: CatalogItem[] = [
  { id: "local-models", title: "Local models", filter: "Local models", description: "Search Hugging Face and ModelScope for local GGUF models.", detail: "Remote catalog discovery is separated from inference. Every result shows its provider, provenance, safety label, size when available, and the verified local install route.", icon: "model", status: "Remote discovery", tone: "success", publisher: "Hugging Face · ModelScope", version: "Live catalog", compatibility: "Local runtime required", nextStep: "Search, filter, inspect the source, then start a verified local download.", installable: false },
  { id: "image-workflows", title: "Image workflows", filter: "Image workflows", description: "Reuse reviewed ComfyUI workflows from Image Studio.", detail: "Workflow JSON is kept in the local profile. Marketplace does not download or activate remote image packages.", icon: "image", status: "Local source needed", tone: "warning", publisher: "Local profile", version: "User-managed", compatibility: "ComfyUI API workflow", nextStep: "Open Image Studio and save a workflow for reuse.", installable: false },
  { id: "mcp:rea", title: "REA · Reverse Engineering Agent", filter: "Tools", description: "A local MCP server for reverse engineering software and application behavior.", detail: "REA is published by morluto as the rea-agents npm package. Skai can download the pinned package or launch its MCP server locally over stdio. Tool actions remain subject to Skai's per-tool approval gate.", icon: "terminal", status: "Downloadable MCP", tone: "success", publisher: "morluto · github.com/morluto/rea", version: "rea-agents 6.9.0", compatibility: "Node.js 22.23.4+, 24.22.1+, or 26.12.1+", nextStep: "Download the verified package or start REA in Skai after reviewing the local runtime requirement.", installable: true },
];

function request(method: string, params?: Record<string, unknown>): Promise<AgentResponse> {
  return window.skaiAgent?.request(method, params) ?? Promise.resolve({ v: 1, id: `marketplace-${method}`, ok: false, error: { code: "BRIDGE_UNAVAILABLE", message: "The Electron agent bridge is unavailable." } });
}

function formatSize(bytes?: number | null) {
  if (!bytes || bytes <= 0) return "Size unavailable";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

function normalizeSource(value: string) {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

function marketplacePreference<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(`skai.marketplace.${key}`);
    return value === null ? fallback : JSON.parse(value) as T;
  } catch { return fallback; }
}

// Embedded in the unified Marketplace catalog (PluginsPage) for the hub sections that catalog
// does not cover itself: remote model search/install, Diffusers LoRAs and the local inventory.
const EMBEDDED_SECTIONS: Section[] = ["Models", "Installed"];

export function MarketplacePage({ onSelectAirLlmModel, onNavigate, initialSection = "Discover", onBack, initialQuery }: { onSelectAirLlmModel?: (model: Model) => void; onNavigate?: (route: Route) => void; initialSection?: Section; onBack?: () => void; initialQuery?: string }) {
  const [section, setSection] = useState<Section>(initialSection);
  const [filter, setFilter] = useState<Filter>("All");
  const [query, setQuery] = useState(() => initialQuery ?? marketplacePreference(`query.${initialSection.toLowerCase()}`, ""));
  const [selectedId, setSelectedId] = useState(items[0].id);
  const [voiceSettings, setVoiceSettings] = useState(selectedVoiceSettings);
  const [catalog, setCatalog] = useState<MarketplaceCatalog | null>(null);
  const [models, setModels] = useState<MarketplaceModel[]>([]);
  const [modelLoading, setModelLoading] = useState(false);
  const modelSearchRequestRef = useRef(0);
  const [modelError, setModelError] = useState<string | null>(null);
  const [uncensored, setUncensored] = useState(false);
  const [provider, setProvider] = useState(() => marketplacePreference("models.provider", "All providers"));
  const [size, setSize] = useState(() => marketplacePreference("models.size", "Any size"));
  const [taskFilter, setTaskFilter] = useState(() => marketplacePreference("models.task", "All tasks"));
  const [libraryFilter, setLibraryFilter] = useState(() => marketplacePreference("models.library", "All libraries"));
  const [appFilter, setAppFilter] = useState(() => marketplacePreference("models.app", "All apps"));
  const [contextFilter, setContextFilter] = useState(() => marketplacePreference("models.context", "Any context"));
  const [installing, setInstalling] = useState<string | null>(null);
  const [installStatus, setInstallStatus] = useState<string | null>(null);
  const [installOperationId, setInstallOperationId] = useState<string | null>(null);
  const [reviewModel, setReviewModel] = useState<MarketplaceModel | null>(null);
  const [installedModels, setInstalledModels] = useState<Array<{ model: string; vision: string; capabilities: string[]; provider?: string }>>([]);
  const [installedConnections, setInstalledConnections] = useState<Array<{ connectionId: string; serverId: string; transport: string; state: string }>>([]);
  const [installedPersonas, setInstalledPersonas] = useState<DesktopPersona[]>([]);
  const [installedInventoryError, setInstalledInventoryError] = useState<string | null>(null);
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

  useEffect(() => { localStorage.setItem(`skai.marketplace.query.${section.toLowerCase()}`, JSON.stringify(query)); }, [query, section]);
  useEffect(() => {
    localStorage.setItem("skai.marketplace.models.provider", JSON.stringify(provider));
    localStorage.setItem("skai.marketplace.models.size", JSON.stringify(size));
    localStorage.setItem("skai.marketplace.models.task", JSON.stringify(taskFilter));
    localStorage.setItem("skai.marketplace.models.library", JSON.stringify(libraryFilter));
    localStorage.setItem("skai.marketplace.models.app", JSON.stringify(appFilter));
    localStorage.setItem("skai.marketplace.models.context", JSON.stringify(contextFilter));
  }, [appFilter, contextFilter, libraryFilter, provider, size, taskFilter]);

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
      detail: `${voice.description} Runtime: ${voice.runtime}. License: ${voice.license}. ${voice.size}. ${voice.availabilityNote}`,
      icon: "activity", status: voice.installed ? "Available locally" : voice.adapterAvailable ? "Ready to install" : "Catalog only", tone: voice.installed ? "success" : voice.adapterAvailable ? "success" : "neutral",
      publisher: voice.runtime, version: voice.size, compatibility: voice.license,
      nextStep: voice.installed ? "Select this voice in the voice controls and preview it." : voice.installable ? `Review the source before installing from ${voice.sourceUrl}.` : voice.sourceUrl ? `Review the upstream source. ${voice.availabilityNote}` : "No verified local installer is connected for this voice.", installable: voice.installable,
    }));
    const voiceProviderItems: CatalogItem[] = (catalog?.voiceProviders ?? []).map((provider) => ({
      id: `voice-provider:${provider.id}`, title: provider.name, filter: "Tools", description: `Optional ${provider.kind} connector for voice generation.`,
      detail: `${provider.status} API keys remain local and are never exposed to the model.`, icon: "activity", status: "Optional cloud connector", tone: "warning",
      publisher: "User-configured", version: provider.requiresUserKey ? "Bring your own key" : "No key required", compatibility: provider.kind,
      nextStep: "Connect this provider in Settings when cloud voice is enabled.", installable: false,
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
    return [...items, ...voiceItems, ...voiceProviderItems, ...skillItems, ...toolItems];
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

  useEffect(() => {
    if (section !== "Installed") return;
    void loadInstalledModels();
    void Promise.all([request("marketplace.image-assets.list"), request("mcp.connections.list"), request("persona.list")]).then(([assets, connections, personas]) => {
      const errors = [assets, connections, personas].filter((response) => !response.ok).map((response) => response.error?.message).filter(Boolean);
      setInstalledInventoryError(errors.join(" ") || null);
      if (assets.ok) setInstalledImageAssets((assets.result as typeof installedImageAssets) ?? []);
      if (connections.ok) setInstalledConnections(((connections.result as { connections?: typeof installedConnections }).connections ?? []));
      if (personas.ok) setInstalledPersonas(((personas.result as { personas?: DesktopPersona[] }).personas ?? []));
    }).catch(() => setInstalledInventoryError("Some installed tools could not be refreshed."));
  }, [section]);
  useEffect(() => { if (onBack && section === "Models") void loadInstalledModels(); }, [section, onBack]);
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
  const modelTags = useMemo(() => [...new Set(models.flatMap((model) => model.tags))].sort((a, b) => a.localeCompare(b)), [models]);
  const taskOptions = useMemo(() => ["All tasks", ...new Set(modelTags.filter((tag) => /text|chat|code|image|audio|video|vision|speech|embed/i.test(tag)).map((tag) => tag.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())))], [modelTags]);
  const libraryOptions = useMemo(() => ["All libraries", ...new Set(modelTags.filter((tag) => /transformers|gguf|mlx|pytorch|tensorflow|diffusers|safetensors|jax/i.test(tag)).map((tag) => tag.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())))], [modelTags]);
  const appOptions = useMemo(() => ["All apps", ...new Set(modelTags.filter((tag) => /ollama|llama\.cpp|lm studio|vllm|jan|localai|airllm/i.test(tag)).map((tag) => tag.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())))], [modelTags]);
  const filteredModels = useMemo(() => models.filter((model) => {
    const matchesProvider = provider === "All providers" || (provider === "AirLLM" ? model.requiresAirLlm === true : model.source === provider && !model.requiresAirLlm);
    const sizeLimit = size === "Any size" ? Number.POSITIVE_INFINITY : Number(size);
    const matchesSize = size === "Any size" || (model.sizeBytes != null && model.sizeBytes <= sizeLimit * 1024 ** 3);
    const tags = model.tags.map((tag) => tag.toLowerCase());
    const normalizedTask = taskFilter === "All tasks" ? "" : taskFilter.toLowerCase();
    const normalizedLibrary = libraryFilter === "All libraries" ? "" : libraryFilter.toLowerCase();
    const normalizedApp = appFilter === "All apps" ? "" : appFilter.toLowerCase();
    const matchesTask = !normalizedTask || tags.some((tag) => tag.includes(normalizedTask));
    const matchesLibrary = !normalizedLibrary || tags.some((tag) => tag.includes(normalizedLibrary));
    const matchesApp = !normalizedApp || tags.some((tag) => tag.includes(normalizedApp));
    const matchesContext = contextFilter === "Any context" || (contextFilter === "1M-class window" && (model.contextLength ?? 0) >= 900_000);
    return matchesProvider && matchesSize && matchesTask && matchesLibrary && matchesApp && matchesContext;
  }), [appFilter, contextFilter, libraryFilter, models, provider, size, taskFilter]);
  const selectedRemoteModel = filteredModels.find((model) => model.id === selectedRemoteModelId) ?? filteredModels[0] ?? null;
  const activeModelFilterCount = [provider !== "All providers", taskFilter !== "All tasks", libraryFilter !== "All libraries", appFilter !== "All apps", size !== "Any size", contextFilter !== "Any context", uncensored].filter(Boolean).length;
  const activeLocalRuntime = localStorage.getItem("skai.provider") ?? "Ollama";
  const installRouteAvailable = (model: MarketplaceModel) => model.requiresAirLlm || (model.installRoute === "ollama-pull"
    ? activeLocalRuntime.toLowerCase().includes("ollama")
    : model.installRoute === "ollama-gguf"
    ? activeLocalRuntime.toLowerCase().includes("ollama")
    : model.installRoute === "lm-studio" && activeLocalRuntime.toLowerCase().replaceAll("-", " ").includes("lm studio"));

  async function searchModels(nextQuery = query, nextUncensored = uncensored) {
    const requestId = ++modelSearchRequestRef.current;
    setModelLoading(true);
    setModelError(null);
    setModels([]);
    setSelectedRemoteModelId(null);
    try {
      const response = await request("marketplace.models.search", { query: nextQuery.trim(), uncensored: nextUncensored });
      if (requestId !== modelSearchRequestRef.current) return;
      if (!response.ok) {
        setModelError(response.error?.message ?? "Remote model discovery failed.");
        return;
      }
      const result = response.result as { models?: MarketplaceModel[]; providers?: Record<string, string> };
      setModels(result.models ?? []);
      if (Object.values(result.providers ?? {}).some((status) => status !== "ready")) {
        setModelError("Some model sources did not respond in time. Showing results from the sources that are available.");
      }
    } catch {
      if (requestId === modelSearchRequestRef.current) setModelError("Remote model discovery failed.");
    } finally {
      if (requestId === modelSearchRequestRef.current) setModelLoading(false);
    }
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
    setInstallOperationId(operationId);
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
    setInstallOperationId(null);
  }

  async function cancelModelInstall() {
    if (!installOperationId) return;
    setInstallStatus("Stopping model download…");
    const response = await request("marketplace.models.install.cancel", { id: installOperationId });
    if (!response.ok) setInstallStatus(response.error?.message ?? "The download could not be stopped.");
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
    Installed: "Review models, skills, local assets, and MCP servers available to Skai on this device.",
    Updates: "Updates appear here only when a verified local source reports them.",
  };

  const sectionHeading: Record<Section, string> = { Discover: "Explore the marketplace", Models: "Local models", "Image models": "Image models & LoRAs", Voices: "Voice profiles", "Image workflows": "Image workflows", Skills: "Agent skills", Tools: "Tools & integrations", Installed: "Installed tools", Updates: "Updates" };
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
    <details className="marketplace-model-filter-disclosure"><summary><span>Filters</span><small>{activeModelFilterCount ? `${activeModelFilterCount} active` : "Optional"}</small></summary><div className="marketplace-model-controls marketplace-model-filters"><label>Task<select value={taskFilter} onChange={(event) => setTaskFilter(event.target.value)}>{taskOptions.map((option) => <option key={option}>{option}</option>)}</select></label><label>Provider<select value={provider} onChange={(event) => setProvider(event.target.value)}><option>All providers</option><option>Ollama</option><option>Hugging Face</option><option>ModelScope</option><option>AirLLM</option></select></label><label>Library<select value={libraryFilter} onChange={(event) => setLibraryFilter(event.target.value)}>{libraryOptions.map((option) => <option key={option}>{option}</option>)}</select></label><label>App/runtime<select value={appFilter} onChange={(event) => setAppFilter(event.target.value)}><option>All apps</option>{appOptions.slice(1).map((option) => <option key={option}>{option}</option>)}</select></label><label>Context window<select value={contextFilter} onChange={(event) => setContextFilter(event.target.value)}><option>Any context</option><option>1M-class window</option></select></label><label>Maximum model size<select value={size} onChange={(event) => setSize(event.target.value)}><option>Any size</option><option value="8">8 GB</option><option value="14">14 GB</option><option value="24">24 GB</option><option value="40">40 GB</option></select></label><label className="settings-toggle"><span><strong>Include abliterated</strong><small>Only show explicit uncensored/abliterated labels.</small></span><input type="checkbox" checked={uncensored} onChange={(event) => { setUncensored(event.target.checked); void searchModels(query, event.target.checked); }} /></label></div></details>
    <p className="marketplace-honesty">Task and runtime filters use catalog tags. Context length appears only when the source publishes it. Model file size is not the same as runtime memory; hardware fit also depends on quantization, context length, and available VRAM/RAM.</p>
    {modelError && <p className="marketplace-honesty" role="status">{modelError}</p>}
    {installStatus && <div className="marketplace-honesty marketplace-download-status" role="status"><span>{installStatus}</span>{installing && <Button variant="ghost" type="button" onClick={() => void cancelModelInstall()}>Cancel download</Button>}</div>}
    {reviewModel && <div className="marketplace-install-review marketplace-model-review" role="dialog" aria-label={reviewModel.requiresAirLlm ? "Review AirLLM model route" : "Verify model installation"}><p className="section-kicker">{reviewModel.requiresAirLlm ? "AIRLLM ROUTE REVIEW" : "INSTALLATION REVIEW"}</p><strong>{reviewModel.repository}</strong><span>{reviewModel.source} · {formatSize(reviewModel.sizeBytes)} · {reviewModel.downloads.toLocaleString()} downloads</span><span>{reviewModel.requiresAirLlm ? `This Transformers model will use the optional AirLLM route. ${airLlmReady === true ? "AirLLM is ready." : airLlmReady === false ? "Install AirLLM in Settings before using this route." : "Checking AirLLM readiness…"} Model weights download from Hugging Face on first use and may require substantial disk space. Inference can be much slower than Ollama or LM Studio.` : installRouteAvailable(reviewModel) ? `This uses ${reviewModel.installRoute} with your active ${activeLocalRuntime} runtime. No download starts until you confirm this local installation.` : `This package needs ${reviewModel.installRoute}, but your active runtime is ${activeLocalRuntime}. Switch the local runtime in Settings before installing; this prevents a download request that would fail.`}</span><div className="marketplace-model-actions">{reviewModel.requiresAirLlm && onNavigate && <Button variant="secondary" type="button" onClick={() => { setReviewModel(null); onNavigate("settings"); }}>Manage AirLLM</Button>}<Button variant="ghost" type="button" onClick={() => setReviewModel(null)}>Cancel</Button><Button variant="primary" type="button" disabled={reviewModel.requiresAirLlm ? !onSelectAirLlmModel || airLlmReady !== true : !reviewModel.installable || installing !== null || !installRouteAvailable(reviewModel)} onClick={() => { const model = reviewModel; setReviewModel(null); if (model.requiresAirLlm) useAirLlmModel(model); else void installModel(model); }}>{reviewModel.requiresAirLlm ? "Use with AirLLM" : "Confirm and install locally"}</Button></div></div>}
    {filteredModels.length === 0 ? <EmptyState title={modelLoading ? "Polling providers…" : "No matching models"} description="Change the search or filters. Unknown sizes are hidden only when a maximum size is selected." /> : <div className="marketplace-model-layout"><div className="marketplace-model-list" aria-label="Marketplace model results">{filteredModels.slice(0, 36).map((model) => <button className={`marketplace-model-row${selectedRemoteModel?.id === model.id ? " is-selected" : ""}`} type="button" key={model.id} aria-pressed={selectedRemoteModel?.id === model.id} onClick={() => setSelectedRemoteModelId(model.id)}><span className="marketplace-row-icon"><NavIcon name="model" /></span><span className="marketplace-model-copy"><strong>{model.repository}</strong><small>{model.source} · {formatSize(model.sizeBytes)} · {model.contextLength ? `${model.contextLength.toLocaleString()} tokens` : "Context unknown"} · {model.downloads.toLocaleString()} downloads · {model.tags.slice(0, 3).join(" · ") || (model.requiresAirLlm ? "Transformers weights" : "GGUF")}</small></span><span className="marketplace-model-actions">{model.requiresAirLlm && <StatusBadge tone="warning">Requires AirLLM</StatusBadge>}{!model.requiresAirLlm && !installRouteAvailable(model) && <StatusBadge tone="warning">Needs {model.installRoute}</StatusBadge>}{model.uncensored && <StatusBadge tone="warning">Abliterated</StatusBadge>}</span></button>)}</div>{selectedRemoteModel && <aside className="marketplace-detail marketplace-model-inspector" aria-label="Selected model details"><div className="marketplace-detail-heading"><div><p className="section-kicker">SELECTED MODEL</p><h3>{selectedRemoteModel.repository}</h3></div><StatusBadge tone={selectedRemoteModel.requiresAirLlm || !installRouteAvailable(selectedRemoteModel) ? "warning" : "success"}>{selectedRemoteModel.requiresAirLlm ? "Requires AirLLM" : installRouteAvailable(selectedRemoteModel) ? "Runtime ready" : `Needs ${selectedRemoteModel.installRoute}`}</StatusBadge></div><p>{selectedRemoteModel.requiresAirLlm ? "Full Transformers weights use the optional AirLLM runtime. The model downloads on first use, so check the listed size and available disk space." : installRouteAvailable(selectedRemoteModel) ? "This model uses your active local runtime. Review the source and size before downloading." : `This model requires ${selectedRemoteModel.installRoute}; your active runtime is ${activeLocalRuntime}. Choose a compatible package or switch runtimes before install.`}</p><div className="marketplace-model-actions">{selectedRemoteModel.requiresAirLlm && onNavigate && <Button variant="secondary" type="button" onClick={() => onNavigate("settings")}>Manage AirLLM</Button>}<Button variant="primary" type="button" disabled={selectedRemoteModel.requiresAirLlm ? !onSelectAirLlmModel || airLlmReady !== true : !selectedRemoteModel.installable || installing !== null} onClick={() => setReviewModel(selectedRemoteModel)}>{selectedRemoteModel.requiresAirLlm ? "Review AirLLM route" : "Review install"}</Button></div><dl className="marketplace-detail-list"><div><dt>Source</dt><dd>{selectedRemoteModel.source}</dd></div><div><dt>Install route</dt><dd>{selectedRemoteModel.requiresAirLlm ? `AirLLM · ${airLlmReady === null ? "checking readiness" : airLlmReady ? "ready" : "setup needed"}` : `${selectedRemoteModel.installRoute} · ${installRouteAvailable(selectedRemoteModel) ? "ready" : `active runtime: ${activeLocalRuntime}`}`}</dd></div><div><dt>Estimated size</dt><dd>{formatSize(selectedRemoteModel.sizeBytes)}</dd></div><div><dt>Context window</dt><dd>{selectedRemoteModel.contextLength ? `${selectedRemoteModel.contextLength.toLocaleString()} tokens (catalog metadata)` : "Not published by catalog"}</dd></div><div><dt>Downloads</dt><dd>{selectedRemoteModel.downloads.toLocaleString()}</dd></div><div><dt>Likes</dt><dd>{selectedRemoteModel.likes.toLocaleString()}</dd></div><div><dt>Next step</dt><dd>{selectedRemoteModel.requiresAirLlm ? "Install the optional runtime in Settings, then choose Use with AirLLM. Weights download when chat first starts." : installRouteAvailable(selectedRemoteModel) ? "Review the local installer before confirming the download." : "Use a package compatible with your active local runtime."}</dd></div></dl></aside>}</div>}
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
        <div className="marketplace-header-actions">{onBack && <Button variant="ghost" type="button" onClick={onBack}><NavIcon name="chevron-left" />Marketplace</Button>}{!onBack && section !== "Installed" && <Button variant="ghost" type="button" onClick={() => { setSection("Installed"); setQuery(""); }}>View installed tools</Button>}</div>
      </header>
      <div className="marketplace-browser">
        <nav className="marketplace-sections" aria-label="Marketplace sections">
          {(onBack ? EMBEDDED_SECTIONS : ["Discover", "Models", "Image models", "Voices", "Image workflows", "Skills", "Tools", "Updates"] as Section[]).map((item) => (
            <button key={item} className={(section === item || (item === "Tools" && section === "Installed")) ? "is-active" : ""} type="button" aria-current={(section === item || (item === "Tools" && section === "Installed")) ? "page" : undefined} onClick={() => { setSection(item); setQuery(""); }}>{item}</button>
          ))}
          {!onBack && (section === "Tools" || section === "Installed") && <div className="marketplace-tools-subnav" role="tablist" aria-label="Tools views"><button type="button" role="tab" aria-selected={section === "Tools"} className={section === "Tools" ? "is-active" : ""} onClick={() => { setSection("Tools"); setQuery(""); }}>Catalog</button><button type="button" role="tab" aria-selected={section === "Installed"} className={section === "Installed" ? "is-active" : ""} onClick={() => { setSection("Installed"); setQuery(""); }}>Installed</button></div>}
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
            <h4>Available LoRAs</h4>
            {imageAssets.map((asset) => <article className="marketplace-model-row" key={asset.repository}><div><strong>{asset.repository}</strong><small>{asset.downloads.toLocaleString()} downloads · {asset.files.length} safetensors files</small>{asset.files.map((file) => <p key={file.path}>{file.path} · {formatSize(file.sizeBytes)}</p>)}</div><div>{asset.files.map((file) => <Button key={file.path} variant="secondary" disabled={Boolean(installing)} onClick={() => void installImageAsset(asset.repository, file.path)}>{file.path.split("/").at(-1)}</Button>)}</div></article>)}
            {!imageAssets.length && !imageAssetsLoading && <EmptyState title="Search image LoRAs" description="Results are filtered to repositories that publish safetensors files. Review the source repository before installing." />}
          </section>
        ) : section === "Installed" ? (
          <div className="marketplace-installed-pane">
            <div className="panel-heading"><div><p className="section-kicker">LOCAL INVENTORY</p><h3>Installed and connected</h3><p className="panel-subtitle">Models, skills, voices, image assets, built-ins, and MCP servers available to Skai on this device.</p></div><div className="marketplace-model-actions"><StatusBadge tone={installedError || installedInventoryError ? "warning" : installedLoading ? "neutral" : "success"}>{installedLoading ? "Refreshing" : `${installedModels.length + (catalog?.skills.filter((item) => item.installed).length ?? 0) + (catalog?.voices.filter((item) => item.installed).length ?? 0) + (catalog?.tools.filter((item) => item.builtIn).length ?? 0) + installedImageAssets.length + installedConnections.length + installedPersonas.length} items`}</StatusBadge><Button variant="secondary" disabled={installedLoading} onClick={() => void loadInstalledModels()}>{installedLoading ? "Refreshing…" : "Refresh inventory"}</Button></div></div>
            <label className="marketplace-installed-search"><span className="sr-only">Search installed items</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search installed tools and local items…" aria-label="Search installed items" /></label>
            {(installedError || installedInventoryError) && <div className="marketplace-honesty" role="status">{[installedError, installedInventoryError].filter(Boolean).join(" ")}</div>}
            {(() => {
              const term = query.trim().toLowerCase();
              const matches = (...values: Array<string | undefined>) => values.join(" ").toLowerCase().includes(term);
              const group = (title: string, rows: Array<{ id: string; name: string; detail: string; state: string; icon: NavIconName; remove?: () => void }>) => {
                const filtered = rows.filter((row) => matches(row.name, row.detail, row.state));
                if (!filtered.length) return null;
                return <section className="marketplace-installed-group" key={title}><h4>{title} <span>{filtered.length}</span></h4>{filtered.map((row) => <article className="marketplace-installed-model" key={row.id}><span className="marketplace-installed-model-icon"><NavIcon name={row.icon} /></span><div className="marketplace-installed-model-copy"><strong>{row.name}</strong><small>{row.detail}</small></div><StatusBadge tone={row.state === "Needs attention" ? "warning" : "success"}>{row.state}</StatusBadge>{row.remove && <Button variant="danger" onClick={row.remove}>Remove</Button>}</article>)}</section>;
              };
              const rows = [
                group("Models", installedModels.map((item) => ({ id: `model:${item.provider}:${item.model}`, name: item.model, detail: `${item.provider ?? "Local runtime"} · ${item.vision.toLowerCase() === "supported" ? "Vision" : "Text"} · ${item.capabilities.join(" · ") || "Text generation"}`, state: "Available locally", icon: "model" as NavIconName }))),
                group("MCP servers", installedConnections.map((item) => ({ id: `mcp:${item.connectionId}`, name: item.serverId, detail: `${item.transport} · ${item.connectionId}`, state: item.state === "healthy" ? "Connected" : "Needs attention", icon: "terminal" as NavIconName }))),
                group("Skai built-ins", (catalog?.tools ?? []).filter((item) => item.builtIn).map((item) => ({ id: `tool:${item.id}`, name: item.name, detail: item.description, state: "Built in", icon: "terminal" as NavIconName }))),
                group("Skills", (catalog?.skills ?? []).filter((item) => item.installed).map((item) => ({ id: `skill:${item.id}`, name: item.name, detail: `${item.source} · ${item.enabled ? "Enabled" : "Disabled"}`, state: item.enabled ? "Enabled" : "Installed", icon: "sparkle" as NavIconName }))),
                group("Voice profiles", (catalog?.voices ?? []).filter((item) => item.installed).map((item) => ({ id: `voice:${item.id}`, name: item.name, detail: `${item.runtime} · ${item.size}`, state: "Available locally", icon: "activity" as NavIconName }))),
                group("Personas", installedPersonas.map((item) => ({ id: `persona:${item.id}`, name: item.name, detail: `${item.sourceMode === "public-research" ? "Public research" : "Own material"} · ${item.roles}`, state: "Available in Skai", icon: "sparkle" as NavIconName }))),
                group("Image assets", installedImageAssets.map((item) => ({ id: `asset:${item.id}`, name: item.id, detail: `${item.repository} · ${formatSize(item.sizeBytes)}`, state: "Installed locally", icon: "image" as NavIconName, remove: () => void removeImageAsset(item.id) }))),
              ];
              return rows.some(Boolean) ? rows : <EmptyState title={query ? "No matching installed items" : "No installed items discovered"} description={query ? "Try another search term." : "Connect a local model runtime or install a compatible tool to see it here."} action={query ? <Button variant="ghost" onClick={() => setQuery("")}>Clear search</Button> : undefined} />;
            })()}
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
                  {selected.filter === "Local models" ? <p className="marketplace-honesty" role="status">{installStatus ?? "Review the provider, size, and source before confirming a local model download."}</p> : selected.id === "mcp:rea" ? <div className="marketplace-install-review"><p className="section-kicker">MCP PACKAGE</p><strong>Pinned package · verified before save</strong><span>{mcpMarketplaceStatus ?? "Downloading saves the package only. Connect starts the reviewed local REA stdio server; no arbitrary commands are accepted."}</span><div className="marketplace-model-actions"><Button variant="primary" disabled={mcpMarketplaceBusy} onClick={() => void downloadReaPackage()}>{mcpMarketplaceBusy ? "Working…" : "Download package"}</Button><Button variant="secondary" disabled={mcpMarketplaceBusy} onClick={() => void connectRea()}>{mcpMarketplaceBusy ? "Working…" : "Connect in Skai"}</Button><Button variant="ghost" onClick={() => void window.skaiAgent?.updates?.open("https://github.com/morluto/rea")}>View source</Button></div></div> : <div className="marketplace-install-review"><p className="section-kicker">INSTALL STATUS</p><strong>{selected.installable ? "Review required" : "No installer connected"}</strong><span>Install actions appear only when a verified local installer is available. Nothing is downloaded from this item.</span></div>}
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
