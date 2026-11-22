using System.Text;
using System.Text.RegularExpressions;
using SkaiDesktop.Core.Models;
using SkaiDesktop.Core.Services;

namespace SkaiDesktop.AgentHost.Protocol;

public static partial class AgentHostLoop
{
    private static string CategorizePersonaSource(string subjectType, string suggested, string title, string url, string excerpt)
    {
        var text = $"{title} {url} {excerpt}";
        if (subjectType == "character")
        {
            var sourceIdentity = $"{title} {url}";
            if (Regex.IsMatch(sourceIdentity, @"\b(?:screenplay|dialogue transcript|movie transcript|film transcript|movie script|film script|subtitles|script)\b", RegexOptions.IgnoreCase)
                || Regex.IsMatch(text, @"\b(?:subtitles found|transcript|dialogue transcript|movie script|film script)\b|\b\d{1,2}:\d{2}:\d{2}\b", RegexOptions.IgnoreCase)) return "Story transcript";
            if (Regex.IsMatch(sourceIdentity, @"\b(?:character dialogue|dialogue|quotes|lines spoken by)\b", RegexOptions.IgnoreCase)) return "Character dialogue";
            if (Regex.IsMatch(text, @"\b(?:character analysis|story arc|motivations|personality|lore)\b", RegexOptions.IgnoreCase)) return "Character analysis";
            if (Regex.IsMatch(text, @"\b(?:official character|canon|franchise|character profile|character wiki|film character|fictional character)\b", RegexOptions.IgnoreCase)
                || Regex.IsMatch(url, @"(?:disney\.com|fandom\.com|wikipedia\.org)/", RegexOptions.IgnoreCase)) return "Canon reference";
            return "Other reference";
        }
        if (Regex.IsMatch(url, @"(?:wikipedia\.org|britannica\.com)/", RegexOptions.IgnoreCase) || Regex.IsMatch(text, @"\b(?:biography|biographical|official profile|about (?:him|her|them)|early life|alumni|career profile)\b", RegexOptions.IgnoreCase)) return "Biography";
        if (Regex.IsMatch(url, @"(?:youtube\.com|youtu\.be)/", RegexOptions.IgnoreCase)) return "Video reference";
        if (suggested == "Conversation transcript" && Regex.IsMatch(text, @"\btranscript\b", RegexOptions.IgnoreCase)) return "Conversation transcript";
        if (Regex.IsMatch(text, @"\b(?:podcast|episode)\b.{0,80}\btranscript\b|\btranscript\b.{0,80}\b(?:podcast|episode)\b", RegexOptions.IgnoreCase)) return "Conversation transcript";
        if (Regex.IsMatch(text, @"\b(?:interview|Q\s*&\s*A|in conversation with)\b", RegexOptions.IgnoreCase)) return "Interview";
        if (suggested == "Video captions" && Regex.IsMatch(url, @"(?:youtube\.com|youtu\.be)/", RegexOptions.IgnoreCase)) return "Video reference";
        return "Other reference";
    }

    private static bool IsPersonaSearchResultRelevant(string subject, string clues, string title, string snippet)
    {
        var text = $"{title} {snippet}";
        return ContainsPersonaName(subject, text) || ContainsPersonaClue(clues, text);
    }

    private static bool LooksLikeTranscriptShell(string url, string text)
    {
        if (!Regex.IsMatch(url, @"(?:transcript|transcripts|caption|subtitles)", RegexOptions.IgnoreCase)) return false;
        if (Regex.IsMatch(text, @"(?:click here if (?:the )?page does not redirect|enable javascript to run this app|loading transcript\.\.\.|transcript unavailable|search .* episodes? & transcripts)", RegexOptions.IgnoreCase)) return true;
        var timedLines = Regex.Matches(text, @"\b\d{1,2}:\d{2}(?::\d{2})?\b").Count;
        var labeledLines = Regex.Matches(text, @"(?:^|\r?\n)\s*(?:\[[^\]]{2,50}\]|[A-Z][A-Z .'-]{2,35}:)\s+\S", RegexOptions.Multiline).Count;
        return text.Length < 700 && timedLines < 3 && labeledLines < 3;
    }

    private static string SelectMixedTranscriptSample(string text)
    {
        var candidates = Regex.Split(text, @"(?=\b(?:Starting point is\s+)?\d{1,2}:\d{2}:\d{2}\b)", RegexOptions.IgnoreCase)
            .Select(turn => Regex.Replace(turn, @"\s+", " ").Trim())
            .Where(turn => turn.Length >= 40)
            .ToArray();
        candidates = candidates.Where(turn => !Regex.IsMatch(turn,
            @"\b(?:this (?:episode|podcast) is brought to you by|sponsored by|use (?:the )?(?:promo )?code|promo code|discount code|limited.time offer|thanks to our sponsor|joe rogan podcast by night|check it out)\b",
            RegexOptions.IgnoreCase)).ToArray();
        var stride = Math.Max(1, candidates.Length / 18);
        var turns = candidates.Where((_, index) => index % stride == 0).Take(18).ToArray();
        var sample = string.Join("\n", turns);
        return sample[..Math.Min(sample.Length, 6_000)];
    }

    private static bool IsDialogueSource(SavedPersonaSource source) =>
        source.Type.Contains("transcript", StringComparison.OrdinalIgnoreCase)
        || source.Type.Contains("interview", StringComparison.OrdinalIgnoreCase)
        || source.Type.Contains("dialogue", StringComparison.OrdinalIgnoreCase)
        || source.Type.Contains("caption", StringComparison.OrdinalIgnoreCase);

    private static bool RequiresUnsupportedMemoryBoundary(SavedPersona persona, string? query)
        => PersonaDialogueEvidence.RequiresUnsupportedMemoryBoundary(persona, query);

    private static string? TryBuildPersonaEvidenceSummary(SavedPersona persona, string? query)
    {
        if (string.IsNullOrWhiteSpace(query) || !Regex.IsMatch(query, @"\b(?:selected sources|canon sources|documented public roles|sources establish|source material establish|what is documented)\b", RegexOptions.IgnoreCase)) return null;
        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(persona.Roles)) parts.Add($"The profile's supported role summary is: {persona.Roles.Trim()}");
        if (!string.IsNullOrWhiteSpace(persona.Knowledge)) parts.Add($"The selected corpus covers: {persona.Knowledge.Trim()}");
        if (!string.IsNullOrWhiteSpace(persona.Timeline)) parts.Add($"The saved timeline says: {persona.Timeline.Trim()}");
        if (!string.IsNullOrWhiteSpace(persona.EvidenceBoundaries)) parts.Add($"Evidence limits: {persona.EvidenceBoundaries.Trim()}");
        if (parts.Count == 0) return $"The selected sources do not yet support a reliable summary for {persona.Name}.";
        return string.Join(" ", parts) + " This summarizes the saved profile fields; it is not a claim of personal memory.";
    }

    private static bool ContainsUnverifiedQuotation(SavedPersona persona, string response)
        => PersonaDialogueEvidence.ContainsUnverifiedQuotation(persona, response);

    private static bool IsPersonaSourceRelevant(string subject, string title, string excerpt)
    {
        // Discovery clues can widen search, but only pages that mention the
        // selected subject itself are retained as evidence.
        return ContainsPersonaName(subject, $"{title} {excerpt}");
    }

    private static string SelectPersonaEvidenceExcerpt(string subject, string clues, string title, string text)
    {
        var stopWords = new HashSet<string>(StringComparer.Ordinal)
        {
            "captain", "original", "film", "canon", "continuity", "character", "person", "the", "and", "for", "with", "what", "when", "where", "how", "who", "does", "did", "was", "were", "about", "from", "that", "this", "into", "their", "they", "have", "your", "you", "more", "some", "would", "could", "should", "dialogue", "transcript", "script", "source", "public", "official", "profile", "history", "information"
        };
        var subjectTokens = Regex.Matches(subject.ToLowerInvariant(), @"[\p{L}\p{N}]{3,}")
            .Select(match => match.Value).Where(token => !stopWords.Contains(token)).Distinct(StringComparer.Ordinal).ToArray();
        var clueTokens = Regex.Matches(clues.ToLowerInvariant(), @"[\p{L}\p{N}]{4,}")
            .Select(match => match.Value).Where(token => !stopWords.Contains(token)).Distinct(StringComparer.Ordinal).ToArray();
        var tokens = subjectTokens.Concat(clueTokens).Distinct(StringComparer.Ordinal).ToArray();
        if (tokens.Length == 0) return text[..Math.Min(text.Length, 2_000)].Trim();

        var chunks = Regex.Split(text, @"(?<=[.!?])\s+|\r?\n+")
            .SelectMany(part => part.Length <= 900
                ? [part]
                : Enumerable.Range(0, (part.Length + 699) / 700).Select(index => part.Substring(index * 700, Math.Min(700, part.Length - index * 700))))
            .Select((value, index) => (value: Regex.Replace(value, @"\s+", " ").Trim(), index))
            .Where(item => item.value.Length >= 45)
            .Where(item => !IsNavigationLike(item.value))
            .Select(item =>
            {
                var normalized = $" {Regex.Replace(item.value.ToLowerInvariant(), @"[^\p{L}\p{N}]+", " ")} ";
                var subjectHits = subjectTokens.Count(token => normalized.Contains($" {token} ", StringComparison.Ordinal));
                var clueHits = clueTokens.Count(token => normalized.Contains($" {token} ", StringComparison.Ordinal));
                var score = subjectHits * 5 + Math.Min(clueHits, 3);
                if (subjectTokens.Length > 1 && subjectTokens.All(token => normalized.Contains($" {token} ", StringComparison.Ordinal))) score += 4;
                if (title.Contains("official", StringComparison.OrdinalIgnoreCase) && subjectHits > 0) score += 1;
                return (item.value, item.index, score);
            })
            .Where(item => item.score > 0)
            .OrderByDescending(item => item.score)
            .ThenBy(item => item.index)
            .Take(24)
            .OrderBy(item => item.index)
            .ToArray();
        var selected = new StringBuilder();
        foreach (var chunk in chunks)
        {
            if (selected.Length + chunk.value.Length + 1 > 7_800) break;
            if (selected.Length > 0) selected.Append(' ');
            selected.Append(chunk.value);
        }
        return selected.ToString();
    }

    private static bool IsNavigationLike(string value)
    {
        if (Regex.IsMatch(value, @"\b(?:skip navigation|cookie settings|privacy policy|terms of use|sign in|log in|subscribe now|search the site)\b", RegexOptions.IgnoreCase)) return true;
        var navigationWords = Regex.Matches(value, @"\b(?:home|explore|shop|all movies|all parks|tickets|account|support|help|menu|store|sale|search|sign in|subscribe)\b", RegexOptions.IgnoreCase).Count;
        return value.Length < 420 && navigationWords >= 3;
    }

    private static bool ContainsPersonaName(string subject, string text)
    {
        var subjectTokens = Regex.Matches(subject.ToLowerInvariant(), @"[\p{L}\p{N}]{2,}")
            .Select(match => match.Value)
            .Where(token => token is not ("captain" or "sir" or "madam" or "mr" or "mrs" or "ms" or "dr" or "professor" or "king" or "queen"))
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        if (subjectTokens.Length == 0) return false;
        var normalizedText = $" {Regex.Replace(text.ToLowerInvariant(), @"[^\p{L}\p{N}]+", " ")} ";
        return subjectTokens.All(token => normalizedText.Contains($" {token} ", StringComparison.Ordinal));
    }

    private static string PersonaNameWithoutHonorifics(string subject)
    {
        return string.Join(' ', Regex.Matches(subject.ToLowerInvariant(), @"[\p{L}\p{N}]{2,}")
            .Select(match => match.Value)
            .Where(token => token is not ("captain" or "sir" or "madam" or "mr" or "mrs" or "ms" or "dr" or "professor" or "king" or "queen")));
    }

    private static bool ContainsPersonaClue(string clues, string text)
    {
        var clueTokens = Regex.Matches(clues.ToLowerInvariant(), @"[\p{L}\p{N}]{4,}")
            .Select(match => match.Value)
            .Where(token => token is not ("original" or "especially" or "focus" or "dialogue" or "spoken" or "separate" or "scripts" or "transcripts" or "analysis" or "uncertain" or "material"))
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        if (clueTokens.Length == 0) return false;
        var normalizedText = $" {Regex.Replace(text.ToLowerInvariant(), @"[^\p{L}\p{N}]+", " ")} ";
        return clueTokens.Count(token => normalizedText.Contains($" {token} ", StringComparison.Ordinal)) >= Math.Min(2, clueTokens.Length);
    }

}
