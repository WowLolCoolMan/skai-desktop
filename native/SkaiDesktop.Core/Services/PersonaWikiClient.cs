using System.Text.Json;
using SkaiDesktop.Core.Infrastructure;

namespace SkaiDesktop.Core.Services;

/// <summary>Owns bounded Wikipedia and Fandom requests used during persona research.</summary>
internal sealed class PersonaWikiClient(HttpClient? httpClient = null)
{
    private static readonly HttpClient Shared = new() { Timeout = Timeout.InfiniteTimeSpan };
    private readonly HttpClient _http = httpClient ?? Shared;
    internal async Task<IReadOnlyList<PersonaKnowledgeSources.WikipediaHit>> WikipediaSearchAsync(string query, int limit, CancellationToken cancellationToken)
    {
        var url = $"https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&generator=search&gsrlimit={limit}&gsrsearch={Uri.EscapeDataString(query)}&prop=description";
        using var document = await GetJsonAsync(url, cancellationToken).ConfigureAwait(false);
        if (!document.RootElement.TryGetProperty("query", out var queryElement) || !queryElement.TryGetProperty("pages", out var pages)) return [];
        return pages.EnumerateArray()
            .OrderBy(page => page.TryGetProperty("index", out var index) ? index.GetInt32() : 99)
            .Select(page => new PersonaKnowledgeSources.WikipediaHit(page.GetProperty("title").GetString() ?? string.Empty, page.TryGetProperty("description", out var description) ? description.GetString() ?? string.Empty : string.Empty))
            .Where(hit => hit.Title.Length > 0)
            .ToList();
    }

    internal async Task<IReadOnlyList<PersonaKnowledgeSources.FandomHit>> FandomPageSearchAsync(string query, int limit, CancellationToken cancellationToken)
    {
        var url = $"https://services.fandom.com/unified-search/page-search?query={Uri.EscapeDataString(query)}&lang=en&limit={limit}&namespace=0";
        using var document = await GetJsonAsync(url, cancellationToken).ConfigureAwait(false);
        if (!document.RootElement.TryGetProperty("results", out var results)) return [];
        var hits = new List<PersonaKnowledgeSources.FandomHit>();
        foreach (var result in results.EnumerateArray())
        {
            var title = result.TryGetProperty("title", out var titleElement) ? titleElement.GetString() ?? string.Empty : string.Empty;
            var pageUrl = result.TryGetProperty("url", out var urlElement) ? urlElement.GetString() ?? string.Empty : string.Empty;
            if (title.Length == 0 || !Uri.TryCreate(pageUrl, UriKind.Absolute, out var uri) || !uri.Host.EndsWith(".fandom.com", StringComparison.OrdinalIgnoreCase)) continue;
            var siteName = result.TryGetProperty("sitename", out var site) ? site.GetString() ?? uri.Host : uri.Host;
            var snippet = result.TryGetProperty("content", out var content) ? PersonaHtmlParser.Clean(content.GetString() ?? string.Empty) : string.Empty;
            hits.Add(new(title, uri.Host.ToLowerInvariant(), siteName, snippet.Length > 300 ? snippet[..300] : snippet));
        }
        return hits;
    }

    internal async Task<IReadOnlyList<PersonaKnowledgeSources.FandomCommunity>> CommunitySearchAsync(string query, int limit, CancellationToken cancellationToken)
    {
        var url = $"https://services.fandom.com/unified-search/community-search?query={Uri.EscapeDataString(query)}&lang=en&limit={limit}";
        using var document = await GetJsonAsync(url, cancellationToken).ConfigureAwait(false);
        if (!document.RootElement.TryGetProperty("results", out var results)) return [];
        return results.EnumerateArray()
            .Select(result => (Name: result.TryGetProperty("name", out var name) ? name.GetString() ?? string.Empty : string.Empty, Url: result.TryGetProperty("url", out var link) ? link.GetString() ?? string.Empty : string.Empty))
            .Where(item => Uri.TryCreate(item.Url, UriKind.Absolute, out var uri) && uri.Host.EndsWith(".fandom.com", StringComparison.OrdinalIgnoreCase))
            .Select(item => new PersonaKnowledgeSources.FandomCommunity(item.Name, new Uri(item.Url).Host.ToLowerInvariant()))
            .ToList();
    }

    internal async Task<IReadOnlyList<string>> WikiSearchTitlesAsync(string host, string query, int limit, CancellationToken cancellationToken, string apiPath = "/api.php")
    {
        var url = $"https://{host}{apiPath}?action=query&format=json&list=search&srlimit={limit}&srsearch={Uri.EscapeDataString(query)}";
        using var document = await GetJsonAsync(url, cancellationToken).ConfigureAwait(false);
        if (!document.RootElement.TryGetProperty("query", out var queryElement) || !queryElement.TryGetProperty("search", out var search)) return [];
        return search.EnumerateArray().Select(item => item.GetProperty("title").GetString() ?? string.Empty).Where(title => title.Length > 0).ToList();
    }

    internal async Task<int> PageLengthAsync(string host, string title, CancellationToken cancellationToken)
    {
        var url = $"https://{host}/api.php?action=query&format=json&formatversion=2&redirects=1&prop=info&titles={Uri.EscapeDataString(title)}";
        using var document = await GetJsonAsync(url, cancellationToken).ConfigureAwait(false);
        if (!document.RootElement.TryGetProperty("query", out var queryElement) || !queryElement.TryGetProperty("pages", out var pages)) return 0;
        return pages.EnumerateArray().Select(page => page.TryGetProperty("length", out var length) ? length.GetInt32() : 0).FirstOrDefault();
    }

    internal async Task<string?> ParseHtmlAsync(string host, string apiPath, string title, CancellationToken cancellationToken)
    {
        var url = $"https://{host}{apiPath}?action=parse&format=json&prop=text&redirects=1&disablelimitreport=1&disableeditsection=1&page={Uri.EscapeDataString(title)}";
        using var document = await GetJsonAsync(url, cancellationToken).ConfigureAwait(false);
        if (!document.RootElement.TryGetProperty("parse", out var parse) || !parse.TryGetProperty("text", out var text)) return null;
        return text.ValueKind == JsonValueKind.Object && text.TryGetProperty("*", out var body) ? body.GetString() : text.GetString();
    }

    // Wikimedia asks API clients to identify themselves with a contact URL and to keep request
    // rates low; anonymous-looking agents are throttled hard (HTTP 429). Fandom has no such rule
    // but gets the same courtesy.
    private const string ResearchUserAgent = "SkaiDesktop/1.0 (+https://github.com/WowLolCoolMan/skai-desktop; persona research)";
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, SemaphoreSlim> HostGates = new(StringComparer.OrdinalIgnoreCase);

    internal async Task<JsonDocument> GetJsonAsync(string url, CancellationToken cancellationToken)
    {
        var host = new Uri(url).Host;
        var gate = HostGates.GetOrAdd(host.EndsWith(".fandom.com", StringComparison.OrdinalIgnoreCase) ? "fandom" : host, _ => new SemaphoreSlim(2, 2));
        await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            for (var attempt = 0; ; attempt++)
            {
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                timeout.CancelAfter(TimeSpan.FromSeconds(12));
                using var request = new HttpRequestMessage(HttpMethod.Get, url);
                request.Headers.UserAgent.ParseAdd(ResearchUserAgent);
                request.Headers.TryAddWithoutValidation("Api-User-Agent", ResearchUserAgent);
                using var response = await _http.SendAsync(request, timeout.Token).ConfigureAwait(false);
                if ((int)response.StatusCode == 429 && attempt == 0)
                {
                    var wait = response.Headers.RetryAfter?.Delta ?? TimeSpan.FromSeconds(1.5);
                    await Task.Delay(wait > TimeSpan.FromSeconds(4) ? TimeSpan.FromSeconds(4) : wait, cancellationToken).ConfigureAwait(false);
                    continue;
                }
                response.EnsureSuccessStatusCode();
                return await BoundedHttpContent.ReadJsonAsync(response.Content, timeout.Token, "Persona knowledge source").ConfigureAwait(false);
            }
        }
        finally { gate.Release(); }
    }

    internal async Task<IReadOnlyList<T>> Quietly<T>(Func<Task<IReadOnlyList<T>>> action)
    {
        try { return await action().ConfigureAwait(false); }
        catch (Exception error) when (error is HttpRequestException or OperationCanceledException or InvalidDataException or JsonException or KeyNotFoundException or InvalidOperationException) { return []; }
    }

    internal async Task<T> Quietly<T>(Func<Task<T>> action, T fallback)
    {
        try { return await action().ConfigureAwait(false); }
        catch (Exception error) when (error is HttpRequestException or OperationCanceledException or InvalidDataException or JsonException or KeyNotFoundException or InvalidOperationException) { return fallback; }
    }
}
