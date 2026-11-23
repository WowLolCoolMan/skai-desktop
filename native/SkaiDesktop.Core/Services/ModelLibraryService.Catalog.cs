using System.Net.Http.Json;
using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using SkaiDesktop.Core.Infrastructure;
using SkaiDesktop.Core.Models;

namespace SkaiDesktop.Core.Services;

/// <summary>Remote model discovery and installation operations for supported local runtimes.</summary>
public sealed partial class ModelLibraryService
{
    public async Task<IReadOnlyList<HubModel>> SearchHuggingFaceAsync(string query, bool uncensored, CancellationToken cancellationToken = default)
    {
        var queryText = ValidateCatalogQuery(query);
        var searchTerms = uncensored
            ? new[] { "uncensored", "abliterated", "abliteration" }
            : new[] { queryText };
        var allModels = new List<HubModel>();
        foreach (var term in searchTerms)
        {
            var searchText = string.Join(' ', new[] { queryText, term }.Where(value => value.Length > 0));
            var uri = new Uri("https://huggingface.co/api/models?" +
                "search=" + Uri.EscapeDataString(searchText) + "&filter=gguf&sort=downloads&direction=-1&limit=50&full=true");
            using var request = new HttpRequestMessage(HttpMethod.Get, uri);
            request.Headers.UserAgent.ParseAdd(ProductIdentity.UserAgent("local model library"));
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(30));
            using var response = await _http.SendAsync(request, timeout.Token);
            response.EnsureSuccessStatusCode();
            using var json = await BoundedHttpContent.ReadJsonAsync(response.Content, timeout.Token, "Model catalog response");
            allModels.AddRange(json.RootElement.EnumerateArray()
            .Where(item => item.TryGetProperty("id", out var modelId) && IsSafeCatalogIdentifier(modelId.GetString()))
            .Select(item =>
            {
                var id = item.TryGetProperty("id", out var modelId) ? modelId.GetString() ?? "" : "";
                var tags = item.TryGetProperty("tags", out var tagElement) && tagElement.ValueKind == JsonValueKind.Array
                    ? tagElement.EnumerateArray().Where(tag => tag.ValueKind == JsonValueKind.String).Select(tag => tag.GetString() ?? "").ToArray()
                    : [];
                var label = IsExplicitUncensoredLabel(id, tags);
                var sizeBytes = item.TryGetProperty("siblings", out var siblings) && siblings.ValueKind == JsonValueKind.Array
                    ? siblings.EnumerateArray()
                        .Where(file => file.TryGetProperty("rfilename", out var name) && name.GetString()?.EndsWith(".gguf", StringComparison.OrdinalIgnoreCase) == true)
                        .Select(file => file.TryGetProperty("size", out var size) && size.TryGetInt64(out var bytes) ? bytes : 0)
                        .Where(bytes => bytes > 0)
                        .Select(bytes => (long?)bytes)
                        .Sum()
                    : null;
                var contextLength = ReadContextLength(item);
                var license = ReadLicense(item, tags);
                return new HubModel(id,
                    item.TryGetProperty("downloads", out var downloads) && downloads.TryGetInt64(out var count) ? count : 0,
                    item.TryGetProperty("likes", out var likes) && likes.TryGetInt32(out var likeCount) ? likeCount : 0,
                    label, tags, sizeBytes, contextLength, license);
            }));
        }
        var filtered = (uncensored ? allModels.Where(model => model.IsUncensored) : allModels.Where(model => !model.IsUncensored));
        return filtered.DistinctBy(model => model.Id, StringComparer.OrdinalIgnoreCase).OrderByDescending(model => model.Downloads).ToArray();
    }

    private static int? ReadContextLength(JsonElement item)
    {
        if (!item.TryGetProperty("config", out var config) || config.ValueKind != JsonValueKind.Object) return null;
        foreach (var name in new[] { "max_position_embeddings", "model_max_length", "max_sequence_length", "seq_length" })
            if (config.TryGetProperty(name, out var value) && value.TryGetInt32(out var length) && length is > 0 and < 10_000_000) return length;
        if (config.TryGetProperty("text_config", out var textConfig) && textConfig.ValueKind == JsonValueKind.Object)
            foreach (var name in new[] { "max_position_embeddings", "model_max_length", "max_sequence_length", "seq_length" })
                if (textConfig.TryGetProperty(name, out var value) && value.TryGetInt32(out var length) && length is > 0 and < 10_000_000) return length;
        return null;
    }

    private static string? ReadLicense(JsonElement item, IEnumerable<string> tags)
    {
        if (item.TryGetProperty("cardData", out var cardData) && cardData.ValueKind == JsonValueKind.Object
            && cardData.TryGetProperty("license", out var license) && license.ValueKind == JsonValueKind.String
            && !string.IsNullOrWhiteSpace(license.GetString()))
            return license.GetString()!.Trim();

        var licenseTag = tags.FirstOrDefault(tag => tag.StartsWith("license:", StringComparison.OrdinalIgnoreCase));
        return licenseTag is null ? null : licenseTag["license:".Length..];
    }

    /// <summary>Finds text-generation repositories with full Transformers weights for the optional AirLLM route.</summary>
    public async Task<IReadOnlyList<HubModel>> SearchHuggingFaceAirLlmAsync(string query, bool uncensored, CancellationToken cancellationToken = default)
    {
        var queryText = ValidateCatalogQuery(query);
        var searchTerms = uncensored ? new[] { "uncensored", "abliterated", "abliteration" } : new[] { queryText };
        var models = new List<HubModel>();
        foreach (var term in searchTerms)
        {
            var searchText = string.Join(' ', new[] { queryText, term }.Where(value => value.Length > 0));
            var uri = new Uri("https://huggingface.co/api/models?pipeline_tag=text-generation&search=" + Uri.EscapeDataString(searchText) + "&sort=downloads&direction=-1&limit=30&full=true");
            using var request = new HttpRequestMessage(HttpMethod.Get, uri);
            request.Headers.UserAgent.ParseAdd(ProductIdentity.UserAgent("local AirLLM model catalog"));
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(30));
            using var response = await _http.SendAsync(request, timeout.Token).ConfigureAwait(false);
            response.EnsureSuccessStatusCode();
            using var json = await BoundedHttpContent.ReadJsonAsync(response.Content, timeout.Token, "AirLLM model catalog response").ConfigureAwait(false);
            foreach (var item in json.RootElement.EnumerateArray())
            {
                if (!item.TryGetProperty("id", out var modelIdElement)) continue;
                var id = modelIdElement.GetString();
                if (!IsSafeCatalogIdentifier(id) || id!.Count(character => character == '/') != 1) continue;
                var tags = item.TryGetProperty("tags", out var tagElement) && tagElement.ValueKind == JsonValueKind.Array
                    ? tagElement.EnumerateArray().Where(tag => tag.ValueKind == JsonValueKind.String).Select(tag => tag.GetString() ?? "").ToArray()
                    : [];
                var isUncensored = IsExplicitUncensoredLabel(id!, tags);
                if (uncensored != isUncensored) continue;
                if (!item.TryGetProperty("siblings", out var siblings) || siblings.ValueKind != JsonValueKind.Array) continue;
                var weightFiles = siblings.EnumerateArray()
                    .Where(file => file.TryGetProperty("rfilename", out var name) && name.GetString() is { } filename
                        && (filename.EndsWith(".safetensors", StringComparison.OrdinalIgnoreCase)
                            || filename.EndsWith(".bin", StringComparison.OrdinalIgnoreCase)
                            || filename.EndsWith(".pt", StringComparison.OrdinalIgnoreCase))
                        && !filename.Contains("adapter_model", StringComparison.OrdinalIgnoreCase))
                    .ToArray();
                if (weightFiles.Length == 0) continue;
                var weightSizes = weightFiles.Select(file => file.TryGetProperty("size", out var size) && size.TryGetInt64(out var bytes) ? bytes : 0).Where(bytes => bytes > 0).ToArray();
                long? sizeBytes = weightSizes.Length > 0 ? weightSizes.Sum() : null;
                if (sizeBytes is null && item.TryGetProperty("usedStorage", out var usedStorage) && usedStorage.TryGetInt64(out var repositorySize) && repositorySize > 0)
                    sizeBytes = repositorySize;
                var downloads = item.TryGetProperty("downloads", out var downloadsElement) && downloadsElement.TryGetInt64(out var count) ? count : 0;
                var likes = item.TryGetProperty("likes", out var likesElement) && likesElement.TryGetInt32(out var likeCount) ? likeCount : 0;
                var contextLength = ReadContextLength(item);
                var license = ReadLicense(item, tags);
                models.Add(new HubModel(id!, downloads, likes, isUncensored, tags, sizeBytes, contextLength, license));
            }
        }
        return models.DistinctBy(model => model.Id, StringComparer.OrdinalIgnoreCase).OrderByDescending(model => model.Downloads).ToArray();
    }

    private static bool IsExplicitUncensoredLabel(string id, IEnumerable<string> tags) =>
        new[] { id }.Concat(tags).Any(value => value.Contains("uncensored", StringComparison.OrdinalIgnoreCase) ||
            value.Contains("abliterat", StringComparison.OrdinalIgnoreCase));

    public async Task<IReadOnlyList<ModelScopeGgufPackage>> SearchModelScopeGgufAsync(string query, bool uncensored, CancellationToken cancellationToken = default)
    {
        var queryText = ValidateCatalogQuery(query);
        var searchTerms = uncensored ? new[] { "uncensored", "abliterated", "abliteration" } : [queryText];
        var repositories = new Dictionary<string, (long Downloads, bool IsUncensored)>(StringComparer.OrdinalIgnoreCase);
        foreach (var term in searchTerms)
        {
            var searchText = string.Join(' ', new[] { queryText, term }.Where(value => value.Length > 0));
            if (searchText.Length == 0) continue;
            var uri = new Uri("https://modelscope.cn/openapi/v1/models?search=" + Uri.EscapeDataString(searchText) + "&sort=downloads&page_size=20");
            using var request = new HttpRequestMessage(HttpMethod.Get, uri);
            request.Headers.UserAgent.ParseAdd(ProductIdentity.UserAgent("local model library"));
            using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            response.EnsureSuccessStatusCode();
            using var json = await BoundedHttpContent.ReadJsonAsync(response.Content, cancellationToken, "ModelScope search response");
            if (!json.RootElement.TryGetProperty("data", out var data) || !data.TryGetProperty("models", out var models) || models.ValueKind != JsonValueKind.Array) continue;
            foreach (var item in models.EnumerateArray())
            {
                var id = item.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                if (string.IsNullOrWhiteSpace(id) || !Regex.IsMatch(id, "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")) continue;
                var tasks = item.TryGetProperty("tasks", out var taskElement) && taskElement.ValueKind == JsonValueKind.Array
                    ? taskElement.EnumerateArray().Where(task => task.ValueKind == JsonValueKind.String).Select(task => task.GetString() ?? "").ToArray()
                    : [];
                if (!IsChatModelCatalogEntry(id, tasks)) continue;
                var tags = item.TryGetProperty("tags", out var tagElement) && tagElement.ValueKind == JsonValueKind.Array
                    ? tagElement.EnumerateArray().Where(tag => tag.ValueKind == JsonValueKind.String).Select(tag => tag.GetString() ?? "").ToArray()
                    : [];
                var isUncensored = IsExplicitUncensoredLabel(id, tags);
                if (uncensored != isUncensored) continue;
                var downloads = item.TryGetProperty("downloads", out var downloadElement) && downloadElement.TryGetInt64(out var count) ? count : 0;
                repositories[id] = (downloads, isUncensored);
            }
        }

        using var parallel = new SemaphoreSlim(4, 4);
        var manifests = await Task.WhenAll(repositories.OrderByDescending(pair => pair.Value.Downloads).Take(20).Select(async pair =>
        {
            await parallel.WaitAsync(cancellationToken);
            try { return await GetModelScopeGgufFilesAsync(pair.Key, pair.Value.Downloads, pair.Value.IsUncensored, cancellationToken); }
            finally { parallel.Release(); }
        }));
        return manifests.SelectMany(value => value)
            .OrderByDescending(value => value.Downloads)
            .ThenBy(value => value.Repository, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private async Task<IReadOnlyList<ModelScopeGgufPackage>> GetModelScopeGgufFilesAsync(string repository, long downloads, bool isUncensored, CancellationToken cancellationToken)
    {
        var uri = new Uri("https://modelscope.cn/api/v1/models/" + repository + "/repo/files?Revision=master&Recursive=True");
        using var request = new HttpRequestMessage(HttpMethod.Get, uri);
        request.Headers.UserAgent.ParseAdd(ProductIdentity.UserAgent("local model library"));
        using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        if (!response.IsSuccessStatusCode) return [];
        using var json = await BoundedHttpContent.ReadJsonAsync(response.Content, cancellationToken, "ModelScope file manifest");
        if (!json.RootElement.TryGetProperty("Data", out var data) || !data.TryGetProperty("Files", out var filesElement)) return [];
        if (filesElement.ValueKind == JsonValueKind.Object && filesElement.TryGetProperty("Files", out var nestedFiles)) filesElement = nestedFiles;
        if (filesElement.ValueKind != JsonValueKind.Array) return [];
        var files = filesElement.EnumerateArray()
            .Where(item => item.TryGetProperty("Type", out var type) && type.GetString() == "blob" && item.TryGetProperty("Path", out var path) && path.GetString()?.EndsWith(".gguf", StringComparison.OrdinalIgnoreCase) == true)
            .Where(item =>
            {
                var name = item.GetProperty("Path").GetString()!.Split('/').Last();
                return !name.StartsWith("mmproj", StringComparison.OrdinalIgnoreCase) && !name.Contains("projector", StringComparison.OrdinalIgnoreCase);
            })
            .Select(item => new ModelScopeGgufFile(
                item.GetProperty("Path").GetString()!,
                item.TryGetProperty("Size", out var size) && size.TryGetInt64(out var bytes) ? bytes : 0,
                item.TryGetProperty("Sha256", out var hash) ? hash.GetString() : null))
            .Where(file => !string.IsNullOrWhiteSpace(file.Sha256) && Regex.IsMatch(file.Sha256, "^[a-fA-F0-9]{64}$"))
            .ToArray();
        return files
            .GroupBy(file => Regex.Replace(file.Path, @"-\d{5}-of-\d{5}(?=\.gguf$)", "", RegexOptions.IgnoreCase), StringComparer.OrdinalIgnoreCase)
            .Select(group => new ModelScopeGgufPackage(repository, group.Key, group.OrderBy(file => file.Path, StringComparer.OrdinalIgnoreCase).ToArray(), downloads, isUncensored))
            .ToArray();
    }

    private static bool IsChatModelCatalogEntry(string repository, IEnumerable<string> tasks)
    {
        var name = repository.ToLowerInvariant();
        if (new[] { "embedding", "reranker", "rerank", "guard", "reward-model", "reward_model", "-asr", "asr-", "-tts", "tts-", "text-to-speech", "whisper", "speech-recognition", "-audio", "audio-", "classifier", "classification" }
            .Any(nonChat => name.Contains(nonChat, StringComparison.Ordinal)))
            return false;

        var taskList = tasks.Where(value => !string.IsNullOrWhiteSpace(value)).ToArray();
        if (taskList.Length > 0)
            return taskList.Any(task => task.Equals("text-generation", StringComparison.OrdinalIgnoreCase) || task.Equals("chat", StringComparison.OrdinalIgnoreCase));

        return true;
    }

    public async Task<string> DownloadAndImportModelScopeGgufAsync(string endpoint, ModelScopeGgufPackage package, Action<string>? onProgress = null, CancellationToken cancellationToken = default)
    {
        if (!Uri.TryCreate(endpoint.Trim().TrimEnd('/'), UriKind.Absolute, out var configured) || configured.Scheme is not ("http" or "https") || !configured.IsLoopback)
            throw new InvalidOperationException("ModelScope GGUF imports require a local Ollama server.");
        var repositoryId = ValidateRepositoryIdentifier(package.Repository, "ModelScope repository");
        var packageName = ValidateModelIdentifier(package.Name, "ModelScope model");
        if (package.Files.Count == 0) throw new InvalidOperationException("The selected ModelScope entry contains no downloadable GGUF files.");

        var root = new UriBuilder(configured) { Path = "", Query = "", Fragment = "" }.Uri;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromHours(6));
        var repositoryKey = Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(repositoryId))).ToLowerInvariant();
        var downloadDirectory = Path.Combine(_modelScopeDownloadDirectory, repositoryKey);
        Directory.CreateDirectory(downloadDirectory);
        var resumableFiles = new List<string>();
        var importCompleted = false;
        try
        {
            var blobMap = new Dictionary<string, string>(StringComparer.Ordinal);
            long completedBytes = 0;
            var totalBytes = package.Files.Sum(file => Math.Max(0, file.SizeBytes));
            foreach (var file in package.Files)
            {
                timeout.Token.ThrowIfCancellationRequested();
                if (!IsSafeModelScopeFilePath(file.Path) || string.IsNullOrWhiteSpace(file.Sha256) || !Regex.IsMatch(file.Sha256, "^[a-fA-F0-9]{64}$"))
                    throw new InvalidOperationException("The ModelScope file manifest contains an invalid filename or SHA-256 digest.");
                var fileName = file.Path.Split('/').Last();
                if (blobMap.ContainsKey(fileName)) throw new InvalidOperationException("The selected ModelScope package contains duplicate GGUF shard filenames.");
                var downloadUri = new Uri("https://modelscope.cn/api/v1/models/" + repositoryId + "/repo?Revision=master&FilePath=" + Uri.EscapeDataString(file.Path));
                var fileKey = Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(file.Path + "\n" + file.Sha256.ToLowerInvariant()))).ToLowerInvariant();
                var localPath = Path.Combine(downloadDirectory, fileKey + ".gguf.partial");
                var actualHash = await DownloadModelScopeFileAsync(downloadUri, localPath, file, totalBytes, completedBytes, onProgress, timeout.Token).ConfigureAwait(false);
                resumableFiles.Add(localPath);
                var fileBytes = new FileInfo(localPath).Length;
                bool hasGgufSignature;
                await using (var signatureFile = File.OpenRead(localPath))
                {
                    var signature = new byte[4];
                    hasGgufSignature = await signatureFile.ReadAsync(signature, timeout.Token) == 4 && signature.SequenceEqual("GGUF"u8.ToArray());
                }
                if (!hasGgufSignature)
                {
                    File.Delete(localPath);
                    throw new InvalidDataException($"The selected file {file.Path} does not have a GGUF signature; the model was not imported.");
                }

                var digest = "sha256:" + actualHash;
                onProgress?.Invoke($"Importing {fileName} into Ollama…");
                using (var blobRequest = new HttpRequestMessage(HttpMethod.Post, new Uri(root, "/api/blobs/" + digest)))
                {
                    var blobStream = new FileStream(localPath, FileMode.Open, FileAccess.Read, FileShare.Read, 1024 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
                    blobRequest.Content = new StreamContent(blobStream);
                    blobRequest.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
                    using var blobResponse = await _http.SendAsync(blobRequest, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
                    if (!blobResponse.IsSuccessStatusCode) throw new InvalidOperationException($"Ollama rejected the verified model blob ({(int)blobResponse.StatusCode}).");
                }
                blobMap[fileName] = digest;
                completedBytes += fileBytes;
            }

            var baseName = Regex.Replace(repositoryId.Split('/').Last() + "-" + Path.GetFileNameWithoutExtension(packageName), "[^A-Za-z0-9_.-]", "-").Trim('-', '.', '_').ToLowerInvariant();
            var modelName = "ms-" + (baseName.Length > 70 ? baseName[..70] : baseName);
            if (modelName.Length <= 3) modelName = "modelscope-model";
            onProgress?.Invoke($"Building {modelName} in Ollama…");
            using var createResponse = await _http.PostAsJsonAsync(new Uri(root, "/api/create"), new { model = modelName, files = blobMap, stream = true }, timeout.Token);
            if (!createResponse.IsSuccessStatusCode)
            {
                var body = await BoundedHttpContent.ReadTextAsync(createResponse.Content, timeout.Token, "Ollama model creation error");
                throw new InvalidOperationException($"Ollama could not create the model ({(int)createResponse.StatusCode}). {body}");
            }
            await using var createStream = await createResponse.Content.ReadAsStreamAsync(timeout.Token);
            using var reader = new StreamReader(createStream);
        var lineReader = BoundedHttpContent.CreateLineReader(reader);
            var succeeded = false;
        while (await lineReader.ReadLineAsync(timeout.Token) is { } line)
            {
                if (string.IsNullOrWhiteSpace(line)) continue;
                using var status = JsonDocument.Parse(line);
                var message = status.RootElement.TryGetProperty("status", out var state) ? state.GetString() : null;
                if (status.RootElement.TryGetProperty("error", out var error)) throw new InvalidOperationException("Ollama: " + error.GetString());
                if (message is not null) onProgress?.Invoke(message);
                if (string.Equals(message, "success", StringComparison.OrdinalIgnoreCase)) succeeded = true;
            }
            if (!succeeded) throw new InvalidOperationException("Ollama closed the model import stream before confirming completion.");
            importCompleted = true;
            return modelName;
        }
        finally
        {
            if (importCompleted)
            {
                foreach (var path in resumableFiles)
                {
                    try { File.Delete(path); }
                    catch (IOException) { }
                    catch (UnauthorizedAccessException) { }
                }
                try { if (Directory.Exists(downloadDirectory) && !Directory.EnumerateFileSystemEntries(downloadDirectory).Any()) Directory.Delete(downloadDirectory); }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
            }
            else
            {
                try { if (Directory.Exists(downloadDirectory) && !Directory.EnumerateFileSystemEntries(downloadDirectory).Any()) Directory.Delete(downloadDirectory); }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
            }
        }
    }

    private async Task<string> DownloadModelScopeFileAsync(Uri downloadUri, string localPath, ModelScopeGgufFile file, long totalBytes, long completedBytes, Action<string>? onProgress, CancellationToken cancellationToken)
    {
        if (file.SizeBytes <= 0) throw new InvalidDataException($"ModelScope did not publish a verified size for {file.Path}; this package cannot be safely resumed.");
        var expectedHash = file.Sha256?.ToLowerInvariant() ?? throw new InvalidDataException($"ModelScope did not publish a verified digest for {file.Path}; this package cannot be safely resumed.");
        if (File.Exists(localPath))
        {
            var existingLength = new FileInfo(localPath).Length;
            if (existingLength == file.SizeBytes)
            {
                var existingHash = await HashFileSha256Async(localPath, cancellationToken).ConfigureAwait(false);
                if (existingHash.Equals(expectedHash, StringComparison.OrdinalIgnoreCase)) return existingHash;
                File.Delete(localPath);
            }
            else if (existingLength > file.SizeBytes) File.Delete(localPath);
        }

        var offset = File.Exists(localPath) ? new FileInfo(localPath).Length : 0;
        if (offset > 0) onProgress?.Invoke($"Resuming {Path.GetFileName(file.Path)} · {offset / 1048576d:0.0} MB already downloaded");
        using var request = new HttpRequestMessage(HttpMethod.Get, downloadUri);
        request.Headers.UserAgent.ParseAdd(ProductIdentity.UserAgent("local model library"));
        if (offset > 0) request.Headers.Range = new System.Net.Http.Headers.RangeHeaderValue(offset, null);
        using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
        if (offset > 0 && response.StatusCode == HttpStatusCode.RequestedRangeNotSatisfiable)
            throw new InvalidDataException("ModelScope rejected the saved download offset; the partial file was preserved for retry.");
        if (offset > 0 && response.StatusCode == HttpStatusCode.PartialContent)
        {
            var range = response.Content.Headers.ContentRange;
            if (range is null || range.From != offset || range.To is null || range.Length != file.SizeBytes)
                throw new InvalidDataException("ModelScope returned an invalid partial-content range; the saved download was preserved.");
        }
        else if (offset == 0 && response.StatusCode == HttpStatusCode.PartialContent)
            throw new InvalidDataException("ModelScope returned a partial response without a requested resume offset.");
        else if (response.StatusCode == HttpStatusCode.OK)
        {
            // The source ignored the Range request. Restart safely from byte zero.
            offset = 0;
        }
        else if (offset > 0)
            throw new InvalidOperationException($"ModelScope could not resume the download ({(int)response.StatusCode}) for {file.Path}.");
        else if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException($"ModelScope file download failed ({(int)response.StatusCode}) for {file.Path}.");

        var expectedResponseLength = file.SizeBytes - offset;
        if (response.Content.Headers.ContentLength is > 0 and var contentLength && contentLength != expectedResponseLength)
            throw new InvalidDataException($"ModelScope reported an unexpected response size for {file.Path}.");
        var mode = offset > 0 ? FileMode.Append : FileMode.Create;
        await using (var destination = new FileStream(localPath, mode, FileAccess.Write, FileShare.None, 1024 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan))
        await using (var source = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false))
        {
            var buffer = new byte[1024 * 1024];
            long responseBytes = 0;
            try
            {
                while (true)
                {
                    var read = await source.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
                    if (read == 0) break;
                    responseBytes += read;
                    if (responseBytes > expectedResponseLength) throw new InvalidDataException($"ModelScope sent more data than its manifest for {file.Path}.");
                    await destination.WriteAsync(buffer.AsMemory(0, read), cancellationToken).ConfigureAwait(false);
                    var fileBytes = offset + responseBytes;
                    onProgress?.Invoke(totalBytes > 0
                        ? $"Downloading {Path.GetFileName(file.Path)} · {(completedBytes + fileBytes) / 1073741824d:0.00} / {totalBytes / 1073741824d:0.00} GB"
                        : $"Downloading {Path.GetFileName(file.Path)} · {(completedBytes + fileBytes) / 1048576d:0.0} MB");
                }
            }
            catch (IOException error) when (!cancellationToken.IsCancellationRequested)
            { throw new IOException($"ModelScope transfer for {file.Path} was interrupted. The partial download was kept so the next install attempt can resume it.", error); }
            await destination.FlushAsync(cancellationToken).ConfigureAwait(false);
        }
        if (new FileInfo(localPath).Length != file.SizeBytes)
            throw new IOException($"ModelScope download for {file.Path} ended early. The partial file was kept so the next install attempt can resume it.");
        var actualHash = await HashFileSha256Async(localPath, cancellationToken).ConfigureAwait(false);
        if (!actualHash.Equals(expectedHash, StringComparison.OrdinalIgnoreCase))
        {
            File.Delete(localPath);
            throw new InvalidDataException($"SHA-256 verification failed for {file.Path}; the corrupt partial download was removed.");
        }
        return actualHash;
    }

    private static async Task<string> HashFileSha256Async(string path, CancellationToken cancellationToken)
    {
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 1024 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
        var digest = await SHA256.HashDataAsync(stream, cancellationToken).ConfigureAwait(false);
        return Convert.ToHexString(digest).ToLowerInvariant();
    }

    private static bool IsSafeModelScopeFilePath(string path)
    {
        if (string.IsNullOrWhiteSpace(path) || path.StartsWith("/", StringComparison.Ordinal) || path.Contains('\\')) return false;
        var segments = path.Split('/');
        if (segments.Any(segment => segment is "" or "." or "..")) return false;
        var fileName = segments[^1];
        return fileName.EndsWith(".gguf", StringComparison.OrdinalIgnoreCase) &&
            !fileName.Any(character => char.IsControl(character) || "<>:\"|?*".Contains(character));
    }

    private static string ValidateRepositoryIdentifier(string repository, string label)
    {
        var value = repository.Trim();
        if (value.Length > MaxModelIdentifierLength ||
            !Regex.IsMatch(value, @"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$") ||
            value.Split('/').Any(segment => segment is "." or ".."))
            throw new InvalidOperationException($"The {label} identifier is invalid.");
        return value;
    }

    private static string ValidateModelIdentifier(string model, string label)
    {
        var value = model.Trim();
        if (value.Length == 0 || value.Length > MaxModelIdentifierLength ||
            value.Any(character => char.IsControl(character) || !(char.IsLetterOrDigit(character) || "_.-:/".Contains(character))))
            throw new InvalidOperationException($"The {label} identifier is invalid.");
        return value;
    }

    private static string ValidateCatalogQuery(string query)
    {
        var value = (query ?? "").Trim();
        if (value.Length > MaxCatalogQueryLength || value.Any(char.IsControl))
            throw new InvalidOperationException($"Model search text must be {MaxCatalogQueryLength} characters or fewer and contain no control characters.");
        return value;
    }

    private static bool IsSafeCatalogIdentifier(string? value) =>
        !string.IsNullOrWhiteSpace(value) && value.Length <= MaxModelIdentifierLength && !value.Any(char.IsControl);

    public async Task DownloadFromHuggingFaceAsync(string endpoint, string repository, string? quantization = null, Action<string>? onProgress = null, CancellationToken cancellationToken = default)
    {
        var repositoryId = ValidateRepositoryIdentifier(repository, "Hugging Face repository");
        var quantizationId = string.IsNullOrWhiteSpace(quantization) ? null : ValidateModelIdentifier(quantization, "quantization");
        if (quantizationId is { Length: > 128 }) throw new InvalidOperationException("The quantization identifier is too long.");
        if (!Uri.TryCreate(endpoint.Trim().TrimEnd('/'), UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https") || !uri.IsLoopback)
            throw new InvalidOperationException("Set a valid LM Studio local server endpoint before downloading a Hugging Face model.");
        var root = new UriBuilder(uri) { Path = "", Query = "", Fragment = "" }.Uri;
        var downloadUri = new Uri(root, "/api/v1/models/download");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromMinutes(45));
        var payload = quantizationId is null
            ? new Dictionary<string, string> { ["model"] = repositoryId }
            : new Dictionary<string, string> { ["model"] = repositoryId, ["quantization"] = quantizationId };
        using var response = await _http.PostAsJsonAsync(downloadUri, payload, timeout.Token);
        var body = await BoundedHttpContent.ReadTextAsync(response.Content, timeout.Token, "LM Studio download response");
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException($"LM Studio could not start this download ({(int)response.StatusCode}). Make sure its local server is running and the selected repository is supported. {body}");
        using var json = JsonDocument.Parse(body);
        var jobId = json.RootElement.TryGetProperty("job_id", out var id) ? id.GetString() : null;
        if (string.IsNullOrWhiteSpace(jobId)) throw new InvalidOperationException("LM Studio accepted the request but returned no download job ID.");
        while (true)
        {
            timeout.Token.ThrowIfCancellationRequested();
            await Task.Delay(TimeSpan.FromSeconds(1), timeout.Token);
            using var statusResponse = await _http.GetAsync(new Uri(root, "/api/v1/models/download/status/" + Uri.EscapeDataString(jobId)), timeout.Token);
            var statusBody = await BoundedHttpContent.ReadTextAsync(statusResponse.Content, timeout.Token, "LM Studio download status");
            if (!statusResponse.IsSuccessStatusCode)
                throw new InvalidOperationException($"Could not check LM Studio download progress ({(int)statusResponse.StatusCode}). {statusBody}");
            using var statusJson = JsonDocument.Parse(statusBody);
            var state = statusJson.RootElement.TryGetProperty("status", out var status) ? status.GetString() : null;
            var downloaded = statusJson.RootElement.TryGetProperty("downloaded_bytes", out var done) && done.TryGetInt64(out var bytes) ? bytes : 0;
            var total = statusJson.RootElement.TryGetProperty("total_size", out var sizeElement) && sizeElement.TryGetInt64(out var size) ? size : 0;
            onProgress?.Invoke(total > 0
                ? $"Hugging Face download · {downloaded / 1048576d:0.0} / {total / 1048576d:0.0} MB"
                : $"Hugging Face download · {state ?? "working"}");
            if (state is "completed" or "success") return;
            if (state is "failed" or "cancelled") throw new InvalidOperationException("LM Studio model download " + state + ". " + statusBody);
        }
    }

    public async Task PullOllamaAsync(string endpoint, string model, Action<string>? onProgress = null, CancellationToken cancellationToken = default)
    {
        var modelId = ValidateModelIdentifier(model, "Ollama model");
        if (!Uri.TryCreate(endpoint.Trim().TrimEnd('/'), UriKind.Absolute, out var endpointUri) || !endpointUri.IsLoopback)
            throw new InvalidOperationException("Ollama downloads are supported only from a local Ollama server.");
        var root = new UriBuilder(endpointUri) { Path = "", Query = "", Fragment = "" }.Uri;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromHours(2));
        using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(root, "/api/pull")) { Content = JsonContent.Create(new { name = modelId, stream = true }) };
        using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException($"Ollama could not start the model pull ({(int)response.StatusCode}). Check the model name and local Ollama server.");
        await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
        using var reader = new StreamReader(stream);
        var lineReader = BoundedHttpContent.CreateLineReader(reader);
        while (await lineReader.ReadLineAsync(timeout.Token) is { } line)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            using var json = JsonDocument.Parse(line);
            if (json.RootElement.TryGetProperty("error", out var error)) throw new InvalidOperationException("Ollama: " + error.GetString());
            var status = json.RootElement.TryGetProperty("status", out var state) ? state.GetString() : "Downloading";
            long completed = json.RootElement.TryGetProperty("completed", out var c) && c.TryGetInt64(out var bytes) ? bytes : 0;
            long total = json.RootElement.TryGetProperty("total", out var t) && t.TryGetInt64(out var size) ? size : 0;
            onProgress?.Invoke(total > 0 ? $"{status} · {completed / 1048576d:0.0} / {total / 1048576d:0.0} MB" : status ?? "Downloading");
            if (string.Equals(status, "success", StringComparison.OrdinalIgnoreCase)) return;
        }
        throw new InvalidOperationException("Ollama closed the download stream before confirming completion.");
    }

    public async Task DeleteOllamaAsync(string endpoint, string model, CancellationToken cancellationToken = default)
    {
        var modelId = ValidateModelIdentifier(model, "Ollama model");
        if (!Uri.TryCreate(endpoint.Trim().TrimEnd('/'), UriKind.Absolute, out var endpointUri) || !endpointUri.IsLoopback)
            throw new InvalidOperationException("Ollama model deletion is supported only from a local Ollama server.");
        var root = new UriBuilder(endpointUri) { Path = "", Query = "", Fragment = "" }.Uri;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromMinutes(2));
        using var response = await _http.SendAsync(new HttpRequestMessage(HttpMethod.Delete, new Uri(root, "/api/delete"))
        {
            Content = JsonContent.Create(new { name = modelId })
        }, timeout.Token);
        if (!response.IsSuccessStatusCode)
        {
            var body = await BoundedHttpContent.ReadTextAsync(response.Content, timeout.Token, "Ollama delete response");
            throw new InvalidOperationException($"Ollama could not delete {modelId} ({(int)response.StatusCode}). {body}");
        }
    }

}
