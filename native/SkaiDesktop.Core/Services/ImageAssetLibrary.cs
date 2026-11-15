using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace SkaiDesktop.Core.Services;

public sealed record ImageLoraAsset(string Id, string Repository, string FileName, long SizeBytes, string Path);

/// <summary>Small, user-owned local inventory for Diffusers LoRA safetensors.</summary>
public sealed class ImageAssetLibrary(HttpClient? client = null)
{
    private static readonly HttpClient SharedClient = new() { Timeout = TimeSpan.FromMinutes(15) };
    private readonly HttpClient _client = client ?? SharedClient;
    private static readonly Regex RepoPattern = new("^[A-Za-z0-9][A-Za-z0-9._-]{0,95}/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$", RegexOptions.CultureInvariant);
    private const long MaxAssetBytes = 8L * 1024 * 1024 * 1024;

    public string Root => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData, Environment.SpecialFolderOption.Create), "Skai", "ImageModels", "Loras");

    public async Task<IReadOnlyList<object>> SearchAsync(string query, CancellationToken cancellationToken = default)
    {
        query = (query ?? string.Empty).Trim();
        if (query.Length > 128 || query.Any(char.IsControl)) throw new ArgumentException("LoRA search text is invalid.", nameof(query));
        var uri = new Uri("https://huggingface.co/api/models?search=" + Uri.EscapeDataString(query) + "&filter=safetensors&sort=downloads&direction=-1&limit=30&full=true");
        using var request = new HttpRequestMessage(HttpMethod.Get, uri);
        request.Headers.UserAgent.ParseAdd("Skai-Desktop/1.0 image-asset-library");
        using var response = await _client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
        using var json = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken).ConfigureAwait(false);
        var results = new List<object>();
        foreach (var model in json.RootElement.EnumerateArray())
        {
            var id = model.TryGetProperty("id", out var idValue) ? idValue.GetString() : null;
            if (string.IsNullOrWhiteSpace(id) || !RepoPattern.IsMatch(id)) continue;
            var files = new List<object>();
            if (model.TryGetProperty("siblings", out var siblings) && siblings.ValueKind == JsonValueKind.Array)
                foreach (var sibling in siblings.EnumerateArray())
                {
                    var file = sibling.TryGetProperty("rfilename", out var fileValue) ? fileValue.GetString() : null;
                    if (string.IsNullOrWhiteSpace(file) || !file.EndsWith(".safetensors", StringComparison.OrdinalIgnoreCase) || file.Contains("..", StringComparison.Ordinal) || file.StartsWith('/')) continue;
                    var size = sibling.TryGetProperty("size", out var sizeValue) && sizeValue.TryGetInt64(out var parsedSize) ? parsedSize : 0;
                    if (size > 0 && size <= MaxAssetBytes) files.Add(new { path = file, sizeBytes = size });
                }
            if (files.Count == 0) continue;
            var downloads = model.TryGetProperty("downloads", out var count) && count.TryGetInt64(out var value) ? value : 0;
            results.Add(new { repository = id, downloads, files });
        }
        return results;
    }

    public IReadOnlyList<ImageLoraAsset> List()
    {
        if (!Directory.Exists(Root)) return [];
        return Directory.EnumerateFiles(Root, "*.safetensors", SearchOption.TopDirectoryOnly)
            .Select(path => new FileInfo(path)).Select(file => new ImageLoraAsset(file.Name, "Local", file.Name, file.Length, file.FullName)).ToArray();
    }

    public async Task<ImageLoraAsset> InstallAsync(string repository, string file, CancellationToken cancellationToken = default)
    {
        if (!RepoPattern.IsMatch(repository) || string.IsNullOrWhiteSpace(file) || file.Length > 512 || file.Contains("..", StringComparison.Ordinal) || file.StartsWith('/') || !file.EndsWith(".safetensors", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Choose a valid Hugging Face repository and safetensors LoRA file.");
        var encodedFile = string.Join('/', file.Split('/').Select(Uri.EscapeDataString));
        var uri = new Uri($"https://huggingface.co/{repository}/resolve/main/{encodedFile}?download=true");
        using var request = new HttpRequestMessage(HttpMethod.Get, uri);
        request.Headers.UserAgent.ParseAdd("Skai-Desktop/1.0 image-asset-library");
        using var response = await _client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
        if (response.Content.Headers.ContentLength is > MaxAssetBytes) throw new InvalidDataException("The LoRA exceeds Skai's 8 GB download limit.");
        Directory.CreateDirectory(Root);
        var name = Path.GetFileName(file);
        var target = Path.GetFullPath(Path.Combine(Root, name));
        if (!target.StartsWith(Path.GetFullPath(Root) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The LoRA file name is invalid.");
        var temporary = target + ".download";
        try
        {
            await using var input = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
            await using var output = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None, 65536, useAsync: true);
            var buffer = new byte[65536]; long total = 0; int read;
            while ((read = await input.ReadAsync(buffer, cancellationToken).ConfigureAwait(false)) > 0)
            {
                total += read; if (total > MaxAssetBytes) throw new InvalidDataException("The LoRA exceeds Skai's 8 GB download limit.");
                await output.WriteAsync(buffer.AsMemory(0, read), cancellationToken).ConfigureAwait(false);
            }
            if (total == 0) throw new InvalidDataException("The downloaded LoRA file was empty.");
            await output.FlushAsync(cancellationToken).ConfigureAwait(false);
            File.Move(temporary, target, overwrite: true);
            return new(name, repository, name, total, target);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    public bool Remove(string id)
    {
        if (string.IsNullOrWhiteSpace(id) || Path.GetFileName(id) != id || !id.EndsWith(".safetensors", StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("Choose a valid installed LoRA.", nameof(id));
        var path = Path.GetFullPath(Path.Combine(Root, id));
        if (!path.StartsWith(Path.GetFullPath(Root) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The LoRA path is invalid.");
        if (!File.Exists(path)) return false;
        File.Delete(path); return true;
    }
}
