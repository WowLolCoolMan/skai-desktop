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
                if (!serverId.Equals("rea", StringComparison.Ordinal) || !profileId.Equals("rea", StringComparison.Ordinal) || endpoint.Length != 0)
                    throw new InvalidOperationException("Only Skai's pinned REA stdio profile can be launched; arbitrary process commands are not accepted.");
                client = McpReaProcessClient.Start(McpConnections);
            }
            else
            {
                if (transport != "streamable-http") throw new InvalidOperationException("The MCP transport is unsupported.");
                if (endpoint.Length == 0 || endpoint.Length > 2_048) throw new InvalidOperationException("A valid MCP endpoint is required.");
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

    private static async Task<AgentResponse> CallMcpToolAsync(AgentRequest request)
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
        }, arguments).ConfigureAwait(false);
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

    private static async Task<AgentResponse> SearchMarketplaceModelsAsync(AgentRequest request)
    {
        var query = OptionalString(request, "query") ?? string.Empty;
        var uncensored = request.Params?.TryGetProperty("uncensored", out var uncensoredValue) == true && uncensoredValue.ValueKind == JsonValueKind.True;
        var library = new ModelLibraryService();
        // A stalled provider should not leave the Marketplace spinner running
        // for the full per-provider HTTP timeout. Share one bounded search budget
        // across the parallel catalog requests and return any results that did arrive.
        using var searchTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        var huggingFaceTask = library.SearchHuggingFaceAsync(query, uncensored, searchTimeout.Token);
        var airLlmTask = library.SearchHuggingFaceAirLlmAsync(query, uncensored, searchTimeout.Token);
        var modelScopeTask = library.SearchModelScopeGgufAsync(query, uncensored, searchTimeout.Token);
        var providers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var models = new List<object>();

        try
        {
            var huggingFace = await huggingFaceTask.ConfigureAwait(false);
            models.AddRange(huggingFace.Select(model => new
            {
                id = $"huggingface:{model.Id}",
                repository = model.Id,
                source = "Hugging Face",
                kind = "llm",
                downloads = model.Downloads,
                likes = model.Likes,
                uncensored = model.IsUncensored,
                tags = model.Tags ?? [],
                sizeBytes = model.SizeBytes,
                contextLength = model.ContextLength,
                installRoute = "lm-studio",
                installable = true,
            }));
            providers["Hugging Face"] = "ready";
        }
        catch (Exception error) when (error is HttpRequestException or InvalidDataException or OperationCanceledException)
        {
            providers["Hugging Face"] = error.Message;
        }

        try
        {
            var airLlmModels = await airLlmTask.ConfigureAwait(false);
            models.AddRange(airLlmModels.Select(model => new
            {
                id = $"huggingface-airllm:{model.Id}",
                repository = model.Id,
                source = "Hugging Face",
                kind = "llm",
                downloads = model.Downloads,
                likes = model.Likes,
                uncensored = model.IsUncensored,
                tags = model.Tags ?? [],
                sizeBytes = model.SizeBytes,
                contextLength = model.ContextLength,
                installRoute = "airllm",
                requiresAirLlm = true,
                installable = false,
            }));
            providers["Hugging Face · AirLLM"] = "ready";
        }
        catch (Exception error) when (error is HttpRequestException or InvalidDataException or OperationCanceledException)
        {
            providers["Hugging Face · AirLLM"] = error.Message;
        }

        try
        {
            var modelScope = await modelScopeTask.ConfigureAwait(false);
            models.AddRange(modelScope.Select(model => new
            {
                id = $"modelscope:{model.Repository}:{model.Name}",
                repository = model.Repository,
                name = model.Name,
                source = "ModelScope",
                kind = "llm",
                downloads = model.Downloads,
                likes = 0,
                uncensored = model.IsUncensored,
                tags = Array.Empty<string>(),
                sizeBytes = model.SizeBytes,
                installRoute = "ollama-gguf",
                installable = true,
                files = model.Files.Select(file => new { path = file.Path, sizeBytes = file.SizeBytes, sha256 = file.Sha256 }).ToArray(),
            }));
            providers["ModelScope"] = "ready";
        }
        catch (Exception error) when (error is HttpRequestException or InvalidDataException or OperationCanceledException)
        {
            providers["ModelScope"] = error.Message;
        }

        // Ollama's registry has no stable public search API. Include reviewed official
        // library entries for the user's common local workflows; Ollama resolves tags
        // on confirmation and handles the pull through the configured local endpoint.
        var ollamaCandidatesAdded = false;
        void AddOllamaModel(string tag, long downloads, double sizeGb, int context, string[] tags)
        {
            models.Insert(0, new
            {
                id = $"ollama:{tag}", repository = tag, source = "Ollama", kind = "llm", downloads, likes = 0L,
                uncensored = false, tags, sizeBytes = (long)(sizeGb * 1024 * 1024 * 1024), contextLength = context,
                installRoute = "ollama-pull", installable = true,
            });
            ollamaCandidatesAdded = true;
        }
        if (uncensored && (string.IsNullOrWhiteSpace(query) || query.Contains("gemma", StringComparison.OrdinalIgnoreCase) || query.Contains("31b", StringComparison.OrdinalIgnoreCase)))
        {
            // Reviewed GGUF build of the dense Gemma 4 31B abliterated model.
            // Keep this in the uncensored lane and route installation through
            // LM Studio, which can import the repository and expose it through
            // Skai's existing loopback OpenAI-compatible provider.
            models.Insert(0, new
            {
                id = "huggingface:Kooten/gemma-4-31b-abliterated-v1.1-GGUF",
                repository = "Kooten/gemma-4-31b-abliterated-v1.1-GGUF",
                source = "Hugging Face",
                kind = "llm",
                downloads = 261L,
                likes = 0L,
                uncensored = true,
                tags = new[] { "text-generation", "gemma4", "31b", "dense", "abliterated", "gguf" },
                sizeBytes = (long)(18.7 * 1024 * 1024 * 1024),
                contextLength = 131072,
                installRoute = "lm-studio",
                installable = true,
                requiresAirLlm = false,
            });
        }
        if (string.IsNullOrWhiteSpace(query) || query.Contains("qwen", StringComparison.OrdinalIgnoreCase) || query.Contains("1m", StringComparison.OrdinalIgnoreCase))
            AddOllamaModel("org/qwen2.5-1m:7b", 4_111, 4.7, 986_000, ["text-generation", "qwen2", "1m-context", "ollama"]);
        if (string.IsNullOrWhiteSpace(query) || query.Contains("code", StringComparison.OrdinalIgnoreCase) || query.Contains("coder", StringComparison.OrdinalIgnoreCase))
            AddOllamaModel("qwen3-coder:30b-a3b-q4_K_M", 11_100_000, 19, 256_000, ["text-generation", "code", "tools", "qwen3", "ollama"]);
        if (string.IsNullOrWhiteSpace(query) || query.Contains("omni", StringComparison.OrdinalIgnoreCase))
            AddOllamaModel("lfm3-omni:2b-q4_K_M", 73_000, 2, 125_000, ["text-generation", "vision", "audio", "video", "omni", "ollama"]);
        if (ollamaCandidatesAdded) providers["Ollama"] = "ready";

        return new(ProtocolVersion, request.Id, true, new
        {
            query,
            uncensored,
            fetchedAtUtc = DateTimeOffset.UtcNow,
            providers,
            models = models.Take(100).ToArray(),
        });
    }

    private static AgentResponse StartMarketplaceModelInstall(AgentRequest request)
    {
        var source = RequiredBoundedString(request, "source", 32).Trim().ToLowerInvariant();
        var endpoint = RequiredLocalEndpoint(request, "endpoint", 2_000);
        var repository = RequiredBoundedString(request, "repository", 512);
        var quantization = OptionalString(request, "quantization");
        var operation = new MarketplaceDownloadOperation(Guid.NewGuid().ToString("N"), source, repository, new CancellationTokenSource());
        lock (MarketplaceDownloadsGate)
        {
            if (MarketplaceDownloads.Values.Any(item => item.Source == source && item.Repository.Equals(repository, StringComparison.OrdinalIgnoreCase) && item.State == "running"))
                throw new InvalidOperationException("This marketplace model is already downloading.");
            MarketplaceDownloads[operation.Id] = operation;
        }
        _ = Task.Run(async () =>
        {
            try
            {
                var library = new ModelLibraryService();
                if (source == "huggingface")
                {
                    await library.DownloadFromHuggingFaceAsync(endpoint, repository, quantization, operation.AddProgress, operation.Cancellation.Token).ConfigureAwait(false);
                }
                else if (source == "modelscope")
                {
                    var files = ReadMarketplaceFiles(request);
                    var package = new ModelScopeGgufPackage(repository, OptionalString(request, "name") ?? repository, files, OptionalLong(request, "downloads") ?? 0, OptionalBoolean(request, "uncensored"));
                    await library.DownloadAndImportModelScopeGgufAsync(endpoint, package, operation.AddProgress, operation.Cancellation.Token).ConfigureAwait(false);
                }
                else if (source == "ollama")
                {
                    await library.PullOllamaAsync(endpoint, repository, operation.AddProgress, operation.Cancellation.Token).ConfigureAwait(false);
                }
                else throw new InvalidOperationException("This marketplace provider does not have a verified local installer.");
                operation.Complete();
            }
            catch (OperationCanceledException) when (operation.Cancellation.IsCancellationRequested) { operation.Cancelled(); }
            catch (Exception error) { operation.Fail(error.Message); }
        });
        return MarketplaceDownloadResponse(request, operation);
    }

    private static AgentResponse GetMarketplaceModelInstallStatus(AgentRequest request)
    {
        var id = RequiredBoundedString(request, "id", 64);
        lock (MarketplaceDownloadsGate)
        {
            return MarketplaceDownloads.TryGetValue(id, out var operation)
                ? MarketplaceDownloadResponse(request, operation)
                : throw new KeyNotFoundException("The marketplace model download no longer exists.");
        }
    }

    private static AgentResponse CancelMarketplaceModelInstall(AgentRequest request)
    {
        var id = RequiredBoundedString(request, "id", 64);
        lock (MarketplaceDownloadsGate)
        {
            if (!MarketplaceDownloads.TryGetValue(id, out var operation)) throw new KeyNotFoundException("The marketplace model download no longer exists.");
            operation.Cancellation.Cancel();
            return MarketplaceDownloadResponse(request, operation);
        }
    }

    private static AgentResponse MarketplaceDownloadResponse(AgentRequest request, MarketplaceDownloadOperation operation) => new(ProtocolVersion, request.Id, true, new
    {
        id = operation.Id,
        source = operation.Source,
        repository = operation.Repository,
        status = operation.State,
        progress = operation.Progress.ToArray(),
        error = operation.Error,
    });

    private static IReadOnlyList<ModelScopeGgufFile> ReadMarketplaceFiles(AgentRequest request)
    {
        if (request.Params is not { } parameters || !parameters.TryGetProperty("files", out var files) || files.ValueKind != JsonValueKind.Array)
            throw new InvalidOperationException("ModelScope installs require the verified GGUF file manifest from discovery.");
        var result = files.EnumerateArray().Select(file => new ModelScopeGgufFile(
            RequiredJsonString(file, "path", 512),
            RequiredJsonLong(file, "sizeBytes"),
            OptionalJsonString(file, "sha256"))).ToArray();
        if (result.Length == 0 || result.Length > 128) throw new InvalidOperationException("The model file manifest is empty or too large.");
        return result;
    }

}
