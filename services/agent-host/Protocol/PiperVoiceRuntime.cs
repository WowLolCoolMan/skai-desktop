using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using SkaiDesktop.Core.Services;

namespace SkaiDesktop.AgentHost.Protocol;

/// <summary>Installs a pinned, local-only Piper 1.5 voice and synthesizes WAV audio.</summary>
internal static class PiperVoiceRuntime
{
    private static readonly object SpeechGate = new();
    private static readonly HashSet<Process> ActiveSpeechProcesses = [];
    private const string Revision = "cf910fb59f1d79ab3b625a63993a108751c6c25d";
    private const string VoiceName = "en_US-hifi_tts_92-medium";
    private const string ModelFile = VoiceName + ".onnx";
    private const string ConfigFile = ModelFile + ".json";
    private const string CardFile = "MODEL_CARD";
    private const string ModelHash = "14d19c09e5b08c9416ef856fd669118f91813b0772714e3d989adbd70f05ff91";
    private const string ConfigHash = "b21f81aea9870e24198645738bd5b95591982ceece2d240fb8eddc59ed50d73f";
    private const string CardHash = "62cafa98605100626d876aadcfd3dfa961cac263fa338b1fe17fe0989545e700";
    private const string VoiceBase = $"https://huggingface.co/rhasspy/piper-voices/resolve/{Revision}/en/en_US/hifi_tts_92/medium/";
    private static readonly object Gate = new();
    private static Task? installTask;
    private static string installState = "not-installed";
    private static string installStep = "";
    private static string? installError;

    private static string Root => VoiceRuntimeStatus.GetVoiceRuntimeRoot("Piper");
    private static string PythonPath => Path.Combine(Root, "venv", OperatingSystem.IsWindows() ? "Scripts/python.exe" : "bin/python");
    private static string ModelPath => Path.Combine(Root, ModelFile);
    public static bool IsInstalled => File.Exists(ModelPath) && File.Exists(ModelPath + ".json") && File.Exists(PythonPath) && File.Exists(Path.Combine(Root, "installed.json"));

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
        lock (Gate) return new { installed = IsInstalled, status = IsInstalled ? "installed" : installState, step = installStep, error = installError };
    }

    public static async Task<string> SynthesizeDataUrlAsync(string text, double rate, int expressiveness)
    {
        if (!IsInstalled) throw new InvalidOperationException("Install Piper from Marketplace before selecting it for speech.");
        var output = Path.Combine(Path.GetTempPath(), $"skai-piper-{Guid.NewGuid():N}.wav");
        var amount = Math.Clamp(expressiveness, 0, 100) / 100d;
        const string script = "import sys, wave\nfrom piper import PiperVoice, SynthesisConfig\nmodel, text, output, rate, noise, noise_w = sys.argv[1:]\nvoice = PiperVoice.load(model)\nwith wave.open(output, 'wb') as wav:\n voice.synthesize_wav(text, wav, syn_config=SynthesisConfig(length_scale=1.0 / float(rate), noise_scale=float(noise), noise_w_scale=float(noise_w)))\n";
        try
        {
            await RunAsync(PythonPath, ["-c", script, ModelPath, text, output, rate.ToString(System.Globalization.CultureInfo.InvariantCulture), (0.55 + amount * 0.3).ToString(System.Globalization.CultureInfo.InvariantCulture), (0.65 + amount * 0.45).ToString(System.Globalization.CultureInfo.InvariantCulture)], TimeSpan.FromMinutes(3), trackSpeech: true).ConfigureAwait(false);
            return "data:audio/wav;base64," + Convert.ToBase64String(await File.ReadAllBytesAsync(output).ConfigureAwait(false));
        }
        finally { try { File.Delete(output); } catch { } }
    }

    public static bool StopGeneration()
    {
        Process[] active;
        lock (SpeechGate) active = ActiveSpeechProcesses.ToArray();
        foreach (var process in active)
        {
            try { if (!process.HasExited) process.Kill(entireProcessTree: true); }
            catch (InvalidOperationException) { }
            catch (System.ComponentModel.Win32Exception) { }
        }
        return active.Length > 0;
    }

    private static async Task InstallAsync()
    {
        try
        {
            Directory.CreateDirectory(Root);
            var python = FindPython();
            SetStep("Creating isolated Python environment");
            await RunAsync(python, ["-m", "venv", Path.Combine(Root, "venv")], TimeSpan.FromMinutes(3)).ConfigureAwait(false);
            SetStep("Installing Piper 1.5.0 for Windows");
            await RunAsync(PythonPath, ["-m", "pip", "install", "--disable-pip-version-check", "--no-input", "piper-tts==1.5.0"], TimeSpan.FromMinutes(10)).ConfigureAwait(false);
            SetStep("Downloading and verifying the Piper voice and its license card");
            await DownloadVerifiedAsync(ModelFile, ModelHash).ConfigureAwait(false);
            await DownloadVerifiedAsync(ConfigFile, ConfigHash).ConfigureAwait(false);
            await DownloadVerifiedAsync(CardFile, CardHash).ConfigureAwait(false);
            SetStep("Checking local Piper synthesis");
            const string check = "import sys; from piper import PiperVoice; v=PiperVoice.load(sys.argv[1]); print('piper-ready')";
            var output = await RunAsync(PythonPath, ["-c", check, ModelPath], TimeSpan.FromMinutes(3)).ConfigureAwait(false);
            if (!output.Contains("piper-ready", StringComparison.Ordinal)) throw new InvalidOperationException("Piper did not pass its local runtime check.");
            await File.WriteAllTextAsync(Path.Combine(Root, "installed.json"), JsonSerializer.Serialize(new { runtime = "piper-tts==1.5.0", voice = VoiceName, revision = Revision, modelSha256 = ModelHash, configSha256 = ConfigHash, cardSha256 = CardHash, installedAtUtc = DateTimeOffset.UtcNow })).ConfigureAwait(false);
            lock (Gate) { installState = "installed"; installStep = "Ready for local speech"; }
        }
        catch (Exception error)
        {
            lock (Gate) { installState = "failed"; installStep = "Install failed"; installError = new string(error.Message.Where(c => !char.IsControl(c)).Take(1_000).ToArray()); }
        }
    }

    private static async Task DownloadVerifiedAsync(string fileName, string expectedHash)
    {
        var path = Path.Combine(Root, fileName);
        if (File.Exists(path) && await HasHashAsync(path, expectedHash).ConfigureAwait(false)) return;
        var temp = path + ".download";
        using var client = new HttpClient { Timeout = TimeSpan.FromMinutes(15) };
        using var response = await client.GetAsync(new Uri(VoiceBase + fileName), HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
        await using (var source = await response.Content.ReadAsStreamAsync().ConfigureAwait(false))
        await using (var destination = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None, 1024 * 128, useAsync: true))
            await source.CopyToAsync(destination).ConfigureAwait(false);
        if (!await HasHashAsync(temp, expectedHash).ConfigureAwait(false)) { File.Delete(temp); throw new CryptographicException($"The downloaded Piper file {fileName} did not match its pinned SHA-256 digest."); }
        File.Move(temp, path, overwrite: true);
    }

    private static async Task<bool> HasHashAsync(string path, string expected)
    {
        await using var file = File.OpenRead(path);
        return Convert.ToHexString(await SHA256.HashDataAsync(file).ConfigureAwait(false)).Equals(expected, StringComparison.OrdinalIgnoreCase);
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
        throw new InvalidOperationException("Install Python 3.10 or newer and add it to PATH to install this local Piper voice.");
    }

    private static void SetStep(string step) { lock (Gate) installStep = step; }

    private static async Task<string> RunAsync(string executable, IReadOnlyList<string> arguments, TimeSpan timeout, bool trackSpeech = false)
    {
        using var process = new Process { StartInfo = new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true } };
        foreach (var argument in arguments) process.StartInfo.ArgumentList.Add(argument);
        if (!process.Start()) throw new InvalidOperationException("The local Piper runtime could not start.");
        if (trackSpeech) lock (SpeechGate) ActiveSpeechProcesses.Add(process);
        process.StandardInput.Close();
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        using var timeoutSource = new CancellationTokenSource(timeout);
        try { await process.WaitForExitAsync(timeoutSource.Token).ConfigureAwait(false); }
        catch (OperationCanceledException) { try { process.Kill(entireProcessTree: true); } catch { } throw new TimeoutException("A Piper setup or speech step timed out."); }
        finally { if (trackSpeech) lock (SpeechGate) ActiveSpeechProcesses.Remove(process); }
        var result = await stdout.ConfigureAwait(false);
        var error = await stderr.ConfigureAwait(false);
        if (process.ExitCode != 0) throw new InvalidOperationException($"The Piper local step failed: {new string(error.Where(c => !char.IsControl(c)).Take(1_000).ToArray())}");
        return result;
    }
}
