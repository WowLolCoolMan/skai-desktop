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
};

const normalizeTag = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function marketplaceModelFilterOptions() {
  return {
    tasks: ["All tasks", "Chat", "Code", "Embeddings", "Image", "Audio", "Video", "Vision", "Speech"],
    libraries: ["All libraries", "GGUF", "Transformers", "MLX", "PyTorch", "TensorFlow", "Safetensors"],
    apps: ["All apps", "Ollama", "LM Studio", "AirLLM", "llama.cpp", "vLLM", "Jan", "LocalAI"],
  };
}

export function filterMarketplaceModels(models: MarketplaceModel[], filters: MarketplaceModelFilters) {
  const sizeLimit = filters.size === "Any size" ? Number.POSITIVE_INFINITY : Number(filters.size) * 1024 ** 3;
  const normalizedTask = filters.task === "All tasks" ? "" : normalizeTag(filters.task);
  const normalizedLibrary = filters.library === "All libraries" ? "" : normalizeTag(filters.library);
  const normalizedApp = filters.app === "All apps" ? "" : normalizeTag(filters.app);

  return models.filter((model) => {
    const matchesProvider = filters.provider === "All providers"
      || (filters.provider === "AirLLM" ? model.requiresAirLlm === true : model.source === filters.provider && !model.requiresAirLlm);
    const matchesSize = filters.size === "Any size" || (model.sizeBytes != null && model.sizeBytes <= sizeLimit);
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
    const matchesApp = !normalizedApp || normalizeTag(model.source).includes(normalizedApp) || tags.some((tag) => tag.includes(normalizedApp));
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
    filters.app !== "All apps",
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
