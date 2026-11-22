using System.Text.RegularExpressions;

namespace SkaiDesktop.Core.Services;

/// <summary>Extracts only explicitly attributed speech and quote-section text from persona sources.</summary>
internal static class PersonaQuoteEvidence
{
    public static IReadOnlyList<string> SpeakerLabels(PersonaIdentity identity) =>
        new[] { identity.CanonicalName }.Concat(identity.Aliases).Distinct(StringComparer.OrdinalIgnoreCase).ToList();

    public static List<string> CleanTurns(string turns) => turns.Split('\n', StringSplitOptions.RemoveEmptyEntries)
        .Where(line => !line.Contains(" | ", StringComparison.Ordinal))
        .Where(line => Regex.Matches(line, @"(?<![\p{L}\p{N}])\d{1,2}(?![\p{L}\p{N}])").Count < 5)
        .Where(line => !Regex.IsMatch(line, @":\s*(?:seasons?|episodes?|movies?|films?|specials?|see also|main article)\s*:", RegexOptions.IgnoreCase))
        .ToList();

    public static List<string> QuoteLines(IEnumerable<string> lines, PersonaIdentity identity)
    {
        var otherSpeaker = new Regex(@"^\s*(?<speaker>[\p{Lu}][\p{L}'’.\- ]{1,40}):\s*\S");
        var labels = SpeakerLabels(identity).Select(PersonaKnowledgeSources.Normalize).ToHashSet(StringComparer.Ordinal);
        var quotes = new List<string>();
        foreach (var raw in lines)
        {
            var line = Regex.Replace(raw, @"\s+", " ").Trim().Trim('"', '“', '”', '•', '-', ' ');
            if (line.Length is < 12 or > 600) continue;
            if (Regex.IsMatch(line, @"^(?:\[\s*edit\s*\]|edit|source|see also|external links|references|notes)$", RegexOptions.IgnoreCase)) continue;
            var speaker = otherSpeaker.Match(line);
            if (speaker.Success)
            {
                if (!labels.Contains(PersonaIdentityMatcher.Normalize(speaker.Groups["speaker"].Value))) continue;
                line = line[(line.IndexOf(':') + 1)..].Trim();
            }
            if (Regex.IsMatch(line, @"^(?:—|–|-)?\s*(?:as quoted in|interview|source|in an interview|episode \d|season \d)", RegexOptions.IgnoreCase)) continue;
            quotes.Add(line);
            if (quotes.Count >= 60) break;
        }
        return quotes;
    }

    public static bool IsQuoteSection(string heading) =>
        Regex.IsMatch(heading, @"\bquotes?\b|\bquotations?\b|\bdialogue\b|\bcatchphrases?\b", RegexOptions.IgnoreCase);
}
