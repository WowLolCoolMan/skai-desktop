using System.Net;
using System.Text.RegularExpressions;

namespace SkaiDesktop.Core.Services;

/// <summary>Converts remote wiki HTML into bounded plain-text evidence sections.</summary>
internal static class PersonaHtmlParser
{
    // ---------------------------------------------------------------- HTML handling

    /// <summary>Converts MediaWiki parser HTML into plain-text lines grouped by section heading.</summary>
    internal static IReadOnlyList<PersonaKnowledgeSources.HtmlSection> HtmlToSections(string html)
    {
        var text = Regex.Replace(html, @"<(script|style|table|figure|sup|noscript)\b[^>]*>.*?</\1>", " ", RegexOptions.IgnoreCase | RegexOptions.Singleline);
        // Infoboxes (<aside>) and navigation boxes are data tables, not prose evidence.
        text = Regex.Replace(text, @"<(aside|nav)\b[^>]*>.*?</\1>", " ", RegexOptions.IgnoreCase | RegexOptions.Singleline);
        text = Regex.Replace(text, @"<(div|span)\b[^>]*class=""[^""]*\b(?:toc|mw-editsection|hatnote|ambox|noprint|navbox)\b[^""]*""[^>]*>.*?</\1>", " ", RegexOptions.IgnoreCase | RegexOptions.Singleline);
        text = Regex.Replace(text, @"<h([2-4])\b[^>]*>(.*?)</h\1>", match => $"\n\u0001{StripTags(match.Groups[2].Value)}\n", RegexOptions.IgnoreCase | RegexOptions.Singleline);
        text = Regex.Replace(text, @"<br\s*/?>|</(?:p|li|dd|dt|div|tr|blockquote|pre)>", "\n", RegexOptions.IgnoreCase);
        text = StripTags(text);
        var sections = new List<PersonaKnowledgeSources.HtmlSection>();
        var heading = string.Empty;
        var lines = new List<string>();
        foreach (var raw in text.Split('\n'))
        {
            var line = Regex.Replace(raw, @"[ \t ]+", " ").Trim();
            if (line.Length == 0) continue;
            if (line[0] == '\u0001')
            {
                if (lines.Count > 0 || heading.Length > 0) sections.Add(new(heading, lines));
                heading = Regex.Replace(line[1..], @"\[\s*edit\s*\]", string.Empty, RegexOptions.IgnoreCase).Trim();
                lines = [];
                continue;
            }
            if (Regex.IsMatch(line, @"^\[\s*(?:edit|\d+)?\s*\]$", RegexOptions.IgnoreCase)) continue;
            lines.Add(Regex.Replace(line, @"\[\s*(?:\d+|edit|citation needed|note \d+)\s*\]", string.Empty, RegexOptions.IgnoreCase));
        }
        if (lines.Count > 0 || heading.Length > 0) sections.Add(new(heading, lines));
        return sections;
    }

    private static string StripTags(string html) => WebUtility.HtmlDecode(Regex.Replace(html, "<[^>]+>", string.Empty));

    internal static string Clean(string html) => Regex.Replace(StripTags(html), @"\s+", " ").Trim();
}
