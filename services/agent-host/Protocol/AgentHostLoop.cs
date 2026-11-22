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

    private sealed class ModelPullOperation(string id, string model, CancellationTokenSource cancellation)
    {
        private readonly object gate = new();
        public string Id { get; } = id;
        public string Model { get; } = model;
        public CancellationTokenSource Cancellation { get; } = cancellation;
        public string State { get; private set; } = "running";
        public string? Error { get; private set; }
        public List<string> Progress { get; } = [];
        public void AddProgress(string? message) { if (!string.IsNullOrWhiteSpace(message)) lock (gate) { if (Progress.Count < 64) Progress.Add(message[..Math.Min(message.Length, 240)]); } }
        public void Complete() { lock (gate) State = "completed"; }
        public void Cancelled() { lock (gate) State = "cancelled"; }
        public void Fail(string message) { lock (gate) { State = "failed"; Error = string.IsNullOrWhiteSpace(message) ? "Local model download failed." : message[..Math.Min(message.Length, 400)]; } }
    }

    private sealed class AirLlmInstallOperation(string id, CancellationTokenSource cancellation)
    {
        private readonly object gate = new();
        public string Id { get; } = id;
        public CancellationTokenSource Cancellation { get; } = cancellation;
        public string State { get; private set; } = "running";
        public string? Error { get; private set; }
        public List<string> Progress { get; } = [];
        public void AddProgress(string? message) { if (!string.IsNullOrWhiteSpace(message)) lock (gate) { if (Progress.Count < 96) Progress.Add(message[..Math.Min(message.Length, 240)]); } }
        public void Complete() { lock (gate) State = "completed"; }
        public void Cancelled() { lock (gate) State = "cancelled"; }
        public void Fail(string message) { lock (gate) { State = "failed"; Error = string.IsNullOrWhiteSpace(message) ? "AirLLM setup failed." : message[..Math.Min(message.Length, 400)]; } }
    }

    private sealed class ImageRuntimeInstallOperation(string id, CancellationTokenSource cancellation)
    {
        private readonly object gate = new();
        public string Id { get; } = id;
        public CancellationTokenSource Cancellation { get; } = cancellation;
        public string State { get; private set; } = "running";
        public string? Error { get; private set; }
        public List<string> Progress { get; } = [];
        public void AddProgress(string? message) { if (!string.IsNullOrWhiteSpace(message)) lock (gate) { if (Progress.Count < 96) Progress.Add(message[..Math.Min(message.Length, 240)]); } }
        public void Complete() { lock (gate) State = "completed"; }
        public void Cancelled() { lock (gate) State = "cancelled"; }
        public void Fail(string message) { lock (gate) { State = "failed"; Error = string.IsNullOrWhiteSpace(message) ? "Image runtime setup failed." : message[..Math.Min(message.Length, 400)]; } }
    }

    private sealed class ImageGenerationOperation(string id, CancellationTokenSource cancellation)
    {
        private readonly object gate = new();
        private readonly List<string> progress = [];
        public string Id { get; } = id;
        public CancellationTokenSource Cancellation { get; } = cancellation;
        public string State { get; private set; } = "running";
        public string? Error { get; private set; }
        public object? Images { get; private set; }
        public IReadOnlyList<string> Progress { get { lock (gate) return progress.ToArray(); } }
        public void AddProgress(string message) { if (string.IsNullOrWhiteSpace(message)) return; lock (gate) { if (progress.Count < 120) progress.Add(message.Length > 400 ? message[..400] : message); } }
        public void Complete(object? result) { lock (gate) { if (State != "running") return; var element = JsonSerializer.SerializeToElement(result); Images = element.TryGetProperty("images", out var images) ? images : result; State = "completed"; } }
        public void Cancelled() { lock (gate) { if (State == "running") State = "cancelled"; } }
        public void Fail(string message) { lock (gate) { if (State != "running") return; State = "failed"; Error = string.IsNullOrWhiteSpace(message) ? "Image generation failed." : message[..Math.Min(message.Length, 400)]; } }
    }

    private sealed class MarketplaceDownloadOperation(string id, string source, string repository, CancellationTokenSource cancellation)
    {
        private readonly object gate = new();
        public string Id { get; } = id;
        public string Source { get; } = source;
        public string Repository { get; } = repository;
        public CancellationTokenSource Cancellation { get; } = cancellation;
        public string State { get; private set; } = "running";
        public string? Error { get; private set; }
        public List<string> Progress { get; } = [];
        public void AddProgress(string? message) { if (!string.IsNullOrWhiteSpace(message)) lock (gate) { if (Progress.Count < 128) Progress.Add(message[..Math.Min(message.Length, 240)]); } }
        public void Complete() { lock (gate) State = "completed"; }
        public void Cancelled() { lock (gate) State = "cancelled"; }
        public void Fail(string message) { lock (gate) { State = "failed"; Error = string.IsNullOrWhiteSpace(message) ? "Marketplace model download failed." : message[..Math.Min(message.Length, 400)]; } }
    }

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

    private static AgentResponse GetUserProfile(AgentRequest request)
    {
        var settings = CreateSettingsStore().Load();
        return new(ProtocolVersion, request.Id, true, new { name = settings.UserName, gender = settings.UserGender, age = settings.UserAge > 0 ? settings.UserAge : (int?)null });
    }

    /// <summary>Saves the optional "About you" details. Every field may be blank; age must be 1–120 when given.</summary>
    private static AgentResponse SaveUserProfile(AgentRequest request)
    {
        var store = CreateSettingsStore();
        var settings = store.Load();
        settings.UserName = ModelInstructions.CleanProfileValue(OptionalString(request, "name"), 60);
        settings.UserGender = ModelInstructions.CleanProfileValue(OptionalString(request, "gender"), 40);
        var age = OptionalInt(request, "age") ?? 0;
        if (age is < 0 or > 120) throw new InvalidOperationException("Age must be between 1 and 120, or left blank.");
        settings.UserAge = age;
        store.Save(settings);
        return GetUserProfile(request);
    }

    private static AgentResponse GetSettings(AgentRequest request)
    {
        var settings = CreateSettingsStore().Load();
        return new(ProtocolVersion, request.Id, true, new
        {
            // A settings file may have been written by the legacy surface before
            // the local-only policy was introduced. Never echo that stale value
            // back into the Electron runtime as an apparent usable route.
            endpoint = LocalEndpoint.IsLocal(settings.Endpoint) ? settings.Endpoint : "http://localhost:11434/v1",
            model = settings.Model,
            provider = settings.ModelProvider,
            ollamaContextWindowTokens = settings.OllamaContextWindowTokens,
            localRamBudgetBytes = settings.LocalRamBudgetBytes,
            localGpuBudgetBytes = settings.LocalGpuBudgetBytes,
            themeMode = settings.ThemeMode,
            accentColor = settings.AccentColor,
            interfaceDensity = settings.InterfaceDensity,
            backdropPreset = settings.BackdropPreset,
            reduceMotion = settings.ReduceMotion,
            developerMode = settings.DeveloperMode,
            memoryInjectionEnabled = settings.MemoryInjectionEnabled,
            smartPromptRewritingEnabled = settings.SmartPromptRewritingEnabled,
            personaConversationRetentionMinutes = settings.PersonaConversationRetentionMinutes,
        });
    }

    private static AgentResponse SaveSettings(AgentRequest request)
    {
        var store = CreateSettingsStore();
        var settings = store.Load();
        settings.Endpoint = RequiredLocalEndpoint(request, "endpoint", 2_000);
        settings.Model = RequiredBoundedString(request, "model", 256);
        if (request.Params is { } parameters)
        {
            if (parameters.TryGetProperty("provider", out var provider) && provider.ValueKind == JsonValueKind.String)
            {
                var requestedProvider = provider.GetString();
                if (!string.IsNullOrWhiteSpace(requestedProvider))
                {
                    if (requestedProvider.Length > 128 || requestedProvider.Any(char.IsControl))
                        throw new InvalidOperationException("provider exceeds the safety limit.");
                    settings.ModelProvider = requestedProvider.Trim();
                }
            }
            if (parameters.TryGetProperty("ollamaContextWindowTokens", out var contextWindow) && contextWindow.TryGetInt32(out var contextTokens))
            {
                if (contextTokens is not (0 or 32_768 or 131_072 or 1_048_576))
                    throw new InvalidOperationException("The Ollama context window must be Auto, 32K, 128K, or 1M tokens.");
                settings.OllamaContextWindowTokens = contextTokens;
            }
            if (parameters.TryGetProperty("localRamBudgetBytes", out var ramBudget) && ramBudget.TryGetInt64(out var ramBytes))
            {
                if (ramBytes is < 0 or > (1L << 50)) throw new InvalidOperationException("The RAM budget must be between 0 and 1024 GiB.");
                settings.LocalRamBudgetBytes = ramBytes;
            }
            if (parameters.TryGetProperty("localGpuBudgetBytes", out var gpuBudget) && gpuBudget.TryGetInt64(out var gpuBytes))
            {
                if (gpuBytes is < 0 or > (1L << 50)) throw new InvalidOperationException("The VRAM budget must be between 0 and 1024 GiB.");
                settings.LocalGpuBudgetBytes = gpuBytes;
            }
            if (parameters.TryGetProperty("themeMode", out var theme) && theme.ValueKind == JsonValueKind.String)
                settings.ThemeMode = theme.GetString() ?? settings.ThemeMode;
            if (parameters.TryGetProperty("accentColor", out var accent) && accent.ValueKind == JsonValueKind.String)
                settings.AccentColor = accent.GetString() ?? settings.AccentColor;
            if (parameters.TryGetProperty("interfaceDensity", out var density) && density.ValueKind == JsonValueKind.String)
                settings.InterfaceDensity = density.GetString() ?? settings.InterfaceDensity;
            if (parameters.TryGetProperty("backdropPreset", out var backdrop) && backdrop.ValueKind == JsonValueKind.String)
                settings.BackdropPreset = backdrop.GetString() ?? settings.BackdropPreset;
            if (parameters.TryGetProperty("developerMode", out var developer) && developer.ValueKind is JsonValueKind.True or JsonValueKind.False)
                settings.DeveloperMode = developer.GetBoolean();
            if (parameters.TryGetProperty("memoryInjectionEnabled", out var memoryInjection) && memoryInjection.ValueKind is JsonValueKind.True or JsonValueKind.False)
                settings.MemoryInjectionEnabled = memoryInjection.GetBoolean();
            if (parameters.TryGetProperty("smartPromptRewritingEnabled", out var smartPromptRewriting) && smartPromptRewriting.ValueKind is JsonValueKind.True or JsonValueKind.False)
                settings.SmartPromptRewritingEnabled = smartPromptRewriting.GetBoolean();
            if (parameters.TryGetProperty("reduceMotion", out var reduceMotion) && reduceMotion.ValueKind is JsonValueKind.True or JsonValueKind.False)
                settings.ReduceMotion = reduceMotion.GetBoolean();
            if (parameters.TryGetProperty("personaConversationRetentionMinutes", out var personaRetention) && personaRetention.TryGetInt32(out var retentionMinutes))
            {
                if (retentionMinutes is not (15 or 60 or 240 or 1_440 or 10_080))
                    throw new InvalidOperationException("Persona conversation retention must be 15 minutes, 1 hour, 4 hours, 1 day, or 7 days.");
                settings.PersonaConversationRetentionMinutes = retentionMinutes;
            }
        }
        store.Save(settings);
        return new(ProtocolVersion, request.Id, true, new { endpoint = settings.Endpoint, model = settings.Model, provider = settings.ModelProvider, ollamaContextWindowTokens = settings.OllamaContextWindowTokens, localRamBudgetBytes = settings.LocalRamBudgetBytes, localGpuBudgetBytes = settings.LocalGpuBudgetBytes, themeMode = settings.ThemeMode, accentColor = settings.AccentColor, interfaceDensity = settings.InterfaceDensity, backdropPreset = settings.BackdropPreset, reduceMotion = settings.ReduceMotion, developerMode = settings.DeveloperMode, memoryInjectionEnabled = settings.MemoryInjectionEnabled, smartPromptRewritingEnabled = settings.SmartPromptRewritingEnabled, personaConversationRetentionMinutes = settings.PersonaConversationRetentionMinutes });
    }

    private static async Task<AgentResponse> RemovePetBackgroundAsync(AgentRequest request)
    {
        var image = RequiredBoundedString(request, "image", 8_400_000);
        var mediaType = RequiredBoundedString(request, "mediaType", 32);
        var result = await new DiffusersImageProvider().RemovePetBackgroundAsync(image, mediaType).ConfigureAwait(false);
        return new(ProtocolVersion, request.Id, true, new { image = result.DataUrl, fileName = result.FileName, progress = "Background removed locally with U2Net." });
    }

    private static AgentResponse StartImageGeneration(AgentRequest request)
    {
        lock (ImageGenerationsGate)
        {
            if (ImageGenerations.Values.Any(operation => operation.State == "running")) throw new InvalidOperationException("An image generation is already running. Cancel it or wait for it to finish.");
            var operation = new ImageGenerationOperation(Guid.NewGuid().ToString("N"), new CancellationTokenSource());
            ImageGenerations[operation.Id] = operation;
            _ = Task.Run(async () =>
            {
                try
                {
                    var response = await GenerateImageAsync(request, operation.AddProgress, operation.Cancellation.Token).ConfigureAwait(false);
                    operation.Complete(response.Result);
                }
                catch (OperationCanceledException) { operation.Cancelled(); }
                catch (Exception error) { operation.Fail(error.Message); }
            });
            return ImageGenerationResponse(request, operation);
        }
    }

    private static AgentResponse GetImageGenerationStatus(AgentRequest request)
    {
        var id = RequiredBoundedString(request, "id", 80);
        lock (ImageGenerationsGate) return ImageGenerations.TryGetValue(id, out var operation) ? ImageGenerationResponse(request, operation) : throw new KeyNotFoundException("The image generation session no longer exists.");
    }

    private static AgentResponse CancelImageGeneration(AgentRequest request)
    {
        var id = RequiredBoundedString(request, "id", 80);
        lock (ImageGenerationsGate)
        {
            if (!ImageGenerations.TryGetValue(id, out var operation)) throw new KeyNotFoundException("The image generation session no longer exists.");
            operation.Cancellation.Cancel();
            operation.Cancelled();
            return ImageGenerationResponse(request, operation);
        }
    }

    private static AgentResponse ImageGenerationResponse(AgentRequest request, ImageGenerationOperation operation) => new(ProtocolVersion, request.Id, true, new { id = operation.Id, status = operation.State, progress = operation.Progress.ToArray(), images = operation.Images, error = operation.Error });

    private static async Task<AgentResponse> GenerateImageAsync(AgentRequest request, Action<string>? reportProgress = null, CancellationToken cancellationToken = default)
    {
        var prompt = RequiredBoundedString(request, "prompt", 8_000);
        var provider = OptionalString(request, "provider") ?? "comfyui";
        if (provider.Length > 32) throw new InvalidOperationException("Image provider name exceeds its safety limit.");
        if (provider.Equals("diffusers", StringComparison.OrdinalIgnoreCase))
        {
            string? diffusersSourceImage = null;
            string? diffusersSourceMediaType = null;
            if (request.Params?.TryGetProperty("sourceImage", out var diffusersSource) == true && diffusersSource.ValueKind == JsonValueKind.String)
            {
                diffusersSourceImage = diffusersSource.GetString();
                diffusersSourceMediaType = RequiredBoundedString(request, "sourceImageMediaType", 32);
            }
            cancellationToken.ThrowIfCancellationRequested();
            reportProgress?.Invoke("Running Stable Diffusion Turbo locally…");
            var generated = await new DiffusersImageProvider().GenerateAsync(prompt, diffusersSourceImage, diffusersSourceMediaType).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            return new(ProtocolVersion, request.Id, true, new { prompt, progress = "Generated locally with Stable Diffusion Turbo.", images = new[] { new { url = generated.DataUrl, fileName = generated.FileName } } });
        }
        if (!provider.Equals("comfyui", StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Choose a supported local image provider.");
        var endpoint = RequiredLocalEndpoint(request, "endpoint", 512);
        var workflow = RequiredBoundedString(request, "workflow", 1_000_000);
        var progress = string.Empty;
        byte[]? sourceImage = null;
        string? sourceImageName = null;
        if (request.Params?.TryGetProperty("sourceImage", out var sourceValue) == true && sourceValue.ValueKind == JsonValueKind.String)
        {
            var encoded = sourceValue.GetString() ?? string.Empty;
            if (encoded.Length > 8_400_000) throw new InvalidDataException("The source image exceeds the 6 MB limit.");
            try { sourceImage = Convert.FromBase64String(encoded); }
            catch (FormatException error) { throw new InvalidDataException("The source image encoding is invalid.", error); }
            var mediaType = RequiredBoundedString(request, "sourceImageMediaType", 32);
            if (!ChatAttachmentPolicy.IsAllowedImageMediaType(mediaType) || !ChatAttachmentPolicy.HasValidImageSignature(mediaType, sourceImage)) throw new InvalidDataException("The source image must be a valid PNG or JPEG.");
            sourceImageName = mediaType == "image/png" ? "source.png" : "source.jpg";
        }
        cancellationToken.ThrowIfCancellationRequested();
        var images = await new ComfyImageProvider().GenerateAsync(endpoint, workflow, prompt, message => { progress = message; reportProgress?.Invoke(message); }, cancellationToken, sourceImageName, sourceImage);
        return new(ProtocolVersion, request.Id, true, new
        {
            prompt,
            progress,
            images = images.Select(image => new { url = image.Url.ToString(), fileName = image.FileName }).ToArray(),
        });
    }

    private static async Task<AgentResponse> ListImageCheckpointsAsync(AgentRequest request)
    {
        var endpoint = RequiredLocalEndpoint(request, "endpoint", 512);
        var checkpoints = await new ComfyImageProvider().DiscoverCheckpointsAsync(endpoint).ConfigureAwait(false);
        return new(ProtocolVersion, request.Id, true, new { checkpoints });
    }

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
