using System.Text.Json;
using SkaiDesktop.Core.Services;

namespace SkaiDesktop.AgentHost.Protocol;

public static partial class AgentHostLoop
{
    private static AgentResponse ListMemory(AgentRequest request) =>
        new(ProtocolVersion, request.Id, true, CreateMemoryStore().Load());

    private static AgentResponse SearchMemory(AgentRequest request) =>
        new(ProtocolVersion, request.Id, true, CreateMemoryStore().Search(OptionalString(request, "query"), OptionalString(request, "scope")));

    private static AgentResponse SaveMemory(AgentRequest request)
    {
        var store = CreateMemoryStore();
        var content = RequiredBoundedString(request, "content", MemoryStore.MaxContentCharacters);
        var scope = RequiredBoundedString(request, "scope", 128);
        var source = RequiredBoundedString(request, "source", 256);
        var approvalId = RequiredBoundedString(request, "approvalId", 128);
        var tags = OptionalStringList(request, "tags", MemoryStore.MaxTags, 64);
        var id = OptionalString(request, "id");
        var entry = string.IsNullOrWhiteSpace(id)
            ? store.Add(content, scope, source, approvalId, tags)
            : store.Update(id, content, scope, source, approvalId, tags);
        return new(ProtocolVersion, request.Id, true, entry);
    }

    private static AgentResponse RemoveMemory(AgentRequest request)
    {
        CreateMemoryStore().Remove(RequiredBoundedString(request, "id", 128));
        return new(ProtocolVersion, request.Id, true, new { removed = true });
    }

    private static AgentResponse SetMemoryEnabled(AgentRequest request)
    {
        var id = RequiredBoundedString(request, "id", 128);
        if (request.Params?.TryGetProperty("enabled", out var enabled) != true || enabled.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
            throw new InvalidOperationException("memory.enabled requires a boolean enabled value.");
        CreateMemoryStore().SetEnabled(id, enabled.GetBoolean());
        return new(ProtocolVersion, request.Id, true, new { id, enabled = enabled.GetBoolean() });
    }

    private static AgentResponse ExportMemory(AgentRequest request) =>
        new(ProtocolVersion, request.Id, true, new { fileName = "skai-memory-backup.json", json = CreateMemoryStore().ExportJson() });

    private static AgentResponse ListCorpus(AgentRequest request) =>
        new(ProtocolVersion, request.Id, true, CreateCorpusStore().Load(OptionalString(request, "scope")));

    private static AgentResponse SearchCorpus(AgentRequest request) =>
        new(ProtocolVersion, request.Id, true, CreateCorpusStore().Search(OptionalString(request, "query"), OptionalInt(request, "limit") ?? 12, OptionalString(request, "scope")));

    private static AgentResponse UpsertCorpus(AgentRequest request)
    {
        var store = CreateCorpusStore();
        var document = store.Upsert(OptionalString(request, "id"), RequiredBoundedString(request, "title", DocumentCorpusStore.MaxTitleCharacters), RequiredBoundedString(request, "source", DocumentCorpusStore.MaxSourceCharacters), RequiredBoundedString(request, "content", DocumentCorpusStore.MaxContentCharacters), OptionalStringList(request, "tags", 16, 64), OptionalString(request, "scope"));
        return new(ProtocolVersion, request.Id, true, document);
    }

    private static AgentResponse RemoveCorpus(AgentRequest request)
    {
        CreateCorpusStore().Remove(RequiredBoundedString(request, "id", 128));
        return new(ProtocolVersion, request.Id, true, new { removed = true });
    }

    /// <summary>Requests that wait on a model or long network research, answered off the request loop.</summary>

}
