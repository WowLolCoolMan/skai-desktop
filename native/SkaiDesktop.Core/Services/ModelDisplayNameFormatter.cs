using System.Text.RegularExpressions;

namespace SkaiDesktop.Core.Services;

/// <summary>Turns local runtime model identifiers into compact, recognizable UI labels.</summary>
public static partial class ModelDisplayNameFormatter
{
    private static readonly HashSet<string> PackagingTokens = new(StringComparer.OrdinalIgnoreCase)
    {
        "gguf", "abliterated"
    };

    public static string Format(string? modelId)
    {
        if (string.IsNullOrWhiteSpace(modelId)) return "Unknown model";

        var identifier = modelId.Trim();
        var repositorySeparator = identifier.LastIndexOf('/');
        if (repositorySeparator >= 0 && repositorySeparator < identifier.Length - 1)
            identifier = identifier[(repositorySeparator + 1)..];

        string? suffix = null;
        var tagSeparator = identifier.LastIndexOf(':');
        if (tagSeparator >= 0 && tagSeparator < identifier.Length - 1)
        {
            suffix = identifier[(tagSeparator + 1)..];
            identifier = identifier[..tagSeparator];
        }

        identifier = GgufExtension().Replace(identifier, "");
        var tokens = TokenSeparator().Split(identifier)
            .Where(token => token.Length > 0 && !PackagingTokens.Contains(token))
            .Select(FormatModelToken)
            .ToList();

        string? quantization = null;
        if (!string.IsNullOrWhiteSpace(suffix) && !suffix.Equals("latest", StringComparison.OrdinalIgnoreCase))
        {
            var quantizationMatch = QuantizationSuffix().Match(suffix);
            if (quantizationMatch.Success)
            {
                quantization = quantizationMatch.Value.ToUpperInvariant();
                var prefix = suffix[..quantizationMatch.Index].TrimEnd('-', '_', ' ');
                if (prefix.Length > 0)
                    tokens.AddRange(TokenSeparator().Split(prefix).Where(token => token.Length > 0).Select(FormatModelToken));
            }
            else
            {
                tokens.AddRange(TokenSeparator().Split(suffix).Where(token => token.Length > 0).Select(FormatModelToken));
            }
        }

        var label = tokens.Count == 0 ? "Unknown model" : string.Join(' ', tokens);
        return quantization is null ? label : $"{label} · {quantization}";
    }

    private static string FormatModelToken(string token) =>
        ParameterSizeTag().IsMatch(token) ? token.ToUpperInvariant() : FormatToken(token);

    private static string FormatToken(string token)
    {
        if (token.Length == 0) return token;
        if (token.Any(char.IsDigit)) return char.ToUpperInvariant(token[0]) + token[1..];
        if (token.All(character => !char.IsLetter(character) || char.IsUpper(character))) return token;
        return char.ToUpperInvariant(token[0]) + token[1..].ToLowerInvariant();
    }

    [GeneratedRegex("[-_\\s]+", RegexOptions.CultureInvariant)]
    private static partial Regex TokenSeparator();

    [GeneratedRegex("\\.gguf$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex GgufExtension();

    [GeneratedRegex("(?:IQ|Q|I|FP|BF|F)\\d+(?:_[A-Z0-9]+)*$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex QuantizationSuffix();

    [GeneratedRegex("^\\d+(?:\\.\\d+)?[BMGK]$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex ParameterSizeTag();
}
