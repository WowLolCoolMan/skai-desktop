using System.Text;
using SkaiDesktop.Core.Infrastructure;
using static TestSupport;

internal static class CloudVoiceCredentialTests
{
    public static async Task RunAsync()
    {
        if (!OperatingSystem.IsWindows()) return;
        var directory = Path.Combine(Path.GetTempPath(), "skai-voice-credentials-" + Guid.NewGuid().ToString("N"));
        try
        {
            var store = new CloudVoiceCredentialStore(directory);
            const string key = "voice-test-secret-key-123456";
            await store.SaveAsync("elevenlabs", key);
            Check(await store.HasAsync("elevenlabs"), "voice credential status detects a saved provider key");
            var storedPath = Path.Combine(directory, "elevenlabs.bin");
            Check(File.Exists(storedPath) && !Encoding.UTF8.GetString(await File.ReadAllBytesAsync(storedPath)).Contains(key, StringComparison.Ordinal), "voice credentials are protected at rest with Windows user encryption");
            Check(await store.ReadAsync("elevenlabs") == key, "voice credential can be read by the same Windows user");
            Check(await store.ReadAsync("cartesia") is null, "voice credentials are isolated by provider");
            try
            {
                await store.SaveAsync("custom-provider", key);
                throw new Exception("Expected unsupported voice credential providers to be rejected.");
            }
            catch (ArgumentException) { Check(true, "voice credential storage rejects unknown providers"); }
            await store.DeleteAsync("elevenlabs");
            Check(!await store.HasAsync("elevenlabs"), "voice credential removal clears the provider key");
        }
        finally
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true);
        }
    }
}
