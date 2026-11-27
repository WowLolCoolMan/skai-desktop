using System.Runtime.InteropServices;
using SkaiDesktop.Core.Infrastructure;
using SkaiDesktop.Core.Models;

namespace SkaiDesktop.AgentHost.Protocol;

public static partial class AgentHostLoop
{
    private static AgentResponse GetSecurityOverview(AgentRequest request)
    {
        var projects = CreateProjectStore().Load();
        var journal = CreateTaskOperationJournal().Load();
        var runs = journal.Runs.ToDictionary(run => run.RunId, StringComparer.Ordinal);
        var audit = journal.Events
            .Where(item => item.Type.StartsWith("permission.", StringComparison.Ordinal))
            .OrderByDescending(item => item.TimestampUtc)
            .ThenByDescending(item => item.Sequence)
            .Take(100)
            .Select(item => new
            {
                eventId = item.EventId,
                type = item.Type,
                actor = item.Actor,
                timestamp = item.TimestampUtc,
                runId = item.RunId,
                projectId = runs.TryGetValue(item.RunId, out var run) && projects.Any(project => project.Id == run.WorkspaceId) ? run.WorkspaceId : null,
                payload = item.Payload,
            })
            .ToArray();

        var platform = OperatingSystem.IsWindows() ? "Windows" : OperatingSystem.IsLinux() ? "Linux" : RuntimeInformation.OSDescription;
        var sandbox = OperatingSystem.IsWindows()
            ? "Coding Agent commands use a Windows Process Security Environment: the selected project is writable, runtime paths are read-only, network access is denied, and a Job Object bounds process count, CPU, and memory. This applies to Coding Agent commands and checks; SSH commands run on the remote host."
            : OperatingSystem.IsLinux()
                ? "Coding Agent commands require Bubblewrap and systemd cgroups: the selected project is writable, system paths are read-only, temporary files are isolated, network access is disabled, and process count, CPU, and memory are bounded. Commands fail closed if Skai cannot establish this sandbox. SSH commands run on the remote host."
                : "Coding Agent shell commands are disabled on this platform because Skai cannot establish its required operating-system sandbox. SSH commands run on the remote host.";

        return new(ProtocolVersion, request.Id, true, new
        {
            platform,
            sandbox,
            projects = projects.OrderBy(project => project.Name, StringComparer.OrdinalIgnoreCase).Select(project => new
            {
                id = project.Id,
                name = project.Name,
                folderPaths = project.FolderPaths,
                scope = "Project-level local folder roots. File reads can use all selected roots; saves, Coding Agent commands, and the integrated terminal use the first selected root.",
                duration = "Until the folder is removed or access is revoked.",
            }).ToArray(),
            audit,
            grants = new[]
            {
                new { area = "Project folders", scope = "Selected folder roots only", duration = "Project-level until revoked", behavior = "File reads use selected roots; saves, Coding Agent commands, and the integrated terminal use the first selected root." },
                new { area = "Project Git", scope = "Selected project repository", duration = "One explicit Git action", behavior = "Review, commit, push, and pull-request actions are recorded without saving commit text or command input in permission history." },
                new { area = "MCP tools", scope = "One connected server and one named tool call", duration = "Single call", behavior = "Every call requires an explicit review; read and write capabilities are checked separately." },
                new { area = "Coding task", scope = "One reviewed task", duration = "Task run", behavior = "A task can use only the project and tools shown for that run; connected MCP calls still prompt separately." },
                new { area = "Scheduled tasks", scope = "Configured chat model prompt only", duration = "One scheduled run", behavior = "Scheduled prompts have no project files, shell, MCP tools, or automatic project writes." },
                new { area = "Global tool grants", scope = "None", duration = "Not available", behavior = "No reusable global MCP grant or unattended high-risk tool policy is enabled." },
            },
            limits = new
            {
                codingActionsPerTask = MaxCodingActions,
                commandsPerTask = MaxCodingCommands,
                commandTimeoutSeconds = (int)WorkspaceCommandRunner.MaxTimeout.TotalSeconds,
                commandCharacters = WorkspaceCommandRunner.MaxCommandCharacters,
                commandOutputCharacters = WorkspaceCommandRunner.MaxOutputCharacters,
                editableFileCharacters = WorkspaceFileEditor.MaxCharacters,
                diskGrowthBytes = (long?)null,
                diskGrowthEnforced = false,
            },
            auditStorage = "Permission events are appended to the local operation journal. Permission-event records contain action metadata and resource paths; they omit file contents, tool arguments, and raw command text.",
        });
    }

    private static AgentResponse RevokeProjectAccess(AgentRequest request)
    {
        var id = RequiredBoundedString(request, "id", 128);
        LocalProject project;
        string[] revoked;
        Task[] activeOperations;
        WorkspaceTerminalSession[] terminals;
        lock (ProjectAccessGate)
        {
            var projects = CreateProjectStore().Load();
            project = projects.SingleOrDefault(item => item.Id == id) ?? throw new KeyNotFoundException("The project does not exist.");
            revoked = project.FolderPaths.ToArray();
            if (revoked.Length > 0)
            {
                project.FolderPaths = [];
                project.UpdatedAt = DateTimeOffset.UtcNow;
                CreateProjectStore().Save(projects);
            }

            var operationRecords = ProjectAccessOperations.Where(pair => pair.Value.ProjectId == project.Id).Select(pair => pair.Value).ToArray();
            activeOperations = operationRecords.Select(item => item.Operation).ToArray();
            foreach (var operation in operationRecords) operation.Cancellation.Cancel();

            lock (TerminalSessionsGate)
            {
                var sessionIds = TerminalSessionProjects.Where(pair => pair.Value == project.Id).Select(pair => pair.Key).ToArray();
                terminals = sessionIds.Select(sessionId => TerminalSessions.Remove(sessionId, out var session) ? session : null).Where(session => session is not null).Cast<WorkspaceTerminalSession>().ToArray();
                foreach (var sessionId in sessionIds) TerminalSessionProjects.Remove(sessionId);
            }
        }
        ActiveTaskExecution[] activeTasks;
        lock (ActiveTaskExecutionsGate)
        {
            var taskIds = CreateTaskStore().Load().Where(task => task.ProjectId == project.Id).Select(task => task.Id).ToHashSet(StringComparer.Ordinal);
            activeTasks = ActiveTaskExecutions.Where(pair => taskIds.Contains(pair.Key)).Select(pair => pair.Value).ToArray();
            foreach (var active in activeTasks) active.Cancellation.Cancel();
        }
        foreach (var active in activeTasks)
            try { active.Task.GetAwaiter().GetResult(); }
            catch (OperationCanceledException) { }
            catch (Exception) { }
        foreach (var operation in activeOperations)
            try { operation.GetAwaiter().GetResult(); }
            catch (OperationCanceledException) { }
            catch (Exception) { }
        foreach (var session in terminals)
            try { session.DisposeAsync().AsTask().GetAwaiter().GetResult(); }
            catch (Exception) { }

        foreach (var folder in revoked)
            AppendPermissionAuditEvent(project.Id, project.Name, "permission.project.folder.revoked", new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["resource"] = folder,
                ["scope"] = "project-level",
                ["duration"] = "revoked",
            });
        return new(ProtocolVersion, request.Id, true, new { projectId = id, projectName = project.Name, revoked = revoked.Length, stoppedTasks = activeTasks.Length, stoppedOperations = activeOperations.Length, closedTerminals = terminals.Length, folderPaths = revoked });
    }
}
