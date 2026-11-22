import { useEffect, useState } from "react";
import {
  Button,
  Card,
  EmptyState,
  StatusBadge,
} from "../../components/ui/Primitives";
import { NavIcon } from "../../components/ui/NavIcon";
import "./pluginsMcpHealth.css";
import type { Model, Route } from "../../app/types";
import { MarketplacePage } from "./MarketplacePage";
import { McpConnectionsPanel } from "./McpConnectionsPanel";
import { StaffPicksPanel } from "./StaffPicksPanel";
import { request } from "./marketplaceRequest";
import {
  createMarketplaceEntries,
  filterMarketplaceEntries,
  groupMarketplaceEntries,
  type MarketplaceCatalogSection,
  type Skill,
  type Tool,
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
  const [view, setView] = useState<"catalog" | "models" | "voices" | "installed" | "staff-picks">("catalog");
  const [catalogSection, setCatalogSection] = useState<MarketplaceCatalogSection>("Discover");
  const [query, setQuery] = useState("");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
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
    setView(next === "Models" ? "models" : next === "Voices" ? "voices" : next === "Installed" ? "installed" : next === "Staff Picks" ? "staff-picks" : "catalog");
    if (!["Models", "Installed", "Staff Picks"].includes(next)) {
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
      const catalog = catalogResponse.result as { tools?: Tool[] };
      setTools(catalog.tools ?? []);
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

  const entries = createMarketplaceEntries(skills, tools, connections, query);
  const sectionEntries = filterMarketplaceEntries(entries, catalogSection);
  const selected = sectionEntries.find((entry) => entry.id === selectedId) ?? null;
  const groupedEntries = groupMarketplaceEntries(sectionEntries);
  return (
    <div className="feature-page plugins-page">
      <aside
        className="plugins-customize-nav"
        aria-label="Marketplace sections"
      >
        <p className="plugins-customize-title">Marketplace</p>
        {([
          ["Discover", "sparkle"],
          ["Staff Picks", "sparkle"],
          ["Models", "model"],
          ["Voices", "activity"],
          ["MCP Servers", "terminal"],
          ["Skills", "sparkle"],
          ["Plugins", "project"],
          ["Installed", "memory"],
        ] as const).map(([item, icon]) => <button key={item} type="button" className={catalogSection === item ? "is-active" : ""} aria-current={catalogSection === item ? "page" : undefined} onClick={() => changeCatalogSection(item)}><NavIcon name={icon} />{item}</button>)}
      </aside>
      <div className="plugins-main">
        {view === "models" || view === "voices" || view === "installed" ? (
          <MarketplacePage
            initialSection={view === "models" ? "Models" : view === "voices" ? "Voices" : "Installed"}
            initialQuery={view === "models" ? query : undefined}
            onBack={() => changeCatalogSection("Discover")}
            onNavigate={onNavigate}
            onSelectAirLlmModel={onSelectAirLlmModel}
          />
        ) : view === "staff-picks" ? (
          <StaffPicksPanel onNavigate={changeCatalogSection} onNavigateRoute={(route) => onNavigate?.(route)} />
        ) : (
          <>
            <header className="plugins-topbar">
              <h2>
                {catalogSection}
                <span className="plugins-count">{sectionEntries.length} {catalogSection === "Discover" ? "available in Skai" : catalogSection.toLowerCase()}</span>
              </h2>
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
              <section className="plugins-start-panel" aria-labelledby="plugins-start-title">
                <div><p className="section-kicker">USEFUL STARTING POINTS</p><h3 id="plugins-start-title">Add capability when you have a reason</h3><p>Browse what Skai can use locally, inspect permissions and compatibility, then connect or install only when the next step is clear.</p></div>
                <div className="plugins-start-actions"><Button variant="primary" type="button" onClick={() => changeCatalogSection("Models")}>Find a model</Button><Button variant="secondary" type="button" onClick={() => changeCatalogSection("Voices")}>Choose a voice</Button><Button variant="secondary" type="button" onClick={() => changeCatalogSection("MCP Servers")}>Connect an MCP server</Button><Button variant="ghost" type="button" onClick={() => changeCatalogSection("Installed")}>Review installed</Button></div>
              </section>
            )}
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
              <div className="plugins-browser">
                <div className="plugins-catalog" aria-label="Skai capabilities">
                  {groupedEntries.map(([category, categoryEntries]) => (
                    <section className="plugins-category" key={category}>
                      <h3>
                        {category}
                        <span className="plugins-category-count">
                          {categoryEntries.length}
                        </span>
                        <NavIcon name="chevron-right" />
                      </h3>
                      <div className="plugins-category-grid">
                        {categoryEntries.map((entry) => (
                          <article
                            className={`plugins-catalog-item${selected?.id === entry.id ? " is-selected" : ""}`}
                            key={entry.id}
                          >
                            <span
                              className={`plugins-catalog-icon ${entry.kind === "Skills" ? "is-skill" : "is-tool"}`}
                            >
                              <NavIcon
                                name={
                                  entry.kind === "Skills"
                                    ? "sparkle"
                                    : "project"
                                }
                              />
                            </span>
                            <button
                              type="button"
                              className="plugins-catalog-copy"
                              onClick={() =>
                                setSelectedId((current) =>
                                  current === entry.id ? null : entry.id,
                                )
                              }
                              aria-pressed={selected?.id === entry.id}
                            >
                              <strong>{entry.name}</strong>
                              <small>{entry.description}</small>
                              <span>{entry.availability}</span>
                            </button>
                            <Button
                              variant="ghost"
                              className="plugins-item-add"
                              aria-label={`Inspect ${entry.name}`}
                              title="View details"
                              onClick={() =>
                                setSelectedId((current) =>
                                  current === entry.id ? null : entry.id,
                                )
                              }
                            >
                              <NavIcon
                                name={
                                  selected?.id === entry.id ? "close" : "plus"
                                }
                              />
                            </Button>
                          </article>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
                <aside
                  className="plugins-inspector"
                  aria-label="Plugin details"
                >
                  {selected ? (
                    <Card className="plugins-detail">
                      <div className="plugins-detail-heading">
                        <div>
                          <p className="section-kicker">PLUGIN DETAILS</p>
                          <h3>{selected.name}</h3>
                        </div>
                        <StatusBadge tone={selected.tone}>
                          {selected.status}
                        </StatusBadge>
                      </div>
                      <p>{selected.description}</p>
                      <dl className="model-detail-list">
                        <div>
                          <dt>Availability</dt>
                          <dd>{selected.availability}</dd>
                        </div>
                        <div>
                          <dt>Type</dt>
                          <dd>
                            {selected.kind === "Skills"
                              ? "Reusable local skill"
                              : "Tool integration"}
                          </dd>
                        </div>
                        <div>
                          <dt>Category</dt>
                          <dd>{selected.category}</dd>
                        </div>
                        <div>
                          <dt>Capabilities</dt>
                          <dd>{selected.access}</dd>
                        </div>
                        <div>
                          <dt>Publisher</dt>
                          <dd>{selected.source}</dd>
                        </div>
                      </dl>
                      {selected.id === "tool:rea" ? (
                        <div className="plugins-detail-note">
                          <strong>
                            Verified local MCP package · version 6.7.0
                          </strong>
                          <span>
                            Published by morluto. Requires Node.js 22.19.0+,
                            24.11.0+, or 26.0.0+. Download verifies the pinned
                            npm SHA-512 digest. Connecting runs the reviewed REA
                            stdio profile; tool calls remain governed by Skai
                            approval.
                          </span>
                          <div className="plugins-detail-actions">
                            <Button
                              variant="secondary"
                              disabled={mcpBusy}
                              onClick={() => void downloadRea()}
                            >
                              {mcpBusy ? "Working…" : "Download package"}
                            </Button>
                            <Button
                              variant="primary"
                              disabled={
                                mcpBusy ||
                                connections.some(
                                  (connection) =>
                                    connection.serverId === "rea" &&
                                    connection.state === "healthy",
                                )
                              }
                              onClick={() => void connectRea()}
                            >
                              {connections.some(
                                (connection) =>
                                  connection.serverId === "rea" &&
                                  connection.state === "healthy",
                              )
                                ? "Connected"
                                : "Connect locally"}
                            </Button>
                            <Button
                              variant="ghost"
                              onClick={() =>
                                void window.skaiAgent?.updates?.open(
                                  "https://github.com/morluto/rea",
                                )
                              }
                            >
                              View source
                            </Button>
                          </div>
                          {mcpError && (
                            <span className="surface-error" role="alert">
                              {mcpError}
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="plugins-detail-note">
                          <strong>Safety boundary</strong>
                          <span>
                            Skills are bounded instructions. Tools remain
                            governed by explicit permissions and the Agent Host;
                            write actions require approval.
                          </span>
                        </div>
                      )}
                    </Card>
                  ) : (
                    <div className="plugins-inspector-empty">
                      <p className="section-kicker">PLUGIN INSPECTOR</p>
                      <h3>Choose an item to inspect</h3>
                      <p>
                        Availability, permissions, compatibility, and next steps
                        will appear here while the catalog stays in view.
                      </p>
                    </div>
                  )}
                </aside>
              </div>
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
