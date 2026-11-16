# Skai Desktop Workflow Overhaul Plan

**Status:** In progress  
**Product:** Skai Desktop  
**Reference:** ChatGPT/Codex desktop interaction flow; reproduce the useful workflow patterns while keeping Skai's own identity, local-first behavior, and capabilities.

## Product decisions captured from the planning Q&A

### Navigation and application shell

- The global rail contains Home, Images, Usage, Marketplace, Extras (three-dot flyout), and Settings.
- Projects belong in the sidebar only while Coding Agent mode is selected. Chatting Agent and Coding Agent are explicit modes with separate recent-thread lists; switching modes preserves the active thread and tab.
- Quick Actions and the standalone Agent Workbench are removed. A project conversation is the complete task flow: prompt, progress, result, changed-file summary, and review actions stay with the thread that started the work.
- Extras is a rail-attached flyout. It auto-lists secondary pages, groups entries by recent use, opens at the top, shows an attention dot when setup is needed, explains unavailable features in-app, and offers search as the list grows. Memory and Voice Workbench are always listed (voice can show unavailable status); Pet Workshop is listed only when enabled. Selecting an entry opens its page and closes the flyout.
- Settings is a searchable category-based overlay. It preserves the exact selected tab, scroll position, and panel state underneath, then returns there on close.
- Workspace tabs are visible only for chat/project work. Images, Usage, Marketplace, and Settings hide the tab strip without closing its sessions.

### Chats and project sessions

- Support multiple persisted chat/project tabs, restore them after restart, and keep drafts automatically.
- A new tab has a start screen with New chat, Open project, and Recent choices. Project creation is a dialog with name, instructions, and one or more connected folders. Project instructions are editable from the workspace header/menu.
- Opening a project restores its last-used project session. A project can have multiple independent coding conversations; these share project files and Git state but retain separate conversation histories.
- A Coding Agent thread without a project offers Choose project or Continue without project. Project context is visible and removable from the composer.
- Search spans both agent-mode thread lists. Switching tabs uses keyboard shortcuts for New chat, New tab, tab cycling, Find file, and Toggle terminal. Narrow windows turn project panes into toggleable drawers.
- Closing a tab saves its draft and editor state automatically.

### Project coding workspace and task lifecycle

- Use a three-pane project workspace: project file tree on the left, Chat and Editor/Diff tabs in the center, and contextual changes/activity on the right. The terminal is a collapsible bottom dock.
- File browsing, editing, task status, Git state, terminal, and diff review remain in the project tab. “Review changes” opens the relevant file/diff beside the conversation.
- Sending from Coding Agent starts work directly by default. Follow-ups can queue in the same thread and run sequentially. One thread's run state remains attached to that thread.
- Run cards distinguish queued, running, and needs-review states; expose Pause/Resume and Stop, preserve partial changes, and report errors/logs with Retry or Continue. If a runtime cannot suspend generation, Pause means stop, preserve partial output, and offer Continue.
- Completed work has a grouped changed-file summary and a clear Review changes action. Changes are written into the project and reviewed/undone from diffs.
- Scheduled runs remain available, but are created and managed from a conversation; scheduled results post back to that same thread.

### Marketplace

- Marketplace has exactly three primary destinations: Discover, Models, and Tools. Selecting catalog items keeps the user inside Marketplace; inline inspectors show details and next steps.
- Discover leads with new and recently updated items. Catalog entries show New/Updated labels and dates. Installed/connected items remain in their catalog group and show status.
- Models combines detected local models with installable models for supported runtimes. Filters compose across task, parameter size, libraries, apps, providers, and hardware. Hardware is detected and can be edited manually. Search and selection state are remembered per Marketplace section.
- Model details show inline. Installation requires a review of runtime, size, and source. Only catalogs with a supported local install route appear as installable.
- Tools are hand-picked and grouped with separators: MCP servers, Skai built-ins, and compatible plugins. The inspector states Skai compatibility, permissions, connection state, and setup. Connecting an MCP server requires a final review of discovered tools. Unavailable plugins explain the missing requirement and disable their action.

### Capacity-aware local model scheduling

- Keep capacity measurements entirely on-device. Refresh every few seconds and when model/context settings change.
- Consider live system RAM and VRAM when available, CPU/GPU load, runtime-reported loaded models, selected model weight size, and each chat's context allocation. Count shared model weights once and add per-chat context/session cost.
- Use conservative estimates and show uncertainty when a metric is unavailable. Mark unsupported VRAM as unknown while using the other measured signals. Explain the limiting resource in plain language with expandable details.
- Show running model count and capacity beside the model selector. Allow optional independent RAM and VRAM budgets.
- Recalculate continuously. If resources drop after work starts, warn and let the runtime continue unless it errors. Ask before unloading an idle model. Never silently replace the selected model.
- When capacity is insufficient, offer Queue, a smaller available model, a compatible AirLLM route, or explicit Run anyway. AirLLM is a per-run choice; explain its speed tradeoff. If compatible but not installed, offer setup and keep the run queued. Never silently switch providers.

### Product identity and stored data

- The current source tree, documentation, build metadata, packaging, and UI use “Skai Desktop” exclusively. Remove the retired Skai names from current-tree files; Git history is not rewritten.
- Preserve existing settings, projects, conversations, and credentials with a one-time migration from the legacy storage locations/identifiers. Verify the destination before removing legacy data. Do not display or log credential contents.
- Do not classify or block user prompts based on whether they are ordinary, defensive, risky, pentesting, exploit-oriented, or malicious. User content should flow to the selected model. Capacity limits, provider compatibility, user-selected permissions, and honest technical failures remain operational behavior, not content-based prompt refusal.

## Implementation sequence and acceptance criteria

### 1. Shell, route cleanup, and session tabs — underway

- Replace Quick Actions with contextual destinations and the Extras flyout.
- Remove Agent Workbench from visible navigation and keep old deep links from reopening it.
- Persist workspace tabs, current selection, and chat drafts; switching/closing restores the right thread and project.
- Settings overlays the workspace without losing session state.
- **Accept when:** Home/chat/project flows need no duplicate destination pages; restart restores tabs/drafts; Settings closes back to the same workspace.

### 2. Project conversation as the coding workspace — underway

- Start and resume project-linked coding threads in the same project tab as files, editor/diff, terminal, and Git state.
- Make Coding Agent Send create and execute a task directly, attach progress/results to the conversation, and keep file changes reviewable/undoable.
- Add a sequential per-thread prompt queue, stop/retry/continue, failure details, changed-file summary, and scheduled-run controls in the thread.
- Rework the project layout to the three-pane contract and make panes collapsible on narrow widths.
- **Accept when:** a user can prompt, follow the run, inspect/edit the diff, and send a follow-up without navigating to another task page.

### 3. Marketplace consolidation

- Replace the existing catalog/hub double navigation with three persistent sections and inline inspectors.
- Combine local and supported installable models with composable filters, availability labels, hardware editing, and install review.
- Group MCP, built-ins, and compatible plugins in Tools; keep connection review and availability explanations in-place.
- **Accept when:** no catalog selection opens a duplicate Marketplace page or exits the Marketplace route.

### 4. Local capacity and concurrency scheduler

- Implement platform-aware RAM/VRAM/load probes and runtime model inventory, with unknown-state handling.
- Estimate shared model and per-thread context costs; queue work and reevaluate as capacity changes.
- Add AirLLM compatibility/setup choices, optional resource budgets, advisory override, and tray status for supported background runs.
- **Accept when:** no model/provider is silently swapped, users see the limiting resource and uncertainty, and queued work starts in order when capacity frees.

### 5. Legacy identity migration

- Move current-tree product identity and build/artifact names to Skai Desktop across Windows/Linux packaging and runtime.
- Migrate each supported legacy data store once, preserve credentials and user-created records, and make migration repeat-safe.
- **Accept when:** source/docs/build metadata have no retired product names; existing data loads after upgrade; migration handles partial/corrupt source data without deleting the original.

### 6. Difference register and release readiness

- Keep `docs/CHATGPT_CODEX_VS_SKAI_DIFFERENCES.md` as the repository-grounded comparison. Update it as each phase changes the actual product, and distinguish implemented behavior from planned behavior.
- Verify key flows at wide and narrow sizes and across supported Windows/Linux packaging. Keep review evidence tied to the tested build and avoid claiming every UI combination was covered unless that matrix was exercised.

## Current implementation snapshot

This implementation pass includes persistent workspace tabs and keyboard switching, an Extras rail flyout, a Settings overlay that keeps the current workspace underneath, a project start screen, direct task dispatch from Coding Agent Send, project/conversation linkage, in-thread run cards, bounded file/command execution, inline project details, and persisted Marketplace section/filter state. Local device RAM/CPU and NVIDIA GPU telemetry is available to the UI; it is only a monitoring foundation and is not yet a concurrency scheduler. The Agent Host now copies existing app-data files into the Skai Desktop storage roots without deleting the originals, and credential reads support the prior protected/keyring identifiers. The renderer bridge and Agent Host build identity use Skai Desktop names.

**Still open:** the agreed three-pane project workspace and right-side change inspector; project-scoped follow-up queue, pause/continue, retry, and schedule controls; live loaded-model/context accounting, resource budgets, capacity queue, AirLLM choice flow, and tray status; full Marketplace hardware detection/manual profiles, real catalog update dates, and install review; narrow-window drawer behavior; persistent draft restoration and thorough settings focus/scroll restoration. A whole-tree text search of the current checkout found no legacy product-name strings outside Git history or generated dependency/build directories. Windows/Linux packaging and migration on a real upgraded installation remain unverified. TypeScript typecheck and .NET builds pass; tests and full UI matrix were not run.
