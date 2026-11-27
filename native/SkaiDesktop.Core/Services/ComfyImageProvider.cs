// Image Studio back end: queues a user-supplied ComfyUI workflow on a loopback-only
// endpoint, polls for the result, and returns image URLs.
// Depends on: HttpClient, BoundedHttpContent. Used by: the Electron Image Studio through the Agent Host.

using System.Net.Http.Json;
using System.Buffers.Binary;
using System.Text.Json;
using SkaiDesktop.Core.Infrastructure;

namespace SkaiDesktop.Core.Services;

public sealed record ComfyGeneratedImage(Uri Url, string FileName, string MediaType = "image", byte[]? Content = null);

/// <summary>Queues an explicitly configured workflow on a local ComfyUI server.</summary>
public sealed class ComfyImageProvider(HttpClient? httpClient = null)
{
    private const int MaxWorkflowCharacters = 1_000_000;
    private const int MaxPromptCharacters = 8_000;
    private const int MaxGlbBytes = 100 * 1024 * 1024;
    private readonly HttpClient _http = httpClient ?? new HttpClient { Timeout = Timeout.InfiniteTimeSpan };

    public async Task<IReadOnlyList<string>> DiscoverCheckpointsAsync(string endpoint, CancellationToken cancellationToken = default)
    {
        var root = ValidateEndpoint(endpoint);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(5));
        var uri = new Uri(root, "object_info/CheckpointLoaderSimple");
        using var response = await _http.GetAsync(uri, timeout.Token).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException($"Local ComfyUI could not list checkpoints ({(int)response.StatusCode}).");
        using var json = await BoundedHttpContent.ReadJsonAsync(response.Content, timeout.Token, "ComfyUI checkpoint list").ConfigureAwait(false);
        if (!json.RootElement.TryGetProperty("CheckpointLoaderSimple", out var node)
            || !node.TryGetProperty("input", out var input)
            || !input.TryGetProperty("required", out var required)
            || !required.TryGetProperty("ckpt_name", out var field)
            || field.ValueKind != JsonValueKind.Array
            || field.GetArrayLength() == 0
            || field[0].ValueKind != JsonValueKind.Array)
            return [];
        return field[0].EnumerateArray()
            .Where(value => value.ValueKind == JsonValueKind.String)
            .Select(value => value.GetString())
            .Where(value => !string.IsNullOrWhiteSpace(value) && value!.Length <= 512 && !value.Any(char.IsControl))
            .Select(value => value!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(256)
            .ToArray();
    }

    public async Task<IReadOnlyList<ComfyGeneratedImage>> GenerateAsync(string endpoint, string workflowTemplate, string prompt, Action<string>? progress = null, CancellationToken cancellationToken = default, string? sourceImageName = null, byte[]? sourceImage = null, bool modelOutputOnly = false)
    {
        var root = ValidateEndpoint(endpoint);
        if (string.IsNullOrWhiteSpace(prompt) || prompt.Length > MaxPromptCharacters)
            throw new ArgumentException($"Enter a prompt up to {MaxPromptCharacters:N0} characters.", nameof(prompt));
        if (string.IsNullOrWhiteSpace(workflowTemplate) || workflowTemplate.Length > MaxWorkflowCharacters || !workflowTemplate.Contains("{{prompt}}", StringComparison.Ordinal))
            throw new ArgumentException("Add a ComfyUI API workflow up to 1 MB and put {{prompt}} inside its prompt text value.", nameof(workflowTemplate));

        if ((sourceImageName is null) != (sourceImage is null)) throw new ArgumentException("The source image name and content must be supplied together.");
        if (sourceImage is not null && !workflowTemplate.Contains("{{image}}", StringComparison.Ordinal))
            throw new ArgumentException("The selected workflow must contain {{image}} for its source image input.", nameof(workflowTemplate));
        if (sourceImage is null && workflowTemplate.Contains("{{image}}", StringComparison.Ordinal))
            throw new ArgumentException("Choose a source image for this workflow because it contains {{image}}.", nameof(workflowTemplate));
        var escapedPrompt = JsonSerializer.Serialize(prompt.Trim())[1..^1];
        var workflowWithSeed = workflowTemplate.Replace("{{seed}}", Random.Shared.Next(0, int.MaxValue).ToString(System.Globalization.CultureInfo.InvariantCulture), StringComparison.Ordinal);
        var validationWorkflow = workflowWithSeed
            .Replace("{{image}}", "source.png", StringComparison.Ordinal)
            .Replace("{{prompt}}", escapedPrompt, StringComparison.Ordinal);
        try { using var validationDocument = JsonDocument.Parse(validationWorkflow); }
        catch (JsonException error) { throw new ArgumentException("The ComfyUI workflow is not valid JSON after its inputs were inserted.", nameof(workflowTemplate), error); }
        var workflowSource = workflowWithSeed;
        if (sourceImage is not null)
        {
            if (sourceImage.Length is < 8 or > 6 * 1024 * 1024 || !sourceImageName!.Equals("source.png", StringComparison.OrdinalIgnoreCase) && !sourceImageName.Equals("source.jpg", StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("The source image is invalid or exceeds the 6 MB limit.", nameof(sourceImage));
            if (sourceImageName.EndsWith(".png", StringComparison.OrdinalIgnoreCase) && !ChatAttachmentPolicy.HasValidImageSignature("image/png", sourceImage) || sourceImageName.EndsWith(".jpg", StringComparison.OrdinalIgnoreCase) && !ChatAttachmentPolicy.HasValidImageSignature("image/jpeg", sourceImage))
                throw new ArgumentException("The source image signature is invalid.", nameof(sourceImage));
            using var upload = new MultipartFormDataContent();
            var imageContent = new ByteArrayContent(sourceImage);
            imageContent.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(sourceImageName.EndsWith(".png", StringComparison.OrdinalIgnoreCase) ? "image/png" : "image/jpeg");
            upload.Add(imageContent, "image", sourceImageName);
            using var uploadResponse = await _http.PostAsync(new Uri(root, "upload/image"), upload, cancellationToken).ConfigureAwait(false);
            using var uploadJson = await BoundedHttpContent.ReadJsonAsync(uploadResponse.Content, cancellationToken, "ComfyUI image upload").ConfigureAwait(false);
            if (!uploadResponse.IsSuccessStatusCode || !uploadJson.RootElement.TryGetProperty("name", out var uploadedName) || uploadedName.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(uploadedName.GetString()))
                throw new InvalidOperationException("ComfyUI could not accept the source image.");
            workflowSource = workflowSource.Replace("{{image}}", JsonSerializer.Serialize(uploadedName.GetString())[1..^1], StringComparison.Ordinal);
        }
        JsonElement workflow;
        try { using var document = JsonDocument.Parse(workflowSource.Replace("{{prompt}}", escapedPrompt, StringComparison.Ordinal)); workflow = document.RootElement.Clone(); }
        catch (JsonException error) { throw new ArgumentException("The ComfyUI workflow is not valid JSON after the prompt was inserted.", nameof(workflowTemplate), error); }

        progress?.Invoke("Queueing media workflow with local ComfyUI…");
        using var queueResponse = await _http.PostAsJsonAsync(new Uri(root, "prompt"), new { prompt = workflow, client_id = Guid.NewGuid().ToString("N") }, cancellationToken).ConfigureAwait(false);
        // Once ComfyUI has accepted the POST, finish reading its bounded queue
        // receipt even if the caller cancels. We need the returned prompt ID to
        // remove exactly that already-queued job rather than leaving it running.
        using var queueJson = await BoundedHttpContent.ReadJsonAsync(queueResponse.Content, CancellationToken.None, "ComfyUI queue response").ConfigureAwait(false);
        if (!queueResponse.IsSuccessStatusCode) throw new InvalidOperationException($"ComfyUI could not queue the image ({(int)queueResponse.StatusCode}).");
        if (!queueJson.RootElement.TryGetProperty("prompt_id", out var id) || string.IsNullOrWhiteSpace(id.GetString()) || id.GetString()!.Length > 200)
            throw new InvalidOperationException("ComfyUI accepted the request but returned no usable prompt ID.");
        var promptId = id.GetString()!;

        try
        {
            // Video and music workflows can take substantially longer than a still image.
            for (var attempt = 0; attempt < 1800; attempt++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                progress?.Invoke($"Generating media locally… {attempt + 1}s");
                await Task.Delay(TimeSpan.FromSeconds(1), cancellationToken).ConfigureAwait(false);
                using var historyResponse = await _http.GetAsync(new Uri(root, "history/" + Uri.EscapeDataString(promptId)), cancellationToken).ConfigureAwait(false);
                if (!historyResponse.IsSuccessStatusCode) continue;
                using var history = await BoundedHttpContent.ReadJsonAsync(historyResponse.Content, cancellationToken, "ComfyUI history").ConfigureAwait(false);
                if (!history.RootElement.TryGetProperty(promptId, out var job) || !job.TryGetProperty("outputs", out var outputs)) continue;
                var media = new List<ComfyGeneratedImage>();
                foreach (var output in outputs.EnumerateObject())
                {
                    if (output.Value.ValueKind != JsonValueKind.Object) continue;
                    foreach (var resultSet in output.Value.EnumerateObject())
                    {
                        if (resultSet.Value.ValueKind != JsonValueKind.Array) continue;
                        foreach (var result in resultSet.Value.EnumerateArray())
                        {
                            if (result.ValueKind != JsonValueKind.Object) continue;
                            var file = result.TryGetProperty("filename", out var name) ? name.GetString() : null;
                            if (string.IsNullOrWhiteSpace(file) || file.Length > 512 || file.Contains('/') || file.Contains('\\')) continue;
                            var mediaType = ClassifyMedia(file, modelOutputOnly);
                            if (mediaType is null || modelOutputOnly && mediaType != "model") continue;
                            var subfolder = result.TryGetProperty("subfolder", out var sub) ? sub.GetString() ?? "" : "";
                            if (subfolder.Length > 512 || subfolder.Contains("..", StringComparison.Ordinal) || subfolder.Contains('\\')) continue;
                            var type = result.TryGetProperty("type", out var kind) ? kind.GetString() ?? "output" : "output";
                            if (type is not ("output" or "temp" or "input")) continue;
                            var query = $"view?filename={Uri.EscapeDataString(file)}&subfolder={Uri.EscapeDataString(subfolder)}&type={Uri.EscapeDataString(type)}";
                            var outputUri = new Uri(root, query);
                            var content = modelOutputOnly ? await ReadValidGlbAsync(outputUri, cancellationToken).ConfigureAwait(false) : null;
                            media.Add(new ComfyGeneratedImage(outputUri, file, mediaType, content));
                        }
                    }
                }
                if (media.Count > 0) return media;
                throw new InvalidOperationException("ComfyUI finished without a supported image, video, or audio output.");
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            await CancelQueuedPromptAsync(root, promptId).ConfigureAwait(false);
            throw;
        }
        throw new TimeoutException("Timed out waiting for ComfyUI after 30 minutes.");
    }

    private static string? ClassifyMedia(string fileName, bool includeModel = false)
    {
        var extension = Path.GetExtension(fileName).ToLowerInvariant();
        if (includeModel && extension == ".glb") return "model";
        if (extension is ".png" or ".jpg" or ".jpeg" or ".webp" or ".gif" or ".avif") return "image";
        if (extension is ".mp4" or ".webm" or ".mov" or ".m4v") return "video";
        if (extension is ".wav" or ".mp3" or ".flac" or ".ogg" or ".opus" or ".m4a") return "audio";
        return null;
    }

    private async Task<byte[]> ReadValidGlbAsync(Uri uri, CancellationToken cancellationToken)
    {
        using var response = await _http.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode || response.Content.Headers.ContentLength is > MaxGlbBytes)
            throw new InvalidDataException("ComfyUI returned a GLB larger than the 100 MB asset limit or could not serve it.");
        await using var source = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
        using var buffer = new MemoryStream();
        var chunk = new byte[64 * 1024];
        while (true)
        {
            var read = await source.ReadAsync(chunk, cancellationToken).ConfigureAwait(false);
            if (read == 0) break;
            if (buffer.Length + read > MaxGlbBytes) throw new InvalidDataException("ComfyUI returned a GLB larger than the 100 MB asset limit.");
            buffer.Write(chunk, 0, read);
        }
        var result = buffer.ToArray();
        var bytes = result.AsSpan();
        if (!(bytes.Length >= 12
            && bytes[..4].SequenceEqual("glTF"u8)
            && BinaryPrimitives.ReadUInt32LittleEndian(bytes[4..8]) == 2
            && BinaryPrimitives.ReadUInt32LittleEndian(bytes[8..12]) == bytes.Length))
            throw new InvalidDataException("ComfyUI returned a GLB file with an invalid header or declared length.");
        return result;
    }

    private async Task CancelQueuedPromptAsync(Uri root, string promptId)
    {
        // This app submits the legacy /prompt workflow API, which returns a prompt_id.
        // Delete only that pending prompt and interrupt only that matching execution.
        // Both calls are best effort: local cancellation must remain responsive even
        // when an older or unavailable ComfyUI instance does not support one route.
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        try
        {
            using var remove = await _http.PostAsJsonAsync(new Uri(root, "queue"), new { delete = new[] { promptId } }, timeout.Token).ConfigureAwait(false);
            using var interrupt = await _http.PostAsJsonAsync(new Uri(root, "interrupt"), new { prompt_id = promptId }, timeout.Token).ConfigureAwait(false);
        }
        catch (HttpRequestException) { }
        catch (OperationCanceledException) { }
    }

    private static Uri ValidateEndpoint(string endpoint)
    {
        if (!Uri.TryCreate(endpoint.Trim().TrimEnd('/') + "/", UriKind.Absolute, out var root)
            || root.Scheme is not ("http" or "https")
            || !root.IsLoopback
            || !string.IsNullOrEmpty(root.UserInfo)
            || !string.IsNullOrEmpty(root.Fragment))
            throw new InvalidOperationException("ComfyUI must use a loopback HTTP or HTTPS endpoint.");
        return root;
    }
}
