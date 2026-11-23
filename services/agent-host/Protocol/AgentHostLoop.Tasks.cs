using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using SkaiDesktop.Core.Infrastructure;
using SkaiDesktop.Core.Models;
using SkaiDesktop.Core.Services;

namespace SkaiDesktop.AgentHost.Protocol;

public static partial class AgentHostLoop
{
    private static AgentResponse ListTasks(AgentRequest request)
    {
        var tasks = CreateTaskStore().Load()
            .OrderByDescending(task => task.UpdatedAtUtc)
            .Select(task => new
            {
                id = task.Id,
                title = task.Title,
                instruction = task.Instruction,
                responseMode = ChatResponseModes.IsValid(task.ResponseMode) ? task.ResponseMode : ChatResponseModes.Coding,
                model = task.Model,
                modelProvider = task.ModelProvider,
                modelSizeBytes = task.ModelSizeBytes,
                modelContextLength = task.ModelContextLength,
                airLlmCompatible = task.AirLlmCompatible,
                projectId = task.ProjectId,
                conversationId = task.ConversationId,
                changedFiles = task.ChangedFiles,
                role = task.Role,
                status = task.Status,
                resultSummary = task.ResultSummary,
                artifactLabels = task.ArtifactLabels,
                dependsOn = task.DependsOn,
                requiresApproval = task.RequiresApproval,
                updatedAt = task.UpdatedAtUtc,
                activity = GetTaskActivity(task.Id),
            })
            .ToArray();
        return new(ProtocolVersion, request.Id, true, tasks);
    }

    private static AgentResponse PlanTask(AgentRequest request)
    {
        var environment = OptionalString(request, "environment") ?? "local";
        if (!string.Equals(environment, "local", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Only the Local environment is configured in this build. Worktree execution is not connected yet.");

        var task = CreateTaskStore().Create(
            RequiredBoundedString(request, "title", AgentTaskArtifactStore.MaxTitleCharacters),
            RequiredBoundedString(request, "instruction", AgentTaskArtifactStore.MaxInstructionCharacters),
            OptionalString(request, "role") ?? "specialist",
            requiresApproval: request.Params?.TryGetProperty("requiresApproval", out var requiresApproval) == true && requiresApproval.ValueKind == JsonValueKind.True,
            projectId: OptionalString(request, "projectId"),
            conversationId: OptionalString(request, "conversationId"),
            responseMode: OptionalString(request, "responseMode") ?? ChatResponseModes.Coding,
            model: OptionalString(request, "model"),
            modelProvider: OptionalString(request, "modelProvider"),
            modelSizeBytes: OptionalLong(request, "modelSizeBytes"),
            modelContextLength: OptionalInt(request, "modelContextLength"),
            airLlmCompatible: OptionalBoolean(request, "airLlmCompatible"));
        EnsureTaskJournal(task);
        var proposedMetadata = new Dictionary<string, string> { ["requiresApproval"] = task.RequiresApproval ? "true" : "false" };
        if (!string.IsNullOrWhiteSpace(task.ProjectId)) proposedMetadata["projectId"] = task.ProjectId;
        if (!string.IsNullOrWhiteSpace(task.ConversationId)) proposedMetadata["conversationId"] = task.ConversationId;
        AppendTaskJournalEvent(task, "task.proposed", proposedMetadata);
        return new(ProtocolVersion, request.Id, true, new
        {
            id = task.Id,
            title = task.Title,
            status = task.Status,
            requiresApproval = task.RequiresApproval,
            updatedAt = task.UpdatedAtUtc,
        });
    }

    private static AgentResponse StartTaskExecution(AgentRequest request)
    {
        var taskId = RequiredBoundedString(request, "id", 128);
        var task = CreateTaskStore().Get(taskId);
        if (task.Status != AgentTaskStatuses.Queued)
            throw new InvalidOperationException($"A task in {task.Status} state must be queued before execution.");

        lock (ActiveTaskExecutionsGate)
        {
            if (ActiveTaskExecutions.ContainsKey(taskId))
                throw new InvalidOperationException("The task is already executing.");

            var execution = new ActiveTaskExecution(new CancellationTokenSource());
            execution.Task = Task.Run(() => ExecuteQueuedLocalModelTaskAsync(taskId, execution));
            ActiveTaskExecutions[taskId] = execution;
        }

        var snapshot = new LocalCapacityProbe().GetSnapshotAsync().GetAwaiter().GetResult();
        var settings = CreateSettingsStore().Load();
        var effectiveProvider = string.IsNullOrWhiteSpace(task.ModelProvider) ? settings.ModelProvider : task.ModelProvider;
        var runtime = ReadRuntimeCapacity(settings, AirLlmProvider.IsAirLlmProvider(effectiveProvider));
        var decision = LocalExecutionCapacityPolicy.Decide(snapshot, settings.LocalRamBudgetBytes, settings.LocalGpuBudgetBytes, task.ModelSizeBytes, task.ModelContextLength, task.AirLlmCompatible, runtime.AirLlmReady == true, runtime.LoadedRamBytes, runtime.LoadedGpuBytes);
        int activeTaskCount;
        lock (LocalExecutionGate) activeTaskCount = LocalAdmittedTaskCount;
        var status = activeTaskCount < decision.SlotLimit ? AgentTaskStatuses.Running : AgentTaskStatuses.Queued;
        return new(ProtocolVersion, request.Id, true, new { id = taskId, status, execution = "local-queue" });
    }

    private static async Task ExecuteQueuedLocalModelTaskAsync(string taskId, ActiveTaskExecution execution)
    {
        var acquired = false;
        try
        {
            var task = CreateTaskStore().Get(taskId);
            await WaitForLocalExecutionCapacityAsync(task, execution.Cancellation.Token).ConfigureAwait(false);
            acquired = true;
            var store = CreateTaskStore();
            if (execution.Cancellation.IsCancellationRequested || store.Get(taskId).Status != AgentTaskStatuses.Queued)
            {
                if (execution.Cancellation.IsCancellationRequested)
                {
                    try
                    {
                        if (store.Get(taskId).Status == AgentTaskStatuses.Queued) store.CancelPlanned(taskId, "Cancelled while waiting for the local execution slot.");
                    }
                    catch (Exception error) when (error is KeyNotFoundException or InvalidOperationException) { }
                }
                return;
            }
            lock (ActiveTaskExecutionsGate) execution.Started = true;
            await ExecuteLocalModelTaskAsync(taskId, execution.Cancellation.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (execution.Cancellation.IsCancellationRequested)
        {
            var store = CreateTaskStore();
            try
            {
                if (store.Get(taskId).Status == AgentTaskStatuses.Queued) store.CancelPlanned(taskId, "Cancelled while waiting for the local execution slot.");
            }
            catch (Exception error) when (error is KeyNotFoundException or InvalidOperationException) { }
        }
        finally
        {
            if (acquired)
            {
                lock (LocalExecutionGate)
                {
                    LocalAdmittedTaskCount = Math.Max(0, LocalAdmittedTaskCount - 1);
                    Monitor.PulseAll(LocalExecutionGate);
                }
            }
            lock (ActiveTaskExecutionsGate)
            {
                if (ActiveTaskExecutions.Remove(taskId, out var finished)) finished.Cancellation.Dispose();
            }
        }
    }

    private static async Task WaitForLocalExecutionCapacityAsync(AgentTaskArtifact task, CancellationToken cancellationToken)
    {
        while (true)
        {
            var snapshot = await new LocalCapacityProbe().GetSnapshotAsync(cancellationToken).ConfigureAwait(false);
            var settings = CreateSettingsStore().Load();
            var effectiveProvider = string.IsNullOrWhiteSpace(task.ModelProvider) ? settings.ModelProvider : task.ModelProvider;
            var runtime = ReadRuntimeCapacity(settings, AirLlmProvider.IsAirLlmProvider(effectiveProvider), cancellationToken);
            var decision = LocalExecutionCapacityPolicy.Decide(snapshot, settings.LocalRamBudgetBytes, settings.LocalGpuBudgetBytes, task.ModelSizeBytes, task.ModelContextLength, task.AirLlmCompatible, runtime.AirLlmReady == true, runtime.LoadedRamBytes, runtime.LoadedGpuBytes);
            lock (LocalExecutionGate)
            {
                if (LocalAdmittedTaskCount < decision.SlotLimit)
                {
                    LocalAdmittedTaskCount++;
                    return;
                }
            }
            await Task.Delay(TimeSpan.FromMilliseconds(750), cancellationToken).ConfigureAwait(false);
        }
    }

    private static RuntimeCapacitySnapshot ReadRuntimeCapacity(AppSettings settings, bool checkAirLlm, CancellationToken cancellationToken = default)
    {
        var now = DateTimeOffset.UtcNow;
        var cacheKey = $"{settings.ModelProvider}|{settings.Endpoint}";
        lock (RuntimeCapacityGate)
        {
            if (CachedRuntimeCapacity is { } cached && cached.Key == cacheKey && now - cached.CapturedAtUtc < TimeSpan.FromSeconds(15) && (!checkAirLlm || cached.AirLlmReady.HasValue))
                return cached;
        }

        var loaded = !string.Equals(settings.ModelProvider, "Ollama", StringComparison.OrdinalIgnoreCase)
            ? new LocalLoadedModelSnapshot(false, [], "The selected local runtime does not expose loaded-model telemetry.")
            : new LocalRuntimeCapacityProbe().ReadOllamaLoadedModelsAsync(settings.Endpoint, cancellationToken).GetAwaiter().GetResult();
        var models = loaded.Models.Take(32).Select(model => new RuntimeLoadedModel(model.Runtime, model.Model, model.RamBytes, model.GpuBytes)).ToArray();
        var result = new RuntimeCapacitySnapshot(
            cacheKey,
            now,
            loaded.Known,
            models,
            loaded.Models.Sum(model => model.RamBytes.GetValueOrDefault()),
            loaded.Models.Sum(model => model.GpuBytes.GetValueOrDefault()),
            loaded.Note,
            checkAirLlm ? new AirLlmProvider().IsRuntimeAvailable(settings) : null);
        lock (RuntimeCapacityGate) CachedRuntimeCapacity = result;
        return result;
    }

    private static async Task ExecuteLocalModelTaskAsync(string taskId, CancellationToken cancellationToken)
    {
        var settings = CreateSettingsStore().Load();
        var executor = new AgentTaskExecutor(CreateTaskStore());
        var journalTask = CreateTaskStore().Get(taskId);
        SetTaskJournalStatus(journalTask, AgentTaskStatuses.Running);
        AppendTaskJournalEvent(journalTask, "task.execution_started");
        var finalTask = await executor.ExecuteAsync(taskId, async (task, cancellationToken) =>
        {
            cancellationToken.ThrowIfCancellationRequested();
            var project = task.ProjectId is null ? null : CreateProjectStore().Load().SingleOrDefault(item => item.Id == task.ProjectId)
                ?? throw new InvalidOperationException("The project linked to this thread is no longer available.");
            var root = project?.FolderPaths.FirstOrDefault();
            if (project is not null && string.IsNullOrWhiteSpace(root)) throw new InvalidOperationException("Select a local project folder before starting a coding task.");
            var editor = new WorkspaceFileEditor();
            var undoStore = CreateUndoStore();
            var changedFiles = new List<string>();
            var commandCount = 0;
            IReadOnlyList<WorkspaceFileContext.WorkspaceTextFileEntry> files = project is null
                ? Array.Empty<WorkspaceFileContext.WorkspaceTextFileEntry>()
                : WorkspaceFileContext.EnumerateTextFileBrowser(project.FolderPaths).Files;
            var system = project is null
                ? "You are Skai's local coding agent. Work only from the user's prompt; do not claim file edits or commands. Return exactly one JSON object: {\"action\":\"done\",\"summary\":\"...\"}."
                : "You are Skai's local coding agent. Return exactly one JSON object and no markdown. Actions: {\"action\":\"read_file\",\"path\":\"relative/path\"}; {\"action\":\"write_file\",\"path\":\"relative/path\",\"content\":\"complete file text\",\"expectedHash\":\"current hash or null for a new file\"}; {\"action\":\"run_command\",\"command\":\"...\",\"cwd\":\".\"}; {\"action\":\"done\",\"summary\":\"...\"}. Escape backslashes and quotes inside JSON strings, and encode line breaks as \\n. Use the provided workspace paths. Read files before editing. Never claim an action before its result is returned. Keep edits focused. You may make at most 12 file or command actions, and at most 3 commands. Commands run in the selected project folder with a two-minute timeout. If an operation fails, adapt or report it honestly.";
            var messages = new List<ChatMessage>
            {
                new("system", system),
                new("user", $"Task: {task.Instruction}\n\nProject: {project?.Name ?? "No project selected"}\n\nReadable project files:\n{string.Join("\n", files.Select(file => $"- {file.RelativePath} ({file.Bytes} bytes)"))}"),
            };
            string? summary = null;
            for (var step = 0; step < 13; step++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                JsonDocument? parsedAction = null;
                for (var formatAttempt = 0; formatAttempt < 3 && parsedAction is null; formatAttempt++)
                {
                    var parameters = JsonSerializer.SerializeToElement(new
                    {
                        endpoint = settings.Endpoint,
                        provider = settings.ModelProvider,
                        model = settings.Model,
                        timeoutSeconds = 285,
                        responseMode = task.ResponseMode,
                        messages,
                    }, JsonOptions);
                    var response = await CompleteChatAsync(new AgentRequest(ProtocolVersion, $"task-{task.Id}-{step}-{formatAttempt}", "chat.complete", parameters), cancellationToken);
                    if (!response.Ok) throw new InvalidOperationException(response.Error?.Message ?? "The local model could not complete the task.");
                    var responseJson = JsonSerializer.SerializeToElement(response.Result, JsonOptions);
                    var content = responseJson.TryGetProperty("content", out var contentValue) ? contentValue.GetString() : null;
                    if (string.IsNullOrWhiteSpace(content)) throw new InvalidOperationException("The local model returned an empty coding-agent action.");
                    try
                    {
                        var normalizedContent = NormalizeCodingAction(content);
                        var candidate = JsonDocument.Parse(normalizedContent);
                        if (candidate.RootElement.ValueKind != JsonValueKind.Object)
                        {
                            candidate.Dispose();
                            throw new JsonException("The coding agent action must be a JSON object.");
                        }
                        messages.Add(new ChatMessage("assistant", normalizedContent));
                        parsedAction = candidate;
                    }
                    catch (JsonException error) when (formatAttempt < 2)
                    {
                        messages.Add(new ChatMessage("assistant", content.Trim()));
                        messages.Add(new ChatMessage("user", $"Your previous response was not a valid coding action JSON object ({error.Message}). Repeat the action as one valid JSON object, with every backslash and quote escaped inside string values. Do not use markdown fences."));
                    }
                }
                using var actionDocument = parsedAction ?? throw new JsonException("The local model returned invalid coding action JSON three times.");
                var action = actionDocument.RootElement;
                var actionName = action.TryGetProperty("action", out var actionValue) ? actionValue.GetString() : null;
                if (actionName == "done")
                {
                    summary = action.TryGetProperty("summary", out var summaryValue) ? summaryValue.GetString() : null;
                    break;
                }
                if (step >= 12) throw new InvalidOperationException("The coding agent reached its 12-action limit before finishing.");
                if (project is null || root is null) throw new InvalidOperationException("This coding thread has no project. Choose a project before asking it to change files.");
                switch (actionName)
                {
                    case "read_file":
                    {
                        var path = action.GetProperty("path").GetString() ?? throw new InvalidOperationException("The model omitted the file path.");
                        AppendTaskJournalEvent(task, "tool.read_file.started", new Dictionary<string, string> { ["path"] = path });
                        var text = editor.ReadText(root, path);
                        AppendTaskJournalEvent(task, "tool.read_file.completed", new Dictionary<string, string> { ["path"] = path, ["characters"] = text.Length.ToString(CultureInfo.InvariantCulture) });
                        messages.Add(new ChatMessage("user", $"READ RESULT for {path}:\n{text}"));
                        break;
                    }
                    case "write_file":
                    {
                        var path = action.GetProperty("path").GetString() ?? throw new InvalidOperationException("The model omitted the file path.");
                        var text = action.GetProperty("content").GetString() ?? throw new InvalidOperationException("The model omitted the file content.");
                        var expectedHash = action.TryGetProperty("expectedHash", out var hashValue) && hashValue.ValueKind == JsonValueKind.String ? hashValue.GetString() : null;
                        AppendTaskJournalEvent(task, "tool.write_file.started", new Dictionary<string, string> { ["path"] = path, ["characters"] = text.Length.ToString(CultureInfo.InvariantCulture) });
                        var receipt = editor.Apply(root, path, text, expectedHash);
                        var undoId = Guid.NewGuid().ToString("N");
                        undoStore.Add(undoStore.Load(), new WorkspaceUndoEntry(undoId, DateTimeOffset.UtcNow, project.Name, root, path, receipt.PreviousContent, receipt.AppliedHash));
                        AppendTaskJournalEvent(task, "tool.write_file.completed", new Dictionary<string, string> { ["path"] = path, ["undoId"] = undoId, ["sha256"] = receipt.AppliedHash });
                        if (!changedFiles.Contains(path, StringComparer.Ordinal)) changedFiles.Add(path);
                        messages.Add(new ChatMessage("user", $"WRITE RESULT for {path}: applied successfully; undo ID {undoId}; current hash {receipt.AppliedHash}."));
                        break;
                    }
                    case "run_command":
                    {
                        if (++commandCount > 3) throw new InvalidOperationException("The coding agent reached its 3-command limit.");
                        var command = action.GetProperty("command").GetString() ?? throw new InvalidOperationException("The model omitted the command.");
                        var cwd = action.TryGetProperty("cwd", out var cwdValue) ? cwdValue.GetString() ?? "." : ".";
                        AppendTaskJournalEvent(task, "tool.command.started", new Dictionary<string, string> { ["workingDirectory"] = cwd });
                        var result = await new WorkspaceCommandRunner().RunAsync(root, cwd, command, TimeSpan.FromMinutes(2), cancellationToken);
                        AppendTaskJournalEvent(task, "tool.command.completed", new Dictionary<string, string> { ["workingDirectory"] = cwd, ["exitCode"] = result.ExitCode.ToString(CultureInfo.InvariantCulture), ["timedOut"] = result.TimedOut ? "true" : "false", ["outputCharacters"] = result.Output.Length.ToString(CultureInfo.InvariantCulture) });
                        messages.Add(new ChatMessage("user", $"COMMAND RESULT (exit {result.ExitCode}, timed out: {result.TimedOut}):\n{result.Output}"));
                        break;
                    }
                    default:
                        throw new InvalidOperationException("The local model returned an unsupported coding-agent action. Ask it again with one valid JSON action.");
                }
            }
            if (string.IsNullOrWhiteSpace(summary)) throw new InvalidOperationException("The local model did not return a final summary.");
            var labels = changedFiles.Count == 0 ? new[] { "local-model-response" } : changedFiles.ToArray();
            return new AgentTaskExecutionResult(summary.Trim(), labels);
        }).ConfigureAwait(false);
        if (finalTask.Status == AgentTaskStatuses.Completed)
        {
            SetTaskJournalStatus(finalTask, AgentTaskStatuses.Completed);
            AppendTaskJournalEvent(finalTask, "task.verification.completed", new Dictionary<string, string> { ["artifactCount"] = finalTask.ArtifactLabels.Count.ToString(CultureInfo.InvariantCulture), ["changedFileCount"] = finalTask.ChangedFiles.Count.ToString(CultureInfo.InvariantCulture) });
        }
        else if (finalTask.Status == AgentTaskStatuses.Cancelled)
        {
            SetTaskJournalStatus(finalTask, AgentTaskStatuses.Cancelled);
            AppendTaskJournalEvent(finalTask, "task.cancelled");
        }
        else
        {
            SetTaskJournalStatus(finalTask, AgentTaskStatuses.Failed);
            AppendTaskJournalEvent(finalTask, "task.failed", new Dictionary<string, string> { ["hasSummary"] = string.IsNullOrWhiteSpace(finalTask.ResultSummary) ? "false" : "true" });
        }
    }

    private static AgentResponse TransitionTask(AgentRequest request, string operation)
    {
        var id = RequiredBoundedString(request, "id", 128);
        var store = CreateTaskStore();
        if (operation == "cancel")
        {
            lock (ActiveTaskExecutionsGate)
            {
                if (ActiveTaskExecutions.TryGetValue(id, out var active))
                {
                    active.Cancellation.Cancel();
                    if (!active.Started)
                    {
                        return new(ProtocolVersion, request.Id, true, new { id, status = AgentTaskStatuses.Queued, cancellationRequested = true });
                    }
                    return new(ProtocolVersion, request.Id, true, new { id, status = AgentTaskStatuses.Running, cancellationRequested = true });
                }
            }
        }
        var task = operation switch
        {
            "queue" => store.Queue(id),
            "cancel" => store.CancelPlanned(id),
            "retry" => store.RetryBlocked(id),
            "approve" => store.Approve(id),
            "deny" => store.Deny(id),
            _ => throw new InvalidOperationException("Unknown task operation."),
        };
        SetTaskJournalStatus(task, task.Status);
        AppendTaskJournalEvent(task, operation switch
        {
            "queue" => task.Status == AgentTaskStatuses.AwaitingApproval ? "task.approval_required" : "task.queued",
            "approve" => "task.approval_granted",
            "deny" => "task.approval_denied",
            "cancel" => "task.cancel_requested",
            "retry" => "task.retry_requested",
            _ => "task.updated",
        }, new Dictionary<string, string> { ["status"] = task.Status, ["requiresApproval"] = task.RequiresApproval ? "true" : "false" });
        return new(ProtocolVersion, request.Id, true, new { id = task.Id, status = task.Status, updatedAt = task.UpdatedAtUtc, resultSummary = task.ResultSummary });
    }

    private static string NormalizeCodingAction(string content)
    {
        var json = content.Trim();
        if (!json.StartsWith("```", StringComparison.Ordinal)) return json;

        var openingLineEnd = json.IndexOf('\n');
        var closingFence = json.LastIndexOf("```", StringComparison.Ordinal);
        if (openingLineEnd < 0 || closingFence <= openingLineEnd)
            throw new JsonException("The coding agent returned an incomplete JSON code fence.");

        var language = json[3..openingLineEnd].Trim();
        if (language.Length > 0 && !language.Equals("json", StringComparison.OrdinalIgnoreCase))
            throw new JsonException("The coding agent fenced its action with an unsupported language label.");
        if (!string.IsNullOrWhiteSpace(json[(closingFence + 3)..]))
            throw new JsonException("The coding agent returned text after its JSON code fence.");

        return json[(openingLineEnd + 1)..closingFence].Trim();
    }

    private sealed record RuntimeLoadedModel(string Runtime, string Model, long? RamBytes, long? GpuBytes);

    private sealed record RuntimeCapacitySnapshot(
        string Key,
        DateTimeOffset CapturedAtUtc,
        bool LoadedModelsKnown,
        IReadOnlyList<RuntimeLoadedModel> LoadedModels,
        long LoadedRamBytes,
        long LoadedGpuBytes,
        string? LoadedModelNote,
        bool? AirLlmReady);

    private sealed class ActiveTaskExecution(CancellationTokenSource cancellation)
    {
        public CancellationTokenSource Cancellation { get; } = cancellation;
        public Task Task { get; set; } = Task.CompletedTask;
        public bool Started { get; set; }
    }

}
