// Local `git` operations for a GitHub repository: clone, status, diff preview, commit, push, and guarded PR creation.
// Tokens are passed via a credential helper, never on the command line or in the remote URL.
// Depends on: GitHubApiClient, WorkspaceFileEditor (bounded file read). Used by the Agent Host GitHub protocol.

using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;
using SkaiDesktop.Core.Infrastructure;

namespace SkaiDesktop.Core.Services;

public sealed record GitWorkspaceFileChange(string Status, string Path, string? OriginalPath = null);
public sealed record GitWorkspaceStatus(string Branch, IReadOnlyList<GitWorkspaceFileChange> Changes, int CommitsAhead, int CommitsBehind, string Repository);
public sealed record GitWorkspaceDiffPreview(string Text, int IncludedFiles, int RedactedFiles, bool IsTruncated);

/// <summary>Runs local Git operations for GitHub repositories without putting OAuth tokens in command arguments or remotes.</summary>
public sealed partial class GitHubWorkspaceService
{
    public const int MaxDiffPreviewCharacters = 256_000;
    private const int MaxDiffFileCharacters = 64_000;
    private const int MaxDiffFiles = 24;
    private static readonly Regex AheadBehindPattern = new("^# branch\\.ab \\+(\\d+) -(\\d+)$", RegexOptions.CultureInvariant | RegexOptions.Compiled);
    private static readonly HashSet<string> ProtectedDirectories = new(StringComparer.OrdinalIgnoreCase) { ".git", ".ssh", ".aws", ".azure", ".gnupg" };
    private static readonly HashSet<string> ProtectedNames = new(StringComparer.OrdinalIgnoreCase) { "credentials.json", "secrets.json", "id_rsa", "id_ed25519" };

    public async Task<string> CloneAsync(GitHubRepository repository, string destination, string accessToken, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ValidateGitHubCloneUri(repository.CloneUrl);
        ValidateAccessToken(accessToken);
        var fullDestination = Path.GetFullPath(destination);
        var parent = Path.GetDirectoryName(fullDestination) ?? throw new ArgumentException("Choose a destination folder.", nameof(destination));
        Directory.CreateDirectory(parent);
        if (File.Exists(fullDestination) || Directory.Exists(fullDestination) && Directory.EnumerateFileSystemEntries(fullDestination).Any())
            throw new IOException("The repository destination already exists and is not empty. Choose another folder.");

        var result = await RunGitAsync(parent, ["clone", "--quiet", "--", repository.CloneUrl.AbsoluteUri, fullDestination], accessToken,
            TimeSpan.FromMinutes(10), cancellationToken).ConfigureAwait(false);
        EnsureSuccess(result, "GitHub repository could not be cloned.");
        var status = await GetStatusAsync(fullDestination, cancellationToken).ConfigureAwait(false);
        if (!status.Repository.Equals(repository.FullName, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("The cloned repository identity did not match the selected GitHub repository.");
        return fullDestination;
    }

    public async Task<GitWorkspaceStatus> GetStatusAsync(string repositoryPath, CancellationToken cancellationToken = default)
    {
        var root = await GetRepositoryRootAsync(repositoryPath, cancellationToken).ConfigureAwait(false);
        var remoteResult = await RunGitAsync(root, ["remote", "get-url", "origin"], null, TimeSpan.FromSeconds(30), cancellationToken).ConfigureAwait(false);
        EnsureSuccess(remoteResult, "This project does not have a GitHub origin remote.");
        if (!Uri.TryCreate(remoteResult.StandardOutput.Trim(), UriKind.Absolute, out var remoteUri))
            throw new InvalidOperationException("The origin remote is not a valid GitHub URL.");
        var repository = ParseGitHubRemote(remoteUri);

        var statusResult = await RunGitAsync(root, ["status", "--porcelain=v2", "--branch", "--untracked-files=all"], null,
            TimeSpan.FromSeconds(30), cancellationToken).ConfigureAwait(false);
        EnsureSuccess(statusResult, "Git could not read the workspace status.");
        return ParseStatus(statusResult.StandardOutput, repository);
    }

    /// <summary>Reads local Git state without requiring a GitHub origin or credentials.</summary>
    public async Task<GitWorkspaceStatus> GetLocalStatusAsync(string repositoryPath, CancellationToken cancellationToken = default)
    {
        var root = await GetRepositoryRootAsync(repositoryPath, cancellationToken).ConfigureAwait(false);
        var statusResult = await RunGitAsync(root, ["status", "--porcelain=v2", "--branch", "--untracked-files=all"], null,
            TimeSpan.FromSeconds(30), cancellationToken).ConfigureAwait(false);
        EnsureSuccess(statusResult, "Git could not read the local workspace status.");
        return ParseStatus(statusResult.StandardOutput, "local repository");
    }

    public async Task<string> CommitSelectedAsync(string repositoryPath, IEnumerable<GitWorkspaceFileChange> selectedChanges, string message,
        string accessToken, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(selectedChanges);
        var selected = selectedChanges.Distinct().ToArray();
        if (selected.Length == 0) throw new InvalidOperationException("Select at least one safe file to commit.");
        var status = await GetStatusAsync(repositoryPath, cancellationToken).ConfigureAwait(false);
        var currentByIdentity = status.Changes.ToDictionary(ChangeIdentity, StringComparer.Ordinal);
        var currentSelection = new List<GitWorkspaceFileChange>(selected.Length);
        foreach (var requested in selected)
        {
            var identity = ChangeIdentity(requested);
            if (!currentByIdentity.TryGetValue(identity, out var current))
                throw new InvalidOperationException($"The workspace changed since review. Reopen the GitHub review before committing {DisplayPath(requested)}.");
            currentSelection.Add(current);
        }
        var unsafePaths = FindUnsafeChangePaths(currentSelection);
        if (unsafePaths.Count > 0)
            throw new InvalidOperationException($"Refusing to stage secret-like files: {string.Join(", ", unsafePaths.Take(8))}{(unsafePaths.Count > 8 ? "…" : "")}");
        return await CommitSelectedCoreAsync(repositoryPath, currentSelection, message, accessToken, cancellationToken).ConfigureAwait(false);
    }

    public async Task<GitWorkspaceDiffPreview> GetDiffPreviewAsync(string repositoryPath, IEnumerable<GitWorkspaceFileChange> selectedChanges,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(selectedChanges);
        var selected = selectedChanges.Distinct().ToArray();
        if (selected.Length == 0) return new("No files selected for diff preview.", 0, 0, false);
        if (selected.Length > MaxDiffFiles) throw new InvalidOperationException($"Select at most {MaxDiffFiles} files for a bounded diff preview.");
        var status = await GetLocalStatusAsync(repositoryPath, cancellationToken).ConfigureAwait(false);
        var currentByIdentity = status.Changes.ToDictionary(ChangeIdentity, StringComparer.Ordinal);
        var builder = new StringBuilder();
        var included = 0;
        var redacted = 0;
        var truncated = false;
        foreach (var requested in selected)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!currentByIdentity.TryGetValue(ChangeIdentity(requested), out var current))
                throw new InvalidOperationException($"The workspace changed since review. Reopen the GitHub review before previewing {DisplayPath(requested)}.");
            if (FindUnsafeChangePaths([current]).Count > 0)
            {
                redacted++;
                AppendDiff(builder, $"# [protected path redacted; review locally before staging]\n# status {current.Status}\n", ref truncated);
                continue;
            }

            var root = await GetRepositoryRootAsync(repositoryPath, cancellationToken).ConfigureAwait(false);
            var paths = new[] { current.Path, current.OriginalPath }
                .Where(path => !string.IsNullOrWhiteSpace(path))
                .Distinct(StringComparer.Ordinal)
                .Cast<string>()
                .ToArray();
            var staged = await RunGitAsync(root, ["diff", "--cached", "--no-ext-diff", "--no-color", "--find-renames", "--unified=3", "--", .. paths], null,
                TimeSpan.FromSeconds(30), cancellationToken).ConfigureAwait(false);
            EnsureSuccess(staged, "Git could not read the staged diff.");
            var unstaged = await RunGitAsync(root, ["diff", "--no-ext-diff", "--no-color", "--find-renames", "--unified=3", "--", .. paths], null,
                TimeSpan.FromSeconds(30), cancellationToken).ConfigureAwait(false);
            EnsureSuccess(unstaged, "Git could not read the workspace diff.");
            var diff = (staged.StandardOutput + unstaged.StandardOutput).Trim();
            if (diff.Length == 0 && current.Status == "??") diff = BuildUntrackedDiff(root, current.Path);
            if (diff.Length == 0) diff = $"# {current.Status} {DisplayPath(current)}\n# No text diff is available (the file may be binary or unchanged in the selected index).\n";
            included++;
            AppendDiff(builder, diff + "\n", ref truncated);
        }
        if (builder.Length == 0) builder.Append("No diff preview is available for the selected files.\n");
        return new(builder.ToString(), included, redacted, truncated);
    }

    /// <summary>Commits explicitly selected local changes without contacting GitHub.</summary>
    public async Task<string> CommitSelectedLocallyAsync(string repositoryPath, IEnumerable<GitWorkspaceFileChange> selectedChanges, string message,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(selectedChanges);
        var selected = selectedChanges.Distinct().ToArray();
        if (selected.Length == 0) throw new InvalidOperationException("Select at least one safe file to commit.");
        var status = await GetLocalStatusAsync(repositoryPath, cancellationToken).ConfigureAwait(false);
        var currentByIdentity = status.Changes.ToDictionary(ChangeIdentity, StringComparer.Ordinal);
        var currentSelection = selected.Select(requested => currentByIdentity.TryGetValue(ChangeIdentity(requested), out var current)
            ? current
            : throw new InvalidOperationException($"The workspace changed since review. Reopen the Git review before committing {DisplayPath(requested)}.")).ToArray();
        return await CommitSelectedCoreAsync(repositoryPath, currentSelection, message, null, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Pushes clean local commits through the user's configured Git credential helper.</summary>
    public async Task<string> PushLocalAsync(string repositoryPath, CancellationToken cancellationToken = default)
    {
        var status = await GetLocalStatusAsync(repositoryPath, cancellationToken).ConfigureAwait(false);
        if (status.Changes.Count > 0) throw new InvalidOperationException("Commit or discard the listed changes before pushing.");
        if (GitHubWorkspaceService.HasConflicts(status.Changes)) throw new InvalidOperationException("Resolve conflicts before pushing.");
        if (status.CommitsAhead == 0) throw new InvalidOperationException("There are no local commits waiting to push.");
        if (status.CommitsBehind > 0) throw new InvalidOperationException("The remote branch has newer commits. Fetch and review them before pushing.");
        var root = await GetRepositoryRootAsync(repositoryPath, cancellationToken).ConfigureAwait(false);
        var remote = await RunGitAsync(root, ["remote", "get-url", "origin"], null, TimeSpan.FromSeconds(30), cancellationToken).ConfigureAwait(false);
        EnsureSuccess(remote, "This project has no origin remote configured. Add one before pushing.");
        var push = await RunGitAsync(root, ["push", "--set-upstream", "origin", "HEAD"], null, TimeSpan.FromMinutes(5), cancellationToken).ConfigureAwait(false);
        EnsureSuccess(push, "Git push failed. Your local commit is preserved; review the Git credential helper and remote state.");
        return (push.StandardOutput + push.StandardError).Trim();
    }

    /// <summary>Creates a pull request with the user's authenticated local GitHub CLI session.</summary>
    public async Task<string> CreatePullRequestAsync(string repositoryPath, string title, string body,
        CancellationToken cancellationToken = default)
    {
        title = (title ?? "").Trim();
        body = (body ?? "").Trim();
        if (title.Length is < 1 or > 256) throw new ArgumentException("Enter a pull request title between 1 and 256 characters.", nameof(title));
        if (body.Length > 16_000) throw new ArgumentException("Keep the pull request description under 16,000 characters.", nameof(body));

        var status = await GetStatusAsync(repositoryPath, cancellationToken).ConfigureAwait(false);
        if (status.Branch.Equals("main", StringComparison.OrdinalIgnoreCase) || status.Branch.Equals("master", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Create a pull request from a feature branch, not the default branch.");
        if (status.Changes.Count > 0) throw new InvalidOperationException("Commit or discard workspace changes before creating a pull request.");
        if (HasConflicts(status.Changes)) throw new InvalidOperationException("Resolve conflicts before creating a pull request.");
        if (status.CommitsAhead == 0) throw new InvalidOperationException("Push at least one local commit before creating a pull request.");
        if (status.CommitsBehind > 0) throw new InvalidOperationException("The remote branch has newer commits. Fetch and review them before creating a pull request.");

        var root = await GetRepositoryRootAsync(repositoryPath, cancellationToken).ConfigureAwait(false);
        var result = await RunToolAsync(root, "gh", ["pr", "create", "--title", title, "--body", body, "--base", "main", "--head", status.Branch],
            TimeSpan.FromMinutes(2), cancellationToken).ConfigureAwait(false);
        EnsureSuccess(result, "Pull request creation is unavailable. Install GitHub CLI and run `gh auth login`, then try again.");
        return (result.StandardOutput + result.StandardError).Trim();
    }


    private async Task<string> CommitSelectedCoreAsync(string repositoryPath, IReadOnlyCollection<GitWorkspaceFileChange> selectedChanges, string message,
        string? accessToken, CancellationToken cancellationToken)
    {
        if (accessToken is not null) ValidateAccessToken(accessToken);
        message = (message ?? "").Trim();
        if (message.Length is < 1 or > 256 || message.Any(character => char.IsControl(character) && character is not '\n' and not '\r' and not '\t'))
            throw new ArgumentException("Enter a commit message between 1 and 256 characters.", nameof(message));

        if (selectedChanges.Count == 0) throw new InvalidOperationException("There are no file changes to commit.");
        var root = await GetRepositoryRootAsync(repositoryPath, cancellationToken).ConfigureAwait(false);
        var paths = selectedChanges
            .SelectMany(change => change.OriginalPath is not null && !change.Status.StartsWith("R", StringComparison.Ordinal)
                ? new[] { change.Path, change.OriginalPath }
                : new[] { change.Path })
            .Where(path => !string.IsNullOrWhiteSpace(path))
            .Cast<string>()
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        var temporaryIndex = Path.Combine(Path.GetTempPath(), $"skai-index-{Guid.NewGuid():N}");
        try
        {
            var resetIndex = await RunGitAsync(root, ["read-tree", "HEAD"], null, TimeSpan.FromMinutes(2), cancellationToken, temporaryIndex).ConfigureAwait(false);
            EnsureSuccess(resetIndex, "Git could not prepare an isolated commit index.");
            foreach (var path in paths)
            {
                var target = Path.GetFullPath(Path.Combine(root, path));
                var arguments = File.Exists(target) || Directory.Exists(target)
                    ? new[] { "add", "--", path }
                    : new[] { "add", "-u", "--", path };
                var stage = await RunGitAsync(root, arguments, null, TimeSpan.FromMinutes(2), cancellationToken, temporaryIndex).ConfigureAwait(false);
                EnsureSuccess(stage, "Git could not stage the workspace changes.");
            }
            var commit = await RunGitAsync(root, ["commit", "-m", message], null, TimeSpan.FromMinutes(2), cancellationToken, temporaryIndex).ConfigureAwait(false);
            EnsureSuccess(commit, "Git could not create the commit. Check your Git author name and email in Git settings.");
            return commit.StandardOutput.Trim();
        }
        finally
        {
            try { if (File.Exists(temporaryIndex)) File.Delete(temporaryIndex); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }

    private static string ChangeIdentity(GitWorkspaceFileChange change) =>
        $"{change.Status}\u001f{change.Path}\u001f{change.OriginalPath}";

    private static string DisplayPath(GitWorkspaceFileChange change) =>
        change.OriginalPath is null ? change.Path : $"{change.Path} (from {change.OriginalPath})";

    private static void AppendDiff(StringBuilder builder, string text, ref bool truncated)
    {
        if (builder.Length >= MaxDiffPreviewCharacters)
        {
            truncated = true;
            return;
        }
        var remaining = MaxDiffPreviewCharacters - builder.Length;
        if (text.Length <= remaining)
        {
            builder.Append(text);
            return;
        }
        builder.Append(text.AsSpan(0, Math.Max(0, remaining - 32)));
        builder.Append("\n[… diff preview truncated …]\n");
        truncated = true;
    }

    private static string BuildUntrackedDiff(string root, string relativePath)
    {
        var target = Path.GetFullPath(Path.Combine(root, relativePath));
        var relative = Path.GetRelativePath(root, target);
        if (Path.IsPathRooted(relative) || relative == ".." || relative.StartsWith(".." + Path.DirectorySeparatorChar, StringComparison.Ordinal))
            return "# [untracked path redacted; it leaves the repository root]\n";
        if (!File.Exists(target)) return $"# ?? {relativePath}\n# The untracked file disappeared before preview.\n";
        string text;
        try { text = WorkspaceFileEditor.ReadTextBounded(target, MaxDiffFileCharacters * 4); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidDataException)
        {
            return $"# ?? {relativePath}\n# Binary or unreadable untracked file; content omitted.\n";
        }
        if (text.Contains('\0')) return $"# ?? {relativePath}\n# Binary untracked file; content omitted.\n";
        var lines = text.Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n').Split('\n');
        var builder = new StringBuilder();
        builder.Append("diff --git a/").Append(relativePath).Append(" b/").Append(relativePath)
            .Append("\nnew file mode 100644\n--- /dev/null\n+++ b/").Append(relativePath)
            .Append("\n@@ -0,0 +1,").Append(Math.Max(1, lines.Length)).Append(" @@\n");
        foreach (var line in lines)
        {
            if (builder.Length + line.Length + 2 > MaxDiffFileCharacters) { builder.Append("+[… file diff truncated …]\n"); break; }
            builder.Append('+').Append(line).Append('\n');
        }
        return builder.ToString();
    }

    public async Task PushAsync(string repositoryPath, string accessToken, CancellationToken cancellationToken = default)
    {
        ValidateAccessToken(accessToken);
        var status = await GetStatusAsync(repositoryPath, cancellationToken).ConfigureAwait(false);
        if (status.Changes.Count > 0) throw new InvalidOperationException("Commit or discard the listed changes before pushing.");
        if (status.CommitsAhead == 0) throw new InvalidOperationException("There are no local commits waiting to push.");
        var root = await GetRepositoryRootAsync(repositoryPath, cancellationToken).ConfigureAwait(false);
        var fetch = await RunGitAsync(root, ["fetch", "--prune", "--no-tags", "origin"], accessToken, TimeSpan.FromMinutes(2), cancellationToken).ConfigureAwait(false);
        EnsureSuccess(fetch, "GitHub remote state could not be refreshed. Your local commits were not pushed; check connectivity and GitHub access, then try again.");
        status = await GetStatusAsync(repositoryPath, cancellationToken).ConfigureAwait(false);
        if (status.Changes.Count > 0) throw new InvalidOperationException("The workspace changed while refreshing GitHub state. Review the changes before pushing.");
        if (status.CommitsAhead == 0) throw new InvalidOperationException("There are no local commits waiting to push after refreshing GitHub state.");
        string[] arguments = status.CommitsBehind > 0
            ? throw new InvalidOperationException("The GitHub branch has newer commits. Fetch and review them before pushing to avoid overwriting remote work.")
            : ["push", "--set-upstream", "origin", "HEAD"];
        var push = await RunGitAsync(root, arguments, accessToken, TimeSpan.FromMinutes(5), cancellationToken).ConfigureAwait(false);
        EnsureSuccess(push, "GitHub push failed. Your local commit is preserved and can be pushed again after resolving the GitHub error.");
    }


}
