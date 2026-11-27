import { useEffect, useMemo, useRef, useState } from "react";
import type { Model, Route } from "../../app/types";
import type { AgentResponse, DesktopPersona } from "../../../shared/contracts";
import { Button, EmptyState, StatusBadge } from "../../components/ui/Primitives";
import { NavIcon, type NavIconName } from "../../components/ui/NavIcon";
import { installedVoiceModels, refreshInstalledVoiceModels, saveVoiceSetting, selectedVoiceSettings, speakNativeResponse, stopNativeSpeech, voiceProfiles } from "../../services/nativeTts";
import { useMarketplaceModelSearch } from "./useMarketplaceModelSearch";
import { MarketplaceModelResults } from "./MarketplaceModelResults";
import { MarketplaceDiscover } from "./MarketplaceDiscover";
import { MarketplaceNavigation } from "./MarketplaceNavigation";

export type MarketplaceSection = Section;
type Section = "Discover" | "Models" | "Image models" | "Voices" | "Image workflows" | "Skills" | "Tools" | "Installed" | "Updates";
type Filter = "All" | "Local models" | "Voices" | "Image workflows" | "Skills" | "Tools";
type CatalogItem = { id: string; title: string; filter: Filter; description: string; detail: string; icon: NavIconName; status: string; tone: "neutral" | "success" | "warning"; publisher: string; version: string; compatibility: string; nextStep: string; installable: boolean };
type InstalledRecord = { id: string; category: string; name: string; detail: string; state: string; icon: NavIconName; source: string; version: string; lastUpdated: string; diskUse: string; compatibility: string; dependents: string[]; removalImpact: string; integrity?: string; removeBlockedReason?: string; nextStep: string; update?: () => void; remove?: () => void; health?: () => void };
type MarketplaceCatalog = { providers: Array<{ id: string; name: string; kinds: string[]; remote: boolean }>; voiceProviders?: Array<{ id: string; name: string; kind: string; requiresUserKey: boolean; status: string }>; voices: Array<{ id: string; name: string; description: string; runtime: string; license: string; size: string; installed: boolean; lowResource: boolean; sourceUrl: string; adapterAvailable: boolean; supportsStreaming: boolean; supportsVoiceCloning: boolean; supportsEmotion: boolean; supportsAudioEffects: boolean; availabilityNote: string; installable: boolean }>; skills: Array<{ id: string; name: string; description: string; category: string; permissions: string[]; source: string; version?: string; packageSha256?: string; installedAtUtc?: string | null; updatedAtUtc?: string | null; sizeBytes?: number; installed: boolean; enabled: boolean; installable: boolean }>; tools: Array<{ id: string; name: string; description: string; category: string; access: string; builtIn: boolean; status: string; source?: string | null; installable: boolean }> };

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
  const catalogLoadStartedRef = useRef(false);
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
  const [savedImageWorkflows, setSavedImageWorkflows] = useState<SavedImageWorkflow[]>(readSavedImageWorkflows);
  const [activeImageWorkflow, setActiveImageWorkflow] = useState(() => localStorage.getItem("skai.imageWorkflow") ?? "");
  const [imageWorkflowStatus, setImageWorkflowStatus] = useState<string | null>(null);
  const [imageWorkflowImporting, setImageWorkflowImporting] = useState(false);

  useEffect(() => { localStorage.setItem(`skai.marketplace.query.${section.toLowerCase()}`, JSON.stringify(query)); }, [query, section]);
  useEffect(() => { localStorage.setItem("skai.marketplace.installed.pinned", JSON.stringify(pinnedItems)); }, [pinnedItems]);
  const modelSearch = useMarketplaceModelSearch({ section, query, setSection, setQuery, onSectionChange, onSelectAirLlmModel, request, formatSize, normalizeSource, normalizeModelSearchQuery, marketplacePreference });
  const { models, modelLoading, modelError, setModelError, uncensored, setUncensored, provider, setProvider, size, setSize, taskFilter, setTaskFilter, libraryFilter, setLibraryFilter, appFilter, setAppFilter, contextFilter, setContextFilter, installing, installStatus, setInstallStatus, installOperationId, reviewModel, setReviewModel, installedModels, setInstalledModels, airLlmReady, activeRuntimeAvailable, localCapacity, taskOptions, libraryOptions, appOptions, filteredModels, activeModelFilterCount, activeLocalRuntime, providerOptions, installRouteAvailable, modelFitSummary, useAirLlmModel, searchModels, cancelModelSearch, installModel, cancelModelInstall } = modelSearch;

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
    const workflowDependents = savedImageWorkflows.filter((workflow) => workflow.workflow.includes(id)).map((workflow) => workflow.name);
    const activeWorkflowUsesAsset = activeImageWorkflow.includes(id);
    if (workflowDependents.length || activeWorkflowUsesAsset) {
      const names = [...workflowDependents, ...(activeWorkflowUsesAsset && !workflowDependents.includes("Active image workflow") ? ["Active image workflow"] : [])];
      setImageAssetStatus(`Cannot remove ${id}: it is referenced by ${names.join(", ")}. Update those workflows first.`);
      return;
    }
    if (!window.confirm(`Remove ${id} from Skai's local image asset folder? This deletes the downloaded LoRA file. Saved workflows, generated images, and source repository files are retained.`)) return;
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
    const connection = installedConnections.find((item) => item.connectionId === connectionId);
    if (!window.confirm(`Revoke the local ${connection?.serverId ?? "MCP"} connection? This stops its local server and removes Skai's connection and approval state. The downloaded package, server-side data, credentials held by the server, chats, and projects are retained.`)) return;
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
        if (result.status === "completed") {
          const changeSummary = result.progress?.slice(-3).join(" · ");
          setInstalledActionStatus(changeSummary ? `Update finished for ${model}. Runtime summary: ${changeSummary}` : `Update finished for ${model}. The local runtime does not report a file-level change summary.`);
          await loadInstalledModels();
          return;
        }
        if (result.status === "failed" || result.status === "cancelled") throw new Error(result.error ?? `Model update ${result.status}.`);
      }
      throw new Error("The model update timed out; its local operation may still be running.");
    } catch (error) { setInstalledActionStatus(error instanceof Error ? error.message : "The model update failed."); }
    finally { setInstalledActionBusy(false); }
  };
  const removeOllamaModel = async (model: string, endpoint?: string | null) => {
    if (!endpoint || installedActionBusy) return;
    const activeModel = localStorage.getItem("skai.model") ?? "";
    const activeSubagentModel = localStorage.getItem("skai.subagentModel") ?? "";
    if (activeModel === model || activeSubagentModel === model) {
      setInstalledActionStatus(`${model} is selected for chat or subagent work. Select another model in Settings before removing it.`);
      return;
    }
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
  const removeInstalledSkill = async (id: string) => {
    const skill = catalog?.skills.find((item) => item.id === id);
    if (!skill || installedActionBusy) return;
    if (!window.confirm(`Remove ${skill.name}? This deletes its installed Markdown instructions and rollback copies. Built-in skills, chats, settings, and unrelated files are retained.`)) return;
    setInstalledActionBusy(true); setInstalledActionStatus(`Removing ${skill.name}…`);
    try {
      const response = await request("skills.remove", { id });
      if (!response.ok) throw new Error(response.error?.message ?? "The skill could not be removed.");
      const refreshed = await request("marketplace.catalog");
      if (refreshed.ok) setCatalog(refreshed.result as MarketplaceCatalog);
      setSelectedInstalledId(null);
      setInstalledActionStatus(`${skill.name} and its local rollback copies were removed. Built-in skills and workspace data were retained.`);
    } catch (error) {
      setInstalledActionStatus(error instanceof Error ? error.message : "The skill could not be removed.");
    } finally { setInstalledActionBusy(false); }
  };
  const removeQwenVoice = async () => {
    if (installedActionBusy) return;
    const current = selectedVoiceSettings();
    if (current.primaryModelId === "qwen3-tts" || current.lowResourceModelId === "qwen3-tts") {
      setInstalledActionStatus("Qwen3-TTS is assigned to a voice setting. Choose another installed voice in Settings before removing it.");
      return;
    }
    if (!window.confirm("Remove Qwen3-TTS's local runtime and model files? Your voice presets and unrelated voice runtimes will be retained.")) return;
    setInstalledActionBusy(true); setInstalledActionStatus("Removing Qwen3-TTS local files…");
    try {
      const response = await request("voice.qwen3.remove");
      const result = response.result as { removed?: boolean; error?: string } | undefined;
      if (!response.ok || !result?.removed) throw new Error(result?.error ?? response.error?.message ?? "Qwen3-TTS could not be removed.");
      await refreshInstalledVoiceModels();
      const refreshed = await request("marketplace.catalog");
      if (refreshed.ok) setCatalog(refreshed.result as MarketplaceCatalog);
      setInstalledActionStatus("Qwen3-TTS runtime and model files were removed. Voice presets and other runtimes were retained.");
    } catch (error) { setInstalledActionStatus(error instanceof Error ? error.message : "Qwen3-TTS could not be removed."); }
    finally { setInstalledActionBusy(false); }
  };
  const activeChatModel = localStorage.getItem("skai.model") ?? "";
  const activeSubagentModel = localStorage.getItem("skai.subagentModel") ?? "";
  const installedRecords: InstalledRecord[] = [
    ...installedModels.map((item) => {
      const dependents = [
        ...(activeChatModel === item.model ? ["Current chat model selection"] : []),
        ...(activeSubagentModel === item.model ? ["Subagent model selection"] : []),
      ];
      return { id: `model:${item.provider}:${item.model}`, category: "Models", name: item.model, detail: `${item.provider ?? "Local runtime"} · ${item.capabilities.join(" · ") || "Text generation"}`, state: "installed", icon: "model" as NavIconName,
        source: item.provider ?? "Configured local runtime", version: item.model.includes(":") ? item.model.slice(item.model.lastIndexOf(":") + 1) : "Provider-managed version", lastUpdated: "Not reported by the local runtime",
        diskUse: "Stored size is not reported by the local API", compatibility: `${item.vision.toLowerCase() === "supported" ? "Vision" : "Text"} · context length not reported`,
        dependents, removalImpact: "Removing deletes the local runtime's model files. Skai chats, settings, and downloaded source files remain.",
        removeBlockedReason: dependents.length ? "Selected by an active chat or subagent setting; choose another model in Settings first." : undefined,
        nextStep: item.provider === "Ollama" ? "Update or remove this model through its local Ollama runtime." : "This model is managed by its local provider; Skai cannot update or remove it here.",
        update: item.provider === "Ollama" ? () => void updateOllamaModel(item.model, item.endpoint) : undefined,
        remove: item.provider === "Ollama" ? () => void removeOllamaModel(item.model, item.endpoint) : undefined };
    }),
    ...installedConnections.map((item) => ({ id: `mcp:${item.connectionId}`, category: "MCP servers", name: item.serverId, detail: `${item.transport} · ${item.connectionId}`, state: item.state === "healthy" ? "installed" : "limited", icon: "terminal" as NavIconName,
      source: item.serverId, version: "Runtime-managed connection", lastUpdated: "Connection date not recorded", diskUse: "Package storage is runtime-managed",
      compatibility: item.transport === "stdio" ? "Local reviewed process" : "Loopback HTTP transport", dependents: item.state === "healthy" ? ["Tools exposed to the local agent"] : [],
      removalImpact: "Revoking stops the local server and removes Skai's connection and approval state; it does not delete the package or remote server data.",
      nextStep: item.state === "healthy" ? "Connection responds to the host health check." : "Check health or remove this MCP connection.", health: () => void checkMcpHealth(item.connectionId), remove: () => void removeMcpConnection(item.connectionId) })),
    ...(catalog?.tools ?? []).filter((item) => item.builtIn).map((item) => ({ id: `tool:${item.id}`, category: "Skai built-ins", name: item.name, detail: item.description, state: "installed", icon: "terminal" as NavIconName,
      source: item.source || "Skai Desktop", version: "Bundled with Skai", lastUpdated: "Updated with Skai Desktop", diskUse: "Included in the application", compatibility: item.access, dependents: ["Available to local agent workflows"], removalImpact: "Built-in capability. It is retained when optional Marketplace items are removed.", nextStep: "Open the related local workflow to use this capability." })),
    ...(catalog?.skills ?? []).filter((item) => item.installed && item.source !== "built-in" && item.source !== "Skai built-in").map((item) => ({ id: `skill:${item.id}`, category: "Skills", name: item.name, detail: `${item.source} · ${item.enabled ? "Enabled" : "Disabled"}`, state: "installed", icon: "sparkle" as NavIconName,
      source: item.source, version: item.version ?? "Version not reported", lastUpdated: item.updatedAtUtc ? new Date(item.updatedAtUtc).toLocaleString() : "Update date not recorded", diskUse: item.sizeBytes ? formatSize(item.sizeBytes) : "Size not reported", integrity: item.packageSha256 ? `SHA-256 ${item.packageSha256}` : undefined,
      compatibility: item.permissions.join(" · ") || "No extra permissions", dependents: item.enabled ? ["Available to the local agent when a task requests it"] : [],
      removalImpact: "Removes this local Markdown package and its rollback copies. Built-in skills and workspace data remain.", nextStep: item.enabled ? "This skill is available to the local agent." : "This skill is disabled and is not added to agent context.", remove: () => void removeInstalledSkill(item.id) })),
    ...(catalog?.voices ?? []).filter((item) => item.installed).map((item) => {
      const settings = selectedVoiceSettings();
      const dependents = [
        ...(settings.primaryModelId === item.id ? ["Primary voice setting"] : []),
        ...(settings.lowResourceModelId === item.id ? ["Low-resource voice setting"] : []),
      ];
      const removable = item.id === "qwen3-tts";
      return { id: `voice:${item.id}`, category: "Voice profiles", name: item.name, detail: `${item.runtime} · ${item.size}`, state: "installed", icon: "activity" as NavIconName,
        source: item.sourceUrl || item.runtime, version: item.runtime, lastUpdated: "Pinned runtime metadata; install date not recorded", diskUse: item.size,
        compatibility: `${item.license} · ${item.availabilityNote}`, dependents, removalImpact: "Removes the supported local runtime and model files. Saved voice presets are retained.",
        removeBlockedReason: dependents.length ? "This runtime is assigned in Voice settings. Choose another installed voice first." : undefined,
        nextStep: "Select this voice in the voice controls and preview it.", remove: removable ? () => void removeQwenVoice() : undefined };
    }),
    ...installedPersonas.map((item) => ({ id: `persona:${item.id}`, category: "Personas", name: item.name, detail: `${item.sourceMode === "public-research" ? "Public research" : "Own material"} · ${item.roles}`, state: "installed", icon: "sparkle" as NavIconName,
      source: item.sourceMode, version: "Local profile", lastUpdated: "Profile date not reported", diskUse: "Size not reported", compatibility: item.roles,
      dependents: ["Persona workspace"], removalImpact: "Manage the persona and supplied material in Persona Workshop; no Marketplace removal is exposed.", nextStep: "Available in the local persona workspace." })),
    ...installedImageAssets.map((item) => {
      const dependents = savedImageWorkflows.filter((workflow) => workflow.workflow.includes(item.id)).map((workflow) => workflow.name);
      if (activeImageWorkflow.includes(item.id) && !dependents.includes("Active image workflow")) dependents.push("Active image workflow");
      return { id: `asset:${item.id}`, category: "Image assets", name: item.id, detail: `${item.repository} · ${formatSize(item.sizeBytes)}`, state: "installed", icon: "image" as NavIconName,
        source: item.repository, version: "Repository file; revision not recorded", lastUpdated: "Update date not reported", diskUse: formatSize(item.sizeBytes), compatibility: "Diffusers image runtime",
        dependents, removalImpact: "Deletes the downloaded local LoRA file. Saved workflows, generated images, and source repository files remain.",
        removeBlockedReason: dependents.length ? `Referenced by ${dependents.join(", ")}; update those workflows first.` : undefined,
        nextStep: "Remove this local image asset or restart image generation to use it.", remove: () => void removeImageAsset(item.id) };
    }),
  ];
  const selectedInstalled = installedRecords.find((item) => item.id === selectedInstalledId) ?? installedRecords[0] ?? null;
  const selectInstalledItem = (id: string) => {
    if (id !== selectedInstalledId) setInstalledActionStatus(null);
    setSelectedInstalledId(id);
  };
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
  const filteredSavedImageWorkflows = savedImageWorkflows.filter((workflow) => `${workflow.name} ${workflow.workflow}`.toLowerCase().includes(query.trim().toLowerCase()));

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
        <MarketplaceNavigation section={section} embedded={Boolean(onBack)} installedCount={installedModels.length + installedConnections.length} setSection={setSection} setQuery={setQuery} onSectionChange={onSectionChange} />
        <div className="marketplace-browser">

        {section === "Discover" ? <MarketplaceDiscover
          query={query}
          setQuery={setQuery}
          setSection={setSection}
          categories={filteredCategories}
          installedCount={installedModels.length + installedConnections.length}
          modelError={modelError}
          modelLoading={modelLoading}
          activeRuntimeAvailable={activeRuntimeAvailable}
          activeLocalRuntime={activeLocalRuntime}
          onNavigate={onNavigate}
        /> : section === "Image workflows" ? (
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
              const group = (title: string, rows: InstalledRecord[]) => {
                if (installedCategory !== "All" && installedCategory !== title) return null;
                const filtered = rows.filter((row) => matches(row.name, row.detail, row.state, row.source, row.version, row.compatibility, ...row.dependents));
                if (!filtered.length) return null;
                return <section className="marketplace-installed-group" key={title}><h4>{title} <span>{filtered.length}</span></h4>{filtered.map((row) => <article className={`marketplace-installed-model${selectedInstalled?.id === row.id ? " is-selected" : ""}`} key={row.id} role="button" tabIndex={0} aria-pressed={selectedInstalled?.id === row.id} onClick={() => selectInstalledItem(row.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectInstalledItem(row.id); } }}><span className="marketplace-installed-model-icon"><NavIcon name={row.icon} /></span><div className="marketplace-installed-model-copy"><strong>{row.name}</strong><small>{row.detail}</small></div><StatusBadge tone={row.state === "limited" ? "warning" : "success"}>{row.state}</StatusBadge></article>)}</section>;
              };
              const rows = [
                ...["Models", "MCP servers", "Skai built-ins", "Skills", "Voice profiles", "Personas", "Image assets"].map((title) => group(title, installedRecords.filter((item) => item.category === title))),
              ];
              return rows.some(Boolean) ? rows : <EmptyState title={query ? "No matching installed items" : "No installed items discovered"} description={query ? "Try another search term." : "Connect a local model runtime or install a compatible tool to see it here."} action={query ? <Button variant="ghost" onClick={() => setQuery("")}>Clear search</Button> : undefined} />;
            })()}
          </div>
          {selectedInstalled ? <aside className="marketplace-detail marketplace-installed-inspector" aria-label="Installed item details">
            <div className="marketplace-installed-inspector-content">
            <div className="marketplace-detail-heading"><div><p className="section-kicker">INSTALLED ITEM</p><h3>{selectedInstalled.name}</h3></div><StatusBadge tone={selectedInstalled.state === "limited" ? "warning" : "success"}>{selectedInstalled.state}</StatusBadge></div>
            <p>{selectedInstalled.detail}</p>
            <dl className="marketplace-detail-list"><div><dt>Source</dt><dd>{selectedInstalled.source}</dd></div><div><dt>Version</dt><dd>{selectedInstalled.version}</dd></div>{selectedInstalled.integrity && <div><dt>Integrity</dt><dd>{selectedInstalled.integrity}</dd></div>}<div><dt>Last updated</dt><dd>{selectedInstalled.lastUpdated}</dd></div><div><dt>Disk use</dt><dd>{selectedInstalled.diskUse}</dd></div><div><dt>Compatibility</dt><dd>{selectedInstalled.compatibility}</dd></div><div><dt>Dependent workflows</dt><dd>{selectedInstalled.dependents.length ? selectedInstalled.dependents.join(" · ") : "No known active dependencies"}</dd></div><div><dt>Removal impact</dt><dd>{selectedInstalled.removalImpact}</dd></div><div><dt>Next step</dt><dd>{selectedInstalled.nextStep}</dd></div></dl>
            {selectedInstalled.id.startsWith("voice:") && <div className="marketplace-installed-voice-status" aria-label={`${selectedInstalled.name} availability`}><div><strong>Local runtime</strong><span>{selectedInstalledVoice ? "Available" : "Unavailable"}</span></div><div><strong>Local voice/model data</strong><span>{selectedInstalledVoice?.installed ? "Available" : "Unavailable"}</span></div><div><strong>Local playback</strong><span>{selectedInstalledVoice ? "Available" : "Unavailable"}</span></div><div className="marketplace-voice-actions"><Button variant="primary" disabled={!selectedInstalledVoice} onClick={() => void previewInstalledVoice()} aria-label={`Preview ${selectedInstalled.name} voice`}>Preview voice</Button><Button variant="ghost" onClick={stopNativeSpeech}>Stop</Button></div>{installedVoicePreviewStatus && <p role="status">{installedVoicePreviewStatus}</p>}</div>}
            {selectedInstalled.removeBlockedReason && <p className="marketplace-honesty" role="status">{selectedInstalled.removeBlockedReason}</p>}
            {installedActionStatus && <p className="marketplace-honesty" role="status">{installedActionStatus}</p>}
            </div>
            <div className="marketplace-model-actions">{selectedInstalled.health && <Button variant="secondary" onClick={selectedInstalled.health}>Check health</Button>}{selectedInstalled.update && <Button variant="secondary" disabled={installedActionBusy} onClick={selectedInstalled.update}>{installedActionBusy ? "Updating…" : "Update"}</Button>}{selectedInstalled.remove && <Button variant="danger" disabled={installedActionBusy || Boolean(selectedInstalled.removeBlockedReason)} onClick={selectedInstalled.remove}>{installedActionBusy ? "Working…" : "Remove"}</Button>}<Button variant="ghost" aria-pressed={pinnedItems.includes(selectedInstalled.id)} onClick={() => setPinnedItems((current) => current.includes(selectedInstalled.id) ? current.filter((id) => id !== selectedInstalled.id) : [...current, selectedInstalled.id])}>{pinnedItems.includes(selectedInstalled.id) ? "Unpin" : "Pin"}</Button></div>
          </aside> : <aside className="marketplace-detail marketplace-installed-inspector"><EmptyState title={installedLoading ? "Checking installed items" : "No installed items"} description={installedLoading ? "The inventory is still being read from this computer." : installedRecords.length ? "Select an installed item to review its local details and available actions." : "Installed inventory details will appear here when a local runtime or catalog item is available."} /></aside>}
          </div>
        ) : (
          <>
            <div className="marketplace-toolbar"><div className="marketplace-search-row"><label className="sr-only" htmlFor="marketplace-search">Search {section.toLowerCase()}</label><input id="marketplace-search" value={query} maxLength={showModels ? 160 : undefined} onChange={(event) => setQuery(showModels ? normalizeModelSearchQuery(event.target.value) : event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && showModels && !modelLoading) void searchModels(); }} placeholder={showModels ? "Search models by name or provider…" : "Search " + section.toLowerCase() + "…"} />{showModels && query.trim() && <Button variant="ghost" type="button" aria-label="Clear model search" title="Clear search" onClick={() => { setQuery(""); void searchModels("", uncensored, provider, true); }}><NavIcon name="close" /></Button>}{showModels && <Button variant="secondary" type="button" onClick={() => modelLoading ? cancelModelSearch() : void searchModels()}>{modelLoading ? "Cancel search" : "Search models"}</Button>}<span>{showModels ? modelLoading ? "Searching catalogs…" : `${models.length} results` : visible.length + " results"}</span></div></div>
            {showModels ? <div className="marketplace-models-pane"><MarketplaceModelResults search={modelSearch} query={query} setQuery={setQuery} setSection={setSection} onSectionChange={onSectionChange} onNavigate={onNavigate} onSelectAirLlmModel={onSelectAirLlmModel} /></div> : (
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
