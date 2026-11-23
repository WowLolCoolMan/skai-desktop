using SkaiDesktop.Core.Services;
using SkaiDesktop.Core.Models;

namespace SkaiDesktop.AgentHost.Protocol;

public static partial class AgentHostLoop
{
    private static AgentResponse ListVoiceModels(AgentRequest request) =>
        new(ProtocolVersion, request.Id, true, new
        {
            providers = VoiceModelCatalog.CloudProviders.Select(provider => new
            {
                id = provider.Id,
                name = provider.Name,
                model = provider.Model,
                defaultVoiceId = provider.DefaultVoiceId,
                supportsStreaming = provider.SupportsStreaming,
                requiresUserKey = provider.RequiresUserKey,
                availabilityNote = provider.AvailabilityNote,
            }).ToArray(),
            models = VoiceModelCatalog.All.Select(model => new
            {
                id = model.Id,
                name = model.Name,
                detail = model.Description,
                size = model.Size,
                installed = model.Id == "os-native" ? VoiceRuntimeStatus.IsOsNativeAvailable : model.Id == "kokoro-82m-onnx" ? KokoroVoiceRuntime.IsInstalled : model.Id == "piper" ? PiperVoiceRuntime.IsInstalled : model.Id == "chatterbox" ? ChatterboxVoiceRuntime.IsInstalled : model.IsInstalled,
                lowResource = model.IsLowResource,
                adapterAvailable = model.AdapterAvailable || model.Id is "kokoro-82m-onnx" or "piper" or "chatterbox",
                supportsStreaming = model.SupportsStreaming,
                supportsVoiceCloning = model.SupportsVoiceCloning,
                supportsEmotion = model.SupportsEmotion,
                supportsAudioEffects = model.SupportsAudioEffects,
                availabilityNote = model.AvailabilityNote,
            }).ToArray(),
        });

    private static AgentResponse TranscribeVoice(AgentRequest request)
    {
        var parameters = request.Params ?? throw new InvalidOperationException("Audio data is required.");
        if (!parameters.TryGetProperty("audioBase64", out var audioValue) || audioValue.ValueKind != System.Text.Json.JsonValueKind.String)
            throw new InvalidOperationException("Audio data is required.");
        var audio = audioValue.GetString() ?? "";
        if (audio.Length is < 4 or > 28_000_000) throw new InvalidOperationException("Choose an audio file smaller than 20 MB.");
        var fileName = RequiredBoundedString(request, "fileName", 128);
        var language = OptionalString(request, "language");
        var result = WhisperVoiceRuntime.TranscribeAsync(audio, fileName, language).GetAwaiter().GetResult();
        return new(ProtocolVersion, request.Id, true, result);
    }

    private static AgentResponse SpeakVoice(AgentRequest request, OsNativeTtsService voice)
    {
        var text = RequiredSpeechText(request, "text", 4_000);
        var rate = OptionalDouble(request, "rate") ?? 1;
        if (rate is < 0.5 or > 2) throw new InvalidOperationException("rate must be between 0.5 and 2.");
        var provider = OptionalString(request, "provider");
        if (!string.IsNullOrWhiteSpace(provider))
        {
            if (request.Params is { ValueKind: System.Text.Json.JsonValueKind.Object } parameters && parameters.TryGetProperty("apiKey", out _))
                throw new InvalidOperationException("Voice API keys must be saved in secure voice settings, not sent with speech requests.");
            var definition = VoiceModelCatalog.CloudProviders.FirstOrDefault(item => item.Id.Equals(provider, StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidOperationException("That cloud voice provider is not supported by this build.");
            var apiKey = VoiceCredentials.ReadAsync(definition.Id).GetAwaiter().GetResult()
                ?? throw new InvalidOperationException("Save this provider's API key in Voice settings before using cloud voice.");
            var requestedVoice = OptionalString(request, "voiceId");
            var requestedModel = OptionalString(request, "modelId");
            var voiceId = string.IsNullOrWhiteSpace(requestedVoice) ? definition.DefaultVoiceId : RequiredBoundedString(request, "voiceId", 128);
            var modelId = string.IsNullOrWhiteSpace(requestedModel) ? definition.Model : RequiredBoundedString(request, "modelId", 128);
            var endpoint = definition.Endpoint;
            var audio = CloudVoiceService.SynthesizeAsync(definition.Id, endpoint, modelId, voiceId, apiKey, text, rate).GetAwaiter().GetResult();
            return new(ProtocolVersion, request.Id, true, new { spoken = true, engine = $"{definition.Id}-cloud", interruptible = true, audioDataUrl = audio });
        }
        var selectedModelId = OptionalString(request, "modelId");
        if (selectedModelId?.Equals("kokoro-82m-onnx", StringComparison.OrdinalIgnoreCase) == true)
        {
            var audio = KokoroVoiceRuntime.SynthesizeDataUrlAsync(text, rate).GetAwaiter().GetResult();
            return new(ProtocolVersion, request.Id, true, new { spoken = true, engine = "kokoro-onnx-local", interruptible = true, audioDataUrl = audio });
        }
        if (selectedModelId?.Equals("piper", StringComparison.OrdinalIgnoreCase) == true)
        {
            var audio = PiperVoiceRuntime.SynthesizeDataUrlAsync(text, rate).GetAwaiter().GetResult();
            return new(ProtocolVersion, request.Id, true, new { spoken = true, engine = "piper-local", interruptible = true, audioDataUrl = audio });
        }
        if (selectedModelId?.Equals("chatterbox", StringComparison.OrdinalIgnoreCase) == true)
        {
            var audio = ChatterboxVoiceRuntime.SynthesizeDataUrlAsync(text, rate).GetAwaiter().GetResult();
            return new(ProtocolVersion, request.Id, true, new { spoken = true, engine = "chatterbox-nano-local", interruptible = true, audioDataUrl = audio });
        }
        var engine = voice.Speak(text, rate);
        return new(ProtocolVersion, request.Id, true, new { spoken = true, engine, interruptible = true });
    }

    private static AgentResponse SaveVoiceCredential(AgentRequest request)
    {
        var provider = RequiredBoundedString(request, "provider", 32);
        var apiKey = RequiredBoundedString(request, "apiKey", 512);
        VoiceCredentials.SaveAsync(provider, apiKey).GetAwaiter().GetResult();
        return new(ProtocolVersion, request.Id, true, new { saved = true, configured = true });
    }

    private static AgentResponse GetVoiceCredentialStatus(AgentRequest request)
    {
        var provider = RequiredBoundedString(request, "provider", 32);
        var configured = VoiceCredentials.HasAsync(provider).GetAwaiter().GetResult();
        return new(ProtocolVersion, request.Id, true, new { available = VoiceCredentials.IsAvailable, configured });
    }

    private static AgentResponse RemoveVoiceCredential(AgentRequest request)
    {
        var provider = RequiredBoundedString(request, "provider", 32);
        VoiceCredentials.DeleteAsync(provider).GetAwaiter().GetResult();
        return new(ProtocolVersion, request.Id, true, new { removed = true, configured = false });
    }

    private static AgentResponse StopVoice(AgentRequest request, OsNativeTtsService voice)
    {
        voice.Stop();
        return new(ProtocolVersion, request.Id, true, new { stopped = true });
    }


}
