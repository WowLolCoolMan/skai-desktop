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
}
