using System.Text.Json;
using SkaiDesktop.Core.Infrastructure;
using SkaiDesktop.Core.Models;

namespace SkaiDesktop.Core.Services;

/// <summary>Durable one-shot scheduler state. Claiming is persisted before execution to prevent replay.</summary>
public sealed class ScheduledTaskStore
{
    public const int MaxTasks = 256;
    public const int MaxPromptCharacters = 50_000;
    public const int MaxOutcomeCharacters = 2_000;
    public const int MaxRunsPerTask = 20;
    private static readonly TimeSpan MissedRunGrace = TimeSpan.FromMinutes(5);
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web) { WriteIndented = true, MaxDepth = 16 };
    private readonly string _path;

    public ScheduledTaskStore(string? path = null)
    {
        _path = path ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData, Environment.SpecialFolderOption.Create), "SkaiDesktop", "AI", "scheduled-tasks.json");
    }

    public IReadOnlyList<ScheduledTask> Load()
    {
        if (!File.Exists(_path)) return [];
        try
        {
            var tasks = JsonSerializer.Deserialize<List<ScheduledTask>>(BoundedFileReader.ReadText(_path), Options) ?? [];
            Validate(tasks);
            return tasks;
        }
        catch (JsonException error)
        {
            throw new InvalidDataException("Scheduled tasks could not be read. The original file was left untouched.", error);
        }
    }

    public ScheduledTask Schedule(string prompt, DateTimeOffset dueAtUtc, string workspaceMode = WorkspaceModes.Chat, DateTimeOffset? now = null, int? repeatEveryMinutes = null, string? conversationId = null, string missedRunPolicy = ScheduledMissedRunPolicies.RunOnce, string triggerType = ScheduledTriggerTypes.Schedule, string? triggerValue = null, string overlapPolicy = ScheduledOverlapPolicies.Skip, bool dryRunCompleted = true, string? sourceTaskId = null, string? sourceWorkflowName = null)
    {
        ValidatePrompt(prompt);
        if (workspaceMode is not (WorkspaceModes.Chat or WorkspaceModes.CodingAgent)) throw new ArgumentException("The scheduled workspace mode is invalid.", nameof(workspaceMode));
        var current = now ?? DateTimeOffset.UtcNow;
        ValidateRepeat(repeatEveryMinutes);
        ValidateMissedRunPolicy(missedRunPolicy);
        ValidateTrigger(triggerType, triggerValue);
        ValidateOverlapPolicy(overlapPolicy);
        if (!dryRunCompleted) throw new InvalidOperationException("Run the one-time dry run before enabling this automation.");
        if (dueAtUtc < current.AddSeconds(-5)) throw new ArgumentException("A scheduled task must be in the future.", nameof(dueAtUtc));
        if (dueAtUtc > current.AddYears(1)) throw new ArgumentException("A scheduled task cannot be more than one year away.", nameof(dueAtUtc));
        var tasks = Load().ToList();
        if (tasks.Count >= MaxTasks) throw new InvalidOperationException($"At most {MaxTasks} scheduled tasks can be saved.");
        if (conversationId is { Length: > 128 }) throw new ArgumentException("The conversation ID is invalid.", nameof(conversationId));
        var task = new ScheduledTask { Prompt = prompt.Trim(), ConversationId = string.IsNullOrWhiteSpace(conversationId) ? null : conversationId.Trim(), WorkspaceMode = workspaceMode, DueAtUtc = dueAtUtc, RepeatEveryMinutes = repeatEveryMinutes, MissedRunPolicy = missedRunPolicy, TriggerType = triggerType, TriggerValue = string.IsNullOrWhiteSpace(triggerValue) ? null : triggerValue.Trim(), OverlapPolicy = overlapPolicy, DryRunCompletedAtUtc = current, SourceTaskId = string.IsNullOrWhiteSpace(sourceTaskId) ? null : sourceTaskId.Trim(), SourceWorkflowName = string.IsNullOrWhiteSpace(sourceWorkflowName) ? null : sourceWorkflowName.Trim(), CreatedAtUtc = current };
        tasks.Add(task);
        Save(tasks);
        return task;
    }

    public ScheduledTask? TryClaimDue(DateTimeOffset? now = null)
    {
        var tasks = Load().ToList();
        var current = now ?? DateTimeOffset.UtcNow;
        var task = tasks.Where(item => item.Status == ScheduledTaskStatuses.Scheduled && item.DueAtUtc <= current)
            .OrderBy(item => item.DueAtUtc).ThenBy(item => item.CreatedAtUtc).FirstOrDefault();
        if (task is null) return null;
        if (current - task.DueAtUtc > MissedRunGrace && task.MissedRunPolicy == ScheduledMissedRunPolicies.AskFirst)
        {
            task.Status = ScheduledTaskStatuses.NeedsDecision;
            task.Outcome = "This run was missed while Skai was unavailable. Choose whether to run it once or skip it.";
            Save(tasks);
            return null;
        }
        if (current - task.DueAtUtc > MissedRunGrace && task.MissedRunPolicy == ScheduledMissedRunPolicies.Skip)
        {
            RecordSkippedRun(task, current);
            Save(tasks);
            return null;
        }
        task.Status = ScheduledTaskStatuses.Running;
        task.StartedAtUtc = current;
        task.Runs ??= [];
        task.Runs.Add(new ScheduledTaskRun { Input = task.Prompt, StartedAtUtc = current });
        TrimRunHistory(task);
        Save(tasks);
        return task;
    }

    public void Complete(string id, bool succeeded, string outcome, DateTimeOffset? now = null)
    {
        if (string.IsNullOrWhiteSpace(id)) throw new ArgumentException("A scheduled task ID is required.", nameof(id));
        if (string.IsNullOrWhiteSpace(outcome) || outcome.Length > MaxOutcomeCharacters || outcome.Any(char.IsControl)) throw new ArgumentException("The task outcome is invalid.", nameof(outcome));
        var tasks = Load().ToList();
        var task = tasks.SingleOrDefault(item => item.Id == id) ?? throw new InvalidOperationException("The scheduled task no longer exists.");
        if (task.Status != ScheduledTaskStatuses.Running) throw new InvalidOperationException("Only a claimed scheduled task can be completed.");
        var completedAt = now ?? DateTimeOffset.UtcNow;
        task.Status = succeeded && task.RepeatEveryMinutes is not null ? ScheduledTaskStatuses.Scheduled : succeeded ? ScheduledTaskStatuses.Completed : ScheduledTaskStatuses.Failed;
        task.CompletedAtUtc = completedAt;
        task.Outcome = outcome.Trim();
        task.Runs ??= [];
        var run = task.Runs.LastOrDefault(item => item.Status == "running") ?? throw new InvalidOperationException("The claimed scheduled run is missing from its history.");
        run.Status = succeeded ? "succeeded" : "failed";
        run.CompletedAtUtc = completedAt;
        if (succeeded) run.Result = task.Outcome; else run.Failure = task.Outcome;
        task.RunCount++;
        if (task.Status == ScheduledTaskStatuses.Scheduled)
        {
            task.StartedAtUtc = null;
            task.DueAtUtc = completedAt.AddMinutes(task.RepeatEveryMinutes!.Value);
        }
        Save(tasks);
    }

    public void Pause(string id)
    {
        UpdateStatus(id, ScheduledTaskStatuses.Scheduled, ScheduledTaskStatuses.Paused);
    }

    public void Resume(string id)
    {
        UpdateStatus(id, ScheduledTaskStatuses.Paused, ScheduledTaskStatuses.Scheduled);
    }

    public ScheduledTask ResolveMissedRun(string id, string choice, DateTimeOffset? now = null)
    {
        if (choice is not ("run_once" or "skip")) throw new ArgumentException("Choose whether to run the missed task once or skip it.", nameof(choice));
        var tasks = Load().ToList();
        var task = tasks.SingleOrDefault(item => item.Id == id) ?? throw new InvalidOperationException("The scheduled task no longer exists.");
        if (task.Status != ScheduledTaskStatuses.NeedsDecision) throw new InvalidOperationException("This task is not waiting for a missed-run decision.");
        var current = now ?? DateTimeOffset.UtcNow;
        if (choice == "run_once")
        {
            task.Status = ScheduledTaskStatuses.Scheduled;
            task.DueAtUtc = current;
            task.Outcome = "Missed run will execute once now.";
        }
        else
        {
            RecordSkippedRun(task, current);
        }
        Save(tasks);
        return task;
    }

    public void Cancel(string id)
    {
        if (string.IsNullOrWhiteSpace(id)) throw new ArgumentException("A scheduled task ID is required.", nameof(id));
        var tasks = Load().ToList();
        var task = tasks.SingleOrDefault(item => item.Id == id) ?? throw new InvalidOperationException("The scheduled task no longer exists.");
        if (task.Status is not (ScheduledTaskStatuses.Scheduled or ScheduledTaskStatuses.Paused))
            throw new InvalidOperationException($"A task in {task.Status} state cannot be cancelled.");
        task.Status = ScheduledTaskStatuses.Cancelled;
        task.Outcome = "Cancelled before execution.";
        Save(tasks);
    }

    /// <summary>Marks a scheduled task due without executing its prompt.</summary>
    public ScheduledTask RunNow(string id, DateTimeOffset? now = null)
    {
        if (string.IsNullOrWhiteSpace(id)) throw new ArgumentException("A scheduled task ID is required.", nameof(id));
        var tasks = Load().ToList();
        var task = tasks.SingleOrDefault(item => item.Id == id) ?? throw new InvalidOperationException("The scheduled task no longer exists.");
        if (task.Status != ScheduledTaskStatuses.Scheduled) throw new InvalidOperationException($"A task in {task.Status} state cannot be run now.");
        task.DueAtUtc = now ?? DateTimeOffset.UtcNow;
        Save(tasks);
        return task;
    }

    private void UpdateStatus(string id, string expected, string next)
    {
        var tasks = Load().ToList();
        var task = tasks.SingleOrDefault(item => item.Id == id) ?? throw new InvalidOperationException("The scheduled task no longer exists.");
        if (task.Status != expected) throw new InvalidOperationException($"A task in {task.Status} state cannot be changed this way.");
        task.Status = next;
        Save(tasks);
    }

    private void Save(IEnumerable<ScheduledTask> tasks)
    {
        var list = tasks.ToList();
        Validate(list);
        AtomicFileWriter.WriteText(_path, BoundedFileReader.EnsureTextSize(JsonSerializer.Serialize(list, Options), "scheduled tasks"));
    }

    private static void ValidatePrompt(string prompt)
    {
        if (string.IsNullOrWhiteSpace(prompt) || prompt.Length > MaxPromptCharacters || prompt.Any(char.IsControl)) throw new ArgumentException("The scheduled prompt is invalid.", nameof(prompt));
    }

    private static void ValidateRepeat(int? repeatEveryMinutes)
    {
        if (repeatEveryMinutes is int value && (value < ScheduledTask.MinRepeatEveryMinutes || value > ScheduledTask.MaxRepeatEveryMinutes))
            throw new ArgumentException($"A recurrence must be between {ScheduledTask.MinRepeatEveryMinutes} minutes and one week.", nameof(repeatEveryMinutes));
    }

    private static void ValidateMissedRunPolicy(string? policy)
    {
        if (policy is not (ScheduledMissedRunPolicies.RunOnce or ScheduledMissedRunPolicies.Skip or ScheduledMissedRunPolicies.AskFirst))
            throw new ArgumentException("The missed-run policy must be run_once, skip, or ask_first.", nameof(policy));
    }

    private static void ValidateTrigger(string? triggerType, string? triggerValue)
    {
        if (triggerType is not (ScheduledTriggerTypes.Schedule or ScheduledTriggerTypes.Manual or ScheduledTriggerTypes.ProjectEvent or ScheduledTriggerTypes.Webhook)) throw new ArgumentException("The trigger type is invalid.", nameof(triggerType));
        if (triggerValue is { Length: > 512 } || triggerValue?.Any(char.IsControl) == true) throw new ArgumentException("The trigger value is invalid.", nameof(triggerValue));
        if (triggerType is ScheduledTriggerTypes.ProjectEvent or ScheduledTriggerTypes.Webhook && string.IsNullOrWhiteSpace(triggerValue)) throw new ArgumentException("This trigger needs a local event or webhook identifier.", nameof(triggerValue));
    }

    private static void ValidateOverlapPolicy(string? policy)
    {
        if (policy is not (ScheduledOverlapPolicies.Skip or ScheduledOverlapPolicies.Queue or ScheduledOverlapPolicies.Replace)) throw new ArgumentException("The overlap policy is invalid.", nameof(policy));
    }

    private static void RecordSkippedRun(ScheduledTask task, DateTimeOffset current)
    {
        task.Runs ??= [];
        task.Runs.Add(new ScheduledTaskRun { Input = task.Prompt, Status = "skipped", StartedAtUtc = task.DueAtUtc, CompletedAtUtc = current, Failure = "Skipped because the device was unavailable when this run was due." });
        TrimRunHistory(task);
        task.CompletedAtUtc = current;
        task.Outcome = "Missed run skipped.";
        if (task.RepeatEveryMinutes is int repeat)
        {
            var intervals = Math.Max(1, (long)Math.Floor((current - task.DueAtUtc).TotalMinutes / repeat) + 1);
            task.DueAtUtc = task.DueAtUtc.AddMinutes(intervals * repeat);
            task.Status = ScheduledTaskStatuses.Scheduled;
        }
        else task.Status = ScheduledTaskStatuses.Completed;
    }

    private static void TrimRunHistory(ScheduledTask task)
    {
        if (task.Runs.Count > MaxRunsPerTask) task.Runs.RemoveRange(0, task.Runs.Count - MaxRunsPerTask);
    }

    private static void Validate(IEnumerable<ScheduledTask> tasks)
    {
        var list = tasks.ToList();
        if (list.Count > MaxTasks || list.Any(item => item is null)) throw new InvalidDataException("The scheduled task store exceeds its safety bounds.");
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var task in list)
        {
            if (string.IsNullOrWhiteSpace(task.Id) || task.Id.Length > 128 || !ids.Add(task.Id)) throw new InvalidDataException("The scheduled task store contains an invalid or duplicate ID.");
            ValidatePrompt(task.Prompt);
            if (task.ConversationId is { Length: > 128 } || task.ConversationId?.Any(char.IsControl) == true) throw new InvalidDataException("The scheduled task contains an invalid conversation ID.");
            ValidateRepeat(task.RepeatEveryMinutes);
            if (task.RunCount < 0) throw new InvalidDataException("The scheduled task store contains an invalid run count.");
            if (task.WorkspaceMode is not (WorkspaceModes.Chat or WorkspaceModes.CodingAgent)) throw new InvalidDataException("The scheduled task store contains an invalid workspace mode.");
            if (task.Status is not (ScheduledTaskStatuses.Scheduled or ScheduledTaskStatuses.Running or ScheduledTaskStatuses.Completed or ScheduledTaskStatuses.Failed or ScheduledTaskStatuses.Paused or ScheduledTaskStatuses.Cancelled or ScheduledTaskStatuses.NeedsDecision)) throw new InvalidDataException("The scheduled task store contains an invalid status.");
            if (task.Outcome is { Length: > MaxOutcomeCharacters } || task.Outcome?.Any(char.IsControl) == true) throw new InvalidDataException("The scheduled task store contains an invalid outcome.");
            ValidateMissedRunPolicy(task.MissedRunPolicy);
            task.TriggerType ??= ScheduledTriggerTypes.Schedule;
            ValidateTrigger(task.TriggerType, task.TriggerValue);
            task.OverlapPolicy ??= ScheduledOverlapPolicies.Skip;
            ValidateOverlapPolicy(task.OverlapPolicy);
            // Existing schedules predate the activation gate. Preserve them as already-enabled
            // local automations; new schedules always receive a dry-run timestamp in Schedule().
            task.DryRunCompletedAtUtc ??= task.CreatedAtUtc;
            if (task.SourceTaskId is { Length: > 128 } || task.SourceTaskId?.Any(char.IsControl) == true || task.SourceWorkflowName is { Length: > 200 } || task.SourceWorkflowName?.Any(char.IsControl) == true) throw new InvalidDataException("The scheduled task source metadata is invalid.");
            task.Runs ??= [];
            if (task.Runs.Count > MaxRunsPerTask) throw new InvalidDataException("Scheduled task run history exceeds the retention bound.");
            foreach (var run in task.Runs)
            {
                if (string.IsNullOrWhiteSpace(run.Id) || run.Id.Length > 128 || run.Input.Length > MaxPromptCharacters || run.Input.Any(char.IsControl) || run.Result is { Length: > MaxOutcomeCharacters } || run.Failure is { Length: > MaxOutcomeCharacters } || run.ArtifactPaths.Count > 100 || run.ArtifactPaths.Any(path => string.IsNullOrWhiteSpace(path) || path.Length > 1024 || path.Any(char.IsControl)) || run.Status is not ("running" or "succeeded" or "failed" or "skipped"))
                    throw new InvalidDataException("Scheduled task run history contains an invalid entry.");
            }
        }
    }
}
