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
    private const int ProtocolVersion = 1;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly Dictionary<string, ActiveTaskExecution> ActiveTaskExecutions = new(StringComparer.Ordinal);
    private static readonly object ActiveTaskExecutionsGate = new();
    private static readonly object LocalExecutionGate = new();
    private static int LocalAdmittedTaskCount;
    private static readonly object RuntimeCapacityGate = new();
    private static RuntimeCapacitySnapshot? CachedRuntimeCapacity;
    private static readonly Dictionary<string, WorkspaceTerminalSession> TerminalSessions = new(StringComparer.Ordinal);
    private static readonly object TerminalSessionsGate = new();
    private static readonly Dictionary<string, ModelPullOperation> ModelPulls = new(StringComparer.Ordinal);
    private static readonly object ModelPullsGate = new();
    private static readonly Dictionary<string, AirLlmInstallOperation> AirLlmInstalls = new(StringComparer.Ordinal);
    private static readonly object AirLlmInstallsGate = new();
    private static readonly Dictionary<string, ImageRuntimeInstallOperation> ImageRuntimeInstalls = new(StringComparer.Ordinal);
    private static readonly object ImageRuntimeInstallsGate = new();
    private static readonly object PersonaConversationRetentionGate = new();
    private static readonly Dictionary<string, ImageGenerationOperation> ImageGenerations = new(StringComparer.Ordinal);
    private static readonly object ImageGenerationsGate = new();
    private static readonly Dictionary<string, MarketplaceDownloadOperation> MarketplaceDownloads = new(StringComparer.Ordinal);
    private static readonly object MarketplaceDownloadsGate = new();
    private static readonly McpConnectionRegistry McpConnections = CreateMcpConnectionRegistry();
    private static readonly Dictionary<string, IMcpClient> ActiveMcpClients = new(StringComparer.Ordinal);
    private static readonly Dictionary<string, IReadOnlyList<McpToolDescriptor>> ActiveMcpTools = new(StringComparer.Ordinal);
    private static readonly object McpClientsGate = new();
    private static readonly object TaskJournalGate = new();
    private static readonly Lazy<OperationJournal> TaskJournal = new(CreateTaskOperationJournal);

    public static async Task RunAsync(Stream input, Stream output, CancellationToken cancellationToken = default)
    {
        using var hostCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        if (!bool.TryParse(Environment.GetEnvironmentVariable("SKAI_SKIP_LEGACY_DATA_MIGRATION"), out var skipLegacyMigration) || !skipLegacyMigration)
            LegacyDataMigration.MigrateLocalData();
        using var reader = new StreamReader(input);
        await using var writer = new StreamWriter(output) { AutoFlush = true };
        using var voice = new OsNativeTtsService();
        // A process can exit after a task has been claimed but before its
        // durable result is written. Reconcile that state before advertising
        // the host as ready; never silently resume or re-run local work.
        var interruptedTasks = CreateTaskStore().ReconcileAfterRestart();
        lock (TaskJournalGate)
            foreach (var task in interruptedTasks) TaskJournal.Value.ReconcileRunAfterRestart(task.Id);
        var scheduledDispatcher = Task.Run(() => RunScheduledDispatcherAsync(hostCancellation.Token), hostCancellation.Token);
        CleanupExpiredPersonaConversations();
        var personaConversationCleanup = Task.Run(() => RunPersonaConversationCleanupAsync(hostCancellation.Token), hostCancellation.Token);

        try
        {
            // Model-bound requests (a persona reply on CPU can take minutes) run in the background so
            // quick requests keep being answered meanwhile. Electron treats a quick request that waits
            // 30 seconds as a hung host and restarts it, which used to kill the reply in progress.
            using var writeGate = new SemaphoreSlim(1, 1);
            async Task WriteResponseAsync(AgentResponse response)
            {
                var json = JsonSerializer.Serialize(response, JsonOptions);
                await writeGate.WaitAsync(CancellationToken.None).ConfigureAwait(false);
                try { await writer.WriteLineAsync(json).ConfigureAwait(false); }
                finally { writeGate.Release(); }
            }
            AgentResponse HandleSafely(AgentRequest request)
            {
                try { return Handle(request, voice); }
                catch (Exception ex) { return new(ProtocolVersion, request.Id, false, Error: new("REQUEST_FAILED", ex.Message)); }
            }
            while (!hostCancellation.IsCancellationRequested)
            {
                var line = await reader.ReadLineAsync(hostCancellation.Token);
                if (line is null) break;
                if (string.IsNullOrWhiteSpace(line)) continue;

                AgentRequest request;
                try
                {
                    request = JsonSerializer.Deserialize<AgentRequest>(line, JsonOptions) ?? throw new InvalidOperationException("Request body was empty.");
                }
                catch (JsonException ex)
                {
                    await WriteResponseAsync(new(ProtocolVersion, string.Empty, false, Error: new("INVALID_JSON", ex.Message)));
                    continue;
                }
                catch (Exception ex)
                {
                    await WriteResponseAsync(new(ProtocolVersion, string.Empty, false, Error: new("REQUEST_FAILED", ex.Message)));
                    continue;
                }

                if (RunsInBackground(request.Method))
                {
                    _ = Task.Run(async () => await WriteResponseAsync(HandleSafely(request)).ConfigureAwait(false), CancellationToken.None);
                    continue;
                }
                await WriteResponseAsync(HandleSafely(request));
            }
        }
        catch (OperationCanceledException) when (hostCancellation.IsCancellationRequested)
        {
            // Normal shutdown; the dispatcher is cancelled below.
        }
        finally
        {
            hostCancellation.Cancel();
            try { await scheduledDispatcher.ConfigureAwait(false); }
            catch (OperationCanceledException) when (hostCancellation.IsCancellationRequested) { }
            try { await personaConversationCleanup.ConfigureAwait(false); }
            catch (OperationCanceledException) when (hostCancellation.IsCancellationRequested) { }
        }
        await DisposeTerminalSessionsAsync().ConfigureAwait(false);
        await DisposeMcpClientsAsync().ConfigureAwait(false);
    }

    private static async Task RunPersonaConversationCleanupAsync(CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        while (await timer.WaitForNextTickAsync(cancellationToken).ConfigureAwait(false))
            CleanupExpiredPersonaConversations();
    }

    private static void CleanupExpiredPersonaConversations()
    {
        lock (PersonaConversationRetentionGate)
        {
            var settings = CreateSettingsStore().Load();
            var retentionMinutes = Math.Clamp(settings.PersonaConversationRetentionMinutes, 15, 10_080);
            var expiresBefore = DateTimeOffset.UtcNow.AddMinutes(-retentionMinutes);
            var store = CreateConversationStore();
            var sessions = store.Load();
            var remaining = sessions.Where(session =>
                !(session.PersonaId is not null || session.IsPersonaGroup)
                || session.UpdatedAt > expiresBefore).ToList();
            if (remaining.Count != sessions.Count) store.Save(remaining);
        }
    }

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

    private static AgentResponse GetLocalCapacity(AgentRequest request)
    {
        var snapshot = new LocalCapacityProbe().GetSnapshotAsync().GetAwaiter().GetResult();
        var tasks = CreateTaskStore().Load();
        var settings = CreateSettingsStore().Load();
        var runtime = ReadRuntimeCapacity(settings, AirLlmProvider.IsAirLlmProvider(settings.ModelProvider));
        var decision = LocalExecutionCapacityPolicy.Decide(snapshot, settings.LocalRamBudgetBytes, settings.LocalGpuBudgetBytes, airLlmAvailable: runtime.AirLlmReady == true, loadedRamBytes: runtime.LoadedRamBytes, loadedGpuBytes: runtime.LoadedGpuBytes);
        int activeTaskCount;
        lock (LocalExecutionGate) activeTaskCount = LocalAdmittedTaskCount;
        var queuedTaskCount = tasks.Count(task => task.Status == AgentTaskStatuses.Queued);
        return new(ProtocolVersion, request.Id, true, new
        {
            snapshot.CapturedAtUtc,
            snapshot.RamTotalBytes,
            snapshot.RamAvailableBytes,
            snapshot.CpuUtilizationPercent,
            snapshot.Gpu,
            snapshot.MeasurementNote,
            scheduler = new { activeTaskCount, queuedTaskCount, executionSlotLimit = decision.SlotLimit, limitingResource = decision.LimitingResource },
            runtime = new { loadedModelsKnown = runtime.LoadedModelsKnown, loadedModels = runtime.LoadedModels, loadedRamBytes = runtime.LoadedRamBytes, loadedGpuBytes = runtime.LoadedGpuBytes, loadedModelNote = runtime.LoadedModelNote, airLlmReady = runtime.AirLlmReady },
        });
    }

    private static AgentResponse GetAirLlmStatus(AgentRequest request)
    {
        var settings = CreateSettingsStore().Load();
        var status = new AirLlmProvider().GetRuntimeStatus(settings);
        return new(ProtocolVersion, request.Id, true, status);
    }

    private static AgentResponse StartAirLlmInstall(AgentRequest request)
    {
        lock (AirLlmInstallsGate)
        {
            if (AirLlmInstalls.Values.Any(operation => operation.State == "running"))
                throw new InvalidOperationException("AirLLM setup is already running.");
            var operation = new AirLlmInstallOperation(Guid.NewGuid().ToString("N"), new CancellationTokenSource());
            AirLlmInstalls[operation.Id] = operation;
            _ = Task.Run(async () =>
            {
                try
                {
                    await new AirLlmRuntimeInstaller().InstallAsync(operation.AddProgress, operation.Cancellation.Token).ConfigureAwait(false);
                    operation.Complete();
                }
                catch (OperationCanceledException) when (operation.Cancellation.IsCancellationRequested) { operation.Cancelled(); }
                catch (Exception error) { operation.Fail(error.Message); }
            });
            return AirLlmInstallResponse(request, operation);
        }
    }

    private static AgentResponse GetAirLlmInstallStatus(AgentRequest request)
    {
        var id = RequiredBoundedString(request, "id", 64);
        lock (AirLlmInstallsGate)
            return AirLlmInstalls.TryGetValue(id, out var operation)
                ? AirLlmInstallResponse(request, operation)
                : throw new KeyNotFoundException("The AirLLM setup session no longer exists.");
    }

    private static AgentResponse CancelAirLlmInstall(AgentRequest request)
    {
        var id = RequiredBoundedString(request, "id", 64);
        lock (AirLlmInstallsGate)
        {
            if (!AirLlmInstalls.TryGetValue(id, out var operation)) throw new KeyNotFoundException("The AirLLM setup session no longer exists.");
            if (operation.State == "running") operation.Cancellation.Cancel();
            return AirLlmInstallResponse(request, operation);
        }
    }

    private static AgentResponse AirLlmInstallResponse(AgentRequest request, AirLlmInstallOperation operation) => new(ProtocolVersion, request.Id, true, new
    {
        id = operation.Id,
        status = operation.State,
        progress = operation.Progress.ToArray(),
        error = operation.Error,
    });

    private static AgentResponse GetImageRuntimeStatus(AgentRequest request) =>
        new(ProtocolVersion, request.Id, true, new DiffusersImageProvider().GetRuntimeStatus());

    private static AgentResponse StartImageRuntimeInstall(AgentRequest request)
    {
        lock (ImageRuntimeInstallsGate)
        {
            if (ImageRuntimeInstalls.Values.Any(operation => operation.State == "running"))
                throw new InvalidOperationException("The optional image runtime setup is already running.");
            var operation = new ImageRuntimeInstallOperation(Guid.NewGuid().ToString("N"), new CancellationTokenSource());
            ImageRuntimeInstalls[operation.Id] = operation;
            _ = Task.Run(async () =>
            {
                try
                {
                    await new DiffusersImageProvider().InstallRuntimeAsync(operation.AddProgress, operation.Cancellation.Token).ConfigureAwait(false);
                    operation.Complete();
                }
                catch (OperationCanceledException) when (operation.Cancellation.IsCancellationRequested) { operation.Cancelled(); }
                catch (Exception error) { operation.Fail(error.Message); }
            });
            return ImageRuntimeInstallResponse(request, operation);
        }
    }

    private static AgentResponse GetImageRuntimeInstallStatus(AgentRequest request)
    {
        var id = RequiredBoundedString(request, "id", 64);
        lock (ImageRuntimeInstallsGate)
            return ImageRuntimeInstalls.TryGetValue(id, out var operation)
                ? ImageRuntimeInstallResponse(request, operation)
                : throw new KeyNotFoundException("The image runtime setup session no longer exists.");
    }

    private static AgentResponse CancelImageRuntimeInstall(AgentRequest request)
    {
        var id = RequiredBoundedString(request, "id", 64);
        lock (ImageRuntimeInstallsGate)
        {
            if (!ImageRuntimeInstalls.TryGetValue(id, out var operation)) throw new KeyNotFoundException("The image runtime setup session no longer exists.");
            if (operation.State == "running") operation.Cancellation.Cancel();
            return ImageRuntimeInstallResponse(request, operation);
        }
    }

    private static AgentResponse ImageRuntimeInstallResponse(AgentRequest request, ImageRuntimeInstallOperation operation) => new(ProtocolVersion, request.Id, true, new
    {
        id = operation.Id,
        status = operation.State,
        progress = operation.Progress.ToArray(),
        error = operation.Error,
    });

    private static AgentResponse ListVoiceModels(AgentRequest request) =>
        new(ProtocolVersion, request.Id, true, new
        {
            models = VoiceModelCatalog.All.Select(model => new
            {
                id = model.Id,
                name = model.Name,
                detail = model.Description,
                size = model.Size,
                installed = model.IsInstalled,
                lowResource = model.IsLowResource,
                adapterAvailable = model.AdapterAvailable,
                supportsStreaming = model.SupportsStreaming,
                supportsVoiceCloning = model.SupportsVoiceCloning,
                supportsEmotion = model.SupportsEmotion,
                supportsAudioEffects = model.SupportsAudioEffects,
                availabilityNote = model.AvailabilityNote,
            }).ToArray(),
        });

    private static AgentResponse SpeakVoice(AgentRequest request, OsNativeTtsService voice)
    {
        var text = RequiredSpeechText(request, "text", 4_000);
        var rate = OptionalDouble(request, "rate") ?? 1;
        if (rate is < 0.5 or > 2) throw new InvalidOperationException("rate must be between 0.5 and 2.");
        if (OptionalString(request, "provider")?.Equals("elevenlabs", StringComparison.OrdinalIgnoreCase) == true)
        {
            var apiKey = RequiredBoundedString(request, "apiKey", 512);
            var voiceId = RequiredBoundedString(request, "voiceId", 128);
            var endpoint = RequiredBoundedString(request, "endpoint", 2_000);
            var audio = CloudVoiceService.SynthesizeAsync(endpoint, voiceId, apiKey, text, rate).GetAwaiter().GetResult();
            return new(ProtocolVersion, request.Id, true, new { spoken = true, engine = "elevenlabs-cloud", interruptible = true, audioDataUrl = audio });
        }
        var engine = voice.Speak(text, rate);
        return new(ProtocolVersion, request.Id, true, new { spoken = true, engine, interruptible = true });
    }

    private static AgentResponse StopVoice(AgentRequest request, OsNativeTtsService voice)
    {
        voice.Stop();
        return new(ProtocolVersion, request.Id, true, new { stopped = true });
    }

    private static AgentResponse ListModels(AgentRequest request)
    {
        var endpoint = RequiredLocalEndpoint(request, "endpoint", 2_000);
        var provider = new OpenAiCompatibleProvider();
        IReadOnlyList<ProviderModelDescriptor> profiles;
        try
        {
            profiles = provider.DiscoverModelProfilesAsync(endpoint, CancellationToken.None, OptionalString(request, "apiKey"))
                .GetAwaiter().GetResult();
        }
        catch (Exception exception) when (exception is HttpRequestException or InvalidOperationException or TaskCanceledException)
        {
            // A slow or unavailable selected endpoint must not hide models found in
            // other installed runtimes or the local Hugging Face cache.
            profiles = Array.Empty<ProviderModelDescriptor>();
        }
        var providerId = OptionalString(request, "provider")?.Trim();
        if (string.IsNullOrWhiteSpace(providerId)) providerId = CreateSettingsStore().Load().ModelProvider;
        var inventory = new ModelLibraryService().DiscoverLocalModelsAsync(endpoint).GetAwaiter().GetResult();
        return new(ProtocolVersion, request.Id, true, inventory.Select(model =>
        {
            var profile = model.Endpoint.Equals(endpoint, StringComparison.OrdinalIgnoreCase)
                ? profiles.FirstOrDefault(item => item.Model.Equals(model.Model, StringComparison.OrdinalIgnoreCase))
                : null;
            return new
            {
                model = model.Model,
                displayName = model.DisplayName,
                vision = profile?.Vision.ToString() ?? "unknown",
                capabilities = profile?.Capabilities ?? Array.Empty<string>(),
                provider = model.Provider == "Current local endpoint" ? providerId : model.Provider,
                endpoint = model.Provider == "AirLLM" ? null : model.Endpoint,
                sizeBytes = model.SizeBytes,
                contextLength = model.ContextLength,
                isLoaded = model.IsLoaded,
            };
        }).ToArray());
    }

    private static AgentResponse StartModelPull(AgentRequest request)
    {
        var endpoint = RequiredLocalEndpoint(request, "endpoint", 2_000);
        var model = RequiredBoundedString(request, "model", 512);
        var operation = new ModelPullOperation(Guid.NewGuid().ToString("N"), model, new CancellationTokenSource());
        lock (ModelPullsGate)
        {
            if (ModelPulls.Values.Any(item => item.Model.Equals(model, StringComparison.OrdinalIgnoreCase) && item.State == "running"))
                throw new InvalidOperationException("This model is already being downloaded locally.");
            ModelPulls[operation.Id] = operation;
        }
        _ = Task.Run(async () =>
        {
            try
            {
                await new ModelLibraryService().PullOllamaAsync(endpoint, model, message => operation.AddProgress(message), operation.Cancellation.Token).ConfigureAwait(false);
                operation.Complete();
            }
            catch (OperationCanceledException) when (operation.Cancellation.IsCancellationRequested) { operation.Cancelled(); }
            catch (Exception error) { operation.Fail(error.Message); }
        });
        return ModelPullResponse(request, operation);
    }

    private static AgentResponse GetModelPullStatus(AgentRequest request)
    {
        var id = RequiredBoundedString(request, "id", 64);
        lock (ModelPullsGate)
        {
            return ModelPulls.TryGetValue(id, out var operation)
                ? ModelPullResponse(request, operation)
                : throw new KeyNotFoundException("The local model download no longer exists.");
        }
    }

    private static AgentResponse CancelModelPull(AgentRequest request)
    {
        var id = RequiredBoundedString(request, "id", 64);
        lock (ModelPullsGate)
        {
            if (!ModelPulls.TryGetValue(id, out var operation)) throw new KeyNotFoundException("The local model download no longer exists.");
            operation.Cancellation.Cancel();
            return ModelPullResponse(request, operation);
        }
    }

    private static AgentResponse ModelPullResponse(AgentRequest request, ModelPullOperation operation) => new(ProtocolVersion, request.Id, true, new
    {
        id = operation.Id,
        model = operation.Model,
        provider = "Ollama",
        status = operation.State,
        progress = operation.Progress.ToArray(),
        error = operation.Error,
    });

    private static AgentResponse ListProjects(AgentRequest request)
    {
        var projects = CreateProjectStore().Load()
            .OrderByDescending(project => project.UpdatedAt)
            .Select(project => new
            {
                id = project.Id,
                name = project.Name,
                instructions = project.Instructions,
                folderPaths = project.FolderPaths,
                gitHubRepository = project.GitHubRepository,
                updatedAt = project.UpdatedAt,
            })
            .ToArray();
        return new(ProtocolVersion, request.Id, true, projects);
    }

    private static AgentResponse RunProjectPreflight(AgentRequest request)
    {
        var id = RequiredBoundedString(request, "id", 128);
        var project = CreateProjectStore().Load().SingleOrDefault(item => item.Id == id)
            ?? throw new InvalidOperationException("The selected local project is no longer available.");
        var report = new ProjectPreflightService().Inspect(project.FolderPaths);
        return new(ProtocolVersion, request.Id, true, new
        {
            projectId = project.Id,
            projectName = project.Name,
            inspectedAt = DateTimeOffset.UtcNow,
            manifests = report.Manifests,
            runtimes = report.Runtimes,
            suggestedChecks = report.SuggestedChecks,
            executionNote = "Read-only scan only. Suggested checks have not been run; choose and review a command explicitly before execution."
        });
    }

    private static AgentResponse ListScheduledTasks(AgentRequest request)
    {
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
                status = task.Status,
                outcome = task.Outcome,
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
        var task = CreateScheduledTaskStore().Schedule(
            RequiredBoundedString(request, "prompt", ScheduledTaskStore.MaxPromptCharacters),
            dueAt.ToUniversalTime(),
            OptionalString(request, "workspaceMode") ?? WorkspaceModes.Chat,
            repeatEveryMinutes: repeat,
            conversationId: conversationId);
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
            status = task.Status,
            outcome = task.Outcome,
        });

    private static AgentResponse ListMemory(AgentRequest request) =>
        new(ProtocolVersion, request.Id, true, CreateMemoryStore().Load());

    private static AgentResponse SearchMemory(AgentRequest request) =>
        new(ProtocolVersion, request.Id, true, CreateMemoryStore().Search(OptionalString(request, "query"), OptionalString(request, "scope")));

    private static AgentResponse SaveMemory(AgentRequest request)
    {
        var store = CreateMemoryStore();
        var content = RequiredBoundedString(request, "content", MemoryStore.MaxContentCharacters);
        var scope = RequiredBoundedString(request, "scope", 128);
        var source = RequiredBoundedString(request, "source", 256);
        var approvalId = RequiredBoundedString(request, "approvalId", 128);
        var tags = OptionalStringList(request, "tags", MemoryStore.MaxTags, 64);
        var id = OptionalString(request, "id");
        var entry = string.IsNullOrWhiteSpace(id)
            ? store.Add(content, scope, source, approvalId, tags)
            : store.Update(id, content, scope, source, approvalId, tags);
        return new(ProtocolVersion, request.Id, true, entry);
    }

    private static AgentResponse RemoveMemory(AgentRequest request)
    {
        CreateMemoryStore().Remove(RequiredBoundedString(request, "id", 128));
        return new(ProtocolVersion, request.Id, true, new { removed = true });
    }

    private static AgentResponse SetMemoryEnabled(AgentRequest request)
    {
        var id = RequiredBoundedString(request, "id", 128);
        if (request.Params?.TryGetProperty("enabled", out var enabled) != true || enabled.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
            throw new InvalidOperationException("memory.enabled requires a boolean enabled value.");
        CreateMemoryStore().SetEnabled(id, enabled.GetBoolean());
        return new(ProtocolVersion, request.Id, true, new { id, enabled = enabled.GetBoolean() });
    }

    private static AgentResponse ExportMemory(AgentRequest request) =>
        new(ProtocolVersion, request.Id, true, new { fileName = "skai-memory-backup.json", json = CreateMemoryStore().ExportJson() });

    private static AgentResponse ListCorpus(AgentRequest request) =>
        new(ProtocolVersion, request.Id, true, CreateCorpusStore().Load());

    private static AgentResponse SearchCorpus(AgentRequest request) =>
        new(ProtocolVersion, request.Id, true, CreateCorpusStore().Search(OptionalString(request, "query"), OptionalInt(request, "limit") ?? 12));

    private static AgentResponse UpsertCorpus(AgentRequest request)
    {
        var store = CreateCorpusStore();
        var document = store.Upsert(OptionalString(request, "id"), RequiredBoundedString(request, "title", DocumentCorpusStore.MaxTitleCharacters), RequiredBoundedString(request, "source", DocumentCorpusStore.MaxSourceCharacters), RequiredBoundedString(request, "content", DocumentCorpusStore.MaxContentCharacters), OptionalStringList(request, "tags", 16, 64));
        return new(ProtocolVersion, request.Id, true, document);
    }

    private static AgentResponse RemoveCorpus(AgentRequest request)
    {
        CreateCorpusStore().Remove(RequiredBoundedString(request, "id", 128));
        return new(ProtocolVersion, request.Id, true, new { removed = true });
    }

    /// <summary>Requests that wait on a model or long network research, answered off the request loop.</summary>
    internal static bool RunsInBackground(string method) => method is "chat.complete" or "persona.group.complete" or "persona.discover"
        or "persona.research" or "persona.research.force" or "persona.draft" or "image.generate" or "marketplace.models.search";

    private static JsonSettingsStore CreateSettingsStore() =>
        new(Environment.GetEnvironmentVariable("SRAI_SETTINGS_PATH"));

    private static ScheduledTaskStore CreateScheduledTaskStore() =>
        new(Environment.GetEnvironmentVariable("SRAI_SCHEDULED_TASKS_PATH"));

    private static ProjectStore CreateProjectStore() =>
        new(Environment.GetEnvironmentVariable("SRAI_PROJECTS_PATH"));

    private static WorkspaceUndoStore CreateUndoStore() =>
        new(Environment.GetEnvironmentVariable("SRAI_UNDO_PATH"));

    private static AgentTaskArtifactStore CreateTaskStore() =>
        new(Environment.GetEnvironmentVariable("SRAI_TASKS_PATH"));
}
