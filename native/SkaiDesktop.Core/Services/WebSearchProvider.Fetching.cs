// Bounded public-page and transcript retrieval for opt-in research.

using System.Net;
using System.Text.RegularExpressions;
using System.Text.Json;
using SkaiDesktop.Core.Infrastructure;
using SkaiDesktop.Core.Models;

namespace SkaiDesktop.Core.Services;

public sealed partial class WebSearchProvider
{
    public async Task<WebPageText?> FetchTextAsync(string url, CancellationToken cancellationToken = default)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https"))
            throw new ArgumentException("Only HTTP and HTTPS research sources are supported.", nameof(url));
        var firecrawl = new FirecrawlWebProvider(_http);
        if (await firecrawl.IsAvailableAsync(cancellationToken).ConfigureAwait(false))
        {
            try
            {
                var extracted = await firecrawl.FetchTextAsync(url, cancellationToken).ConfigureAwait(false);
                if (extracted is not null) return extracted;
            }
            catch (HttpRequestException) { }
            catch (JsonException) { }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { }
        }
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
}
