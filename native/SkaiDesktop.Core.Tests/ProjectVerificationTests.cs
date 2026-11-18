using SkaiDesktop.Core.Models;
using SkaiDesktop.Core.Services;
using static TestSupport;

internal static class ProjectVerificationTests
{
    public static void Run()
    {
        var root = Path.Combine(Path.GetTempPath(), "skai-project-checks-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            File.WriteAllText(Path.Combine(root, "package.json"), "{\"scripts\":{\"test\":\"vitest run\",\"dev\":\"vite\",\"build\":\"vite build\"}}");
            var checks = new ProjectCheckDetector().Detect([root]);
            Check(checks.Any(check => check.Id == "npm:test" && check.Command == "npm run test"), "project check detector finds explicit package test scripts");
            Check(checks.Any(check => check.Id == "npm:build"), "project check detector finds build scripts");
            Check(checks.All(check => check.Id != "npm:dev"), "project check detector excludes non-verification package scripts");

            var store = new AgentTaskArtifactStore(Path.Combine(root, "tasks.json"));
            var task = store.Create("Verify project", "Run a selected project check.");
            store.Queue(task.Id);
            Check(store.TryClaimReady()?.Status == AgentTaskStatuses.Running, "verification fixture claims a task before evidence is attached");
            store.Complete(task.Id, "Task changes are ready for review.");
            var started = DateTimeOffset.UtcNow.AddSeconds(-1);
            store.AttachVerificationEvidence(task.Id, new ProjectCheckEvidence("package:test", "Test", "npm run test", ".", "package.json", 0, "passed", false, false, started, DateTimeOffset.UtcNow));
            var reloaded = new AgentTaskArtifactStore(Path.Combine(root, "tasks.json")).Get(task.Id);
            Check(reloaded.VerificationEvidence?.ExitCode == 0 && reloaded.VerificationEvidence.Output == "passed", "verification evidence persists beside the task artifact");
        }
        finally { DeleteDirectoryTree(root); }
    }
}
