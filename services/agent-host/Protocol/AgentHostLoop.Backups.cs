using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using SkaiDesktop.Core.Infrastructure;
using SkaiDesktop.Core.Models;

namespace SkaiDesktop.AgentHost.Protocol;

public static partial class AgentHostLoop
{
    private sealed record WorkspaceStorageUsageRow(string label, long bytes, bool exists);
    private static readonly string[] WorkspaceBackupCategories = ["conversations", "settings", "personas", "projects"];

    private static AgentResponse PreviewWorkspaceBackup(AgentRequest request)
    {
        var counts = GetWorkspaceBackupCounts();
        var selected = ReadBackupCategories(request, allowEmpty: false);
        return new(ProtocolVersion, request.Id, true, new
        {
            categories = selected.Select(category => new { id = category, label = BackupCategoryLabel(category), count = counts[category], description = BackupCategoryDescription(category) }).ToArray(),
            redaction = "Secret-like tokens are redacted. Credential stores, MCP connections, project folder roots, project instructions, runtime cache paths, executable paths, and platform-local endpoints are excluded or kept local.",
            privacyNote = "Conversation messages, persona notes, project names, and optional profile fields may contain personal text. Review the selected categories before saving the file.",
            maxArchiveBytes = WorkspaceBackupArchive.MaxArchiveCharacters,
        });
    }

    private static AgentResponse ExportWorkspaceBackup(AgentRequest request)
    {
        var categories = ReadBackupCategories(request, allowEmpty: false);
        var passphrase = OptionalString(request, "passphrase");
        var payload = CreateWorkspaceBackupPayload(categories);
        var archive = WorkspaceBackupArchive.Create(payload, passphrase, JsonOptions, out var encrypted, out var redactions);
        return new(ProtocolVersion, request.Id, true, new
        {
            fileName = $"skai-workspace-backup-{DateTimeOffset.UtcNow:yyyyMMdd-HHmmss}.skai-backup",
            content = archive,
            encrypted,
            redactions,
            categories,
            bytes = Encoding.UTF8.GetByteCount(archive),
        });
    }

    private static AgentResponse PreviewWorkspaceRestore(AgentRequest request)
    {
        var archiveText = RequiredBackupText(request);
        var opened = WorkspaceBackupArchive.Open(archiveText, OptionalString(request, "passphrase"), JsonOptions);
        var categories = GetBackupPayloadCategories(opened.Payload);
        var counts = GetWorkspaceBackupCounts();
        var details = categories.Select(category =>
        {
            var incoming = GetPayloadCount(opened.Payload, category);
            var existing = counts[category];
            var collisions = GetCollisionCount(opened.Payload, category);
            return new { id = category, label = BackupCategoryLabel(category), incoming, existing, collisions, description = BackupCategoryDescription(category) };
        }).ToArray();
        return new(ProtocolVersion, request.Id, true, new
        {
            fileName = OptionalBoundedValue(OptionalString(request, "fileName"), 260),
            format = opened.Envelope.Format,
            version = opened.Envelope.Version,
            encrypted = opened.Envelope.Encrypted,
            integrity = "verified",
            createdAtUtc = opened.Envelope.CreatedAtUtc,
            archiveDigest = opened.Digest,
            stateFingerprint = GetWorkspaceStateFingerprint(categories),
            categories = details,
            excluded = new[] { "Credentials and API tokens", "MCP connections", "project folder permissions", "project instructions", "task and tool operation logs", "runtime/model caches" },
            portability = "Project folder roots and machine-specific paths are not imported. Existing local roots are retained when project metadata is replaced; new projects require folder access to be selected again.",
        });
    }

    private static AgentResponse ApplyWorkspaceRestore(AgentRequest request)
    {
        var opened = WorkspaceBackupArchive.Open(RequiredBackupText(request), OptionalString(request, "passphrase"), JsonOptions);
        var categories = ReadBackupCategories(request, allowEmpty: false);
        var available = GetBackupPayloadCategories(opened.Payload);
        if (categories.Any(category => !available.Contains(category, StringComparer.Ordinal)))
            throw new InvalidOperationException("The selected restore category is not present in this backup. Preview it again.");
        if (!string.Equals(RequiredBoundedString(request, "archiveDigest", 64), opened.Digest, StringComparison.Ordinal))
            throw new InvalidOperationException("The backup changed after preview. Preview it again before restoring.");
        if (!string.Equals(RequiredBoundedString(request, "stateFingerprint", 64), GetWorkspaceStateFingerprint(available), StringComparison.Ordinal))
            throw new InvalidOperationException("Workspace data changed after the restore preview. Review the preview again before restoring.");

        var policies = ReadRestorePolicies(request, categories);
        var imported = new Dictionary<string, int>(StringComparer.Ordinal);
        var skipped = new Dictionary<string, int>(StringComparer.Ordinal);
        if (categories.Contains("conversations", StringComparer.Ordinal))
        {
            var incoming = opened.Payload.Conversations!;
            var store = CreateConversationStore();
            var current = store.Load();
            var existingById = current.Select((item, index) => (item, index)).ToDictionary(pair => pair.item.Id, StringComparer.Ordinal);
            var added = 0; var kept = 0;
            foreach (var chat in incoming)
            {
                if (existingById.TryGetValue(chat.Id, out var match))
                {
                    if (policies["conversations"] == "replace") current[match.index] = chat;
                    else kept++;
                }
                else { current.Add(chat); existingById[chat.Id] = (chat, current.Count - 1); added++; }
            }
            store.Save(current);
            imported["conversations"] = added + (policies["conversations"] == "replace" ? incoming.Count - added - kept : 0);
            skipped["conversations"] = kept;
        }
        if (categories.Contains("settings", StringComparer.Ordinal))
        {
            var current = CreateSettingsStore().Load();
            if (policies["settings"] == "replace")
            {
                CreateSettingsStore().Save(WorkspaceBackupArchive.KeepMachineSettings(opened.Payload.Settings!, current, JsonOptions));
                imported["settings"] = 1;
                skipped["settings"] = 0;
            }
            else { imported["settings"] = 0; skipped["settings"] = 1; }
        }
        if (categories.Contains("personas", StringComparer.Ordinal))
        {
            var current = CreateSettingsStore().Load();
            var existingById = current.SavedPersonas.Select((item, index) => (item, index)).ToDictionary(pair => pair.item.Id, StringComparer.Ordinal);
            var added = 0; var kept = 0; var replaced = 0;
            foreach (var persona in opened.Payload.Personas!)
            {
                if (existingById.TryGetValue(persona.Id, out var match))
                {
                    if (policies["personas"] == "replace") { current.SavedPersonas[match.index] = persona; replaced++; }
                    else kept++;
                }
                else { current.SavedPersonas.Add(persona); existingById[persona.Id] = (persona, current.SavedPersonas.Count - 1); added++; }
            }
            current.SavedPersonas = current.SavedPersonas.Take(24).ToList();
            CreateSettingsStore().Save(current);
            imported["personas"] = added + replaced;
            skipped["personas"] = kept;
        }
        if (categories.Contains("projects", StringComparer.Ordinal))
        {
            var store = CreateProjectStore();
            var current = store.Load();
            var existingById = current.Select((item, index) => (item, index)).ToDictionary(pair => pair.item.Id, StringComparer.Ordinal);
            var added = 0; var kept = 0; var replaced = 0;
            foreach (var metadata in opened.Payload.Projects!)
            {
                if (existingById.TryGetValue(metadata.Id, out var match))
                {
                    if (policies["projects"] == "replace")
                    {
                        current[match.index] = new LocalProject { Id = metadata.Id, Name = metadata.Name, GitHubRepository = metadata.GitHubRepository, FolderPaths = match.item.FolderPaths };
                        replaced++;
                    }
                    else kept++;
                }
                else { current.Add(new LocalProject { Id = metadata.Id, Name = metadata.Name, GitHubRepository = metadata.GitHubRepository }); added++; }
            }
            store.Save(current);
            imported["projects"] = added + replaced;
            skipped["projects"] = kept;
        }
        AppendPermissionAuditEvent(null, null, "permission.workspace.restore", new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["categories"] = string.Join(",", categories),
            ["encrypted"] = opened.Envelope.Encrypted.ToString().ToLowerInvariant(),
            ["archiveDigest"] = opened.Digest,
        });
        return new(ProtocolVersion, request.Id, true, new { imported, skipped, integrity = "verified", machinePathsRestored = false });
    }

    private static AgentResponse GetWorkspaceStorageOverview(AgentRequest request)
    {
        var rows = new[]
        {
            StorageFileRow("Conversations", Environment.GetEnvironmentVariable("SRAI_CONVERSATIONS_PATH"), "conversations.json"),
            StorageFileRow("Settings and personas", Environment.GetEnvironmentVariable("SRAI_SETTINGS_PATH"), "settings.json"),
            StorageFileRow("Project metadata", Environment.GetEnvironmentVariable("SRAI_PROJECTS_PATH"), "projects.json"),
            StorageFileRow("Tasks and operation history", Environment.GetEnvironmentVariable("SRAI_OPERATIONS_PATH"), "operations.json"),
            StorageFileRow("Task plans", Environment.GetEnvironmentVariable("SRAI_TASKS_PATH"), "agent-tasks.json"),
            StorageFileRow("Memory notes", Environment.GetEnvironmentVariable("SRAI_MEMORY_PATH"), "memory.json"),
            StorageFileRow("Reference documents", Environment.GetEnvironmentVariable("SRAI_CORPUS_PATH"), "document-corpus.json"),
        };
        return new(ProtocolVersion, request.Id, true, new
        {
            localRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData, Environment.SpecialFolderOption.Create), "SkaiDesktop", "AI"),
            rows,
            totalBytes = rows.Sum(row => row.bytes),
            privacy = new[]
            {
                new { integration = "Local models and local voice runtimes", data = "Prompt or speech payloads used for the request", route = "Configured local service; exact endpoint is shown in Models & Providers and Voice & Audio." },
                new { integration = "MCP servers and connected tools", data = "Only the arguments shown in the one-call review", route = "Sent to the selected local or remote MCP server after explicit approval." },
                new { integration = "GitHub", data = "Repository metadata, selected diffs, commit or pull request details", route = "Sent only when the user starts an explicit GitHub operation." },
                new { integration = "Web search", data = "Search query and fetched public pages", route = "Sent to the selected search provider when web search is used." },
            },
            retention = "Conversations, tasks, media history, operation logs, and caches are currently retained until the user removes them or uses the owning feature's cleanup control. No automatic deletion schedule is enabled.",
            cleanup = "Skai reports app-owned JSON storage here. Model, voice, image, and Electron caches belong to their runtime/provider and are not deleted by this page.",
        });
    }

    private static WorkspaceStorageUsageRow StorageFileRow(string label, string? configuredPath, string defaultName)
    {
        var path = string.IsNullOrWhiteSpace(configuredPath)
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData, Environment.SpecialFolderOption.Create), "SkaiDesktop", "AI", defaultName)
            : Path.GetFullPath(configuredPath);
        long bytes = 0;
        var exists = false;
        try { exists = File.Exists(path); if (exists) bytes = new FileInfo(path).Length; } catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
        return new(label, bytes, exists);
    }

    private static WorkspaceBackupPayload CreateWorkspaceBackupPayload(IReadOnlyCollection<string> categories)
    {
        var payload = new WorkspaceBackupPayload(
            Conversations: categories.Contains("conversations", StringComparer.Ordinal) ? MakePortableConversations(CreateConversationStore().Load()) : null,
            Settings: categories.Contains("settings", StringComparer.Ordinal) ? WorkspaceBackupArchive.MakePortableSettings(CreateSettingsStore().Load(), includePersonas: false, JsonOptions) : null,
            Personas: categories.Contains("personas", StringComparer.Ordinal) ? CreateSettingsStore().Load().SavedPersonas : null,
            Projects: categories.Contains("projects", StringComparer.Ordinal) ? CreateProjectStore().Load().Select(item => new WorkspaceBackupProject(item.Id, item.Name, item.GitHubRepository)).ToList() : null);
        WorkspaceBackupArchive.Open(WorkspaceBackupArchive.Create(payload, null, JsonOptions, out _, out _), null, JsonOptions);
        return payload;
    }

    private static List<ChatSession> MakePortableConversations(IEnumerable<ChatSession> conversations) => conversations.Select(source =>
    {
        var copy = JsonSerializer.Deserialize<ChatSession>(JsonSerializer.Serialize(source, JsonOptions), JsonOptions) ?? new ChatSession();
        copy.ProjectId = null;
        copy.ProjectName = null;
        copy.ProjectInstructions = null;
        copy.IncludeProjectFilesInChat = false;
        return copy;
    }).ToList();

    private static Dictionary<string, int> GetWorkspaceBackupCounts()
    {
        var settings = CreateSettingsStore().Load();
        return new(StringComparer.Ordinal)
        {
            ["conversations"] = CreateConversationStore().Load().Count,
            ["settings"] = 1,
            ["personas"] = settings.SavedPersonas.Count,
            ["projects"] = CreateProjectStore().Load().Count,
        };
    }

    private static string[] GetBackupPayloadCategories(WorkspaceBackupPayload payload)
    {
        WorkspaceBackupArchive.Open(WorkspaceBackupArchive.Create(payload, null, JsonOptions, out _, out _), null, JsonOptions);
        var result = new List<string>();
        if (payload.Conversations is not null) result.Add("conversations");
        if (payload.Settings is not null) result.Add("settings");
        if (payload.Personas is not null) result.Add("personas");
        if (payload.Projects is not null) result.Add("projects");
        return result.ToArray();
    }

    private static int GetPayloadCount(WorkspaceBackupPayload payload, string category) => category switch
    {
        "conversations" => payload.Conversations?.Count ?? 0,
        "settings" => payload.Settings is null ? 0 : 1,
        "personas" => payload.Personas?.Count ?? 0,
        "projects" => payload.Projects?.Count ?? 0,
        _ => 0,
    };

    private static int GetCollisionCount(WorkspaceBackupPayload payload, string category)
    {
        var incoming = category switch
        {
            "conversations" => payload.Conversations?.Select(item => item.Id).ToHashSet(StringComparer.Ordinal) ?? [],
            "personas" => payload.Personas?.Select(item => item.Id).ToHashSet(StringComparer.Ordinal) ?? [],
            "projects" => payload.Projects?.Select(item => item.Id).ToHashSet(StringComparer.Ordinal) ?? [],
            _ => new HashSet<string>(StringComparer.Ordinal),
        };
        return category switch
        {
            "conversations" => CreateConversationStore().Load().Count(item => incoming.Contains(item.Id)),
            "personas" => CreateSettingsStore().Load().SavedPersonas.Count(item => incoming.Contains(item.Id)),
            "projects" => CreateProjectStore().Load().Count(item => incoming.Contains(item.Id)),
            "settings" => incoming.Count == 0 ? 0 : 1,
            _ => 0,
        };
    }

    private static string GetWorkspaceStateFingerprint(IEnumerable<string> categories)
    {
        var state = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var category in categories)
        {
            switch (category)
            {
                case "conversations": state[category] = CreateConversationStore().Load(); break;
                case "settings": state[category] = WorkspaceBackupArchive.MakePortableSettings(CreateSettingsStore().Load(), includePersonas: false, JsonOptions); break;
                case "personas": state[category] = CreateSettingsStore().Load().SavedPersonas; break;
                case "projects": state[category] = CreateProjectStore().Load(); break;
            }
        }
        return Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(state, JsonOptions))).ToLowerInvariant();
    }

    private static string BackupCategoryLabel(string category) => category switch
    {
        "conversations" => "Chats",
        "settings" => "Settings",
        "personas" => "Personas",
        "projects" => "Project metadata",
        _ => category,
    };

    private static string BackupCategoryDescription(string category) => category switch
    {
        "conversations" => "Saved chat history and branches; secret-like tokens are redacted.",
        "settings" => "Preferences, theme, profile, and local drafts; machine paths and provider endpoints are kept local.",
        "personas" => "Saved persona profiles and their user-selected source notes.",
        "projects" => "Project names and repository labels; folder roots and project instructions are excluded.",
        _ => string.Empty,
    };

    private static IReadOnlyList<string> ReadBackupCategories(AgentRequest request, bool allowEmpty)
    {
        if (request.Params is not { } parameters || !parameters.TryGetProperty("categories", out var value) || value.ValueKind != JsonValueKind.Array)
            throw new InvalidOperationException("Select one or more backup categories.");
        var selected = value.EnumerateArray().Select(item => item.ValueKind == JsonValueKind.String ? item.GetString() : null).ToArray();
        if (selected.Any(item => string.IsNullOrWhiteSpace(item) || !WorkspaceBackupCategories.Contains(item, StringComparer.Ordinal)) || selected.Distinct(StringComparer.Ordinal).Count() != selected.Length || !allowEmpty && selected.Length == 0)
            throw new InvalidOperationException("The workspace backup category selection is invalid.");
        return selected.Cast<string>().ToArray();
    }

    private static Dictionary<string, string> ReadRestorePolicies(AgentRequest request, IReadOnlyList<string> categories)
    {
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        if (request.Params is { } parameters && parameters.TryGetProperty("policies", out var policies) && policies.ValueKind == JsonValueKind.Object)
            foreach (var property in policies.EnumerateObject())
                if (categories.Contains(property.Name, StringComparer.Ordinal) && property.Value.ValueKind == JsonValueKind.String && property.Value.GetString() is "keep" or "replace") result[property.Name] = property.Value.GetString()!;
        foreach (var category in categories) result.TryAdd(category, "keep");
        return result;
    }

    private static string RequiredBackupText(AgentRequest request)
    {
        if (request.Params?.TryGetProperty("content", out var value) != true || value.ValueKind != JsonValueKind.String)
            throw new InvalidOperationException("Choose a Skai workspace backup file first.");
        var content = value.GetString() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(content) || content.Length > WorkspaceBackupArchive.MaxArchiveCharacters || content.Contains('\0'))
            throw new InvalidDataException("The workspace backup is empty or exceeds the 16 MB archive limit.");
        return content;
    }
}
