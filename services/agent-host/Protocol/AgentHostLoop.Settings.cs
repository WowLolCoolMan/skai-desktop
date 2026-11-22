using System.Text.Json;
using SkaiDesktop.Core.Infrastructure;
using SkaiDesktop.Core.Models;

namespace SkaiDesktop.AgentHost.Protocol;

public static partial class AgentHostLoop
{
    private static AgentResponse GetUserProfile(AgentRequest request)
    {
        var settings = CreateSettingsStore().Load();
        return new(ProtocolVersion, request.Id, true, new { name = settings.UserName, gender = settings.UserGender, age = settings.UserAge > 0 ? settings.UserAge : (int?)null });
    }

    /// <summary>Saves the optional "About you" details. Every field may be blank; age must be 1–120 when given.</summary>
    private static AgentResponse SaveUserProfile(AgentRequest request)
    {
        var store = CreateSettingsStore();
        var settings = store.Load();
        settings.UserName = ModelInstructions.CleanProfileValue(OptionalString(request, "name"), 60);
        settings.UserGender = ModelInstructions.CleanProfileValue(OptionalString(request, "gender"), 40);
        var age = OptionalInt(request, "age") ?? 0;
        if (age is < 0 or > 120) throw new InvalidOperationException("Age must be between 1 and 120, or left blank.");
        settings.UserAge = age;
        store.Save(settings);
        return GetUserProfile(request);
    }

    private static AgentResponse GetSettings(AgentRequest request)
    {
        var settings = CreateSettingsStore().Load();
        return new(ProtocolVersion, request.Id, true, new
        {
            // A settings file may have been written by the legacy surface before
            // the local-only policy was introduced. Never echo that stale value
            // back into the Electron runtime as an apparent usable route.
            endpoint = LocalEndpoint.IsLocal(settings.Endpoint) ? settings.Endpoint : "http://localhost:11434/v1",
            model = settings.Model,
            provider = settings.ModelProvider,
            ollamaContextWindowTokens = settings.OllamaContextWindowTokens,
            localRamBudgetBytes = settings.LocalRamBudgetBytes,
            localGpuBudgetBytes = settings.LocalGpuBudgetBytes,
            themeMode = settings.ThemeMode,
            accentColor = settings.AccentColor,
            interfaceDensity = settings.InterfaceDensity,
            backdropPreset = settings.BackdropPreset,
            reduceMotion = settings.ReduceMotion,
            developerMode = settings.DeveloperMode,
            memoryInjectionEnabled = settings.MemoryInjectionEnabled,
            smartPromptRewritingEnabled = settings.SmartPromptRewritingEnabled,
            personaConversationRetentionMinutes = settings.PersonaConversationRetentionMinutes,
        });
    }

    private static AgentResponse SaveSettings(AgentRequest request)
    {
        var store = CreateSettingsStore();
        var settings = store.Load();
        settings.Endpoint = RequiredLocalEndpoint(request, "endpoint", 2_000);
        settings.Model = RequiredBoundedString(request, "model", 256);
        if (request.Params is { } parameters)
        {
            if (parameters.TryGetProperty("provider", out var provider) && provider.ValueKind == JsonValueKind.String)
            {
                var requestedProvider = provider.GetString();
                if (!string.IsNullOrWhiteSpace(requestedProvider))
                {
                    if (requestedProvider.Length > 128 || requestedProvider.Any(char.IsControl))
                        throw new InvalidOperationException("provider exceeds the safety limit.");
                    settings.ModelProvider = requestedProvider.Trim();
                }
            }
            if (parameters.TryGetProperty("ollamaContextWindowTokens", out var contextWindow) && contextWindow.TryGetInt32(out var contextTokens))
            {
                if (contextTokens is not (0 or 32_768 or 131_072 or 1_048_576))
                    throw new InvalidOperationException("The Ollama context window must be Auto, 32K, 128K, or 1M tokens.");
                settings.OllamaContextWindowTokens = contextTokens;
            }
            if (parameters.TryGetProperty("localRamBudgetBytes", out var ramBudget) && ramBudget.TryGetInt64(out var ramBytes))
            {
                if (ramBytes is < 0 or > (1L << 50)) throw new InvalidOperationException("The RAM budget must be between 0 and 1024 GiB.");
                settings.LocalRamBudgetBytes = ramBytes;
            }
            if (parameters.TryGetProperty("localGpuBudgetBytes", out var gpuBudget) && gpuBudget.TryGetInt64(out var gpuBytes))
            {
                if (gpuBytes is < 0 or > (1L << 50)) throw new InvalidOperationException("The VRAM budget must be between 0 and 1024 GiB.");
                settings.LocalGpuBudgetBytes = gpuBytes;
            }
            if (parameters.TryGetProperty("themeMode", out var theme) && theme.ValueKind == JsonValueKind.String)
                settings.ThemeMode = theme.GetString() ?? settings.ThemeMode;
            if (parameters.TryGetProperty("accentColor", out var accent) && accent.ValueKind == JsonValueKind.String)
                settings.AccentColor = accent.GetString() ?? settings.AccentColor;
            if (parameters.TryGetProperty("interfaceDensity", out var density) && density.ValueKind == JsonValueKind.String)
                settings.InterfaceDensity = density.GetString() ?? settings.InterfaceDensity;
            if (parameters.TryGetProperty("backdropPreset", out var backdrop) && backdrop.ValueKind == JsonValueKind.String)
                settings.BackdropPreset = backdrop.GetString() ?? settings.BackdropPreset;
            if (parameters.TryGetProperty("developerMode", out var developer) && developer.ValueKind is JsonValueKind.True or JsonValueKind.False)
                settings.DeveloperMode = developer.GetBoolean();
            if (parameters.TryGetProperty("memoryInjectionEnabled", out var memoryInjection) && memoryInjection.ValueKind is JsonValueKind.True or JsonValueKind.False)
                settings.MemoryInjectionEnabled = memoryInjection.GetBoolean();
            if (parameters.TryGetProperty("smartPromptRewritingEnabled", out var smartPromptRewriting) && smartPromptRewriting.ValueKind is JsonValueKind.True or JsonValueKind.False)
                settings.SmartPromptRewritingEnabled = smartPromptRewriting.GetBoolean();
            if (parameters.TryGetProperty("reduceMotion", out var reduceMotion) && reduceMotion.ValueKind is JsonValueKind.True or JsonValueKind.False)
                settings.ReduceMotion = reduceMotion.GetBoolean();
            if (parameters.TryGetProperty("personaConversationRetentionMinutes", out var personaRetention) && personaRetention.TryGetInt32(out var retentionMinutes))
            {
                if (retentionMinutes is not (15 or 60 or 240 or 1_440 or 10_080))
                    throw new InvalidOperationException("Persona conversation retention must be 15 minutes, 1 hour, 4 hours, 1 day, or 7 days.");
                settings.PersonaConversationRetentionMinutes = retentionMinutes;
            }
        }
        store.Save(settings);
        return new(ProtocolVersion, request.Id, true, new { endpoint = settings.Endpoint, model = settings.Model, provider = settings.ModelProvider, ollamaContextWindowTokens = settings.OllamaContextWindowTokens, localRamBudgetBytes = settings.LocalRamBudgetBytes, localGpuBudgetBytes = settings.LocalGpuBudgetBytes, themeMode = settings.ThemeMode, accentColor = settings.AccentColor, interfaceDensity = settings.InterfaceDensity, backdropPreset = settings.BackdropPreset, reduceMotion = settings.ReduceMotion, developerMode = settings.DeveloperMode, memoryInjectionEnabled = settings.MemoryInjectionEnabled, smartPromptRewritingEnabled = settings.SmartPromptRewritingEnabled, personaConversationRetentionMinutes = settings.PersonaConversationRetentionMinutes });
    }


}