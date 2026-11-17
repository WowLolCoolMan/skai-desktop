# ChatGPT/Codex Desktop vs. Skai Desktop: Difference Register

**Snapshot date:** 2026-11-16
**Audience:** Product, design, and engineering  
**Purpose:** Record the material product, interaction, capability, privacy, and platform differences that affect how a person moves through either desktop app.

## Scope and reading guide

This register compares Skai's current Electron application with the current ChatGPT desktop application and its Codex experience, using the supplied screenshots as visual references. OpenAI's current desktop product combines ChatGPT's **Chat** and **Work** experiences with a separate **Codex** view. Codex keeps its own workflow and history. The supplied Codex screenshots show a particular coding-workspace layout; they are visual evidence for that flow, not a complete inventory of every current rollout or account configuration. OpenAI features vary by plan, region, workspace permissions, platform, and staged rollout. See [ChatGPT Work and Codex](https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex) and [Moving to the new ChatGPT desktop app](https://help.openai.com/en/articles/20001276-moving-to-the-new-chatgpt-desktop-app).

“Current Skai behavior” is grounded in this repository's source and capability matrix. “Screenshot observation” is limited to what is visible in the user-provided images. “Not implemented” means not found in the current Skai product path or explicitly listed as a gap; it is not a claim about every possible extension or external tool.

## Executive summary

**Implementation note (2026-11-16):** The current working tree adds persisted workspace tabs, a Chat/Coding mode switch, an Extras flyout, a Settings overlay, project-linked coding conversations with in-thread task cards, project details editing, and persistent Marketplace model filters. The remaining planned gaps are tracked in [WORKFLOW_OVERHAUL_PLAN.md](WORKFLOW_OVERHAUL_PLAN.md). Several lower sections still describe the baseline captured on 2026-11-15; consult the plan's implementation snapshot for the current changed paths until each comparison section is refreshed.

The largest difference is the **work loop**:

- **Codex:** choose a project, start or resume a project conversation, direct the agent, inspect its work and diffs in that same conversation, then steer or request changes without losing project context.
- **Skai:** choose a local project and work in a project-linked conversation alongside its files and Git review; direct task dispatch and compact run cards are now connected. The planned Codex-like three-pane change inspector, persistent per-thread queue, and capacity-aware multi-run controls are still incomplete.

Skai's core distinction is deliberate: **local-first execution and explicit local boundaries**. It supports local models, guarded project files and terminal operations, local memory, and Linux packaging. ChatGPT/Codex is an account-based product with hosted ChatGPT and Codex models, cloud features, project and app integrations, and cross-device workflows where available.

## Flow comparison

| Stage | ChatGPT/Codex desktop | Skai Desktop | User-facing difference |
|---|---|---|---|
| Choose an experience | Switch between ChatGPT and Codex; ChatGPT itself has Chat and Work modes. | Use Skai's Home, Images, Usage, Marketplace, Extras, and Settings destinations; Chatting and Coding Agent modes have separate thread lists. | Skai is a local-first workspace with fewer global destinations; it does not provide ChatGPT account-backed Chat/Work/Codex surfaces. |
| Find prior work | Chat and Work share Recents; Codex history remains separate. ChatGPT search can find chats, projects, and files. | Persisted workspace tabs keep active sessions open; sidebar mode switches between chat and coding threads, with a Projects list in Coding Agent mode. | Skai now restores session tabs, but search and history behavior still differ from ChatGPT's account-wide search. |
| Start project work | Open a project and start Chat or Work with its project context; in Codex, open a project conversation and prompt the agent. | Open a project-linked Coding Agent session; its conversation is embedded beside project files and Git state, and Send dispatches task work. | Skai now connects project context and a coding conversation; multi-folder and local-only behavior differ from ChatGPT's synced projects. |
| Follow progress | The thread remains the center; changes, outputs, subagents, sources, and background activity are available in the task context. | Compact task status and result cards appear in the project conversation; task artifacts remain reviewable there. | Skai has not yet unified live progress, logs, approvals, queued prompts, and capacity status into a complete Codex-like thread flow. |
| Review and iterate | Review changes in context, comment or edit diffs, and continue steering in the thread. | Project files, Monaco editor, Git status/diff, and terminal remain available in the project session beside its conversation. | Skai's planned three-pane layout and contextual right-side change inspector are not complete; several review actions still use existing project panels. |

## Difference register

### 1. Product model and navigation

| ChatGPT/Codex | Skai Desktop |
|---|---|
| The current desktop app has a global ChatGPT/Codex switcher. ChatGPT contains Chat and Work modes; Codex remains a distinct view with separate history. | Skai is one local desktop workspace with routes for Chat, Projects, Coding, Models, Images, Marketplace, Workbench, Terminal, Memory, Usage, and Settings. |
| Chat and Work recents are unified. Codex has its own history. | Skai's conversations and coding projects are separate concepts. Selecting a project opens a Coding Workspace route; chat is not automatically bound to it. |
| The screenshots show a Codex project tab, a separate active conversation, a file pane, and a contextual right panel. | Skai uses a persistent rail and conversation/project sidebar, followed by one route's page. The project index is a separate destination. There are no persistent project/conversation workspace tabs in the shown Skai flow. |
| The screenshot's three-dot app switcher presents product destinations such as Projects and other apps. | Skai's three-dot button opens Quick Actions for its own secondary routes; the command palette is a separate keyboard/search surface. |
| The supplied ChatGPT/Codex window screenshots include File, Edit, View, and Help menus; the shown Help menu groups documentation, shortcuts, troubleshooting, status, feedback, updates, and About. | The supplied Skai window screenshot shows File, Edit, View, and Window; no Help menu is visible in that captured state. |

**Visible screenshot differences:** Skai's supplied Usage screenshot shows the route name twice (in the top toolbar and the page heading), a global “local repository folder no longer exists” error while Usage is open, and recent-chat entries named “Filler conversation number …”. Those are screenshot observations, not assumptions about the current user's data or a claim that every launch shows them. They make Skai look less coherent than Codex's project-and-thread presentation and suggest the error is not scoped to the page that caused it. The Help-menu comparison is also limited to the supplied screenshots; it does not assert that every Skai build lacks every help action.

**Skai evidence:** [App.tsx](../apps/desktop/src/App.tsx), [GlobalRail.tsx](../apps/desktop/src/components/layout/GlobalRail.tsx), [Sidebar.tsx](../apps/desktop/src/components/layout/Sidebar.tsx), [navigation.ts](../apps/desktop/src/app/navigation.ts), [Toolbar.tsx](../apps/desktop/src/components/layout/Toolbar.tsx).

### 2. Projects and project context

| ChatGPT/Codex | Skai Desktop |
|---|---|
| A ChatGPT Project can group chats, files, custom instructions, and supported connected-app sources. Project memory can reuse project chats and files; projects can be shared where available. A project chat or Work thread starts with that context. | A Skai project is a local workspace record with one or more explicitly connected folder paths and project instructions. The project browser exposes bounded local files and project tools. |
| Project sources may include uploaded documents, links from supported apps, and saved ChatGPT responses. Users can move eligible chats into or out of a project. | Project records do not currently group Chat conversations into a shared project history or present a project source library with saved responses and connected cloud-app sources. |
| Projects are available in ChatGPT's desktop UI and can participate in ChatGPT's account and cross-device workflows, subject to feature availability. | Skai project state and file access are local to the desktop installation. Selecting a project is a local UI state; it is not a shared team project. |
| The supplied Projects screenshot shows a clean searchable list with Create and row actions. | Skai now has a searchable Projects directory, and also repeats a short recent-project list in the sidebar. A stale folder only becomes apparent when project files are requested; the app then needs a clear repair path. |

**Sources:** OpenAI [Projects in ChatGPT](https://help.openai.com/en/articles/10169521-projects-in-chatgpt). Skai: [DesktopProject contract](../apps/desktop/shared/contracts.ts), [CodingPage.tsx](../apps/desktop/src/features/coding/CodingPage.tsx), [useCodingWorkspace.ts](../apps/desktop/src/features/coding/useCodingWorkspace.ts).

### 3. Conversations, history, and search

| ChatGPT/Codex | Skai Desktop |
|---|---|
| ChatGPT conversations are account-backed; Chat and Work recents are together. Codex history remains separate. Cloud Work can continue across desktop, web, and mobile where enabled; local Work remains on its host. | Skai conversations are stored locally and use a selected local provider. No cloud conversation sync or account-backed cross-device history is part of the current product boundary. |
| ChatGPT search can span supported chats, projects, images, and documents; archived chats remain searchable. | Skai's visible sidebar search filters recent conversation titles. Chat supports search within the current conversation; project search searches project names and folder paths. These are separate searches, not one global search over all content. |
| Recents can be sorted, filtered, and pinned; a compact sidebar does not imply older history was deleted. | The sidebar currently displays a bounded number of recent chats and projects; the full project list is a separate page. Chat actions include pin/archive/rename/fork, but there is no single unified Chat/Work/Codex history. |

**Sources:** OpenAI [Finding your chats, projects, and files](https://help.openai.com/en/articles/10056348-how-do-i-search-my-chat-history-in-chatgpt), [ChatGPT Work and Codex](https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex). Skai: [Sidebar.tsx](../apps/desktop/src/components/layout/Sidebar.tsx), [ChatPage.tsx](../apps/desktop/src/features/chat/ChatPage.tsx), [README.md](../README.md).

### 4. Coding conversation and agent execution

| ChatGPT/Codex | Skai Desktop |
|---|---|
| Codex is designed around agent threads organized by projects. The user gives the task in the thread, can queue or steer follow-up work, and keeps the task discussion beside the repository context. Codex supports parallel agent work and isolated worktrees in its documented app workflow. | Coding Workspace provides a project file browser, Monaco editor, local Git actions, terminal, task planner, and an activity panel. The task planner saves a proposed local task; it explicitly does not start an agent or run tools. |
| Agent work and its output remain attached to the thread that initiated it. A user can review the result and ask for another change in the same conversation. | Submitting a Coding Workspace task navigates to Agent Workbench. General Chat uses another task brief and may also navigate to Workbench. The project is appended to the coding task instruction, but the chat itself is not a project conversation. |
| Codex's task orchestration includes multiple agents, long-running tasks, isolated work, and interoperability with Codex CLI/IDE history and configuration as documented by OpenAI. | Skai now has a bounded local action loop for project reads, writes, and commands with undo and task journaling. It still lacks Codex's multi-agent interoperability, richer progress inspector, parallel scheduling, and OS-level sandboxing. |

**This is the most consequential product-flow gap.** Skai has the surrounding workspace tools, but users cannot yet make the Codex loop—ask for a project change, watch the agent perform it, inspect the diff, and continue in that same project conversation—as one continuous path.

**Sources:** OpenAI [Introducing the Codex app](https://openai.com/index/introducing-the-codex-app/). Skai: [CodingPage.tsx](../apps/desktop/src/features/coding/CodingPage.tsx), [CodingSessionView.tsx](../apps/desktop/src/features/coding/CodingSessionView.tsx), [CAPABILITY_MATRIX.md](CAPABILITY_MATRIX.md), [FUTURE_FEATURES.md](FUTURE_FEATURES.md).

### 5. Files, editor, terminal, and change review

| ChatGPT/Codex | Skai Desktop |
|---|---|
| The screenshots show a project file tree beside the active conversation and a right-side task context panel with Changes, Outputs, Subagents, and Sources. Change cards appear in the thread with View changes and Undo actions. Codex supports reviewing and commenting on diffs in context; current release notes also describe inline diff editing and pull-request review. | Skai has a bounded local project browser, Monaco editor, open-file tabs, guarded file write-back with undo, local Git status/diff/commit/push/PR actions, and a terminal route or dock. These are real tools, but they are organized around the Coding page and task manager rather than an agent thread. |
| The project task can touch repository files using Codex's environment and approval controls. | Skai explicitly limits project access to selected folders and bounded operations. The complete nested file-tree and some richer mutation paths remain partial. Terminal and task execution have different safeguards and acceptance status. |
| Codex presents task outputs, sources, and agent activity in a task-specific inspector. | Skai's Git review is repository-wide status/diff UI; task artifacts and results appear in Workbench. There is no single right inspector joining a chat, its patch, output files, sources, and agents. |

**Sources:** Skai: [CodingSessionView.tsx](../apps/desktop/src/features/coding/CodingSessionView.tsx), [TerminalPage.tsx](../apps/desktop/src/features/terminal/TerminalPage.tsx), [CAPABILITY_MATRIX.md](CAPABILITY_MATRIX.md). OpenAI [ChatGPT release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes) (desktop/Codex updates).

### 6. Models, sign-in, and usage

| ChatGPT/Codex | Skai Desktop |
|---|---|
| The ChatGPT desktop app uses ChatGPT sign-in. ChatGPT and Codex model access is governed by plan, account, workspace, and usage controls. Codex can use local folders as well as cloud execution environments where available. | Skai does not currently offer ChatGPT account sign-in or hosted OpenAI model execution. Its product boundary is local model execution: Ollama, LM Studio, local OpenAI-compatible endpoints and other local runtimes. “OpenAI-compatible” means a local compatible server; it does not mean the OpenAI cloud API. |
| ChatGPT/Codex can show plan or model usage information, with availability varying by account and feature rollout. | Skai's Usage page explicitly says no telemetry and no verified token, latency, GPU-memory, or cost measurements are currently exposed. It records local task/operation provenance. |
| Cloud Work or Codex Cloud can run work on OpenAI-managed infrastructure; local desktop work can use local files with permission, but messages/context may still be cloud-stored for cloud features. | Skai sends prompts to the local runtime the user selected and does not silently switch to a hosted provider or cloud fallback. GitHub is a separate explicit integration, not an AI model provider. |

**Sources:** OpenAI [ChatGPT Work and Codex](https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex), [Codex app introduction](https://openai.com/index/introducing-the-codex-app/). Skai: [README.md](../README.md), [UsagePage.tsx](../apps/desktop/src/features/usage/UsagePage.tsx), [FUTURE_FEATURES.md](FUTURE_FEATURES.md).

OpenAI has also announced Codex usage profiles for eligible users as a gradual rollout; the document does not treat that as universal account availability. See [ChatGPT Business release notes](https://help.openai.com/en/articles/11391654-chatgpt-business-release-notes).

### 7. Marketplace, plugins, skills, apps, and MCP

| ChatGPT/Codex | Skai Desktop |
|---|---|
| The current Plugin Directory can package reusable skills, connected apps, app templates, and extensions. Apps may connect external services and require account authorization or workspace permissions. Plugins can be invoked in supported ChatGPT or Codex task surfaces. | Skai Marketplace is a local capabilities/catalog surface for model providers, image/voice tools, skills, and integrations. Skai has local skill install review and MCP stdio/HTTP discovery with grants and revocation; the full ChatGPT plugin/app catalog and its account integrations are not automatically available in Skai. |
| Availability, sign-in, and capabilities depend on plan, region, workspace policy, and product surface. Workspace administrators can manage plugin availability and import supported marketplaces. | Skai's marketplace/MCP area is partial: richer lifecycle UI, authenticated retrieval, notifications, and resources remain gaps. A visible catalog entry does not imply a connected account or permission. |

**Sources:** OpenAI [Plugins in ChatGPT and Codex](https://help.openai.com/en/articles/20001256-plugins-in-codex/), [Skills in ChatGPT](https://help.openai.com/en/articles/20001066-skills-in-chatgpt). Skai: [PluginsPage.tsx](../apps/desktop/src/features/catalog/PluginsPage.tsx), [CAPABILITY_MATRIX.md](CAPABILITY_MATRIX.md).

### 8. External integrations and data sources

| ChatGPT/Codex | Skai Desktop |
|---|---|
| Supported connected apps can retrieve from or act on external services under the user's or workspace's authorization. Projects can include supported app links as sources. | Skai integrations are explicit local or project-level connections, including MCP servers and a GitHub repository workflow. They do not make Skai a general ChatGPT app connector, and GitHub credentials are not used for model inference. |
| A connected app may need provider authentication, workspace enablement, and action-specific permissions. | Skai uses local MCP grants, GitHub device sign-in for repository workflows, and local provider endpoints. Authenticated retrieval through MCP remains incomplete according to the capability matrix. |

**Sources:** OpenAI [Projects in ChatGPT](https://help.openai.com/en/articles/10169521-projects-in-chatgpt), [Plugins in ChatGPT and Codex](https://help.openai.com/en/articles/20001256-plugins-in-codex/). Skai: [GITHUB_INTEGRATION.md](GITHUB_INTEGRATION.md), [CAPABILITY_MATRIX.md](CAPABILITY_MATRIX.md).

### 9. Memory and knowledge

| ChatGPT/Codex | Skai Desktop |
|---|---|
| ChatGPT memory and project context can use account/project conversations and files, subject to memory settings and workspace policy. Shared projects let collaborators reuse project knowledge. | Skai Memory is an explicit local editor for saved notes, scopes, tags, provenance, and enable/disable state. Its document corpus is manually imported or entered; Skai does not crawl arbitrary files implicitly. |
| Project sources can be reused by project chats and can include uploaded or supported connected-app content. | Skai documents can be searched locally with bounded snippets; original-source freshness and broader retrieval remain limited. Memory does not substitute for a project chat history. |

**Sources:** OpenAI [Projects in ChatGPT](https://help.openai.com/en/articles/10169521-projects-in-chatgpt). Skai: [MemoryPage.tsx](../apps/desktop/src/features/memory/MemoryPage.tsx), [CAPABILITY_MATRIX.md](CAPABILITY_MATRIX.md).

### 10. Voice, images, and media

| ChatGPT/Codex | Skai Desktop |
|---|---|
| Eligible ChatGPT desktop users can use Voice in Work or Codex. ChatGPT's wider multimodal and image-generation features depend on the selected experience and account access. | Skai provides local dictation, OS-native text-to-speech, image workflows through ComfyUI or managed local Diffusers, image/PDF/text attachments, and local video-frame sampling. |
| Hosted model and service availability can make these features accessible without installing local inference runtimes. | Skai requires compatible local runtimes/models. Voice success, live ComfyUI, image editing, and broader media acceptance are still partial/unverified per its capability matrix. |
| Codex desktop's primary reference flow is coding and agent supervision; media/voice is not the center of the supplied coding screenshots. | Skai makes Image Studio, the built-in pet and companion system, voice, local model management, and memory first-class app routes. These are Skai-specific capabilities, not Codex navigation equivalents. |

**Sources:** OpenAI [ChatGPT Work and Codex](https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex). Skai: [ImagesPage.tsx](../apps/desktop/src/features/catalog/ImagesPage.tsx), [ChatPage.tsx](../apps/desktop/src/features/chat/ChatPage.tsx), [CAPABILITY_MATRIX.md](CAPABILITY_MATRIX.md).

### 11. Scheduled work, goals, and background execution

| ChatGPT/Codex | Skai Desktop |
|---|---|
| ChatGPT Work supports scheduled or trigger-based work where available; Codex supports long-running coding tasks and agent supervision. Cloud tasks can continue on OpenAI-managed machines. | Skai has local scheduled task records with pause, resume, cancel, and reviewed Run now actions. It does not imply unattended hosted inference; autonomous dispatch and background task execution remain incomplete. |
| Codex can isolate parallel agent tasks using worktrees; current OpenAI material also describes goals, side chats, queued/steering prompts, and remote task review. | Skai Workbench tracks local plans, dependencies, approvals, and artifacts. Parallel agents, project-isolated worktrees as an end-user workflow, goals tied to chats, and phone-to-desktop task control are not implemented in the current capability matrix. |

**Sources:** OpenAI [ChatGPT Work and Codex](https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex), [Codex app introduction](https://openai.com/index/introducing-the-codex-app/), [Codex remote workflow guide](https://developers.openai.com/blog/mastering-codex-remote-for-engineering). Skai: [ScheduledRunsPanel.tsx](../apps/desktop/src/features/agents/ScheduledRunsPanel.tsx), [FUTURE_FEATURES.md](FUTURE_FEATURES.md), [CAPABILITY_MATRIX.md](CAPABILITY_MATRIX.md).

### 12. Screen context, computer use, browser, and remote control

| ChatGPT/Codex | Skai Desktop |
|---|---|
| Current OpenAI desktop workflows include app/window capture (Appshots), Codex computer use on Windows for eligible accounts, in-app browser workflows, and remote steering/review of supported host tasks from mobile. Availability and regional/workspace restrictions apply. | Skai has no computer-use control path, built-in browser panel, screen/app context capture, or phone-to-desktop task control in the current product. Its backlog lists computer use, built-in browser, screen capture, and remote device access as future work. Skai does have web search with citations and a system-wide launcher, which are narrower functions. |
| A user can attach app context to a Codex thread or steer a running task remotely, keeping it connected to the original agent task. | Skai's launcher opens the local app; it does not transfer screen context or control an agent running elsewhere. |

**Sources:** OpenAI [ChatGPT Business release notes](https://help.openai.com/en/articles/11391654-chatgpt-business-release-notes), [Codex remote workflow guide](https://developers.openai.com/blog/mastering-codex-remote-for-engineering). Skai: [FUTURE_FEATURES.md](FUTURE_FEATURES.md), [README.md](../README.md).

### 13. Permissions, safety, and trust boundary

| ChatGPT/Codex | Skai Desktop |
|---|---|
| ChatGPT app access is account/workspace governed. Codex local work is sandboxed and may require approval for elevated commands; cloud work runs in a managed environment. | Skai's renderer has no direct filesystem access. The Electron bridge mediates operations; the Agent Host owns local provider calls, persistence, project boundaries, approvals, and guarded file/terminal operations. |
| The user can choose local or cloud surfaces where enabled, with plan/workspace controls affecting the available paths. | Skai's model path is local-only. File access is bound to explicitly selected folders, protected names and bounded operations are enforced, and no hosted fallback is offered. |
| An account-based workflow allows cloud sync and remote access, but can involve cloud storage of conversation/task context. | Locality reduces cloud dependence and supports offline/local-runtime workflows, but users manage local model installation, hardware fit, and local backups themselves. |

**Sources:** OpenAI [Codex app security overview](https://openai.com/index/introducing-the-codex-app/), [ChatGPT Work and Codex](https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex). Skai: [ARCHITECTURE.md](ARCHITECTURE.md), [README.md](../README.md).

### 14. Extensibility and customization

| ChatGPT/Codex | Skai Desktop |
|---|---|
| Skills and plugins can package instructions, resources, scripts, and connected apps; availability and syncing vary by product surface and account. Codex also interoperates with its CLI/IDE configuration. | Skai supports local personas, prompt presets, local skills/MCP, model/provider configuration, appearance settings, and configurable pets. It does not inherit ChatGPT account skills, GPTs, app connections, or Codex CLI history. |
| The plugin directory and workspace administration provide a managed distribution and permission surface. | Skai's local marketplace and MCP UI have their own install/grant flow. They are independent catalogs, not a mirror of the OpenAI directory. |

**Sources:** OpenAI [Skills in ChatGPT](https://help.openai.com/en/articles/20001066-skills-in-chatgpt), [Plugins in ChatGPT and Codex](https://help.openai.com/en/articles/20001256-plugins-in-codex/), [Codex app introduction](https://openai.com/index/introducing-the-codex-app/). Skai: [PluginsPage.tsx](../apps/desktop/src/features/catalog/PluginsPage.tsx), [SettingsPage.tsx](../apps/desktop/src/features/settings/SettingsPage.tsx), [CAPABILITY_MATRIX.md](CAPABILITY_MATRIX.md).

### 15. Platform and lifecycle

| ChatGPT/Codex | Skai Desktop |
|---|---|
| Current ChatGPT desktop is available on macOS and Windows. Cloud Work extends to web/mobile; supported Codex remote access is also available from mobile surfaces. Availability depends on plan/workspace. | Skai's documented desktop distribution targets Windows and Linux. The repo documents Linux installers and window-manager/Wayland behavior; a macOS product distribution is not documented as a supported release target. |
| Account-based cloud work can continue across eligible devices; Codex has local and cloud environments. | Skai runs an Electron shell plus a persistent local .NET Agent Host and optional separate companion window. Closing the main window may leave the host/tray/pet resident, depending on platform. |
| OpenAI manages desktop updates and service/model availability. | Skai packages and updates its own application from its repository/release pipeline; local model runtimes and model files have separate install/update lifecycles. |

**Sources:** OpenAI [Moving to the new ChatGPT desktop app](https://help.openai.com/en/articles/20001276-moving-to-the-new-chatgpt-desktop-app). Skai: [README.md](../README.md), [ARCHITECTURE.md](ARCHITECTURE.md), [RELEASE_READINESS.md](RELEASE_READINESS.md).

### 16. Visual language and density

| ChatGPT/Codex references | Skai screenshots and current implementation |
|---|---|
| The supplied Codex screenshots use a restrained dark canvas, compact top tabs, project breadcrumbs, a file tree, a wide conversation column, and a right-side context inspector. Project lists are simple searchable rows. Menus are small popovers with short labeled destinations. | Skai keeps its own teal/blue identity, gradient/backdrop effects, accent labels, cards, and persistent left rail/sidebar. Its page-based coding view includes project/file/Git/task panels, while the conversation view uses a separate route. |
| Codex's visible hierarchy keeps the prompt and response central, and moves files/review details into adjacent panes or the right inspector. | Skai's shell has a route toolbar plus page headers; the supplied Usage screenshot repeats “Usage” and surfaces a repository error on that unrelated page. The screenshot also shows filler-like recent-chat titles. |
| Codex's right panel exposes task-related changes, outputs, sources, and subagents in one place. | Skai's activity panel, task Workbench, project Git review, and chat sources are distinct UI areas. |

The goal should be to imitate the **work flow and information hierarchy**, not to erase Skai's local-first identity or copy ChatGPT branding. Keep Skai's local model, explicit folder, Git safety, Linux, image, memory, and companion surfaces visible where they materially differ.

## Differences that matter most to the product direction

| Priority | Difference | Why it matters | Codex-like direction for Skai |
|---|---|---|---|
| 1 | No project-scoped coding conversation that directly performs the task | Users cannot ask, watch, inspect, and continue in one place. | Make the active project conversation the center of Coding Workspace; retain the project and selected model across turns. |
| 2 | Changes, artifacts, task state, and chat are split | Review requires navigating among Coding, Chat, and Workbench. | Add a conversation-linked inspector with changed files, outputs, task status, sources, and review actions. |
| 3 | No persistent project/thread tabs or task-preserving switch | Switching routes or projects can lose the user's sense of active work. | Add lightweight workspace tabs or a recent-task switcher that returns to the same project conversation. |
| 4 | Project records are folders, not reusable project knowledge spaces | Instructions exist, but chats, source materials, and answers do not form one project context. | Decide whether Skai projects should group project chats and saved local sources while retaining explicit local access. |
| 5 | Incomplete global discovery and visible app-state noise | Sidebar title-only search and visible filler/error state make the app feel less finished. | Provide cross-surface search and prevent stale project errors or test data from appearing as unrelated active UI. |
| 6 | Account/cloud services and local runtime have different tradeoffs | ChatGPT offers sign-in, hosted models, cloud sync, and remote work; Skai offers local control and Linux. | State this boundary clearly in onboarding and provider selection; don't imply ChatGPT sign-in or cloud parity unless implemented. |

## Capability comparison by Skai status

The matrix below uses Skai's current repository capability classifications; these are not quality ratings of either product.

| Surface | Skai status in repository | Main gap vs. ChatGPT/Codex flow |
|---|---|---|
| Electron shell/navigation | Working | No unified ChatGPT/Codex switcher, cross-type recents, or persistent task tabs. |
| Chat and local persistence | Working | Not connected to a project coding thread; no account/cloud sync. |
| Local models | Working | Does not sign in to ChatGPT or route to hosted models. |
| Projects and GitHub | Partial | Local folder workspaces exist; project chats/sources and richer shared project context do not. |
| Coding Agent / Workbench | Partial | Model-directed coding dispatch and project edits remain gaps; proposed tasks and review UI exist. |
| Terminal | Partial | Local sessions and bounded commands exist; full OS sandboxing and packaged cross-platform PTY acceptance remain. |
| Marketplace / skills / MCP | Partial | Local catalog and grants exist; it is not the OpenAI plugin/app directory and richer lifecycle/auth retrieval remain. |
| Usage | Partial/not available | No verified token, latency, GPU-memory, or cost measurements are exposed. |
| Memory / corpus | Partial | Explicit local notes and imported documents exist; no ChatGPT project memory/sharing model. |
| Voice/images/media | Partial | Local workflows exist; successful speech-pack, live ComfyUI, and image-edit acceptance remain open. |
| Scheduled work | Partial | Local schedule controls exist; autonomous/unattended execution is not implied. |
| Platform | Windows/Linux documented | No supported macOS release is documented; Linux is a Skai-specific advantage over the current official ChatGPT desktop availability statement. |

The full evidence-backed status is maintained in [CAPABILITY_MATRIX.md](CAPABILITY_MATRIX.md).

## Evidence and references

### Skai source and product documentation

- [README.md](../README.md) — product boundary, local-first positioning, current product surfaces, supported installation notes.
- [ARCHITECTURE.md](ARCHITECTURE.md) — Electron/renderer/preload/Agent Host/Core boundaries.
- [CAPABILITY_MATRIX.md](CAPABILITY_MATRIX.md) — current working/partial/planned status and remaining gaps.
- [FUTURE_FEATURES.md](FUTURE_FEATURES.md) — explicit product boundary, unfinished coding-agent and workspace features.
- [UI_REFERENCE_GUIDE.md](UI_REFERENCE_GUIDE.md) — screenshot references and product interaction goals.
- [AppRouteView.tsx](../apps/desktop/src/app/AppRouteView.tsx) — route-to-page map.
- [CodingPage.tsx](../apps/desktop/src/features/coding/CodingPage.tsx), [CodingSessionView.tsx](../apps/desktop/src/features/coding/CodingSessionView.tsx) — project and coding flow.
- [ChatPage.tsx](../apps/desktop/src/features/chat/ChatPage.tsx), [CodingPage.tsx](../apps/desktop/src/features/coding/CodingPage.tsx) — conversation-linked project and task flows.
- [UsagePage.tsx](../apps/desktop/src/features/usage/UsagePage.tsx), [PluginsPage.tsx](../apps/desktop/src/features/catalog/PluginsPage.tsx), [MemoryPage.tsx](../apps/desktop/src/features/memory/MemoryPage.tsx) — usage, integration catalog, and memory behavior.

### OpenAI primary references

- [ChatGPT Work and Codex](https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex) — current desktop modes, account/workspace constraints, cloud/local Work, cross-device behavior, Codex separation.
- [Moving to the new ChatGPT desktop app](https://help.openai.com/en/articles/20001276-moving-to-the-new-chatgpt-desktop-app) — current ChatGPT/Codex navigation and platform statement.
- [Projects in ChatGPT](https://help.openai.com/en/articles/10169521-projects-in-chatgpt) — project chats, files, instructions, sources, sharing, and memory.
- [Finding your chats, projects, and files](https://help.openai.com/en/articles/10056348-how-do-i-search-my-chat-history-in-chatgpt) — ChatGPT search scope and history behavior.
- [Introducing the Codex app](https://openai.com/index/introducing-the-codex-app/) — agent threads, parallel work, worktrees, diffs, local sandboxing, and CLI/IDE interoperability.
- [Plugins in ChatGPT and Codex](https://help.openai.com/en/articles/20001256-plugins-in-codex/) and [Skills in ChatGPT](https://help.openai.com/en/articles/20001066-skills-in-chatgpt) — plugin, app, skill, setup, and permission model.
- [Codex remote engineering workflow](https://developers.openai.com/blog/mastering-codex-remote-for-engineering) — remote task steering, review, goals, and agent workflow features.

## Maintenance notes

- Recheck official OpenAI references before release or roadmap decisions; plans, availability, and desktop rollout change over time.
- Update Skai status from source/tests and the capability matrix, not from the appearance of a menu item or a successful build alone.
- When comparing a screenshot, record its capture date and distinguish it from current product behavior.
- Keep the comparison focused on interaction and capability. Skai should borrow the Codex project's continuity and review hierarchy while keeping its own brand and local-first trust model.

## Implementation update — 2026-11-16

The workflow redesign is underway. Skai now has persisted chat/project session tabs, an Extras flyout in place of Quick Actions, and a Settings overlay that leaves the selected workspace underneath. Coding Agent Send starts a local task directly, task records retain their project/conversation IDs, and the conversation can show task status, results, file labels, Stop/Retry, and Review changes. The task executor can read/write project files with the existing hash checks and undo journal, and can run bounded project commands. Old Workbench links are redirected into the conversation/coding surface.

These changes narrow the original page-handoff gap, but do not yet complete the intended Codex-like experience. The project workspace still needs its final three-pane layout and responsive drawers; queued follow-ups and scheduled runs are not yet scoped to a project conversation; Marketplace still contains duplicate catalog/hub navigation; live capacity-aware scheduling and AirLLM queue handoff are not complete; and the current-tree legacy-name/data migration is still outstanding. See [Workflow Overhaul Plan](WORKFLOW_OVERHAUL_PLAN.md) for the accepted requirements, sequence, and acceptance criteria.
