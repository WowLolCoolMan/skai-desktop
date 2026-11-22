using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;
using SkaiDesktop.Core.Infrastructure;

namespace SkaiDesktop.Core.Services;

public sealed partial class GitHubWorkspaceService
{
    private static async Task<string> GetRepositoryRootAsync(string repositoryPath, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(repositoryPath)) throw new ArgumentException("Choose a local repository folder.", nameof(repositoryPath));
        var path = Path.GetFullPath(repositoryPath);
        if (!Directory.Exists(path)) throw new DirectoryNotFoundException("The local repository folder no longer exists.");
        var result = await RunGitAsync(path, ["rev-parse", "--show-toplevel"], null, TimeSpan.FromSeconds(30), cancellationToken).ConfigureAwait(false);
        EnsureSuccess(result, "This folder is not a Git repository.");
        var root = Path.GetFullPath(result.StandardOutput.Trim());
        if (!root.Equals(path, OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal))
            throw new InvalidOperationException("Select the repository root folder, not a subfolder.");
        return root;
    }

    private static string ParseGitHubRemote(Uri uri)
    {
        if (uri.Scheme != Uri.UriSchemeHttps || !uri.Host.Equals("github.com", StringComparison.OrdinalIgnoreCase) || uri.Port != 443 ||
            uri.UserInfo.Length > 0 || uri.Query.Length > 0 || uri.Fragment.Length > 0)
            throw new InvalidOperationException("The origin remote must be a plain HTTPS GitHub repository URL.");
        try { return GitHubApiClient.ParseRepositoryReference(uri.AbsolutePath.Trim('/')); }
        catch (ArgumentException exception) { throw new InvalidOperationException("The origin remote must point to a GitHub owner/repository.", exception); }
    }

    private static void ValidateGitHubCloneUri(Uri uri)
    {
        if (uri.Scheme != Uri.UriSchemeHttps || !uri.Host.Equals("github.com", StringComparison.OrdinalIgnoreCase) || uri.Port != 443 ||
            uri.UserInfo.Length > 0 || uri.Query.Length > 0 || uri.Fragment.Length > 0)
            throw new ArgumentException("Only clean HTTPS GitHub clone URLs are allowed.", nameof(uri));
        _ = GitHubApiClient.ParseRepositoryReference(uri.AbsolutePath.Trim('/'));
    }

    private static async Task<GitProcessResult> RunGitAsync(string workingDirectory, IReadOnlyList<string> arguments, string? accessToken,
        TimeSpan timeoutDuration, CancellationToken cancellationToken, string? indexFile = null)
    {
        var startInfo = new ProcessStartInfo("git")
        {
            WorkingDirectory = workingDirectory,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };
        foreach (var argument in arguments) startInfo.ArgumentList.Add(argument);
        startInfo.Environment["GIT_TERMINAL_PROMPT"] = "0";
        startInfo.Environment["GCM_INTERACTIVE"] = "Never";
        if (!string.IsNullOrWhiteSpace(indexFile)) startInfo.Environment["GIT_INDEX_FILE"] = indexFile;
        if (!string.IsNullOrEmpty(accessToken))
        {
            var basic = Convert.ToBase64String(Encoding.UTF8.GetBytes("x-access-token:" + accessToken));
            startInfo.Environment["GIT_CONFIG_COUNT"] = "2";
            startInfo.Environment["GIT_CONFIG_KEY_0"] = "credential.helper";
            startInfo.Environment["GIT_CONFIG_VALUE_0"] = "";
            startInfo.Environment["GIT_CONFIG_KEY_1"] = "http.https://github.com/.extraheader";
            startInfo.Environment["GIT_CONFIG_VALUE_1"] = "AUTHORIZATION: basic " + basic;
        }

        using var process = new Process { StartInfo = startInfo };
        try
        {
            if (!process.Start()) throw new InvalidOperationException("Git could not be started. Install Git and make sure it is available on PATH.");
        }
        catch (System.ComponentModel.Win32Exception exception)
        {
            throw new InvalidOperationException("Git is not installed or is not available on PATH. Install Git to clone, commit, and push repositories.", exception);
        }

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(timeoutDuration);
        var stdout = ReadLimitedAsync(process.StandardOutput, timeout.Token);
        var stderr = ReadLimitedAsync(process.StandardError, timeout.Token);
        try
        {
            await process.WaitForExitAsync(timeout.Token).ConfigureAwait(false);
            return new(process.ExitCode, await stdout.ConfigureAwait(false), await stderr.ConfigureAwait(false));
        }
        catch (OperationCanceledException)
        {
            try { process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
            if (!cancellationToken.IsCancellationRequested) throw new TimeoutException("Git did not finish before the operation timed out.");
            throw;
        }
    }

    private static async Task<GitProcessResult> RunToolAsync(string workingDirectory, string executable, IReadOnlyList<string> arguments,
        TimeSpan timeoutDuration, CancellationToken cancellationToken)
    {
        var startInfo = new ProcessStartInfo(executable)
        {
            WorkingDirectory = workingDirectory,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };
        foreach (var argument in arguments) startInfo.ArgumentList.Add(argument);
        startInfo.Environment["GH_PROMPT_DISABLED"] = "1";
        using var process = new Process { StartInfo = startInfo };
        try
        {
            if (!process.Start()) throw new InvalidOperationException($"{executable} could not be started.");
        }
        catch (System.ComponentModel.Win32Exception exception)
        {
            throw new InvalidOperationException("GitHub CLI is not installed or is not available on PATH.", exception);
        }

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(timeoutDuration);
        var stdout = ReadLimitedAsync(process.StandardOutput, timeout.Token);
        var stderr = ReadLimitedAsync(process.StandardError, timeout.Token);
        try
        {
            await process.WaitForExitAsync(timeout.Token).ConfigureAwait(false);
            return new(process.ExitCode, await stdout.ConfigureAwait(false), await stderr.ConfigureAwait(false));
        }
        catch (OperationCanceledException)
        {
            try { process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
            if (!cancellationToken.IsCancellationRequested) throw new TimeoutException($"{executable} did not finish before the operation timed out.");
            throw;
        }
    }

    private static async Task<string> ReadLimitedAsync(StreamReader reader, CancellationToken cancellationToken)
    {
        const int maxCharacters = 1_048_576;
        var buffer = new char[8192];
        var output = new StringBuilder(Math.Min(maxCharacters, 8192));
        while (true)
        {
            var read = await reader.ReadAsync(buffer.AsMemory(), cancellationToken).ConfigureAwait(false);
            if (read == 0) break;
            if (output.Length < maxCharacters)
                output.Append(buffer, 0, Math.Min(read, maxCharacters - output.Length));
        }
        return output.Length == maxCharacters ? output + "…[output truncated]" : output.ToString();
    }

    private static void EnsureSuccess(GitProcessResult result, string fallback)
    {
        if (result.ExitCode == 0) return;
        var detail = result.StandardError.Trim();
        if (detail.Length > 400) detail = detail[..400] + "…";
        if (detail.Contains("AUTHORIZATION: basic", StringComparison.OrdinalIgnoreCase)) detail = "GitHub rejected the saved authorization. Reconnect GitHub and try again.";
        throw new InvalidOperationException(detail.Length == 0 ? fallback : $"{fallback} {detail}");
    }


    private static void ValidateAccessToken(string? accessToken)
    {
        if (string.IsNullOrWhiteSpace(accessToken) || accessToken.Length > 16_384 || accessToken.Any(char.IsControl))
            throw new ArgumentException("A valid GitHub sign-in is required.", nameof(accessToken));
    }

    private sealed record GitProcessResult(int ExitCode, string StandardOutput, string StandardError);}
