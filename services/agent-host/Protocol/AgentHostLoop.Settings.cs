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
            comfyEndpoint = settings.ComfyEndpoint,
            imageWorkflow = settings.ImageWorkflow,
            threeDWorkflow = settings.ThreeDWorkflow,
            subagentModel = settings.SubagentModel,
            subagentModelProvider = settings.SubagentModelProvider,
            subagentModelSizeBytes = settings.SubagentModelSizeBytes,
            subagentModelContextLength = settings.SubagentModelContextLength,
            codingModel = settings.CodingModel,
            codingModelProvider = settings.CodingModelProvider,
            codingModelSizeBytes = settings.CodingModelSizeBytes,
            codingModelContextLength = settings.CodingModelContextLength,
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
            chatRetentionDays = settings.ChatRetentionDays,
            taskRetentionDays = settings.TaskRetentionDays,
            taskLogRetentionDays = settings.TaskLogRetentionDays,
            presets = settings.SavedPresets.Select(preset => new { id = preset.Id, name = preset.Name }).ToArray(),
        });
    }

    private static AgentResponse SaveSettings(AgentRequest request)
    {
        var store = CreateSettingsStore();
        var settings = store.Load();
        if (request.Params is { } parameters)
        {
            // Settings pages may update a single preference. Leave unrelated
            // runtime choices untouched when the caller omits them.
            if (parameters.TryGetProperty("endpoint", out _))
                settings.Endpoint = RequiredLocalEndpoint(request, "endpoint", 2_000);
            if (parameters.TryGetProperty("model", out _))
                settings.Model = RequiredBoundedString(request, "model", 256);
            if (parameters.TryGetProperty("comfyEndpoint", out var comfyEndpoint) && comfyEndpoint.ValueKind == JsonValueKind.String)
            {
                var value = comfyEndpoint.GetString()?.Trim() ?? "";
                if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || !LocalEndpoint.IsLocal(value) || uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps || uri.AbsolutePath != "/" || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment))
                    throw new InvalidOperationException("ComfyUI must use a local HTTP or HTTPS endpoint such as http://127.0.0.1:8188.");
                settings.ComfyEndpoint = value;
            }
            if (parameters.TryGetProperty("imageWorkflow", out var imageWorkflow) && imageWorkflow.ValueKind == JsonValueKind.String)
            {
                var value = imageWorkflow.GetString() ?? "";
                if (value.Length > 1_000_000) throw new InvalidOperationException("The ComfyUI image workflow exceeds 1 MB.");
                settings.ImageWorkflow = value;
            }
            if (parameters.TryGetProperty("threeDWorkflow", out var threeDWorkflow) && threeDWorkflow.ValueKind == JsonValueKind.String)
            {
                var value = threeDWorkflow.GetString() ?? "";
                if (value.Length > 1_000_000) throw new InvalidOperationException("The ComfyUI 3D workflow exceeds 1 MB.");
                settings.ThreeDWorkflow = value;
            }
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
            if (parameters.TryGetProperty("subagentModel", out var subagentModel) && subagentModel.ValueKind == JsonValueKind.String)
            {
                var value = subagentModel.GetString()?.Trim() ?? "";
                if (value.Length > 256 || value.Any(char.IsControl)) throw new InvalidOperationException("The subagent model exceeds the safety limit.");
                settings.SubagentModel = value;
            }
            if (parameters.TryGetProperty("subagentModelProvider", out var subagentProvider) && subagentProvider.ValueKind == JsonValueKind.String)
            {
                var value = subagentProvider.GetString()?.Trim() ?? "";
                if (value.Length > 128 || value.Any(char.IsControl)) throw new InvalidOperationException("The subagent model provider exceeds the safety limit.");
                settings.SubagentModelProvider = value;
            }
            if (parameters.TryGetProperty("subagentModelSizeBytes", out var subagentSize))
            {
                if (subagentSize.ValueKind == JsonValueKind.Null) settings.SubagentModelSizeBytes = null;
                else if (subagentSize.TryGetInt64(out var bytes) && bytes is >= 0 and <= (1L << 50)) settings.SubagentModelSizeBytes = bytes;
                else throw new InvalidOperationException("The subagent model size must be between 0 and 1024 GiB.");
            }
            if (parameters.TryGetProperty("subagentModelContextLength", out var subagentContext))
            {
                if (subagentContext.ValueKind == JsonValueKind.Null) settings.SubagentModelContextLength = null;
                else if (subagentContext.TryGetInt32(out var tokens) && tokens is >= 0 and <= 16_777_216) settings.SubagentModelContextLength = tokens;
                else throw new InvalidOperationException("The subagent model context length is invalid.");
            }
            if (parameters.TryGetProperty("codingModel", out var codingModel) && codingModel.ValueKind == JsonValueKind.String)
            {
                var value = codingModel.GetString()?.Trim() ?? "";
                if (value.Length > 256 || value.Any(char.IsControl)) throw new InvalidOperationException("The coding model exceeds the safety limit.");
                settings.CodingModel = value;
            }
            if (parameters.TryGetProperty("codingModelProvider", out var codingProvider) && codingProvider.ValueKind == JsonValueKind.String)
            {
                var value = codingProvider.GetString()?.Trim() ?? "";
                if (value.Length > 128 || value.Any(char.IsControl)) throw new InvalidOperationException("The coding model provider exceeds the safety limit.");
                settings.CodingModelProvider = value;
            }
            if (parameters.TryGetProperty("codingModelSizeBytes", out var codingSize))
            {
                if (codingSize.ValueKind == JsonValueKind.Null) settings.CodingModelSizeBytes = null;
                else if (codingSize.TryGetInt64(out var bytes) && bytes is >= 0 and <= (1L << 50)) settings.CodingModelSizeBytes = bytes;
                else throw new InvalidOperationException("The coding model size must be between 0 and 1024 GiB.");
            }
            if (parameters.TryGetProperty("codingModelContextLength", out var codingContext))
            {
                if (codingContext.ValueKind == JsonValueKind.Null) settings.CodingModelContextLength = null;
                else if (codingContext.TryGetInt32(out var tokens) && tokens is >= 0 and <= 16_777_216) settings.CodingModelContextLength = tokens;
                else throw new InvalidOperationException("The coding model context length is invalid.");
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
            if (parameters.TryGetProperty("chatRetentionDays", out var chatRetention) && chatRetention.TryGetInt32(out var chatDays))
                settings.ChatRetentionDays = ValidateRetentionDays(chatDays, "Chat");
            if (parameters.TryGetProperty("taskRetentionDays", out var taskRetention) && taskRetention.TryGetInt32(out var taskDays))
                settings.TaskRetentionDays = ValidateRetentionDays(taskDays, "Task");
            if (parameters.TryGetProperty("taskLogRetentionDays", out var taskLogRetention) && taskLogRetention.TryGetInt32(out var taskLogDays))
                settings.TaskLogRetentionDays = ValidateRetentionDays(taskLogDays, "Task log");
        }
        store.Save(settings);
        return new(ProtocolVersion, request.Id, true, new { endpoint = settings.Endpoint, model = settings.Model, provider = settings.ModelProvider, comfyEndpoint = settings.ComfyEndpoint, imageWorkflow = settings.ImageWorkflow, threeDWorkflow = settings.ThreeDWorkflow, subagentModel = settings.SubagentModel, subagentModelProvider = settings.SubagentModelProvider, subagentModelSizeBytes = settings.SubagentModelSizeBytes, subagentModelContextLength = settings.SubagentModelContextLength, codingModel = settings.CodingModel, codingModelProvider = settings.CodingModelProvider, codingModelSizeBytes = settings.CodingModelSizeBytes, codingModelContextLength = settings.CodingModelContextLength, ollamaContextWindowTokens = settings.OllamaContextWindowTokens, localRamBudgetBytes = settings.LocalRamBudgetBytes, localGpuBudgetBytes = settings.LocalGpuBudgetBytes, themeMode = settings.ThemeMode, accentColor = settings.AccentColor, interfaceDensity = settings.InterfaceDensity, backdropPreset = settings.BackdropPreset, reduceMotion = settings.ReduceMotion, developerMode = settings.DeveloperMode, memoryInjectionEnabled = settings.MemoryInjectionEnabled, smartPromptRewritingEnabled = settings.SmartPromptRewritingEnabled, personaConversationRetentionMinutes = settings.PersonaConversationRetentionMinutes, chatRetentionDays = settings.ChatRetentionDays, taskRetentionDays = settings.TaskRetentionDays, taskLogRetentionDays = settings.TaskLogRetentionDays, presets = settings.SavedPresets.Select(preset => new { id = preset.Id, name = preset.Name }).ToArray() });
    }

    private static int ValidateRetentionDays(int days, string label) => days is 0 or 7 or 30 or 90 or 365
        ? days
        : throw new InvalidOperationException($"{label} retention must be Never, 7, 30, 90, or 365 days.");


}
