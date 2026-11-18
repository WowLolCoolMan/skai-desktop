// Loads/saves AppSettings as settings.json in the user's app-data folder.
// Depends on: AppSettings, BoundedFileReader, AtomicFileWriter. Used by: the Agent Host settings protocol.

using System.Text.Json;
using SkaiDesktop.Core.Models;

namespace SkaiDesktop.Core.Infrastructure;

/// <summary>Stores non-secret preferences in the current user's app data directory.</summary>
public sealed class JsonSettingsStore
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    private readonly string _path;

    public JsonSettingsStore(string? path = null)
    {
        _path = path ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData, Environment.SpecialFolderOption.Create),
            "SkaiDesktop", "AI", "settings.json");
    }

    public AppSettings Load()
    {
        try
        {
            if (File.Exists(_path)) return Normalize(JsonSerializer.Deserialize<AppSettings>(BoundedFileReader.ReadText(_path), Options) ?? new AppSettings());
        }
        catch (JsonException) { PreserveCorruptSettings(); }
        catch (InvalidDataException) { PreserveCorruptSettings(); }
        catch (IOException) { }
        return new AppSettings();
    }

    private static AppSettings Normalize(AppSettings settings)
    {
        // Settings are user-local JSON and older versions or manual recovery can
        // legitimately contain explicit nulls. Keep optional project fields null,
        // but restore required strings and collections before UI code reads them.
        var defaults = new AppSettings();
        settings.Endpoint ??= defaults.Endpoint;
        settings.Model ??= defaults.Model;
        settings.ModelProvider ??= defaults.ModelProvider;
        if (!LocalEndpoint.IsLocal(settings.Endpoint))
        {
            settings.Endpoint = defaults.Endpoint;
            if (!settings.ModelProvider.Equals("AirLLM", StringComparison.OrdinalIgnoreCase))
                settings.ModelProvider = defaults.ModelProvider;
        }
        settings.RequireLocalModelEndpoints = true;
        settings.VisionApiFormat ??= defaults.VisionApiFormat;
        settings.VisionCapabilityOverride = settings.VisionCapabilityOverride?.ToLowerInvariant() switch
        {
            "supported" or "unsupported" => settings.VisionCapabilityOverride.ToLowerInvariant(),
            _ => defaults.VisionCapabilityOverride
        };
        settings.EffortMode = SkaiDesktop.Core.Services.EffortModePolicy.Normalize(settings.EffortMode);
        settings.OllamaContextWindowTokens = settings.OllamaContextWindowTokens is 32_768 or 131_072 or 1_048_576 ? settings.OllamaContextWindowTokens : 0;
        settings.ComfyEndpoint ??= defaults.ComfyEndpoint;
        settings.ImageWorkflow ??= defaults.ImageWorkflow;
        settings.GitHubAppClientId ??= defaults.GitHubAppClientId;
        settings.PromptUserName ??= defaults.PromptUserName;
        settings.VoicePrimaryModelId = VoiceModelCatalog.Resolve(settings.VoicePrimaryModelId).Id;
        settings.VoiceLowResourceModelId = VoiceModelCatalog.Resolve(settings.VoiceLowResourceModelId).Id;
        settings.VoiceProfileId = VoiceProfileCatalog.Resolve(settings.VoiceProfiles, settings.VoiceProfileId).Id;
        settings.VoiceProfiles ??= [];
        settings.VoiceProfiles = settings.VoiceProfiles
            .Where(profile => profile is not null)
            .Take(12)
            .Select(profile => VoiceProfileCatalog.Resolve([profile], profile.Id))
            .ToList();
        settings.LastProjectFileProjectId = NormalizeOptional(settings.LastProjectFileProjectId, 128);
        settings.LastProjectFilePath = NormalizeOptional(settings.LastProjectFilePath, 512);
        settings.OpenProjectFileProjectId = NormalizeOptional(settings.OpenProjectFileProjectId, 128);
        settings.OpenProjectFiles ??= [];
        settings.OpenProjectFiles = settings.OpenProjectFiles
            .Where(path => !string.IsNullOrWhiteSpace(path) && path.Length <= 512 && !path.Any(char.IsControl))
            .Select(path => path.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(8)
            .ToList();
        settings.ExpandedProjectFolders ??= new(StringComparer.OrdinalIgnoreCase);
        settings.ExpandedProjectFolders = settings.ExpandedProjectFolders
            .Where(entry => !string.IsNullOrWhiteSpace(entry.Key) && entry.Key.Length <= 128 && !entry.Key.Any(char.IsControl))
            .Take(24)
            .ToDictionary(
                entry => entry.Key.Trim(),
                entry => (entry.Value ?? [])
                    .Where(folder => !string.IsNullOrWhiteSpace(folder) && folder.Length <= 512 && !folder.Any(char.IsControl))
                    .Select(folder => folder.Trim().Replace('\\', '/'))
                    .Where(folder => folder.Length > 0 && !folder.StartsWith("/", StringComparison.Ordinal) && !folder.Split('/').Any(part => part is "" or "." or ".."))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .Take(64)
                    .ToList(),
                StringComparer.OrdinalIgnoreCase);
        settings.ThemeMode = settings.ThemeMode?.ToLowerInvariant() switch
        {
            "dark" => "dark",
            _ => defaults.ThemeMode
        };
        settings.PinnedModels ??= [];
        settings.PinnedModelConnections ??= [];
        settings.LocalModelPerformance ??= new(StringComparer.OrdinalIgnoreCase);
        settings.ChatFolders ??= [];
        settings.PromptSnippets ??= [];
        settings.SavedPersonas ??= [];
        settings.SavedPersonas = settings.SavedPersonas
            .Where(persona => persona is not null)
            .Take(24)
            .ToList();
        foreach (var persona in settings.SavedPersonas)
        {
            persona.Id = string.IsNullOrWhiteSpace(persona.Id) ? Guid.NewGuid().ToString("N") : persona.Id.Trim();
            persona.Name = (persona.Name ?? string.Empty).Trim();
            persona.SourceMode = persona.SourceMode?.Equals("public-research", StringComparison.OrdinalIgnoreCase) == true ? "public-research" : "own-material";
            persona.Roles = Bound(persona.Roles, 4_000);
            persona.VoiceProfileId = Bound(persona.VoiceProfileId, 120);
            persona.Voice = Bound(persona.Voice, 8_000);
            persona.Personality = Bound(persona.Personality, 8_000);
            persona.ThinkingStyle = Bound(persona.ThinkingStyle, 8_000);
            persona.InteractionStyle = Bound(persona.InteractionStyle, 8_000);
            persona.Values = Bound(persona.Values, 8_000);
            persona.Knowledge = Bound(persona.Knowledge, 12_000);
            persona.EvidenceBoundaries = Bound(persona.EvidenceBoundaries, 6_000);
            persona.Timeline = Bound(persona.Timeline, 12_000);
            persona.SourceMaterial = Bound(persona.SourceMaterial, 200_000);
            persona.Instructions = (persona.Instructions ?? string.Empty).Trim();
            persona.InteractionCount = Math.Clamp(persona.InteractionCount, 0, 1_000_000);
            persona.ResearchPassCount = Math.Clamp(persona.ResearchPassCount, 0, 1_000);
            persona.LastResearchSummary = Bound(persona.LastResearchSummary, 500);
            if (persona.LatestDistillation is { } distillation)
            {
                distillation.Focus = Bound(distillation.Focus, 120);
                distillation.SourceUrls ??= [];
                distillation.SourceUrls = distillation.SourceUrls.Where(url => !string.IsNullOrWhiteSpace(url) && Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https").Distinct(StringComparer.OrdinalIgnoreCase).Take(12).Select(url => Bound(url, 2_000)).ToList();
                distillation.Roles = Bound(distillation.Roles, 4_000);
                distillation.SpeechPatterns = Bound(distillation.SpeechPatterns, 6_000);
                distillation.Personality = Bound(distillation.Personality, 6_000);
                distillation.ThinkingStyle = Bound(distillation.ThinkingStyle, 6_000);
                distillation.InteractionStyle = Bound(distillation.InteractionStyle, 6_000);
                distillation.Values = Bound(distillation.Values, 6_000);
                distillation.Knowledge = Bound(distillation.Knowledge, 8_000);
                distillation.EvidenceBoundaries = Bound(distillation.EvidenceBoundaries, 5_000);
                distillation.Timeline = Bound(distillation.Timeline, 8_000);
            }
            persona.VerifiedQuotes ??= [];
            persona.VerifiedQuotes = persona.VerifiedQuotes.Where(quote => quote is not null).Take(32).ToList();
            foreach (var quote in persona.VerifiedQuotes)
            {
                quote.Text = Bound(quote.Text, 800);
                quote.SourceId = Bound(quote.SourceId, 128);
                quote.Attribution = Bound(quote.Attribution, 300);
            }
            persona.Sources ??= [];
            persona.Sources = persona.Sources.Where(source => source is not null).Take(32).ToList();
            foreach (var source in persona.Sources)
            {
                source.Title = Bound(source.Title, 300);
                source.Url = Bound(source.Url, 2_000);
                source.AuthorOrPublisher = Bound(source.AuthorOrPublisher, 300);
                source.PublishedDate = Bound(source.PublishedDate, 80);
                source.Type = Bound(source.Type, 80);
                source.ReliabilityNote = Bound(source.ReliabilityNote, 500);
                source.Excerpt = Bound(source.Excerpt, 1_200);
            }
            persona.ResearchHistory ??= [];
            persona.ResearchHistory = persona.ResearchHistory.Where(pass => pass is not null).Take(12).ToList();
            foreach (var pass in persona.ResearchHistory)
            {
                pass.Focus = Bound(pass.Focus, 120);
                pass.Summary = Bound(pass.Summary, 500);
                pass.SourcesAdded = Math.Clamp(pass.SourcesAdded, 0, 32);
            }
            persona.Continuity ??= [];
            persona.Continuity = persona.Continuity.Where(turn => turn is not null).TakeLast(200).ToList();
            foreach (var turn in persona.Continuity)
            {
                turn.Role = turn.Role is "user" or "assistant" ? turn.Role : "user";
                turn.Content = Bound(turn.Content, 4_000);
            }
        }
        if (settings.ActivePersonaId is not null && !settings.SavedPersonas.Any(persona => persona.Id == settings.ActivePersonaId))
            settings.ActivePersonaId = null;
        settings.SavedPresets ??= [];
        settings.SavedPresets = settings.SavedPresets
            .Where(preset => preset is not null)
            .Take(12)
            .ToList();
        foreach (var preset in settings.SavedPresets)
        {
            preset.Id = string.IsNullOrWhiteSpace(preset.Id) ? Guid.NewGuid().ToString("N") : preset.Id.Trim();
            preset.Name = (preset.Name ?? string.Empty).Trim();
            preset.Instructions = (preset.Instructions ?? string.Empty).Trim();
            preset.Knowledge = (preset.Knowledge ?? string.Empty).Trim();
            preset.ToolGuidance = (preset.ToolGuidance ?? string.Empty).Trim();
        }
        if (settings.ActivePresetId is not null && !settings.SavedPresets.Any(preset => preset.Id == settings.ActivePresetId))
            settings.ActivePresetId = null;
        settings.Quicklinks ??= [];
        settings.WorkspaceDrafts ??= new(StringComparer.Ordinal);
        settings.SplitChatRatios ??= new(StringComparer.OrdinalIgnoreCase);
        return settings;
    }

    private static string? NormalizeOptional(string? value, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > maxLength || value.Any(char.IsControl)) return null;
        return value.Trim();
    }

    private static string Bound(string? value, int maxLength)
    {
        var normalized = value?.Trim() ?? string.Empty;
        return normalized.Length <= maxLength ? normalized : normalized[..maxLength];
    }

    public void Save(AppSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        var json = BoundedFileReader.EnsureTextSize(JsonSerializer.Serialize(settings, Options), "saved settings");
        AtomicFileWriter.WriteText(_path, json);
    }

    private void PreserveCorruptSettings()
    {
        try
        {
            var recoveryPath = Path.GetFullPath(_path) + ".corrupt-" + Guid.NewGuid().ToString("N");
            File.Move(_path, recoveryPath);
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }
}
