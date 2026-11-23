using System.Diagnostics;
using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using SkaiDesktop.Core.Services;

namespace SkaiDesktop.AgentHost.Protocol;

/// <summary>Installs the pinned Pocket TTS Windows runtime and serves local speech on loopback.</summary>
internal static class PocketTtsRuntime
{
    private const string ReleaseArchiveUrl = "https://github.com/kyutai-labs/pocket-tts/releases/download/v4.0.1/pocket-tts-3.3.0-x86_64-pc-windows-msvc.zip";
    private const string ReleaseArchiveSha256 = "98753041f2e65744b989776f87bccb93f1f574a08afe1890c5427ec94cd6309c";
    private const string LicenseSha256 = "36516aefdc84c5d5a1e7485425913a22dbda69eb1930c5e84d6ae4972b5194b9";
    private const string LowResourceTokenizerUrl = "https://huggingface.co/kyutai/pocket-tts-without-voice-cloning/resolve/08ffc58775e62aad9409511b9591c9af626270f3/languages/english_7m_refl_2026-10/tokenizer.model";
    private const string LowResourceTokenizerSha256 = "d461765ae179566678c93091c5fa6f2984c31bbe990bf1aa62d92c64d91bc3f6";
    private const string VoiceName = "alba";
    private static readonly object StateGate = new();
    private static readonly SemaphoreSlim WorkerGate = new(1, 1);
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromMinutes(4) };
    private static Task? installTask;
    private static Process? worker;
    private static string? workerLanguage;
    private static int workerPort;
    private static string installState = "not-installed";
    private static string installStep = "";
    private static string? installError;
    private static string workerDiagnostics = "";

    static PocketTtsRuntime() => AppDomain.CurrentDomain.ProcessExit += (_, _) => StopWorker();

    private static string Root => VoiceRuntimeStatus.GetPocketTtsRoot();
    private static string BinaryPath => Path.Combine(Root, "pocket-tts.exe");
    private static string CacheRoot => Path.Combine(Root, "cache");
    private static string MarkerPath => Path.Combine(Root, "installed.json");
    public static bool IsSupported => OperatingSystem.IsWindows() && RuntimeInformation.ProcessArchitecture == Architecture.X64;
    public static bool IsInstalled => VoiceRuntimeStatus.IsPocketTtsInstalled;

    public static object StartInstall()
    {
        lock (StateGate)
        {
            if (!IsSupported) return new { installed = false, status = "unavailable", step = "Pocket TTS's verified Skai adapter currently supports Windows x64.", error = (string?)null };
            if (IsInstalled) return Snapshot();
            if (installTask is { IsCompleted: false }) return Snapshot();
            installState = "installing";
            installStep = "Preparing the verified local runtime";
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

    public static async Task<string> SynthesizeDataUrlAsync(string text, string? modelId)
    {
        if (!IsInstalled) throw new InvalidOperationException("Install Pocket TTS from Marketplace before selecting it for speech.");
        var language = modelId?.Equals("pocket-tts-low-resource", StringComparison.OrdinalIgnoreCase) == true
            ? "english_7m_refl_2026-10"
            : "english_2026-09";
        await WorkerGate.WaitAsync().ConfigureAwait(false);
        try
        {
            await EnsureWorkerAsync(language).ConfigureAwait(false);
            var port = workerPort;
            using var request = new HttpRequestMessage(HttpMethod.Post, $"http://127.0.0.1:{port}/tts")
            {
                Content = new FormUrlEncodedContent([new KeyValuePair<string, string>("text", text[..Math.Min(text.Length, 4_000)])]),
            };
            using var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                var detail = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                throw new InvalidOperationException($"Pocket TTS local speech failed ({(int)response.StatusCode}): {Bound(detail, 400)}");
            }
            var bytes = await ReadBoundedAsync(response.Content, 32 * 1024 * 1024).ConfigureAwait(false);
            if (bytes.Length < 44 || !bytes.AsSpan(0, 4).SequenceEqual("RIFF"u8) || !bytes.AsSpan(8, 4).SequenceEqual("WAVE"u8))
                throw new InvalidDataException("Pocket TTS returned an invalid WAV response.");
            return "data:audio/wav;base64," + Convert.ToBase64String(bytes);
        }
        finally { WorkerGate.Release(); }
    }

    private static async Task InstallAsync()
    {
        try
        {
            Directory.CreateDirectory(Root);
            Directory.CreateDirectory(CacheRoot);
            var archivePath = Path.Combine(Root, "pocket-tts-runtime.zip.download");
            SetStep("Downloading the 8 MB Kyutai Pocket TTS runtime");
            await DownloadVerifiedAsync(ReleaseArchiveUrl, archivePath, ReleaseArchiveSha256, 16 * 1024 * 1024).ConfigureAwait(false);
            SetStep("Verifying and extracting the Pocket TTS program");
            ExtractVerifiedRuntime(archivePath);
            File.Delete(archivePath);
            await WorkerGate.WaitAsync().ConfigureAwait(false);
            try
            {
                SetStep("Downloading and warming the English speech model");
                await EnsureWorkerAsync("english_2026-09").ConfigureAwait(false);
                var sample = await SynthesizeUnlockedAsync("Skai local speech is ready.").ConfigureAwait(false);
                ValidateWav(Convert.FromBase64String(sample["data:audio/wav;base64,".Length..]));
                StopWorker();
                SetStep("Preparing the pinned low-resource tokenizer");
                var tokenizerPath = Path.Combine(CacheRoot, "huggingface", "hub", "models--kyutai--pocket-tts-without-voice-cloning", "snapshots", "08ffc58775e62aad9409511b9591c9af626270f3", "languages", "english_7m_refl_2026-10", "tokenizer.model");
                Directory.CreateDirectory(Path.GetDirectoryName(tokenizerPath)!);
                await DownloadVerifiedAsync(LowResourceTokenizerUrl, tokenizerPath, LowResourceTokenizerSha256, 128 * 1024).ConfigureAwait(false);
                SetStep("Downloading and warming the low-resource English model");
                await EnsureWorkerAsync("english_7m_refl_2026-10").ConfigureAwait(false);
                var lowResourceSample = await SynthesizeUnlockedAsync("Skai local speech is ready.").ConfigureAwait(false);
                ValidateWav(Convert.FromBase64String(lowResourceSample["data:audio/wav;base64,".Length..]));
                StopWorker();
            }
            finally { WorkerGate.Release(); }

            await File.WriteAllTextAsync(MarkerPath, JsonSerializer.Serialize(new
            {
                engine = "Pocket TTS",
                release = "v4.0.1",
                binary = "pocket-tts 3.3.0",
                archiveSha256 = ReleaseArchiveSha256,
                executableSha256 = VoiceRuntimeStatus.PocketTtsExecutableSha256,
                voice = "alba (Kyutai built-in voice)",
                voiceLicense = "CC BY 4.0",
                installedAtUtc = DateTimeOffset.UtcNow,
            })).ConfigureAwait(false);
            lock (StateGate) { installState = "installed"; installStep = "Ready for local speech"; }
        }
        catch (Exception error)
        {
            StopWorker();
            lock (StateGate) { installState = "failed"; installStep = "Install failed"; installError = Bound(error.Message, 1_000); }
        }
    }

    private static async Task<string> SynthesizeUnlockedAsync(string text)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"http://127.0.0.1:{workerPort}/tts")
        {
            Content = new FormUrlEncodedContent([new KeyValuePair<string, string>("text", text)]),
        };
        using var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException("Pocket TTS failed its local synthesis acceptance request.");
        var bytes = await ReadBoundedAsync(response.Content, 4 * 1024 * 1024).ConfigureAwait(false);
        ValidateWav(bytes);
        return "data:audio/wav;base64," + Convert.ToBase64String(bytes);
    }

    private static async Task EnsureWorkerAsync(string language)
    {
        if (!HasHash(BinaryPath, VoiceRuntimeStatus.PocketTtsExecutableSha256))
            throw new CryptographicException("The installed Pocket TTS runtime failed its SHA-256 integrity check. Reinstall it from Marketplace.");
        if (worker is { HasExited: false } && workerLanguage == language)
        {
            try
            {
                using var health = await ProbeHealthAsync(workerPort).ConfigureAwait(false);
                if (health.IsSuccessStatusCode) return;
            }
            catch { }
        }
        StopWorker();
        var port = GetLoopbackPort();
        var start = new ProcessStartInfo(BinaryPath)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            WorkingDirectory = Root,
        };
        start.ArgumentList.Add("serve");
        start.ArgumentList.Add("--host");
        start.ArgumentList.Add("127.0.0.1");
        start.ArgumentList.Add("--port");
        start.ArgumentList.Add(port.ToString(System.Globalization.CultureInfo.InvariantCulture));
        start.ArgumentList.Add("--language");
        start.ArgumentList.Add(language);
        start.ArgumentList.Add("--default-voice");
        start.ArgumentList.Add(VoiceName);
        // The pinned Windows runtime does not resolve tokenizer files correctly
        // when Hugging Face cache paths contain spaces. Keep storage in Skai's
        // normal per-user directory, but pass its equivalent 8.3 path to it.
        var runtimeCacheRoot = GetRuntimePath(CacheRoot);
        start.Environment["HF_HOME"] = Path.Combine(runtimeCacheRoot, "huggingface");
        start.Environment["HF_HUB_DISABLE_TELEMETRY"] = "1";
        start.Environment["USERPROFILE"] = runtimeCacheRoot;
        start.Environment["HOME"] = runtimeCacheRoot;
        var candidate = new Process { StartInfo = start, EnableRaisingEvents = true };
        workerDiagnostics = "";
        candidate.OutputDataReceived += (_, eventArgs) => AppendWorkerDiagnostic(eventArgs.Data);
        candidate.ErrorDataReceived += (_, eventArgs) => AppendWorkerDiagnostic(eventArgs.Data);
        if (!candidate.Start()) throw new InvalidOperationException("Pocket TTS could not start its local speech server.");
        candidate.BeginOutputReadLine();
        candidate.BeginErrorReadLine();
        worker = candidate;
        workerPort = port;
        workerLanguage = language;
        var deadline = DateTimeOffset.UtcNow.AddMinutes(6);
        while (DateTimeOffset.UtcNow < deadline)
        {
            if (candidate.HasExited)
            {
                var detail = GetWorkerDiagnostics();
                StopWorker();
                throw new InvalidOperationException(Bound($"Pocket TTS stopped while loading its local model. {detail}", 1_000));
            }
            try
            {
                using var response = await ProbeHealthAsync(port).ConfigureAwait(false);
                if (response.IsSuccessStatusCode) return;
            }
            catch { }
            await Task.Delay(500).ConfigureAwait(false);
        }
        StopWorker();
        throw new TimeoutException("Pocket TTS did not finish loading its local model within six minutes.");
    }

    private static async Task<HttpResponseMessage> ProbeHealthAsync(int port)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        return await Http.GetAsync($"http://127.0.0.1:{port}/health", timeout.Token).ConfigureAwait(false);
    }

    private static void ExtractVerifiedRuntime(string archivePath)
    {
        using var archive = ZipFile.OpenRead(archivePath);
        var executable = archive.Entries.SingleOrDefault(entry => entry.FullName.EndsWith("/pocket-tts.exe", StringComparison.OrdinalIgnoreCase));
        var license = archive.Entries.SingleOrDefault(entry => entry.FullName.EndsWith("/LICENSE", StringComparison.OrdinalIgnoreCase));
        if (executable is null || executable.Length != 22_080_000 || license is null || license.Length > 32_000)
            throw new InvalidDataException("The Pocket TTS release archive did not match the expected Windows package contents.");
        ExtractEntry(executable, BinaryPath, VoiceRuntimeStatus.PocketTtsExecutableSha256);
        ExtractEntry(license, Path.Combine(Root, "POCKET-TTS-LICENSE.txt"), LicenseSha256);
    }

    private static void ExtractEntry(ZipArchiveEntry entry, string path, string expectedSha256)
    {
        var temporary = path + ".extracting";
        using (var source = entry.Open())
        using (var destination = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None))
            source.CopyTo(destination);
        if (!HasHash(temporary, expectedSha256))
        {
            try { File.Delete(temporary); } catch { }
            throw new CryptographicException($"The Pocket TTS release file {Path.GetFileName(path)} did not match its pinned SHA-256 digest.");
        }
        File.Move(temporary, path, overwrite: true);
    }

    private static async Task DownloadVerifiedAsync(string url, string path, string expectedSha256, long maxBytes)
    {
        if (File.Exists(path) && HasHash(path, expectedSha256)) return;
        var temporary = path + ".partial";
        try { if (File.Exists(temporary)) File.Delete(temporary); } catch { }
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.UserAgent.Add(new ProductInfoHeaderValue("SkaiDesktop", "0.1.4"));
        using var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
        if (response.Content.Headers.ContentLength is { } length && (length > maxBytes || length == 0))
            throw new InvalidDataException("A Pocket TTS download had an unexpected size.");
        await using (var source = await response.Content.ReadAsStreamAsync().ConfigureAwait(false))
        await using (var destination = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None, 128 * 1024, useAsync: true))
        {
            var buffer = new byte[128 * 1024];
            long total = 0;
            int read;
            while ((read = await source.ReadAsync(buffer).ConfigureAwait(false)) > 0)
            {
                total += read;
                if (total > maxBytes) throw new InvalidDataException("A Pocket TTS download exceeded its size limit.");
                await destination.WriteAsync(buffer.AsMemory(0, read)).ConfigureAwait(false);
            }
            if (response.Content.Headers.ContentLength is { } expectedLength && total != expectedLength)
                throw new EndOfStreamException("A Pocket TTS download ended before its declared size.");
        }
        if (!HasHash(temporary, expectedSha256)) throw new CryptographicException("A Pocket TTS file did not match its pinned SHA-256 digest.");
        File.Move(temporary, path, overwrite: true);
    }

    private static async Task<byte[]> ReadBoundedAsync(HttpContent content, int maxBytes)
    {
        if (content.Headers.ContentLength is { } length && length > maxBytes)
            throw new InvalidDataException("Pocket TTS audio exceeded the local playback size limit.");
        await using var source = await content.ReadAsStreamAsync().ConfigureAwait(false);
        await using var destination = new MemoryStream();
        var buffer = new byte[64 * 1024];
        int read;
        while ((read = await source.ReadAsync(buffer).ConfigureAwait(false)) > 0)
        {
            if (destination.Length + read > maxBytes) throw new InvalidDataException("Pocket TTS audio exceeded the local playback size limit.");
            await destination.WriteAsync(buffer.AsMemory(0, read)).ConfigureAwait(false);
        }
        return destination.ToArray();
    }

    private static int GetLoopbackPort()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        return ((IPEndPoint)listener.LocalEndpoint).Port;
    }

    private static string GetRuntimePath(string path)
    {
        if (!OperatingSystem.IsWindows()) return path;
        var buffer = new StringBuilder(32_768);
        var length = GetShortPathName(path, buffer, (uint)buffer.Capacity);
        var runtimePath = length is > 0 and < 32_768 ? buffer.ToString() : path;
        if (path.Contains(' ') && runtimePath.Contains(' '))
            throw new IOException("Pocket TTS needs a Windows short-path alias to load model files from this cache folder, but Windows did not provide one. Enable 8.3 short names for this volume or use a cache location without spaces.");
        return runtimePath;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetShortPathName(string longPath, StringBuilder shortPath, uint bufferLength);

    private static bool HasHash(string path, string expected) => File.Exists(path)
        && Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path))).Equals(expected, StringComparison.OrdinalIgnoreCase);

    private static bool ValidateWav(byte[] bytes) => bytes.Length >= 44 && bytes.AsSpan(0, 4).SequenceEqual("RIFF"u8) && bytes.AsSpan(8, 4).SequenceEqual("WAVE"u8);

    private static void StopWorker()
    {
        var current = worker;
        worker = null;
        workerLanguage = null;
        workerPort = 0;
        if (current is null) return;
        try { if (!current.HasExited) current.Kill(entireProcessTree: true); } catch { }
        try { current.WaitForExit(3_000); } catch { }
        current.Dispose();
    }

    private static void AppendWorkerDiagnostic(string? line)
    {
        if (string.IsNullOrWhiteSpace(line)) return;
        lock (StateGate)
        {
            var combined = $"{workerDiagnostics}\n{line}";
            workerDiagnostics = combined.Length <= 2_000 ? combined : combined[^2_000..];
        }
    }

    private static string GetWorkerDiagnostics()
    {
        lock (StateGate) return workerDiagnostics;
    }

    private static void SetStep(string step) { lock (StateGate) installStep = step; }
    private static string Bound(string? value, int max) => new((value ?? "").Where(c => !char.IsControl(c) || c is '\n' or '\t').Take(max).ToArray());
}
