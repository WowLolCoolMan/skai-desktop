import { useEffect, useMemo, useState } from "react";
import { Button, Card, EmptyState, StatusBadge } from "../../components/ui/Primitives";
import { NavIcon } from "../../components/ui/NavIcon";

type PluginFilter = "All" | "Skills" | "Tools" | "Installed";
type Skill = { id: string; name: string; description: string; category: string; permissions: string[]; source: string; enabled: boolean };
type Tool = { id: string; name: string; description: string; category: string; access: string; builtIn: boolean; status: string };
type McpConnection = { connectionId: string; serverId: string; transport: string; state: string; lastError: string; updatedAtUtc: string };
type McpTool = { serverId: string; toolName: string; description: string; isMutating: boolean; requiredCapabilities: string[] };

function request(method: string, params?: Record<string, unknown>) {
  return window.serverRockAgent?.request(method, params) ?? Promise.resolve({ v: 1, id: `plugins-${method}`, ok: false, error: { code: "BRIDGE_UNAVAILABLE", message: "The Electron agent bridge is unavailable." } });
}

export function PluginsPage() {
  const [filter, setFilter] = useState<PluginFilter>("All");
  const [query, setQuery] = useState("");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [connections, setConnections] = useState<McpConnection[]>([]);
  const [mcpTools, setMcpTools] = useState<Record<string, McpTool[]>>({});
  const [serverId, setServerId] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [mcpBusy, setMcpBusy] = useState(false);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [catalogResponse, skillsResponse, connectionsResponse] = await Promise.all([request("marketplace.catalog"), request("skills.list"), request("mcp.connections.list")]);
      if (!catalogResponse.ok) throw new Error(catalogResponse.error?.message ?? "Plugin catalog could not be loaded.");
      if (!skillsResponse.ok) throw new Error(skillsResponse.error?.message ?? "Local skills could not be loaded.");
      const catalog = catalogResponse.result as { tools?: Tool[] };
      setTools(catalog.tools ?? []);
      setSkills((skillsResponse.result as Skill[]) ?? []);
      if (connectionsResponse.ok) setConnections(((connectionsResponse.result as { connections?: McpConnection[] }).connections ?? []));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Plugins could not be loaded.");
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const entries = useMemo(() => {
    const term = query.trim().toLowerCase();
    const skillEntries = skills.map((skill) => ({ id: `skill:${skill.id}`, kind: "Skills" as const, name: skill.name, description: skill.description, category: skill.category, access: skill.permissions.join(" · ") || "No extra permissions", status: skill.enabled ? "Enabled" : "Disabled", tone: skill.enabled ? "success" as const : "neutral" as const, source: skill.source }));
    const toolEntries = tools.map((tool) => ({ id: `tool:${tool.id}`, kind: "Tools" as const, name: tool.name, description: tool.description, category: tool.category, access: tool.access, status: tool.builtIn ? "Built in" : tool.status, tone: tool.builtIn ? "success" as const : "neutral" as const, source: "Marketplace catalog" }));
    return [...skillEntries, ...toolEntries].filter((entry) => (filter === "All" || entry.kind === filter || filter === "Installed" && entry.kind === "Skills" && entry.source !== "built-in") && (!term || `${entry.name} ${entry.description} ${entry.category} ${entry.access}`.toLowerCase().includes(term)));
  }, [filter, query, skills, tools]);
  const selected = entries.find((entry) => entry.id === selectedId) ?? null;
  const groupedEntries = useMemo(() => {
    const groups = new Map<string, typeof entries>();
    for (const entry of entries) groups.set(entry.category || (entry.kind === "Skills" ? "Skills" : "Tools"), [...(groups.get(entry.category || (entry.kind === "Skills" ? "Skills" : "Tools")) ?? []), entry]);
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [entries]);
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
    <aside className="plugins-customize-nav" aria-label="Plugin categories"><p className="plugins-customize-title">Customize</p><button type="button" className={filter === "All" ? "is-active" : ""} onClick={() => setFilter("All")}><NavIcon name="sparkle" />Plugins</button><button type="button" className={filter === "Skills" ? "is-active" : ""} onClick={() => setFilter("Skills")}><NavIcon name="code" />Skills</button><p className="plugins-customize-group">Installed</p><button type="button" className={filter === "Installed" ? "is-active" : ""} onClick={() => setFilter("Installed")}><NavIcon name="marketplace" />Local plugins</button><button type="button" className={filter === "Tools" ? "is-active" : ""} onClick={() => setFilter("Tools")}><NavIcon name="terminal" />Tools</button></aside>
    <div className="plugins-main">
      <header className="plugins-topbar"><h2>Plugins</h2><div className="plugins-topbar-actions"><label className="plugins-search"><span className="sr-only">Search plugins</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search plugins" /></label><Button variant="ghost" className="plugins-icon-button" aria-label="Refresh plugins" title="Refresh plugins" disabled={loading} onClick={() => void load()}><NavIcon name="refresh" /></Button><Button variant="primary" className="plugins-add-button" onClick={() => document.getElementById("plugins-endpoint")?.focus()}><NavIcon name="plus" />Add</Button></div></header>
      {error ? <div className="surface-error" role="alert"><strong>Plugins are unavailable</strong><p>{error}</p><Button variant="secondary" onClick={() => void load()}>Retry</Button></div> : loading ? <EmptyState title="Loading plugins…" description="Reading the local catalog and enabled skills." /> : entries.length === 0 ? <EmptyState title="No matching plugins" description="Try another search or choose a different category." action={<Button variant="secondary" onClick={() => { setQuery(""); setFilter("All"); }}>Clear filters</Button>} /> : <div className="plugins-catalog" aria-label="Available plugins">{groupedEntries.map(([category, categoryEntries]) => <section className="plugins-category" key={category}><h3>{category}<NavIcon name="chevron-right" /></h3><div className="plugins-category-grid">{categoryEntries.map((entry) => <article className={`plugins-catalog-item${selected?.id === entry.id ? " is-selected" : ""}`} key={entry.id}><span className={`plugins-catalog-icon ${entry.kind === "Skills" ? "is-skill" : "is-tool"}`}><NavIcon name={entry.kind === "Skills" ? "sparkle" : "project"} /></span><button type="button" className="plugins-catalog-copy" onClick={() => setSelectedId(current => current === entry.id ? null : entry.id)} aria-pressed={selected?.id === entry.id}><strong>{entry.name}</strong><small>{entry.description}</small></button><Button variant="ghost" className="plugins-item-add" aria-label={`Inspect ${entry.name}`} title={`Inspect ${entry.name}`} onClick={() => setSelectedId(current => current === entry.id ? null : entry.id)}><NavIcon name={selected?.id === entry.id ? "close" : "plus"} /></Button></article>)}</div></section>)}</div>}
      {selected && <Card className="plugins-detail"><div className="plugins-detail-heading"><div><p className="section-kicker">PLUGIN DETAILS</p><h3>{selected.name}</h3></div><StatusBadge tone={selected.tone}>{selected.status}</StatusBadge></div><p>{selected.description}</p><dl className="model-detail-list"><div><dt>Type</dt><dd>{selected.kind === "Skills" ? "Reusable local skill" : "Connected tool"}</dd></div><div><dt>Category</dt><dd>{selected.category}</dd></div><div><dt>Access</dt><dd>{selected.access}</dd></div><div><dt>Source</dt><dd>{selected.source}</dd></div></dl><div className="plugins-detail-note"><strong>Safety boundary</strong><span>Skills are bounded instructions. Tools remain governed by explicit permissions and the Agent Host; write actions require approval.</span></div></Card>}
      <Card className="plugins-mcp-note" id="plugins-mcp-connections"><div className="plugins-mcp-copy"><p className="section-kicker">MCP CONNECTIONS</p><h3>Bring your own compatible tools</h3><p>Connect a Streamable HTTP MCP server explicitly. HTTPS is required for remote servers; plain HTTP is accepted only for loopback development endpoints.</p><div className="plugins-mcp-form"><input value={serverId} onChange={(event) => setServerId(event.target.value)} placeholder="Server ID" aria-label="MCP server ID" /><input id="plugins-endpoint" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://example.com/mcp" aria-label="MCP endpoint" /><Button variant="primary" disabled={mcpBusy || !serverId.trim() || !endpoint.trim()} onClick={() => void connectMcp()}>{mcpBusy ? "Connecting…" : "Connect and review tools"}</Button></div>{mcpError && <p className="surface-error" role="alert">{mcpError}</p>}</div><StatusBadge tone="neutral">Explicit approval required</StatusBadge></Card>
      {connections.length > 0 && <Card className="plugins-connections"><div className="settings-section-heading"><div><p className="section-kicker">CONNECTED SERVERS</p><h3>MCP lifecycle</h3><p>Connections are persisted as credential-free metadata. Revoking one prevents future tool calls and cannot be silently undone.</p></div></div><div className="plugins-connection-list">{connections.map((connection) => { const toolsForConnection = mcpTools[connection.connectionId] ?? []; const tone = connection.state === "healthy" ? "success" : connection.state === "revoked" ? "danger" : "warning"; return <div className="plugins-connection" key={connection.connectionId}><div><strong>{connection.serverId}</strong><small>{connection.transport} · {connection.connectionId}</small><div className="plugins-tool-list">{toolsForConnection.length === 0 ? <span>No live tool manifest</span> : toolsForConnection.map((tool) => <span key={tool.toolName}>{tool.toolName} · {tool.isMutating ? "write approval" : "read approval"}</span>)}</div></div><div className="plugins-connection-actions"><StatusBadge tone={tone}>{connection.state}</StatusBadge>{connection.state !== "revoked" && <><Button variant="ghost" disabled={mcpBusy} onClick={() => void changeMcpState(connection, "mcp.connection.disconnect")}>Disconnect</Button><Button variant="danger" disabled={mcpBusy} onClick={() => void changeMcpState(connection, "mcp.connection.revoke")}>Revoke</Button></>}</div></div>; })}</div></Card>}
    </div>
  </div>;
}
