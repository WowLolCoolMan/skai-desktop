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
        var provider = OptionalString(request, "provider");
        if (!string.IsNullOrWhiteSpace(provider))
        {
            var definition = VoiceModelCatalog.CloudProviders.FirstOrDefault(item => item.Id.Equals(provider, StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidOperationException("That cloud voice provider is not supported by this build.");
            var apiKey = RequiredBoundedString(request, "apiKey", 512);
            var requestedVoice = OptionalString(request, "voiceId");
            var requestedModel = OptionalString(request, "modelId");
            var voiceId = string.IsNullOrWhiteSpace(requestedVoice) ? definition.DefaultVoiceId : RequiredBoundedString(request, "voiceId", 128);
            var modelId = string.IsNullOrWhiteSpace(requestedModel) ? definition.Model : RequiredBoundedString(request, "modelId", 128);
            var endpoint = definition.Endpoint;
            var audio = CloudVoiceService.SynthesizeAsync(definition.Id, endpoint, modelId, voiceId, apiKey, text, rate).GetAwaiter().GetResult();
            return new(ProtocolVersion, request.Id, true, new { spoken = true, engine = $"{definition.Id}-cloud", interruptible = true, audioDataUrl = audio });
        }
        var engine = voice.Speak(text, rate);
        return new(ProtocolVersion, request.Id, true, new { spoken = true, engine, interruptible = true });
    }

    private static AgentResponse StopVoice(AgentRequest request, OsNativeTtsService voice)
    {
        voice.Stop();
        return new(ProtocolVersion, request.Id, true, new { stopped = true });
    }


}
