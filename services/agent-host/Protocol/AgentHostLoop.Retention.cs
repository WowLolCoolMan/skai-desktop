using SkaiDesktop.Core.Models;

namespace SkaiDesktop.AgentHost.Protocol;

public static partial class AgentHostLoop
{
    private static async Task RunWorkspaceRetentionCleanupAsync(CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(10));
        while (await timer.WaitForNextTickAsync(cancellationToken).ConfigureAwait(false))
            CleanupExpiredWorkspaceData();
    }

    private static void CleanupExpiredWorkspaceData()
    {
        var settings = CreateSettingsStore().Load();
        var chatDays = SupportedRetentionDays(settings.ChatRetentionDays);
        var taskDays = SupportedRetentionDays(settings.TaskRetentionDays);
        var taskLogDays = SupportedRetentionDays(settings.TaskLogRetentionDays);

        if (chatDays > 0)
        {
            try
            {
                var store = CreateConversationStore();
                var sessions = store.Load();
                var cutoff = DateTimeOffset.UtcNow.AddDays(-chatDays);
                var retained = sessions.Where(session => session.Pinned || session.PersonaId is not null || session.IsPersonaGroup || session.UpdatedAt >= cutoff).ToList();
                if (retained.Count != sessions.Count) store.Save(retained);
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidDataException or System.Text.Json.JsonException)
            {
                Console.Error.WriteLine($"Automatic chat retention was skipped: {error.Message}");
            }
        }

        if (taskDays > 0)
        {
            try { CreateTaskStore().RemoveTerminalTasksBefore(DateTimeOffset.UtcNow.AddDays(-taskDays)); }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidDataException or System.Text.Json.JsonException)
            {
                Console.Error.WriteLine($"Automatic task retention was skipped: {error.Message}");
            }
        }

        if (taskLogDays > 0)
        {
            try
            {
                lock (TaskJournalGate)
                    TaskJournal.Value.RemoveTerminalRunsBefore(DateTimeOffset.UtcNow.AddDays(-taskLogDays));
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidDataException or System.Text.Json.JsonException)
            {
                Console.Error.WriteLine($"Automatic task-log retention was skipped: {error.Message}");
            }
        }
    }

    private static int SupportedRetentionDays(int days) => days is 0 or 7 or 30 or 90 or 365 ? days : 0;
}
