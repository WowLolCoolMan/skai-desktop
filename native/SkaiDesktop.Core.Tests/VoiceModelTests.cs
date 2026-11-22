using SkaiDesktop.Core.Models;
using static TestSupport;

internal static class VoiceModelTests
{
    public static void Run()
    {
        Check(VoiceModelCatalog.Resolve("unknown").Id == "os-native", "voice catalog falls back to the installed OS-native runtime");
        Check(VoiceModelCatalog.All.Any(model => model.Id == "kokoro-82m-onnx" && model.License == "Apache-2.0"), "voice catalog exposes the Kokoro ONNX option");
        Check(VoiceModelCatalog.All.Any(model => model.Id == "pocket-tts-low-resource" && model.IsLowResource), "voice catalog exposes a low-resource Pocket TTS option");
        Check(VoiceModelCatalog.All.Count >= 10, "voice catalog exposes a broad local engine set");
        Check(VoiceModelCatalog.All.Any(model => model.Id == "fish-speech" && model.SupportsAudioEffects), "voice catalog exposes expressive audio capability metadata");
        Check(VoiceModelCatalog.All.Any(model => model.Id == "piper" && model.IsLowResource), "voice catalog exposes a compact offline runtime");
        Check(VoiceModelCatalog.All.Any(model => model.Id == "chatterbox" && model.SupportsVoiceCloning), "voice catalog exposes Chatterbox voice cloning");
        Check(VoiceModelCatalog.All.Any(model => model.Id == "qwen3-tts" && model.SupportsStreaming), "voice catalog exposes Qwen3-TTS streaming");
        Check(VoiceModelCatalog.All.Any(model => model.Id == "omnivoice"), "voice catalog exposes OmniVoice");
        Check(VoiceModelCatalog.All.Any(model => model.Id == "higgs-audio-v2" && model.SupportsAudioEffects), "voice catalog exposes Higgs Audio v2 expressive effects");
        Check(VoiceModelCatalog.CloudProviders.Any(provider => provider.Id == "elevenlabs") && VoiceModelCatalog.CloudProviders.Any(provider => provider.Id == "inworld") && VoiceModelCatalog.CloudProviders.Any(provider => provider.Id == "cartesia"), "voice catalog exposes supported hosted providers");
        var profile = VoiceProfileCatalog.Resolve(null, "missing");
        Check(profile.Id == "skai-neutral", "voice profiles fall back to the Skai Neutral preset");
        var bounded = VoiceProfileCatalog.Resolve([new VoiceProfile { Id = "custom", Name = "Custom", Rate = 999, Volume = -2 }], "custom");
        Check(bounded.Rate == 50 && bounded.Volume == 0, "voice profile settings are bounded before use");
    }
}
