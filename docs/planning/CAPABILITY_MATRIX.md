# Skai Desktop capability matrix

Snapshot: repository audit, 2026-11-23.

This is the current product-facing capability map for the Electron desktop
application. It is intentionally conservative: `working` means an implemented
path is covered by focused tests or smoke evidence; `partial` means the core
path exists but an important journey or platform acceptance remains; `planned`
means it is not yet implemented. A build alone never upgrades a feature to
`working`.

| Area | Status | Current evidence | Remaining boundary |
| --- | --- | --- | --- |
| Electron shell and navigation | working | Electron main/preload, React renderer, persistent workspace sidebar, launcher, 17-route packaged UI matrix (5 sizes × 4 theme/sidebar variants), packaged Windows Axe audit of 14 routes with zero WCAG violations or inconclusive contrast checks; skip-link focus, main landmark, Model Picker and overflow-menu popup semantics pass | User screen-reader and visual review across routes/themes; native Linux acceptance |
| Chat and persistence | working | Agent Host `chat.complete`, local conversation storage, streaming/error states, text/PDF/image/XLSX attachments, bounded local XLSX cell extraction without formula execution, bundled English PDF OCR that preserves selectable pages and OCRs only scanned pages (first 20 pages/16,000 characters; packaged smoke verifies mixed-PDF recognition), local MP4/WebM frame extraction (packaged Windows smoke verifies four WebM frame attachments; H.264 MP4 verifies four timestamped frames), strict per-turn documents-only grounding, bounded local-model summaries for oversized history, retry, Markdown export, previewed legacy JSON import with duplicate and collision protection, packaged chat smoke | WebM frame timestamps need verification with a fixture that reports usable duration; non-English OCR; successful audio transcription with an installed speech pack; summary quality and runtime acceptance across model sizes; broader provider and multi-pane acceptance |
| Voice input and output | partial | On-device-only one-shot dictation, local Whisper large-v3 microphone recording (WebM; five-minute and 20 MB caps), turn-based hands-free mode, Kokoro ONNX, Piper, and Chatterbox Nano local TTS adapters, Whisper local audio-file transcription, OS-native TTS; Marketplace voice inspectors now disclose the private runtime, recognition/synthesis package, model/voice data, and local output stage for the four supported adapters; packaged Windows smoke records/stops a microphone clip and confirms local Whisper completion while Chromium's en-US speech pack is unavailable; `npm run smoke:voice:acceptance` passes Kokoro and Piper WAV signal checks; Chatterbox smoke installs its pinned CPU runtime/checkpoint, verifies hashes and non-silent 24 kHz WAV output, and measures cold and warm synthesis on an 8-core Ryzen 7 5800X3D (warm: 3.04s audio in 3.36s; first request including model load: 2.56s audio in 23.64s) | Spoken-word quality remains unreviewed; one warm phrase is near real-time throughput but first-use model loading is slow, and neither result predicts quality or performance across devices. Permission denial/recovery, hands-free acceptance on a supported local speech pack, acoustic barge-in, custom reference-voice controls, and streaming voice remain open |
| Local models | working | Ollama/OpenAI-compatible discovery, model selection, model library, benchmark metadata, Ollama context metadata discovery, local-only recovery, and a 1,048,576-token Ollama request contract exercised with a multi-megabyte history | More runtime adapters and resource scheduling; 1M-token execution is unverified on compatible hardware/models |
| AirLLM | partial | Core provider strategy, Agent Host route, packaged `airllm/skai_airllm.py` worker, and artifact smoke assertion exist | Managed Python dependency/runtime setup, model compatibility acceptance, and hardware-aware scheduling |
| Marketplace | working | Host-backed catalog/provider search, install review, cancellable model downloads with progress, resume for Skai-managed ModelScope GGUF installs, published Hugging Face license metadata, device-fit advisory, and local workflow activation; current host smoke checks all 89 curated listings and verifies that exactly 41 have matching local adapters while unsupported listings have no install action; the curated `qwen3-coder:30b-a3b-q4_K_M` Ollama route exposes update/remove in Installed, and the host smoke verifies exact pull/delete requests through a disposable loopback runtime and rejects hosted removal; two installed Ollama GGUF models (2.05 GB and 9.28 GB) produced responses on a Windows host with 32 GiB RAM | Real curated package install/use/removal against a local runtime, remaining MCP/voice adapters, fit checks across hardware/GPU offload, and broader visual/keyboard acceptance |
| Projects and GitHub | partial | Local projects, Git review/push, GitHub integration docs and guarded operations | Full live GitHub permission/error matrix and richer worktree UX |
| Coding Agent / project session | partial | Project-linked conversations, durable task state and approvals, guarded worktree leases, Monaco editor, local model action loop with native Ollama tools or bounded JSON actions, three-repair cap, verification-aware completion, Windows and Ubuntu 24.04 WSL acceptance for Windows PSEC or Linux Bubblewrap/cgroup filesystem/network/process/memory limits, fail-closed command refusal on unsupported OSes, undo journal, reviewable results, explicit detected-check selection, and durable exit/output evidence beside the task diff; isolated Agent Host smoke covers tool-schema, fenced/malformed action recovery, retry cap, model-unavailable failure, one-slot queueing, and cancellation | Native Linux desktop acceptance, macOS sandbox adapter, multi-step planning and human decision pauses, parallel capacity-aware runs, and broader live acceptance |
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
