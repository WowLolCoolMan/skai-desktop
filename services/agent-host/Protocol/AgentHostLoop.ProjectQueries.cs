using SkaiDesktop.Core.Models;
using SkaiDesktop.Core.Services;

namespace SkaiDesktop.AgentHost.Protocol;

public static partial class AgentHostLoop
{
    private static AgentResponse ListProjects(AgentRequest request)
    {
        var projects = CreateProjectStore().Load()
            .OrderByDescending(project => project.UpdatedAt)
            .Select(project => new
            {
                id = project.Id,
                name = project.Name,
                instructions = project.Instructions,
                folderPaths = project.FolderPaths,
                gitHubRepository = project.GitHubRepository,
                updatedAt = project.UpdatedAt,
            })
            .ToArray();
        return new(ProtocolVersion, request.Id, true, projects);
    }

    private static AgentResponse RunProjectPreflight(AgentRequest request)
    {
        var id = RequiredBoundedString(request, "id", 128);
        var project = CreateProjectStore().Load().SingleOrDefault(item => item.Id == id)
            ?? throw new InvalidOperationException("The selected local project is no longer available.");
        var report = new ProjectPreflightService().Inspect(project.FolderPaths);
        return new(ProtocolVersion, request.Id, true, new
        {
            projectId = project.Id,
            projectName = project.Name,
            inspectedAt = DateTimeOffset.UtcNow,
            manifests = report.Manifests,
            runtimes = report.Runtimes,
            suggestedChecks = report.SuggestedChecks,
            executionNote = "Read-only scan only. Suggested checks have not been run; choose and review a command explicitly before execution."
        });
    }
}
