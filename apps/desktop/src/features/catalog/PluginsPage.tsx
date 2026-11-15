import { useEffect, useMemo, useState } from "react";
import { Button, Card, EmptyState, StatusBadge } from "../../components/ui/Primitives";
import { NavIcon } from "../../components/ui/NavIcon";

type PluginFilter = "All" | "Skills" | "Tools" | "Installed" | "Official";
type Skill = { id: string; name: string; description: string; category: string; permissions: string[]; source: string; enabled: boolean };
type Tool = { id: string; name: string; description: string; category: string; access: string; builtIn: boolean; status: string };
type OfficialPlugin = { id: string; name: string; category: string; description: string; longDescription: string; publisher: string; version: string; capabilities: string[]; products: string[]; authentication: string; sourceRef: string; repository: string; packagePath: string; sourceUrl: string; websiteUrl: string; privacyUrl: string; termsUrl: string };
type PluginDownload = { id: string; name: string; fileName: string; filePath: string; sha256: string; sizeBytes: number; fileCount?: number; sourceRef?: string; version?: string; integrity?: string };
type McpConnection = { connectionId: string; serverId: string; transport: string; state: string; lastError: string; updatedAtUtc: string };
type McpTool = { serverId: string; toolName: string; description: string; isMutating: boolean; requiredCapabilities: string[] };

function request(method: string, params?: Record<string, unknown>) {
  return window.serverRockAgent?.request(method, params) ?? Promise.resolve({ v: 1, id: `plugins-${method}`, ok: false, error: { code: "BRIDGE_UNAVAILABLE", message: "The Electron agent bridge is unavailable." } });
}

export function PluginsPage({ onNavigate }: { onNavigate?: (route: "models" | "images") => void } = {}) {
  const [filter, setFilter] = useState<PluginFilter>("All");
  const [query, setQuery] = useState("");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [officialPlugins, setOfficialPlugins] = useState<OfficialPlugin[]>([]);
  const [connections, setConnections] = useState<McpConnection[]>([]);
  const [mcpTools, setMcpTools] = useState<Record<string, McpTool[]>>({});
  const [serverId, setServerId] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [mcpBusy, setMcpBusy] = useState(false);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingPlugin, setDownloadingPlugin] = useState<string | null>(null);
  const [downloadNotice, setDownloadNotice] = useState<PluginDownload | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [catalogResponse, skillsResponse, connectionsResponse, directoryResponse] = await Promise.all([request("marketplace.catalog"), request("skills.list"), request("mcp.connections.list"), request("plugins.directory")]);
      if (!catalogResponse.ok) throw new Error(catalogResponse.error?.message ?? "Plugin catalog could not be loaded.");
      if (!skillsResponse.ok) throw new Error(skillsResponse.error?.message ?? "Local skills could not be loaded.");
      const catalog = catalogResponse.result as { tools?: Tool[] };
      if (!directoryResponse.ok) throw new Error(directoryResponse.error?.message ?? "The OpenAI plugin directory could not be loaded.");
      setTools(catalog.tools ?? []);
      setSkills((skillsResponse.result as Skill[]) ?? []);
      setOfficialPlugins(((directoryResponse.result as { plugins?: OfficialPlugin[] }).plugins ?? []));
      if (connectionsResponse.ok) setConnections(((connectionsResponse.result as { connections?: McpConnection[] }).connections ?? []));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Plugins could not be loaded.");
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const entries = useMemo(() => {
    const term = query.trim().toLowerCase();
    const skillEntries = skills.map((skill) => ({ id: `skill:${skill.id}`, kind: "Skills" as const, name: skill.name, description: skill.description, category: skill.category, access: skill.permissions.join(" · ") || "No extra permissions", status: skill.enabled ? "Enabled" : "Disabled", availability: skill.source === "built-in" ? "Built into Skai" : "Local skill", tone: skill.enabled ? "success" as const : "neutral" as const, source: skill.source }));
    const toolEntries = tools.map((tool) => ({ id: `tool:${tool.id}`, kind: "Tools" as const, name: tool.name, description: tool.description, category: tool.category, access: tool.access, status: tool.builtIn ? "Built in" : tool.status, availability: tool.builtIn ? "Available in Skai" : "Not available in this build", tone: tool.builtIn ? "success" as const : "neutral" as const, source: "Marketplace catalog" }));
    const officialEntries = officialPlugins.map((plugin) => ({ id: `official:${plugin.id}`, kind: "Official" as const, name: plugin.name, description: plugin.description, category: plugin.category || "Plugins", access: plugin.capabilities.join(" · ") || `Authentication ${plugin.authentication.toLowerCase()}`, status: "ZIP download", availability: "For Codex / ChatGPT · not installable in Skai", tone: "neutral" as const, source: plugin.publisher, downloadId: plugin.id, sourceUrl: plugin.sourceUrl, version: plugin.version, longDescription: plugin.longDescription, capabilities: plugin.capabilities, products: plugin.products, authentication: plugin.authentication, repository: plugin.repository, sourceRef: plugin.sourceRef, websiteUrl: plugin.websiteUrl, privacyUrl: plugin.privacyUrl, termsUrl: plugin.termsUrl }));
    return [...skillEntries, ...toolEntries, ...officialEntries].filter((entry) => {
      const filterMatch = filter === "All" || filter === "Official" && entry.kind === "Official" || filter === "Skills" && entry.kind === "Skills" || filter === "Tools" && entry.kind === "Tools" || filter === "Installed" && entry.kind === "Skills" && entry.source !== "built-in";
      return filterMatch && (!term || `${entry.name} ${entry.description} ${entry.category} ${entry.access} ${entry.source}`.toLowerCase().includes(term));
    });
  }, [filter, officialPlugins, query, skills, tools]);
  const selected = entries.find((entry) => entry.id === selectedId) ?? null;
  const groupedEntries = useMemo(() => {
    const groups = new Map<string, typeof entries>();
    for (const entry of entries) groups.set(entry.category || (entry.kind === "Skills" ? "Skills" : "Tools"), [...(groups.get(entry.category || (entry.kind === "Skills" ? "Skills" : "Tools")) ?? []), entry]);
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [entries]);
  const downloadOfficialPlugin = async (pluginId: string) => {
    if (downloadingPlugin) return;
    setDownloadingPlugin(pluginId); setDownloadError(null); setDownloadNotice(null);
    try {
      const response = await request("plugins.download", { id: pluginId });
      if (!response.ok) throw new Error(response.error?.message ?? "The plugin package could not be downloaded.");
      setDownloadNotice(response.result as PluginDownload);
    } catch (downloadLoadError) { setDownloadError(downloadLoadError instanceof Error ? downloadLoadError.message : "The plugin package could not be downloaded."); }
    finally { setDownloadingPlugin(null); }
  };
  const connectMcp = async () => {
    if (!serverId.trim() || !endpoint.trim()) return;
    setMcpBusy(true); setMcpError(null);
    try {
      const response = await request("mcp.connection.connect", { serverId: serverId.trim(), endpoint: endpoint.trim(), transport: "streamable-http" });
      if (!response.ok) throw new Error(response.error?.message ?? "MCP connection failed.");
      const result = response.result as { connection: McpConnection; tools?: McpTool[] };
      setConnections((current) => [result.connection, ...current.filter((item) => item.connectionId !== result.connection.connectionId)]);
      setMcpTools((current) => ({ ...current, [result.connection.connectionId]: result.tools ?? [] }));
      setServerId(""); setEndpoint("");
    } catch (connectError) { setMcpError(connectError instanceof Error ? connectError.message : "MCP connection failed."); }
    finally { setMcpBusy(false); }
  };
  const changeMcpState = async (connection: McpConnection, method: "mcp.connection.disconnect" | "mcp.connection.revoke") => {
    setMcpBusy(true); setMcpError(null);
    try {
      const response = await request(method, { connectionId: connection.connectionId });
      if (!response.ok) throw new Error(response.error?.message ?? "MCP connection update failed.");
      const updated = response.result as McpConnection;
      setConnections((current) => current.map((item) => item.connectionId === updated.connectionId ? updated : item));
      setMcpTools((current) => ({ ...current, [updated.connectionId]: [] }));
    } catch (stateError) { setMcpError(stateError instanceof Error ? stateError.message : "MCP connection update failed."); }
    finally { setMcpBusy(false); }
  };

  return <div className="feature-page plugins-page">
    <aside className="plugins-customize-nav" aria-label="Marketplace categories"><p className="plugins-customize-title">Marketplace</p><button type="button" className={filter === "All" ? "is-active" : ""} onClick={() => { setFilter("All"); setQuery(""); }}><NavIcon name="sparkle" />Plugins</button><button type="button" className={filter === "Skills" ? "is-active" : ""} onClick={() => { setFilter("Skills"); setQuery(""); }}><NavIcon name="code" />Skills</button><button type="button" className={filter === "Tools" ? "is-active" : ""} onClick={() => { setFilter("Tools"); setQuery(""); }}><NavIcon name="terminal" />Tools</button><p className="plugins-customize-group">Library</p><button type="button" onClick={() => onNavigate?.("models")}><NavIcon name="project" />Models</button><button type="button" onClick={() => setQuery("voice")}><NavIcon name="activity" />Voice</button><button type="button" onClick={() => onNavigate?.("images")}><NavIcon name="image" />Image workflows</button><button type="button" className={filter === "Installed" ? "is-active" : ""} onClick={() => { setFilter("Installed"); setQuery(""); }}><NavIcon name="marketplace" />Installed</button></aside>
    <div className="plugins-main">
      <header className="plugins-topbar"><h2>Marketplace <span className="plugins-count">{officialPlugins.length} curated</span></h2><div className="plugins-topbar-actions"><label className="plugins-search"><span className="sr-only">Search marketplace</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search marketplace" /></label><Button variant="ghost" className="plugins-icon-button" aria-label="Refresh marketplace" title="Refresh marketplace" disabled={loading} onClick={() => void load()}><NavIcon name="refresh" /></Button>{downloadNotice && <Button variant="secondary" className="plugins-add-button" onClick={() => void window.serverRockAgent?.pluginDownloads?.openFolder()}>Open downloads</Button>}<Button variant="primary" className="plugins-add-button" onClick={() => document.getElementById("plugins-endpoint")?.focus()}><NavIcon name="plus" />Add</Button></div></header>
      {downloadNotice && <div className="plugins-download-notice" role="status"><span><strong>{downloadNotice.name} downloaded</strong><small>{downloadNotice.version ? `Version ${downloadNotice.version} · npm integrity verified` : `${downloadNotice.fileCount} files · source integrity verified`} · SHA-256 {downloadNotice.sha256}</small></span><span className="plugins-download-path">{downloadNotice.filePath}</span></div>}
      {downloadError && <div className="surface-error" role="alert">{downloadError}</div>}
      {error ? <div className="surface-error" role="alert"><strong>Plugins are unavailable</strong><p>{error}</p><Button variant="secondary" onClick={() => void load()}>Retry</Button></div> : loading ? <EmptyState title="Loading plugins…" description="Reading local tools, skills, and the OpenAI curated plugin directory." /> : entries.length === 0 ? <EmptyState title="No matching plugins" description="Try another search or choose a different category." action={<Button variant="secondary" onClick={() => { setQuery(""); setFilter("All"); }}>Clear filters</Button>} /> : <div className="plugins-browser">
        <div className="plugins-catalog" aria-label="Available plugins">{groupedEntries.map(([category, categoryEntries]) => <section className="plugins-category" key={category}><h3>{category}<span className="plugins-category-count">{categoryEntries.length}</span><NavIcon name="chevron-right" /></h3><div className="plugins-category-grid">{categoryEntries.map((entry) => <article className={`plugins-catalog-item${selected?.id === entry.id ? " is-selected" : ""}`} key={entry.id}><span className={`plugins-catalog-icon ${entry.kind === "Skills" ? "is-skill" : entry.kind === "Official" ? "is-official" : "is-tool"}`}><NavIcon name={entry.kind === "Skills" ? "sparkle" : entry.kind === "Official" ? "marketplace" : "project"} /></span><button type="button" className="plugins-catalog-copy" onClick={() => setSelectedId(current => current === entry.id ? null : entry.id)} aria-pressed={selected?.id === entry.id}><strong>{entry.name}</strong><small>{entry.description}</small><span>{entry.availability}</span></button><Button variant="ghost" className="plugins-item-add" aria-label={`Inspect ${entry.name}`} title="View details" onClick={() => setSelectedId(current => current === entry.id ? null : entry.id)}><NavIcon name={selected?.id === entry.id ? "close" : "plus"} /></Button></article>)}</div></section>)}</div>
        <aside className="plugins-inspector" aria-label="Plugin details">{selected ? <Card className="plugins-detail"><div className="plugins-detail-heading"><div><p className="section-kicker">{selected.kind === "Official" ? "OPENAI MARKETPLACE PACKAGE" : "PLUGIN DETAILS"}</p><h3>{selected.name}</h3></div><StatusBadge tone={selected.tone}>{selected.status}</StatusBadge></div><p>{selected.kind === "Official" ? selected.longDescription : selected.description}</p><dl className="model-detail-list"><div><dt>Availability</dt><dd>{selected.availability}</dd></div><div><dt>Type</dt><dd>{selected.kind === "Official" ? "Downloadable plugin package" : selected.kind === "Skills" ? "Reusable local skill" : "Tool integration"}</dd></div><div><dt>Category</dt><dd>{selected.category}</dd></div><div><dt>Capabilities</dt><dd>{selected.access}</dd></div><div><dt>Publisher</dt><dd>{selected.source}</dd></div>{selected.kind === "Official" && <><div><dt>Version</dt><dd>{selected.version}</dd></div><div><dt>Authentication</dt><dd>{selected.authentication === "ON_USE" ? "When first used" : "During setup"}</dd></div><div><dt>Source</dt><dd><button type="button" className="plugins-source-link" onClick={() => void window.serverRockAgent?.updates?.open(selected.sourceUrl)}>Pinned OpenAI repository snapshot</button></dd></div><div><dt>Compatibility</dt><dd>{selected.products.includes("CODEX") ? "Codex" : "Codex and ChatGPT"}</dd></div></>}</dl>{selected.kind === "Official" ? <div className="plugins-detail-note"><strong>Download and review</strong><span>This package downloads for Codex or ChatGPT. Skai does not install or run it. Skai verifies every file against the pinned OpenAI commit and does not execute package code.</span><Button variant="primary" disabled={downloadingPlugin !== null} onClick={() => void downloadOfficialPlugin(selected.downloadId)}>{downloadingPlugin === selected.downloadId ? "Downloading package…" : "Download plugin ZIP"}</Button></div> : <div className="plugins-detail-note"><strong>Safety boundary</strong><span>Skills are bounded instructions. Tools remain governed by explicit permissions and the Agent Host; write actions require approval.</span></div>}</Card> : <div className="plugins-inspector-empty"><p className="section-kicker">PLUGIN INSPECTOR</p><h3>Choose an item to inspect</h3><p>Availability, permissions, compatibility, and next steps will appear here while the catalog stays in view.</p></div>}</aside>
      </div>}
      <Card className="plugins-mcp-note" id="plugins-mcp-connections"><div className="plugins-mcp-copy"><p className="section-kicker">MCP CONNECTIONS</p><h3>Connect a compatible server</h3><p>Connect a Streamable HTTP MCP server explicitly. HTTPS is required for remote servers; plain HTTP is accepted only for loopback development endpoints.</p><div className="plugins-mcp-form"><input value={serverId} onChange={(event) => setServerId(event.target.value)} placeholder="Server ID" aria-label="MCP server ID" /><input id="plugins-endpoint" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://example.com/mcp" aria-label="MCP endpoint" /><Button variant="primary" disabled={mcpBusy || !serverId.trim() || !endpoint.trim()} onClick={() => void connectMcp()}>{mcpBusy ? "Connecting…" : "Connect and review tools"}</Button></div>{mcpError && <p className="surface-error" role="alert">{mcpError}</p>}</div><StatusBadge tone="neutral">Explicit approval required</StatusBadge></Card>
      {connections.length > 0 && <Card className="plugins-connections"><div className="settings-section-heading"><div><p className="section-kicker">CONNECTED SERVERS</p><h3>MCP lifecycle</h3><p>Connections are persisted as credential-free metadata. Revoking one prevents future tool calls and cannot be silently undone.</p></div></div><div className="plugins-connection-list">{connections.map((connection) => { const toolsForConnection = mcpTools[connection.connectionId] ?? []; const tone = connection.state === "healthy" ? "success" : connection.state === "revoked" ? "danger" : "warning"; return <div className="plugins-connection" key={connection.connectionId}><div><strong>{connection.serverId}</strong><small>{connection.transport} · {connection.connectionId}</small><div className="plugins-tool-list">{toolsForConnection.length === 0 ? <span>No live tool manifest</span> : toolsForConnection.map((tool) => <span key={tool.toolName}>{tool.toolName} · {tool.isMutating ? "write approval" : "read approval"}</span>)}</div></div><div className="plugins-connection-actions"><StatusBadge tone={tone}>{connection.state}</StatusBadge>{connection.state !== "revoked" && <><Button variant="ghost" disabled={mcpBusy} onClick={() => void changeMcpState(connection, "mcp.connection.disconnect")}>Disconnect</Button><Button variant="danger" disabled={mcpBusy} onClick={() => void changeMcpState(connection, "mcp.connection.revoke")}>Revoke</Button></>}</div></div>; })}</div></Card>}
    </div>
  </div>;
}
