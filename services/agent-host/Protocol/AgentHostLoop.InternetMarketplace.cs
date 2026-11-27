using SkaiDesktop.Core.Services;

namespace SkaiDesktop.AgentHost.Protocol;

public static partial class AgentHostLoop
{
    private static AgentResponse SearchInternetMarketplace(AgentRequest request)
    {
        var category = OptionalString(request, "category") ?? "all";
        var query = OptionalString(request, "query") ?? string.Empty;
        var page = OptionalInt(request, "page") ?? 1;
        if (page is < 1 or > 100) throw new ArgumentOutOfRangeException(nameof(page), "Marketplace pages must be between 1 and 100.");
        var result = new InternetMarketplaceService().SearchAsync(category, query, page).GetAwaiter().GetResult();
        return new(ProtocolVersion, request.Id, true, result);
    }
}
