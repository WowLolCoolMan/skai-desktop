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
| Chat and persistence | working | Agent Host `chat.complete`, local conversation storage, streaming/error states, text/PDF/image attachments, strict per-turn documents-only grounding, bounded local-model summaries for oversized history, retry, export/import, chat smoke | Summary quality and runtime acceptance across model sizes; broader provider and multi-pane acceptance |
| Voice input and output | partial | On-device-only one-shot dictation; hands-free turns submit local recognition results, speak replies through OS-native TTS, wait for local speech completion, and stop speech when hands-free is turned off; packaged Windows smoke confirms Electron's local recognition and installer APIs and verifies fail-closed messaging when en-US is unavailable | Microphone acceptance with an installed pack across supported runtimes; acoustic barge-in and streaming voice remain open |
| Local models | working | Ollama/OpenAI-compatible discovery, model selection, model library, benchmark metadata, Ollama context metadata discovery, local-only recovery, and a 1,048,576-token Ollama request contract exercised with a multi-megabyte history | More runtime adapters and resource scheduling; 1M-token execution is unverified on compatible hardware/models |
| AirLLM | partial | Core provider strategy, Agent Host route, packaged `airllm/skai_airllm.py` worker, and artifact smoke assertion exist | Managed Python dependency/runtime setup, model compatibility acceptance, and hardware-aware scheduling |
| Marketplace | working | Host-backed catalog/provider search, installed model routes, verified install review, packaged artifact smoke | More catalogs and download recovery UX |
| Projects and GitHub | partial | Local projects, Git review/push, GitHub integration docs and guarded operations | Full live GitHub permission/error matrix and richer worktree UX |
| Coding Agent / workbench | partial | Task artifacts, approvals, durable activity events, guarded worktree leases, Monaco-based project editor | Actual model/tool dispatch and background execution |
| Terminal and tools | partial | Host-backed terminal sessions, cancellation, secret-shaped environment filtering | Stronger OS sandboxing and cross-platform PTY acceptance |
| Settings and appearance | working | Persisted settings, themes, density, reduced motion, model/voice/host controls | Broader live accessibility matrix |
| Companion / Percy | partial | Separate transparent always-on-top Electron window, state-driven animation, placement guard, artifact smoke | Cross-platform packaged positioning and collision matrix |
| Images and media | partial | ComfyUI queue/poll flow, checkpoint discovery, built-in text-to-image and image-edit workflow templates, workflow import/save, and local vision attachment paths | Live generation acceptance, resumable jobs, richer artifact storage, capability gating |
| Memory and retrieval | partial | Local memory editor, approval/provenance, bounded injection and export | More retrieval sources and freshness evaluation |
| Skills, MCP, integrations | partial | Local skill catalog/install review, stdio/HTTP discovery, GitHub connection | Authenticated retrieval, notifications/resources, lifecycle health UI |
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
