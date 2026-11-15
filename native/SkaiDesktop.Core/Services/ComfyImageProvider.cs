// Image Studio back end: queues a user-supplied ComfyUI workflow on a loopback-only
// endpoint, polls for the result, and returns image URLs.
// Depends on: HttpClient, BoundedHttpContent. Used by: the Electron Image Studio through the Agent Host.

using System.Net.Http.Json;
using System.Text.Json;
using SkaiDesktop.Core.Infrastructure;

namespace SkaiDesktop.Core.Services;

public sealed record ComfyGeneratedImage(Uri Url, string FileName);

/// <summary>Queues an explicitly configured workflow on a local ComfyUI server.</summary>
public sealed class ComfyImageProvider(HttpClient? httpClient = null)
{
    private const int MaxWorkflowCharacters = 1_000_000;
    private const int MaxPromptCharacters = 8_000;
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

    public async Task<IReadOnlyList<ComfyGeneratedImage>> GenerateAsync(string endpoint, string workflowTemplate, string prompt, Action<string>? progress = null, CancellationToken cancellationToken = default, string? sourceImageName = null, byte[]? sourceImage = null)
    {
        var root = ValidateEndpoint(endpoint);
        if (string.IsNullOrWhiteSpace(prompt) || prompt.Length > MaxPromptCharacters)
            throw new ArgumentException($"Enter an image prompt up to {MaxPromptCharacters:N0} characters.", nameof(prompt));
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

        progress?.Invoke("Queueing image with local ComfyUI…");
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
            for (var attempt = 0; attempt < 180; attempt++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                progress?.Invoke($"Generating image locally… {attempt + 1}s");
                await Task.Delay(TimeSpan.FromSeconds(1), cancellationToken).ConfigureAwait(false);
                using var historyResponse = await _http.GetAsync(new Uri(root, "history/" + Uri.EscapeDataString(promptId)), cancellationToken).ConfigureAwait(false);
                if (!historyResponse.IsSuccessStatusCode) continue;
                using var history = await BoundedHttpContent.ReadJsonAsync(historyResponse.Content, cancellationToken, "ComfyUI history").ConfigureAwait(false);
                if (!history.RootElement.TryGetProperty(promptId, out var job) || !job.TryGetProperty("outputs", out var outputs)) continue;
                var images = new List<ComfyGeneratedImage>();
                foreach (var output in outputs.EnumerateObject())
                {
                    if (!output.Value.TryGetProperty("images", out var values) || values.ValueKind != JsonValueKind.Array) continue;
                    foreach (var image in values.EnumerateArray())
                    {
                        var file = image.TryGetProperty("filename", out var name) ? name.GetString() : null;
                        if (string.IsNullOrWhiteSpace(file) || file.Length > 512 || file.Contains('/') || file.Contains('\\')) continue;
                        var subfolder = image.TryGetProperty("subfolder", out var sub) ? sub.GetString() ?? "" : "";
                        if (subfolder.Contains("..", StringComparison.Ordinal) || subfolder.Contains('\\')) continue;
                        var type = image.TryGetProperty("type", out var kind) ? kind.GetString() ?? "output" : "output";
                        var query = $"view?filename={Uri.EscapeDataString(file)}&subfolder={Uri.EscapeDataString(subfolder)}&type={Uri.EscapeDataString(type)}";
                        images.Add(new ComfyGeneratedImage(new Uri(root, query), file));
                    }
                }
                if (images.Count > 0) return images;
                throw new InvalidOperationException("ComfyUI finished without returning an image output.");
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            await CancelQueuedPromptAsync(root, promptId).ConfigureAwait(false);
            throw;
        }
        throw new TimeoutException("Timed out waiting for ComfyUI after 3 minutes.");
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
