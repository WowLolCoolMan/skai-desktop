// Writes a file via temp-file-then-rename so a crash never leaves a half-written store.
// Used by: JsonSettingsStore, ConversationStore, ProjectStore, WorkspaceUndoStore.

using System.Text;

namespace SkaiDesktop.Core.Infrastructure;

internal static class AtomicFileWriter
{
    public static void WriteText(string destination, string content)
        => WriteText(destination, content, WriteTemporaryFile, (temporaryPath, fullPath) => File.Move(temporaryPath, fullPath, overwrite: true));

    internal static void WriteText(string destination, string content, Action<string, string> writeTemporaryFile, Action<string, string> replaceFile)
    {
        ArgumentNullException.ThrowIfNull(destination);
        ArgumentNullException.ThrowIfNull(content);
        ArgumentNullException.ThrowIfNull(writeTemporaryFile);
        ArgumentNullException.ThrowIfNull(replaceFile);
        var fullPath = Path.GetFullPath(destination);
        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
        var temporaryPath = fullPath + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            writeTemporaryFile(temporaryPath, content);
            replaceFile(temporaryPath, fullPath);
        }
        finally
        {
            try { if (File.Exists(temporaryPath)) File.Delete(temporaryPath); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }

    private static void WriteTemporaryFile(string path, string content)
    {
        using var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        using var writer = new StreamWriter(stream, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
        writer.Write(content);
    }
}
