using SkaiDesktop.Core.Infrastructure;
using static TestSupport;

internal static class AtomicFileWriterTests
{
    public static void Run()
    {
        var root = Path.Combine(Path.GetTempPath(), "skai-atomic-write-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            var destination = Path.Combine(root, "settings.json");
            File.WriteAllText(destination, "previous-valid-settings");
            var noSpaceObserved = false;
            try
            {
                AtomicFileWriter.WriteText(destination, "replacement-settings", (temporary, _) =>
                {
                    File.WriteAllText(temporary, "partial-temp-data");
                    throw new IOException("No space left on device");
                }, (temporary, target) => File.Move(temporary, target, overwrite: true));
            }
            catch (IOException exception) when (exception.Message.Contains("No space left on device", StringComparison.Ordinal))
            {
                noSpaceObserved = true;
            }

            Check(noSpaceObserved, "atomic persistence propagates an injected disk-full write failure");
            Check(File.ReadAllText(destination) == "previous-valid-settings", "disk-full failure preserves the previous complete settings file");
            Check(!Directory.EnumerateFiles(root, "*.tmp").Any(), "disk-full failure cleans up its partial temporary file");
        }
        finally { Directory.Delete(root, recursive: true); }
    }
}
