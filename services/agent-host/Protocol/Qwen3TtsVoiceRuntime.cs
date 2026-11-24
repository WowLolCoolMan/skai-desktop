using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using SkaiDesktop.Core.Services;

namespace SkaiDesktop.AgentHost.Protocol;

/// <summary>Installs the pinned Qwen3-TTS 0.6B CustomVoice model in a private CPU runtime.</summary>
internal static class Qwen3TtsVoiceRuntime
{
    private const string ModelRevision = "f3d1af06e4eaefac12b1ffa6726f9eef674a6f02";
    private const string ModelId = "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice";
    private const string PythonPackage = "qwen-tts==0.1.1";
    private static readonly object StateGate = new();
    private static readonly SemaphoreSlim WorkerGate = new(1, 1);
    private static readonly string[] Speakers = ["Ryan", "Aiden", "Vivian", "Serena", "Uncle_Fu", "Dylan", "Eric", "Ono_Anna", "Sohee"];
    private static readonly (string Name, long Bytes, string Hash, bool GitBlob)[] ModelFiles =
    [
        ("config.json", 4_908, "5e8d5fc100536984e3a89bd87ef08e59e322b29b", true),
        ("generation_config.json", 245, "1872b16d4535564abf2db5d6debe6cddd82b7f2e", true),
        ("merges.txt", 1_671_839, "20024bfe7c83998e9aeaf98a0cd6a2ce6306c2f0", true),
        ("model.safetensors", 1_811_626_576, "bc3c7e785eb961179c25450d1acff03f839e0002f2f3a5aeb67b5735c0fa2adb", false),
        ("preprocessor_config.json", 127, "0525dd953bb9241912f7147666f0d535165d5d4f", true),
        ("speech_tokenizer/config.json", 2_336, "06cc8dc4c5ec8a1929086b71b98c313020d9268b", true),
        ("speech_tokenizer/configuration.json", 76, "ab58e2eaf53cd14a1a2a7527d9261ceea93a24cd", true),
        ("speech_tokenizer/model.safetensors", 682_293_092, "836b7b357f5ea43e889936a3709af68dfe3751881acefe4ecf0dbd30ba571258", false),
        ("speech_tokenizer/preprocessor_config.json", 234, "ba40914f4f49ab98a8ca545d4892ef7291a39592", true),
        ("tokenizer_config.json", 7_344, "6ff9fd60cc623bb54bbd603cbd418c97a11528d7", true),
        ("vocab.json", 2_776_833, "4783fe10ac3adce15ac8f358ef5462739852c569", true),
    ];
    private static Task? installTask;
    private static Process? worker;
    private static bool verifiedModelFiles;
    private static string installState = "not-installed";
    private static string installStep = "";
    private static string? installError;

    static Qwen3TtsVoiceRuntime() => AppDomain.CurrentDomain.ProcessExit += (_, _) => StopWorker();

    private static string Root => VoiceRuntimeStatus.GetVoiceRuntimeRoot("Qwen3TTS");
    private static string ModelRoot => Path.Combine(Root, "model");
    private static string PythonPath => Path.Combine(Root, "venv", OperatingSystem.IsWindows() ? "Scripts/python.exe" : "bin/python");
    private static string MarkerPath => Path.Combine(Root, "installed.json");
    public static bool IsSupported => OperatingSystem.IsWindows() && RuntimeInformation.ProcessArchitecture == Architecture.X64;
    public static bool IsInstalled => VoiceRuntimeStatus.IsQwen3TtsInstalled;

    public static object StartInstall()
    {
        lock (StateGate)
        {
            if (!IsSupported) return new { installed = false, status = "unavailable", step = "Skai's verified Qwen3-TTS adapter currently supports Windows x64 only.", error = (string?)null };
            if (IsInstalled) return Snapshot();
            if (installTask is { IsCompleted: false }) return Snapshot();
            installState = "installing";
            installStep = "Preparing isolated Python 3.12 CPU runtime";
            installError = null;
            installTask = Task.Run(InstallAsync);
            return Snapshot();
        }
    }

    public static object Snapshot()
    {
        lock (StateGate)
            return new { installed = IsInstalled, status = IsInstalled ? "installed" : IsSupported ? installState : "unavailable", step = installStep, error = installError };
    }

    public static void StopGeneration() => StopWorker();

    public static object RemoveInstall()
    {
        lock (StateGate)
        {
            if (installTask is { IsCompleted: false }) return new { removed = false, status = "busy", error = "Qwen3-TTS is still installing." };
            if (!Directory.Exists(Root)) return new { removed = true, status = "not-installed", error = (string?)null };
            if (!WorkerGate.Wait(0)) return new { removed = false, status = "busy", error = "Qwen3-TTS is being used for speech." };
            try
            {
                StopWorker();
                var fullRoot = Path.GetFullPath(Root);
                var expectedParent = Path.GetFullPath(Environment.GetEnvironmentVariable("SKAI_VOICE_ROOT") is { Length: > 0 } isolated
                    ? isolated
                    : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Skai", "Voice"));
                if (!string.Equals(Path.GetFileName(fullRoot), "Qwen3TTS", StringComparison.OrdinalIgnoreCase)
                    || !string.Equals(Path.GetDirectoryName(fullRoot), expectedParent, OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal))
                    throw new IOException("Refusing to remove Qwen3-TTS data outside its registered voice runtime folder.");
                var directory = new DirectoryInfo(fullRoot);
                if (directory.LinkTarget is not null || (directory.Attributes & FileAttributes.ReparsePoint) != 0)
                    throw new IOException("Refusing to remove a linked Qwen3-TTS runtime directory.");
                Directory.Delete(fullRoot, recursive: true);
                installState = "not-installed";
                installStep = "";
                installError = null;
                verifiedModelFiles = false;
                return new { removed = true, status = "not-installed", error = (string?)null };
            }
            finally { WorkerGate.Release(); }
        }
    }

    public static async Task<string> SynthesizeDataUrlAsync(string text, double rate, string? speaker, int expressiveness)
    {
        if (!IsInstalled) throw new InvalidOperationException("Install Qwen3-TTS 0.6B CustomVoice from Marketplace before selecting it for speech.");
        var selectedSpeaker = Speakers.FirstOrDefault(item => item.Equals(speaker, StringComparison.OrdinalIgnoreCase)) ?? "Ryan";
        var language = LanguageFor(selectedSpeaker);
        await WorkerGate.WaitAsync().ConfigureAwait(false);
        try
        {
            var activeWorker = await EnsureWorkerAsync().ConfigureAwait(false);
            var message = JsonSerializer.Serialize(new { text = text[..Math.Min(text.Length, 1_200)], speaker = selectedSpeaker, language, rate = Math.Clamp(rate, 0.5, 2), expressiveness = Math.Clamp(expressiveness, 0, 100) });
            await activeWorker.StandardInput.WriteLineAsync(message).ConfigureAwait(false);
            await activeWorker.StandardInput.FlushAsync().ConfigureAwait(false);
            string? line;
            try { line = await activeWorker.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromMinutes(3)).ConfigureAwait(false); }
            catch (TimeoutException) { StopWorker(); throw new TimeoutException("Qwen3-TTS exceeded its 3 minute speech limit; its local worker was restarted."); }
            if (line is null) { StopWorker(); throw new InvalidOperationException("The Qwen3-TTS worker exited before returning speech."); }
            using var result = JsonDocument.Parse(line);
            if (result.RootElement.TryGetProperty("error", out var error))
                throw new InvalidOperationException($"Qwen3-TTS speech failed: {Bound(error.GetString(), 500)}");
            if (!result.RootElement.TryGetProperty("audio", out var audio) || audio.ValueKind != JsonValueKind.String)
                throw new InvalidOperationException("Qwen3-TTS returned an invalid audio response.");
            var bytes = Convert.FromBase64String(audio.GetString()!);
            if (bytes.Length < 44 || !bytes.AsSpan(0, 4).SequenceEqual("RIFF"u8) || !bytes.AsSpan(8, 4).SequenceEqual("WAVE"u8))
                throw new InvalidDataException("Qwen3-TTS returned an invalid WAV sample.");
            return "data:audio/wav;base64," + Convert.ToBase64String(bytes);
        }
        finally { WorkerGate.Release(); }
    }

    private static async Task InstallAsync()
    {
        try
        {
            Directory.CreateDirectory(Root);
            var drive = DriveInfo.GetDrives().FirstOrDefault(item => Path.GetFullPath(Root).StartsWith(item.RootDirectory.FullName, StringComparison.OrdinalIgnoreCase));
            if (drive is not null && drive.AvailableFreeSpace < 8L * 1024 * 1024 * 1024)
                throw new InvalidOperationException("Qwen3-TTS needs at least 8 GB of free disk space for its isolated CPU runtime and 2.5 GB model.");

            var python = FindPython312();
            SetStep("Creating isolated Python 3.12 environment");
            await RunAsync(python, ["-m", "venv", Path.Combine(Root, "venv")], TimeSpan.FromMinutes(3)).ConfigureAwait(false);
            SetStep("Installing pinned CPU PyTorch 2.6");
            await RunAsync(PythonPath, ["-m", "pip", "install", "--disable-pip-version-check", "--no-input", "--no-cache-dir", "torch==2.6.0+cpu", "torchaudio==2.6.0+cpu", "--index-url", "https://download.pytorch.org/whl/cpu"], TimeSpan.FromMinutes(15)).ConfigureAwait(false);
            SetStep("Installing Qwen3-TTS and its isolated inference dependencies");
            var constraintsPath = Path.Combine(Root, "constraints.txt");
            await File.WriteAllTextAsync(constraintsPath, "torch==2.6.0+cpu\ntorchaudio==2.6.0+cpu\ntransformers==4.57.3\naccelerate==1.12.0\n").ConfigureAwait(false);
            await RunAsync(PythonPath, ["-m", "pip", "install", "--disable-pip-version-check", "--no-input", "--no-cache-dir", "--constraint", constraintsPath, PythonPackage], TimeSpan.FromMinutes(25)).ConfigureAwait(false);

            SetStep("Downloading the pinned 2.5 GB Qwen3-TTS 0.6B model");
            Directory.CreateDirectory(ModelRoot);
            const string downloadScript = "import sys; from huggingface_hub import snapshot_download; snapshot_download(repo_id='Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice', revision='f3d1af06e4eaefac12b1ffa6726f9eef674a6f02', local_dir=sys.argv[1], allow_patterns=['config.json','generation_config.json','merges.txt','model.safetensors','preprocessor_config.json','speech_tokenizer/*','tokenizer_config.json','vocab.json'])";
            await RunAsync(PythonPath, ["-c", downloadScript, ModelRoot], TimeSpan.FromMinutes(45)).ConfigureAwait(false);
            SetStep("Verifying pinned model files and loading the local voice");
            await VerifyModelFilesAsync().ConfigureAwait(false);
            verifiedModelFiles = true;
            await WorkerGate.WaitAsync().ConfigureAwait(false);
            try
            {
                var activeWorker = await EnsureWorkerAsync().ConfigureAwait(false);
                await activeWorker.StandardInput.WriteLineAsync(JsonSerializer.Serialize(new { text = "Skai local speech is ready.", speaker = "Ryan", language = "English", rate = 1.0, expressiveness = 50 })).ConfigureAwait(false);
                await activeWorker.StandardInput.FlushAsync().ConfigureAwait(false);
                var sample = await activeWorker.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromMinutes(5)).ConfigureAwait(false)
                    ?? throw new InvalidOperationException("Qwen3-TTS exited before its local synthesis check.");
                using var result = JsonDocument.Parse(sample);
                if (!result.RootElement.TryGetProperty("audio", out var audio) || audio.ValueKind != JsonValueKind.String
                    || !Convert.FromBase64String(audio.GetString()!).AsSpan().StartsWith("RIFF"u8))
                    throw new InvalidOperationException("Qwen3-TTS failed its local WAV synthesis check.");
                StopWorker();
            }
            finally { WorkerGate.Release(); }

            await File.WriteAllTextAsync(MarkerPath, JsonSerializer.Serialize(new
            {
                engine = "Qwen3-TTS 0.6B CustomVoice",
                package = PythonPackage,
                pytorch = "2.6.0+cpu",
                model = ModelId,
                revision = ModelRevision,
                license = "Apache-2.0",
                installedAtUtc = DateTimeOffset.UtcNow,
            })).ConfigureAwait(false);
            lock (StateGate) { installState = "installed"; installStep = "Ready for offline multilingual speech"; }
        }
        catch (Exception error)
        {
            StopWorker();
            lock (StateGate) { installState = "failed"; installStep = "Install failed"; installError = Bound(error.Message, 1_000); }
        }
    }

    private static async Task<Process> EnsureWorkerAsync()
    {
        if (worker is { HasExited: false }) return worker;
        StopWorker();
        if (!verifiedModelFiles) { await VerifyModelFilesAsync().ConfigureAwait(false); verifiedModelFiles = true; }
        var start = new ProcessStartInfo(PythonPath)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            WorkingDirectory = Root,
        };
        start.ArgumentList.Add("-u");
        start.ArgumentList.Add("-c");
        start.ArgumentList.Add(WorkerScript);
        start.ArgumentList.Add(ModelRoot);
        start.Environment["HF_HUB_OFFLINE"] = "1";
        start.Environment["HF_HUB_DISABLE_TELEMETRY"] = "1";
        start.Environment["TRANSFORMERS_OFFLINE"] = "1";
        var candidate = new Process { StartInfo = start, EnableRaisingEvents = true };
        var diagnostics = new StringBuilder();
        candidate.ErrorDataReceived += (_, eventArgs) =>
        {
            if (eventArgs.Data is null) return;
            lock (diagnostics) { diagnostics.AppendLine(eventArgs.Data); if (diagnostics.Length > 4_000) diagnostics.Remove(0, diagnostics.Length - 4_000); }
        };
        if (!candidate.Start()) throw new InvalidOperationException("The Qwen3-TTS worker could not start.");
        worker = candidate;
        candidate.BeginErrorReadLine();
        string? ready;
        try { ready = await candidate.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromMinutes(5)).ConfigureAwait(false); }
        catch
        {
            if (ReferenceEquals(worker, candidate)) worker = null;
            try { candidate.Kill(entireProcessTree: true); } catch { }
            candidate.Dispose();
            throw;
        }
        if (ready is null || !ready.Contains("\"ready\": true", StringComparison.Ordinal))
        {
            if (ReferenceEquals(worker, candidate)) worker = null;
            try { candidate.Kill(entireProcessTree: true); } catch { }
            candidate.Dispose();
            var reason = "Qwen3-TTS could not load its verified local 0.6B model.";
            lock (diagnostics) if (diagnostics.Length > 0) reason += $" {Bound(diagnostics.ToString(), 1_500)}";
            throw new InvalidOperationException(reason);
        }
        return candidate;
    }

    private static async Task VerifyModelFilesAsync()
    {
        foreach (var file in ModelFiles)
        {
            var path = Path.Combine(ModelRoot, file.Name.Replace('/', Path.DirectorySeparatorChar));
            if (!File.Exists(path) || new FileInfo(path).Length != file.Bytes || !await HasHashAsync(path, file.Hash, file.GitBlob).ConfigureAwait(false))
                throw new CryptographicException($"The local Qwen3-TTS file {file.Name} is missing or failed its pinned digest check. Reinstall Qwen3-TTS from Marketplace.");
        }
    }

    private static async Task<bool> HasHashAsync(string path, string expected, bool gitBlob)
    {
        await using var stream = File.OpenRead(path);
        if (!gitBlob) return Convert.ToHexString(await SHA256.HashDataAsync(stream).ConfigureAwait(false)).Equals(expected, StringComparison.OrdinalIgnoreCase);
        using var memory = new MemoryStream();
        await stream.CopyToAsync(memory).ConfigureAwait(false);
        var content = memory.ToArray();
        using var sha1 = SHA1.Create();
        return Convert.ToHexString(sha1.ComputeHash(Encoding.ASCII.GetBytes($"blob {content.Length}\0").Concat(content).ToArray())).Equals(expected, StringComparison.OrdinalIgnoreCase);
    }

    private static string FindPython312()
    {
        foreach (var directory in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        foreach (var name in OperatingSystem.IsWindows() ? new[] { "python.exe", "py.exe" } : new[] { "python3", "python" })
        {
            var candidate = Path.Combine(directory, name);
            if (!File.Exists(candidate)) continue;
            var prefix = name == "py.exe" ? new[] { "-3.12" } : [];
            try
            {
                var output = RunAsync(candidate, [.. prefix, "-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"], TimeSpan.FromSeconds(10)).GetAwaiter().GetResult().Trim();
                if (output == "3.12") return candidate;
            }
            catch { }
        }
        throw new InvalidOperationException("Qwen3-TTS requires Python 3.12 on Windows x64. Install Python 3.12 and add it to PATH, then retry from Marketplace.");
    }

    private static async Task<string> RunAsync(string executable, IReadOnlyList<string> arguments, TimeSpan timeout)
    {
        using var process = new Process { StartInfo = new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true } };
        foreach (var argument in arguments) process.StartInfo.ArgumentList.Add(argument);
        if (!process.Start()) throw new InvalidOperationException("A Qwen3-TTS setup process could not start.");
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        using var timeoutSource = new CancellationTokenSource(timeout);
        try { await process.WaitForExitAsync(timeoutSource.Token).ConfigureAwait(false); }
        catch (OperationCanceledException) { try { process.Kill(entireProcessTree: true); } catch { } throw new TimeoutException("A Qwen3-TTS setup step timed out."); }
        var output = await stdout.ConfigureAwait(false);
        var error = await stderr.ConfigureAwait(false);
        if (process.ExitCode != 0) throw new InvalidOperationException($"Qwen3-TTS local setup failed: {Bound(error, 1_000)}");
        return output;
    }

    private static string LanguageFor(string speaker) => speaker switch
    {
        "Ryan" or "Aiden" => "English",
        "Vivian" or "Serena" or "Uncle_Fu" => "Chinese",
        "Dylan" => "Chinese",
        "Eric" => "Chinese",
        "Ono_Anna" => "Japanese",
        "Sohee" => "Korean",
        _ => "English",
    };

    private static void SetStep(string step) { lock (StateGate) installStep = step; }
    private static string Bound(string? value, int max) => new((value ?? "Unknown error.").Where(character => !char.IsControl(character) || character is '\r' or '\n' or '\t').Take(max).ToArray());

    private static void StopWorker()
    {
        var active = worker;
        worker = null;
        if (active is null) return;
        try { if (!active.HasExited) active.Kill(entireProcessTree: true); } catch { }
        try { active.WaitForExit(3_000); } catch { }
        active.Dispose();
    }

    private const string WorkerScript = """
import base64, contextlib, io, json, sys
with contextlib.redirect_stdout(sys.stderr):
 import soundfile as sf
 import torch
 from qwen_tts import Qwen3TTSModel
 model = Qwen3TTSModel.from_pretrained(sys.argv[1], device_map="cpu", dtype=torch.float32, trust_remote_code=False)
print(json.dumps({'ready': True}), flush=True)
for line in sys.stdin:
 try:
  request=json.loads(line)
  with contextlib.redirect_stdout(sys.stderr):
   amount=max(0.0, min(1.0, float(request.get('expressiveness', 50))/100.0))
   wavs, sample_rate=model.generate_custom_voice(text=request['text'], speaker=request['speaker'], language=request['language'], do_sample=True, temperature=0.72 + amount*0.38, top_p=0.82 + amount*0.16, non_streaming_mode=True)
   audio=wavs[0]
   buffer=io.BytesIO()
   sf.write(buffer, audio, sample_rate, format='WAV', subtype='PCM_16')
  print(json.dumps({'audio':base64.b64encode(buffer.getvalue()).decode('ascii')}), flush=True)
 except Exception as error:
  print(json.dumps({'error':str(error)[:500]}), flush=True)
""";
}
