using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;

namespace SkaiDesktop.AgentHost.Protocol;

/// <summary>Installs and runs a checksum-pinned, offline Whisper large-v3 model.</summary>
internal static class WhisperVoiceRuntime
{
    private const string Revision = "edaa852ec7e145841d8ffdb056a99866b5f0a478";
    private const string AudioDecoder = "av==18.1.0";
    private const string ModelHash = "69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1";
    private const string ConfigHash = "a9306624f5ec14270a014b647e5c316b6e03a662c369758d1b90697a7b0655b9";
    private const string PreprocessorHash = "7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711";
    private const string TokenizerHash = "6d8cbd7cd0d8d5815e478dac67b85a26bbe77c1f5e0c6d76d1ce2abc0e5f21ca";
    private const string VocabularyHash = "c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1";
    private static readonly string[] ModelFiles = ["config.json", "model.bin", "preprocessor_config.json", "tokenizer.json", "vocabulary.json"];
    private static readonly string[] ModelHashes = [ConfigHash, ModelHash, PreprocessorHash, TokenizerHash, VocabularyHash];
    private const string ModelBase = $"https://huggingface.co/Systran/faster-whisper-large-v3/resolve/{Revision}/";
    private static readonly object Gate = new();
    private static readonly object TranscriptionGate = new();
    private static readonly Dictionary<string, CancellationTokenSource> ActiveTranscriptions = [];
    private static readonly Dictionary<string, DateTimeOffset> PendingTranscriptionCancellations = [];
    private static readonly Dictionary<string, DateTimeOffset> CompletedTranscriptions = [];
    private static Task? installTask;
    private static string installState = "not-installed";
    private static string installStep = "";
    private static string? installError;

    private static string Root => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData, Environment.SpecialFolderOption.Create), "Skai", "Voice", "WhisperLargeV3");
    private static string ModelRoot => Path.Combine(Root, "model");
    private static string PythonPath => Path.Combine(Root, "venv", OperatingSystem.IsWindows() ? "Scripts/python.exe" : "bin/python");
    public static bool IsInstalled => File.Exists(PythonPath) && ModelFiles.All(file => File.Exists(Path.Combine(ModelRoot, file))) &&
        File.Exists(Path.Combine(Root, "installed.json")) && File.ReadAllText(Path.Combine(Root, "installed.json")).Contains($"\"audioDecoder\":\"{AudioDecoder}\"", StringComparison.Ordinal);

    public static object StartInstall()
    {
        lock (Gate)
        {
            if (IsInstalled) return Snapshot();
            if (installTask is { IsCompleted: false }) return Snapshot();
            installState = "installing"; installStep = "Preparing isolated Python runtime"; installError = null;
            installTask = Task.Run(InstallAsync);
            return Snapshot();
        }
    }

    public static object Snapshot()
    {
        lock (Gate) return new { installed = IsInstalled, status = IsInstalled ? "installed" : installState, step = installStep, error = installError, modelSizeBytes = 3_087_284_237L };
    }

    public static (bool Requested, bool WasRunning) CancelTranscription(string operationId)
    {
        if (!Guid.TryParse(operationId, out var parsed)) return (false, false);
        var id = parsed.ToString("D");
        lock (TranscriptionGate)
        {
            PruneTranscriptionIds();
            if (ActiveTranscriptions.TryGetValue(id, out var active))
            {
                active.Cancel();
                return (true, true);
            }
            if (CompletedTranscriptions.ContainsKey(id)) return (false, false);
            if (PendingTranscriptionCancellations.Count >= 64)
                PendingTranscriptionCancellations.Remove(PendingTranscriptionCancellations.MinBy(item => item.Value).Key);
            PendingTranscriptionCancellations[id] = DateTimeOffset.UtcNow;
            return (true, false);
        }
    }

    public static async Task<object> TranscribeAsync(string audioBase64, string fileName, string? language, string? operationId = null)
    {
        if (!IsInstalled) throw new InvalidOperationException("Install Whisper large-v3 from Marketplace before transcribing audio.");
        if (audioBase64.Length is < 4 or > 28_000_000) throw new InvalidOperationException("Choose an audio file smaller than 20 MB.");
        var extension = Path.GetExtension(fileName).ToLowerInvariant();
        if (extension is not (".mp3" or ".m4a" or ".ogg" or ".wav" or ".webm")) throw new InvalidOperationException("Whisper accepts MP3, M4A, OGG, WAV, and WebM audio files.");
        var safeLanguage = NormalizeLanguage(language);
        byte[] audio;
        try { audio = Convert.FromBase64String(audioBase64); }
        catch (FormatException error) { throw new InvalidOperationException("The local audio encoding is invalid.", error); }
        if (audio.Length is < 16 or > 20 * 1024 * 1024) throw new InvalidOperationException("Choose an audio file smaller than 20 MB.");
        var id = RegisterTranscription(operationId, out var cancellation);
        var cancellationToken = cancellation?.Token ?? CancellationToken.None;
        var temporaryAudio = Path.Combine(Path.GetTempPath(), $"skai-whisper-{Guid.NewGuid():N}{extension}");
        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            await File.WriteAllBytesAsync(temporaryAudio, audio, cancellationToken).ConfigureAwait(false);
        }
        catch
        {
            try { File.Delete(temporaryAudio); } catch { }
            CompleteTranscription(id, cancellation);
            throw;
        }
        try
        {
            const string script = "import json, sys\nfrom faster_whisper import WhisperModel\nmodel_path, audio_path, language = sys.argv[1:]\nmodel = WhisperModel(model_path, device='cpu', compute_type='int8', cpu_threads=min(4, max(1, (__import__('os').cpu_count() or 2)//2)))\nsegments, info = model.transcribe(audio_path, language=language or None, beam_size=5, vad_filter=False)\ntext = ' '.join(segment.text.strip() for segment in segments).strip()\nprint('SKAI_WHISPER_RESULT:' + json.dumps({'text': text, 'language': info.language}, ensure_ascii=False))\n";
            var result = await RunAsync(PythonPath, ["-u", "-c", script, ModelRoot, temporaryAudio, safeLanguage], TimeSpan.FromMinutes(30), offline: true, cancellationToken: cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            var payload = result.Split('\n').LastOrDefault(line => line.StartsWith("SKAI_WHISPER_RESULT:", StringComparison.Ordinal));
            if (payload is null) throw new InvalidOperationException("Whisper completed without returning a transcript.");
            using var document = JsonDocument.Parse(payload["SKAI_WHISPER_RESULT:".Length..]);
            var transcript = document.RootElement.GetProperty("text").GetString() ?? "";
            var detectedLanguage = document.RootElement.GetProperty("language").GetString() ?? "unknown";
            if (transcript.Length > 100_000) transcript = transcript[..100_000];
            if (string.IsNullOrWhiteSpace(transcript)) throw new InvalidOperationException("Whisper did not recognize speech in this audio.");
            return new { transcript, language = detectedLanguage, engine = "whisper-large-v3-local" };
        }
        finally
        {
            try { File.Delete(temporaryAudio); } catch { }
            CompleteTranscription(id, cancellation);
        }
    }

    private static string? RegisterTranscription(string? operationId, out CancellationTokenSource? cancellation)
    {
        cancellation = null;
        if (string.IsNullOrWhiteSpace(operationId)) return null;
        if (!Guid.TryParse(operationId, out var parsed)) throw new InvalidOperationException("The audio transcription operation ID is invalid.");
        var id = parsed.ToString("D");
        cancellation = new CancellationTokenSource();
        lock (TranscriptionGate)
        {
            PruneTranscriptionIds();
            if (CompletedTranscriptions.ContainsKey(id) || ActiveTranscriptions.ContainsKey(id))
            {
                cancellation.Dispose();
                cancellation = null;
                throw new InvalidOperationException("The audio transcription operation ID has already been used.");
            }
            if (PendingTranscriptionCancellations.Remove(id))
            {
                CompletedTranscriptions[id] = DateTimeOffset.UtcNow;
                cancellation.Dispose();
                cancellation = null;
                throw new OperationCanceledException("Audio transcription cancelled before it started.");
            }
            ActiveTranscriptions.Add(id, cancellation);
        }
        return id;
    }

    private static void CompleteTranscription(string? id, CancellationTokenSource? cancellation)
    {
        if (id is null || cancellation is null) return;
        lock (TranscriptionGate)
        {
            ActiveTranscriptions.Remove(id);
            CompletedTranscriptions[id] = DateTimeOffset.UtcNow;
            PruneTranscriptionIds();
        }
        cancellation.Dispose();
    }

    private static void PruneTranscriptionIds()
    {
        var expired = DateTimeOffset.UtcNow - TimeSpan.FromMinutes(2);
        foreach (var id in PendingTranscriptionCancellations.Where(item => item.Value < expired).Select(item => item.Key).ToArray())
            PendingTranscriptionCancellations.Remove(id);
        foreach (var id in CompletedTranscriptions.Where(item => item.Value < expired).Select(item => item.Key).ToArray())
            CompletedTranscriptions.Remove(id);
        while (CompletedTranscriptions.Count > 256)
            CompletedTranscriptions.Remove(CompletedTranscriptions.MinBy(item => item.Value).Key);
    }

    private static async Task InstallAsync()
    {
        try
        {
            Directory.CreateDirectory(Root);
            Directory.CreateDirectory(ModelRoot);
            var python = FindPython();
            SetStep("Creating isolated Python environment");
            await RunAsync(python, ["-m", "venv", Path.Combine(Root, "venv")], TimeSpan.FromMinutes(3)).ConfigureAwait(false);
            SetStep("Installing faster-whisper 1.2.1 and compatible PyAV 18.1.0 audio decoder");
            await RunAsync(PythonPath, ["-m", "pip", "install", "--disable-pip-version-check", "--no-input", "faster-whisper==1.2.1", AudioDecoder], TimeSpan.FromMinutes(10)).ConfigureAwait(false);
            for (var index = 0; index < ModelFiles.Length; index++)
            {
                SetStep(index == 1 ? "Downloading 3.09 GB Whisper large-v3 weights" : "Downloading verified Whisper model metadata");
                await DownloadVerifiedAsync(ModelFiles[index], ModelHashes[index]).ConfigureAwait(false);
            }
            SetStep("Checking offline Whisper model load");
            const string check = "import sys; from faster_whisper import WhisperModel; WhisperModel(sys.argv[1], device='cpu', compute_type='int8', cpu_threads=1); print('whisper-ready')";
            var output = await RunAsync(PythonPath, ["-c", check, ModelRoot], TimeSpan.FromMinutes(10), offline: true).ConfigureAwait(false);
            if (!output.Contains("whisper-ready", StringComparison.Ordinal)) throw new InvalidOperationException("Whisper large-v3 did not pass its local runtime check.");
            await File.WriteAllTextAsync(Path.Combine(Root, "installed.json"), JsonSerializer.Serialize(new { runtime = "faster-whisper==1.2.1", audioDecoder = AudioDecoder, model = "Systran/faster-whisper-large-v3", revision = Revision, files = ModelFiles.Select((file, index) => new { file, sha256 = ModelHashes[index] }).ToArray(), installedAtUtc = DateTimeOffset.UtcNow })).ConfigureAwait(false);
            lock (Gate) { installState = "installed"; installStep = "Ready for offline transcription"; }
        }
        catch (Exception error)
        {
            lock (Gate) { installState = "failed"; installStep = "Install failed"; installError = new string(error.Message.Where(c => !char.IsControl(c)).Take(1_000).ToArray()); }
        }
    }

    private static async Task DownloadVerifiedAsync(string fileName, string expectedHash)
    {
        var path = Path.Combine(ModelRoot, fileName);
        if (File.Exists(path) && await HasHashAsync(path, expectedHash).ConfigureAwait(false)) return;
        var temp = path + ".download";
        using var client = new HttpClient { Timeout = TimeSpan.FromHours(3) };
        using var response = await client.GetAsync(new Uri(ModelBase + fileName), HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
        await using (var source = await response.Content.ReadAsStreamAsync().ConfigureAwait(false))
        await using (var destination = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None, 1024 * 1024, useAsync: true))
            await source.CopyToAsync(destination).ConfigureAwait(false);
        if (!await HasHashAsync(temp, expectedHash).ConfigureAwait(false)) { File.Delete(temp); throw new CryptographicException($"The downloaded Whisper file {fileName} did not match its pinned SHA-256 digest."); }
        File.Move(temp, path, overwrite: true);
    }

    private static async Task<bool> HasHashAsync(string path, string expected)
    {
        await using var stream = File.OpenRead(path);
        return Convert.ToHexString(await SHA256.HashDataAsync(stream).ConfigureAwait(false)).Equals(expected, StringComparison.OrdinalIgnoreCase);
    }

    private static string NormalizeLanguage(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "";
        var code = value.Split('-', StringSplitOptions.RemoveEmptyEntries)[0].Trim();
        return code.Length is >= 2 and <= 3 && code.All(char.IsAsciiLetter) ? code.ToLowerInvariant() : "";
    }

    private static string FindPython()
    {
        var names = OperatingSystem.IsWindows() ? new[] { "python.exe", "py.exe" } : new[] { "python3", "python" };
        foreach (var directory in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        foreach (var name in names)
        {
            var path = Path.Combine(directory, name);
            if (File.Exists(path)) return path;
        }
        throw new InvalidOperationException("Install Python 3.10 or newer and add it to PATH to install Whisper large-v3 locally.");
    }

    private static void SetStep(string step) { lock (Gate) installStep = step; }

    private static async Task<string> RunAsync(string executable, IReadOnlyList<string> arguments, TimeSpan timeout, bool offline = false, CancellationToken cancellationToken = default)
    {
        using var process = new Process { StartInfo = new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true } };
        foreach (var argument in arguments) process.StartInfo.ArgumentList.Add(argument);
        if (offline)
        {
            process.StartInfo.Environment["HF_HUB_OFFLINE"] = "1";
            process.StartInfo.Environment["HF_HUB_DISABLE_TELEMETRY"] = "1";
            process.StartInfo.Environment["TRANSFORMERS_OFFLINE"] = "1";
        }
        if (!process.Start()) throw new InvalidOperationException("The local Whisper runtime could not start.");
        process.StandardInput.Close();
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        using var timeoutSource = new CancellationTokenSource(timeout);
        using var linkedSource = CancellationTokenSource.CreateLinkedTokenSource(timeoutSource.Token, cancellationToken);
        try { await process.WaitForExitAsync(linkedSource.Token).ConfigureAwait(false); }
        catch (OperationCanceledException)
        {
            try { process.Kill(entireProcessTree: true); } catch { }
            await process.WaitForExitAsync().ConfigureAwait(false);
            if (cancellationToken.IsCancellationRequested) throw new OperationCanceledException("Audio transcription cancelled.", cancellationToken);
            throw new TimeoutException("Whisper setup or transcription timed out.");
        }
        var output = await stdout.ConfigureAwait(false);
        var error = await stderr.ConfigureAwait(false);
        if (process.ExitCode != 0) throw new InvalidOperationException($"Whisper local step failed: {new string(error.Where(c => !char.IsControl(c)).Take(1_000).ToArray())}");
        return output;
    }
}
