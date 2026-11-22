using System.Diagnostics;
using System.Text;
using SkaiDesktop.Core.Models;

namespace SkaiDesktop.Core.Services;

/// <summary>Runs a reviewed, version-pinned npm MCP package as a local stdio child process.</summary>
public sealed class McpMarketplaceNpmProcessClient : IMcpClient
{
    private sealed record PackageProfile(string Id, string Package, string Version, string Executable, int MinimumNodeMajor, bool FolderScopedReadOnly, string[] Arguments, bool RequiresConnectionString = false);
    private static readonly IReadOnlyDictionary<string, PackageProfile> Profiles = new Dictionary<string, PackageProfile>(StringComparer.Ordinal)
    {
        ["filesystem"] = new("filesystem", "@modelcontextprotocol/server-filesystem", "2.4.0", "mcp-server-filesystem", 24, true, []),
        ["playwright"] = new("playwright", "@playwright/mcp", "0.0.86", "playwright-mcp", 20, false, []),
        ["postgres"] = new("postgres", "@microsoft/postgres-mcp", "0.3.1", "postgres-mcp", 22, false, ["run", "--no-telemetry"], true),
    };
    private readonly Process _process;
    private readonly McpStdioClient _client;
    private readonly StringBuilder _diagnostics = new();
    private readonly object _diagnosticsGate = new();
    private readonly string? _sensitiveValue;
    private bool _disposed;

    private McpMarketplaceNpmProcessClient(Process process, McpConnectionRegistry registry, string serverId, string? sensitiveValue)
    {
        _process = process;
        _sensitiveValue = sensitiveValue;
        _process.ErrorDataReceived += CaptureError;
        _process.BeginErrorReadLine();
        _client = new McpStdioClient(serverId, process.StandardOutput.BaseStream, process.StandardInput.BaseStream, connectionRegistry: registry);
    }

    public static McpMarketplaceNpmProcessClient Start(McpConnectionRegistry registry, string profileId, string? folderPath = null, string? connectionString = null, string? serverId = null)
    {
        ArgumentNullException.ThrowIfNull(registry);
        if (!Profiles.TryGetValue(profileId, out var profile)) throw new InvalidOperationException("That local MCP package is not in Skai's reviewed package catalog.");
        string workingDirectory;
        if (profile.FolderScopedReadOnly)
        {
            if (string.IsNullOrWhiteSpace(folderPath) || !Path.IsPathFullyQualified(folderPath) || !Directory.Exists(folderPath))
                throw new ArgumentException("Choose an existing local folder for Filesystem MCP access.", nameof(folderPath));
            workingDirectory = Path.GetFullPath(folderPath);
        }
        else
        {
            if (!string.IsNullOrWhiteSpace(folderPath)) throw new ArgumentException("This MCP profile does not accept a folder path.", nameof(folderPath));
            workingDirectory = Path.GetTempPath();
        }
        if (profile.RequiresConnectionString && string.IsNullOrWhiteSpace(connectionString))
            throw new ArgumentException("A local database connection is required.", nameof(connectionString));
        if (!profile.RequiresConnectionString && !string.IsNullOrWhiteSpace(connectionString))
            throw new ArgumentException("This MCP profile does not accept a connection string.", nameof(connectionString));

        var start = new ProcessStartInfo
        {
            FileName = OperatingSystem.IsWindows() ? "node" : "npx",
            WorkingDirectory = workingDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        if (OperatingSystem.IsWindows())
        {
            var npxCli = FindNpxCli() ?? throw new InvalidOperationException($"{profile.Id} MCP needs Node.js {profile.MinimumNodeMajor} or newer with npm installed on PATH.");
            EnsureNodeVersion(profile.MinimumNodeMajor, profile.Id);
            start.ArgumentList.Add(npxCli);
        }
        else
        {
            EnsureNodeVersion(profile.MinimumNodeMajor, profile.Id);
            start.ArgumentList.Add("--yes");
        }

        if (OperatingSystem.IsWindows())
        {
            start.ArgumentList.Add("--yes");
            start.ArgumentList.Add($"--package={profile.Package}@{profile.Version}");
            start.ArgumentList.Add(profile.Executable);
        }
        else
        {
            start.ArgumentList.Add("--package");
            start.ArgumentList.Add($"{profile.Package}@{profile.Version}");
            start.ArgumentList.Add(profile.Executable);
        }
        foreach (var argument in profile.Arguments) start.ArgumentList.Add(argument);
        if (profile.Id == "playwright" && OperatingSystem.IsWindows() && FindMicrosoftEdge() is { } edgePath)
        {
            // The upstream default selects the Chrome channel. Windows includes
            // Edge on most supported installations, so prefer that installed
            // browser and avoid an unnecessary Chromium download on first use.
            start.ArgumentList.Add("--browser");
            start.ArgumentList.Add("msedge");
            start.ArgumentList.Add("--executable-path");
            start.ArgumentList.Add(edgePath);
        }
        if (profile.FolderScopedReadOnly)
        {
            start.ArgumentList.Add("--read-only");
            start.ArgumentList.Add("--");
            start.ArgumentList.Add(workingDirectory);
        }
        if (profile.RequiresConnectionString) start.Environment["POSTGRES_MCP_CONNECTION_STRING"] = connectionString!;
        start.Environment["NO_COLOR"] = "1";
        start.Environment["FORCE_COLOR"] = "0";

        Process process;
        try { process = Process.Start(start) ?? throw new InvalidOperationException("The local Node package runner did not start."); }
        catch (System.ComponentModel.Win32Exception error)
        {
            throw new InvalidOperationException($"{profile.Id} MCP needs Node.js {profile.MinimumNodeMajor} or newer with npm on PATH.", error);
        }
        return new McpMarketplaceNpmProcessClient(process, registry, serverId ?? profile.Id, connectionString);
    }

    public Task InitializeAsync(CancellationToken cancellationToken = default) => RunWithDiagnosticsAsync(() => _client.InitializeAsync(cancellationToken));
    public Task<IReadOnlyList<McpToolDescriptor>> ListToolsAsync(CancellationToken cancellationToken = default) => RunWithDiagnosticsAsync(() => _client.ListToolsAsync(cancellationToken));
    public Task<McpToolCallResult> CallToolAsync(McpToolDescriptor descriptor, McpToolGrant grant, System.Text.Json.JsonElement arguments, CancellationToken cancellationToken = default) => RunWithDiagnosticsAsync(() => _client.CallToolAsync(descriptor, grant, arguments, cancellationToken));

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

    private static string? FindNpxCli()
    {
        foreach (var directory in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var candidate = Path.Combine(directory.Trim('"'), "node_modules", "npm", "bin", "npx-cli.js");
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }

    private static string? FindMicrosoftEdge()
    {
        var candidates = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "Edge", "Application", "msedge.exe"),
        };
        return candidates.FirstOrDefault(File.Exists);
    }

    private static void EnsureNodeVersion(int minimumMajor, string profileId)
    {
        try
        {
            using var process = Process.Start(new ProcessStartInfo
            {
                FileName = "node",
                ArgumentList = { "--version" },
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            }) ?? throw new InvalidOperationException("Node.js did not start.");
            var versionText = process.StandardOutput.ReadToEnd().Trim().TrimStart('v');
            if (!process.WaitForExit(5_000) || process.ExitCode != 0 || !Version.TryParse(versionText, out var version) || version.Major < minimumMajor)
                throw new InvalidOperationException($"{profileId} MCP requires Node.js {minimumMajor} or newer. Update Node.js, then try again.");
        }
        catch (System.ComponentModel.Win32Exception error)
        {
            throw new InvalidOperationException($"{profileId} MCP requires Node.js {minimumMajor} or newer with npm on PATH.", error);
        }
    }

    private void CaptureError(object sender, DataReceivedEventArgs eventArgs)
    {
        if (string.IsNullOrWhiteSpace(eventArgs.Data)) return;
        lock (_diagnosticsGate)
        {
            var line = eventArgs.Data.Trim();
            if (!string.IsNullOrWhiteSpace(_sensitiveValue)) line = line.Replace(_sensitiveValue, "[redacted connection]", StringComparison.Ordinal);
            if (line.Length > 1_000) line = line[..1_000];
            if (_diagnostics.Length + line.Length + 1 > 4_000)
                _diagnostics.Remove(0, Math.Min(_diagnostics.Length, _diagnostics.Length + line.Length + 1 - 4_000));
            _diagnostics.AppendLine(line);
        }
    }

    private async Task RunWithDiagnosticsAsync(Func<Task> operation)
    {
        try { await operation().ConfigureAwait(false); }
        catch (Exception error) { throw WithDiagnostics(error); }
    }

    private async Task<T> RunWithDiagnosticsAsync<T>(Func<Task<T>> operation)
    {
        try { return await operation().ConfigureAwait(false); }
        catch (Exception error) { throw WithDiagnostics(error); }
    }

    private Exception WithDiagnostics(Exception error)
    {
        string detail;
        lock (_diagnosticsGate) detail = _diagnostics.ToString().Trim();
        if (!string.IsNullOrWhiteSpace(_sensitiveValue)) detail = detail.Replace(_sensitiveValue, "[redacted connection]", StringComparison.Ordinal);
        if (detail.Length == 0) return new InvalidOperationException(error.Message, error);
        detail = System.Text.RegularExpressions.Regex.Replace(detail, @"(?i)(token|api[_-]?key|secret|password)(\s*[:=]\s*)[^\s,;]+", "$1$2[redacted]");
        return new InvalidOperationException($"{error.Message} MCP server: {detail[..Math.Min(detail.Length, 2_000)]}", error);
    }
}
