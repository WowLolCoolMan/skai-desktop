using SkaiDesktop.Core.Services;
using static TestSupport;

internal static class InstructionConflictTests
{
    public static void Run()
    {
        var direct = InstructionConflictDetector.Find(
            "Edit src/App.tsx and update the layout.",
            [("Project instructions", "Do not edit src/App.tsx.")]);
        Check(direct.Count == 1 && direct[0].Contains("src/app.tsx", StringComparison.OrdinalIgnoreCase), "instruction guard flags a direct project-file contradiction");

        var allowed = InstructionConflictDetector.Find(
            "Review src/App.tsx and summarize the current behavior.",
            [("Project instructions", "Do not edit src/App.tsx.")]);
        Check(allowed.Count == 0, "instruction guard allows read-only review when a file is protected");

        var only = InstructionConflictDetector.Find(
            "Update src/App.tsx and src/styles.css.",
            [("Acceptance criteria", "Only edit src/App.tsx for this task.")]);
        Check(only.Count == 1 && only[0].Contains("src/styles.css", StringComparison.OrdinalIgnoreCase), "instruction guard flags edits outside an only-file constraint");

        var broad = InstructionConflictDetector.Find(
            "Refactor the project files to remove the duplicated layout.",
            [("Project instructions", "Do not edit any files until the owner approves the plan.")]);
        Check(broad.Count == 1 && broad[0].Contains("file edits", StringComparison.OrdinalIgnoreCase), "instruction guard flags broad no-edit constraints");

        var reverse = InstructionConflictDetector.Find(
            "Do not change src/App.tsx.",
            [("Acceptance criteria", "Update src/App.tsx to expose the new route.")]);
        Check(reverse.Count == 1 && reverse[0].Contains("src/app.tsx", StringComparison.OrdinalIgnoreCase), "instruction guard checks user and reference constraints in both directions");
    }
}
