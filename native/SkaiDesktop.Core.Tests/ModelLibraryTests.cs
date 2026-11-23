// Model Library: local runtime discovery, Hugging Face and ModelScope search,
// GGUF download/import checks, Ollama pull/delete (ModelLibraryService).
// Uses TestSupport (Check, StubHandler, …). Run by Program.cs.

using System.Net;
using System.Text;
using System.Text.Json;
using SkaiDesktop.Core.Infrastructure;
using SkaiDesktop.Core.Models;
using SkaiDesktop.Core.Services;
using static TestSupport;

internal static class ModelLibraryTests
{
    public static async Task RunAsync()
    {
        HttpRequestMessage? deleteRequest = null;
        var deleteService = new ModelLibraryService(new HttpClient(new StubHandler((request, _) =>
        {
            deleteRequest = request;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK));
        })));
        await deleteService.DeleteOllamaAsync("http://127.0.0.1:11434", "local-model");
        Check(deleteRequest?.Method == HttpMethod.Delete && deleteRequest.RequestUri?.AbsolutePath == "/api/delete",
            "Ollama model deletion uses the bounded local delete endpoint");

        var hfSearch = new ModelLibraryService(new HttpClient(new StubHandler((request, _) =>
        {
            var requestUri = request.RequestUri;
            Check(requestUri?.Host == "huggingface.co" && requestUri.Query.Contains("filter=gguf", StringComparison.Ordinal), "model library searches Hugging Face GGUF repositories");
            var data = requestUri?.Query.Contains("abliterated", StringComparison.OrdinalIgnoreCase) == true
                ? "[{\"id\":\"org/model-abliterated-gguf\",\"downloads\":1234,\"likes\":12,\"tags\":[\"gguf\",\"abliterated\"]}]"
                : "[{\"id\":\"org/model-gguf\",\"downloads\":1234,\"likes\":12,\"tags\":[\"gguf\",\"license:apache-2.0\"],\"cardData\":{\"license\":\"apache-2.0\"}},{\"id\":\"org/model-uncensored-gguf\",\"downloads\":9,\"tags\":[\"uncensored\"]}]";
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(data) });
        })));
        var hubModels = await hfSearch.SearchHuggingFaceAsync("small instruct", uncensored: false);
        Check(hubModels.Count == 1 && hubModels[0].Id == "org/model-gguf" && hubModels[0].Downloads == 1234 && hubModels[0].License == "apache-2.0", "model library parses Hub IDs, popularity, and published license metadata");
        var unpublishedLicenseCatalog = new ModelLibraryService(new HttpClient(new StubHandler((_, _) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("[{\"id\":\"org/model-no-license\",\"downloads\":1,\"tags\":[\"gguf\"]}]")
            }))));
        var unpublishedLicenseModels = await unpublishedLicenseCatalog.SearchHuggingFaceAsync("small instruct", uncensored: false);
        Check(unpublishedLicenseModels.Count == 1 && unpublishedLicenseModels[0].License is null,
            "model library leaves license unknown when the publisher provides no license metadata");
        var uncensoredHubModels = await hfSearch.SearchHuggingFaceAsync("small instruct", uncensored: true);
        Check(uncensoredHubModels.Count >= 1 && uncensoredHubModels.All(model => model.IsUncensored), "uncensored catalog includes only explicitly labeled repositories");
        var boundedCatalog = new ModelLibraryService(new HttpClient(new StubHandler((_, _) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("[{\"id\":\"" + new string('x', 513) + "\"}]") }))));
        try
        {
            await boundedCatalog.SearchHuggingFaceAsync(new string('q', 257), uncensored: false);
            throw new Exception("Expected oversized model search text to be rejected.");
        }
        catch (InvalidOperationException)
        {
            Check(true, "model catalog search text is bounded before network access");
        }
        var ignoredCatalogModels = await boundedCatalog.SearchHuggingFaceAsync("small", uncensored: false);
        Check(ignoredCatalogModels.Count == 0, "model catalog ignores oversized remote model IDs");
        var airLlmCatalog = new ModelLibraryService(new HttpClient(new StubHandler((_, _) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("[{\"id\":\"org/full-weights\",\"downloads\":42,\"tags\":[\"text-generation\",\"license:mit\"],\"cardData\":{\"license\":\"apache-2.0\"},\"config\":{\"max_position_embeddings\":1048576},\"siblings\":[{\"rfilename\":\"model.safetensors\",\"size\":4096}]}]")
            }))));
        var airLlmModels = await airLlmCatalog.SearchHuggingFaceAirLlmAsync("full weights", uncensored: false);
        Check(airLlmModels.Count == 1 && airLlmModels[0].License == "apache-2.0" && airLlmModels[0].ContextLength == 1048576,
            "full-weight model catalog results include published license and context metadata");
        var localInventory = new ModelLibraryService(new HttpClient(new StubHandler((request, _) =>
        {
            var models = (request.RequestUri?.Port, request.RequestUri?.AbsolutePath) switch
            {
                (11434, "/api/tags") => "{\"models\":[{\"name\":\"llama3.2\",\"size\":123456789,\"details\":{\"family\":\"llama\"}},{\"name\":\"qwen3:8b\"}]}",
                (11434, "/api/show") => "{\"model_info\":{\"llama.context_length\":131072}}",
                (1234, "/api/v1/models") => "{\"models\":[{\"type\":\"llm\",\"key\":\"qwen3:8b\",\"display_name\":\"Qwen 3 8B\",\"size_bytes\":1234567890,\"loaded_instances\":[]}]}",
                _ => "{\"data\":[]}"
            };
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(models) });
        })));
        var discoveredLocalModels = await localInventory.DiscoverLocalModelsAsync("http://localhost:1234/v1", includeHuggingFaceCache: false);
        Check(discoveredLocalModels.Count == 3, "model library finds installed models across multiple local runtimes");
        Check(discoveredLocalModels.Count(model => model.Model == "qwen3:8b") == 2 && discoveredLocalModels.Select(model => model.Endpoint).Distinct(StringComparer.OrdinalIgnoreCase).Count() == 2, "same model ID remains distinguishable when installed in separate runtimes");
        Check(discoveredLocalModels.Any(model => model.Provider == "LM Studio" && model.IsLoaded == false && model.DisplayName == "Qwen 3 8B") && discoveredLocalModels.Any(model => model.Provider == "Ollama" && model.SizeBytes == 123456789 && model.DisplayName == "Llama3.2"), "runtime-native inventories include installed state and readable model labels");
        Check(discoveredLocalModels.Where(model => model.Provider == "Ollama").All(model => model.ContextLength == 131072), "Ollama inventory enriches short model lists with bounded context metadata");
        Check(ModelDisplayNameFormatter.Format("qwen3:14b") == "Qwen3 14B", "Ollama parameter-size tags become readable model labels");
        Check(ModelDisplayNameFormatter.Format("hf.co/Thaurock/Qwen3-Coder-30B-A3B-Instruct-abliterated-GGUF:Q4_K_M") == "Qwen3 Coder 30B A3B Instruct · Q4_K_M", "Hugging Face Ollama IDs expose the model name and quantization instead of the runtime family alias");
        Check(ModelDisplayNameFormatter.Format("hf.co/example/model-name:latest") == "Model Name" && ModelDisplayNameFormatter.Format("") == "Unknown model", "generic and empty model IDs receive safe readable labels");
        var resilientInventory = new ModelLibraryService(new HttpClient(new StubHandler((request, _) =>
        {
            if (request.RequestUri?.Port == 1234 && request.RequestUri.AbsolutePath == "/api/v1/models")
            {
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent("{\"models\":[{\"type\":\"llm\",\"key\":\"healthy-local-model\"}]}", Encoding.UTF8, "application/json")
                });
            }
            var oversized = new StringContent("{}");
            oversized.Headers.ContentLength = BoundedHttpContent.MaxJsonBytes + 1L;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = oversized });
        })));
        var resilientModels = await resilientInventory.DiscoverLocalModelsAsync("http://localhost:1234/v1", includeHuggingFaceCache: false);
        Check(resilientModels.Count == 1 && resilientModels[0].Model == "healthy-local-model" && resilientModels[0].Provider == "LM Studio",
            "one malformed local runtime response does not block Model Library inventory from healthy runtimes");

        var ollamaProgress = new List<string>();
        var ollamaPull = new ModelLibraryService(new HttpClient(new StubHandler((request, _) =>
        {
            Check(request.RequestUri?.AbsoluteUri == "http://localhost:11434/api/pull", "Ollama library pulls through the local native API");
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"status\":\"pulling\",\"completed\":524288,\"total\":1048576}\n{\"status\":\"success\"}\n") });
        })));
        await ollamaPull.PullOllamaAsync("http://localhost:11434/v1", "qwen3:8b", ollamaProgress.Add);
        Check(ollamaProgress.Count == 2 && ollamaProgress[0].Contains("0.5 / 1.0 MB", StringComparison.Ordinal), "Ollama model pull reports streaming byte progress");
        var invalidModelLibrary = new ModelLibraryService(new HttpClient(new StubHandler((_, _) => throw new Exception("Invalid model identifiers must be rejected before network access."))));
        try
        {
            await invalidModelLibrary.PullOllamaAsync("http://localhost:11434/v1", new string('x', 513));
            throw new Exception("Expected an oversized Ollama model identifier to be rejected.");
        }
        catch (InvalidOperationException)
        {
            Check(true, "Ollama model identifiers are bounded before network access");
        }
        try
        {
            await invalidModelLibrary.DownloadFromHuggingFaceAsync("http://localhost:1234", "not-a-repository");
            throw new Exception("Expected an invalid Hugging Face repository identifier to be rejected.");
        }
        catch (InvalidOperationException)
        {
            Check(true, "Hugging Face repository identifiers are validated before network access");
        }

        var modelScopeSearch = new ModelLibraryService(new HttpClient(new StubHandler((request, _) =>
        {
            var uri = request.RequestUri!;
            if (uri.AbsolutePath == "/openapi/v1/models")
            {
                var uncensored = uri.Query.Contains("abliterated", StringComparison.OrdinalIgnoreCase) || uri.Query.Contains("uncensored", StringComparison.OrdinalIgnoreCase);
                var results = uncensored
                    ? "{\"data\":{\"models\":[{\"id\":\"org/model-abliterated\",\"downloads\":12,\"tasks\":[\"text-generation\"]}]}}"
                    : "{\"data\":{\"models\":[{\"id\":\"org/model-gguf\",\"downloads\":120,\"tasks\":[\"text-generation\"]},{\"id\":\"org/model-embedding\",\"downloads\":300,\"tasks\":[\"sentence-embedding\"]},{\"id\":\"org/model-reranker\",\"downloads\":90,\"tasks\":[\"text-generation\"]},{\"id\":\"org/Qwen3Guard-Gen-0.6B\",\"downloads\":85,\"tasks\":[\"text-generation\"]},{\"id\":\"org/qwen3-asr\",\"downloads\":80,\"tasks\":[]}]}}";
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(results) });
            }
            var pathParts = uri.AbsolutePath.Split('/');
            var repository = pathParts.Length > 5 ? pathParts[4] + "/" + pathParts[5] : "";
            var hash = new string('a', 64);
            var files = repository.Contains("abliterated", StringComparison.OrdinalIgnoreCase)
                ? $"{{\"Data\":{{\"Files\":[{{\"Path\":\"model-abliterated-Q4_K_M.gguf\",\"Type\":\"blob\",\"Size\":8,\"Sha256\":\"{hash}\"}}]}}}}"
                : $"{{\"Data\":{{\"Files\":[{{\"Path\":\"model-Q4_K_M-00001-of-00002.gguf\",\"Type\":\"blob\",\"Size\":8,\"Sha256\":\"{hash}\"}},{{\"Path\":\"model-Q4_K_M-00002-of-00002.gguf\",\"Type\":\"blob\",\"Size\":8,\"Sha256\":\"{hash}\"}},{{\"Path\":\"mmproj-model-Q4_K_M.gguf\",\"Type\":\"blob\",\"Size\":8,\"Sha256\":\"{hash}\"}},{{\"Path\":\"README.md\",\"Type\":\"blob\",\"Size\":10,\"Sha256\":\"{hash}\"}}]}}}}";
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(files) });
        })));
        var modelScopeRegular = await modelScopeSearch.SearchModelScopeGgufAsync("small instruct", uncensored: false);
        Check(modelScopeRegular.Count == 1 && modelScopeRegular[0].Repository == "org/model-gguf" && modelScopeRegular[0].Files.Count == 2 && modelScopeRegular[0].SizeBytes == 16, "ModelScope catalog groups chat GGUF shards and excludes embedding, reranker, guard, ASR, and projector files even when task tags conflict");
        var modelScopeUncensored = await modelScopeSearch.SearchModelScopeGgufAsync("small instruct", uncensored: true);
        Check(modelScopeUncensored.Count == 1 && modelScopeUncensored[0].IsUncensored && modelScopeUncensored[0].Repository.Contains("abliterated", StringComparison.OrdinalIgnoreCase), "ModelScope uncensored search includes only explicitly labeled repositories");

        var ggufBytes = "GGUFtest"u8.ToArray();
        var ggufHash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(ggufBytes)).ToLowerInvariant();
        var importedFileDigest = "";
        var importedCreateBody = "";
        var modelScopeImport = new ModelLibraryService(new HttpClient(new StubHandler(async (request, _) =>
        {
            if (request.Method == HttpMethod.Get)
                return new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(ggufBytes) };
            if (request.RequestUri!.AbsolutePath.StartsWith("/api/blobs/", StringComparison.Ordinal))
            {
                importedFileDigest = request.RequestUri.AbsolutePath.Split('/').Last();
                return new HttpResponseMessage(HttpStatusCode.Created);
            }
            if (request.RequestUri!.AbsolutePath == "/api/create")
            {
                importedCreateBody = await request.Content!.ReadAsStringAsync();
                return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"status\":\"parsing GGUF\"}\n{\"status\":\"success\"}\n") };
            }
            throw new Exception("Unexpected ModelScope import request: " + request.RequestUri);
        })));
        var importedModelName = await modelScopeImport.DownloadAndImportModelScopeGgufAsync("http://localhost:11434/v1",
            new ModelScopeGgufPackage("org/model", "model-Q4_K_M.gguf", [new ModelScopeGgufFile("model-Q4_K_M.gguf", ggufBytes.Length, ggufHash)], 1));
        using (var createJson = JsonDocument.Parse(importedCreateBody))
            Check(importedFileDigest == "sha256:" + ggufHash && createJson.RootElement.GetProperty("files").GetProperty("model-Q4_K_M.gguf").GetString() == importedFileDigest && importedModelName.StartsWith("ms-model-", StringComparison.Ordinal), "ModelScope GGUF downloads are SHA-256 checked and imported through Ollama's blob/create APIs");

        var resumeDirectory = Path.Combine(Path.GetTempPath(), "skai-modelscope-resume-test-" + Guid.NewGuid().ToString("N"));
        var rangedResumeSeen = false;
        var resumeRequestCount = 0;
        var resumableImport = new ModelLibraryService(new HttpClient(new StubHandler((request, _) =>
        {
            if (request.Method == HttpMethod.Get)
            {
                resumeRequestCount++;
                if (resumeRequestCount == 1)
                    return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StreamContent(new PrefixThenThrowStream(ggufBytes, 4)) });
                rangedResumeSeen = request.Headers.Range?.Ranges.SingleOrDefault()?.From == 4;
                if (!rangedResumeSeen) throw new Exception("The interrupted ModelScope download was not resumed at its verified saved offset.");
                var resumed = new HttpResponseMessage(HttpStatusCode.PartialContent) { Content = new ByteArrayContent(ggufBytes[4..]) };
                resumed.Content.Headers.ContentRange = new System.Net.Http.Headers.ContentRangeHeaderValue(4, ggufBytes.Length - 1, ggufBytes.Length);
                return Task.FromResult(resumed);
            }
            if (request.RequestUri!.AbsolutePath.StartsWith("/api/blobs/", StringComparison.Ordinal)) return Task.FromResult(new HttpResponseMessage(HttpStatusCode.Created));
            if (request.RequestUri!.AbsolutePath == "/api/create") return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"status\":\"success\"}\n") });
            throw new Exception("Unexpected resumable ModelScope request: " + request.RequestUri);
        })), resumeDirectory);
        var resumablePackage = new ModelScopeGgufPackage("org/model", "model-Q4_K_M.gguf", [new ModelScopeGgufFile("model-Q4_K_M.gguf", ggufBytes.Length, ggufHash)], 1);
        try
        {
            try
            {
                await resumableImport.DownloadAndImportModelScopeGgufAsync("http://localhost:11434/v1", resumablePackage);
                throw new Exception("Expected the first ModelScope transfer to interrupt.");
            }
            catch (IOException error) when (error.Message.Contains("partial download was kept", StringComparison.Ordinal))
            {
                var savedPartial = Directory.GetFiles(resumeDirectory, "*.partial", SearchOption.AllDirectories).SingleOrDefault();
                Check(savedPartial is not null && new FileInfo(savedPartial).Length == 4, "Interrupted ModelScope downloads retain a bounded partial file for a safe retry");
            }
            await resumableImport.DownloadAndImportModelScopeGgufAsync("http://localhost:11434/v1", resumablePackage);
            Check(rangedResumeSeen && resumeRequestCount == 2, "ModelScope retry resumes with HTTP Range, verifies the whole SHA-256, and imports the model");
            Check(!Directory.Exists(resumeDirectory) || !Directory.EnumerateFileSystemEntries(resumeDirectory, "*", SearchOption.AllDirectories).Any(), "Successfully imported ModelScope downloads remove only their temporary resume cache");
        }
        finally { if (Directory.Exists(resumeDirectory)) Directory.Delete(resumeDirectory, recursive: true); }

        var cancelDirectory = Path.Combine(Path.GetTempPath(), "skai-modelscope-cancel-test-" + Guid.NewGuid().ToString("N"));
        var cancelStream = new CancellablePrefixStream(ggufBytes, 4);
        var cancellableImport = new ModelLibraryService(new HttpClient(new StubHandler((request, _) =>
        {
            if (request.Method == HttpMethod.Get)
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StreamContent(cancelStream) });
            throw new Exception("Cancelled ModelScope download must not upload a model blob.");
        })), cancelDirectory);
        try
        {
            using (var cancelDownload = new CancellationTokenSource())
            {
                var firstBytesWritten = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
                var downloadTask = cancellableImport.DownloadAndImportModelScopeGgufAsync("http://localhost:11434/v1", resumablePackage,
                    onProgress: _ => firstBytesWritten.TrySetResult(), cancellationToken: cancelDownload.Token);
                try
                {
                    await firstBytesWritten.Task.WaitAsync(TimeSpan.FromSeconds(5));
                    cancelDownload.Cancel();
                    await downloadTask;
                    throw new Exception("Expected the ModelScope transfer to cancel.");
                }
                catch (OperationCanceledException)
                {
                    var savedPartial = Directory.GetFiles(cancelDirectory, "*.partial", SearchOption.AllDirectories).SingleOrDefault();
                    Check(savedPartial is not null && new FileInfo(savedPartial).Length == 4,
                        "Cancelling a ModelScope transfer preserves only its verified local partial for retry");
                }
            }
        }
        finally { if (Directory.Exists(cancelDirectory)) Directory.Delete(cancelDirectory, recursive: true); }

        var rejectedImportHandler = new StubHandler((request, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(ggufBytes) }));
        var rejectedImport = new ModelLibraryService(new HttpClient(rejectedImportHandler));
        try
        {
            await rejectedImport.DownloadAndImportModelScopeGgufAsync("http://localhost:11434/v1",
                new ModelScopeGgufPackage("org/model", "model-Q4_K_M.gguf", [new ModelScopeGgufFile("model-Q4_K_M.gguf", ggufBytes.Length, new string('0', 64))], 1));
            throw new Exception("Expected a mismatched ModelScope file checksum to be rejected.");
        }
        catch (InvalidDataException) { Check(true, "ModelScope GGUF import rejects mismatched SHA-256 before Ollama upload"); }
        var invalidGgufBytes = "NOPEtest"u8.ToArray();
        var invalidGgufHash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(invalidGgufBytes)).ToLowerInvariant();
        var invalidGgufImport = new ModelLibraryService(new HttpClient(new StubHandler((request, _) =>
        {
            if (request.Method == HttpMethod.Post) throw new Exception("Invalid GGUF data must not be uploaded to Ollama.");
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(invalidGgufBytes) });
        })));
        try
        {
            await invalidGgufImport.DownloadAndImportModelScopeGgufAsync("http://localhost:11434/v1",
                new ModelScopeGgufPackage("org/model", "model-Q4_K_M.gguf", [new ModelScopeGgufFile("model-Q4_K_M.gguf", invalidGgufBytes.Length, invalidGgufHash)], 1));
            throw new Exception("Expected a non-GGUF file signature to be rejected.");
        }
        catch (InvalidDataException) { Check(true, "ModelScope GGUF import rejects invalid file signatures before Ollama upload"); }
        var traversalImport = new ModelLibraryService(new HttpClient(new StubHandler((_, _) => throw new Exception("Unsafe local paths must be rejected before network access."))));
        try
        {
            await traversalImport.DownloadAndImportModelScopeGgufAsync("http://localhost:11434/v1",
                new ModelScopeGgufPackage("org/model", "../model.gguf", [new ModelScopeGgufFile("../model.gguf", 1, new string('a', 64))], 1));
            throw new Exception("Expected unsafe ModelScope archive paths to be rejected.");
        }
        catch (InvalidOperationException) { Check(true, "ModelScope GGUF import rejects path traversal before network access"); }

        // Local speed averaging (moved from the former desktop shell into Core).
        Check(LocalModelPerformance.Key(" HTTP://LocalHost:1234/v1/ ", "Qwen3") == "http://localhost:1234/v1\nQwen3",
            "local speed key normalizes the endpoint but keeps the model ID");
        var measuredAt = DateTimeOffset.Parse("2026-11-07T00:00:00Z");
        var firstSample = LocalModelPerformance.AddSample(null, 400, 1100, 100, measuredAt);
        Check(firstSample.Samples == 1 && Math.Abs(firstSample.EstimatedTokensPerSecond - 100) < 0.001 && firstSample.TimeToFirstTokenMilliseconds == 100,
            "first local speed sample estimates characters/4 per second after the first token");
        var secondSample = LocalModelPerformance.AddSample(firstSample, 200, 1300, 300, measuredAt);
        Check(secondSample.Samples == 2 && Math.Abs(secondSample.EstimatedTokensPerSecond - 75) < 0.001 && secondSample.TimeToFirstTokenMilliseconds == 200,
            "later local speed samples update the running averages");
    }
}

internal sealed class PrefixThenThrowStream(byte[] bytes, int prefixLength) : Stream
{
    private int _position;
    public override bool CanRead => true;
    public override bool CanSeek => false;
    public override bool CanWrite => false;
    public override long Length => throw new NotSupportedException();
    public override long Position { get => _position; set => throw new NotSupportedException(); }
    public override void Flush() { }
    public override int Read(byte[] buffer, int offset, int count)
    {
        if (_position >= prefixLength) throw new IOException("Simulated interrupted transfer.");
        var read = Math.Min(count, prefixLength - _position);
        Array.Copy(bytes, _position, buffer, offset, read);
        _position += read;
        return read;
    }
    public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (_position >= prefixLength) throw new IOException("Simulated interrupted transfer.");
        var read = Math.Min(buffer.Length, prefixLength - _position);
        bytes.AsMemory(_position, read).CopyTo(buffer);
        _position += read;
        return ValueTask.FromResult(read);
    }
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
}

internal sealed class CancellablePrefixStream(byte[] bytes, int prefixLength) : Stream
{
    private int _position;
    public override bool CanRead => true;
    public override bool CanSeek => false;
    public override bool CanWrite => false;
    public override long Length => throw new NotSupportedException();
    public override long Position { get => _position; set => throw new NotSupportedException(); }
    public override void Flush() { }
    public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
    {
        if (_position >= prefixLength)
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
            return 0;
        }
        var read = Math.Min(buffer.Length, prefixLength - _position);
        bytes.AsMemory(_position, read).CopyTo(buffer);
        _position += read;
        return read;
    }
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
}
