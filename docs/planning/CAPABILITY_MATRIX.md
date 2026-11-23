# Skai Desktop capability matrix

Snapshot: repository audit, 2026-11-22.

This is the current product-facing capability map for the Electron desktop
application. It is intentionally conservative: `working` means an implemented
path is covered by focused tests or smoke evidence; `partial` means the core
path exists but an important journey or platform acceptance remains; `planned`
means it is not yet implemented. A build alone never upgrades a feature to
`working`.

| Area | Status | Current evidence | Remaining boundary |
| --- | --- | --- | --- |
| Electron shell and navigation | working | Electron main/preload, React renderer, narrow global rail, project/conversation sidebar, launcher, route smoke, responsive overflow matrix | More packaged accessibility coverage on Linux |
| Chat and persistence | working | Agent Host `chat.complete`, local conversation storage, streaming/error states, text/PDF/image/XLSX attachments, bounded local XLSX cell extraction without formula execution, local MP4/WebM sampling into four timestamped JPEG frames (packaged Windows smoke verifies WebM and H.264 MP4), strict per-turn documents-only grounding, bounded local-model summaries for oversized history, retry, Markdown export, previewed legacy JSON import with duplicate and collision protection, packaged chat smoke | OCR for scanned PDFs; successful audio transcription with an installed speech pack; summary quality and runtime acceptance across model sizes; broader provider and multi-pane acceptance |
| Voice input and output | partial | On-device-only one-shot dictation, local Whisper large-v3 microphone recording (WebM; five-minute and 20 MB caps), turn-based hands-free mode, Kokoro ONNX and Piper local TTS adapters, Whisper local audio-file transcription, OS-native TTS; packaged Windows smoke verifies local audio transcription and clearly fails closed when the en-US dictation pack is unavailable | Real-microphone recording/transcription acceptance, hands-free acceptance on a supported local speech pack, acoustic barge-in, and streaming voice remain open |
| Local models | working | Ollama/OpenAI-compatible discovery, model selection, model library, benchmark metadata, Ollama context metadata discovery, local-only recovery, and a 1,048,576-token Ollama request contract exercised with a multi-megabyte history | More runtime adapters and resource scheduling; 1M-token execution is unverified on compatible hardware/models |
| AirLLM | partial | Core provider strategy, Agent Host route, packaged `airllm/skai_airllm.py` worker, and artifact smoke assertion exist | Managed Python dependency/runtime setup, model compatibility acceptance, and hardware-aware scheduling |
| Marketplace | working | Host-backed catalog/provider search, install review, cancellable model downloads with progress, resume for Skai-managed ModelScope GGUF installs, published Hugging Face license metadata, device-fit advisory, and local workflow activation; packaged smoke confirms Models and Tools → Installed inventory remain in Marketplace | More verified adapters, fit checks against real models/runtimes, and broadened visual/keyboard acceptance |
| Projects and GitHub | partial | Local projects, Git review/push, GitHub integration docs and guarded operations | Full live GitHub permission/error matrix and richer worktree UX |
| Coding Agent / project session | partial | Project-linked conversations, durable task state and approvals, guarded worktree leases, Monaco editor, local model action loop with bounded read/write tools, Windows and Ubuntu 24.04 WSL acceptance for Windows PSEC or Linux Bubblewrap/cgroup filesystem/network/process/memory limits, fail-closed command refusal on unsupported OSes, undo journal, reviewable results, explicit detected-check selection, and durable exit/output evidence beside the task diff | Native Linux desktop acceptance, macOS sandbox adapter, parallel capacity-aware runs, and broader live acceptance |
| Terminal and tools | partial | Host-backed interactive terminal sessions; approved commands have an explicit environment allowlist, OS-specific filesystem/network/process-tree containment on Windows/Linux, and are refused where Skai cannot establish its sandbox | Cross-profile sandbox and cross-platform PTY acceptance; interactive Terminal remains a user-opened host shell |
| Settings and appearance | working | Persisted settings, themes, density, reduced motion, model/voice/host controls | Broader live accessibility matrix |
| Pets and companions | partial | Seven built-ins exposed in Workshop; eleven-cell 256×256 strips with exact rest-pose seams; adjustable bounded blink timing; per-pet idle/walk behaviors; Blaze approach, pounce, large fire plume and impact effects; local Stable Diffusion Turbo/ComfyUI concept generation; asset/behavior checks; packaged Windows smoke and a 17-route × 5-size × 4-variant UI matrix | Live attack/pointer visual acceptance, Linux compositor behavior, multi-monitor collision and accessibility acceptance |
| Images and media | partial | Optional managed Diffusers runtime; packaged Windows acceptance generated and edited local 512×512 JPEGs, cancelled active inference, and restored both outputs after reload; actual progress reported (text 4/4, edit 2/2); missing-runtime/model recovery smokes pass; ComfyUI queue/poll and scoped cancellation are covered in provider tests; packaged MP4/WebM sampling smoke | Live ComfyUI acceptance, GPU and additional hardware validation, resumable jobs/downloads, broader model controls, and capability gating |
| Memory and retrieval | partial | Local memory editor, approval/provenance, bounded injection and export; imported corpus documents show recent, aging, or stale status from their saved update time; persona research accepts any requested name with explicit weak/ambiguous identity evidence rather than silently claiming a match | More retrieval sources and evaluation against changes to the original source |
| Skills, MCP, integrations | partial | Local skill catalog/install review, stdio/HTTP discovery, GitHub connection, MCP live health refresh with last-reported time and sanitized errors | Authenticated retrieval, notifications/resources |
| Updates and release | partial | RSA manifest verification, monotonic channel checks, artifact hashes, Electron packaging, unsigned Windows 0.1.3 → 0.1.4 install/upgrade/uninstall and loopback-feed update passed; Linux AppImage loopback-feed update and rollback passed under WSL2 with data retention; published 0.1.4 Linux feed downloaded, verified, installed, and reopened the real AppImage in an isolated profile; public Windows/Linux feed metadata and asset sizes pass HTTPS checks | Published 0.1.4 updater predates in-app rollback; native Linux desktop acceptance and signed metadata remain open; production signing is deferred by the owner |

## Architecture rule

There is one desktop UI architecture: Electron + React + TypeScript backed by
the persistent .NET Agent Host. `native/SkaiDesktop.Core` is a headless domain
library used by the host and tests; it is not an alternate desktop shell. Uno,
XAML, native launchers, native packaging, and legacy fallback commands are not
supported project surfaces.

## Product boundary

Current releases support local model execution only. Optional user-connected
cloud and hybrid model routes are an approved product direction, but are not
implemented or available in the shipped app yet. GitHub and public model
catalogs remain separate integrations and do not currently receive chat prompts
as model providers. The provider-gateway plan requires explicit routing,
OS-protected credentials, remote-data disclosure, no silent fallback, and an
offline-only mode before hosted inference can be advertised as working.

## Evidence commands

```text
npm run check:syntax
npm run check:hygiene
npm run audit:electron-runtime
npm run desktop:typecheck
npm run desktop:build
npm run package:electron
npm run smoke:electron:artifact
npm run smoke:voice:acceptance
npm run check:release-readiness
npm run smoke:electron:themes
npm run smoke:electron:overflow
npm run smoke:windows
npm run check:pet-assets
npm run test:pet
```

See [Pets and companions](../guides/PETS_AND_COMPANIONS.md) for behavior details and the
limits of the current smoke evidence.
