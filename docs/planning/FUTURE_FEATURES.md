# Skai Desktop — Future Features

Longer-term proposals live here. The [active queue](TO_DO_NEXT.md) owns near-term
work; the [capability matrix](CAPABILITY_MATRIX.md) owns current status. Keep
entries outcome-oriented, split delivery into reviewable slices, and verify
the user workflow before marking an item complete.

Product boundary: shipped inference is local. Optional user-connected cloud
and hybrid routes are planned in the [provider gateway plan](implementation-plans/provider-gateway.md);
they require explicit routing, protected credentials, clear data disclosure,
and offline-only behavior. Skai does not resell provider access. Cloud sync,
remote device control, teams, and unattended computer use require separate
product decisions. A request-size limit does not prove 1M-token execution.

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
- [ ] Voice input/output, hands-free calls, and advanced voice mode. (OS-native speech output, one-shot dictation, and an explicit Voice Mode panel with listening/waiting/end controls are implemented; the turn loop speaks each reply and pauses listening until speech finishes. MP3/M4A/OGG/WAV files produce local transcript attachments. The packaged Windows smoke confirms Electron exposes local recognition and its installer API, but this machine reports the en-US pack unavailable and verifies fail-closed behavior; successful microphone/audio transcription and acoustic barge-in/streaming voice remain open.)
  - [ ] Image generation and editing. (Packaged Windows acceptance with cached SD-Turbo weights now covers text-to-image, image-to-image, active cancellation, history restoration after reload, and missing-runtime/model recovery. Outputs are stored in bounded local IndexedDB history. Live ComfyUI, GPU/additional hardware, resumable work, and broader model controls remain open; see the [image-generation guide](../guides/LOCAL_IMAGE_GENERATION.md).)
- [x] Context compaction. (Oversized histories now use a bounded summary from the selected local model before falling back to deterministic omission; recent turns and system instructions are retained, and generated summaries are marked as untrusted reference. Summary quality and runtime acceptance across model sizes remain open.)
- [ ] 1M+ token context support. (Opt-in Ollama context windows up to 1M tokens, bounded request payloads, model-context discovery, and known-incompatible model preflight are implemented; this computer's installed models currently advertise up to 262,144 tokens, so 1M execution with a compatible local model remains unverified.)
- [ ] Omni-modal input for text, images, audio, and video. (The composer now has one Add menu for files/folders, local audio transcription, one-shot voice input, and hands-free Voice Mode. Images and text attachments are supported; MP4 and WebM can be selected or dropped, with four timestamped frames sampled locally and attached as images under a 20 MB/15-minute limit. Packaged Windows smoke verifies WebM and H.264 MP4 decoding. MP3/M4A/OGG/WAV transcription uses on-device speech recognition and produces a reviewable local audio-transcript attachment; the required speech pack is unavailable on the acceptance machine, so successful audio transcription remains unverified.)
- [x] Chat export and split view.
- [x] NotebookLM-style mode grounded only in documents attached to the current turn. (Composer toggle adds a strict grounding prompt, requires a current-turn attachment, and skips memory, project, and skill context; durable corpus retrieval is separate.)

## Agents and tools

- [ ] Computer use with screen, keyboard, and mouse control.
- [ ] Built-in browser panel.
- [ ] Python sandbox execution.
- [ ] Parallel sub-agent delegation.
- [x] Scheduled automations. (Open-host local scheduled runs now claim due entries, execute through the configured loopback model, persist bounded success/failure outcomes, and reschedule successful recurrences; restart recovery and cloud scheduling remain intentionally out of scope.)
- [x] Structured task lists. (Persisted local agent task plans with dependency-aware readiness, queue, search, cancellation, and conversation-linked status cards; the originating thread is the user-facing review surface.)
- [x] MCP tools over Streamable HTTP and stdio. (Explicit grants, revocation, read-only defaults, protocol smoke coverage, and a Marketplace lifecycle inspector with connection health, manifest freshness, grouped tool risk, and approval-boundary messaging are implemented.)
- [x] OpenAPI tool auto-discovery. (Bounded local discovery is implemented; authenticated retrieval and broader schema coverage remain open.)
- [x] Git panel for stage, commit, push, and pull requests. (Guarded local project workflow is implemented; richer selective staging and live permission/error acceptance remain open.)
- [ ] Coding-agent model integrations, including Claude Code and Codex.
- [ ] AI planning mode: plan, execute, verify, iterate, retry, and pause for human decisions.
- [ ] Auto mode for unattended agent execution.
- [x] Background tasks. (Queued local coding tasks now auto-dispatch through a conservative single-run scheduler, preserve queued/running/cancelled state, and start the next task when the current one finishes. Capacity-derived parallel execution remains open.)
- [ ] Learning loop from past interactions.
- [ ] Dispatch tasks from a phone to the desktop.
- [ ] Nested sessions for subtasks.
- [ ] Parallel sessions with Git isolation.
- [ ] Coordinator, specialist, and verifier architecture with a shared living specification.
- [ ] Containerized parallel agents with Docker and IDE synchronization.
- [ ] Background computer use while the user works elsewhere.
- [ ] Autonomous open-weight model agent.
- [ ] Headless/daemon mode for local CI integration. (Cloud deployment needs a separate security and operations review.)
- [ ] Portable local harness with orchestrator, models, tools, and queue.
- [ ] Hybrid local/cloud compute split. (Approved direction; provider routing and per-task disclosure must be implemented first.)
- [ ] Fully offline local-first agent mode.
- [ ] Remote device access for controlling a desktop elsewhere.

## Retrieval and knowledge

- [ ] Multiple vector database backends.
- [ ] Hybrid search with BM25, vector search, and reranking.
- [ ] Multiple document-extraction engines.
- [ ] Agentic retrieval that browses documentation.
- [x] Full-text context injection. (Explicit Advanced generation option for bounded text/PDF attachment content; query-ranked retrieval remains the default.)
- [ ] Nested file browser with preview. (The bounded local browser renders a collapsible directory tree, preserves safe relative paths, and auto-expands matching search results. PNG/JPEG previews and bounded inline PDF rendering are read locally; oversized PDFs fall back to selectable text. File mutation and packaged acceptance remain open.)
- [ ] Projects that group chats, shared knowledge, and context.
- [ ] Saved environments for reusable folders, SSH hosts, and cloud contexts.
- [x] File connectors that open, edit, and save files directly. (Bounded local project browser and approved file operations are implemented.)
- [x] Integrated file editor that writes approved changes back to disk. (Review, save, undo, and bounded path checks are implemented.)
- [x] Visual diff review. (Project Git diff inspection is implemented; the project workspace now supports bounded per-file selection for diff review and commits. Interactive hunk/line staging remains open.)
- [x] Memory management UI for viewing and editing remembered information. (Local search, edit, enable/disable, export, and safe import are implemented.)

## Workspace and desktop experience

- [ ] Capacity-aware concurrent local runs. (The chat header compares known model size plus rough startup headroom against measured available RAM, reports context and GPU memory separately, and clearly labels the estimate as advisory. Durable local coding tasks now use conservative live RAM/GPU/CPU-derived admission with a four-slot cap, optional persisted RAM/VRAM budgets, a reported limiting resource, model-specific size/context estimates, verified AirLLM readiness, and bounded Ollama loaded-model accounting; provider-specific KV-cache/offload formulas and loaded-model accounting for other runtimes remain open.)

- [ ] Interactive artifacts for code, HTML, and diagrams. (The project workspace now provides sandboxed, draft-aware HTML and SVG/diagram previews without script or Electron privileges; richer interactive artifacts remain open.)
- [ ] Tabs beside chat for files, terminals, and previews.
- [x] In-browser terminal. (Project sessions open a persistent terminal dock in place; the standalone terminal destination remains available elsewhere.)
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
- [ ] Session bar showing context, changes, and background tasks. (The project workspace now shows connected folders, changed/unsaved files, diff readiness, and project-scoped background task status alongside the existing shortcuts; richer shared capacity and background process controls remain open.)
- [x] Side chats spawned with a keyboard shortcut. (Ctrl+Shift+S opens the existing bounded side-by-side chat view; detached windows and new parallel threads remain open.)
- [ ] Detachable chats in their own windows.
- [ ] Drag-and-drop pane layouts.
- [x] Custom themes. (Light/dark palettes plus persisted Deep Sea and Deep Space ambient presets with reduced-motion support.)
- [ ] Cloud sync across devices (requires a separate product/privacy decision; model-provider support does not imply sync).
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

- [x] Marketplace → Tools → Installed inventory. (Searchable local inventory groups discovered models, configured MCP servers, Skai built-ins, installed skills, local voice profiles, and image assets; discovery remains in its catalog sections.)

- [x] Presets bundling prompts, tools, and knowledge. (Bounded local AI presets can bundle user-authored instructions, explicitly marked reference knowledge, and descriptive tool guidance; activation is explicit and tool guidance never grants permissions.)
- [x] Dynamic variables such as `{{USER_NAME}}` and `{{DATE}}`.
- [x] Lazy-loaded Markdown instruction-pack skills with `$` mentions. (Built-in and enabled local Markdown skills resolve only when explicitly mentioned in a chat request; instructions are bounded and never grant permissions.)
- [x] Local model runner support for Ollama and LM Studio. (Loopback discovery, selection, model-library inventory, and bounded install/load paths are implemented.)
- [ ] Offline-capable operation.
- [x] OpenAI-compatible API for local servers. (Loopback-compatible local endpoints are supported. Cloud endpoints and hosted API keys remain unavailable until the provider gateway is implemented.)
- [ ] Plugin and pipeline framework.
- [ ] Community tool library.
- [ ] Third-party extensions that provide their own AI models.
- [ ] NPU/GPU/CPU auto-routing through Windows AI Foundry.
- [ ] On-device LoRA fine-tuning.
- [ ] User-managed provider connections and credentials. (Approved direction; tracked in the provider-gateway plan. No Skai credit resale.)
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
- [ ] Verified remote-provider usage details when supplied by the provider. (Never infer or fabricate token/cost metrics.)
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

## Additional high-value proposals (2026-11-16)

These candidates were reviewed before being added. They are proposals, not
committed release promises. Existing items elsewhere in this backlog remain the
source of truth when a proposal overlaps a broader planned capability.

### Chat and user workflow

- [ ] Context preview showing which messages, files, memories, and project
  instructions will be sent before a request starts.
- [ ] Context receipt showing what the model actually received, including
  omitted, truncated, or summarized content.
- [ ] Attachment citations that jump to the exact page, section, or passage in
  a local document.
- [ ] Decision bookmarks for pinning important answers inside a chat without
  pinning the entire conversation.
- [ ] Project context controls for choosing which folders and instruction sets
  a thread can use.
- [ ] Per-thread or per-project local model and generation settings.
- [ ] Universal keyboard switcher for finding chats, projects, files, tasks,
  and models from one search.
- [ ] Reusable task brief templates with instructions and verification steps.
- [ ] Context size warnings before a request exceeds the selected model's
  practical context budget.
- [ ] Accessibility controls for contrast, text size, focus behavior, and
  reduced motion in one place.
- [ ] Workspace export and import for moving selected chats, settings, skills,
  and task templates between local installs.
- [ ] Data retention controls for choosing how long local histories, generated
  media, and task logs are kept.

### Coding workspace and agent review

- [ ] Review and apply agent patches as one explicit, reviewable action.
- [ ] Inline diff comments that can be sent back as agent guidance for specific
  changed lines.
- [ ] A consolidated approval inbox for pending file writes, commands, and
  integrations, showing the scope and reason for each request.
- [x] A task change timeline linking what the agent read, proposed, changed,
  and verified. (Coding tasks now append local approval, file action, command
  outcome, verification, and restart reconciliation events; the thread shows a
  chronological activity disclosure. File contents and raw shell commands are
  excluded.)
- [ ] Worktree review and recovery to inspect isolated changes, apply selected
  files, or recover work after an interrupted run.
- [ ] Repository map showing key folders, entry points, and dependencies.
- [ ] Per-project run profiles for saving build, launch, and verification
  commands for reviewed use.
- [ ] Verification evidence panel placing command output and results beside
  the files changed by a task.
- [ ] App preview pane for a local web app beside its task conversation and
  editor, with an explicit port and origin.
- [ ] Project setup guide that detects missing runtimes or dependencies and
  explains local setup steps.
- [ ] Project preflight checks for required files, runtimes, repository state,
  and configured verification commands before a task starts.
- [ ] Configuration drift detection for noticing when project settings or
  environment assumptions differ from the last successful run.
- [ ] Local secret-exposure warnings for proposed changes that appear to add
  credentials, private keys, or other secret-shaped values.
- [ ] Citation validity checks that identify missing or mismatched references
  in model answers before export or handoff.
- [ ] Stale task detection for plans that refer to files or project state that
  changed after the plan was created.
- [ ] Project readiness watcher that updates readiness when required files,
  runtimes, or repository state change.
- [ ] Saved local model evaluation sets for comparing results against the same
  prompts over time.

### Background reliability and local operations

- [ ] Automatic bounded local backups with versioned snapshots and a clear
  restore path.
- [ ] Crash recovery for restoring drafts, open files, and in-progress task
  state after an app or Agent Host restart.
- [ ] Database integrity checks with safe recovery for corrupted local
  conversation or settings stores.
- [ ] External file change detection for files open in Monaco, with reload or
  compare options.
- [ ] Incremental project indexing that re-indexes changed files only and
  respects visible exclusions and local storage limits.
- [ ] Background verification queue for explicitly approved checks, with
  pause and cancel controls.
- [x] Task restart recovery to resume or safely mark interrupted tasks after
  an app or Agent Host restart. (Interrupted Coding Agent tasks are marked for
  review in task state and the operation journal; restart never replays a
  model/tool request.)
- [ ] Resource-aware task scheduling that limits simultaneous model requests
  based on available local memory and compute.
- [ ] Idle model management to offer unloading unused models or keeping
  selected models warm with a clear resource cost.
- [ ] Resumable model downloads with integrity verification before use.
- [ ] Local runtime health monitor for configured model servers, with
  actionable diagnostics.
- [ ] Hardware suitability advisor to estimate whether a model and context
  size fit available local memory before loading.
- [ ] Per-run resource summary showing local inference duration, memory use,
  and request size.
- [ ] User-reviewed redacted diagnostics bundle that excludes prompts,
  attachments, and secrets by default.
- [ ] Searchable local action history for approvals, file writes, task
  transitions, and settings changes.
- [ ] Workspace storage manager for reviewing cached models, old snapshots,
  and generated media before cleanup.
- [x] Linux AppImage rollback support that preserves and restores the previous local app version; Windows installer rollback remains governed by NSIS lifecycle policy
  and provides a recovery path if an update fails.
- [ ] Scheduled maintenance controls for choosing when local indexing,
  backups, and cache cleanup may run.

## Reference

The backlog was collected from product research and the requested capability
set. AirLLM is one referenced project for large-context and model-runtime
exploration: <https://github.com/lyogavin/airllm>. Any future code reuse or
integration must go through the repository's licensing, security, privacy, and
platform review requirements.
