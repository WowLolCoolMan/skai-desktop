# Integrations

## Local model and media runtimes

- Ollama, LM Studio/OpenAI-compatible loopback servers, LocalAI, llama.cpp, and vLLM are named local model targets in product documentation and provider code.
- AirLLM is an optional local provider path. The packaged Agent Host exposes a
  readiness check and can run the bundled JSON-lines worker when its user-local
  Python environment is installed.
- ComfyUI is the current image workflow integration, using local queue/poll behavior and local output handling.
- OS-native speech/TTS is available as a local capability; a complete local STT/TTS model marketplace path is not finished.

## GitHub

- GitHub is an explicit project integration for repository status, guarded actions, branches, pull requests, and remote operations.
- Authentication and credential handling are local/policy-gated rather than a cloud model route.
- The current Electron Marketplace does not expose remote GitHub skill
  discovery/install as a live product feature; GitHub remains a project
  integration with guarded repository and pull-request operations.

## Marketplace sources

- Core contains model library, authored/curated skill catalog, package installer, plugin catalog, and MCP-related clients.
- The Electron Marketplace has host-backed catalog, provider search, model-size/provider filters, selected-item details, and verified local model-install operations. Results are limited to sources supported by the host and clearly label provenance.
- Skills, tools, voices, and image workflows are cataloged locally; remote package installation for those categories remains intentionally unavailable until a verified source and installer contract exists.
- Hugging Face/ModelScope model discovery is user-selectable through provider and size filters. Quantization, licensing, and hardware suitability remain follow-up metadata/compatibility work rather than decorative claims.

## MCP and tool integrations

- Core supports bounded stdio/HTTP-style MCP clients, OpenAPI descriptors, conservative tool classification, manifests, permissions, and audit concepts.
- Process supervision, notifications/resources, authenticated retrieval, and full UI lifecycle/health coverage remain incomplete according to `docs/CAPABILITY_MATRIX.md`.

## Persistence and secrets

- Local JSON-backed stores hold product state and are guarded by profile paths and recovery tests.
- Windows-protected credential storage is used for sensitive local credentials where implemented.
- No external database, hosted queue, telemetry vendor, or cloud synchronization path is part of the intended architecture.

## Reliability boundary

- Requests have bounds, cancellation, and timeout handling in several adapters.
- There is no uniform retry, backoff, circuit-breaker, provider health, or resumable-download contract across all integrations. Marketplace model installs expose bounded status and cancellation, but do not yet provide resumable downloads. [TODO]

## Evidence

- `README.md`
- `docs/CAPABILITY_MATRIX.md`
- `docs/MODEL_LIBRARY.md`
- `docs/LOCAL_IMAGE_GENERATION.md`
- `apps/desktop/src/features/catalog/MarketplacePage.tsx`
- `native/SkaiDesktop.Core/Services/ModelLibraryService.cs`
- `native/SkaiDesktop.Core/Services/SkillPackageInstaller.cs`
- `native/SkaiDesktop.Core/Services/AuthoredSkillCatalog.cs`
- `native/SkaiDesktop.Core/Integrations/`
