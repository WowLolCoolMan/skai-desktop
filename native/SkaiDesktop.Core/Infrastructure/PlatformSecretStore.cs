using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using SkaiDesktop.Core.Models;

namespace SkaiDesktop.Core.Infrastructure;

/// <summary>Stores application credentials with Windows user protection or the Linux desktop keyring.</summary>
public sealed class PlatformSecretStore : ISecretStore
{
    private const int MaxCredentialCharacters = 32_768;
    private const int MaxProtectedBytes = 64 * 1024;
    private readonly string _service;
    private readonly string _purpose;
    private readonly string _keyAttribute;
    private readonly string _windowsDirectory;
    private readonly string? _secretToolPath;

    public PlatformSecretStore(string service, string purpose, string? windowsDirectory = null, string? secretToolPath = null, string keyAttribute = "account")
    {
        _service = ValidateIdentifier(service, nameof(service));
        _purpose = ValidatePurpose(purpose);
        _keyAttribute = keyAttribute is "account" or "provider" ? keyAttribute : throw new ArgumentException("The keyring attribute must be account or provider.", nameof(keyAttribute));
        var storageName = _service.StartsWith("skaidesktop-", StringComparison.Ordinal) ? _service[12..] : _service;
        _windowsDirectory = windowsDirectory ?? Path.Combine(ProductIdentity.DataDirectory(Environment.SpecialFolder.LocalApplicationData), $"{storageName}-credentials");
        _secretToolPath = secretToolPath ?? FindExecutable("secret-tool");
    }

    public bool IsAvailable => OperatingSystem.IsWindows()
        || OperatingSystem.IsLinux() && _secretToolPath is not null && HasLinuxSessionBus();

    public async Task SetAsync(string key, string value, CancellationToken cancellationToken = default)
    {
        var account = ValidateIdentifier(key, nameof(key));
        if (value.Length is < 1 or > MaxCredentialCharacters || value.Any(char.IsControl)) throw new ArgumentException("The credential has an invalid format.", nameof(value));
        if (Encoding.UTF8.GetByteCount(value) > MaxProtectedBytes - 1024) throw new ArgumentException("The credential is too large for secure storage.", nameof(value));
        if (!IsAvailable) throw new PlatformNotSupportedException("Secure credential storage requires Windows user protection or an unlocked Linux desktop keyring.");
        if (OperatingSystem.IsWindows())
        {
            var path = Path.Combine(_windowsDirectory, account + ".bin");
            Directory.CreateDirectory(_windowsDirectory);
            var plaintext = Encoding.UTF8.GetBytes(value);
            byte[] ciphertext;
            try { ciphertext = ProtectedData.Protect(plaintext, Entropy(account), DataProtectionScope.CurrentUser); }
            finally { CryptographicOperations.ZeroMemory(plaintext); }
            var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try { await File.WriteAllBytesAsync(temporary, ciphertext, cancellationToken).ConfigureAwait(false); File.Move(temporary, path, overwrite: true); }
            finally { CryptographicOperations.ZeroMemory(ciphertext); if (File.Exists(temporary)) File.Delete(temporary); }
            return;
        }
        await RunSecretToolAsync(["store", $"--label={ProductIdentity.DisplayName} {_purpose} {account}", "application", _service, _keyAttribute, account], value, cancellationToken).ConfigureAwait(false);
    }

    public async Task<string?> GetAsync(string key, CancellationToken cancellationToken = default)
    {
        var account = ValidateIdentifier(key, nameof(key));
        if (!IsAvailable) throw new PlatformNotSupportedException("Secure credential storage requires Windows user protection or an unlocked Linux desktop keyring.");
        if (OperatingSystem.IsWindows())
        {
            var path = Path.Combine(_windowsDirectory, account + ".bin");
            if (!File.Exists(path)) return null;
            var ciphertext = await ReadProtectedBytesAsync(path, cancellationToken).ConfigureAwait(false);
            byte[] plaintext;
            try { plaintext = ProtectedData.Unprotect(ciphertext, Entropy(account), DataProtectionScope.CurrentUser); }
            finally { CryptographicOperations.ZeroMemory(ciphertext); }
            try
            {
                var value = Encoding.UTF8.GetString(plaintext);
                if (value.Length is < 1 or > MaxCredentialCharacters || value.Any(char.IsControl)) throw new InvalidDataException("The saved credential has an invalid format.");
                return value;
            }
            finally { CryptographicOperations.ZeroMemory(plaintext); }
        }
        var result = await RunSecretToolAsync(["lookup", "application", _service, _keyAttribute, account], null, cancellationToken, allowMissing: true).ConfigureAwait(false);
        if (result is not null && (result.Length is < 1 or > MaxCredentialCharacters || result.Any(char.IsControl)))
            throw new InvalidDataException("The saved credential has an invalid format.");
        return result;
    }

    public async Task RemoveAsync(string key, CancellationToken cancellationToken = default)
    {
        var account = ValidateIdentifier(key, nameof(key));
        if (!IsAvailable) throw new PlatformNotSupportedException("Secure credential storage requires Windows user protection or an unlocked Linux desktop keyring.");
        if (OperatingSystem.IsWindows())
        {
            var path = Path.Combine(_windowsDirectory, account + ".bin");
            if (File.Exists(path)) File.Delete(path);
            return;
        }
        _ = await RunSecretToolAsync(["clear", "application", _service, _keyAttribute, account], null, cancellationToken, allowMissing: true).ConfigureAwait(false);
    }

    private async Task<string?> RunSecretToolAsync(IReadOnlyList<string> arguments, string? input, CancellationToken cancellationToken, bool allowMissing = false)
    {
        var executable = _secretToolPath ?? throw new PlatformNotSupportedException("The Linux desktop keyring utility is unavailable.");
        var startInfo = new ProcessStartInfo(executable) { UseShellExecute = false, RedirectStandardInput = input is not null, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true };
        foreach (var argument in arguments) startInfo.ArgumentList.Add(argument);
        using var process = new Process { StartInfo = startInfo };
        if (!process.Start()) throw new InvalidOperationException("The Linux desktop keyring utility could not be started.");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(20));
        var outputTask = ReadLimitedAsync(process.StandardOutput, MaxCredentialCharacters + 1, timeout.Token);
        var errorTask = ReadLimitedAsync(process.StandardError, 1024, timeout.Token);
        try
        {
            if (input is not null)
            {
                await process.StandardInput.WriteLineAsync(input.AsMemory(), timeout.Token).ConfigureAwait(false);
                await process.StandardInput.FlushAsync(timeout.Token).ConfigureAwait(false);
                process.StandardInput.Close();
            }
            await process.WaitForExitAsync(timeout.Token).ConfigureAwait(false);
            var output = await outputTask.ConfigureAwait(false);
            var error = await errorTask.ConfigureAwait(false);
            if (output.Truncated || error.Truncated) throw new InvalidDataException("The desktop keyring returned an unexpected response.");
            if (allowMissing && process.ExitCode == 1 && string.IsNullOrWhiteSpace(error.Value)) return null;
            if (process.ExitCode != 0) throw new InvalidOperationException("The desktop keyring could not complete the credential operation. Unlock it and try again.");
            return input is null ? output.Value.TrimEnd('\r', '\n') : null;
        }
        catch (OperationCanceledException)
        {
            try { process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
            try { await Task.WhenAll(outputTask, errorTask).ConfigureAwait(false); } catch { }
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
        if (stream.Length is < 1 or > MaxProtectedBytes) throw new InvalidDataException("The saved credential has an invalid size.");
        var bytes = new byte[(int)stream.Length];
        await stream.ReadExactlyAsync(bytes, cancellationToken).ConfigureAwait(false);
        if (stream.ReadByte() != -1) throw new InvalidDataException("The saved credential changed while it was being read.");
        return bytes;
    }

    private static string ValidateIdentifier(string identifier, string parameterName)
    {
        var normalized = identifier?.Trim().ToLowerInvariant();
        if (string.IsNullOrEmpty(normalized) || normalized.Length > 64 || normalized.Any(character => !char.IsAsciiLetterOrDigit(character) && character != '-'))
            throw new ArgumentException("Credential identifiers may contain only letters, numbers, and hyphens.", parameterName);
        return normalized;
    }

    private static string ValidatePurpose(string purpose)
    {
        var normalized = purpose?.Trim();
        if (string.IsNullOrWhiteSpace(normalized) || normalized.Length > 48 || normalized.Any(char.IsControl))
            throw new ArgumentException("A short credential purpose is required.", nameof(purpose));
        return normalized;
    }

    private byte[] Entropy(string key)
    {
        // Keep the original cloud-voice entropy so credentials created before
        // this extraction remain readable; all other namespaces are isolated.
        var value = _service == "skaidesktop-voice" && _purpose == "voice"
            ? $"{ProductIdentity.DisplayName} voice {key} v1"
            : $"{ProductIdentity.DisplayName} {_service} {_purpose} {key} v1";
        return Encoding.UTF8.GetBytes(value);
    }

    private static string? FindExecutable(string name) => Environment.GetEnvironmentVariable("PATH")?.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries).Select(directory => Path.Combine(directory, name)).FirstOrDefault(File.Exists);
    private static bool HasLinuxSessionBus() => !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("DBUS_SESSION_BUS_ADDRESS")) || !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("XDG_RUNTIME_DIR")) && File.Exists(Path.Combine(Environment.GetEnvironmentVariable("XDG_RUNTIME_DIR")!, "bus"));
}
