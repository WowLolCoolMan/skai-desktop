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

## Implementation review status — 2026-11-23

The current packaged app has been checked at 1440×900 across 20 routes in dark
and light themes with the workspace sidebar expanded and collapsed. The matrix
reported no renderer errors or layout failures. A 390×844 pass covered Chat
and Coding with no page-level horizontal overflow or clipped controls. Chat
search/task-tools/import-menu checks and the Coding Agent edit → compare → save
→ undo flow passed; the latter also passed at 390×844 after the workspace was
made to scroll internally. Persona Workshop and Pet Workshop remain separate
routes and their selection/customization flows have separate smoke coverage.
The Video page remains a planned concept.

This is route and representative-flow evidence, not proof that every numbered
image has been matched. Several references describe distinct states within one
route. The remaining acceptance work is to capture and compare those states
individually, especially queued/message actions, document grounding, Voice
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
