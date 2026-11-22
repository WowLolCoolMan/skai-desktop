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

type MarketplaceHubSection = MarketplaceCatalogSection;
type StaffPickKind = "Model" | "MCP server" | "Skill" | "Plugin" | "Voice pack" | "Persona" | "Highlight";
type StaffPickAction =
  | { label: string; type: "external"; url: string }
  | { label: string; type: "section"; section: MarketplaceHubSection; query?: string }
  | { label: string; type: "route"; route: Route };
type StaffPick = { id: string; kind: StaffPickKind; title: string; description: string; details: string; publisher: string; icon: "model" | "activity" | "sparkle" | "terminal" | "project" | "image"; actions: StaffPickAction[] };

// Developers can curate any marketplace resource or a general highlight here.
// Type-specific installs should route into the corresponding reviewed catalog flow.
const staffPicks: StaffPick[] = [
  { id: "sophon-realtime", kind: "Model", title: "Sophon-Realtime v1", description: "Open full-duplex speech-to-speech by Adventists.ai, with expressive voice and interruption handling.", details: "Apache-2.0 · Recommended Tag build: about 42 GB and an 80 GB GPU · Self-hosting requires Linux and CUDA.", publisher: "Adventists.ai", icon: "activity", actions: [{ label: "Open model card", type: "external", url: "https://huggingface.co/adventists-ai/Sophon-Realtime-v1" }, { label: "Browse models", type: "section", section: "Models", query: "adventists-ai/Sophon-Realtime-v1" }] },
  { id: "lfm3-omni-2b", kind: "Model", title: "LFM3-Omni-2B", description: "Compact all-in-one model from Liquid AI for text, images, video, and audio, with text or speech output.", details: "LFM Open License v1.0 · 32K context · GGUF is supported by llama.cpp for local use.", publisher: "Liquid AI", icon: "model", actions: [{ label: "Open model card", type: "external", url: "https://huggingface.co/LiquidAI/LFM3-Omni-2B" }, { label: "Find GGUF build", type: "section", section: "Models", query: "LiquidAI/LFM3-Omni-2B-GGUF" }] },
];

function StaffPicksPanel({ onNavigate, onNavigateRoute }: { onNavigate: (section: MarketplaceHubSection, query?: string) => void; onNavigateRoute: (route: Route) => void }) {
  const iconFor: Record<StaffPickKind, StaffPick["icon"]> = { Model: "model", "MCP server": "terminal", Skill: "sparkle", Plugin: "project", "Voice pack": "activity", Persona: "sparkle", Highlight: "image" };
  return <section className="marketplace-staff-picks" aria-label="Developer staff picks">
    <header className="plugins-topbar"><div><h2>Staff Picks</h2><p className="page-description">Developer-curated models, skills, voices, personas, plugins, servers, and other things worth a look.</p></div></header>
    {staffPicks.length === 0 ? <EmptyState title="No staff picks yet" description="Developer-curated Marketplace highlights will appear here." /> : <div className="marketplace-staff-picks-list">{staffPicks.map((pick) => <article className="marketplace-developer-pick" key={pick.id}>
      <div className="marketplace-developer-pick-mark" aria-hidden="true"><NavIcon name={iconFor[pick.kind] ?? pick.icon} /></div>
      <div className="marketplace-developer-pick-copy"><div className="marketplace-developer-pick-heading"><h3>{pick.title}</h3><span className="marketplace-developer-favorite"><span aria-hidden="true">★</span> Developer Favorite</span><StatusBadge tone="neutral">{pick.kind}</StatusBadge></div><p>{pick.description}</p><small>{pick.details} · {pick.publisher}</small></div>
      <div className="marketplace-developer-pick-actions">{pick.actions.map((action) => <Button key={`${pick.id}:${action.label}`} variant={action.type === "section" ? "primary" : "secondary"} type="button" onClick={() => { if (action.type === "external") void window.skaiAgent?.updates?.open(action.url); else if (action.type === "section") onNavigate(action.section, action.query); else onNavigateRoute(action.route); }}>{action.label}</Button>)}</div>
    </article>)}</div>}
  </section>;
}


export function PluginsPage({
  onNavigate,
  onSelectAirLlmModel,
}: {
  onNavigate?: (route: Route) => void;
  onSelectAirLlmModel?: (model: Model) => void;
} = {}) {
  const [view, setView] = useState<"catalog" | "models" | "voices" | "installed" | "staff-picks">("catalog");
  const [catalogSection, setCatalogSection] = useState<MarketplaceHubSection>("Discover");
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

  const changeCatalogSection = (next: MarketplaceHubSection, nextQuery?: string) => {
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
