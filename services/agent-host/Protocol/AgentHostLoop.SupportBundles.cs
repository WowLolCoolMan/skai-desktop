using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using SkaiDesktop.Core.Infrastructure;

namespace SkaiDesktop.AgentHost.Protocol;

/// <summary>
/// Builds a small, local-only diagnostic bundle. This is deliberately a
/// summary rather than a workspace dump: project roots, chat text, prompts,
/// credentials, provider endpoints, and runtime paths never enter the bundle.
/// </summary>
public static partial class AgentHostLoop
{
    private static readonly string[] SupportBundleSections = ["runtime", "storage", "security", "activity"];

    private static readonly (string Id, string Label, string Description)[] SupportBundleSectionDetails =
    [
        ("runtime", "Runtime health", "Skai version, local provider type, model label, and protocol capabilities."),
        ("storage", "Local storage", "App-owned record counts and byte totals without the local storage path."),
        ("security", "Safety boundaries", "Sandbox status, configured limits, and permission-event counts."),
        ("activity", "Workspace activity", "Counts for chats, tasks, projects, schedules, memory, and references."),
    ];

    private static readonly object[] SupportBundleRedactions =
    [
        new { id = "credentials", label = "Credentials", detail = "API keys, tokens, cookies, and credential-store contents." },
        new { id = "paths", label = "Machine paths", detail = "Project roots, executable paths, cache paths, and usernames." },
        new { id = "content", label = "User content", detail = "Chat messages, prompts, attachments, persona notes, and project instructions." },
        new { id = "network", label = "Provider routes", detail = "Exact endpoints, connection strings, and remote server addresses." },
        new { id = "identifiers", label = "Private identifiers", detail = "Git remotes, repository URLs, operation IDs, and file names." },
        new { id = "environment", label = "Environment values", detail = "Environment variables and process arguments are never read." },
    ];

    private static AgentResponse PreviewSupportBundle(AgentRequest request)
    {
        var sections = ReadSupportBundleSections(request);
        var snapshot = BuildSupportBundleSnapshot(sections);
        return new(ProtocolVersion, request.Id, true, new
        {
            generatedAtUtc = DateTimeOffset.UtcNow,
            sections = sections.Select(id =>
            {
                var detail = SupportBundleSectionDetails.Single(item => item.Id == id);
                return new { id = detail.Id, label = detail.Label, description = detail.Description, summary = SupportBundleSummary(id, snapshot[id]) };
            }).ToArray(),
            redactions = SupportBundleRedactions,
            privacyNote = "Preview is generated locally. Export contains summaries only; it does not include chat text, project files, credentials, exact paths, or provider endpoints.",
            maxCharacters = 2_000_000,
        });
    }

    private static AgentResponse ExportSupportBundle(AgentRequest request)
    {
        var sections = ReadSupportBundleSections(request);
        var generatedAt = DateTimeOffset.UtcNow;
        var payload = new
        {
            format = "skai.support-bundle",
            schemaVersion = 1,
            generatedAtUtc = generatedAt,
            appVersion = typeof(AgentHostLoop).Assembly.GetName().Version?.ToString() ?? "development",
            sections = BuildSupportBundleSnapshot(sections),
            redactions = SupportBundleRedactions,
            privacy = new
            {
                localOnly = true,
                includesUserContent = false,
                includesCredentials = false,
                includesMachinePaths = false,
                includesProviderEndpoints = false,
            },
        };
        var json = JsonSerializer.Serialize(payload, JsonOptions);
        if (json.Length > 2_000_000) throw new InvalidOperationException("The support bundle exceeded the 2 MB safety limit.");
        return new(ProtocolVersion, request.Id, true, new
        {
            fileName = $"skai-support-bundle-{generatedAt:yyyyMMdd-HHmmss}.json",
            content = json,
            bytes = Encoding.UTF8.GetByteCount(json),
            redactions = SupportBundleRedactions.Length,
            sections,
        });
    }

    private static IReadOnlyList<string> ReadSupportBundleSections(AgentRequest request)
    {
        if (request.Params is not { } parameters || !parameters.TryGetProperty("sections", out var value) || value.ValueKind != JsonValueKind.Array)
            throw new InvalidOperationException("Select one or more support-bundle sections.");
        var selected = value.EnumerateArray().Select(item => item.ValueKind == JsonValueKind.String ? item.GetString() : null).ToArray();
        if (selected.Length == 0 || selected.Any(item => string.IsNullOrWhiteSpace(item) || !SupportBundleSections.Contains(item, StringComparer.Ordinal)) || selected.Distinct(StringComparer.Ordinal).Count() != selected.Length)
            throw new InvalidOperationException("The support-bundle section selection is invalid.");
        return selected.Cast<string>().ToArray();
    }

    private static Dictionary<string, object> BuildSupportBundleSnapshot(IReadOnlyCollection<string> sections)
    {
        var result = new Dictionary<string, object>(StringComparer.Ordinal);
        foreach (var section in sections)
            result[section] = section switch
            {
                "runtime" => BuildSupportRuntimeSnapshot(),
                "storage" => BuildSupportStorageSnapshot(),
                "security" => BuildSupportSecuritySnapshot(),
                "activity" => BuildSupportActivitySnapshot(),
                _ => throw new InvalidOperationException("Unknown support-bundle section."),
            };
        return result;
    }

    private static object BuildSupportRuntimeSnapshot()
    {
        var settings = CreateSettingsStore().Load();
        return new
        {
            platform = OperatingSystem.IsWindows() ? "Windows" : OperatingSystem.IsLinux() ? "Linux" : "Other",
            architecture = RuntimeInformation.OSArchitecture.ToString(),
            appVersion = typeof(AgentHostLoop).Assembly.GetName().Version?.ToString() ?? "development",
            protocolVersion = ProtocolVersion,
            provider = settings.ModelProvider,
            model = settings.Model,
            localEndpointConfigured = LocalEndpoint.IsLocal(settings.Endpoint),
            developerMode = settings.DeveloperMode,
        };
    }

    private static object BuildSupportStorageSnapshot()
    {
        var rows = new[]
        {
            StorageFileRow("Conversations", Environment.GetEnvironmentVariable("SRAI_CONVERSATIONS_PATH"), "conversations.json"),
            StorageFileRow("Settings", Environment.GetEnvironmentVariable("SRAI_SETTINGS_PATH"), "settings.json"),
            StorageFileRow("Projects", Environment.GetEnvironmentVariable("SRAI_PROJECTS_PATH"), "projects.json"),
            StorageFileRow("Operations", Environment.GetEnvironmentVariable("SRAI_OPERATIONS_PATH"), "operations.json"),
            StorageFileRow("Tasks", Environment.GetEnvironmentVariable("SRAI_TASKS_PATH"), "agent-tasks.json"),
            StorageFileRow("Memory", Environment.GetEnvironmentVariable("SRAI_MEMORY_PATH"), "memory.json"),
            StorageFileRow("References", Environment.GetEnvironmentVariable("SRAI_CORPUS_PATH"), "document-corpus.json"),
        };
        return new
        {
            totalBytes = rows.Sum(row => row.bytes),
            filesPresent = rows.Count(row => row.exists),
            files = rows.Select(row => new { label = row.label, bytes = row.bytes, exists = row.exists }).ToArray(),
        };
    }

    private static object BuildSupportSecuritySnapshot()
    {
        var projects = CreateProjectStore().Load();
        var events = CreateTaskOperationJournal().Load().Events;
        var sandbox = OperatingSystem.IsWindows() || OperatingSystem.IsLinux();
        return new
        {
            sandboxAvailable = sandbox,
            sandboxPlatform = OperatingSystem.IsWindows() ? "windows-process-security" : OperatingSystem.IsLinux() ? "bubblewrap-and-cgroups" : "unsupported-platform",
            projectGrantCount = projects.Count(project => project.FolderPaths.Count > 0),
            permissionEventCount = events.Count(item => item.Type.StartsWith("permission.", StringComparison.Ordinal)),
            limits = new
            {
                codingActionsPerTask = MaxCodingActions,
                commandsPerTask = MaxCodingCommands,
                commandTimeoutSeconds = (int)WorkspaceCommandRunner.MaxTimeout.TotalSeconds,
                commandCharacters = WorkspaceCommandRunner.MaxCommandCharacters,
                commandOutputCharacters = WorkspaceCommandRunner.MaxOutputCharacters,
                editableFileCharacters = WorkspaceFileEditor.MaxCharacters,
            },
        };
    }

    private static object BuildSupportActivitySnapshot()
    {
        var settings = CreateSettingsStore().Load();
        var operations = CreateTaskOperationJournal().Load();
        return new
        {
            conversations = CreateConversationStore().Load().Count,
            projects = CreateProjectStore().Load().Count,
            tasks = CreateTaskStore().Load().Count,
            scheduledTasks = CreateScheduledTaskStore().Load().Count,
            operationRuns = operations.Runs.Count,
            operationEvents = operations.Events.Count,
            memoryNotes = CreateMemoryStore().Load().Count,
            referenceDocuments = CreateCorpusStore().Load(null).Count,
            savedPersonas = settings.SavedPersonas.Count,
        };
    }

    private static string SupportBundleSummary(string section, object value)
    {
        var json = JsonSerializer.SerializeToElement(value, JsonOptions);
        return section switch
        {
            "runtime" => $"{json.GetProperty("platform").GetString()} · {json.GetProperty("provider").GetString()} · local endpoint {((json.GetProperty("localEndpointConfigured").GetBoolean()) ? "configured" : "not configured")}",
            "storage" => $"{json.GetProperty("filesPresent").GetInt32()} app-owned files · {json.GetProperty("totalBytes").GetInt64():N0} bytes",
            "security" => $"{json.GetProperty("projectGrantCount").GetInt32()} project grants · {json.GetProperty("permissionEventCount").GetInt32()} permission events · sandbox {((json.GetProperty("sandboxAvailable").GetBoolean()) ? "available" : "unavailable")}",
            "activity" => $"{json.GetProperty("conversations").GetInt32()} chats · {json.GetProperty("tasks").GetInt32()} tasks · {json.GetProperty("projects").GetInt32()} projects",
            _ => "Ready",
        };
    }
}
