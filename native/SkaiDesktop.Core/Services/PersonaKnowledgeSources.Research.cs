using System.Text.Json;
using System.Text.RegularExpressions;

namespace SkaiDesktop.Core.Services;

public sealed partial class PersonaKnowledgeSources
{
    // ---------------------------------------------------------------- evidence gathering

    /// <summary>Collects structured evidence for a resolved identity. Each source is best-effort; failures are skipped.</summary>
    public async Task<IReadOnlyList<PersonaKnowledgeDocument>> GatherAsync(PersonaIdentity identity, CancellationToken cancellationToken = default)
    {
        if (identity.SubjectType != "person" && identity.FandomHost is null)
            identity = await _wiki.Quietly(() => AttachFranchiseWikiAsync(identity, cancellationToken), identity).ConfigureAwait(false);
        var tasks = new List<Task<IReadOnlyList<PersonaKnowledgeDocument>>>
        {
            _wiki.Quietly(() => WikipediaDocumentsAsync(identity, cancellationToken)),
            _wiki.Quietly(() => FandomDocumentsAsync(identity, cancellationToken)),
            _wiki.Quietly(() => FandomTranscriptDocumentsAsync(identity, cancellationToken)),
            _wiki.Quietly(() => WikiquoteDocumentsAsync(identity, cancellationToken)),
        };
        await Task.WhenAll(tasks).ConfigureAwait(false);
        return tasks.SelectMany(task => task.Result)
            .Where(document => document.Text.Length >= 120)
            .GroupBy(document => document.Url + "|" + document.Kind, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .ToList();
    }

    /// <summary>
    /// Adds a real person's birth and death dates from Wikidata (via the Wikipedia article's item).
    /// Best effort: the identity comes back unchanged when anything is missing.
    /// </summary>
    public async Task<PersonaIdentity> AddLifeDatesAsync(PersonaIdentity identity, CancellationToken cancellationToken = default)
    {
        if (identity.WikipediaTitle is null || identity.SubjectType == "character") return identity;
        return await _wiki.Quietly(async () =>
        {
            using var page = await _wiki.GetJsonAsync($"https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&prop=pageprops&ppprop=wikibase_item&titles={Uri.EscapeDataString(identity.WikipediaTitle)}", cancellationToken).ConfigureAwait(false);
            var item = page.RootElement.TryGetProperty("query", out var query) && query.TryGetProperty("pages", out var pages)
                ? pages.EnumerateArray().Select(entry => entry.TryGetProperty("pageprops", out var props) && props.TryGetProperty("wikibase_item", out var id) ? id.GetString() : null).FirstOrDefault()
                : null;
            if (item is null || !Regex.IsMatch(item, @"^Q\d{1,12}$")) return identity;
            using var entity = await _wiki.GetJsonAsync($"https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids={item}", cancellationToken).ConfigureAwait(false);
            if (!entity.RootElement.TryGetProperty("entities", out var entities) || !entities.TryGetProperty(item, out var record) || !record.TryGetProperty("claims", out var claims)) return identity;
            return identity with { BirthDate = WikidataDate(claims, "P569"), DeathDate = WikidataDate(claims, "P570") };
        }, identity).ConfigureAwait(false);
    }

    /// <summary>Reads a Wikidata time claim ("+1946-01-20T00:00:00Z", precision 9/10/11 = year/month/day) as an ISO date.</summary>
    public static string? WikidataDate(JsonElement claims, string property)
    {
        if (!claims.TryGetProperty(property, out var statements) || statements.ValueKind != JsonValueKind.Array) return null;
        foreach (var statement in statements.EnumerateArray())
        {
            if (!statement.TryGetProperty("mainsnak", out var snak) || !snak.TryGetProperty("datavalue", out var data) || !data.TryGetProperty("value", out var value)
                || !value.TryGetProperty("time", out var timeElement)) continue;
            var match = Regex.Match(timeElement.GetString() ?? string.Empty, @"^\+(?<y>\d{4})-(?<m>\d{2})-(?<d>\d{2})");
            if (!match.Success) continue;
            var precision = value.TryGetProperty("precision", out var precisionElement) && precisionElement.TryGetInt32(out var p) ? p : 11;
            return precision >= 11 ? $"{match.Groups["y"]}-{match.Groups["m"]}-{match.Groups["d"]}" : precision == 10 ? $"{match.Groups["y"]}-{match.Groups["m"]}" : precision == 9 ? match.Groups["y"].Value : null;
        }
        return null;
    }

    /// <summary>For a character with no wiki yet, finds its franchise's Fandom wiki and the character's page on it.</summary>
    public async Task<PersonaIdentity> AttachFranchiseWikiAsync(PersonaIdentity identity, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(identity.Franchise)) return identity;
        var wikis = await _wiki.CommunitySearchAsync(identity.Franchise, 4, cancellationToken).ConfigureAwait(false);
        foreach (var wiki in wikis.Where(wiki => !PersonaIdentityMatcher.IsAggregatorWiki(wiki.Host)))
        {
            var titles = await _wiki.WikiSearchTitlesAsync(wiki.Host, identity.CanonicalName, 5, cancellationToken).ConfigureAwait(false);
            var title = titles.OrderByDescending(candidate => PersonaIdentityMatcher.NameSimilarity(identity.CanonicalName, candidate)).FirstOrDefault();
            if (title is not null && PersonaIdentityMatcher.NameSimilarity(identity.CanonicalName, title) >= 0.75)
                return identity with { FandomHost = wiki.Host, FandomTitle = title, FandomSiteName = wiki.Name };
        }
        return identity;
    }

    private async Task<IReadOnlyList<PersonaKnowledgeDocument>> WikipediaDocumentsAsync(PersonaIdentity identity, CancellationToken cancellationToken)
    {
        if (identity.WikipediaTitle is null) return [];
        var html = await _wiki.ParseHtmlAsync("en.wikipedia.org", "/w/api.php", identity.WikipediaTitle, cancellationToken).ConfigureAwait(false);
        if (html is null) return [];
        var sections = HtmlToSections(html);
        var url = identity.WikipediaUrl!;
        var documents = new List<PersonaKnowledgeDocument>();
        var overview = JoinSections(sections.Where(section => !IsBoilerplateSection(section.Heading) && !IsAnalysisSection(section.Heading)), 9_000);
        if (overview.Length > 0)
            documents.Add(new(identity.WikipediaTitle + " — Wikipedia", url, "en.wikipedia.org", identity.SubjectType == "person" ? "Biography" : "Canon reference", overview,
                "not-applicable", 0, "reference-text", "Wikipedia article; established public reference. Check cited claims for disputed details."));
        var analysis = JoinSections(sections.Where(section => IsAnalysisSection(section.Heading)), 8_000);
        if (analysis.Length > 0)
            documents.Add(new(identity.WikipediaTitle + " — Wikipedia (characterization and reception)", url + "#characterization", "en.wikipedia.org", identity.SubjectType == "person" ? "Other reference" : "Character analysis", analysis,
                "not-applicable", 0, "reference-text", "Wikipedia sections on personality, portrayal, style, or reception."));
        return documents;
    }

    private async Task<IReadOnlyList<PersonaKnowledgeDocument>> FandomDocumentsAsync(PersonaIdentity identity, CancellationToken cancellationToken)
    {
        if (identity.FandomHost is null || identity.FandomTitle is null) return [];
        var html = await _wiki.ParseHtmlAsync(identity.FandomHost, "/api.php", identity.FandomTitle, cancellationToken).ConfigureAwait(false);
        if (html is null) return [];
        var sections = HtmlToSections(html);
        var site = identity.FandomSiteName ?? identity.FandomHost;
        var url = identity.FandomUrl!;
        var note = PersonaIdentityMatcher.IsAggregatorWiki(identity.FandomHost)
            ? "Fan-maintained aggregator wiki; prefer franchise wiki or official canon where they disagree."
            : "Fan-maintained franchise wiki; usually detailed and canon-focused, but check disputed details.";
        var documents = new List<PersonaKnowledgeDocument>();
        var canon = JoinSections(sections.Where(section => !IsBoilerplateSection(section.Heading) && !IsAnalysisSection(section.Heading) && !PersonaQuoteEvidence.IsQuoteSection(section.Heading)), 9_000);
        if (canon.Length > 0)
            documents.Add(new($"{identity.FandomTitle} — {site}", url, identity.FandomHost, identity.SubjectType == "person" ? "Other reference" : "Canon reference", canon, "not-applicable", 0, "reference-text", note));
        var analysis = JoinSections(sections.Where(section => IsAnalysisSection(section.Heading)), 8_000);
        if (analysis.Length > 0)
            documents.Add(new($"{identity.FandomTitle} — {site} (personality and relationships)", url + "#Personality", identity.FandomHost, identity.SubjectType == "person" ? "Other reference" : "Character analysis", analysis, "not-applicable", 0, "reference-text", note));
        var quotes = PersonaQuoteEvidence.QuoteLines(sections.Where(section => PersonaQuoteEvidence.IsQuoteSection(section.Heading)).SelectMany(section => section.Lines), identity);
        if (quotes.Count >= 3)
            documents.Add(new($"{identity.FandomTitle} — {site} (quotes)", url + "#Quotes", identity.FandomHost, "Character dialogue", string.Join('\n', quotes.Select(line => $"{identity.CanonicalName}: {line}")),
                "subject-attributed", quotes.Count, "wiki-quote-section", "Quotes the wiki attributes to this subject; verify against the episode or scene when exact wording matters."));
        return documents;
    }

    private async Task<IReadOnlyList<PersonaKnowledgeDocument>> FandomTranscriptDocumentsAsync(PersonaIdentity identity, CancellationToken cancellationToken)
    {
        if (identity.SubjectType == "person" || identity.FandomHost is null) return [];
        var shortName = identity.Aliases.LastOrDefault(alias => !alias.Contains(' ')) ?? identity.CanonicalName;
        var titles = await _wiki.WikiSearchTitlesAsync(identity.FandomHost, $"{shortName} transcript", 10, cancellationToken).ConfigureAwait(false);
        var transcriptTitles = titles.Where(title => title.Contains("transcript", StringComparison.OrdinalIgnoreCase) && !title.StartsWith("List of", StringComparison.OrdinalIgnoreCase)).Take(4).ToArray();
        var documents = new List<PersonaKnowledgeDocument>();
        foreach (var title in transcriptTitles)
        {
            var html = await _wiki.Quietly(() => _wiki.ParseHtmlAsync(identity.FandomHost, "/api.php", title, cancellationToken), null).ConfigureAwait(false);
            if (html is null) continue;
            var text = string.Join('\n', HtmlToSections(html).SelectMany(section => section.Lines));
            var attribution = PersonaDialogueEvidence.DetectSpeaker(PersonaQuoteEvidence.SpeakerLabels(identity), text);
            if (!attribution.IsUsable) continue;
            var turns = PersonaQuoteEvidence.CleanTurns(PersonaDialogueEvidence.SelectSpeakerTurns(PersonaQuoteEvidence.SpeakerLabels(identity), text, 6_000));
            if (turns.Count < 3) continue;
            documents.Add(new($"{title} — {identity.FandomSiteName ?? identity.FandomHost}", PersonaIdentityMatcher.WikiUrl(identity.FandomHost, title), identity.FandomHost, "Story transcript", string.Join('\n', turns),
                "subject-attributed", Math.Max(turns.Count, attribution.TurnCount), "explicit-speaker-labels", "Fan transcript with explicit speaker labels; compare with the episode or film for transcription errors."));
            if (documents.Sum(document => document.AttributedTurnCount) >= 80) break;
        }
        return documents;
    }

    private async Task<IReadOnlyList<PersonaKnowledgeDocument>> WikiquoteDocumentsAsync(PersonaIdentity identity, CancellationToken cancellationToken)
    {
        // Characters' lines live on their works' pages ("Grand Theft Auto V"); search by franchise and
        // by name. Work pages are kept only if they contain the character's labelled lines.
        var searches = new[] { identity.SubjectType == "character" ? identity.Franchise : null, identity.CanonicalName }
            .Where(text => !string.IsNullOrWhiteSpace(text)).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        var batches = await Task.WhenAll(searches.Select(text => _wiki.Quietly(() => _wiki.WikiSearchTitlesAsync("en.wikiquote.org", text!, 5, cancellationToken, "/w/api.php")))).ConfigureAwait(false);
        var titles = batches.SelectMany(batch => batch).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var nameTitles = batches.Length > 0 ? batches[^1] : [];
        var documents = new List<PersonaKnowledgeDocument>();
        // Person pages ("Sam Hyde") hold quotes by the subject; work pages ("Open Season (2006 film)")
        // hold labelled dialogue from which the subject's lines are selected.
        var personPage = titles.FirstOrDefault(title => PersonaIdentityMatcher.NameSimilarity(identity.CanonicalName, title) >= 0.85);
        // Pages found by the character's name mention the character, so try them first; then the
        // franchise's pages by affinity. Each is kept only if it holds the character's labelled lines.
        var workPages = identity.SubjectType == "person" ? [] : nameTitles
            .Concat(titles.OrderByDescending(title => PersonaIdentityMatcher.FranchiseAffinity(identity.Franchise ?? identity.CanonicalName, title)))
            .Where(title => title != personPage).Distinct(StringComparer.OrdinalIgnoreCase).Take(4).ToArray();
        if (personPage is not null)
        {
            var html = await _wiki.ParseHtmlAsync("en.wikiquote.org", "/w/api.php", personPage, cancellationToken).ConfigureAwait(false);
            if (html is not null && !html.Contains("disambiguation", StringComparison.OrdinalIgnoreCase))
            {
                var sections = HtmlToSections(html);
                var quotes = PersonaQuoteEvidence.QuoteLines(sections.Where(section => section.Heading.Length > 0 && !IsBoilerplateSection(section.Heading) && !Regex.IsMatch(section.Heading, @"^(?:quotes about|about|misattributed|disputed)", RegexOptions.IgnoreCase)).SelectMany(section => section.Lines), identity);
                if (quotes.Count >= 3)
                    documents.Add(new($"{personPage} — Wikiquote", PersonaIdentityMatcher.WikiUrl("en.wikiquote.org", personPage), "en.wikiquote.org", identity.SubjectType == "person" ? "Interview" : "Character dialogue",
                        string.Join('\n', quotes.Select(line => $"{identity.CanonicalName}: {line}")), "subject-attributed", quotes.Count, "sourced-quote-collection",
                        "Wikiquote collects sourced quotes attributed to this subject; check each quote's listed source."));
            }
        }
        foreach (var title in workPages)
        {
            var html = await _wiki.Quietly(() => _wiki.ParseHtmlAsync("en.wikiquote.org", "/w/api.php", title, cancellationToken), null).ConfigureAwait(false);
            if (html is null) continue;
            var text = string.Join('\n', HtmlToSections(html).SelectMany(section => section.Lines));
            var attribution = PersonaDialogueEvidence.DetectSpeaker(PersonaQuoteEvidence.SpeakerLabels(identity), text);
            if (!attribution.IsUsable) continue;
            var turns = PersonaQuoteEvidence.CleanTurns(PersonaDialogueEvidence.SelectSpeakerTurns(PersonaQuoteEvidence.SpeakerLabels(identity), text, 5_000));
            if (turns.Count < 3) continue;
            documents.Add(new($"{title} — Wikiquote", PersonaIdentityMatcher.WikiUrl("en.wikiquote.org", title), "en.wikiquote.org", "Character dialogue",
                string.Join('\n', turns), "subject-attributed", turns.Count, "explicit-speaker-labels",
                "Wikiquote dialogue with speaker labels; lines are from the listed work."));
        }
        return documents;
    }

    /// <summary>Compatibility facade: display name first, followed by transcript aliases.</summary>
    public static IReadOnlyList<string> SpeakerLabels(PersonaIdentity identity) => PersonaQuoteEvidence.SpeakerLabels(identity);


}