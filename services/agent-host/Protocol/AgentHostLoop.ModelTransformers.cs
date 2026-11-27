using SkaiDesktop.Core.Services;

namespace SkaiDesktop.AgentHost.Protocol;

public static partial class AgentHostLoop
{
    private static AgentResponse ListModelTransformers(AgentRequest request) => new(
        ProtocolVersion,
        request.Id,
        true,
        new { adapters = ModelTransformationService.List() });

    private static AgentResponse PlanModelTransformation(AgentRequest request)
    {
        var adapter = RequiredBoundedString(request, "adapterId", 128);
        var modelPath = RequiredBoundedString(request, "modelPath", 4_000);
        var outputPath = RequiredBoundedString(request, "outputPath", 4_000);
        return new(ProtocolVersion, request.Id, true, ModelTransformationService.Plan(adapter, modelPath, outputPath));
    }

    private static AgentResponse StartModelTransformation(AgentRequest request)
    {
        var adapter = RequiredBoundedString(request, "adapterId", 128);
        var modelPath = RequiredBoundedString(request, "modelPath", 4_000);
        var outputPath = RequiredBoundedString(request, "outputPath", 4_000);
        var confirmed = OptionalBoolean(request, "confirm");
        return new(ProtocolVersion, request.Id, true, ModelTransformationService.Start(adapter, modelPath, outputPath, confirmed));
    }

    private static AgentResponse GetModelTransformationStatus(AgentRequest request)
    {
        var id = RequiredBoundedString(request, "id", 128);
        var status = ModelTransformationService.GetStatus(id) ?? throw new InvalidOperationException("Model transformation run was not found.");
        return new(ProtocolVersion, request.Id, true, status);
    }

    private static AgentResponse CancelModelTransformation(AgentRequest request)
    {
        var id = RequiredBoundedString(request, "id", 128);
        var status = ModelTransformationService.Cancel(id) ?? throw new InvalidOperationException("Model transformation run was not found.");
        return new(ProtocolVersion, request.Id, true, status);
    }
}
