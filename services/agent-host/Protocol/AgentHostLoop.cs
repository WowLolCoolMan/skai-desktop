using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using SkaiDesktop.Core.Infrastructure;
using SkaiDesktop.Core.Models;
using SkaiDesktop.Core.Services;

namespace SkaiDesktop.AgentHost.Protocol;

public static partial class AgentHostLoop
{
    private const int ProtocolVersion = 1;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly Dictionary<string, ActiveTaskExecution> ActiveTaskExecutions = new(StringComparer.Ordinal);
    private static readonly object ActiveTaskExecutionsGate = new();
    private static readonly object LocalExecutionGate = new();
    private static int LocalAdmittedTaskCount;
    private static readonly object RuntimeCapacityGate = new();
    private static RuntimeCapacitySnapshot? CachedRuntimeCapacity;
    private static readonly Dictionary<string, WorkspaceTerminalSession> TerminalSessions = new(StringComparer.Ordinal);
    private static readonly object TerminalSessionsGate = new();
    private static readonly Dictionary<string, ModelPullOperation> ModelPulls = new(StringComparer.Ordinal);
    private static readonly object ModelPullsGate = new();
    private static readonly Dictionary<string, AirLlmInstallOperation> AirLlmInstalls = new(StringComparer.Ordinal);
    private static readonly object AirLlmInstallsGate = new();
    private static readonly Dictionary<string, ImageRuntimeInstallOperation> ImageRuntimeInstalls = new(StringComparer.Ordinal);
    private static readonly object ImageRuntimeInstallsGate = new();
    private static readonly object PersonaConversationRetentionGate = new();
    private static readonly Dictionary<string, ImageGenerationOperation> ImageGenerations = new(StringComparer.Ordinal);
    private static readonly object ImageGenerationsGate = new();
    private static readonly Dictionary<string, MarketplaceDownloadOperation> MarketplaceDownloads = new(StringComparer.Ordinal);
    private static readonly object MarketplaceDownloadsGate = new();
    private static readonly McpConnectionRegistry McpConnections = CreateMcpConnectionRegistry();
    private static readonly Dictionary<string, IMcpClient> ActiveMcpClients = new(StringComparer.Ordinal);
    private static readonly Dictionary<string, IReadOnlyList<McpToolDescriptor>> ActiveMcpTools = new(StringComparer.Ordinal);
    private static readonly object McpClientsGate = new();
    private static readonly object TaskJournalGate = new();
    private static readonly Lazy<OperationJournal> TaskJournal = new(CreateTaskOperationJournal);

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

    private static async Task RunPersonaConversationCleanupAsync(CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        while (await timer.WaitForNextTickAsync(cancellationToken).ConfigureAwait(false))
            CleanupExpiredPersonaConversations();
    }

    private static void CleanupExpiredPersonaConversations()
    {
        lock (PersonaConversationRetentionGate)
        {
            var settings = CreateSettingsStore().Load();
            var retentionMinutes = Math.Clamp(settings.PersonaConversationRetentionMinutes, 15, 10_080);
            var expiresBefore = DateTimeOffset.UtcNow.AddMinutes(-retentionMinutes);
            var store = CreateConversationStore();
            var sessions = store.Load();
            var remaining = sessions.Where(session =>
                !(session.PersonaId is not null || session.IsPersonaGroup)
                || session.UpdatedAt > expiresBefore).ToList();
            if (remaining.Count != sessions.Count) store.Save(remaining);
        }
    }

    private static AgentResponse ListProjects(AgentRequest request)
    {
        var projects = CreateProjectStore().Load()
            .OrderByDescending(project => project.UpdatedAt)
            .Select(project => new
            {
                id = project.Id,
                name = project.Name,
                instructions = project.Instructions,
                folderPaths = project.FolderPaths,
                gitHubRepository = project.GitHubRepository,
                updatedAt = project.UpdatedAt,
            })
            .ToArray();
        return new(ProtocolVersion, request.Id, true, projects);
    }

    private static AgentResponse RunProjectPreflight(AgentRequest request)
    {
        var id = RequiredBoundedString(request, "id", 128);
        var project = CreateProjectStore().Load().SingleOrDefault(item => item.Id == id)
            ?? throw new InvalidOperationException("The selected local project is no longer available.");
        var report = new ProjectPreflightService().Inspect(project.FolderPaths);
        return new(ProtocolVersion, request.Id, true, new
        {
            projectId = project.Id,
            projectName = project.Name,
            inspectedAt = DateTimeOffset.UtcNow,
            manifests = report.Manifests,
            runtimes = report.Runtimes,
            suggestedChecks = report.SuggestedChecks,
            executionNote = "Read-only scan only. Suggested checks have not been run; choose and review a command explicitly before execution."
        });
    }

    internal static bool RunsInBackground(string method) => method is "chat.complete" or "persona.group.complete" or "persona.discover"
        or "persona.research" or "persona.research.force" or "persona.draft" or "image.generate" or "marketplace.models.search";

    private static JsonSettingsStore CreateSettingsStore() =>
        new(Environment.GetEnvironmentVariable("SRAI_SETTINGS_PATH"));

    private static ScheduledTaskStore CreateScheduledTaskStore() =>
        new(Environment.GetEnvironmentVariable("SRAI_SCHEDULED_TASKS_PATH"));

    private static ProjectStore CreateProjectStore() =>
        new(Environment.GetEnvironmentVariable("SRAI_PROJECTS_PATH"));

    private static WorkspaceUndoStore CreateUndoStore() =>
        new(Environment.GetEnvironmentVariable("SRAI_UNDO_PATH"));

    private static AgentTaskArtifactStore CreateTaskStore() =>
        new(Environment.GetEnvironmentVariable("SRAI_TASKS_PATH"));
}
