using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using SkaiDesktop.Core.Infrastructure;
using SkaiDesktop.Core.Models;
using SkaiDesktop.Core.Services;

namespace SkaiDesktop.AgentHost.Protocol;

public static partial class AgentHostLoop
{
    private static AgentResponse SaveProject(AgentRequest request)
    {
        var name = RequiredBoundedString(request, "name", 200);
        var instructions = OptionalString(request, "instructions") ?? string.Empty;
        if (instructions.Length > 500_000 || instructions.Any(char.IsControl)) throw new InvalidOperationException("Project instructions exceed the safety limit.");
        var folderPaths = OptionalStringList(request, "folderPaths", 128, 32_768);
        var store = CreateProjectStore();
        var projects = store.Load();
        var id = OptionalString(request, "id");
        var project = string.IsNullOrWhiteSpace(id) ? new LocalProject { Name = name } : projects.SingleOrDefault(item => item.Id == id)
            ?? throw new KeyNotFoundException("The project does not exist.");
        project.Name = name;
        project.Instructions = instructions;
        project.FolderPaths = folderPaths;
        project.UpdatedAt = DateTimeOffset.UtcNow;
        if (projects.All(item => item.Id != project.Id)) projects.Add(project);
        store.Save(projects);
        return new(ProtocolVersion, request.Id, true, new { id = project.Id, name = project.Name, updatedAt = project.UpdatedAt });
    }

    private static AgentResponse ListProjectFiles(AgentRequest request)
    {
        var id = RequiredBoundedString(request, "id", 128);
        var project = CreateProjectStore().Load().SingleOrDefault(item => item.Id == id)
            ?? throw new KeyNotFoundException("The project does not exist.");
        var snapshot = WorkspaceFileContext.EnumerateTextFileBrowser(project.FolderPaths);
        var visualPreviews = WorkspaceFileContext.EnumeratePreviewableFiles(project.FolderPaths, includeText: false);
        var files = snapshot.Files.Select(file => new { relativePath = file.RelativePath, bytes = file.Bytes, kind = "text" })
            .Concat(visualPreviews.Select(file => new { relativePath = file.RelativePath, bytes = file.Bytes, kind = file.Kind }))
            .GroupBy(file => file.relativePath, OperatingSystem.IsWindows() ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal)
            .Select(group => group.First())
            .ToArray();
        return new(ProtocolVersion, request.Id, true, new
        {
            projectId = id,
            files,
            protectedFilesSkipped = snapshot.ProtectedFilesSkipped,
            excludedDirectoriesSkipped = snapshot.ExcludedDirectoriesSkipped,
            linkedPathsSkipped = snapshot.LinkedPathsSkipped,
            hitEntryLimit = snapshot.HitEntryLimit,
        });
    }

    private static AgentResponse ReadProjectFile(AgentRequest request)
    {
        var id = RequiredBoundedString(request, "id", 128);
        var relativePath = RequiredBoundedString(request, "relativePath", 512);
        var project = CreateProjectStore().Load().SingleOrDefault(item => item.Id == id)
            ?? throw new KeyNotFoundException("The project does not exist.");
        foreach (var root in project.FolderPaths)
        {
            try
            {
                var editor = new WorkspaceFileEditor();
                var content = editor.ReadText(root, relativePath);
                return new(ProtocolVersion, request.Id, true, new { projectId = id, relativePath, content, hash = editor.GetCurrentHash(root, relativePath) });
            }
            catch (FileNotFoundException) { }
            catch (DirectoryNotFoundException) { }
        }
        throw new FileNotFoundException("The selected project file is unavailable or protected.");
    }

    private static AgentResponse ReadProjectPreview(AgentRequest request)
    {
        var id = RequiredBoundedString(request, "id", 128);
        var relativePath = RequiredBoundedString(request, "relativePath", 512);
        var project = CreateProjectStore().Load().SingleOrDefault(item => item.Id == id)
            ?? throw new KeyNotFoundException("The project does not exist.");
        var (entry, bytes) = WorkspaceFileContext.ReadPreviewableFile(project.FolderPaths, relativePath);
        if (entry.Kind == "image")
        {
            var mediaType = ChatAttachmentPolicy.GetImageMediaType(entry.RelativePath);
            if (mediaType is null || !ChatAttachmentPolicy.HasValidImageSignature(mediaType, bytes))
                throw new InvalidDataException("The selected image has an unsupported or invalid file signature.");
            return new(ProtocolVersion, request.Id, true, new { projectId = id, relativePath, kind = "image", mediaType, content = Convert.ToBase64String(bytes) });
        }
        if (entry.Kind == "svg")
        {
            string content;
            try { content = new System.Text.UTF8Encoding(false, true).GetString(bytes); }
            catch (System.Text.DecoderFallbackException error) { throw new InvalidDataException("The selected SVG is not valid UTF-8 text.", error); }
            if (content.Contains('\0') || !content.Contains("<svg", StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("The selected SVG does not contain a valid SVG root.");
            return new(ProtocolVersion, request.Id, true, new { projectId = id, relativePath, kind = "svg", mediaType = "image/svg+xml", content });
        }
        if (bytes.Length <= WorkspaceFileContext.MaxInlinePdfPreviewBytes)
            return new(ProtocolVersion, request.Id, true, new { projectId = id, relativePath, kind = "pdf", mediaType = "application/pdf", content = Convert.ToBase64String(bytes) });
        var text = PdfAttachmentTextExtractor.Extract(bytes, ChatAttachmentPolicy.MaxCharactersPerFile);
        return new(ProtocolVersion, request.Id, true, new { projectId = id, relativePath, kind = "pdf", mediaType = "text/plain", content = text });
    }

    private static AgentResponse WriteProjectFile(AgentRequest request)
    {
        var id = RequiredBoundedString(request, "id", 128);
        var relativePath = RequiredBoundedString(request, "relativePath", 512);
        var content = request.Params?.TryGetProperty("content", out var contentValue) == true ? contentValue.GetString() : null;
        var expectedHash = RequiredBoundedString(request, "expectedHash", 128);
        if (content is null) throw new InvalidOperationException("project.file.write requires content.");
        var project = CreateProjectStore().Load().SingleOrDefault(item => item.Id == id) ?? throw new KeyNotFoundException("The project does not exist.");
        var root = project.FolderPaths.FirstOrDefault() ?? throw new InvalidOperationException("Select a project folder before editing a file.");
        var receipt = new WorkspaceFileEditor().Apply(root, relativePath, content, expectedHash);
        var undoId = Guid.NewGuid().ToString("N");
        var undoStore = CreateUndoStore();
        undoStore.Add(undoStore.Load(), new WorkspaceUndoEntry(undoId, DateTimeOffset.UtcNow, project.Name, root, relativePath, receipt.PreviousContent, receipt.AppliedHash));
        return new(ProtocolVersion, request.Id, true, new { undoId, hash = receipt.AppliedHash });
    }

    private static AgentResponse UndoProjectFile(AgentRequest request)
    {
        var undoId = RequiredBoundedString(request, "undoId", 128);
        var undoStore = CreateUndoStore();
        var entry = undoStore.Load().SingleOrDefault(item => item.Id == undoId) ?? throw new KeyNotFoundException("The file edit is no longer available for undo.");
        undoStore.Undo(entry, new WorkspaceFileEditor());
        undoStore.Remove(undoStore.Load(), undoId);
        return new(ProtocolVersion, request.Id, true, new { undone = true, relativePath = entry.RelativePath });
    }

    private static async Task<AgentResponse> RunProjectCommandAsync(AgentRequest request)
    {
        var id = RequiredBoundedString(request, "id", 128);
        var command = RequiredBoundedString(request, "command", WorkspaceCommandRunner.MaxCommandCharacters);
        var cwd = OptionalString(request, "relativeWorkingDirectory") ?? ".";
        var timeoutSeconds = OptionalInt(request, "timeoutSeconds") ?? 30;
        var project = CreateProjectStore().Load().SingleOrDefault(item => item.Id == id)
            ?? throw new KeyNotFoundException("The project does not exist.");
        var root = project.FolderPaths.FirstOrDefault() ?? throw new InvalidOperationException("Select a project folder before running a command.");
        var result = await new WorkspaceCommandRunner().RunAsync(root, cwd, command, TimeSpan.FromSeconds(timeoutSeconds));
        return new(ProtocolVersion, request.Id, true, new
        {
            exitCode = result.ExitCode,
            output = result.Output,
            timedOut = result.TimedOut,
            outputTruncated = result.OutputTruncated,
            workingDirectory = result.WorkingDirectory,
        });
    }

    private static AgentResponse ListProjectChecks(AgentRequest request)
    {
        var id = RequiredBoundedString(request, "id", 128);
        var project = CreateProjectStore().Load().SingleOrDefault(item => item.Id == id) ?? throw new KeyNotFoundException("The project does not exist.");
        var checks = new ProjectCheckDetector().Detect(project.FolderPaths);
        return new(ProtocolVersion, request.Id, true, new { projectId = id, checks });
    }

    private static async Task<AgentResponse> RunProjectCheckAsync(AgentRequest request)
    {
        var projectId = RequiredBoundedString(request, "projectId", 128);
        var checkId = RequiredBoundedString(request, "checkId", 128);
        var taskId = RequiredBoundedString(request, "taskId", 128);
        var project = CreateProjectStore().Load().SingleOrDefault(item => item.Id == projectId) ?? throw new KeyNotFoundException("The project does not exist.");
        var check = new ProjectCheckDetector().Detect(project.FolderPaths).SingleOrDefault(item => item.Id.Equals(checkId, StringComparison.OrdinalIgnoreCase)) ?? throw new KeyNotFoundException("The selected project check is no longer available. Refresh the detected checks.");
        var task = CreateTaskStore().Get(taskId);
        if (!string.Equals(task.ProjectId, projectId, StringComparison.Ordinal)) throw new InvalidOperationException("The selected task does not belong to this project.");
        var root = project.FolderPaths.FirstOrDefault() ?? throw new InvalidOperationException("Select a project folder before running a check.");
        var started = DateTimeOffset.UtcNow;
        var result = await new WorkspaceCommandRunner().RunAsync(root, check.RelativeWorkingDirectory, check.Command, WorkspaceCommandRunner.MaxTimeout).ConfigureAwait(false);
        var completed = DateTimeOffset.UtcNow;
        var evidence = new ProjectCheckEvidence(check.Id, check.Label, check.Command, check.RelativeWorkingDirectory, check.Source, result.ExitCode, result.Output, result.TimedOut, result.OutputTruncated, started, completed);
        var updated = CreateTaskStore().AttachVerificationEvidence(taskId, evidence);
        return new(ProtocolVersion, request.Id, true, new { projectId, taskId, check, exitCode = result.ExitCode, output = result.Output, timedOut = result.TimedOut, outputTruncated = result.OutputTruncated, startedAtUtc = started, completedAtUtc = completed, task = updated });
    }

    private static async Task<AgentResponse> StartProjectTerminalAsync(AgentRequest request)
    {
        var id = RequiredBoundedString(request, "id", 128);
        var project = CreateProjectStore().Load().SingleOrDefault(item => item.Id == id) ?? throw new KeyNotFoundException("The project does not exist.");
        var root = project.FolderPaths.FirstOrDefault() ?? throw new InvalidOperationException("Select a project folder before starting a terminal.");
        var sessionId = $"terminal-{Guid.NewGuid():N}";
        var session = new WorkspaceTerminalSession(OptionalInt(request, "columns") ?? 100, OptionalInt(request, "rows") ?? 26);
        await session.StartAsync(root, OptionalString(request, "relativeWorkingDirectory") ?? ".", cancellationToken: CancellationToken.None).ConfigureAwait(false);
        lock (TerminalSessionsGate) TerminalSessions[sessionId] = session;
        return new(ProtocolVersion, request.Id, true, new { sessionId, screen = session.ScreenText, exitCode = session.ExitCode, workingDirectory = root });
    }

    private static AgentResponse ReadProjectTerminal(AgentRequest request)
    {
        var session = GetTerminalSession(RequiredBoundedString(request, "sessionId", 128));
        return new(ProtocolVersion, request.Id, true, new { screen = session.ScreenText, exitCode = session.ExitCode });
    }

    private static async Task<AgentResponse> WriteProjectTerminalAsync(AgentRequest request)
    {
        var session = GetTerminalSession(RequiredBoundedString(request, "sessionId", 128));
        var text = RequiredTerminalText(request, "text", 16_000);
        await session.SendTextAsync(text, CancellationToken.None).ConfigureAwait(false);
        return new(ProtocolVersion, request.Id, true, new { accepted = true, screen = session.ScreenText, exitCode = session.ExitCode });
    }

    private static async Task<AgentResponse> CloseProjectTerminalAsync(AgentRequest request)
    {
        var sessionId = RequiredBoundedString(request, "sessionId", 128);
        WorkspaceTerminalSession? session;
        lock (TerminalSessionsGate) { TerminalSessions.Remove(sessionId, out session); }
        if (session is not null) await session.DisposeAsync().ConfigureAwait(false);
        return new(ProtocolVersion, request.Id, true, new { closed = true });
    }

    private static WorkspaceTerminalSession GetTerminalSession(string sessionId)
    {
        lock (TerminalSessionsGate)
        {
            if (TerminalSessions.TryGetValue(sessionId, out var session)) return session;
        }
        throw new KeyNotFoundException("The terminal session does not exist or has expired.");
    }

    private static async Task DisposeTerminalSessionsAsync()
    {
        WorkspaceTerminalSession[] sessions;
        lock (TerminalSessionsGate) { sessions = TerminalSessions.Values.ToArray(); TerminalSessions.Clear(); }
        foreach (var session in sessions) await session.DisposeAsync().ConfigureAwait(false);
    }

    private static async Task<AgentResponse> GetProjectGitStatusAsync(AgentRequest request)
    {
        var id = RequiredBoundedString(request, "id", 128);
        var project = CreateProjectStore().Load().SingleOrDefault(item => item.Id == id)
            ?? throw new KeyNotFoundException("The project does not exist.");
        var root = project.FolderPaths.FirstOrDefault()
            ?? throw new InvalidOperationException("Select a project folder before reading Git status.");
        var status = await new GitHubWorkspaceService().GetLocalStatusAsync(root, CancellationToken.None).ConfigureAwait(false);
        return new(ProtocolVersion, request.Id, true, new
        {
            branch = status.Branch,
            repository = status.Repository,
            commitsAhead = status.CommitsAhead,
            commitsBehind = status.CommitsBehind,
            hasConflicts = GitHubWorkspaceService.HasConflicts(status.Changes),
            changes = status.Changes.Select(change => new { status = change.Status, path = change.Path, originalPath = change.OriginalPath }).ToArray(),
        });
    }

    private static async Task<AgentResponse> GetProjectGitDiffAsync(AgentRequest request)
    {
        var (project, root, changes) = await ResolveProjectGitSelectionAsync(request).ConfigureAwait(false);
        var preview = await new GitHubWorkspaceService().GetDiffPreviewAsync(root, changes, CancellationToken.None).ConfigureAwait(false);
        return new(ProtocolVersion, request.Id, true, new { repository = project.Name, text = preview.Text, includedFiles = preview.IncludedFiles, redactedFiles = preview.RedactedFiles, truncated = preview.IsTruncated });
    }

    private static async Task<AgentResponse> CommitProjectGitChangesAsync(AgentRequest request)
    {
        var (project, root, changes) = await ResolveProjectGitSelectionAsync(request).ConfigureAwait(false);
        var message = RequiredBoundedString(request, "message", 256);
        var commit = await new GitHubWorkspaceService().CommitSelectedLocallyAsync(root, changes, message, CancellationToken.None).ConfigureAwait(false);
        return new(ProtocolVersion, request.Id, true, new { repository = project.Name, committed = true, output = commit });
    }

    private static async Task<AgentResponse> PushProjectGitAsync(AgentRequest request)
    {
        var id = RequiredBoundedString(request, "id", 128);
        var project = CreateProjectStore().Load().SingleOrDefault(item => item.Id == id) ?? throw new KeyNotFoundException("The project does not exist.");
        var root = project.FolderPaths.FirstOrDefault() ?? throw new InvalidOperationException("Select a project folder before pushing.");
        var output = await new GitHubWorkspaceService().PushLocalAsync(root, CancellationToken.None).ConfigureAwait(false);
        return new(ProtocolVersion, request.Id, true, new { repository = project.Name, pushed = true, output });
    }

    private static async Task<AgentResponse> CreateProjectPullRequestAsync(AgentRequest request)
    {
        var id = RequiredBoundedString(request, "id", 128);
        var project = CreateProjectStore().Load().SingleOrDefault(item => item.Id == id)
            ?? throw new KeyNotFoundException("The project does not exist.");
        var root = project.FolderPaths.FirstOrDefault()
            ?? throw new InvalidOperationException("Select a project folder before creating a pull request.");
        var title = RequiredBoundedString(request, "title", 256);
        var body = OptionalString(request, "body") ?? string.Empty;
        var output = await new GitHubWorkspaceService().CreatePullRequestAsync(root, title, body, CancellationToken.None).ConfigureAwait(false);
        return new(ProtocolVersion, request.Id, true, new { repository = project.Name, created = true, output });
    }

    private static async Task<(LocalProject Project, string Root, IReadOnlyList<GitWorkspaceFileChange> Changes)> ResolveProjectGitSelectionAsync(AgentRequest request)
    {
        var id = RequiredBoundedString(request, "id", 128);
        var project = CreateProjectStore().Load().SingleOrDefault(item => item.Id == id)
            ?? throw new KeyNotFoundException("The project does not exist.");
        var root = project.FolderPaths.FirstOrDefault()
            ?? throw new InvalidOperationException("Select a project folder before using Git review.");
        var status = await new GitHubWorkspaceService().GetLocalStatusAsync(root, CancellationToken.None).ConfigureAwait(false);
        if (request.Params is not { } parameters || !parameters.TryGetProperty("paths", out var paths) || paths.ValueKind != JsonValueKind.Array)
            throw new InvalidOperationException("Git review requires a paths array.");
        var selectedPaths = paths.EnumerateArray().Select(path => path.GetString()).Where(path => !string.IsNullOrWhiteSpace(path)).Cast<string>().Distinct(StringComparer.Ordinal).ToHashSet(StringComparer.Ordinal);
        if (selectedPaths.Count == 0 || selectedPaths.Count > 24) throw new InvalidOperationException("Select between 1 and 24 changed files for Git review.");
        var selected = status.Changes.Where(change => selectedPaths.Contains(change.Path) || change.OriginalPath is not null && selectedPaths.Contains(change.OriginalPath)).ToArray();
        if (selected.Length != selectedPaths.Count) throw new InvalidOperationException("The workspace changed since review. Refresh Git status and select the current files again.");
        return (project, root, selected);
    }

}
