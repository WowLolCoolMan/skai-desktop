using System.Collections.Concurrent;
using System.Diagnostics;

namespace SkaiDesktop.Core.Services;

public sealed record ModelTransformerDescriptor(
    string Id,
    string Name,
    string License,
    string Source,
    string? CheckoutPath,
    bool Available,
    bool CanRunFromSkai,
    string Runtime,
    string Description,
    string[] Capabilities);

public sealed record ModelTransformationPlan(
    string AdapterId,
    string ModelPath,
    string OutputPath,
    string Command,
    bool CanRun,
    string[] Warnings);

public sealed record ModelTransformationRunSnapshot(
    string Id,
    string AdapterId,
    string Status,
    string ModelPath,
    string OutputPath,
    string Output,
    int? ExitCode,
    DateTimeOffset StartedAtUtc,
    DateTimeOffset? FinishedAtUtc,
    string? Error);

/// <summary>
/// Describes and launches optional model transformation sidecars without
/// linking their AGPL source into Skai. The operator must install dependencies
/// and choose the model/output directories explicitly.
/// </summary>
public static class ModelTransformationService
{
    private const string HereticId = "heretic";
    private const string ObliteratusId = "obliteratus";
    private const string TransformersId = "remove-refusals-with-transformers";
    private static readonly ConcurrentDictionary<string, RunState> Runs = new(StringComparer.Ordinal);

    public static IReadOnlyList<ModelTransformerDescriptor> List() =>
    [
        Describe(HereticId, "Heretic", "AGPL-3.0", "https://github.com/p-e-w/heretic", "Python 3.10+ · PyTorch 2.6+", "Training-free model modification with configurable scorers and modifiers.", ["refusal-direction editing", "scorer optimization", "local weights"]),
        Describe(ObliteratusId, "OBLITERATUS", "AGPL-3.0", "https://github.com/elder-plinius/OBLITERATUS", "Python 3.11+ · PyTorch", "Explicit model surgery, evaluation, recipes, and a local MCP/CLI surface.", ["abliteration", "evaluation", "model recipes"]),
        Describe(TransformersId, "Remove refusals with Transformers", "Apache-2.0", "https://github.com/Sumandora/remove-refusals-with-transformers", "Python · Transformers · PyTorch", "Experimental refusal-direction research code for Hugging Face Transformers models.", ["refusal direction", "HF Transformers", "research prototype"]),
    ];

    public static ModelTransformationPlan Plan(string adapterId, string modelPath, string outputPath)
    {
        var descriptor = List().FirstOrDefault(item => item.Id.Equals(NormalizeAdapterId(adapterId), StringComparison.OrdinalIgnoreCase))
            ?? throw new InvalidOperationException("Unknown model transformation adapter.");
        var input = ValidateDirectory(modelPath, "model path");
        var output = ValidateOutputDirectory(outputPath, input);
        var warnings = new List<string>
        {
            "Model transformation changes local model weights and may take substantial GPU, RAM, disk, and time.",
            "Skai does not install Python, PyTorch, or model dependencies automatically.",
            $"Review the upstream {descriptor.Name} license and model license before distributing the result.",
        };
        if (!descriptor.Available) warnings.Add("The upstream checkout was not found. Configure SKAI_MODEL_TOOLS_ROOT or place the checkout under .tmp/github-checkouts.");
        if (!descriptor.CanRunFromSkai) warnings.Add("This adapter is research-only in Skai until its input/output workflow is configured explicitly.");

        var command = descriptor.Id switch
        {
            ObliteratusId => $"python -m obliteratus obliterate \"{input}\" --output-dir \"{output}\" --device auto",
            HereticId => $"heretic \"{input}\" (configure save_directory in Heretic before running)",
            _ => $"python compute_refusal_dir.py (set MODEL_ID to \"{input}\"), then python inference.py",
        };
        return new(adapterId, input, output, command, descriptor.Available && descriptor.CanRunFromSkai && descriptor.Id == ObliteratusId, warnings.ToArray());
    }

    public static ModelTransformationRunSnapshot Start(string adapterId, string modelPath, string outputPath, bool confirmed)
    {
        if (!confirmed) throw new InvalidOperationException("Model transformation requires explicit confirmation.");
        var plan = Plan(adapterId, modelPath, outputPath);
        if (!plan.CanRun) throw new InvalidOperationException(string.Join(" ", plan.Warnings));
        if (Runs.Values.Any(run => run.Status is "starting" or "running")) throw new InvalidOperationException("A model transformation is already running.");

        var descriptor = List().Single(item => item.Id.Equals(NormalizeAdapterId(adapterId), StringComparison.OrdinalIgnoreCase));
        if (descriptor.CheckoutPath is null) throw new InvalidOperationException("The model transformation checkout is unavailable.");
        Directory.CreateDirectory(plan.OutputPath);
        var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = ResolvePythonExecutable(),
                WorkingDirectory = descriptor.CheckoutPath,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            },
        };
        process.StartInfo.ArgumentList.Add("-m");
        process.StartInfo.ArgumentList.Add("obliteratus");
        process.StartInfo.ArgumentList.Add("obliterate");
        process.StartInfo.ArgumentList.Add(plan.ModelPath);
        process.StartInfo.ArgumentList.Add("--output-dir");
        process.StartInfo.ArgumentList.Add(plan.OutputPath);
        process.StartInfo.ArgumentList.Add("--device");
        process.StartInfo.ArgumentList.Add("auto");
        if (!process.Start()) throw new InvalidOperationException("The Python process could not be started.");

        var run = new RunState(Guid.NewGuid().ToString("N"), NormalizeAdapterId(adapterId), plan.ModelPath, plan.OutputPath, process);
        Runs[run.Id] = run;
        _ = ObserveAsync(run);
        return run.Snapshot();
    }

    public static ModelTransformationRunSnapshot? GetStatus(string id) => Runs.TryGetValue(id, out var run) ? run.Snapshot() : null;

    public static ModelTransformationRunSnapshot? Cancel(string id)
    {
        if (!Runs.TryGetValue(id, out var run)) return null;
        try { if (!run.Process.HasExited) run.Process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
        run.Status = "cancelled";
        run.Error = "Cancelled by the user.";
        run.FinishedAtUtc ??= DateTimeOffset.UtcNow;
        return run.Snapshot();
    }

    public static bool IsAvailable(string adapterId) => List().Any(item => item.Id.Equals(NormalizeAdapterId(adapterId), StringComparison.OrdinalIgnoreCase) && item.Available);

    public static bool CanRun(string adapterId) => List().Any(item => item.Id.Equals(NormalizeAdapterId(adapterId), StringComparison.OrdinalIgnoreCase) && item.Available && item.CanRunFromSkai);

    private static string NormalizeAdapterId(string adapterId) => adapterId.Trim().ToLowerInvariant() switch
    {
        "model-transform-heretic" => HereticId,
        "model-transform-obliteratus" => ObliteratusId,
        "model-transform-transformers" => TransformersId,
        _ => adapterId.Trim().ToLowerInvariant(),
    };

    private static ModelTransformerDescriptor Describe(string id, string name, string license, string source, string runtime, string description, string[] capabilities)
    {
        var checkout = FindCheckout(id);
        return new(id, name, license, source, checkout, checkout is not null, id == ObliteratusId, runtime, description, capabilities);
    }

    private static async Task ObserveAsync(RunState run)
    {
        run.Status = "running";
        var stdout = run.Process.StandardOutput.ReadToEndAsync();
        var stderr = run.Process.StandardError.ReadToEndAsync();
        await run.Process.WaitForExitAsync().ConfigureAwait(false);
        var combined = (await stdout.ConfigureAwait(false) + "\n" + await stderr.ConfigureAwait(false)).Trim();
        run.Output = combined.Length > 16_000 ? combined[^16_000..] : combined;
        run.ExitCode = run.Process.ExitCode;
        run.Status = run.ExitCode == 0 ? "completed" : "failed";
        run.Error = run.ExitCode == 0 ? null : "The model transformation process exited with an error.";
        run.FinishedAtUtc = DateTimeOffset.UtcNow;
        run.Process.Dispose();
    }

    private static string? FindCheckout(string adapterId)
    {
        var repoName = adapterId;
        var roots = new List<string>();
        var configured = Environment.GetEnvironmentVariable("SKAI_MODEL_TOOLS_ROOT")?.Trim();
        if (!string.IsNullOrWhiteSpace(configured)) roots.Add(configured);
        foreach (var start in new[] { Directory.GetCurrentDirectory(), AppContext.BaseDirectory })
        {
            var current = new DirectoryInfo(start);
            for (var depth = 0; current is not null && depth < 8; depth++, current = current.Parent)
                roots.Add(current.FullName);
        }
        foreach (var root in roots.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var candidate = Path.Combine(root, ".tmp", "github-checkouts", repoName);
            if (Directory.Exists(candidate)) return candidate;
            candidate = Path.Combine(root, repoName);
            if (Directory.Exists(candidate)) return candidate;
        }
        return null;
    }

    private static string ValidateDirectory(string path, string label)
    {
        if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException($"Choose a {label}.", nameof(path));
        var full = Path.GetFullPath(path);
        if (!Directory.Exists(full)) throw new DirectoryNotFoundException($"The {label} does not exist.");
        return full;
    }

    private static string ValidateOutputDirectory(string path, string input)
    {
        if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException("Choose an output folder.", nameof(path));
        var full = Path.GetFullPath(path);
        if (full.Equals(input, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("The output folder must be different from the source model folder.");
        return full;
    }

    private static string ResolvePythonExecutable() => Environment.GetEnvironmentVariable("SKAI_MODEL_TOOLS_PYTHON")?.Trim() is { Length: > 0 } configured ? configured : OperatingSystem.IsWindows() ? "python.exe" : "python3";

    private sealed class RunState(string id, string adapterId, string modelPath, string outputPath, Process process)
    {
        public string Id { get; } = id;
        public string AdapterId { get; } = adapterId;
        public string ModelPath { get; } = modelPath;
        public string OutputPath { get; } = outputPath;
        public Process Process { get; } = process;
        public string Status { get; set; } = "starting";
        public string Output { get; set; } = string.Empty;
        public int? ExitCode { get; set; }
        public string? Error { get; set; }
        public DateTimeOffset StartedAtUtc { get; } = DateTimeOffset.UtcNow;
        public DateTimeOffset? FinishedAtUtc { get; set; }
        public ModelTransformationRunSnapshot Snapshot() => new(Id, AdapterId, Status, ModelPath, OutputPath, Output, ExitCode, StartedAtUtc, FinishedAtUtc, Error);
    }
}
