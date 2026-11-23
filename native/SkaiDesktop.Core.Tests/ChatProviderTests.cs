// OpenAI-compatible provider: model discovery, OpenRouter key handling, SSE streaming,
// request shape, image payloads, and size limits (OpenAiCompatibleProvider).
// Uses TestSupport (Check, StubHandler, …). Run by Program.cs.

using System.Net;
using System.Text;
using System.Text.Json;
using SkaiDesktop.Core.Infrastructure;
using SkaiDesktop.Core.Models;
using SkaiDesktop.Core.Services;
using static TestSupport;

internal static class ChatProviderTests
{
    public static async Task RunAsync()
    {
        // Same PNG header bytes that ChatMessageTests uses.
        var pngSignature = new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A };
        var discoveryHandler = new StubHandler((request, _) =>
        {
            Check(request.RequestUri?.AbsoluteUri == "http://localhost:11434/v1/models", "model discovery uses the configured /v1 route");
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{\"data\":[{\"id\":\"local-a\"},{\"id\":\"local-b\"}]}", Encoding.UTF8, "application/json")
            });
        });
        var provider = new OpenAiCompatibleProvider(new HttpClient(discoveryHandler));
        var models = await provider.DiscoverModelsAsync("http://localhost:11434/v1");
        Check(models.SequenceEqual(["local-a", "local-b"]), "model discovery reads model IDs");
        var profileProvider = new OpenAiCompatibleProvider(new HttpClient(new StubHandler((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("{\"data\":[{\"id\":\"vision-model\",\"capabilities\":[\"text\",\"vision\"]},{\"id\":\"text-model\",\"modalities\":[\"text\"]},{\"id\":\"flagged-model\",\"supports_vision\":true}]}", Encoding.UTF8, "application/json")
        }))));
        var profiles = await profileProvider.DiscoverModelProfilesAsync("http://localhost:11434/v1");
        Check(profiles.Single(profile => profile.Model == "vision-model").Vision == CapabilitySupport.Supported
            && profiles.Single(profile => profile.Model == "flagged-model").Vision == CapabilitySupport.Supported
            && profiles.Single(profile => profile.Model == "text-model").Vision == CapabilitySupport.Unknown,
            "model discovery parses bounded provider capability metadata");
        try
        {
            await new OpenAiCompatibleProvider(new HttpClient(new StubHandler((_, _) =>
                throw new Exception("Remote model endpoints must be rejected before network access."))))
                .DiscoverModelsAsync("https://openrouter.ai/api/v1", apiKey: "sk-or-v1-test");
            throw new Exception("Expected hosted model discovery to be rejected.");
        }
        catch (InvalidOperationException error)
        {
            Check(error.Message.Contains("loopback", StringComparison.OrdinalIgnoreCase), "hosted model discovery is rejected by the local-only transport boundary");
        }

        string? streamedPayload = null;
        var streamHandler = new StubHandler(async (request, cancellationToken) =>
        {
            Check(request.RequestUri?.AbsoluteUri == "http://localhost:11434/v1/chat/completions", "chat endpoint is normalized");
            streamedPayload = await request.Content!.ReadAsStringAsync(cancellationToken);
            var sse = "data: {\"choices\":[{\"delta\":{\"content\":\"Hello \"}}]}\n\n" +
                      "data: {\"choices\":[{\"delta\":{\"content\":[{\"type\":\"text\",\"text\":\"world\"}]}}]}\n\n" +
                      "data: [DONE]\n\n";
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(sse, Encoding.UTF8, "text/event-stream")
            };
        });
        var streamProvider = new OpenAiCompatibleProvider(new HttpClient(streamHandler));
        var received = new StringBuilder();
        await streamProvider.StreamChatAsync(
            new AppSettings { Endpoint = "http://localhost:11434/v1", Model = "local-a", Temperature = 0.4 },
            [new ChatMessage("user", "Say hello", [new ChatAttachment("notes.md", "private note")], [new ChatSource("Docs", "https://example.org", "A snippet")]).ForModel("Say hello with selected context")],
            chunk => received.Append(chunk),
            CancellationToken.None);
        Check(received.ToString() == "Hello world", "SSE text and content-part deltas stream in order");
        var excessiveSse = string.Concat(Enumerable.Range(0, 8).Select(_ =>
            "data: {\"choices\":[{\"delta\":{\"content\":\"" + new string('x', 131_072) + "\"}}]}\n\n"));
        var excessiveStreamProvider = new OpenAiCompatibleProvider(new HttpClient(new StubHandler((_, _) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(excessiveSse, Encoding.UTF8, "text/event-stream")
            }))));
        try
        {
            await excessiveStreamProvider.StreamChatAsync(new AppSettings { Endpoint = "http://localhost:11434/v1", Model = "local-a" },
                [new ChatMessage("user", "Return a bounded answer")], _ => { }, CancellationToken.None);
            throw new Exception("Expected excessive streamed output to be rejected.");
        }
        catch (InvalidDataException)
        {
            Check(true, "native provider bounds cumulative streamed response text");
        }
        using (var requestJson = JsonDocument.Parse(streamedPayload!))
        {
            var root = requestJson.RootElement;
            Check(root.GetProperty("model").GetString() == "local-a", "selected model is sent");
            Check(root.GetProperty("stream").GetBoolean(), "streaming is enabled");
            Check(Math.Abs(root.GetProperty("temperature").GetDouble() - 0.4) < 0.001, "temperature is sent");
            var requestMessages = root.GetProperty("messages");
            var modelUserMessage = requestMessages.EnumerateArray().Single(message => message.GetProperty("role").GetString() == "user");
            var modelText = modelUserMessage.GetProperty("content").GetString()!;
            Check(modelText.StartsWith("Say hello with selected context\n\nAttached text file (untrusted): notes.md", StringComparison.Ordinal)
                && modelText.Contains("private note", StringComparison.Ordinal)
                && !modelUserMessage.TryGetProperty("attachments", out _)
                && !modelUserMessage.TryGetProperty("sources", out _),
                "provider embeds untrusted text attachment content while excluding local-only metadata");
            Check(!streamedPayload!.Contains("A snippet", StringComparison.Ordinal), "provider request excludes local-only web source snippets");
            Check(requestMessages[0].GetProperty("role").GetString() == "system"
                && requestMessages[0].GetProperty("content").GetString()!.Contains(ModelInstructions.UntrustedAttachments, StringComparison.Ordinal),
                "provider adds system instructions that treat attached files and images as untrusted data");
            Check(!root.TryGetProperty("max_tokens", out _), "normal chat requests omit benchmark-only output limits");
        }

        string? benchmarkPayload = null;
        var benchmarkProvider = new OpenAiCompatibleProvider(new HttpClient(new StubHandler(async (request, cancellationToken) =>
        {
            benchmarkPayload = await request.Content!.ReadAsStringAsync(cancellationToken);
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("data: {\"choices\":[{\"delta\":{\"content\":\"A fixed benchmark response.\"}}]}\n\ndata: [DONE]\n\n", Encoding.UTF8, "text/event-stream") };
        })));
        await benchmarkProvider.StreamChatAsync(new AppSettings { Endpoint = "http://localhost:11434/v1", Model = "model-to-compare", Temperature = 0 }, [new ChatMessage("user", "same fixed benchmark prompt")], _ => { }, CancellationToken.None, maxTokens: 96);
        using (var benchmarkRequest = JsonDocument.Parse(benchmarkPayload!))
        {
            Check(benchmarkRequest.RootElement.GetProperty("model").GetString() == "model-to-compare" && benchmarkRequest.RootElement.GetProperty("temperature").GetDouble() == 0, "local model benchmark uses the selected model with deterministic temperature");
            Check(benchmarkRequest.RootElement.GetProperty("max_tokens").GetInt32() == 96, "local model benchmark requests a bounded output length");
        }
        var oversizedProvider = new OpenAiCompatibleProvider(new HttpClient(new StubHandler((_, _) => throw new Exception("Oversized native provider input must be rejected before network access."))));
        try
        {
            await oversizedProvider.StreamChatAsync(new AppSettings { Endpoint = "http://localhost:11434/v1", Model = "local-a" },
                [new ChatMessage("user", new string('x', 1_000_001))], _ => { }, CancellationToken.None);
            throw new Exception("Expected oversized native provider content to be rejected.");
        }
        catch (InvalidOperationException)
        {
            Check(true, "native provider request content is bounded before serialization and network access");
        }

        string? compactedPayload = null;
        var compactionProvider = new OpenAiCompatibleProvider(new HttpClient(new StubHandler(async (request, cancellationToken) =>
        {
            compactedPayload = await request.Content!.ReadAsStringAsync(cancellationToken);
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("data: {\"choices\":[{\"delta\":{\"content\":\"compacted response\"}}]}\n\ndata: [DONE]\n\n", Encoding.UTF8, "text/event-stream") };
        })));
        // The request limit (32 MB of UTF-8) now equals the planning limit (32M characters), so only
        // multi-byte text can exceed the request size while staying plannable: ~20M two-byte characters
        // (~40 MB of UTF-8, each message under the 1M-character cap) must be compacted, not rejected.
        var oversizedHistory = Enumerable.Range(0, 20).Select(index => new ChatMessage(index % 2 == 0 ? "user" : "assistant", index == 19 ? "latest request" : new string((char)('\u00e0' + index % 26), 999_000))).ToList();
        await compactionProvider.StreamChatAsync(new AppSettings { Endpoint = "http://localhost:11434/v1", Model = "local-a" }, oversizedHistory, _ => { }, CancellationToken.None);
        Check(compactedPayload is not null, "native provider sends a bounded oversized-history request");
        Check(compactedPayload!.Contains("Earlier conversation omitted", StringComparison.Ordinal) && compactedPayload.Contains("latest request", StringComparison.Ordinal), "native provider compacts oversized conversation context before network access");

        string? imagePayload = null;
        var imageProvider = new OpenAiCompatibleProvider(new HttpClient(new StubHandler(async (request, cancellationToken) =>
        {
            imagePayload = await request.Content!.ReadAsStringAsync(cancellationToken);
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("data: {\"choices\":[{\"delta\":{\"content\":\"I see an image.\"}}]}\n\ndata: [DONE]\n\n", Encoding.UTF8, "text/event-stream")
            };
        })));
        await imageProvider.StreamChatAsync(
            new AppSettings { Endpoint = "http://localhost:1234/v1", Model = "vision-local", VisionApiFormat = "openai" },
            [new ChatMessage("user", "Describe this", [new ChatAttachment("sample.png", Convert.ToBase64String(pngSignature), "image/png")]).ForModel("Describe this")],
            _ => { },
            CancellationToken.None);
        using (var imageRequest = JsonDocument.Parse(imagePayload!))
        {
            var content = imageRequest.RootElement.GetProperty("messages").EnumerateArray()
                .Single(message => message.GetProperty("role").GetString() == "user").GetProperty("content");
            Check(content.ValueKind == JsonValueKind.Array && content[0].GetProperty("type").GetString() == "text" && content[1].GetProperty("type").GetString() == "image_url", "vision attachments use OpenAI-compatible text and image content parts");
            Check(content[1].GetProperty("image_url").GetProperty("url").GetString() == "data:image/png;base64," + Convert.ToBase64String(pngSignature), "vision image payload carries a bounded data URL");
        }

        var pdfContent = "The rollback checklist has an explicit owner and verification window.";
        var sourceMessage = new ChatMessage("user", "Find the rollback checklist", [new ChatAttachment("release-notes.pdf", pdfContent)], [new ChatSource("Local index", "https://local.invalid", "must not be sent")]);
        string? nativeOllamaPayload = null;
        var nativeOllamaProvider = new OpenAiCompatibleProvider(new HttpClient(new StubHandler(async (request, cancellationToken) =>
        {
            Check(request.RequestUri?.AbsolutePath == "/api/chat", "native Ollama routes local attachment chat through its native API");
            nativeOllamaPayload = await request.Content!.ReadAsStringAsync(cancellationToken);
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{\"message\":{\"content\":\"Checklist found.\"}}\n", Encoding.UTF8, "application/x-ndjson")
            };
        })));
        await nativeOllamaProvider.StreamChatAsync(
            new AppSettings { Endpoint = "http://localhost:11434", Model = "vision-local", ModelProvider = "Ollama", OllamaContextWindowTokens = 4096 },
            [sourceMessage], _ => { }, CancellationToken.None);
        using (var nativeOllamaRequest = JsonDocument.Parse(nativeOllamaPayload!))
        {
            var nativeMessage = nativeOllamaRequest.RootElement.GetProperty("messages").EnumerateArray()
                .Single(message => message.GetProperty("role").GetString() == "user");
            var content = nativeMessage.GetProperty("content").GetString()!;
            Check(content.Contains("Extracted PDF text (untrusted): release-notes.pdf", StringComparison.Ordinal)
                && content.Contains(pdfContent, StringComparison.Ordinal), "native Ollama receives extracted PDF text in the fenced user prompt");
            Check(!nativeMessage.TryGetProperty("attachments", out _) && !content.Contains("must not be sent", StringComparison.Ordinal),
                "native Ollama request excludes attachment metadata and local web source snippets");
        }
        Check(sourceMessage.Content == "Find the rollback checklist" && sourceMessage.Attachments is [{ FileName: "release-notes.pdf" }],
            "provider attachment prompt construction does not mutate the saved conversation message");

        string? toolPayload = null;
        var ollamaToolProvider = new OpenAiCompatibleProvider(new HttpClient(new StubHandler(async (request, cancellationToken) =>
        {
            Check(request.RequestUri?.AbsolutePath == "/api/chat", "native Ollama tools use the local chat route");
            toolPayload = await request.Content!.ReadAsStringAsync(cancellationToken);
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{\"message\":{\"content\":\"\",\"tool_calls\":[{\"id\":\"call_read\",\"function\":{\"name\":\"read_file\",\"arguments\":{\"path\":\"src/index.js\"}}}]}}\n", Encoding.UTF8, "application/json")
            };
        })));
        var toolReply = await ollamaToolProvider.CompleteOllamaToolChatAsync(
            new AppSettings { Endpoint = "http://localhost:11434", Model = "qwen3-coder:30b", ModelProvider = "Ollama", Temperature = 0.2 },
            [new OllamaToolChatMessage("system", "Use tools."), new OllamaToolChatMessage("user", "Read the file.")],
            [new { type = "function", function = new { name = "read_file", parameters = new { type = "object", properties = new { path = new { type = "string" } }, required = new[] { "path" } } } }],
            CancellationToken.None);
        Check(toolReply.Content == string.Empty && toolReply.ToolCalls is [{ Name: "read_file", Id: "call_read" }],
            "native Ollama tool calls parse when the assistant content is empty");
        using (var toolRequest = JsonDocument.Parse(toolPayload!))
        {
            Check(toolRequest.RootElement.GetProperty("think").ValueKind == JsonValueKind.False
                && toolRequest.RootElement.GetProperty("tools").GetArrayLength() == 1,
                "Qwen3 native tool requests disable thinking and include bounded tool schemas");
        }

        string? qwenPayload = null;
        var qwenProvider = new OpenAiCompatibleProvider(new HttpClient(new StubHandler(async (request, cancellationToken) =>
        {
            qwenPayload = await request.Content!.ReadAsStringAsync(cancellationToken);
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{\"message\":{\"content\":\"A direct reply.\"}}\n", Encoding.UTF8, "application/x-ndjson")
            };
        })));
        await qwenProvider.StreamChatAsync(
            new AppSettings { Endpoint = "http://localhost:11434", Model = "hf.co/Thaurock/Qwen3-Coder-30B-A3B-Instruct-abliterated-GGUF:Q4_K_M", ModelProvider = "Ollama", OllamaContextWindowTokens = 4096 },
            [new ChatMessage("user", "Reply conversationally")], _ => { }, CancellationToken.None, maxTokens: 100);
        using (var qwenRequest = JsonDocument.Parse(qwenPayload!))
        {
            Check(qwenRequest.RootElement.GetProperty("think").ValueKind == JsonValueKind.False,
                "downloaded Hugging Face Qwen3 Ollama requests disable hidden reasoning so bounded chats return visible content");
        }

        string? qwenCompatiblePayload = null;
        var qwenCompatibleProvider = new OpenAiCompatibleProvider(new HttpClient(new StubHandler(async (request, cancellationToken) =>
        {
            qwenCompatiblePayload = await request.Content!.ReadAsStringAsync(cancellationToken);
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("data: {\"choices\":[{\"delta\":{\"content\":\"Visible reply.\"}}]}\n\ndata: [DONE]\n\n", Encoding.UTF8, "text/event-stream")
            };
        })));
        await qwenCompatibleProvider.StreamChatAsync(
            new AppSettings { Endpoint = "http://localhost:11434/v1", Model = "hf.co/abliterant/Qwen3.8-27B-RANA-abliterated-GGUF:Q4_K_M", ModelProvider = "Ollama" },
            [new ChatMessage("user", "Reply conversationally")], _ => { }, CancellationToken.None, maxTokens: 100);
        using (var qwenCompatibleRequest = JsonDocument.Parse(qwenCompatiblePayload!))
        {
            Check(qwenCompatibleRequest.RootElement.GetProperty("think").ValueKind == JsonValueKind.False,
                "downloaded Hugging Face Qwen3 OpenAI-compatible Ollama requests disable hidden reasoning under the default response budget");
        }

        string? millionContextPayload = null;
        var millionContextProvider = new OpenAiCompatibleProvider(new HttpClient(new StubHandler(async (request, cancellationToken) =>
        {
            millionContextPayload = await request.Content!.ReadAsStringAsync(cancellationToken);
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{\"message\":{\"content\":\"large context request accepted\"}}\n", Encoding.UTF8, "application/x-ndjson")
            };
        })));
        var millionContextMessages = new ChatMessage[]
        {
            new("user", "EARLY-USER " + new string('u', 998_000)),
            new("assistant", "EARLY-ASSISTANT " + new string('a', 998_000)),
            new("user", "RECENT-USER " + new string('r', 998_000)),
            new("user", "LATEST-REQUEST")
        };
        await millionContextProvider.StreamChatAsync(
            new AppSettings { Endpoint = "http://localhost:11434", Model = "long-context-local", ModelProvider = "Ollama", OllamaContextWindowTokens = 1_048_576 },
            millionContextMessages, _ => { }, CancellationToken.None);
        using (var millionContextRequest = JsonDocument.Parse(millionContextPayload!))
        {
            var options = millionContextRequest.RootElement.GetProperty("options");
            var serializedMessages = millionContextRequest.RootElement.GetProperty("messages").EnumerateArray().ToArray();
            Check(options.GetProperty("num_ctx").GetInt32() == 1_048_576,
                "Ollama receives the configured 1M-token context window");
            Check(serializedMessages.Length == 4
                && serializedMessages[0].GetProperty("content").GetString()!.StartsWith("EARLY-USER ", StringComparison.Ordinal)
                && serializedMessages[^1].GetProperty("content").GetString() == "LATEST-REQUEST",
                "large Ollama context requests preserve the complete multi-message history and current request");
            Check(Encoding.UTF8.GetByteCount(millionContextPayload!) < 8_000_000,
                "large Ollama context request stays within the bounded serialized payload budget");
        }

        string? ollamaImagePayload = null;
        var ollamaImageProvider = new OpenAiCompatibleProvider(new HttpClient(new StubHandler(async (request, cancellationToken) =>
        {
            ollamaImagePayload = await request.Content!.ReadAsStringAsync(cancellationToken);
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("data: {\"choices\":[{\"delta\":{\"content\":\"Ollama image received.\"}}]}\n\ndata: [DONE]\n\n", Encoding.UTF8, "text/event-stream")
            };
        })));
        await ollamaImageProvider.StreamChatAsync(
            new AppSettings { Endpoint = "http://localhost:11434/v1", Model = "vision-local", VisionApiFormat = "auto" },
            [new ChatMessage("user", "Describe this", [new ChatAttachment("sample.png", Convert.ToBase64String(pngSignature), "image/png")]).ForModel("Describe this")],
            _ => { },
            CancellationToken.None);
        using (var ollamaImageRequest = JsonDocument.Parse(ollamaImagePayload!))
        {
            var content = ollamaImageRequest.RootElement.GetProperty("messages").EnumerateArray()
                .Single(message => message.GetProperty("role").GetString() == "user").GetProperty("content");
            Check(content[1].GetProperty("image_url").ValueKind == JsonValueKind.String, "Ollama's default local endpoint uses its documented image URL string shape");
        }

        var badResponseProvider = new OpenAiCompatibleProvider(new HttpClient(new StubHandler((_, _) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.ServiceUnavailable) { Content = new StringContent("model server unavailable") }))));
        try
        {
            await badResponseProvider.StreamChatAsync(new AppSettings(), [new ChatMessage("user", "test")], _ => { }, CancellationToken.None);
            throw new Exception("Expected an HTTP failure to be surfaced.");
        }
        catch (HttpRequestException error)
        {
            Check(error.Message.Contains("503", StringComparison.Ordinal), "provider HTTP errors include status");
            Check(error.Message.Contains("model server unavailable", StringComparison.Ordinal), "provider HTTP errors include a readable response body");
        }

        // Local endpoint check and error messages (moved from the former desktop shell into Core).
        Check(LocalEndpoint.IsLocal("http://localhost:11434/v1") && LocalEndpoint.IsLocal("http://127.0.0.1:1234/v1") && LocalEndpoint.IsLocal("http://[::1]:8080"),
            "loopback and localhost endpoints count as on-device");
        Check(!LocalEndpoint.IsLocal("http://192.168.1.20:11434/v1") && !LocalEndpoint.IsLocal("https://openrouter.ai/api/v1") && !LocalEndpoint.IsLocal("not a url")
            && !LocalEndpoint.IsLocal("http://user:secret@localhost:11434/v1") && !LocalEndpoint.IsLocal("http://localhost:11434/v1#remote"),
            "LAN, cloud, credential-bearing, and malformed endpoints do not count as on-device");
        var profile = ModelCapabilityResolver.Resolve(new AppSettings { ModelProvider = "Ollama", Model = "llama3.2", Endpoint = "http://localhost:11434/v1" });
        Check(profile.EndpointPrivacy == "local" && profile.Streaming == CapabilitySupport.Supported && profile.Vision == CapabilitySupport.Unknown,
            "capability profile reports bounded local routing facts without guessing vision support");
        var nonVisionProfile = ModelCapabilityResolver.Resolve(new AppSettings { ModelProvider = "Custom endpoint", Model = "text-embedding-3-small", Endpoint = "https://example.test/v1" });
        Check(nonVisionProfile.Vision == CapabilitySupport.Unsupported && nonVisionProfile.EndpointPrivacy == "remote",
            "capability profile identifies definitive non-vision model markers");
        var overrideProfile = ModelCapabilityResolver.Resolve(new AppSettings { Model = "text-embedding-3-small", VisionCapabilityOverride = "supported" });
        Check(overrideProfile.Vision == CapabilitySupport.Supported && overrideProfile.Evidence.Contains("override", StringComparison.Ordinal),
            "capability profile honors an explicit local vision override");
        var blockedImageProvider = new OpenAiCompatibleProvider(new HttpClient(new StubHandler((_, _) => throw new Exception("Definitive capability rejection must happen before network access."))));
        try
        {
            await blockedImageProvider.StreamChatAsync(
                new AppSettings { Model = "text-embedding-3-small", Endpoint = "https://example.test/v1" },
                [new ChatMessage("user", "describe", [new ChatAttachment("sample.png", Convert.ToBase64String(pngSignature), "image/png")])],
                _ => { }, CancellationToken.None);
            throw new Exception("Expected a definitive non-vision model to reject image input.");
        }
        catch (InvalidOperationException error)
        {
            Check(error.Message.Contains("non-vision", StringComparison.OrdinalIgnoreCase), "provider blocks image input for a definitive non-vision model");
        }
        Check(ProviderErrorText.Describe(new HttpRequestException("boom", null, HttpStatusCode.InternalServerError)) == "Model server error: boom"
            && ProviderErrorText.Describe(new HttpRequestException("refused")).StartsWith("Could not reach the model server.", StringComparison.Ordinal)
            && ProviderErrorText.Describe(new TaskCanceledException()) == "The request timed out or was interrupted.",
            "provider errors distinguish server errors, unreachable servers, and timeouts");
        Check(ProviderErrorText.Describe(new HttpRequestException("bad", null, HttpStatusCode.BadRequest), hasImageAttachments: true).StartsWith("This model endpoint rejected the image.", StringComparison.Ordinal)
            && ProviderErrorText.Describe(new HttpRequestException("bad", null, HttpStatusCode.BadRequest), hasImageAttachments: false) == "Model server error: bad",
            "a 400 is explained as an image rejection only when images were attached");
        Check(ProviderErrorText.Classify(new InvalidOperationException("The model server closed the stream without returning a response.")) == ProviderFailureKind.ModelCompatibility
            && ProviderErrorText.Classify(new HttpRequestException("refused")) == ProviderFailureKind.EndpointUnavailable
            && ProviderErrorText.Classify(new HttpRequestException("bad", null, HttpStatusCode.BadRequest), hasImageAttachments: true) == ProviderFailureKind.ImageRejected
            && ProviderErrorText.Classify(new TaskCanceledException()) == ProviderFailureKind.Timeout,
            "provider failures classify model compatibility separately from endpoint, image, and timeout failures");
        var selection = ModelSelectionPolicy.Evaluate("missing-model", ["local-a", "local-b"]);
        Check(!selection.IsAvailable && selection.SelectedModel == "missing-model"
            && ModelSelectionPolicy.Evaluate("local-b", ["local-a", "local-b"]).IsAvailable,
            "unavailable selected models remain explicit until the user chooses a listed model");
        Check(ConnectionSettingsValidator.Validate("http://localhost:11434/v1", "local-a", true).IsValid,
            "valid local connection settings pass validation");
        Check(!ConnectionSettingsValidator.Validate("not an endpoint", "local-a", false).IsValid
            && !ConnectionSettingsValidator.Validate("http://localhost:11434/v1", "", false).IsValid,
            "invalid endpoint and missing model are rejected before save");
        Check(!ConnectionSettingsValidator.Validate("https://example.com/v1", "remote-a", true).IsValid,
            "local-only settings reject remote endpoints before save");
        Check(!ConnectionSettingsValidator.Validate("http://user:secret@localhost:11434/v1", "local-a", false).IsValid
            && !ConnectionSettingsValidator.Validate("http://localhost:11434/v1#remote", "local-a", false).IsValid,
            "settings reject embedded credentials and URL fragments even on loopback");
        Check(ConnectionSettingsValidator.Validate("http://localhost:11434/v1", "local-a", true).IsValid
            && !ConnectionSettingsValidator.Validate("https://example.com/v1", "remote-a", true).IsValid,
            "local-only route selection rejects a pinned remote endpoint before switching");
        var drafts = new WorkspaceDraftStore();
        drafts.Set("ChatBot", "draft for chat");
        drafts.Set("CodingAgent", "draft for coding");
        Check(drafts.Get("ChatBot") == "draft for chat" && drafts.Get("CodingAgent") == "draft for coding"
            && drafts.Get("missing") == string.Empty,
            "workspace drafts remain isolated by workspace");
        var restoredDrafts = new WorkspaceDraftStore(drafts.Snapshot());
        Check(restoredDrafts.Get("ChatBot") == "draft for chat" && restoredDrafts.Get("CodingAgent") == "draft for coding",
            "workspace drafts restore from a persisted snapshot");
    }
}
