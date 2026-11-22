using SkaiDesktop.Core.Infrastructure;
using SkaiDesktop.Core.Models;

namespace SkaiDesktop.AgentHost.Protocol;

public static partial class AgentHostLoop
{
    private static OperationJournal CreateTaskOperationJournal()
    {
        var journalPath = Environment.GetEnvironmentVariable("SRAI_OPERATIONS_PATH");
        var taskPath = Environment.GetEnvironmentVariable("SRAI_TASKS_PATH");
        if (string.IsNullOrWhiteSpace(journalPath) && !string.IsNullOrWhiteSpace(taskPath))
            journalPath = Path.Combine(Path.GetDirectoryName(Path.GetFullPath(taskPath))!, "operations.json");
        return new(journalPath);
    }

    private static void EnsureTaskJournal(AgentTaskArtifact task)
    {
        lock (TaskJournalGate)
        {
            var journal = TaskJournal.Value;
            if (journal.Load().Runs.Any(run => run.RunId == task.Id)) return;
            journal.Create(task.ProjectId ?? task.ConversationId ?? "local", task.Instruction,
                actor: "user", modelProvider: string.IsNullOrWhiteSpace(task.ModelProvider) ? "unknown" : task.ModelProvider, model: string.IsNullOrWhiteSpace(task.Model) ? "unknown" : task.Model,
                endpointPrivacy: "local", runId: task.Id);
        }
    }

    private static void AppendTaskJournalEvent(AgentTaskArtifact task, string type, IReadOnlyDictionary<string, string>? payload = null)
    {
        lock (TaskJournalGate)
        {
            var journal = TaskJournal.Value;
            if (!journal.Load().Runs.Any(run => run.RunId == task.Id))
                journal.Create(task.ProjectId ?? task.ConversationId ?? "local", task.Instruction,
                    actor: "system", modelProvider: string.IsNullOrWhiteSpace(task.ModelProvider) ? "unknown" : task.ModelProvider, model: string.IsNullOrWhiteSpace(task.Model) ? "unknown" : task.Model,
                    endpointPrivacy: "local", runId: task.Id);
            journal.AppendEvent(task.Id, type, actor: "agent-host", payload: payload, correlationId: task.Id);
        }
    }

    private static void SetTaskJournalStatus(AgentTaskArtifact task, string taskStatus)
    {
        lock (TaskJournalGate)
        {
            var journal = TaskJournal.Value;
            if (!journal.Load().Runs.Any(run => run.RunId == task.Id))
                journal.Create(task.ProjectId ?? task.ConversationId ?? "local", task.Instruction,
                    actor: "system", modelProvider: string.IsNullOrWhiteSpace(task.ModelProvider) ? "unknown" : task.ModelProvider, model: string.IsNullOrWhiteSpace(task.Model) ? "unknown" : task.Model,
                    endpointPrivacy: "local", runId: task.Id);
            var status = journal.Load().Runs.Single(run => run.RunId == task.Id).Status;
            void Move(string next)
            {
                status = journal.Transition(task.Id, next, actor: "agent-host", correlationId: task.Id).Status;
            }
            if (taskStatus is AgentTaskStatuses.Queued or AgentTaskStatuses.AwaitingApproval or AgentTaskStatuses.Running or AgentTaskStatuses.Completed)
            {
                if (status == OperationRunStatuses.Draft) Move(OperationRunStatuses.Validating);
                if (status == OperationRunStatuses.Validating) Move(OperationRunStatuses.Queued);
            }
            if (taskStatus == AgentTaskStatuses.AwaitingApproval && status == OperationRunStatuses.Queued)
                Move(OperationRunStatuses.AwaitingApproval);
            if (taskStatus == AgentTaskStatuses.Running && status is OperationRunStatuses.Queued or OperationRunStatuses.AwaitingApproval or OperationRunStatuses.NeedsReconciliation)
                Move(OperationRunStatuses.Running);
            if (taskStatus == AgentTaskStatuses.Completed)
            {
                if (status == OperationRunStatuses.Running) Move(OperationRunStatuses.Verifying);
                if (status is OperationRunStatuses.Verifying or OperationRunStatuses.ReviewReady) Move(OperationRunStatuses.Completed);
            }
            else if (taskStatus == AgentTaskStatuses.Failed && status is OperationRunStatuses.Running or OperationRunStatuses.Queued or OperationRunStatuses.AwaitingApproval or OperationRunStatuses.Validating)
                Move(OperationRunStatuses.Failed);
            else if (taskStatus == AgentTaskStatuses.Cancelled && status is OperationRunStatuses.Running or OperationRunStatuses.Queued or OperationRunStatuses.AwaitingApproval or OperationRunStatuses.Draft)
            {
                Move(OperationRunStatuses.Cancelling);
                Move(OperationRunStatuses.Cancelled);
            }
        }
    }

    private static object[] GetTaskActivity(string taskId)
    {
        lock (TaskJournalGate)
        {
            return TaskJournal.Value.Load().Events
                .Where(item => item.RunId == taskId || item.CorrelationId == taskId)
                .OrderBy(item => item.Sequence)
                .TakeLast(40)
                .Select(item => (object)new { sequence = item.Sequence, type = item.Type, actor = item.Actor, timestamp = item.TimestampUtc, payload = item.Payload })
                .ToArray();
        }
    }

}
