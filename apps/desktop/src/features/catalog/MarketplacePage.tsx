import { useEffect, useMemo, useRef, useState } from "react";
import type { Model, Route } from "../../app/types";
import type { AgentResponse, DesktopPersona } from "../../../shared/contracts";
import { Button, EmptyState, StatusBadge } from "../../components/ui/Primitives";
import { NavIcon, type NavIconName } from "../../components/ui/NavIcon";
import { installedVoiceModels, refreshInstalledVoiceModels, saveVoiceSetting, selectedVoiceSettings, speakNativeResponse, stopNativeSpeech, voiceProfiles } from "../../services/nativeTts";
import { countActiveMarketplaceModelFilters, filterMarketplaceModels, isMarketplaceModelInstallRouteAvailable, marketplaceModelFilterOptions, type MarketplaceModel } from "./marketplaceModelFilters";

export type MarketplaceSection = Section;
type Section = "Discover" | "Models" | "Image models" | "Voices" | "Image workflows" | "Skills" | "Tools" | "Installed" | "Updates";
type Filter = "All" | "Local models" | "Voices" | "Image workflows" | "Skills" | "Tools";
type CatalogItem = { id: string; title: string; filter: Filter; description: string; detail: string; icon: NavIconName; status: string; tone: "neutral" | "success" | "warning"; publisher: string; version: string; compatibility: string; nextStep: string; installable: boolean };
type InstalledRecord = { id: string; name: string; detail: string; state: string; icon: NavIconName; source: string; requirements: string; nextStep: string; update?: () => void; remove?: () => void; health?: () => void };
type MarketplaceCatalog = { providers: Array<{ id: string; name: string; kinds: string[]; remote: boolean }>; voiceProviders?: Array<{ id: string; name: string; kind: string; requiresUserKey: boolean; status: string }>; voices: Array<{ id: string; name: string; description: string; runtime: string; license: string; size: string; installed: boolean; lowResource: boolean; sourceUrl: string; adapterAvailable: boolean; supportsStreaming: boolean; supportsVoiceCloning: boolean; supportsEmotion: boolean; supportsAudioEffects: boolean; availabilityNote: string; installable: boolean }>; skills: Array<{ id: string; name: string; description: string; category: string; permissions: string[]; source: string; installed: boolean; enabled: boolean; installable: boolean }>; tools: Array<{ id: string; name: string; description: string; category: string; access: string; builtIn: boolean; status: string; source?: string | null; installable: boolean }> };

const items: CatalogItem[] = [
  { id: "local-models", title: "Local models", filter: "Local models", description: "Search Hugging Face and ModelScope for local GGUF models.", detail: "Remote catalog discovery is separated from inference. Every result shows its provider, provenance, safety label, size when available, and the verified local install route.", icon: "model", status: "ready", tone: "success", publisher: "Hugging Face · ModelScope", version: "Catalog search", compatibility: "Local runtime required", nextStep: "Search, filter, inspect the source, then start a verified local download.", installable: false },
  { id: "mcp:rea", title: "REA · Reverse Engineering Agent", filter: "Tools", description: "A local MCP server for reverse engineering software and application behavior.", detail: "REA is published by morluto as the rea-agents npm package. Skai can download the pinned package or launch its MCP server locally over stdio. Tool actions remain subject to Skai's per-tool approval gate.", icon: "terminal", status: "ready", tone: "success", publisher: "morluto · github.com/morluto/rea", version: "rea-agents 6.7.0", compatibility: "Node.js 22.19.0+, 24.11.0+, or 26.0.0+", nextStep: "Download the verified package or start REA in Skai after reviewing the local runtime requirement.", installable: true },
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

function normalizeModelSearchQuery(value: string) {
  let normalized = value.trim();
  for (let attempt = 0; attempt < 2 && normalized.startsWith('"') && normalized.endsWith('"'); attempt += 1) {
    try {
      const decoded: unknown = JSON.parse(normalized);
      if (typeof decoded !== "string" || decoded === normalized) break;
      normalized = decoded.trim();
    } catch { break; }
  }
  const backslashes = (normalized.match(/\\/g) ?? []).length;
  if (normalized.length > 160 || (normalized.length > 28 && backslashes > 8 && backslashes / normalized.length > 0.1)) return "";
  return normalized;
}

// Embedded in the unified Marketplace catalog (PluginsPage) for the hub sections that catalog
// does not cover itself: remote model search/install, Diffusers LoRAs and the local inventory.
const EMBEDDED_SECTIONS: Section[] = ["Models", "Voices", "Image workflows", "Installed"];
const sectionIcons: Record<Section, NavIconName> = {
  Discover: "sparkle",
  Models: "model",
  "Image models": "image",
  Voices: "activity",
  "Image workflows": "image",
  Skills: "sparkle",
  Tools: "terminal",
  Installed: "memory",
  Updates: "memory",
};

type SavedImageWorkflow = { name: string; workflow: string };
type LocalCapacity = { ramTotalBytes?: number | null; ramAvailableBytes?: number | null; gpu?: { name?: string; totalBytes?: number | null; availableBytes?: number | null } | null; measurementNote?: string | null };

function readSavedImageWorkflows(): SavedImageWorkflow[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem("skai.image.workflows") ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is SavedImageWorkflow => Boolean(item && typeof item === "object" && typeof (item as SavedImageWorkflow).name === "string" && typeof (item as SavedImageWorkflow).workflow === "string")).slice(0, 12) : [];
  } catch { return []; }
}

export function MarketplacePage({ onSelectAirLlmModel, onNavigate, onImageChange, onImportWorkflow, initialSection = "Discover", onBack, onSectionChange, initialQuery }: { onSelectAirLlmModel?: (model: Model) => void; onNavigate?: (route: Route) => void; onImageChange?: (key: "endpoint" | "prompt" | "workflow" | "provider", value: string) => void; onImportWorkflow?: () => Promise<{ name: string; workflow: string } | null>; initialSection?: Section; onBack?: () => void; onSectionChange?: (section: Section) => void; initialQuery?: string }) {
  const [section, setSection] = useState<Section>(initialSection);
  const [query, setQuery] = useState(() => normalizeModelSearchQuery(initialQuery ?? marketplacePreference(`query.${initialSection.toLowerCase()}`, "")));
  const [selectedId, setSelectedId] = useState(items[0].id);
  const [voiceSettings, setVoiceSettings] = useState(selectedVoiceSettings);
  const [catalog, setCatalog] = useState<MarketplaceCatalog | null>(null);
  const [models, setModels] = useState<MarketplaceModel[]>([]);
  const [modelLoading, setModelLoading] = useState(false);
  const modelSearchRequestRef = useRef(0);
  const initialModelSearchStartedRef = useRef(false);
  const lastProviderSearchRef = useRef<string | null>(null);
  const capacityLoadStartedRef = useRef(false);
  const airLlmLoadStartedRef = useRef(false);
  const catalogLoadStartedRef = useRef(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [uncensored, setUncensored] = useState(false);
  const [provider, setProvider] = useState(() => marketplacePreference("models.provider", "All providers"));
  const [size, setSize] = useState(() => marketplacePreference("models.size", "Any size"));
  const [taskFilter, setTaskFilter] = useState(() => marketplacePreference("models.task", "All tasks"));
  const [libraryFilter, setLibraryFilter] = useState(() => marketplacePreference("models.library", "All libraries"));
  const [appFilter, setAppFilter] = useState(() => {
    const saved = marketplacePreference<string>("models.app", "All install paths");
    return ["All install paths", "Ollama", "LM Studio", "AirLLM"].includes(saved) ? saved : "All install paths";
  });
  const [contextFilter, setContextFilter] = useState(() => marketplacePreference("models.context", "Any context"));
  const [installing, setInstalling] = useState<string | null>(null);
  const [installStatus, setInstallStatus] = useState<string | null>(null);
  const [installOperationId, setInstallOperationId] = useState<string | null>(null);
  const [reviewModel, setReviewModel] = useState<MarketplaceModel | null>(null);
  const [installedModels, setInstalledModels] = useState<Array<{ model: string; vision: string; capabilities: string[]; provider?: string; endpoint?: string | null }>>([]);
  const [installedConnections, setInstalledConnections] = useState<Array<{ connectionId: string; serverId: string; transport: string; state: string }>>([]);
  const [selectedInstalledId, setSelectedInstalledId] = useState<string | null>(null);
  const [installedCategory, setInstalledCategory] = useState("All");
  const [pinnedItems, setPinnedItems] = useState<string[]>(() => marketplacePreference("installed.pinned", []));
  const [installedPersonas, setInstalledPersonas] = useState<DesktopPersona[]>([]);
  const [installedInventoryError, setInstalledInventoryError] = useState<string | null>(null);
  const [installedLoading, setInstalledLoading] = useState(false);
  const [installedError, setInstalledError] = useState<string | null>(null);
  const [installedActionBusy, setInstalledActionBusy] = useState(false);
  const [installedActionStatus, setInstalledActionStatus] = useState<string | null>(null);
  const [installedVoicePreviewStatus, setInstalledVoicePreviewStatus] = useState<string | null>(null);
  const [mcpMarketplaceBusy, setMcpMarketplaceBusy] = useState(false);
  const [mcpMarketplaceStatus, setMcpMarketplaceStatus] = useState<string | null>(null);
  const [imageAssets, setImageAssets] = useState<Array<{ repository: string; downloads: number; files: Array<{ path: string; sizeBytes: number }> }>>([]);
  const [installedImageAssets, setInstalledImageAssets] = useState<Array<{ id: string; repository: string; sizeBytes: number }>>([]);
  const [imageAssetsLoading, setImageAssetsLoading] = useState(false);
  const [imageAssetStatus, setImageAssetStatus] = useState<string | null>(null);
  const [airLlmReady, setAirLlmReady] = useState<boolean | null>(null);
  const [activeRuntimeAvailable, setActiveRuntimeAvailable] = useState<boolean | null>(null);
  const [localCapacity, setLocalCapacity] = useState<LocalCapacity | null>(null);
  const [savedImageWorkflows, setSavedImageWorkflows] = useState<SavedImageWorkflow[]>(readSavedImageWorkflows);
  const [activeImageWorkflow, setActiveImageWorkflow] = useState(() => localStorage.getItem("skai.imageWorkflow") ?? "");
  const [imageWorkflowStatus, setImageWorkflowStatus] = useState<string | null>(null);
  const [imageWorkflowImporting, setImageWorkflowImporting] = useState(false);

  useEffect(() => { localStorage.setItem(`skai.marketplace.query.${section.toLowerCase()}`, JSON.stringify(query)); }, [query, section]);
  useEffect(() => { localStorage.setItem("skai.marketplace.installed.pinned", JSON.stringify(pinnedItems)); }, [pinnedItems]);
  useEffect(() => {
    localStorage.setItem("skai.marketplace.models.provider", JSON.stringify(provider));
    localStorage.setItem("skai.marketplace.models.size", JSON.stringify(size));
    localStorage.setItem("skai.marketplace.models.task", JSON.stringify(taskFilter));
    localStorage.setItem("skai.marketplace.models.library", JSON.stringify(libraryFilter));
    localStorage.setItem("skai.marketplace.models.app", JSON.stringify(appFilter));
    localStorage.setItem("skai.marketplace.models.context", JSON.stringify(contextFilter));
  }, [appFilter, contextFilter, libraryFilter, provider, size, taskFilter]);
  useEffect(() => {
    if (section !== "Models") return;
    let active = true;
    setActiveRuntimeAvailable(null);
    const endpoint = localStorage.getItem("skai.endpoint") ?? "http://localhost:11434/v1";
    const runtime = localStorage.getItem("skai.provider") ?? "Ollama";
    void request("models.runtime.status", { endpoint, provider: runtime }).then((response) => {
      if (active) setActiveRuntimeAvailable(Boolean(response.ok && (response.result as { available?: boolean })?.available));
    }).catch(() => { if (active) setActiveRuntimeAvailable(false); });
    return () => { active = false; };
  }, [section]);

  useEffect(() => {
    if (section !== "Models") return;
    if (!capacityLoadStartedRef.current) {
      capacityLoadStartedRef.current = true;
      void request("system.capacity").then((response) => {
        if (response.ok) setLocalCapacity(response.result as LocalCapacity);
      }).catch(() => undefined);
    }
    if (!airLlmLoadStartedRef.current) {
      airLlmLoadStartedRef.current = true;
      void request("airllm.status").then((response) => {
        if (response.ok) setAirLlmReady(Boolean((response.result as { dependenciesAvailable?: boolean }).dependenciesAvailable));
        else setAirLlmReady(false);
      }).catch(() => setAirLlmReady(false));
    }
    if (!initialModelSearchStartedRef.current) {
      initialModelSearchStartedRef.current = true;
      void searchModels(query, uncensored, provider, !query.trim() && (provider === "All providers" || provider === "Ollama"));
    } else if (lastProviderSearchRef.current !== null && lastProviderSearchRef.current !== provider) {
      void searchModels(query, uncensored, provider);
    }
  }, [section, provider]);

  useEffect(() => {
    const needsCatalog = section !== "Models" && section !== "Image models" && section !== "Image workflows";
    if (!needsCatalog || catalogLoadStartedRef.current) return;
    catalogLoadStartedRef.current = true;
    void request("marketplace.catalog").then((response) => {
      if (response.ok) setCatalog(response.result as MarketplaceCatalog);
      else {
        catalogLoadStartedRef.current = false;
        setModelError(response.error?.message ?? "Marketplace catalog could not be loaded.");
      }
    });
  }, [section]);

  useEffect(() => {
    if (section !== "Voices") return;
    let active = true;
    const refreshVoices = async () => {
      await refreshInstalledVoiceModels();
      if (active) setVoiceSettings(selectedVoiceSettings());
    };
    void refreshVoices();
    window.addEventListener("skai:voice-models-updated", refreshVoices);
    return () => { active = false; window.removeEventListener("skai:voice-models-updated", refreshVoices); };
  }, [section]);

  const useAirLlmModel = (model: MarketplaceModel) => {
    if (!model.requiresAirLlm || !onSelectAirLlmModel) return;
    onSelectAirLlmModel({ model: model.repository, displayName: model.repository, vision: "unsupported", capabilities: ["Text generation"], provider: "AirLLM", endpoint: null, sizeBytes: model.sizeBytes });
  };

  const marketplaceItems = useMemo<CatalogItem[]>(() => {
    const voiceItems: CatalogItem[] = (catalog?.voices ?? []).filter((voice) => voice.installed).map((voice) => ({
      id: `voice:${voice.id}`, title: voice.name, filter: "Voices", description: voice.description,
      detail: `${voice.description} Runtime: ${voice.runtime}. License: ${voice.license}. ${voice.size}. ${voice.availabilityNote}`,
      icon: "activity", status: voice.installed ? "installed" : voice.installable ? "ready" : voice.adapterAvailable ? "limited" : "unavailable", tone: voice.installed || voice.installable ? "success" : "warning",
      publisher: voice.runtime, version: voice.size, compatibility: voice.license,
      nextStep: voice.installed ? "Select this voice in the voice controls and preview it." : voice.installable ? `Review the source before installing from ${voice.sourceUrl}.` : voice.sourceUrl ? `Review the upstream source. ${voice.availabilityNote}` : "No verified local installer is connected for this voice.", installable: voice.installable,
    }));
    const skillItems: CatalogItem[] = (catalog?.skills ?? []).filter((skill) => skill.installed).map((skill) => ({
      id: `skill:${skill.id}`, title: skill.name, filter: "Skills", description: skill.description,
      detail: `${skill.description} Permission scope: ${skill.permissions.join(", ") || "No extra permissions"}.`,
      icon: "sparkle", status: skill.installed ? "installed" : skill.installable ? "ready" : "unavailable",
      tone: skill.installed ? "success" : skill.installable ? "neutral" : "warning", publisher: skill.source, version: skill.installed ? "Available locally" : "Catalog entry",
      compatibility: skill.permissions.join(", ") || "No extra permissions",
      nextStep: skill.enabled ? "This skill is available to the local agent." : skill.installable ? "Review the publisher and permission scope before installing." : "This catalog entry is not currently installable.", installable: false,
    }));
    const toolItems: CatalogItem[] = (catalog?.tools ?? []).filter((tool) => tool.builtIn || /installed|connected/i.test(tool.status)).map((tool) => ({
      id: `tool:${tool.id}`, title: tool.name, filter: "Tools", description: tool.description,
      detail: `${tool.description} Access: ${tool.access}.`, icon: "terminal",
      status: tool.builtIn ? "installed" : /installed|connected/i.test(tool.status) ? "installed" : "unavailable", tone: tool.builtIn || /installed|connected/i.test(tool.status) ? "success" : "warning",
      publisher: tool.source || "Local capability catalog", version: tool.builtIn ? "Available locally" : "Not connected",
      compatibility: tool.access,
      nextStep: tool.builtIn ? "Open the listed local workflow to use this capability." : "Connect and review a compatible local integration before use.", installable: false,
    }));
    const listedVoiceIds = new Set((catalog?.voices ?? []).map((voice) => voice.id));
    const localVoiceItems: CatalogItem[] = installedVoiceModels.filter((voice) => !listedVoiceIds.has(voice.id)).map((voice) => ({
      id: `voice:${voice.id}`, title: voice.name, filter: "Voices", description: voice.detail,
      detail: `${voice.detail}. This voice runtime is already available on this computer.`, icon: "activity", status: "installed", tone: "success",
      publisher: "Skai local voice runtime", version: voice.size, compatibility: "Local speech", nextStep: "Select this runtime in Settings or preview it here.", installable: false,
    }));
    return [...items.filter((item) => item.status !== "unavailable"), ...voiceItems, ...localVoiceItems, ...skillItems, ...toolItems];
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
      } else setInstalledModels((response.result as Array<{ model: string; vision: string; capabilities: string[]; provider?: string; endpoint?: string | null }>) ?? []);
    } catch { setInstalledError("The local model inventory could not be loaded."); }
    finally { setInstalledLoading(false); }
  };

  useEffect(() => {
    if (section !== "Installed" && section !== "Updates") return;
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
  const checkMcpHealth = async (connectionId: string) => {
    const response = await request("mcp.tools.list", { connectionId });
    if (!response.ok) { setInstalledInventoryError(response.error?.message ?? "MCP health check failed."); return; }
    const result = response.result as { connection?: { connectionId: string; serverId: string; transport: string; state: string } };
    if (result.connection) setInstalledConnections((current) => current.map((item) => item.connectionId === connectionId ? result.connection! : item));
  };
  const removeMcpConnection = async (connectionId: string) => {
    const response = await request("mcp.connection.revoke", { connectionId });
    if (!response.ok) { setInstalledInventoryError(response.error?.message ?? "MCP server could not be removed."); return; }
    setInstalledConnections((current) => current.filter((item) => item.connectionId !== connectionId));
  };
  const updateOllamaModel = async (model: string, endpoint?: string | null) => {
    if (!endpoint || installedActionBusy) return;
    setInstalledActionBusy(true);
    setInstalledActionStatus(`Checking ${model} for an updated Ollama version…`);
    try {
      const started = await request("models.pull.start", { endpoint, model });
      if (!started.ok) throw new Error(started.error?.message ?? "The model update could not start.");
      const id = (started.result as { id?: string }).id;
      if (!id) throw new Error("The model update did not return an operation ID.");
      for (let attempt = 0; attempt < 600; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        const status = await request("models.pull.status", { id });
        if (!status.ok) throw new Error(status.error?.message ?? "The model update status could not be read.");
        const result = status.result as { status: string; progress?: string[]; error?: string };
        setInstalledActionStatus(result.progress?.at(-1) ?? `Model update · ${result.status}`);
        if (result.status === "completed") { setInstalledActionStatus(`${model} is up to date.`); await loadInstalledModels(); return; }
        if (result.status === "failed" || result.status === "cancelled") throw new Error(result.error ?? `Model update ${result.status}.`);
      }
      throw new Error("The model update timed out; its local operation may still be running.");
    } catch (error) { setInstalledActionStatus(error instanceof Error ? error.message : "The model update failed."); }
    finally { setInstalledActionBusy(false); }
  };
  const removeOllamaModel = async (model: string, endpoint?: string | null) => {
    if (!endpoint || installedActionBusy) return;
    if (!window.confirm(`Remove ${model} from the local Ollama library? This deletes the model files from Ollama.`)) return;
    setInstalledActionBusy(true);
    setInstalledActionStatus(`Removing ${model} from Ollama…`);
    try {
      const response = await request("marketplace.models.remove", { endpoint, model });
      if (!response.ok) throw new Error(response.error?.message ?? "The model could not be removed.");
      setInstalledActionStatus(`${model} removed from Ollama.`);
      setSelectedInstalledId(null);
      await loadInstalledModels();
    } catch (error) {
      setInstalledActionStatus(error instanceof Error ? error.message : "The model could not be removed.");
    } finally { setInstalledActionBusy(false); }
  };
  const installedRecords: InstalledRecord[] = [
    ...installedModels.map((item) => ({ id: `model:${item.provider}:${item.model}`, name: item.model, detail: `${item.provider ?? "Local runtime"} · ${item.capabilities.join(" · ") || "Text generation"}`, state: "installed", icon: "model" as NavIconName, source: item.provider ?? "Configured local runtime", requirements: item.capabilities.join(" · ") || "Text generation", nextStep: item.provider === "Ollama" ? "Update or remove this model through its local Ollama runtime." : "This model is managed by its local provider; Skai cannot update or remove it here.", update: item.provider === "Ollama" ? () => void updateOllamaModel(item.model, item.endpoint) : undefined, remove: item.provider === "Ollama" ? () => void removeOllamaModel(item.model, item.endpoint) : undefined })),
    ...installedConnections.map((item) => ({ id: `mcp:${item.connectionId}`, name: item.serverId, detail: `${item.transport} · ${item.connectionId}`, state: item.state === "healthy" ? "installed" : "limited", icon: "terminal" as NavIconName, source: item.connectionId, requirements: item.transport, nextStep: item.state === "healthy" ? "Connection responds to the host health check." : "Check health or remove this MCP connection.", health: () => void checkMcpHealth(item.connectionId), remove: () => void removeMcpConnection(item.connectionId) })),
    ...(catalog?.tools ?? []).filter((item) => item.builtIn).map((item) => ({ id: `tool:${item.id}`, name: item.name, detail: item.description, state: "installed", icon: "terminal" as NavIconName, source: "Skai", requirements: item.access, nextStep: "Open the related local workflow to use this capability." })),
    ...(catalog?.skills ?? []).filter((item) => item.installed).map((item) => ({ id: `skill:${item.id}`, name: item.name, detail: `${item.source} · ${item.enabled ? "Enabled" : "Disabled"}`, state: "installed", icon: "sparkle" as NavIconName, source: item.source, requirements: item.permissions.join(" · ") || "No extra permissions", nextStep: item.enabled ? "This skill is available to the local agent." : "Enable the skill in its local settings before use." })),
    ...(catalog?.voices ?? []).filter((item) => item.installed).map((item) => ({ id: `voice:${item.id}`, name: item.name, detail: `${item.runtime} · ${item.size}`, state: "installed", icon: "activity" as NavIconName, source: item.sourceUrl || item.runtime, requirements: item.license, nextStep: "Select this voice in the voice controls and preview it." })),
    ...installedPersonas.map((item) => ({ id: `persona:${item.id}`, name: item.name, detail: `${item.sourceMode === "public-research" ? "Public research" : "Own material"} · ${item.roles}`, state: "installed", icon: "sparkle" as NavIconName, source: item.sourceMode, requirements: item.roles, nextStep: "Available in the local persona workspace." })),
    ...installedImageAssets.map((item) => ({ id: `asset:${item.id}`, name: item.id, detail: `${item.repository} · ${formatSize(item.sizeBytes)}`, state: "installed", icon: "image" as NavIconName, source: item.repository, requirements: formatSize(item.sizeBytes), nextStep: "Remove this local image asset or restart image generation to use it.", remove: () => void removeImageAsset(item.id) })),
  ];
  const selectedInstalled = installedRecords.find((item) => item.id === selectedInstalledId) ?? installedRecords[0] ?? null;
  const selectedInstalledVoiceId = selectedInstalled?.id.startsWith("voice:") ? selectedInstalled.id.slice("voice:".length) : null;
  const selectedInstalledVoice = selectedInstalledVoiceId ? installedVoiceModels.find((voice) => voice.id === selectedInstalledVoiceId) ?? null : null;
  const previewInstalledVoice = async () => {
    if (!selectedInstalledVoice) return;
    const previousSettings = selectedVoiceSettings();
    saveVoiceSetting("primaryModelId", selectedInstalledVoice.id);
    setInstalledVoicePreviewStatus(`Playing ${selectedInstalledVoice.name}…`);
    try {
      const played = await speakNativeResponse(`Skai voice preview. ${selectedInstalledVoice.name} is ready for local playback.`, true);
      setInstalledVoicePreviewStatus(played ? `${selectedInstalledVoice.name} preview finished.` : `${selectedInstalledVoice.name} could not be previewed on this device.`);
    } finally {
      saveVoiceSetting("primaryModelId", previousSettings.primaryModelId);
    }
  };

  const sectionCategory: Partial<Record<Section, Filter>> = { Models: "Local models", Voices: "Voices", "Image workflows": "Image workflows", Skills: "Skills", Tools: "Tools" };
  const visible = useMemo(() => marketplaceItems.filter((item) => {
    const category = sectionCategory[section];
    return (!category || item.filter === category) && `${item.title} ${item.description} ${item.detail} ${item.publisher}`.toLowerCase().includes(query.trim().toLowerCase());
  }), [marketplaceItems, query, section]);
  const selected = visible.find((item) => item.id === selectedId) ?? visible[0] ?? null;
  // Live provider search gets the full width under Models; Discover stays a capability overview.
  const showModels = section === "Models";
  const { tasks: taskOptions, libraries: libraryOptions, apps: appOptions } = useMemo(() => marketplaceModelFilterOptions(), []);
  const filteredModels = useMemo(() => filterMarketplaceModels(models, {
    provider, size, task: taskFilter, library: libraryFilter, app: appFilter, context: contextFilter, uncensored,
  }), [appFilter, contextFilter, libraryFilter, models, provider, size, taskFilter, uncensored]);
  const activeModelFilterCount = countActiveMarketplaceModelFilters({ provider, size, task: taskFilter, library: libraryFilter, app: appFilter, context: contextFilter, uncensored });
  const filteredSavedImageWorkflows = savedImageWorkflows.filter((workflow) => `${workflow.name} ${workflow.workflow}`.toLowerCase().includes(query.trim().toLowerCase()));
  const activeLocalRuntime = localStorage.getItem("skai.provider") ?? "Ollama";
  const providerOptions = useMemo(() => ["All providers", "Hugging Face", "ModelScope", ...(activeRuntimeAvailable && activeLocalRuntime === "Ollama" ? ["Ollama"] : []), ...(airLlmReady ? ["AirLLM"] : [])], [activeLocalRuntime, activeRuntimeAvailable, airLlmReady]);
  useEffect(() => {
    if (activeRuntimeAvailable === null || airLlmReady === null) return;
    if (provider !== "All providers" && !providerOptions.includes(provider)) setProvider("All providers");
  }, [activeRuntimeAvailable, airLlmReady, provider, providerOptions]);
  const installRouteAvailable = (model: MarketplaceModel) => model.requiresAirLlm
    ? airLlmReady === true
    : activeRuntimeAvailable === true && isMarketplaceModelInstallRouteAvailable(model, activeLocalRuntime);
  const modelFitSummary = (model: MarketplaceModel) => {
    if (!model.sizeBytes) return "No package size is published, so device fit cannot be estimated.";
    const freeRam = localCapacity?.ramAvailableBytes;
    if (!freeRam) return `${formatSize(model.sizeBytes)} package; available RAM could not be measured. Model size is not a memory guarantee.`;
    const ram = model.sizeBytes <= freeRam
      ? `Package size is below current free RAM (${formatSize(freeRam)}), before runtime and context overhead.`
      : `Package size exceeds current free RAM (${formatSize(freeRam)}); loading may be slow, use swap, or fail.`;
    const gpu = localCapacity?.gpu?.availableBytes
      ? ` GPU free: ${formatSize(localCapacity.gpu.availableBytes)}${localCapacity.gpu.name ? ` on ${localCapacity.gpu.name}` : ""}; CPU fallback depends on the selected runtime.`
      : " GPU memory is not reported by a supported local telemetry provider.";
    return `${formatSize(model.sizeBytes)} download. ${ram}${gpu}`;
  };

  const activateImageWorkflow = (workflow: SavedImageWorkflow) => {
    localStorage.setItem("skai.imageWorkflow", workflow.workflow);
    setActiveImageWorkflow(workflow.workflow);
    onImageChange?.("workflow", workflow.workflow);
    setImageWorkflowStatus(`“${workflow.name}” is now the active local workflow. It is ready in Image Studio.`);
  };

  const importImageWorkflow = async () => {
    if (!onImportWorkflow || imageWorkflowImporting) return;
    setImageWorkflowImporting(true);
    setImageWorkflowStatus(null);
    try {
      const imported = await onImportWorkflow();
      if (!imported) return;
      const next = [{ name: imported.name, workflow: imported.workflow }, ...savedImageWorkflows.filter((item) => item.name !== imported.name)].slice(0, 12);
      localStorage.setItem("skai.image.workflows", JSON.stringify(next));
      setSavedImageWorkflows(next);
      activateImageWorkflow(imported);
    } catch (error) {
      setImageWorkflowStatus(error instanceof Error ? error.message : "The local workflow could not be imported.");
    } finally { setImageWorkflowImporting(false); }
  };

  async function searchModels(nextQuery = query, nextUncensored = uncensored, nextProvider = provider, curatedOnly = false) {
    const requestId = ++modelSearchRequestRef.current;
    lastProviderSearchRef.current = nextProvider;
    setModelLoading(true);
    setModelError(null);
    let timeoutId = 0;
    try {
      const response = await Promise.race([
        request("marketplace.models.search", { query: normalizeModelSearchQuery(nextQuery), uncensored: nextUncensored, provider: nextProvider, curatedOnly }),
        new Promise<never>((_, reject) => { timeoutId = window.setTimeout(() => reject(new Error("MODEL_SEARCH_TIMEOUT")), 30_000); }),
      ]);
      if (requestId !== modelSearchRequestRef.current) return;
      if (!response.ok) {
        setModelError(response.error?.message ?? "Model search failed.");
        return;
      }
      const result = response.result as { models?: MarketplaceModel[]; providers?: Record<string, string> };
      setModels(result.models ?? []);
      if (Object.values(result.providers ?? {}).some((status) => status !== "ready")) {
        setModelError("Some model sources did not respond in time. Showing results from the sources that are available.");
      }
    } catch (error) {
      if (requestId === modelSearchRequestRef.current) setModelError(error instanceof Error && error.message === "MODEL_SEARCH_TIMEOUT" ? "Model search took too long. Check your connection and try again." : "Model search failed.");
    } finally {
      window.clearTimeout(timeoutId);
      if (requestId === modelSearchRequestRef.current) setModelLoading(false);
    }
  }

  function cancelModelSearch() {
    modelSearchRequestRef.current += 1;
    setModelLoading(false);
    setModelError(null);
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
        if (result.status === "completed") {
          setInstallStatus("Install complete. Added to Installed.");
          setSection("Installed");
          setQuery("");
          onSectionChange?.("Installed");
        } else if (result.error) setInstallStatus(result.error);
        else if (result.status === "cancelled") setInstallStatus("Download cancelled.");
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
    Discover: "Choose the next capability you actually need, then review its local requirements before changing this computer.",
    Models: "Quick picks load first. Choose a provider to search its catalog; review the runtime, size, and device fit before installing.",
    "Image models": "Search Hugging Face for safetensors LoRAs compatible with local Diffusers image generation. Downloads stay in Skai’s local image-model folder.",
    Voices: "Browse installed voice runtimes and available adapters, then choose the runtime and profile Skai should use for speech.",
    "Image workflows": "Review local ComfyUI workflows and configure them in Image Studio.",
    Skills: "Browse local agent instructions and review their permission scope.",
    Tools: "See built-in capabilities and integrations that can be connected.",
    Installed: "Review marketplace downloads, update compatible items, or remove local installs. Skai Desktop updates are in Settings → Updates.",
    Updates: "Review marketplace downloads, update compatible items, or remove local installs. Skai Desktop updates are in Settings → Updates.",
  };

  const sectionHeading: Record<Section, string> = { Discover: "Explore the marketplace", Models: "Local models", "Image models": "Image models & LoRAs", Voices: "Voice profiles", "Image workflows": "Image workflows", Skills: "Agent skills", Tools: "Tools & integrations", Installed: "Installed & updates", Updates: "Installed & updates" };
  const categoryCards: Array<{ title: string; description: string; section: Section; icon: NavIconName; status: string; availability: "ready" | "setup" | "limited" }> = [
    { title: "Local models", description: "Browse model packages by task and size, then install only through a responding local runtime.", section: "Models", icon: "model", status: activeRuntimeAvailable ? `${activeLocalRuntime} responding` : activeRuntimeAvailable === false ? "No local runtime responding" : "Runtime not checked yet", availability: activeRuntimeAvailable ? "ready" : activeRuntimeAvailable === false ? "setup" : "limited" },
    { title: "Image models & LoRAs", description: "Find image adapters and manage the LoRA files stored on this device.", section: "Image models", icon: "image", status: `${installedImageAssets.length} installed · Diffusers required`, availability: "setup" },
    { title: "Image workflows", description: "Import and activate local ComfyUI workflows for Image Studio.", section: "Image workflows", icon: "image", status: `${savedImageWorkflows.length} saved locally`, availability: "ready" },
    { title: "Tools & integrations", description: "Browse built-in tools, MCP servers, and compatible integrations.", section: "Tools", icon: "terminal", status: "Connections and permissions", availability: "ready" },
    { title: "Voice runtimes", description: "Choose an installed voice engine and preview its available profiles.", section: "Voices", icon: "activity", status: catalog ? `${catalog.voices.filter((voice) => voice.installed).length} installed locally` : "Checking local voices", availability: "ready" },
    { title: "Agent skills", description: "Review local skills and the permission scope each one uses.", section: "Skills", icon: "sparkle", status: catalog ? `${catalog.skills.filter((skill) => skill.installed).length} installed locally` : "Checking local catalog", availability: "ready" },
    { title: "Installed & updates", description: "Review marketplace downloads, update compatible items, or remove local installs. Skai Desktop updates are in Settings.", section: "Installed", icon: "marketplace", status: "Manage local installs", availability: "ready" },
  ];
  const modelResults = <section className="marketplace-remote-results" aria-label="Remote model sources">
    <div className="panel-heading"><div><p className="section-kicker">LOCAL MODEL CATALOG</p><h3>Models for local runtimes</h3><p className="panel-subtitle">Browse model packages by task and size. Skai only enables installs when the required local runtime is responding.</p></div><StatusBadge tone={activeRuntimeAvailable ? "success" : activeRuntimeAvailable === false ? "warning" : "neutral"}>{activeRuntimeAvailable ? `${activeLocalRuntime} available` : activeRuntimeAvailable === false ? "No local runtime detected" : "Checking runtime"}</StatusBadge></div>
    <div className="marketplace-model-tabs" role="tablist" aria-label="Model library views"><button type="button" role="tab" aria-selected="true" className="is-active">Get new</button><button type="button" role="tab" aria-selected="false" onClick={() => { setSection("Installed"); setQuery(""); onSectionChange?.("Installed"); }}>Installed &amp; updates <span>{installedModels.length}</span></button></div>
    <div className="marketplace-model-filter-bar"><div className="marketplace-model-safety-filters" role="group" aria-label="Model catalog safety"><button type="button" className={!uncensored ? "is-active" : ""} aria-pressed={!uncensored} onClick={() => { setUncensored(false); void searchModels(query, false); }}>Mainstream</button><button type="button" className={uncensored ? "is-active" : ""} aria-pressed={uncensored} onClick={() => { setUncensored(true); void searchModels(query, true); }}>Unfiltered</button></div><span className="marketplace-model-capacity">{localCapacity?.gpu?.totalBytes ? `${formatSize(localCapacity.gpu.totalBytes)} GPU` : "GPU not reported"} · {localCapacity?.ramTotalBytes ? `${formatSize(localCapacity.ramTotalBytes)} RAM` : "RAM not reported"}</span></div>
    <div className="marketplace-model-size-filters" role="group" aria-label="Filter models by download size"><button type="button" className={size === "Any size" ? "is-active" : ""} aria-pressed={size === "Any size"} onClick={() => setSize("Any size")}>All sizes</button><button type="button" className={size === "Fits my PC" ? "is-active" : ""} disabled={!localCapacity?.ramAvailableBytes} title={!localCapacity?.ramAvailableBytes ? "RAM availability is not currently measured" : "Package-size estimate only; loaded models need additional memory"} aria-pressed={size === "Fits my PC"} onClick={() => setSize("Fits my PC")}>Fits my PC <small>estimate</small></button><button type="button" className={size === "Tiny" ? "is-active" : ""} aria-pressed={size === "Tiny"} onClick={() => setSize("Tiny")}>Tiny <small>≤4 GB</small></button><button type="button" className={size === "Small" ? "is-active" : ""} aria-pressed={size === "Small"} onClick={() => setSize("Small")}>Small <small>4–10 GB</small></button><button type="button" className={size === "Medium" ? "is-active" : ""} aria-pressed={size === "Medium"} onClick={() => setSize("Medium")}>Medium <small>10–20 GB</small></button><button type="button" className={size === "Big" ? "is-active" : ""} aria-pressed={size === "Big"} onClick={() => setSize("Big")}>Big <small>&gt;20 GB</small></button></div>
    <details className="marketplace-model-filter-disclosure"><summary><span>More filters</span><small>{activeModelFilterCount ? `${activeModelFilterCount} active` : "Optional"}</small></summary><div className="marketplace-model-controls marketplace-model-filters"><label>Task<select value={taskFilter} onChange={(event) => setTaskFilter(event.target.value)}>{taskOptions.map((option) => <option key={option}>{option}</option>)}</select></label><label>Provider<select value={provider} onChange={(event) => setProvider(event.target.value)}>{providerOptions.map((option) => <option key={option}>{option}</option>)}</select></label><label>Library<select value={libraryFilter} onChange={(event) => setLibraryFilter(event.target.value)}>{libraryOptions.map((option) => <option key={option}>{option}</option>)}</select></label><label>Install path<select value={appFilter} onChange={(event) => setAppFilter(event.target.value)}>{appOptions.map((option) => <option key={option}>{option}</option>)}</select></label><label>Context<select value={contextFilter} onChange={(event) => setContextFilter(event.target.value)}><option>Any context</option><option>1M-class window</option></select></label><div className="marketplace-filter-footer"><span>{filteredModels.length} matching models</span>{activeModelFilterCount > 0 && <Button variant="ghost" type="button" onClick={() => { setTaskFilter("All tasks"); setProvider("All providers"); setLibraryFilter("All libraries"); setAppFilter("All install paths"); setContextFilter("Any context"); setSize("Any size"); setUncensored(false); void searchModels(query, false, "All providers"); }}>Clear filters</Button>}</div></div></details>
    <p className="marketplace-honesty">Model size reflects the download. It does not predict loaded memory exactly; context length, quantization, runtime overhead, and GPU/CPU fallback all matter.</p>
    {modelError && <p className="marketplace-honesty" role="status">{modelError}</p>}
    {installStatus && <div className="marketplace-honesty marketplace-download-status" role="status"><span>{installStatus}</span>{installing && <Button variant="ghost" type="button" onClick={() => void cancelModelInstall()}>Cancel download</Button>}</div>}
    {reviewModel && <div className="marketplace-install-review marketplace-model-review" role="dialog" aria-label={reviewModel.requiresAirLlm ? "Review AirLLM model route" : "Verify model installation"}><p className="section-kicker">{reviewModel.requiresAirLlm ? "AIRLLM ROUTE REVIEW" : "INSTALLATION REVIEW"}</p><strong>{reviewModel.repository}</strong><span>{reviewModel.source} · {formatSize(reviewModel.sizeBytes)} · {reviewModel.downloads.toLocaleString()} downloads</span><span>{modelFitSummary(reviewModel)}</span><span>{reviewModel.requiresAirLlm ? `This Transformers model will use the optional AirLLM route. ${airLlmReady === true ? "AirLLM is ready." : airLlmReady === false ? "Install AirLLM in Settings before using this route." : "Checking AirLLM readiness…"} Model weights download from Hugging Face on first use and may require substantial disk space. Inference can be much slower than Ollama or LM Studio.` : installRouteAvailable(reviewModel) ? `This uses ${reviewModel.installRoute} with your active ${activeLocalRuntime} runtime. No download starts until you confirm this local installation.` : `This package needs ${reviewModel.installRoute}, but your active runtime is ${activeLocalRuntime}. Switch the local runtime in Settings before installing; this prevents a download request that would fail.`}</span><div className="marketplace-model-actions">{reviewModel.requiresAirLlm && onNavigate && <Button variant="secondary" type="button" onClick={() => { setReviewModel(null); onNavigate("settings"); }}>Manage AirLLM</Button>}<Button variant="ghost" type="button" onClick={() => setReviewModel(null)}>Cancel</Button><Button variant="primary" type="button" disabled={reviewModel.requiresAirLlm ? !onSelectAirLlmModel || airLlmReady !== true : !reviewModel.installable || installing !== null || !installRouteAvailable(reviewModel)} onClick={() => { const model = reviewModel; setReviewModel(null); if (model.requiresAirLlm) useAirLlmModel(model); else void installModel(model); }}>{reviewModel.requiresAirLlm ? "Use with AirLLM" : "Confirm and install locally"}</Button></div></div>}
    {filteredModels.length === 0 ? <EmptyState title={modelLoading ? "Searching model sources…" : modelError ? "Search could not complete" : "No matching models"} description={modelLoading ? "Checking the available catalogs. Results will appear here when the search finishes." : modelError ? "Check your connection, adjust the search, or try again." : "Change the task, provider, install path, or size filters."} action={modelError && <Button variant="secondary" type="button" onClick={() => void searchModels()}>Try again</Button>} /> : (
      <div className="marketplace-model-card-grid" aria-label="Marketplace model results">
        {filteredModels.slice(0, 60).map((model) => {
          const runtimeReady = installRouteAvailable(model) && model.installable;
          const freeRam = localCapacity?.ramAvailableBytes;
          const packageFitsRam = Boolean(model.sizeBytes && freeRam && model.sizeBytes <= freeRam);
          const fitLabel = !model.sizeBytes ? "Size unknown" : !freeRam ? "Fit unknown" : packageFitsRam ? "Package is below free RAM" : "May exceed free RAM";
          const visibleTags = model.tags.slice(0, 3).join(" · ") || (model.requiresAirLlm ? "Transformers weights" : model.installRoute);
          return <article className="marketplace-model-card" key={model.id}>
            <div className="marketplace-model-card-heading"><span className="marketplace-row-icon"><NavIcon name="model" /></span><div><h4>{model.repository}</h4><p>{model.source} · {visibleTags}</p></div></div>
            <div className="marketplace-model-card-meta"><StatusBadge tone={runtimeReady ? "success" : "warning"}>{runtimeReady ? "Runtime available" : model.requiresAirLlm ? airLlmReady ? "AirLLM ready" : "Optional AirLLM needed" : activeRuntimeAvailable === false ? "Configured runtime unavailable" : `Needs ${model.installRoute}`}</StatusBadge><span>{formatSize(model.sizeBytes)}</span><span>{model.contextLength ? `${model.contextLength.toLocaleString()} token context` : "Context not published"}</span></div>
            <p className="marketplace-model-fit">{fitLabel} · package size is only a rough guide; runtime and context need additional memory.</p>
            <details className="marketplace-model-card-details"><summary>Model details</summary><dl><div><dt>Install path</dt><dd>{model.requiresAirLlm ? "Optional AirLLM runtime" : model.installRoute}</dd></div><div><dt>License</dt><dd>{model.license || "Not published by catalog"}</dd></div><div><dt>Downloads</dt><dd>{model.downloads.toLocaleString()}</dd></div><div><dt>Device fit</dt><dd>{modelFitSummary(model)}</dd></div></dl></details>
            <div className="marketplace-model-card-actions"><span>{model.uncensored && <StatusBadge tone="warning">Abliterated</StatusBadge>}</span><Button variant="primary" type="button" disabled={!runtimeReady || installing !== null} onClick={() => setReviewModel(model)}>{runtimeReady ? `Get · ${formatSize(model.sizeBytes)}` : "Not available here"}</Button></div>
            {model.requiresAirLlm && !airLlmReady && onNavigate && <Button variant="ghost" type="button" onClick={() => onNavigate("settings")}>Manage optional AirLLM</Button>}
          </article>;
        })}
      </div>
    )}
  </section>;

  const filteredCategories = categoryCards.filter((category) => {
    const categoryItems = marketplaceItems.filter((item) => item.filter === sectionCategory[category.section]);
    const searchable = (category.title + " " + category.description + " " + categoryItems.map((item) => item.title + " " + item.description).join(" ")).toLowerCase();
    return searchable.includes(query.trim().toLowerCase());
  });

  return (
    <div className="feature-page marketplace-page">
      <header className="marketplace-header">
        <div className="marketplace-heading-lockup"><span className="marketplace-heading-mark"><NavIcon name="marketplace" /></span><div><p className="eyebrow">LOCAL-FIRST MARKETPLACE</p><h2>{sectionHeading[section]}</h2><p className="page-description">{sectionDescription[section]}</p></div></div>
         <div className="marketplace-header-actions"><StatusBadge tone={modelError ? "warning" : section === "Models" ? activeRuntimeAvailable ? "success" : activeRuntimeAvailable === false ? "warning" : "neutral" : catalog ? "success" : "neutral"}>{modelError ? "Catalog needs attention" : section === "Models" ? activeRuntimeAvailable ? `${activeLocalRuntime} available` : activeRuntimeAvailable === false ? "Runtime unavailable" : "Checking runtime" : catalog ? "Local catalog loaded" : "Loading catalog"}</StatusBadge>{!onBack && section !== "Installed" && section !== "Updates" && <Button variant="secondary" type="button" onClick={() => { setSection("Installed"); setQuery(""); }}><NavIcon name="memory" />Installed &amp; updates</Button>}</div>
      </header>
      <div className={`marketplace-frame${onBack ? " is-embedded" : ""}`}>
        <aside className="marketplace-nav-panel">
          <div className="marketplace-nav-heading"><span>Browse</span><small>{onBack ? "Embedded" : "Skai catalog"}</small></div>
          <nav className="marketplace-sections" aria-label="Marketplace sections">
          {(onBack ? EMBEDDED_SECTIONS : ["Discover", "Models", "Image models", "Voices", "Image workflows", "Skills", "Tools", "Installed"] as Section[]).map((item) => (
            <button key={item} className={(section === item || (item === "Installed" && section === "Updates")) ? "is-active" : ""} type="button" aria-current={(section === item || (item === "Installed" && section === "Updates")) ? "page" : undefined} onClick={() => { setSection(item); setQuery(""); onSectionChange?.(item); }}><NavIcon name={sectionIcons[item]} /><span>{item === "Installed" ? "Installed & updates" : item}</span>{item === "Installed" && <small>{installedModels.length + installedConnections.length}</small>}</button>
          ))}
          </nav>
          <div className="marketplace-nav-note"><span className="marketplace-nav-note-dot" /><div><strong>Everything stays local</strong><small>Review source, runtime, and permissions before installing.</small></div></div>
        </aside>
        <div className="marketplace-browser">

        {section === "Discover" ? (
          <div className="marketplace-discover">
            <div className="marketplace-search-row"><label className="sr-only" htmlFor="marketplace-search">Search marketplace</label><input id="marketplace-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search categories, skills, tools, and capabilities…" /><span>{filteredCategories.length} categories</span></div>
            <section className="marketplace-next-step" aria-labelledby="marketplace-next-step-title">
              <div><p className="section-kicker">START HERE</p><h3 id="marketplace-next-step-title">Build a useful local workspace</h3><p>Choose a model, confirm the runtime it needs, and keep the install reviewable. Skai will not claim an item is ready until the local path is actually available.</p></div>
              <div className="marketplace-next-step-status"><span><strong>Active runtime</strong>{activeRuntimeAvailable ? activeLocalRuntime : activeRuntimeAvailable === false ? "No runtime responding" : "Not checked yet"}</span><span><strong>Installed locally</strong>{installedModels.length + installedConnections.length} core items</span><span><strong>Model catalog</strong>{modelError ? "Needs attention" : modelLoading ? "Checking providers" : "Ready to search"}</span></div>
              <div className="marketplace-next-step-actions"><Button variant="primary" type="button" onClick={() => { setSection("Models"); setQuery(""); }}>Find a model</Button><Button variant="secondary" type="button" onClick={() => { setSection("Installed"); setQuery(""); }}>Installed &amp; updates</Button>{onNavigate && <Button variant="ghost" type="button" onClick={() => onNavigate("settings")}>Runtime settings</Button>}</div>
            </section>
            {filteredCategories.length === 0 ? <EmptyState title="No matching categories" description="Try a different search term." action={<Button variant="ghost" onClick={() => setQuery("")}>Clear search</Button>} /> : (
              <div className="marketplace-category-grid" aria-label="Marketplace categories">
                {filteredCategories.map((category) => (
                  <button key={category.section} type="button" className="marketplace-category-card" onClick={() => { setSection(category.section); setQuery(""); }}>
                    <span className="marketplace-category-icon"><NavIcon name={category.icon} /></span>
                    <span className="marketplace-category-copy"><strong>{category.title}</strong><small>{category.description}</small><em className={`marketplace-category-status is-${category.availability}`}>{category.status}</em></span><NavIcon name="arrow-right" className="marketplace-category-arrow" />
                  </button>
                ))}
              </div>
            )}
            <p className="marketplace-discover-note">Downloads stay local. Each install shows its source, runtime, size, and next action before anything changes on this device.</p>
          </div>
        ) : section === "Image workflows" ? (
          <section className="marketplace-installed-pane marketplace-image-workflows-pane">
            <div className="panel-heading"><div><p className="section-kicker">LOCAL WORKFLOW LIBRARY</p><h3>ComfyUI workflows</h3><p className="panel-subtitle">Manage workflows already saved on this device. Marketplace never downloads workflow code or contacts a remote workflow service.</p></div><div className="marketplace-model-actions">{onImportWorkflow && <Button variant="primary" type="button" disabled={imageWorkflowImporting} onClick={() => void importImageWorkflow()}>{imageWorkflowImporting ? "Importing…" : "Import local workflow"}</Button>}<Button variant="secondary" type="button" onClick={() => { setSavedImageWorkflows(readSavedImageWorkflows()); setImageWorkflowStatus(null); }}>Refresh library</Button></div></div>
            <div className="marketplace-search-row"><label className="sr-only" htmlFor="marketplace-image-workflow-search">Search saved workflows</label><input id="marketplace-image-workflow-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search saved workflows…" /><span>{filteredSavedImageWorkflows.length} local workflows</span></div>
            {imageWorkflowStatus && <p className="marketplace-install-status" role="status">{imageWorkflowStatus}</p>}
            {savedImageWorkflows.length === 0 ? <EmptyState title="No saved workflows yet" description="Import a ComfyUI API workflow file here. It will be checked by Image Studio when used and stored in this app profile." action={onImportWorkflow ? <Button variant="primary" type="button" disabled={imageWorkflowImporting} onClick={() => void importImageWorkflow()}>{imageWorkflowImporting ? "Importing…" : "Import local workflow"}</Button> : undefined} /> : (
              <div className="marketplace-workflow-list" aria-label="Saved local image workflows">
                {filteredSavedImageWorkflows.map((workflow) => {
                  const active = workflow.workflow === activeImageWorkflow;
                  const nodes = (() => { try { const json: unknown = JSON.parse(workflow.workflow); return json && typeof json === "object" ? Object.keys(json).length : 0; } catch { return 0; } })();
                  return <article className="marketplace-workflow-card" key={workflow.name}><div><p className="section-kicker">LOCAL COMFYUI API WORKFLOW</p><h4>{workflow.name}</h4><p>{nodes ? `${nodes} workflow nodes · stored in this app profile` : "Saved local workflow · stored in this app profile"}</p></div><StatusBadge tone={active ? "success" : "neutral"}>{active ? "Active" : "Saved locally"}</StatusBadge><Button variant={active ? "secondary" : "primary"} type="button" disabled={active} onClick={() => activateImageWorkflow(workflow)}>{active ? "Active in Image Studio" : "Set active"}</Button></article>;
                })}
                {filteredSavedImageWorkflows.length === 0 && <EmptyState title="No matching workflows" description="Try a different search term." action={<Button variant="ghost" onClick={() => setQuery("")}>Clear search</Button>} />}
              </div>
            )}
          </section>
        ) : section === "Image models" ? (
          <section className="marketplace-installed-pane"><div className="panel-heading"><div><p className="section-kicker">DIFFUSERS IMAGE ASSETS</p><h3>LoRAs</h3><p className="panel-subtitle">Search Hugging Face safetensors LoRAs, then install or remove them from Skai’s local Diffusers asset folder. Downloads are capped at 8 GB.</p></div><Button variant="secondary" onClick={() => void searchImageAssets()} disabled={imageAssetsLoading}>{imageAssetsLoading ? "Searching…" : "Search LoRAs"}</Button></div>
            <div className="marketplace-search-row"><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchImageAssets(); }} placeholder="Search LoRAs by style or subject…" aria-label="Search image LoRAs" /></div>
            {imageAssetStatus && <p className="marketplace-honesty" role="status">{imageAssetStatus}</p>}
            <h4>Available LoRAs</h4>
            {imageAssets.map((asset) => <article className="marketplace-model-row" key={asset.repository}><div><strong>{asset.repository}</strong><small>{asset.downloads.toLocaleString()} downloads · {asset.files.length} safetensors files</small>{asset.files.map((file) => <p key={file.path}>{file.path} · {formatSize(file.sizeBytes)}</p>)}</div><div>{asset.files.map((file) => <Button key={file.path} variant="secondary" disabled={Boolean(installing)} onClick={() => void installImageAsset(asset.repository, file.path)}>{file.path.split("/").at(-1)}</Button>)}</div></article>)}
            {!imageAssets.length && !imageAssetsLoading && <EmptyState title="Search image LoRAs" description="Results are filtered to repositories that publish safetensors files. Review the source repository before installing." />}
          </section>
        ) : section === "Installed" || section === "Updates" ? (
          <div className="marketplace-installed-layout">
          <div className="marketplace-installed-pane">
            <div className="panel-heading"><div><p className="section-kicker">LOCAL INVENTORY</p><h3>Installed marketplace items</h3><p className="panel-subtitle">Review marketplace downloads, update compatible items, or remove local installs. To update Skai Desktop, open Settings → Updates.</p></div><div className="marketplace-model-actions"><StatusBadge tone={installedError || installedInventoryError ? "warning" : installedLoading ? "neutral" : "success"}>{installedLoading ? "Refreshing" : `${installedModels.length + (catalog?.skills.filter((item) => item.installed).length ?? 0) + (catalog?.voices.filter((item) => item.installed).length ?? 0) + (catalog?.tools.filter((item) => item.builtIn).length ?? 0) + installedImageAssets.length + installedConnections.length + installedPersonas.length} items`}</StatusBadge><Button variant="secondary" disabled={installedLoading} onClick={() => void loadInstalledModels()}>{installedLoading ? "Refreshing…" : "Refresh inventory"}</Button>{onNavigate && <Button variant="ghost" onClick={() => onNavigate("settings")}>Skai app updates · Settings</Button>}</div></div>
            <div className="marketplace-installed-filters"><label><span className="sr-only">Filter installed items by category</span><select value={installedCategory} onChange={(event) => setInstalledCategory(event.target.value)} aria-label="Filter installed items by category">{["All", "Models", "Voice profiles", "Skills", "MCP servers", "Skai built-ins", "Personas", "Image assets"].map((category) => <option key={category} value={category}>{category === "All" ? "All installed items" : category}</option>)}</select></label><label className="marketplace-installed-search"><span className="sr-only">Search installed items</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search installed items…" aria-label="Search installed items" /></label></div>
            {(installedError || installedInventoryError) && <div className="marketplace-honesty" role="status">{[installedError, installedInventoryError].filter(Boolean).join(" ")}</div>}
            {installedLoading ? <EmptyState title="Checking installed items" description="Reading models and local marketplace inventory from this computer…" /> : (() => {
              const term = query.trim().toLowerCase();
              const matches = (...values: Array<string | undefined>) => values.join(" ").toLowerCase().includes(term);
              const group = (title: string, rows: Array<{ id: string; name: string; detail: string; state: string; icon: NavIconName; remove?: () => void; health?: () => void }>) => {
                if (installedCategory !== "All" && installedCategory !== title) return null;
                const filtered = rows.filter((row) => matches(row.name, row.detail, row.state));
                if (!filtered.length) return null;
                return <section className="marketplace-installed-group" key={title}><h4>{title} <span>{filtered.length}</span></h4>{filtered.map((row) => <article className={`marketplace-installed-model${selectedInstalled?.id === row.id ? " is-selected" : ""}`} key={row.id} role="button" tabIndex={0} aria-pressed={selectedInstalled?.id === row.id} onClick={() => setSelectedInstalledId(row.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedInstalledId(row.id); } }}><span className="marketplace-installed-model-icon"><NavIcon name={row.icon} /></span><div className="marketplace-installed-model-copy"><strong>{row.name}</strong><small>{row.detail}</small></div><StatusBadge tone={row.state === "limited" ? "warning" : "success"}>{row.state}</StatusBadge></article>)}</section>;
              };
              const rows = [
                group("Models", installedModels.map((item) => ({ id: `model:${item.provider}:${item.model}`, name: item.model, detail: `${item.provider ?? "Local runtime"} · ${item.vision.toLowerCase() === "supported" ? "Vision" : "Text"} · ${item.capabilities.join(" · ") || "Text generation"}`, state: "installed", icon: "model" as NavIconName }))),
                group("MCP servers", installedConnections.map((item) => ({ id: `mcp:${item.connectionId}`, name: item.serverId, detail: `${item.transport} · ${item.connectionId}`, state: item.state === "healthy" ? "installed" : "limited", icon: "terminal" as NavIconName, health: () => void checkMcpHealth(item.connectionId), remove: () => void removeMcpConnection(item.connectionId) }))),
                group("Skai built-ins", (catalog?.tools ?? []).filter((item) => item.builtIn).map((item) => ({ id: `tool:${item.id}`, name: item.name, detail: item.description, state: "installed", icon: "terminal" as NavIconName }))),
                group("Skills", (catalog?.skills ?? []).filter((item) => item.installed).map((item) => ({ id: `skill:${item.id}`, name: item.name, detail: `${item.source} · ${item.enabled ? "Enabled" : "Disabled"}`, state: "installed", icon: "sparkle" as NavIconName }))),
                group("Voice profiles", (catalog?.voices ?? []).filter((item) => item.installed).map((item) => ({ id: `voice:${item.id}`, name: item.name, detail: `${item.runtime} · ${item.size}`, state: "installed", icon: "activity" as NavIconName }))),
                group("Personas", installedPersonas.map((item) => ({ id: `persona:${item.id}`, name: item.name, detail: `${item.sourceMode === "public-research" ? "Public research" : "Own material"} · ${item.roles}`, state: "installed", icon: "sparkle" as NavIconName }))),
                group("Image assets", installedImageAssets.map((item) => ({ id: `asset:${item.id}`, name: item.id, detail: `${item.repository} · ${formatSize(item.sizeBytes)}`, state: "installed", icon: "image" as NavIconName, remove: () => void removeImageAsset(item.id) }))),
              ];
              return rows.some(Boolean) ? rows : <EmptyState title={query ? "No matching installed items" : "No installed items discovered"} description={query ? "Try another search term." : "Connect a local model runtime or install a compatible tool to see it here."} action={query ? <Button variant="ghost" onClick={() => setQuery("")}>Clear search</Button> : undefined} />;
            })()}
          </div>
          {selectedInstalled ? <aside className="marketplace-detail marketplace-installed-inspector" aria-label="Installed item details">
            <div className="marketplace-detail-heading"><div><p className="section-kicker">INSTALLED ITEM</p><h3>{selectedInstalled.name}</h3></div><StatusBadge tone={selectedInstalled.state === "limited" ? "warning" : "success"}>{selectedInstalled.state}</StatusBadge></div>
            <p>{selectedInstalled.detail}</p>
            <dl className="marketplace-detail-list"><div><dt>Source</dt><dd>{selectedInstalled.source}</dd></div><div><dt>Requirements</dt><dd>{selectedInstalled.requirements}</dd></div><div><dt>Next step</dt><dd>{selectedInstalled.nextStep}</dd></div></dl>
            {selectedInstalled.id.startsWith("voice:") && <div className="marketplace-installed-voice-status" aria-label={`${selectedInstalled.name} availability`}><div><strong>Local runtime</strong><span>{selectedInstalledVoice ? "Available" : "Unavailable"}</span></div><div><strong>Local voice/model data</strong><span>{selectedInstalledVoice?.installed ? "Available" : "Unavailable"}</span></div><div><strong>Local playback</strong><span>{selectedInstalledVoice ? "Available" : "Unavailable"}</span></div><div className="marketplace-voice-actions"><Button variant="primary" disabled={!selectedInstalledVoice} onClick={() => void previewInstalledVoice()} aria-label={`Preview ${selectedInstalled.name} voice`}>Preview voice</Button><Button variant="ghost" onClick={stopNativeSpeech}>Stop</Button></div>{installedVoicePreviewStatus && <p role="status">{installedVoicePreviewStatus}</p>}</div>}
            {installedActionStatus && selectedInstalled.id.startsWith("model:") && <p className="marketplace-honesty" role="status">{installedActionStatus}</p>}
            <div className="marketplace-model-actions">{selectedInstalled.health && <Button variant="secondary" onClick={selectedInstalled.health}>Check health</Button>}{selectedInstalled.update && <Button variant="secondary" disabled={installedActionBusy} onClick={selectedInstalled.update}>{installedActionBusy ? "Updating…" : "Update"}</Button>}{selectedInstalled.remove && <Button variant="danger" disabled={installedActionBusy} onClick={selectedInstalled.remove}>{installedActionBusy ? "Working…" : "Remove"}</Button>}<Button variant="ghost" aria-pressed={pinnedItems.includes(selectedInstalled.id)} onClick={() => setPinnedItems((current) => current.includes(selectedInstalled.id) ? current.filter((id) => id !== selectedInstalled.id) : [...current, selectedInstalled.id])}>{pinnedItems.includes(selectedInstalled.id) ? "Unpin" : "Pin"}</Button></div>
          </aside> : <aside className="marketplace-detail marketplace-installed-inspector"><EmptyState title={installedLoading ? "Checking installed items" : "No installed items"} description={installedLoading ? "The inventory is still being read from this computer." : installedRecords.length ? "Select an installed item to review its local details and available actions." : "Installed inventory details will appear here when a local runtime or catalog item is available."} /></aside>}
          </div>
        ) : (
          <>
            <div className="marketplace-toolbar"><div className="marketplace-search-row"><label className="sr-only" htmlFor="marketplace-search">Search {section.toLowerCase()}</label><input id="marketplace-search" value={query} maxLength={showModels ? 160 : undefined} onChange={(event) => setQuery(showModels ? normalizeModelSearchQuery(event.target.value) : event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && showModels && !modelLoading) void searchModels(); }} placeholder={showModels ? "Search models by name or provider…" : "Search " + section.toLowerCase() + "…"} />{showModels && query.trim() && <Button variant="ghost" type="button" aria-label="Clear model search" title="Clear search" onClick={() => { setQuery(""); void searchModels("", uncensored, provider, true); }}><NavIcon name="close" /></Button>}{showModels && <Button variant="secondary" type="button" onClick={() => modelLoading ? cancelModelSearch() : void searchModels()}>{modelLoading ? "Cancel search" : "Search models"}</Button>}<span>{showModels ? modelLoading ? "Searching catalogs…" : `${models.length} results` : visible.length + " results"}</span></div></div>
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
      </div>
    </div>
  );
}
