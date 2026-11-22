using System.Text.RegularExpressions;

namespace SkaiDesktop.Core.Services;

/// <summary>Provider-specific source gathering; request limits and source policies stay intact.</summary>
public sealed partial class PersonaKnowledgeSources
{
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


}
