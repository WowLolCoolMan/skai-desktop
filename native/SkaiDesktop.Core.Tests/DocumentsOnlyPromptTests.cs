using SkaiDesktop.Core.Infrastructure;
using SkaiDesktop.Core.Models;
using static TestSupport;

internal static class DocumentsOnlyPromptTests
{
    public static void Run()
    {
        var originalSystem = new ChatMessage("system", "Be concise.");
        var originalUser = new ChatMessage("user", "Summarize this", [new ChatAttachment("brief.pdf", "Extracted local text")]);
        var prepared = DocumentsOnlyPrompt.Apply([originalSystem, originalUser]);
        Check(prepared[0].Content.Contains("Be concise.", StringComparison.Ordinal)
            && prepared[0].Content.Contains(ModelInstructions.DocumentsOnly, StringComparison.Ordinal),
            "documents-only mode adds grounding rules without replacing the existing system prompt");
        Check(prepared[1].Content == originalUser.Content && prepared[1].Attachments is [{ FileName: "brief.pdf" }]
            && originalSystem.Content == "Be concise.", "documents-only prompt preparation preserves user content and saved messages");
        try
        {
            DocumentsOnlyPrompt.Apply([originalUser, new ChatMessage("assistant", "Previous answer"), new ChatMessage("user", "Follow-up without a file")]);
            throw new Exception("Expected documents-only mode without a current user attachment to fail.");
        }
        catch (InvalidOperationException error) when (error.Message.Contains("attached to this message", StringComparison.Ordinal))
        {
            Check(true, "documents-only mode rejects requests without documents attached to the latest user turn");
        }
    }
}
