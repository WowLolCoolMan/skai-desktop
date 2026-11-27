import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentResponse } from "../../../shared/contracts";
import type { Model } from "../../app/types";
import { countActiveMarketplaceModelFilters, filterMarketplaceModels, isMarketplaceModelInstallRouteAvailable, marketplaceModelFilterOptions, type MarketplaceModel } from "./marketplaceModelFilters";

type LocalCapacity = { ramTotalBytes?: number | null; ramAvailableBytes?: number | null; gpu?: { name?: string; totalBytes?: number | null; availableBytes?: number | null; budgetBytes?: number | null; processUsageBytes?: number | null; measurementSource?: string | null; availabilityScope?: string | null } | null; measurementNote?: string | null };
type MarketplaceSection = "Discover" | "Models" | "Image models" | "Voices" | "Image workflows" | "Skills" | "Tools" | "Installed" | "Updates";
type MarketplaceRequest = (method: string, params?: Record<string, unknown>) => Promise<AgentResponse>;
type MarketplacePreference = <T>(key: string, fallback: T) => T;

type UseMarketplaceModelSearchOptions = {
  section: MarketplaceSection;
  query: string;
  setSection: (section: MarketplaceSection) => void;
  setQuery: (query: string) => void;
  onSectionChange?: (section: MarketplaceSection) => void;
  onSelectAirLlmModel?: (model: Model) => void;
  request: MarketplaceRequest;
  formatSize: (bytes?: number | null) => string;
  normalizeSource: (value: string) => string;
  normalizeModelSearchQuery: (value: string) => string;
  marketplacePreference: MarketplacePreference;
};

export function useMarketplaceModelSearch({ section, query, setSection, setQuery, onSectionChange, onSelectAirLlmModel, request, formatSize, normalizeSource, normalizeModelSearchQuery, marketplacePreference }: UseMarketplaceModelSearchOptions) {
  const [models, setModels] = useState<MarketplaceModel[]>([]);
  const [modelLoading, setModelLoading] = useState(false);
  const modelSearchRequestRef = useRef(0);
  const initialModelSearchStartedRef = useRef(false);
  const lastProviderSearchRef = useRef<string | null>(null);
  const capacityLoadStartedRef = useRef(false);
  const airLlmLoadStartedRef = useRef(false);
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
  const [airLlmReady, setAirLlmReady] = useState<boolean | null>(null);
  const [activeRuntimeAvailable, setActiveRuntimeAvailable] = useState<boolean | null>(null);
  const [localCapacity, setLocalCapacity] = useState<LocalCapacity | null>(null);

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
  }, [request, section]);

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
      void searchModels(query, uncensored, provider, provider === "Ollama" && !query.trim());
    } else if (lastProviderSearchRef.current !== null && lastProviderSearchRef.current !== provider) {
      void searchModels(query, uncensored, provider);
    }
  }, [section, provider]);

  const useAirLlmModel = (model: MarketplaceModel) => {
    if (!model.requiresAirLlm || !onSelectAirLlmModel) return;
    onSelectAirLlmModel({ model: model.repository, displayName: model.repository, vision: "unsupported", capabilities: ["Text generation"], provider: "AirLLM", endpoint: null, sizeBytes: model.sizeBytes });
  };

  const { tasks: taskOptions, libraries: libraryOptions, apps: appOptions } = useMemo(() => marketplaceModelFilterOptions(), []);
  const filteredModels = useMemo(() => filterMarketplaceModels(models, {
    provider, size, task: taskFilter, library: libraryFilter, app: appFilter, context: contextFilter, uncensored,
    availableRamBytes: localCapacity?.ramAvailableBytes,
    availableGpuBytes: localCapacity?.gpu?.availableBytes,
  }), [appFilter, contextFilter, libraryFilter, localCapacity?.gpu?.availableBytes, localCapacity?.ramAvailableBytes, models, provider, size, taskFilter, uncensored]);
  const activeModelFilterCount = countActiveMarketplaceModelFilters({ provider, size, task: taskFilter, library: libraryFilter, app: appFilter, context: contextFilter, uncensored });
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
    const estimatedWeights = Math.ceil(model.sizeBytes * 1.2);
    const ram = freeRam == null
      ? " Available RAM was not measured."
      : estimatedWeights <= freeRam
        ? `Estimated weights plus 20% overhead (${formatSize(estimatedWeights)}) fit current free RAM (${formatSize(freeRam)}), before context cache and runtime overhead.`
        : `Estimated weights plus 20% overhead (${formatSize(estimatedWeights)}) exceed current free RAM (${formatSize(freeRam)}).`;
    const gpu = localCapacity?.gpu?.availableBytes != null
      ? ` ${localCapacity.gpu.availabilityScope === "application-budget" ? "Agent host GPU budget headroom" : "GPU system free"}: ${formatSize(localCapacity.gpu.availableBytes)}${localCapacity.gpu.name ? ` on ${localCapacity.gpu.name}` : ""}; CPU fallback depends on the selected runtime.`
      : " GPU available memory is not reported by a supported local telemetry provider.";
    return `${formatSize(model.sizeBytes)} download. ${ram}${gpu}`;
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

  return { models, modelLoading, modelError, setModelError, uncensored, setUncensored, provider, setProvider, size, setSize, taskFilter, setTaskFilter, libraryFilter, setLibraryFilter, appFilter, setAppFilter, contextFilter, setContextFilter, installing, installStatus, setInstallStatus, installOperationId, reviewModel, setReviewModel, installedModels, setInstalledModels, airLlmReady, activeRuntimeAvailable, localCapacity, taskOptions, libraryOptions, appOptions, filteredModels, activeModelFilterCount, activeLocalRuntime, providerOptions, installRouteAvailable, modelFitSummary, useAirLlmModel, searchModels, cancelModelSearch, installModel, cancelModelInstall };
}

export type MarketplaceModelSearchState = ReturnType<typeof useMarketplaceModelSearch>;
