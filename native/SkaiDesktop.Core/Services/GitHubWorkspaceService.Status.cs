using System.Text.RegularExpressions;

namespace SkaiDesktop.Core.Services;

public sealed partial class GitHubWorkspaceService
{
    public static GitWorkspaceStatus ParseStatus(string porcelainV2, string repository)
    {
        var branch = "(detached HEAD)";
        var ahead = 0;
        var behind = 0;
        var changes = new List<GitWorkspaceFileChange>();
        foreach (var line in porcelainV2.Split('\n', StringSplitOptions.RemoveEmptyEntries))
        {
            var trimmed = line.TrimEnd('\r');
            if (trimmed.StartsWith("# branch.head ", StringComparison.Ordinal)) branch = trimmed[14..];
            else if (AheadBehindPattern.Match(trimmed) is { Success: true } match)
            {
                _ = int.TryParse(match.Groups[1].Value, out ahead);
                _ = int.TryParse(match.Groups[2].Value, out behind);
            }
            else if (trimmed.StartsWith("? ", StringComparison.Ordinal))
                changes.Add(new("??", trimmed[2..]));
            else if (trimmed.StartsWith("1 ", StringComparison.Ordinal))
            {
                var fields = trimmed.Split(' ', 9, StringSplitOptions.None);
                if (fields.Length == 9) changes.Add(new(fields[1], fields[8]));
            }
            else if (trimmed.StartsWith("2 ", StringComparison.Ordinal))
            {
                var fields = trimmed.Split(' ', 10, StringSplitOptions.None);
                if (fields.Length == 10)
                {
                    var paths = fields[9].Split('\t', 2, StringSplitOptions.None);
                    changes.Add(new(fields[1], paths[0], paths.Length == 2 ? paths[1] : null));
                }
            }
            else if (trimmed.StartsWith("u ", StringComparison.Ordinal))
            {
                var fields = trimmed.Split(' ', 11, StringSplitOptions.None);
                if (fields.Length == 11) changes.Add(new("UU", fields[10]));
            }
        }
        return new(branch, changes, ahead, behind, repository);
    }

    public static IReadOnlyList<string> FindUnsafeChangePaths(IEnumerable<GitWorkspaceFileChange> changes) =>
        changes
            .SelectMany(change => new[] { change.Path, change.OriginalPath })
            .Where(path => path is not null)
            .Select(path => path!.Replace('\\', '/'))
            .Where(IsUnsafeChangePath)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

    public static bool IsConflictStatus(string? status) => status is not null &&
        (status.Contains('U', StringComparison.OrdinalIgnoreCase) || status is "AA" or "DD");

    public static bool HasConflicts(IEnumerable<GitWorkspaceFileChange> changes) =>
        changes.Any(change => IsConflictStatus(change.Status));

    private static bool IsUnsafeChangePath(string path)
    {
        var parts = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0) return false;
        if (parts[..^1].Any(ProtectedDirectories.Contains)) return true;
        var name = parts[^1];
        if (ProtectedNames.Contains(name)) return true;
        if (name.StartsWith(".env", StringComparison.OrdinalIgnoreCase) &&
            !name.Equals(".env.example", StringComparison.OrdinalIgnoreCase)) return true;
        return Path.GetExtension(name) is ".pem" or ".key" or ".pfx" or ".p12";
    }

}
