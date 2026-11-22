using System.Text.Json;

namespace SkaiDesktop.AgentHost.Protocol;

public static partial class AgentHostLoop
{
    private sealed class ModelPullOperation(string id, string model, CancellationTokenSource cancellation)
    {
        private readonly object gate = new();
        public string Id { get; } = id;
        public string Model { get; } = model;
        public CancellationTokenSource Cancellation { get; } = cancellation;
        public string State { get; private set; } = "running";
        public string? Error { get; private set; }
        public List<string> Progress { get; } = [];
        public void AddProgress(string? message) { if (!string.IsNullOrWhiteSpace(message)) lock (gate) { if (Progress.Count < 64) Progress.Add(message[..Math.Min(message.Length, 240)]); } }
        public void Complete() { lock (gate) State = "completed"; }
        public void Cancelled() { lock (gate) State = "cancelled"; }
        public void Fail(string message) { lock (gate) { State = "failed"; Error = string.IsNullOrWhiteSpace(message) ? "Local model download failed." : message[..Math.Min(message.Length, 400)]; } }
    }

    private sealed class AirLlmInstallOperation(string id, CancellationTokenSource cancellation)
    {
        private readonly object gate = new();
        public string Id { get; } = id;
        public CancellationTokenSource Cancellation { get; } = cancellation;
        public string State { get; private set; } = "running";
        public string? Error { get; private set; }
        public List<string> Progress { get; } = [];
        public void AddProgress(string? message) { if (!string.IsNullOrWhiteSpace(message)) lock (gate) { if (Progress.Count < 96) Progress.Add(message[..Math.Min(message.Length, 240)]); } }
        public void Complete() { lock (gate) State = "completed"; }
        public void Cancelled() { lock (gate) State = "cancelled"; }
        public void Fail(string message) { lock (gate) { State = "failed"; Error = string.IsNullOrWhiteSpace(message) ? "AirLLM setup failed." : message[..Math.Min(message.Length, 400)]; } }
    }

    private sealed class ImageRuntimeInstallOperation(string id, CancellationTokenSource cancellation)
    {
        private readonly object gate = new();
        public string Id { get; } = id;
        public CancellationTokenSource Cancellation { get; } = cancellation;
        public string State { get; private set; } = "running";
        public string? Error { get; private set; }
        public List<string> Progress { get; } = [];
        public void AddProgress(string? message) { if (!string.IsNullOrWhiteSpace(message)) lock (gate) { if (Progress.Count < 96) Progress.Add(message[..Math.Min(message.Length, 240)]); } }
        public void Complete() { lock (gate) State = "completed"; }
        public void Cancelled() { lock (gate) State = "cancelled"; }
        public void Fail(string message) { lock (gate) { State = "failed"; Error = string.IsNullOrWhiteSpace(message) ? "Image runtime setup failed." : message[..Math.Min(message.Length, 400)]; } }
    }

    private sealed class ImageGenerationOperation(string id, CancellationTokenSource cancellation)
    {
        private readonly object gate = new();
        private readonly List<string> progress = [];
        public string Id { get; } = id;
        public CancellationTokenSource Cancellation { get; } = cancellation;
        public string State { get; private set; } = "running";
        public string? Error { get; private set; }
        public object? Images { get; private set; }
        public IReadOnlyList<string> Progress { get { lock (gate) return progress.ToArray(); } }
        public void AddProgress(string message) { if (string.IsNullOrWhiteSpace(message)) return; lock (gate) { if (progress.Count < 120) progress.Add(message.Length > 400 ? message[..400] : message); } }
        public void Complete(object? result) { lock (gate) { if (State != "running") return; var element = JsonSerializer.SerializeToElement(result); Images = element.TryGetProperty("images", out var images) ? images : result; State = "completed"; } }
        public void Cancelled() { lock (gate) { if (State == "running") State = "cancelled"; } }
        public void Fail(string message) { lock (gate) { if (State != "running") return; State = "failed"; Error = string.IsNullOrWhiteSpace(message) ? "Image generation failed." : message[..Math.Min(message.Length, 400)]; } }
    }

    private sealed class MarketplaceDownloadOperation(string id, string source, string repository, CancellationTokenSource cancellation)
    {
        private readonly object gate = new();
        public string Id { get; } = id;
        public string Source { get; } = source;
        public string Repository { get; } = repository;
        public CancellationTokenSource Cancellation { get; } = cancellation;
        public string State { get; private set; } = "running";
        public string? Error { get; private set; }
        public List<string> Progress { get; } = [];
        public void AddProgress(string? message) { if (!string.IsNullOrWhiteSpace(message)) lock (gate) { if (Progress.Count < 128) Progress.Add(message[..Math.Min(message.Length, 240)]); } }
        public void Complete() { lock (gate) State = "completed"; }
        public void Cancelled() { lock (gate) State = "cancelled"; }
        public void Fail(string message) { lock (gate) { State = "failed"; Error = string.IsNullOrWhiteSpace(message) ? "Marketplace model download failed." : message[..Math.Min(message.Length, 400)]; } }
    }


}