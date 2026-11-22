using System.Globalization;
using SkaiDesktop.Core.Models;

namespace SkaiDesktop.Core.Services;

/// <summary>Applies a persona's knowledge and era dates to dated public evidence.</summary>
public static class PersonaKnowledgeCutoffPolicy
{
    public static DateOnly? EffectiveCutoff(SavedPersona persona)
    {
        var dates = new[] { ParseDate(persona.KnowledgeCutoffDate), ParseDate(persona.EraDate) }
            .Where(date => date.HasValue)
            .Select(date => date!.Value)
            .ToArray();
        return dates.Length == 0 ? null : dates.Min();
    }

    /// <summary>
    /// Sources explicitly published after the effective cutoff cannot inform the simulation.
    /// Undated sources remain usable, but their date must not be treated as evidence that a fact
    /// was known by the persona at the cutoff.
    /// </summary>
    public static bool IsAvailableByCutoff(SavedPersonaSource source, DateOnly? cutoff)
    {
        if (cutoff is null) return true;
        var published = ParseDate(source.PublishedDate);
        return published is null || published.Value <= cutoff.Value;
    }

    public static bool IsPublishedAfterCutoff(string? publishedDate, DateOnly? cutoff)
    {
        var published = ParseDate(publishedDate);
        return cutoff is not null && published is not null && published.Value > cutoff.Value;
    }

    public static bool IsAvailableByCutoff(SavedPersonaSource source, SavedPersona persona) =>
        IsAvailableByCutoff(source, EffectiveCutoff(persona));

    public static DateOnly? ParseDate(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        if (DateOnly.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)) return date;
        if (DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var timestamp))
            return DateOnly.FromDateTime(timestamp.DateTime);
        return null;
    }
}
