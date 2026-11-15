using System.IO.Compression;
using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using SkaiDesktop.Core.Infrastructure;

namespace SkaiDesktop.Core.Services;

public sealed record OpenAiPluginMarketplace(string Name, string Publisher, string Repository, string RefreshedAtUtc, IReadOnlyList<OpenAiPluginListing> Plugins);
public sealed record OpenAiPluginListing(string Id, string Name, string Category, string Description, string LongDescription, string Publisher, string Version, IReadOnlyList<string> Capabilities, IReadOnlyList<string> Products, string Authentication, string SourceRef, string Repository, string PackagePath, string SourceUrl, string WebsiteUrl, string PrivacyUrl, string TermsUrl);
public sealed record OpenAiPluginDownload(string Id, string Name, string FileName, string FilePath, string Sha256, long SizeBytes, int FileCount, string SourceRef);

/// <summary>Lists OpenAI's pinned Codex marketplace snapshot and downloads one plugin package without executing it.</summary>
public sealed class OpenAiPluginMarketplaceService
{
    private const string ResourceName = "SkaiDesktop.Core.Data.openai-plugin-marketplace.json";
    private const string Repository = "openai/plugins";
    private const int MaxFiles = 1024;
    private const int MaxFileBytes = 8 * 1024 * 1024;
    private const long MaxPackageBytes = 32 * 1024 * 1024;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { MaxDepth = 20 };
    private static readonly HttpClient SharedHttp = CreateHttpClient();
    private static readonly Lazy<OpenAiPluginMarketplace> CachedCatalog = new(LoadCatalog);
    private readonly HttpClient _http;

    public OpenAiPluginMarketplaceService(HttpClient? httpClient = null) => _http = httpClient ?? SharedHttp;

    public OpenAiPluginMarketplace List() => CachedCatalog.Value;

    public async Task<OpenAiPluginDownload> DownloadAsync(string pluginId, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(pluginId) || pluginId.Length > 80 || pluginId.Any(ch => !(char.IsAsciiLetterOrDigit(ch) || ch is '-' or '_' or '.')))
            throw new InvalidDataException("The plugin ID is invalid.");
        var plugin = List().Plugins.SingleOrDefault(item => item.Id.Equals(pluginId, StringComparison.OrdinalIgnoreCase))
            ?? throw new KeyNotFoundException("That plugin is not present in the pinned OpenAI catalog.");
        if (!plugin.Repository.Equals("https://github.com/openai/plugins", StringComparison.Ordinal) ||
            !plugin.SourceRef.All(Uri.IsHexDigit) || plugin.SourceRef.Length != 40 ||
            !plugin.PackagePath.Equals($"plugins/{plugin.Id}", StringComparison.Ordinal))
            throw new InvalidDataException("The plugin source is not a pinned OpenAI marketplace package.");

        using var treeResponse = await _http.GetAsync($"https://api.github.com/repos/{Repository}/git/trees/{plugin.SourceRef}?recursive=1", HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
        treeResponse.EnsureSuccessStatusCode();
        using var tree = await BoundedHttpContent.ReadJsonAsync(treeResponse.Content, cancellationToken, "OpenAI plugin source tree").ConfigureAwait(false);
        if (tree.RootElement.TryGetProperty("truncated", out var truncated) && truncated.ValueKind == JsonValueKind.True)
            throw new InvalidDataException("The pinned plugin source tree is incomplete.");
        if (!tree.RootElement.TryGetProperty("tree", out var treeItems) || treeItems.ValueKind != JsonValueKind.Array)
            throw new InvalidDataException("The pinned plugin source tree is invalid.");

        var prefix = plugin.PackagePath + "/";
        var files = treeItems.EnumerateArray()
            .Where(item => item.TryGetProperty("type", out var type) && type.GetString() == "blob" && item.TryGetProperty("path", out var path) && path.GetString()?.StartsWith(prefix, StringComparison.Ordinal) == true)
            .Select(item => new TreeFile(
                item.GetProperty("path").GetString()!,
                item.GetProperty("sha").GetString()!,
                item.TryGetProperty("size", out var size) ? size.GetInt64() : -1,
                item.TryGetProperty("mode", out var mode) ? mode.GetString() ?? "" : ""))
            .OrderBy(item => item.Path, StringComparer.Ordinal)
            .ToArray();
        if (files.Length == 0 || files.Length > MaxFiles) throw new InvalidDataException($"The plugin package must contain between 1 and {MaxFiles} files.");
        if (files.Any(file => file.Mode == "120000" || !IsSafeRelativePath(file.Path[prefix.Length..]) || file.Size < 0 || file.Size > MaxFileBytes))
            throw new InvalidDataException("The plugin package contains a link, unsafe path, or oversized file.");
        if (files.Sum(file => file.Size) > MaxPackageBytes) throw new InvalidDataException("The plugin package exceeds the 32 MB download limit.");

        var configuredDownloadsDirectory = Environment.GetEnvironmentVariable("SKAI_PLUGIN_DOWNLOADS");
        var downloadsDirectory = string.IsNullOrWhiteSpace(configuredDownloadsDirectory)
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile, Environment.SpecialFolderOption.Create), "Downloads", "Skai Plugins")
            : Path.GetFullPath(configuredDownloadsDirectory);
        Directory.CreateDirectory(downloadsDirectory);
        var safeVersion = string.Concat(plugin.Version.Select(ch => char.IsAsciiLetterOrDigit(ch) || ch is '.' or '-' or '_' ? ch : '-'));
        var baseName = $"{plugin.Id}-{safeVersion}";
        var outputPath = Path.Combine(downloadsDirectory, baseName + ".zip");
        for (var suffix = 2; File.Exists(outputPath); suffix++) outputPath = Path.Combine(downloadsDirectory, $"{baseName}-{suffix}.zip");
        var stagedPath = outputPath + "." + Guid.NewGuid().ToString("N") + ".tmp";
        var fileHashes = new SortedDictionary<string, string>(StringComparer.Ordinal);
        var downloadedFiles = new ConcurrentDictionary<string, byte[]>(StringComparer.Ordinal);
        long downloadedBytes = 0;
        await Parallel.ForEachAsync(files, new ParallelOptions { MaxDegreeOfParallelism = 8, CancellationToken = cancellationToken }, async (file, token) =>
        {
            var relativePath = file.Path[prefix.Length..];
            var rawPath = string.Join('/', file.Path.Split('/').Select(Uri.EscapeDataString));
            using var response = await _http.GetAsync($"https://raw.githubusercontent.com/{Repository}/{plugin.SourceRef}/{rawPath}", HttpCompletionOption.ResponseHeadersRead, token).ConfigureAwait(false);
            response.EnsureSuccessStatusCode();
            var bytes = await BoundedHttpContent.ReadBytesAsync(response.Content, MaxFileBytes, token, $"Plugin file {relativePath}").ConfigureAwait(false);
            if (bytes.LongLength != file.Size || !ComputeGitBlobSha(bytes).Equals(file.GitSha, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException($"Plugin file integrity validation failed: {relativePath}");
            if (Interlocked.Add(ref downloadedBytes, bytes.LongLength) > MaxPackageBytes)
                throw new InvalidDataException("The downloaded plugin package exceeds the 32 MB limit.");
            if (!downloadedFiles.TryAdd(relativePath, bytes)) throw new InvalidDataException("The plugin source tree contains duplicate file paths.");
            lock (fileHashes) fileHashes[relativePath] = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        }).ConfigureAwait(false);
        try
        {
            await using (var output = new FileStream(stagedPath, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None, 64 * 1024, useAsync: true))
            using (var archive = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true))
            {
                foreach (var file in files)
                {
                    var relativePath = file.Path[prefix.Length..];
                    var bytes = downloadedFiles[relativePath];
                    var entry = archive.CreateEntry($"plugins/{plugin.Id}/{relativePath}", CompressionLevel.Optimal);
                    await using var destination = entry.Open();
                    await destination.WriteAsync(bytes, cancellationToken).ConfigureAwait(false);
                }

                var integrity = JsonSerializer.SerializeToUtf8Bytes(new
                {
                    plugin = plugin.Id,
                    version = plugin.Version,
                    repository = plugin.Repository,
                    commit = plugin.SourceRef,
                    algorithm = "sha256",
                    fileCount = fileHashes.Count,
                    files = fileHashes,
                }, JsonOptions);
                var integrityEntry = archive.CreateEntry($"plugins/{plugin.Id}/SKAI-INTEGRITY.json", CompressionLevel.Optimal);
                await using var integrityStream = integrityEntry.Open();
                await integrityStream.WriteAsync(integrity, cancellationToken).ConfigureAwait(false);

                var localMarketplace = JsonSerializer.SerializeToUtf8Bytes(new
                {
                    name = $"skai-{plugin.Id}",
                    @interface = new { displayName = $"Skai · {plugin.Name}" },
                    plugins = new[]
                    {
                        new
                        {
                            name = plugin.Id,
                            source = new { source = "local", path = $"./plugins/{plugin.Id}" },
                            policy = new { installation = "AVAILABLE", authentication = plugin.Authentication },
                            category = plugin.Category,
                        },
                    },
                }, JsonOptions);
                var marketplaceEntry = archive.CreateEntry(".agents/plugins/marketplace.json", CompressionLevel.Optimal);
                await using var marketplaceStream = marketplaceEntry.Open();
                await marketplaceStream.WriteAsync(localMarketplace, cancellationToken).ConfigureAwait(false);

                var instructions = Encoding.UTF8.GetBytes($"{plugin.Name} plugin package\n\nExtract this ZIP to a folder, then add the extracted folder as a local plugin marketplace in Codex or ChatGPT desktop. Review the included plugin manifest, capabilities, and authentication policy before enabling it.\n\nSource: {plugin.Repository}/tree/{plugin.SourceRef}/{plugin.PackagePath}\nPinned commit: {plugin.SourceRef}\nAuthentication: {plugin.Authentication}\n\nSkai downloaded and integrity-checked these files. Skai does not execute plugin package code.\n");
                var readmeEntry = archive.CreateEntry("SKAI-README.txt", CompressionLevel.Optimal);
                await using var readmeStream = readmeEntry.Open();
                await readmeStream.WriteAsync(instructions, cancellationToken).ConfigureAwait(false);
            }
            byte[] digest;
            long archiveSize;
            await using (var input = new FileStream(stagedPath, FileMode.Open, FileAccess.Read, FileShare.Read, 64 * 1024, useAsync: true))
            {
                digest = await SHA256.HashDataAsync(input, cancellationToken).ConfigureAwait(false);
                archiveSize = input.Length;
            }
            File.Move(stagedPath, outputPath);
            return new(plugin.Id, plugin.Name, Path.GetFileName(outputPath), outputPath, Convert.ToHexString(digest).ToLowerInvariant(), archiveSize, fileHashes.Count, plugin.SourceRef);
        }
        finally
        {
            if (File.Exists(stagedPath)) File.Delete(stagedPath);
        }
    }

    private static OpenAiPluginMarketplace LoadCatalog()
    {
        using var stream = typeof(OpenAiPluginMarketplaceService).Assembly.GetManifestResourceStream(ResourceName)
            ?? throw new InvalidDataException("The bundled OpenAI plugin catalog is missing.");
        return JsonSerializer.Deserialize<OpenAiPluginMarketplace>(stream, JsonOptions)
            ?? throw new InvalidDataException("The bundled OpenAI plugin catalog is invalid.");
    }

    private static HttpClient CreateHttpClient()
    {
        var client = new HttpClient(new SocketsHttpHandler { MaxConnectionsPerServer = 8 }) { Timeout = TimeSpan.FromSeconds(30) };
        client.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("SkaiDesktop", "1.0"));
        client.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
        return client;
    }

    private static string ComputeGitBlobSha(byte[] bytes)
    {
        var header = Encoding.ASCII.GetBytes($"blob {bytes.Length}\0");
        var payload = new byte[header.Length + bytes.Length];
        Buffer.BlockCopy(header, 0, payload, 0, header.Length);
        Buffer.BlockCopy(bytes, 0, payload, header.Length, bytes.Length);
        return Convert.ToHexString(SHA1.HashData(payload)).ToLowerInvariant();
    }

    private static bool IsSafeRelativePath(string path) =>
        !string.IsNullOrWhiteSpace(path) && path.Length <= 512 && !Path.IsPathRooted(path) &&
        path.Split('/').All(part => part.Length > 0 && part is not "." and not ".." && !part.Any(char.IsControl));

    private sealed record TreeFile(string Path, string GitSha, long Size, string Mode);
}
