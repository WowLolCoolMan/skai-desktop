using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using SkaiDesktop.Core.Infrastructure;
using SkaiDesktop.Core.Models;
using SkaiDesktop.Core.Services;

namespace SkaiDesktop.AgentHost.Protocol;
public static partial class AgentHostLoop
{
    private static async Task<AgentResponse> DiscoverPersonaAsync(AgentRequest request)
    {
        var query = RequiredBoundedString(request, "query", 240);
        var subjectType = OptionalString(request, "subjectType")?.Equals("character", StringComparison.OrdinalIgnoreCase) == true ? "character" : "person";
        var notes = OptionalString(request, "notes") ?? string.Empty;
        if (notes.Length > 600 || notes.Any(char.IsControl)) throw new InvalidOperationException("Search notes exceed the safety limit.");
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(35));
        var search = new WebSearchProvider();
        var requestedUrls = OptionalStringList(request, "sourceUrls", 24, 2_000)
            .Where(url => Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https")
            .Distinct(StringComparer.OrdinalIgnoreCase);
        var directMatches = requestedUrls
            .Select(url =>
            {
                var uri = new Uri(url);
                var title = Uri.UnescapeDataString(uri.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries).LastOrDefault() ?? uri.Host)
                    .Replace('-', ' ').Replace('_', ' ');
                return new WebSearchResult(title, uri.AbsoluteUri, "Source URL supplied by you. Open it and confirm that it refers to the intended character.");
            })
            .ToArray();
        // Include user-supplied URLs alongside public search results; neither
        // the URL nor the entered name should suppress other candidates.
        IReadOnlyList<WebSearchResult> results = directMatches;
        // Structured knowledge sources (Wikipedia, franchise wikis) resolve typos, franchise hints
        // ("Boog from Open Season"), and person/character type far better than web results.
        var knowledge = new PersonaKnowledgeSources();
        var identitiesTask = knowledge.ResolveAsync(query, subjectType, timeout.Token);
        var discoveryTerms = subjectType == "character" ? "fictional character franchise canon" : "real person biography profile";
        var identityNames = PersonaSearchNames(PersonaKnowledgeSources.ParseQuery(query).Name is { Length: > 0 } parsedName ? parsedName : query);
        var queryVariants = identityNames.SelectMany(subjectName => new[]
            {
                $"\"{subjectName}\" {discoveryTerms}",
                $"{subjectName} {notes} {discoveryTerms}",
                subjectName,
            })
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Distinct(StringComparer.OrdinalIgnoreCase);
        using var searchLimit = new SemaphoreSlim(3, 3);
        try
        {
            var batches = await Task.WhenAll(queryVariants.Select(async variant =>
            {
                await searchLimit.WaitAsync(timeout.Token).ConfigureAwait(false);
                try
                {
                    try { return await search.SearchAsync(variant, timeout.Token).ConfigureAwait(false); }
                    catch (OperationCanceledException) when (timeout.IsCancellationRequested) { throw; }
                    catch { return Array.Empty<WebSearchResult>(); }
                }
                finally { searchLimit.Release(); }
            })).ConfigureAwait(false);
            var candidates = batches.SelectMany(batch => batch)
                .GroupBy(result => result.Url, StringComparer.OrdinalIgnoreCase)
                .Select(group => group.First());
            results = directMatches.Concat(candidates)
                .GroupBy(result => result.Url, StringComparer.OrdinalIgnoreCase)
                .Select(group => group.First())
                .ToArray();
        }
        catch (OperationCanceledException) when (timeout.IsCancellationRequested) { throw new TimeoutException("People search took too long. Try again with a fuller name."); }
        var identities = await identitiesTask.ConfigureAwait(false);
        var identityUrls = identities.SelectMany(identity => new[] { identity.WikipediaUrl, identity.FandomUrl }).Where(url => url is not null).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var typedName = PersonaKnowledgeSources.ParseQuery(query).Name;
        results = results
            .GroupBy(result => result.Url, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .Where(result => !identityUrls.Contains(result.Url))
            // Search engines pad results with unrelated pages ("SAM.gov" for "Sam Hyde"); keep only
            // results that name the subject, plus any URL the user supplied.
            .Where(result => directMatches.Any(direct => direct.Url == result.Url)
                || ContainsPersonaName(typedName, $"{result.Title} {result.Snippet} {result.Url}")
                || PersonaKnowledgeSources.NameSimilarity(typedName, PersonaCandidateName(typedName, result.Title)) >= 0.75)
            .ToArray();
        var identityMatches = identities.Select(identity => (object)new
        {
            id = $"identity:{identity.PrimaryUrl}",
            title = identity.Description.Length > 0 && identity.Description.Length <= 140 ? $"{identity.CanonicalName} — {identity.Description}" : identity.CanonicalName,
            canonicalName = identity.CanonicalName,
            snippet = string.Join(" · ", new[]
            {
                identity.SubjectType == "character" ? (identity.Franchise is null ? "Fictional character" : $"Character from {identity.Franchise}") : identity.SubjectType == "person" ? "Real person" : null,
                identity.Description.Length > 140 ? identity.Description[..140] + "…" : null,
                identity.SourceSummary.Length > 0 ? $"Sources: {identity.SourceSummary}" : null,
            }.Where(part => part is not null)),
            url = identity.PrimaryUrl,
            nameMatch = identity.NameScore >= 0.75,
            manualQuery = false,
            resolved = true,
            subjectType = identity.SubjectType,
            franchise = identity.Franchise,
            aliases = identity.Aliases,
        });
        var matches = new object[]
            {
                new
                {
                    id = $"entered-name:{query}",
                    title = $"Use this name: {query}",
                    canonicalName = PersonaDisplayNameFromQuery(query),
                    snippet = "Continue with the name and aliases you entered, even if public search results are missing or unrelated.",
                    url = string.Empty,
                    nameMatch = false,
                    manualQuery = true,
                },
            }
            .Concat(identityMatches)
            .Concat(results.Select(result => (object)new
            {
                id = result.Url,
                title = result.Title,
                canonicalName = PersonaCandidateName(query, result.Title),
                snippet = result.Snippet,
                url = result.Url,
                nameMatch = ContainsPersonaName(query, $"{result.Title} {result.Snippet} {result.Url}"),
                manualQuery = false,
            }))
            .ToArray();
        return new(ProtocolVersion, request.Id, true, new { query, subjectType, matches });
    }

    private static string PersonaCandidateName(string query, string title)
    {
        var separator = Regex.Match(title, @"\s+(?:\||—|–|-)\s+");
        var candidate = (separator.Success ? title[..separator.Index] : title).Trim();
        return candidate.Length is > 0 and <= 120 && candidate.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length <= 8
            ? candidate
            : query;
    }

    private static string[] PersonaSearchNames(string query)
    {
        var aliases = Regex.Match(query, @"\b(?:also\s+known\s+as|a\.k\.a\.|aka)\s+(.+?)(?:\)|;|$)", RegexOptions.IgnoreCase);
        var primary = aliases.Success ? query[..aliases.Index] : query;
        var names = new List<string> { PersonaNameWithoutHonorifics(primary) };
        if (aliases.Success)
            names.AddRange(Regex.Split(aliases.Groups[1].Value, @"\s+or\s+|[,;/|]+")
                .Select(PersonaNameWithoutHonorifics));
        return names.Where(name => !string.IsNullOrWhiteSpace(name))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(5)
            .ToArray();
    }

    private static string PersonaDisplayNameFromQuery(string query)
    {
        var aliases = Regex.Match(query, @"\b(?:also\s+known\s+as|a\.k\.a\.|aka)\s+", RegexOptions.IgnoreCase);
        var displayName = aliases.Success ? query[..aliases.Index] : query;
        return displayName.Trim().TrimEnd('(', '[', ';', ':', ',').Trim();
    }

    /// <summary>
    /// Drafts persona profile fields from researched sources: a computed voice card plus two small,
    /// schema-constrained model passes (identity/knowledge, then personality/voice).
    /// </summary>
}
