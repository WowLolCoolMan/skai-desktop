import { useEffect, useState } from "react";
import {
  Button,
  EmptyState,
  StatusBadge,
} from "../../components/ui/Primitives";
import { NavIcon } from "../../components/ui/NavIcon";
import "./pluginsMcpHealth.css";
import type { Model, Route } from "../../app/types";
import { MarketplacePage } from "./MarketplacePage";
import { McpConnectionsPanel } from "./McpConnectionsPanel";
import { MarketplaceCatalogBrowser } from "./MarketplaceCatalogBrowser";
import { request } from "./marketplaceRequest";
import {
  createMarketplaceEntries,
  filterMarketplaceEntries,
  groupMarketplaceEntries,
  type MarketplaceCatalogSection,
  type Skill,
  type Tool,
  type CuratedCatalogEntry,
} from "./marketplaceEntries";
import { useMarketplaceMcp, type McpConnection } from "./useMarketplaceMcp";
export { VoiceWorkbench } from "./VoiceWorkbench";

export function PluginsPage({
  onNavigate,
  onSelectAirLlmModel,
}: {
  onNavigate?: (route: Route) => void;
  onSelectAirLlmModel?: (model: Model) => void;
} = {}) {
  const [view, setView] = useState<"catalog" | "models" | "voices" | "installed" | "updates">("catalog");
  const [catalogSection, setCatalogSection] = useState<MarketplaceCatalogSection>("Discover");
  const [query, setQuery] = useState("");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [curated, setCurated] = useState<CuratedCatalogEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mcp = useMarketplaceMcp(setNotice);
  const {
    connections,
    tools: mcpTools,
    selectedConnectionId,
    setSelectedConnectionId,
    serverId,
    setServerId,
    endpoint,
    setEndpoint,
    busy: mcpBusy,
    error: mcpError,
    connect: connectMcp,
    refreshHealth: refreshMcpHealth,
    downloadRea,
    connectRea,
    changeState: changeMcpState,
  } = mcp;

  const changeCatalogSection = (next: MarketplaceCatalogSection, nextQuery?: string) => {
    setCatalogSection(next);
    setView(next === "Models" ? "models" : next === "Voices" ? "voices" : next === "Installed" ? "installed" : next === "Updates" ? "updates" : "catalog");
    if (!["Installed", "Staff Picks"].includes(next)) {
      setQuery(nextQuery ?? localStorage.getItem(`skai.marketplace.query.${next.toLowerCase()}`) ?? "");
      setSelectedId(null);
    }
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const [catalogResponse, skillsResponse, connectionsResponse] =
        await Promise.all([
          request("marketplace.catalog"),
          request("skills.list"),
          request("mcp.connections.list"),
        ]);
      if (!catalogResponse.ok)
        throw new Error(
          catalogResponse.error?.message ??
            "Plugin catalog could not be loaded.",
        );
      if (!skillsResponse.ok)
        throw new Error(
          skillsResponse.error?.message ?? "Local skills could not be loaded.",
        );
      const catalog = catalogResponse.result as { tools?: Tool[]; catalogEntries?: CuratedCatalogEntry[] };
      setTools(catalog.tools ?? []);
      setCurated(catalog.catalogEntries ?? []);
      setSkills((skillsResponse.result as Skill[]) ?? []);
      if (connectionsResponse.ok) {
        const nextConnections =
          (connectionsResponse.result as { connections?: McpConnection[] })
            .connections ?? [];
        mcp.loadConnections(nextConnections);
      } else
        setNotice((current) =>
          current
            ? `${current} MCP connections could not be refreshed.`
            : "MCP connections could not be refreshed.",
        );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Plugins could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (view === "catalog")
      localStorage.setItem(
        `skai.marketplace.query.${catalogSection.toLowerCase()}`,
        query,
      );
  }, [catalogSection, query, view]);

  const entries = createMarketplaceEntries(skills, tools, connections, query, curated);
  const sectionEntries = filterMarketplaceEntries(entries, catalogSection);
  const selected = sectionEntries.find((entry) => entry.id === selectedId) ?? null;
  const groupedEntries = groupMarketplaceEntries(sectionEntries);
  return (
    <div className="feature-page plugins-page">
      <aside
        className="plugins-customize-nav"
        aria-label="Marketplace sections"
      >
        <div className="plugins-nav-brand">
          <span className="plugins-nav-brand-mark" aria-hidden="true"><NavIcon name="sparkle" /></span>
          <div>
            <strong>Marketplace</strong>
            <small>Local capability catalog</small>
          </div>
        </div>
        <p className="plugins-customize-label">BROWSE</p>
        {([
          ["Discover", "sparkle"],
          ["Models", "model"],
          ["Voices", "activity"],
          ["Tools", "terminal"],
          ["Updates", "arrow-up-right"],
        ] as const).map(([item, icon]) => {
          const active = item === "Tools"
            ? ["MCP Servers", "Skai built-ins", "Compatible plugins", "Installed"].includes(catalogSection)
            : catalogSection === item;
          return <button key={item} type="button" className={active ? "is-active" : ""} aria-current={active ? "page" : undefined} onClick={() => changeCatalogSection(item === "Tools" ? "MCP Servers" : item)}><NavIcon name={icon} /><span>{item}</span>{item === "Models" && <small>Live</small>}{item === "Tools" && <small>{tools.length + skills.length}</small>}</button>;
        })}
        {["MCP Servers", "Skai built-ins", "Compatible plugins", "Installed"].includes(catalogSection) && <div className="plugins-tool-subnav" role="tablist" aria-label="Tools categories">
          {(["MCP Servers", "Skai built-ins", "Compatible plugins", "Installed"] as const).map((item) => <button key={item} type="button" role="tab" aria-selected={catalogSection === item} className={catalogSection === item ? "is-active" : ""} onClick={() => changeCatalogSection(item)}>{item === "MCP Servers" ? "MCP servers" : item}</button>)}
        </div>}
        <div className="plugins-nav-note">
          <span className="plugins-nav-note-dot" aria-hidden="true" />
          <div><strong>Stays on this device</strong><small>Review source, runtime, and permissions before connecting.</small></div>
        </div>
      </aside>
      <div className="plugins-main">
        {view === "models" || view === "voices" || view === "installed" || view === "updates" ? (
          <MarketplacePage
            initialSection={view === "models" ? "Models" : view === "voices" ? "Voices" : view === "updates" ? "Updates" : "Installed"}
            initialQuery={view === "models" ? query : undefined}
            onBack={() => changeCatalogSection("Discover")}
            onNavigate={onNavigate}
            onSelectAirLlmModel={onSelectAirLlmModel}
          />
        ) : (
          <>
            <header className="plugins-topbar">
              <div className="plugins-heading-lockup">
                <span className="plugins-heading-mark" aria-hidden="true"><NavIcon name={catalogSection === "Discover" ? "sparkle" : catalogSection === "MCP Servers" || catalogSection === "Skai built-ins" || catalogSection === "Compatible plugins" ? "terminal" : "project"} /></span>
                <div><p className="plugins-eyebrow">SKAI MARKETPLACE</p><h2>{catalogSection === "MCP Servers" ? "MCP servers" : catalogSection}</h2><p className="plugins-heading-description">{catalogSection === "Discover" ? "Search local models and inspect what can be installed on this device." : catalogSection === "MCP Servers" ? "Connect a local MCP server or review the available package." : catalogSection === "Skai built-ins" ? "Hand-picked capabilities already built into Skai." : catalogSection === "Compatible plugins" ? "Plugins and skills that work inside Skai Desktop." : `Browse ${catalogSection.toLowerCase()} available on this device.`}</p></div>
              </div>
              <div className="plugins-heading-meta"><StatusBadge tone="success">Local catalog</StatusBadge><span className="plugins-count">{sectionEntries.length} {catalogSection === "Discover" ? "available" : catalogSection.toLowerCase()}</span></div>
              <div className="plugins-topbar-actions">
                <label className="plugins-search">
                  <span className="sr-only">Search marketplace</span>
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={`Search ${catalogSection.toLowerCase()}`}
                  />
                </label>
                <Button
                  variant="ghost"
                  className="plugins-icon-button"
                  aria-label="Refresh marketplace"
                  title="Refresh marketplace"
                  disabled={loading}
                  onClick={() => void load()}
                >
                  <NavIcon name="refresh" />
                </Button>
                {catalogSection === "MCP Servers" && (
                  <Button
                    variant="primary"
                    className="plugins-add-button"
                    onClick={() =>
                      document.getElementById("plugins-endpoint")?.focus()
                    }
                  >
                    <NavIcon name="plus" />
                    Connect server
                  </Button>
                )}
              </div>
            </header>
            {notice && (
              <div className="plugins-catalog-notice" role="status">
                {notice}
              </div>
            )}
            {catalogSection === "Discover" && !query.trim() && (
              <section className="plugins-start-panel" aria-label="Marketplace actions">
                <div><p className="section-kicker">LOCAL WORKSPACE</p><h3>Marketplace</h3><p>Model search finds packages for local runtimes. Inference stays on your configured runtime.</p></div>
                <div className="plugins-start-actions"><Button variant="primary" type="button" onClick={() => changeCatalogSection("Models")}>Search models</Button><Button variant="secondary" type="button" onClick={() => changeCatalogSection("MCP Servers")}>Connect MCP</Button><Button variant="secondary" type="button" onClick={() => changeCatalogSection("Installed")}>Open installed</Button><Button variant="ghost" type="button" onClick={() => changeCatalogSection("Updates")}>Check updates</Button></div>
              </section>
            )}
            {catalogSection === "Discover" && !query.trim() && <nav className="marketplace-category-filters" aria-label="Filter by category">
              <span>Browse by category</span>
              {([
                ["Voice", "Voices", "activity", undefined],
                ["Coding", "Models", "model", "code"],
                ["Chat", "Models", "model", "chat"],
                ["Image", "Models", "image", "image"],
                ["MCP", "MCP Servers", "terminal", undefined],
              ] as const).map(([label, section, icon, term]) => <button key={label} type="button" onClick={() => changeCatalogSection(section, term)}><NavIcon name={icon} /><span>{label}</span></button>)}
            </nav>}
            {error ? (
              <div className="surface-error" role="alert">
                <strong>Marketplace is unavailable</strong>
                <p>{error}</p>
                <Button variant="secondary" onClick={() => void load()}>
                  Retry
                </Button>
              </div>
            ) : loading ? (
              <EmptyState
                title="Loading Marketplace…"
                description="Reading tools and skills available in Skai."
              />
            ) : sectionEntries.length === 0 ? (
              <EmptyState
                title="No matching items"
                description="Try another search or choose a different category."
                action={
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setQuery("");
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <MarketplaceCatalogBrowser
                groups={groupedEntries}
                selected={selected}
                connections={connections}
                busy={mcpBusy}
                error={mcpError}
                onToggleSelect={(id) => setSelectedId((current) => current === id ? null : id)}
                onDownloadRea={downloadRea}
                onConnectRea={connectRea}
              />
            )}
            {catalogSection === "MCP Servers" && <McpConnectionsPanel
              connections={connections}
              toolsByConnection={mcpTools}
              selectedConnectionId={selectedConnectionId}
              onSelectConnection={setSelectedConnectionId}
              busy={mcpBusy}
              onRefreshHealth={(connection) => void refreshMcpHealth(connection)}
              onChangeState={(connection, method) => void changeMcpState(connection, method)}
              serverId={serverId}
              onServerIdChange={setServerId}
              endpoint={endpoint}
              onEndpointChange={setEndpoint}
              onConnect={() => void connectMcp()}
              error={mcpError}
            />}
          </>
        )}
      </div>
    </div>
  );
}
