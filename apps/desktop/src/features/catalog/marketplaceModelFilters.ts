export type MarketplaceModel = {
  id: string;
  repository: string;
  name?: string;
  source: string;
  kind: string;
  downloads: number;
  likes: number;
  uncensored: boolean;
  tags: string[];
  sizeBytes?: number | null;
  contextLength?: number | null;
  license?: string | null;
  installRoute: string;
  installable: boolean;
  requiresAirLlm?: boolean;
  files?: Array<{ path: string; sizeBytes: number; sha256?: string | null }>;
};

export type MarketplaceModelFilters = {
  provider: string;
  size: string;
  task: string;
  library: string;
  app: string;
  context: string;
  uncensored: boolean;
  availableRamBytes?: number | null;
};

const normalizeTag = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function marketplaceModelFilterOptions() {
  return {
    tasks: ["All tasks", "Chat", "Code", "Embeddings", "Image", "Audio", "Video", "Vision", "Speech"],
    libraries: ["All libraries", "GGUF", "Transformers", "MLX", "PyTorch", "TensorFlow", "Safetensors"],
    apps: ["All install paths", "Ollama", "LM Studio", "AirLLM"],
  };
}

export function filterMarketplaceModels(models: MarketplaceModel[], filters: MarketplaceModelFilters) {
  const sizeMatches = (model: MarketplaceModel) => {
    if (filters.size === "Any size") return true;
    if (model.sizeBytes == null) return false;
    const size = model.sizeBytes / 1024 ** 3;
    if (filters.size === "Fits my PC") return Boolean(filters.availableRamBytes && model.sizeBytes <= filters.availableRamBytes);
    if (filters.size === "Tiny") return size <= 4;
    if (filters.size === "Small") return size > 4 && size <= 10;
    if (filters.size === "Medium") return size > 10 && size <= 20;
    if (filters.size === "Big") return size > 20;
    const legacyLimit = Number(filters.size);
    return Number.isFinite(legacyLimit) && model.sizeBytes <= legacyLimit * 1024 ** 3;
  };
  const normalizedTask = filters.task === "All tasks" ? "" : normalizeTag(filters.task);
  const normalizedLibrary = filters.library === "All libraries" ? "" : normalizeTag(filters.library);
  const normalizedApp = filters.app === "All install paths" || filters.app === "All apps" ? "" : normalizeTag(filters.app);

  return models.filter((model) => {
    const matchesProvider = filters.provider === "All providers"
      || (filters.provider === "AirLLM" ? model.requiresAirLlm === true : model.source === filters.provider && !model.requiresAirLlm);
    const matchesSize = sizeMatches(model);
    const tags = model.tags.map(normalizeTag);
    const taskAliases: Record<string, string[]> = {
      chat: ["chat", "conversational", "instruct", "text generation"],
      code: ["code", "coder", "programming"],
      embeddings: ["embedding", "embeddings"],
      image: ["image", "images", "text to image"],
      audio: ["audio", "speech"],
      video: ["video"],
      vision: ["vision", "visual question answering"],
      speech: ["speech", "audio", "text to speech"],
    };
    const matchesTask = !normalizedTask || (taskAliases[normalizedTask] ?? [normalizedTask]).some((alias) => tags.some((tag) => tag.includes(normalizeTag(alias))));
    const matchesLibrary = !normalizedLibrary || tags.some((tag) => tag.includes(normalizedLibrary));
    const route = model.requiresAirLlm ? "airllm" : model.installRoute.startsWith("ollama-") ? "ollama" : model.installRoute === "lm-studio" ? "lm studio" : "";
    const matchesApp = !normalizedApp || normalizeTag(route) === normalizedApp;
    const matchesContext = filters.context === "Any context"
      || (filters.context === "1M-class window" && (model.contextLength ?? 0) >= 900_000);
    return matchesProvider && matchesSize && matchesTask && matchesLibrary && matchesApp && matchesContext;
  });
}

export function countActiveMarketplaceModelFilters(filters: MarketplaceModelFilters) {
  return [
    filters.provider !== "All providers",
    filters.task !== "All tasks",
    filters.library !== "All libraries",
    filters.app !== "All install paths" && filters.app !== "All apps",
    filters.size !== "Any size",
    filters.context !== "Any context",
    filters.uncensored,
  ].filter(Boolean).length;
}

export function isMarketplaceModelInstallRouteAvailable(model: MarketplaceModel, activeRuntime: string) {
  if (model.requiresAirLlm) return true;
  if (model.installRoute === "ollama-pull" || model.installRoute === "ollama-gguf") {
    return activeRuntime.toLowerCase().includes("ollama");
  }
  return model.installRoute === "lm-studio"
    && activeRuntime.toLowerCase().replaceAll("-", " ").includes("lm studio");
}
