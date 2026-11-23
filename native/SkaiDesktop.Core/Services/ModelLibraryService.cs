// Model Library back end: finds installed models on known local runtimes
// (Ollama, LM Studio, …), searches Hugging Face and ModelScope, downloads/imports GGUF files, and
// pulls/deletes Ollama models.
// Depends on: HttpClient, BoundedHttpContent (size-limited responses).
// Used by: the Agent Host model library and model-selection protocol.

using System.Net.Http.Json;
using System.Text.Json;
using SkaiDesktop.Core.Infrastructure;
using SkaiDesktop.Core.Models;

namespace SkaiDesktop.Core.Services;

/// <summary>Catalog and installation adapters for chat-ready local model runtimes.</summary>
public sealed partial class ModelLibraryService(HttpClient? httpClient = null, string? modelScopeDownloadDirectory = null)
{
    private const int MaxModelIdentifierLength = 512;
    private const int MaxCatalogQueryLength = 256;
    private static readonly HttpClient SharedHttp = new() { Timeout = Timeout.InfiniteTimeSpan };
    private static readonly (string Provider, string Endpoint)[] LocalHosts =
    [
        ("Ollama", "http://127.0.0.1:11434/v1"),
        ("GPT4All", "http://127.0.0.1:4891/v1"),
        ("LM Studio", "http://127.0.0.1:1234/v1"),
        ("Jan", "http://127.0.0.1:1337/v1"),
        ("LocalAI / llama.cpp", "http://127.0.0.1:8080/v1"),
        ("vLLM", "http://127.0.0.1:8000/v1"),
        ("KoboldCpp", "http://127.0.0.1:5001/v1"),
        ("Text Generation WebUI", "http://127.0.0.1:5000/v1")
    ];
    private readonly HttpClient _http = httpClient ?? SharedHttp;
    private readonly string _modelScopeDownloadDirectory = string.IsNullOrWhiteSpace(modelScopeDownloadDirectory)
        ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData, Environment.SpecialFolderOption.Create), "Skai", "Marketplace", "ModelScope")
        : Path.GetFullPath(modelScopeDownloadDirectory);

    public async Task<IReadOnlyList<InstalledLocalModel>> DiscoverLocalModelsAsync(
        string configuredEndpoint,
        CancellationToken cancellationToken = default,
        bool includeHuggingFaceCache = true)
    {
        var targets = LocalHosts.ToList();
        if (IsLoopbackEndpoint(configuredEndpoint) && !targets.Any(target => SameHost(target.Endpoint, configuredEndpoint)))
            targets.Add(("Current local endpoint", NormalizeModelsEndpoint(configuredEndpoint)));
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(5));
        var results = await Task.WhenAll(targets.Select(async target =>
        {
            try
            {
                if (target.Provider == "Ollama") return await DiscoverOllamaModelsAsync(target.Endpoint, timeout.Token);
                if (target.Provider == "LM Studio") return await DiscoverLmStudioModelsAsync(target.Endpoint, timeout.Token);
                var uri = BuildModelsUri(target.Endpoint);
                using var response = await _http.GetAsync(uri, timeout.Token);
                if (!response.IsSuccessStatusCode) return Array.Empty<InstalledLocalModel>();
                using var json = await BoundedHttpContent.ReadJsonAsync(response.Content, timeout.Token, "Local model response");
                if (!json.RootElement.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Array)
                    return Array.Empty<InstalledLocalModel>();
                return data.EnumerateArray()
                    .Where(item => item.TryGetProperty("id", out _))
                    .Select(item => item.GetProperty("id").GetString())
                    .Where(IsSafeCatalogIdentifier)
                    .Select(id => new InstalledLocalModel(target.Provider, id!, target.Endpoint))
                    .ToArray();
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { return Array.Empty<InstalledLocalModel>(); }
            catch (HttpRequestException) { return Array.Empty<InstalledLocalModel>(); }
            catch (JsonException) { return Array.Empty<InstalledLocalModel>(); }
            // A local port may be occupied by an unrelated or unhealthy service.
            // Inventory discovery is best-effort, so a bounded-body failure from one
            // runtime must not hide models served by every other local runtime.
            catch (InvalidDataException) { return Array.Empty<InstalledLocalModel>(); }
        }));
        var cacheModels = includeHuggingFaceCache ? DiscoverHuggingFaceCacheModels() : Array.Empty<InstalledLocalModel>();
        return results.SelectMany(models => models).Concat(cacheModels)
            .DistinctBy(model => (model.Model, model.Endpoint), StringTupleComparer.Instance)
            .OrderBy(model => model.Provider, StringComparer.OrdinalIgnoreCase)
            .ThenBy(model => model.Model, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static IReadOnlyList<InstalledLocalModel> DiscoverHuggingFaceCacheModels()
    {
        var profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var cacheHome = Environment.GetEnvironmentVariable("HF_HOME");
        var xdgCache = Environment.GetEnvironmentVariable("XDG_CACHE_HOME");
        var transformersCache = Environment.GetEnvironmentVariable("TRANSFORMERS_CACHE");
        var configuredRoots = new[]
        {
            Environment.GetEnvironmentVariable("HUGGINGFACE_HUB_CACHE"),
            Environment.GetEnvironmentVariable("HF_HUB_CACHE"),
            transformersCache,
            string.IsNullOrWhiteSpace(cacheHome) ? null : Path.Combine(cacheHome, "hub"),
            string.IsNullOrWhiteSpace(xdgCache) ? null : Path.Combine(xdgCache, "huggingface", "hub"),
            Path.Combine(profile, ".cache", "huggingface", "hub"),
            Path.Combine(localAppData, "huggingface", "hub"),
        }.Where(path => !string.IsNullOrWhiteSpace(path));
        var roots = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var path in configuredRoots)
        {
            try { roots.Add(Path.GetFullPath(path!)); }
            catch (ArgumentException) { }
            catch (PathTooLongException) { }
            catch (NotSupportedException) { }
        }
        var found = new List<InstalledLocalModel>();
        foreach (var root in roots)
        {
            try
            {
                if (!Directory.Exists(root) || (File.GetAttributes(root) & FileAttributes.ReparsePoint) != 0) continue;
                foreach (var repositoryPath in Directory.EnumerateDirectories(root, "models--*", SearchOption.TopDirectoryOnly))
                {
                    try
                    {
                        if ((File.GetAttributes(repositoryPath) & FileAttributes.ReparsePoint) != 0) continue;
                        var repositoryFolder = Path.GetFileName(repositoryPath);
                        var modelId = repositoryFolder["models--".Length..].Replace("--", "/", StringComparison.Ordinal);
                        if (!IsSafeCatalogIdentifier(modelId) || !modelId.Contains('/')) continue;
                        var snapshotsRoot = Path.GetFullPath(Path.Combine(repositoryPath, "snapshots"));
                        var snapshotPrefix = snapshotsRoot + Path.DirectorySeparatorChar;
                        if (!Directory.Exists(snapshotsRoot) || (File.GetAttributes(snapshotsRoot) & FileAttributes.ReparsePoint) != 0) continue;
                        var usableSnapshot = Directory.EnumerateDirectories(snapshotsRoot, "*", SearchOption.TopDirectoryOnly)
                            .Select(Path.GetFullPath)
                            .Any(snapshotPath => snapshotPath.StartsWith(snapshotPrefix, StringComparison.OrdinalIgnoreCase)
                                && (File.GetAttributes(snapshotPath) & FileAttributes.ReparsePoint) == 0
                                && File.Exists(Path.Combine(snapshotPath, "config.json"))
                                && (Directory.EnumerateFiles(snapshotPath, "*.safetensors", SearchOption.TopDirectoryOnly).Any()
                                    || Directory.EnumerateFiles(snapshotPath, "*.bin", SearchOption.TopDirectoryOnly).Any()
                                    || Directory.EnumerateFiles(snapshotPath, "*.pt", SearchOption.TopDirectoryOnly).Any()));
                        if (!usableSnapshot) continue;
                        found.Add(new InstalledLocalModel("AirLLM", modelId, string.Empty, "Hugging Face cache", null, true));
                    }
                    catch (IOException) { }
                    catch (UnauthorizedAccessException) { }
                }
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
        return found;
    }

    public async Task<IReadOnlyDictionary<string, int?>> DiscoverOllamaContextLengthsAsync(string endpoint, IEnumerable<string> modelNames, CancellationToken cancellationToken = default)
    {
        if (!IsLoopbackEndpoint(endpoint)) throw new InvalidOperationException("Ollama model metadata can be read only from a local endpoint.");
        var names = modelNames.Where(IsSafeCatalogIdentifier).Distinct(StringComparer.OrdinalIgnoreCase).Take(64).ToArray();
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(5));
        using var parallelism = new SemaphoreSlim(4, 4);
        var contexts = await Task.WhenAll(names.Select(async name =>
        {
            await parallelism.WaitAsync(timeout.Token).ConfigureAwait(false);
            try { return (Name: name, Length: await DiscoverOllamaContextLengthAsync(NormalizeModelsEndpoint(endpoint), name, timeout.Token).ConfigureAwait(false)); }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { return (Name: name, Length: (int?)null); }
            catch (HttpRequestException) { return (Name: name, Length: (int?)null); }
            catch (JsonException) { return (Name: name, Length: (int?)null); }
            catch (InvalidDataException) { return (Name: name, Length: (int?)null); }
            finally { parallelism.Release(); }
        })).ConfigureAwait(false);
        return contexts.ToDictionary(item => item.Name, item => item.Length, StringComparer.OrdinalIgnoreCase);
    }

    private async Task<InstalledLocalModel[]> DiscoverOllamaModelsAsync(string endpoint, CancellationToken cancellationToken)
    {
        var root = new Uri(endpoint);
        var tagsUri = new UriBuilder(root) { Path = "/api/tags", Query = "", Fragment = "" }.Uri;
        using var response = await _http.GetAsync(tagsUri, cancellationToken);
        if (!response.IsSuccessStatusCode) return [];
        using var json = await BoundedHttpContent.ReadJsonAsync(response.Content, cancellationToken, "Local model inventory response");
        if (!json.RootElement.TryGetProperty("models", out var models) || models.ValueKind != JsonValueKind.Array) return [];
        var installed = models.EnumerateArray()
            .Where(item => item.TryGetProperty("name", out _))
            .Select(item =>
            {
                var model = item.GetProperty("name").GetString() ?? "";
                return new InstalledLocalModel(
                    "Ollama",
                    model,
                    endpoint,
                    ModelDisplayNameFormatter.Format(model),
                    item.TryGetProperty("size", out var size) && size.TryGetInt64(out var bytes) ? bytes : null,
                    null);
            })
            .Where(model => IsSafeCatalogIdentifier(model.Model))
            .ToArray();
        // Ollama's tags endpoint does not include a model's training context.
        // Ask /api/show for a bounded number of installed models so the UI can
        // distinguish a known 1M-capable model from an unknown or smaller one.
        using var parallelism = new SemaphoreSlim(4, 4);
        var inspected = await Task.WhenAll(installed.Take(64).Select(async model =>
        {
            await parallelism.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                var contextLength = await DiscoverOllamaContextLengthAsync(endpoint, model.Model, cancellationToken).ConfigureAwait(false);
                return model with { ContextLength = contextLength };
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { return model; }
            catch (HttpRequestException) { return model; }
            catch (JsonException) { return model; }
            catch (InvalidDataException) { return model; }
            finally { parallelism.Release(); }
        })).ConfigureAwait(false);
        var remainder = installed.Length > 64 ? installed[64..] : Array.Empty<InstalledLocalModel>();
        return inspected.Concat(remainder).ToArray();
    }

    private async Task<int?> DiscoverOllamaContextLengthAsync(string endpoint, string model, CancellationToken cancellationToken)
    {
        var root = new Uri(endpoint);
        var showUri = new UriBuilder(root) { Path = "/api/show", Query = "", Fragment = "" }.Uri;
        using var response = await _http.PostAsJsonAsync(showUri, new { name = model }, cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode) return null;
        using var json = await BoundedHttpContent.ReadJsonAsync(response.Content, cancellationToken, "Ollama model metadata").ConfigureAwait(false);
        if (!json.RootElement.TryGetProperty("model_info", out var info) || info.ValueKind != JsonValueKind.Object) return null;
        return FindContextLength(info);
    }

    private static int? FindContextLength(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in element.EnumerateObject())
            {
                if ((property.Name.Equals("context_length", StringComparison.OrdinalIgnoreCase) || property.Name.EndsWith(".context_length", StringComparison.OrdinalIgnoreCase))
                    && property.Value.TryGetInt32(out var contextLength) && contextLength > 0)
                    return contextLength;
                var nested = FindContextLength(property.Value);
                if (nested.HasValue) return nested;
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
        {
            foreach (var child in element.EnumerateArray())
            {
                var nested = FindContextLength(child);
                if (nested.HasValue) return nested;
            }
        }
        return null;
    }

    private async Task<InstalledLocalModel[]> DiscoverLmStudioModelsAsync(string endpoint, CancellationToken cancellationToken)
    {
        var root = new Uri(endpoint);
        var modelsUri = new UriBuilder(root) { Path = "/api/v1/models", Query = "", Fragment = "" }.Uri;
        using var response = await _http.GetAsync(modelsUri, cancellationToken);
        if (!response.IsSuccessStatusCode) return [];
        using var json = await BoundedHttpContent.ReadJsonAsync(response.Content, cancellationToken, "Local model metadata response");
        if (!json.RootElement.TryGetProperty("models", out var models) || models.ValueKind != JsonValueKind.Array) return [];
        return models.EnumerateArray()
            .Where(item => item.TryGetProperty("type", out var type) && type.GetString() == "llm" && item.TryGetProperty("key", out _))
            .Select(item => new InstalledLocalModel(
                "LM Studio",
                item.GetProperty("key").GetString() ?? "",
                endpoint,
                item.TryGetProperty("display_name", out var displayName) ? displayName.GetString() : null,
                item.TryGetProperty("size_bytes", out var size) && size.TryGetInt64(out var bytes) ? bytes : null,
                item.TryGetProperty("loaded_instances", out var loaded) && loaded.ValueKind == JsonValueKind.Array ? loaded.GetArrayLength() > 0 : null))
            .Where(model => IsSafeCatalogIdentifier(model.Model))
            .ToArray();
    }

    public async Task EnsureLmStudioModelLoadedAsync(string endpoint, string model, Action<string>? onStatus = null, CancellationToken cancellationToken = default)
    {
        var modelId = ValidateModelIdentifier(model, "LM Studio model");
        if (!Uri.TryCreate(endpoint.Trim().TrimEnd('/'), UriKind.Absolute, out var configured) || !configured.IsLoopback)
            throw new InvalidOperationException("LM Studio model loading is available only from a local LM Studio endpoint.");
        var root = new UriBuilder(configured) { Path = "", Query = "", Fragment = "" }.Uri;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromMinutes(5));
        using (var listResponse = await _http.GetAsync(new Uri(root, "/api/v1/models"), timeout.Token))
        {
            if (!listResponse.IsSuccessStatusCode)
                throw new InvalidOperationException($"Could not check LM Studio model status ({(int)listResponse.StatusCode}). Its REST API may require an API token, which is not configured here.");
            using var list = await BoundedHttpContent.ReadJsonAsync(listResponse.Content, timeout.Token, "Ollama model load response");
            if (list.RootElement.TryGetProperty("models", out var available) && available.ValueKind == JsonValueKind.Array)
            {
                var match = available.EnumerateArray().FirstOrDefault(item => item.TryGetProperty("key", out var key) && key.GetString()?.Equals(modelId, StringComparison.OrdinalIgnoreCase) == true);
                if (match.ValueKind != JsonValueKind.Undefined && match.TryGetProperty("loaded_instances", out var loaded) && loaded.ValueKind == JsonValueKind.Array && loaded.GetArrayLength() > 0) return;
            }
        }
        onStatus?.Invoke($"Loading {modelId} into LM Studio memory… This may take a while for a large model.");
        using var loadResponse = await _http.PostAsJsonAsync(new Uri(root, "/api/v1/models/load"), new { model = modelId }, timeout.Token);
        var body = await BoundedHttpContent.ReadTextAsync(loadResponse.Content, timeout.Token, "Ollama model load response");
        if (!loadResponse.IsSuccessStatusCode)
            throw new InvalidOperationException($"LM Studio could not load {modelId} ({(int)loadResponse.StatusCode}). Check available memory and API authentication. {body}");
    }

    private static bool IsLoopbackEndpoint(string endpoint) =>
        Uri.TryCreate(endpoint.Trim().TrimEnd('/'), UriKind.Absolute, out var uri) &&
        (uri.Scheme is "http" or "https") && uri.IsLoopback && string.IsNullOrEmpty(uri.UserInfo) && string.IsNullOrEmpty(uri.Fragment);

    private static bool SameHost(string left, string right) =>
        Uri.TryCreate(left.Trim().TrimEnd('/'), UriKind.Absolute, out var leftUri) &&
        Uri.TryCreate(right.Trim().TrimEnd('/'), UriKind.Absolute, out var rightUri) &&
        leftUri.Port == rightUri.Port &&
        (leftUri.IsLoopback && rightUri.IsLoopback || leftUri.Host.Equals(rightUri.Host, StringComparison.OrdinalIgnoreCase));

    private static string NormalizeModelsEndpoint(string endpoint)
    {
        var uri = new Uri(endpoint.Trim().TrimEnd('/'));
        var path = uri.AbsolutePath.TrimEnd('/');
        if (path.EndsWith("/chat/completions", StringComparison.OrdinalIgnoreCase)) path = path[..^"/chat/completions".Length];
        if (!path.EndsWith("/v1", StringComparison.OrdinalIgnoreCase)) path += "/v1";
        return new UriBuilder(uri) { Path = path, Query = "", Fragment = "" }.Uri.ToString().TrimEnd('/');
    }

    private static Uri BuildModelsUri(string endpoint)
    {
        var root = new Uri(endpoint.Trim().TrimEnd('/'));
        var path = root.AbsolutePath.TrimEnd('/');
        if (!path.EndsWith("/v1", StringComparison.OrdinalIgnoreCase)) path += "/v1";
        return new UriBuilder(root) { Path = path + "/models", Query = "", Fragment = "" }.Uri;
    }

    private sealed class StringTupleComparer : IEqualityComparer<(string Model, string Endpoint)>
    {
        public static readonly StringTupleComparer Instance = new();
        public bool Equals((string Model, string Endpoint) x, (string Model, string Endpoint) y) =>
            x.Model.Equals(y.Model, StringComparison.OrdinalIgnoreCase) && x.Endpoint.Equals(y.Endpoint, StringComparison.OrdinalIgnoreCase);
        public int GetHashCode((string Model, string Endpoint) value) => HashCode.Combine(
            StringComparer.OrdinalIgnoreCase.GetHashCode(value.Model), StringComparer.OrdinalIgnoreCase.GetHashCode(value.Endpoint));
    }

}

public sealed record HubModel(string Id, long Downloads, int Likes, bool IsUncensored = false, string[]? Tags = null, long? SizeBytes = null, int? ContextLength = null, string? License = null);
public sealed record ModelScopeGgufFile(string Path, long SizeBytes, string? Sha256);
public sealed record ModelScopeGgufPackage(string Repository, string Name, IReadOnlyList<ModelScopeGgufFile> Files, long Downloads, bool IsUncensored = false)
{
    public long SizeBytes => Files.Sum(file => Math.Max(0, file.SizeBytes));
}
public sealed record InstalledLocalModel(string Provider, string Model, string Endpoint, string? DisplayName = null, long? SizeBytes = null, bool? IsLoaded = null, int? ContextLength = null);
