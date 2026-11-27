using SkaiDesktop.Core.Services;
using static TestSupport;

internal static class DocumentCorpusStoreTests
{
    public static void Run()
    {
        var directory = Path.Combine(Path.GetTempPath(), "skai-corpus-" + Guid.NewGuid().ToString("N"));
        var path = Path.Combine(directory, "corpus.json");
        try
        {
            var store = new DocumentCorpusStore(path);
            var workspace = store.Upsert(null, "Workspace guide", "guide.md", "Workspace setup and local development.");
            var project = store.Upsert(null, "Project guide", "project.md", "Project deployment and local development.", scope: "project:demo_1");
            Check(workspace.Scope == "workspace" && store.Load("workspace").Single().Id == workspace.Id, "document corpus defaults to workspace scope and filters it");
            Check(store.Load("project:demo_1").Single().Id == project.Id, "document corpus lists the selected project scope");
            Check(store.Search("local development", scope: "project:demo_1").Single().Document.Id == project.Id, "document corpus retrieval respects project scope");
            Check(store.Search("deployment", scope: "workspace").Count == 0, "workspace retrieval does not leak project documents");
            Check(store.Load().Count == 2 && store.Search("local development").Count == 2, "unscoped document corpus requests continue to include every scope");
            var reloaded = new DocumentCorpusStore(path);
            Check(reloaded.Load("all").Count == 2 && reloaded.Load("project:demo_1").Single().Scope == "project:demo_1", "document scope survives local persistence");
            var rejected = false;
            try { store.Upsert(null, "Invalid scope", "bad.md", "Content", scope: "project:../escape"); }
            catch (ArgumentException) { rejected = true; }
            Check(rejected, "document corpus rejects malformed project scopes");
        }
        finally { if (Directory.Exists(directory)) DeleteDirectoryTree(directory); }
    }
}
