using System.Diagnostics;
using System.Text.Json;
using SkaiDesktop.Core.Infrastructure;
using SkaiDesktop.Core.Models;

namespace SkaiDesktop.Core.Services;

public sealed record DiffusersRuntimeStatus(bool WorkerAvailable, bool DependenciesAvailable, string PythonCommand, string Status, string Message, bool BackgroundRemovalAvailable = false);
public sealed record LocalGeneratedImage(string DataUrl, string FileName);

/// <summary>Optional built-in local image generation through Hugging Face Diffusers.</summary>
public sealed class DiffusersImageProvider
{
    public const string DefaultModel = "stabilityai/sd-turbo";
    private const int MaxPromptCharacters = 8_000;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public DiffusersRuntimeStatus GetRuntimeStatus()
    {
        var worker = ResolveWorkerPath();
        var python = ResolvePythonPath();
        if (worker is null)
            return new(false, false, python, "worker-missing", "The built-in image worker is missing from this Skai installation.");
        var dependenciesAvailable = CheckDependencies(python);
        var backgroundRemovalAvailable = dependenciesAvailable && CheckBackgroundDependencies(python);
        if (dependenciesAvailable)
            return new(true, true, python, "ready", "The local image runtime is ready. Image models download separately on first use.", backgroundRemovalAvailable);
        return new(true, false, python, "dependencies-missing", "Install the optional local image runtime to use Stable Diffusion and pet background removal. Python dependencies may use several gigabytes; models download separately.");
    }

    public async Task InstallRuntimeAsync(Action<string> reportProgress, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(reportProgress);
        var packageDirectory = ResolvePackageDirectory()
            ?? throw new DirectoryNotFoundException("The optional Diffusers installer files are unavailable in this Skai package.");
        var requirements = Path.Combine(packageDirectory, "requirements.txt");
        var root = GetRuntimeRoot();
        var venv = Path.Combine(root, "venv");
        var venvPython = GetVenvPython(venv);
        Directory.CreateDirectory(root);
        if (!File.Exists(venvPython))
        {
            reportProgress("Creating an optional local image runtime…");
            await RunSetupProcessAsync(OperatingSystem.IsWindows() ? "python" : "python3", ["-m", "venv", venv], root, reportProgress, cancellationToken).ConfigureAwait(false);
        }
        reportProgress("Installing Diffusers, PyTorch, and image dependencies. This may use several gigabytes of disk…");
        await RunSetupProcessAsync(venvPython, ["-m", "pip", "install", "--upgrade", "pip"], root, reportProgress, cancellationToken).ConfigureAwait(false);
        await RunSetupProcessAsync(venvPython, ["-m", "pip", "install", "-r", requirements], root, reportProgress, cancellationToken).ConfigureAwait(false);
        reportProgress("Checking the local image runtime…");
        await RunSetupProcessAsync(venvPython, ["-c", "import diffusers, torch; print('Diffusers and PyTorch are ready')"], root, reportProgress, cancellationToken).ConfigureAwait(false);
    }

    public async Task<LocalGeneratedImage> GenerateAsync(string prompt, string? sourceImageBase64 = null, string? sourceImageMediaType = null, Action<string>? reportProgress = null, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(prompt) || prompt.Length > MaxPromptCharacters)
            throw new ArgumentException($"Enter an image prompt up to {MaxPromptCharacters:N0} characters.", nameof(prompt));
        if ((sourceImageBase64 is null) != (sourceImageMediaType is null))
            throw new ArgumentException("Source image data and media type must be supplied together.");
        if (sourceImageBase64 is not null)
        {
            if (sourceImageBase64.Length > 8_400_000 || sourceImageMediaType is not ("image/png" or "image/jpeg"))
                throw new ArgumentException("Choose a PNG or JPEG source image up to 6 MB.", nameof(sourceImageBase64));
            byte[] sourceBytes;
            try { sourceBytes = Convert.FromBase64String(sourceImageBase64); }
            catch (FormatException error) { throw new ArgumentException("The source image encoding is invalid.", nameof(sourceImageBase64), error); }
            if (sourceBytes.Length is < 8 or > 6 * 1024 * 1024 || !ChatAttachmentPolicy.HasValidImageSignature(sourceImageMediaType, sourceBytes))
                throw new ArgumentException("Choose a valid PNG or JPEG source image up to 6 MB.", nameof(sourceImageBase64));
        }
        var worker = ResolveWorkerPath() ?? throw new InvalidOperationException("The local image worker is missing from this Skai installation.");
        var python = ResolvePythonPath();
        if (!CheckDependencies(python))
            throw new InvalidOperationException("Install the optional Diffusers runtime in Settings before generating with local Stable Diffusion.");

        var start = new ProcessStartInfo
        {
            FileName = python,
            WorkingDirectory = Path.GetDirectoryName(worker) ?? AppContext.BaseDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        start.ArgumentList.Add(worker);
        using var process = Process.Start(start) ?? throw new InvalidOperationException("Could not start the local image runtime.");
        var stderrTask = process.StandardError.ReadToEndAsync(cancellationToken);
        using var cancellation = cancellationToken.Register(() => { try { if (!process.HasExited) process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { } });
        await process.StandardInput.WriteLineAsync(JsonSerializer.Serialize(new { model = DefaultModel, prompt = prompt.Trim(), sourceImage = sourceImageBase64, sourceImageMediaType }, JsonOptions)).ConfigureAwait(false);
        await process.StandardInput.FlushAsync().ConfigureAwait(false);
        process.StandardInput.Close();
        string? dataUrl = null;
        string? fileName = null;
        var done = false;
        try
        {
            while (await process.StandardOutput.ReadLineAsync(cancellationToken).ConfigureAwait(false) is { } line)
            {
                if (line.Length > 7_500_000) throw new InvalidDataException("The local image runtime returned an oversized image.");
                using var item = JsonDocument.Parse(line);
                var root = item.RootElement;
                var type = root.TryGetProperty("type", out var typeElement) ? typeElement.GetString() : null;
                if (type == "progress" && root.TryGetProperty("step", out var step) && step.TryGetInt32(out var completed)
                    && root.TryGetProperty("total", out var total) && total.TryGetInt32(out var count) && count > 0 && completed >= 0 && completed <= count)
                    reportProgress?.Invoke($"Generating locally… step {completed} of {count}.");
                if (type == "error") throw new InvalidOperationException(SummarizeWorkerError(root.TryGetProperty("message", out var message) ? message.GetString() : null));
                if (type == "result")
                {
                    var mediaType = root.GetProperty("mediaType").GetString();
                    var data = root.GetProperty("data").GetString();
                    if (mediaType != "image/jpeg" || string.IsNullOrWhiteSpace(data) || data.Length > 7_000_000)
                        throw new InvalidDataException("The local image runtime returned invalid image data.");
                    var bytes = Convert.FromBase64String(data);
                    if (!ChatAttachmentPolicy.HasValidImageSignature("image/jpeg", bytes) || bytes.Length > 5 * 1024 * 1024)
                        throw new InvalidDataException("The local image runtime returned invalid or oversized image bytes.");
                    dataUrl = $"data:image/jpeg;base64,{data}";
                    fileName = $"skai-stable-diffusion-{DateTime.UtcNow:yyyyMMdd-HHmmss}.jpg";
                }
                if (type == "done") done = true;
            }
            await process.WaitForExitAsync(cancellationToken).ConfigureAwait(false);
            if (!done || dataUrl is null || fileName is null)
                throw new InvalidOperationException((await stderrTask.ConfigureAwait(false)).Trim() is { Length: > 0 } error ? error[..Math.Min(error.Length, 500)] : "The local image runtime closed without returning an image.");
            return new(dataUrl, fileName);
        }
        catch
        {
            try { if (!process.HasExited) process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
            throw;
        }
    }

    public async Task<LocalGeneratedImage> RemovePetBackgroundAsync(string imageBase64, string mediaType, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(imageBase64) || imageBase64.Length > 8_400_000 || mediaType is not ("image/png" or "image/jpeg"))
            throw new ArgumentException("Choose a PNG or JPEG frame up to 6 MB.", nameof(imageBase64));
        byte[] sourceBytes;
        try { sourceBytes = Convert.FromBase64String(imageBase64); }
        catch (FormatException error) { throw new ArgumentException("The frame image encoding is invalid.", nameof(imageBase64), error); }
        if (sourceBytes.Length is < 8 or > 6 * 1024 * 1024 || !ChatAttachmentPolicy.HasValidImageSignature(mediaType, sourceBytes))
            throw new ArgumentException("Choose a valid PNG or JPEG frame up to 6 MB.", nameof(imageBase64));

        var packageDirectory = ResolvePackageDirectory() ?? throw new InvalidOperationException("The local pet image tools are missing from this Skai installation.");
        var worker = Path.Combine(packageDirectory, "skai_pet_background.py");
        if (!File.Exists(worker)) throw new InvalidOperationException("The local pet background worker is missing from this Skai installation.");
        var python = ResolvePythonPath();
        if (!CheckBackgroundDependencies(python)) throw new InvalidOperationException("Install or update the optional local image runtime in Image Studio before removing a background.");

        var start = new ProcessStartInfo
        {
            FileName = python,
            WorkingDirectory = packageDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        start.ArgumentList.Add(worker);
        start.Environment["U2NET_HOME"] = Path.Combine(GetRuntimeRoot(), "models");
        using var process = Process.Start(start) ?? throw new InvalidOperationException("Could not start local pet background removal.");
        using var cancellation = cancellationToken.Register(() => { try { if (!process.HasExited) process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { } });
        var stderrTask = process.StandardError.ReadToEndAsync(cancellationToken);
        await process.StandardInput.WriteLineAsync(JsonSerializer.Serialize(new { image = imageBase64 }, JsonOptions)).ConfigureAwait(false);
        await process.StandardInput.FlushAsync().ConfigureAwait(false);
        process.StandardInput.Close();
        string? data = null;
        var done = false;
        try
        {
            while (await process.StandardOutput.ReadLineAsync(cancellationToken).ConfigureAwait(false) is { } line)
            {
                if (line.Length > 7_500_000) throw new InvalidDataException("The background remover returned an oversized image.");
                using var item = JsonDocument.Parse(line);
                var root = item.RootElement;
                var type = root.TryGetProperty("type", out var typeElement) ? typeElement.GetString() : null;
                if (type == "error") throw new InvalidOperationException(root.TryGetProperty("message", out var message) ? message.GetString() : "Local background removal failed.");
                if (type == "result")
                {
                    data = root.GetProperty("data").GetString();
                    if (root.GetProperty("mediaType").GetString() != "image/png" || string.IsNullOrWhiteSpace(data) || data.Length > 7_000_000)
                        throw new InvalidDataException("The background remover returned invalid image data.");
                    var bytes = Convert.FromBase64String(data);
                    if (!ChatAttachmentPolicy.HasValidImageSignature("image/png", bytes) || bytes.Length > 5 * 1024 * 1024)
                        throw new InvalidDataException("The background remover returned invalid or oversized image bytes.");
                }
                if (type == "done") done = true;
            }
            await process.WaitForExitAsync(cancellationToken).ConfigureAwait(false);
            if (!done || data is null)
                throw new InvalidOperationException((await stderrTask.ConfigureAwait(false)).Trim() is { Length: > 0 } error ? error[..Math.Min(error.Length, 500)] : "The local background remover closed without returning an image.");
            return new($"data:image/png;base64,{data}", $"skai-pet-transparent-{DateTime.UtcNow:yyyyMMdd-HHmmss}.png");
        }
        catch
        {
            try { if (!process.HasExited) process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
            throw;
        }
    }

    private static bool CheckDependencies(string python)
    {
        try
        {
            var start = new ProcessStartInfo { FileName = python, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
            start.ArgumentList.Add("-c"); start.ArgumentList.Add("import diffusers, torch");
            using var process = Process.Start(start);
            if (process is null) return false;
            // Drain both redirected streams while the import runs, then join the drains before
            // disposing the process. This avoids a pipe-buffer deadlock and orphaned readers.
            var stdout = process.StandardOutput.ReadToEndAsync();
            var stderr = process.StandardError.ReadToEndAsync();
            if (!process.WaitForExit(20_000))
            {
                try { if (!process.HasExited) process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
                try { process.WaitForExit(3_000); } catch (InvalidOperationException) { }
                try { Task.WaitAll([stdout, stderr], TimeSpan.FromSeconds(3)); } catch (AggregateException) { }
                return false;
            }
            try { Task.WaitAll([stdout, stderr], TimeSpan.FromSeconds(3)); } catch (AggregateException) { return false; }
            return process.ExitCode == 0;
        }
        catch (System.ComponentModel.Win32Exception) { return false; }
        catch (InvalidOperationException) { return false; }
    }

    public static string SummarizeWorkerError(string? message)
    {
        if (string.IsNullOrWhiteSpace(message)) return "Local image generation failed.";
        if (message.Contains("OfflineModeIsEnabled", StringComparison.OrdinalIgnoreCase) ||
            message.Contains("LocalEntryNotFoundError", StringComparison.OrdinalIgnoreCase) ||
            message.Contains("does not appear to have a file named model_index.json", StringComparison.OrdinalIgnoreCase))
            return "Stable Diffusion Turbo is not in the local model cache. Connect to the internet once to download the model, then retry.";

        var firstLine = message.Split(['\r', '\n'], 2, StringSplitOptions.RemoveEmptyEntries)[0].Trim();
        return firstLine.Length <= 500 ? firstLine : firstLine[..500];
    }

    private static bool CheckBackgroundDependencies(string python)
    {
        try
        {
            var start = new ProcessStartInfo { FileName = python, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
            start.ArgumentList.Add("-c"); start.ArgumentList.Add("import importlib.util,sys; sys.exit(0 if all(importlib.util.find_spec(name) for name in ('rembg','onnxruntime')) else 1)");
            using var process = Process.Start(start);
            if (process is null) return false;
            var stdout = process.StandardOutput.ReadToEndAsync();
            var stderr = process.StandardError.ReadToEndAsync();
            if (!process.WaitForExit(20_000))
            {
                try { if (!process.HasExited) process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
                try { process.WaitForExit(3_000); } catch (InvalidOperationException) { }
                try { Task.WaitAll([stdout, stderr], TimeSpan.FromSeconds(3)); } catch (AggregateException) { }
                return false;
            }
            try { Task.WaitAll([stdout, stderr], TimeSpan.FromSeconds(3)); } catch (AggregateException) { return false; }
            return process.ExitCode == 0;
        }
        catch (System.ComponentModel.Win32Exception) { return false; }
        catch (InvalidOperationException) { return false; }
    }

    private static string ResolvePythonPath()
    {
        var configured = Environment.GetEnvironmentVariable("SKAI_DIFFUSERS_PYTHON");
        if (!string.IsNullOrWhiteSpace(configured)) return configured;
        var managed = GetVenvPython(Path.Combine(GetRuntimeRoot(), "venv"));
        return File.Exists(managed) ? managed : OperatingSystem.IsWindows() ? "python" : "python3";
    }

    private static string? ResolveWorkerPath()
    {
        var configured = Environment.GetEnvironmentVariable("SKAI_DIFFUSERS_WORKER");
        if (!string.IsNullOrWhiteSpace(configured) && File.Exists(configured)) return Path.GetFullPath(configured);
        return ResolvePackageDirectory() is { } directory && File.Exists(Path.Combine(directory, "skai_diffusers.py")) ? Path.Combine(directory, "skai_diffusers.py") : null;
    }

    private static string? ResolvePackageDirectory()
    {
        var candidates = new[] { Path.Combine(AppContext.BaseDirectory, "diffusers"), Path.Combine(AppContext.BaseDirectory, "services", "diffusers"), Path.Combine(Environment.CurrentDirectory, "services", "diffusers") };
        return candidates.FirstOrDefault(path => File.Exists(Path.Combine(path, "requirements.txt")));
    }

    private static string GetRuntimeRoot() => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData, Environment.SpecialFolderOption.Create), "Skai", "Diffusers");
    private static string GetVenvPython(string venv) => OperatingSystem.IsWindows() ? Path.Combine(venv, "Scripts", "python.exe") : Path.Combine(venv, "bin", "python");

    private static async Task RunSetupProcessAsync(string executable, IReadOnlyList<string> arguments, string workingDirectory, Action<string> reportProgress, CancellationToken cancellationToken)
    {
        var start = new ProcessStartInfo { FileName = executable, WorkingDirectory = workingDirectory, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var argument in arguments) start.ArgumentList.Add(argument);
        using var process = Process.Start(start) ?? throw new InvalidOperationException("Could not start Python. Install Python 3 and retry.");
        using var registration = cancellationToken.Register(() => { try { if (!process.HasExited) process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { } });
        var stdout = ForwardAsync(process.StandardOutput, reportProgress);
        var stderr = ForwardAsync(process.StandardError, reportProgress);
        try { await process.WaitForExitAsync(cancellationToken).ConfigureAwait(false); }
        catch (OperationCanceledException)
        {
            try { if (!process.HasExited) process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
            await process.WaitForExitAsync().ConfigureAwait(false);
            await Task.WhenAll(stdout, stderr).ConfigureAwait(false);
            throw;
        }
        await Task.WhenAll(stdout, stderr).ConfigureAwait(false);
        if (process.ExitCode != 0) throw new InvalidOperationException($"Optional image runtime setup stopped with exit code {process.ExitCode}. Check Python and available disk space.");
    }

    private static async Task ForwardAsync(StreamReader reader, Action<string> report)
    {
        while (await reader.ReadLineAsync().ConfigureAwait(false) is { } line)
            if (!string.IsNullOrWhiteSpace(line)) report(line.Length > 240 ? line[..240] : line);
    }
}
