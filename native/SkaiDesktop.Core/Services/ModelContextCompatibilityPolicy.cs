namespace SkaiDesktop.Core.Services;

/// <summary>Validates a known model context limit without guessing when metadata is absent.</summary>
public static class ModelContextCompatibilityPolicy
{
    public static string? Explain(string? provider, int configuredContextTokens, int? advertisedContextTokens)
    {
        if (!string.Equals(provider, "Ollama", StringComparison.OrdinalIgnoreCase)
            || configuredContextTokens <= 0
            || advertisedContextTokens is not > 0
            || configuredContextTokens <= advertisedContextTokens.Value)
            return null;

        return $"Ollama context window {configuredContextTokens:N0} exceeds this model's advertised {advertisedContextTokens.Value:N0}-token context. Choose a smaller context or a compatible model.";
    }
}
