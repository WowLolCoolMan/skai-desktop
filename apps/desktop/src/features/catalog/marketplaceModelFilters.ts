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

const titleCaseTag = (tag: string) => tag.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());

export function marketplaceModelFilterOptions(models: MarketplaceModel[]) {
  const tags = [...new Set(models.flatMap((model) => model.tags))].sort((left, right) => left.localeCompare(right));
  const optionsFor = (pattern: RegExp, fallback: string) => [fallback, ...new Set(tags.filter((tag) => pattern.test(tag)).map(titleCaseTag))];
  return {
    tasks: optionsFor(/text|chat|code|image|audio|video|vision|speech|embed/i, "All tasks"),
    libraries: optionsFor(/transformers|gguf|mlx|pytorch|tensorflow|diffusers|safetensors|jax/i, "All libraries"),
    apps: optionsFor(/ollama|llama\.cpp|lm studio|vllm|jan|localai|airllm/i, "All apps"),
  };
}

export function filterMarketplaceModels(models: MarketplaceModel[], filters: MarketplaceModelFilters) {
  const sizeLimit = filters.size === "Any size" ? Number.POSITIVE_INFINITY : Number(filters.size) * 1024 ** 3;
  const normalizedTask = filters.task === "All tasks" ? "" : filters.task.toLowerCase();
  const normalizedLibrary = filters.library === "All libraries" ? "" : filters.library.toLowerCase();
  const normalizedApp = filters.app === "All apps" ? "" : filters.app.toLowerCase();

  return models.filter((model) => {
    const matchesProvider = filters.provider === "All providers"
      || (filters.provider === "AirLLM" ? model.requiresAirLlm === true : model.source === filters.provider && !model.requiresAirLlm);
    const matchesSize = filters.size === "Any size" || (model.sizeBytes != null && model.sizeBytes <= sizeLimit);
    const tags = model.tags.map((tag) => tag.toLowerCase());
    const matchesTask = !normalizedTask || tags.some((tag) => tag.includes(normalizedTask));
    const matchesLibrary = !normalizedLibrary || tags.some((tag) => tag.includes(normalizedLibrary));
    const matchesApp = !normalizedApp || tags.some((tag) => tag.includes(normalizedApp));
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
