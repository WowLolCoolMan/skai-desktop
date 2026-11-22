using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using SkaiDesktop.Core.Models;

namespace SkaiDesktop.Core.Infrastructure;

/// <summary>Stores optional hosted voice keys outside renderer and settings state.</summary>
public sealed class CloudVoiceCredentialStore(string? windowsDirectory = null, string? secretToolPath = null)
{
    private const string Service = "skaidesktop-voice";
    private static readonly string[] SupportedProviders = ["elevenlabs", "inworld", "cartesia"];
    private readonly string _windowsDirectory = windowsDirectory ?? Path.Combine(ProductIdentity.DataDirectory(Environment.SpecialFolder.LocalApplicationData), "voice-credentials");
    private readonly string? _secretToolPath = secretToolPath ?? FindExecutable("secret-tool");

    public bool IsAvailable => OperatingSystem.IsWindows()
        || OperatingSystem.IsLinux() && _secretToolPath is not null && HasLinuxSessionBus();

    public async Task<bool> HasAsync(string provider, CancellationToken cancellationToken = default) =>
        await ReadAsync(provider, cancellationToken).ConfigureAwait(false) is not null;

    public async Task SaveAsync(string provider, string value, CancellationToken cancellationToken = default)
    {
        var account = ValidateProvider(provider);
        if (value.Length is < 8 or > 512 || value.Any(char.IsControl)) throw new ArgumentException("The voice provider key has an invalid format.", nameof(value));
        if (!IsAvailable) throw new PlatformNotSupportedException("Secure voice-key storage requires Windows user protection or an unlocked Linux desktop keyring.");
        if (OperatingSystem.IsWindows())
        {
            var path = Path.Combine(_windowsDirectory, account + ".bin");
            Directory.CreateDirectory(_windowsDirectory);
            var plaintext = Encoding.UTF8.GetBytes(value);
            byte[] ciphertext;
            try { ciphertext = ProtectedData.Protect(plaintext, Encoding.UTF8.GetBytes($"Skai Desktop voice {account} v1"), DataProtectionScope.CurrentUser); }
            finally { CryptographicOperations.ZeroMemory(plaintext); }
            var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try { await File.WriteAllBytesAsync(temporary, ciphertext, cancellationToken).ConfigureAwait(false); File.Move(temporary, path, overwrite: true); }
            finally { CryptographicOperations.ZeroMemory(ciphertext); if (File.Exists(temporary)) File.Delete(temporary); }
            return;
        }
        await RunSecretToolAsync(["store", $"--label=Skai Desktop {account} voice key", "application", Service, "provider", account], value, cancellationToken).ConfigureAwait(false);
    }

    public async Task<string?> ReadAsync(string provider, CancellationToken cancellationToken = default)
    {
        var account = ValidateProvider(provider);
        if (!IsAvailable) throw new PlatformNotSupportedException("Secure voice-key storage requires Windows user protection or an unlocked Linux desktop keyring.");
        if (OperatingSystem.IsWindows())
        {
            var path = Path.Combine(_windowsDirectory, account + ".bin");
            if (!File.Exists(path)) return null;
            var ciphertext = await ReadProtectedBytesAsync(path, cancellationToken).ConfigureAwait(false);
            byte[] plaintext;
            try { plaintext = ProtectedData.Unprotect(ciphertext, Encoding.UTF8.GetBytes($"Skai Desktop voice {account} v1"), DataProtectionScope.CurrentUser); }
            finally { CryptographicOperations.ZeroMemory(ciphertext); }
            try
            {
                var value = Encoding.UTF8.GetString(plaintext);
                if (value.Length is < 8 or > 512 || value.Any(char.IsControl)) throw new InvalidDataException("The saved voice key is invalid. Replace it in Voice settings.");
                return value;
            }
            finally { CryptographicOperations.ZeroMemory(plaintext); }
        }
        var result = await RunSecretToolAsync(["lookup", "application", Service, "provider", account], null, cancellationToken, allowMissing: true).ConfigureAwait(false);
        if (result is not null && (result.Length is < 8 or > 512 || result.Any(char.IsControl)))
            throw new InvalidDataException("The saved voice key is invalid. Replace it in Voice settings.");
        return result;
    }

    public async Task DeleteAsync(string provider, CancellationToken cancellationToken = default)
    {
        var account = ValidateProvider(provider);
        if (!IsAvailable) throw new PlatformNotSupportedException("Secure voice-key storage requires Windows user protection or an unlocked Linux desktop keyring.");
        if (OperatingSystem.IsWindows())
        {
            var path = Path.Combine(_windowsDirectory, account + ".bin");
            if (File.Exists(path)) File.Delete(path);
            return;
        }
        _ = await RunSecretToolAsync(["clear", "application", Service, "provider", account], null, cancellationToken, allowMissing: true).ConfigureAwait(false);
    }

    private async Task<string?> RunSecretToolAsync(IReadOnlyList<string> arguments, string? input, CancellationToken cancellationToken, bool allowMissing = false)
    {
        var startInfo = new ProcessStartInfo(_secretToolPath!) { UseShellExecute = false, RedirectStandardInput = input is not null, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true };
        foreach (var argument in arguments) startInfo.ArgumentList.Add(argument);
        using var process = new Process { StartInfo = startInfo };
        if (!process.Start()) throw new InvalidOperationException("The Linux desktop keyring utility could not be started.");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(20));
        var outputTask = ReadLimitedAsync(process.StandardOutput, 4096, timeout.Token);
        var errorTask = ReadLimitedAsync(process.StandardError, 1024, timeout.Token);
        if (input is not null)
        {
            await process.StandardInput.WriteLineAsync(input.AsMemory(), timeout.Token).ConfigureAwait(false);
            await process.StandardInput.FlushAsync(timeout.Token).ConfigureAwait(false);
            process.StandardInput.Close();
        }
        try
        {
            await process.WaitForExitAsync(timeout.Token).ConfigureAwait(false);
            var output = await outputTask.ConfigureAwait(false);
            var error = await errorTask.ConfigureAwait(false);
            if (output.Truncated || error.Truncated) throw new InvalidDataException("The desktop keyring returned an unexpected response.");
            if (allowMissing && process.ExitCode == 1 && string.IsNullOrWhiteSpace(error.Value)) return null;
            if (process.ExitCode != 0) throw new InvalidOperationException("The desktop keyring could not complete the voice-key operation. Unlock it and try again.");
            return input is null ? output.Value.TrimEnd('\r', '\n') : null;
        }
        catch (OperationCanceledException)
        {
            try { process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
            throw;
        }
    }

    private static async Task<(string Value, bool Truncated)> ReadLimitedAsync(StreamReader reader, int maxCharacters, CancellationToken cancellationToken)
    {
        var buffer = new char[1024];
        var output = new StringBuilder(maxCharacters);
        var truncated = false;
        while (true)
        {
            var read = await reader.ReadAsync(buffer.AsMemory(), cancellationToken).ConfigureAwait(false);
            if (read == 0) break;
            var retained = Math.Min(read, Math.Max(0, maxCharacters - output.Length));
            if (retained > 0) output.Append(buffer, 0, retained);
            if (retained < read) truncated = true;
        }
        return (output.ToString(), truncated);
    }

    private static async Task<byte[]> ReadProtectedBytesAsync(string path, CancellationToken cancellationToken)
    {
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, FileOptions.Asynchronous | FileOptions.SequentialScan);
        if (stream.Length is < 1 or > 4096) throw new InvalidDataException("The saved voice key has an invalid size. Replace it in Voice settings.");
        var bytes = new byte[(int)stream.Length];
        await stream.ReadExactlyAsync(bytes, cancellationToken).ConfigureAwait(false);
        if (stream.ReadByte() != -1) throw new InvalidDataException("The saved voice key changed while it was being read. Replace it in Voice settings.");
        return bytes;
    }

    private static string ValidateProvider(string provider)
    {
        var normalized = provider.Trim().ToLowerInvariant();
        return SupportedProviders.Contains(normalized, StringComparer.Ordinal) ? normalized : throw new ArgumentException("That voice provider is not supported.", nameof(provider));
    }

    private static string? FindExecutable(string name) => Environment.GetEnvironmentVariable("PATH")?.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries).Select(directory => Path.Combine(directory, name)).FirstOrDefault(File.Exists);
    private static bool HasLinuxSessionBus() => !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("DBUS_SESSION_BUS_ADDRESS")) || !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("XDG_RUNTIME_DIR")) && File.Exists(Path.Combine(Environment.GetEnvironmentVariable("XDG_RUNTIME_DIR")!, "bus"));
}
