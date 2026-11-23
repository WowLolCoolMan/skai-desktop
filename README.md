# Skai Desktop

<div align="center">
  <img src="assets/branding/skaiwolficon.png" width="112" alt="Skai Desktop wolf icon" />
  <h1>Skai Desktop</h1>
  <p><strong>Local AI for the work behind the conversation.</strong></p>
  <p>Bring chat, coding, projects, models, and creative tools together in one desktop workspace you control.</p>
</div>

<p align="center">
  <img src="assets/branding/skai-desktop-hero.png" alt="Skai Desktop workspace" />
</p>

Skai is built for the whole AI work loop: choose a model, bring in the right context, work with your files, review what changed, and keep or undo the result. Your conversations and project work live side by side in one app, with local model choice and clear boundaries around agent actions.

> **Try the 0.1.4 testing release:** [Download from GitHub Releases](https://github.com/WowLolCoolMan/skai-desktop/releases/latest). The Windows release is unsigned; production code signing is deferred while the app is in active development. See [release readiness](docs/operations/RELEASE_READINESS.md) for verified status and remaining limits.

## A workspace built around the whole job

**Ask → add project context → work with files and tools → review → keep or undo**

- **Your models, your choice.** Connect local runtimes such as Ollama, LM Studio, LocalAI, llama.cpp, or vLLM. Discover installed models, compare them, and switch explicitly; Skai does not silently choose another model for you.
- **From conversation to project work.** Keep chats linked to projects, inspect files, edit in Monaco, review diffs, run approved commands, and follow task activity in the conversation that started it.
- **Agent actions you can inspect.** Coding tasks use bounded tools, approvals, cancellation, and undo. Approved project commands run in OS sandboxes on supported Windows and Linux systems; Skai refuses to start them when it cannot establish the required isolation.
- **Tools beyond text.** Use local image generation and editing, document and media attachments, voice tools, saved personas, and animated desktop companions.
- **One coherent desktop app.** Chats, projects, models, Marketplace, memory, settings, and tools are part of the same workspace, so context can travel with the work.

## What you can do

| Area | Skai Desktop today |
| --- | --- |
| **Chat** | Persistent conversations, local memory, search, folders, tags, split view, attachments, document-grounded turns, queued follow-ups, and conversation export/import. |
| **Coding and projects** | Project-linked chats and tasks, Monaco editor, bounded previews, reviewable file changes, guarded terminal actions, cancellation, undo, and task activity. |
| **Models** | Local runtime discovery, model library, explicit model switching, capability checks, comparisons, and reviewed downloads for supported catalog formats. |
| **Voice and media** | Local speech output, local audio transcription, hands-free controls, image generation/editing, and local video-frame sampling. Microphone dictation depends on the operating system's speech pack. |
| **Marketplace and tools** | Search supported catalogs, review installs, manage installed items, and connect local MCP tools. Support varies by category; the [capability matrix](docs/planning/CAPABILITY_MATRIX.md) lists current boundaries. |
| **Personal workspace** | Themes, keyboard shortcuts, in-app documentation, saved personas, and seven built-in animated companions. |

## Local-first, with clear boundaries

Chat inference in the shipped release runs through the local model runtime you select. Skai does not send chat prompts to hosted model providers or silently fall back to a cloud model. Skai does not sell model access; you choose and configure your own runtimes.

Some actions connect to their own services—for example, web search, GitHub operations, or catalog and model downloads. Those integrations use the network to perform the action you selected. Optional user-connected cloud and hybrid **chat model** routes are planned, but are not available in the current release. Before those routes ship, the provider gateway must provide explicit routing, protected credentials, clear data disclosure, and an offline-only mode.

## Safer project commands

Coding Agent commands are isolated by the operating system:

- **Windows:** AppContainer isolation limits project commands to the selected project and required read-only runtime paths, with no network access. A Job Object also limits process count and memory. If Windows cannot establish the sandbox, Skai refuses to run the command.
- **Linux:** Bubblewrap isolates project commands with read-only system paths, a writable selected-project directory, a private temporary directory, and separate process, network, IPC, and UTS namespaces. Resource limits use systemd cgroups. If Bubblewrap or required namespaces are unavailable, Skai refuses to run the command.
- **Other platforms:** Coding Agent commands remain disabled until Skai can establish a supported sandbox. Skai does not fall back to unrestricted project commands.
- **Interactive Terminal:** This is a separately user-opened shell and does not use the Coding Agent command sandbox.

See the [capability matrix](docs/planning/CAPABILITY_MATRIX.md) for acceptance evidence and remaining platform gaps.

## Run from source

To build and run Skai from source, install:

- Windows 10 or 11
- Node.js 20 or newer
- .NET 10 SDK
- Ollama, LM Studio, or another supported local model runtime for AI responses (optional for interface work)

```sh
npm run desktop:install
npm run desktop:dev
```

To build the renderer and open the desktop shell:

```sh
npm run desktop:build
npm run open:desktop
```

## Linux desktop notes

Linux x64 packages use a per-user installer and do not require root for installation. Extract the `Skai-Desktop-electron-linux-x64` archive and run `./install.sh`; `./uninstall.sh` removes the app while keeping your data. The current package and update acceptance status is in the [release readiness report](docs/operations/RELEASE_READINESS.md).

Window behavior depends on your desktop environment:

- **Wayland:** Skai uses XWayland by default so companion windows can be positioned. Set `SKAI_OZONE_PLATFORM=wayland` to use native Wayland; the compositor then controls pet placement and dragging.
- **Tiling window managers:** Pets request a floating window. Add a window rule if your manager tiles them.
- **X11 without a compositor:** Transparent companion windows may appear black. Run a compositor such as `picom`, or hide companions from the tray or Settings.
- **System tray:** Closing the window keeps Skai running only when a tray host is available. Without one, closing quits the app.

macOS is not yet covered by the release acceptance matrix, and Coding Agent commands are disabled there.

## Project structure

```text
apps/desktop/              Electron + React desktop app
services/agent-host/       Persistent .NET host and protocol boundary
native/SkaiDesktop.Core/   Shared provider, persistence, workflow, and safety logic
assets/                    Branding and built-in companion assets
docs/                      Guides, plans, release evidence, and research
```

## Documentation

- [Documentation index](docs/README.md) — guides, engineering notes, operations, and research
- [Capability matrix](docs/planning/CAPABILITY_MATRIX.md) — current features and limits
- [To Do Next](docs/planning/TO_DO_NEXT.md) — active contributor work
- [Future features](docs/planning/FUTURE_FEATURES.md) — longer-term proposals
- [Local model library](docs/guides/MODEL_LIBRARY.md) — supported runtimes and model installation
- [Local image generation](docs/guides/LOCAL_IMAGE_GENERATION.md) — setup and acceptance boundaries

## Contributing

Keep changes incremental and verifiable. Preserve the Electron → isolated IPC → .NET Agent Host boundary, keep provider secrets out of the renderer, and include evidence for user-facing changes. Start with [CONTRIBUTING.md](CONTRIBUTING.md).

Skai Desktop is source-available for reference under the [Skai Desktop Source Reference License](LICENSE). Existing snapshots published under MIT remain under their original terms. Third-party components retain their own licenses; see [Third-party notices](THIRD_PARTY_NOTICES.md). Also read the [Code of Conduct](CODE_OF_CONDUCT.md), [Security Policy](SECURITY.md), and [Accessibility statement](ACCESSIBILITY.md).

## Development checks

Run the checks that match your change before opening a pull request:

```sh
npm run check:syntax
npm run check:hygiene
npm run audit:electron-runtime
npm run audit:local-only
npm test
npm run desktop:typecheck
npm run desktop:build
```
