using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;

namespace SkaiDesktop.AgentHost.Protocol;

/// <summary>Installs and runs the pinned, entirely local Kokoro ONNX speech runtime.</summary>
internal static class KokoroVoiceRuntime
{
    private const string ModelName = "kokoro-v1.0.int8.onnx";
    private const string VoicesName = "voices-v1.0.bin";
    private const string ModelSha256 = "ae315a79b623f244700e4afb9246c46a26066782e049ba174bf3ba433970ee9c";
    private const string VoicesSha256 = "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d";
    private const string ReleaseBase = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/";
    private static readonly object Gate = new();
    private static Task? installTask;
    private static string installState = "not-installed";
    private static string? installError;
    private static string installStep = "";

    private static string Root => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData, Environment.SpecialFolderOption.Create), "Skai", "Voice", "Kokoro");
    private static string ModelPath => Path.Combine(Root, ModelName);
    private static string VoicesPath => Path.Combine(Root, VoicesName);
    private static string PythonPath => Path.Combine(Root, "venv", OperatingSystem.IsWindows() ? "Scripts/python.exe" : "bin/python");
    public static bool IsInstalled => File.Exists(ModelPath) && File.Exists(VoicesPath) && File.Exists(PythonPath) && File.Exists(Path.Combine(Root, "installed.json"));

    public static object StartInstall()
    {
        lock (Gate)
        {
            if (IsInstalled) return Snapshot();
            if (installTask is { IsCompleted: false }) return Snapshot();
            installError = null;
            installState = "installing";
            installStep = "Preparing isolated Python runtime";
            installTask = Task.Run(InstallAsync);
            return Snapshot();
        }
    }

    public static object Snapshot()
    {
        lock (Gate) return new { installed = IsInstalled, status = IsInstalled ? "installed" : installState, step = installStep, error = installError };
    }

    public static async Task<string> SynthesizeDataUrlAsync(string text, double rate)
    {
        if (!IsInstalled) throw new InvalidOperationException("Install Kokoro from Marketplace before selecting it for speech.");
        var output = Path.Combine(Path.GetTempPath(), $"skai-kokoro-{Guid.NewGuid():N}.wav");
        const string script = "import sys, soundfile as sf\nfrom kokoro_onnx import Kokoro\nmodel, voices, text, output, speed = sys.argv[1:]\ntts = Kokoro(model, voices)\ntry:\n audio, sample_rate = tts.create(text, voice='af_heart', speed=float(speed), lang='en-us')\n sf.write(output, audio, sample_rate, subtype='PCM_16')\nfinally:\n tts.voices.close()\n";
        try
        {
            await RunAsync(PythonPath, ["-c", script, ModelPath, VoicesPath, text, output, rate.ToString(System.Globalization.CultureInfo.InvariantCulture)], TimeSpan.FromMinutes(3)).ConfigureAwait(false);
            var bytes = await File.ReadAllBytesAsync(output).ConfigureAwait(false);
            return "data:audio/wav;base64," + Convert.ToBase64String(bytes);
        }
        finally { try { File.Delete(output); } catch { } }
    }

    private static async Task InstallAsync()
    {
        try
        {
            Directory.CreateDirectory(Root);
            var python = FindPython();
            SetStep("Creating isolated Python environment");
            await RunAsync(python, ["-m", "venv", Path.Combine(Root, "venv")], TimeSpan.FromMinutes(3)).ConfigureAwait(false);
            SetStep("Installing Kokoro ONNX runtime");
            await RunAsync(PythonPath, ["-m", "pip", "install", "--disable-pip-version-check", "--no-input", "kokoro-onnx==0.6.1", "soundfile==0.13.1"], TimeSpan.FromMinutes(10)).ConfigureAwait(false);
            SetStep("Downloading and verifying Kokoro model files");
            await DownloadVerifiedAsync(ModelName, ModelSha256).ConfigureAwait(false);
            await DownloadVerifiedAsync(VoicesName, VoicesSha256).ConfigureAwait(false);
            SetStep("Checking local speech runtime");
            const string check = "import sys; from kokoro_onnx import Kokoro; t=Kokoro(sys.argv[1],sys.argv[2]); t.voices.close(); print('kokoro-ready')";
            var result = await RunAsync(PythonPath, ["-c", check, ModelPath, VoicesPath], TimeSpan.FromMinutes(3)).ConfigureAwait(false);
            if (!result.Contains("kokoro-ready", StringComparison.Ordinal)) throw new InvalidOperationException("Kokoro did not pass its runtime check.");
            await File.WriteAllTextAsync(Path.Combine(Root, "installed.json"), JsonSerializer.Serialize(new { model = ModelName, modelSha256 = ModelSha256, voices = VoicesName, voicesSha256 = VoicesSha256, runtime = "kokoro-onnx==0.6.1", installedAtUtc = DateTimeOffset.UtcNow })).ConfigureAwait(false);
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
        using var response = await client.GetAsync(new Uri(ReleaseBase + fileName), HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
        await using (var source = await response.Content.ReadAsStreamAsync().ConfigureAwait(false))
        await using (var destination = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None, 1024 * 128, useAsync: true))
            await source.CopyToAsync(destination).ConfigureAwait(false);
        if (!await HasHashAsync(temp, expectedHash).ConfigureAwait(false)) { File.Delete(temp); throw new CryptographicException($"The downloaded {fileName} did not match its pinned SHA-256 digest."); }
        File.Move(temp, path, overwrite: true);
    }

    private static async Task<bool> HasHashAsync(string path, string expected)
    {
        await using var stream = File.OpenRead(path);
        var hash = await SHA256.HashDataAsync(stream).ConfigureAwait(false);
        return Convert.ToHexString(hash).Equals(expected, StringComparison.OrdinalIgnoreCase);
    }

    private static string FindPython()
    {
        var names = OperatingSystem.IsWindows() ? new[] { "python.exe", "py.exe" } : new[] { "python3", "python" };
        foreach (var directory in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        foreach (var name in names)
        {
            var candidate = Path.Combine(directory, name);
            if (!File.Exists(candidate)) continue;
            if (OperatingSystem.IsWindows() && name == "py.exe") return candidate;
            return candidate;
        }
        throw new InvalidOperationException("Install Python 3.10 or newer and add it to PATH to install this local voice model.");
    }

    private static void SetStep(string step) { lock (Gate) installStep = step; }

    private static async Task<string> RunAsync(string executable, IReadOnlyList<string> arguments, TimeSpan timeout)
    {
        using var process = new Process { StartInfo = new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true } };
        foreach (var argument in arguments) process.StartInfo.ArgumentList.Add(argument);
        if (!process.Start()) throw new InvalidOperationException("The local Kokoro runtime could not start.");
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        using var cancellation = new CancellationTokenSource(timeout);
        try { await process.WaitForExitAsync(cancellation.Token).ConfigureAwait(false); }
        catch (OperationCanceledException) { try { process.Kill(entireProcessTree: true); } catch { } throw new TimeoutException("The Kokoro setup or synthesis step timed out."); }
        var output = await stdout.ConfigureAwait(false);
        var error = await stderr.ConfigureAwait(false);
        if (process.ExitCode != 0) throw new InvalidOperationException($"Kokoro local step failed: {new string(error.Where(c => !char.IsControl(c)).Take(1_000).ToArray())}");
        return output;
    }
}
