using System.Net;
using SkaiDesktop.Core.Services;
using static TestSupport;

internal static class LocalRuntimeCapacityTests
{
    public static async Task RunAsync()
    {
        var probe = new LocalRuntimeCapacityProbe(new HttpClient(new StubHandler((request, _) =>
        {
            Check(request.RequestUri?.AbsolutePath == "/api/ps", "loaded-model probe uses Ollama's local process endpoint");
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{\"models\":[{\"name\":\"qwen:32b\",\"size\":34359738368,\"size_vram\":17179869184},{\"model\":\"small\",\"size\":4294967296}]}")
            });
        })));
        var loaded = await probe.ReadOllamaLoadedModelsAsync("http://127.0.0.1:11434/v1");
        Check(loaded.Known && loaded.Models.Count == 2, "Ollama loaded-model telemetry parses bounded model entries");
        Check(loaded.Models[0].RamBytes == 34359738368 && loaded.Models[0].GpuBytes == 17179869184, "loaded-model telemetry preserves reported RAM and VRAM sizes");

        var remote = await probe.ReadOllamaLoadedModelsAsync("https://models.example.test/v1");
        Check(!remote.Known && remote.Models.Count == 0, "loaded-model telemetry refuses non-local endpoints");
    }
}
