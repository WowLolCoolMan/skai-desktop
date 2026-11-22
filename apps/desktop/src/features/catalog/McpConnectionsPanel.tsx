import { Button, Card, StatusBadge } from "../../components/ui/Primitives";
import type { McpConnection, McpTool } from "./useMarketplaceMcp";

export function McpConnectionsPanel({
  connections,
  toolsByConnection,
  selectedConnectionId,
  onSelectConnection,
  busy,
  onRefreshHealth,
  onChangeState,
  serverId,
  onServerIdChange,
  endpoint,
  onEndpointChange,
  onConnect,
  error,
}: {
  connections: McpConnection[];
  toolsByConnection: Record<string, McpTool[]>;
  selectedConnectionId: string | null;
  onSelectConnection: (connectionId: string | null) => void;
  busy: boolean;
  onRefreshHealth: (connection: McpConnection) => void;
  onChangeState: (connection: McpConnection, method: "mcp.connection.disconnect" | "mcp.connection.revoke") => void;
  serverId: string;
  onServerIdChange: (value: string) => void;
  endpoint: string;
  onEndpointChange: (value: string) => void;
  onConnect: () => void;
  error: string | null;
}) {
  return <>
    <Card className="plugins-mcp-note" id="plugins-mcp-connections">
      <div className="plugins-mcp-copy">
        <p className="section-kicker">MCP CONNECTIONS</p>
        <h3>Connect a compatible server</h3>
        <p>Connect a Streamable HTTP MCP server explicitly. HTTPS is required for remote servers; plain HTTP is accepted only for loopback development endpoints.</p>
        <div className="plugins-mcp-form">
          <input value={serverId} onChange={(event) => onServerIdChange(event.target.value)} placeholder="Server ID" aria-label="MCP server ID" />
          <input id="plugins-endpoint" value={endpoint} onChange={(event) => onEndpointChange(event.target.value)} placeholder="https://example.com/mcp" aria-label="MCP endpoint" />
          <Button variant="primary" disabled={busy || !serverId.trim() || !endpoint.trim()} onClick={onConnect}>{busy ? "Connecting…" : "Connect and review tools"}</Button>
        </div>
        {error && <p className="surface-error" role="alert">{error}</p>}
      </div>
      <StatusBadge tone="neutral">Explicit approval required</StatusBadge>
    </Card>
    {connections.length > 0 && <Card className="plugins-connections">
      <div className="settings-section-heading"><div>
        <p className="section-kicker">CONNECTED SERVERS</p>
        <h3>MCP lifecycle</h3>
        <p>Connections are persisted as credential-free metadata. Revoking one prevents future tool calls and cannot be silently undone.</p>
      </div></div>
      <div className="plugins-connection-list">
        {connections.map((connection) => {
          const tools = toolsByConnection[connection.connectionId] ?? [];
          const tone = connection.state === "healthy" ? "success" : connection.state === "revoked" ? "danger" : "warning";
          const selected = selectedConnectionId === connection.connectionId;
          const readTools = tools.filter((tool) => !tool.isMutating);
          const writeTools = tools.filter((tool) => tool.isMutating);
          return <div className={`plugins-connection${selected ? " is-selected" : ""}`} key={connection.connectionId}>
            <div className="plugins-connection-summary">
              <button type="button" className="plugins-connection-select" onClick={() => onSelectConnection(selected ? null : connection.connectionId)} aria-expanded={selected}>
                <span><strong>{connection.serverId}</strong><small>{connection.transport} · {connection.connectionId}</small></span>
                <StatusBadge tone={tone}>{connection.state === "healthy" ? "Connected" : connection.state === "degraded" ? "Needs attention" : connection.state}</StatusBadge>
              </button>
              <div className="plugins-connection-actions">
                <div className="plugins-connection-health">
                  <span>Last reported {Number.isNaN(Date.parse(connection.updatedAtUtc)) ? "time unavailable" : new Date(connection.updatedAtUtc).toLocaleString()}</span>
                  {connection.lastError && <p role="status">{connection.lastError.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").replace(/(token|api[_-]?key|secret|password)(\s*[:=]\s*)[^\s,;]+/gi, "$1$2[redacted]").slice(0, 240)}</p>}
                </div>
                {connection.state !== "revoked" && <>
                  <Button variant="secondary" disabled={busy || connection.state === "disconnected"} onClick={() => onRefreshHealth(connection)}>{busy ? "Checking…" : "Refresh health"}</Button>
                  <Button variant="ghost" disabled={busy} onClick={() => onChangeState(connection, "mcp.connection.disconnect")}>Disconnect</Button>
                  <Button variant="danger" disabled={busy} onClick={() => onChangeState(connection, "mcp.connection.revoke")}>Revoke</Button>
                </>}
              </div>
            </div>
            {selected && <div className="plugins-connection-inspector">
              <div className="plugins-connection-metadata">
                <span><b>Manifest</b>{connection.manifestDigest || "Not recorded"}</span>
                <span><b>Tools</b>{tools.length} discovered</span>
                <span><b>Access</b>Explicit approval per call</span>
              </div>
              {tools.length === 0 ? <p className="plugins-tool-empty">No live tool manifest. Refresh health while the server is connected to inspect its current tools.</p> : <div className="plugins-tool-groups">
                <ToolReviewGroup title="Read-only tools" tools={readTools} access="Read approval" />
                <ToolReviewGroup title="Mutating tools" tools={writeTools} access="Write approval" mutating />
              </div>}
              <p className="plugins-approval-boundary">Listing a tool only shows untrusted server metadata. Skai still requires an explicit approval grant when a tool is called.</p>
            </div>}
          </div>;
        })}
      </div>
    </Card>}
  </>;
}

function ToolReviewGroup({ title, tools, access, mutating = false }: { title: string; tools: McpTool[]; access: string; mutating?: boolean }) {
  return <div>
    <h4>{title} <span>{tools.length}</span></h4>
    {tools.length === 0 ? <p className="plugins-tool-empty">None discovered.</p> : tools.map((tool) => <div className={`plugins-tool-review${mutating ? " is-mutating" : ""}`} key={tool.toolName}>
      <span><strong>{tool.toolName}</strong><small>{tool.description || "No description provided by the server."}</small></span>
      <em>{tool.requiredCapabilities.join(" · ") || access}</em>
    </div>)}
  </div>;
}
