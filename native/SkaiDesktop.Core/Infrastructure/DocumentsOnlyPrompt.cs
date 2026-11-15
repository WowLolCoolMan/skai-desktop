using SkaiDesktop.Core.Models;

namespace SkaiDesktop.Core.Infrastructure;

/// <summary>Applies the per-request documents-only grounding instruction to provider messages.</summary>
public static class DocumentsOnlyPrompt
{
    public static IReadOnlyList<ChatMessage> Apply(IReadOnlyList<ChatMessage> messages)
    {
        ArgumentNullException.ThrowIfNull(messages);
        var latestUserMessage = messages.LastOrDefault(message => string.Equals(message.Role, "user", StringComparison.OrdinalIgnoreCase));
        if (latestUserMessage?.Attachments is not { Count: > 0 })
            throw new InvalidOperationException("Documents-only mode needs at least one document attached to this message.");

        var prepared = messages.ToList();
        var systemIndex = prepared.FindIndex(message => string.Equals(message.Role, "system", StringComparison.OrdinalIgnoreCase));
        if (systemIndex >= 0)
            prepared[systemIndex] = prepared[systemIndex] with { Content = prepared[systemIndex].Content + "\n\n" + ModelInstructions.DocumentsOnly };
        else
            prepared.Insert(0, new ChatMessage("system", ModelInstructions.DocumentsOnly));
        return prepared;
    }
}
