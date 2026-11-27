using System.Runtime.InteropServices;
using System.Diagnostics;

namespace SkaiDesktop.AgentHost.Protocol;

/// <summary>Versioned capability and health contract for local task execution harnesses.</summary>
public static class HarnessAdapterRegistry
{
    public const int ContractVersion = 2;

    private sealed record AdapterDefinition(
        string Id,
        string Name,
        string Description,
        string[] Executables,
        string[] NativeCapabilities,
        string[] Prerequisites,
        bool CanExecute,
        bool OwnsSessionFormat);

    private static readonly AdapterDefinition[] Definitions =
    [
        new("skai-local", "Skai Local Agent", "Skai's local model and task-journal workflow.", [], ["chat", "tools", "streaming", "cancellation", "status", "resume", "approvals", "task-journal"], ["A supported local chat model"], true, false),
        new("codex-cli", "Codex CLI", "OpenAI Codex terminal harness; listed for compatibility discovery only.", ["codex"], ["planning", "coding", "terminal-ui", "session-resume"], ["Codex CLI installed and signed in"], false, true),
        new("claude-code", "Claude Code", "Claude Code terminal harness; listed for compatibility discovery only.", ["claude"], ["planning", "coding", "terminal-ui", "session-resume"], ["Claude Code installed and signed in"], false, true),
        new("opencode", "OpenCode", "OpenCode agent harness; listed for compatibility discovery only.", ["opencode"], ["planning", "coding", "terminal-ui", "session-resume"], ["OpenCode installed and configured with a provider"], false, true),
        new("gemini-cli", "Gemini CLI", "Gemini CLI agent harness; listed for compatibility discovery only.", ["gemini"], ["planning", "coding", "terminal-ui"], ["Gemini CLI installed and signed in"], false, true),
        new("goose", "Goose", "Block Goose agent harness; listed for compatibility discovery only.", ["goose"], ["planning", "coding", "terminal-ui"], ["Goose installed and configured with a provider"], false, true),
        new("pi", "Pi Coding Agent", "Pi coding agent; listed for compatibility discovery only.", ["pi"], ["planning", "coding", "terminal-ui"], ["Pi installed and configured with a provider"], false, true),
        new("openhands", "OpenHands", "OpenHands agent; listed for compatibility discovery only.", ["openhands"], ["planning", "coding", "session-resume"], ["OpenHands installed with its required runtime"], false, true),
    ];

    public static object Snapshot(bool probeExternal = false) => new
    {
        contractVersion = ContractVersion,
        generatedAtUtc = DateTimeOffset.UtcNow,
        adapters = Definitions.Select(definition =>
        {
            var executable = definition.Executables.Select(FindExecutable).FirstOrDefault(path => path is not null);
            var isBuiltIn = definition.Id == "skai-local";
            var installed = isBuiltIn || executable is not null;
            var health = probeExternal && !isBuiltIn && executable is not null ? ProbeExecutable(executable) : null;
            return new
            {
                contractVersion = ContractVersion,
                id = definition.Id,
                name = definition.Name,
                description = definition.Description,
                status = isBuiltIn ? "ready" : installed ? "detected-not-connected" : "not-installed",
                available = isBuiltIn,
                executionSupported = definition.CanExecute,
                executablePath = executable,
                capabilities = definition.CanExecute ? definition.NativeCapabilities : Array.Empty<string>(),
                nativeCapabilities = definition.NativeCapabilities,
                prerequisites = definition.Prerequisites,
                ownsSessionFormat = definition.OwnsSessionFormat,
                taskJournal = "Skai remains authoritative; external session import/resume is not enabled yet.",
                healthNote = isBuiltIn
                    ? "Skai's local task adapter is available. Model availability is checked when a task starts."
                    : installed
                        ? health?.Detail ?? "Executable found on PATH. Authentication and runtime health have not been verified."
                        : "Executable was not found on PATH.",
                healthStatus = isBuiltIn ? "ready" : executable is null ? "missing" : health?.Status ?? "not-checked",
                healthCheckedAtUtc = health?.CheckedAtUtc,
                healthVersion = health?.Version,
                authenticationStatus = isBuiltIn ? "not-applicable" : "unknown",
            };
        }).ToArray(),
    };

    private sealed record ProbeResult(string Status, string Detail, string? Version, DateTimeOffset CheckedAtUtc);

    private static ProbeResult ProbeExecutable(string executable)
    {
        var checkedAt = DateTimeOffset.UtcNow;
        try
        {
            using var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = executable,
                    Arguments = "--version",
                    WorkingDirectory = Path.GetDirectoryName(executable) ?? Environment.CurrentDirectory,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    StandardOutputEncoding = System.Text.Encoding.UTF8,
                    StandardErrorEncoding = System.Text.Encoding.UTF8,
                }
            };
            process.Start();
            var outputTask = process.StandardOutput.ReadToEndAsync();
            var errorTask = process.StandardError.ReadToEndAsync();
            if (!process.WaitForExit(4_000))
            {
                try { process.Kill(entireProcessTree: true); } catch { }
                return new("timeout", "The safe --version probe timed out after 4 seconds.", null, checkedAt);
            }
            var output = (outputTask.GetAwaiter().GetResult() + "\n" + errorTask.GetAwaiter().GetResult()).Trim();
            var bounded = output.Length > 400 ? output[..400] : output;
            var version = string.IsNullOrWhiteSpace(bounded) ? null : bounded.Replace('\r', ' ').Replace('\n', ' ').Trim();
            return process.ExitCode == 0
                ? new("ready", version is null ? "Safe --version probe passed." : $"Safe --version probe passed: {version}", version, checkedAt)
                : new("failed", version is null ? $"Safe --version probe exited with code {process.ExitCode}." : $"Safe --version probe exited with code {process.ExitCode}: {version}", version, checkedAt);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or System.ComponentModel.Win32Exception)
        {
            return new("failed", $"Safe --version probe could not start: {error.Message}", null, checkedAt);
        }
    }

    private static string? FindExecutable(string command)
    {
        var path = Environment.GetEnvironmentVariable("PATH");
        if (string.IsNullOrWhiteSpace(path)) return null;
        var extensions = RuntimeInformation.IsOSPlatform(OSPlatform.Windows)
            ? (Environment.GetEnvironmentVariable("PATHEXT") ?? ".EXE;.CMD;.BAT").Split(';', StringSplitOptions.RemoveEmptyEntries)
            : [""];
        foreach (var directory in path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            foreach (var extension in extensions)
            {
                var candidate = Path.Combine(directory.Trim('"'), command + extension);
                if (File.Exists(candidate)) return candidate;
            }
        }
        return null;
    }
}
