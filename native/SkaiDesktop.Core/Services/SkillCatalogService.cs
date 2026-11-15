// Static list of built-in read-only workflow skills and their permissions.
// Used by: the Agent Host skill catalog protocol.

namespace SkaiDesktop.Core.Services;

public sealed record SkillDefinition(
    string Id,
    string Name,
    string Description,
    string Category,
    string Prompt,
    IReadOnlyList<string> RequiredPermissions);

public static class SkillCatalogService
{
    public static IReadOnlyList<SkillDefinition> BuiltIns { get; } =
    [
        new(
            "project-audit",
            "Audit project health",
            "Review project structure, reliability, maintainability, and test coverage using file-based evidence.",
            "Analysis",
            "Audit the selected project using only the files and context available to you. First identify the project roots and main technologies. Review the structure and dependency boundaries, build and test configuration, CI checks, error handling, configuration defaults, and the most relevant source files. Do not run commands, modify files, or infer that a check passed just because configuration exists.\n\nReturn a short summary followed by findings grouped as Critical, High, Medium, and Low. For each finding include the exact file path and line when available, observed evidence, user or operational impact, and one concrete next step. Distinguish confirmed problems from risks and missing evidence. If a category cannot be verified, say so. Avoid generic advice and do not list findings without supporting evidence.",
            ["project.read"]),
        new(
            "release-readiness",
            "Review release readiness",
            "Assess whether a specific release is supported by build, test, package, and rollback evidence.",
            "Delivery",
            "Review release readiness for the selected project. Use the target version and release scope from the user or project context; if either is missing, mark it as not provided instead of guessing. Inspect available evidence for version consistency, build and test results, CI gates, dependency and package provenance, signing and packaging, release notes, diagnostics, update behavior, and rollback. Configuration that says a check should run is not proof that it passed; use actual recorded results where available and mark missing evidence as Unknown. Do not run commands, modify files, create a release, or publish artifacts.\n\nReturn a concise decision: Ready, Blocked, or Needs evidence. Follow it with a checklist where every item is Pass, Fail, or Unknown, its evidence with exact file paths and line numbers when available, and the impact of any gap. Treat any unresolved critical failure or unknown as a blocker. End with the smallest concrete actions needed to establish readiness. Do not claim a release is safe based only on an unexecuted workflow or undocumented assurance.",
            ["project.read"])
    ];

    public static SkillDefinition? Find(string id) =>
        BuiltIns.FirstOrDefault(skill => skill.Id.Equals(id.Trim(), StringComparison.OrdinalIgnoreCase));
}
