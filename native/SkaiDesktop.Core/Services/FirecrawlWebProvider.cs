using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using SkaiDesktop.Core.Infrastructure;

namespace SkaiDesktop.Core.Services;

/// <summary>
/// Optional Firecrawl adapter. It discovers a local Firecrawl Local server on
/// loopback and never persists credentials. Set SKAI_FIRECRAWL_ENDPOINT to use
/// another operator-configured endpoint and FIRECRAWL_API_KEY for cloud routes.
/// </summary>
internal sealed class FirecrawlWebProvider
{
    private const string DefaultEndpoint = "http://127.0.0.1:3002";
    private readonly HttpClient _http;
    private readonly Uri _endpoint;

    public FirecrawlWebProvider(HttpClient http)
    {
        _http = http;
        _endpoint = ResolveEndpoint();
    }

    public async Task<bool> IsAvailableAsync(CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromMilliseconds(350));
        try
        {
            using var response = await _http.GetAsync(new Uri(_endpoint, "health"), timeout.Token).ConfigureAwait(false);
            return response.IsSuccessStatusCode;
        }
        catch (HttpRequestException) { return false; }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { return false; }
    }

    public async Task<IReadOnlyList<WebSearchResult>> SearchAsync(string query, CancellationToken cancellationToken)
    {
        using var request = CreateRequest(HttpMethod.Post, "v2/search", new { query, limit = 6 });
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(12));
        using var response = await _http.SendAsync(request, timeout.Token).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode) return [];
        using var json = await ReadJsonAsync(response, timeout.Token).ConfigureAwait(false);
        var results = new List<WebSearchResult>();
        foreach (var item in EnumerateSearchItems(json.RootElement))
        {
            var url = GetString(item, "url");
            if (!Uri.TryCreate(url, UriKind.Absolute, out var parsed) || parsed.Scheme is not ("http" or "https")) continue;
            var title = Clean(GetString(item, "title") ?? parsed.Host, 200);
            var snippet = Clean(GetString(item, "description") ?? GetString(item, "snippet") ?? "Firecrawl search result.", 700);
            if (title.Length == 0) continue;
            results.Add(new(title, parsed.AbsoluteUri, snippet));
            if (results.Count >= 6) break;
        }
        return results;
    }

    public async Task<WebPageText?> FetchTextAsync(string url, CancellationToken cancellationToken)
    {
        using var request = CreateRequest(HttpMethod.Post, "v2/scrape", new { url, formats = new[] { "markdown" }, onlyMainContent = true });
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(20));
        using var response = await _http.SendAsync(request, timeout.Token).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode) return null;
        using var json = await ReadJsonAsync(response, timeout.Token).ConfigureAwait(false);
        if (!json.RootElement.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Object) return null;
        var markdown = GetString(data, "markdown") ?? GetString(data, "content");
        if (string.IsNullOrWhiteSpace(markdown)) return null;
        var title = GetString(data, "title");
        if (data.TryGetProperty("metadata", out var metadata) && metadata.ValueKind == JsonValueKind.Object)
            title ??= GetString(metadata, "title");
        title ??= new Uri(url).Host;
        return new WebPageText(Clean(title, 300), CleanMarkdown(markdown, 20_000))
        {
            SourceType = "firecrawl",
            EvidenceQuality = "firecrawl-extracted",
        };
    }

    private HttpRequestMessage CreateRequest(HttpMethod method, string path, object body)
    {
        var request = new HttpRequestMessage(method, new Uri(_endpoint, path));
        request.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        var key = Environment.GetEnvironmentVariable("FIRECRAWL_API_KEY");
        if (!string.IsNullOrWhiteSpace(key)) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key.Trim());
        return request;
    }

    private static Uri ResolveEndpoint()
    {
        var configured = Environment.GetEnvironmentVariable("SKAI_FIRECRAWL_ENDPOINT")?.Trim();
        var value = string.IsNullOrWhiteSpace(configured) ? DefaultEndpoint : configured;
        if (!Uri.TryCreate(value, UriKind.Absolute, out var endpoint) || endpoint.Scheme is not ("http" or "https") || !string.IsNullOrEmpty(endpoint.Query) || !string.IsNullOrEmpty(endpoint.Fragment))
            return new Uri(DefaultEndpoint + "/", UriKind.Absolute);
        return new Uri(endpoint.AbsoluteUri.TrimEnd('/') + "/", UriKind.Absolute);
    }

    private static IEnumerable<JsonElement> EnumerateSearchItems(JsonElement root)
    {
        if (!root.TryGetProperty("data", out var data)) yield break;
        if (data.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in data.EnumerateArray()) yield return item;
            yield break;
        }
        if (data.ValueKind == JsonValueKind.Object && data.TryGetProperty("web", out var web) && web.ValueKind == JsonValueKind.Array)
            foreach (var item in web.EnumerateArray()) yield return item;
    }

    private static async Task<JsonDocument> ReadJsonAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        var text = await BoundedHttpContent.ReadTextAsync(response.Content, cancellationToken, "Firecrawl response").ConfigureAwait(false);
        return JsonDocument.Parse(text);
    }

    private static string? GetString(JsonElement value, string property) => value.TryGetProperty(property, out var item) && item.ValueKind == JsonValueKind.String ? item.GetString() : null;

    private static string Clean(string value, int maxLength)
    {
        var cleaned = string.Join(' ', value.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)).Trim();
        return cleaned.Length <= maxLength ? cleaned : cleaned[..maxLength] + "…";
    }

    private static string CleanMarkdown(string value, int maxLength)
    {
        var cleaned = value.Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n');
        cleaned = string.Join("\n", cleaned.Split('\n').Select(line => line.TrimEnd())).Trim();
        return cleaned.Length <= maxLength ? cleaned : cleaned[..maxLength] + "…";
    }
}
