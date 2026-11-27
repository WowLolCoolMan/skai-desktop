using SkaiDesktop.Core.Services;
using SkaiDesktop.Core.Models;
using SkaiDesktop.Core.Infrastructure;
using System.Text.Json;

namespace SkaiDesktop.AgentHost.Protocol;

public static partial class AgentHostLoop
{
    private static AgentResponse GetModelRuntimeStatus(AgentRequest request)
    {
        var endpoint = RequiredLocalEndpoint(request, "endpoint", 2_000);
        var provider = RequiredBoundedString(request, "provider", 64).Trim();
        var isOllama = provider.Equals("Ollama", StringComparison.OrdinalIgnoreCase);
        var endpointUri = new Uri(endpoint.TrimEnd('/') + "/");
        var probeUri = isOllama
            ? new UriBuilder(endpointUri) { Path = "/api/tags", Query = "", Fragment = "" }.Uri
            : new UriBuilder(endpointUri) { Path = "/v1/models", Query = "", Fragment = "" }.Uri;
        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
            using var message = new HttpRequestMessage(HttpMethod.Get, probeUri);
            using var response = client.SendAsync(message, HttpCompletionOption.ResponseHeadersRead).GetAwaiter().GetResult();
            if (!response.IsSuccessStatusCode)
                return new(ProtocolVersion, request.Id, true, new { provider, available = false, status = "unavailable" });
            using var json = BoundedHttpContent.ReadJsonAsync(response.Content, label: "Local runtime probe").GetAwaiter().GetResult();
            var collectionName = isOllama ? "models" : "data";
            var available = json.RootElement.ValueKind == JsonValueKind.Object
                && json.RootElement.TryGetProperty(collectionName, out var entries)
                && entries.ValueKind == JsonValueKind.Array;
            return new(ProtocolVersion, request.Id, true, new { provider, available, status = available ? "ready" : "unavailable" });
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException or JsonException or IOException)
        {
            return new(ProtocolVersion, request.Id, true, new { provider, available = false, status = "unavailable" });
        }
    }

    private static AgentResponse GetLocalCapacity(AgentRequest request)
    {
        var snapshot = new LocalCapacityProbe().GetSnapshotAsync().GetAwaiter().GetResult();
        var tasks = CreateTaskStore().Load();
        var settings = CreateSettingsStore().Load();
        var runtime = ReadRuntimeCapacity(settings, AirLlmProvider.IsAirLlmProvider(settings.ModelProvider));
        var decision = LocalExecutionCapacityPolicy.Decide(snapshot, settings.LocalRamBudgetBytes, settings.LocalGpuBudgetBytes,
            settings.CodingModelSizeBytes, settings.CodingModelContextLength,
            string.Equals(settings.CodingModelProvider ?? settings.ModelProvider, "AirLLM", StringComparison.OrdinalIgnoreCase), runtime.AirLlmReady == true);
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
            scheduler = new { activeTaskCount, queuedTaskCount, executionSlotLimit = decision.SlotLimit, limitingResource = decision.LimitingResource, estimatedRamPerTaskBytes = decision.EstimatedRamPerTaskBytes, effectiveAvailableRamBytes = decision.EffectiveAvailableRamBytes, effectiveAvailableGpuBytes = decision.EffectiveAvailableGpuBytes, estimateBasis = decision.EstimateBasis, queuePolicy = "fifo" },
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
            var route = ModelRuntimeRouter.Route(model.Provider, model.Model, capabilities: profile?.Capabilities);
            return new
            {
                model = model.Model,
                displayName = model.DisplayName,
                vision = profile?.Vision.ToString() ?? "unknown",
                capabilities = profile?.Capabilities ?? Array.Empty<string>(),
                format = route.Format.ToString(),
                task = route.Task.ToString(),
                runtime = route.Runtime,
                routingEvidence = route.Evidence,
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


}
