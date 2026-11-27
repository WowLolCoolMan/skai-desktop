using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using SkaiDesktop.Core.Models;

namespace SkaiDesktop.AgentHost.Protocol;

internal sealed record WorkspaceBackupProject(string Id, string Name, string? GitHubRepository);

internal sealed record WorkspaceBackupPayload(
    List<ChatSession>? Conversations = null,
    AppSettings? Settings = null,
    List<SavedPersona>? Personas = null,
    List<WorkspaceBackupProject>? Projects = null);

internal sealed record WorkspaceBackupEnvelope(
    string Format,
    int Version,
    DateTimeOffset CreatedAtUtc,
    bool Encrypted,
    string Digest,
    string Data,
    string? Salt = null,
    string? Nonce = null,
    string? Tag = null);

internal sealed record OpenedWorkspaceBackup(WorkspaceBackupPayload Payload, WorkspaceBackupEnvelope Envelope, string Digest);

internal static class WorkspaceBackupArchive
{
    public const int MaxArchiveCharacters = 16_000_000;
    private const int MaxPlaintextBytes = 11 * 1024 * 1024;
    private const int Pbkdf2Iterations = 310_000;
    private const string FormatName = "skai.workspace.backup";
    private static readonly byte[] AssociatedData = Encoding.UTF8.GetBytes("Skai Workspace Backup v1");
    private static readonly Regex SecretToken = new(@"\b(?:sk-[A-Za-z0-9_-]{12,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{12,})\b", RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly Regex SecretAssignment = new(@"\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd)\b(\s*[:=]\s*)(['""]?)[^\s,'"";]{8,}", RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    public static string Create(WorkspaceBackupPayload payload, string? passphrase, JsonSerializerOptions options, out bool encrypted, out int redactions)
    {
        ArgumentNullException.ThrowIfNull(payload);
        payload = Redact(payload, out redactions, options);
        var plaintext = JsonSerializer.SerializeToUtf8Bytes(payload, options);
        if (plaintext.Length > MaxPlaintextBytes) throw new InvalidDataException("The selected workspace backup exceeds the 12 MiB safety limit.");
        var digest = Convert.ToHexString(SHA256.HashData(plaintext)).ToLowerInvariant();
        encrypted = !string.IsNullOrWhiteSpace(passphrase);
        if (!encrypted)
            return JsonSerializer.Serialize(new WorkspaceBackupEnvelope(FormatName, 1, DateTimeOffset.UtcNow, false, digest, Convert.ToBase64String(plaintext)), options);

        ValidatePassphrase(passphrase!);
        var salt = RandomNumberGenerator.GetBytes(16);
        var nonce = RandomNumberGenerator.GetBytes(12);
        var ciphertext = new byte[plaintext.Length];
        var tag = new byte[16];
        var key = Rfc2898DeriveBytes.Pbkdf2(passphrase!, salt, Pbkdf2Iterations, HashAlgorithmName.SHA256, 32);
        try
        {
            using var aes = new AesGcm(key, tag.Length);
            aes.Encrypt(nonce, plaintext, ciphertext, tag, AssociatedData);
        }
        finally { CryptographicOperations.ZeroMemory(key); }
        return JsonSerializer.Serialize(new WorkspaceBackupEnvelope(
            FormatName, 1, DateTimeOffset.UtcNow, true, digest,
            Convert.ToBase64String(ciphertext), Convert.ToBase64String(salt), Convert.ToBase64String(nonce), Convert.ToBase64String(tag)), options);
    }

    public static OpenedWorkspaceBackup Open(string archive, string? passphrase, JsonSerializerOptions options)
    {
        if (string.IsNullOrWhiteSpace(archive) || archive.Length > MaxArchiveCharacters || archive.Contains('\0'))
            throw new InvalidDataException("The workspace backup is empty or exceeds the 16 MB archive limit.");
        WorkspaceBackupEnvelope envelope;
        try { envelope = JsonSerializer.Deserialize<WorkspaceBackupEnvelope>(archive, options) ?? throw new InvalidDataException("The backup envelope is empty."); }
        catch (JsonException error) { throw new InvalidDataException("This file is not a valid Skai workspace backup.", error); }
        if (envelope.Format != FormatName || envelope.Version != 1 || !Regex.IsMatch(envelope.Digest, "^[a-f0-9]{64}$", RegexOptions.CultureInvariant))
            throw new InvalidDataException("The backup format or version is not supported.");
        byte[] data;
        try { data = Convert.FromBase64String(envelope.Data); }
        catch (FormatException error) { throw new InvalidDataException("The backup data encoding is invalid.", error); }
        if (data.Length > MaxPlaintextBytes) throw new InvalidDataException("The workspace backup exceeds the supported 12 MiB payload limit.");
        byte[] plaintext;
        if (!envelope.Encrypted)
        {
            if (envelope.Salt is not null || envelope.Nonce is not null || envelope.Tag is not null)
                throw new InvalidDataException("The unencrypted backup contains inconsistent encryption metadata.");
            plaintext = data;
        }
        else
        {
            ValidatePassphrase(passphrase ?? string.Empty);
            byte[] salt, nonce, tag;
            try
            {
                salt = Convert.FromBase64String(envelope.Salt ?? string.Empty);
                nonce = Convert.FromBase64String(envelope.Nonce ?? string.Empty);
                tag = Convert.FromBase64String(envelope.Tag ?? string.Empty);
            }
            catch (FormatException error) { throw new InvalidDataException("The encrypted backup metadata is invalid.", error); }
            if (salt.Length != 16 || nonce.Length != 12 || tag.Length != 16)
                throw new InvalidDataException("The encrypted backup metadata has invalid lengths.");
            plaintext = new byte[data.Length];
            var key = Rfc2898DeriveBytes.Pbkdf2(passphrase!, salt, Pbkdf2Iterations, HashAlgorithmName.SHA256, 32);
            try
            {
                using var aes = new AesGcm(key, tag.Length);
                aes.Decrypt(nonce, data, tag, plaintext, AssociatedData);
            }
            catch (CryptographicException error) { throw new InvalidDataException("The passphrase is incorrect or the encrypted backup was changed.", error); }
            finally { CryptographicOperations.ZeroMemory(key); }
        }
        var actualDigest = Convert.ToHexString(SHA256.HashData(plaintext)).ToLowerInvariant();
        if (!CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(actualDigest), Encoding.ASCII.GetBytes(envelope.Digest)))
            throw new InvalidDataException("The backup integrity check failed; no data was restored.");
        WorkspaceBackupPayload payload;
        try { payload = JsonSerializer.Deserialize<WorkspaceBackupPayload>(plaintext, options) ?? throw new InvalidDataException("The backup payload is empty."); }
        catch (JsonException error) { throw new InvalidDataException("The backup payload could not be read; no data was restored.", error); }
        ValidatePayload(payload);
        return new(payload, envelope, actualDigest);
    }

    public static AppSettings MakePortableSettings(AppSettings source, bool includePersonas, JsonSerializerOptions options)
    {
        var settings = JsonSerializer.Deserialize<AppSettings>(JsonSerializer.Serialize(source, options), options) ?? new AppSettings();
        settings.Endpoint = "http://localhost:11434/v1";
        settings.ComfyEndpoint = "http://127.0.0.1:8188";
        settings.GitHubAppClientId = string.Empty;
        settings.AirLlmPythonPath = "python";
        settings.AirLlmCachePath = null;
        settings.LocalRamBudgetBytes = 0;
        settings.LocalGpuBudgetBytes = 0;
        settings.PinnedModelConnections = [];
        settings.ProjectPath = null;
        settings.ProjectInstructions = null;
        settings.LastProjectFileProjectId = null;
        settings.LastProjectFilePath = null;
        settings.OpenProjectFileProjectId = null;
        settings.OpenProjectFiles = [];
        settings.ExpandedProjectFolders = new(StringComparer.OrdinalIgnoreCase);
        settings.InstalledPlugins = [];
        settings.ImageWorkflow = string.Empty;
        settings.ThreeDWorkflow = string.Empty;
        settings.SavedPersonas = includePersonas ? settings.SavedPersonas : [];
        return settings;
    }

    public static AppSettings KeepMachineSettings(AppSettings incoming, AppSettings current, JsonSerializerOptions options)
    {
        var restored = MakePortableSettings(incoming, includePersonas: true, options);
        restored.Endpoint = current.Endpoint;
        restored.ComfyEndpoint = current.ComfyEndpoint;
        restored.AirLlmPythonPath = current.AirLlmPythonPath;
        restored.AirLlmCachePath = current.AirLlmCachePath;
        restored.LocalRamBudgetBytes = current.LocalRamBudgetBytes;
        restored.LocalGpuBudgetBytes = current.LocalGpuBudgetBytes;
        restored.PinnedModelConnections = current.PinnedModelConnections;
        restored.GitHubAppClientId = current.GitHubAppClientId;
        restored.ProjectPath = current.ProjectPath;
        restored.ProjectInstructions = current.ProjectInstructions;
        restored.LastProjectFileProjectId = current.LastProjectFileProjectId;
        restored.LastProjectFilePath = current.LastProjectFilePath;
        restored.OpenProjectFileProjectId = current.OpenProjectFileProjectId;
        restored.OpenProjectFiles = current.OpenProjectFiles;
        restored.ExpandedProjectFolders = current.ExpandedProjectFolders;
        restored.InstalledPlugins = current.InstalledPlugins;
        restored.ImageWorkflow = current.ImageWorkflow;
        restored.ThreeDWorkflow = current.ThreeDWorkflow;
        restored.SavedPersonas = current.SavedPersonas;
        return restored;
    }

    private static WorkspaceBackupPayload Redact(WorkspaceBackupPayload payload, out int count, JsonSerializerOptions options)
    {
        var node = System.Text.Json.Nodes.JsonNode.Parse(JsonSerializer.Serialize(payload, options));
        count = 0;
        var redacted = RedactNode(node, ref count);
        return redacted?.Deserialize<WorkspaceBackupPayload>(options) ?? new WorkspaceBackupPayload();
    }

    private static System.Text.Json.Nodes.JsonNode? RedactNode(System.Text.Json.Nodes.JsonNode? node, ref int count)
    {
        if (node is System.Text.Json.Nodes.JsonValue value && value.TryGetValue<string>(out var text))
        {
            var next = SecretToken.Replace(text, "[REDACTED]");
            next = SecretAssignment.Replace(next, match => $"{match.Groups[1].Value}{match.Groups[2].Value}[REDACTED]");
            if (!string.Equals(next, text, StringComparison.Ordinal)) count++;
            return System.Text.Json.Nodes.JsonValue.Create(next);
        }
        if (node is System.Text.Json.Nodes.JsonObject obj)
        {
            foreach (var key in obj.Select(item => item.Key).ToArray())
            {
                var child = obj[key];
                if (child is System.Text.Json.Nodes.JsonObject or System.Text.Json.Nodes.JsonArray) RedactNode(child, ref count);
                else if (child is System.Text.Json.Nodes.JsonValue childValue && childValue.TryGetValue<string>(out _)) obj[key] = RedactNode(child, ref count);
            }
        }
        else if (node is System.Text.Json.Nodes.JsonArray array)
        {
            for (var index = 0; index < array.Count; index++)
            {
                var child = array[index];
                if (child is System.Text.Json.Nodes.JsonObject or System.Text.Json.Nodes.JsonArray) RedactNode(child, ref count);
                else if (child is System.Text.Json.Nodes.JsonValue childValue && childValue.TryGetValue<string>(out _)) array[index] = RedactNode(child, ref count);
            }
        }
        return node;
    }

    private static void ValidatePayload(WorkspaceBackupPayload payload)
    {
        if (payload.Conversations is { Count: > 20_000 } || payload.Personas is { Count: > 1_000 } || payload.Projects is { Count: > 2_000 })
            throw new InvalidDataException("The backup contains more records than Skai supports.");
        if (payload.Conversations is not null && payload.Conversations.Any(item => item is null || string.IsNullOrWhiteSpace(item.Id) || item.Id.Length > 128 || string.IsNullOrWhiteSpace(item.Title) || item.Title.Length > 200))
            throw new InvalidDataException("The backup contains an invalid conversation record.");
        if (payload.Conversations is not null && payload.Conversations.Select(item => item.Id).Distinct(StringComparer.Ordinal).Count() != payload.Conversations.Count)
            throw new InvalidDataException("The backup contains duplicate conversation identifiers.");
        if (payload.Personas is not null && payload.Personas.Any(item => item is null || string.IsNullOrWhiteSpace(item.Id) || item.Id.Length > 128 || string.IsNullOrWhiteSpace(item.Name) || item.Name.Length > 200))
            throw new InvalidDataException("The backup contains an invalid persona record.");
        if (payload.Personas is not null && payload.Personas.Select(item => item.Id).Distinct(StringComparer.Ordinal).Count() != payload.Personas.Count)
            throw new InvalidDataException("The backup contains duplicate persona identifiers.");
        if (payload.Projects is not null && payload.Projects.Any(item => item is null || string.IsNullOrWhiteSpace(item.Id) || item.Id.Length > 128 || string.IsNullOrWhiteSpace(item.Name) || item.Name.Length > 200 || item.GitHubRepository?.Length > 256))
            throw new InvalidDataException("The backup contains invalid project metadata.");
        if (payload.Projects is not null && payload.Projects.Select(item => item.Id).Distinct(StringComparer.Ordinal).Count() != payload.Projects.Count)
            throw new InvalidDataException("The backup contains duplicate project identifiers.");
        if (payload.Settings is null && payload.Conversations is null && payload.Personas is null && payload.Projects is null)
            throw new InvalidDataException("The backup contains no restorable workspace categories.");
        if (payload.Settings is { } settings && (settings.SavedPersonas.Count > 24 || settings.WorkspaceDrafts.Count > 200))
            throw new InvalidDataException("The backup settings exceed supported collection limits.");
    }

    private static void ValidatePassphrase(string passphrase)
    {
        if (passphrase.Length is < 10 or > 1_024 || passphrase.Any(char.IsControl))
            throw new InvalidDataException("Encrypted backups require a passphrase of 10–1,024 characters.");
    }
}
