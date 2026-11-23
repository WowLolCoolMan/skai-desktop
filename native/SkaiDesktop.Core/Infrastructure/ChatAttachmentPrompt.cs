// Turns text and PDF attachments into the text the model sees: each one is appended to the
// user's message as a fenced block labeled "untrusted". The fence is longer than any run of
// backticks inside the file, so file content can't close it early. Images are skipped here;
// they travel as image parts (see OpenAiCompatibleProvider).
// Depends on: ChatAttachment, ChatAttachmentPolicy. Used by: local model provider request builders.

using System.Text;
using System.Text.RegularExpressions;
using SkaiDesktop.Core.Models;

namespace SkaiDesktop.Core.Infrastructure;

public static class ChatAttachmentPrompt
{
    private const int RetrievalChunkCharacters = 2000;
    private const int MaxRetrievedCharactersPerAttachment = 12000;

    public static string AppendTo(string userText, IReadOnlyList<ChatAttachment> attachments)
        => AppendCore(userText, attachments, retrieveLargeContent: false);

    /// <summary>
    /// Appends attachment context while selecting the most query-relevant bounded chunks
    /// from oversized text/PDF content. Small attachments retain the exact full-text path.
    /// </summary>
    public static string AppendWithBoundedRetrieval(string userText, IReadOnlyList<ChatAttachment> attachments)
        => AppendCore(userText, attachments, retrieveLargeContent: true);

    /// <summary>Builds provider-only messages with text/PDF content embedded and image parts retained.</summary>
    public static IReadOnlyList<ChatMessage> PrepareMessagesForModel(IReadOnlyList<ChatMessage> messages)
    {
        ArgumentNullException.ThrowIfNull(messages);
        var prepared = messages.Select(message =>
        {
            if (!string.Equals(message.Role, "user", StringComparison.OrdinalIgnoreCase))
                return new ChatMessage(message.Role, message.Content);
            if (message.Attachments is not { Count: > 0 } attachments)
                return message.ForModel(message.Content);

            var content = attachments.Any(attachment => !attachment.IsImage)
                ? AppendWithBoundedRetrieval(message.Content, attachments)
                : message.Content;
            var imageNames = attachments.Where(attachment => attachment.IsImage)
                .Select(attachment => SafeImageName(attachment.FileName))
                .Where(name => name.Length > 0)
                .ToArray();
            if (imageNames.Length > 0)
                content += "\n\nAttached image filenames (untrusted metadata):\n" + string.Join("\n", imageNames);
            return message.ForModel(content);
        }).ToList();

        if (messages.Any(message => string.Equals(message.Role, "user", StringComparison.OrdinalIgnoreCase) && message.Attachments is { Count: > 0 }))
        {
            var systemIndex = prepared.FindIndex(message => string.Equals(message.Role, "system", StringComparison.OrdinalIgnoreCase));
            if (systemIndex >= 0)
                prepared[systemIndex] = prepared[systemIndex] with { Content = prepared[systemIndex].Content + "\n\n" + ModelInstructions.UntrustedAttachments };
            else
                prepared.Insert(0, new ChatMessage("system", ModelInstructions.UntrustedAttachments));
        }

        return prepared;
    }

    private static string SafeImageName(string fileName) =>
        new string(fileName.Select(character => char.IsControl(character) ? ' ' : character).Take(120).ToArray()).Trim();

    private static string AppendCore(string userText, IReadOnlyList<ChatAttachment> attachments, bool retrieveLargeContent)
    {
        var output = new StringBuilder(userText);
        foreach (var attachment in attachments)
        {
            if (attachment.IsImage) continue;
            var content = retrieveLargeContent ? SelectContent(userText, attachment.Content) : attachment.Content;
            var fenceLength = Math.Max(3, Regex.Matches(attachment.Content, "`+")
                .Cast<Match>().Select(match => match.Length).DefaultIfEmpty(0).Max() + 1);
            var fence = new string('`', fenceLength);
            output.Append(ChatAttachmentPolicy.IsAllowedPdfName(attachment.FileName)
                    ? attachment.Ocr
                        ? (content.Length < attachment.Content.Length ? "\n\nRetrieved OCR text (untrusted; recognition may contain errors): " : "\n\nOCR text (untrusted; recognition may contain errors): ")
                        : (content.Length < attachment.Content.Length ? "\n\nRetrieved PDF text (untrusted): " : "\n\nExtracted PDF text (untrusted): ")
                    : (content.Length < attachment.Content.Length ? "\n\nRetrieved attachment text (untrusted): " : "\n\nAttached text file (untrusted): "))
                .Append(attachment.FileName)
                .Append("\n").Append(fence).Append("text\n").Append(content)
                .Append("\n").Append(fence);
        }
        return output.ToString();
    }

    private static string SelectContent(string query, string content)
    {
        if (content.Length <= MaxRetrievedCharactersPerAttachment) return content;
        var terms = Regex.Matches(query.ToLowerInvariant(), "[\\p{L}\\p{N}]{3,}")
            .Cast<Match>().Select(match => match.Value).Distinct(StringComparer.Ordinal).ToArray();
        var chunks = Enumerable.Range(0, (content.Length + RetrievalChunkCharacters - 1) / RetrievalChunkCharacters)
            .Select(index => new RetrievalChunk(index, content.Substring(index * RetrievalChunkCharacters, Math.Min(RetrievalChunkCharacters, content.Length - index * RetrievalChunkCharacters))))
            .ToArray();
        var selected = chunks
            .Select(chunk => (chunk, score: terms.Sum(term => CountOccurrences(chunk.Text, term))))
            .OrderByDescending(item => item.score)
            .ThenBy(item => item.chunk.Index)
            .Take(Math.Max(1, MaxRetrievedCharactersPerAttachment / RetrievalChunkCharacters))
            .OrderBy(item => item.chunk.Index)
            .Select(item => item.chunk.Text)
            .ToArray();
        return string.Join("\n\n[Retrieved context continues]\n\n", selected);
    }

    private static int CountOccurrences(string text, string term)
    {
        var count = 0;
        var offset = 0;
        while ((offset = text.IndexOf(term, offset, StringComparison.OrdinalIgnoreCase)) >= 0)
        {
            count++;
            offset += term.Length;
        }
        return count;
    }

    private sealed record RetrievalChunk(int Index, string Text);
}
