using System.Net.Http;
using System.Text.Json;
using SkaiDesktop.Core.Infrastructure;

namespace SkaiDesktop.Core.Services;

public sealed record LocalLoadedModelCapacity(string Runtime, string Model, long? RamBytes, long? GpuBytes);

public sealed record LocalLoadedModelSnapshot(bool Known, IReadOnlyList<LocalLoadedModelCapacity> Models, string? Note);

/// <summary>Reads bounded loaded-model telemetry from runtimes that expose it locally.</summary>
public sealed class LocalRuntimeCapacityProbe(HttpClient? httpClient = null)
{
    private static readonly HttpClient SharedHttp = new() { Timeout = Timeout.InfiniteTimeSpan };
    private readonly HttpClient _http = httpClient ?? SharedHttp;

    public async Task<LocalLoadedModelSnapshot> ReadOllamaLoadedModelsAsync(string endpoint, CancellationToken cancellationToken = default)
    {
        if (!LocalEndpoint.IsLocal(endpoint))
            return new(false, [], "Loaded-model telemetry is available only for a local Ollama endpoint.");
        if (!Uri.TryCreate(endpoint.TrimEnd('/'), UriKind.Absolute, out var configured))
            return new(false, [], "The configured local endpoint is invalid.");

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromMilliseconds(900));
        var uri = new UriBuilder(configured) { Path = "/api/ps", Query = "", Fragment = "" }.Uri;
        try
        {
            using var response = await _http.GetAsync(uri, timeout.Token).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
                return new(false, [], $"Ollama did not expose loaded-model telemetry ({(int)response.StatusCode}).");
            using var json = await BoundedHttpContent.ReadJsonAsync(response.Content, timeout.Token, "Ollama loaded-model response").ConfigureAwait(false);
            if (!json.RootElement.TryGetProperty("models", out var models) || models.ValueKind != JsonValueKind.Array)
                return new(false, [], "Ollama returned no loaded-model telemetry.");

            var loaded = models.EnumerateArray().Take(32).Select(item => new LocalLoadedModelCapacity(
                "Ollama",
                ReadBoundedModelName(item),
                ReadBoundedBytes(item, "size"),
                ReadBoundedBytes(item, "size_vram"))).Where(item => item.Model.Length > 0).ToArray();
            var unknownSizes = loaded.Any(item => item.RamBytes is null && item.GpuBytes is null);
            return new(true, loaded, unknownSizes ? "Ollama reported a loaded model without a bounded size." : null);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return new(false, [], "Ollama loaded-model telemetry timed out.");
        }
        catch (HttpRequestException)
        {
            return new(false, [], "Ollama loaded-model telemetry is unavailable.");
        }
        catch (JsonException)
        {
            return new(false, [], "Ollama returned invalid loaded-model telemetry.");
        }
        catch (InvalidDataException)
        {
            return new(false, [], "Ollama returned oversized loaded-model telemetry.");
        }
    }

    private static string ReadBoundedModelName(JsonElement item)
    {
        foreach (var property in new[] { "name", "model" })
            if (item.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String)
            {
                var text = value.GetString()?.Trim() ?? string.Empty;
                return text.Length <= 512 && text.All(character => !char.IsControl(character)) ? text : string.Empty;
            }
        return string.Empty;
    }

    private static long? ReadBoundedBytes(JsonElement item, string property)
    {
        if (!item.TryGetProperty(property, out var value) || !value.TryGetInt64(out var bytes)) return null;
        return bytes is > 0 and <= (1L << 50) ? bytes : null;
    }
}
