using SkaiDesktop.Core.Infrastructure;
using SkaiDesktop.Core.Models;
using SkaiDesktop.Core.Services;
using static TestSupport;

internal static class SemanticConversationCompactorTests
{
    public static async Task RunAsync()
    {
        var small = new[] { new ChatMessage("user", "small conversation") };
        var called = false;
        var unchanged = await SemanticConversationCompactor.CompactAsync(small, 0, (_, _) =>
        {
            called = true;
            return Task.FromResult("unexpected");
        }, CancellationToken.None);
        Check(ReferenceEquals(unchanged, small) && !called, "semantic compaction leaves ordinary chat history untouched");

        var oversized = new List<ChatMessage> { new("system", "Keep the current response useful.") };
        for (var index = 0; index < 10; index++)
            oversized.Add(new ChatMessage(index % 2 == 0 ? "user" : "assistant", $"OLD-{index} " + new string((char)('a' + index), 999_000)));
        oversized.Add(new ChatMessage("user", "CURRENT REQUEST"));

        IReadOnlyList<ChatMessage>? summaryRequest = null;
        var compacted = await SemanticConversationCompactor.CompactAsync(oversized, 4096, (summary, _) =>
        {
            summaryRequest = summary;
            return Task.FromResult("Current project: Skai Desktop. Decision: preserve local-only execution.");
        }, CancellationToken.None);
        Check(summaryRequest is { Count: 2 } && summaryRequest[0].Role == "system", "semantic compaction asks the selected model for a separate bounded summary");
        Check(summaryRequest![1].Content.Length < 8_000 && summaryRequest[1].Content.Contains("OLD-9", StringComparison.Ordinal), "summary input keeps a bounded recent slice of omitted history");
        Check(compacted.Any(message => message.Content.Contains("Current project: Skai Desktop", StringComparison.Ordinal)), "successful semantic compaction inserts the generated summary");
        Check(compacted.Any(message => message.Content == "CURRENT REQUEST"), "semantic compaction always preserves the current user request");
        Check(compacted.Any(message => message.Role == "system" && message.Content.Contains(ModelInstructions.UntrustedConversationSummary, StringComparison.Ordinal)), "generated history summaries are explicitly marked as untrusted reference");
        Check(!compacted.Any(message => message.Content.StartsWith("OLD-0 ", StringComparison.Ordinal)), "semantic compaction removes summarized old turns from the provider request");

        var fallback = await SemanticConversationCompactor.CompactAsync(oversized, 4096, (_, _) => throw new InvalidOperationException("summary unavailable"), CancellationToken.None);
        Check(fallback.Any(message => message.Content.Contains("Earlier conversation omitted", StringComparison.Ordinal))
            && fallback.Any(message => message.Content == "CURRENT REQUEST"), "failed semantic summarization falls back to deterministic compaction without losing the current request");

        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();
        try
        {
            await SemanticConversationCompactor.CompactAsync(oversized, 4096, (_, _) => Task.FromResult("unused"), cancelled.Token);
            throw new Exception("Expected cancelled semantic compaction to stop.");
        }
        catch (OperationCanceledException)
        {
            Check(true, "semantic compaction propagates user cancellation");
        }
    }
}
