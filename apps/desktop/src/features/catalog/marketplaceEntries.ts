export type Skill = {
  id: string;
  name: string;
  description: string;
  category: string;
  permissions: string[];
  source: string;
  enabled: boolean;
};

export type Tool = {
  id: string;
  name: string;
  description: string;
  category: string;
  access: string;
  builtIn: boolean;
  status: string;
};

export type MarketplaceCatalogSection = "Discover" | "Internet" | "Staff Picks" | "Models" | "Voices" | "MCP Servers" | "Skills" | "Plugins" | "Installed" | "Updates" | "Skai built-ins" | "Compatible plugins";

export type MarketplaceEntry = {
  id: string;
  kind: "Skills" | "Tools" | "Catalog";
  name: string;
  description: string;
  category: string;
  access: string;
  status: string;
  availability: string;
  installed: boolean;
  tone: "success" | "neutral" | "warning";
  source: string;
  sourceUrl?: string;
  license?: string;
  installReview?: string;
  adapter?: string;
  remote?: boolean;
};

export type CuratedCatalogEntry = { id: string; name: string; provider: string; category: string; license: string; description: string; runtime: string; capabilities: string[]; source: string; localOnly: boolean; adapter: string; installable: boolean; installReview: string };

export type InternetMarketplaceItem = { id: string; name: string; category: string; source: string; description: string; sourceUrl: string; license?: string | null; downloads?: number | null; likes?: number | null; tags: string[]; installable: boolean };

export type McpConnectionStatus = {
  serverId: string;
  state: string;
};

export function createMarketplaceEntries(
  skills: Skill[],
  tools: Tool[],
  connections: McpConnectionStatus[],
  query: string,
  curated: CuratedCatalogEntry[] = [],
  internet: InternetMarketplaceItem[] = [],
): MarketplaceEntry[] {
  const term = query.trim().toLowerCase();
  const skillEntries: MarketplaceEntry[] = skills.map((skill) => ({
    id: `skill:${skill.id}`,
    kind: "Skills",
    name: skill.name,
    description: skill.description,
    category: "Compatible plugins",
    access: skill.permissions.join(" · ") || "No extra permissions",
    status: skill.enabled ? "Enabled" : "Disabled",
    availability: skill.source === "built-in" ? "Built into Skai" : "Installed locally",
    installed: skill.source !== "built-in",
    tone: skill.enabled ? "success" : "neutral",
    source: skill.source,
  }));

  const reaTool: Tool = {
    id: "rea",
    name: "REA · Reverse Engineering Agent",
    description:
      "Downloadable local MCP server for reverse engineering software and application behavior.",
    category: "Developer Tools",
    access: "Local stdio MCP · explicit tool approval",
    builtIn: false,
    status: "Downloadable MCP",
  };
  const toolEntries: MarketplaceEntry[] = [...tools, reaTool].filter((tool) => {
    const installed = tool.id === "rea"
      ? connections.some((connection) => connection.serverId === "rea" && connection.state === "healthy")
      : tool.builtIn || /installed|connected/i.test(tool.status);
    return installed || tool.id === "rea";
  }).map((tool) => {
    const isRea = tool.id === "rea";
    const installed = isRea
      ? connections.some((connection) => connection.serverId === "rea" && connection.state === "healthy")
      : tool.builtIn || tool.status.toLowerCase().includes("installed");
    return {
      id: `tool:${tool.id}`,
      kind: "Tools",
      name: tool.name,
      description: tool.description,
      category: isRea ? "MCP servers" : tool.builtIn ? "Skai built-ins" : "Compatible plugins",
      access: tool.access,
      status: tool.builtIn ? "Built in" : tool.status,
      availability: isRea ? "Downloadable MCP · morluto" : tool.builtIn ? "Available in Skai" : "Installed locally",
      installed,
      tone: tool.builtIn || isRea ? "success" : "neutral",
      source: isRea ? "morluto · github.com/morluto/rea" : "Marketplace catalog",
    };
  });

  const curatedEntries: MarketplaceEntry[] = curated.filter((item) => item.localOnly && item.installable && item.adapter !== "none").map((item) => {
    const restrictedLicense = /non[- ]commercial|\bresearch\b|\bNC\b|BY-NC|CC-BY|Llama License|GPL-3\.0|\bcustom\b|OpenRAIL|CPML|modified MIT/i.test(item.license);
    const localNpmPackage = ["local-mcp-filesystem", "local-mcp-playwright", "local-mcp-postgres"].includes(item.adapter);
    const voiceStorageKey = item.adapter === "local-voice-kokoro" ? "skai.voice.kokoroInstalled" : item.adapter === "local-voice-piper" ? "skai.voice.piperInstalled" : item.adapter === "local-voice-chatterbox" ? "skai.voice.chatterboxInstalled" : item.adapter === "local-voice-pocket-tts" ? "skai.voice.pocketTtsInstalled" : item.adapter === "local-voice-qwen3-tts" ? "skai.voice.qwen3TtsInstalled" : "skai.voice.whisperInstalled";
    const localVoiceInstalled = item.adapter?.startsWith("local-voice-") && localStorage.getItem(voiceStorageKey) === "true";
    const statusLabel = item.adapter === "local-model-search" ? "Local model search" : item.adapter?.startsWith("local-voice-") ? "Local voice" : item.adapter?.startsWith("model-transform-") ? "Model transformer" : "Local MCP";
    return {
      id: `catalog:${item.id}`, kind: "Catalog", name: item.name, description: item.description,
      category: item.category, access: item.capabilities.join(" · "), status: localVoiceInstalled ? "Installed · local voice" : restrictedLicense
        ? `License review · ${item.license}`
        : `${statusLabel} · ${item.license}`,
      availability: localVoiceInstalled ? "Ready for local speech" : item.adapter === "local-model-search" ? "Search and install local model files" : item.adapter?.startsWith("local-voice-") ? "Install isolated local speech runtime" : item.adapter?.startsWith("model-transform-") ? "Run against a selected local model folder" : localNpmPackage ? "Install local package and connect" : "Connect to a running local service", installed: Boolean(localVoiceInstalled), tone: restrictedLicense && !localVoiceInstalled ? "warning" : "success", source: `${item.provider} · ${item.source}`,
      license: item.license, installReview: item.installReview, adapter: item.adapter,
    };
  });
  const internetEntries: MarketplaceEntry[] = internet.map((item) => ({
    id: `internet:${item.id}`,
    kind: "Catalog",
    name: item.name,
    description: item.description,
    category: item.category,
    access: item.tags.length > 0 ? item.tags.slice(0, 8).join(" · ") : "Internet discovery",
    status: `Online · ${item.source}`,
    availability: item.installable ? "Available through a reviewed local adapter" : "Review source online · no Skai installer",
    installed: false,
    tone: "neutral",
    source: item.source,
    sourceUrl: item.sourceUrl,
    license: item.license ?? undefined,
    installReview: item.installable ? "This result has a compatible local adapter. Review the source and local resource fit before installing." : "Internet discovery only. Skai does not execute or install arbitrary remote repositories.",
    remote: true,
  }));
  return [...skillEntries, ...toolEntries, ...curatedEntries, ...internetEntries].filter((entry) =>
    !term || `${entry.name} ${entry.description} ${entry.category} ${entry.access} ${entry.source}`.toLowerCase().includes(term),
  );
}

export function filterMarketplaceEntries(
  entries: MarketplaceEntry[],
  section: MarketplaceCatalogSection,
): MarketplaceEntry[] {
  return entries.filter((entry) => {
    if (section === "Internet") return entry.remote === true;
    if (section === "Voices") return entry.kind === "Catalog" && entry.category === "Voice (TTS/STT)";
    if (section === "Skills") return entry.kind === "Skills";
    if (section === "MCP Servers") return (entry.kind === "Tools" && (entry.id === "tool:rea" || /mcp/i.test(entry.category))) || (entry.kind === "Catalog" && entry.category === "MCP Servers");
    if (section === "Skai built-ins") return entry.kind === "Tools" && entry.category === "Skai built-ins";
    if (section === "Compatible plugins") return (entry.kind === "Skills" || entry.kind === "Tools") && entry.category === "Compatible plugins";
    if (section === "Plugins") return entry.kind === "Tools" && entry.id !== "tool:rea" && !/mcp/i.test(entry.category);
    return true;
  });
}

export function groupMarketplaceEntries(entries: MarketplaceEntry[]) {
  const groups = new Map<string, MarketplaceEntry[]>();
  for (const entry of entries) {
    const category = entry.category || (entry.kind === "Skills" ? "Skills" : "Tools");
    groups.set(category, [...(groups.get(category) ?? []), entry]);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
}
