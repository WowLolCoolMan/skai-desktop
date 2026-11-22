using System.Text.Json;

namespace SkaiDesktop.Core.Services;

public sealed record ProjectRuntimeCheck(string Name, bool Required, bool Available);
public sealed record ProjectPreflightReport(IReadOnlyList<string> Manifests, IReadOnlyList<ProjectRuntimeCheck> Runtimes, IReadOnlyList<string> SuggestedChecks);

/// <summary>Read-only project setup inspection. It never starts the suggested commands.</summary>
public sealed class ProjectPreflightService
{
    private const int MaxPackageManifestBytes = 1_048_576;

    public ProjectPreflightReport Inspect(IEnumerable<string> folders)
    {
        var roots = folders.Where(Directory.Exists).Select(Path.GetFullPath).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        if (roots.Length == 0) throw new DirectoryNotFoundException("Choose an available local project folder before running preflight.");
        foreach (var root in roots)
            if ((File.GetAttributes(root) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidOperationException("Project preflight does not follow linked or reparse-point folders.");

        var manifests = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var runtimeRequirements = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var suggestedChecks = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var root in roots)
        {
            var files = Directory.EnumerateFiles(root, "*", SearchOption.TopDirectoryOnly).Take(256).ToArray();
            var names = files.Select(Path.GetFileName).Where(name => name is not null).ToHashSet(StringComparer.OrdinalIgnoreCase);
            void Detect(string file, string runtime, string executable)
            {
                if (!names.Contains(file)) return;
                manifests.Add(file);
                runtimeRequirements[runtime] = executable;
            }
            Detect("package.json", "Node.js", "node");
            Detect("pyproject.toml", "Python", "python");
            Detect("requirements.txt", "Python", "python");
            Detect("Cargo.toml", "Rust", "cargo");
            Detect("go.mod", "Go", "go");
            foreach (var file in files.Where(path => Path.GetExtension(path).Equals(".csproj", StringComparison.OrdinalIgnoreCase) || Path.GetExtension(path).Equals(".sln", StringComparison.OrdinalIgnoreCase) || Path.GetExtension(path).Equals(".slnx", StringComparison.OrdinalIgnoreCase)))
            {
                manifests.Add(Path.GetFileName(file));
                runtimeRequirements[".NET SDK"] = "dotnet";
            }
            if (names.Contains("package.json")) ReadPackageScripts(Path.Combine(root, "package.json"), suggestedChecks);
        }

        var runtimes = runtimeRequirements.Select(item => new ProjectRuntimeCheck(item.Key, true, IsOnPath(item.Value))).ToArray();
        return new(manifests.OrderBy(value => value, StringComparer.OrdinalIgnoreCase).ToArray(), runtimes,
            suggestedChecks.Take(16).ToArray());
    }

    private static void ReadPackageScripts(string path, ISet<string> checks)
    {
        try
        {
            var info = new FileInfo(path);
            if (info.Length is <= 0 or > MaxPackageManifestBytes) return;
            using var document = JsonDocument.Parse(File.ReadAllText(path));
            if (!document.RootElement.TryGetProperty("scripts", out var scripts) || scripts.ValueKind != JsonValueKind.Object) return;
            foreach (var script in scripts.EnumerateObject())
                if (script.Name is "build" or "test" or "check" or "lint" or "typecheck") checks.Add($"{(OperatingSystem.IsWindows() ? "npm.cmd" : "npm")} run {script.Name}");
        }
        catch (Exception error) when (error is IOException or JsonException or UnauthorizedAccessException) { }
    }

    private static bool IsOnPath(string executable)
    {
        var path = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
        var extensions = OperatingSystem.IsWindows()
            ? (Environment.GetEnvironmentVariable("PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").Split(';', StringSplitOptions.RemoveEmptyEntries)
            : [string.Empty];
        foreach (var directory in path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        foreach (var extension in extensions)
            try
            {
                if (File.Exists(Path.Combine(directory, executable + extension))) return true;
            }
            catch (Exception error) when (error is ArgumentException or IOException or UnauthorizedAccessException) { }
        return false;
    }
}
