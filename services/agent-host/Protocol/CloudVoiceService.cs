using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace SkaiDesktop.AgentHost.Protocol;

/// <summary>Explicit user-key cloud speech adapter. It is never used for local voice.</summary>
internal static class CloudVoiceService
{
    private const int MaxAudioBytes = 12 * 1024 * 1024;
    private static readonly HttpClient Client = new() { Timeout = TimeSpan.FromSeconds(45) };

    public static async Task<string> SynthesizeAsync(string endpoint, string voiceId, string apiKey, string text, double rate, CancellationToken cancellationToken = default)
    {
        if (!Uri.TryCreate(endpoint, UriKind.Absolute, out var baseUri) || baseUri.Scheme != Uri.UriSchemeHttps || !baseUri.Host.Equals("api.elevenlabs.io", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Cloud voice must use the official ElevenLabs HTTPS endpoint.");
        if (apiKey.Any(char.IsControl) || apiKey.Length is < 8 or > 512 || voiceId.Any(char.IsControl))
            throw new InvalidOperationException("The cloud voice credentials are invalid.");

        var requestUri = new Uri(baseUri, $"{baseUri.AbsolutePath.TrimEnd('/')}/{Uri.EscapeDataString(voiceId)}?output_format=mp3_44100_128");
        using var request = new HttpRequestMessage(HttpMethod.Post, requestUri);
        request.Headers.TryAddWithoutValidation("xi-api-key", apiKey);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("audio/mpeg"));
        request.Content = new StringContent(JsonSerializer.Serialize(new
        {
            text,
            model_id = "eleven_multilingual_v2",
            voice_settings = new { stability = 0.5, similarity_boost = 0.75, style = Math.Clamp((rate - 1) * 0.4 + 0.2, 0, 1), use_speaker_boost = true },
        }), Encoding.UTF8, "application/json");

        using var response = await Client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            var detail = (await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false)).Trim();
            throw new InvalidOperationException($"ElevenLabs cloud voice failed ({(int)response.StatusCode}).{(detail.Length > 0 ? $" {detail[..Math.Min(detail.Length, 240)]}" : string.Empty)}");
        }
        var bytes = await response.Content.ReadAsByteArrayAsync(cancellationToken).ConfigureAwait(false);
        if (bytes.Length == 0 || bytes.Length > MaxAudioBytes || bytes[0] == 0)
            throw new InvalidOperationException("ElevenLabs returned an invalid or oversized audio response.");
        return $"data:audio/mpeg;base64,{Convert.ToBase64String(bytes)}";
    }
}
