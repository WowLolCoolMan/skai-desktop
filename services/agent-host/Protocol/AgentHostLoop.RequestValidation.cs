using System.Text.Json;
using SkaiDesktop.Core.Infrastructure;
using SkaiDesktop.Core.Models;
using SkaiDesktop.Core.Services;

namespace SkaiDesktop.AgentHost.Protocol;

public static partial class AgentHostLoop
{
    private static bool OptionalBoolean(AgentRequest request, string name) =>
        request.Params?.TryGetProperty(name, out var value) == true && value.ValueKind == JsonValueKind.True;

    private static long? OptionalLong(AgentRequest request, string name) =>
        request.Params?.TryGetProperty(name, out var value) == true && value.TryGetInt64(out var result) ? result : null;

    private static string RequiredJsonString(JsonElement value, string name, int maxLength)
    {
        if (!value.TryGetProperty(name, out var property) || property.ValueKind != JsonValueKind.String)
            throw new InvalidOperationException($"The marketplace file manifest requires a {name} value.");
        var result = property.GetString() ?? string.Empty;
        if (result.Length == 0 || result.Length > maxLength || result.Any(char.IsControl)) throw new InvalidOperationException($"The marketplace file manifest {name} value is invalid.");
        return result;
    }

    /// <summary>A bounded JSON-schema object from the "responseSchema" parameter, serialized for the provider.</summary>
    private static string? OptionalResponseSchema(AgentRequest request)
    {
        if (request.Params is not { } parameters || !parameters.TryGetProperty("responseSchema", out var schema) || schema.ValueKind == JsonValueKind.Null) return null;
        if (schema.ValueKind != JsonValueKind.Object) throw new InvalidOperationException("responseSchema must be a JSON schema object.");
        var json = schema.GetRawText();
        if (json.Length > 16_000) throw new InvalidOperationException("responseSchema exceeds the safety limit.");
        return json;
    }

    private static string? OptionalJsonString(JsonElement value, string name)
    {
        if (!value.TryGetProperty(name, out var property) || property.ValueKind == JsonValueKind.Null) return null;
        return property.ValueKind == JsonValueKind.String ? property.GetString() : null;
    }

    private static long RequiredJsonLong(JsonElement value, string name)
    {
        if (!value.TryGetProperty(name, out var property) || !property.TryGetInt64(out var result) || result < 0)
            throw new InvalidOperationException($"The marketplace file manifest {name} value is invalid.");
        return result;
    }

    private static string RequiredString(AgentRequest request, string name)
    {
        var value = OptionalString(request, name);
        return string.IsNullOrWhiteSpace(value) ? throw new InvalidOperationException($"{name} is required.") : value;
    }

    private static string RequiredBoundedString(AgentRequest request, string name, int maxLength)
    {
        var value = RequiredString(request, name);
        if (value.Length > maxLength || value.Any(char.IsControl)) throw new InvalidOperationException($"{name} exceeds its safety limit.");
        return value.Trim();
    }

    private static string RequiredTerminalText(AgentRequest request, string name, int maxLength)
    {
        var value = RequiredString(request, name);
        if (value.Length > maxLength || value.Any(character => char.IsControl(character) && character is not ('\r' or '\n' or '\t' or '\u001b')))
            throw new InvalidOperationException($"{name} exceeds its safety limit.");
        return value;
    }

    private static string RequiredLocalEndpoint(AgentRequest request, string name, int maxLength)
    {
        var endpoint = RequiredBoundedString(request, name, maxLength);
        if (!Uri.TryCreate(endpoint, UriKind.Absolute, out var uri)
            || uri is null
            || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
            || !uri.IsLoopback
            || !string.IsNullOrEmpty(uri.UserInfo)
            || !string.IsNullOrEmpty(uri.Fragment))
            throw new InvalidOperationException("Skai Desktop only connects to a local loopback model endpoint without embedded credentials or a URL fragment.");
        return endpoint;
    }

    private static string RequiredSpeechText(AgentRequest request, string name, int maxLength)
    {
        var value = RequiredString(request, name);
        if (value.Length > maxLength || value.Any(character => char.IsControl(character) && character is not ('\r' or '\n' or '\t')))
            throw new InvalidOperationException($"{name} exceeds its safety limit.");
        // The native fallback does not implement expressive effect tags. Strip
        // structured cues at the protocol boundary so it never says "cough"
        // or "laugh" aloud when the selected engine cannot render them.
        return System.Text.RegularExpressions.Regex.Replace(
            value.Replace('\r', ' ').Replace('\n', ' ').Replace('\t', ' ').Trim(),
            @"\[(laugh|cough|clear[- ]?throat|breath|sigh)(?::[^\]]+)?\]",
            string.Empty,
            System.Text.RegularExpressions.RegexOptions.IgnoreCase).Trim();
    }

    private static string? OptionalBoundedValue(string? value, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        if (value.Length > maxLength || value.Any(char.IsControl)) throw new InvalidOperationException("Metadata value exceeds the safety limit.");
        return value.Trim();
    }

    private static string? OptionalString(AgentRequest request, string name) =>
        request.Params is { } parameters && parameters.TryGetProperty(name, out var value) ? value.GetString() : null;

    private static IReadOnlyList<ChatAttachment>? OptionalAttachments(AgentRequest request)
    {
        if (request.Params is not { } parameters || !parameters.TryGetProperty("attachments", out var value) || value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            return null;
        if (value.ValueKind != JsonValueKind.Array) throw new InvalidOperationException("attachments must be an array.");
        var attachments = value.Deserialize<List<ChatAttachment>>(JsonOptions) ?? [];
        if (attachments.Count > ChatAttachmentPolicy.MaxFiles) throw new InvalidOperationException("Too many queued attachments.");
        var totalTextCharacters = 0;
        var totalImageBytes = 0L;
        foreach (var attachment in attachments)
        {
            if (!ChatAttachmentPolicy.IsAllowedName(attachment.FileName)) throw new InvalidOperationException($"The attachment name is not allowed: {attachment.FileName}");
            if (attachment.FileName.Length > 260 || attachment.FileName.Any(char.IsControl) || string.IsNullOrWhiteSpace(attachment.Content)) throw new InvalidOperationException("The queued attachment is invalid.");
            if (attachment.IsImage)
            {
                if (!ChatAttachmentPolicy.IsAllowedImageMediaType(attachment.MediaType)) throw new InvalidOperationException("The queued image type is not allowed.");
                byte[] bytes;
                try { bytes = Convert.FromBase64String(attachment.Content); }
                catch (FormatException error) { throw new InvalidDataException("The queued image encoding is invalid.", error); }
                if (!ChatAttachmentPolicy.HasValidImageSignature(attachment.MediaType, bytes)) throw new InvalidDataException("The queued image signature is invalid.");
                totalImageBytes += bytes.Length;
            }
            else
            {
                totalTextCharacters += attachment.Content.Length;
                if (attachment.Content.Length > ChatAttachmentPolicy.MaxCharactersPerFile) throw new InvalidOperationException("The queued attachment exceeds its character limit.");
            }
        }
        if (totalTextCharacters > ChatAttachmentPolicy.MaxTotalCharacters) throw new InvalidOperationException("Queued attachments exceed the total character limit.");
        if (totalImageBytes > ChatAttachmentPolicy.MaxTotalImageBytes) throw new InvalidOperationException("Queued images exceed the total size limit.");
        return attachments;
    }

    private static List<string> OptionalStringList(AgentRequest request, string name, int maxItems, int maxLength)
    {
        if (request.Params is not { } parameters || !parameters.TryGetProperty(name, out var value)) return [];
        if (value.ValueKind != JsonValueKind.Array) throw new InvalidOperationException($"{name} must be an array.");
        var values = value.EnumerateArray().Select(item => item.GetString() ?? string.Empty).ToList();
        if (values.Count > maxItems || values.Any(item => string.IsNullOrWhiteSpace(item) || item.Length > maxLength || item.Any(char.IsControl)))
            throw new InvalidOperationException($"{name} exceeds the safety limit.");
        return values.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }

    private static double? OptionalDouble(AgentRequest request, string name) =>
        request.Params is { } parameters && parameters.TryGetProperty(name, out var value) && value.TryGetDouble(out var result) ? result : null;

    private static int? OptionalInt(AgentRequest request, string name) =>
        request.Params is { } parameters && parameters.TryGetProperty(name, out var value) && value.TryGetInt32(out var result) ? result : null;
}
