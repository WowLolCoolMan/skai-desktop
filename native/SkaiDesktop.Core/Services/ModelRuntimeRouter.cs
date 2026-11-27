using SkaiDesktop.Core.Models;

namespace SkaiDesktop.Core.Services;

/// <summary>
/// Maps model artifacts and provider metadata to the runtime adapter that can
/// execute them. The router is deliberately conservative: unknown artifacts
/// remain unknown instead of being presented as universally supported.
/// </summary>
public static class ModelRuntimeRouter
{
    public static ModelRuntimeRoute Route(
        string? provider,
        string? model,
        IEnumerable<string>? files = null,
        IEnumerable<string>? capabilities = null)
    {
        var providerName = provider?.Trim() ?? string.Empty;
        var modelName = model?.Trim() ?? string.Empty;
        var fileNames = files?.Where(file => !string.IsNullOrWhiteSpace(file)).ToArray() ?? [];
        var capabilityNames = capabilities?.Where(capability => !string.IsNullOrWhiteSpace(capability)).ToArray() ?? [];
        var normalized = string.Join(' ', new[] { providerName, modelName }.Concat(fileNames).Concat(capabilityNames)).ToLowerInvariant();

        var format = DetectFormat(providerName, modelName, fileNames);
        var task = DetectTask(normalized);
        var runtime = DetectRuntime(providerName, format, task);
        var evidence = BuildEvidence(format, task, runtime, fileNames.Length > 0, capabilityNames.Length > 0);
        return new ModelRuntimeRoute(format, task, runtime, evidence);
    }

    private static ModelFormat DetectFormat(string provider, string model, IReadOnlyList<string> files)
    {
        if (files.Any(file => file.EndsWith(".gguf", StringComparison.OrdinalIgnoreCase))) return ModelFormat.Gguf;
        if (files.Any(file => file.EndsWith(".onnx", StringComparison.OrdinalIgnoreCase))) return ModelFormat.Onnx;
        if (files.Any(file => file.EndsWith(".safetensors", StringComparison.OrdinalIgnoreCase))) return ModelFormat.SafeTensors;
        if (files.Any(file => file.EndsWith(".pt", StringComparison.OrdinalIgnoreCase) || file.EndsWith(".bin", StringComparison.OrdinalIgnoreCase))) return ModelFormat.PyTorch;

        // Ollama/LM Studio/llama.cpp expose a server model rather than its
        // local files. GGUF is the common adapter format, but keep the reason
        // explicit so the UI does not imply that the file was inspected.
        if (provider.Contains("ollama", StringComparison.OrdinalIgnoreCase)
            || provider.Contains("lm studio", StringComparison.OrdinalIgnoreCase)
            || provider.Contains("llama.cpp", StringComparison.OrdinalIgnoreCase)
            || provider.Contains("localai", StringComparison.OrdinalIgnoreCase)
            || model.StartsWith("hf.co/", StringComparison.OrdinalIgnoreCase)) return ModelFormat.Gguf;
        if (provider.Contains("airllm", StringComparison.OrdinalIgnoreCase)) return ModelFormat.SafeTensors;
        if (provider.Contains("comfy", StringComparison.OrdinalIgnoreCase)
            || model.Contains("flux", StringComparison.OrdinalIgnoreCase)
            || model.Contains("stable-diffusion", StringComparison.OrdinalIgnoreCase)
            || model.Contains("sdxl", StringComparison.OrdinalIgnoreCase)) return ModelFormat.SafeTensors;
        return ModelFormat.Unknown;
    }

    private static ModelTask DetectTask(string normalized)
    {
        if (ContainsAny(normalized, "embedding", "embed", "bge-", "gte-")) return ModelTask.Embeddings;
        if (ContainsAny(normalized, "text-to-speech", "tts", "kokoro", "piper")) return ModelTask.TextToSpeech;
        if (ContainsAny(normalized, "audio", "whisper", "speech-to-text", "stt")) return ModelTask.Audio;
        if (ContainsAny(normalized, "text-to-image", "diffusion", "flux", "stable-diffusion", "sdxl")) return ModelTask.TextToImage;
        if (ContainsAny(normalized, "vision", "vl", "multimodal", "mmproj", "image")) return ModelTask.VisionLanguage;
        if (ContainsAny(normalized, "chat", "instruct", "coder", "completion", "llm", "qwen", "llama", "gemma", "mistral")) return ModelTask.TextGeneration;
        return ModelTask.Unknown;
    }

    private static string DetectRuntime(string provider, ModelFormat format, ModelTask task)
    {
        if (provider.Contains("comfy", StringComparison.OrdinalIgnoreCase) || task == ModelTask.TextToImage) return "ComfyUI";
        if (format == ModelFormat.Onnx) return "ONNX Runtime";
        if (provider.Contains("airllm", StringComparison.OrdinalIgnoreCase) || format == ModelFormat.PyTorch) return "PyTorch sidecar";
        if (format == ModelFormat.Gguf) return "llama.cpp-compatible server";
        return "Unknown local adapter";
    }

    private static string BuildEvidence(ModelFormat format, ModelTask task, string runtime, bool inspectedFiles, bool advertisedCapabilities) =>
        inspectedFiles
            ? $"Detected from local artifact files · {format}"
            : advertisedCapabilities
                ? $"Inferred from provider metadata · {runtime}"
                : $"Inferred from provider/model identity · {runtime}";

    private static bool ContainsAny(string value, params string[] terms) => terms.Any(value.Contains);
}
