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

public sealed class PersonaKnowledgeSources(HttpClient? httpClient = null)
{
    private readonly PersonaWikiClient _wiki = new(httpClient);

    // Public compatibility surface retained while matching rules live in their own focused helper.
    public static PersonaQuery ParseQuery(string input) => PersonaIdentityMatcher.ParseQuery(input);
    public static string Normalize(string value) => PersonaIdentityMatcher.Normalize(value);
    public static double NameSimilarity(string query, string candidate) => PersonaIdentityMatcher.NameSimilarity(query, candidate);
    public static string ClassifyDescription(string description) => PersonaIdentityMatcher.ClassifyDescription(description);
    public static string? ExtractFranchise(string description) => PersonaIdentityMatcher.ExtractFranchise(description);
    public static string WikiUrl(string host, string title) => PersonaIdentityMatcher.WikiUrl(host, title);

    // ---------------------------------------------------------------- identity resolution

    /// <summary>
    /// Finds the subjects a user may mean, best first. <paramref name="subjectHint"/> is "person",
    /// "character", or null when unknown; it ranks matching candidates higher but never hides others.
    /// </summary>
    public async Task<IReadOnlyList<PersonaIdentity>> ResolveAsync(string input, string? subjectHint, CancellationToken cancellationToken = default)
    {
        var query = PersonaIdentityMatcher.ParseQuery(input);
        if (query.Name.Length == 0) return [];
        var hint = subjectHint is "person" or "character" ? subjectHint : null;
        var franchiseSuffix = query.Franchise is null ? string.Empty : " " + query.Franchise;

        var wikipediaTask = _wiki.Quietly(() => _wiki.WikipediaSearchAsync(query.Name + franchiseSuffix, 6, cancellationToken));
        var wikipediaCharacterTask = hint == "person"
            ? Task.FromResult<IReadOnlyList<WikipediaHit>>([])
            : _wiki.Quietly(() => _wiki.WikipediaSearchAsync($"{query.Name}{franchiseSuffix} character", 4, cancellationToken));
        var fandomTask = hint == "person"
            ? Task.FromResult<IReadOnlyList<FandomHit>>([])
            : _wiki.Quietly(() => _wiki.FandomPageSearchAsync(query.Name + franchiseSuffix, 10, cancellationToken));
        await Task.WhenAll(wikipediaTask, wikipediaCharacterTask, fandomTask).ConfigureAwait(false);

        var wikipediaHits = wikipediaTask.Result.Concat(wikipediaCharacterTask.Result)
            .Where(hit => !IsDisambiguation(hit))
            .GroupBy(hit => hit.Title, StringComparer.OrdinalIgnoreCase).Select(group => group.First()).ToList();
        var fandomHits = fandomTask.Result.ToList();

        // A character request whose Wikipedia hits are only works ("Grand Theft Auto V" for
        // "Trevor Phillips") still tells us the franchise.
        var inferredFranchise = query.Franchise
            ?? wikipediaHits.Where(hit => PersonaIdentityMatcher.ClassifyDescription(hit.Description) == "work").Select(hit => hit.Title).FirstOrDefault();

        // Ask Fandom which wiki is dedicated to the franchise (gta, openseason, spongebob, pirates) and
        // search for the character there directly. Cross-wiki search tends to surface company, logo,
        // or "every character" wikis first, which hold far thinner canon and no transcripts.
        var franchiseCandidates = new[] { query.Franchise, inferredFranchise }
            .Concat(wikipediaHits.Where(hit => PersonaIdentityMatcher.ClassifyDescription(hit.Description) == "character").Select(hit => PersonaIdentityMatcher.ExtractFranchise(hit.Description)))
            .Where(item => !string.IsNullOrWhiteSpace(item)).Cast<string>().Distinct(StringComparer.OrdinalIgnoreCase).Take(2).ToArray();
        // No franchise anywhere ("Trevor Phillips"): let the wikis that host a matching page vote.
        if (franchiseCandidates.Length == 0)
            franchiseCandidates = fandomHits.Where(hit => !PersonaIdentityMatcher.IsAggregatorWiki(hit.Host) && PersonaIdentityMatcher.NameSimilarity(query.Name, hit.Title) >= 0.75 && hit.Franchise is not null)
                .Select(hit => hit.Franchise!).Distinct(StringComparer.OrdinalIgnoreCase).Take(2).ToArray();
        var dedicatedHosts = new List<string>();
        if (hint != "person")
        {
            foreach (var franchise in franchiseCandidates)
            {
                var communities = await _wiki.Quietly(() => _wiki.CommunitySearchAsync(franchise, 4, cancellationToken)).ConfigureAwait(false);
                foreach (var community in communities.Where(community => !PersonaIdentityMatcher.IsAggregatorWiki(community.Host)).Take(2))
                {
                    if (dedicatedHosts.Contains(community.Host)) continue;
                    dedicatedHosts.Add(community.Host);
                    // The typed name, any fuller canonical spelling another wiki uses ("SpongeBob
                    // SquarePants"), and "<name> character" — a wiki's search often ranks the
                    // series or film page above its character page for a bare name.
                    var searchNames = new[] { query.Name, $"{query.Name} character" }
                        .Concat(fandomHits.Where(hit => PersonaIdentityMatcher.NameSimilarity(query.Name, hit.Title) >= 0.75).Select(hit => Regex.Replace(hit.Title, @"\s*\([^)]*\)\s*$", string.Empty)))
                        .Distinct(StringComparer.OrdinalIgnoreCase).Take(3).ToArray();
                    var titleBatches = await Task.WhenAll(searchNames.Select(name => _wiki.Quietly(() => _wiki.WikiSearchTitlesAsync(community.Host, name, 6, cancellationToken)))).ConfigureAwait(false);
                    var titles = titleBatches.SelectMany(batch => batch).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
                    var best = titles.Select(title => (title, score: PersonaIdentityMatcher.NameSimilarity(query.Name, title) + TitleShapeBonus(title)))
                        .OrderByDescending(item => item.score).FirstOrDefault();
                    if (best.title is not null && PersonaIdentityMatcher.NameSimilarity(query.Name, best.title) >= 0.6)
                        fandomHits.Insert(0, new FandomHit(best.title, community.Host, community.Name, $"Page on {community.Name}, the dedicated wiki for {franchise}.", franchise));
                }
            }
        }

        var identities = new List<PersonaIdentity>();
        foreach (var hit in wikipediaHits)
        {
            var type = PersonaIdentityMatcher.ClassifyDescription(hit.Description);
            if (type == "work") continue;
            var nameScore = PersonaIdentityMatcher.NameSimilarity(query.Name, hit.Title);
            if (nameScore < 0.6) continue;
            var franchise = type == "character" ? PersonaIdentityMatcher.ExtractFranchise(hit.Description) ?? query.Franchise : null;
            var fandom = type == "person" ? null : BestFandomMatch(fandomHits, hit.Title, franchise ?? query.Franchise, dedicatedHosts);
            identities.Add(Build(hit.Title, hit.Description, type, franchise ?? fandom?.Franchise, hit.Title, type == "character" ? fandom : null, nameScore));
        }

        foreach (var fandom in fandomHits)
        {
            if (identities.Any(identity => identity.FandomHost == fandom.Host && identity.FandomTitle == fandom.Title)) continue;
            var nameScore = PersonaIdentityMatcher.NameSimilarity(query.Name, fandom.Title);
            if (nameScore < 0.6) continue;
            identities.Add(Build(fandom.Title, fandom.Snippet, hint ?? "character", fandom.Franchise, null, fandom, nameScore));
        }

        var scored = identities.Select(identity => identity with { Score = ScoreIdentity(identity, query, hint, inferredFranchise, dedicatedHosts) }).ToList();
        // Break near-ties between wiki pages by depth: a franchise wiki's full article (100 KB for
        // Trevor on the GTA wiki) beats a stub on a company or aggregator wiki.
        var contenders = scored.Where(identity => identity.FandomHost is not null && identity.WikipediaTitle is null)
            .OrderByDescending(identity => identity.Score).Take(5).ToList();
        var lengths = await Task.WhenAll(contenders.Select(identity => _wiki.Quietly(() => _wiki.PageLengthAsync(identity.FandomHost!, identity.FandomTitle!, cancellationToken), 0))).ConfigureAwait(false);
        for (var index = 0; index < contenders.Count; index++)
        {
            if (lengths[index] <= 0) continue;
            var bonus = Math.Clamp(Math.Log10(lengths[index] / 2_000.0) * 0.05, 0, 0.1);
            var position = scored.IndexOf(contenders[index]);
            scored[position] = scored[position] with { Score = Math.Round(scored[position].Score + bonus, 3) };
        }
        return scored
            .GroupBy(identity => PersonaIdentityMatcher.Normalize(identity.CanonicalName) + "|" + PersonaIdentityMatcher.Normalize(identity.Franchise ?? identity.FandomHost ?? string.Empty))
            .Select(MergeGroup)
            .OrderByDescending(identity => identity.Score)
            .Take(8)
            .ToList();

        PersonaIdentity Build(string name, string description, string type, string? franchise, string? wikipediaTitle, FandomHit? fandom, double nameScore)
        {
            var canonical = Regex.Replace(name.Split('/')[0], @"\s*\((?:character|fictional character|[^)]*\bcharacter)\)\s*$", string.Empty, RegexOptions.IgnoreCase).Trim();
            var aliases = new List<string> { canonical };
            if (fandom is not null) aliases.Add(Regex.Replace(fandom.Title, @"\s*\([^)]*\)\s*$", string.Empty).Trim());
            if (PersonaIdentityMatcher.NameSimilarity(query.Name, canonical) >= 0.75) aliases.Add(query.Name);
            var meaningful = PersonaIdentityMatcher.TokenizeName(canonical);
            // Scripts and transcripts label characters by first name ("Jack", "Trevor", "SpongeBob").
            if (type == "character" && meaningful.Count >= 2)
            {
                var first = Regex.Matches(canonical, @"[\p{L}\p{N}'’.-]+").Select(match => match.Value).FirstOrDefault(token => !PersonaIdentityMatcher.IsHonorific(PersonaIdentityMatcher.Normalize(token)));
                if (first is { Length: >= 3 }) aliases.Add(first);
            }
            return new PersonaIdentity
            {
                CanonicalName = canonical,
                Description = description,
                SubjectType = type,
                Franchise = franchise,
                Aliases = aliases.Where(alias => alias.Length >= 2).Distinct(StringComparer.OrdinalIgnoreCase).ToList(),
                WikipediaTitle = wikipediaTitle,
                FandomHost = fandom?.Host,
                FandomTitle = fandom?.Title,
                FandomSiteName = fandom?.SiteName,
                NameScore = nameScore,
            };
        }
    }

    private static bool IsDisambiguation(WikipediaHit hit) =>
        hit.Title.Contains("(disambiguation)", StringComparison.OrdinalIgnoreCase)
        || Regex.IsMatch(hit.Description, @"^(?:topics referred to by the same term|disambiguation|wikimedia disambiguation page|index of)", RegexOptions.IgnoreCase);

    private static FandomHit? BestFandomMatch(IEnumerable<FandomHit> hits, string name, string? franchise, IReadOnlyList<string> dedicatedHosts) =>
        hits.Where(hit => PersonaIdentityMatcher.NameSimilarity(name, hit.Title) >= 0.8 || PersonaIdentityMatcher.NameSimilarity(hit.Title, name) >= 0.8)
            .OrderByDescending(hit => dedicatedHosts.Contains(hit.Host))
            .ThenByDescending(hit => TitleShapeBonus(hit.Title))
            .ThenByDescending(hit => PersonaIdentityMatcher.FranchiseAffinity(franchise, hit.SiteName, hit.Host))
            .ThenBy(hit => PersonaIdentityMatcher.IsAggregatorWiki(hit.Host))
            .FirstOrDefault(hit => !PersonaIdentityMatcher.IsAggregatorWiki(hit.Host));

    private static double ScoreIdentity(PersonaIdentity identity, PersonaQuery query, string? hint, string? inferredFranchise, IReadOnlyList<string> dedicatedHosts)
    {
        var typeScore = hint is null || identity.SubjectType == "unknown" ? 0.5 : identity.SubjectType == hint ? 1 : 0;
        var franchise = query.Franchise ?? inferredFranchise;
        var franchiseScore = franchise is null ? 0.5 : PersonaIdentityMatcher.FranchiseAffinity(franchise, identity.Franchise, identity.FandomSiteName, identity.FandomHost, identity.Description);
        var dedicated = identity.FandomHost is not null && dedicatedHosts.Contains(identity.FandomHost);
        var sourceScore = (identity.WikipediaTitle is not null ? 0.6 : 0) + (identity.FandomHost is null ? 0 : dedicated ? 0.6 : PersonaIdentityMatcher.IsAggregatorWiki(identity.FandomHost) ? 0.05 : 0.3);
        if (dedicated) franchiseScore = Math.Max(franchiseScore, 0.9);
        var shape = TitleShapeBonus(identity.FandomTitle ?? identity.WikipediaTitle ?? identity.CanonicalName);
        return Math.Round(0.45 * identity.NameScore + 0.2 * typeScore + 0.2 * franchiseScore + 0.15 * Math.Min(1, sourceScore) + shape, 3);
    }

    /// <summary>
    /// One subject found on Wikipedia and on its franchise wiki is a single candidate: keep the
    /// Wikipedia article and attach the best-scoring wiki page (usually the dedicated franchise wiki).
    /// </summary>
    private static PersonaIdentity MergeGroup(IEnumerable<PersonaIdentity> group)
    {
        var members = group.OrderByDescending(identity => identity.Score).ToList();
        var wikipedia = members.FirstOrDefault(identity => identity.WikipediaTitle is not null);
        var wiki = members.FirstOrDefault(identity => identity.FandomHost is not null);
        if (wikipedia is null || wiki is null || ReferenceEquals(wikipedia, wiki) && wikipedia.FandomHost is not null) return members[0];
        return wikipedia with
        {
            FandomHost = wiki.FandomHost,
            FandomTitle = wiki.FandomTitle,
            FandomSiteName = wiki.FandomSiteName,
            Aliases = wikipedia.Aliases.Concat(wiki.Aliases).Distinct(StringComparer.OrdinalIgnoreCase).ToList(),
            Score = Math.Round(members[0].Score + 0.02, 3),
        };
    }

    /// <summary>Prefers a subject's own page over subpages and pages about works, lists, or galleries.</summary>
    private static double TitleShapeBonus(string title)
    {
        if (title.Contains('/') || Regex.IsMatch(title, @"\((?:series|tv series|film|movie|franchise|song|single|album|episode|video game|game|book|comics?|disambiguation)\)|^(?:list of|gallery|category)|transcript", RegexOptions.IgnoreCase)) return -0.2;
        if (Regex.IsMatch(title, @"\((?:[^)]*\s)?character\)", RegexOptions.IgnoreCase)) return 0.05;
        return 0;
    }

    /// <summary>
    /// Builds an identity from a Wikipedia or Fandom article URL the user picked, so research uses
    /// exactly that page. Returns null for other URLs.
    /// </summary>
    public static PersonaIdentity? IdentityFromUrl(string url, string typedName, string subjectType)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https") || !uri.AbsolutePath.StartsWith("/wiki/", StringComparison.Ordinal)) return null;
        var title = Uri.UnescapeDataString(uri.AbsolutePath[6..]).Replace('_', ' ').Trim();
        if (title.Length == 0 || title.Contains(':')) return null;
        var host = uri.Host.ToLowerInvariant();
        var isWikipedia = host is "en.wikipedia.org" or "en.m.wikipedia.org";
        var isFandom = host.EndsWith(".fandom.com", StringComparison.Ordinal);
        if (!isWikipedia && !isFandom) return null;
        var canonical = Regex.Replace(title.Split('/')[0], @"\s*\((?:character|fictional character|[^)]*\bcharacter)\)\s*$", string.Empty, RegexOptions.IgnoreCase).Trim();
        var aliases = new List<string> { canonical };
        if (PersonaIdentityMatcher.NameSimilarity(typedName, canonical) >= 0.75) aliases.Add(PersonaIdentityMatcher.ParseQuery(typedName).Name);
        var first = Regex.Matches(canonical, @"[\p{L}\p{N}'’.-]+").Select(match => match.Value).FirstOrDefault(token => !PersonaIdentityMatcher.IsHonorific(PersonaIdentityMatcher.Normalize(token)));
        if (subjectType == "character" && PersonaIdentityMatcher.TokenizeName(canonical).Count >= 2 && first is { Length: >= 3 }) aliases.Add(first);
        return new PersonaIdentity
        {
            CanonicalName = canonical,
            SubjectType = subjectType is "person" or "character" ? subjectType : "unknown",
            Franchise = PersonaIdentityMatcher.ParseQuery(typedName).Franchise,
            Aliases = aliases.Where(alias => alias.Length >= 2).Distinct(StringComparer.OrdinalIgnoreCase).ToList(),
            WikipediaTitle = isWikipedia ? title : null,
            FandomHost = isFandom ? host : null,
            FandomTitle = isFandom ? title : null,
            FandomSiteName = isFandom ? host : null,
            NameScore = PersonaIdentityMatcher.NameSimilarity(typedName, canonical),
        };
    }

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
        var canon = JoinSections(sections.Where(section => !IsBoilerplateSection(section.Heading) && !IsAnalysisSection(section.Heading) && !IsQuoteSection(section.Heading)), 9_000);
        if (canon.Length > 0)
            documents.Add(new($"{identity.FandomTitle} — {site}", url, identity.FandomHost, identity.SubjectType == "person" ? "Other reference" : "Canon reference", canon, "not-applicable", 0, "reference-text", note));
        var analysis = JoinSections(sections.Where(section => IsAnalysisSection(section.Heading)), 8_000);
        if (analysis.Length > 0)
            documents.Add(new($"{identity.FandomTitle} — {site} (personality and relationships)", url + "#Personality", identity.FandomHost, identity.SubjectType == "person" ? "Other reference" : "Character analysis", analysis, "not-applicable", 0, "reference-text", note));
        var quotes = QuoteLines(sections.Where(section => IsQuoteSection(section.Heading)).SelectMany(section => section.Lines), identity);
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
            var attribution = PersonaDialogueEvidence.DetectSpeaker(SpeakerLabels(identity), text);
            if (!attribution.IsUsable) continue;
            var turns = CleanTurns(PersonaDialogueEvidence.SelectSpeakerTurns(SpeakerLabels(identity), text, 6_000));
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
                var quotes = QuoteLines(sections.Where(section => section.Heading.Length > 0 && !IsBoilerplateSection(section.Heading) && !Regex.IsMatch(section.Heading, @"^(?:quotes about|about|misattributed|disputed)", RegexOptions.IgnoreCase)).SelectMany(section => section.Lines), identity);
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
            var attribution = PersonaDialogueEvidence.DetectSpeaker(SpeakerLabels(identity), text);
            if (!attribution.IsUsable) continue;
            var turns = CleanTurns(PersonaDialogueEvidence.SelectSpeakerTurns(SpeakerLabels(identity), text, 5_000));
            if (turns.Count < 3) continue;
            documents.Add(new($"{title} — Wikiquote", PersonaIdentityMatcher.WikiUrl("en.wikiquote.org", title), "en.wikiquote.org", "Character dialogue",
                string.Join('\n', turns), "subject-attributed", turns.Count, "explicit-speaker-labels",
                "Wikiquote dialogue with speaker labels; lines are from the listed work."));
        }
        return documents;
    }

    /// <summary>Speaker labels for transcripts: the display name first, then aliases such as a first name.</summary>
    public static IReadOnlyList<string> SpeakerLabels(PersonaIdentity identity) =>
        new[] { identity.CanonicalName }.Concat(identity.Aliases).Distinct(StringComparer.OrdinalIgnoreCase).ToList();

    /// <summary>Drops navigation and list residue ("Seasons: 1 2 3 4 …", "a | b | c") that page chrome leaves among dialogue turns.</summary>
    private static List<string> CleanTurns(string turns) =>
        turns.Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .Where(line => !line.Contains(" | ", StringComparison.Ordinal))
            .Where(line => Regex.Matches(line, @"(?<![\p{L}\p{N}])\d{1,2}(?![\p{L}\p{N}])").Count < 5)
            .Where(line => !Regex.IsMatch(line, @":\s*(?:seasons?|episodes?|movies?|films?|specials?|see also|main article)\s*:", RegexOptions.IgnoreCase))
            .ToList();

    private static List<string> QuoteLines(IEnumerable<string> lines, PersonaIdentity identity)
    {
        var otherSpeaker = new Regex(@"^\s*(?<speaker>[\p{Lu}][\p{L}'’.\- ]{1,40}):\s*\S");
        var labels = SpeakerLabels(identity).Select(Normalize).ToHashSet(StringComparer.Ordinal);
        var quotes = new List<string>();
        foreach (var raw in lines)
        {
            var line = Regex.Replace(raw, @"\s+", " ").Trim().Trim('"', '“', '”', '•', '-', ' ');
            if (line.Length is < 12 or > 600) continue;
            if (Regex.IsMatch(line, @"^(?:\[\s*edit\s*\]|edit|source|see also|external links|references|notes)$", RegexOptions.IgnoreCase)) continue;
            var speaker = otherSpeaker.Match(line);
            if (speaker.Success)
            {
                // A labelled line belongs to the subject only when the label is one of its names.
                if (!labels.Contains(PersonaIdentityMatcher.Normalize(speaker.Groups["speaker"].Value))) continue;
                line = line[(line.IndexOf(':') + 1)..].Trim();
            }
            // Source citations under a quote ("Interview with X, 2016") are not quotes.
            if (Regex.IsMatch(line, @"^(?:—|–|-)?\s*(?:as quoted in|interview|source|in an interview|episode \d|season \d)", RegexOptions.IgnoreCase)) continue;
            quotes.Add(line);
            if (quotes.Count >= 60) break;
        }
        return quotes;
    }

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

    private static bool IsQuoteSection(string heading) => Regex.IsMatch(heading, @"\bquotes?\b|\bquotations?\b|\bdialogue\b|\bcatchphrases?\b", RegexOptions.IgnoreCase);

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
