# Skai Desktop — Future Features

This is the product backlog for future capabilities. It is intentionally broader
than the current release roadmap. Features should be implemented one bounded
vertical slice at a time, starting with the simplest useful item, and checked
off only after the feature works in the Electron app with the appropriate tests
and acceptance evidence.

## How to use this list

- Keep this document in sync with the repository and review it before starting
  a new feature.
- Choose the simplest unblocked feature that advances the product, then split
  it into a small, reviewable implementation slice.
- Record design, privacy, platform, and licensing constraints before adding a
  dependency or promising a capability.
- Move completed items to the implemented state only after the user-facing
  workflow and failure states are verified.

## Current product boundary

Skai Desktop is local-only. The application does not use hosted model
providers, cloud model execution, cloud sync, remote model routing, or cloud
fallbacks. The local path may use a model server already running on this
computer or AirLLM running locally. Prompts, attachments, credentials, and
application state stay on this computer unless the user explicitly starts a
separate external integration workflow such as GitHub.

Any older backlog item that mentions cloud execution, cloud compute, hosted
accounts, cloud sync, or remote device control is retained as historical
product research only and is not a commitment for Skai Desktop. New features
must preserve the local-only boundary and provide explicit provider selection,
cancellation, permission review, and local credential handling.

## Core chat

- [x] Visible user-selected Chat/Think, Coding, and Security/Risky modes. The active mode is selectable in the conversation header, persists with chats and forks, and is passed as local model context in chat and coding-task requests. Skai does not classify prompts, filter topics, or add mode-specific refusals.
- [x] Multi-model picker supporting any compatible provider.
- [x] Side-by-side model comparison.
- [x] File, image, and PDF upload with bounded local retrieval-augmented context. (Selectable-text PDFs, supported images, and text attachments are policy-checked; broader extraction and semantic retrieval remain open.)
- [x] Web search with citations.
- [x] Persistent memory with a view/edit management UI.
- [x] Message queueing while the AI is responding.
- [x] Folders, tags, and pinned chats.
- [x] Search within the current chat and jump to a matching message.
- [x] Fork a chat from any message.
- [ ] Voice input/output, hands-free calls, and advanced voice mode. (OS-native speech output, one-shot dictation, and a hands-free local turn loop that speaks each reply and pauses listening until speech finishes are implemented; MP3/M4A/OGG/WAV files can also be transcribed from a local media track into the draft. The packaged Windows smoke confirms Electron exposes local recognition and its installer API, but this machine reports the en-US pack unavailable and verifies fail-closed behavior; successful microphone/audio transcription and acoustic barge-in/streaming voice remain open.)
  - [ ] Image generation and editing. (Managed Diffusers setup, the 5.2 GB SD-Turbo download, and local CPU generation were exercised in Skai on 2026-11-15. Recent outputs now persist in bounded local IndexedDB history (up to 24 records / 32 MiB of URL data) with prompt and provider metadata; Diffusers image bytes are retained locally, while ComfyUI history stores local output URLs. The built-in Diffusers path now accepts a validated local PNG/JPEG and runs image-to-image inference; the same source picker works with ComfyUI. Restart recovery is implemented and the persistent database/blob were observed after relaunch, but visual gallery-reopen and built-in edit live acceptance remain open. ComfyUI live acceptance, model library, and inference progress/cancel also remain open.)
- [x] Context compaction. (Oversized histories now use a bounded summary from the selected local model before falling back to deterministic omission; recent turns and system instructions are retained, and generated summaries are marked as untrusted reference. Summary quality and runtime acceptance across model sizes remain open.)
- [ ] 1M+ token context support. (Opt-in Ollama context windows up to 1M tokens, bounded request payloads, model-context discovery, and a multi-megabyte 1,048,576-token request contract check are implemented; this computer's installed models currently advertise up to 262,144 tokens, so 1M execution with a compatible local model remains unverified.)
- [ ] Omni-modal input for text, images, audio, and video. (Images and text attachments are supported; MP4 and WebM can be selected or dropped, with four timestamped frames sampled locally and attached as images under a 20 MB/15-minute limit. Packaged Windows smoke verifies WebM and H.264 MP4 decoding. MP3/M4A/OGG/WAV transcription uses on-device speech recognition and leaves the transcript in the draft; the required speech pack is unavailable on the acceptance machine, so successful audio transcription remains unverified.)
- [x] Chat export and split view.
- [x] NotebookLM-style mode grounded only in documents attached to the current turn. (Composer toggle adds a strict grounding prompt, requires a current-turn attachment, and skips memory, project, and skill context; durable corpus retrieval is separate.)

## Agents and tools

- [ ] Computer use with screen, keyboard, and mouse control.
- [ ] Built-in browser panel.
- [ ] Python sandbox execution.
- [ ] Parallel sub-agent delegation.
- [x] Scheduled automations. (Local scheduled runs support create, pause, resume, cancel, and run-now; recurring and unattended reliability remain open.)
- [x] Structured task lists. (Persisted local agent task plans with dependency-aware readiness, queue, search, and cancellation; autonomous dispatch remains open.)
- [x] MCP tools over Streamable HTTP and stdio. (Explicit grants, revocation, read-only defaults, and protocol smoke coverage are implemented; richer lifecycle UI remains open.)
- [x] OpenAPI tool auto-discovery. (Bounded local discovery is implemented; authenticated retrieval and broader schema coverage remain open.)
- [x] Git panel for stage, commit, push, and pull requests. (Guarded local project workflow is implemented; richer selective staging and live permission/error acceptance remain open.)
- [ ] Coding-agent model integrations, including Claude Code and Codex.
- [ ] AI planning mode: plan, execute, verify, iterate, retry, and pause for human decisions.
- [ ] Auto mode for unattended agent execution.
- [ ] Background tasks.
- [ ] Learning loop from past interactions.
- [ ] Dispatch tasks from a phone to the desktop.
- [ ] Nested sessions for subtasks.
- [ ] Parallel sessions with Git isolation.
- [ ] Coordinator, specialist, and verifier architecture with a shared living specification.
- [ ] Containerized parallel agents with Docker and IDE synchronization.
- [ ] Background computer use while the user works elsewhere.
- [ ] Autonomous open-weight model agent.
- [ ] Headless/daemon mode for local CI integration (cloud deployment remains outside the local-only product boundary).
- [ ] Portable local harness with orchestrator, models, tools, and queue.
- [ ] Hybrid cloud/local compute split (outside the current local-only product boundary; retained as historical research only).
- [ ] Fully offline local-first agent mode.
- [ ] Remote device access for controlling a desktop elsewhere.

## Retrieval and knowledge

- [ ] Multiple vector database backends.
- [ ] Hybrid search with BM25, vector search, and reranking.
- [ ] Multiple document-extraction engines.
- [ ] Agentic retrieval that browses documentation.
- [x] Full-text context injection. (Explicit Advanced generation option for bounded text/PDF attachment content; query-ranked retrieval remains the default.)
- [ ] Nested file browser with preview. (The bounded local browser renders a collapsible directory tree, preserves safe relative paths, and auto-expands matching search results. PNG/JPEG previews and selectable PDF text are read locally through bounded allowlists; full PDF page rendering, file mutation, and packaged acceptance remain open.)
- [ ] Projects that group chats, shared knowledge, and context.
- [ ] Saved environments for reusable folders, SSH hosts, and cloud contexts.
- [x] File connectors that open, edit, and save files directly. (Bounded local project browser and approved file operations are implemented.)
- [x] Integrated file editor that writes approved changes back to disk. (Review, save, undo, and bounded path checks are implemented.)
- [x] Visual diff review. (Project Git diff inspection is implemented; selective staging remains open.)
- [x] Memory management UI for viewing and editing remembered information. (Local search, edit, enable/disable, export, and safe import are implemented.)

## Workspace and desktop experience

- [ ] Capacity-aware concurrent local runs. (First UI slice implemented: the chat header now compares known model size plus rough startup headroom against measured available RAM, reports context and GPU memory separately, and clearly labels the estimate as advisory. Runtime-specific context allocation, loaded model accounting, hardware budgets, AirLLM-aware scheduling, and queue dispatch remain open.)

- [ ] Interactive artifacts for code, HTML, and diagrams.
- [ ] Tabs beside chat for files, terminals, and previews.
- [ ] In-browser terminal.
- [ ] Rich Markdown editor with in-place AI enhancement.
- [ ] Notes with context injection.
- [ ] Channels with model tagging and threads.
  - [x] System-wide hotkey and launcher integration. (The resident Electron app can be brought to the foreground with `Ctrl+Alt+Space` on Windows/Linux or `Cmd+Alt+Space` on macOS; the existing tray and second-instance paths remain available.)
- [ ] Screen capture and screen awareness.
- [ ] Live presence.
- [ ] End-to-end encrypted direct messages.
- [ ] Clipboard history with AI search.
- [ ] Unified screen, audio, and application context capture.
- [ ] Active-window context injection.
- [ ] Dictation that combines speech with automatic app context.
- [ ] File and app previews. (Local text, PNG/JPEG, and selectable-text PDF previews exist; app/executable previews remain unsupported.)
- [ ] Design handoff to a coding agent.
- [ ] Session bar showing context, changes, and background tasks. (A local informational workspace bar shows mode, message context, pending files, reviewed changes, and queued agent plans; live background status remains open.)
- [x] Side chats spawned with a keyboard shortcut. (Ctrl+Shift+S opens the existing bounded side-by-side chat view; detached windows and new parallel threads remain open.)
- [ ] Detachable chats in their own windows.
- [ ] Drag-and-drop pane layouts.
- [x] Custom themes. (Light/dark palettes plus persisted Deep Sea and Deep Space ambient presets with reduced-motion support.)
- [ ] Cloud sync across devices (outside the current local-only product boundary; requires a future product/privacy decision).
- [x] Built-in translator. (Review-first translation through the selected model with explicit composer insertion.)
- [x] Text snippets with AI expansion. (Bounded local save/insert plus review-first model expansion.)
- [ ] Window management.
- [x] Quicklinks for frequent-access bookmarks. (Bounded local http/https bookmarks with explicit open and remove actions.)
- [x] In-app documentation.
- [x] Developer mode. (Persisted local-only diagnostics toggle with bounded runtime inspection.)
- [ ] Global quick-AI fallback for non-command input.
- [ ] Native multi-session sidebar with drag-and-drop panes.
- [x] Persist composer drafts and attachments per workspace tab, with a bounded recently closed tab list and restore action.
- [x] Resume the active persisted chat or project workspace session after startup, preferring its conversation/project over the legacy global selection and preserving the user's last non-workspace destination.
- [x] Restore the active project file tab and keep unsaved editor drafts per project/file in bounded local storage; closing an editor tab retains its draft for reopening.

## Models, runtime, and extensibility

- [x] Presets bundling prompts, tools, and knowledge. (Bounded local AI presets can bundle user-authored instructions, explicitly marked reference knowledge, and descriptive tool guidance; activation is explicit and tool guidance never grants permissions.)
- [x] Dynamic variables such as `{{USER_NAME}}` and `{{DATE}}`.
- [x] Lazy-loaded Markdown instruction-pack skills with `$` mentions. (Built-in and enabled local Markdown skills resolve only when explicitly mentioned in a chat request; instructions are bounded and never grant permissions.)
- [x] Local model runner support for Ollama and LM Studio. (Loopback discovery, selection, model-library inventory, and bounded install/load paths are implemented.)
- [ ] Offline-capable operation.
- [x] OpenAI-compatible API for local servers. (Loopback-compatible local endpoints are supported; cloud endpoints and hosted API keys are intentionally unsupported.)
- [ ] Plugin and pipeline framework.
- [ ] Community tool library.
- [ ] Third-party extensions that provide their own AI models.
- [ ] NPU/GPU/CPU auto-routing through Windows AI Foundry.
- [ ] On-device LoRA fine-tuning.
- [ ] Bring-your-own-key with credit-based pricing (hosted execution is outside the current product boundary).
- [ ] React/TypeScript extension SDK.
- [ ] Team-shared commands, snippets, and private extension store.
- [ ] One-time purchase/no-subscription option.
- [x] Model Council that merges answers from multiple models. (Bounded comparison answers can be sent to the selected model for review-first synthesis; automatic routing and durable council history remain open.)
- [x] Effort modes: Light, Standard, High, and Ultra. (Persisted local choice maps to bounded compatible-provider output budgets; provider-specific reasoning controls remain open.)
- [x] Adaptive reasoning depth. (Adaptive effort selects a bounded 512/1,024/2,048/4,096 output budget from request size; provider-native reasoning controls remain open.)
- [ ] Speculative decoding with DFlash, DSpark, or MTP drafters.
- [ ] Tensor parallelism across GPUs.
- [ ] Continuous batching and parallel requests.
- [ ] KV-cache checkpointing for agentic workflows.
- [ ] Specialized inference engines such as Splash.
- [ ] Per-token cloud pricing and usage visibility (hosted execution is outside the current product boundary).
- [ ] Open-weight Decisions API for classification and routing.

## Administration and teams

- [ ] Role-based access control and user groups.
- [ ] LDAP, SSO, OIDC, and SCIM provisioning.
- [ ] Analytics dashboards for tokens and per-user usage.
- [ ] Model arena and ELO leaderboards.
- [ ] Webhooks.
- [ ] Per-user isolated environments.
- [ ] Workspace-wide retention, sharing, and training policies.
- [ ] Centralized billing.
- [ ] Zapier automation.
- [ ] HIPAA workspaces.
- [ ] Audit logs.
- [ ] Organization-wide retention policies.
- [ ] Private extension store.

## Files, environments, and delivery

- [ ] Saved reusable environments for local and remote resources.
- [ ] PR monitoring.
- [ ] App previews.
- [ ] Design-to-code handoff.
- [ ] Shared living documents with team editing.
- [ ] Publish/share artifacts on the web.
- [ ] Publish web pages through a Sites-style workflow.
- [ ] Document, slide, and spreadsheet generation in chat.
- [ ] Presentation generation.
- [ ] On-canvas design editing with design-system import.
- [ ] Inline charts and 3D visuals.

## Content generation and meetings

- [ ] Deep research with autonomous multi-step web research and a report.
- [x] Gems/personas saved as reusable AI configurations. (Bounded local persona save, activate/deactivate, delete, and future-chat prompt injection; bundled tools/knowledge and cloud sync remain open.)
- [ ] Meeting notes with AI synthesis, including handwritten notes to structured summaries.
- [ ] Real-time transcription without a bot joining the call.
- [ ] AI-enhanced handwritten notes.
- [ ] Custom meeting templates.
- [ ] People and Companies views.
- [ ] Shared folders.
- [ ] Cross-meeting AI chat, such as “what did we agree last month?”.
- [ ] MCP access to meeting notes for other AI tools.
- [ ] Slack, Notion, Zapier, HubSpot, and Attio integrations.
- [ ] Apple Watch companion app.
- [ ] Multi-language meeting support.
- [ ] Meeting model-training opt-out.
- [ ] Personal voice training and voice cloning for TTS.
- [ ] System-wide dictation with AI post-processing.

## Ecosystem and platform

- [ ] Native Microsoft Office integration.
- [ ] Native Google Workspace, Calendar, Mail, and Drive integration.
- [ ] Floating always-accessible overlay bar.
- [ ] Phone call capability.
- [ ] iPhone/iPad companion app.
- [ ] Encrypted remote tunnels such as Tailscale or LM Link.
- [ ] Remote access to desktop models from mobile.
- [ ] OS-native sandboxing.
- [ ] One-time purchase option.
- [ ] MLX optimization for Apple Silicon.
- [ ] Windows AI Foundry routing.

## Reference

The backlog was collected from product research and the requested capability
set. AirLLM is one referenced project for large-context and model-runtime
exploration: <https://github.com/lyogavin/airllm>. Any future code reuse or
integration must go through the repository's licensing, security, privacy, and
platform review requirements.
