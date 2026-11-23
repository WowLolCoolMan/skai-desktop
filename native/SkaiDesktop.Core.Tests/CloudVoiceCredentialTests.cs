using System.Text;
using SkaiDesktop.Core.Infrastructure;
using static TestSupport;

internal static class CloudVoiceCredentialTests
{
    public static async Task RunAsync()
    {
        var directory = Path.Combine(Path.GetTempPath(), "skai-voice-credentials-" + Guid.NewGuid().ToString("N"));
        if (OperatingSystem.IsLinux())
        {
            var service = "skaidesktop-test-" + Guid.NewGuid().ToString("N");
            var store = new PlatformSecretStore(service, "provider acceptance", directory);
            if (!store.IsAvailable)
            {
                Console.WriteLine("SKIP Linux Secret Service integration checks (secret-tool or an active D-Bus session is unavailable).");
                return;
            }
            const string key = "linux-keyring-acceptance-secret-123";
            var isolatedStore = new PlatformSecretStore("skaidesktop-test-isolated-" + Guid.NewGuid().ToString("N"), "provider acceptance", directory);
            try
            {
                Check(await store.GetAsync("connection-01") is null, "Linux Secret Service reports a missing provider credential");
                await store.SetAsync("connection-01", key);
                Check(await store.GetAsync("connection-01") == key, "Linux Secret Service round-trips a credential");
                Check(await store.GetAsync("connection-02") is null, "Linux Secret Service isolates credentials by connection");
                Check(await isolatedStore.GetAsync("connection-01") is null, "Linux Secret Service isolates credentials by service namespace");
                await store.RemoveAsync("connection-01");
                Check(await store.GetAsync("connection-01") is null, "Linux Secret Service removes a credential");
                try
                {
                    await store.SetAsync("../outside", key);
                    throw new Exception("Expected unsafe Linux secret-store identifiers to be rejected.");
                }
                catch (ArgumentException) { Check(true, "Linux secret store rejects path-shaped identifiers"); }
            }
            finally
            {
                if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true);
            }
            return;
        }
        if (!OperatingSystem.IsWindows()) return;
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

            var providerDirectory = Path.Combine(directory, "generic-provider");
            var providerStore = new PlatformSecretStore("skaidesktop-provider", "model provider", providerDirectory);
            const string providerKey = "generic-provider-key-0987654321";
            Check(await providerStore.GetAsync("connection-01") is null, "generic secret store reports a missing connection credential");
            await providerStore.SetAsync("connection-01", providerKey);
            Check(await providerStore.GetAsync("connection-01") == providerKey, "generic secret store round-trips a credential by stable key");
            Check(!Encoding.UTF8.GetString(await File.ReadAllBytesAsync(Path.Combine(providerDirectory, "connection-01.bin"))).Contains(providerKey, StringComparison.Ordinal), "generic secret store encrypts credentials at rest");
            Check(await providerStore.GetAsync("connection-02") is null, "generic secret store isolates credentials by connection");
            var otherProviderStore = new PlatformSecretStore("skaidesktop-other-provider", "model provider", providerDirectory);
            try
            {
                _ = await otherProviderStore.GetAsync("connection-01");
                throw new Exception("Expected credentials from separate services to remain cryptographically isolated.");
            }
            catch (System.Security.Cryptography.CryptographicException) { Check(true, "generic secret store isolates credentials by service namespace"); }
            await providerStore.RemoveAsync("connection-01");
            Check(await providerStore.GetAsync("connection-01") is null, "generic secret store removes credentials by stable key");
            try
            {
                await providerStore.SetAsync("../outside", providerKey);
                throw new Exception("Expected unsafe secret-store identifiers to be rejected.");
            }
            catch (ArgumentException) { Check(true, "generic secret store rejects path-shaped identifiers"); }
        }
        finally
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true);
        }
    }
}
