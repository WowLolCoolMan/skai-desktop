namespace SkaiDesktop.Core.Models;

public static class ScheduledTaskStatuses
{
    public const string Scheduled = "scheduled";
    public const string Running = "running";
    public const string Completed = "completed";
    public const string Failed = "failed";
    public const string Paused = "paused";
    public const string Cancelled = "cancelled";
    public const string NeedsDecision = "needs_decision";
}

public static class ScheduledMissedRunPolicies
{
    public const string RunOnce = "run_once";
    public const string Skip = "skip";
    public const string AskFirst = "ask_first";
}

public sealed class ScheduledTaskRun
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Input { get; set; } = string.Empty;
    public string Status { get; set; } = "running";
    public DateTimeOffset StartedAtUtc { get; set; }
    public DateTimeOffset? CompletedAtUtc { get; set; }
    public string? Result { get; set; }
    public string? Failure { get; set; }
    public List<string> ArtifactPaths { get; set; } = [];
}

/// <summary>A durable, one-shot task request. The scheduler never replays a claimed task after restart.</summary>
public sealed class ScheduledTask
{
    public const int MinRepeatEveryMinutes = 1;
    public const int MaxRepeatEveryMinutes = 7 * 24 * 60;
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Prompt { get; set; } = string.Empty;
    public string? ConversationId { get; set; }
    public string WorkspaceMode { get; set; } = WorkspaceModes.Chat;
    public DateTimeOffset DueAtUtc { get; set; }
    public int? RepeatEveryMinutes { get; set; }
    public string MissedRunPolicy { get; set; } = ScheduledMissedRunPolicies.RunOnce;
    public int RunCount { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset? StartedAtUtc { get; set; }
    public DateTimeOffset? CompletedAtUtc { get; set; }
    public string Status { get; set; } = ScheduledTaskStatuses.Scheduled;
    public string? Outcome { get; set; }
    public List<ScheduledTaskRun> Runs { get; set; } = [];
}
