using System.Text;
using System.Text.Json;
using SkaiDesktop.Core.Infrastructure;
using SkaiDesktop.Core.Models;

namespace SkaiDesktop.Core.Services;

/// <summary>Small bounded MCP JSON-RPC client for a supervised stdio transport.</summary>
public sealed class McpStdioClient : IMcpClient
{
    // REA publishes complete JSON Schemas for its tools. Its initial tools/list
    // response is several megabytes even though the actual tool arguments stay
    // small. Keep a bounded line limit, but do not reject a valid catalog.
    private const int MaxMessageCharacters = 8 * 1024 * 1024;
    private const int MaxArgumentsCharacters = 32 * 1024;
    private const int MaxResultCharacters = 1 * 1024 * 1024;
    private readonly string _serverId;
    private readonly McpConnectionRegistry? _connectionRegistry;
    private readonly StreamReader _input;
    private readonly StreamWriter _output;
    private readonly BoundedHttpContent.LimitedLineReader _lines;
    private readonly SemaphoreSlim _requestLock = new(1, 1);
    private readonly TimeSpan _requestTimeout;
    private int _nextRequestId;
    private bool _initialized;

    public McpStdioClient(string serverId, Stream input, Stream output, TimeSpan? requestTimeout = null, McpConnectionRegistry? connectionRegistry = null)
    {
        if (string.IsNullOrWhiteSpace(serverId) || serverId.Length > 128 || serverId.Any(char.IsControl)) throw new ArgumentException("The MCP server identity is invalid.", nameof(serverId));
        _serverId = serverId;
        _connectionRegistry = connectionRegistry;
        _requestTimeout = requestTimeout ?? TimeSpan.FromSeconds(30);
        if (_requestTimeout < TimeSpan.FromSeconds(1) || _requestTimeout > TimeSpan.FromMinutes(5)) throw new ArgumentOutOfRangeException(nameof(requestTimeout));
        _input = new StreamReader(input ?? throw new ArgumentNullException(nameof(input)), new UTF8Encoding(false, true), detectEncodingFromByteOrderMarks: false, bufferSize: 4096, leaveOpen: true);
        _output = new StreamWriter(output ?? throw new ArgumentNullException(nameof(output)), new UTF8Encoding(false, true), bufferSize: 4096, leaveOpen: true) { AutoFlush = true, NewLine = "\n" };
        _lines = BoundedHttpContent.CreateLineReader(_input, MaxMessageCharacters);
    }

    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        using var result = await SendRequestAsync("initialize", new
        {
            protocolVersion = "2025-06-18",
            capabilities = new { },
            clientInfo = new { name = ProductIdentity.ClientName, version = "0.1" }
        }, cancellationToken).ConfigureAwait(false);
        if (!result.RootElement.TryGetProperty("result", out var initializeResult) || !initializeResult.TryGetProperty("protocolVersion", out var protocolVersion) || protocolVersion.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(protocolVersion.GetString()))
            throw new InvalidDataException("The MCP initialize response did not declare a protocol version.");
        await SendNotificationAsync("notifications/initialized", new { }, cancellationToken).ConfigureAwait(false);
        _initialized = true;
    }

    public async Task<IReadOnlyList<McpToolDescriptor>> ListToolsAsync(CancellationToken cancellationToken = default)
    {
        EnsureInitialized();
        using var result = await SendRequestAsync("tools/list", new { }, cancellationToken).ConfigureAwait(false);
        if (!result.RootElement.TryGetProperty("result", out var listResult) || !listResult.TryGetProperty("tools", out var tools) || tools.ValueKind != JsonValueKind.Array || tools.GetArrayLength() > 256)
            throw new InvalidDataException("The MCP tools/list response is missing a bounded tools array.");
        var descriptors = new List<McpToolDescriptor>(tools.GetArrayLength());
        foreach (var tool in tools.EnumerateArray())
        {
            if (!tool.TryGetProperty("name", out var name) || name.ValueKind != JsonValueKind.String) throw new InvalidDataException("The MCP tool manifest contains a tool without a name.");
            var toolName = name.GetString() ?? "";
            var description = tool.TryGetProperty("description", out var descriptionValue) && descriptionValue.ValueKind == JsonValueKind.String ? descriptionValue.GetString() ?? "" : "";
            var schema = tool.TryGetProperty("inputSchema", out var schemaValue) ? schemaValue.GetRawText() : "{}";
            var readOnly = tool.TryGetProperty("annotations", out var annotations) && annotations.ValueKind == JsonValueKind.Object && annotations.TryGetProperty("readOnlyHint", out var hint) && hint.ValueKind == JsonValueKind.True;
            descriptors.Add(new McpToolDescriptor
            {
                ServerId = _serverId,
                ToolName = toolName,
                Description = description,
                InputSchemaJson = schema,
                IsMutating = !readOnly,
                RequiredCapabilities = [readOnly ? McpCapabilities.InvokeRead : McpCapabilities.InvokeWrite]
            });
        }
        return descriptors;
    }

    public async Task<McpToolCallResult> CallToolAsync(McpToolDescriptor descriptor, McpToolGrant grant, JsonElement arguments, CancellationToken cancellationToken = default)
    {
        EnsureInitialized();
        if (arguments.ValueKind != JsonValueKind.Object) throw new ArgumentException("MCP tool arguments must be a JSON object.", nameof(arguments));
        var argumentsJson = arguments.GetRawText();
        if (Encoding.UTF8.GetByteCount(argumentsJson) > MaxArgumentsCharacters) throw new InvalidDataException("MCP tool arguments exceed the bounded payload limit.");
        if (_connectionRegistry is null) McpToolPermissionGate.Authorize(descriptor, grant);
        else _connectionRegistry.Authorize(descriptor, grant);
        using var result = await SendRequestAsync("tools/call", new { name = descriptor.ToolName, arguments }, cancellationToken).ConfigureAwait(false);
        if (!result.RootElement.TryGetProperty("result", out var callResult)) throw new InvalidDataException("The MCP tools/call response is missing a result.");
        var isError = callResult.TryGetProperty("isError", out var error) && error.ValueKind == JsonValueKind.True;
        var text = new StringBuilder();
        if (callResult.TryGetProperty("content", out var content) && content.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in content.EnumerateArray())
            {
                if (!item.TryGetProperty("text", out var value) || value.ValueKind != JsonValueKind.String) continue;
                var part = value.GetString() ?? "";
                if (text.Length + part.Length > MaxResultCharacters) throw new InvalidDataException("The MCP tool result exceeds the bounded output limit.");
                text.Append(part);
            }
        }
        return new McpToolCallResult(isError, text.ToString());
    }

    private async Task<JsonDocument> SendRequestAsync(string method, object parameters, CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(_requestTimeout);
        await _requestLock.WaitAsync(timeout.Token).ConfigureAwait(false);
        try
        {
            var id = Interlocked.Increment(ref _nextRequestId);
            await WriteMessageAsync(new { jsonrpc = "2.0", id, method, @params = parameters }, timeout.Token).ConfigureAwait(false);
            // Servers may emit notifications (progress, logging, resource updates)
            // before returning a tool response. They are not responses to the
            // outstanding request, so skip a bounded number of valid notifications.
            for (var notifications = 0; notifications <= 64; notifications++)
            {
                var line = await _lines.ReadLineAsync(timeout.Token).ConfigureAwait(false) ?? throw new EndOfStreamException("The MCP server closed its stdio stream.");
                if (line.Length > MaxMessageCharacters) throw new InvalidDataException("The MCP response exceeds the bounded message limit.");
                JsonDocument document;
                try { document = JsonDocument.Parse(line); } catch (JsonException exception) { throw new InvalidDataException("The MCP server returned invalid JSON.", exception); }
                var root = document.RootElement;
                if (root.ValueKind != JsonValueKind.Object)
                {
                    document.Dispose();
                    throw new InvalidDataException("The MCP server returned a non-object JSON-RPC message.");
                }
                if (!root.TryGetProperty("id", out var responseId))
                {
                    var isNotification = root.ValueKind == JsonValueKind.Object
                        && root.TryGetProperty("jsonrpc", out var version) && version.ValueKind == JsonValueKind.String && version.GetString() == "2.0"
                        && root.TryGetProperty("method", out var notificationMethod) && notificationMethod.ValueKind == JsonValueKind.String;
                    document.Dispose();
                    if (!isNotification) throw new InvalidDataException("The MCP server returned a message without a response ID or notification method.");
                    if (notifications == 64) throw new InvalidDataException("The MCP server emitted too many notifications before its response.");
                    continue;
                }
                if (responseId.ValueKind != JsonValueKind.Number || responseId.GetInt32() != id)
                {
                    document.Dispose();
                    throw new InvalidDataException("The MCP response did not match the outstanding request.");
                }
                if (root.TryGetProperty("error", out var error))
                {
                    var message = error.TryGetProperty("message", out var errorMessage) && errorMessage.ValueKind == JsonValueKind.String ? errorMessage.GetString() : "unknown MCP error";
                    document.Dispose();
                    throw new InvalidOperationException($"The MCP server rejected {method}: {message}");
                }
                return document;
            }
            throw new InvalidDataException("The MCP server did not return a response.");
        }
        finally { _requestLock.Release(); }
    }

    private async Task SendNotificationAsync(string method, object parameters, CancellationToken cancellationToken) => await WriteMessageAsync(new { jsonrpc = "2.0", method, @params = parameters }, cancellationToken).ConfigureAwait(false);

    private async Task WriteMessageAsync(object message, CancellationToken cancellationToken)
    {
        var json = JsonSerializer.Serialize(message);
        if (json.Length > MaxMessageCharacters) throw new InvalidDataException("The MCP request exceeds the bounded message limit.");
        await _output.WriteLineAsync(json.AsMemory(), cancellationToken).ConfigureAwait(false);
    }

    private void EnsureInitialized()
    {
        if (!_initialized) throw new InvalidOperationException("The MCP server must be initialized before a tool call.");
    }

    public ValueTask DisposeAsync()
    {
        _output.Dispose();
        _input.Dispose();
        _requestLock.Dispose();
        return ValueTask.CompletedTask;
    }
}
