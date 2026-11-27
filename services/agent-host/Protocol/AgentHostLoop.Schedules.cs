using System.Text.Json;
using SkaiDesktop.Core.Models;
using SkaiDesktop.Core.Services;

namespace SkaiDesktop.AgentHost.Protocol;

public static partial class AgentHostLoop
{
    private static async Task RunScheduledDispatcherAsync(CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1));
        while (await timer.WaitForNextTickAsync(cancellationToken).ConfigureAwait(false))
        {
            ScheduledTask? task;
            try { task = CreateScheduledTaskStore().TryClaimDue(); }
            catch { continue; }
            if (task is null) continue;

            try
            {
                var settings = CreateSettingsStore().Load();
                var parameters = JsonSerializer.SerializeToElement(new
                {
                    endpoint = settings.Endpoint,
                    provider = settings.ModelProvider,
                    model = settings.Model,
                    timeoutSeconds = 285,
                    responseMode = task.WorkspaceMode == WorkspaceModes.CodingAgent ? ChatResponseModes.Coding : ChatResponseModes.Think,
                    messages = new[]
                    {
                        new ChatMessage("system", "You are Skai's scheduled local assistant. Complete the scheduled request using only the configured local model and report the result concisely."),
                        new ChatMessage("user", task.Prompt),
                    },
                }, JsonOptions);
                var response = await CompleteChatAsync(new AgentRequest(ProtocolVersion, $"scheduled-{task.Id}", "chat.complete", parameters), cancellationToken).ConfigureAwait(false);
                if (!response.Ok) throw new InvalidOperationException(response.Error?.Message ?? "The local model could not complete the scheduled request.");
                var responseJson = JsonSerializer.SerializeToElement(response.Result, JsonOptions);
                var content = responseJson.TryGetProperty("content", out var contentValue) ? contentValue.GetString() : null;
                if (string.IsNullOrWhiteSpace(content)) throw new InvalidOperationException("The local model returned an empty scheduled result.");
                var outcome = TrimScheduledOutcome(content);
                CreateScheduledTaskStore().Complete(task.Id, succeeded: true, outcome);
                AppendScheduledConversationResult(task, outcome);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception error)
            {
                try { CreateScheduledTaskStore().Complete(task.Id, succeeded: false, TrimScheduledOutcome(error.Message)); }
                catch { /* Preserve the host protocol if scheduler persistence is unavailable. */ }
            }
        }
    }

    private static string TrimScheduledOutcome(string value)
    {
        var outcome = value.Replace('\r', ' ').Replace('\n', ' ').Trim();
        if (outcome.Length == 0) return "Scheduled run completed without a summary.";
        return outcome.Length <= ScheduledTaskStore.MaxOutcomeCharacters ? outcome : outcome[..ScheduledTaskStore.MaxOutcomeCharacters];
    }

    private static void AppendScheduledConversationResult(ScheduledTask task, string outcome)
    {
        if (string.IsNullOrWhiteSpace(task.ConversationId)) return;
        var store = CreateConversationStore();
        var sessions = store.Load();
        var session = sessions.SingleOrDefault(item => item.Id == task.ConversationId);
        if (session is null) return;
        session.Messages.Add(new ChatMessage("assistant", $"Scheduled run · {task.Prompt}\n\n{outcome}"));
        session.UpdatedAt = DateTimeOffset.UtcNow;
        store.Save(sessions);
    }


    private static AgentResponse ListScheduledTasks(AgentRequest request)
    {
        var settings = CreateSettingsStore().Load();
        var selectedModel = $"{settings.ModelProvider} · {settings.Model}";
        var tasks = CreateScheduledTaskStore().Load()
            .OrderBy(task => task.DueAtUtc)
            .Select(task => new
            {
                id = task.Id,
                conversationId = task.ConversationId,
                prompt = task.Prompt,
                workspaceMode = task.WorkspaceMode,
                dueAt = task.DueAtUtc,
                repeatEveryMinutes = task.RepeatEveryMinutes,
                missedRunPolicy = task.MissedRunPolicy,
                triggerType = task.TriggerType,
                triggerValue = task.TriggerValue,
                overlapPolicy = task.OverlapPolicy,
                dryRunCompletedAt = task.DryRunCompletedAtUtc,
                sourceTaskId = task.SourceTaskId,
                sourceWorkflowName = task.SourceWorkflowName,
                status = task.Status,
                outcome = task.Outcome,
                runs = task.Runs,
                selectedModel,
            })
            .ToArray();
        return new(ProtocolVersion, request.Id, true, tasks);
    }

    private static AgentResponse CreateScheduledTask(AgentRequest request)
    {
        var dueAtText = RequiredBoundedString(request, "dueAt", 128);
        if (!DateTimeOffset.TryParse(dueAtText, out var dueAt))
            throw new InvalidOperationException("dueAt must be a valid date and time.");
        var repeat = OptionalInt(request, "repeatEveryMinutes");
        var conversationId = OptionalString(request, "conversationId");
        if (!OptionalBoolean(request, "dryRunCompleted")) throw new InvalidOperationException("Run the one-time dry run before enabling this automation.");
        var task = CreateScheduledTaskStore().Schedule(
            RequiredBoundedString(request, "prompt", ScheduledTaskStore.MaxPromptCharacters),
            dueAt.ToUniversalTime(),
            OptionalString(request, "workspaceMode") ?? WorkspaceModes.Chat,
            repeatEveryMinutes: repeat,
            conversationId: conversationId,
            missedRunPolicy: OptionalString(request, "missedRunPolicy") ?? ScheduledMissedRunPolicies.RunOnce,
            triggerType: OptionalString(request, "triggerType") ?? ScheduledTriggerTypes.Schedule,
            triggerValue: OptionalString(request, "triggerValue"),
            overlapPolicy: OptionalString(request, "overlapPolicy") ?? ScheduledOverlapPolicies.Skip,
            dryRunCompleted: true,
            sourceTaskId: OptionalString(request, "sourceTaskId"),
            sourceWorkflowName: OptionalString(request, "sourceWorkflowName"));
        return ScheduledTaskResponse(request, task);
    }

    private static AgentResponse TransitionScheduledTask(AgentRequest request, string operation)
    {
        var store = CreateScheduledTaskStore();
        var id = RequiredBoundedString(request, "id", 128);
        switch (operation)
        {
            case "pause": store.Pause(id); break;
            case "resume": store.Resume(id); break;
            case "cancel": store.Cancel(id); break;
            case "runNow": store.RunNow(id); break;
            case "resolveMissed": store.ResolveMissedRun(id, RequiredBoundedString(request, "choice", 32)); break;
            default: throw new InvalidOperationException("Unknown scheduled-task operation.");
        }
        var task = store.Load().Single(item => item.Id == id);
        return ScheduledTaskResponse(request, task);
    }

    private static AgentResponse ScheduledTaskResponse(AgentRequest request, ScheduledTask task) =>
        new(ProtocolVersion, request.Id, true, new
        {
            id = task.Id,
            conversationId = task.ConversationId,
            prompt = task.Prompt,
            workspaceMode = task.WorkspaceMode,
            dueAt = task.DueAtUtc,
            repeatEveryMinutes = task.RepeatEveryMinutes,
            missedRunPolicy = task.MissedRunPolicy,
            triggerType = task.TriggerType,
            triggerValue = task.TriggerValue,
            overlapPolicy = task.OverlapPolicy,
            dryRunCompletedAt = task.DryRunCompletedAtUtc,
            sourceTaskId = task.SourceTaskId,
            sourceWorkflowName = task.SourceWorkflowName,
            status = task.Status,
            outcome = task.Outcome,
            runs = task.Runs,
            selectedModel = SelectedScheduleModel(),
        });

    private static string SelectedScheduleModel()
    {
        var settings = CreateSettingsStore().Load();
        return $"{settings.ModelProvider} · {settings.Model}";
    }


}
