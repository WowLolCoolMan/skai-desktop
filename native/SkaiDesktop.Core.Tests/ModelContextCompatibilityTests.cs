using SkaiDesktop.Core.Services;
using static TestSupport;

internal static class ModelContextCompatibilityTests
{
    public static void Run()
    {
        Check(ModelContextCompatibilityPolicy.Explain("Ollama", 1_048_576, 262_144)?.Contains("262,144", StringComparison.Ordinal) == true,
            "known Ollama context mismatch returns an actionable limit");
        Check(ModelContextCompatibilityPolicy.Explain("Ollama", 1_048_576, 1_048_576) is null,
            "compatible Ollama context is allowed");
        Check(ModelContextCompatibilityPolicy.Explain("Ollama", 1_048_576, null) is null,
            "unknown model context does not block Ollama");
        Check(ModelContextCompatibilityPolicy.Explain("LM Studio", 1_048_576, 262_144) is null,
            "non-Ollama providers are not subject to Ollama context validation");
    }
}
