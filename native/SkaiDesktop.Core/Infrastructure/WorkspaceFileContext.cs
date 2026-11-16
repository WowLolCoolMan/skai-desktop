// Reads a small, text-only sample of a project's selected folders to send to the model
// (skips secrets, VCS metadata, dependencies, binaries, and symlinks).
// Depends on: WorkspaceFileEditor (bounded file read). Used by the Agent Host when building model requests.

using System.Text;

namespace SkaiDesktop.Core.Infrastructure;

/// <summary>Reads a small, safe text-only sample from folders the user explicitly selected.</summary>
public static class WorkspaceFileContext
{
    public const int MaxFiles = 16;
    public const int MaxFileCharacters = 8_000;
    public const int MaxTotalCharacters = 48_000;
    public const int MaxPreviewEntries = 24;
    public const int MaxBrowserTextEntries = 128;
    public const string BrowserBoundaryDescription = "Shows up to 128 readable text files. Protected names, dependency/build directories, and linked paths are hidden.";

    public sealed record WorkspaceFileEntry(string RelativePath, string FullPath, string Kind, long Bytes);
    public sealed record WorkspaceTextFileEntry(string RelativePath, string FullPath, long Bytes);
    public sealed record WorkspaceTextFileBrowserSnapshot(
        IReadOnlyList<WorkspaceTextFileEntry> Files,
        int ProtectedFilesSkipped,
        int ExcludedDirectoriesSkipped,
        int LinkedPathsSkipped,
        bool HitEntryLimit);

    private static readonly HashSet<string> ExcludedDirectories = new(StringComparer.OrdinalIgnoreCase)
    {
        ".git", ".svn", ".hg", "node_modules", "vendor", "bin", "obj", "dist", "build",
        ".venv", "venv", "__pycache__", ".idea", ".vscode", "target"
    };

    private static readonly HashSet<string> ExcludedFiles = new(StringComparer.OrdinalIgnoreCase)
    {
        ".env", ".env.local", ".env.production", "secrets.json", "credentials.json", "id_rsa", "id_ed25519"
    };

    private static readonly HashSet<string> TextExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".cs", ".csproj", ".sln", ".xaml", ".xml", ".json", ".md", ".txt", ".yml", ".yaml",
        ".toml", ".ini", ".props", ".targets", ".razor", ".html", ".css", ".js", ".jsx", ".ts",
        ".tsx", ".py", ".sh", ".ps1", ".sql", ".go", ".rs", ".java", ".kt", ".swift", ".c",
        ".h", ".cpp", ".hpp", ".vue", ".svelte", ".gitignore", ".editorconfig"
    };

    public static IReadOnlyList<(string Path, string Content)> ReadSelectedFiles(IEnumerable<string> selectedFolders)
    {
        ArgumentNullException.ThrowIfNull(selectedFolders);
        var result = new List<(string Path, string Content)>();
        var totalCharacters = 0;
        foreach (var selected in selectedFolders)
        {
            if (result.Count >= MaxFiles || totalCharacters >= MaxTotalCharacters) break;
            if (string.IsNullOrWhiteSpace(selected)) continue;
            var root = Path.GetFullPath(selected);
            if (!Directory.Exists(root) || IsLink(root)) continue;

            var pending = new Stack<string>();
            pending.Push(root);
            while (pending.Count > 0 && result.Count < MaxFiles && totalCharacters < MaxTotalCharacters)
            {
                var directory = pending.Pop();
                IEnumerable<string> files;
                try { files = Directory.EnumerateFiles(directory).OrderBy(Path.GetFileName, StringComparer.OrdinalIgnoreCase).ToArray(); }
                catch (IOException) { continue; }
                catch (UnauthorizedAccessException) { continue; }

                foreach (var file in files)
                {
                    if (result.Count >= MaxFiles || totalCharacters >= MaxTotalCharacters) break;
                    var name = Path.GetFileName(file);
                    if (IsExcludedFile(name) || !TextExtensions.Contains(Path.GetExtension(file)) || IsLink(file)) continue;
                    try
                    {
                        var info = new FileInfo(file);
                        if (info.Length > MaxFileCharacters * 4L) continue;
                        var content = WorkspaceFileEditor.ReadTextBounded(file, MaxFileCharacters * 4);
                        if (content.Contains('\0')) continue;
                        if (content.Length > MaxFileCharacters) content = content[..MaxFileCharacters] + "\n[truncated]";
                        var relative = Path.GetRelativePath(root, file);
                        var remaining = MaxTotalCharacters - totalCharacters;
                        if (content.Length > remaining) content = content[..remaining] + "\n[truncated]";
                        result.Add((relative, content));
                        totalCharacters += content.Length;
                    }
                    catch (IOException) { }
                    catch (UnauthorizedAccessException) { }
                    catch (DecoderFallbackException) { }
                }

                try
                {
                    foreach (var child in Directory.EnumerateDirectories(directory).OrderByDescending(Path.GetFileName, StringComparer.OrdinalIgnoreCase))
                    {
                        if (!ExcludedDirectories.Contains(Path.GetFileName(child)) && !IsLink(child)) pending.Push(child);
                    }
                }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
            }
        }
        return result;
    }

    /// <summary>
    /// Enumerates a bounded text-file navigation surface without opening file
    /// contents. This is intentionally separate from the smaller model-context
    /// sample so browsing does not change what is sent to a provider.
    /// </summary>
    public static IReadOnlyList<WorkspaceTextFileEntry> EnumerateTextFiles(IEnumerable<string> selectedFolders)
        => EnumerateTextFileBrowser(selectedFolders).Files;

    /// <summary>
    /// Enumerates the bounded project browser and reports only structural skip
    /// counts. It never opens file contents, and its summary is safe to show in
    /// the UI without disclosing protected names or data.
    /// </summary>
    public static WorkspaceTextFileBrowserSnapshot EnumerateTextFileBrowser(IEnumerable<string> selectedFolders)
    {
        ArgumentNullException.ThrowIfNull(selectedFolders);
        var result = new List<WorkspaceTextFileEntry>();
        var protectedFilesSkipped = 0;
        var excludedDirectoriesSkipped = 0;
        var linkedPathsSkipped = 0;
        var hitEntryLimit = false;
        foreach (var selected in selectedFolders)
        {
            if (result.Count >= MaxBrowserTextEntries)
            {
                hitEntryLimit = true;
                break;
            }
            if (string.IsNullOrWhiteSpace(selected)) continue;
            var root = Path.GetFullPath(selected);
            if (!Directory.Exists(root)) continue;
            if (IsLink(root))
            {
                linkedPathsSkipped++;
                continue;
            }
            var pending = new Stack<string>();
            pending.Push(root);
            while (pending.Count > 0 && result.Count < MaxBrowserTextEntries)
            {
                var directory = pending.Pop();
                IEnumerable<string> files;
                try { files = Directory.EnumerateFiles(directory).OrderBy(Path.GetFileName, StringComparer.OrdinalIgnoreCase).ToArray(); }
                catch (IOException) { continue; }
                catch (UnauthorizedAccessException) { continue; }
                foreach (var file in files)
                {
                    if (result.Count >= MaxBrowserTextEntries)
                    {
                        hitEntryLimit = true;
                        break;
                    }
                    if (IsLink(file))
                    {
                        linkedPathsSkipped++;
                        continue;
                    }
                    var name = Path.GetFileName(file);
                    if (IsExcludedFile(name))
                    {
                        protectedFilesSkipped++;
                        continue;
                    }
                    if (!TextExtensions.Contains(Path.GetExtension(file))) continue;
                    try { result.Add(new WorkspaceTextFileEntry(Path.GetRelativePath(root, file), Path.GetFullPath(file), new FileInfo(file).Length)); }
                    catch (IOException) { }
                    catch (UnauthorizedAccessException) { }
                }
                try
                {
                    foreach (var child in Directory.EnumerateDirectories(directory).OrderByDescending(Path.GetFileName, StringComparer.OrdinalIgnoreCase))
                    {
                        if (IsLink(child))
                        {
                            linkedPathsSkipped++;
                            continue;
                        }
                        if (ExcludedDirectories.Contains(Path.GetFileName(child)))
                        {
                            excludedDirectoriesSkipped++;
                            continue;
                        }
                        pending.Push(child);
                    }
                }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
            }
            if (result.Count >= MaxBrowserTextEntries) hitEntryLimit = true;
        }
        return new WorkspaceTextFileBrowserSnapshot(result, protectedFilesSkipped, excludedDirectoriesSkipped, linkedPathsSkipped, hitEntryLimit);
    }

    public static IReadOnlyList<WorkspaceFileEntry> EnumeratePreviewableFiles(IEnumerable<string> selectedFolders, bool includeText = true)
    {
        ArgumentNullException.ThrowIfNull(selectedFolders);
        var result = new List<WorkspaceFileEntry>();
        foreach (var selected in selectedFolders)
        {
            if (result.Count >= MaxPreviewEntries || string.IsNullOrWhiteSpace(selected)) break;
            var root = Path.GetFullPath(selected);
            if (!Directory.Exists(root) || IsLink(root)) continue;
            var pending = new Stack<string>();
            pending.Push(root);
            while (pending.Count > 0 && result.Count < MaxPreviewEntries)
            {
                var directory = pending.Pop();
                IEnumerable<string> files;
                try { files = Directory.EnumerateFiles(directory).OrderBy(Path.GetFileName, StringComparer.OrdinalIgnoreCase).ToArray(); }
                catch (IOException) { continue; }
                catch (UnauthorizedAccessException) { continue; }
                foreach (var file in files)
                {
                    if (result.Count >= MaxPreviewEntries || IsLink(file)) continue;
                    var name = Path.GetFileName(file);
                    if (IsExcludedFile(name)) continue;
                    var kind = includeText && ChatAttachmentPolicy.IsAllowedTextName(name) ? "text"
                        : ChatAttachmentPolicy.GetImageMediaType(name) is not null ? "image"
                        : ChatAttachmentPolicy.IsAllowedPdfName(name) ? "pdf"
                        : null;
                    if (kind is null) continue;
                    try
                    {
                        var length = new FileInfo(file).Length;
                        var maxBytes = kind == "pdf" ? ChatAttachmentPolicy.MaxPdfBytes : kind == "image" ? ChatAttachmentPolicy.MaxFileBytes : MaxFileCharacters * 4L;
                        if (length > maxBytes) continue;
                        result.Add(new WorkspaceFileEntry(Path.GetRelativePath(root, file), Path.GetFullPath(file), kind, length));
                    }
                    catch (IOException) { }
                    catch (UnauthorizedAccessException) { }
                }
                try
                {
                    foreach (var child in Directory.EnumerateDirectories(directory).OrderByDescending(Path.GetFileName, StringComparer.OrdinalIgnoreCase))
                    {
                        if (!ExcludedDirectories.Contains(Path.GetFileName(child)) && !IsLink(child)) pending.Push(child);
                    }
                }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
            }
        }
        return result;
    }

    /// <summary>Reads one enumerated image/PDF preview after rechecking workspace containment and reparse-point boundaries.</summary>
    public static (WorkspaceFileEntry Entry, byte[] Content) ReadPreviewableFile(IEnumerable<string> selectedFolders, string relativePath)
    {
        ArgumentNullException.ThrowIfNull(selectedFolders);
        if (string.IsNullOrWhiteSpace(relativePath) || Path.IsPathRooted(relativePath) || relativePath.Contains(':'))
            throw new InvalidOperationException("Only a supported project-relative preview path is allowed.");
        var parts = relativePath.Split([Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar, '/', '\\'], StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0 || parts.Any(part => part is "." or ".." || part.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0))
            throw new InvalidOperationException("The project preview path is invalid.");

        var roots = selectedFolders.Where(path => !string.IsNullOrWhiteSpace(path)).Select(Path.GetFullPath).ToArray();
        var requested = relativePath.Replace('\\', '/');
        var comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
        var entry = EnumeratePreviewableFiles(roots, includeText: false).FirstOrDefault(file =>
            string.Equals(file.RelativePath.Replace('\\', '/'), requested, comparison));
        if (entry is null) throw new FileNotFoundException("The selected project preview is unavailable or protected.");

        var root = roots.FirstOrDefault(candidate =>
        {
            var fullPath = Path.GetFullPath(Path.Combine(candidate, Path.Combine(parts)));
            return string.Equals(fullPath, entry.FullPath, OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal);
        });
        if (root is null) throw new FileNotFoundException("The selected project preview is outside its connected folders.");
        EnsureNoLinksInPath(root, entry.FullPath);

        var maxBytes = entry.Kind == "pdf" ? ChatAttachmentPolicy.MaxPdfBytes : ChatAttachmentPolicy.MaxFileBytes;
        using var stream = new FileStream(entry.FullPath, FileMode.Open, FileAccess.Read, FileShare.Read, 64 * 1024, FileOptions.SequentialScan);
        if (stream.Length > maxBytes || stream.Length > int.MaxValue) throw new InvalidDataException("The project preview exceeds its size limit.");
        var content = new byte[(int)stream.Length];
        var offset = 0;
        while (offset < content.Length)
        {
            var read = stream.Read(content, offset, content.Length - offset);
            if (read == 0) throw new IOException("The project preview changed while it was being read.");
            offset += read;
        }
        if (stream.ReadByte() != -1) throw new IOException("The project preview changed while it was being read.");
        EnsureNoLinksInPath(root, entry.FullPath);
        return (entry, content);
    }

    private static void EnsureNoLinksInPath(string root, string target)
    {
        var fullRoot = Path.GetFullPath(root);
        var fullTarget = Path.GetFullPath(target);
        var relative = Path.GetRelativePath(fullRoot, fullTarget);
        if (Path.IsPathRooted(relative) || relative == ".." || relative.StartsWith(".." + Path.DirectorySeparatorChar, StringComparison.Ordinal))
            throw new InvalidOperationException("The project preview path leaves its connected folder.");
        var current = fullRoot;
        if (IsLink(current)) throw new IOException("Linked project folders cannot be previewed.");
        var segments = relative.Split([Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar], StringSplitOptions.RemoveEmptyEntries);
        for (var index = 0; index < segments.Length; index++)
        {
            current = Path.Combine(current, segments[index]);
            if (IsLink(current)) throw new IOException("Linked project paths cannot be previewed.");
            if (index < segments.Length - 1 && !Directory.Exists(current))
                throw new DirectoryNotFoundException("The project preview folder is unavailable.");
        }
    }

    private static bool IsLink(string path)
    {
        try { return (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0; }
        catch (IOException) { return true; }
        catch (UnauthorizedAccessException) { return true; }
    }

    private static bool IsExcludedFile(string name) =>
        ExcludedFiles.Contains(name) ||
        (name.StartsWith(".env", StringComparison.OrdinalIgnoreCase) &&
         !string.Equals(name, ".env.example", StringComparison.OrdinalIgnoreCase));
}
