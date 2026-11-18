using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.Json;
using SkaiDesktop.Core.Infrastructure;

namespace SkaiDesktop.Core.Services;

public sealed record McpMarketplaceDownload(string Id, string Name, string Version, string FileName, string FilePath, long SizeBytes, string Sha256, string Integrity);

/// <summary>Downloads a pinned MCP server package from npm after verifying its published SRI digest.</summary>
public sealed class McpMarketplaceDownloadService
{
    private const string Package = "rea-agents";
    // REA 6.7 supports the Node 24.20 runtime shipped on current Skai machines.
    // Later releases require Node 24.22.1+ and exit before starting MCP.
    private const string Version = "6.7.0";
    private const int MaxPackageBytes = 128 * 1024 * 1024;
    private static readonly HttpClient Http = CreateHttp();

    public async Task<McpMarketplaceDownload> DownloadReaAsync(CancellationToken cancellationToken = default)
    {
        using var metadataResponse = await Http.GetAsync($"https://registry.npmjs.org/{Package}/{Version}", HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
        metadataResponse.EnsureSuccessStatusCode();
        using var metadata = await BoundedHttpContent.ReadJsonAsync(metadataResponse.Content, cancellationToken, "REA npm metadata").ConfigureAwait(false);
        var dist = metadata.RootElement.GetProperty("dist");
        var tarball = new Uri(dist.GetProperty("tarball").GetString() ?? throw new InvalidDataException("REA package metadata has no tarball URL."));
        var integrity = dist.GetProperty("integrity").GetString() ?? throw new InvalidDataException("REA package metadata has no integrity digest.");
        if (tarball.Scheme != Uri.UriSchemeHttps || tarball.Host != "registry.npmjs.org" || !tarball.AbsolutePath.Equals($"/{Package}/-/{Package}-{Version}.tgz", StringComparison.Ordinal))
            throw new InvalidDataException("REA package metadata points outside the pinned npm package artifact.");
        if (!integrity.StartsWith("sha512-", StringComparison.Ordinal) || integrity.Length > 256)
            throw new InvalidDataException("REA package metadata contains an unsupported integrity digest.");

        using var packageResponse = await Http.GetAsync(tarball, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
        packageResponse.EnsureSuccessStatusCode();
        var bytes = await BoundedHttpContent.ReadBytesAsync(packageResponse.Content, MaxPackageBytes, cancellationToken, "REA MCP package").ConfigureAwait(false);
        var actualSri = "sha512-" + Convert.ToBase64String(SHA512.HashData(bytes));
        if (!CryptographicOperations.FixedTimeEquals(System.Text.Encoding.ASCII.GetBytes(actualSri), System.Text.Encoding.ASCII.GetBytes(integrity)))
            throw new InvalidDataException("REA package integrity verification failed.");

        var downloads = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile, Environment.SpecialFolderOption.Create), "Downloads", "Skai MCP");
        Directory.CreateDirectory(downloads);
        var name = $"{Package}-{Version}";
        var path = Path.Combine(downloads, name + ".tgz");
        for (var suffix = 2; File.Exists(path); suffix++) path = Path.Combine(downloads, $"{name}-{suffix}.tgz");
        var staged = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            await File.WriteAllBytesAsync(staged, bytes, cancellationToken).ConfigureAwait(false);
            File.Move(staged, path);
        }
        finally { if (File.Exists(staged)) File.Delete(staged); }
        return new("rea", "REA MCP server", Version, Path.GetFileName(path), path, bytes.LongLength, Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(), integrity);
    }

    private static HttpClient CreateHttp()
    {
        var http = new HttpClient(new SocketsHttpHandler { MaxConnectionsPerServer = 2 }) { Timeout = TimeSpan.FromMinutes(2) };
        http.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("SkaiDesktop", "1.0"));
        http.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        return http;
    }
}
