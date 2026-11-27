using SkaiDesktop.Core.Models;
using SkaiDesktop.Core.Services;

internal static class ScheduledTaskTests
{
    public static void Run()
    {
        var directory = Path.Combine(Path.GetTempPath(), "skai-scheduled-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var store = new ScheduledTaskStore(Path.Combine(directory, "scheduled.json"));
        var now = DateTimeOffset.UtcNow;
        var task = store.Schedule("Review the release checklist", now.AddMinutes(5), WorkspaceModes.Chat, now, triggerType: ScheduledTriggerTypes.ProjectEvent, triggerValue: "project-1:push", overlapPolicy: ScheduledOverlapPolicies.Queue, sourceTaskId: "task-1", sourceWorkflowName: "Release review");
        Check(store.Load().Count == 1 && store.Load()[0].Status == ScheduledTaskStatuses.Scheduled, "scheduled task persists as pending");
        Check(store.Load()[0].TriggerType == ScheduledTriggerTypes.ProjectEvent && store.Load()[0].TriggerValue == "project-1:push" && store.Load()[0].OverlapPolicy == ScheduledOverlapPolicies.Queue && store.Load()[0].DryRunCompletedAtUtc is not null && store.Load()[0].SourceTaskId == "task-1" && store.Load()[0].SourceWorkflowName == "Release review", "automation trigger, overlap, dry-run, and source metadata persist");
        Check(store.TryClaimDue(now) is null, "future scheduled task is not claimed early");
        var claimed = store.TryClaimDue(now.AddMinutes(6));
        Check(claimed is not null && claimed.Status == ScheduledTaskStatuses.Running, "due scheduled task is claimed durably");
        Check(store.TryClaimDue(now.AddMinutes(7)) is null, "claimed scheduled task is not replayed");
        store.Complete(claimed!.Id, succeeded: true, "queued for reviewed chat execution", now.AddMinutes(6));
        var completed = store.Load().Single(item => item.Id == claimed.Id);
        Check(completed.Status == ScheduledTaskStatuses.Completed && completed.Outcome!.Contains("reviewed", StringComparison.Ordinal), "scheduled task records its outcome");
        Check(completed.RunCount == 1 && completed.Runs.Count == 1 && completed.Runs[0].Input == task.Prompt && completed.Runs[0].Result!.Contains("reviewed", StringComparison.Ordinal) && completed.Runs[0].Status == "succeeded", "scheduled task preserves bounded run input and result history");

        var recurring = store.Schedule("Review recurring health", now.AddMinutes(10), WorkspaceModes.Chat, now, repeatEveryMinutes: 120);
        var recurringClaim = store.TryClaimDue(now.AddMinutes(11));
        Check(recurringClaim?.Id == recurring.Id, "recurring task is claimed when due");
        store.Complete(recurring.Id, succeeded: true, "surfaced for review", now.AddMinutes(11));
        var rescheduled = store.Load().Single(item => item.Id == recurring.Id);
        Check(rescheduled.Status == ScheduledTaskStatuses.Scheduled && rescheduled.RunCount == 1 && rescheduled.DueAtUtc == now.AddMinutes(131), "successful recurring task is durably rescheduled");
        Check(store.TryClaimDue(now.AddMinutes(12)) is null, "rescheduled task is not replayed early");

        var runNow = store.Schedule("Run this task now", now.AddHours(1), WorkspaceModes.Chat, now);
        var madeDue = store.RunNow(runNow.Id, now.AddMinutes(12));
        Check(madeDue.Status == ScheduledTaskStatuses.Scheduled && madeDue.DueAtUtc == now.AddMinutes(12), "run now marks a scheduled task due without executing it");
        Check(store.TryClaimDue(now.AddMinutes(12))?.Id == runNow.Id, "run now makes the task claimable");

        var paused = store.Schedule("Paused task", now.AddMinutes(8), WorkspaceModes.CodingAgent, now);
        store.Pause(paused.Id);
        Check(store.TryClaimDue(now.AddMinutes(9)) is null, "paused scheduled task is not claimed");
        store.Resume(paused.Id);
        Check(store.TryClaimDue(now.AddMinutes(9))?.Id == paused.Id, "paused task resumes explicitly");
        var cancelled = store.Schedule("Cancel before execution", now.AddHours(2), WorkspaceModes.Chat, now);
        store.Cancel(cancelled.Id);
        var cancelledState = store.Load().Single(item => item.Id == cancelled.Id);
        Check(cancelledState.Status == ScheduledTaskStatuses.Cancelled && cancelledState.Outcome == "Cancelled before execution.", "scheduled task cancellation is durable");
        Check(store.TryClaimDue(now.AddDays(2))?.Id != cancelled.Id, "cancelled scheduled task is never claimed");

        var missedSkip = store.Schedule("Skip stale work", now.AddMinutes(1), WorkspaceModes.Chat, now, missedRunPolicy: ScheduledMissedRunPolicies.Skip);
        Check(store.TryClaimDue(now.AddMinutes(10)) is null, "missed run skip policy does not execute stale work");
        var skipped = store.Load().Single(item => item.Id == missedSkip.Id);
        Check(skipped.Status == ScheduledTaskStatuses.Completed && skipped.Runs.Single().Status == "skipped", "missed one-shot run is recorded as skipped");

        var missedAsk = store.Schedule("Ask before stale work", now.AddMinutes(1), WorkspaceModes.Chat, now, missedRunPolicy: ScheduledMissedRunPolicies.AskFirst);
        Check(store.TryClaimDue(now.AddMinutes(10)) is null, "ask-first policy does not execute a missed run unattended");
        var awaiting = store.Load().Single(item => item.Id == missedAsk.Id);
        Check(awaiting.Status == ScheduledTaskStatuses.NeedsDecision, "missed ask-first task waits for a user decision");
        var runOnce = store.ResolveMissedRun(missedAsk.Id, "run_once", now.AddMinutes(10));
        Check(runOnce.Status == ScheduledTaskStatuses.Scheduled && runOnce.DueAtUtc == now.AddMinutes(10) && store.TryClaimDue(now.AddMinutes(10))?.Id == missedAsk.Id, "missed run can be explicitly run once");

        var missedRecurring = store.Schedule("Skip a missed recurrence", now.AddMinutes(1), WorkspaceModes.Chat, now, repeatEveryMinutes: 60, missedRunPolicy: ScheduledMissedRunPolicies.Skip);
        Check(store.TryClaimDue(now.AddHours(3)) is null, "missed recurring skip policy avoids replaying every missed interval");
        var recurringAfterSkip = store.Load().Single(item => item.Id == missedRecurring.Id);
        Check(recurringAfterSkip.Status == ScheduledTaskStatuses.Scheduled && recurringAfterSkip.DueAtUtc > now.AddHours(3) && recurringAfterSkip.Runs.Single().Status == "skipped", "missed recurring task advances to the next future interval and records the skip");

        var rejected = false;
        try { store.Schedule("Missing dry run", now.AddHours(4), WorkspaceModes.Chat, now, dryRunCompleted: false); }
        catch (InvalidOperationException) { rejected = true; }
        Check(rejected, "automation activation requires a completed dry run");

        Console.WriteLine("PASS scheduled task persistence, recurrence, claim, no-replay, run history, missed-run decisions, outcome, run-now, pause, resume, and cancellation");
    }

    private static void Check(bool condition, string message)
    {
        if (!condition) throw new Exception("FAIL " + message);
    }
}
