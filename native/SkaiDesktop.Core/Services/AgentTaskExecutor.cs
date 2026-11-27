using SkaiDesktop.Core.Models;

namespace SkaiDesktop.Core.Services;

/// <summary>
/// Runs one explicitly supplied agent-task handler with durable claim and terminal
/// state updates. The executor itself never selects a model, invokes a tool, or
/// starts a process; those capabilities remain the caller's explicit boundary.
/// </summary>
public sealed class AgentTaskExecutor
{
    private readonly AgentTaskArtifactStore _store;

    public AgentTaskExecutor(AgentTaskArtifactStore store) => _store = store ?? throw new ArgumentNullException(nameof(store));

    public async Task<AgentTaskArtifact?> ExecuteNextAsync(
        Func<AgentTaskArtifact, CancellationToken, Task<AgentTaskExecutionResult>> handler,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(handler);
        var task = _store.TryClaimReady();
        if (task is null) return null;
        return await ExecuteClaimedAsync(task, handler, cancellationToken).ConfigureAwait(false);
    }

    public async Task<AgentTaskArtifact> ExecuteAsync(
        string taskId,
        Func<AgentTaskArtifact, CancellationToken, Task<AgentTaskExecutionResult>> handler,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(taskId);
        ArgumentNullException.ThrowIfNull(handler);
        var task = _store.TryClaim(taskId);
        return await ExecuteClaimedAsync(task, handler, cancellationToken).ConfigureAwait(false);
    }

    private async Task<AgentTaskArtifact> ExecuteClaimedAsync(
        AgentTaskArtifact task,
        Func<AgentTaskArtifact, CancellationToken, Task<AgentTaskExecutionResult>> handler,
        CancellationToken cancellationToken)
    {
        try
        {
            var result = await handler(task, cancellationToken).ConfigureAwait(false);
            _store.BeginVerification(task.Id, result.Summary, result.ArtifactLabels);
            return _store.Verify(task.Id);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            return _store.Cancel(task.Id, "Execution was cancelled before the handler completed.");
        }
        catch (Exception error)
        {
            var summary = NormalizeFailureSummary(error, "The task handler failed.");
            return _store.Fail(task.Id, summary);
        }
    }

    /// <summary>
    /// Claims one task, creates a sibling Git worktree, persists the lease, and
    /// invokes the injected handler with that isolated target. The worktree is
    /// intentionally retained after the handler returns; callers must invoke
    /// <see cref="ReleaseTaskWorktreeAsync"/> after review and only a clean
    /// registered worktree can be removed.
    /// </summary>
    public async Task<AgentTaskArtifact?> ExecuteNextInWorktreeAsync(
        GitWorktreeCoordinator coordinator,
        string repositoryPath,
        string worktreeParent,
        Func<AgentTaskArtifact, GitWorktreeLease, CancellationToken, Task<AgentTaskExecutionResult>> handler,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(coordinator);
        ArgumentException.ThrowIfNullOrWhiteSpace(repositoryPath);
        ArgumentException.ThrowIfNullOrWhiteSpace(worktreeParent);
        ArgumentNullException.ThrowIfNull(handler);
        var task = _store.TryClaimReady();
        if (task is null) return null;

        GitWorktreeLease? lease = null;
        try
        {
            var target = Path.Combine(Path.GetFullPath(worktreeParent), $"agent-task-{task.Id}");
            lease = await coordinator.CreateAsync(repositoryPath, target, $"codex/agent-task/{task.Id}", cancellationToken: cancellationToken).ConfigureAwait(false);
            task = _store.AttachWorktree(task.Id, lease.RepositoryRoot, lease.WorktreePath, lease.Branch);
            var result = await handler(task, lease, cancellationToken).ConfigureAwait(false);
            return _store.Complete(task.Id, result.Summary, result.ArtifactLabels);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            return _store.Cancel(task.Id, "Execution was cancelled before the handler completed; the worktree was retained for review.");
        }
        catch (Exception error)
        {
            var summary = NormalizeFailureSummary(error, "The isolated task handler failed; the worktree was retained for review.");
            return _store.Fail(task.Id, summary);
        }
    }

    private static string NormalizeFailureSummary(Exception error, string fallback)
    {
        var raw = string.IsNullOrWhiteSpace(error.Message) ? fallback : error.Message;
        var normalized = string.Concat(raw.Select(character => char.IsControl(character) ? ' ' : character)).Trim();
        if (normalized.Length == 0) normalized = fallback;
        return normalized.Length <= AgentTaskArtifactStore.MaxResultCharacters
            ? normalized
            : normalized[..AgentTaskArtifactStore.MaxResultCharacters];
    }

    public async Task<AgentTaskArtifact> ReleaseTaskWorktreeAsync(
        string taskId,
        GitWorktreeCoordinator coordinator,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(taskId);
        ArgumentNullException.ThrowIfNull(coordinator);
        var task = _store.Get(taskId);
        if (task.WorktreeRepositoryRoot is null || task.WorktreePath is null || task.WorktreeBranch is null) throw new InvalidOperationException("The task has no retained worktree.");
        if (task.Status is AgentTaskStatuses.Proposed or AgentTaskStatuses.Queued or AgentTaskStatuses.AwaitingApproval or AgentTaskStatuses.Running or AgentTaskStatuses.Verifying)
            throw new InvalidOperationException("An active or unapproved task worktree cannot be released.");
        await coordinator.ReleaseCleanAsync(task.WorktreeRepositoryRoot, task.WorktreePath, cancellationToken).ConfigureAwait(false);
        return _store.ClearWorktree(task.Id);
    }
}

public sealed record AgentTaskExecutionResult(string Summary, IReadOnlyList<string>? ArtifactLabels = null);
