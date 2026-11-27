using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using SkaiDesktop.Core.Infrastructure;
using SkaiDesktop.Core.Models;
using SkaiDesktop.Core.Services;

namespace SkaiDesktop.AgentHost.Protocol;

public static partial class AgentHostLoop
{
    private static AgentResponse ListMarketplaceCatalog(AgentRequest request) =>
        new(ProtocolVersion, request.Id, true, MarketplaceCatalogService.Snapshot());

    private static async Task<AgentResponse> DownloadMcpMarketplaceItemAsync(AgentRequest request)
    {
        var id = RequiredBoundedString(request, "id", 80);
        if (!id.Equals("rea", StringComparison.Ordinal)) throw new KeyNotFoundException("That MCP package is not in Skai's pinned catalog.");
        var download = await new McpMarketplaceDownloadService().DownloadReaAsync().ConfigureAwait(false);
        return new(ProtocolVersion, request.Id, true, download);
    }

    private static AgentResponse ListSkills(AgentRequest request)
    {
        var installed = new SkillPackageInstaller().ListInstalled();
        var skills = SkillCatalogService.BuiltIns.Select(skill => new
        {
            id = skill.Id, name = skill.Name, description = skill.Description, category = skill.Category,
            permissions = skill.RequiredPermissions, source = "built-in", enabled = true,
        }).Concat(installed.Select(skill => new
        {
            id = skill.Id, name = skill.Name, description = $"Local Markdown skill by {skill.Publisher}.", category = "Installed",
            permissions = skill.RequiredPermissions, source = skill.SourceRef, enabled = skill.Enabled,
        })).ToArray();
        return new(ProtocolVersion, request.Id, true, skills);
    }

    private static AgentResponse ReadSkill(AgentRequest request)
    {
        var id = RequiredString(request, "id");
        var builtIn = SkillCatalogService.Find(id);
        if (builtIn is not null) return new(ProtocolVersion, request.Id, true, new { id = builtIn.Id, content = builtIn.Prompt });
        var installer = new SkillPackageInstaller();
        var installed = installer.ListInstalled().SingleOrDefault(skill => skill.Id.Equals(id, StringComparison.OrdinalIgnoreCase));
        if (installed is null || !installed.Enabled) throw new InvalidOperationException("That skill is not installed or enabled.");
        return new(ProtocolVersion, request.Id, true, new { id = installed.Id, content = installer.ReadInstructions(installed.Id) });
    }

    private static AgentResponse ListMcpConnections(AgentRequest request) =>
        new(ProtocolVersion, request.Id, true, new { connections = McpConnections.List() });

    private static async Task<AgentResponse> ConnectMcpAsync(AgentRequest request)
    {
        var serverId = RequiredBoundedString(request, "serverId", 128);
        var endpoint = OptionalString(request, "endpoint")?.Trim() ?? "";
        var transport = OptionalString(request, "transport") ?? "streamable-http";
        var connectionId = OptionalString(request, "connectionId")?.Trim();
        if (string.IsNullOrWhiteSpace(connectionId)) connectionId = $"mcp-{Guid.NewGuid():N}";
        if (connectionId.Length > 128 || connectionId.Any(char.IsControl)) throw new InvalidOperationException("The MCP connection identity is invalid.");
        McpConnections.Configure(connectionId, serverId, transport);
        IMcpClient? client = null;
        try
        {
            if (transport == "stdio")
            {
                var profileId = RequiredBoundedString(request, "profileId", 32);
                if (endpoint.Length != 0) throw new InvalidOperationException("Local MCP profiles do not accept an endpoint.");
                if (serverId.Equals("rea", StringComparison.Ordinal) && profileId.Equals("rea", StringComparison.Ordinal))
                {
                    client = McpReaProcessClient.Start(McpConnections);
                }
                else if (serverId.Equals(profileId, StringComparison.Ordinal) && (profileId is "filesystem" or "playwright"))
                {
                    string? folderPath = null;
                    if (profileId == "filesystem")
                    {
                        var requestedFolder = RequiredBoundedString(request, "folderPath", 4_000);
                        folderPath = Path.GetFullPath(requestedFolder);
                        if (!Directory.Exists(folderPath) || !Path.IsPathFullyQualified(requestedFolder))
                            throw new InvalidOperationException("Choose an existing local folder before connecting Filesystem MCP.");
                        if (string.Equals(Path.GetPathRoot(folderPath)?.TrimEnd(Path.DirectorySeparatorChar), folderPath.TrimEnd(Path.DirectorySeparatorChar), OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal))
                            throw new InvalidOperationException("Choose a folder inside the drive, not the drive root.");
                    }
                    client = McpMarketplaceNpmProcessClient.Start(McpConnections, profileId, folderPath);
                }
                else if (serverId == "postgres-mcp-pro" && profileId == "postgres")
                {
                    var connectionString = RequiredBoundedString(request, "connectionString", 2_000);
                    if (!Uri.TryCreate(connectionString, UriKind.Absolute, out var databaseEndpoint)
                        || databaseEndpoint.Scheme is not ("postgresql" or "postgres")
                        || !McpStreamableHttpClient.IsLoopbackEndpoint(databaseEndpoint)
                        || string.IsNullOrWhiteSpace(databaseEndpoint.UserInfo)
                        || databaseEndpoint.AbsolutePath.Length <= 1
                        || !string.IsNullOrEmpty(databaseEndpoint.Query)
                        || !string.IsNullOrEmpty(databaseEndpoint.Fragment))
                        throw new InvalidOperationException("Enter a PostgreSQL connection for a local database on 127.0.0.1 or localhost. Hosted database connections are not available here.");
                    client = McpMarketplaceNpmProcessClient.Start(McpConnections, profileId, connectionString: connectionString, serverId: serverId);
                }
                else throw new InvalidOperationException("That local MCP profile is not in Skai's reviewed package catalog; arbitrary process commands are not accepted.");
            }
            else
            {
                if (transport != "streamable-http") throw new InvalidOperationException("The MCP transport is unsupported.");
                if (endpoint.Length == 0 || endpoint.Length > 2_048) throw new InvalidOperationException("A valid MCP endpoint is required.");
                if (!Uri.TryCreate(endpoint, UriKind.Absolute, out var localEndpoint) || !McpStreamableHttpClient.IsLoopbackEndpoint(localEndpoint))
                    throw new InvalidOperationException("Marketplace MCP connections must point to a local server on this device. Hosted MCP endpoints are not available here.");
                client = new McpStreamableHttpClient(serverId, endpoint, connectionRegistry: McpConnections);
            }
        }
        catch (Exception error)
        {
            try { McpConnections.MarkDegraded(connectionId, error.Message); } catch { }
            if (client is not null) await client.DisposeAsync().ConfigureAwait(false);
            throw;
        }
        var activeClient = client!;
        try
        {
            await activeClient.InitializeAsync().ConfigureAwait(false);
            var tools = await activeClient.ListToolsAsync().ConfigureAwait(false);
            McpConnections.MarkHealthy(connectionId);
            lock (McpClientsGate)
            {
                if (ActiveMcpClients.Remove(connectionId, out var previous)) previous.DisposeAsync().AsTask().GetAwaiter().GetResult();
                ActiveMcpClients[connectionId] = activeClient;
                ActiveMcpTools[connectionId] = tools;
            }
            return new(ProtocolVersion, request.Id, true, new { connection = McpConnections.Get(connectionId), tools });
        }
        catch (Exception error)
        {
            try { McpConnections.MarkDegraded(connectionId, error.Message); } catch { }
            await activeClient.DisposeAsync().ConfigureAwait(false);
            throw;
        }
    }

    private static AgentResponse DisconnectMcp(AgentRequest request)
    {
        var connectionId = RequiredBoundedString(request, "connectionId", 128);
        DisposeActiveMcpClient(connectionId);
        return new(ProtocolVersion, request.Id, true, McpConnections.Disconnect(connectionId));
    }

    private static AgentResponse RevokeMcp(AgentRequest request)
    {
        var connectionId = RequiredBoundedString(request, "connectionId", 128);
        DisposeActiveMcpClient(connectionId);
        return new(ProtocolVersion, request.Id, true, McpConnections.Revoke(connectionId));
    }

    private static async Task<AgentResponse> ListMcpToolsAsync(AgentRequest request)
    {
        var connectionId = RequiredBoundedString(request, "connectionId", 128);
        IMcpClient? client;
        lock (McpClientsGate)
        {
            ActiveMcpClients.TryGetValue(connectionId, out client);
            if (client is null)
                return new(ProtocolVersion, request.Id, true, new { connectionId, connected = false, tools = Array.Empty<McpToolDescriptor>(), connection = McpConnections.Get(connectionId) });
        }

        try
        {
            var tools = await client.ListToolsAsync().ConfigureAwait(false);
            lock (McpClientsGate)
            {
                if (!ActiveMcpClients.TryGetValue(connectionId, out var current) || !ReferenceEquals(current, client))
                    return new(ProtocolVersion, request.Id, true, new { connectionId, connected = false, tools = Array.Empty<McpToolDescriptor>(), connection = McpConnections.Get(connectionId) });
                ActiveMcpTools[connectionId] = tools;
                var connection = McpConnections.MarkHealthy(connectionId);
                return new(ProtocolVersion, request.Id, true, new { connectionId, connected = true, tools, connection });
            }
        }
        catch (Exception error)
        {
            var message = new string(error.Message.Where(character => !char.IsControl(character)).Take(2_000).ToArray());
            lock (McpClientsGate)
            {
                if (!ActiveMcpClients.TryGetValue(connectionId, out var current) || !ReferenceEquals(current, client))
                    return new(ProtocolVersion, request.Id, true, new { connectionId, connected = false, tools = Array.Empty<McpToolDescriptor>(), connection = McpConnections.Get(connectionId) });
                var connection = McpConnections.MarkDegraded(connectionId, string.IsNullOrWhiteSpace(message) ? "MCP health check failed." : message);
                return new(ProtocolVersion, request.Id, true, new { connectionId, connected = false, tools = Array.Empty<McpToolDescriptor>(), connection });
            }
        }
    }

    private static async Task<AgentResponse> CallMcpToolAsync(AgentRequest request, CancellationToken cancellationToken = default)
    {
        var connectionId = RequiredBoundedString(request, "connectionId", 128);
        var toolName = RequiredBoundedString(request, "toolName", 128);
        var approvalId = RequiredBoundedString(request, "approvalId", 128);
        var capabilities = OptionalStringList(request, "capabilities", 2, 64);
        using var emptyArguments = JsonDocument.Parse("{}");
        var arguments = request.Params?.TryGetProperty("arguments", out var argumentValue) == true ? argumentValue : emptyArguments.RootElement;
        if (arguments.ValueKind != JsonValueKind.Object) throw new InvalidOperationException("MCP tool arguments must be a JSON object.");

        IMcpClient client;
        McpToolDescriptor descriptor;
        lock (McpClientsGate)
        {
            if (!ActiveMcpClients.TryGetValue(connectionId, out client!)) throw new InvalidOperationException("The MCP connection is not active.");
            if (!ActiveMcpTools.TryGetValue(connectionId, out var tools) || (descriptor = tools.SingleOrDefault(tool => tool.ToolName.Equals(toolName, StringComparison.Ordinal))!) is null)
                throw new KeyNotFoundException("The MCP tool is not available on this connection.");
        }
        var result = await client.CallToolAsync(descriptor, new McpToolGrant
        {
            ServerId = descriptor.ServerId,
            ToolName = descriptor.ToolName,
            ConnectionId = connectionId,
            ApprovalId = approvalId,
            Capabilities = capabilities,
        }, arguments, cancellationToken).ConfigureAwait(false);
        return new(ProtocolVersion, request.Id, true, new { toolName, isError = result.IsError, text = result.Text });
    }

    private static McpConnectionRegistry CreateMcpConnectionRegistry() =>
        new(new McpConnectionStore(Environment.GetEnvironmentVariable("SRAI_MCP_CONNECTIONS_PATH")));

    private static void DisposeActiveMcpClient(string connectionId)
    {
        lock (McpClientsGate)
        {
            if (ActiveMcpClients.Remove(connectionId, out var client)) client.DisposeAsync().AsTask().GetAwaiter().GetResult();
            ActiveMcpTools.Remove(connectionId);
        }
    }

    private static async Task DisposeMcpClientsAsync()
    {
        IMcpClient[] clients;
        lock (McpClientsGate)
        {
            clients = ActiveMcpClients.Values.ToArray();
            ActiveMcpClients.Clear();
            ActiveMcpTools.Clear();
        }
        foreach (var client in clients) await client.DisposeAsync().ConfigureAwait(false);
    }

    private static AgentResponse SearchImageAssetsAsync(AgentRequest request) => new(ProtocolVersion, request.Id, true, new ImageAssetLibrary().SearchAsync(OptionalString(request, "query") ?? string.Empty).GetAwaiter().GetResult());

    private static AgentResponse InstallImageAssetAsync(AgentRequest request) => new(ProtocolVersion, request.Id, true, new ImageAssetLibrary().InstallAsync(RequiredBoundedString(request, "repository", 200), RequiredBoundedString(request, "file", 512)).GetAwaiter().GetResult());

    private static AgentResponse RemoveImageAsset(AgentRequest request) => new(ProtocolVersion, request.Id, true, new { removed = new ImageAssetLibrary().Remove(RequiredBoundedString(request, "id", 512)) });


}
