namespace SkaiDesktop.Core.Services;

/// <summary>Shared installed-state checks for Marketplace voice adapters.</summary>
public static class VoiceRuntimeStatus
{
    public static bool IsKokoroInstalled
    {
        get
        {
            var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData, Environment.SpecialFolderOption.Create), "Skai", "Voice", "Kokoro");
            return File.Exists(Path.Combine(root, "kokoro-v1.0.int8.onnx"))
                && File.Exists(Path.Combine(root, "voices-v1.0.bin"))
                && File.Exists(Path.Combine(root, "installed.json"));
        }
    }

    public static bool IsPiperInstalled
    {
        get
        {
            var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData, Environment.SpecialFolderOption.Create), "Skai", "Voice", "Piper");
            return File.Exists(Path.Combine(root, "en_US-hifi_tts_92-medium.onnx"))
                && File.Exists(Path.Combine(root, "en_US-hifi_tts_92-medium.onnx.json"))
                && File.Exists(Path.Combine(root, "installed.json"));
        }
    }

    public static bool IsChatterboxInstalled
    {
        get
        {
            var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData, Environment.SpecialFolderOption.Create), "Skai", "Voice", "ChatterboxNano");
            var python = Path.Combine(root, "venv", OperatingSystem.IsWindows() ? "Scripts/python.exe" : "bin/python");
            return File.Exists(python)
                && new[] { "added_tokens.json", "conds.pt", "merges.txt", "s3gen_meanflow.safetensors", "special_tokens_map.json", "t3_nano_v1.safetensors", "tokenizer_config.json", "ve.safetensors", "vocab.json" }
                    .All(file => File.Exists(Path.Combine(root, file)))
                && File.Exists(Path.Combine(root, "installed.json"));
        }
    }
}
