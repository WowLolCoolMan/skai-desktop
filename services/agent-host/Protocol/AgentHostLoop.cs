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
