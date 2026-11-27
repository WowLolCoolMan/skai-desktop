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
    /// <summary>Evidence-backed reasoning and decision patterns distilled from source material.</summary>
    public string ThinkingStyle { get; set; } = string.Empty;
    /// <summary>Observed interaction behavior, including conversational modes and response habits.</summary>
    public string InteractionStyle { get; set; } = string.Empty;
    /// <summary>Beliefs and values, with uncertainty or change over time stated explicitly.</summary>
    public string Values { get; set; } = string.Empty;
    /// <summary>Topics and knowledge supported by the selected source corpus.</summary>
    public string Knowledge { get; set; } = string.Empty;
    /// <summary>Limits, disputed evidence, and unsupported areas the persona must not guess about.</summary>
    public string EvidenceBoundaries { get; set; } = string.Empty;
    public string Timeline { get; set; } = string.Empty;
    public string SourceMaterial { get; set; } = string.Empty;
    public string Instructions { get; set; } = string.Empty;
    /// <summary>Optional local preset whose instructions, knowledge, and tool guidance are layered into persona chats.</summary>
    public string PresetId { get; set; } = string.Empty;
    /// <summary>Explicit local skills to apply whenever this persona is active.</summary>
    public List<string> SkillIds { get; set; } = [];
    /// <summary>Named tool grants are retained as an auditable binding; persona chat remains non-mutating until a tool-capable surface is selected.</summary>
    public List<string> ToolIds { get; set; } = [];
    /// <summary>Persona continuity scope: persona, project, or workspace.</summary>
    public string MemoryScope { get; set; } = "persona";
    /// <summary>Project identity used when MemoryScope is project.</summary>
    public string? MemoryProjectId { get; set; }
    /// <summary>Chosen once at creation. When true, user-specific continuity is durable.</summary>
    public bool PersonalContinuityEnabled { get; set; }
    public bool ProgressiveResearchEnabled { get; set; } = true;
    public int InteractionCount { get; set; }
    public int ResearchPassCount { get; set; }
    public DateTimeOffset? LastResearchAtUtc { get; set; }
    public string LastResearchSummary { get; set; } = string.Empty;
    public SavedPersonaDistillation? LatestDistillation { get; set; }
    public List<SavedPersonaResearchPass> ResearchHistory { get; set; } = [];
    public List<SavedPersonaContinuityTurn> Continuity { get; set; } = [];
    /// <summary>Recent editable profile revisions. Snapshots never include conversation memory.</summary>
    public List<SavedPersonaVersion> Versions { get; set; } = [];
    public List<SavedPersonaQuote> VerifiedQuotes { get; set; } = [];
    public List<SavedPersonaSource> Sources { get; set; } = [];
    /// <summary>Sources used to draft the current public-research profile fields.</summary>
    public List<string> ProfileEvidenceUrls { get; set; } = [];
    /// <summary>Sources explicitly removed by the user; progressive research must not re-add them.</summary>
    public List<string> ExcludedResearchUrls { get; set; } = [];
    public DateTimeOffset UpdatedAtUtc { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class SavedPersonaVersion
{
    public string VersionId { get; set; } = Guid.NewGuid().ToString("N");
    public DateTimeOffset CreatedAtUtc { get; set; } = DateTimeOffset.UtcNow;
    public SavedPersona Snapshot { get; set; } = new();
}

public sealed class SavedPersonaSource
{
    public string Title { get; set; } = string.Empty;
    public string Url { get; set; } = string.Empty;
    public string AuthorOrPublisher { get; set; } = string.Empty;
    public string PublishedDate { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    /// <summary>Whether dialogue in this source is explicitly linked to the persona by speaker labels.</summary>
    public string SpeakerAttribution { get; set; } = "not-applicable";
    /// <summary>Number of transcript turns explicitly attributed to the persona, when available.</summary>
    public int AttributedTurnCount { get; set; }
    /// <summary>Evidence quality gate result; only verified-attributed dialogue can inform voice.</summary>
    public string EvidenceQuality { get; set; } = "unreviewed";
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

/// <summary>Latest research-derived persona synthesis. Kept separate from user-edited profile fields.</summary>
public sealed class SavedPersonaDistillation
{
    public DateTimeOffset UpdatedAtUtc { get; set; } = DateTimeOffset.UtcNow;
    public string Focus { get; set; } = string.Empty;
    public List<string> SourceUrls { get; set; } = [];
    public string Roles { get; set; } = string.Empty;
    public string SpeechPatterns { get; set; } = string.Empty;
    public string Personality { get; set; } = string.Empty;
    public string ThinkingStyle { get; set; } = string.Empty;
    public string InteractionStyle { get; set; } = string.Empty;
    public string Values { get; set; } = string.Empty;
    public string Knowledge { get; set; } = string.Empty;
    public string EvidenceBoundaries { get; set; } = string.Empty;
    public string Timeline { get; set; } = string.Empty;
}

public sealed class SavedPersonaContinuityTurn
{
    public DateTimeOffset AtUtc { get; set; } = DateTimeOffset.UtcNow;
    public string Role { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
}
