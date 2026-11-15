using System.Diagnostics;

namespace SkaiDesktop.Core.Services;

/// <summary>Installs AirLLM dependencies into Skai's user-local optional environment.</summary>
public sealed class AirLlmRuntimeInstaller
{
    public async Task InstallAsync(Action<string> reportProgress, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(reportProgress);
        var packageDirectory = FindPackageDirectory();
        var requirements = Path.Combine(packageDirectory, "requirements.txt");
        if (!File.Exists(requirements)) throw new FileNotFoundException("Skai's AirLLM dependency list is missing.", requirements);

        var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData, Environment.SpecialFolderOption.Create), "Skai", "AirLLM");
        var venv = Path.Combine(root, "venv");
        Directory.CreateDirectory(root);
        var python = OperatingSystem.IsWindows() ? "python" : "python3";
        var venvPython = OperatingSystem.IsWindows() ? Path.Combine(venv, "Scripts", "python.exe") : Path.Combine(venv, "bin", "python");

        if (!File.Exists(venvPython))
        {
            reportProgress("Creating the optional AirLLM environment…");
            await RunAsync(python, ["-m", "venv", venv], root, reportProgress, cancellationToken).ConfigureAwait(false);
        }

        reportProgress("Installing AirLLM and Python dependencies. This may download several gigabytes, depending on the PyTorch wheel selected by pip…");
        await RunAsync(venvPython, ["-m", "pip", "install", "--upgrade", "pip"], root, reportProgress, cancellationToken).ConfigureAwait(false);
        await RunAsync(venvPython, ["-m", "pip", "install", "-r", requirements], root, reportProgress, cancellationToken).ConfigureAwait(false);

        reportProgress("Checking the installed AirLLM and PyTorch packages…");
        await RunAsync(venvPython, ["-c", "import airllm, torch; print('AirLLM and PyTorch are ready')"], root, reportProgress, cancellationToken).ConfigureAwait(false);
    }

    private static async Task RunAsync(string executable, IReadOnlyList<string> arguments, string workingDirectory,
        Action<string> reportProgress, CancellationToken cancellationToken)
    {
        var start = new ProcessStartInfo
        {
            FileName = executable,
            WorkingDirectory = workingDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        foreach (var argument in arguments) start.ArgumentList.Add(argument);

        using var process = Process.Start(start) ?? throw new InvalidOperationException($"Could not start {executable}. Install Python 3 and retry.");
        using var registration = cancellationToken.Register(() =>
        {
            try { if (!process.HasExited) process.Kill(entireProcessTree: true); }
            catch (InvalidOperationException) { }
        });
        var outputTask = ForwardLinesAsync(process.StandardOutput, reportProgress);
        var errorTask = ForwardLinesAsync(process.StandardError, reportProgress);
        try { await process.WaitForExitAsync(cancellationToken).ConfigureAwait(false); }
        catch (OperationCanceledException)
        {
            try { if (!process.HasExited) process.Kill(entireProcessTree: true); }
            catch (InvalidOperationException) { }
            await process.WaitForExitAsync().ConfigureAwait(false);
            await Task.WhenAll(outputTask, errorTask).ConfigureAwait(false);
            throw;
        }
        await Task.WhenAll(outputTask, errorTask).ConfigureAwait(false);
        if (process.ExitCode != 0)
            throw new InvalidOperationException($"AirLLM setup stopped with exit code {process.ExitCode}. Review the setup log and verify Python and disk space.");
    }

    private static async Task ForwardLinesAsync(StreamReader reader, Action<string> reportProgress)
    {
        while (await reader.ReadLineAsync().ConfigureAwait(false) is { } line)
            if (!string.IsNullOrWhiteSpace(line)) reportProgress(line);
    }

    private static string FindPackageDirectory()
    {
        var candidates = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "airllm"),
            Path.Combine(AppContext.BaseDirectory, "services", "airllm"),
            Path.Combine(Environment.CurrentDirectory, "services", "airllm"),
        };
        return candidates.FirstOrDefault(path => File.Exists(Path.Combine(path, "requirements.txt")))
            ?? throw new DirectoryNotFoundException("The optional AirLLM installer files are unavailable in this Skai package.");
    }
}
