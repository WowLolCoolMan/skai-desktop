using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace SkaiDesktop.AgentHost.Protocol;

/// <summary>Installs the pinned Chatterbox Nano checkpoint and keeps its CPU worker warm.</summary>
internal static class ChatterboxVoiceRuntime
{
    private const string Revision = "b2e3ed5d1fddc76f715c4135b954b1f7727f6b24";
    private const string SourceCommit = "ab55923c27757c90cfcc407baa57dc25a7d25217";
    private const string ModelId = "ResembleAI/chatterbox-nano";
    private const string ModelBase = $"https://huggingface.co/{ModelId}/resolve/{Revision}/";
    private static readonly (string Name, string Hash, bool GitBlob, long Bytes)[] Files =
    [
        ("added_tokens.json", "fd85325cdfafc690469b6f0e8aeb5cf4649c1450", true, 418),
        ("conds.pt", "b1852099306fd6a7814eb9d0bd10186caba7249596cc23868f78a0eefbfa5033", false, 169454),
        ("merges.txt", "226b0752cac7789c48f0cb3ec53eda48b7be36cc", true, 456318),
        ("s3gen_meanflow.safetensors", "d65cb687a2ed581ee6cc297e919ffefa63386944f42364ae13b78a594945514f", false, 1064875036),
        ("special_tokens_map.json", "b2d2dbc845800c78fe98656af927d831ab4ff7b7", true, 470),
        ("t3_nano_v1.safetensors", "72b110185087d945dbdf54dee4e333848e1811bdd5fd6cb16ceb8da50006f0c9", false, 869899204),
        ("tokenizer_config.json", "58bc759ea7dab3dd5442f0500e493f170eeba67f", true, 3878),
        ("ve.safetensors", "f0921cab452fa278bc25cd23ffd59d36f816d7dc5181dd1bef9751a7fb61f63c", false, 5695784),
        ("vocab.json", "a15dd0028acd1dd2c1c2394c80e1de8f3f12a0e4", true, 999186),
    ];
    private static readonly SemaphoreSlim WorkerGate = new(1, 1);
    private static readonly object StateGate = new();
    private static Task? installTask;
    private static Process? worker;
    private static bool verifiedModelFiles;
    private static string installState = "not-installed";
    private static string installStep = "";
    private static string? installError;

    static ChatterboxVoiceRuntime() => AppDomain.CurrentDomain.ProcessExit += (_, _) => StopWorker();

    private static string Root => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData, Environment.SpecialFolderOption.Create), "Skai", "Voice", "ChatterboxNano");
    private static string ModelPath(string file) => Path.Combine(Root, file);
    private static string PythonPath => Path.Combine(Root, "venv", OperatingSystem.IsWindows() ? "Scripts/python.exe" : "bin/python");
    private static string MarkerPath => Path.Combine(Root, "installed.json");
    public static bool IsInstalled => File.Exists(MarkerPath) && File.Exists(PythonPath) && Files.All(file => File.Exists(ModelPath(file.Name)));

    public static object StartInstall()
    {
        lock (StateGate)
        {
            if (IsInstalled) return Snapshot();
            if (installTask is { IsCompleted: false }) return Snapshot();
            installState = "installing";
            installStep = "Preparing isolated CPU runtime";
            installError = null;
            installTask = Task.Run(InstallAsync);
            return Snapshot();
        }
    }

    public static object Snapshot()
    {
        lock (StateGate) return new { installed = IsInstalled, status = IsInstalled ? "installed" : installState, step = installStep, error = installError };
    }

    public static async Task<string> SynthesizeDataUrlAsync(string text, double rate)
    {
        if (!IsInstalled) throw new InvalidOperationException("Install Chatterbox Nano from Marketplace before selecting it for speech.");
        await WorkerGate.WaitAsync().ConfigureAwait(false);
        try
        {
            var activeWorker = await EnsureWorkerAsync().ConfigureAwait(false);
            var message = JsonSerializer.Serialize(new { text = text[..Math.Min(text.Length, 4_000)] });
            await activeWorker.StandardInput.WriteLineAsync(message).ConfigureAwait(false);
            await activeWorker.StandardInput.FlushAsync().ConfigureAwait(false);
            string? line;
            try { line = await activeWorker.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromMinutes(3)).ConfigureAwait(false); }
            catch (TimeoutException) { StopWorker(); throw new TimeoutException("Chatterbox speech exceeded its 3 minute time limit; the worker was restarted."); }
            if (line is null) { StopWorker(); throw new InvalidOperationException("The Chatterbox worker exited before returning speech."); }
            using var result = JsonDocument.Parse(line);
            if (result.RootElement.TryGetProperty("error", out var error))
                throw new InvalidOperationException($"Chatterbox speech failed: {Bound(error.GetString(), 500)}");
            if (!result.RootElement.TryGetProperty("audio", out var audio) || audio.ValueKind != JsonValueKind.String)
                throw new InvalidOperationException("Chatterbox returned an invalid audio response.");
            var bytes = Convert.FromBase64String(audio.GetString()!);
            if (bytes.Length < 44 || !bytes.AsSpan(0, 4).SequenceEqual("RIFF"u8) || !bytes.AsSpan(8, 4).SequenceEqual("WAVE"u8))
                throw new InvalidOperationException("Chatterbox returned an invalid WAV sample.");
            return "data:audio/wav;base64," + Convert.ToBase64String(bytes);
        }
        finally { WorkerGate.Release(); }
    }

    private static async Task InstallAsync()
    {
        try
        {
            Directory.CreateDirectory(Root);
            if (DriveInfo.GetDrives().FirstOrDefault(drive => Path.GetFullPath(Root).StartsWith(drive.RootDirectory.FullName, StringComparison.OrdinalIgnoreCase)) is { } drive
                && drive.AvailableFreeSpace < 6L * 1024 * 1024 * 1024)
                throw new InvalidOperationException("Chatterbox Nano needs about 2 GB for model weights and at least 6 GB of free disk space for its CPU runtime and setup files.");

            var python = FindPython();
            SetStep("Creating isolated Python environment");
            await RunAsync(python.Executable, [.. python.PrefixArguments, "-m", "venv", Path.Combine(Root, "venv")], TimeSpan.FromMinutes(3)).ConfigureAwait(false);
            SetStep("Installing CPU PyTorch and pinned Chatterbox dependencies");
            await RunAsync(PythonPath, ["-m", "pip", "install", "--disable-pip-version-check", "--no-input", "torch==2.6.0+cpu", "torchaudio==2.6.0+cpu", "--extra-index-url", "https://download.pytorch.org/whl/cpu"], TimeSpan.FromMinutes(15)).ConfigureAwait(false);
            var numpyVersion = python.Version.Minor >= 13 ? "numpy==2.2.6" : "numpy==1.26.4";
            await RunAsync(PythonPath, ["-m", "pip", "install", "--disable-pip-version-check", "--no-input",
                numpyVersion, "librosa==0.11.0", "s3tokenizer==0.3.0", "transformers==5.2.0", "diffusers==0.29.0",
                "conformer==0.3.2", "safetensors==0.5.3", "pyloudnorm==0.1.1", "omegaconf==2.3.0", "soundfile==0.13.1",
                "git+https://github.com/resemble-ai/Perth.git@ff1c8ac55a976971245cdd53c18d6131ca00d993"], TimeSpan.FromMinutes(20)).ConfigureAwait(false);
            await RunAsync(PythonPath, ["-m", "pip", "install", "--disable-pip-version-check", "--no-input", "--force-reinstall", "--no-deps", $"git+https://github.com/resemble-ai/chatterbox.git@{SourceCommit}"], TimeSpan.FromMinutes(5)).ConfigureAwait(false);

            SetStep("Downloading and verifying the pinned 1.9 GB Nano checkpoint");
            for (var index = 0; index < Files.Length; index++)
            {
                SetStep($"Downloading pinned model files ({index + 1}/{Files.Length})");
                await DownloadVerifiedAsync(Files[index]).ConfigureAwait(false);
            }

            SetStep("Loading the local model and synthesizing a verification sample");
            var warmWorker = await EnsureWorkerAsync().ConfigureAwait(false);
            await warmWorker.StandardInput.WriteLineAsync(JsonSerializer.Serialize(new { text = "Skai local speech is ready.", rate = 1.0 })).ConfigureAwait(false);
            await warmWorker.StandardInput.FlushAsync().ConfigureAwait(false);
            var sample = await warmWorker.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromMinutes(8)).ConfigureAwait(false)
                ?? throw new InvalidOperationException("Chatterbox exited before its local synthesis check.");
            using (var sampleJson = JsonDocument.Parse(sample))
            {
                if (sampleJson.RootElement.TryGetProperty("error", out var error)) throw new InvalidOperationException($"Chatterbox verification synthesis failed: {Bound(error.GetString(), 500)}");
                if (!sampleJson.RootElement.TryGetProperty("audio", out var audio) || audio.ValueKind != JsonValueKind.String || Convert.FromBase64String(audio.GetString()!).Length < 44)
                    throw new InvalidOperationException("Chatterbox did not produce a valid verification sample.");
            }
            await File.WriteAllTextAsync(MarkerPath, JsonSerializer.Serialize(new { model = ModelId, revision = Revision, runtime = $"chatterbox-tts@{SourceCommit}", torch = "2.6.0+cpu", installedAtUtc = DateTimeOffset.UtcNow })).ConfigureAwait(false);
            lock (StateGate) { installState = "installed"; installStep = "Ready for local speech"; }
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
        if (!verifiedModelFiles)
        {
            foreach (var file in Files)
            {
                var path = ModelPath(file.Name);
                if (!File.Exists(path) || new FileInfo(path).Length != file.Bytes || !await HasHashAsync(path, file.Hash, file.GitBlob).ConfigureAwait(false))
                    throw new CryptographicException($"The local Chatterbox file {file.Name} is missing or failed its pinned digest check. Reinstall Chatterbox Nano from Marketplace.");
            }
            verifiedModelFiles = true;
        }
        var start = new ProcessStartInfo(PythonPath)
        {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        start.ArgumentList.Add("-u");
        start.ArgumentList.Add("-c");
        start.ArgumentList.Add(WorkerScript);
        start.ArgumentList.Add(Root);
        start.Environment["HF_HUB_OFFLINE"] = "1";
        start.Environment["HF_HUB_DISABLE_TELEMETRY"] = "1";
        start.Environment["TRANSFORMERS_OFFLINE"] = "1";
        var candidate = new Process { StartInfo = start, EnableRaisingEvents = true };
        var diagnostics = new StringBuilder();
        candidate.ErrorDataReceived += (_, eventArgs) =>
        {
            if (eventArgs.Data is null) return;
            lock (diagnostics)
            {
                diagnostics.AppendLine(eventArgs.Data);
                if (diagnostics.Length > 4_000) diagnostics.Remove(0, diagnostics.Length - 4_000);
            }
        };
        if (!candidate.Start()) throw new InvalidOperationException("The local Chatterbox worker could not start.");
        candidate.BeginErrorReadLine();
        string? ready;
        try { ready = await candidate.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromMinutes(8)).ConfigureAwait(false); }
        catch
        {
            try { candidate.Kill(entireProcessTree: true); } catch { }
            candidate.Dispose();
            throw;
        }
        if (ready is null || !ready.Contains("\"ready\": true", StringComparison.Ordinal))
        {
            try { candidate.Kill(entireProcessTree: true); } catch { }
            candidate.Dispose();
            var reason = "Chatterbox could not load its checksum-verified local Nano weights.";
            lock (diagnostics) if (diagnostics.Length > 0) reason += $" {Bound(diagnostics.ToString(), 1_500)}";
            throw new InvalidOperationException(reason);
        }
        worker = candidate;
        return candidate;
    }

    private static async Task DownloadVerifiedAsync((string Name, string Hash, bool GitBlob, long Bytes) file)
    {
        var path = ModelPath(file.Name);
        if (File.Exists(path) && new FileInfo(path).Length == file.Bytes && await HasHashAsync(path, file.Hash, file.GitBlob).ConfigureAwait(false)) return;
        var temp = path + ".download";
        var partialBytes = File.Exists(temp) ? new FileInfo(temp).Length : 0;
        if (partialBytes > file.Bytes) { File.Delete(temp); partialBytes = 0; }
        using var client = new HttpClient { Timeout = TimeSpan.FromMinutes(30) };
        using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(ModelBase + Uri.EscapeDataString(file.Name)));
        if (partialBytes > 0) request.Headers.Range = new System.Net.Http.Headers.RangeHeaderValue(partialBytes, null);
        using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false);
        var append = partialBytes > 0 && response.StatusCode == System.Net.HttpStatusCode.PartialContent
            && response.Content.Headers.ContentRange?.From == partialBytes;
        if (response.StatusCode == System.Net.HttpStatusCode.PartialContent && !append)
        { File.Delete(temp); throw new InvalidDataException($"The Chatterbox file {file.Name} returned an invalid resume range."); }
        if (response.StatusCode is not (System.Net.HttpStatusCode.OK or System.Net.HttpStatusCode.PartialContent)) response.EnsureSuccessStatusCode();
        if (!append) partialBytes = 0;
        if (response.Content.Headers.ContentLength is { } contentLength && contentLength != file.Bytes - partialBytes)
        { try { File.Delete(temp); } catch { } throw new InvalidDataException($"The Chatterbox file {file.Name} had an unexpected size."); }
        await using (var source = await response.Content.ReadAsStreamAsync().ConfigureAwait(false))
        await using (var destination = new FileStream(temp, append ? FileMode.Append : FileMode.Create, FileAccess.Write, FileShare.None, 1024 * 256, useAsync: true))
        {
            var buffer = new byte[1024 * 256];
            var total = partialBytes;
            int read;
            while ((read = await source.ReadAsync(buffer).ConfigureAwait(false)) > 0)
            {
                total += read;
                if (total > file.Bytes) { try { File.Delete(temp); } catch { } throw new InvalidDataException($"The Chatterbox file {file.Name} exceeded its pinned size."); }
                await destination.WriteAsync(buffer.AsMemory(0, read)).ConfigureAwait(false);
            }
            if (total != file.Bytes) throw new IOException($"The Chatterbox file {file.Name} was interrupted; its partial download is retained for retry.");
        }
        if (!await HasHashAsync(temp, file.Hash, file.GitBlob).ConfigureAwait(false))
        { try { File.Delete(temp); } catch { } throw new CryptographicException($"The downloaded Chatterbox file {file.Name} did not match its pinned digest."); }
        File.Move(temp, path, overwrite: true);
    }

    private static async Task<bool> HasHashAsync(string path, string expected, bool gitBlob)
    {
        await using var stream = File.OpenRead(path);
        byte[] hash;
        if (gitBlob)
        {
            using var memory = new MemoryStream();
            await stream.CopyToAsync(memory).ConfigureAwait(false);
            var content = memory.ToArray();
            using var sha1 = SHA1.Create();
            hash = sha1.ComputeHash(Encoding.ASCII.GetBytes($"blob {content.Length}\0").Concat(content).ToArray());
        }
        else hash = await SHA256.HashDataAsync(stream).ConfigureAwait(false);
        return Convert.ToHexString(hash).Equals(expected, StringComparison.OrdinalIgnoreCase);
    }

    private sealed record PythonSelection(string Executable, string[] PrefixArguments, Version Version);

    private static PythonSelection FindPython()
    {
        var names = OperatingSystem.IsWindows() ? new[] { "python.exe", "py.exe" } : new[] { "python3", "python" };
        foreach (var directory in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        foreach (var name in names)
        {
            var candidate = Path.Combine(directory, name);
            if (!File.Exists(candidate)) continue;
            var prefix = name == "py.exe" ? new[] { "-3.11" } : [];
            try
            {
                var result = RunAsync(candidate, [.. prefix, "-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"], TimeSpan.FromSeconds(10)).GetAwaiter().GetResult().Trim();
                if (Version.TryParse(result, out var parsed) && parsed >= new Version(3, 10) && parsed < new Version(3, 14)) return new(candidate, prefix, parsed);
            }
            catch { }
        }
        throw new InvalidOperationException("Chatterbox Nano requires Python 3.10–3.13. Install one of those versions and add it to PATH.");
    }

    private static async Task<string> RunAsync(string executable, IReadOnlyList<string> arguments, TimeSpan timeout)
    {
        using var process = new Process { StartInfo = new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true } };
        foreach (var argument in arguments) process.StartInfo.ArgumentList.Add(argument);
        if (!process.Start()) throw new InvalidOperationException("The local Chatterbox setup process could not start.");
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        using var timeoutSource = new CancellationTokenSource(timeout);
        try { await process.WaitForExitAsync(timeoutSource.Token).ConfigureAwait(false); }
        catch (OperationCanceledException) { try { process.Kill(entireProcessTree: true); } catch { } throw new TimeoutException("A Chatterbox setup step timed out."); }
        var output = await stdout.ConfigureAwait(false);
        var error = await stderr.ConfigureAwait(false);
        if (process.ExitCode != 0) throw new InvalidOperationException($"Chatterbox local setup failed: {Bound(error, 1_000)}");
        return output;
    }

    private static void SetStep(string step) { lock (StateGate) installStep = step; }
    private static string Bound(string? value, int length)
    {
        var safe = new string((value ?? "Unknown error.").Where(character => !char.IsControl(character) || character is '\r' or '\n' or '\t').ToArray());
        var profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile, Environment.SpecialFolderOption.DoNotVerify);
        if (!string.IsNullOrWhiteSpace(profile)) safe = safe.Replace(profile, "[user profile]", StringComparison.OrdinalIgnoreCase);
        safe = safe.Replace(Root, "[Skai voice data]", StringComparison.OrdinalIgnoreCase);
        return safe.Length > length ? safe[..length] : safe;
    }

    private static void StopWorker()
    {
        var active = worker;
        worker = null;
        if (active is null) return;
        try { if (!active.HasExited) active.Kill(entireProcessTree: true); } catch { }
        active.Dispose();
    }

    private const string WorkerScript = """
import base64, contextlib, io, json, sys
with contextlib.redirect_stdout(sys.stderr):
 import soundfile as sf
 from chatterbox.tts_turbo import ChatterboxTurboTTS
 model = ChatterboxTurboTTS.from_local(sys.argv[1], device='cpu', nano=True)
print(json.dumps({'ready': True}), flush=True)
for line in sys.stdin:
 try:
  request=json.loads(line)
  with contextlib.redirect_stdout(sys.stderr):
   wav=model.generate(request['text'])
   audio=wav.squeeze().detach().cpu().numpy()
   buffer=io.BytesIO()
   sf.write(buffer, audio, model.sr, format='WAV', subtype='PCM_16')
  print(json.dumps({'audio':base64.b64encode(buffer.getvalue()).decode('ascii')}), flush=True)
 except Exception as error:
  print(json.dumps({'error':str(error)[:500]}), flush=True)
""";
}
