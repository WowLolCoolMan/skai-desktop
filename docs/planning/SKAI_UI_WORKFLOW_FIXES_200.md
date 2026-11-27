# Skai UI and workflow overhaul: 400 fixes

This is a proposal backlog, not a claim that every item is already implemented.
The order is intentional: items 1–50 remove the highest-friction shell and
composer problems; 51–200 improve the agent work loop; 201–400 deepen the
product's extensibility, observability, collaboration, accessibility, and finish
quality. Each line is written as a testable fix that can become its own
implementation slice.

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

## Additional 200 fixes

## 21. Shell polish and responsive composition

201. `[P0][Codex]` Add a compact shell mode that collapses labels while retaining tooltips and keyboard access.
202. `[P0][Open WebUI]` Add a split-pane drag handle with a visible percentage and snap points.
203. `[P0][Codex]` Keep the primary action fixed when a page scrolls, while allowing secondary controls to scroll.
204. `[P1][Codex]` Add a shell-wide focus ring that identifies the active pane and restores focus after route changes.
205. `[P1][Odysseus]` Add a “workspace overview” shortcut that opens a visual map of open chats, tasks, files, and tools.
206. `[P1][Open WebUI]` Add pane presets for single, chat-plus-files, chat-plus-terminal, review, and research layouts.
207. `[P1][Codex]` Add a mobile-width bottom navigation fallback for compact windows instead of squeezing the left rail.
208. `[P2][Codex]` Add density preview cards that show the same screen at comfortable, compact, and touch sizes.
209. `[P2][Happy]` Preserve shell layout when the app is reopened on a different monitor or DPI scale.
210. `[P2][Codex]` Add an empty-space inspector that suggests useful panels when a workspace has no active artifact.

## 22. Chat workflow intelligence

211. `[P0][Continue]` Add a one-click “explain before changing” action that switches a draft to Plan mode.
212. `[P0][Codex]` Add an explicit target selector for answering, editing, reviewing, researching, or generating media.
213. `[P0][AnythingLLM]` Add tool recommendations beside the draft without enabling them automatically.
214. `[P1][Codex]` Add draft linting for missing project, vague goal, absent acceptance criteria, and unsupported requested output.
215. `[P1][Continue]` Add recent `@` context suggestions based on the active file, branch, and last task.
216. `[P1][Codex]` Add a “send and keep editing” command for users who want to queue multiple prompts.
217. `[P1][Codex]` Add a visible queue preview with reorder, edit, remove, and send-now actions.
218. `[P2][Happy]` Add voice/text handoff so a voice turn can become an editable text draft before sending.
219. `[P2][Odysseus]` Add prompt starters generated from the current project state, not generic sample prompts.
220. `[P2][Codex]` Add a composer history drawer for restoring recently discarded drafts without reopening a chat.

## 23. Conversation history and organization

221. `[P0][Codex]` Add folders and tags to the chat list with keyboard shortcuts for assignment.
222. `[P0][Odysseus]` Add saved views such as Active work, Needs review, Research, Unfinished, and Media.
223. `[P0][Codex]` Add conversation-level status: open, waiting, blocked, complete, archived, or deleted.
224. `[P1][Happy]` Add session resume cards that show last device, last model, pending approvals, and last activity.
225. `[P1][Codex]` Add timeline search across user messages, assistant messages, tool calls, files, and task events.
226. `[P1][Odysseus]` Add a conversation summary card with decisions, open questions, files touched, and next actions.
227. `[P1][Codex]` Add bulk archive, move, tag, export, and delete actions with undo.
228. `[P2][Codex]` Add duplicate-conversation detection with side-by-side merge planning.
229. `[P2][Happy]` Add a “continue elsewhere” marker when a session moves between local windows or devices.
230. `[P2][Codex]` Add retention previews before automatic cleanup removes old chats or artifacts.

## 24. Plans, tasks, and durable artifacts

231. `[P0][Codex]` Render a plan as a first-class artifact with steps, dependencies, risks, and acceptance criteria.
232. `[P0][OpenHands]` Add checkpoints that can be reopened as a task, review, or fresh branch.
233. `[P0][Codex]` Add task-level scope chips for files, folders, commands, tools, and network access.
234. `[P1][Ruflo]` Add dependency graph view for tasks that wait on other tasks or approvals.
235. `[P1][Codex]` Add “mark as blocked” with a structured reason and requested user input.
236. `[P1][Codex]` Add task artifacts for plan, diff, test evidence, review notes, and release notes.
237. `[P1][OpenHands]` Add recovery from the latest checkpoint without replaying completed side effects.
238. `[P2][Codex]` Add task templates that include test commands, reviewers, tool policy, and branch naming.
239. `[P2][Ruflo]` Add an execution budget for time, tokens, retries, disk, and worker count.
240. `[P2][Codex]` Add a completion report that distinguishes requested work, verified work, and deferred work.

## 25. Multi-agent team experience

241. `[P0][Ruflo]` Add a team canvas where agents are connected by explicit input and output edges.
242. `[P0][Omnigent]` Add agent capability cards showing harness, model, tools, filesystem, network, and review role.
243. `[P0][Ruflo]` Add a “suggest team” action that proposes roles from the task goal and project state.
244. `[P1][Omnigent]` Add per-agent conversation tabs without duplicating the parent task transcript.
245. `[P1][Ruflo]` Add consensus controls for majority vote, lead decision, reviewer veto, and user decision.
246. `[P1][Codex]` Add a shared findings board where agents can pin evidence, questions, risks, and conflicts.
247. `[P1][Omnigent]` Add handoff packets with summary, files, commands, assumptions, and unverified claims.
248. `[P2][Ruflo]` Add agent heartbeat and stale-worker recovery with a manual takeover action.
249. `[P2][Omnigent]` Add cross-harness transcript normalization so tool calls are comparable.
250. `[P2][Codex]` Add an agent cost/latency panel without exposing secrets or provider credentials.

## 26. GitHub, CI, and review depth

251. `[P0][Codex]` Add a review dashboard that groups changed files by risk, owner, test coverage, and dependency.
252. `[P0][Codex]` Add check-run cards for local, GitHub Actions, and external CI with stale-result labels.
253. `[P0][Codex]` Add a required-review policy preview before creating or updating a pull request.
254. `[P1][OpenHands]` Add issue templates that convert acceptance criteria into task checklist items.
255. `[P1][Codex]` Add commit message suggestions derived from the selected diff and task goal.
256. `[P1][Codex]` Add a safe branch cleanup wizard that checks open tasks, worktrees, and unpushed commits.
257. `[P1][Omnigent]` Add an independent reviewer harness selector for pull request validation.
258. `[P2][Codex]` Add release-note drafts grouped by user-visible behavior and breaking changes.
259. `[P2][Codex]` Add conflict previews that explain both sides before offering a merge action.
260. `[P2][Happy]` Add remote review notifications for new comments, failed checks, and requested changes.

## 27. Context and knowledge quality

261. `[P0][Continue]` Add a ranked context explanation showing relevance score and selection reason per item.
262. `[P0][AnythingLLM]` Add document collection policies for chunk size, overlap, metadata, and embedding runtime.
263. `[P0][Codex]` Add a “context freeze” action that keeps the exact request inputs while the user edits the draft.
264. `[P1][Odysseus]` Add research source cards with fetch date, source type, credibility note, and extracted claims.
265. `[P1][Codex]` Add stale-context warnings when an attached file changed after it was selected.
266. `[P1][AnythingLLM]` Add retrieval evaluation prompts and a local relevance score report.
267. `[P1][Odysseus]` Add note linking between chats, documents, research reports, tasks, and projects.
268. `[P2][Ruflo]` Add memory decay and review dates for durable patterns.
269. `[P2][Codex]` Add a context-diff view between two task runs.
270. `[P2][Codex]` Add an exportable context manifest for reproducing a request locally.

## 28. Tools, MCP, and extension platform

271. `[P0][AnythingLLM]` Add an effective-tool list that shows only tools available for the current mode and project.
272. `[P0][Ruflo]` Add plugin dependency graphs with version conflicts and safe disable suggestions.
273. `[P0][Codex]` Add schema previews for tool arguments with examples and sensitive-field markings.
274. `[P1][Omnigent]` Add a connector contract that describes authentication, sandbox, network, and data retention.
275. `[P1][Ruflo]` Add extension lifecycle events for install, enable, disable, update, rollback, and revoke.
276. `[P1][Codex]` Add a one-click “copy tool call as reproducible request” action.
277. `[P2][AnythingLLM]` Add tool-selection telemetry stored locally for prompt-size and latency analysis.
278. `[P2][Ruflo]` Add a plugin compatibility matrix across OS, runtime, model, and permission profiles.
279. `[P2][Codex]` Add a dry-run sandbox for new tool calls that records intended side effects only.
280. `[P2][Omnigent]` Add extension hot reload with a visible generation number and rollback action.

## 29. Workflow graphs and orchestration

281. `[P0][Ruflo]` Add a visual DAG editor for composing agents, tools, approvals, conditions, and outputs.
282. `[P0][Codex]` Add a step inspector that shows inputs, outputs, retries, timeout, policy, and artifacts.
283. `[P0][Ruflo]` Add a workflow simulator that walks the graph without invoking mutating tools.
284. `[P1][Omnigent]` Add reusable agent definitions with versioned YAML/JSON export and validation.
285. `[P1][Codex]` Add branch and join nodes with explicit failure semantics.
286. `[P1][Ruflo]` Add workflow-level concurrency limits and fairness across projects.
287. `[P2][Codex]` Add a local event bus for task, file, Git, schedule, and runtime events.
288. `[P2][Ruflo]` Add idempotency keys to prevent duplicate workflow side effects after restart.
289. `[P2][Omnigent]` Add remote execution adapters that expose their sandbox capabilities before dispatch.
290. `[P2][Codex]` Add workflow version comparison and migration hints when a saved graph changes.

## 30. Models, benchmarks, and runtime ergonomics

291. `[P0][Odysseus]` Add a model cookbook organized by task role, hardware fit, license, and install size.
292. `[P0][Continue]` Add role capability tests for tool calling, edit format, JSON, vision, and long context.
293. `[P0][Codex]` Add benchmark result cards with prompt, context, runtime, quantization, and temperature.
294. `[P1][Codex]` Add warm/cold start latency and memory use to local model health.
295. `[P1][AnythingLLM]` Add per-workspace provider fallback chains with explicit routing explanation.
296. `[P1][Happy]` Preserve reasoning effort and tool policy when switching provider or harness.
297. `[P2][Odysseus]` Add model compare labels for blind, named, and weighted scoring modes.
298. `[P2][Codex]` Add a “why this model?” explanation on every task and automation run.
299. `[P2][Codex]` Add runtime logs that separate model error, network error, capacity error, and policy denial.
300. `[P2][Codex]` Add a model cleanup advisor that identifies unused weights and dependent workflows.

## 31. Voice and audio depth

301. `[P0][Codex]` Add a voice-mode preflight for microphone, speaker, runtime, permissions, and fallback engine.
302. `[P0][Happy]` Add reconnect-safe voice sessions that resume without sending duplicate turns.
303. `[P0][Codex]` Add an interrupt timeline showing where the user barged in and where speech stopped.
304. `[P1][Codex]` Add per-turn audio playback speed, replay, download, and transcript correction.
305. `[P1][Odysseus]` Add pronunciation dictionaries scoped to persona, project, and global voice settings.
306. `[P1][Codex]` Add a local voice quality test using a bounded phrase and latency report.
307. `[P2][Happy]` Add remote voice permission prompts with an encrypted session-state indicator.
308. `[P2][Codex]` Add audio clip trimming and naming in the Voice Workbench.
309. `[P2][Codex]` Add waveform and transcript alignment for generated speech.
310. `[P2][Codex]` Add retention and export controls for microphone input and generated audio.

## 32. Visual generation and media workflow

311. `[P0][Codex]` Add a generation brief that separates subject, composition, style, motion, exclusions, and output constraints.
312. `[P0][Codex]` Add an inspector for model, workflow, checkpoint, custom nodes, seed, and output dimensions.
313. `[P0][Odysseus]` Add media collections with cover image, description, tags, and project links.
314. `[P1][Codex]` Add a contact sheet for queued image candidates with select, compare, and promote actions.
315. `[P1][Open WebUI]` Add comments and annotations on generated media without altering the source file.
316. `[P1][Codex]` Add workflow validation before queueing missing checkpoint, node, disk, and endpoint errors.
317. `[P2][Codex]` Add a seed lock and variation slider for controlled iteration.
318. `[P2][Ruflo]` Add media batch orchestration with bounded concurrency and per-item retry.
319. `[P2][Codex]` Add provenance badges for generated, edited, imported, and user-authored assets.
320. `[P2][Codex]` Add a local media cleanup view that previews what history removal will and will not delete.

## 33. Data portability and history

321. `[P0][Codex]` Add a portable workspace manifest that lists projects, chats, tasks, tools, models, and layouts.
322. `[P0][Codex]` Add an import dry run that identifies conflicts, unsupported fields, and redacted secrets.
323. `[P0][Happy]` Add per-device export keys and a clear statement of what encrypted sync stores.
324. `[P1][Codex]` Add versioned migration reports with before/after record counts.
325. `[P1][Odysseus]` Add a unified artifact library that can reattach files to a new conversation or task.
326. `[P1][Codex]` Add undo for reversible deletion of chats, projects, tasks, skills, and media history.
327. `[P2][Codex]` Add selective export by tag, project, date range, or workflow.
328. `[P2][Happy]` Add offline export when a relay or remote device is unavailable.
329. `[P2][Codex]` Add an archive browser that can inspect old versions without restoring them.
330. `[P2][Codex]` Add data ownership summaries showing local path, owner, retention, and deletion action per category.

## 34. Collaboration and distributed sessions

331. `[P0][Omnigent]` Add a collaboration lobby that explains who can observe, steer, approve, or edit.
332. `[P0][Happy]` Add device pairing with QR/code fallback and a revocable local identity.
333. `[P0][Happy]` Add conflict-safe message ordering when two devices send turns close together.
334. `[P1][Omnigent]` Add collaborator comments anchored to a message, diff hunk, file line, or task step.
335. `[P1][Codex]` Add a “request owner decision” card for conflicts and risky actions.
336. `[P1][Happy]` Add push-notification preferences per project, task, and approval type.
337. `[P2][Omnigent]` Add a shared watch mode that hides secrets and sensitive paths from viewers.
338. `[P2][Happy]` Add session takeover with explicit transfer and previous-owner notification.
339. `[P2][Codex]` Add collaborative task notes with revision history and authorship.
340. `[P2][Happy]` Add reconnect reconciliation that displays missing events instead of silently merging them.

## 35. Security and governance

341. `[P0][Codex]` Add a permission center summary to every task start and tool approval.
342. `[P0][Omnigent]` Add policy simulation that answers “would this action be allowed?” before execution.
343. `[P0][Codex]` Add secret redaction previews before exporting logs, transcripts, or collaboration links.
344. `[P1][Ruflo]` Add plugin trust levels based on publisher, digest, permissions, and update history.
345. `[P1][Codex]` Add a prompt-injection quarantine for files or web content flagged as instruction-like.
346. `[P1][Omnigent]` Add time-limited grants with countdown and automatic expiry.
347. `[P2][Codex]` Add an access ledger that links each external effect to the approving user and policy.
348. `[P2][Ruflo]` Add security review workflows for new tools, skills, and agent definitions.
349. `[P2][Codex]` Add a safe-mode startup that disables all mutating tools until the user opts in.
350. `[P2][Codex]` Add policy snapshots so a run can be audited against the exact rules active at execution time.

## 36. Performance and offline resilience

351. `[P0][Codex]` Add route-level loading skeletons that preserve layout instead of flashing empty pages.
352. `[P0][Codex]` Add virtualized chat history and file trees for large projects and conversations.
353. `[P0][Happy]` Add an offline banner that distinguishes read-only cached work from queued mutations.
354. `[P1][Codex]` Add local cache health with size, last cleanup, and safe clear actions.
355. `[P1][Ruflo]` Add backpressure indicators when agents, tool calls, or model requests are queued.
356. `[P1][Codex]` Add lazy loading for heavy editors, media previews, and model catalogs.
357. `[P2][Codex]` Add a startup diagnostic that identifies slow extensions, runtimes, and corrupted caches.
358. `[P2][Happy]` Add resumable synchronization after network loss with progress and retry controls.
359. `[P2][Codex]` Add memory-pressure mode that reduces previews and pauses nonessential workers.
360. `[P2][Codex]` Add a performance trace export with route timing, render timing, and runtime waits.

## 37. Accessibility and internationalization

361. `[P0][Codex]` Add landmark regions and heading hierarchy checks to every route.
362. `[P0][Continue]` Add keyboard-only workflows for context selection, mode change, approval, and file navigation.
363. `[P0][Codex]` Add high-contrast states for selected, focused, disabled, pending, warning, and error controls.
364. `[P1][Codex]` Add reduced-motion alternatives for task progress, pane transitions, and voice visualization.
365. `[P1][Codex]` Add locale-aware dates, sizes, durations, and decimal formatting everywhere.
366. `[P1][Codex]` Add translation-safe labels that do not rely on fixed-width buttons.
367. `[P2][Codex]` Add right-to-left layout checks for shell, composer, chat, and code views.
368. `[P2][Codex]` Add text scaling acceptance at 125%, 150%, and 200% without clipping.
369. `[P2][Codex]` Add accessible descriptions for generated media, charts, diffs, and terminal output.
370. `[P2][Codex]` Add an accessibility report to the release evidence bundle.

## 38. Diagnostics and developer experience

371. `[P0][Codex]` Add a developer diagnostics page with bridge health, Agent Host health, runtime health, and last errors.
372. `[P0][Codex]` Add copyable correlation IDs for tasks, tool calls, model requests, and background jobs.
373. `[P0][Ruflo]` Add a live worker/event stream with filters for agent, project, severity, and event type.
374. `[P1][Codex]` Add a request inspector that shows bounded request shape without exposing secrets or raw credentials.
375. `[P1][Omnigent]` Add harness conformance checks for supported commands, tools, sessions, and cancellation.
376. `[P1][Codex]` Add a “reproduce this failure” bundle that recreates only safe local inputs.
377. `[P2][Ruflo]` Add health probes for every plugin, memory namespace, scheduler, and worker pool.
378. `[P2][Codex]` Add diagnostics redaction tests for paths, tokens, cookies, and model prompts.
379. `[P2][Codex]` Add a support mode that lets users attach evidence without granting remote control.
380. `[P2][Codex]` Add a debug overlay that can be enabled per session and never persists by default.

## 39. Testing and release confidence

381. `[P0][Codex]` Add deterministic fixtures for empty, loading, success, error, retry, blocked, and recovery states on every major route.
382. `[P0][Continue]` Add contract tests proving mode permissions stay aligned with visible tool availability.
383. `[P0][Ruflo]` Add topology tests proving cancellation and failure propagation for every graph shape.
384. `[P1][Codex]` Add screenshot assertions for no overlap, clipped labels, unreachable actions, and hidden focus.
385. `[P1][Happy]` Add session continuity tests across close, restart, reconnect, and device handoff.
386. `[P1][Omnigent]` Add sandbox capability tests for each supported host backend.
387. `[P2][Codex]` Add migration fixtures for every persisted store and every previous schema version.
388. `[P2][Ruflo]` Add plugin upgrade/rollback tests with incompatible dependency graphs.
389. `[P2][Codex]` Add performance smoke thresholds to the packaged UI matrix.
390. `[P2][Codex]` Add release evidence links directly from the relevant screen and task artifacts.

## 40. Product quality and hard-finish checks

391. `[P0][Codex]` Add a product-wide empty-state language guide and apply it consistently.
392. `[P0][Codex]` Add a consistent action hierarchy for primary, secondary, ghost, destructive, and recovery buttons.
393. `[P0][Odysseus]` Add a page-level “what can I do here?” summary to every workspace route.
394. `[P1][Continue]` Add inline help that explains modes and tools without taking users to a separate manual.
395. `[P1][Codex]` Add a visual consistency audit for spacing, borders, radii, typography, and status colors.
396. `[P1][Codex]` Add an interaction audit for every button, link, picker, toggle, dialog, and keyboard shortcut.
397. `[P2][Happy]` Add a recovery audit for every session, task, upload, download, and sync operation.
398. `[P2][Ruflo]` Add a trust audit for every plugin, subagent, tool, model, and external connector.
399. `[P2][Codex]` Add a user-facing changelog grouped by workflow improvements instead of internal commits.
400. `[P2][Codex]` Require a final before/after review that checks visual hierarchy, state completeness, accessibility, recovery, and local privacy before calling a slice done.

## Suggested delivery order

Start with 1–20 (shell and composer), then 21–40 (conversation and context),
then 51–80 (coding and orchestration). Next take 201–240 for the second pass on
shell, conversation, and durable task artifacts, followed by 241–300 for
orchestration and runtime depth. Finish with 301–400 as the media, portability,
collaboration, safety, platform, and hard-finish pass. Each slice should include
UI, Agent Host/native behavior, persistence, and a focused packaged smoke flow.

## Research caveats

These references are inspiration, not proof that every advertised feature is
safe or complete. Skai should retain its local-first posture, explicit approvals,
bounded filesystem access, and platform-specific safety disclosures. Features
that require cloud relays, mobile encryption, remote sandboxes, or third-party
credentials should remain opt-in and should not silently weaken local policy.
