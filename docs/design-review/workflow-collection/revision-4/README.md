# Skai Desktop workflow references — revision 4

This collection contains 30 references for current Skai Desktop workflows plus one additional future concept for the Video page. The images are the design review record for the Revision 4 UI work.

[Open the continuity sheet](continuity-sheet.jpg) to scan all 31 references together.

The continuity pass uses one exact product name (**Skai Desktop**), a persistent compact desktop shell, dark charcoal/navy surfaces, restrained cyan/violet accents, plain labels, and one obvious next action per screen. It keeps Chat and Coding Agent as familiar work modes and follows common desktop patterns for conversations, projects, search, model discovery, and review.

## Workflow evidence

These are established patterns in other AI desktop apps, not one-off interaction ideas:

- ChatGPT's desktop layout uses conversations/Recents and Projects, with work started in project context. See [Moving to the new ChatGPT desktop app](https://help.openai.com/en/articles/20001276-moving-to-the-new-chatgpt-desktop-app).
- LM Studio documents the local model sequence as Discover → load a model → Chat. See [Get started with LM Studio](https://lmstudio.ai/docs/app/basics).
- Codex keeps agent work reviewable in its conversation thread and lets users inspect changes or open them in an editor. See [Introducing the Codex app](https://openai.com/index/introducing-the-codex-app/).

The designs apply those familiar navigation and review patterns to Skai's documented, local-first capabilities. Fine sample names, copy, statuses, dates, and model metadata inside generated images are illustrative; confirm them against the current app and runtime before implementation.

## Continuity decisions

- The app title is always **Skai Desktop**. Chat, Coding Agent, Images, Model Library, and other names are page or mode labels.
- The shared shell keeps navigation compact and puts the selected page or mode in one clear heading.
- The Coding Agent thread stays visible beside a docked Monaco editor. The editor can be collapsed; a second state shows code review without leaving the thread.
- Persona Workshop and Pet Workshop are separate pages and separate references.
- Video is a future page concept only. Generate and Edit are marked as planned; no video editing or generation controls are shown as working features.
- No old sample brand, unsupported A/B comparison page, fake model capabilities, past scheduled dates, or contradictory runtime states are part of the final set.

## Implementation review status — 2026-11-24

The current packaged app has been checked at 1440×900 across 20 routes in dark
and light themes with the workspace sidebar expanded and collapsed. The matrix
reported no renderer errors or layout failures. A 390×844 pass covered Chat
and Coding with no page-level horizontal overflow or clipped controls. Chat
search/task-tools/import-menu checks and the Coding Agent edit → compare → save
→ undo flow passed; the latter also passed at 390×844 after the workspace was
made to scroll internally. Persona Workshop and Pet Workshop remain separate
routes and their selection/customization flows have separate smoke coverage.
The Video page remains a planned concept.

### Image workflow continuity evidence

The Image page now follows the two primary steps in references #24–25: choose
Generate or Edit, create from a prompt, or reopen a history item into Edit.
Secondary local workflow tools are grouped under More tools. Generate keeps the
prompt and source action prominent and shows local runtime readiness. Edit
shows its source image beside the editing controls and keeps history below. The
packaged screens are captured here:

- [Generate · 1440×900](evidence-image-generate-1440.png)
- [Generate · 390×844](evidence-image-generate-390.png)
- [Edit with source and history · 1440×900](evidence-image-edit-1440.png)

The seeded history-to-edit interaction passed at 1440×900 with both source
previews and zero horizontal overflow. Image generation itself remains
unverified on this profile: the Python runtime is installed, but the local
`stabilityai/sd-turbo` model cache contains only partial `.incomplete` blobs.
The offline smoke confirms the recovery message and does not download the
multi-gigabyte model. This remains an acceptance blocker for the generated
result/edit/history-persistence flow.

### Chat queue and message actions — reference #4

The packaged 1440×900 Chat state and its 390×844 layout are captured in
[desktop evidence](evidence-chat-queue-actions-1440.png) and
[mobile evidence](evidence-chat-queue-actions-390.png). The throwaway-profile
interaction check restores a seeded thread and queue, edits a queued prompt into
the composer, removes a different queued item, opens and cancels the user's
inline edit, and verifies assistant Copy, Retry, and Fork actions. Copy now
falls back to a bounded, main-window-only Electron clipboard bridge when the
renderer clipboard write is unavailable. The packaged smoke confirms the
action and Copy confirmation at both sizes, with no matrix layout findings.

The reference labels assistant actions Copy / Retry / Edit. Skai keeps Edit on
the user's own prompt and offers Fork from here on assistant replies; this
preserves the familiar role-specific pattern while exposing the same prompt
revision path. This is a deliberate small label/action difference, not a
missing queue or message workflow.

### Document-grounded Chat — reference #5

The packaged result state is captured in
[document-grounded Chat evidence](evidence-chat-documents-1440.png). The seeded
thread keeps both attachment names with the user question and shows the answer
citing `Plan.pdf` and `Results.xlsx`. Separately,
`npm run smoke:documents-only` passed real local inference with Qwen3 14B using
two isolated synthetic attachments; it checked the three objective outcomes
and both source filenames. This is protocol/inference evidence, not proof of
the composer attachment and Documents-only toggle interaction. The composer
clears attachments and turns the per-message mode off after send, so the
result-state capture shows the source documents on the sent turn while the
composer is ready for the next turn. The direct UI attach → Documents-only →
send flow remains open for acceptance.

### Conversation search and import — reference #7

The packaged 1440×900 search result is captured in
[Chat search evidence](evidence-chat-search-1440.png). Searching `garden`
filters local conversation history to matching titles, selecting a result
opens that conversation while preserving the query, and the existing import
preview flow remains in Chat options. The packaged search and import checks
passed. Revision 4 depicts search as a full-page destination; Skai keeps search
in the conversation sidebar and opens the chosen result in the active thread.
That follows the compact conversation-sidebar pattern used by desktop AI chat
workspaces while keeping the current conversation in context.

### Project task plan — reference #8

The packaged 1440×900 project-scoped planner is captured in
[Coding task-plan evidence](evidence-coding-task-plan-1440.png). The focused
Coding Agent flow opened the local project thread's planner, filled a task title
and brief, saved the plan to the conversation, and received confirmation that
the plan is saved for review; saving did not start execution. The first capture
showed the composer clipped below the planner. The embedded planner now uses a
compact two-row form and shorter brief field so the composer stays visible; the
rebuilt packaged matrix passes without unreachable-control findings.

The project name is already selected in the workspace header, so the plan form
does not repeat a project dropdown. Skai also defaults to requiring approval
before a local run starts, while the reference shows that optional switch off.
These choices keep project context visible and execution approval explicit.
The focused packaged flow also passed at 390×844: the planner expands into the
vertical workspace scroll, saves for review, then closes back to the compact
Coding thread. The Coding header/actions now wrap within the mobile viewport;
the matrix reported no clipped controls or horizontal overflow. Desktop
`npm run desktop:typecheck`, `npm run build`, and `npm run package:electron`
passed after the layout changes.

After the Image changes, the packaged layout matrix captured all 20 routes at
1440×900 in the dark expanded-sidebar state with no renderer or layout findings.
Focused interaction smokes passed for queueing, search/import, task handoff and
journal/schedules, project file/terminal flows, Memory, MCP, Marketplace, and
Voice Workbench. These results do not close the reference-by-reference review:
the document-grounded composer interaction, Voice Mode, GitHub,
model download review, and remaining route-specific states still need paired
screenshots and interaction evidence. See the active acceptance queue for the
specific model-cache and persona quality limitations.

This is route and representative-flow evidence, not proof that every numbered
image has been matched. Several references describe distinct states within one
route. Reference #4 now has paired screenshots and interaction evidence.
Reference #5 has a result screenshot and local-inference evidence, while its
composer interaction still needs direct packaged UI coverage. References #7
and #8 now have packaged screenshots and their search/import and local-plan
flows exercised. The
remaining
acceptance work is to capture and compare the other states individually,
especially Voice
Mode, task planning/progress, schedules, project creation, GitHub, model
inspection/download review, Marketplace install and voice details, MCP
approval, image generation/edit history, multimodal attachments, Voice
Workbench, Memory/document corpus, and Settings/Usage. Do not mark the
Revision 4 continuity pass complete until those supported journeys have
specific screenshot and interaction evidence. Local model-backed inference
must be verified against an available local runtime; a rendered page is not
inference evidence. See [UI evidence](../../../planning/SKAI_PREMIUM_UI_PROGRESS.md)
and [the active queue](../../../planning/TO_DO_NEXT.md).

## Image index

| # | File | Focus |
|---:|---|---|
| 1 | [01-shared-workspace-shell.png](01-shared-workspace-shell.png) | Persistent shell and active conversation |
| 2 | [02-new-chat-and-workspace-start.png](02-new-chat-and-workspace-start.png) | Start a chat or open a project |
| 3 | [03-everyday-chat-thread.png](03-everyday-chat-thread.png) | Everyday Chat thread and composer |
| 4 | [04-queue-and-message-actions.png](04-queue-and-message-actions.png) | Queue a follow-up and use message actions |
| 5 | [05-document-grounded-chat.png](05-document-grounded-chat.png) | Ask a question grounded in attached documents |
| 6 | [06-local-voice-mode.png](06-local-voice-mode.png) | Start local Voice Mode |
| 7 | [07-chat-search-and-import.png](07-chat-search-and-import.png) | Search conversations |
| 8 | [08-plan-a-local-task.png](08-plan-a-local-task.png) | Save a Coding Agent task plan |
| 9 | [09-coding-task-progress-review.png](09-coding-task-progress-review.png) | Follow task progress and review changed files |
| 10 | [10-schedule-from-conversation.png](10-schedule-from-conversation.png) | Schedule a run from its conversation |
| 11 | [11-standalone-scheduled-tasks.png](11-standalone-scheduled-tasks.png) | Find and manage standalone schedules |
| 12 | [12-projects-create-open.png](12-projects-create-open.png) | Create or open a project |
| 13 | [13-coding-project-session.png](13-coding-project-session.png) | Coding Agent chat with Monaco docked beside it |
| 14 | [14-project-files-editor.png](14-project-files-editor.png) | Review a Monaco edit while keeping chat visible |
| 15 | [15-git-review-and-commit.png](15-git-review-and-commit.png) | Review a diff and commit selected changes |
| 16 | [16-project-terminal-and-preflight.png](16-project-terminal-and-preflight.png) | Run a project command and inspect readiness |
| 17 | [17-github-repository-workflow.png](17-github-repository-workflow.png) | Select a GitHub repository and open it as a project |
| 18 | [18-model-library-inspector.png](18-model-library-inspector.png) | Search local models and use one in chat |
| 19 | [19-local-model-download-review.png](19-local-model-download-review.png) | Review local model metadata before download |
| 20 | [20-persona-workshop.png](20-persona-workshop.png) | Manage a persona and start a conversation |
| 21 | [21-marketplace-discovery.png](21-marketplace-discovery.png) | Search and inspect a Marketplace listing |
| 22 | [22-marketplace-voices-installed.png](22-marketplace-voices-installed.png) | Inspect an installed local voice workflow |
| 23 | [23-mcp-connect-and-review.png](23-mcp-connect-and-review.png) | Review one MCP tool call before running it |
| 24 | [24-local-image-generation.png](24-local-image-generation.png) | Create an image with a local workflow |
| 25 | [25-image-edit-and-history.png](25-image-edit-and-history.png) | Edit an image locally and revisit local history |
| 26 | [26-omnimodal-file-input.png](26-omnimodal-file-input.png) | Add files or choose local audio and voice input |
| 27 | [27-voice-workbench-clip-library.png](27-voice-workbench-clip-library.png) | Find and preview saved voice clips |
| 28 | [28-memory-and-document-corpus.png](28-memory-and-document-corpus.png) | Manage saved memory or open the document corpus |
| 29 | [29-settings-and-usage.png](29-settings-and-usage.png) | Adjust appearance and inspect local usage |
| 30 | [30-pet-workshop.png](30-pet-workshop.png) | Choose or hide an optional desktop companion |
| Future | [31-video-page-future-concept.png](31-video-page-future-concept.png) | Planned Video page for future generation and editing |

## Repository documents used

- [DESIGN.md](../../../../DESIGN.md)
- [UI_REFERENCE_GUIDE.md](../../../planning/UI_REFERENCE_GUIDE.md)
- [CAPABILITY_MATRIX.md](../../../planning/CAPABILITY_MATRIX.md)
- [FUTURE_FEATURES.md](../../../planning/FUTURE_FEATURES.md)
- [TO_DO_NEXT.md](../../../planning/TO_DO_NEXT.md)
- [User-provided UI references](../../../ui-references/)

The documentation corpus was inventoried and the current product, UI, capability, and future-feature guidance was reviewed for this pass. No app source files were changed during image generation.
