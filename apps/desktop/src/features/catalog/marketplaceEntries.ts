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

export type MarketplaceCatalogSection = "Discover" | "Staff Picks" | "Models" | "Voices" | "MCP Servers" | "Skills" | "Plugins" | "Installed" | "Updates" | "Skai built-ins" | "Compatible plugins";

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
  tone: "success" | "neutral";
  source: string;
  license?: string;
  installReview?: string;
};

export type CuratedCatalogEntry = { id: string; name: string; provider: string; category: string; license: string; description: string; runtime: string; capabilities: string[]; source: string; localOnly: boolean; installable: boolean; installReview: string };

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
  const toolEntries: MarketplaceEntry[] = [...tools, reaTool].map((tool) => {
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

  const curatedEntries: MarketplaceEntry[] = curated.map((item) => ({
    id: `catalog:${item.id}`, kind: "Catalog", name: item.name, description: item.description,
    category: item.category, access: item.capabilities.join(" · "), status: item.license.toLowerCase().includes("non-commercial") || item.license.toLowerCase().includes("research") || item.license.toLowerCase().includes("llama") || item.license.toLowerCase().includes("custom") ? `License review · ${item.license}` : item.license,
    availability: `${item.runtime} · Local only`, installed: false, tone: "neutral", source: `${item.provider} · ${item.source}`,
    license: item.license, installReview: item.installReview,
  }));
  return [...skillEntries, ...toolEntries, ...curatedEntries].filter((entry) =>
    !term || `${entry.name} ${entry.description} ${entry.category} ${entry.access} ${entry.source}`.toLowerCase().includes(term),
  );
}

export function filterMarketplaceEntries(
  entries: MarketplaceEntry[],
  section: MarketplaceCatalogSection,
): MarketplaceEntry[] {
  return entries.filter((entry) => {
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
