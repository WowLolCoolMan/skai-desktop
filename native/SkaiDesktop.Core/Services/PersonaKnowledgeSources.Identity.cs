using System.Text.RegularExpressions;

namespace SkaiDesktop.Core.Services;

public sealed partial class PersonaKnowledgeSources
{
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


}