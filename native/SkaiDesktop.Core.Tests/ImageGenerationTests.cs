// Local ComfyUI image generation: queue/poll, cancellation, loopback-only endpoints
// (ComfyImageProvider).
// Uses TestSupport (Check, StubHandler, …). Run by Program.cs.

using System.Net;
using System.Text;
using SkaiDesktop.Core.Infrastructure;
using SkaiDesktop.Core.Models;
using SkaiDesktop.Core.Services;
using static TestSupport;

internal static class ImageGenerationTests
{
    public static async Task RunAsync()
    {
        var missingModelMessage = DiffusersImageProvider.SummarizeWorkerError(
            "LocalEntryNotFoundError: stabilityai/sd-turbo does not appear to have a file named model_index.json\nTraceback: private cache path\nOfflineModeIsEnabled");
        Check(missingModelMessage.Contains("not in the local model cache", StringComparison.Ordinal) &&
              missingModelMessage.Contains("Connect to the internet once", StringComparison.Ordinal) &&
              !missingModelMessage.Contains("Traceback", StringComparison.Ordinal) &&
              !missingModelMessage.Contains("private cache path", StringComparison.Ordinal),
            "offline image model misses produce concise download guidance without traceback or local paths");
        Check(DiffusersImageProvider.SummarizeWorkerError("RuntimeError: device out of memory\nTraceback: details") == "RuntimeError: device out of memory",
            "other image worker failures keep their concise first-line diagnostic");

        var comfyRequests = 0;
        var comfy = new ComfyImageProvider(new HttpClient(new StubHandler((request, _) =>
        {
            comfyRequests++;
            if (request.RequestUri!.AbsolutePath == "/prompt")
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"prompt_id\":\"local-job\"}", Encoding.UTF8, "application/json") });
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"local-job\":{\"outputs\":{\"9\":{\"images\":[{\"filename\":\"result.png\",\"subfolder\":\"\",\"type\":\"output\"}]}}}}", Encoding.UTF8, "application/json") });
        })));
        var comfyImages = await comfy.GenerateAsync("http://127.0.0.1:8188", "{\"1\":{\"inputs\":{\"text\":\"{{prompt}}\"}}}", "a \"safe\" image");
        Check(comfyRequests == 2 && comfyImages.Count == 1 && comfyImages[0].Url.AbsolutePath == "/view", "local ComfyUI image workflow queues, polls, and returns bounded output URLs");
        var cancellationRequests = new List<(string Path, string Body)>();
        using var imageCancellation = new CancellationTokenSource();
        var cancellableComfy = new ComfyImageProvider(new HttpClient(new StubHandler(async (request, cancellationToken) =>
        {
            var path = request.RequestUri!.AbsolutePath;
            var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken);
            cancellationRequests.Add((path, body));
            if (path == "/prompt")
            {
                imageCancellation.Cancel();
                return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"prompt_id\":\"local-cancel-job\"}", Encoding.UTF8, "application/json") };
            }
            return new HttpResponseMessage(HttpStatusCode.OK);
        })));
        try
        {
            await cancellableComfy.GenerateAsync("http://127.0.0.1:8188", "{\"1\":{\"inputs\":{\"text\":\"{{prompt}}\"}}}", "cancel this image", cancellationToken: imageCancellation.Token);
            throw new Exception("Expected cancelled ComfyUI generation to stop.");
        }
        catch (OperationCanceledException)
        {
            Check(cancellationRequests.Select(request => request.Path).SequenceEqual(["/prompt", "/queue", "/interrupt"]) &&
                  cancellationRequests[1].Body.Contains("local-cancel-job", StringComparison.Ordinal) &&
                  cancellationRequests[2].Body.Contains("local-cancel-job", StringComparison.Ordinal),
                "cancelling an image request removes and interrupts only its matching local ComfyUI prompt");
        }
        try { await comfy.GenerateAsync("http://example.com:8188", "{\"x\":\"{{prompt}}\"}", "no"); throw new Exception("Expected remote ComfyUI endpoint to be rejected."); }
        catch (InvalidOperationException) { Check(true, "native image provider rejects non-local ComfyUI endpoints"); }
        try
        {
            var remoteProvider = new OpenAiCompatibleProvider(new HttpClient());
            await remoteProvider.DiscoverModelsAsync("http://example.com/v1");
            throw new Exception("Expected remote HTTP model endpoint to be rejected.");
        }
        catch (InvalidOperationException)
        {
            Check(true, "native providers reject remote plain HTTP endpoints");
        }
    }
}
