using System.Diagnostics;
using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;

namespace SkaiDesktop.Core.Services;

public sealed record WorkspaceGlbArtifact(string RelativePath, string Sha256, long Bytes);

/// <summary>Stores and validates GLB artifacts inside a selected workspace.</summary>
public sealed class WorkspaceGlbArtifactService
{
    public const int MaxGlbBytes = 100 * 1024 * 1024;

    public WorkspaceGlbArtifact Save(string workspaceRoot, string relativePath, byte[] content)
    {
        ArgumentNullException.ThrowIfNull(content);
        if (content.Length is < 12 or > MaxGlbBytes || !HasValidGlbHeader(content))
            throw new InvalidDataException("The generated file is not a valid GLB within the 100 MB limit.");
        var root = ValidateRoot(workspaceRoot);
        var target = ResolveOutputPath(root, relativePath);
        EnsureNoLinks(root, target);
        if (File.Exists(target)) throw new IOException("The asset output already exists; choose a new file name to preserve existing work.");
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);
        EnsureNoLinks(root, target);
        using (var stream = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            stream.Write(content);
        return new WorkspaceGlbArtifact(Path.GetRelativePath(root, target), Convert.ToHexString(SHA256.HashData(content)).ToLowerInvariant(), content.LongLength);
    }

    public static string ResolveInput(string workspaceRoot, string relativePath)
    {
        var root = ValidateRoot(workspaceRoot);
        var path = ResolveOutputPath(root, relativePath);
        EnsureNoLinks(root, path);
        if (!File.Exists(path)) throw new FileNotFoundException("The GLB input does not exist in the selected workspace.");
        var info = new FileInfo(path);
        if (info.Length is < 12 or > MaxGlbBytes) throw new InvalidDataException("The GLB input is outside the supported size limit.");
        using var stream = File.OpenRead(path);
        Span<byte> header = stackalloc byte[12];
        stream.ReadExactly(header);
        if (header[..4].SequenceEqual("glTF"u8) && BitConverter.ToUInt32(header[4..8]) == 2 && BitConverter.ToUInt32(header[8..12]) == info.Length)
            return path;
        throw new InvalidDataException("The input file is not a valid version 2 GLB.");
    }

    public static string ResolveOutput(string workspaceRoot, string relativePath)
    {
        var root = ValidateRoot(workspaceRoot);
        var path = ResolveOutputPath(root, relativePath);
        EnsureNoLinks(root, path);
        return path;
    }

    public static void ValidateOutput(string workspaceRoot, string relativePath)
    {
        var root = ValidateRoot(workspaceRoot);
        var path = ResolveOutputPath(root, relativePath);
        EnsureNoLinks(root, path);
        if (!File.Exists(path)) throw new InvalidDataException("The rigging tool did not create its output GLB.");
        _ = ResolveInput(root, relativePath);
    }

    private static string ValidateRoot(string workspaceRoot)
    {
        if (string.IsNullOrWhiteSpace(workspaceRoot)) throw new ArgumentException("A workspace root is required.", nameof(workspaceRoot));
        var root = Path.GetFullPath(workspaceRoot);
        if (!Directory.Exists(root) || IsLink(root)) throw new DirectoryNotFoundException("The selected project folder is unavailable or linked.");
        return root;
    }

    private static string ResolveOutputPath(string root, string relativePath)
    {
        if (string.IsNullOrWhiteSpace(relativePath) || Path.IsPathRooted(relativePath) || relativePath.Contains(':') || Path.GetExtension(relativePath) != ".glb")
            throw new InvalidOperationException("Only relative .glb paths are supported for asset files.");
        var pieces = relativePath.Split([Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar], StringSplitOptions.RemoveEmptyEntries);
        if (pieces.Length == 0 || pieces.Any(piece => piece is "." or ".." || piece.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0))
            throw new InvalidOperationException("The asset path is not a valid workspace-relative path.");
        if (pieces.Any(piece => piece.Equals(".git", StringComparison.OrdinalIgnoreCase) || piece.Equals("node_modules", StringComparison.OrdinalIgnoreCase) || piece.StartsWith(".env", StringComparison.OrdinalIgnoreCase)))
            throw new InvalidOperationException("The asset path targets a protected workspace location.");
        var target = Path.GetFullPath(Path.Combine(root, Path.Combine(pieces)));
        var relative = Path.GetRelativePath(root, target);
        if (Path.IsPathRooted(relative) || relative == ".." || relative.StartsWith(".." + Path.DirectorySeparatorChar, StringComparison.Ordinal))
            throw new InvalidOperationException("The asset path leaves the selected workspace.");
        return target;
    }

    private static void EnsureNoLinks(string root, string target)
    {
        var current = root;
        foreach (var piece in Path.GetRelativePath(root, target).Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, piece);
            if ((File.Exists(current) || Directory.Exists(current)) && IsLink(current))
                throw new InvalidOperationException("The asset path contains a symbolic link.");
        }
    }

    private static bool IsLink(string path)
    {
        try { return (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0; }
        catch (IOException) { return true; }
        catch (UnauthorizedAccessException) { return true; }
    }

    private static bool HasValidGlbHeader(ReadOnlySpan<byte> bytes) => bytes.Length >= 12
        && bytes[..4].SequenceEqual("glTF"u8)
        && BinaryPrimitives.ReadUInt32LittleEndian(bytes[4..8]) == 2
        && BinaryPrimitives.ReadUInt32LittleEndian(bytes[8..12]) == bytes.Length;
}

/// <summary>Runs the configured skin-tokens.cpp CLI against GLB files scoped to one workspace.</summary>
public sealed class SkinTokensRiggingService
{
    private const int MaxDiagnosticCharacters = 12_000;

    public async Task<(WorkspaceGlbArtifact Artifact, string Output)> RigAsync(
        string workspaceRoot,
        string inputRelativePath,
        string outputRelativePath,
        string? cliPath = null,
        string? modelDirectory = null,
        CancellationToken cancellationToken = default)
    {
        cliPath ??= Environment.GetEnvironmentVariable("SKAI_SKINTOKENS_CLI");
        modelDirectory ??= Environment.GetEnvironmentVariable("SKAI_SKINTOKENS_MODEL_DIR");
        if (string.IsNullOrWhiteSpace(cliPath) || !File.Exists(cliPath))
            throw new InvalidOperationException("Configure SKAI_SKINTOKENS_CLI with the local skintokens-cli executable.");
        if (string.IsNullOrWhiteSpace(modelDirectory) || !Directory.Exists(modelDirectory))
            throw new InvalidOperationException("Configure SKAI_SKINTOKENS_MODEL_DIR with the local F16 SkinTokens model directory.");

        var input = WorkspaceGlbArtifactService.ResolveInput(workspaceRoot, inputRelativePath);
        var output = WorkspaceGlbArtifactService.ResolveOutput(workspaceRoot, outputRelativePath);
        if (File.Exists(output)) throw new IOException("The rigged output already exists; choose a new file name.");
        Directory.CreateDirectory(Path.GetDirectoryName(output)!);
        var start = new ProcessStartInfo
        {
            FileName = Path.GetFullPath(cliPath),
            WorkingDirectory = Path.GetFullPath(workspaceRoot),
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        start.ArgumentList.Add("rig");
        start.ArgumentList.Add(Path.GetFullPath(modelDirectory));
        start.ArgumentList.Add(input);
        start.ArgumentList.Add(output);
        start.ArgumentList.Add("--device");
        start.ArgumentList.Add("cpu");

        using var process = new Process { StartInfo = start, EnableRaisingEvents = true };
        if (!process.Start()) throw new InvalidOperationException("The SkinTokens rigging process did not start.");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromMinutes(30));
        var stdout = ReadBoundedAsync(process.StandardOutput, timeout.Token);
        var stderr = ReadBoundedAsync(process.StandardError, timeout.Token);
        try { await process.WaitForExitAsync(timeout.Token).ConfigureAwait(false); }
        catch (OperationCanceledException)
        {
            try { process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
            if (!cancellationToken.IsCancellationRequested) throw new TimeoutException("SkinTokens rigging exceeded the 30 minute limit.");
            throw;
        }
        var diagnostics = (await stdout.ConfigureAwait(false) + "\n" + await stderr.ConfigureAwait(false)).Trim();
        if (diagnostics.Length > MaxDiagnosticCharacters) diagnostics = diagnostics[..MaxDiagnosticCharacters];
        if (process.ExitCode != 0) throw new InvalidOperationException($"SkinTokens exited with code {process.ExitCode}: {diagnostics}");
        WorkspaceGlbArtifactService.ValidateOutput(workspaceRoot, outputRelativePath);
        var bytes = await File.ReadAllBytesAsync(output, cancellationToken).ConfigureAwait(false);
        var artifact = new WorkspaceGlbArtifact(Path.GetRelativePath(Path.GetFullPath(workspaceRoot), output), Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(), bytes.LongLength);
        return (artifact, diagnostics);
    }

    private static async Task<string> ReadBoundedAsync(StreamReader reader, CancellationToken cancellationToken)
    {
        var result = new StringBuilder();
        var buffer = new char[1024];
        while (true)
        {
            var read = await reader.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
            if (read == 0) break;
            if (result.Length < MaxDiagnosticCharacters)
                result.Append(buffer, 0, Math.Min(read, MaxDiagnosticCharacters - result.Length));
        }
        return result.ToString();
    }
}
