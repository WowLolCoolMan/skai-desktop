using System.Text.Json;
using SkaiDesktop.Core.Models;

namespace SkaiDesktop.Core.Services;

/// <summary>
/// Finds conventional project checks without running them. Commands are only
/// returned as choices; execution happens through the explicit check protocol.
/// </summary>
public sealed class ProjectCheckDetector
{
    public IReadOnlyList<ProjectCheck> Detect(IEnumerable<string> roots)
    {
        var checks = new List<ProjectCheck>();
        foreach (var root in roots.Where(Directory.Exists).Select(Path.GetFullPath).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            AddPackageScripts(checks, root);
            AddFileChecks(checks, root);
        }
        return checks.GroupBy(check => check.Id, StringComparer.OrdinalIgnoreCase).Select(group => group.First()).Take(24).ToArray();
    }

    private static void AddPackageScripts(List<ProjectCheck> checks, string root)
    {
        var package = Path.Combine(root, "package.json");
        if (!File.Exists(package)) return;
        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(package));
            if (!document.RootElement.TryGetProperty("scripts", out var scripts) || scripts.ValueKind != JsonValueKind.Object) return;
            foreach (var name in new[] { "test", "check", "typecheck", "lint", "build", "verify" })
            {
                if (!scripts.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.String) continue;
                var command = $"npm run {name}";
                checks.Add(new($"npm:{name}", $"npm · {name}", command, ".", "package.json scripts"));
            }
        }
        catch (JsonException) { }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    private static void AddFileChecks(List<ProjectCheck> checks, string root)
    {
        if (Directory.EnumerateFiles(root, "*.sln", SearchOption.TopDirectoryOnly).Any()) checks.Add(new("dotnet:build", "dotnet · build solution", "dotnet build", ".", "solution file"));
        if (Directory.EnumerateFiles(root, "*.csproj", SearchOption.TopDirectoryOnly).Any()) checks.Add(new("dotnet:test", "dotnet · test project", "dotnet test", ".", "project file"));
        if (File.Exists(Path.Combine(root, "go.mod"))) checks.Add(new("go:test", "Go · test", "go test ./...", ".", "go.mod"));
        if (File.Exists(Path.Combine(root, "Cargo.toml"))) checks.Add(new("cargo:test", "Cargo · test", "cargo test", ".", "Cargo.toml"));
        if (File.Exists(Path.Combine(root, "pyproject.toml")) || File.Exists(Path.Combine(root, "pytest.ini"))) checks.Add(new("python:test", "Python · pytest", "python -m pytest", ".", "Python project metadata"));
    }
}
