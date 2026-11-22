using SkaiDesktop.Core.Infrastructure;
using SkaiDesktop.Core.Services;

namespace SkaiDesktop.AgentHost.Protocol;

public static partial class AgentHostLoop
{
    private static readonly object PersonaConversationRetentionGate = new();

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
}
