# Skai Desktop capability matrix

Snapshot: repository audit, 2026-11-18.

This map is conservative: `working` requires a user-facing path and focused
test or smoke evidence; `partial` means the main path exists but meaningful
acceptance or workflow gaps remain; `planned` means it is not implemented. A
successful build alone does not upgrade a feature to `working`.

| Area | Status | Current evidence | Remaining boundary |
| --- | --- | --- | --- |
| Electron shell and navigation | working | Electron main/preload, React renderer, workspace tabs, Chat/Coding Agent switcher, route and overflow smoke | Broader packaged Linux accessibility acceptance |
| Chat and persistence | working | Local Agent Host chat, streaming/errors, text/PDF/image attachments, bounded local video frame sampling, document-only grounding, history compaction, retry, export/import, queue and persisted drafts | Successful installed-pack microphone/audio transcription; broader model-size and multi-pane acceptance |
| Voice input and output | partial | Local one-shot dictation and turn-based Voice Mode; OS-native TTS; local audio transcription path; Windows smoke verifies pack installation APIs and fails closed when en-US is unavailable | Successful speech-pack install and actual mic/audio transcription evidence; acoustic barge-in and streaming remain open |
| Local models | working | Ollama and OpenAI-compatible loopback runtime, model selection/library, context metadata, bounded 1M request contract and hardware suitability estimates | More runtime adapters; full 1M execution remains hardware/model dependent and unverified here |
| AirLLM | partial | Provider strategy, Agent Host route and packaged worker | Managed runtime/dependency install, compatible model acceptance and hardware scheduling |
| Marketplace | working | Host-backed catalog, reviewed installs, cancellation/progress/retry, Ollama curated catalog and runtime compatibility feedback | Resumable downloads and additional catalogs |
| Projects and GitHub | partial | Local projects, bounded editor/file operations, diff, commit/push/PR flow, explicit GitHub integration | Full live permission/error matrix and richer worktree UX |
| Coding Agent / project session | partial | Project-linked conversations, durable task states, local model tool loop, bounded file/command tools, undo, reviewable results; append-only per-task operation timeline records approval, file actions, command outcomes, verification and interrupted-run recovery; read-only project preflight detects manifests, required runtimes and suggested checks without executing them | Approved verification command execution/evidence beside the diff, richer streaming progress, review/apply patches as one action, parallel runs, stronger OS sandboxing |
| Terminal and tools | partial | Host-backed terminal sessions, cancellation and secret-shaped environment filtering | Stronger OS sandboxing and cross-platform PTY acceptance |
| Settings and appearance | working | Persisted settings, themes, density, motion and model/host controls | Broader live accessibility matrix |
| Pets and companions | partial | Seven built-ins, bounded sprite/behavior validation, walk-on entry and interaction effects, packaged Windows and UI matrix smoke | Live interaction acceptance across platforms, multi-monitor collision and accessibility |
| Images and media | partial | Managed Diffusers and ComfyUI flows, local generation/edit paths, saved workflows and bounded IndexedDB history | Live ComfyUI acceptance, robust inference progress/cancel and broader model controls |
| Memory and retrieval | partial | Local memory editor, approval/provenance, bounded injection/export, corpus freshness indicators | More retrieval sources and source-change evaluation |
| Skills, MCP and integrations | partial | Local skill catalog/install review, stdio/HTTP discovery, explicit permissions, GitHub integration and MCP health refresh | Authenticated retrieval, notifications/resources and lifecycle health UI |
| Updates and release | partial | Signed-manifest verification, monotonic channel checks, artifact hashes and Electron packaging | Signing/notarization plus installer, upgrade and rollback acceptance |

## Highest-priority remaining work

1. Add explicit verification evidence: let users select a detected project
   check to run, preserve exit status/output beside the task diff, and never run
   checks during preflight.
2. Complete local voice acceptance with an installed speech pack, a real
   microphone/audio fixture, cancellation and unavailable-language paths.
3. Add stronger OS-level isolation before expanding unattended or parallel
   execution.
4. Finish image generation/edit progress, cancellation, and runtime acceptance.
5. Complete installer signing, upgrade/rollback, and Linux acceptance.

These priorities stay within the local-first architecture. Remote device
control, cloud model execution/sync, team administration, and unattended
computer use are not near-term commitments; they require separate privacy,
security, and product decisions. Full 1M-token execution is not promised by a
request-contract test and depends on compatible model/runtime hardware.

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
npm run audit:future-features
npm run desktop:typecheck
npm run desktop:build
npm run package:electron
npm run smoke:electron:artifact
npm run smoke:electron:themes
npm run smoke:electron:overflow
npm run smoke:windows
npm run check:pet-assets
npm run test:pet
```
