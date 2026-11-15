# Skai Desktop capability matrix

Snapshot: repository audit, 2026-11-15.

This is the current product-facing capability map for the Electron desktop
application. It is intentionally conservative: `working` means an implemented
path is covered by focused tests or smoke evidence; `partial` means the core
path exists but an important journey or platform acceptance remains; `planned`
means it is not yet implemented. A build alone never upgrades a feature to
`working`.

| Area | Status | Current evidence | Remaining boundary |
| --- | --- | --- | --- |
| Electron shell and navigation | working | Electron main/preload, React renderer, narrow global rail, project/conversation sidebar, launcher, route smoke, responsive overflow matrix | More packaged accessibility coverage on Linux |
| Chat and persistence | working | Agent Host `chat.complete`, local conversation storage, streaming/error states, text/PDF/image attachments, local MP4/WebM sampling into four timestamped JPEG frames (packaged Windows smoke verifies WebM and H.264 MP4), strict per-turn documents-only grounding, bounded local-model summaries for oversized history, retry, export/import, packaged chat smoke | Successful audio transcription with an installed speech pack; summary quality and runtime acceptance across model sizes; broader provider and multi-pane acceptance |
| Voice input and output | partial | On-device-only one-shot dictation and hands-free turns; local MP3/M4A/OGG/WAV transcription from an audio track into the draft; OS-native TTS; packaged Windows smoke confirms the local recognition and installer APIs and verifies audio/dictation fail closed when en-US is unavailable | Successful audio and microphone transcription with an installed pack; acoustic barge-in and streaming voice remain open |
| Local models | working | Ollama/OpenAI-compatible discovery, model selection, model library, benchmark metadata, Ollama context metadata discovery, local-only recovery, and a 1,048,576-token Ollama request contract exercised with a multi-megabyte history | More runtime adapters and resource scheduling; 1M-token execution is unverified on compatible hardware/models |
| AirLLM | partial | Core provider strategy, Agent Host route, packaged `airllm/skai_airllm.py` worker, and artifact smoke assertion exist | Managed Python dependency/runtime setup, model compatibility acceptance, and hardware-aware scheduling |
| Marketplace | working | Host-backed catalog/provider search, installed model routes, verified install review, cancellable model downloads with progress, retry through the reviewed install flow, packaged artifact smoke | More catalogs and resumable partial downloads |
| Projects and GitHub | partial | Local projects, Git review/push, GitHub integration docs and guarded operations | Full live GitHub permission/error matrix and richer worktree UX |
| Coding Agent / workbench | partial | Task artifacts and approvals, durable activity events, guarded worktree leases, Monaco-based project editor, background execution through the selected local model | Model-directed tool dispatch and project file edits; current task execution returns model reasoning only |
| Terminal and tools | partial | Host-backed terminal sessions, cancellation, secret-shaped environment filtering | Stronger OS sandboxing and cross-platform PTY acceptance |
| Settings and appearance | working | Persisted settings, themes, density, reduced motion, model/voice/host controls | Broader live accessibility matrix |
| Companion / Percy | partial | Separate transparent always-on-top Electron window, state-driven animation, placement guard, artifact smoke | Cross-platform packaged positioning and collision matrix |
| Images and media | partial | Optional managed Diffusers runtime; SD-Turbo weights downloaded and a local CPU image generated in Skai on 2026-11-15; bounded IndexedDB output history with prompt/provider metadata and gallery restore after restart; ComfyUI queue/poll flow, checkpoint discovery, built-in text-to-image and image-edit workflow templates, workflow import/save, local vision attachment paths, and packaged MP4/WebM sampling smoke | Live ComfyUI acceptance, image-edit execution in the built-in path, resumable jobs, inference progress/cancel, broader model controls, capability gating |
| Memory and retrieval | partial | Local memory editor, approval/provenance, bounded injection and export; imported corpus documents show recent, aging, or stale status from their saved update time | More retrieval sources and evaluation against changes to the original source |
| Skills, MCP, integrations | partial | Local skill catalog/install review, stdio/HTTP discovery, GitHub connection, MCP live health refresh with last-reported time and sanitized errors | Authenticated retrieval, notifications/resources |
| Updates and release | partial | RSA manifest verification, monotonic channel checks, artifact hashes, Electron packaging | Signing, notarization, installer/upgrade/rollback acceptance |

## Architecture rule

There is one desktop UI architecture: Electron + React + TypeScript backed by
the persistent .NET Agent Host. `native/SkaiDesktop.Core` is a headless domain
library used by the host and tests; it is not an alternate desktop shell. Uno,
XAML, native launchers, native packaging, and legacy fallback commands are not
supported project surfaces.

## Product boundary

Skai is local-only for model execution. It does not route prompts to hosted
providers or fall back to cloud inference. GitHub and public model catalogs are
separate, explicit integrations and do not receive chat prompts as model
providers.

## Evidence commands

```text
npm run check:syntax
npm run check:hygiene
npm run audit:electron-runtime
npm run desktop:typecheck
npm run desktop:build
npm run package:electron
npm run smoke:electron:artifact
npm run smoke:electron:themes
npm run smoke:electron:overflow
npm run smoke:windows
```
