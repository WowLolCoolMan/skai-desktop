namespace SkaiDesktop.Core.Models;

/// <summary>Local reusable role instructions. Activation is explicit and never changes provider settings.</summary>
public sealed class SavedPersona
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get; set; } = string.Empty;
    /// <summary>public-research or own-material. Public research is always opt-in.</summary>
    public string SourceMode { get; set; } = "own-material";
    /// <summary>person or character; controls which public evidence lanes are searched.</summary>
    public string SubjectType { get; set; } = "person";
    public bool IsPublicFigure { get; set; }
    public string? BirthDate { get; set; }
    public string? DeathDate { get; set; }
    public string? KnowledgeCutoffDate { get; set; }
    public string? EraDate { get; set; }
    public string Roles { get; set; } = string.Empty;
    /// <summary>Optional local voice profile used when this persona speaks.</summary>
    public string VoiceProfileId { get; set; } = string.Empty;
    public string Voice { get; set; } = string.Empty;
    public string Personality { get; set; } = string.Empty;
    public string Timeline { get; set; } = string.Empty;
    public string SourceMaterial { get; set; } = string.Empty;
    public string Instructions { get; set; } = string.Empty;
    /// <summary>Chosen once at creation. When true, user-specific continuity is durable.</summary>
    public bool PersonalContinuityEnabled { get; set; }
    public bool ProgressiveResearchEnabled { get; set; } = true;
    public int InteractionCount { get; set; }
    public int ResearchPassCount { get; set; }
    public DateTimeOffset? LastResearchAtUtc { get; set; }
    public string LastResearchSummary { get; set; } = string.Empty;
    public List<SavedPersonaResearchPass> ResearchHistory { get; set; } = [];
    public List<SavedPersonaContinuityTurn> Continuity { get; set; } = [];
    public List<SavedPersonaQuote> VerifiedQuotes { get; set; } = [];
    public List<SavedPersonaSource> Sources { get; set; } = [];
    public DateTimeOffset UpdatedAtUtc { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class SavedPersonaSource
{
    public string Title { get; set; } = string.Empty;
    public string Url { get; set; } = string.Empty;
    public string AuthorOrPublisher { get; set; } = string.Empty;
    public string PublishedDate { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public string ReliabilityNote { get; set; } = string.Empty;
    public string Excerpt { get; set; } = string.Empty;
}

public sealed class SavedPersonaQuote
{
    public string Text { get; set; } = string.Empty;
    public string SourceId { get; set; } = string.Empty;
    public string Attribution { get; set; } = string.Empty;
}

public sealed class SavedPersonaResearchPass
{
    public DateTimeOffset CompletedAtUtc { get; set; } = DateTimeOffset.UtcNow;
    public string Focus { get; set; } = string.Empty;
    public int SourcesAdded { get; set; }
    public string Summary { get; set; } = string.Empty;
}

public sealed class SavedPersonaContinuityTurn
{
    public DateTimeOffset AtUtc { get; set; } = DateTimeOffset.UtcNow;
    public string Role { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
}
