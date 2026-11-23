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

/// <summary>Describes a hosted voice provider that can be used with an explicit user key.</summary>
public sealed record CloudVoiceProviderDefinition(
    string Id,
    string Name,
    string Model,
    string DefaultVoiceId,
    string Endpoint,
    string Description,
    string SourceUrl)
{
    public string Kind { get; init; } = "cloud voice";
    public bool RequiresUserKey { get; init; } = true;
    public bool SupportsStreaming { get; init; }
    public string AvailabilityNote { get; init; } = "Bring your own API key; the key remains in the running Skai session.";
}

public static class VoiceModelCatalog
{
    public static IReadOnlyList<VoiceModelDefinition> All { get; } =
    [
        new("os-native", "OS-native speech", "Uses the platform speech service; no model download required.", "Windows Speech / Linux espeak-ng", "OS-provided", "No model", true, true, "")
        {
            AdapterAvailable = true, SupportsStreaming = false, AvailabilityNote = "Ready through the operating system."
        },
        new("kokoro-82m-onnx", "Kokoro 82M ONNX", "Fast English speech through Skai's local INT8 ONNX adapter.", "kokoro-onnx 0.6.1 · Python", "Apache-2.0 model / MIT runtime", "~136 MB INT8 model + voices", false, false, "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX")
        {
            SupportsStreaming = false, SupportsEmotion = false, AvailabilityNote = "Install the local runtime and checksum-verified model files from Marketplace."
        },
        new("chatterbox", "Chatterbox Nano", "English expressive speech using its built-in voice. The upstream supports reference-voice cloning, but Skai does not expose custom reference audio yet.", "Chatterbox-TTS 0.1.7 · PyTorch 2.6 CPU", "MIT model / MIT runtime", "~1.9 GB weights; 6 GB free disk recommended", false, false, "https://huggingface.co/ResembleAI/chatterbox-nano")
        {
            AdapterAvailable = true, SupportsVoiceCloning = true, SupportsEmotion = true, SupportsAudioEffects = true,
            AvailabilityNote = "Installed through Skai's isolated CPU runtime with pinned and verified local weights. The warm worker remains resident while Skai runs; custom reference audio is not exposed yet."
        },
        new("qwen3-tts", "Qwen3-TTS", "Multilingual local speech with voice design, cloning, and streaming generation.", "PyTorch", "Apache-2.0 / model-specific", "0.6B or 1.7B model", false, false, "https://github.com/QwenLM/Qwen3-TTS")
        {
            SupportsStreaming = true, SupportsVoiceCloning = true, SupportsEmotion = true,
            AvailabilityNote = "Cataloged for local setup; Qwen3-TTS Python runtime and weights are not installed by Skai yet."
        },
        new("omnivoice", "OmniVoice", "Omnilingual zero-shot speech synthesis with broad language coverage.", "PyTorch", "Upstream model terms", "Model-dependent", false, false, "https://github.com/k2-fsa/OmniVoice")
        {
            SupportsVoiceCloning = true, SupportsStreaming = true,
            AvailabilityNote = "Cataloged for local setup; review the upstream model card and runtime requirements before installation."
        },
        new("higgs-audio-v2", "Higgs Audio v2", "Expressive local audio generation with multi-speaker and reference-audio support.", "PyTorch", "Apache-2.0 / model-specific", "3B model", false, false, "https://github.com/boson-ai/higgs-audio")
        {
            SupportsVoiceCloning = true, SupportsEmotion = true, SupportsAudioEffects = true,
            AvailabilityNote = "Cataloged for local setup; the v2 runtime requires a compatible Python/PyTorch environment."
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
        new("piper", "Piper", "Compact English local speech with a pinned US English voice and CC BY attribution terms.", "piper-tts 1.5.0 · ONNX Runtime", "GPL-3.0 engine / CC-BY-4.0 voice data", "~64 MB voice model", false, true, "https://github.com/OHF-Voice/piper1-gpl")
        {
            SupportsStreaming = false, AvailabilityNote = "Install Piper and the attributed voice files from Marketplace."
        },
        new("xtts-v2", "XTTS v2", "Multilingual local speech with reference-audio cloning.", "Coqui TTS / PyTorch", "Coqui Public Model License", "Model-dependent", false, false, "https://github.com/coqui-ai/TTS")
        {
            SupportsStreaming = true, SupportsVoiceCloning = true, SupportsEmotion = false, AvailabilityNote = "Review the upstream license and model terms before installation."
        }
    ];

    public static IReadOnlyList<CloudVoiceProviderDefinition> CloudProviders { get; } =
    [
        new("elevenlabs", "ElevenLabs", "eleven_v4", "21m00Tcm4TlvDq8ikWAM", "https://api.elevenlabs.io/v1/text-to-speech", "Expressive hosted TTS with voice library, cloning, and streaming models.", "https://elevenlabs.io/docs/api-reference/text-to-speech/convert")
        {
            SupportsStreaming = true,
        },
        new("inworld", "Inworld Realtime TTS-2", "inworld-tts-2", "Ashley", "https://api.inworld.ai/v1/audio/speech", "OpenAI-compatible hosted speech optimized for realtime conversational turns.", "https://docs.inworld.ai/tts/tts-models")
        {
            SupportsStreaming = true,
        },
        new("cartesia", "Cartesia Sonic 3.5", "sonic-3.5", "f786b574-daa5-4673-aa0c-cbe3e8534c02", "https://api.cartesia.ai/tts/bytes", "Low-latency hosted speech through Cartesia's Sonic family.", "https://docs.cartesia.ai/api-reference/tts/bytes")
        {
            SupportsStreaming = true,
        },
    ];

    public static VoiceModelDefinition Resolve(string? id) =>
        All.FirstOrDefault(model => model.Id.Equals(id, StringComparison.OrdinalIgnoreCase)) ?? All[0];
}
