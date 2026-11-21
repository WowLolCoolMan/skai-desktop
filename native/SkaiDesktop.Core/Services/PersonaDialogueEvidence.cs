using System.Text.RegularExpressions;

namespace SkaiDesktop.Core.Services;

using SkaiDesktop.Core.Models;

/// <summary>Conservative checks for transcript structure and explicit persona speaker labels.</summary>
public static class PersonaDialogueEvidence
{
    public sealed record SpeakerAttribution(int TurnCount, string SpeakerName)
    {
        public bool IsUsable => TurnCount >= 3;
    }

    public static bool IsUsableSpeechEvidence(string sourceType, string speakerAttribution, int attributedTurnCount)
    {
        var dialogueType = sourceType.Contains("transcript", StringComparison.OrdinalIgnoreCase)
            || sourceType.Contains("interview", StringComparison.OrdinalIgnoreCase)
            || sourceType.Contains("dialogue", StringComparison.OrdinalIgnoreCase)
            || sourceType.Contains("caption", StringComparison.OrdinalIgnoreCase);
        return dialogueType && speakerAttribution.Equals("subject-attributed", StringComparison.OrdinalIgnoreCase) && attributedTurnCount >= 3;
    }

    public static bool HasTranscriptStructure(string text)
    {
        var timestampedTurns = Regex.Matches(text, @"(?:^|\r?\n)\s*(?:Starting point is\s+)?(?:\[)?\d{1,2}:\d{2}(?::\d{2})?(?:\])?\s+\S", RegexOptions.Multiline).Count;
        var labeledTurns = Regex.Matches(text, @"(?:^|\r?\n)\s*(?:\[[^\]]{2,50}\]|[A-Z][A-Z .'-]{2,35}:)\s+\S", RegexOptions.Multiline).Count;
        var titleCaseSpeakerTurns = Regex.Matches(text, @"(?:^|\r?\n)\s*(?:\*\*)?[\p{Lu}][\p{L}'.-]{1,30}(?:\s+[\p{Lu}][\p{L}'.-]{1,30}){0,3}(?:\*\*)?:\s*\S", RegexOptions.Multiline).Count;
        var namedSpeakerStamps = Regex.Matches(text, @"(?:^|\r?\n)\s*[\p{Lu}][\p{L}'.-]{1,30}(?:\s+[\p{Lu}][\p{L}'.-]{1,30}){0,3}\s+\(\d{1,2}:\d{2}(?::\d{2})?\)", RegexOptions.Multiline).Count;
        var screenplaySpeakerLabels = Regex.Matches(text, @"^\s*[A-Z][A-Z .'-]{2,35}\s*$", RegexOptions.Multiline).Count;
        return timestampedTurns >= 3 || labeledTurns >= 3 || titleCaseSpeakerTurns >= 3 || namedSpeakerStamps >= 3 || screenplaySpeakerLabels >= 3;
    }

    public static SpeakerAttribution DetectSubjectSpeaker(string subject, string text)
        => DetectSpeaker(BuildSubjectAliases(subject), text);

    /// <summary>
    /// Counts dialogue turns labelled with any of <paramref name="speakerLabels"/>. The first label is
    /// the display name. Callers that know a subject's canonical aliases (for example a resolved
    /// character whose transcripts label it "SpongeBob" rather than "SpongeBob SquarePants") pass them here.
    /// </summary>
    public static SpeakerAttribution DetectSpeaker(IReadOnlyList<string> speakerLabels, string text)
    {
        var aliases = NormalizeLabels(speakerLabels);
        if (aliases.Count == 0) return new(0, string.Empty);
        var labelPattern = BuildSpeakerLabelPattern(aliases);
        var lines = text.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries);
        var count = 0;
        for (var index = 0; index < lines.Length; index++)
        {
            var match = labelPattern.Match(lines[index]);
            if (!match.Success) continue;
            var inline = match.Groups["inline"].Value.Trim();
            var following = FindFollowingDialogueLine(lines, index, labelPattern);
            if (inline.Length >= 12 || following.Length >= 12) count++;
        }
        return new(count, aliases[0]);
    }

    public static string SelectAttributedSpeakerTurns(string subject, string text, int maxCharacters = 6_000)
        => SelectSpeakerTurns(BuildSubjectAliases(subject), text, maxCharacters);

    /// <summary>Selects turns labelled with any of <paramref name="speakerLabels"/>, relabelled with the first (display) label.</summary>
    public static string SelectSpeakerTurns(IReadOnlyList<string> speakerLabels, string text, int maxCharacters = 6_000)
    {
        var aliases = NormalizeLabels(speakerLabels);
        if (aliases.Count == 0) return string.Empty;
        var labelPattern = BuildSpeakerLabelPattern(aliases);
        var lines = text.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries).Select(line => line.Trim()).ToArray();
        var sample = new System.Text.StringBuilder();
        for (var index = 0; index < lines.Length; index++)
        {
            var match = labelPattern.Match(lines[index]);
            if (!match.Success) continue;
            var turn = match.Groups["inline"].Value.Trim().TrimStart(':').Trim();
            if (turn.Length < 12 && index + 1 < lines.Length)
            {
                turn = FindFollowingDialogueLine(lines, index, labelPattern);
            }
            if (turn.Length < 12) continue;
            var separator = sample.Length == 0 ? string.Empty : "\n";
            var item = $"{separator}{aliases[0]}: {turn}";
            if (sample.Length + item.Length > maxCharacters) break;
            sample.Append(item);
        }
        return sample.ToString();
    }

    private static List<string> NormalizeLabels(IReadOnlyList<string> labels)
    {
        var cleaned = labels.Select(label => Regex.Replace(label ?? string.Empty, @"\s+", " ").Trim())
            .Where(label => label.Length >= 2)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        // Screenplays use uppercase cues; keep an uppercase copy of each label for that form.
        foreach (var label in cleaned.ToArray()) if (!cleaned.Contains(label.ToUpperInvariant(), StringComparer.Ordinal)) cleaned.Add(label.ToUpperInvariant());
        return cleaned;
    }

    private static string FindFollowingDialogueLine(string[] lines, int speakerLine, Regex speakerPattern)
    {
        for (var index = speakerLine + 1; index < lines.Length; index++)
        {
            var line = lines[index].Trim();
            if (speakerPattern.IsMatch(line)) return string.Empty;
            if (Regex.IsMatch(line, @"^\([^)]{1,100}\)$")) continue;
            if (Regex.IsMatch(line, @"^[A-Z][A-Z .'-]{2,35}$")) return string.Empty;
            // Any other speaker label, including a single name ("Beth: [roaring]"), starts someone else's turn.
            if (Regex.IsMatch(line, @"^(?:[A-Z][A-Z .'-]{2,35}|[\p{Lu}][\p{L}'.-]{1,30}(?:\s+[\p{Lu}][\p{L}'.-]{1,30}){0,3})\s*:\s*\S")) return string.Empty;
            return line;
        }
        return string.Empty;
    }

    /// <summary>Conservatively blocks first-person memories unless selected evidence directly supports the requested detail.</summary>
    public static bool RequiresUnsupportedMemoryBoundary(SavedPersona persona, string? query)
    {
        if (string.IsNullOrWhiteSpace(query)) return false;
        var asksForPersonalExperience = Regex.IsMatch(query,
            @"\b(?:do you remember|what do you remember|what was your first|when did you first|did you first|how did you get|where did you get|what happened when|what happened to you|tell me about your childhood|your childhood|did you grow up|where did you grow up|where were you born|who taught you|how did you learn|what did you do when|how did you feel when|what did it feel like|how did it feel to|what do you remember about|have you ever|did you ever|was there a time you|tell me about when|your first time|your relationship with|how did you know)\b",
            RegexOptions.IgnoreCase);
        if (!asksForPersonalExperience) return false;
        var concepts = Regex.Matches(query.ToLowerInvariant(), @"[\p{L}\p{N}]{4,}")
            .Select(match => match.Value)
            .Where(term => term is not ("what" or "when" or "where" or "your" or "first" or "tell" or "about" or "remember" or "happened" or "did" or "have" or "with" or "from" or "that" or "this" or "were" or "does" or "into" or "learn" or "feel" or "like" or "ever" or "time"))
            .Distinct(StringComparer.Ordinal).ToArray();
        var memorySources = persona.Sources.Where(source => !string.IsNullOrWhiteSpace(source.Excerpt)
            && (source.SpeakerAttribution == "subject-attributed"
                || persona.SubjectType == "character" && source.Type is "Canon reference" or "Official source" or "Character dialogue" or "Story transcript"))
            .ToArray();
        if (memorySources.Length == 0 || concepts.Length == 0) return true;
        var evidence = string.Join(' ', memorySources.Select(source => source.Excerpt).Append(persona.Timeline));
        var segments = Regex.Split(evidence, @"(?<=[.!?])\s+|\r?\n+")
            .Select(segment => segment.Trim())
            .Where(segment => segment.Length >= 24)
            .ToArray();
        var asksHowAcquired = Regex.IsMatch(query, @"\b(?:how|where) did you (?:get|find|receive|acquire)\b", RegexOptions.IgnoreCase);
        var asksIntent = Regex.IsMatch(query, @"\b(?:what did you want|why did you|what were you looking for)\b", RegexOptions.IgnoreCase);
        var asksFirstEvent = Regex.IsMatch(query, @"\bwhat was your first\b|\b(?:who|what|when) did you first\b|\bfirst time\b", RegexOptions.IgnoreCase);
        return !segments.Any(segment =>
        {
            if (concepts.Any(term => !segment.Contains(term, StringComparison.OrdinalIgnoreCase))) return false;
            if (asksHowAcquired && !Regex.IsMatch(segment, @"\b(?:got|received|given|found|acquired|inherited|won|stole|took)\b", RegexOptions.IgnoreCase)) return false;
            if (asksIntent && !Regex.IsMatch(segment, @"\b(?:want(?:ed)?|desire[ds]?|hop(?:e|ed)|intend(?:ed)?|goal|look(?:ing)? for|seek(?:ing)?)\b", RegexOptions.IgnoreCase)) return false;
            if (asksFirstEvent && !Regex.IsMatch(segment, @"\b(?:first|earliest|initial)\b", RegexOptions.IgnoreCase)) return false;
            return true;
        });
    }

    /// <summary>Detects likely fabricated quotations without mistaking quoted terms for attributed speech.</summary>
    public static bool ContainsUnverifiedQuotation(SavedPersona persona, string response)
    {
        var quotedSpans = Regex.Matches(response,
            "\\\"(?<double>[^\\\"\\r\\n]{8,400})\\\"|“(?<curly>[^”\\r\\n]{8,400})”|‘(?<single>[^’\\r\\n]{8,400})’");
        foreach (Match span in quotedSpans)
        {
            var value = span.Groups["double"].Success ? span.Groups["double"].Value
                : span.Groups["curly"].Success ? span.Groups["curly"].Value
                : span.Groups["single"].Value;
            if (persona.VerifiedQuotes.Any(quote => quote.Text.Contains(value, StringComparison.Ordinal))) continue;
            if (value.Length >= 12 && persona.Sources.Any(source => source.Excerpt.Contains(value, StringComparison.Ordinal))) return true;
            var contextStart = Math.Max(0, span.Index - 90);
            var contextEnd = Math.Min(response.Length, span.Index + span.Length + 90);
            var context = response[contextStart..contextEnd];
            var explicitlyAttributed = Regex.IsMatch(context,
                @"\b(?:said|says|quote|quoted|famous line|you told me|you said|I told|I said|he said|she said)\b",
                RegexOptions.IgnoreCase);
            // In a persona chat, generated in-character dialogue may be placed
            // in quotation marks. Only block wording presented as an actual
            // quote or wording copied from source evidence.
            if (explicitlyAttributed && value.Length >= 12) return true;
        }
        return false;
    }

    private static List<string> BuildSubjectAliases(string subject)
    {
        var names = Regex.Matches(subject, @"[\p{L}\p{N}]{3,}").Select(match => match.Value)
            .Where(name => !new[] { "captain", "the", "sir", "mr", "mrs", "ms", "dr" }.Contains(name, StringComparer.OrdinalIgnoreCase))
            .Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        if (names.Length == 0) return [];
        var fullName = string.Join(' ', names);
        // Screenplays commonly label Captain Jack Sparrow simply as JACK.
        // Permit that shortened label only for an explicitly titled character;
        // using either first or last names for ordinary public figures is too
        // likely to attribute another speaker's lines by accident.
        var aliases = new List<string> { fullName, fullName.ToUpperInvariant() };
        if (Regex.IsMatch(subject, @"^\s*Captain\b", RegexOptions.IgnoreCase) && names.Length > 1)
            aliases.Add(names[0]);
        return aliases;
    }

    private static Regex BuildSpeakerLabelPattern(IReadOnlyList<string> aliases)
    {
        var label = string.Join('|', aliases.Distinct(StringComparer.OrdinalIgnoreCase).Select(Regex.Escape));
        var screenplayAliases = aliases.Where(alias => !alias.Contains(' ')).ToArray();
        if (screenplayAliases.Length == 0) screenplayAliases = aliases.ToArray();
        var screenplayLabel = string.Join('|', screenplayAliases.Distinct(StringComparer.OrdinalIgnoreCase).Select(alias => Regex.Escape(alias.ToUpperInvariant())));
        // A speaker cue is an isolated name, a timestamped name, a screenplay
        // continuation cue, or a colon-labeled line. Never accept arbitrary
        // text after a short alias: action such as "Jack walks to the ship"
        // is not dialogue even though it starts with the character's name.
        // Bare screenplay cues must be uppercase; transcript labels can use
        // normal name casing when they include a timestamp or colon.
        return new Regex($@"^\s*(?:\[\s*(?i:{label})\s*\]|(?i:{label})\s*\(\d{{1,2}}:\d{{2}}(?::\d{{2}})?\)\s*(?<inline>.*)|(?i:{label})\s*:\s*(?<inline>.*)|(?:{screenplayLabel})(?:\s*\(CONT['’]?D\))?)\s*$", RegexOptions.CultureInvariant);
    }
}
