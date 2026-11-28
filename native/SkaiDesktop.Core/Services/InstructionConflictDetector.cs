using System.Text.RegularExpressions;

namespace SkaiDesktop.Core.Services;

/// <summary>
/// Finds explicit conflicts between the requested edit and instruction-like
/// reference text (for example, project instructions or acceptance criteria).
/// This is intentionally conservative: it only flags direct file/action
/// contradictions and never tries to reinterpret ordinary prose.
/// </summary>
public static class InstructionConflictDetector
{
    private static readonly Regex ActionPattern = new(@"\b(?:add|change|create|delete|edit|modify|refactor|remove|rename|replace|rewrite|touch|update|write)\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);
    private static readonly Regex FilePattern = new(@"(?<![\w.-])(?:[A-Za-z0-9_./\\-]+\.[A-Za-z0-9_-]{1,16})(?![\w-])", RegexOptions.CultureInvariant | RegexOptions.Compiled);
    private static readonly Regex NegativePattern = new(@"\b(?:do\s+not|don't|never|must\s+not|should\s+not|avoid|forbid|forbidden)\b(?<clause>[^\r\n!?]{0,220})", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);
    private static readonly Regex OnlyPattern = new(@"\bonly\s+(?:add|change|create|delete|edit|modify|refactor|remove|rename|replace|rewrite|touch|update|write)\b(?<clause>[^\r\n!?]{0,220})", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    public static IReadOnlyList<string> Find(string task, IEnumerable<(string Source, string Text)> references)
    {
        ArgumentNullException.ThrowIfNull(references);
        var request = Normalize(task);
        if (request.Length == 0 || !ActionPattern.IsMatch(request)) return [];

        var requestFiles = Files(request);
        var requestNegatives = Negatives(request);
        var requestOnly = OnlyTargets(request);
        var conflicts = new List<string>();

        foreach (var (source, text) in references)
        {
            var reference = Normalize(text);
            if (reference.Length == 0) continue;
            var referenceFiles = Files(reference);
            var referenceNegatives = Negatives(reference);
            var referenceOnly = OnlyTargets(reference);

            AddDirectConflicts(conflicts, source, request, requestFiles, requestNegatives, referenceFiles, referenceNegatives, referenceOnly, "reference");
            AddDirectConflicts(conflicts, source, reference, referenceFiles, referenceNegatives, requestFiles, requestNegatives, requestOnly, "request");
        }

        return conflicts.Distinct(StringComparer.Ordinal).Take(8).ToArray();
    }

    private static void AddDirectConflicts(
        List<string> conflicts,
        string source,
        string positiveText,
        IReadOnlySet<string> positiveFiles,
        IReadOnlyList<string> positiveNegatives,
        IReadOnlySet<string> negativeReferenceFiles,
        IReadOnlyList<string> negativeReferenceClauses,
        IReadOnlySet<string> onlyReferenceFiles,
        string positiveLabel)
    {
        foreach (var clause in negativeReferenceClauses)
        {
            var forbiddenFiles = Files(clause);
            var broad = IsBroadFileConstraint(clause);
            var overlap = positiveFiles.Intersect(forbiddenFiles, StringComparer.OrdinalIgnoreCase).ToArray();
            if (overlap.Length > 0 || broad && ActionPattern.IsMatch(positiveText))
            {
                var target = overlap.Length > 0 ? string.Join(", ", overlap) : "file edits";
                conflicts.Add($"{source}: the reference says not to change {target}, while the {positiveLabel} requests an edit.");
            }
        }

        if (onlyReferenceFiles.Count > 0 && positiveFiles.Any(file => !onlyReferenceFiles.Contains(file)))
        {
            var outside = positiveFiles.Where(file => !onlyReferenceFiles.Contains(file)).Take(3);
            conflicts.Add($"{source}: the reference limits edits to {string.Join(", ", onlyReferenceFiles)}, but the {positiveLabel} also targets {string.Join(", ", outside)}.");
        }

        // Keep the parameter explicit so the two-direction comparison cannot
        // accidentally become a one-way check during future refactors.
        _ = negativeReferenceFiles;
    }

    private static IReadOnlyList<string> Negatives(string text) =>
        NegativePattern.Matches(text)
            .Select(match => match.Groups["clause"].Value.Trim())
            .Where(clause => ActionPattern.IsMatch(clause) || IsBroadFileConstraint(clause))
            .ToArray();

    private static IReadOnlySet<string> OnlyTargets(string text)
    {
        var files = OnlyPattern.Matches(text).SelectMany(match => Files(match.Groups["clause"].Value)).ToHashSet(StringComparer.OrdinalIgnoreCase);
        return files;
    }

    private static IReadOnlySet<string> Files(string text) =>
        FilePattern.Matches(text)
            .Select(match => NormalizeFile(match.Value))
            .Where(file => file.Length > 1 && !file.Equals("e.g", StringComparison.OrdinalIgnoreCase))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

    private static bool IsBroadFileConstraint(string text) =>
        Regex.IsMatch(text, @"\b(?:any|all|no|every|the)\s+(?:files?|source|code|changes?)\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)
        || Regex.IsMatch(text, @"\b(?:edit|change|modify|write|touch|delete|remove)\s+nothing\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static string Normalize(string? value) =>
        string.Concat((value ?? string.Empty).Where(character => !char.IsControl(character))).Trim();

    private static string NormalizeFile(string value) =>
        value.Trim().Trim('`', '"', '\'', '(', ')', '[', ']', ',', ';', ':').Replace('\\', '/').ToLowerInvariant();
}
