using System.Diagnostics;
using System.Text;
using System.Text.Json;
using SkaiDesktop.Core.Models;

namespace SkaiDesktop.Core.Services;

/// <summary>Supervises REA's pinned npm MCP process over the existing bounded stdio protocol.</summary>
public sealed class McpReaProcessClient : IMcpClient
{
    public const string PackageVersion = "6.9.0";
    private readonly Process _process;
    private readonly McpStdioClient _client;
    private readonly StringBuilder _diagnostics = new();
    private readonly object _diagnosticsGate = new();
    private bool _disposed;

    private McpReaProcessClient(Process process, McpConnectionRegistry registry)
    {
        _process = process;
        _process.ErrorDataReceived += CaptureError;
        _process.BeginErrorReadLine();
        _client = new McpStdioClient("rea", process.StandardOutput.BaseStream, process.StandardInput.BaseStream, connectionRegistry: registry);
    }

    public static McpReaProcessClient Start(McpConnectionRegistry registry)
    {
        ArgumentNullException.ThrowIfNull(registry);
        var start = new ProcessStartInfo
        {
            FileName = OperatingSystem.IsWindows() ? Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe" : "npx",
            WorkingDirectory = Path.GetTempPath(),
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        if (OperatingSystem.IsWindows())
        {
            start.ArgumentList.Add("/d");
            start.ArgumentList.Add("/s");
            start.ArgumentList.Add("/c");
            // Static command and arguments; no caller-supplied command text is accepted.
            start.ArgumentList.Add($"npx -y rea-agents@{PackageVersion} mcp");
        }
        else
        {
            start.ArgumentList.Add("-y");
            start.ArgumentList.Add($"rea-agents@{PackageVersion}");
            start.ArgumentList.Add("mcp");
        }
        start.Environment["NO_COLOR"] = "1";
        start.Environment["FORCE_COLOR"] = "0";
        Process process;
        try { process = Process.Start(start) ?? throw new InvalidOperationException("The local Node package runner did not start."); }
        catch (System.ComponentModel.Win32Exception error)
        {
            throw new InvalidOperationException("REA needs Node.js and npm on PATH. Install a supported Node.js release, then reconnect REA.", error);
        }
        return new McpReaProcessClient(process, registry);
    }

    public Task InitializeAsync(CancellationToken cancellationToken = default) => _client.InitializeAsync(cancellationToken);
    public Task<IReadOnlyList<McpToolDescriptor>> ListToolsAsync(CancellationToken cancellationToken = default) => _client.ListToolsAsync(cancellationToken);
    public Task<McpToolCallResult> CallToolAsync(McpToolDescriptor descriptor, McpToolGrant grant, JsonElement arguments, CancellationToken cancellationToken = default) => _client.CallToolAsync(descriptor, grant, arguments, cancellationToken);

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;
        await _client.DisposeAsync().ConfigureAwait(false);
        try
        {
            if (!_process.HasExited) _process.Kill(entireProcessTree: true);
            await _process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(3)).ConfigureAwait(false);
        }
        catch (InvalidOperationException) { }
        catch (System.ComponentModel.Win32Exception) { }
        catch (TimeoutException) { }
        _process.Dispose();
    }

    private void CaptureError(object sender, DataReceivedEventArgs eventArgs)
    {
        if (string.IsNullOrWhiteSpace(eventArgs.Data)) return;
        lock (_diagnosticsGate)
        {
            var line = eventArgs.Data.Trim();
            if (line.Length > 1_000) line = line[..1_000];
            if (_diagnostics.Length + line.Length + 1 > 4_000)
            {
                var trim = Math.Min(_diagnostics.Length, _diagnostics.Length + line.Length + 1 - 4_000);
                _diagnostics.Remove(0, trim);
            }
            _diagnostics.AppendLine(line);
        }
    }
}
