using System.Text;
using System.Text.Json;
using SkaiDesktop.Core.Models;
using SkaiDesktop.Core.Services;
using static TestSupport;

internal static class McpStdioClientTests
{
    public static async Task RunAsync()
    {
        var largeToolCatalog = JsonSerializer.Serialize(new
        {
            jsonrpc = "2.0",
            id = 2,
            result = new
            {
                tools = new object[]
                {
                    new { name = "list-files", description = "Lists files.", inputSchema = new { type = "object" }, annotations = new { readOnlyHint = true } },
                    new { name = "delete-file", description = "Deletes a file.", inputSchema = new { type = "object" } },
                    new { name = "large-schema-tool", description = new string('x', 300_000), inputSchema = new { type = "object" }, annotations = new { readOnlyHint = true } },
                },
            },
        });
        var responses = string.Join("\n", [
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":\"2025-06-18\"}}",
            largeToolCatalog,
            "{\"jsonrpc\":\"2.0\",\"id\":3,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"safe result\"}]}}"
        ]) + "\n";
        await using var input = new MemoryStream(Encoding.UTF8.GetBytes(responses));
        await using var output = new MemoryStream();
        var registry = new McpConnectionRegistry();
        registry.Configure("connection-1", "test-server", "stdio");
        registry.MarkHealthy("connection-1");
        await using var client = new McpStdioClient("test-server", input, output, null, registry);
        await client.InitializeAsync();
        var tools = await client.ListToolsAsync();
        Check(tools.Count == 3 && !tools[0].IsMutating && tools[1].IsMutating && !tools[2].IsMutating, "MCP stdio client accepts large catalogs and classifies tool annotations conservatively");
        using var arguments = JsonDocument.Parse("{}");
        var result = await client.CallToolAsync(tools[0], new McpToolGrant
        {
            ServerId = "test-server",
            ToolName = "list-files",
            ConnectionId = "connection-1",
            ApprovalId = "approval-1",
            Capabilities = [McpCapabilities.InvokeRead]
        }, arguments.RootElement);
        Check(!result.IsError && result.Text == "safe result", "MCP stdio client invokes an approved read-only tool");

        var refused = false;
        try
        {
            await client.CallToolAsync(tools[1], new McpToolGrant
            {
                ServerId = "test-server",
                ToolName = "delete-file",
                ConnectionId = "connection-1",
                ApprovalId = "approval-2",
                Capabilities = [McpCapabilities.InvokeRead]
            }, arguments.RootElement);
        }
        catch (UnauthorizedAccessException) { refused = true; }
        Check(refused, "MCP stdio client denies an unapproved mutating tool");
        registry.Revoke("connection-1");
        refused = false;
        try { await client.CallToolAsync(tools[0], new McpToolGrant { ServerId = "test-server", ToolName = "list-files", ConnectionId = "connection-1", ApprovalId = "approval-3", Capabilities = [McpCapabilities.InvokeRead] }, arguments.RootElement); }
        catch (UnauthorizedAccessException) { refused = true; }
        Check(refused, "MCP stdio client blocks calls after connection revocation");
        var wire = Encoding.UTF8.GetString(output.ToArray());
        Check(wire.Contains("\"method\":\"tools/list\"", StringComparison.Ordinal) && wire.Contains("\"method\":\"tools/call\"", StringComparison.Ordinal) && wire.Contains("notifications/initialized", StringComparison.Ordinal), "MCP stdio client emits protocol requests and initialized notification");
    }
}
