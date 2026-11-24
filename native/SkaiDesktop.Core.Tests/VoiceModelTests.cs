using SkaiDesktop.Core.Models;
using SkaiDesktop.Core.Services;
using static TestSupport;

internal static class VoiceModelTests
{
    public static void Run()
    {
        Check(VoiceModelCatalog.Resolve("unknown").Id == "os-native", "voice catalog falls back to the installed OS-native runtime");
        Check(VoiceModelCatalog.All.Any(model => model.Id == "kokoro-82m-onnx" && model.License == "Apache-2.0 model / MIT runtime"), "voice catalog exposes the Kokoro ONNX model and runtime licenses");
        Check(VoiceModelCatalog.All.Any(model => model.Id == "pocket-tts-low-resource" && model.IsLowResource), "voice catalog exposes a low-resource Pocket TTS option");
        Check(VoiceModelCatalog.All.Count >= 10, "voice catalog exposes a broad local engine set");
        Check(VoiceModelCatalog.All.Any(model => model.Id == "fish-speech" && model.SupportsAudioEffects), "voice catalog exposes expressive audio capability metadata");
        Check(VoiceModelCatalog.All.Any(model => model.Id == "piper" && model.IsLowResource), "voice catalog exposes a compact offline runtime");
        Check(VoiceModelCatalog.All.Any(model => model.Id == "piper" && model.License.Contains("GPL-3.0") && model.License.Contains("CC-BY-4.0")), "voice catalog exposes Piper engine and voice-data license terms");
        var previousVoiceRoot = Environment.GetEnvironmentVariable("SKAI_VOICE_ROOT");
        try
        {
            Environment.SetEnvironmentVariable("SKAI_VOICE_ROOT", Path.Combine(Path.GetTempPath(), "skai-voice-root"));
            Check(VoiceRuntimeStatus.GetVoiceRuntimeRoot("Piper") == Path.Combine(Path.GetTempPath(), "skai-voice-root", "Piper"), "voice runtimes honor the isolated acceptance root");
            Check(VoiceRuntimeStatus.GetVoiceRuntimeRoot("WhisperLargeV3").EndsWith(Path.Combine("skai-voice-root", "WhisperLargeV3"), StringComparison.OrdinalIgnoreCase), "voice root supports the registered Whisper runtime");
            Check(VoiceRuntimeStatus.GetVoiceRuntimeRoot("Qwen3TTS").EndsWith(Path.Combine("skai-voice-root", "Qwen3TTS"), StringComparison.OrdinalIgnoreCase), "voice root supports the Qwen3-TTS runtime");
            var rejectedUnknownRuntime = false;
            try { VoiceRuntimeStatus.GetVoiceRuntimeRoot("Unregistered"); }
            catch (ArgumentOutOfRangeException) { rejectedUnknownRuntime = true; }
            Check(rejectedUnknownRuntime, "voice root rejects unregistered runtime directories");
        }
        finally { Environment.SetEnvironmentVariable("SKAI_VOICE_ROOT", previousVoiceRoot); }
        var chatterbox = VoiceModelCatalog.All.Single(model => model.Id == "chatterbox");
        Check(chatterbox.Name == "Chatterbox Nano" && !chatterbox.IsLowResource && chatterbox.License.StartsWith("MIT"), "voice catalog identifies the official MIT CPU-oriented Chatterbox Nano variant without overstating its memory fit");
        Check(!chatterbox.SupportsVoiceCloning && chatterbox.SupportsAudioEffects && chatterbox.SourceUrl == "https://huggingface.co/ResembleAI/chatterbox-nano", "voice catalog exposes only Chatterbox Nano features wired by the local adapter");
        Check(chatterbox.AdapterAvailable && chatterbox.AvailabilityNote.Contains("pinned"), "voice catalog exposes the verified Chatterbox adapter and pinned local runtime");
        var qwen = VoiceModelCatalog.All.Single(model => model.Id == "qwen3-tts");
        Check(qwen.AdapterAvailable && !qwen.SupportsEmotion && qwen.AvailabilityNote.Contains("ignores style instructions", StringComparison.Ordinal), "voice catalog accurately describes Qwen3-TTS 0.6B sampling controls and instruction limits");
        Check(!qwen.SupportsStreaming && !qwen.SupportsVoiceCloning && !qwen.SupportsAudioEffects, "Qwen3-TTS does not claim unsupported streaming, cloning, or audio effects");
        Check(qwen.License.StartsWith("Apache-2.0", StringComparison.Ordinal) && qwen.Size.Contains("2.5 GB", StringComparison.Ordinal), "Qwen3-TTS shows its model license and approximate download size");
        Check(VoiceModelCatalog.All.Any(model => model.Id == "omnivoice"), "voice catalog exposes OmniVoice");
        Check(VoiceModelCatalog.All.Any(model => model.Id == "higgs-audio-v2" && model.SupportsAudioEffects), "voice catalog exposes Higgs Audio v2 expressive effects");
        Check(VoiceModelCatalog.CloudProviders.Any(provider => provider.Id == "elevenlabs") && VoiceModelCatalog.CloudProviders.Any(provider => provider.Id == "inworld") && VoiceModelCatalog.CloudProviders.Any(provider => provider.Id == "cartesia"), "voice catalog exposes supported hosted providers");
        var profile = VoiceProfileCatalog.Resolve(null, "missing");
        Check(profile.Id == "skai-neutral", "voice profiles fall back to the Skai Neutral preset");
        var bounded = VoiceProfileCatalog.Resolve([new VoiceProfile { Id = "custom", Name = "Custom", Rate = 999, Volume = -2 }], "custom");
        Check(bounded.Rate == 50 && bounded.Volume == 0, "voice profile settings are bounded before use");
    }
}
