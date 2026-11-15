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
            "product-audit",
            "Audit product experience",
            "Review a product flow for usability, consistency, accessibility, and clear user feedback using observable evidence.",
            "Analysis",
            "Audit the selected product experience using only the screenshots, source files, and project context provided or available locally. First identify the user, their goal, and the exact flow or screen under review. Trace the flow from its entry point through completion, including empty, loading, error, disabled, and narrow-window states when evidence exists. Review information hierarchy, labels, navigation, interaction affordances, accessibility semantics and keyboard behavior, responsive layout, consistency with nearby screens, and whether status and next steps are clear. Do not run commands, modify files, invent user research, or treat a design reference as proof of implemented behavior.\n\nReturn a short overall assessment and findings ordered by user impact. For each finding include severity (Blocker, High, Medium, or Low), the exact screen or file path and line when available, the observed evidence, the user consequence, and one specific improvement. Clearly distinguish a confirmed issue from an unverified risk or missing evidence. Call out strengths briefly, avoid generic design advice, and finish with the smallest useful set of changes to improve the flow.",
            ["project.read"]),
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
            "Review release readiness for the selected project for {{USER_NAME}} on {{DATE}}. Use the target version and release scope from the user or project context; if either is missing, mark it as not provided instead of guessing. Inspect available evidence for version consistency, build and test results, CI gates, dependency and package provenance, signing and packaging, release notes, diagnostics, update behavior, and rollback. Configuration that says a check should run is not proof that it passed; use actual recorded results where available and mark missing evidence as Unknown. Do not run commands, modify files, create a release, or publish artifacts.\n\nReturn a concise decision: Ready, Blocked, or Needs evidence. Follow it with a checklist where every item is Pass, Fail, or Unknown, its evidence with exact file paths and line numbers when available, and the impact of any gap. Treat any unresolved critical failure or unknown as a blocker. End with the smallest concrete actions needed to establish readiness. Do not claim a release is safe based only on an unexecuted workflow or undocumented assurance.",
            ["project.read"])
    ];

    public static SkillDefinition? Find(string id) =>
        BuiltIns.FirstOrDefault(skill => skill.Id.Equals(id.Trim(), StringComparison.OrdinalIgnoreCase));
}
