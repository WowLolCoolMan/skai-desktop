namespace SkaiDesktop.Core.Infrastructure;

/// <summary>Minimal asynchronous contract for credentials protected by the user's OS account.</summary>
public interface ISecretStore
{
    bool IsAvailable { get; }
    Task SetAsync(string key, string value, CancellationToken cancellationToken = default);
    Task<string?> GetAsync(string key, CancellationToken cancellationToken = default);
    Task RemoveAsync(string key, CancellationToken cancellationToken = default);
}
