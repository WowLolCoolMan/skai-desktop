using SkaiDesktop.Core.Models;

namespace SkaiDesktop.Core.Services;

/// <summary>
/// Describes capabilities that are already understood by the local runtime.
/// Remote model discovery is handled separately by ModelLibraryService so the
/// catalog never presents an install action without a matching adapter.
/// </summary>
public static class MarketplaceCatalogService
{
    private sealed record CuratedEntry(string Id, string Name, string Provider, string Category, string License, string Description, string Runtime, string[] Capabilities, string Source);

    private static readonly CuratedEntry[] CuratedEntries = BuildCuratedEntries();

    private static CuratedEntry[] BuildCuratedEntries()
    {
        var entries = new List<CuratedEntry>();
        void Add(string category, string provider, string license, string runtime, string capabilities, params (string id, string name, string description, string source)[] items)
        {
            foreach (var item in items)
                entries.Add(new(item.id, item.name, provider, category, license, item.description, runtime, capabilities.Split('|'), item.source));
        }

        Add("Voice (TTS/STT)", "Resemble AI", "MIT", "Chatterbox-TTS 0.1.7 · PyTorch 2.6 CPU · pinned Hugging Face checkpoint", "text-to-speech|offline|english|emotion-tags|cpu", ("chatterbox", "Chatterbox Nano", "Local English speech with its built-in speaker and expressive cues. Skai's current voice controls do not yet accept custom reference audio.", "https://huggingface.co/ResembleAI/chatterbox-nano"));
        Add("Voice (TTS/STT)", "Kyutai", "MIT runtime and model / CC BY 4.0 built-in voice", "Pocket TTS 3.3.0 · verified Windows x64 runtime · pinned CPU model", "text-to-speech|offline|english|cpu|attribution", ("pocket-tts", "Pocket TTS", "CPU-first offline English speech through a verified loopback-only local adapter. Skai uses Kyutai's built-in attributed voice; custom voice clips are not exposed in this adapter.", "https://github.com/kyutai-labs/pocket-tts"));
        Add("Voice (TTS/STT)", "hexgrad", "Apache-2.0 model / MIT runtime", "Pinned kokoro-onnx 0.6.1 · isolated Python · local ONNX", "text-to-speech|offline|english", ("kokoro-82m", "Kokoro-82M", "English offline neural speech synthesis with a Skai installer and local playback adapter.", "https://huggingface.co/hexgrad/Kokoro-82M"));
        Add("Voice (TTS/STT)", "Alibaba", "Apache-2.0", "Local Python/PyTorch; installer not connected", "text-to-speech|voice-design|voice-cloning|streaming", ("qwen3-tts", "Qwen3-TTS", "Multilingual local speech with voice design and cloning.", "https://github.com/QwenLM/Qwen3-TTS"));
        Add("Voice (TTS/STT)", "Fish Audio", "Research NC", "Local runtime; verify model terms", "text-to-speech|voice-cloning|emotion", ("fish-audio-s2-pro", "Fish Audio S2 Pro", "Expressive speech generation; research non-commercial terms apply.", "https://github.com/fishaudio/fish-speech"));
        Add("Voice (TTS/STT)", "BreezeBlue", "Research NC", "Local runtime; verify model terms", "text-to-speech", ("breeze-tts-2", "Breeze TTS 2", "Local speech synthesis; research non-commercial terms apply.", "https://huggingface.co/BreezeBlue"));
        Add("Voice (TTS/STT)", "StepFun", "Apache-2.0", "Local runtime; setup not connected", "speech-editing|audio", ("step-audio-editx", "Step Audio EditX", "Local speech and audio editing model.", "https://huggingface.co/stepfun-ai"));
        Add("Voice (TTS/STT)", "Mistral", "CC-BY-NC", "Local runtime; non-commercial", "text-to-speech", ("voxtral-tts", "Voxtral TTS", "Local speech model with non-commercial license restrictions.", "https://huggingface.co/mistralai"));
        Add("Voice (TTS/STT)", "NVIDIA", "Open", "Local runtime; setup not connected", "text-to-speech|multilingual", ("magpie-multilingual-357m", "Magpie-Multilingual 357M", "Multilingual local speech model.", "https://huggingface.co/nvidia"));
        Add("Voice (TTS/STT)", "SWivid", "CC-BY-NC", "Local Python/PyTorch; non-commercial", "text-to-speech|voice-cloning", ("f5-tts", "F5-TTS", "Local flow-matching speech and reference voice cloning.", "https://github.com/SWivid/F5-TTS"));
        Add("Voice (TTS/STT)", "Coqui", "CPML NC", "Local Python/PyTorch; non-commercial", "text-to-speech|multilingual|voice-cloning", ("xtts-v2", "XTTS v2", "Multilingual local speech and reference voice cloning.", "https://github.com/coqui-ai/TTS"));
        Add("Voice (TTS/STT)", "Open Home Foundation", "GPL-3.0 engine / CC-BY-4.0 voice data", "Pinned piper-tts 1.5.0 · isolated Python · local ONNX", "text-to-speech|offline|english|attribution", ("piper", "Piper", "Compact offline English neural speech. Skai retains the selected voice's model card and attribution terms.", "https://github.com/OHF-Voice/piper1-gpl"));
        Add("Voice (TTS/STT)", "Kitten AI", "Apache-2.0", "Local runtime; setup not connected", "text-to-speech|small-model", ("kitten-tts-08", "Kitten TTS 0.8", "Small local text-to-speech model.", "https://github.com/KittenML/KittenTTS"));
        Add("Voice (TTS/STT)", "Alibaba", "Apache-2.0", "Local Python/PyTorch; setup not connected", "text-to-speech|multilingual|voice-cloning", ("cosyvoice2", "CosyVoice2", "Multilingual local speech with zero-shot voice support.", "https://github.com/FunAudioLLM/CosyVoice"));
        Add("Voice (TTS/STT)", "NVIDIA", "Apache-2.0", "Local runtime; setup not connected", "text-to-speech|multispeaker", ("dia-2", "Dia 2", "Local multi-speaker speech generation.", "https://huggingface.co/nvidia"));
        Add("Voice (TTS/STT)", "Supertone", "Open", "Local runtime; verify model terms", "text-to-speech", ("supertonic-3", "Supertonic 3", "Local speech synthesis model.", "https://github.com/supertone-inc"));
        Add("Voice (TTS/STT)", "Maya Research", "Apache-2.0", "Local runtime; setup not connected", "text-to-speech", ("maya1", "Maya1", "Local expressive speech model.", "https://huggingface.co"));
        Add("Voice (TTS/STT)", "Kyutai", "MIT", "Local Python runtime; setup not connected", "speech-to-speech|streaming", ("moshi", "Moshi", "Local realtime speech conversation model.", "https://github.com/kyutai-labs/moshi"));
        Add("Voice (TTS/STT)", "Meta", "Llama License", "Local runtime; license gated", "speech|multimodal", ("llama-omni", "Llama-Omni", "Local multimodal model with speech output; Meta license applies.", "https://github.com/ictnlp/LLaMA-Omni"));
        Add("Voice (TTS/STT)", "OpenAI · Systran conversion", "MIT", "faster-whisper 1.2.1 · local CPU int8 · 3.09 GB model", "speech-to-text|transcription|offline|multilingual", ("whisper-large-v3", "Whisper large-v3", "Offline multilingual audio transcription through a checksum-pinned local model.", "https://github.com/SYSTRAN/faster-whisper"));
        Add("Voice (TTS/STT)", "NVIDIA", "CC-BY-NC", "Local NeMo runtime; non-commercial", "speech-to-text|transcription", ("parakeet-tdt-11b", "Parakeet TDT 1.1B", "Local speech recognition; non-commercial license applies.", "https://huggingface.co/nvidia"));

        var coding = new (string id, string name, string provider, string license, string source)[] {
            ("deepseek-v4-1-flash","DeepSeek V4.1 Flash","DeepSeek","MIT","https://huggingface.co/deepseek-ai"),("kimi-k3","Kimi K3","Moonshot","Modified MIT","https://huggingface.co/moonshotai"),("glm-5-3","GLM-5.3","Z.ai","License not confirmed","https://huggingface.co/zai-org"),("glm-5-2","GLM-5.2","Z.ai","MIT","https://huggingface.co/zai-org"),("glm-5-3-flash","GLM-5.3-Flash","Z.ai","MIT","https://huggingface.co/zai-org"),("qwen3-coder-480b-a35b","Qwen3 Coder 480B-A35B","Alibaba","Apache-2.0","https://huggingface.co/Qwen"),("qwen3-8-27b","Qwen3.8-27B","Alibaba","Apache-2.0","https://huggingface.co/Qwen"),("qwen3-8-max","Qwen3.8-Max","Alibaba","License not confirmed","https://huggingface.co/Qwen"),("mistral-large-4","Mistral Large 4","Mistral","Open-Weight","https://huggingface.co/mistralai"),("devstral-small-2505","Devstral Small 2505","Mistral","Apache-2.0","https://huggingface.co/mistralai"),("mimo-v2-6-pro","MiMo-V2.6-Pro","Xiaomi","MIT","https://huggingface.co/XiaomiMiMo"),("deepseek-v4-pro","DeepSeek V4 Pro","DeepSeek","MIT","https://huggingface.co/deepseek-ai"),("gemma-4-31b","Gemma 4 31B","Google","Apache-2.0","https://huggingface.co/google"),("gpt-oss-120b","gpt-oss-120b","OpenAI","Apache-2.0","https://huggingface.co/openai"),("hunyuan-hy3","Hunyuan Hy3","Tencent","Apache-2.0","https://huggingface.co/tencent"),("command-a-plus","Command A+","Cohere","Apache-2.0","https://huggingface.co/CohereForAI")};
        foreach (var item in coding) Add("Coding", item.provider, item.license, "Ollama / LM Studio if compatible weights exist; verify package", "code-generation|local-inference", (item.id, item.name, $"Self-hostable coding model entry. License: {item.license}.", item.source));

        var chat = new (string id, string name, string provider, string license, string source)[] {
            ("glm-5-2-general","GLM-5.2","Z.ai","MIT","https://huggingface.co/zai-org"),("qwen3-6-27b","Qwen3.6-27B","Alibaba","Apache-2.0","https://huggingface.co/Qwen"),("deepseek-v4-flash","DeepSeek V4-Flash","DeepSeek","MIT","https://huggingface.co/deepseek-ai"),("kimi-k3-general","Kimi K3","Moonshot","Modified MIT","https://huggingface.co/moonshotai"),("gemma-4-2-31b","Gemma 4 2B–31B","Google","Apache-2.0","https://huggingface.co/google"),("gpt-oss-120b-general","gpt-oss-120b","OpenAI","Apache-2.0","https://huggingface.co/openai"),("gpt-oss-20b","gpt-oss-20b","OpenAI","Apache-2.0","https://huggingface.co/openai"),("hunyuan-hy3-general","Hunyuan Hy3","Tencent","Apache-2.0","https://huggingface.co/tencent"),("command-a-plus-general","Command A+","Cohere","Apache-2.0","https://huggingface.co/CohereForAI"),("phi-4-mini","Phi-4-mini","Microsoft","MIT","https://huggingface.co/microsoft"),("mistral-small-3-2-24b","Mistral Small 3.2 24B","Mistral","Apache-2.0","https://huggingface.co/mistralai"),("llama-3-3-70b","Llama 3.3 70B","Meta","Llama License","https://huggingface.co/meta-llama"),("qwen3-14b","Qwen3 14B","Alibaba","Apache-2.0","https://huggingface.co/Qwen"),("minimax-m2-5","MiniMax M2.5","MiniMax","Custom","https://huggingface.co/MiniMaxAI"),("deepseek-v3-2","DeepSeek V3.2","DeepSeek","MIT","https://huggingface.co/deepseek-ai"),("mistral-large-4-general","Mistral Large 4","Mistral","Open-Weight","https://huggingface.co/mistralai")};
        foreach (var item in chat) Add("Chat / General LLM", item.provider, item.license, "Ollama / LM Studio if compatible weights exist; verify package", "chat|text-generation|local-inference", (item.id, item.name, $"Self-hostable general language model entry. License: {item.license}.", item.source));

        var images = new (string id, string name, string provider, string license, string source)[] {
            ("flux-2-dev","FLUX.2 [dev]","BFL","Non-commercial","https://huggingface.co/black-forest-labs"),("qwen-image-2-1","Qwen-Image-2.1","Alibaba","Non-commercial","https://huggingface.co/Qwen"),("qwen-image-2512","Qwen-Image-2512","Alibaba","Apache-2.0","https://huggingface.co/Qwen"),("flux-2-klein-4b","FLUX.2 klein 4B","BFL","Apache-2.0","https://huggingface.co/black-forest-labs"),("hidream-o1-image","HiDream-O1-Image","HiDream","MIT","https://huggingface.co/HiDream-ai"),("hunyuanimage-3","HunyuanImage 3.0","Tencent","Community","https://huggingface.co/tencent"),("z-image-turbo","Z-Image Turbo","Alibaba","Apache-2.0","https://huggingface.co/Tongyi-MAI"),("flux-1-schnell","FLUX.1 [schnell]","BFL","Apache-2.0","https://huggingface.co/black-forest-labs"),("sd-3-5-large","SD 3.5 Large","Stability","Community License <$1M","https://huggingface.co/stabilityai"),("sdxl-1-0","SDXL 1.0","Stability","OpenRAIL++","https://huggingface.co/stabilityai"),("sd-3-5-medium","SD 3.5 Medium","Stability","Community License <$1M","https://huggingface.co/stabilityai"),("nvidia-sana","NVIDIA Sana","NVIDIA","Apache-2.0","https://huggingface.co/nvidia"),("deepseek-janus-pro","DeepSeek Janus-Pro","DeepSeek","MIT","https://huggingface.co/deepseek-ai"),("ideogram-4","Ideogram 4.0","Ideogram","Non-commercial","https://huggingface.co"),("ming-image-01-design","Ming-Image-0.1-Design","InclusionAI","MIT","https://huggingface.co/inclusionAI"),("flux-3-image-klein","FLUX 3 Image Klein","BFL","Kommunity","https://huggingface.co/black-forest-labs"),("glm-image","GLM-Image","Z.ai","MIT","https://huggingface.co/zai-org")};
        foreach (var item in images) Add("Image Generation", item.provider, item.license, "ComfyUI or local Diffusers only when a compatible package is verified", "text-to-image|local-inference", (item.id, item.name, $"Self-hostable image generation entry. License: {item.license}.", item.source));

        var mcps = new (string id, string name, string provider, string access)[] {
            ("playwright-mcp","Playwright MCP","Microsoft","stdio MCP"),("github-mcp","GitHub MCP","GitHub","stdio MCP; local credentials required"),("context7-mcp","Context7","Upstash","stdio MCP"),("filesystem-mcp","Filesystem MCP","Model Context Protocol","stdio MCP; explicit folder permissions"),("supabase-mcp","Supabase MCP","Supabase","stdio or HTTP MCP; local setup"),("postgres-mcp-pro","Postgres MCP Pro","Postgres MCP","stdio MCP; database credentials required"),("figma-mcp","Figma MCP","Figma","stdio or HTTP MCP; provider auth may be required"),("linear-mcp","Linear MCP","Linear","stdio or HTTP MCP; provider auth may be required"),("notion-mcp","Notion MCP","Notion","stdio or HTTP MCP; provider auth may be required"),("atlassian-rovo-mcp","Atlassian Rovo MCP","Atlassian","stdio or HTTP MCP; provider auth may be required"),("sentry-mcp","Sentry MCP","Sentry","stdio or HTTP MCP; provider auth may be required"),("stripe-mcp","Stripe MCP","Stripe","stdio or HTTP MCP; provider auth may be required"),("cloudflare-mcp","Cloudflare MCP","Cloudflare","stdio or HTTP MCP; provider auth may be required"),("slack-mcp","Slack MCP","Slack","stdio or HTTP MCP; provider auth may be required"),("exa-mcp","Exa MCP","Exa","stdio or HTTP MCP; provider auth may be required"),("firecrawl-mcp","Firecrawl MCP","Firecrawl","stdio MCP; local server and key may be required"),("brave-search-mcp","Brave Search MCP","Brave","stdio MCP; local server and key may be required"),("tavily-mcp","Tavily MCP","Tavily","stdio MCP; local server and key may be required"),("terraform-mcp","Terraform MCP","HashiCorp","stdio MCP"),("aws-mcp-server","AWS MCP Server","AWS","stdio MCP; local AWS credentials required")};
        foreach (var item in mcps)
        {
            if (item.id == "playwright-mcp")
                Add("MCP Servers", "Microsoft", "Apache-2.0", "Node.js 20+ · local stdio", "browser-automation|local-tools|explicit-approval", (item.id, item.name, "Run the official Playwright MCP server locally to inspect and control browser pages. Network access follows the pages you choose to open; tool calls remain behind explicit approval.", "https://github.com/microsoft/playwright-mcp"));
            else if (item.id == "postgres-mcp-pro")
                Add("MCP Servers", "Microsoft", "MIT", "Node.js 22+ · local stdio · localhost PostgreSQL", "database-query|local-only|explicit-approval", (item.id, item.name, "Connect the local server to a PostgreSQL database on this device. Credentials are used only by the server process for this session and are not saved by Skai.", "https://github.com/microsoft/postgres-mcp"));
            else if (item.id == "filesystem-mcp")
                Add("MCP Servers", "Model Context Protocol", "MIT / Apache-2.0 transition", "Node.js 24+ · local stdio · read-only by default", "filesystem|read-only|local-tools", (item.id, item.name, "Browse files in one folder you choose. Skai starts the official local server in read-only mode and keeps tool calls behind explicit approval.", "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem"));
            else if (item.id == "figma-mcp")
                Add("MCP Servers", "Figma", "Proprietary · Figma desktop", "Figma desktop · loopback HTTP", "design-context|local-desktop-server|explicit-approval", (item.id, item.name, "Connect to Figma's local desktop MCP server after enabling it in Dev Mode. The official desktop server listens on 127.0.0.1:3845 and requires a Figma account and eligible seat.", "https://help.figma.com/hc/en-us/articles/39216419318551-Get-started-with-the-Figma-MCP-server"));
            else if (item.id == "supabase-mcp")
                Add("MCP Servers", "Supabase", "Apache-2.0", "Supabase CLI · local loopback HTTP", "database|local-development|explicit-approval", (item.id, item.name, "Connect to the MCP endpoint exposed by a running local Supabase CLI stack. This supports the local project only and does not connect to Supabase's hosted MCP service.", "https://github.com/supabase/mcp"));
            else
                Add("MCP Servers", item.provider, "See upstream repository", item.access, "tools|explicit-approval", (item.id, item.name, $"MCP server integration. Setup requires reviewing the upstream server and its local configuration. {item.access}.", "https://github.com"));
        }
        return entries.ToArray();
    }

    public static object Snapshot() => new
    {
        providers = new[]
        {
            new { id = "huggingface", name = "Hugging Face", kinds = new[] { "llm", "voice", "image" }, remote = true },
            new { id = "modelscope", name = "ModelScope", kinds = new[] { "llm" }, remote = true },
            new { id = "ollama", name = "Ollama", kinds = new[] { "llm" }, remote = false },
            new { id = "lm-studio", name = "LM Studio", kinds = new[] { "llm" }, remote = false },
            new { id = "comfyui", name = "ComfyUI", kinds = new[] { "image" }, remote = false },
            new { id = "github", name = "GitHub", kinds = new[] { "skill", "tool" }, remote = true },
        },
        voiceProviders = VoiceModelCatalog.CloudProviders.Select(provider => new
        {
            id = provider.Id,
            name = provider.Name,
            kind = provider.Kind,
            model = provider.Model,
            defaultVoiceId = provider.DefaultVoiceId,
            endpoint = provider.Endpoint,
            sourceUrl = provider.SourceUrl,
            requiresUserKey = provider.RequiresUserKey,
            supportsStreaming = provider.SupportsStreaming,
            status = provider.AvailabilityNote,
        }).ToArray(),
        voices = VoiceModelCatalog.All.Select(voice => new
        {
            id = voice.Id,
            name = voice.Name,
            description = voice.Description,
            runtime = voice.Runtime,
            license = voice.License,
            size = voice.Size,
            installed = voice.Id == "kokoro-82m-onnx" ? VoiceRuntimeStatus.IsKokoroInstalled : voice.Id == "piper" ? VoiceRuntimeStatus.IsPiperInstalled : voice.Id == "chatterbox" ? VoiceRuntimeStatus.IsChatterboxInstalled : voice.Id is "pocket-tts" or "pocket-tts-low-resource" ? VoiceRuntimeStatus.IsPocketTtsInstalled : voice.IsInstalled,
            lowResource = voice.IsLowResource,
            sourceUrl = voice.SourceUrl,
            adapterAvailable = (voice.AdapterAvailable || voice.Id is "kokoro-82m-onnx" or "piper" or "chatterbox" or "pocket-tts" or "pocket-tts-low-resource") && (voice.Id is not ("pocket-tts" or "pocket-tts-low-resource") || VoiceRuntimeStatus.IsPocketTtsSupported),
            supportsStreaming = voice.SupportsStreaming,
            supportsVoiceCloning = voice.SupportsVoiceCloning,
            supportsEmotion = voice.SupportsEmotion,
            supportsAudioEffects = voice.SupportsAudioEffects,
            availabilityNote = voice.AvailabilityNote,
            installable = (voice.AdapterAvailable || voice.Id is "kokoro-82m-onnx" or "piper" or "chatterbox" or "pocket-tts" or "pocket-tts-low-resource") && (voice.Id is not ("pocket-tts" or "pocket-tts-low-resource") || VoiceRuntimeStatus.IsPocketTtsSupported) && !string.IsNullOrWhiteSpace(voice.SourceUrl) && !(voice.Id == "kokoro-82m-onnx" && VoiceRuntimeStatus.IsKokoroInstalled) && !(voice.Id == "piper" && VoiceRuntimeStatus.IsPiperInstalled) && !(voice.Id == "chatterbox" && VoiceRuntimeStatus.IsChatterboxInstalled) && !((voice.Id is "pocket-tts" or "pocket-tts-low-resource") && VoiceRuntimeStatus.IsPocketTtsInstalled),
        }).ToArray(),
        skills = SkillCatalogService.BuiltIns.Select(skill => new
        {
            id = skill.Id,
            name = skill.Name,
            description = skill.Description,
            category = skill.Category,
            permissions = skill.RequiredPermissions,
            source = "Skai built-in",
            installed = true,
            enabled = true,
            installable = false,
        }).Concat(new SkillPackageInstaller().ListInstalled().Select(skill => new
        {
            id = skill.Id,
            name = skill.Name,
            description = $"Local Markdown skill by {skill.Publisher}.",
            category = "Installed",
            permissions = skill.RequiredPermissions,
            source = skill.SourceRef,
            installed = true,
            enabled = skill.Enabled,
            installable = false,
        })).ToArray(),
        tools = PluginCatalogService.Search().Select(tool => new
        {
            id = tool.Id,
            name = tool.Name,
            description = tool.Description,
            category = tool.Category,
            access = tool.Access,
            builtIn = tool.IsBuiltIn,
            status = tool.StatusLabel,
            source = tool.WhereToFind,
            installable = false,
        }).ToArray(),
        catalogEntries = CuratedEntries.Select(entry => new
        {
            id = entry.Id, name = entry.Name, provider = entry.Provider, category = entry.Category,
            license = entry.License, description = entry.Description, runtime = entry.Runtime,
            capabilities = entry.Capabilities, source = entry.Source, localOnly = true,
            adapter = ResolveAdapter(entry),
            installable = ResolveAdapter(entry) != "none" && (ResolveAdapter(entry) != "local-voice-pocket-tts" || VoiceRuntimeStatus.IsPocketTtsSupported),
            installReview = ResolveAdapter(entry) == "local-model-search"
                ? "Search supported local GGUF packages, confirm the exact repository and active runtime, then install after reviewing the license and hardware fit. This does not imply the named upstream weights are directly downloadable."
                : ResolveAdapter(entry) == "local-voice-kokoro"
                    ? "Skai creates an isolated Python environment, installs kokoro-onnx 0.6.1, and downloads the INT8 Kokoro ONNX weights and voice pack. Both model files are checked against pinned SHA-256 digests before use. The Kokoro model is Apache-2.0; runtime package is MIT. Speech is synthesized locally."
                : ResolveAdapter(entry) == "local-voice-piper"
                    ? "Skai installs the pinned Windows-compatible piper-tts 1.5.0 runtime in an isolated Python environment and downloads a pinned English voice, JSON config, and MODEL_CARD from a fixed Hugging Face revision. SHA-256 hashes are checked before use. Piper engine is GPL-3.0; voice data is CC BY 4.0 and requires attribution. Synthesis stays local."
                : ResolveAdapter(entry) == "local-voice-chatterbox"
                    ? "Skai installs CPU-only PyTorch and the Chatterbox-TTS source at a pinned commit in an isolated Python environment, then downloads about 1.9 GB of required Nano checkpoint files from a fixed Hugging Face revision. File hashes are verified before local synthesis. Allow at least 6 GB free for setup. The 110M-parameter English model is MIT licensed; initial model loading is memory and disk intensive."
                : ResolveAdapter(entry) == "local-voice-pocket-tts"
                    ? "Windows x64 only. Skai downloads Kyutai's Pocket TTS 3.3.0 runtime from the official v4.0.1 release and verifies the published archive digest plus the extracted executable hash. It warms full and low-resource English models from immutable upstream revisions, using Kyutai's built-in alba voice. Runtime service binds only to 127.0.0.1; synthesis stays on this device. Runtime and models are MIT; the built-in voice is CC BY 4.0 and attribution is stored with the install. Custom reference clips are not exposed in Skai yet."
                : ResolveAdapter(entry) == "local-voice-whisper"
                    ? "Skai installs faster-whisper 1.2.1 into an isolated Python environment and downloads the 3.09 GB Systran large-v3 conversion at a pinned Hugging Face revision. SHA-256 hashes are verified for every model file. Transcription uses CPU int8, runs offline, and sends no audio to a service. Keep at least 4 GB free for download and additional RAM for inference."
                : ResolveAdapter(entry) == "local-mcp-playwright"
                    ? "Skai installs @playwright/mcp@0.0.86 on first connect and runs it locally over stdio. Node.js 20 or newer is required. On Windows Skai uses Microsoft Edge when found; other platforms need a Playwright-compatible browser installed."
                : ResolveAdapter(entry) == "local-mcp-postgres"
                    ? "Skai installs @microsoft/postgres-mcp@0.3.1 on first connect, disables telemetry, and passes the localhost connection string only to the child process. Credentials are not persisted; re-enter them after restarting Skai."
                : ResolveAdapter(entry) == "local-mcp-filesystem"
                    ? "Skai installs @modelcontextprotocol/server-filesystem@2.4.0 on first connect and starts it locally over stdio. Choose one folder to share; the server exposes read-only tools by default and requires Node.js 24 or newer."
                : ResolveAdapter(entry) == "local-mcp-figma"
                    ? "Requires Figma desktop to be running with its local MCP server enabled in Dev Mode. Skai connects only to http://127.0.0.1:3845/mcp; hosted Figma MCP endpoints are not used. Review each tool call before execution."
                : ResolveAdapter(entry) == "local-mcp-supabase"
                    ? "Requires Supabase CLI with a local stack already running. Skai connects only to http://127.0.0.1:54321/mcp; hosted Supabase MCP routes are not used. Experimental multi-project stacks may use another port; add that local endpoint in MCP Connections."
                : "No verified in-app installer is connected for this category yet. This listing is unavailable for installation until Skai has a compatible local adapter.",
        }).ToArray(),
    };

    private static string ResolveAdapter(CuratedEntry entry) => entry.Category is "Coding" or "Chat / General LLM"
        ? "local-model-search"
        : entry.Id switch
        {
            "kokoro-82m" => "local-voice-kokoro",
            "piper" => "local-voice-piper",
            "chatterbox" => "local-voice-chatterbox",
            "pocket-tts" => "local-voice-pocket-tts",
            "whisper-large-v3" => "local-voice-whisper",
            "filesystem-mcp" => "local-mcp-filesystem",
            "playwright-mcp" => "local-mcp-playwright",
            "postgres-mcp-pro" => "local-mcp-postgres",
            "figma-mcp" => "local-mcp-figma",
            "supabase-mcp" => "local-mcp-supabase",
            _ => "none",
        };
}
