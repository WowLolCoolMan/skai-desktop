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

    /// <summary>Compatibility facade: display name first, followed by transcript aliases.</summary>
    public static IReadOnlyList<string> SpeakerLabels(PersonaIdentity identity) => PersonaQuoteEvidence.SpeakerLabels(identity);


}