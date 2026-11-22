using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace SkaiDesktop.AgentHost.Protocol;

/// <summary>Explicit user-key cloud speech adapters. Keys are accepted per request and never persisted.</summary>
internal static class CloudVoiceService
{
    private const int MaxAudioBytes = 12 * 1024 * 1024;
    private static readonly HttpClient Client = new() { Timeout = TimeSpan.FromSeconds(45) };

    public static async Task<string> SynthesizeAsync(string provider, string endpoint, string modelId, string voiceId, string apiKey, string text, double rate, CancellationToken cancellationToken = default)
    {
        if (apiKey.Any(char.IsControl) || apiKey.Length is < 8 or > 512 || voiceId.Any(char.IsControl) || modelId.Any(char.IsControl))
            throw new InvalidOperationException("The cloud voice credentials are invalid.");
        if (!Uri.TryCreate(endpoint, UriKind.Absolute, out var baseUri) || baseUri.Scheme != Uri.UriSchemeHttps)
            throw new InvalidOperationException("Cloud voice must use an official HTTPS endpoint.");

        var normalizedProvider = provider.Trim().ToLowerInvariant();
        using var request = new HttpRequestMessage(HttpMethod.Post, baseUri);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("audio/mpeg"));
        object payload;
        string audioMime;
        switch (normalizedProvider)
        {
            case "elevenlabs":
                RequireEndpoint(baseUri, "api.elevenlabs.io", "/v1/text-to-speech");
                request.Headers.TryAddWithoutValidation("xi-api-key", apiKey);
                request.RequestUri = new Uri(baseUri, $"{baseUri.AbsolutePath.TrimEnd('/')}/{Uri.EscapeDataString(voiceId)}?output_format=mp3_44100_128");
                payload = new { text, model_id = string.IsNullOrWhiteSpace(modelId) ? "eleven_v4" : modelId, voice_settings = new { stability = 0.5, similarity_boost = 0.75, style = Math.Clamp((rate - 1) * 0.4 + 0.2, 0, 1), use_speaker_boost = true } };
                audioMime = "audio/mpeg";
                break;
            case "inworld":
                RequireEndpoint(baseUri, "api.inworld.ai", "/v1/audio/speech");
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
                payload = new { model = string.IsNullOrWhiteSpace(modelId) ? "inworld-tts-2" : modelId, voice = voiceId, input = text, response_format = "mp3", speed = Math.Clamp(rate, 0.5, 2) };
                audioMime = "audio/mpeg";
                break;
            case "cartesia":
                RequireEndpoint(baseUri, "api.cartesia.ai", "/tts/bytes");
                request.Headers.TryAddWithoutValidation("X-API-Key", apiKey);
                request.Headers.TryAddWithoutValidation("Cartesia-Version", "2026-08-14");
                payload = new { model_id = string.IsNullOrWhiteSpace(modelId) ? "sonic-3.5" : modelId, transcript = text, voice = new { mode = "id", id = voiceId }, output_format = new { container = "mp3", sample_rate = 44_100, bit_rate = 128_000 }, language = "en", generation_config = new { speed = Math.Clamp(rate, 0.5, 2) } };
                audioMime = "audio/mpeg";
                break;
            default:
                throw new InvalidOperationException("That cloud voice provider is not supported by this build.");
        }
        request.Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");

        using var response = await Client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            var detail = (await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false)).Trim();
            throw new InvalidOperationException($"{normalizedProvider} cloud voice failed ({(int)response.StatusCode}).{(detail.Length > 0 ? $" {detail[..Math.Min(detail.Length, 240)]}" : string.Empty)}");
        }
        var bytes = await response.Content.ReadAsByteArrayAsync(cancellationToken).ConfigureAwait(false);
        if (bytes.Length == 0 || bytes.Length > MaxAudioBytes || bytes[0] == 0)
            throw new InvalidOperationException($"{normalizedProvider} returned an invalid or oversized audio response.");
        var responseMime = response.Content.Headers.ContentType?.MediaType;
        return $"data:{(string.IsNullOrWhiteSpace(responseMime) ? audioMime : responseMime)};base64,{Convert.ToBase64String(bytes)}";
    }

    private static void RequireEndpoint(Uri endpoint, string host, string pathPrefix)
    {
        if (!endpoint.Host.Equals(host, StringComparison.OrdinalIgnoreCase) || !endpoint.AbsolutePath.StartsWith(pathPrefix, StringComparison.OrdinalIgnoreCase) || !string.IsNullOrEmpty(endpoint.UserInfo) || !string.IsNullOrEmpty(endpoint.Fragment))
            throw new InvalidOperationException("Cloud voice must use the provider's official HTTPS endpoint.");
    }
}
