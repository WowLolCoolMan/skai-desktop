using System.Text.Json;
using SkaiDesktop.Core.Models;

namespace SkaiDesktop.Core.Services;

/// <summary>Common boundary for supervised MCP Streamable HTTP and stdio clients.</summary>
public interface IMcpClient : IAsyncDisposable
{
    Task InitializeAsync(CancellationToken cancellationToken = default);
    Task<IReadOnlyList<McpToolDescriptor>> ListToolsAsync(CancellationToken cancellationToken = default);
    Task<McpToolCallResult> CallToolAsync(McpToolDescriptor descriptor, McpToolGrant grant, JsonElement arguments, CancellationToken cancellationToken = default);
}
