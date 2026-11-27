# Skai UI and workflow overhaul: 200 fixes

This is a proposal backlog, not a claim that every item is already implemented.
The order is intentional: items 1–50 remove the highest-friction shell and
composer problems; 51–150 improve the agent work loop; 151–200 make the
product safer, more adaptable, and easier to operate at scale. Each line is
written as a testable fix that can become its own implementation slice.

## Research basis

The ideas below were compared against the current Skai routes, settings,
composer, Agent Host, Marketplace, task store, GitHub bridge, and packaged UI
matrix. The external references are primary repositories or their first-party
documentation:

| Source | Patterns worth carrying into Skai |
| --- | --- |
| [OpenAI Codex](https://github.com/openai/codex) | Sandboxed coding sessions, explicit approvals, terminal-first task execution, and a compact agent work loop. |
| [Continue](https://github.com/continuedev/continue) and its [Agent mode guide](https://github.com/continuedev/continue/blob/main/docs/ide-extensions/agent/quick-start.mdx) | One composer shared by Chat, Plan, and Agent modes; `@` context; read-only planning; tool permission prompts; headless and resumable CLI workflows. |
| [Ruflo](https://github.com/ruvnet/ruflo) | Swarm topologies, worker loops, worktree isolation, plugin marketplace, monitor streams, memory namespaces, and policy-aware orchestration. |
| [Omnigent](https://github.com/omnigent-ai/omnigent) | Harness abstraction, provider/model swapping, YAML-declared agents and reviewers, realtime collaboration, sandbox backends, and remote session continuity. |
| [Odysseus](https://github.com/odysseus-dev/odysseus) | Workspace-first navigation across chat, agents, tools, research, notes, tasks, calendar, memory, model comparison, and hardware-aware model discovery. |
| [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm) and its [agent setup guide](https://github.com/Mintplex-Labs/anything-llm/blob/master/pages/agent/setup.mdx) | Workspace-specific model policy, granular skills, composer tool toggles, and intelligent tool selection to avoid bloated prompts. |
| [Happy](https://github.com/slopus/happy) and [Happy Desktop](https://github.com/slopus/happy-desktop) | Sessions that survive the window, multi-device control, encrypted sync, harness-specific prompts, notifications, and shared sessions. |
| [OpenHands](https://github.com/All-Hands-AI/OpenHands) | Autonomous task runs, workspace snapshots, delegation, and reviewable execution traces. |
| [Open WebUI](https://github.com/open-webui/open-webui) | Folder workspaces, split panes, side chats, tool search, subagents, and an extensible chat workspace. |
| [Cline](https://github.com/cline/cline), [Kilo Code](https://github.com/Kilo-Org/kilocode), and [Goose](https://github.com/block/goose) | Explicit Plan/Ask/Agent modes, browser/terminal tools, MCP-first extension, and provider-agnostic coding workflows. |

Tags such as `[Continue]` or `[Ruflo]` identify the strongest inspiration; they
do not mean the feature should be copied without adapting it to Skai's local,
Windows-first safety model.

## 1. Shell, navigation, and information architecture

1. `[P0][Codex][Odysseus]` Replace route-specific top tabs with a single workspace header that always shows workspace, project, chat, and active mode.
2. `[P0][Codex]` Hide the current chat tab on Usage, Settings, Marketplace, Memory, and other non-chat pages.
3. `[P0][Odysseus]` Add a persistent left rail with stable destinations: Chat, Projects, Tasks, Files, Tools, Models, Media, Usage, and Settings.
4. `[P0][Codex]` Make the selected rail item and selected sub-view share one visual state instead of two competing highlights.
5. `[P0][Odysseus]` Add a global command/search affordance in the shell header that searches routes, chats, files, tasks, models, and tools.
6. `[P1][Codex]` Keep a compact breadcrumb for nested pages such as Project → Files → file name and Project → Tasks → task name.
7. `[P1][Continue]` Add a mode switcher in the shell that cycles Chat, Plan, Agent, Review, Research, and Media without losing the draft.
8. `[P1][Odysseus]` Let users pin a destination or workspace to the rail and drag pinned destinations into a custom order.
9. `[P1][Codex]` Persist the last useful shell layout per project instead of applying one global layout to every project.
10. `[P2][Happy]` Add a “session is active elsewhere” presence indicator when the same Skai session is open in another window or device.

## 2. Chat and composer fundamentals

11. `[P0][Codex]` Make the composer the same component in Chat, Plan, Agent, Review, and side-chat views.
12. `[P0][Continue]` Show the current mode directly inside the composer, with a one-line explanation of what tools that mode may use.
13. `[P0][Codex]` Swap the empty-composer send button for microphone/voice-mode controls, then restore send as soon as text or an attachment exists.
14. `[P0][Continue]` Add `@` context completion for files, folders, chats, tasks, skills, tools, and web sources.
15. `[P0][AnythingLLM]` Add a Tools button in the composer that lets users toggle skills and MCP tools for the next turn only.
16. `[P0][Continue]` Add Plan mode as a read-only composer state that cannot write files or run commands.
17. `[P0][Codex]` Add Agent mode as an explicit full-tool state with permission prompts before mutating actions.
18. `[P1][Codex]` Add a visible “working in” chip that names the project, folder, branch, and selected model before submission.
19. `[P1][Continue]` Preserve drafts, attachments, and mode selection when the user changes routes or opens a side chat.
20. `[P1][Codex]` Add a compact composer footer showing model, effort, context budget, active tools, and keyboard submit behavior.

## 3. Conversation controls and response ergonomics

21. `[P0][Codex]` Add one-click Stop, Pause, Resume, Retry, and Continue controls to every running response.
22. `[P0][Happy]` Let a session continue in the background after the window closes and show its last known state on reopen.
23. `[P0][Codex]` Make every tool call collapsible with status, duration, inputs, outputs, and a clear approval decision.
24. `[P0][Continue]` Add an inline “why this tool?” explanation before a tool approval request.
25. `[P0][Codex]` Add per-message actions for edit, branch, fork, retry with another model, copy, export, and open in side chat.
26. `[P1][Continue]` Add a response mode toggle for concise, balanced, and detailed explanations without changing the project policy.
27. `[P1][Codex]` Add a visible transcript timeline for long-running work instead of a single undifferentiated spinner.
28. `[P1][Happy]` Show reconnecting, queued, remote, and local session states with actionable recovery text.
29. `[P1][Codex]` Make assistant messages support “apply all,” “review changes,” and “open changed files” actions when edits are present.
30. `[P2][Odysseus]` Add conversation dashboards for recent work, unfinished tasks, saved outputs, and unresolved approvals.

## 4. Context, attachments, and prompt composition

31. `[P0][Continue]` Add a context tray that lists every file, folder, memory, source, and tool included in the next request.
32. `[P0][AnythingLLM]` Add relevance-ranked context selection so large tool catalogs and document sets are not always injected wholesale.
33. `[P0][Codex]` Add a context budget meter with a preview of what will be omitted before submission.
34. `[P0][Continue]` Add “use current file,” “use selection,” and “use project” shortcuts from the file viewer.
35. `[P0][Codex]` Add attachment-level trust labels for user content, project content, web content, and generated content.
36. `[P1][AnythingLLM]` Let users choose workspace, project, conversation, or one-turn document scope for each attachment.
37. `[P1][Odysseus]` Add a document inbox that keeps imported documents separate from chats and projects until explicitly linked.
38. `[P1][Codex]` Add local OCR status, truncation status, and extraction preview for PDFs and images before they enter context.
39. `[P1][Continue]` Add a “remove duplicate context” action that merges repeated files and source excerpts.
40. `[P2][Codex]` Add prompt composer blocks for goal, constraints, acceptance criteria, files, tools, and output format.

## 5. Projects, files, and workspace surfaces

41. `[P0][Codex]` Make the project switcher available from the composer, command palette, and shell header.
42. `[P0][Odysseus]` Give every project a home dashboard with chats, tasks, files, Git status, active agents, and recent artifacts.
43. `[P0][Codex]` Expand the file viewer to fill unused space while keeping a compact project tree and inspector.
44. `[P0][Open WebUI]` Add draggable split panes for chat, file viewer, terminal, diff, and browser surfaces.
45. `[P0][Codex]` Persist pane sizes, open tabs, active file, scroll positions, and expanded tree folders per project.
46. `[P1][Continue]` Add “open in editor,” “add to context,” “compare with chat,” and “start review” actions to every file row.
47. `[P1][Codex]` Add a project-scoped scratchpad for notes, decisions, commands, and temporary links.
48. `[P1][Odysseus]` Add project-level Tasks, Notes, Documents, and Research collections without forcing everything into chat history.
49. `[P1][Happy]` Add a project health banner for disconnected runtime, missing folder, stale Git state, or interrupted task.
50. `[P2][Codex]` Add a read-only project snapshot mode for reviewing files and history without enabling mutations.

## 6. Coding task loop

51. `[P0][Codex]` Turn “new coding thread” into a goal-first task setup with goal, scope, mode, model, branch, and acceptance criteria.
52. `[P0][Continue]` Add a read-only Plan stage that summarizes files, risks, and proposed edits before the Agent stage.
53. `[P0][Codex]` Require an explicit “start implementation” action after a plan is generated.
54. `[P0][OpenHands]` Show a durable task timeline: planning, editing, testing, reviewing, blocked, needs input, and complete.
55. `[P0][Codex]` Add a changed-files rail that updates as edits land and links directly to each diff.
56. `[P1][Continue]` Add a task-local test command picker with detected package, native, and project checks.
57. `[P1][Codex]` Add a verification gate that blocks completion until configured checks produce evidence.
58. `[P1][OpenHands]` Add resumable task checkpoints after planning, first edit, test pass, and review.
59. `[P1][Codex]` Add a “revert last agent step” action backed by the existing file undo history.
60. `[P2][Codex]` Add reusable task templates for bug fix, feature, refactor, dependency update, documentation, and security review.

## 7. Git and GitHub workflow

61. `[P0][Codex]` Make branch, ahead/behind, conflicts, and dirty state visible in the project header.
62. `[P0][Codex]` Add a preflight card before commit or push that lists selected files, tests, branch target, and remote target.
63. `[P0][Codex]` Add hunk-level selection directly inside the file diff viewer.
64. `[P0][Codex]` Add a review queue for changed files with unread, accepted, rejected, and needs-follow-up states.
65. `[P0][OpenHands]` Add a “prepare pull request” task that gathers summary, tests, screenshots, risks, and rollback notes.
66. `[P1][Codex]` Add issue-to-task intake that imports issue title, body, labels, links, and acceptance criteria into a local task.
67. `[P1][Omnigent]` Add reviewer assignment across local models or harnesses, with the author and reviewer kept separate.
68. `[P1][Ruflo]` Add a review topology that routes security, tests, UX, and dependency checks to specialized workers.
69. `[P2][Codex]` Add protected-branch guidance explaining why a push or force-push is blocked and what safe alternatives exist.
70. `[P2][Happy]` Add push/PR completion notifications with a deep link back to the exact review state.

## 8. Subagents and orchestration

71. `[P0][Ruflo]` Add a visual agent roster with roles, status, model, branch/worktree, tools, and current step.
72. `[P0][Omnigent]` Add a harness selector per subagent so one worker can use Codex, another Continue, and another a local runtime.
73. `[P0][Ruflo]` Add explicit topologies: sequential, parallel, hierarchical, debate, reviewer loop, and fan-out/fan-in.
74. `[P0][Codex]` Require each subagent proposal to declare scope, allowed paths, tools, model, timeout, and output contract.
75. `[P0][Omnigent]` Add a supervisor-only view that shows agent messages, tool calls, approvals, and handoffs without cluttering the user transcript.
76. `[P1][Ruflo]` Add worktree allocation and cleanup status directly to each agent card.
77. `[P1][Ruflo]` Add a queue for blocked agents with reason, dependency, owner, and suggested next action.
78. `[P1][Omnigent]` Add cross-agent review handoff where the author cannot approve its own result.
79. `[P2][Ruflo]` Add bounded worker loops for test-fix-test and review-fix-review with a visible iteration cap.
80. `[P2][Codex]` Add “merge findings” and “discard worker” controls with a durable audit record.

## 9. Models, providers, and runtimes

81. `[P0][Odysseus]` Add a hardware-aware model recommender with RAM, VRAM, disk, quantization, and task-role fit.
82. `[P0][AnythingLLM]` Separate system-default, project-default, agent-default, and one-turn model selection.
83. `[P0][Continue]` Show model capability badges for tools, vision, edit, autocomplete, reasoning, and structured output.
84. `[P0][Codex]` Add runtime preflight before a task starts: endpoint, model availability, context capacity, disk, and permissions.
85. `[P1][Codex]` Add mid-session model switching without losing transcript, context tray, or task state.
86. `[P1][Happy]` Preserve the same transcript while switching between harnesses or model providers.
87. `[P1][Odysseus]` Add blind model comparison with identical prompt, context, and scoring rubric.
88. `[P1][Codex]` Add model health history with last success, latency, token throughput, and failure category.
89. `[P2][Continue]` Add role-specific model bindings for chat, plan, edit, apply, summarize, autocomplete, and review.
90. `[P2][Codex]` Add a runtime repair wizard that explains missing binaries, wrong endpoints, stale downloads, and incompatible formats.

## 10. Skills, tools, and MCP

91. `[P0][AnythingLLM]` Add a searchable skill/tool picker in the composer with one-turn and persistent scopes.
92. `[P0][Continue]` Show tool availability by mode: Chat, Plan, Agent, Review, and Research.
93. `[P0][AnythingLLM]` Add intelligent tool selection that ranks only relevant tools into the model request.
94. `[P0][Ruflo]` Add a Plugin Catalog with install, enable, disable, update, rollback, and provenance actions.
95. `[P0][Codex]` Show tool risk, required permissions, data boundary, and expected side effects before first use.
96. `[P1][Ruflo]` Add tool health, last error, latency, schema version, and compatible runtime to each MCP card.
97. `[P1][AnythingLLM]` Let users configure skills per workspace and override them for one agent or one task.
98. `[P1][Omnigent]` Add policy layers at server, project, agent, task, and tool scope with visible precedence.
99. `[P2][Codex]` Add a “why was this tool selected?” trace for automatic tool routing.
100. `[P2][Ruflo]` Add a tool test harness that runs read-only probes against every installed skill or MCP connection.

## 11. Memory, retrieval, and research

101. `[P0][Odysseus]` Add a first-class Research workspace with question, sources, notes, claims, and report output.
102. `[P0][Odysseus]` Add staged research progress: search, collect, read, extract, cross-check, synthesize, cite.
103. `[P0][AnythingLLM]` Add workspace-specific document indexes and retrieval policies.
104. `[P0][Ruflo]` Add memory namespaces for global, project, task, agent, and temporary run state.
105. `[P1][Odysseus]` Add memory provenance showing source, date, scope, confidence, and last-used time.
106. `[P1][Codex]` Add a “use memory” disclosure to the context tray before submission.
107. `[P1][Odysseus]` Add saved research briefs that can be reopened, refreshed, or exported without recreating the chat.
108. `[P1][AnythingLLM]` Add a retrieval inspector that shows why each chunk was selected and what was excluded.
109. `[P2][Ruflo]` Add successful-pattern capture from completed tasks with explicit user approval before durable memory storage.
110. `[P2][Codex]` Add citation linting that rejects unsupported claims or stale sources in research outputs.

## 12. Terminal, browser, and computer use

111. `[P0][Codex]` Add a terminal pane that is scoped to the selected project and task, not a global hidden process.
112. `[P0][Codex]` Show command preview, working directory, environment summary, timeout, and network boundary before execution.
113. `[P0][Continue]` Add read-only terminal policy for Plan and Review modes.
114. `[P0][Codex]` Add streaming terminal output with search, copy, wrap toggle, and download-as-log.
115. `[P1][OpenHands]` Add browser sessions as named task resources with URL, profile, cookies, and permission scope visible.
116. `[P1][Codex]` Add computer-use checkpoints before clicks, typing, downloads, and external submissions.
117. `[P1][Omnigent]` Add selectable sandbox backends with capability comparison before launching a run.
118. `[P1][Codex]` Add a kill-switch that stops the process tree, browser session, and pending tool calls together.
119. `[P2][Happy]` Add remote terminal attachment with explicit host identity and session ownership.
120. `[P2][Codex]` Add replayable command evidence with sanitized output, exit code, duration, and artifact links.

## 13. Schedules and automations

121. `[P0][Codex]` Add a visual automation builder with trigger, context, model, tools, approval policy, and output destination.
122. `[P0][Ruflo]` Add cron, manual, project-event, webhook, and file-change triggers with clear activation states.
123. `[P0][AnythingLLM]` Add an automation-level model and skill profile independent of the global default.
124. `[P0][Codex]` Require a dry run and permission preview before activation.
125. `[P1][Ruflo]` Add overlap policies: queue, replace, skip, or allow bounded concurrency.
126. `[P1][Codex]` Add a run timeline with input snapshot, selected model, tool calls, approvals, result, and artifacts.
127. `[P1][Odysseus]` Add calendar-like schedule browsing with local timezone and next-run explanation.
128. `[P1][Happy]` Add completion, failure, and approval-needed notifications with quiet hours.
129. `[P2][Codex]` Add “create automation from this task” and “save as workflow” actions.
130. `[P2][Ruflo]` Add retry budgets and circuit breakers for repeatedly failing automations.

## 14. Voice and live multimodal interaction

131. `[P0][Codex]` Add full-duplex voice mode from the empty composer with visible listening, thinking, speaking, and interrupted states.
132. `[P0][Happy]` Keep a live voice session attached to the same conversation when the window changes or reconnects.
133. `[P0][Codex]` Add barge-in interruption that stops speech and preserves the partial transcript.
134. `[P0][Codex]` Show live transcript, confidence, speaker turn, and editable correction before sending.
135. `[P1][Continue]` Let voice mode use the same Chat/Plan/Agent mode policy as text mode.
136. `[P1][Codex]` Add voice device, runtime, latency, and fallback status beside the mic control.
137. `[P1][Odysseus]` Add voice presets for persona, pacing, expressiveness, pronunciation, and language.
138. `[P1][Codex]` Add a voice privacy indicator showing local-only versus network speech processing.
139. `[P2][Happy]` Add push notification when a remote voice/task session needs user input.
140. `[P2][Codex]` Add downloadable transcript and audio-session evidence with retention controls.

## 15. Visuals, media, and artifacts

141. `[P0][Codex]` Keep the Visuals Workshop canvas dominant and move advanced controls into a collapsible inspector.
142. `[P0][Odysseus]` Add a unified Gallery for images, audio, video, documents, and generated reports.
143. `[P0][Codex]` Add media-job states: queued, preparing, running, review, failed, recoverable, and exported.
144. `[P0][Codex]` Add per-result prompt, seed, model, dimensions, workflow, license, and source metadata.
145. `[P1][AnythingLLM]` Add asset collections scoped to project, conversation, or global library.
146. `[P1][Open WebUI]` Add compare view for before/after edits and multiple generated candidates.
147. `[P1][Codex]` Add local-file import with thumbnail, type, size, source path, and trust boundary.
148. `[P1][Codex]` Keep unavailable Video and Music actions visible as honest placeholders with readiness requirements.
149. `[P2][Ruflo]` Add media workflow templates with named steps, runtime requirements, and retry behavior.
150. `[P2][Codex]` Add export bundles that include the artifact, prompt, workflow snapshot, and provenance manifest.

## 16. Marketplace and installed inventory

151. `[P0][Codex]` Use one Installed inspector for models, voices, skills, tools, MCP servers, personas, and media runtimes.
152. `[P0][Codex]` Separate “update downloaded item” from “update Skai Desktop” in every navigation surface.
153. `[P0][Ruflo]` Add package preview for contents, permissions, network access, license, digest, and maintainer.
154. `[P0][Codex]` Add dependency impact before removal, including active chats, agents, schedules, and workflows.
155. `[P1][Ruflo]` Add package channels, pinned versions, rollback copies, and release notes.
156. `[P1][AnythingLLM]` Add install profiles such as minimal, coding, research, voice, and media.
157. `[P1][Codex]` Add a download queue with pause, resume, retry, checksum, and disk-space preflight.
158. `[P1][Odysseus]` Add hardware compatibility filters before showing model install actions.
159. `[P2][Codex]` Add one-click “repair inventory” that re-scans runtimes without changing installed data.
160. `[P2][Ruflo]` Add marketplace audit history for install, update, enable, disable, rollback, and remove.

## 17. Settings and customization

161. `[P0][Odysseus]` Group Settings by outcomes: Workspace, Models, Tools, Permissions, Memory, Voice, Media, Data, and Updates.
162. `[P0][Codex]` Add settings search with highlighted matches and direct deep links into the exact control.
163. `[P0][AnythingLLM]` Make project-level overrides visually distinct from global defaults.
164. `[P0][Continue]` Add a capability matrix showing which modes, models, and tools work together.
165. `[P1][Codex]` Add named workspace layouts with preview thumbnails, reset, duplicate, and per-project assignment.
166. `[P1][Codex]` Add density, typography, contrast, motion, and sidebar-width presets with live preview.
167. `[P1][Ruflo]` Add policy profiles such as Safe, Balanced, Autonomous, and Custom with a diff before applying.
168. `[P1][Happy]` Add device/session management with revoke, rename, last seen, and encryption status.
169. `[P2][Codex]` Add import/export for non-secret preferences, layouts, aliases, personas, and workflow templates.
170. `[P2][Codex]` Add a settings change history with undo for reversible preferences.

## 18. Collaboration and session continuity

171. `[P0][Happy]` Add explicit session ownership: local-only, shared, remote-controlled, or collaborative.
172. `[P0][Happy]` Add end-to-end encrypted session sync as an opt-in capability with a clear relay boundary.
173. `[P0][Omnigent]` Add live collaborator presence, cursor/selection state, and who last steered the agent.
174. `[P0][Omnigent]` Add role-based collaboration permissions for observe, comment, steer, approve, and administer.
175. `[P1][Happy]` Add resume-from-phone/browser flow with full transcript and pending approvals restored.
176. `[P1][Codex]` Add fork-to-new-session while preserving source provenance and context choices.
177. `[P1][Omnigent]` Add shareable read-only task links that omit secrets and local paths.
178. `[P2][Happy]` Add encrypted attachment sync with per-file opt-in and expiration.
179. `[P2][Codex]` Add collaboration audit history for joins, approvals, handoffs, and revocations.
180. `[P2][Happy]` Add offline outbox/reconnect handling that clearly labels messages waiting to send.

## 19. Safety, reliability, and observability

181. `[P0][Codex]` Add a single activity timeline that correlates chat turns, tool calls, file edits, commands, approvals, and artifacts.
182. `[P0][Omnigent]` Show effective policy after merging global, project, agent, task, and tool rules.
183. `[P0][Codex]` Add prompt-injection warnings at the exact untrusted file, web source, or tool output that triggered them.
184. `[P0][Codex]` Add a universal Stop Everything action with a confirmation only for already-committed external side effects.
185. `[P1][Ruflo]` Add run health with queue depth, worker count, retries, memory pressure, and stuck-step detection.
186. `[P1][Codex]` Add structured failure cards with cause, scope, recovery action, and safe retry boundary.
187. `[P1][Omnigent]` Add sandbox capability diff before and after a runtime or provider change.
188. `[P2][Codex]` Add local diagnostic bundle export with secret redaction, version, platform, and reproduction steps.
189. `[P2][Ruflo]` Add policy regression fixtures that prove a new plugin cannot widen an existing grant.
190. `[P2][Codex]` Add retention controls for transcripts, logs, tool outputs, attachments, and generated artifacts.

## 20. Accessibility, performance, and quality gates

191. `[P0][Continue]` Add keyboard shortcuts for mode cycling, context picker, tool approval, stop, resume, and focus changes.
192. `[P0][Codex]` Add screen-reader summaries for every running task, approval, pane, and status change.
193. `[P0][Open WebUI]` Add responsive layouts for narrow windows, split panes, and high zoom without hiding critical actions.
194. `[P0][Codex]` Add visual regression fixtures for Chat, Coding, Usage, Settings, Marketplace, Visuals, and side chat.
195. `[P1][Codex]` Add performance budgets for initial shell, route switch, composer open, file viewer, and model picker.
196. `[P1][Continue]` Add a deterministic model-capability fixture matrix for Chat, Plan, Agent, Edit, and Review.
197. `[P1][Ruflo]` Add orchestration test fixtures for every topology, cancellation, retry, worker failure, and merge outcome.
198. `[P1][Happy]` Add reconnect and resume fixtures for closed windows, offline devices, expired sessions, and partial history.
199. `[P2][Codex]` Add a release checklist that requires typecheck, native tests, package build, UI matrix, accessibility scan, and evidence links.
200. `[P2][Codex]` Add a “workflow comparison” review step that captures before/after screenshots and records which reference pattern each change adopts.

## Suggested delivery order

Start with 1–20 (shell and composer), then 21–40 (conversation and context),
then 51–80 (coding and orchestration). Those three groups create the largest
workflow improvement. The remaining groups can be delivered in vertical slices
that each include UI, Agent Host/native behavior, persistence, and a focused
packaged smoke flow.

## Research caveats

These references are inspiration, not proof that every advertised feature is
safe or complete. Skai should retain its local-first posture, explicit approvals,
bounded filesystem access, and platform-specific safety disclosures. Features
that require cloud relays, mobile encryption, remote sandboxes, or third-party
credentials should remain opt-in and should not silently weaken local policy.
