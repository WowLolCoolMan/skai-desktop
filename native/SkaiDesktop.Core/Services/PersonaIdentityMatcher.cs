using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace SkaiDesktop.Core.Services;

/// <summary>Pure name and identity heuristics used by public-persona discovery.</summary>
internal static class PersonaIdentityMatcher
{
    private static readonly HashSet<string> Honorifics = new(StringComparer.Ordinal)
    {
        "captain", "capt", "sir", "dame", "madam", "mr", "mrs", "ms", "miss", "dr", "doctor", "professor", "prof",
        "king", "queen", "prince", "princess", "lord", "lady", "the", "general", "agent", "detective", "officer",
    };

    // Character and "battle stats" aggregators, fan-fiction and dubbing wikis. They often host a
    // page for every character, but the franchise's own wiki is the better canon source.
    private static readonly string[] AggregatorWikis =
    [
        "vsbattles", "villains", "hero", "heroes", "near-pure-good-hero", "pure-good-hero", "heroes-and-villain", "villainsfanon",
        "inconsistently-admirable", "deathbattle", "deathbattlefanon", "characterprofile", "powerlisting", "fanon", "dubdb",
        "dubbing-fanon", "historica", "althistory", "listofdeaths", "evil", "antagonists", "protagonists", "joke-battles",
        "ultimate-pop-culture", "fictionalcrossover", "crossoverfanon", "ideas", "community", "allthetropes", "tropedia",
        "logos", "fictionalcharacters", "muc", "international-dubbing", "dubbing", "voice-actors", "behindthevoiceactors", "aesthetics",
        "inconsistently-heinous", "pure-evil", "monster", "loathsome-characters", "awesome-characters", "near-pure-evil",
    ];

    // ---------------------------------------------------------------- query parsing and matching

    /// <summary>Splits "Boog from Open Season", "Boog (Open Season)" or "Boog - Open Season" into name and franchise.</summary>
    internal static PersonaQuery ParseQuery(string input)
    {
        var text = Regex.Replace(input ?? string.Empty, @"\s+", " ").Trim();
        if (text.Length == 0) return new(string.Empty, null);
        var parenthetical = Regex.Match(text, @"^(?<name>[^()]+?)\s*\((?<franchise>[^()]{2,80})\)$");
        if (parenthetical.Success) return Split(parenthetical);
        var from = Regex.Match(text, @"^(?<name>.+?)\s+from\s+(?:the\s+)?(?<franchise>.{2,80})$", RegexOptions.IgnoreCase);
        if (from.Success && Tokens(from.Groups["name"].Value).Count is >= 1 and <= 5) return Split(from);
        var dash = Regex.Match(text, @"^(?<name>[^,–—-]+?)\s+[–—-]\s+(?<franchise>.{2,80})$");
        if (dash.Success) return Split(dash);
        return new(text, null);

        static PersonaQuery Split(Match match) => new(match.Groups["name"].Value.Trim(), match.Groups["franchise"].Value.Trim().TrimEnd('.', ')'));
    }

    /// <summary>Lowercase, accent-free, punctuation-free form used for comparisons.</summary>
    internal static string Normalize(string value)
    {
        var decomposed = (value ?? string.Empty).Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder(decomposed.Length);
        foreach (var character in decomposed)
        {
            var category = CharUnicodeInfo.GetUnicodeCategory(character);
            if (category == UnicodeCategory.NonSpacingMark) continue;
            builder.Append(char.IsLetterOrDigit(character) ? char.ToLowerInvariant(character) : ' ');
        }
        return Regex.Replace(builder.ToString(), @"\s+", " ").Trim();
    }

    private static List<string> Tokens(string value) =>
        Normalize(Regex.Replace(value ?? string.Empty, @"\([^)]*\)", " ")).Split(' ', StringSplitOptions.RemoveEmptyEntries).ToList();

    internal static List<string> TokenizeName(string value)
    {
        var tokens = Tokens(value);
        var meaningful = tokens.Where(token => !Honorifics.Contains(token)).ToList();
        return meaningful.Count > 0 ? meaningful : tokens;
    }

    /// <summary>
    /// How well <paramref name="candidate"/> matches the name a user typed, from 0 to 1. Tolerates
    /// typos ("Phillips"/"Philips"), honorifics ("Captain"), missing surnames ("Spongebob" for
    /// "SpongeBob SquarePants"), and spacing ("Sponge Bob").
    /// </summary>
    internal static double NameSimilarity(string query, string candidate)
    {
        var queryTokens = TokenizeName(query);
        var candidateTokens = TokenizeName(candidate);
        if (queryTokens.Count == 0 || candidateTokens.Count == 0) return 0;
        double Best(string token, List<string> others) => others.Max(other => TokenSimilarity(token, other));
        var queryCoverage = queryTokens.Average(token => Best(token, candidateTokens));
        var candidateCoverage = candidateTokens.Average(token => Best(token, queryTokens));
        var combined = 0.75 * queryCoverage + 0.25 * candidateCoverage;
        var joined = TokenSimilarity(string.Concat(queryTokens), string.Concat(candidateTokens));
        // A single-token query that equals one candidate token ("Boog" vs "Boog") is a strong match
        // even when the candidate has more tokens.
        return Math.Round(Math.Max(combined, joined), 3);
    }

    private static double TokenSimilarity(string left, string right)
    {
        if (left == right) return 1;
        if (left.Length == 0 || right.Length == 0) return 0;
        var distance = Levenshtein(left, right);
        var similarity = 1.0 - (double)distance / Math.Max(left.Length, right.Length);
        // Short tokens need to match exactly; one edit in a three-letter name is a different name.
        if (Math.Min(left.Length, right.Length) <= 3 && distance > 0) similarity *= 0.5;
        // Below this, two tokens are different words ("hyde"/"home"), not a typo ("phillips"/"philips").
        return similarity >= 0.7 ? similarity : 0;
    }

    private static int Levenshtein(string left, string right)
    {
        var previous = new int[right.Length + 1];
        var current = new int[right.Length + 1];
        for (var j = 0; j <= right.Length; j++) previous[j] = j;
        for (var i = 1; i <= left.Length; i++)
        {
            current[0] = i;
            for (var j = 1; j <= right.Length; j++)
            {
                var cost = left[i - 1] == right[j - 1] ? 0 : 1;
                current[j] = Math.Min(Math.Min(current[j - 1] + 1, previous[j] + 1), previous[j - 1] + cost);
            }
            (previous, current) = (current, previous);
        }
        return previous[right.Length];
    }

    /// <summary>Classifies a Wikipedia short description as a person, character, creative work, or unknown.</summary>
    internal static string ClassifyDescription(string description)
    {
        var text = (description ?? string.Empty).ToLowerInvariant();
        if (text.Length == 0) return "unknown";
        if (Regex.IsMatch(text, @"\b(?:fictional|character|mascot|protagonist|antagonist|anthropomorphic)\b")) return "character";
        if (Regex.IsMatch(text, @"\b(?:born|died|\(\d{4}|\d{4}\s*[–-]\s*\d{4})\b|\(born|\b(?:actor|actress|comedian|politician|singer|rapper|writer|author|journalist|broadcaster|presenter|footballer|athlete|player|youtuber|streamer|podcaster|businessman|businesswoman|entrepreneur|musician|director|producer|activist|scientist|philosopher|chef|artist|model|internet personality)\b")) return "person";
        if (Regex.IsMatch(text, @"\b(?:film|movie|series|sitcom|video game|game|franchise|novel|album|single|song|episode|book|attraction|ride|theme park|restaurant|toy|brand|comic|manga|anime|show|programme|program|company|organization|organisation|band|website|software)\b")) return "work";
        return "unknown";
    }

    /// <summary>Pulls the franchise out of descriptions such as "Fictional character in the Pirates of the Caribbean film series".</summary>
    internal static string? ExtractFranchise(string description)
    {
        var match = Regex.Match(description ?? string.Empty, @"\b(?:in|from|of)\s+(?:the\s+)?(?<franchise>[A-Z0-9][^,;]+)$");
        if (!match.Success) return null;
        var franchise = Regex.Replace(match.Groups["franchise"].Value,
            @"\s+(?:(?:animated|live-action|media|film|movie|video game|game|book|novel|comic|television|tv|web|anime|manga)\s+)*(?:series|franchise|films?|games?|universe|saga|trilogy|show|sitcom)\s*$",
            string.Empty, RegexOptions.IgnoreCase).Trim();
        return franchise.Length is >= 2 and <= 80 && !Regex.IsMatch(franchise, @"^(?:the\s+)?same name$", RegexOptions.IgnoreCase) ? franchise : null;
    }

    internal static bool IsAggregatorWiki(string host)
    {
        var subdomain = host.Split('.')[0].ToLowerInvariant();
        return AggregatorWikis.Any(name => subdomain.Equals(name, StringComparison.Ordinal) || subdomain.Contains("fanon", StringComparison.Ordinal) || subdomain.EndsWith("-fanon", StringComparison.Ordinal));
    }

    internal static double FranchiseAffinity(string? franchise, params string?[] evidence)
    {
        if (string.IsNullOrWhiteSpace(franchise)) return 0.5;
        var wanted = TokenizeName(franchise).Where(token => token.Length > 2).ToArray();
        if (wanted.Length == 0) return 0.5;
        var haystack = " " + Normalize(string.Join(' ', evidence.Where(item => item is not null))) + " ";
        var joinedHaystack = haystack.Replace(" ", string.Empty);
        var hits = wanted.Count(token => haystack.Contains($" {token} ", StringComparison.Ordinal) || joinedHaystack.Contains(token, StringComparison.Ordinal));
        return (double)hits / wanted.Length;
    }

    internal static string WikiUrl(string host, string title) => $"https://{host}/wiki/{Uri.EscapeDataString(title.Replace(' ', '_')).Replace("%2F", "/").Replace("%3A", ":")}";

    internal static bool IsHonorific(string token) => Honorifics.Contains(token);
}
