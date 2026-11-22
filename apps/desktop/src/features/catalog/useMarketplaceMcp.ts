import { useState } from "react";
import { request } from "./marketplaceRequest";

export type McpConnection = {
  connectionId: string;
  serverId: string;
  transport: string;
  state: string;
  manifestDigest?: string;
  lastError: string;
  updatedAtUtc: string;
};

export type McpTool = {
  serverId: string;
  toolName: string;
  description: string;
  inputSchemaJson?: string;
  isMutating: boolean;
  requiredCapabilities: string[];
};

type ConnectionResult = { connection: McpConnection; tools?: McpTool[] };

export function useMarketplaceMcp(onNotice: (notice: string) => void) {
  const [connections, setConnections] = useState<McpConnection[]>([]);
  const [tools, setTools] = useState<Record<string, McpTool[]>>({});
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [serverId, setServerId] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const acceptConnection = (result: ConnectionResult) => {
    setConnections((current) => [
      result.connection,
      ...current.filter((item) => item.connectionId !== result.connection.connectionId),
    ]);
    setTools((current) => ({ ...current, [result.connection.connectionId]: result.tools ?? [] }));
    setSelectedConnectionId(result.connection.connectionId);
  };

  const loadConnections = (next: McpConnection[]) => {
    setConnections(next);
    setSelectedConnectionId((current) => current && next.some((item) => item.connectionId === current)
      ? current
      : next[0]?.connectionId ?? null);
  };

  const connect = async () => {
    if (!serverId.trim() || !endpoint.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await request("mcp.connection.connect", {
        serverId: serverId.trim(), endpoint: endpoint.trim(), transport: "streamable-http",
      });
      if (!response.ok) throw new Error(response.error?.message ?? "MCP connection failed.");
      acceptConnection(response.result as ConnectionResult);
      setServerId("");
      setEndpoint("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "MCP connection failed.");
    } finally {
      setBusy(false);
    }
  };

  const refreshHealth = async (connection: McpConnection) => {
    setBusy(true);
    setError(null);
    try {
      const response = await request("mcp.tools.list", { connectionId: connection.connectionId });
      if (!response.ok) throw new Error(response.error?.message ?? "The MCP health check failed.");
      const result = response.result as { connected: boolean; tools?: McpTool[]; connection?: McpConnection };
      if (result.connection) setConnections((current) => current.map((item) => item.connectionId === connection.connectionId ? result.connection! : item));
      setTools((current) => ({ ...current, [connection.connectionId]: result.tools ?? [] }));
      onNotice(result.connected
        ? `${connection.serverId} responded. The tool manifest and connection health are current.`
        : `${connection.serverId} did not respond; its last known health is shown.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The MCP health check failed.");
    } finally {
      setBusy(false);
    }
  };

  const downloadRea = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await request("mcp.marketplace.download", { id: "rea" });
      if (!response.ok) throw new Error(response.error?.message ?? "REA package download failed.");
      const result = response.result as { name: string; version: string; filePath: string };
      onNotice(`${result.name} ${result.version} downloaded to ${result.filePath}. npm SHA-512 integrity verified.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "REA package download failed.");
    } finally {
      setBusy(false);
    }
  };

  const connectRea = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await request("mcp.connection.connect", { serverId: "rea", transport: "stdio", profileId: "rea" });
      if (!response.ok) throw new Error(response.error?.message ?? "REA could not be started.");
      const result = response.result as ConnectionResult;
      acceptConnection(result);
      onNotice(`REA connected locally with ${result.tools?.length ?? 0} tools. Review each tool permission before use.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "REA could not be started.");
    } finally {
      setBusy(false);
    }
  };

  const connectFilesystem = async (folderPath: string) => {
    setBusy(true);
    setError(null);
    try {
      const response = await request("mcp.connection.connect", {
        serverId: "filesystem", transport: "stdio", profileId: "filesystem", folderPath,
      });
      if (!response.ok) throw new Error(response.error?.message ?? "Filesystem MCP could not be installed or started.");
      const result = response.result as ConnectionResult;
      acceptConnection(result);
      onNotice(`Filesystem MCP is connected in read-only mode for the selected folder, with ${result.tools?.length ?? 0} tools. npm package installation runs locally.`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Filesystem MCP could not be installed or started.";
      setError(message);
      onNotice(message);
    } finally {
      setBusy(false);
    }
  };

  const connectPlaywright = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await request("mcp.connection.connect", {
        serverId: "playwright", transport: "stdio", profileId: "playwright",
      });
      if (!response.ok) throw new Error(response.error?.message ?? "Playwright MCP could not be installed or started.");
      const result = response.result as ConnectionResult;
      acceptConnection(result);
      onNotice(`Playwright MCP is connected locally with ${result.tools?.length ?? 0} browser tools. Each tool call still requires its configured approval.`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Playwright MCP could not be installed or started.";
      setError(message);
      onNotice(message);
    } finally {
      setBusy(false);
    }
  };

  const connectPostgres = async (connectionString: string) => {
    setBusy(true);
    setError(null);
    try {
      const response = await request("mcp.connection.connect", {
        serverId: "postgres-mcp-pro", transport: "stdio", profileId: "postgres", connectionString,
      });
      if (!response.ok) throw new Error(response.error?.message ?? "PostgreSQL MCP could not be installed or started.");
      const result = response.result as ConnectionResult;
      acceptConnection(result);
      onNotice(`PostgreSQL MCP is connected to the local database with ${result.tools?.length ?? 0} tools. Credentials were provided only to the server process; tool approvals still apply.`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "PostgreSQL MCP could not be installed or started.";
      setError(message);
      onNotice(message);
    } finally {
      setBusy(false);
    }
  };

  const connectLocalServer = async (localServerId: string, localEndpoint: string) => {
    setBusy(true);
    setError(null);
    try {
      const response = await request("mcp.connection.connect", {
        serverId: localServerId, transport: "streamable-http", endpoint: localEndpoint,
      });
      if (!response.ok) throw new Error(response.error?.message ?? "The local MCP server could not be connected.");
      const result = response.result as ConnectionResult;
      acceptConnection(result);
      onNotice(`${localServerId} is connected over loopback with ${result.tools?.length ?? 0} tools. Review each tool call before execution.`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The local MCP server could not be connected.";
      setError(message);
      onNotice(message);
    } finally {
      setBusy(false);
    }
  };

  const changeState = async (connection: McpConnection, method: "mcp.connection.disconnect" | "mcp.connection.revoke") => {
    setBusy(true);
    setError(null);
    try {
      const response = await request(method, { connectionId: connection.connectionId });
      if (!response.ok) throw new Error(response.error?.message ?? "MCP connection update failed.");
      const updated = response.result as McpConnection;
      setConnections((current) => current.map((item) => item.connectionId === updated.connectionId ? updated : item));
      setTools((current) => ({ ...current, [updated.connectionId]: [] }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "MCP connection update failed.");
    } finally {
      setBusy(false);
    }
  };

  return {
    connections, tools, selectedConnectionId, setSelectedConnectionId,
    serverId, setServerId, endpoint, setEndpoint, busy, error,
    loadConnections, connect, refreshHealth, downloadRea, connectRea, connectFilesystem, connectPlaywright, connectPostgres, connectLocalServer, changeState,
  };
}
