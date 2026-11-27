using SkaiDesktop.Core.Models;
using SkaiDesktop.Core.Services;
using static TestSupport;

internal static class AgentTaskArtifactTests
{
    public static async Task RunAsync()
    {
        // Keep the Git fixture path short enough for Git for Windows' internal
        // GIT_DIR budget even when the test runner's sandbox temp root is long.
        var root = Path.Combine(Path.GetTempPath(), "s-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            var store = new AgentTaskArtifactStore(Path.Combine(root, "agent-tasks.json"));
            var first = store.Create("Inspect provider routing", "Review capability preflight evidence.", "researcher", "run-1", responseMode: ChatResponseModes.Security, model: "org/model-8b", modelProvider: "AirLLM", modelSizeBytes: 8L << 30, modelContextLength: 131072, airLlmCompatible: true, gitHubIssueUrl: "https://github.com/skai/example/issues/42/", acceptanceCriteria: "The issue context survives reload.");
            var second = store.Create("Verify the routing change", "Check the result against the first task.", "verifier", dependsOn: [first.Id]);
            var isolated = store.Create("Isolated task", "Keep the main checkout unchanged.", environment: "worktree");
            Check(first.Status == AgentTaskStatuses.Proposed && first.ResponseMode == ChatResponseModes.Security && store.Get(first.Id).ResponseMode == ChatResponseModes.Security && store.Get(first.Id).Model == "org/model-8b" && store.Get(first.Id).AirLlmCompatible && first.GitHubIssueUrl == "https://github.com/skai/example/issues/42" && first.AcceptanceCriteria == "The issue context survives reload." && second.DependsOn.SequenceEqual([first.Id]), "agent task artifacts persist response mode, model capacity, GitHub issue context, and acceptance criteria");
            try
            {
                store.Create("Invalid issue context", "Reject non-GitHub issue links.", gitHubIssueUrl: "https://example.com/skai/example/issues/42");
                throw new Exception("Expected a non-GitHub issue URL to be rejected.");
            }
            catch (ArgumentException)
            {
                Check(true, "agent task artifacts reject issue links outside canonical GitHub issue URLs");
            }
            Check(isolated.Environment == "worktree" && store.Get(isolated.Id).Environment == "worktree", "agent task environment persists across store reloads");
            Check(store.GetNextReady() is null, "agent task readiness preview ignores proposed tasks");
            Check(store.TryClaimReady() is null, "queued dependent agent task is not claimable before its prerequisite is queued and completed");
            store.Queue(first.Id);
            var preview = store.GetNextReady();
            Check(preview?.Id == first.Id && store.Load().Single(task => task.Id == first.Id).Status == AgentTaskStatuses.Queued, "agent task readiness preview is dependency-aware and non-mutating");
            var claimedFirst = store.TryClaimReady();
            Check(claimedFirst?.Id == first.Id && claimedFirst.Status == AgentTaskStatuses.Running, "queued root agent task can be claimed without dispatching external work");
            var assignedModel = store.RecordEffectiveModel(first.Id, "org/model-8b", "AirLLM", 8L << 30, 131072, airLlmCompatible: true);
            Check(assignedModel.Model == "org/model-8b" && assignedModel.ModelProvider == "AirLLM" && assignedModel.ModelContextLength == 131072 && assignedModel.ModelSizeBytes == 8L << 30, "running task records its resolved model assignment and capacity metadata");
            store.RecordChangedFile(first.Id, "src/layout.ts");
            var runningWithChanges = store.RecordChangedFile(first.Id, "src/layout.ts");
            Check(runningWithChanges.Status == AgentTaskStatuses.Running && runningWithChanges.ChangedFiles.SequenceEqual(["src/layout.ts"]), "successful edits are persisted immediately on a running task and duplicate paths are ignored");
            var followUp = "Keep the retry behavior compatible with 3.11.\nAdd a regression test too.";
            var steeredFirst = store.AddFollowUpInstruction(first.Id, followUp);
            Check(steeredFirst.FollowUpInstructions.SequenceEqual([followUp]) && store.Get(first.Id).FollowUpInstructions.Count == 1, "running task steering persists a bounded multiline follow-up message");
            Check(!store.TryBeginVerificationAfterFollowUps(first.Id, 0, "Finished without applying the follow-up.", ["local-review"]) && store.Get(first.Id).Status == AgentTaskStatuses.Running, "task cannot enter verification while an accepted follow-up remains unapplied");
            Check(store.TryBeginVerificationAfterFollowUps(first.Id, 1, "Reviewed the retry behavior with the follow-up applied.", ["local-review"]) && store.Get(first.Id).Status == AgentTaskStatuses.Verifying, "task enters verification atomically after applying every accepted follow-up");
            try
            {
                store.RecordChangedFile(second.Id, "src/plant.ts");
                throw new Exception("Expected changed files on a proposed task to be rejected.");
            }
            catch (InvalidOperationException)
            {
                Check(true, "changed-file progress is accepted only after a task has started");
            }
            store.Complete(first.Id, "Routing evidence reviewed.", ["local-review"]);
            Check(store.Get(first.Id).ChangedFiles.SequenceEqual(["src/layout.ts"]), "the terminal task result retains files recorded during its running state");
            store.Queue(second.Id);
            var claimedSecond = store.TryClaimReady();
            Check(claimedSecond?.Id == second.Id, "dependent agent task becomes claimable only after its prerequisite completes");
            store.Fail(second.Id, "Verifier found an unresolved compatibility gap.");
            var cancelled = store.Create("Cancel before execution", "Review whether a queued plan can be withdrawn.");
            store.Queue(cancelled.Id);
            var cancelledPlan = store.CancelPlanned(cancelled.Id, "User withdrew the plan before execution.");
            Check(cancelledPlan.Status == AgentTaskStatuses.Cancelled && store.GetNextReady() is null, "proposed agent task plans can be cancelled before execution");
            var interruptedPlan = store.Create("Retry interrupted review", "Review an interrupted task before retrying.");
            store.Queue(interruptedPlan.Id);
            Check(store.TryClaimReady()?.Status == AgentTaskStatuses.Running, "retry fixture claims an agent task before simulated restart");
            store.ReconcileAfterRestart();
            var retriedPlan = store.RetryBlocked(interruptedPlan.Id);
            Check(retriedPlan.Status == AgentTaskStatuses.Queued && retriedPlan.ResultSummary?.Contains("Retry approved", StringComparison.Ordinal) == true,
                "blocked agent tasks can be explicitly re-queued without starting execution");
            var reloaded = new AgentTaskArtifactStore(Path.Combine(root, "agent-tasks.json")).Load();
            Check(reloaded.Any(task => task.Id == first.Id && task.Status == AgentTaskStatuses.Completed && task.ArtifactLabels.Contains("local-review")), "completed agent task artifacts persist bounded result labels");
            Check(reloaded.Any(task => task.Id == second.Id && task.Status == AgentTaskStatuses.Failed), "failed agent task artifacts persist their terminal status");
            Check(store.Search("verifier").Count == 1, "agent task search matches role metadata");
            var executor = new AgentTaskExecutor(store);
            var completedPlan = store.Create("Execute bounded review", "Run an injected review handler.");
            store.Queue(completedPlan.Id);
            var completed = await executor.ExecuteNextAsync((task, _) => Task.FromResult(new AgentTaskExecutionResult($"Completed {task.Title}.", ["handler-result"])));
            Check(completed?.Status == AgentTaskStatuses.Completed && completed.ArtifactLabels.Contains("handler-result"), "agent task executor durably completes an injected handler");
            var failedPlan = store.Create("Fail bounded review", "Run a failing injected handler.");
            store.Queue(failedPlan.Id);
            var failed = await executor.ExecuteNextAsync((_, _) => throw new InvalidOperationException("handler failure"));
            Check(failed?.Status == AgentTaskStatuses.Failed && failed.ResultSummary == "handler failure", "agent task executor durably records handler failure");
            var noisyFailurePlan = store.Create("Fail with noisy detail", "Persist a safe one-line handler failure.");
            store.Queue(noisyFailurePlan.Id);
            var noisyFailure = await executor.ExecuteNextAsync((_, _) => throw new InvalidOperationException("handler line 1\nhandler line 2"));
            Check(noisyFailure?.Status == AgentTaskStatuses.Failed && noisyFailure.ResultSummary == "handler line 1 handler line 2", "agent task executor normalizes multiline handler failures before persistence");
            var cancelledExecutionPlan = store.Create("Cancel bounded review", "Run a cancelled injected handler.");
            store.Queue(cancelledExecutionPlan.Id);
            using var cancellation = new CancellationTokenSource();
            cancellation.Cancel();
            var cancelledExecution = await executor.ExecuteNextAsync(async (_, token) =>
            {
                await Task.Delay(1, token);
                return new AgentTaskExecutionResult("unreachable");
            }, cancellation.Token);
            Check(cancelledExecution?.Status == AgentTaskStatuses.Cancelled, "agent task executor durably records cancellation");

            var isolatedRepository = Path.Combine(root, "agent-repo");
            Directory.CreateDirectory(isolatedRepository);
            RunGit(isolatedRepository, "init", "-b", "main");
            RunGit(isolatedRepository, "config", "user.email", "tests@example.invalid");
            RunGit(isolatedRepository, "config", "user.name", "Native Tests");
            File.WriteAllText(Path.Combine(isolatedRepository, "README.md"), "isolated fixture\n");
            RunGit(isolatedRepository, "add", "README.md");
            RunGit(isolatedRepository, "commit", "-m", "initial agent fixture");
            var isolatedPlan = store.Create("Execute in isolated worktree", "Inspect the isolated project target.", "specialist");
            store.Queue(isolatedPlan.Id);
            var worktreeExecutor = new AgentTaskExecutor(store);
            var coordinator = new GitWorktreeCoordinator();
            var worktreeParent = Path.Combine(root, "w");
            var activeWorktreeReleaseBlocked = false;
            var isolatedResult = await worktreeExecutor.ExecuteNextInWorktreeAsync(coordinator, isolatedRepository, worktreeParent, async (task, lease, _) =>
            {
                Check(task.WorktreePath == lease.WorktreePath && File.Exists(Path.Combine(lease.WorktreePath, "README.md")), "agent executor injects a real isolated worktree into the handler");
                Check(RunGitOutput(lease.WorktreePath, "branch", "--show-current").Trim() == lease.Branch, "agent executor persists the isolated task branch");
                try
                {
                    await worktreeExecutor.ReleaseTaskWorktreeAsync(task.Id, coordinator);
                }
                catch (InvalidOperationException error) when (error.Message.Contains("active or unapproved", StringComparison.Ordinal))
                {
                    activeWorktreeReleaseBlocked = true;
                }
                await Task.CompletedTask;
                return new AgentTaskExecutionResult("Isolated review completed.", ["isolated-review"]);
            });
            Check(activeWorktreeReleaseBlocked, "an active isolated task worktree cannot be released from disk");
            Check(isolatedResult?.Status == AgentTaskStatuses.Completed && isolatedResult.WorktreePath is not null && string.Equals(isolatedResult.WorktreeRepositoryRoot, isolatedRepository, OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal), "agent executor durably retains the worktree lease after handler completion");
            var releasedResult = await worktreeExecutor.ReleaseTaskWorktreeAsync(isolatedResult!.Id, coordinator);
            Check(releasedResult.WorktreePath is null && !Directory.Exists(Path.Combine(worktreeParent, $"agent-task-{isolatedResult.Id}")), "agent executor releases a retained clean worktree explicitly");
            try
            {
                store.Create("bad", "missing dependency", dependsOn: ["missing"]);
                throw new Exception("Expected an unknown dependency to be rejected.");
            }
            catch (ArgumentException)
            {
                Check(true, "agent task artifacts reject dependencies outside the local task set");
            }
        }
        finally { DeleteDirectoryTree(root); }
    }
}
