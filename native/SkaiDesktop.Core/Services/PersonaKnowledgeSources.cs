// Structured persona research. Resolves who a user means ("Trevor Phillips", "Boog from Open
// Season") and gathers evidence from public knowledge APIs — Wikipedia, Fandom wikis and their
// transcripts, and Wikiquote — instead of scraping search-engine result pages, which return
// unrelated pages or nothing at all for many names.
// Depends on: HttpClient, BoundedHttpContent, PersonaDialogueEvidence. Used by the Agent Host's
// persona.discover and persona.research.

using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using SkaiDesktop.Core.Infrastructure;
using SkaiDesktop.Core.Models;

namespace SkaiDesktop.Core.Services;

/// <summary>A user's persona request split into the subject's name and an optional franchise hint.</summary>
public sealed record PersonaQuery(string Name, string? Franchise);

/// <summary>A resolved candidate for the subject the user means, with the public references that describe it.</summary>
public sealed record PersonaIdentity
{
    public required string CanonicalName { get; init; }
    public string Description { get; init; } = string.Empty;
    /// <summary>"person", "character", or "unknown".</summary>
    public string SubjectType { get; init; } = "unknown";
    public string? Franchise { get; init; }
    public IReadOnlyList<string> Aliases { get; init; } = [];
    public string? WikipediaTitle { get; init; }
    public string? FandomHost { get; init; }
    public string? FandomTitle { get; init; }
    public string? FandomSiteName { get; init; }
    public double NameScore { get; init; }
    public double Score { get; init; }
    /// <summary>ISO dates from Wikidata (yyyy-MM-dd, or yyyy-MM / yyyy at lower precision); null when unknown.</summary>
    public string? BirthDate { get; init; }
    public string? DeathDate { get; init; }

    public string? WikipediaUrl => WikipediaTitle is null ? null : PersonaKnowledgeSources.WikiUrl("en.wikipedia.org", WikipediaTitle);
    public string? FandomUrl => FandomHost is null || FandomTitle is null ? null : PersonaKnowledgeSources.WikiUrl(FandomHost, FandomTitle);
    public string PrimaryUrl => WikipediaUrl ?? FandomUrl ?? string.Empty;

    public string SourceSummary => string.Join(", ", new[] { WikipediaTitle is null ? null : "Wikipedia", FandomSiteName ?? (FandomHost is null ? null : "Fandom") }.Where(item => item is not null));
}

/// <summary>A piece of public evidence gathered for a resolved identity.</summary>
public sealed record PersonaKnowledgeDocument(
    string Title,
    string Url,
    string Publisher,
    string Kind,
    string Text,
    string SpeakerAttribution,
    int AttributedTurnCount,
    string EvidenceQuality,
    string ReliabilityNote);

public sealed partial class PersonaKnowledgeSources(HttpClient? httpClient = null)
{
    private readonly PersonaWikiClient _wiki = new(httpClient);

    // Public compatibility surface retained while matching rules live in their own focused helper.
    public static PersonaQuery ParseQuery(string input) => PersonaIdentityMatcher.ParseQuery(input);
    public static string Normalize(string value) => PersonaIdentityMatcher.Normalize(value);
    public static double NameSimilarity(string query, string candidate) => PersonaIdentityMatcher.NameSimilarity(query, candidate);
    public static string ClassifyDescription(string description) => PersonaIdentityMatcher.ClassifyDescription(description);
    public static string? ExtractFranchise(string description) => PersonaIdentityMatcher.ExtractFranchise(description);
    public static string WikiUrl(string host, string title) => PersonaIdentityMatcher.WikiUrl(host, title);

    // ---------------------------------------------------------------- API calls

    internal sealed record WikipediaHit(string Title, string Description);
    internal sealed record FandomHit(string Title, string Host, string SiteName, string Snippet, string? FranchiseHint = null)
    {
        public string? Franchise => FranchiseHint ?? (Regex.Replace(SiteName, @"\s+(?:Wiki|Wikia|Fandom)$", string.Empty, RegexOptions.IgnoreCase).Trim() is { Length: > 1 } name ? name : null);
    }
    internal sealed record FandomCommunity(string Name, string Host);
    public sealed record HtmlSection(string Heading, IReadOnlyList<string> Lines);

    // HTML parsing remains exposed through the existing facade for compatibility.
    public static IReadOnlyList<HtmlSection> HtmlToSections(string html) => PersonaHtmlParser.HtmlToSections(html);
    private static string Clean(string html) => PersonaHtmlParser.Clean(html);
    private static bool IsBoilerplateSection(string heading) =>
        Regex.IsMatch(heading, @"^(?:contents|references|notes|footnotes|citations|sources|bibliography|external links|see also|further reading|gallery|navigation|trivia|behind the scenes|appearances|navigation menu|mission appearances|links|videos?)$", RegexOptions.IgnoreCase);

    private static bool IsAnalysisSection(string heading) =>
        Regex.IsMatch(heading, @"\b(?:personality|characteri[sz]ation|character|portrayal|depiction|reception|legacy|relationships?|abilities|skills|traits|views|beliefs|politic|style|persona|public image|comedy|humou?r|behaviou?r|psychology|motivations?|attitude)\b", RegexOptions.IgnoreCase);

    private static string JoinSections(IEnumerable<HtmlSection> sections, int maxCharacters)
    {
        var builder = new StringBuilder();
        foreach (var section in sections)
        {
            var body = string.Join('\n', section.Lines.Where(line => line.Length >= 30));
            if (body.Length == 0) continue;
            var block = (section.Heading.Length > 0 ? $"## {section.Heading}\n" : string.Empty) + body + "\n";
            if (builder.Length + block.Length > maxCharacters)
            {
                var room = maxCharacters - builder.Length;
                if (room > 400) builder.Append(block[..room]);
                break;
            }
            builder.Append(block);
        }
        return builder.ToString().Trim();
    }
}
