using SkaiDesktop.Core.Services;
using SkaiDesktop.Core.Models;

namespace SkaiDesktop.AgentHost.Protocol;

public static partial class AgentHostLoop
{
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


}
