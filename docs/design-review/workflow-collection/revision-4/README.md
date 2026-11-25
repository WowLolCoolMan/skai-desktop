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

### Shared workspace shell and start — references #1–3

The packaged 1440×900 captures pair the persistent shell with a selected
conversation in [shared-shell evidence](evidence-shared-workspace-shell-1440.png)
and [everyday Chat evidence](evidence-everyday-chat-thread-1440.png). The
[new-chat start capture](evidence-new-chat-and-workspace-start-1440.png) keeps
the familiar composer in place and adds compact **Open a project** and
**Choose a model** shortcuts below the welcome copy. The packaged smoke opens a
saved recent conversation, starts a fresh chat, verifies both shortcuts are
visible, opens Projects, returns to the empty chat, and opens Model Library.
Both navigation paths passed. New conversations and Model Library are covered
by their dedicated workflow sections below; the basic empty Chat state stays
simple, with the extra entry points limited to the start screen.

## Implementation review status — 2026-11-24

The current packaged app has been checked at 1440×900 across 20 routes in dark
and light themes with the workspace sidebar expanded and collapsed. The full
matrix passed at five window sizes and four theme/sidebar variants, with no
renderer errors or layout failures. The dedicated overflow check passed 11
routes at five widths, and accessibility smoke passed 16 routes with zero WCAG
violations. At 390×844, Chat and the Coding Agent thread/editor workflow pass
without horizontal overflow or unreachable controls. Coding's optional split
stacks into a scrollable mobile workspace; the editor, file tree, Save, and Undo
remain reachable. Desktop and mobile panel switching, file editing, Git review,
and split close/reopen are exercised. Coding file-tab restore and interaction
state are separated from the pane renderer and pass the packaged editor and
browser acceptance smokes. A model-backed Side chat task and the
#16–30 visual continuity review remain open. Persona Workshop and Pet Workshop
remain separate routes. The Video page remains a planned concept.

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
previews and zero horizontal overflow. The packaged local runtime then passed
real generation and edit acceptance: cancel a run, generate a 512×512 image,
select it from history, reopen it in Edit, generate an edited result, and
confirm both images persist after reloading the app. During this test, a late
history update could replace the image the user had selected for Edit and hide
the source preview. History selection now remains stable across background
updates until a new generation starts. The packaged smoke passed with that fix.

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
The everyday Chat shell at [390×844](evidence-chat-shell-390.png) and the
Coding Agent's [single-pane mobile thread](evidence-coding-panel-chat-390.png)
are captured after correcting the mobile sidebar/content overlap.

The reference labels assistant actions Copy / Retry / Edit. Skai keeps Edit on
the user's own prompt and offers Fork from here on assistant replies; this
preserves the familiar role-specific pattern while exposing the same prompt
revision path. This is a deliberate small label/action difference, not a
missing queue or message workflow.

### Document-grounded Chat — reference #5

The packaged result state is captured in
[document-grounded Chat evidence](evidence-chat-documents-1440.png). The seeded
thread keeps both attachment names with the user question and shows the answer
citing `Plan.pdf` and `Results.xlsx`. The direct composer preparation is
captured in [composer evidence](evidence-chat-documents-composer-1440.png):
the smoke drops a local text file, enters a grounded question, enables
Documents-only, verifies its checked state and Docs only chip, and confirms
Send is enabled. The thumbnail uses a file-type mark instead of squeezing
document text into a 42px preview. Separately,
`npm run smoke:documents-only` passed real local inference with Qwen3 14B using
two isolated synthetic attachments; it checked the three objective outcomes
and both source filenames. Sending clears the attachments and per-message mode
for the next turn. The packaged UI and local-inference checks cover the
composer interaction and grounded result separately.

### Local Voice Mode — reference #6

The packaged 1440×900 active listening state is captured in
[Voice Mode evidence](evidence-voice-mode-1440.png). The UI smoke starts Voice
Mode from the Chat composer with a fake local microphone, waits for the
“Listening on this device” state, verifies the visible End control, and closes
the session. The broader Windows voice acceptance separately covers a real
microphone turn, local Whisper transcription, interruption, and cancellation.

Revision 4 depicts Voice Mode as a separate destination with a large start
button. Skai keeps it attached to the current Chat thread and opens a focused
session dialog from the composer. This matches the in-thread voice entry used
by mainstream AI chat apps and keeps the conversation context available. The
standalone page layout is a documented workflow variation; the local
hands-free start/listen/end flow is covered. This capture also reflects a
voice-expressiveness control from separate, uncommitted working-copy changes;
those runtime and settings changes are not part of the pushed UI batch and
still need their own review and tests.

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

### Coding task progress and review — reference #9

The packaged 1440×900 active task state is captured in
[Coding task-progress evidence](evidence-coding-task-progress-1440.png). An
isolated local-model fixture writes four files in a temporary Git project and
pauses before verification. The Coding Activity panel shows the four changed
paths while the task is still running, the queued → running → verifying →
completed progress line, and a Stop action with immediate “Stopping…” feedback.
The packaged interaction smoke checks the live file list, Git status, button
feedback, and task cancellation. Changed paths persist as each write completes
instead of appearing only after the task ends. The held-model fixture now
reaches Cancelled and closes its pending request; both the Agent Host smoke and
task-progress UI smoke pass. The focused 390×844 task-progress flow also
passes: changed files remain visible in the Activity drawer, Stop cancels the
fixture, and the mobile overflow probe reports no clipping or horizontal
scroll.
This page keeps task review in the
project's Activity drawer beside the Coding Agent thread rather than navigating
to a separate task page.

The per-reference visual pass remains open for references #16–30. References
#13–15 now have packaged desktop captures and focused Coding workspace flows;
the remaining reference-specific states still need comparison and interaction
evidence.

### Schedule from a conversation — reference #10

The packaged 1440×900 state is captured in
[conversation schedule evidence](evidence-chat-schedule-1440.png). Details opens
a right-side rail for the active conversation, where the user can set a prompt,
a local run time, and a repeat interval, see existing runs, and save another
schedule. The focused packaged flow selected a saved conversation, opened
Details, edited a weekly schedule, saved it, and confirmed it appeared in that
conversation's schedule list. The schedule stays attached to the conversation
while its thread and composer remain visible. Revision 4 places the form in the
main conversation surface; Skai keeps it in the Details rail to preserve thread
space. The rail was previously hidden by a stale Chat style rule; it now opens
on desktop and stacks below the conversation on narrow screens. The focused
390×844 flow opens the mobile navigation drawer, selects the saved conversation,
opens Details, creates a weekly schedule, and confirms it appears in that
thread. Selecting the conversation dismisses the drawer, and the matrix reports
no clipping or horizontal overflow.

### Standalone scheduled tasks — reference #11

The packaged 1440×900 state is captured in
[Standalone Scheduled evidence](evidence-scheduled-standalone-1440.png). Skai
shows a searchable local schedule list beside details for the selected run,
including its next time, repeat interval, workspace mode, saved result, and
Run now / Pause / Cancel controls. The page explains that these prompts run
locally and do not automatically access project files. The focused packaged
flow created a standalone weekly prompt, selected it, then paused, resumed, and
cancelled it; all three state changes appeared in the details view. This keeps
standalone automations separate from conversation schedules as in the
reference. The 1440×900 matrix found no layout or runtime issues.

### Projects create and open — reference #12

Packaged 1440×900 captures show the [Create project dialog](evidence-project-create-1440.png) and the [opened project workspace](evidence-project-open-1440.png). The Projects page now puts **Open folder** beside **New project**, searches recent projects by name or path, and lists each project with its folder path. Creating a project asks for a name and one local folder; project settings retain the existing instructions and multi-folder editing controls. The packaged flow checks both entry points, the compact name/folder dialog, and opening a listed project into Coding. On Windows, the real native folder picker was exercised with a temporary fixture, and the project was created and opened. The already-running app showed stale dialog copy; the packaged screenshots and smoke are from the freshly built source.

Reference #12 is still a visual approximation: the persistent workspace sidebar and tabs remain visible around Projects, while the reference shows a standalone full-page surface. This preserves Skai's common project navigation and workspace tabs, but remains a visible shell difference to check during continuity review. At 390×844, the focused smoke opens and closes the compact Create project dialog, then opens the listed project into Coding. The native Open folder picker was exercised on desktop; its mobile picker flow remains untested.

### Coding project session — reference #13

The packaged [Coding project session capture](evidence-coding-project-session-1440.png)
shows a project thread and Monaco editor side by side, with the project file
tree, open file tab, and inline workspace controls. The focused packaged flow
restored a seeded project conversation, opened README.md in the editor beside
its Coding Agent thread, and confirmed the editor was available at 1440×900.
This matches the reference's core chat-plus-editor workflow. The persistent
Skai navigation rail and workspace tabs remain visible around the project.
Mobile layout and further keyboard/accessibility review remain open.

### Side-by-side file diff — reference #14

The packaged [side-by-side diff capture](evidence-coding-side-by-side-diff-1440.png)
keeps the Coding Agent thread beside a wider Monaco review surface, with the
original file on the left and the working copy on the right. The smoke edited
the seeded README, opened the comparison, returned to Monaco, saved the change,
and used Undo to restore a clean editor state. The local comparison is
read-only; Git diff remains the source for repository change review. At
1440×900, the editor receives more room than the thread. The edit → compare →
editor → save → undo workflow also passes at 390×844 with no page overflow.

### Git review and selected commit — reference #15

The packaged [Git review capture](evidence-coding-git-review-1440.png) shows
the selected project's changed files and unified diff in a focused review
surface. The focused disposable-project flow seeded three changes, selected
README.md and src/index.ts, confirmed the diff excluded the unselected new
file, entered a commit message, and committed only those two paths. The
remaining unselected file stayed in the working tree; committed paths returned
to a clean status while unrelated staged work remained preserved. The review
panel uses the existing Files workspace in Coding, keeping repository actions
with the project. At 1440×900 the file list and commit controls stay in a left
rail beside a large diff pane. Mobile Git review remains open.

### Project terminal and preflight — reference #16

The focused Agent Host smokes passed bounded command execution and read-only
project preflight. The packaged Coding workflow detected `package.json` and
Node.js, listed the build command as **Suggested checks (not run)**, and verified
that preflight did not execute the fixture script. The project terminal then ran
an explicitly entered command in the selected project and returned exit code 0,
captured output, and the Windows process-isolation summary. The task-journal
smoke also passed selected-check result persistence and failure evidence.

Packaged captures: [read-only preflight](evidence-project-preflight-1440.png),
[command result in the Coding inspector](evidence-project-terminal-1440.png),
and [the dedicated Terminal workspace](evidence-project-terminal-workspace-1440.png).
The #16 flow now selects a project, keeps the main command runner beside Setup
and Files & Diffs, refreshes the project file list, runs read-only preflight,
and executes one explicit command with exit code 0. The packaged geometry check
confirmed both columns align with no overlap at 1440×900. The seeded build
script was not run during preflight. This closes the #16 composition mismatch;
the command and isolation evidence remain local to a disposable project.

### GitHub repositories — reference #17

The reference calls for a live account repository list, selection, and opening
the chosen repository as a project. The current desktop-to-Agent Host protocol
does not expose GitHub device authorization, repository listing, or cloning.
The core project has device-flow, credential-store, API-client, and workspace
service code with unit coverage, but these services are not wired to the
desktop workflow. The visible GitHub controls cover local project changes and
pull-request creation through the existing CLI session; they do not provide
the referenced repo picker. Therefore no packaged UI journey exists yet for
consent denial, repo selection, clone conflict, cancellation, or retry. This
is a feature/bridge gap in addition to needing an isolated repository fixture;
see the next step in [the active queue](../../../planning/TO_DO_NEXT.md).

### Local model library and download review — references #18–19

The packaged model page reports the real local inventory. The installed
`qwen3:14b` model was selected in the inspector, its Ollama runtime and local
availability were confirmed, and **Use in chat** opened Chat with that model
selected. The refreshed [selected-model capture](evidence-model-installed-1440.png)
shows the settled Registry ready state. `npm run smoke:documents-only` also
passed real local inference with Qwen3 14B, citing both attached files and
matching all three recorded outcomes. The #19 free-form pull path was tested
without starting a download: enter `qwen3:8b`, review the local-runtime
destination and verification limits, then cancel. See [download review
evidence](evidence-model-download-review-1440.png).

### Persona Workshop — reference #20

The packaged smoke loaded the seeded persona library, selected Release Engineer,
confirmed its profile details, and started a persona-specific conversation.
The selected profile is captured in [Persona Workshop evidence](evidence-persona-workshop-1440.png).
Persona Workshop stays a separate page from Pet Workshop; their data and
controls are not merged.

### Marketplace discovery — reference #21

The packaged Discover flow searched the local catalog for Qwen3.6-27B,
selected the listing, and verified that availability, license, publisher,
capabilities, and the local model adapter guidance appear in the inspector.
The [selected listing capture](evidence-marketplace-discover-1440.png) shows
the filtered result and its details. The independent Marketplace host smoke
returned 63 model results across six providers without downloading model files.

### Installed voices — reference #22

The packaged Installed & updates view opens, but its isolated profile's local
inventory request was still refreshing when the focused UI smoke captured the
state. The inventory pane now shows an explicit checking state instead of a
contradictory empty result; see [Installed voice inventory](evidence-marketplace-installed-voices-1440.png).
The host's separate voice acceptance test confirms native Windows speech plus
installed Piper and Kokoro synthesis. The packaged profile has not returned
those voice profiles for inspection, so #22's selected installed-voice UI
state remains blocked on the local inventory bridge settling and surfacing
those runtimes.

### MCP tool review — reference #23

The packaged review flow connected an isolated loopback Streamable HTTP server,
inspected its read-only `read_garden_plan` tool, reviewed editable JSON
arguments, explicitly approved the read, and confirmed the result. The host
protocol smoke separately rejects a write call without a write grant and
verifies revocation and clean reconnection. The first UI pass exposed a narrow
inspector caused by a flex row; the server summary and inspector now stack, and
the pending call review appears before the tool inventory. The focused
[MCP review capture](evidence-mcp-tool-review-1440.png) and packaged run pass
without renderer errors. The current connected-state surface is taller than
the reference and uses an inline review card rather than a standalone pending
approval queue; the essential review-before-execute boundary matches.

### Local image workflows — references #24–25

The packaged Generate and Edit layouts have [desktop Generate](evidence-image-generate-1440.png),
[mobile Generate](evidence-image-generate-390.png), and
[Edit/history](evidence-image-edit-1440.png) evidence. Focused runs cover
cancellation, local generation, history selection, reopening a result in Edit,
and a second edit. A real local runtime is required for inference acceptance.

### Omnimodal composer — reference #26

At 1440×900, the packaged Chat smoke opens the add menu and verifies the
Files and folders, Audio file, Documents only, Voice input, and Voice Mode
paths; the [menu capture](evidence-chat-omnimodal-menu-1440.png) shows these
choices in context. The packaged fake-microphone Voice Mode smoke reaches
“Listening on this device,” checks the visible End control, and closes the
session; see [Voice Mode evidence](evidence-voice-mode-1440.png). The PDF
attachment validation smoke rejects malformed content and protected names.
These checks establish menu and local voice workflow availability; they do not
exercise a physical microphone turn or every file-picker attachment type.

### Voice Workbench clips — reference #27

The refreshed [Voice Workbench capture](evidence-voice-workbench-clips-1440.png)
shows the selected profile, clip search, Add audio clips control, and all eight
fixture rows together. `npm run smoke:voice:workbench` verified profile
selection, name filtering, two same-named files from different folders,
decodable local previews, IndexedDB reload, and removing one same-named clip
without removing its sibling. The smoke uses synthetic audio; it does not rate
speech quality or claim that a voice-cloning adapter is available.

### Memory and document corpus — reference #28

The saved-note list now sits to the left of the selected note editor, as in the
reference. The [selected note capture](evidence-memory-note-1440.png) shows
three explicit notes and the selected note ready to edit. The
[document-corpus capture](evidence-memory-corpus-1440.png) shows the separate
corpus view. The packaged UI flow saves three notes, selects and restores one
in the editor, adds and searches a local document, then removes it. That flow
exposed that the visible corpus controls had no connected action handlers;
Save, Search, and Remove now call the existing local corpus protocol.
`npm run smoke:memory`
also covers note search, disable, export, and removal. Memory and document
corpus remain separate from each other and from project context.

### Usage and settings — reference #29

The packaged Usage page shows local activity, runtime capacity, saved model
mix, and inventory in [Usage evidence](evidence-usage-1440.png). The packaged
layout matrix visited all 13 Settings categories at 1440×900; the Appearance
category is shown in [Settings evidence](evidence-settings-appearance-1440.png).
The focused Usage → Settings flow now verifies that Settings opens as a modal
over Usage, then returns to Usage when closed. The screenshot is in
[Settings-over-Usage evidence](evidence-settings-over-usage-1440.png). This
matches the reference's composition and close/return behavior while keeping
the app's fuller Settings categories. The Settings route also passes all 13
categories at five viewport sizes and four theme/sidebar variants.

### Pets Workshop — reference #30

The isolated packaged flow selects a companion, toggles visibility off and
back on, opens appearance customization, and returns to work. The selected
profile and separate workshop are shown in [Pets evidence](evidence-pet-workshop-1440.png).
Persona Workshop remains a different page with its own records and controls.

### Planned Video page — reference #31

The packaged page is explicitly marked **Planned** and says its preview is not
available; Generate a clip, Edit a timeline, and Export are also marked planned.
The [Video capture](evidence-video-planned-1440.png) verifies the future-state
page without presenting video generation or editing as working functionality.

### Coding workspace panel continuity — user-provided Codex examples

The Coding Agent thread stays mounted on the left while the right workspace
uses its own page group beside the main chat/project tabs. **Editor** docks
Monaco and a collapsible project-file tree; **Side chat** provides a
project-scoped subagent task composer and task status/results; **Changes** shows
local Git review state. Side chat starts a Coding task through the existing
local task queue/executor, and file links in its result return to Monaco.

The current Revision 4 examples also show **Files** as a separate right-side
page. Skai now exposes Files as a peer page beside Editor, Side chat, and
Changes; selecting a file there opens it in Monaco and keeps the main thread
mounted.

The packaged panel smoke at 1440×900 verified all four right-side pages,
confirmed the main thread remained visible after each switch, typed and enabled
a Side chat task draft, opened `README.md` in Monaco, and checked the Changes
surface. Current captures are:

- [Side chat beside the main thread](evidence-coding-panel-side-chat-1440.png)
- [Editor/Monaco with the project-file tree beside the main thread](evidence-coding-panel-monaco-1440.png)
- [Files as a separate right-side page](evidence-coding-panel-files-1440.png)
- [Changes beside the main thread](evidence-coding-panel-changes-1440.png)

The packaged mobile panel pass also has [single-pane Chat](evidence-coding-panel-chat-390.png),
[Side chat](evidence-coding-panel-side-chat-390.png),
[Monaco with Files](evidence-coding-panel-monaco-390.png), and
[Changes](evidence-coding-panel-changes-390.png) captures. The main thread and
right-side panel stack vertically at 390×844; there is no horizontal overflow.

The full packaged matrix passed 20 routes at five window sizes across dark and
light themes with expanded and collapsed sidebars, with no runtime errors or
layout findings. After the matrix exposed a clipped Recent Projects section
label, the sidebar control sizing was corrected and the dedicated overflow
acceptance passed 11 routes at five viewport widths. The packaged accessibility
smoke covered 16 routes with zero WCAG violations; four contrast checks for
symbol-only decorative content remain incomplete because axe cannot determine
their text contrast. Desktop and 390×844 panel switching preserve the main
thread. An isolated Local API fixture now verifies the Side chat composer,
project task execution, README inspection, completed summary, and result card
beside the main thread; this workflow exposed and fixed omission handling for
unknown model size/context metadata. Changes without a Git repository show an
inline status message and can be refreshed through Project actions.

After the Image changes, the packaged layout matrix captured all 20 routes at
1440×900 in the dark expanded-sidebar state with no renderer or layout findings.
Focused interaction smokes passed for queueing, search/import, task handoff and
journal/schedules, project file/terminal flows, Memory, MCP, Marketplace, and
Voice Workbench. Additional Revision 4 work now has packaged evidence for
references #23 and #26–31, including MCP approval, omnmodal attachment choices,
Voice Mode, Memory, Usage, Pets, and the planned Video destination. The current
open gaps are #17 GitHub repository browsing/cloning (desktop bridge not wired)
and #22 voice inventory in the isolated package profile. Reference #18's installed-model
selection and real local inference now pass. These results
advance the review but do not close it.

This is route and representative-flow evidence, not proof that every numbered
image has been matched. Several references describe distinct states within one
route. References #4–8, #16, #19–21, #23, and #26–31 now have targeted workflow
evidence; see the individual notes above and the progress log. Do not mark the
Revision 4 continuity pass complete until remaining supported journeys have
paired screenshots and interaction evidence, and the listed environmental
blockers are resolved. Local model-backed inference must be verified against
an available local runtime; a rendered page is not inference evidence. See
[UI evidence](../../../planning/SKAI_PREMIUM_UI_PROGRESS.md) and [the active
queue](../../../planning/TO_DO_NEXT.md).

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
