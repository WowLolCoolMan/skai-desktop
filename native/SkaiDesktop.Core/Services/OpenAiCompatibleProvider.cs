// HTTP client for OpenAI-compatible chat servers: streams /chat/completions (SSE)
// and lists /models. Also shapes image attachments for vision models.
// Depends on: AppSettings, ChatMessage, ChatAttachmentPolicy, BoundedHttpContent.
// Used by: Agent Host chat, connection checks, prompt rewriting, and model benchmarks.

using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using SkaiDesktop.Core.Infrastructure;
using SkaiDesktop.Core.Models;

namespace SkaiDesktop.Core.Services;

/// <summary>Transport for local and compatible chat-completions servers.</summary>
public sealed class OpenAiCompatibleProvider(HttpClient? httpClient = null)
{
    private const int MaxMessages = 500;
    private const int MaxMessageCharacters = 1_000_000;
    private const int MaxStreamedResponseCharacters = 1_000_000;
    private const int ContextCompactionBytes = 8_000_000;
    private const int MaxRequestBytes = 32_000_000;
    private const int MaxPlanningCharacters = 32_000_000;

    // The planner budgets characters but the limit is UTF-8 bytes; multi-byte text (accented, Cyrillic,
    // CJK) needs up to 4 bytes per character. Plan, measure the serialized request, and shrink the
    // character budget by the measured ratio until it fits. ASCII histories fit on the first pass.
    private static (IReadOnlyList<ChatMessage> Messages, string Json) CompactToRequestLimit(IReadOnlyList<ChatMessage> messages, Func<IReadOnlyList<ChatMessage>, string> serialize)
    {
        var budget = ContextCompactionBytes - 1_000_000;
        for (var attempt = 0; attempt < 6 && budget > 0; attempt++)
        {
            var planned = ConversationContextPlanner.Plan(messages, budget).Messages;
            var json = serialize(planned);
            var bytes = Encoding.UTF8.GetByteCount(json);
            if (bytes <= MaxRequestBytes) return (planned, json);
            budget = (int)(budget * ((double)MaxRequestBytes / bytes) * 0.9);
        }
        throw new InvalidOperationException("The model request exceeds the 32 MB payload limit after bounded context compaction.");
    }
    private const int MaxModelCharacters = 512;
    private static readonly HttpClient SharedHttp = new() { Timeout = Timeout.InfiniteTimeSpan };
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly HttpClient _http = httpClient ?? SharedHttp;

    public async Task StreamChatAsync(
        AppSettings settings,
        IReadOnlyList<ChatMessage> messages,
        Action<string> onText,
        CancellationToken cancellationToken,
        int? maxTokens = null,
        string? apiKey = null)
    {
        ValidateRequest(settings, messages);
        var modelMessages = ChatAttachmentPrompt.PrepareMessagesForModel(messages);
        ValidateRequest(settings, modelMessages);
        if (settings.ModelProvider.Equals("Ollama", StringComparison.OrdinalIgnoreCase) && settings.OllamaContextWindowTokens > 0)
        {
            await StreamOllamaNativeChatAsync(settings, modelMessages, onText, cancellationToken, maxTokens, apiKey).ConfigureAwait(false);
            return;
        }
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromMinutes(5));
        var requestMessages = modelMessages;
        var requestJson = SerializeRequest(settings, requestMessages, maxTokens);
        if (Encoding.UTF8.GetByteCount(requestJson) > ContextCompactionBytes)
            (requestMessages, requestJson) = CompactToRequestLimit(modelMessages, compacted => SerializeRequest(settings, compacted, maxTokens));
        using var request = new HttpRequestMessage(HttpMethod.Post, BuildChatUri(settings.Endpoint))
        {
            Content = new StringContent(requestJson, Encoding.UTF8, "application/json")
        };
        AddApiKey(request, apiKey);
        using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
        if (!response.IsSuccessStatusCode)
        {
            var body = await BoundedHttpContent.ReadTextAsync(response.Content, timeout.Token, "Model server error", BoundedHttpContent.MaxTextBytes);
            throw new HttpRequestException(
                $"The model server returned {(int)response.StatusCode} {response.ReasonPhrase}. {body}",
                null,
                response.StatusCode);
        }

        await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
        using var reader = new StreamReader(stream);
        var lineReader = BoundedHttpContent.CreateLineReader(reader);
        var receivedContent = false;
        var receivedCharacters = 0;
        while (await lineReader.ReadLineAsync(timeout.Token) is { } line)
        {
            timeout.Token.ThrowIfCancellationRequested();
            if (!line.StartsWith("data:", StringComparison.Ordinal)) continue;
            var data = line[5..].Trim();
            if (data is "[DONE]" or "") continue;

            using var chunk = JsonDocument.Parse(data);
            if (!chunk.RootElement.TryGetProperty("choices", out var choices)
                || choices.ValueKind != JsonValueKind.Array
                || choices.GetArrayLength() == 0
                || !choices[0].TryGetProperty("delta", out var delta)
                || !delta.TryGetProperty("content", out var content)) continue;

            var text = content.ValueKind switch
            {
                JsonValueKind.String => content.GetString(),
                JsonValueKind.Array => string.Join("", content.EnumerateArray()
                    .Where(part => part.TryGetProperty("text", out _))
                    .Select(part => part.GetProperty("text").GetString())),
                _ => null
            };
            if (string.IsNullOrEmpty(text)) continue;
            if (text.Length > MaxStreamedResponseCharacters - receivedCharacters)
                throw new InvalidDataException($"The model response exceeds the {MaxStreamedResponseCharacters:N0}-character limit.");
            receivedCharacters += text.Length;
            receivedContent = true;
            onText(text);
        }
        if (!receivedContent) throw new InvalidOperationException("The model server closed the stream without returning a response.");
    }

    private static object BuildModelContent(ChatMessage message, bool ollamaImageUrlString)
    {
        var images = message.Attachments?.Where(attachment => attachment.IsImage).ToArray() ?? [];
        if (images.Length == 0) return message.Content;
        long totalImageBytes = 0;
        foreach (var image in images)
        {
            if (!ChatAttachmentPolicy.IsAllowedImageMediaType(image.MediaType) ||
                ChatAttachmentPolicy.GetImageMediaType(image.FileName) != image.MediaType)
                throw new InvalidOperationException("An attached image has an unsupported media type. Add a PNG or JPEG image and try again.");
            byte[] bytes;
            try { bytes = Convert.FromBase64String(image.Content); }
            catch (FormatException error) { throw new InvalidOperationException("An attached image is not valid base64 data. Remove it and attach the image again.", error); }
            if (bytes.Length > ChatAttachmentPolicy.MaxFileBytes)
                throw new InvalidOperationException("An attached image exceeds the 2 MB per-image limit. Remove it and attach a smaller image.");
            if (!ChatAttachmentPolicy.HasValidImageSignature(image.MediaType, bytes))
                throw new InvalidOperationException($"{image.FileName} does not contain valid {image.MediaType} image data. Remove it and attach the image again.");
            totalImageBytes += bytes.Length;
        }
        if (totalImageBytes > ChatAttachmentPolicy.MaxTotalImageBytes)
            throw new InvalidOperationException("Attached images exceed the 6 MB total limit. Remove one or more images and try again.");
        var parts = new List<object>();
        if (!string.IsNullOrWhiteSpace(message.Content)) parts.Add(new { type = "text", text = message.Content });
        parts.AddRange(images.Select(image => ollamaImageUrlString
            ? (object)new { type = "image_url", image_url = $"data:{image.MediaType};base64,{image.Content}" }
            : new { type = "image_url", image_url = new { url = $"data:{image.MediaType};base64,{image.Content}", detail = "auto" } }));
        return parts;
    }

    private static string SerializeRequest(AppSettings settings, IReadOnlyList<ChatMessage> messages, int? maxTokens)
    {
        var requestBody = new Dictionary<string, object?>
        {
            ["model"] = settings.Model,
            ["temperature"] = settings.Temperature,
            ["stream"] = true,
            ["messages"] = messages.Select(message => new
            {
                message.Role,
                content = BuildModelContent(message, UsesOllamaImageUrlString(settings))
            }).ToArray()
        };
        if (maxTokens is > 0) requestBody["max_tokens"] = Math.Clamp(maxTokens.Value, 1, 4096);
        if (IsQwen3Model(settings.Model)) requestBody["think"] = false;
        return JsonSerializer.Serialize(requestBody, JsonOptions);
    }

    private async Task StreamOllamaNativeChatAsync(AppSettings settings, IReadOnlyList<ChatMessage> messages, Action<string> onText, CancellationToken cancellationToken, int? maxTokens, string? apiKey)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromMinutes(5));
        var requestMessages = messages;
        var requestJson = SerializeOllamaNativeRequest(settings, requestMessages, maxTokens);
        if (Encoding.UTF8.GetByteCount(requestJson) > ContextCompactionBytes)
            (requestMessages, requestJson) = CompactToRequestLimit(messages, compacted => SerializeOllamaNativeRequest(settings, compacted, maxTokens));
        var endpoint = new Uri(settings.Endpoint.TrimEnd('/') + "/");
        var chatUri = new UriBuilder(endpoint) { Path = "/api/chat", Query = "", Fragment = "" }.Uri;
        using var request = new HttpRequestMessage(HttpMethod.Post, chatUri) { Content = new StringContent(requestJson, Encoding.UTF8, "application/json") };
        AddApiKey(request, apiKey);
        using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            var body = await BoundedHttpContent.ReadTextAsync(response.Content, timeout.Token, "Ollama error", BoundedHttpContent.MaxTextBytes).ConfigureAwait(false);
            throw new HttpRequestException($"Ollama returned {(int)response.StatusCode} {response.ReasonPhrase}. {body}", null, response.StatusCode);
        }
        await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token).ConfigureAwait(false);
        using var reader = new StreamReader(stream);
        var lineReader = BoundedHttpContent.CreateLineReader(reader);
        var receivedCharacters = 0;
        var receivedContent = false;
        while (await lineReader.ReadLineAsync(timeout.Token).ConfigureAwait(false) is { } line)
        {
            timeout.Token.ThrowIfCancellationRequested();
            if (string.IsNullOrWhiteSpace(line)) continue;
            using var chunk = JsonDocument.Parse(line);
            if (chunk.RootElement.TryGetProperty("error", out var error) && error.ValueKind == JsonValueKind.String)
                throw new InvalidOperationException($"Ollama could not run this context window: {error.GetString()}");
            if (!chunk.RootElement.TryGetProperty("message", out var message) || !message.TryGetProperty("content", out var content) || content.ValueKind != JsonValueKind.String) continue;
            var text = content.GetString();
            if (string.IsNullOrEmpty(text)) continue;
            if (text.Length > MaxStreamedResponseCharacters - receivedCharacters)
                throw new InvalidDataException($"The model response exceeds the {MaxStreamedResponseCharacters:N0}-character limit.");
            receivedCharacters += text.Length;
            receivedContent = true;
            onText(text);
        }
        if (!receivedContent) throw new InvalidOperationException("Ollama closed the stream without returning a response.");
    }

    private static string SerializeOllamaNativeRequest(AppSettings settings, IReadOnlyList<ChatMessage> messages, int? maxTokens)
    {
        var options = new Dictionary<string, object?> { ["num_ctx"] = settings.OllamaContextWindowTokens, ["temperature"] = settings.Temperature };
        if (maxTokens is > 0) options["num_predict"] = Math.Clamp(maxTokens.Value, 1, 4096);
        var payload = new Dictionary<string, object?>
        {
            ["model"] = settings.Model,
            ["messages"] = messages.Select(BuildOllamaNativeMessage).ToArray(),
            ["stream"] = true,
            ["options"] = options,
        };
        // Qwen3 exposes internal reasoning on a separate "thinking" channel and
        // enables it by default. Skai streams only message.content, so a short
        // completion budget can be spent entirely on hidden reasoning and look
        // like an empty or failed chat. Keep responses directly usable here;
        // users can still choose a dedicated reasoning model when needed.
        if (IsQwen3Model(settings.Model)) payload["think"] = false;
        return JsonSerializer.Serialize(payload, JsonOptions);
    }

    private static bool IsQwen3Model(string model) =>
        model.Trim().StartsWith("qwen3", StringComparison.OrdinalIgnoreCase);

    private static object BuildOllamaNativeMessage(ChatMessage message)
    {
        var images = message.Attachments?.Where(attachment => attachment.IsImage).ToArray() ?? [];
        if (images.Length == 0) return new { message.Role, message.Content };
        long totalImageBytes = 0;
        foreach (var image in images)
        {
            if (!ChatAttachmentPolicy.IsAllowedImageMediaType(image.MediaType) || ChatAttachmentPolicy.GetImageMediaType(image.FileName) != image.MediaType)
                throw new InvalidOperationException("An attached image has an unsupported media type. Add a PNG or JPEG image and try again.");
            byte[] bytes;
            try { bytes = Convert.FromBase64String(image.Content); }
            catch (FormatException error) { throw new InvalidOperationException("An attached image is not valid base64 data. Remove it and attach it again.", error); }
            if (bytes.Length > ChatAttachmentPolicy.MaxFileBytes || !ChatAttachmentPolicy.HasValidImageSignature(image.MediaType, bytes))
                throw new InvalidOperationException($"{image.FileName} is invalid or exceeds the per-image size limit.");
            totalImageBytes += bytes.Length;
        }
        if (totalImageBytes > ChatAttachmentPolicy.MaxTotalImageBytes)
            throw new InvalidOperationException("Attached images exceed the 6 MB total limit. Remove one or more images and try again.");
        return new { message.Role, message.Content, images = images.Select(image => image.Content).ToArray() };
    }

    private static void ValidateRequest(AppSettings settings, IReadOnlyList<ChatMessage> messages)
    {
        ArgumentNullException.ThrowIfNull(settings);
        ArgumentNullException.ThrowIfNull(messages);
        ModelCapabilityResolver.ValidateMessageCapabilities(settings, messages);
        if (messages.Count is < 1 or > MaxMessages)
            throw new InvalidOperationException($"A chat request must contain between 1 and {MaxMessages} messages.");
        if (string.IsNullOrWhiteSpace(settings.Model) || settings.Model.Length > MaxModelCharacters || settings.Model.Any(char.IsControl))
            throw new InvalidOperationException("The selected model identifier is invalid.");

        var totalCharacters = 0L;
        foreach (var message in messages)
        {
            if (message is null || string.IsNullOrWhiteSpace(message.Role) || message.Role.Length > 64 || message.Role.Any(char.IsControl))
                throw new InvalidOperationException("A chat message contains an invalid role.");
            if (message.Content is null)
                throw new InvalidOperationException("A chat message must contain text.");
            if (message.Content.Length > MaxMessageCharacters)
                throw new InvalidOperationException("A chat message exceeds the 1 MB content limit.");
            totalCharacters += message.Role.Length + message.Content.Length;
            if (message.Attachments is { Count: > ChatAttachmentPolicy.MaxFiles })
                throw new InvalidOperationException($"A chat message can contain at most {ChatAttachmentPolicy.MaxFiles} attachments.");
            foreach (var attachment in message.Attachments ?? [])
            {
                var maxAttachmentCharacters = attachment?.IsImage == true
                    ? ((ChatAttachmentPolicy.MaxFileBytes + 2) / 3) * 4 + 4
                    : ChatAttachmentPolicy.MaxCharactersPerFile;
                if (attachment is null || attachment.Content is null || attachment.Content.Length > maxAttachmentCharacters)
                    throw new InvalidOperationException("A chat attachment exceeds its supported content limit.");
                totalCharacters += attachment.Content.Length;
            }
            if (totalCharacters > MaxPlanningCharacters)
                throw new InvalidOperationException("The model request exceeds the bounded planning limit.");
        }
    }

    private static bool UsesOllamaImageUrlString(AppSettings settings)
    {
        if (settings.VisionApiFormat.Equals("ollama", StringComparison.OrdinalIgnoreCase)) return true;
        if (settings.VisionApiFormat.Equals("openai", StringComparison.OrdinalIgnoreCase)) return false;
        return Uri.TryCreate(settings.Endpoint.Trim().TrimEnd('/'), UriKind.Absolute, out var endpoint) &&
            endpoint.IsLoopback && endpoint.Port == 11434;
    }

    public async Task<IReadOnlyList<string>> DiscoverModelsAsync(string endpoint, CancellationToken cancellationToken = default, string? apiKey = null)
    {
        var profiles = await DiscoverModelProfilesAsync(endpoint, cancellationToken, apiKey);
        return profiles.Select(profile => profile.Model).ToArray();
    }

    public async Task<IReadOnlyList<ProviderModelDescriptor>> DiscoverModelProfilesAsync(string endpoint, CancellationToken cancellationToken = default, string? apiKey = null)
    {
        var root = BuildBaseUri(endpoint);
        var path = root.AbsolutePath.TrimEnd('/');
        var modelsUri = path.EndsWith("/v1", StringComparison.OrdinalIgnoreCase)
            ? new UriBuilder(root) { Path = path + "/models", Query = "" }.Uri
            : new UriBuilder(root) { Path = path + "/v1/models", Query = "" }.Uri;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(15));
        using var request = new HttpRequestMessage(HttpMethod.Get, modelsUri);
        AddApiKey(request, apiKey);
        using var response = await _http.SendAsync(request, timeout.Token);
        response.EnsureSuccessStatusCode();
        using var json = await BoundedHttpContent.ReadJsonAsync(response.Content, timeout.Token, "Model server model list");
        if (!json.RootElement.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Array)
            throw new InvalidOperationException("The provider response did not include a model list.");
        var models = data.EnumerateArray()
            .Select(ParseModelDescriptor)
            .Where(profile => profile is not null)
            .Cast<ProviderModelDescriptor>()
            .DistinctBy(profile => profile.Model, StringComparer.Ordinal)
            .ToArray();
        if (models.Length == 0) throw new InvalidOperationException("The provider returned no models.");
        return models;
    }

    private static ProviderModelDescriptor? ParseModelDescriptor(JsonElement item)
    {
        if (!item.TryGetProperty("id", out var idElement) || idElement.ValueKind != JsonValueKind.String) return null;
        var model = idElement.GetString();
        if (string.IsNullOrWhiteSpace(model) || model.Length > MaxModelCharacters || model.Any(char.IsControl)) return null;
        var capabilities = new List<string>();
        foreach (var propertyName in new[] { "capabilities", "modalities" })
        {
            if (!item.TryGetProperty(propertyName, out var values) || values.ValueKind != JsonValueKind.Array) continue;
            foreach (var value in values.EnumerateArray().Take(16))
            {
                if (value.ValueKind != JsonValueKind.String) continue;
                var capability = value.GetString()?.Trim().ToLowerInvariant();
                if (!string.IsNullOrWhiteSpace(capability) && capability.Length <= 64 && !capability.Any(char.IsControl) && !capabilities.Contains(capability, StringComparer.Ordinal))
                    capabilities.Add(capability);
            }
        }
        var vision = item.TryGetProperty("supports_vision", out var supportsVision) && supportsVision.ValueKind is JsonValueKind.True
            ? CapabilitySupport.Supported
            : capabilities.Any(capability => capability is "vision" or "image" or "images" or "image_input")
                ? CapabilitySupport.Supported
                : CapabilitySupport.Unknown;
        return new(model, vision, capabilities);
    }

    private static Uri BuildChatUri(string endpoint)
    {
        var uri = BuildBaseUri(endpoint);
        var path = uri.AbsolutePath.TrimEnd('/');
        if (!path.EndsWith("/chat/completions", StringComparison.OrdinalIgnoreCase))
        {
            if (!path.EndsWith("/v1", StringComparison.OrdinalIgnoreCase)) path += "/v1";
            path += "/chat/completions";
        }
        return new UriBuilder(uri) { Path = path, Query = "" }.Uri;
    }

    private static Uri BuildBaseUri(string endpoint)
    {
        if (!Uri.TryCreate(endpoint.Trim().TrimEnd('/'), UriKind.Absolute, out var uri)
            || uri.Scheme is not ("http" or "https")
            || !uri.IsLoopback
            || !string.IsNullOrEmpty(uri.UserInfo)
            || !string.IsNullOrEmpty(uri.Fragment))
            throw new InvalidOperationException("Skai Desktop only accepts a local loopback model endpoint without embedded credentials or a URL fragment.");
        return uri;
    }

    private static void AddApiKey(HttpRequestMessage request, string? apiKey)
    {
        if (string.IsNullOrWhiteSpace(apiKey)) return;
        var value = apiKey.Trim();
        if (value.Length > 512 || value.Any(char.IsControl) || value.Contains(' '))
            throw new InvalidOperationException("The provider API key has an invalid format.");
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", value);
    }
}
