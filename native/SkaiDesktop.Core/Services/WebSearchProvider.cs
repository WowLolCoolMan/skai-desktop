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
        var html = string.Empty;
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
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { }
            catch (HttpRequestException) { }
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
        if (uri.Host.Equals("joeroganpodcast.org", StringComparison.OrdinalIgnoreCase))
        {
            var archiveTranscript = await FetchJreArchiveTranscriptAsync(uri, cancellationToken).ConfigureAwait(false);
            if (archiveTranscript is not null) return archiveTranscript;
        }
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(12));
        using var request = new HttpRequestMessage(HttpMethod.Get, uri);
        request.Headers.UserAgent.ParseAdd(ProductIdentity.UserAgent("persona research"));
        using var response = await _http.SendAsync(request, timeout.Token);
        if (!response.IsSuccessStatusCode) return null;
        if (response.Content.Headers.ContentType?.MediaType?.Equals("application/pdf", StringComparison.OrdinalIgnoreCase) == true
            || uri.AbsolutePath.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
        {
            var pdfBytes = await BoundedHttpContent.ReadBytesAsync(response.Content, 8 * 1024 * 1024, timeout.Token, "Persona research PDF").ConfigureAwait(false);
            if (!PdfAttachmentTextExtractor.HasPdfSignature(pdfBytes)) return null;
            string pdfText;
            try { pdfText = PdfAttachmentTextExtractor.Extract(pdfBytes, 20_000); }
            catch (InvalidDataException) { return null; }
            var filename = response.Content.Headers.ContentDisposition?.FileNameStar
                ?? response.Content.Headers.ContentDisposition?.FileName
                ?? Uri.UnescapeDataString(uri.Segments.LastOrDefault() ?? uri.Host);
            var pdfTitle = Clean(filename.Trim('"'), 300);
            if (string.IsNullOrWhiteSpace(pdfTitle)) pdfTitle = uri.Host;
            var speakerLabelCount = Regex.Matches(pdfText, @"(?:^|\r?\n)\s*(?:\*\*)?[\p{Lu}][\p{L}'.-]{1,30}(?:\s+[\p{Lu}][\p{L}'.-]{1,30}){0,3}(?:\*\*)?:\s*\S", RegexOptions.Multiline).Count;
            var sourceType = speakerLabelCount >= 3 ? "Conversation transcript" : null;
            return new WebPageText(pdfTitle, pdfText)
            {
                SourceType = sourceType,
                EvidenceQuality = sourceType is null ? "reference-text" : "speaker-labeled-pdf-transcript",
            };
        }
        var html = await BoundedHttpContent.ReadTextAsync(response.Content, timeout.Token, "Persona research page");
        var titleMatch = Regex.Match(html, "<title[^>]*>(?<title>.*?)</title>", RegexOptions.IgnoreCase | RegexOptions.Singleline);
        var publishedDate = ExtractPublishedDate(html);
        var title = Clean(titleMatch.Success ? titleMatch.Groups["title"].Value : uri.Host, 300);
        var visibleHtml = Regex.Replace(html, "<(script|style|noscript|nav|footer|header|svg|form)[^>]*>.*?</\\1>", " ", RegexOptions.IgnoreCase | RegexOptions.Singleline);
        visibleHtml = Regex.Replace(visibleHtml, "</?(?:p|div|li|br|h[1-6]|section|article)[^>]*>", "\n", RegexOptions.IgnoreCase);
        var text = RemoveAdCopy(CleanPageText(visibleHtml, 20_000));
        return text.Length == 0 ? null : new WebPageText(title, text) { PublishedDate = publishedDate };
    }

    private async Task<WebPageText?> FetchJreArchiveTranscriptAsync(Uri transcriptPage, CancellationToken cancellationToken)
    {
        if (!transcriptPage.AbsolutePath.Contains("/transcript", StringComparison.OrdinalIgnoreCase)) return null;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(15));
        using var homeRequest = new HttpRequestMessage(HttpMethod.Get, "https://joeroganpodcast.org/");
        homeRequest.Headers.UserAgent.ParseAdd(ProductIdentity.UserAgent("persona transcript research"));
        using var homeResponse = await _http.SendAsync(homeRequest, timeout.Token).ConfigureAwait(false);
        if (!homeResponse.IsSuccessStatusCode) return null;
        var home = await BoundedHttpContent.ReadTextAsync(homeResponse.Content, timeout.Token, "Transcript archive page").ConfigureAwait(false);
        var bundlePath = Regex.Match(home, "src=\\\"(?<src>/assets/index-[^\\\"]+\\.js)\\\"", RegexOptions.IgnoreCase).Groups["src"].Value;
        if (string.IsNullOrWhiteSpace(bundlePath)) return null;
        using var bundleRequest = new HttpRequestMessage(HttpMethod.Get, new Uri(new Uri("https://joeroganpodcast.org"), bundlePath));
        bundleRequest.Headers.UserAgent.ParseAdd(ProductIdentity.UserAgent("persona transcript research"));
        using var bundleResponse = await _http.SendAsync(bundleRequest, timeout.Token).ConfigureAwait(false);
        if (!bundleResponse.IsSuccessStatusCode) return null;
        var bundle = await BoundedHttpContent.ReadTextAsync(bundleResponse.Content, timeout.Token, "Transcript archive app data").ConfigureAwait(false);
        var api = Regex.Match(bundle, "(?<url>https://[a-z0-9]+\\.supabase\\.co)").Groups["url"].Value;
        var key = Regex.Match(bundle, "(?<key>eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+)").Groups["key"].Value;
        if (string.IsNullOrWhiteSpace(api) || string.IsNullOrWhiteSpace(key)) return null;
        var segments = transcriptPage.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
        var slug = segments.Length > 1 && segments[^1].Equals("transcript", StringComparison.OrdinalIgnoreCase)
            ? segments[^2]
            : segments.LastOrDefault() ?? string.Empty;
        var words = Regex.Matches(slug.Replace('-', ' '), @"[\p{L}\p{N}]{3,}").Select(match => match.Value)
            .Where(word => !Regex.IsMatch(word, @"^\d+$"))
            .TakeLast(4).ToArray();
        if (words.Length == 0) return null;
        var guestPattern = string.Join("%20", words.Select(Uri.EscapeDataString));
        var endpoint = $"{api}/rest/v1/episodes?select=title,guest,date,transcript&published=eq.true&archived=eq.false&guest=ilike.*{guestPattern}*&limit=8";
        using var dataRequest = new HttpRequestMessage(HttpMethod.Get, endpoint);
        dataRequest.Headers.TryAddWithoutValidation("apikey", key);
        dataRequest.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", key);
        using var dataResponse = await _http.SendAsync(dataRequest, timeout.Token).ConfigureAwait(false);
        if (!dataResponse.IsSuccessStatusCode) return null;
        var payload = await BoundedHttpContent.ReadTextAsync(dataResponse.Content, timeout.Token, "Podcast transcript data").ConfigureAwait(false);
        using var document = JsonDocument.Parse(payload);
        var episode = document.RootElement.EnumerateArray()
            .Where(item => item.TryGetProperty("transcript", out var transcript) && transcript.ValueKind == JsonValueKind.String && transcript.GetString()?.Length >= 800)
            .OrderByDescending(item => item.GetProperty("transcript").GetString()!.Length)
            .FirstOrDefault();
        if (episode.ValueKind != JsonValueKind.Object) return null;
        var body = episode.GetProperty("transcript").GetString() ?? string.Empty;
        var title = episode.TryGetProperty("title", out var titleValue) ? titleValue.GetString() ?? "" : "";
        var guest = episode.TryGetProperty("guest", out var guestValue) ? guestValue.GetString() ?? "" : "";
        var date = episode.TryGetProperty("date", out var dateValue) ? dateValue.GetString() ?? "" : "";
        // This archive provides timed speech text but does not label the speakers.
        // Keep it useful for topic coverage while refusing to use it as Joe's voice evidence.
        return new WebPageText($"Joe Rogan Experience transcript — {title} ({guest})", body[..Math.Min(body.Length, 20_000)])
        {
            PublishedDate = date,
            SourceType = "Unattributed conversation transcript",
            SpeakerAttribution = "unattributed-mixed-speakers",
            EvidenceQuality = "dialogue-present-speaker-unverified",
        };
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
            return new WebPageText(Clean(titleMatch.Success ? titleMatch.Groups["title"].Value : "YouTube video", 300), transcript[..Math.Min(transcript.Length, 20_000)]) { SourceType = "Unattributed video captions", SpeakerAttribution = "unattributed-mixed-speakers", EvidenceQuality = "dialogue-present-speaker-unverified" };
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
