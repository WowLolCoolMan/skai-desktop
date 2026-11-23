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
            var verificationRepairRequired = false;
            IReadOnlyList<WorkspaceFileContext.WorkspaceTextFileEntry> files = project is null
                ? Array.Empty<WorkspaceFileContext.WorkspaceTextFileEntry>()
                : WorkspaceFileContext.EnumerateTextFileBrowser(project.FolderPaths).Files;
            var system = project is null
                ? "You are Skai's local coding agent. Work only from the user's prompt; do not claim file edits or commands. Return exactly one JSON object: {\"action\":\"done\",\"summary\":\"...\"}."
                : "You are Skai's local coding agent. Use the available file and command tools; for Ollama, call the named tools directly. Use exactly one tool per turn. If the model endpoint does not return a native tool call, return the same action as one JSON object. First inspect the relevant source, tests, and project instructions with read_file. Before editing, derive a short checklist from the acceptance requirements and preserve details explicitly required by tests (including digits, suffixes, and meaningful name tokens). Make a focused implementation, then run the requested verification. On failure, compare each exact expected/actual value and fix only the failing behavior; rerun verification after the fix. Keep earlier passing behavior. Use replace_text for small unique edits with the latest SHA-256; write_file is for new files or a necessary complete rewrite. Do not use commands to inspect or edit files. Commands run in the selected project folder with a two-minute timeout. You may make at most 20 file or command actions and at most 8 commands. Never claim an action before its result returns; if a check still fails at the limit, report it honestly.";
            var messages = new List<ChatMessage>
            {
                new("system", system),
                new("user", $"Task: {task.Instruction}\n\nProject: {project?.Name ?? "No project selected"}\n\nReadable project files:\n{string.Join("\n", files.Select(file => $"- {file.RelativePath} ({file.Bytes} bytes)"))}"),
            };
            var useNativeOllamaTools = project is not null && string.Equals(settings.ModelProvider, "Ollama", StringComparison.OrdinalIgnoreCase);
            var ollamaMessages = useNativeOllamaTools
                ? new List<OllamaToolChatMessage> { new("system", system), new("user", messages[1].Content) }
                : null;
            var codingTools = useNativeOllamaTools ? CreateCodingTools() : null;
            string? summary = null;
            for (var step = 0; step < 21; step++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                JsonDocument? parsedAction = null;
                OllamaToolFunctionCall? nativeCall = null;
                if (ollamaMessages is not null && codingTools is not null)
                {
                    var provider = new OpenAiCompatibleProvider();
                    var toolResponse = await provider.CompleteOllamaToolChatAsync(
                        settings,
                        ollamaMessages,
                        codingTools,
                        cancellationToken,
                        maxTokens: 2048).ConfigureAwait(false);
                    if (toolResponse.ToolCalls.Count == 1)
                    {
                        nativeCall = toolResponse.ToolCalls[0];
                        using var arguments = JsonDocument.Parse(nativeCall.ArgumentsJson);
                        var normalized = new Dictionary<string, JsonElement>(StringComparer.Ordinal)
                        {
                            ["action"] = JsonSerializer.SerializeToElement(nativeCall.Name),
                        };
                        foreach (var property in arguments.RootElement.EnumerateObject())
                            if (!normalized.TryAdd(property.Name, property.Value.Clone()))
                                throw new InvalidDataException("Ollama returned a duplicate coding action argument.");
                        var normalizedContent = JsonSerializer.Serialize(normalized, JsonOptions);
                        parsedAction = JsonDocument.Parse(normalizedContent);
                        messages.Add(new ChatMessage("assistant", normalizedContent));
                        ollamaMessages.Add(new OllamaToolChatMessage("assistant", toolResponse.Content, [nativeCall]));
                    }
                    else
                    {
                        // Some local Ollama models do not support native function calling. Keep
                        // their work in the same bounded action loop by switching to JSON actions.
                        ollamaMessages = null;
                        codingTools = null;
                        if (!string.IsNullOrWhiteSpace(toolResponse.Content))
                            messages.Add(new ChatMessage("assistant", toolResponse.Content.Trim()));
                        messages.Add(new ChatMessage("user", "The Ollama model did not return exactly one native tool call. Continue using the same bounded coding actions as one JSON object per response (read_file, write_file, replace_text, run_command, or done). Do not repeat the previous response."));
                    }
                }
                if (parsedAction is null)
                {
                    const int maxCodingActionRepairAttempts = 3;
                    for (var formatAttempt = 0; formatAttempt <= maxCodingActionRepairAttempts && parsedAction is null; formatAttempt++)
                    {
                        var parameters = JsonSerializer.SerializeToElement(new
                        {
                            endpoint = settings.Endpoint,
                            provider = settings.ModelProvider,
                            model = settings.Model,
                            timeoutSeconds = 285,
                            temperature = 0.2,
                            maxTokens = 2048,
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
                        catch (JsonException error)
                        {
                            messages.Add(new ChatMessage("assistant", content.Trim()));
                            if (formatAttempt == maxCodingActionRepairAttempts) break;
                            var escapeGuidance = error.Message.Contains("invalid escapable character", StringComparison.OrdinalIgnoreCase)
                                ? " A backslash in file content must be doubled in JSON; for example, source text `\\w` must appear as `\\\\w` inside the JSON string."
                                : string.Empty;
                            messages.Add(new ChatMessage("user", $"Your previous response was not a valid coding action JSON object ({error.Message}). Repeat the action as one valid JSON object, with every backslash and quote escaped inside string values. Do not use markdown fences.{escapeGuidance}"));
                        }
                    }
                }
                using var actionDocument = parsedAction ?? throw new JsonException("The local model returned invalid coding action JSON after three repair attempts.");
                var action = actionDocument.RootElement;
                var actionName = action.TryGetProperty("action", out var actionValue) ? actionValue.GetString() : null;
                if (actionName == "done")
                {
                    if (verificationRepairRequired)
                        throw new InvalidOperationException("The coding agent cannot finish while its latest verification command is failing; fix the reported issue or leave the task incomplete.");
                    var proposedSummary = action.TryGetProperty("summary", out var summaryValue) ? summaryValue.GetString() : null;
                    if (string.IsNullOrWhiteSpace(proposedSummary))
                    {
                        messages.Add(new ChatMessage("user", "A completed task must include a concise, non-empty summary of the work and verification. Return a done action with that summary."));
                        continue;
                    }
                    summary = proposedSummary;
                    break;
                }
                if (step >= 20) throw new InvalidOperationException("The coding agent reached its 20-action limit before finishing.");
                if (project is null || root is null) throw new InvalidOperationException("This coding thread has no project. Choose a project before asking it to change files.");
                switch (actionName)
                {
                    case "read_file":
                    {
                        var path = action.GetProperty("path").GetString() ?? throw new InvalidOperationException("The model omitted the file path.");
                        AppendTaskJournalEvent(task, "tool.read_file.started", new Dictionary<string, string> { ["path"] = path });
                        var snapshot = editor.ReadTextWithHash(root, path);
                        AppendTaskJournalEvent(task, "tool.read_file.completed", new Dictionary<string, string> { ["path"] = path, ["characters"] = snapshot.Content.Length.ToString(CultureInfo.InvariantCulture), ["sha256"] = snapshot.Sha256 });
                        messages.Add(new ChatMessage("user", $"READ RESULT for {path} (SHA-256 {snapshot.Sha256}; provide this exact value as expectedHash when writing this existing file):\n{snapshot.Content}"));
                        break;
                    }
                    case "write_file":
                    {
                        var path = action.GetProperty("path").GetString() ?? throw new InvalidOperationException("The model omitted the file path.");
                        var text = action.GetProperty("content").GetString() ?? throw new InvalidOperationException("The model omitted the file content.");
                        var expectedHash = action.TryGetProperty("expectedHash", out var hashValue) && hashValue.ValueKind == JsonValueKind.String ? hashValue.GetString() : null;
                        if (verificationRepairRequired && expectedHash is not null)
                        {
                            try
                            {
                                var current = editor.ReadTextWithHash(root, path);
                                if (string.Equals(current.Sha256, expectedHash, StringComparison.Ordinal) && string.Equals(current.Content, text, StringComparison.Ordinal))
                                {
                                    AppendTaskJournalEvent(task, "tool.write_file.rejected", new Dictionary<string, string> { ["path"] = path, ["reason"] = "The proposed content is unchanged after a failed verification." });
                                    messages.Add(new ChatMessage("user", $"WRITE NOT APPLIED for {path}: the proposal is byte-for-byte identical to the current file, and the last verification still failed. Use the exact failing assertion output to make a targeted implementation change."));
                                    break;
                                }
                            }
                            catch (FileNotFoundException) { }
                        }
                        AppendTaskJournalEvent(task, "tool.write_file.started", new Dictionary<string, string> { ["path"] = path, ["characters"] = text.Length.ToString(CultureInfo.InvariantCulture) });
                        WorkspaceEditReceipt receipt;
                        try
                        {
                            receipt = editor.Apply(root, path, text, expectedHash);
                        }
                        catch (IOException error)
                        {
                            AppendTaskJournalEvent(task, "tool.write_file.rejected", new Dictionary<string, string> { ["path"] = path, ["reason"] = error.Message });
                            messages.Add(new ChatMessage("user", $"WRITE FAILED for {path}: {error.Message} Reopen the current file with read_file, review its current content and SHA-256, then propose a fresh write. Do not retry the stale proposal."));
                            break;
                        }
                        var undoId = Guid.NewGuid().ToString("N");
                        undoStore.Add(undoStore.Load(), new WorkspaceUndoEntry(undoId, DateTimeOffset.UtcNow, project.Name, root, path, receipt.PreviousContent, receipt.AppliedHash));
                        AppendTaskJournalEvent(task, "tool.write_file.completed", new Dictionary<string, string> { ["path"] = path, ["undoId"] = undoId, ["sha256"] = receipt.AppliedHash });
                        if (!changedFiles.Contains(path, StringComparer.Ordinal)) changedFiles.Add(path);
                        verificationRepairRequired = false;
                        messages.Add(new ChatMessage("user", $"WRITE RESULT for {path}: applied successfully; undo ID {undoId}; current hash {receipt.AppliedHash}."));
                        break;
                    }
                    case "replace_text":
                    {
                        var path = action.GetProperty("path").GetString() ?? throw new InvalidOperationException("The model omitted the file path.");
                        var find = action.GetProperty("find").GetString() ?? throw new InvalidOperationException("The model omitted the exact text to replace.");
                        var replacement = action.GetProperty("replacement").GetString() ?? throw new InvalidOperationException("The model omitted the replacement text.");
                        var expectedHash = action.TryGetProperty("expectedHash", out var hashValue) && hashValue.ValueKind == JsonValueKind.String ? hashValue.GetString() : null;
                        if (string.IsNullOrEmpty(find)) throw new InvalidOperationException("The exact text to replace must be non-empty.");
                        if (string.IsNullOrWhiteSpace(expectedHash)) throw new InvalidOperationException("replace_text requires the current SHA-256 from read_file or the latest edit result.");

                        var current = editor.ReadTextWithHash(root, path);
                        if (!string.Equals(current.Sha256, expectedHash, StringComparison.Ordinal))
                        {
                            messages.Add(new ChatMessage("user", $"EDIT NOT APPLIED for {path}: the file changed since hash {expectedHash}. Current SHA-256 is {current.Sha256}; reread it before proposing another exact replacement."));
                            break;
                        }
                        var firstOccurrence = current.Content.IndexOf(find, StringComparison.Ordinal);
                        if (firstOccurrence < 0 || current.Content.IndexOf(find, firstOccurrence + find.Length, StringComparison.Ordinal) >= 0)
                        {
                            messages.Add(new ChatMessage("user", $"EDIT NOT APPLIED for {path}: the exact text must occur once, but it was {(firstOccurrence < 0 ? "not found" : "found more than once")}. Reread the current file and choose a unique, smaller substring."));
                            break;
                        }
                        var updated = string.Concat(current.Content[..firstOccurrence], replacement, current.Content[(firstOccurrence + find.Length)..]);
                        if (string.Equals(current.Content, updated, StringComparison.Ordinal))
                        {
                            messages.Add(new ChatMessage("user", $"EDIT NOT APPLIED for {path}: the replacement makes no change. Use the failing expected/actual output to propose a different correction."));
                            break;
                        }

                        AppendTaskJournalEvent(task, "tool.replace_text.started", new Dictionary<string, string> { ["path"] = path, ["characters"] = replacement.Length.ToString(CultureInfo.InvariantCulture) });
                        WorkspaceEditReceipt receipt;
                        try { receipt = editor.Apply(root, path, updated, expectedHash); }
                        catch (IOException error)
                        {
                            messages.Add(new ChatMessage("user", $"EDIT FAILED for {path}: {error.Message} Reread the current file and propose a fresh exact replacement."));
                            break;
                        }
                        var undoId = Guid.NewGuid().ToString("N");
                        undoStore.Add(undoStore.Load(), new WorkspaceUndoEntry(undoId, DateTimeOffset.UtcNow, project.Name, root, path, receipt.PreviousContent, receipt.AppliedHash));
                        AppendTaskJournalEvent(task, "tool.replace_text.completed", new Dictionary<string, string> { ["path"] = path, ["undoId"] = undoId, ["sha256"] = receipt.AppliedHash });
                        if (!changedFiles.Contains(path, StringComparer.Ordinal)) changedFiles.Add(path);
                        verificationRepairRequired = false;
                        messages.Add(new ChatMessage("user", $"EDIT RESULT for {path}: exactly one occurrence was replaced; undo ID {undoId}; current hash {receipt.AppliedHash}."));
                        break;
                    }
                    case "run_command":
                    {
                        if (verificationRepairRequired)
                        {
                            messages.Add(new ChatMessage("user", "The previous verification command failed. This command was not run because no file has changed since that failure. Use write_file to fix the reported issue first; then rerun verification."));
                            break;
                        }
                        if (++commandCount > 8) throw new InvalidOperationException("The coding agent reached its 8-command limit.");
                        var command = action.GetProperty("command").GetString() ?? throw new InvalidOperationException("The model omitted the command.");
                        var cwd = action.TryGetProperty("cwd", out var cwdValue) ? cwdValue.GetString() ?? "." : ".";
                        AppendTaskJournalEvent(task, "tool.command.started", new Dictionary<string, string> { ["workingDirectory"] = cwd });
                        var result = await new WorkspaceCommandRunner().RunAsync(root, cwd, command, TimeSpan.FromMinutes(2), cancellationToken);
                        AppendTaskJournalEvent(task, "tool.command.completed", new Dictionary<string, string> { ["workingDirectory"] = cwd, ["exitCode"] = result.ExitCode.ToString(CultureInfo.InvariantCulture), ["timedOut"] = result.TimedOut ? "true" : "false", ["outputCharacters"] = result.Output.Length.ToString(CultureInfo.InvariantCulture) });
                        verificationRepairRequired = result.ExitCode != 0 || result.TimedOut;
                        var repairInstruction = verificationRepairRequired
                            ? "The verification failed. Do not rerun it unchanged; compare exact expected and actual values, then make the smallest targeted correction before trying again."
                            : "The verification passed. You may provide your final summary.";
                        messages.Add(new ChatMessage("user", $"COMMAND RESULT (exit {result.ExitCode}, timed out: {result.TimedOut}):\n{result.Output}\n\n{repairInstruction}"));
                        break;
                    }
                    default:
                        throw new InvalidOperationException("The local model returned an unsupported coding-agent action. Ask it again with one valid JSON action.");
                }
                if (ollamaMessages is not null && nativeCall is not null)
                {
                    if (!string.Equals(actionName, "done", StringComparison.Ordinal))
                    {
                        var toolResult = messages[^1].Content;
                        ollamaMessages.Add(new OllamaToolChatMessage("tool", toolResult, Name: nativeCall.Name, ToolCallId: nativeCall.Id ?? $"call_{step}"));
                    }
                }
                if (string.Equals(actionName, "done", StringComparison.Ordinal)) break;
            }
            if (string.IsNullOrWhiteSpace(summary)) throw new InvalidOperationException("The local model did not return a final summary.");
            var labels = changedFiles.Count == 0 ? new[] { "local-model-response" } : changedFiles.ToArray();
            return new AgentTaskExecutionResult(NormalizeTaskSummary(summary), labels);
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

    private static string NormalizeTaskSummary(string summary)
    {
        var normalized = Regex.Replace(string.Concat(summary.Trim().Select(character => char.IsControl(character) ? ' ' : character)), @"\s+", " ").Trim();
        if (normalized.Length == 0) throw new InvalidOperationException("The local model returned an empty final summary.");
        return normalized.Length <= 4_000 ? normalized : normalized[..4_000].TrimEnd();
    }

    private static IReadOnlyList<object> CreateCodingTools()
    {
        static object Property(object type, string description) => new { type, description };
        static object Tool(string name, string description, Dictionary<string, object> properties, params string[] required) => new
        {
            type = "function",
            function = new
            {
                name,
                description,
                parameters = new { type = "object", properties, required },
            },
        };

        return
        [
            Tool("read_file", "Read a project text file before editing it.", new Dictionary<string, object>
            {
                ["path"] = Property("string", "Workspace-relative file path."),
            }, "path"),
            Tool("write_file", "Create or replace a complete text file using the SHA-256 from read_file, or null only when creating a new file.", new Dictionary<string, object>
            {
                ["path"] = Property("string", "Workspace-relative file path."),
                ["content"] = Property("string", "Complete file contents."),
                ["expectedHash"] = Property(new[] { "string", "null" }, "Current SHA-256 from read_file; null only for a new file."),
            }, "path", "content", "expectedHash"),
            Tool("replace_text", "Replace one exact, unique substring in a file using the latest SHA-256.", new Dictionary<string, object>
            {
                ["path"] = Property("string", "Workspace-relative file path."),
                ["find"] = Property("string", "Exact non-empty substring occurring once."),
                ["replacement"] = Property("string", "Replacement text."),
                ["expectedHash"] = Property("string", "Current SHA-256 from read_file or the latest edit result."),
            }, "path", "find", "replacement", "expectedHash"),
            Tool("run_command", "Run a bounded verification command in the selected workspace.", new Dictionary<string, object>
            {
                ["command"] = Property("string", "Command to execute."),
                ["cwd"] = Property("string", "Workspace-relative working directory, usually ."),
            }, "command"),
            Tool("done", "Finish after all requested changes and verification are complete.", new Dictionary<string, object>
            {
                ["summary"] = Property("string", "Concise summary of changes and verification."),
            }, "summary"),
        ];
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
        if (json.StartsWith("```", StringComparison.Ordinal))
        {
            var openingLineEnd = json.IndexOf('\n');
            var closingFence = json.LastIndexOf("```", StringComparison.Ordinal);
            if (openingLineEnd < 0 || closingFence <= openingLineEnd)
                throw new JsonException("The coding agent returned an incomplete JSON code fence.");

            var language = json[3..openingLineEnd].Trim();
            if (language.Length > 0 && !language.Equals("json", StringComparison.OrdinalIgnoreCase))
                throw new JsonException("The coding agent fenced its action with an unsupported language label.");
            json = json[(openingLineEnd + 1)..closingFence].Trim();
        }

        var objectStart = json.IndexOf('{');
        if (objectStart < 0) throw new JsonException("The coding agent did not return a JSON object.");

        var depth = 0;
        var inString = false;
        var escaped = false;
        for (var index = objectStart; index < json.Length; index++)
        {
            var character = json[index];
            if (inString)
            {
                if (escaped) escaped = false;
                else if (character == '\\') escaped = true;
                else if (character == '"') inString = false;
                continue;
            }

            if (character == '"') inString = true;
            else if (character == '{') depth++;
            else if (character == '}' && --depth == 0) return json[objectStart..(index + 1)];
        }

        throw new JsonException("The coding agent returned an incomplete JSON object.");
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
