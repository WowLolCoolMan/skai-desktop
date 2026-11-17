// Opt-in web search: fetches DuckDuckGo's HTML results page and extracts a few
// title/URL/snippet results. Does not open the result pages.
// Depends on: HttpClient, BoundedHttpContent. Used by Agent Host chat when web search is enabled.

using System.Net;
using System.Text.RegularExpressions;
using System.Text.Json;
using SkaiDesktop.Core.Infrastructure;
using SkaiDesktop.Core.Models;

namespace SkaiDesktop.Core.Services;

public sealed record WebSearchResult(string Title, string Url, string Snippet);
public sealed record WebPageText(string Title, string Text)
{
    public string? PublishedDate { get; init; }
    public string? SourceType { get; init; }
}

/// <summary>Small opt-in web search adapter using DuckDuckGo's public HTML search results.</summary>
public sealed class WebSearchProvider(HttpClient? httpClient = null)
{
    private static readonly HttpClient Shared = new() { Timeout = Timeout.InfiniteTimeSpan };
    private readonly HttpClient _http = httpClient ?? Shared;
    private static readonly Regex ResultRegex = new(
        "<a[^>]*class=\"result__a\"[^>]*href=\"(?<url>[^\"]+)\"[^>]*>(?<title>.*?)</a>.*?<a[^>]*class=\"result__snippet\"[^>]*>(?<snippet>.*?)</a>",
        RegexOptions.IgnoreCase | RegexOptions.Singleline | RegexOptions.Compiled);
    private static readonly Regex BingResultRegex = new(
        "<li[^>]*class=\"b_algo\"[^>]*>.*?<h2>\\s*<a[^>]*href=\"(?<url>[^\"]+)\"[^>]*>(?<title>.*?)</a>.*?</h2>.*?(?:<p[^>]*>(?<snippet>.*?)</p>)?",
        RegexOptions.IgnoreCase | RegexOptions.Singleline | RegexOptions.Compiled);
    private static readonly Regex BingTitleRegex = new(
        "<h2>\\s*<a[^>]*href=\"(?<url>[^\"]+)\"[^>]*>(?<title>.*?)</a>.*?</h2>",
        RegexOptions.IgnoreCase | RegexOptions.Singleline | RegexOptions.Compiled);
    private static readonly Regex Tags = new("<[^>]+>", RegexOptions.Compiled);

    public async Task<IReadOnlyList<WebSearchResult>> SearchAsync(string query, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(query)) throw new ArgumentException("Enter a search query.", nameof(query));
        if (query.Length > 500) throw new ArgumentException("Search queries are limited to 500 characters.", nameof(query));
        var uri = new Uri("https://html.duckduckgo.com/html/?q=" + Uri.EscapeDataString(query));
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(20));
        using var request = new HttpRequestMessage(HttpMethod.Get, uri);
        request.Headers.UserAgent.ParseAdd(ProductIdentity.UserAgent("desktop web search"));
        using var response = await _http.SendAsync(request, timeout.Token);
        var html = response.IsSuccessStatusCode ? await BoundedHttpContent.ReadTextAsync(response.Content, timeout.Token, "Web search response") : string.Empty;
        var results = new List<WebSearchResult>();
        foreach (Match match in ResultRegex.Matches(html))
        {
            var href = WebUtility.HtmlDecode(match.Groups["url"].Value);
            if (Uri.TryCreate(href, UriKind.RelativeOrAbsolute, out var resultUri) && !resultUri.IsAbsoluteUri && href.StartsWith("//duckduckgo.com/l/?", StringComparison.Ordinal))
            {
                var queryPart = new Uri("https:" + href).Query.TrimStart('?').Split('&')
                    .FirstOrDefault(part => part.StartsWith("uddg=", StringComparison.OrdinalIgnoreCase));
                if (queryPart is not null) href = Uri.UnescapeDataString(queryPart[5..]);
            }
            if (!Uri.TryCreate(href, UriKind.Absolute, out var absolute) || absolute.Scheme is not ("http" or "https")) continue;
            var title = Clean(match.Groups["title"].Value, 200);
            var snippet = Clean(match.Groups["snippet"].Value, 700);
            if (title.Length == 0 || snippet.Length == 0) continue;
            results.Add(new WebSearchResult(title, absolute.AbsoluteUri, snippet));
            if (results.Count == 6) break;
        }
        if (results.Count == 0)
        {
            using var fallbackRequest = new HttpRequestMessage(HttpMethod.Get, "https://www.bing.com/search?q=" + Uri.EscapeDataString(query));
            fallbackRequest.Headers.UserAgent.ParseAdd(ProductIdentity.UserAgent("desktop web search fallback"));
            using var fallbackResponse = await _http.SendAsync(fallbackRequest, timeout.Token);
            if (fallbackResponse.IsSuccessStatusCode)
            {
                var fallbackHtml = await BoundedHttpContent.ReadTextAsync(fallbackResponse.Content, timeout.Token, "Fallback web search response");
                foreach (Match match in BingResultRegex.Matches(fallbackHtml))
                {
                    if (!Uri.TryCreate(WebUtility.HtmlDecode(match.Groups["url"].Value), UriKind.Absolute, out var absolute) || absolute.Scheme is not ("http" or "https")) continue;
                    var title = Clean(match.Groups["title"].Value, 200);
                    var snippet = Clean(match.Groups["snippet"].Value, 700);
                    if (title.Length == 0) continue;
                    if (snippet.Length == 0) snippet = "Public search result. Open the source to review identity and details.";
                    results.Add(new WebSearchResult(title, absolute.AbsoluteUri, snippet));
                    if (results.Count == 6) break;
                }
                if (results.Count == 0)
                {
                    foreach (Match match in BingTitleRegex.Matches(fallbackHtml).Take(8))
                    {
                        var rawUrl = WebUtility.HtmlDecode(match.Groups["url"].Value);
                        if (!Uri.TryCreate(rawUrl, UriKind.Absolute, out var absolute) || absolute.Scheme is not ("http" or "https")) continue;
                        var title = Clean(match.Groups["title"].Value, 200);
                        if (title.Length == 0) continue;
                        results.Add(new WebSearchResult(title, absolute.AbsoluteUri, "Public search result. Open the source to review identity and details."));
                        if (results.Count == 6) break;
                    }
                }
            }
        }
        return results;
    }

    /// <summary>Fetch a small text-only excerpt for an explicitly selected research result.</summary>
    public async Task<WebPageText?> FetchTextAsync(string url, CancellationToken cancellationToken = default)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https"))
            throw new ArgumentException("Only HTTP and HTTPS research sources are supported.", nameof(url));
        if (uri.Host.Equals("youtu.be", StringComparison.OrdinalIgnoreCase) || uri.Host.EndsWith("youtube.com", StringComparison.OrdinalIgnoreCase))
        {
            var transcript = await FetchYouTubeTranscriptAsync(uri, cancellationToken).ConfigureAwait(false);
            if (transcript is not null) return transcript;
        }
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(12));
        using var request = new HttpRequestMessage(HttpMethod.Get, uri);
        request.Headers.UserAgent.ParseAdd(ProductIdentity.UserAgent("persona research"));
        using var response = await _http.SendAsync(request, timeout.Token);
        if (!response.IsSuccessStatusCode) return null;
        var html = await BoundedHttpContent.ReadTextAsync(response.Content, timeout.Token, "Persona research page");
        var titleMatch = Regex.Match(html, "<title[^>]*>(?<title>.*?)</title>", RegexOptions.IgnoreCase | RegexOptions.Singleline);
        var publishedDate = ExtractPublishedDate(html);
        var title = Clean(titleMatch.Success ? titleMatch.Groups["title"].Value : uri.Host, 300);
        var visibleHtml = Regex.Replace(html, "<(script|style|noscript|nav|footer|header|svg|form)[^>]*>.*?</\\1>", " ", RegexOptions.IgnoreCase | RegexOptions.Singleline);
        visibleHtml = Regex.Replace(visibleHtml, "</?(?:p|div|li|br|h[1-6]|section|article)[^>]*>", "\n", RegexOptions.IgnoreCase);
        var text = RemoveAdCopy(Clean(visibleHtml, 20_000));
        return text.Length == 0 ? null : new WebPageText(title, text) { PublishedDate = publishedDate };
    }

    private async Task<WebPageText?> FetchYouTubeTranscriptAsync(Uri videoUri, CancellationToken cancellationToken)
    {
        var videoId = videoUri.Host.Equals("youtu.be", StringComparison.OrdinalIgnoreCase)
            ? videoUri.AbsolutePath.Trim('/')
            : videoUri.AbsolutePath.Equals("/watch", StringComparison.OrdinalIgnoreCase)
                ? System.Web.HttpUtility.ParseQueryString(videoUri.Query).Get("v")
                : null;
        if (string.IsNullOrWhiteSpace(videoId) || !Regex.IsMatch(videoId, "^[A-Za-z0-9_-]{6,20}$")) return null;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(10));
        using var request = new HttpRequestMessage(HttpMethod.Get, $"https://www.youtube.com/watch?v={Uri.EscapeDataString(videoId)}");
        request.Headers.UserAgent.ParseAdd(ProductIdentity.UserAgent("persona video transcript"));
        using var response = await _http.SendAsync(request, timeout.Token).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode) return null;
        var html = await BoundedHttpContent.ReadTextAsync(response.Content, timeout.Token, "Video transcript page").ConfigureAwait(false);
        var titleMatch = Regex.Match(html, "<title[^>]*>(?<title>.*?)</title>", RegexOptions.IgnoreCase | RegexOptions.Singleline);
        var tracksMatch = Regex.Match(html, "(?:\\\\?\")captionTracks(?:\\\\?\")\\s*:\\s*(?<tracks>\\[.*?\\])", RegexOptions.IgnoreCase | RegexOptions.Singleline);
        if (!tracksMatch.Success) return null;
        JsonDocument tracksDocument;
        try { tracksDocument = JsonDocument.Parse(Regex.Unescape(tracksMatch.Groups["tracks"].Value)); }
        catch (JsonException) { return null; }
        using (tracksDocument)
        {
            var track = tracksDocument.RootElement.EnumerateArray().FirstOrDefault(item => item.TryGetProperty("languageCode", out var language) && language.GetString()?.StartsWith("en", StringComparison.OrdinalIgnoreCase) == true);
            if (track.ValueKind == System.Text.Json.JsonValueKind.Undefined) track = tracksDocument.RootElement.EnumerateArray().FirstOrDefault();
            if (track.ValueKind != System.Text.Json.JsonValueKind.Object || !track.TryGetProperty("baseUrl", out var baseUrlValue)) return null;
            var baseUrl = WebUtility.HtmlDecode(baseUrlValue.GetString() ?? string.Empty);
            if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var captionsUri) || !captionsUri.Host.EndsWith("youtube.com", StringComparison.OrdinalIgnoreCase)) return null;
            var separator = captionsUri.Query.Length == 0 ? "?" : "&";
            using var captionsResponse = await _http.GetAsync(captionsUri + separator + "fmt=json3", timeout.Token).ConfigureAwait(false);
            if (!captionsResponse.IsSuccessStatusCode) return null;
            var captionsText = await BoundedHttpContent.ReadTextAsync(captionsResponse.Content, timeout.Token, "Video captions").ConfigureAwait(false);
            using var captionsDocument = JsonDocument.Parse(captionsText);
            if (!captionsDocument.RootElement.TryGetProperty("events", out var events)) return null;
            var lines = events.EnumerateArray()
                .Where(item => item.TryGetProperty("segs", out _))
                .Select(item => string.Concat(item.GetProperty("segs").EnumerateArray().Where(segment => segment.TryGetProperty("utf8", out _)).Select(segment => segment.GetProperty("utf8").GetString())))
                .Where(line => !string.IsNullOrWhiteSpace(line));
            var transcript = RemoveAdCopy(string.Join(" ", lines));
            if (transcript.Length == 0) return null;
            return new WebPageText(Clean(titleMatch.Success ? titleMatch.Groups["title"].Value : "YouTube video", 300), transcript[..Math.Min(transcript.Length, 20_000)]) { SourceType = "Video captions" };
        }
    }

    private static string RemoveAdCopy(string text)
    {
        var sponsorStart = new Regex("\\b(?:this (?:episode|podcast) is brought to you by|sponsored by|support for (?:this|today's) episode comes from|thanks to our sponsor|a word from our sponsors?)\\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);
        var promoCopy = new Regex("\\b(?:use (?:the )?(?:promo )?code|promo code|discount code|limited.time offer|save \\d{1,3}%|visit [a-z0-9.-]+\\.com for|free trial)\\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);
        var adReturn = new Regex("\\b(?:and now we're back|now back to the show|back to (?:our|the) conversation|let's get back to it|back to the episode)\\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);
        var sentences = Regex.Split(text, "(?<=[.!?])\\s+");
        var cleaned = new List<string>(sentences.Length);
        var adSentencesRemaining = 0;
        foreach (var sentence in sentences)
        {
            if (adSentencesRemaining > 0 && adReturn.IsMatch(sentence)) { adSentencesRemaining = 0; continue; }
            if (sponsorStart.IsMatch(sentence)) { adSentencesRemaining = 6; continue; }
            if (promoCopy.IsMatch(sentence)) { adSentencesRemaining = Math.Max(adSentencesRemaining, 1); continue; }
            if (adSentencesRemaining > 0) { adSentencesRemaining--; continue; }
            cleaned.Add(sentence);
        }
        return string.Join(" ", cleaned).Trim();
    }

    private static string? ExtractPublishedDate(string html)
    {
        var patterns = new[]
        {
            "<meta[^>]+(?:property|name)=[\"'](?:article:published_time|datePublished|pubdate|published_time)[\"'][^>]+content=[\"'](?<date>[^\"']+)",
            "<meta[^>]+content=[\"'](?<date>[^\"']+)[\"'][^>]+(?:property|name)=[\"'](?:article:published_time|datePublished|pubdate|published_time)[\"']",
        };
        foreach (var pattern in patterns)
        {
            var match = Regex.Match(html, pattern, RegexOptions.IgnoreCase | RegexOptions.Singleline);
            if (!match.Success) continue;
            var value = WebUtility.HtmlDecode(match.Groups["date"].Value).Trim();
            if (DateTimeOffset.TryParse(value, out var parsed)) return parsed.ToString("yyyy-MM-dd");
        }
        return null;
    }

    private static string Clean(string html, int maxLength)
    {
        var text = WebUtility.HtmlDecode(Tags.Replace(html, ""));
        text = Regex.Replace(text, "\\s+", " ").Trim();
        return text.Length <= maxLength ? text : text[..maxLength] + "…";
    }
}
