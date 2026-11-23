using System.Runtime.InteropServices;
using System.Security.Cryptography;

namespace SkaiDesktop.Core.Services;

/// <summary>Shared installed-state checks for Marketplace voice adapters.</summary>
public static class VoiceRuntimeStatus
{
    public const string PocketTtsExecutableSha256 = "813cabfc2f8fc7a4e5310deda6025426b3164610dd9f3c3098a6078e5cc1895a";
    private static readonly object PocketTtsIntegrityGate = new();
    private static long pocketTtsCheckedLength = -1;
    private static long pocketTtsCheckedWriteTicks = -1;
    private static bool pocketTtsIntegrityValid;

    public static bool IsPocketTtsSupported => OperatingSystem.IsWindows() && RuntimeInformation.ProcessArchitecture == Architecture.X64;
    public static bool IsQwen3TtsSupported => OperatingSystem.IsWindows() && RuntimeInformation.ProcessArchitecture == Architecture.X64;

    /// <summary>Reports whether the OS speech adapter can start on this host.</summary>
    public static bool IsOsNativeAvailable
    {
        get
        {
            if (OperatingSystem.IsWindows()) return true; // Windows Speech is provided by System.Speech.
            if (!OperatingSystem.IsLinux()) return false;
            var path = Environment.GetEnvironmentVariable("PATH");
            return !string.IsNullOrWhiteSpace(path) && path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries)
                .SelectMany(directory => new[] { "espeak-ng", "espeak", "spd-say" }.Select(name => Path.Combine(directory, name)))
                .Any(File.Exists);
        }
    }

    public static bool IsKokoroInstalled
    {
        get
        {
            var root = GetVoiceRuntimeRoot("Kokoro");
            var python = Path.Combine(root, "venv", OperatingSystem.IsWindows() ? "Scripts/python.exe" : "bin/python");
            return File.Exists(Path.Combine(root, "kokoro-v1.0.int8.onnx"))
                && File.Exists(Path.Combine(root, "voices-v1.0.bin"))
                && File.Exists(python)
                && File.Exists(Path.Combine(root, "installed.json"));
        }
    }

    public static bool IsPiperInstalled
    {
        get
        {
            var root = GetVoiceRuntimeRoot("Piper");
            var python = Path.Combine(root, "venv", OperatingSystem.IsWindows() ? "Scripts/python.exe" : "bin/python");
            return File.Exists(Path.Combine(root, "en_US-hifi_tts_92-medium.onnx"))
                && File.Exists(Path.Combine(root, "en_US-hifi_tts_92-medium.onnx.json"))
                && File.Exists(python)
                && File.Exists(Path.Combine(root, "installed.json"));
        }
    }

    public static bool IsChatterboxInstalled
    {
        get
        {
            var root = GetVoiceRuntimeRoot("ChatterboxNano");
            var python = Path.Combine(root, "venv", OperatingSystem.IsWindows() ? "Scripts/python.exe" : "bin/python");
            return File.Exists(python)
                && new[] { "added_tokens.json", "conds.pt", "merges.txt", "s3gen_meanflow.safetensors", "special_tokens_map.json", "t3_nano_v1.safetensors", "tokenizer_config.json", "ve.safetensors", "vocab.json" }
                    .All(file => File.Exists(Path.Combine(root, file)))
                && File.Exists(Path.Combine(root, "installed.json"));
        }
    }

    public static bool IsPocketTtsInstalled
    {
        get
        {
            if (!IsPocketTtsSupported) return false;
            var root = GetPocketTtsRoot();
            var binaryPath = Path.Combine(root, "pocket-tts.exe");
            if (!File.Exists(Path.Combine(root, "installed.json")) || !File.Exists(binaryPath)) return false;
            var info = new FileInfo(binaryPath);
            lock (PocketTtsIntegrityGate)
            {
                if (info.Length == pocketTtsCheckedLength && info.LastWriteTimeUtc.Ticks == pocketTtsCheckedWriteTicks)
                    return pocketTtsIntegrityValid;
                try
                {
                    using var stream = File.OpenRead(binaryPath);
                    pocketTtsIntegrityValid = Convert.ToHexString(SHA256.HashData(stream)).Equals(PocketTtsExecutableSha256, StringComparison.OrdinalIgnoreCase);
                }
                catch (IOException) { pocketTtsIntegrityValid = false; }
                pocketTtsCheckedLength = info.Length;
                pocketTtsCheckedWriteTicks = info.LastWriteTimeUtc.Ticks;
                return pocketTtsIntegrityValid;
            }
        }
    }

    public static bool IsQwen3TtsInstalled
    {
        get
        {
            var root = GetVoiceRuntimeRoot("Qwen3TTS");
            var python = Path.Combine(root, "venv", OperatingSystem.IsWindows() ? "Scripts/python.exe" : "bin/python");
            return File.Exists(Path.Combine(root, "installed.json"))
                && File.Exists(python)
                && File.Exists(Path.Combine(root, "model", "model.safetensors"))
                && File.Exists(Path.Combine(root, "model", "speech_tokenizer", "model.safetensors"));
        }
    }

    /// <summary>Returns the per-user Pocket TTS directory, with a process-local override for isolated acceptance runs.</summary>
    public static string GetPocketTtsRoot()
    {
        var overridePath = Environment.GetEnvironmentVariable("SKAI_POCKET_TTS_ROOT");
        return !string.IsNullOrWhiteSpace(overridePath) ? Path.GetFullPath(overridePath) : GetVoiceRuntimeRoot("PocketTTS");
    }

    /// <summary>Returns an engine's per-user runtime directory or its child under an isolated test root.</summary>
    public static string GetVoiceRuntimeRoot(string engineDirectory)
    {
        if (engineDirectory is not ("Kokoro" or "Piper" or "ChatterboxNano" or "PocketTTS" or "Qwen3TTS" or "WhisperLargeV3"))
            throw new ArgumentOutOfRangeException(nameof(engineDirectory), "Unknown local voice runtime directory.");
        var isolatedRoot = Environment.GetEnvironmentVariable("SKAI_VOICE_ROOT");
        return !string.IsNullOrWhiteSpace(isolatedRoot)
            ? Path.Combine(Path.GetFullPath(isolatedRoot), engineDirectory)
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData, Environment.SpecialFolderOption.Create), "Skai", "Voice", engineDirectory);
    }
}
