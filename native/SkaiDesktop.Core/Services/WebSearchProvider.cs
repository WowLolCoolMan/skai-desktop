// Opt-in web search: fetches DuckDuckGo's HTML results page and extracts a few
// title/URL/snippet results. Does not open the result pages.
// Depends on: HttpClient, BoundedHttpContent. Used by Agent Host chat when web search is enabled.

using System.Net;
using System.Text;
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
    public string SpeakerAttribution { get; init; } = "unknown";
    public int AttributedTurnCount { get; init; }
    public string EvidenceQuality { get; init; } = "unreviewed";
}

/// <summary>Small opt-in web search adapter using DuckDuckGo HTML results with a bounded Bing fallback.</summary>
public sealed partial class WebSearchProvider(HttpClient? httpClient = null)
{
    private static readonly HttpClient Shared = new() { Timeout = Timeout.InfiniteTimeSpan };
    private readonly HttpClient _http = httpClient ?? Shared;
    private static readonly TimeSpan DuckDuckGoCooldown = TimeSpan.FromMinutes(10);
    // Keyed by HttpClient so the app's shared client remembers failures across provider instances
    // while each injected (test) client starts fresh.
    private static readonly System.Runtime.CompilerServices.ConditionalWeakTable<HttpClient, System.Runtime.CompilerServices.StrongBox<DateTimeOffset>> DuckDuckGoCooldowns = new();
    private System.Runtime.CompilerServices.StrongBox<DateTimeOffset> DuckDuckGoRetryAfter => DuckDuckGoCooldowns.GetValue(_http, _ => new(DateTimeOffset.MinValue));
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
        var html = string.Empty;
        // DuckDuckGo blocks or times out on some networks. After a failure, skip it for a while
        // instead of spending six seconds per query before every Bing fallback.
        if (DateTimeOffset.UtcNow >= DuckDuckGoRetryAfter.Value)
        using (var duckDuckGoTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken))
        {
            duckDuckGoTimeout.CancelAfter(TimeSpan.FromSeconds(6));
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Get, uri);
                request.Headers.UserAgent.ParseAdd(ProductIdentity.UserAgent("desktop web search"));
                using var response = await _http.SendAsync(request, duckDuckGoTimeout.Token);
                if (response.IsSuccessStatusCode)
                    html = await BoundedHttpContent.ReadTextAsync(response.Content, duckDuckGoTimeout.Token, "Web search response");
                else DuckDuckGoRetryAfter.Value = DateTimeOffset.UtcNow.Add(DuckDuckGoCooldown);
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { DuckDuckGoRetryAfter.Value = DateTimeOffset.UtcNow.Add(DuckDuckGoCooldown); }
            catch (HttpRequestException) { DuckDuckGoRetryAfter.Value = DateTimeOffset.UtcNow.Add(DuckDuckGoCooldown); }
        }
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
            href = UnwrapBingResultUrl(href) ?? string.Empty;
            if (!Uri.TryCreate(href, UriKind.Absolute, out var absolute) || absolute.Scheme is not ("http" or "https") || IsSearchRedirect(absolute)) continue;
            var title = Clean(match.Groups["title"].Value, 200);
            var snippet = Clean(match.Groups["snippet"].Value, 700);
            if (title.Length == 0 || snippet.Length == 0) continue;
            results.Add(new WebSearchResult(title, absolute.AbsoluteUri, snippet));
            if (results.Count == 6) break;
        }
        if (results.Count == 0)
        {
            using var fallbackTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            fallbackTimeout.CancelAfter(TimeSpan.FromSeconds(12));
            try
            {
                using var fallbackRequest = new HttpRequestMessage(HttpMethod.Get, "https://www.bing.com/search?q=" + Uri.EscapeDataString(query));
                fallbackRequest.Headers.UserAgent.ParseAdd(ProductIdentity.UserAgent("desktop web search fallback"));
                using var fallbackResponse = await _http.SendAsync(fallbackRequest, fallbackTimeout.Token);
                if (fallbackResponse.IsSuccessStatusCode)
                {
                    var fallbackHtml = await BoundedHttpContent.ReadTextAsync(fallbackResponse.Content, fallbackTimeout.Token, "Fallback web search response");
                    foreach (Match match in BingResultRegex.Matches(fallbackHtml))
                    {
                        var rawUrl = WebUtility.HtmlDecode(match.Groups["url"].Value);
                        var unwrappedUrl = UnwrapBingResultUrl(rawUrl);
                        if (unwrappedUrl is null || !Uri.TryCreate(unwrappedUrl, UriKind.Absolute, out var absolute) || absolute.Scheme is not ("http" or "https") || IsSearchRedirect(absolute)) continue;
                        var title = Clean(match.Groups["title"].Value, 200);
                        // The snippet is a later <p> inside the same result block; the result regex's
                        // optional lazy group never captures it, so read it from the block itself.
                        var blockEnd = fallbackHtml.IndexOf("<li class=\"b_algo\"", match.Index + match.Length, StringComparison.OrdinalIgnoreCase);
                        var block = fallbackHtml[match.Index..(blockEnd < 0 ? Math.Min(fallbackHtml.Length, match.Index + 6_000) : blockEnd)];
                        var paragraph = Regex.Match(block, "<p[^>]*>(?<snippet>.*?)</p>", RegexOptions.IgnoreCase | RegexOptions.Singleline);
                        var snippet = Clean(paragraph.Success ? paragraph.Groups["snippet"].Value : match.Groups["snippet"].Value, 700);
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
                            var unwrappedUrl = UnwrapBingResultUrl(rawUrl);
                            if (unwrappedUrl is null || !Uri.TryCreate(unwrappedUrl, UriKind.Absolute, out var absolute) || absolute.Scheme is not ("http" or "https") || IsSearchRedirect(absolute)) continue;
                            var title = Clean(match.Groups["title"].Value, 200);
                            if (title.Length == 0) continue;
                            results.Add(new WebSearchResult(title, absolute.AbsoluteUri, "Public search result. Open the source to review identity and details."));
                            if (results.Count == 6) break;
                        }
                    }
                }
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { }
            catch (HttpRequestException) { }
        }
        return results;
    }

    private static string? UnwrapBingResultUrl(string href)
    {
        if (!Uri.TryCreate(href, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https")) return null;
        if (!uri.Host.Equals("bing.com", StringComparison.OrdinalIgnoreCase)
            && !uri.Host.EndsWith(".bing.com", StringComparison.OrdinalIgnoreCase)) return href;
        if (!uri.AbsolutePath.Equals("/ck/a", StringComparison.OrdinalIgnoreCase)) return href;
        var encodedTarget = System.Web.HttpUtility.ParseQueryString(uri.Query).Get("u");
        if (string.IsNullOrWhiteSpace(encodedTarget) || !encodedTarget.StartsWith("a1", StringComparison.Ordinal)) return null;
        try
        {
            var base64 = encodedTarget[2..].Replace('-', '+').Replace('_', '/');
            base64 = base64.PadRight(base64.Length + (4 - base64.Length % 4) % 4, '=');
            var target = Encoding.UTF8.GetString(Convert.FromBase64String(base64));
            return Uri.TryCreate(target, UriKind.Absolute, out var targetUri) && targetUri.Scheme is "http" or "https"
                ? targetUri.AbsoluteUri
                : null;
        }
        catch (FormatException) { return null; }
    }

    public static string? NormalizePublicResearchUrl(string? href)
    {
        if (string.IsNullOrWhiteSpace(href) || !Uri.TryCreate(href, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https")) return null;
        var unwrapped = UnwrapBingResultUrl(uri.AbsoluteUri);
        if (unwrapped is null || !Uri.TryCreate(unwrapped, UriKind.Absolute, out var normalized) || IsSearchRedirect(normalized)) return null;
        return normalized.AbsoluteUri;
    }

    private static bool IsSearchRedirect(Uri uri) =>
        uri.Host.Equals("bing.com", StringComparison.OrdinalIgnoreCase) && uri.AbsolutePath.Equals("/ck/a", StringComparison.OrdinalIgnoreCase)
        || uri.Host.Equals("google.com", StringComparison.OrdinalIgnoreCase) && uri.AbsolutePath.Equals("/url", StringComparison.OrdinalIgnoreCase)
        || uri.Host.Equals("duckduckgo.com", StringComparison.OrdinalIgnoreCase) && uri.AbsolutePath.Equals("/l/", StringComparison.OrdinalIgnoreCase);

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
        return string.Join("\n", cleaned).Trim();
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

    private static string CleanPageText(string html, int maxLength)
    {
        var text = WebUtility.HtmlDecode(Tags.Replace(html, ""));
        text = Regex.Replace(text, @"\r\n?", "\n");
        text = Regex.Replace(text, @"[^\S\n]+", " ");
        text = Regex.Replace(text, @" *\n *", "\n");
        text = Regex.Replace(text, @"\n{3,}", "\n\n").Trim();
        return text.Length <= maxLength ? text : text[..maxLength] + "…";
    }
}
