// Agent Host stdio protocol lifecycle and request-response scheduling.

using System.Text.Json;
using SkaiDesktop.Core.Infrastructure;
using SkaiDesktop.Core.Models;
using SkaiDesktop.Core.Services;

namespace SkaiDesktop.AgentHost.Protocol;

public static partial class AgentHostLoop
{
    private static readonly AsyncLocal<Action<string, bool>?> ChatProgress = new();
    public static async Task RunAsync(Stream input, Stream output, CancellationToken cancellationToken = default)
    {
        using var hostCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        if (!bool.TryParse(Environment.GetEnvironmentVariable("SKAI_SKIP_LEGACY_DATA_MIGRATION"), out var skipLegacyMigration) || !skipLegacyMigration)
            LegacyDataMigration.MigrateLocalData();
        using var reader = new StreamReader(input);
        await using var writer = new StreamWriter(output) { AutoFlush = true };
        using var voice = new OsNativeTtsService();
        // A process can exit after a task has been claimed but before its
        // durable result is written. Reconcile that state before advertising
        // the host as ready; never silently resume or re-run local work.
        var interruptedTasks = CreateTaskStore().ReconcileAfterRestart();
        lock (TaskJournalGate)
            foreach (var task in interruptedTasks) TaskJournal.Value.ReconcileRunAfterRestart(task.Id);
        var scheduledDispatcher = Task.Run(() => RunScheduledDispatcherAsync(hostCancellation.Token), hostCancellation.Token);
        CleanupExpiredPersonaConversations();
        CleanupExpiredWorkspaceData();
        var personaConversationCleanup = Task.Run(() => RunPersonaConversationCleanupAsync(hostCancellation.Token), hostCancellation.Token);
        var workspaceRetentionCleanup = Task.Run(() => RunWorkspaceRetentionCleanupAsync(hostCancellation.Token), hostCancellation.Token);

        try
        {
            // Model-bound requests (a persona reply on CPU can take minutes) run in the background so
            // quick requests keep being answered meanwhile. Electron treats a quick request that waits
            // 30 seconds as a hung host and restarts it, which used to kill the reply in progress.
            using var writeGate = new SemaphoreSlim(1, 1);
            async Task WriteResponseAsync(AgentResponse response)
            {
                var json = JsonSerializer.Serialize(response, JsonOptions);
                await writeGate.WaitAsync(CancellationToken.None).ConfigureAwait(false);
                try { await writer.WriteLineAsync(json).ConfigureAwait(false); }
                finally { writeGate.Release(); }
            }
            WriteHostMessage = WriteResponseAsync;
            AgentResponse HandleSafely(AgentRequest request)
            {
                var previous = ChatProgress.Value;
                ChatProgress.Value = request.Method == "chat.complete" && OptionalBoolean(request, "streamResponse")
                    ? (delta, reset) => WriteResponseAsync(new(ProtocolVersion, request.Id, true, new { delta, reset }, Kind: "progress")).GetAwaiter().GetResult()
                    : null;
                try { return Handle(request, voice); }
                catch (Exception ex) { return new(ProtocolVersion, request.Id, false, Error: new("REQUEST_FAILED", ex.Message)); }
                finally { ChatProgress.Value = previous; }
            }
            while (!hostCancellation.IsCancellationRequested)
            {
                var line = await reader.ReadLineAsync(hostCancellation.Token);
                if (line is null) break;
                if (string.IsNullOrWhiteSpace(line)) continue;

                AgentRequest request;
                try
                {
                    request = JsonSerializer.Deserialize<AgentRequest>(line, JsonOptions) ?? throw new InvalidOperationException("Request body was empty.");
                }
                catch (JsonException ex)
                {
                    await WriteResponseAsync(new(ProtocolVersion, string.Empty, false, Error: new("INVALID_JSON", ex.Message)));
                    continue;
                }
                catch (Exception ex)
                {
                    await WriteResponseAsync(new(ProtocolVersion, string.Empty, false, Error: new("REQUEST_FAILED", ex.Message)));
                    continue;
                }

                if (request.Method == "bridge.response")
                {
                    if (request.Params is { } bridgeParams && bridgeParams.TryGetProperty("result", out var bridgeResult)
                        && PendingBridgeRequests.TryRemove(request.Id, out var pendingBridge))
                        pendingBridge.TrySetResult(bridgeResult.Clone());
                    else if (PendingBridgeRequests.TryRemove(request.Id, out var missingBridge))
                        missingBridge.TrySetException(new InvalidDataException("The desktop preview bridge returned an invalid response."));
                    continue;
                }

                if (RunsInBackground(request.Method))
                {
                    _ = Task.Run(async () => await WriteResponseAsync(HandleSafely(request)).ConfigureAwait(false), CancellationToken.None);
                    continue;
                }
                await WriteResponseAsync(HandleSafely(request));
            }
        }
        catch (OperationCanceledException) when (hostCancellation.IsCancellationRequested)
        {
            // Normal shutdown; the dispatcher is cancelled below.
        }
        finally
        {
            hostCancellation.Cancel();
            try { await scheduledDispatcher.ConfigureAwait(false); }
            catch (OperationCanceledException) when (hostCancellation.IsCancellationRequested) { }
            try { await personaConversationCleanup.ConfigureAwait(false); }
            catch (OperationCanceledException) when (hostCancellation.IsCancellationRequested) { }
            try { await workspaceRetentionCleanup.ConfigureAwait(false); }
            catch (OperationCanceledException) when (hostCancellation.IsCancellationRequested) { }
        }
        await DisposeTerminalSessionsAsync().ConfigureAwait(false);
        await DisposeMcpClientsAsync().ConfigureAwait(false);
        WriteHostMessage = null;
        foreach (var pendingBridge in PendingBridgeRequests.Values) pendingBridge.TrySetCanceled();
        PendingBridgeRequests.Clear();
    }

    private static async Task<JsonElement> RequestDesktopPreviewAsync(string projectId, string? url, CancellationToken cancellationToken)
    {
        if (projectId.Length is < 1 or > 128 || projectId.Any(char.IsControl)) throw new ArgumentException("The preview project identity is invalid.", nameof(projectId));
        var id = $"preview-{Guid.NewGuid():N}";
        var completion = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (!PendingBridgeRequests.TryAdd(id, completion)) throw new InvalidOperationException("A desktop preview request could not be registered.");
        try
        {
            var writer = WriteHostMessage ?? throw new InvalidOperationException("The desktop preview bridge is unavailable.");
            await writer(new(ProtocolVersion, id, true, new { method = "browser.preview.inspect", parameters = new { projectId, url } }, Kind: "bridge_request")).ConfigureAwait(false);
            return await completion.Task.WaitAsync(TimeSpan.FromSeconds(30), cancellationToken).ConfigureAwait(false);
        }
        finally { PendingBridgeRequests.TryRemove(id, out _); }
    }

    private static async Task<JsonElement> RequestDesktopMcpToolApprovalAsync(string connectionId, McpToolDescriptor tool, bool isMutating, JsonElement arguments, CancellationToken cancellationToken)
    {
        var id = $"mcp-approval-{Guid.NewGuid():N}";
        var completion = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (!PendingBridgeRequests.TryAdd(id, completion)) throw new InvalidOperationException("A plugin approval request could not be registered.");
        try
        {
            var writer = WriteHostMessage ?? throw new InvalidOperationException("The desktop plugin approval bridge is unavailable.");
            await writer(new(ProtocolVersion, id, true, new
            {
                method = "mcp.tool.approval",
                parameters = new
                {
                    connectionId,
                    serverId = tool.ServerId,
                    toolName = tool.ToolName,
                    description = tool.Description,
                    isMutating,
                    arguments,
                },
            }, Kind: "bridge_request")).ConfigureAwait(false);
            return await completion.Task.WaitAsync(TimeSpan.FromMinutes(5), cancellationToken).ConfigureAwait(false);
        }
        finally { PendingBridgeRequests.TryRemove(id, out _); }
    }

    internal static bool RunsInBackground(string method) => method is "chat.complete" or "persona.group.complete" or "persona.discover"
        or "persona.research" or "persona.research.force" or "persona.draft" or "image.generate" or "marketplace.models.search" or "voice.whisper.transcribe" or "voice.speak";

}
