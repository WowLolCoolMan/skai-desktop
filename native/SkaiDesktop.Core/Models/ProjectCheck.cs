namespace SkaiDesktop.Core.Models;

/// <summary>A check detected from a selected project. Detection never executes it.</summary>
public sealed record ProjectCheck(string Id, string Label, string Command, string RelativeWorkingDirectory, string Source);

/// <summary>Evidence from one explicit, user-triggered project check.</summary>
public sealed record ProjectCheckEvidence(
    string CheckId,
    string CheckLabel,
    string Command,
    string RelativeWorkingDirectory,
    string Source,
    int ExitCode,
    string Output,
    bool TimedOut,
    bool OutputTruncated,
    DateTimeOffset StartedAtUtc,
    DateTimeOffset CompletedAtUtc);
