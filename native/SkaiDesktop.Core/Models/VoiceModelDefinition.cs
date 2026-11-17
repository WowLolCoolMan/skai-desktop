namespace SkaiDesktop.Core.Models;

/// <summary>Describes a voice runtime that can be selected in the local marketplace.</summary>
public sealed record VoiceModelDefinition(
    string Id,
    string Name,
    string Description,
    string Runtime,
    string License,
    string Size,
    bool IsInstalled,
    bool IsLowResource,
    string SourceUrl)
{
    /// <summary>Whether Skai has a tested adapter for this runtime in this build.</summary>
    public bool AdapterAvailable { get; init; }
    public bool SupportsStreaming { get; init; }
    public bool SupportsVoiceCloning { get; init; }
    public bool SupportsEmotion { get; init; }
    public bool SupportsAudioEffects { get; init; }
    public string AvailabilityNote { get; init; } = "Catalog entry; adapter not connected.";
}

public static class VoiceModelCatalog
{
    public static IReadOnlyList<VoiceModelDefinition> All { get; } =
    [
        new("os-native", "OS-native speech", "Uses the platform speech service; no model download required.", "Windows Speech / Linux espeak-ng", "OS-provided", "No model", true, true, "")
        {
            AdapterAvailable = true, SupportsStreaming = false, AvailabilityNote = "Ready through the operating system."
        },
        new("kokoro-82m-onnx", "Kokoro 82M ONNX", "Fast, natural multi-voice speech through a local ONNX runtime.", "ONNX Runtime", "Apache-2.0", "~163 MB fp16 model + voices", false, false, "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX")
        {
            SupportsStreaming = true, SupportsEmotion = false, AvailabilityNote = "Model cataloged; local adapter and model install are not connected yet."
        },
        new("pocket-tts", "Pocket TTS", "CPU-first streaming speech with voice cloning support.", "Pocket TTS", "MIT", "Model-dependent", false, false, "https://github.com/kyutai-labs/pocket-tts")
        {
            SupportsStreaming = true, SupportsVoiceCloning = true, AvailabilityNote = "Model cataloged; local adapter and model install are not connected yet."
        },
        new("pocket-tts-low-resource", "Pocket TTS Low Resource", "Small CPU-first English voice for constrained laptops.", "Pocket TTS", "MIT", "Small English model", false, true, "https://github.com/kyutai-labs/pocket-tts")
        {
            SupportsStreaming = true, SupportsVoiceCloning = true, AvailabilityNote = "Model cataloged; local adapter and model install are not connected yet."
        },
        new("f5-tts", "F5-TTS", "Local flow-matching speech with reference-audio voice cloning.", "PyTorch", "CC-BY-NC-4.0 / model-specific", "Model-dependent", false, false, "https://github.com/SWivid/F5-TTS")
        {
            SupportsVoiceCloning = true, SupportsEmotion = true, AvailabilityNote = "Review upstream model and commercial-use terms before installation."
        },
        new("fish-speech", "Fish Speech", "Expressive multilingual local speech with reference audio support.", "PyTorch", "Apache-2.0 / model-specific", "Model-dependent", false, false, "https://github.com/fishaudio/fish-speech")
        {
            SupportsStreaming = true, SupportsVoiceCloning = true, SupportsEmotion = true, SupportsAudioEffects = true, AvailabilityNote = "Model cataloged; adapter and model install are not connected yet."
        },
        new("cosyvoice", "CosyVoice", "Multilingual zero-shot and instructed local speech.", "PyTorch", "Apache-2.0 / model-specific", "Model-dependent", false, false, "https://github.com/FunAudioLLM/CosyVoice")
        {
            SupportsStreaming = true, SupportsVoiceCloning = true, SupportsEmotion = true, AvailabilityNote = "Model cataloged; adapter and model install are not connected yet."
        },
        new("gpt-sovits", "GPT-SoVITS", "Reference-audio voice conversion and few-shot speech synthesis.", "PyTorch", "MIT / model-specific", "Model-dependent", false, false, "https://github.com/RVC-Boss/GPT-SoVITS")
        {
            SupportsVoiceCloning = true, SupportsEmotion = true, AvailabilityNote = "Review upstream model and voice rights before installation."
        },
        new("openvoice", "OpenVoice", "Instant voice cloning and style control for local synthesis.", "PyTorch", "MIT", "Model-dependent", false, false, "https://github.com/myshell-ai/OpenVoice")
        {
            SupportsVoiceCloning = true, SupportsEmotion = true, AvailabilityNote = "Model cataloged; adapter and model install are not connected yet."
        },
        new("styletts2", "StyleTTS 2", "High-quality local speech with style and reference-audio control.", "PyTorch", "MIT / model-specific", "Model-dependent", false, false, "https://github.com/yl4579/StyleTTS2")
        {
            SupportsVoiceCloning = true, SupportsEmotion = true, AvailabilityNote = "Model cataloged; adapter and model install are not connected yet."
        },
        new("piper", "Piper", "Compact, fast local neural speech for offline devices.", "ONNX Runtime", "MIT / voice-specific", "Model-dependent", false, true, "https://github.com/rhasspy/piper")
        {
            SupportsStreaming = true, AvailabilityNote = "Model cataloged; adapter and model install are not connected yet."
        },
        new("xtts-v2", "XTTS v2", "Multilingual local speech with reference-audio cloning.", "Coqui TTS / PyTorch", "Coqui Public Model License", "Model-dependent", false, false, "https://github.com/coqui-ai/TTS")
        {
            SupportsStreaming = true, SupportsVoiceCloning = true, SupportsEmotion = false, AvailabilityNote = "Review the upstream license and model terms before installation."
        }
    ];

    public static VoiceModelDefinition Resolve(string? id) =>
        All.FirstOrDefault(model => model.Id.Equals(id, StringComparison.OrdinalIgnoreCase)) ?? All[0];
}
