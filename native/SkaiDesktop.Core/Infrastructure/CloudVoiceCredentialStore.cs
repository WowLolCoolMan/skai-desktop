namespace SkaiDesktop.Core.Infrastructure;

/// <summary>Voice-specific key validation over the shared operating-system secret store.</summary>
public sealed class CloudVoiceCredentialStore
{
    private static readonly HashSet<string> SupportedProviders = new(StringComparer.Ordinal)
    {
        "elevenlabs", "inworld", "cartesia"
    };
    private readonly ISecretStore _secrets;

    public CloudVoiceCredentialStore(string? windowsDirectory = null, string? secretToolPath = null) =>
        _secrets = new PlatformSecretStore("skaidesktop-voice", "voice", windowsDirectory, secretToolPath, "provider");

    public bool IsAvailable => _secrets.IsAvailable;

    public async Task<bool> HasAsync(string provider, CancellationToken cancellationToken = default) =>
        await ReadAsync(provider, cancellationToken).ConfigureAwait(false) is not null;

    public Task SaveAsync(string provider, string value, CancellationToken cancellationToken = default)
    {
        var key = ValidateProvider(provider);
        if (value.Length is < 8 or > 512 || value.Any(char.IsControl)) throw new ArgumentException("The voice provider key has an invalid format.", nameof(value));
        return _secrets.SetAsync(key, value, cancellationToken);
    }

    public async Task<string?> ReadAsync(string provider, CancellationToken cancellationToken = default)
    {
        var key = ValidateProvider(provider);
        var value = await _secrets.GetAsync(key, cancellationToken).ConfigureAwait(false);
        if (value is not null && (value.Length is < 8 or > 512 || value.Any(char.IsControl)))
            throw new InvalidDataException("The saved voice key is invalid. Replace it in Voice settings.");
        return value;
    }

    public Task DeleteAsync(string provider, CancellationToken cancellationToken = default) =>
        _secrets.RemoveAsync(ValidateProvider(provider), cancellationToken);

    private static string ValidateProvider(string provider)
    {
        var normalized = provider.Trim().ToLowerInvariant();
        return SupportedProviders.Contains(normalized) ? normalized : throw new ArgumentException("That voice provider is not supported.", nameof(provider));
    }
}
