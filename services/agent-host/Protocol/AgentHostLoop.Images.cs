using System.Text.Json;
using SkaiDesktop.Core.Infrastructure;
using SkaiDesktop.Core.Services;

namespace SkaiDesktop.AgentHost.Protocol;

public static partial class AgentHostLoop
{
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
            var generated = await new DiffusersImageProvider().GenerateAsync(prompt, diffusersSourceImage, diffusersSourceMediaType, reportProgress, cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            return new(ProtocolVersion, request.Id, true, new { prompt, progress = "Generated locally with Stable Diffusion Turbo.", images = new[] { new { url = generated.DataUrl, fileName = generated.FileName, mediaType = "image" } } });
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
            images = images.Select(image => new { url = image.Url.ToString(), fileName = image.FileName, mediaType = image.MediaType }).ToArray(),
        });
    }

    private static async Task<AgentResponse> Generate3DAssetAsync(AgentRequest request, CancellationToken cancellationToken = default)
    {
        var prompt = RequiredBoundedString(request, "prompt", 8_000);
        var endpoint = RequiredLocalEndpoint(request, "endpoint", 512);
        var workflow = RequiredBoundedString(request, "workflow", 1_000_000);
        byte[]? sourceImage = null;
        string? sourceImageName = null;
        if (request.Params?.TryGetProperty("sourceImage", out var sourceValue) == true && sourceValue.ValueKind == JsonValueKind.String)
        {
            var encoded = sourceValue.GetString() ?? string.Empty;
            if (encoded.Length > 8_400_000) throw new InvalidDataException("The source image exceeds the 6 MB limit.");
            try { sourceImage = Convert.FromBase64String(encoded); }
            catch (FormatException error) { throw new InvalidDataException("The source image encoding is invalid.", error); }
            var mediaType = RequiredBoundedString(request, "sourceImageMediaType", 32);
            if (!ChatAttachmentPolicy.IsAllowedImageMediaType(mediaType) || !ChatAttachmentPolicy.HasValidImageSignature(mediaType, sourceImage))
                throw new InvalidDataException("The source image must be a valid PNG or JPEG.");
            sourceImageName = mediaType == "image/png" ? "source.png" : "source.jpg";
        }
        var result = await new ComfyImageProvider().GenerateAsync(
            endpoint,
            workflow,
            prompt,
            cancellationToken: cancellationToken,
            sourceImageName: sourceImageName,
            sourceImage: sourceImage,
            modelOutputOnly: true).ConfigureAwait(false);
        if (result.Count == 0) throw new InvalidOperationException("ComfyUI did not return a GLB asset.");
        var artifacts = new List<object>();
        var projectId = OptionalString(request, "projectId");
        if (!string.IsNullOrWhiteSpace(projectId))
        {
            var project = CreateProjectStore().Load().SingleOrDefault(item => item.Id == projectId)
                ?? throw new InvalidOperationException("The project linked to this asset is no longer available.");
            var root = project.FolderPaths.FirstOrDefault();
            if (string.IsNullOrWhiteSpace(root)) throw new InvalidOperationException("Select a local project folder before saving generated assets.");
            var artifactStore = new WorkspaceGlbArtifactService();
            foreach (var asset in result)
            {
                var stored = artifactStore.Save(root, $"generated-assets/skai-{Guid.NewGuid():N}.glb", asset.Content ?? throw new InvalidDataException("ComfyUI did not return the validated GLB content."));
                artifacts.Add(new { url = asset.Url.ToString(), fileName = asset.FileName, mediaType = asset.MediaType, workspacePath = stored.RelativePath, sha256 = stored.Sha256, bytes = stored.Bytes });
            }
        }
        else
        {
            artifacts.AddRange(result.Select(asset => new { url = asset.Url.ToString(), fileName = asset.FileName, mediaType = asset.MediaType, workspacePath = (string?)null, sha256 = (string?)null, bytes = (long?)asset.Content?.LongLength }));
        }
        return new(ProtocolVersion, request.Id, true, new
        {
            prompt,
            assets = artifacts,
        });
    }

    private static async Task<AgentResponse> ListImageCheckpointsAsync(AgentRequest request)
    {
        var endpoint = RequiredLocalEndpoint(request, "endpoint", 512);
        var checkpoints = await new ComfyImageProvider().DiscoverCheckpointsAsync(endpoint).ConfigureAwait(false);
        return new(ProtocolVersion, request.Id, true, new { checkpoints });
    }


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

}
