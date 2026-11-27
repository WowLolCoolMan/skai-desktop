using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Text.Json;
using SkaiDesktop.Core.Infrastructure;

namespace SkaiDesktop.Core.Services;

public sealed record InternetMarketplaceItem(
    string Id,
    string Name,
    string Category,
    string Source,
    string Description,
    string SourceUrl,
    string? License,
    long? Downloads,
    int? Likes,
    string[] Tags,
    bool Installable);

public sealed record InternetMarketplaceSearchResult(
    string Category,
    string Query,
    int Page,
    int PageSize,
    bool HasMore,
    IReadOnlyDictionary<string, string> Providers,
    IReadOnlyList<InternetMarketplaceItem> Items,
    DateTimeOffset FetchedAtUtc);

/// <summary>
/// Bounded discovery over public registries. Discovery is intentionally separate
/// from install adapters: a result can be visible online without being executable
/// or safe to install through Skai.
/// </summary>
public sealed class InternetMarketplaceService(HttpClient? httpClient = null)
{
    private const int PageSize = 24;
    private static readonly HttpClient SharedHttp = new() { Timeout = Timeout.InfiniteTimeSpan };
    private static readonly ConcurrentDictionary<string, CacheEntry> Cache = new(StringComparer.OrdinalIgnoreCase);
    private readonly HttpClient _http = httpClient ?? SharedHttp;

    public async Task<InternetMarketplaceSearchResult> SearchAsync(string category, string query, int page = 1, CancellationToken cancellationToken = default)
    {
        var normalizedCategory = NormalizeCategory(category);
        var normalizedQuery = NormalizeQuery(query);
        page = Math.Clamp(page, 1, 100);
        var cacheKey = $"{normalizedCategory}|{normalizedQuery}|{page}";
        if (Cache.TryGetValue(cacheKey, out var cached) && cached.ExpiresAtUtc > DateTimeOffset.UtcNow)
            return cached.Result;

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(12));
        var items = new List<InternetMarketplaceItem>();
        var providers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var searches = new List<Task<(string Provider, IReadOnlyList<InternetMarketplaceItem> Items)>>();

        if (normalizedCategory is "all" or "llm" or "image" or "voice")
            searches.Add(SearchHuggingFaceAsync(normalizedCategory, normalizedQuery, page, timeout.Token));
        if (normalizedCategory is "all" or "skills" or "tools" or "mcp")
            searches.Add(SearchGitHubAsync(normalizedCategory, normalizedQuery, page, timeout.Token));
        if (normalizedCategory is "all" or "mcp")
            searches.Add(SearchMcpRegistryAsync(normalizedQuery, page, timeout.Token));

        foreach (var search in searches)
        {
            try
            {
                var providerResult = await search.ConfigureAwait(false);
                providers[providerResult.Provider] = "ready";
                items.AddRange(providerResult.Items);
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { }
            catch (HttpRequestException error) { providers[ProviderFor(search)] = error.Message; }
            catch (JsonException error) { providers[ProviderFor(search)] = error.Message; }
            catch (InvalidDataException error) { providers[ProviderFor(search)] = error.Message; }
        }

        var distinct = items
            .GroupBy(item => item.Id, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.OrderByDescending(item => item.Downloads ?? 0).First())
            .OrderByDescending(item => item.Downloads ?? 0)
            .ThenBy(item => item.Name, StringComparer.OrdinalIgnoreCase)
            .ToArray();
        var searchResult = new InternetMarketplaceSearchResult(
            normalizedCategory,
            normalizedQuery,
            page,
            PageSize,
            distinct.Length >= PageSize,
            providers,
            distinct,
            DateTimeOffset.UtcNow);
        Cache[cacheKey] = new(searchResult, DateTimeOffset.UtcNow.AddSeconds(45));
        return searchResult;
    }

    private async Task<(string Provider, IReadOnlyList<InternetMarketplaceItem> Items)> SearchHuggingFaceAsync(string category, string query, int page, CancellationToken cancellationToken)
    {
        var tags = category switch
        {
            "llm" => new[] { "text-generation" },
            "image" => new[] { "text-to-image", "image-to-image", "image-to-video" },
            "voice" => new[] { "text-to-speech", "automatic-speech-recognition", "text-to-audio" },
            _ => new[] { "text-generation", "text-to-image", "text-to-speech" },
        };
        var searches = tags.Select(tag => SearchHuggingFaceTagAsync(category, tag, query, page, cancellationToken));
        var responses = await Task.WhenAll(searches).ConfigureAwait(false);
        return ("Hugging Face", responses.SelectMany(items => items).ToArray());
    }

    private async Task<IReadOnlyList<InternetMarketplaceItem>> SearchHuggingFaceTagAsync(string category, string pipelineTag, string query, int page, CancellationToken cancellationToken)
    {
        var queryParts = new List<string>();
        if (!string.IsNullOrWhiteSpace(query)) queryParts.Add(query);
        var uri = new Uri("https://huggingface.co/api/models?pipeline_tag=" + Uri.EscapeDataString(pipelineTag)
            + "&search=" + Uri.EscapeDataString(string.Join(' ', queryParts))
            + $"&sort=downloads&direction=-1&limit={PageSize}&full=true&page={page}");
        using var request = new HttpRequestMessage(HttpMethod.Get, uri);
        AddHeaders(request, "Skai internet model discovery");
        using var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
        using var json = await BoundedHttpContent.ReadJsonAsync(response.Content, cancellationToken, "Hugging Face model catalog response").ConfigureAwait(false);
        if (json.RootElement.ValueKind != JsonValueKind.Array) return [];
        return json.RootElement.EnumerateArray()
            .Select(item => ParseHuggingFaceItem(item, category, pipelineTag))
            .Where(item => item is not null)
            .Select(item => item!)
            .ToArray();
    }

    private async Task<(string Provider, IReadOnlyList<InternetMarketplaceItem> Items)> SearchGitHubAsync(string category, string query, int page, CancellationToken cancellationToken)
    {
        var categoryQuery = category switch
        {
            "skills" => "(agent-skill OR codex-skill OR claude-skill)",
            "mcp" => "(mcp OR \"model context protocol\")",
            _ => "(ai-agent OR agent-tool OR automation)",
        };
        var search = string.IsNullOrWhiteSpace(query) ? categoryQuery : $"{query} {categoryQuery}";
        var uri = new Uri("https://api.github.com/search/repositories?q=" + Uri.EscapeDataString(search)
            + $"&sort=stars&order=desc&per_page={PageSize}&page={page}");
        using var request = new HttpRequestMessage(HttpMethod.Get, uri);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        AddHeaders(request, "Skai internet repository discovery");
        var token = Environment.GetEnvironmentVariable("GITHUB_TOKEN");
        if (!string.IsNullOrWhiteSpace(token)) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token.Trim());
        using var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
        using var json = await BoundedHttpContent.ReadJsonAsync(response.Content, cancellationToken, "GitHub repository search response").ConfigureAwait(false);
        if (!json.RootElement.TryGetProperty("items", out var items) || items.ValueKind != JsonValueKind.Array) return ("GitHub", []);
        return ("GitHub", items.EnumerateArray().Select(item => ParseGitHubItem(item, category)).Where(item => item is not null).Select(item => item!).ToArray());
    }

    private async Task<(string Provider, IReadOnlyList<InternetMarketplaceItem> Items)> SearchMcpRegistryAsync(string query, int page, CancellationToken cancellationToken)
    {
        string? cursor = null;
        IReadOnlyList<InternetMarketplaceItem> results = [];
        for (var currentPage = 1; currentPage <= page; currentPage++)
        {
            var queryString = $"limit={PageSize}&version=latest";
            if (query.Length >= 3) queryString += "&search=" + Uri.EscapeDataString(query);
            if (!string.IsNullOrWhiteSpace(cursor)) queryString += "&cursor=" + Uri.EscapeDataString(cursor);
            var uri = new Uri("https://registry.modelcontextprotocol.io/v0.1/servers?" + queryString);
            using var request = new HttpRequestMessage(HttpMethod.Get, uri);
            AddHeaders(request, "Skai official MCP registry discovery");
            using var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
            response.EnsureSuccessStatusCode();
            using var json = await BoundedHttpContent.ReadJsonAsync(response.Content, cancellationToken, "MCP Registry response").ConfigureAwait(false);
            if (!json.RootElement.TryGetProperty("servers", out var servers) || servers.ValueKind != JsonValueKind.Array) return ("Official MCP Registry", []);
            results = servers.EnumerateArray().Select(ParseMcpRegistryItem).Where(item => item is not null).Select(item => item!).ToArray();
            cursor = json.RootElement.TryGetProperty("metadata", out var metadata) && metadata.ValueKind == JsonValueKind.Object ? StringProperty(metadata, "nextCursor") : null;
            if (currentPage < page && string.IsNullOrWhiteSpace(cursor)) break;
        }
        return ("Official MCP Registry", results);
    }

    private static InternetMarketplaceItem? ParseHuggingFaceItem(JsonElement item, string category, string pipelineTag)
    {
        var id = StringProperty(item, "id");
        if (string.IsNullOrWhiteSpace(id) || id.Length > 256 || !id.Contains('/')) return null;
        var tags = ArrayProperty(item, "tags");
        var license = item.TryGetProperty("cardData", out var card) && card.ValueKind == JsonValueKind.Object ? StringProperty(card, "license") : tags.FirstOrDefault(tag => tag.StartsWith("license:", StringComparison.OrdinalIgnoreCase))?.Split(':', 2).Last();
        var description = StringProperty(item, "pipeline_tag") ?? pipelineTag;
        var name = id.Split('/').Last();
        var downloads = LongProperty(item, "downloads");
        var likes = IntProperty(item, "likes");
        return new($"huggingface:{id}", name, category switch { "llm" => "LLM models", "image" => "Image models", _ => "Voice models" }, "Hugging Face", $"{description} · {string.Join(" · ", tags.Take(6))}", $"https://huggingface.co/{id}", license, downloads, likes, tags, false);
    }

    private static InternetMarketplaceItem? ParseGitHubItem(JsonElement item, string category)
    {
        var fullName = StringProperty(item, "full_name");
        if (string.IsNullOrWhiteSpace(fullName)) return null;
        var name = StringProperty(item, "name") ?? fullName;
        var description = StringProperty(item, "description") ?? "No description published.";
        var stars = IntProperty(item, "stargazers_count");
        var sourceUrl = StringProperty(item, "html_url") ?? $"https://github.com/{fullName}";
        return new($"github:{fullName}", name, category switch { "skills" => "Skills", "mcp" => "MCP servers", _ => "Developer tools" }, "GitHub", description, sourceUrl, null, stars, stars, ArrayProperty(item, "topics"), false);
    }

    private static InternetMarketplaceItem? ParseMcpRegistryItem(JsonElement item)
    {
        if (!item.TryGetProperty("server", out var server) || server.ValueKind != JsonValueKind.Object) return null;
        var name = StringProperty(server, "name");
        if (string.IsNullOrWhiteSpace(name)) return null;
        var title = StringProperty(server, "title") ?? name.Split('/').Last();
        var description = StringProperty(server, "description") ?? "MCP server published to the official registry.";
        var version = StringProperty(server, "version");
        var repository = server.TryGetProperty("repository", out var repo) && repo.ValueKind == JsonValueKind.Object ? StringProperty(repo, "url") : null;
        var registryUrl = $"https://registry.modelcontextprotocol.io/v0.1/servers/{Uri.EscapeDataString(name)}/versions/{Uri.EscapeDataString(version ?? "latest")}";
        var tags = new List<string>();
        if (!string.IsNullOrWhiteSpace(version)) tags.Add($"version:{version}");
        if (server.TryGetProperty("packages", out var packages) && packages.ValueKind == JsonValueKind.Array)
            tags.AddRange(packages.EnumerateArray().Select(package => StringProperty(package, "registryType")).Where(value => !string.IsNullOrWhiteSpace(value)).Select(value => $"package:{value}"));
        return new($"mcp-registry:{name}:{version}", title, "MCP servers", "Official MCP Registry", description, repository ?? registryUrl, null, null, null, tags.Distinct(StringComparer.OrdinalIgnoreCase).Take(12).ToArray(), false);
    }

    private static string NormalizeCategory(string value) => value.Trim().ToLowerInvariant() switch
    {
        "llm" or "llms" or "models" => "llm",
        "image" or "images" => "image",
        "voice" or "voices" or "audio" => "voice",
        "skill" or "skills" => "skills",
        "tool" or "tools" or "plugin" or "plugins" => "tools",
        "mcp" or "mcp servers" or "servers" => "mcp",
        "all" or "" => "all",
        _ => throw new ArgumentException("Choose all, LLM, image, voice, skills, tools, or MCP.", nameof(value)),
    };

    private static string NormalizeQuery(string value)
    {
        var query = value.Trim();
        if (query.Length > 160) throw new ArgumentException("Internet Marketplace searches are limited to 160 characters.", nameof(value));
        return query;
    }

    private static void AddHeaders(HttpRequestMessage request, string product)
    {
        request.Headers.UserAgent.ParseAdd($"SkaiDesktop/1.0 ({product})");
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
    }

    private static string ProviderFor(Task<(string Provider, IReadOnlyList<InternetMarketplaceItem> Items)> task) => task.Status == TaskStatus.RanToCompletion ? task.Result.Provider : "Internet registry";
    private static string? StringProperty(JsonElement value, string name) => value.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.String ? property.GetString() : null;
    private static long? LongProperty(JsonElement value, string name) => value.TryGetProperty(name, out var property) && property.TryGetInt64(out var result) ? result : null;
    private static int? IntProperty(JsonElement value, string name) => value.TryGetProperty(name, out var property) && property.TryGetInt32(out var result) ? result : null;
    private static string[] ArrayProperty(JsonElement value, string name) => value.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.Array ? property.EnumerateArray().Where(item => item.ValueKind == JsonValueKind.String).Select(item => item.GetString() ?? string.Empty).Where(item => item.Length > 0).Take(24).ToArray() : [];

    private sealed record CacheEntry(InternetMarketplaceSearchResult Result, DateTimeOffset ExpiresAtUtc);
}
