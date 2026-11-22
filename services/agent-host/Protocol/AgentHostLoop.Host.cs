// Agent Host stdio protocol lifecycle and request-response scheduling.

using System.Text.Json;
using SkaiDesktop.Core.Infrastructure;
using SkaiDesktop.Core.Models;
using SkaiDesktop.Core.Services;

namespace SkaiDesktop.AgentHost.Protocol;

public static partial class AgentHostLoop
{
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
        var personaConversationCleanup = Task.Run(() => RunPersonaConversationCleanupAsync(hostCancellation.Token), hostCancellation.Token);

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
            AgentResponse HandleSafely(AgentRequest request)
            {
                try { return Handle(request, voice); }
                catch (Exception ex) { return new(ProtocolVersion, request.Id, false, Error: new("REQUEST_FAILED", ex.Message)); }
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
        }
        await DisposeTerminalSessionsAsync().ConfigureAwait(false);
        await DisposeMcpClientsAsync().ConfigureAwait(false);
    }

    internal static bool RunsInBackground(string method) => method is "chat.complete" or "persona.group.complete" or "persona.discover"
        or "persona.research" or "persona.research.force" or "persona.draft" or "image.generate" or "marketplace.models.search" or "voice.whisper.transcribe";

}
