# Skai Desktop overhaul opportunities

**Status:** implementation in progress, per the user's instruction to implement the complete roadmap.  
**Research date:** 2026-11-26.  
**Backlog size:** 330 distinct candidate changes in 33 reviewable slices.  
**Count:** items 001–130 preserve the previous pitch; 131–330 add 200 new proposals.

## Implementation progress

This is now the active implementation backlog, not an approval queue. Existing capabilities must be verified in the current checkout before counting an item complete; partial matches stay open. The implementation is being delivered in dependency-ordered slices and the table below records verified progress.

| Slice | Status | Current result |
| --- | --- | --- |
| 1 · Agent task supervision | In progress | The Coding task inspector surfaces lifecycle, next-step guidance, verification output, activity, and changed-file review. Saved plans expose explicit Queue plan, Approve/Decline, and Start task actions. Running tasks accept bounded, persisted multiline follow-ups; the host applies them before verification and rejects completion while accepted steering is unapplied. Usage now has a cross-project inbox with status filters, approval/decline, queue/start/stop/retry actions, and links back to the project or conversation. Failed runs can seed a new approval-gated plan while preserving the failed run. Native core tests, live Agent Host smoke, packaged build, typecheck, and a 20-route × five-size UI matrix passed. Richer failed-task recovery details and an explicit review decision inbox remain open. |
| 2 · Multi-agent delegation | In progress | Users can split an active local parent task into up to six scoped planner/implementer/reviewer/verifier/researcher proposals, optionally selecting any discovered local chat model for each worker. Children persist under the parent and stay proposed until individually queued and started. The Coding activity inspector renders parent/child progress, while the model coordinator waits for delegated children and integrates their summaries before verification. Host protocol smoke covers per-worker model/provider/capacity metadata; packaged coding-workflow smoke exercises creating two specialists and verifies the persisted task tree. Explicit concurrency estimates, safe same-file coordination, per-worker tool scopes, and a fuller agent roster remain open. |
| 3 · Isolated worktrees | In progress | Project task plans can select a retained Git worktree; execution stays on its separate branch and records the branch/path for review. Users can open a retained worktree folder in the system file browser via a task-ID-only Electron bridge; the main process resolves the trusted Agent Host task, validates the retained directory, and reports unavailable paths. Users can explicitly release a terminal task's retained checkout; release refuses active tasks and dirty worktrees, then keeps the Git branch. Core tests, Agent Host smoke, packaged Coding layout matrix, and desktop typecheck passed. Opening the worktree in the in-app editor/terminal, conflict-previewed merge, dirty base-checkout guidance, orphan recovery, disk-use visibility, and capacity-linked worktree limits remain open. |
| 4 · GitHub loop | In progress | Existing local repository status, selected-file diff/commit, guarded push, repository-scoped `gh` PR creation, authorized repository listing/cloning, and credential controls were confirmed in code and core tests. PR creation now leaves the base branch to GitHub CLI/repository defaults instead of forcing `main`, and the Coding dialog exposes an explicit draft toggle (default on) without collecting credentials. Task plans accept a canonical GitHub issue URL and acceptance criteria; both persist in task artifacts, appear in task context, and reject non-GitHub issue URLs. Native core tests, Agent Host smoke, desktop typecheck, and production build pass. Issue import/details beyond user-supplied metadata, CI/review status display, review-feedback routing, and a live GitHub acceptance fixture remain open. |
| 5 · Adaptive shell | In progress | Packaged route/layout matrix passed for 20 routes × five window sizes × four theme/sidebar combinations; the 960×640 composer/model-picker overflow is corrected. The View menu now offers Chat focus, Coding, Review, Research, and Media layouts with Ctrl+Alt+1–5 shortcuts; each applies the relevant route, sidebar visibility, and width. Sidebar sizing and visibility persist using existing preferences. User-saved layouts, drag-to-split/reorder beyond existing tab ordering, and persistent pane arrangements remain open. |
| 6 · Project context | In progress | Existing projects persist instructions and connected folders; project instructions are editable in project settings, included in project chats, and are now added to task context with a 20,000-character prompt bound. Task plans and project chats are scoped to project IDs. The Coding workspace now has a context strip for branch, selected model, active task, changed-file count, and available Files/Git/Terminal tools. Composer project switching and project-specific commands in Ctrl+K now open the selected project. Project knowledge sets, model profiles, scoped tools, activity feeds, health cards, templates, and archive gaps remain open. |
| 7 · Skills and tools | In progress | MCP connections expose health, last errors, discovered tools, read/write risk grouping, arguments, and explicit call review in Marketplace. The composer’s access disclosure now previews connected project folders and `$skill-id` mentions in the current draft, and clarifies that MCP tools are not silently invoked from chat and computer use starts only through its explicit local workflow. Unifying policy precedence, composer-to-skill discovery, and an effective-capabilities inspector remain open. |
| 8 · Computer use | In progress | Computer use already captures screenshots, follows actions with fresh captures, records an action list, and has a stop control. Model-proposed actions now pass strict type/range/length checks and pause for an explicit review click by default, with a preview for coordinates and text. Cross-platform adapters, replayable redacted traces, browser diagnostics, and UI Automation targets remain open. |
| 9 · Search and knowledge | In progress | The corpus has bounded hybrid lexical/token-vector search, source snippets, freshness timestamps, and explicit local imports. Documents now persist Workspace or project scope, and both listing and retrieval filter by that scope; legacy corpus entries default to Workspace. Native tests cover scope isolation, persistence, and input validation. True semantic embeddings/reranking, changed-source freshness checks, extraction retry/status, broader extractors, evaluation fixtures, and a nested file browser remain open. |
| 10 · Models and runtimes | In progress | Installed model controls and provider/runtime discovery already live in Marketplace and Settings. Coding tasks now persist the resolved model/provider when execution begins, including inherited coding-profile selections and capacity metadata, and the task inspector identifies the actual model used on each task plus specialist model assignments. Reusable role profiles, verified action capability explanations, a unified runtime health view, resumable downloads, richer trust metadata, side-by-side model comparisons, and runtime compatibility preflight remain open. |
| 11 · Voice and media | In progress | Voice settings now save and apply up to 16 named device-local presets covering runtime, source/provider, selected speaker, pacing profile, expressiveness, and low-resource mode. Existing voice workflows provide turn-based live speech chunks, first-use runtime status and recovery, an audio clip workbench, editable dictation, local image history, cancellation, and verified runtime/workflow labels. True TTS audio-frame streaming, consistent media-job recovery across runtimes, and prompt/workflow preset import/export remain open. |
| 12 · Customization | In progress | Settings already filters the 13 categories by relevant search terms. Press Enter or choose “Jump to matching control” to scroll to and focus the first visible setting control matching the query. Per-category resets, scope labels, and broader layout/preset editing remain open. |
| 13 · Reliability | In progress | Agent Host smoke verifies project-bound local/worktree task planning and persistence; the packaged UI matrix passed all 20 routes × five sizes × four theme/sidebar combinations, and this turn's matrix passed 20 routes × five sizes on the isolated packaged build. Native core tests and worktree release acceptance passed. Cross-platform acceptance and additional interruption/recovery paths remain open. |
| 14 · Conversation queue | In progress | Queued prompts can now be edited inline with explicit Save/Cancel and Ctrl+Enter/Escape, preserving attachments; Up/Down actions reorder the persisted FIFO and are keyboard-focusable. Queue core and Agent Host protocol smoke cover text updates, attachment preservation, reordering, removal, and invalid input. Retrying with a different model, checkpoints, attachment-aware sent-message editing, and response-branch comparison remain open. |
| 15 · Documents and artifacts | In progress | Project files already open beside the conversation with safe HTML/SVG/PDF/image preview, Monaco editing, local save/undo, and source review. Markdown files now have an accessible Source/Preview toggle with headings, paragraphs, lists, quotes, code blocks, and safe web/email links; raw HTML is treated as text. Packaged coding smoke checks rendered content, unsafe-element absence, and return to editable source. Rich document workspace, tracked suggestions, local document history, conversation-linked artifacts, export preview, spreadsheet workbench, diagram authoring, templates, and artifact provenance remain open. |
| 16 · Terminal and environments | In progress | Existing SSH execution uses the system OpenSSH client, known_hosts trust, key/agent authentication, and disables password prompts and forwarding; SSH profiles save host/user/port locally per project. Terminal output now has Copy, Clear/Show, and a text export capped at 100,000 characters; packaged project-terminal smoke exercises the visible controls and buffer restoration. Named reusable environment records, preflight connection checks, separate worktree/task PTYs, task timeline linkage, remote PTY recovery, and a precise sandbox-guarantee summary remain open. |
| 17 · Code review | In progress | The Coding Changes inspector now includes a review checklist scoped to project and Git branch. Findings can be added with notes, marked unresolved/accepted/deferred, and removed; state persists locally. Existing selected-file diff and per-file commit inclusion remain available. Line/hunk comments, hunk staging, richer change classification/previews, check coverage, reviewer agent, and feedback history remain open. Typecheck passed; packaged workflow verified adding a finding, saving status, and rendering the checklist in the Changes pane. |
| 18 · Schedules and automations | In progress | Existing schedules show local run state and outcomes, and support run now, pause, resume, and cancel. Detail now identifies the local time zone and host requirement; a Duplicate action prefills a new schedule while preserving prompt, interval, and workspace mode. Packaged workflow verified duplication, local context, create, pause, resume, and cancel. Saved-workflow automation, trigger variants, explicit model/tool preview, run history, dry-run gate, missed-run policy, overlap controls, and notifications remain open. |
| 19 · Personas and presets | In progress | Persona profiles can now be duplicated from the library while preserving their reviewed profile and sources, clearing personal continuity, and resetting usage/research history. The profile view explains which context a persona conversation uses and confirms that project files and tools are not attached. Packaged workflow verifies duplication, source/profile preservation, continuity reset, scope disclosure, and library selection across five window sizes. Model/skill/tool bindings, versions/restore, templates, explicit memory scope, sandboxing, compatibility checks, import/export, and instruction provenance remain open. |
| 20 · Voice and accessibility | In progress | Voice Mode now exposes an accessible live microphone meter, a saved sensitivity control that tunes turn detection and spoken interruption, and a Ctrl+Shift+Space shortcut to stop speech while keeping the conversation open. The packaged Electron smoke verifies the active listening announcement, meter, sensitivity persistence, and visible session controls; screenshot review confirms the controls fit the modal at 1440×900. Input/output device selection, interim transcript preview, push-to-talk, calibration, captions/session transcript, broader voice-quality coverage, and hardware testing remain open. |
| 21–33 | Not audited | Verify current implementation before changing or closing items. |

## How to use this roadmap

Each numbered item is a candidate change to implement or validate. Some proposals finish or connect existing partial capabilities rather than introducing features from scratch. Close an item only when code inspection and relevant workflow checks support it.

The ideas adapt product patterns from linked projects; they are not instructions to copy implementations wholesale. The screenshot is treated as a research target list, not as a directive. Skai's local-first privacy boundaries, reviewable changes, and Electron + React + .NET Agent Host architecture remain design constraints.

## Skai baseline observed

Skai already has persistent navigation; chat history, search, queues, attachments, memory, and voice; project-linked coding tasks; file editing with save/undo; Git status, diff, commit, push, and PR actions; local model inventory and Marketplace; MCP connections with explicit permissions; local image generation/editing; scheduled tasks; Usage and Settings pages; themes and density controls; and broad route, interaction, and packaged-app smoke coverage.

The [capability matrix](CAPABILITY_MATRIX.md) marks shell and core chat as working, while projects/GitHub, coding sessions, voice, terminal/tool acceptance, media, memory retrieval, and integrations have specific remaining boundaries. [Future features](FUTURE_FEATURES.md) still calls out parallel subagents, harness integrations, complete plan/execute/verify loops, richer pane layouts, project-scoped context, a browser panel, deeper retrieval, and portability ideas. The renderer composes Chat, Projects, Coding, Models, Compare, Images, Video, Marketplace, Terminal, Memory, Usage, Scheduled tasks, Voice Workbench, Persona Workshop, and Pet Workshop. Chat tabs are scoped to Chat/Coding; Settings opens over the prior page.

Implementation references: [App shell](../../apps/desktop/src/App.tsx), [route composition](../../apps/desktop/src/app/AppRouteView.tsx), [Coding workspace](../../apps/desktop/src/features/coding/CodingPage.tsx), [Marketplace](../../apps/desktop/src/features/catalog/MarketplacePage.tsx), [Settings](../../apps/desktop/src/features/settings/SettingsPage.tsx), [Agent Host](../../services/agent-host/README.md), and [Revision 4 visual/workflow review](../design-review/workflow-collection/revision-4/README.md).

The implementation is being layered onto a working tree that already contained user changes. Those changes are preserved; additions are checked against the current checkout and marked below only after their relevant verification passes. This roadmap is an implementation commitment, not a request to pause for slice-by-slice approval.

## Reference projects scanned

I reviewed public repository descriptions and README-level feature/workflow documentation for the 20 screenshot targets plus four repositories named earlier. Continue and Open WebUI were also checked as comparable references introduced in the prior review. The table records primary idea sources, not an endorsement of every feature.

| Target | Repository/readme | Patterns considered |
| --- | --- | --- |
| Odysseus | [odysseus-dev/odysseus](https://github.com/odysseus-dev/odysseus) | Unified workspace, research, documents, cookbook/model setup, tasks, editor, themes. |
| Happy | [slopus/happy](https://github.com/slopus/happy) | Live session supervision, remote continuation, encrypted relay and local execution boundary. |
| OpenCode | [anomalyco/opencode](https://github.com/anomalyco/opencode) | Plan/read-only versus build/full-access modes; provider and harness flexibility. |
| Codex CLI/app | [openai/codex](https://github.com/openai/codex), [Codex app](https://openai.com/index/introducing-the-codex-app/) | Sandboxing, skills, parallel threads, worktrees, reviewable changes, automations. |
| Pi | [earendil-works/pi](https://github.com/earendil-works/pi) | Composable harness, permissions and containerization, session sharing. Screenshot's badlogic/pi-mono name resolves to this current repository. |
| OpenHands | [OpenHands/OpenHands](https://github.com/OpenHands/OpenHands) | Headless and interactive agents, Docker sandbox choices, isolated sandboxes. |
| Cline | [cline/cline](https://github.com/cline/cline) | Plan/Act, rules and skills, model flexibility, plugins/MCP, teams and schedules. |
| Goose | [aaif-goose/goose](https://github.com/aaif-goose/goose) | Composable operations, approvals, resumable state, runtime portability, ACP. Screenshot's block/goose name resolves to the current organization. |
| Aider | [Aider-AI/aider](https://github.com/Aider-AI/aider) | Git-native edits, repository map, lint/test loop, voice-to-code, editor integration. |
| Open Interpreter | [openinterpreter/open-interpreter](https://github.com/openinterpreter/open-interpreter) | Computer-use workflows, ACP compatibility, portable runtime packaging. |
| DeepSeek Harness | [deepseek-ai/dsh](https://github.com/deepseek-ai/dsh) | **Not verified:** GitHub returned 404 for the exact screenshot name; no features are inferred from its caption. |
| Orca | [stablyai/orca](https://github.com/stablyai/orca) | Parallel worktrees, agent board, GitHub/Linear, design mode, scheduling, split workspace. |
| OpenClaw | [openclaw/openclaw](https://github.com/openclaw/openclaw) | Local gateway/control plane for sessions, tools, events, and channels. |
| Hermes Agent | [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) | Skills, user memory, tool gateways, messaging, agent migration. |
| CodeWhale | [CodeWhaleAI/CodeWhale](https://github.com/CodeWhaleAI/CodeWhale) | **Not verified:** GitHub returned 404 for the exact screenshot name; no features are inferred from its caption. |
| Kilo Code | [Kilo-Org/kilocode](https://github.com/Kilo-Org/kilocode) | Code/Plan/Ask/Debug modes, self-checking, Marketplace, model choice, browser/terminal. |
| Happier | [happier-dev/happier](https://github.com/happier-dev/happier) | Multi-device agent control and private session continuity. |
| Gemini CLI | [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) | Model/provider selection, integrations, release channels. |
| Happy Desktop | [slopus/happy-desktop](https://github.com/slopus/happy-desktop) | Desktop and companion workflows for sessions on local agents. |
| Plandex | [plandex-ai/plandex](https://github.com/plandex-ai/plandex) | Large-project context, staged plans, autonomy/approval controls, production checks. |
| AnythingLLM | [Mintplex-Labs/anything-llm](https://github.com/Mintplex-Labs/anything-llm), [agent setup docs](https://github.com/Mintplex-Labs/anything-llm-docs/blob/main/pages/agent/setup.mdx) | Workspace model assignments, knowledge, skills, selective tool inclusion. |
| Omnigent | [omnigent-ai/omnigent](https://github.com/omnigent-ai/omnigent) | Multiple harnesses, session sharing, policy levels, budget limits, sandbox choices. |
| Ruflo | [ruvnet/ruflo](https://github.com/ruvnet/ruflo) | Agent/swarm lifecycle, workflow plugins, task coordination, memory patterns. |
| Agent Orchestrator | [OrchestratorInc/agent-orchestrator](https://github.com/OrchestratorInc/agent-orchestrator) | Project board, isolated workers, PR/CI/review state, previews, mobile follow-up. |
| Continue | [continuedev/continue](https://github.com/continuedev/continue) | Configurable agents, project rules, MCP, context providers, per-tool policies. |
| Open WebUI | [open-webui/open-webui](https://github.com/open-webui/open-webui) | Reusable model presets bound to knowledge, prompts, tools, skills, and parameters. |

The screenshot's exact DeepSeek Harness and CodeWhale names could not be verified through public GitHub lookup on the research date. Their screenshot descriptions remain user-provided references, not verified repository findings. Star counts were not treated as quality evidence.

---

# Ordered change backlog

## Slice 1 — Make agent work easy to supervise
**Outcome:** Long-running local tasks become legible and steerable. Skai persists task plans, approvals, progress, and cancellation; Codex and Agent Orchestrator foreground task progress and reviewable work.

1. Give each task visible lifecycle states: plan, queued, working, verifying, waiting for you, completed, or failed.
2. Show the agent's current goal and next action in the task view.
3. Keep tool calls and results in a readable, collapsible activity timeline.
4. Let users steer a running task with a follow-up instruction without losing its history.
5. Add explicit decision points for ambiguous requirements, risky edits, and failed verification.
6. Show why a task is waiting, not just its status.
7. Put pause, resume, cancel, retry, and replan in one consistent task menu.
8. Persist verification output, exit codes, and failure context beside resulting changes.
9. Add a completion summary with changed files, checks run, unresolved questions, and suggested next action.
10. Add a task inbox for work needing review or a decision.

## Slice 2 — Add real multi-agent delegation
**Outcome:** Delegate bounded work to specialists and understand how results combine. Parallel subagent delegation remains open in Skai; Ruflo, Omnigent, Orca, and Codex describe agent-team workflows.

11. Let a user split a task into explicit subtasks assigned to specialist agents.
12. Start with clear roles such as planner, implementer, reviewer, and verifier.
13. Display parent and child tasks in a compact tree or board.
14. Show which subtasks can run concurrently and which depend on earlier results.
15. Give each agent a scoped instruction, tools, model, and project context.
16. Prevent agents from silently overwriting each other's working files.
17. Add an agent roster with status, role, current task, and resource use.
18. Let one agent review another's changes and return actionable feedback.
19. Require the coordinator to reconcile conflicting outputs before presenting a result.
20. Put a user-visible concurrency limit and resource estimate on parallel work.

## Slice 3 — Build an isolated worktree workflow
**Outcome:** Parallel coding tasks work without collisions with the user's checkout. Skai has guarded worktree leases; richer worktree UX remains open. Codex and Agent Orchestrator use isolated task worktrees.

21. Offer “run in this checkout” and “run in an isolated worktree” as explicit choices.
22. Create a named worktree automatically for an agent task.
23. Show the branch and worktree path in the task header.
24. Let users open a worktree in the editor, terminal, or file browser.
25. Offer a safe “bring changes into this checkout” action with conflict preview.
26. Detect dirty files before starting and explain their effect on the selected run mode.
27. Clean up completed worktrees only after the user reviews or keeps the result.
28. Recover orphaned worktrees and interrupted tasks.
29. Show disk use and stale-worktree cleanup suggestions.
30. Tie worktree capacity to the same resource admission system as concurrent runs.

## Slice 4 — Complete the GitHub issue-to-merge loop
**Outcome:** Connect task planning, local Git, pull requests, CI, and review. Skai's GitHub journey and worktree UX have open acceptance gaps; Agent Orchestrator connects sessions to PR/review/CI state.

31. Add a repository picker for repositories the user has authorized.
32. Support cloning a repository into a user-selected local folder.
33. Start a task from a GitHub issue and carry its link into the task.
34. Display issue details and acceptance criteria next to the task plan.
35. Create a branch or worktree with a predictable name from the issue or task.
36. Show PR, review, and CI state in the project workspace.
37. Let a user open a draft PR from reviewed changes.
38. Summarize review feedback and route requested changes to the implementing agent.
39. Explain conflicts and failed checks with links to relevant files or logs.
40. Keep GitHub permissions explicit, scoped, revocable, and visible in context.

## Slice 5 — Make the shell adapt to the work
**Outcome:** Arrange chats, files, terminals, and previews around a task. Skai has persistent navigation, workspace tabs, and docked coding panels; design references make the shared shell a core workflow.

41. Make tab visibility and tab actions depend consistently on active workspace context.
42. Add drag-to-split and drag-to-reorder for chat, file, terminal, and preview panes.
43. Let users resize panes and save the arrangement as a named layout.
44. Add one-click “focus this pane” and “restore split” controls.
45. Offer layout presets such as Chat, Coding, Review, Research, and Media.
46. Restore open panes and selected files when reopening a project session.
47. Let users pin frequently used panes without pinning entire conversations.
48. Add detached windows for chats or tool panels where supported.
49. Make mobile layouts collapse panels predictably while preserving the active task.
50. Add a context strip for project, branch, model, task, changed files, and active tools.

## Slice 6 — Make project context useful across the app
**Outcome:** A project becomes a durable home for work and configuration. Skai links project conversations and tasks; its roadmap calls out project-grouped chats, shared knowledge, and context. AnythingLLM and Open WebUI bind workspace resources.

51. Give each project a home for chats, tasks, notes, files, skills, and integrations.
52. Add project-level instructions that are visible and editable.
53. Attach reference folders or documents to a project knowledge set.
54. Set a default model profile per project with a clear per-chat override.
55. Add project-scoped tool and MCP choices.
56. Keep a project activity feed for task starts, commits, PRs, and decisions.
57. Add project health checks for uncommitted changes, missing runtimes, and broken integrations.
58. Support project templates with starter instructions, skills, and layout.
59. Let users archive a project without deleting its data or chat history.
60. Add quick project switching from the composer and command palette.

## Slice 7 — Unify skills, tools, and MCP setup
**Outcome:** Users understand and control what each agent can do. Skai has local skill installation, MCP discovery, permissions, and Marketplace workflows. AnythingLLM, Open WebUI, and Continue show composable capability configuration and tool policies.

61. Give every tool a plain-language description, risk level, data scope, and example.
62. Show which tools are active for the current chat or task before it starts.
63. Support policies such as blocked, ask first, and automatic.
64. Allow policy overrides per project, agent, and task with precedence shown.
65. Add an MCP setup wizard that validates connection, tools, and permissions before saving.
66. Show last health check, last error, and reconnect action for every integration.
67. Let users search for a skill or tool from the composer and enable it in context.
68. Add skill version, source, files, and integrity details to its inspector.
69. Provide preview and rollback when updating an installed skill or tool package.
70. Add an effective-capabilities view that explains why a tool is or is not available.

## Slice 8 — Turn computer use into a reviewable workflow
**Outcome:** Computer-use sessions are bounded, understandable, and auditable. Skai supports bounded computer use and local screen capture; Codex and Open Interpreter emphasize computer interaction and browser workflows.

71. Add a built-in browser panel with clear separation between browsing and computer control.
72. Let users annotate a page or screenshot to identify exactly what should change.
73. Show an action timeline with screenshot, action, and result for each computer-use step.
74. Add a dry-run preview of planned clicks and typing before execution.
75. Keep an easy stop control visible while computer use is active.
76. Support accessibility/UI Automation targets alongside coordinate-based actions.
77. Limit each session to approved windows or applications and show the boundary.
78. Save a replayable, redacted action trace for troubleshooting.
79. Add browser-console and navigation diagnostics for web-development tasks.
80. Design cross-platform computer-use adapters before advertising other OS support.

## Slice 9 — Make search and knowledge more dependable
**Outcome:** Grounded answers are easier to verify and refresh. Skai has conversation search, memory, document-grounded chat, and a corpus; hybrid retrieval and evaluation remain open.

81. Combine keyword search with semantic retrieval and optional reranking.
82. Show retrieved passages and sources before sending them to a model.
83. Add retrieval modes for relevant passages versus full-document context.
84. Track document freshness and prompt users when a source changes.
85. Add extraction status and clear retry controls per document.
86. Support more extraction engines behind a consistent local interface.
87. Add project and workspace scopes to memory, notes, and document search.
88. Make source provenance and confidence visible in document-grounded answers.
89. Add retrieval-quality evaluation fixtures, not only extraction-success checks.
90. Add a nested file browser with preview, search, and safe path feedback.

## Slice 10 — Simplify model and runtime management
**Outcome:** Choose an appropriate model for each job and understand runtime health. Skai supports local model discovery, installation review, and hardware-fit advisories; AnythingLLM supports workspace and agent model assignment.

91. Create reusable model profiles for chat, coding, vision, voice, and review.
92. Explain a model's supported actions using verified capability data.
93. Show model size, context limit, runtime, hardware fit, and readiness together.
94. Add a runtime health panel with connection status, loaded models, and recent failures.
95. Resume interrupted downloads when the provider supports it.
96. Make install, update, remove, and pin actions consistent across model types.
97. Show source, license, checksum, and trust status in the model inspector.
98. Check compatibility before a task uses tools or large context.
99. Compare models on user prompts with latency and quality notes.
100. Explain which model assignments were used for each completed task.

## Slice 11 — Make voice and media first-class workspaces
**Outcome:** Local voice and media share consistent setup, progress, and history. Skai has local voice adapters, Voice Mode, and image generation; incremental audio streaming and broader media acceptance remain open.

101. Stream generated speech incrementally while the assistant is still responding.
102. Add voice presets for model, speaker, rate, and expressiveness.
103. Make first-use voice downloads and warm-up states understandable.
104. Add an audio clip library with search, metadata, playback, and safe removal.
105. Let users edit recognition errors before sending a transcript.
106. Keep Image Generate/Edit as the active Visuals path while media jobs share a history.
107. Gate video and music controls on installed, verified local workflows.
108. Add consistent progress, cancellation, and recovery across media jobs.
109. Show which local runtime and workflow produced each media result.
110. Add import/export for prompts and local workflow presets.

## Slice 12 — Make customization easier to discover and manage
**Outcome:** Adapt the shell and defaults without scattering configuration. Skai has themes, density, reduced motion, model, and voice settings; Open WebUI binds model presets to resources.

111. Add a layout editor for sidebar width, pane layout, and default landing page.
112. Let users save named workspace and composer presets.
113. Add settings search that jumps to the matching control.
114. Explain why a setting matters and show its effective default.
115. Preview theme, font, contrast, and density changes before applying them.
116. Group configuration by task: chat, coding, media, voice, models, and integrations.
117. Add import/export for user preferences and workspace layouts.
118. Show whether settings are global, project-specific, or task-specific.
119. Add reset actions per settings category.
120. Explain what is missing and how to enable each disabled control.

## Slice 13 — Improve reliability, safety, and platform readiness
**Outcome:** Failures are diagnosable and workflows proven on supported platforms. Skai has a typed Electron bridge, persistent local Agent Host, permissions, and smoke coverage; acceptance boundaries remain.

121. Standardize retry, backoff, cancellation, and resumability across integrations.
122. Add provider health and actionable diagnostics for model, voice, MCP, and GitHub connections.
123. Make tool/action history searchable by task and project.
124. Add a permission review before enabling unattended or recurring actions.
125. Add sandbox acceptance coverage for each supported OS and build type.
126. Report unverified platform or runtime capabilities directly in the UI.
127. Add a support bundle users can inspect and redact before sharing.
128. Add performance baselines for startup, task startup, and common page transitions.
129. Tie layout, accessibility, and keyboard checks to the supported route matrix.
130. Add recovery guidance for interrupted tasks, failed updates, and corrupted local state.

## Slice 14 — Make conversation editing and queued work predictable
**Outcome:** Give users precise control over prompts and in-flight turns. Skai already has drafts, queueing, retry, forks, and message actions; Codex and Aider make steering and Git-aware iteration central.

131. Add a “steer next” action that queues a correction without replacing the current turn.
132. Make queued prompts editable in place with visible save/cancel controls.
133. Reorder queued prompts by drag-and-drop and keyboard controls.
134. Show whether a queued prompt inherits current files, tools, model, and project context.
135. Convert a queued message into a durable task plan.
136. Add a user-visible “interrupt after this sentence/action” control for streamed responses.
137. Make retry choices explicit: same prompt, edited prompt, new model, or branch from prior turn.
138. Preserve attachments and per-turn settings when editing a sent prompt.
139. Add user-labeled conversation checkpoints before major task changes.
140. Compare response branches and choose which context to continue.

## Slice 15 — Add practical documents and artifacts
**Outcome:** Keep generated documents and previews in the same space as chat and coding. Odysseus documents a writing-first editor; Skai already previews bounded HTML/SVG and edits project files.

141. Add a document workspace for Markdown, plain text, and supported office formats.
142. Add tracked AI suggestions that users can accept or reject by section.
143. Support rich Markdown with a source-view toggle.
144. Keep document version history and restore points local to the project.
145. Open a generated artifact beside the conversation that created it.
146. Add export to PDF, HTML, or Markdown with a preview before saving.
147. Add spreadsheet preview and formula-safe context extraction with clear limits.
148. Add diagram artifacts that render from a reviewable source format.
149. Provide reusable document templates with typed variables.
150. Record artifact provenance: source prompt, model, attachments, and edit history.

## Slice 16 — Make terminal and remote environments coherent
**Outcome:** Treat local and remote environments as explicit, inspectable targets. Skai has a project terminal and SSH command support; Codex and Agent Orchestrator describe remote devboxes and session-scoped terminals.

151. Save named SSH environments with host, user, port, and safe working directory.
152. Show local versus remote execution context in terminal and task headers.
153. Add a connection test and capability check before using an SSH environment.
154. Reuse environments across projects without copying credentials into project files.
155. Keep separate terminal sessions per project, worktree, and task.
156. Add terminal-output search, copy, clear, and bounded export controls.
157. Link task terminal commands and output to the activity timeline.
158. Open a scoped terminal for a worktree without creating a full coding session.
159. Surface remote disconnects and recovery choices without losing buffered output.
160. Display which sandbox guarantees apply to local and SSH commands.

## Slice 17 — Upgrade code review into a review workflow
**Outcome:** Make changes easy to inspect, discuss, stage, and validate. Skai has Git diff review and save/undo; Codex keeps review in the thread and Aider emphasizes Git-native changes.

161. Add line-level comments on local diffs that can be sent to the agent as scoped feedback.
162. Add hunk-level staging while preserving unrelated staged changes.
163. Add per-file and per-hunk include/exclude controls for a commit.
164. Distinguish generated, modified, deleted, and renamed files in review.
165. Add before/after previews for image, HTML, and document changes.
166. Make whitespace, generated-file, and large-file diff handling configurable.
167. Show which checks cover each changed area when project metadata allows it.
168. Add a review checklist with accepted, unresolved, and deferred findings.
169. Add a reviewer agent that returns anchored comments instead of a generic summary.
170. Preserve review notes across revisions so users can see how feedback was addressed.

## Slice 18 — Make schedules and automations safer and more useful
**Outcome:** Reuse trusted workflows while keeping triggers and outcomes inspectable. Skai already has local scheduled tasks; Codex automations and Cline schedules demonstrate recurring agent work.

171. Create an automation from a successful task or saved workflow.
172. Add a trigger picker for schedule, manual run, project event, or supported webhook.
173. Show next run, timezone, required host state, and selected model.
174. Preview tools and permissions before enabling an automation.
175. Keep run history with input, result, failure, and links to created artifacts.
176. Add a one-time dry run before activating a recurring schedule.
177. Pause, resume, duplicate, and disable schedules from the task inbox.
178. Add missed-run choices: skip, run once on resume, or ask first.
179. Prevent overlapping executions unless the user explicitly enables concurrency.
180. Add local notifications for completion, failure, or a decision request.

## Slice 19 — Make personas and agent presets composable
**Outcome:** Build repeatable agents from instructions and capabilities. Skai has Persona Workshop and authored presets; Open WebUI, Continue, and Hermes support reusable configured agents or skills.

181. Let a persona bind model profile, skills, tools, knowledge sources, and response style.
182. Display a persona's effective permissions before activation.
183. Version persona changes and restore a previous configuration.
184. Add starter persona templates for coding, research, writing, and support.
185. Scope persona memory explicitly by persona, project, or workspace.
186. Duplicate a persona and change bindings without modifying the original.
187. Add a persona test sandbox separate from conversations that can write project files.
188. Explain model incompatibilities and missing skills at selection time.
189. Import/export persona definitions with secrets excluded by default.
190. Show which instructions came from persona, project, skill, and current prompt.

## Slice 20 — Deepen voice interaction and accessibility
**Outcome:** Make hands-free conversation reliable across longer sessions and devices. Skai has turn-based Voice Mode and local TTS/STT; actual incremental audio streaming remains open.

191. Add an audio-device selector with live input/output level meters.
192. Add adjustable voice activity thresholds and a visual listening indicator.
193. Show live transcript text before submitting the turn.
194. Support push-to-talk as an alternative to continuous listening.
195. Interrupt synthesis with a keyboard shortcut as well as speech.
196. Add first-run voice calibration for permission and silence/noise conditions.
197. Keep mute, pause, resume, and end controls in one stable location.
198. Provide captions for assistant speech and a transcript of the full session.
199. Test voice quality across representative voices, speeds, and hardware classes.
200. Announce listening, processing, speaking, errors, and stop state to assistive tech.

## Slice 21 — Make visual generation extensible without confusing readiness
**Outcome:** Keep Visuals Workshop useful as local image workflows grow. Skai has image generation/editing, workflow import, and history; the reference emphasizes a large canvas and clear controls.

201. Add a persistent large preview canvas that stays usable when settings change.
202. Add a job queue with per-job progress, cancel, retry, and open-in-edit actions.
203. Store prompt, seed, model, dimensions, and workflow with each result.
204. Save named generation presets and reopen them later.
205. Add before/after comparison for image edits.
206. Make source-image selection and replacement visible in the edit workflow.
207. Add batch generation with bounded concurrency and grouped outputs.
208. Explain required models, custom nodes, disk size, and license before activation.
209. Keep video/music as honest placeholders until local workflows are verified.
210. Add a local asset browser for generated images, audio, and supported media.

## Slice 22 — Support more agent harnesses through an adapter boundary
**Outcome:** Use installed coding agents without hardwiring the desktop to one runtime. OpenCode, Cline, Goose, OpenHands, Pi, Gemini CLI, Codex, and Omnigent document varied harnesses; Skai lists Codex/Claude Code integrations as planned.

211. Define a versioned harness adapter contract for chat, tools, streaming, cancellation, and status.
212. Publish a capability matrix per adapter instead of implying every agent supports every control.
213. Add adapter health checks and clear login/runtime prerequisite messages.
214. Keep Skai's task journal authoritative when a harness has its own session format.
215. Add stable session resume and transcript import where a harness permits them.
216. Expose a harness's native terminal UI as an optional session interface.
217. Keep approvals and sandbox limits visible when a harness supplies its own UX.
218. Choose a different harness for a new task without changing project metadata.
219. Add compatibility smokes for each harness version before marking it supported.
220. Start with one read-only/plan adapter and one coding adapter before expanding the catalog.

## Slice 23 — Improve first-run onboarding and capability discovery
**Outcome:** Help new users reach a useful first chat or project task with fewer surprises. Skai has local setup and Marketplace; Agent Orchestrator documents onboarding, and Odysseus offers model recommendations.

221. Add a first-run checklist for local runtime, model, permissions, and workspace folder.
222. Offer a sample prompt that exercises the installed model without touching project files.
223. Explain local-only, network-connected, and remote-provider actions during setup.
224. Recommend a model from detected hardware while labeling it advisory.
225. Let users skip optional setup and return to unfinished steps later.
226. Add a readiness page linking missing capabilities to setup screens.
227. Introduce navigation with short, dismissible explanations instead of a blocking tour.
228. Offer demo data in an isolated profile to preview task, Git, and media workflows.
229. Add onboarding reset that preserves chats, projects, and installed models.
230. Show what Skai can do now based on this machine's actual runtimes.

## Slice 24 — Make activity and search work across the workspace
**Outcome:** Find prior work and understand current activity from one place. Skai has conversation search and Usage; Agent Orchestrator has a session board, and OpenClaw uses a control plane for session/tool events.

231. Add global search across chats, projects, tasks, files, skills, and saved artifacts.
232. Filter results by project, date, model, status, or content type.
233. Add a live board for running, queued, paused, and waiting tasks.
234. Group activity by project, agent, or execution environment.
235. Show unread completion and decision-needed states in the sidebar.
236. Filter activity by tool calls, file changes, Git actions, and user decisions.
237. Preserve the query and filters when opening and returning from a result.
238. Save frequent searches as local shortcuts.
239. Correlate tasks, commits, checks, and PR events in a timeline.
240. Distinguish measured facts from estimates in usage summaries.

## Slice 25 — Make safety and permission policy understandable
**Outcome:** Govern powerful local actions through clear, auditable choices. Skai has explicit MCP grants and guarded execution; Omnigent and Pi make policies and sandbox environments explicit.

241. Create one permission center for filesystem, shell, network, browser, Git, and computer use.
242. Show exact resource scope and duration for every approval request.
243. Distinguish one-time, task-only, project-level, and global grants.
244. Explain when a permission is inherited from another policy scope.
245. Add “revoke all grants for this project”.
246. Keep an append-only local audit event for permission grants and use.
247. Show the active sandbox and its filesystem/network boundaries.
248. Add limits for task duration, tool calls, disk growth, and output size.
249. Require a second review before enabling unattended high-risk actions.
250. Add prompt-injection acceptance cases for files, webpages, and tool output.

## Slice 26 — Improve backup, migration, and data ownership
**Outcome:** Make local data portable and recoverable without weakening privacy. Skai is local-first with bounded import/export; AnythingLLM and Hermes describe workspace migration and portable state.

251. Add a workspace backup for selected chats, settings, personas, and project metadata.
252. Preview exactly which categories an export will include.
253. Exclude credentials, machine paths, and secrets by default.
254. Add an encrypted backup option with a user-controlled passphrase.
255. Validate backup integrity before offering a restore.
256. Add restore preview with collision handling and per-category choices.
257. Support Windows/Linux migration while marking platform-specific settings.
258. Add retention controls for chats, media, task logs, and caches.
259. Show local storage use by category and offer safe cleanup targets.
260. Explain what stays local and what leaves the device for each integration.

## Slice 27 — Finish accessibility and cross-platform polish
**Outcome:** Make workflows reachable by keyboard, assistive technology, and supported platforms. Skai has a broad automated UI matrix; manual assistive-tech and native Linux acceptance remain open.

261. Add a keyboard-only journey for creating, steering, reviewing, and completing a task.
262. Audit focus order after opening and closing drawers, dialogs, split panes, and menus.
263. Add accessible names and state announcements to icon-only controls.
264. Add a high-contrast preset and check every route against contrast targets.
265. Apply reduced motion consistently to page transitions, progress, and pets.
266. Add screen-reader summaries for task progress and code-review status.
267. Run native Linux acceptance for startup, window management, microphone, terminal, and update.
268. Add platform-specific smoke coverage for input capture and computer use.
269. Validate scaling at high-DPI and fractional display settings.
270. Add layout acceptance for long translations, large type, and narrow panes.

## Slice 28 — Improve capacity-aware scheduling and performance
**Outcome:** Avoid starting work the machine cannot run comfortably. Skai has RAM/GPU-aware admission for durable tasks; Orca, Codex, and model workspaces expose multiple work units.

271. Estimate runtime memory by model, context, quantization, and backend.
272. Account for loaded models and competing tasks before admitting new work.
273. Let users set per-runtime RAM/VRAM budgets and show the effective limit.
274. Explain why a task is waiting for capacity and what can unblock it.
275. Offer a user-approved queue policy such as FIFO, project priority, or manual order.
276. Show task CPU, memory, GPU, and disk telemetry when the runtime exposes it.
277. Avoid automatic model unloading unless the user enables it.
278. Measure startup, streaming, first-token, and completion timing separately.
279. Add resource-aware parallelism caps based on observed runtime behavior.
280. Label capacity values as measured, provider-reported, or estimated.

## Slice 29 — Add collaboration only behind explicit privacy choices
**Outcome:** Allow optional shared work while preserving ownership and data boundaries. Happy, Happier, Omnigent, and Agent Orchestrator describe companion, shared-session, or mobile workflows; Skai treats sync/sharing as a separate decision.

281. Define a local-only LAN collaboration mode before considering hosted services.
282. Add read-only session sharing with explicit information included/excluded.
283. Let collaborators send suggestions without machine-control permission.
284. Show owner, participants, access level, and expiration in the session header.
285. Let users leave a shared session without deleting the owner's data.
286. Fork a shared conversation into a private local copy.
287. Pair a companion device with a short-lived QR code and revocable key.
288. Require separate opt-in before remote messages can trigger local tools.
289. Review encryption and threat model before relay-based sync.
290. Keep collaboration disabled until a trusted host or endpoint is configured.

## Slice 30 — Add notifications and mobile follow-up carefully
**Outcome:** Notify users when a local task needs attention without making the desktop noisy. Agent Orchestrator, Happy, and Happier emphasize phone follow-up, approvals, and live status; remote execution is not assumed.

291. Add configurable desktop notifications for task completion, failure, and decisions.
292. Group repeated task updates into one notification with a direct return link.
293. Add quiet hours and project-specific notification rules.
294. Allow a one-time task-status link for local network viewing if the user enables a host.
295. Design mobile review for status, questions, and diffs before remote execution.
296. Scope phone approvals to the pending action and task identity.
297. Show stale/offline host state so cached data cannot be mistaken for live status.
298. Let notification actions pause or cancel a task without opening the full app.
299. Keep notification content private on lock screens by default.
300. Add delivery recovery and a local notification history.

## Slice 31 — Make shortcuts and command workflows personal
**Outcome:** Frequent users move quickly without hiding controls from new users. Skai has a command palette; Continue, Cline, and agent CLIs expose modes and contextual actions.

301. Add a searchable command palette for routes, layouts, projects, tasks, and tools.
302. Let users customize shortcuts with conflict detection.
303. Add composer slash commands for saved prompts and reusable workflows.
304. Show commands contextually based on page, project, and selection.
305. Add recent actions and allow pinning frequent commands.
306. Add exportable command aliases without credentials.
307. Show keyboard shortcuts in menus and tooltips.
308. Let users choose compact or descriptive composer toolbar layouts.
309. Add configurable default send behavior for Enter and Shift+Enter.
310. Keep advanced controls discoverable without crowding the composer.

## Slice 32 — Make implementation and release quality evidence-driven
**Outcome:** Tie completion to user-observable acceptance rather than code presence. Skai maintains a capability matrix, workflow references, and focused smokes; its own policy says a build alone does not establish a working feature.

311. Add an acceptance checklist per slice with a representative success and failure path.
312. Link each capability-matrix claim to current smoke or manual evidence.
313. Add screenshot comparison checkpoints for user-approved reference layouts.
314. Record platform, viewport, theme, sidebar, and runtime in UI evidence.
315. Add disposable-profile workflows for destructive or stateful acceptance.
316. Inject failures for offline models, MCP timeouts, expired GitHub auth, and disk full.
317. Add regression gates for tab/page context and Settings return behavior.
318. Test privacy boundaries, including local-only and explicit network calls.
319. Summarize unverified platforms and unsupported integrations in release readiness.
320. Require before/after visual comparison for major workflow redesigns.

## Slice 33 — Make Marketplace and installed inventory safer to operate
**Outcome:** Make discovery, installation, updates, and removal consistent and trustworthy. Skai has a unified Marketplace and installed inventory; real install/remove and hardware acceptance remain.

321. Use one installed-item inspector for models, voices, skills, tools, and assets.
322. Show installed version, source, last update, disk use, and dependent workflows.
323. Distinguish downloaded-item updates from Skai Desktop updates across the app.
324. Preview package contents and requested permissions before installation.
325. Verify signatures or checksums where trusted source metadata exists.
326. Explain incompatibility with current OS, runtime, or hardware.
327. Update one item at a time and review its change summary.
328. Protect active projects and workflows from removing a dependency in use.
329. Confirm uninstall while identifying data that will be removed or retained.
330. Test install, use, update, removal, and recovery across supported item categories.

---

## Suggested approval sequence

The order below favors visible workflow improvements and foundational dependencies; it is not a request to approve every slice:

1. **Slice 1 — Agent supervision:** clarify today's task state, questions, progress, and results.
2. **Slice 3 — Isolated worktrees:** prepare safe execution boundaries before scaling parallel coding.
3. **Slice 2 — Multi-agent delegation:** add specialist agents after isolation and supervision are ready.
4. **Slice 4 — GitHub issue-to-merge:** connect local work to remote review.
5. **Slice 5 — Adaptive workspace shell:** make review, coding, and research panes feel like one workbench.
6. **Slices 7 and 25 — Tools and policy:** clarify capabilities and permission inheritance before adding integrations.
7. **Slice 32 — Evidence-driven completion:** establish acceptance and screenshot comparison for redesigns.

## Source notes

- [Codex app: parallel agents, worktrees, skills, automations, and review](https://openai.com/index/introducing-the-codex-app/)
- [Codex for almost everything: computer use, browser, PR review, SSH, and panes](https://openai.com/index/codex-for-almost-everything/)
- [Agent Orchestrator: board, session view, inspector, and task workflow](https://github.com/OrchestratorInc/agent-orchestrator/blob/main/frontend/src/docs/content/dashboard.mdx)
- [Agent Orchestrator: project/worktree/PR/CI workflow](https://github.com/OrchestratorInc/agent-orchestrator/blob/main/frontend/src/docs/content/index.mdx)
- [Happy: session, client, relay, and local agent architecture](https://github.com/slopus/happy-agent/blob/main/docs/happy.md)
- [Omnigent: harnesses, collaboration, policies, and sandboxing](https://github.com/omnigent-ai/omnigent)
- [AnythingLLM: agent skills and intelligent tool selection](https://github.com/Mintplex-Labs/anything-llm-docs/blob/main/pages/agent/setup.mdx)
- [AnythingLLM: system, workspace, and agent model assignments](https://github.com/Mintplex-Labs/anything-llm-docs/blob/main/pages/setup/llm-configuration/overview.mdx)
- [Open WebUI: workspace composition](https://docs.openwebui.com/features/workspace/)
- [Continue: agent customization and per-tool policies](https://docs.continue.dev/ide-extensions/agent/how-to-customize)
- [RuFlo: plugin catalog for coordination and workflows](https://github.com/ruvnet/ruflo/blob/main/plugins/README.md)
- [OpenAI: harness engineering, observability, and worktree isolation](https://openai.com/index/harness-engineering/)

