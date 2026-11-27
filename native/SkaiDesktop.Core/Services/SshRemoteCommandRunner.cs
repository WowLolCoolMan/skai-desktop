using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;

namespace SkaiDesktop.Core.Services;

public sealed record SshRemoteCommandResult(int ExitCode, string Output, bool TimedOut, bool OutputTruncated, string Target);

/// <summary>Runs one explicitly requested remote command through the system OpenSSH client.</summary>
public sealed class SshRemoteCommandRunner
{
    public const int MaxCommandCharacters = 4_000;
    public const int MaxOutputCharacters = 30_000;
    public static readonly TimeSpan MaxTimeout = TimeSpan.FromMinutes(2);
    private static readonly Regex HostPattern = new(@"^(?:[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?|(?:\d{1,3}\.){3}\d{1,3}|\[[0-9a-f:]+\])$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);
    private static readonly Regex UserPattern = new(@"^[a-z_][a-z0-9_.-]{0,63}\$?$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    public async Task<SshRemoteCommandResult> RunAsync(
        string host,
        string username,
        int port,
        string command,
        TimeSpan timeout,
        CancellationToken cancellationToken = default)
    {
        host = (host ?? string.Empty).Trim();
        username = (username ?? string.Empty).Trim();
        if (!HostPattern.IsMatch(host) || host.Contains("..", StringComparison.Ordinal))
            throw new ArgumentException("Enter a valid SSH host name or IP address.", nameof(host));
        if (!UserPattern.IsMatch(username)) throw new ArgumentException("Enter a valid SSH username.", nameof(username));
        if (port is < 1 or > 65_535) throw new ArgumentOutOfRangeException(nameof(port), "SSH port must be between 1 and 65535.");
        if (string.IsNullOrWhiteSpace(command) || command.Length > MaxCommandCharacters || command.Contains('\0'))
            throw new ArgumentException($"Enter a remote command of 1 to {MaxCommandCharacters:N0} characters.", nameof(command));
        if (timeout < TimeSpan.FromSeconds(1) || timeout > MaxTimeout)
            throw new ArgumentOutOfRangeException(nameof(timeout), $"SSH command timeout must be between 1 second and {MaxTimeout.TotalMinutes:N0} minutes.");

        var target = $"{username}@{host}";
        var start = new ProcessStartInfo
        {
            FileName = OperatingSystem.IsWindows() ? "ssh.exe" : "ssh",
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        var inherited = start.Environment.ToArray();
        start.Environment.Clear();
        foreach (var (name, value) in inherited)
        {
            if (name.Equals("PATH", StringComparison.OrdinalIgnoreCase)
                || name.Equals("HOME", StringComparison.OrdinalIgnoreCase)
                || name.Equals("USERPROFILE", StringComparison.OrdinalIgnoreCase)
                || name.Equals("SystemRoot", StringComparison.OrdinalIgnoreCase)
                || name.Equals("WINDIR", StringComparison.OrdinalIgnoreCase)
                || name.Equals("HOMEDRIVE", StringComparison.OrdinalIgnoreCase)
                || name.Equals("HOMEPATH", StringComparison.OrdinalIgnoreCase)) start.Environment[name] = value;
        }
        foreach (var argument in new[]
        {
            "-T", "-p", port.ToString(System.Globalization.CultureInfo.InvariantCulture),
            "-o", "BatchMode=yes",
            "-o", "StrictHostKeyChecking=yes",
            "-o", "ForwardAgent=no",
            "-o", "ClearAllForwardings=yes",
            "-o", "PermitLocalCommand=no",
            "-o", "ConnectTimeout=10",
            "--", target, command,
        }) start.ArgumentList.Add(argument);

        using var process = new Process { StartInfo = start, EnableRaisingEvents = true };
        try
        {
            if (!process.Start()) throw new InvalidOperationException("The OpenSSH process could not be started.");
        }
        catch (System.ComponentModel.Win32Exception error)
        {
            throw new InvalidOperationException("OpenSSH was not found. Install the system OpenSSH client and make ssh available on PATH.", error);
        }
        process.StandardInput.Close();
        var output = new StringBuilder();
        var outputGate = new object();
        var truncated = 0;
        var stdout = DrainAsync(process.StandardOutput, output, outputGate, () => Interlocked.Exchange(ref truncated, 1));
        var stderr = DrainAsync(process.StandardError, output, outputGate, () => Interlocked.Exchange(ref truncated, 1));
        using var timeoutSource = new CancellationTokenSource(timeout);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutSource.Token);
        var timedOut = false;
        try { await process.WaitForExitAsync(linked.Token).ConfigureAwait(false); }
        catch (OperationCanceledException) when (timeoutSource.IsCancellationRequested && !cancellationToken.IsCancellationRequested)
        {
            timedOut = true;
            TryKill(process);
            await process.WaitForExitAsync(CancellationToken.None).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            TryKill(process);
            await process.WaitForExitAsync(CancellationToken.None).ConfigureAwait(false);
            throw;
        }
        await Task.WhenAll(stdout, stderr).ConfigureAwait(false);
        var cleaned = Regex.Replace(output.ToString(), "\\x1b(?:\\[[0-?]*[ -/]*[@-~]|\\][^\\x07]*(?:\\x07|\\x1b\\\\))", string.Empty, RegexOptions.CultureInvariant);
        cleaned = new string(cleaned.Where(character => !char.IsControl(character) || character is '\r' or '\n' or '\t').ToArray());
        return new SshRemoteCommandResult(process.ExitCode, cleaned, timedOut, truncated != 0, target);
    }

    private static async Task DrainAsync(StreamReader reader, StringBuilder output, object gate, Action markTruncated)
    {
        var buffer = new char[2048];
        while (true)
        {
            var count = await reader.ReadAsync(buffer).ConfigureAwait(false);
            if (count == 0) return;
            lock (gate)
            {
                var remaining = MaxOutputCharacters - output.Length;
                if (remaining > 0) output.Append(buffer, 0, Math.Min(remaining, count));
                if (count > remaining) markTruncated();
            }
        }
    }

    private static void TryKill(Process process)
    {
        try { if (!process.HasExited) process.Kill(entireProcessTree: true); }
        catch (InvalidOperationException) { }
        catch (System.ComponentModel.Win32Exception) { }
    }
}
