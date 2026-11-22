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
    private static AgentResponse ListConversations(AgentRequest request)
    {
        CleanupExpiredPersonaConversations();
        var scope = OptionalString(request, "scope") ?? "standard";
        var personaId = OptionalString(request, "personaId");
        var includeArchived = request.Params?.TryGetProperty("includeArchived", out var archivedValue) == true
            && archivedValue.ValueKind == JsonValueKind.True;
        if (scope is not ("standard" or "persona")) throw new InvalidOperationException("The conversation scope is invalid.");
        var conversations = CreateConversationStore().Load()
            .Where(session => scope == "persona" ? (session.PersonaId is not null || session.IsPersonaGroup) && (string.IsNullOrWhiteSpace(personaId) || session.PersonaId == personaId || session.PersonaIds.Contains(personaId)) : session.PersonaId is null && !session.IsPersonaGroup)
            .Where(session => includeArchived || !session.Archived)
            .OrderByDescending(session => session.Pinned)
            .ThenByDescending(session => session.UpdatedAt)
            .Select(session => new
            {
                id = session.Id,
                title = session.Title,
                mode = session.Mode,
                responseMode = ChatResponseModes.IsValid(session.ResponseMode) ? session.ResponseMode : ChatResponseModes.Think,
                model = session.Model,
                modelProvider = session.ModelProvider,
                modelSizeBytes = session.ModelSizeBytes,
                modelContextLength = session.ModelContextLength,
                personaId = session.PersonaId,
                personaName = session.PersonaName,
                personaSourceMode = session.PersonaSourceMode,
                personaIds = session.PersonaIds,
                isPersonaGroup = session.IsPersonaGroup,
                messages = session.Messages,
                projectId = session.ProjectId,
                projectName = session.ProjectName,
                includeProjectFilesInChat = session.IncludeProjectFilesInChat,
                updatedAt = session.UpdatedAt,
                pinned = session.Pinned,
                archived = session.Archived,
                tags = session.Tags,
                folderName = session.FolderName,
            })
            .ToArray();
        return new(ProtocolVersion, request.Id, true, conversations);
    }

    private static AgentResponse SearchConversations(AgentRequest request)
    {
        CleanupExpiredPersonaConversations();
        var query = OptionalString(request, "query") ?? string.Empty;
        var scope = OptionalString(request, "scope") ?? "standard";
        var personaId = OptionalString(request, "personaId");
        if (scope is not ("standard" or "persona")) throw new InvalidOperationException("The conversation scope is invalid.");
        var matches = ConversationSearchService.Search(CreateConversationStore().Load()
            .Where(session => scope == "persona" ? (session.PersonaId is not null || session.IsPersonaGroup) && (string.IsNullOrWhiteSpace(personaId) || session.PersonaId == personaId || session.PersonaIds.Contains(personaId)) : session.PersonaId is null && !session.IsPersonaGroup).ToList(), query)
            .Select(hit => new
            {
                id = hit.Session.Id,
                title = hit.Session.Title,
                mode = hit.Session.Mode,
                responseMode = ChatResponseModes.IsValid(hit.Session.ResponseMode) ? hit.Session.ResponseMode : ChatResponseModes.Think,
                model = hit.Session.Model,
                modelProvider = hit.Session.ModelProvider,
                modelSizeBytes = hit.Session.ModelSizeBytes,
                modelContextLength = hit.Session.ModelContextLength,
                personaId = hit.Session.PersonaId,
                personaName = hit.Session.PersonaName,
                personaSourceMode = hit.Session.PersonaSourceMode,
                personaIds = hit.Session.PersonaIds,
                isPersonaGroup = hit.Session.IsPersonaGroup,
                messages = hit.Session.Messages,
                projectId = hit.Session.ProjectId,
                projectName = hit.Session.ProjectName,
                includeProjectFilesInChat = hit.Session.IncludeProjectFilesInChat,
                updatedAt = hit.Session.UpdatedAt,
                pinned = hit.Session.Pinned,
                tags = hit.Session.Tags,
                display = hit.Display,
            })
            .ToArray();
        return new(ProtocolVersion, request.Id, true, matches);
    }

    private static AgentResponse ExportConversations(AgentRequest request)
    {
        var includeArchived = request.Params?.TryGetProperty("includeArchived", out var archivedValue) == true
            && archivedValue.ValueKind == JsonValueKind.True;
        var sessions = CreateConversationStore().Load().Where(session => session.PersonaId is null && !session.IsPersonaGroup).ToList();
        if (!includeArchived) sessions = sessions.Where(session => !session.Archived).ToList();
        var markdown = ConversationMarkdownExporter.Serialize(sessions);
        return new(ProtocolVersion, request.Id, true, new { fileName = "skai-chat-export.md", markdown, conversationCount = sessions.Count });
    }

    private static AgentResponse ExtractPdfAttachment(AgentRequest request)
    {
        var fileName = RequiredBoundedString(request, "fileName", 260);
        if (!ChatAttachmentPolicy.IsAllowedPdfName(fileName))
            throw new InvalidOperationException("Only approved PDF attachments can be extracted.");
        var encoded = RequiredBoundedString(request, "content", checked((int)(((ChatAttachmentPolicy.MaxPdfBytes + 2) / 3) * 4 + 4)));
        byte[] bytes;
        try { bytes = Convert.FromBase64String(encoded); }
        catch (FormatException exception) { throw new InvalidDataException("The PDF attachment encoding is invalid.", exception); }
        if (bytes.Length > ChatAttachmentPolicy.MaxPdfBytes)
            throw new InvalidDataException("The PDF attachment exceeds the size limit.");
        var content = PdfAttachmentTextExtractor.Extract(bytes, ChatAttachmentPolicy.MaxCharactersPerFile);
        return new(ProtocolVersion, request.Id, true, new { fileName, mediaType = (string?)null, content });
    }

    private static AgentResponse SaveConversation(AgentRequest request)
    {
        var title = RequiredBoundedString(request, "title", 200);
        var messages = request.Params?.TryGetProperty("messages", out var messageValue) == true
            ? messageValue.Deserialize<List<ChatMessage>>(JsonOptions)
            : throw new InvalidOperationException("conversation.save requires a messages array.");
        if (messages is null) throw new InvalidOperationException("conversation.save requires a messages array.");
        var store = CreateConversationStore();
        var sessions = store.Load();
        var requestedId = OptionalString(request, "id");
        var requestedMode = OptionalString(request, "mode");
        if (requestedMode is not null && requestedMode is not (WorkspaceModes.Chat or WorkspaceModes.CodingAgent))
            throw new InvalidOperationException("The conversation mode is invalid.");
        var session = string.IsNullOrWhiteSpace(requestedId)
            ? new ChatSession { Title = title, Messages = messages, Mode = requestedMode ?? WorkspaceModes.Chat }
            : sessions.SingleOrDefault(item => item.Id == requestedId)
              ?? throw new InvalidOperationException("The requested conversation does not exist.");
        session.Title = title;
        session.Messages = messages;
        if (requestedMode is not null) session.Mode = requestedMode;
        var requestedResponseMode = OptionalString(request, "responseMode");
        if (requestedResponseMode is not null)
        {
            if (!ChatResponseModes.IsValid(requestedResponseMode)) throw new InvalidOperationException("The conversation response mode is invalid.");
            session.ResponseMode = requestedResponseMode;
        }
        session.Model = OptionalString(request, "model");
        session.ModelProvider = OptionalString(request, "modelProvider");
        session.ModelSizeBytes = OptionalLong(request, "modelSizeBytes");
        session.ModelContextLength = OptionalInt(request, "modelContextLength");
        var requestedPersonaId = OptionalString(request, "personaId");
        var savedPersona = string.IsNullOrWhiteSpace(requestedPersonaId) ? null : CreateSettingsStore().Load().SavedPersonas.SingleOrDefault(item => item.Id == requestedPersonaId)
            ?? (string.IsNullOrWhiteSpace(requestedPersonaId) ? null : throw new KeyNotFoundException("The selected persona does not exist."));
        var requestedPersonaIds = request.Params?.TryGetProperty("personaIds", out _) == true
            ? OptionalStringList(request, "personaIds", 12, 128).Distinct(StringComparer.Ordinal).ToList()
            : session.PersonaIds;
        var isPersonaGroup = request.Params?.TryGetProperty("isPersonaGroup", out _) == true ? OptionalBoolean(request, "isPersonaGroup") : session.IsPersonaGroup;
        session.IsPersonaGroup = isPersonaGroup && requestedPersonaIds.Count >= 2;
        session.PersonaId = session.IsPersonaGroup ? null : savedPersona?.Id ?? (request.Params?.TryGetProperty("personaId", out _) != true ? session.PersonaId : null);
        session.PersonaName = session.IsPersonaGroup ? "Persona group" : savedPersona?.Name;
        session.PersonaSourceMode = session.IsPersonaGroup ? "group" : savedPersona?.SourceMode;
        session.PersonaIds = requestedPersonaIds;
        if (session.IsPersonaGroup) { session.PersonaId = null; session.PersonaName = "Persona group"; session.PersonaSourceMode = "group"; }
        var projectId = OptionalString(request, "projectId");
        if (string.IsNullOrWhiteSpace(projectId))
        {
            session.ProjectId = null;
            session.ProjectName = null;
            session.ProjectInstructions = null;
            session.IncludeProjectFilesInChat = false;
        }
        else
        {
            var project = CreateProjectStore().Load().SingleOrDefault(item => item.Id == projectId)
                ?? throw new KeyNotFoundException("The selected project does not exist.");
            session.ProjectId = project.Id;
            session.ProjectName = project.Name;
            session.ProjectInstructions = project.Instructions;
            session.IncludeProjectFilesInChat = true;
        }
        session.UpdatedAt = DateTimeOffset.UtcNow;
        if (!sessions.Contains(session)) sessions.Add(session);
        store.Save(sessions);
        return new(ProtocolVersion, request.Id, true, new { id = session.Id, title = session.Title, projectId = session.ProjectId, updatedAt = session.UpdatedAt });
    }

    private static string ResponseModePrompt(string responseMode) => responseMode switch
    {
        ChatResponseModes.Coding => "The user explicitly selected Coding mode. Prioritize practical software engineering, code, debugging, and implementation details while following the active workflow's required output format.",
        ChatResponseModes.Security => "The user explicitly selected Security / Risky mode. Interpret the request through a security research, testing, and risk-analysis lens while following the active workflow's required output format. This is user-selected context, not an automatic classification of the prompt.",
        _ => "The user explicitly selected Chat / Think mode. Use a general-purpose reasoning style while following the active workflow's required output format.",
    };

    private static AgentResponse ForkConversation(AgentRequest request)
    {
        var sourceId = RequiredBoundedString(request, "id", 128);
        var store = CreateConversationStore();
        var sessions = store.Load();
        var source = sessions.SingleOrDefault(item => item.Id == sourceId)
            ?? throw new KeyNotFoundException("The conversation to fork does not exist.");
        int? throughIndex = null;
        if (request.Params?.TryGetProperty("throughIndex", out var throughValue) == true && throughValue.ValueKind != JsonValueKind.Null)
        {
            if (!throughValue.TryGetInt32(out var parsedIndex)) throw new InvalidOperationException("throughIndex must be an integer.");
            throughIndex = parsedIndex;
        }
        var fork = new ChatSession
        {
            Title = string.IsNullOrWhiteSpace(source.Title) ? "Forked chat" : $"Fork: {source.Title}",
            Messages = ConversationForkService.CopyMessages(source.Messages, throughIndex).ToList(),
            ProjectId = source.ProjectId,
            ProjectName = source.ProjectName,
            ProjectInstructions = source.ProjectInstructions,
            Mode = source.Mode,
            ResponseMode = ChatResponseModes.IsValid(source.ResponseMode) ? source.ResponseMode : ChatResponseModes.Think,
            Model = source.Model,
            ModelProvider = source.ModelProvider,
            ModelSizeBytes = source.ModelSizeBytes,
            ModelContextLength = source.ModelContextLength,
            PersonaId = source.PersonaId,
            PersonaName = source.PersonaName,
            PersonaSourceMode = source.PersonaSourceMode,
            IncludeProjectFilesInChat = source.IncludeProjectFilesInChat,
            FolderName = source.FolderName,
            ForkedFrom = source.Id,
            BaseMessages = source.Messages.ToList(),
        };
        sessions.Add(fork);
        store.Save(sessions);
        return new(ProtocolVersion, request.Id, true, new { id = fork.Id, title = fork.Title, forkedFrom = fork.ForkedFrom, messageCount = fork.Messages.Count });
    }

    private static AgentResponse SaveConversationMetadata(AgentRequest request)
    {
        var id = RequiredBoundedString(request, "id", 128);
        var store = CreateConversationStore();
        var sessions = store.Load();
        var session = sessions.SingleOrDefault(item => item.Id == id)
            ?? throw new KeyNotFoundException("The conversation does not exist.");
        if (request.Params is not { } parameters) throw new InvalidOperationException("conversation.metadata.save requires metadata.");
        if (parameters.TryGetProperty("pinned", out var pinned) && pinned.ValueKind is JsonValueKind.True or JsonValueKind.False)
            session.Pinned = pinned.GetBoolean();
        if (parameters.TryGetProperty("responseMode", out var responseModeValue) && responseModeValue.ValueKind == JsonValueKind.String)
        {
            var responseMode = responseModeValue.GetString();
            if (!ChatResponseModes.IsValid(responseMode)) throw new InvalidOperationException("The conversation response mode is invalid.");
            session.ResponseMode = responseMode!;
        }
        if (parameters.TryGetProperty("archived", out var archived) && archived.ValueKind is JsonValueKind.True or JsonValueKind.False)
            session.Archived = archived.GetBoolean();
        if (parameters.TryGetProperty("title", out var title))
        {
            if (title.ValueKind is not JsonValueKind.String) throw new InvalidOperationException("title must be text.");
            var nextTitle = title.GetString()?.Trim();
            if (string.IsNullOrWhiteSpace(nextTitle) || nextTitle.Length > 200 || nextTitle.Any(char.IsControl))
                throw new InvalidOperationException("title must be between 1 and 200 visible characters.");
            session.Title = nextTitle;
        }
        if (parameters.TryGetProperty("folderName", out var folder))
        {
            if (folder.ValueKind is not JsonValueKind.String) throw new InvalidOperationException("folderName must be text.");
            session.FolderName = OptionalBoundedValue(folder.GetString(), 80);
        }
        if (parameters.TryGetProperty("tags", out var tags))
        {
            if (tags.ValueKind != JsonValueKind.Array) throw new InvalidOperationException("tags must be an array.");
            session.Tags = tags.EnumerateArray().Select(item => item.GetString() ?? string.Empty).ToList();
            if (session.Tags.Count > 8 || session.Tags.Any(tag => string.IsNullOrWhiteSpace(tag) || tag.Length > 32 || tag.Any(char.IsControl)))
                throw new InvalidOperationException("tags exceed the safety limit.");
            session.Tags = session.Tags.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        }
        session.UpdatedAt = DateTimeOffset.UtcNow;
        store.Save(sessions);
        return new(ProtocolVersion, request.Id, true, new { id = session.Id, title = session.Title, pinned = session.Pinned, archived = session.Archived, folderName = session.FolderName, tags = session.Tags, updatedAt = session.UpdatedAt });
    }

    private static AgentResponse ListQueuedMessages(AgentRequest request)
    {
        var queue = CreateChatQueueStore().Load();
        return new(ProtocolVersion, request.Id, true, queue.Select((item, index) => new
        {
            index,
            text = item.Text,
            attachments = item.Attachments?.Select(attachment => new { fileName = attachment.FileName, mediaType = attachment.MediaType }).ToArray(),
        }).ToArray());
    }

    private static AgentResponse EnqueueChatMessage(AgentRequest request)
    {
        var text = RequiredBoundedString(request, "text", 50_000);
        var attachments = OptionalAttachments(request);
        var store = CreateChatQueueStore();
        var queue = new ChatMessageQueue();
        foreach (var item in store.Load()) queue.Enqueue(item.Text, item.Attachments);
        queue.Enqueue(text, attachments);
        store.Save(queue.Snapshot());
        return new(ProtocolVersion, request.Id, true, queue.Snapshot().Select((item, index) => new
        {
            index,
            text = item.Text,
            attachments = item.Attachments?.Select(attachment => new { fileName = attachment.FileName, mediaType = attachment.MediaType }).ToArray(),
        }).ToArray());
    }

    private static AgentResponse RemoveQueuedMessage(AgentRequest request)
    {
        var index = request.Params is { } parameters && parameters.TryGetProperty("index", out var value) && value.TryGetInt32(out var parsed)
            ? parsed
            : throw new InvalidOperationException("chat.queue.remove requires an index.");
        var store = CreateChatQueueStore();
        var queue = new ChatMessageQueue();
        foreach (var item in store.Load()) queue.Enqueue(item.Text, item.Attachments);
        queue.RemoveAt(index);
        store.Save(queue.Snapshot());
        return new(ProtocolVersion, request.Id, true, queue.Snapshot().Select((item, position) => new { index = position, text = item.Text }).ToArray());
    }

    private static ConversationStore CreateConversationStore() =>
        new(Environment.GetEnvironmentVariable("SRAI_CONVERSATIONS_PATH"));

    private static MemoryStore CreateMemoryStore() =>
        new(Environment.GetEnvironmentVariable("SRAI_MEMORY_PATH"));

    private static DocumentCorpusStore CreateCorpusStore() =>
        new(Environment.GetEnvironmentVariable("SRAI_CORPUS_PATH"));

    private static ChatMessageQueueStore CreateChatQueueStore() =>
        new(Environment.GetEnvironmentVariable("SRAI_CHAT_QUEUE_PATH"));

}
