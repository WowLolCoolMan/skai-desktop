# Skai Desktop

<div align="center">
  <img src="assets/branding/skaiwolficon.png" width="128" alt="Skai Desktop wolf icon" />
  <h1>Skai Desktop</h1>
  <p><strong>A local-first desktop workspace for chat, coding, projects, and local AI models.</strong></p>
  <p>Private by default. Built to keep useful work on your own computer.</p>
</div>

<p align="center">
  <img src="assets/branding/skai-desktop-hero.png" alt="Skai Desktop workspace illustration" />
</p>

Skai Desktop is an Electron + React desktop application with a persistent .NET Agent Host. It brings local model chat, project files, guarded terminal work, task review, GitHub workflows, settings, memory, and creative tools into one focused workspace—not a hosted chat wrapper or a collection of disconnected mock screens.

> **Status:** active development · current release line: `0.1.x` · Electron is the only desktop product surface. Capability claims below describe this project snapshot; unfinished ideas remain in the [future feature backlog](docs/planning/FUTURE_FEATURES.md). See the [Skai Desktop project site](https://wowlolcoolman.github.io/skai-desktop/) for the public overview and documentation index.

## Local-first by design

The current `0.1.x` release supports local model inference only. The planned
product direction also supports optional user-connected cloud models and
workflows that combine local and cloud providers; those model routes are not
available yet. Skai will not supply or resell cloud models. Users bring their
own supported provider accounts and credentials.

- Current prompts and attachments go only to the local runtime selected by the
  user. Skai does not silently fall back to a hosted model.
- Future remote routes must disclose what leaves the device, use credentials
  stored by the operating system, be selected by the user, and preserve a real
  offline/local-only mode.
- GitHub remains an explicit project integration for repository context and
  guarded Git workflows; it is not currently an AI model provider.
- Local services such as Ollama, LM Studio, LocalAI, llama.cpp, vLLM,
  OpenAI-compatible loopback servers, and ComfyUI can be connected by the user.
  An optional managed Diffusers runtime can generate Stable Diffusion Turbo
  images locally.

## What Skai is today

| Surface | Current state |
| --- | --- |
| **Chat** | Persistent conversations, attachments, strict per-turn document grounding, on-device voice input and spoken hands-free turns where the desktop runtime supports them, queued follow-ups, Markdown/code rendering, retry, fork, pin, archive, rename, folders, tags, split view, search, and local memory controls. |
| **Coding Workspace** | Monaco editor, project-scoped browsing, bounded previews, editing, reviewable diffs, guarded terminal commands, undo, task planning, and focused project context. |
| **Thread-linked coding tasks** | Durable local task plans, dependency-aware readiness, cancellation, approvals, bounded model-directed file/command actions, and reviewable task state stay attached to the conversation that launched the work. |
| **Scheduled work** | Local one-time and repeating schedules with pause/resume/cancel and reviewed Run now controls. No unattended provider request is implied. |
| **Models** | Local provider discovery, model library, pinned models, capability checks, comparison, explicit unavailable-model recovery, and no silent model switching. |
| **Workspace shell** | Resizable sidebar, persistent navigation state, command palette, settings search, responsive layouts, in-app documentation, and Deep Sea/Deep Space appearance presets. |
| **Pets and companions** | Seven built-in pets in Pet Workshop, eleven-frame looping sprites, adjustable blinks, per-pet idle/walk actions, Blaze's animated pounce and fire-breath fight scene, and guided pet concept generation through local Diffusers or ComfyUI. |
| **Local integrations** | Guarded GitHub repository workflows, local ComfyUI-compatible image workflows, optional Diffusers image generation, and local attachments. |

The [capability matrix](docs/planning/CAPABILITY_MATRIX.md) is the source of truth for working, partial, unverified, and planned areas. The project favors small, tested vertical slices over static mock screens, with screenshots and interaction evidence recorded in [UI progress](docs/planning/SKAI_PREMIUM_UI_PROGRESS.md).

## Why Skai

| Skai Desktop | Typical AI chat app |
| --- | --- |
| Local models in one discoverable library | One provider and disconnected tools |
| Project-scoped context, files, terminal, and task review | Copy and paste between chat, editor, and terminal |
| Persistent local conversations and drafts | Account-first history with opaque data flows |
| Bounded reads and explicit write approval | Broad tool access with limited review |
| Chat, coding, models, images, memory, and settings in one shell | Separate apps for separate steps |

## Architecture

```text
Electron + React + TypeScript
        │ typed, sandboxed local IPC
        ▼
.NET Agent Host
        │ sessions · local providers · tools · persistence
        ▼
Ollama · LM Studio · AirLLM · local OpenAI-compatible APIs · ComfyUI
```

The Electron renderer is the only product UI. The isolated preload bridge exposes only typed desktop operations. The persistent .NET Agent Host and shared Core services own local model requests, project boundaries, persistence, approvals, and guarded file/terminal operations. Closing the main window keeps the local host and enabled companion resident in the system tray, where users can reopen Skai, open recent chats, show or hide pets, or quit explicitly. Pet cursor targeting reads pointer coordinates and never moves or clicks the cursor.

## Run locally

Prerequisites:

- Windows 10/11
- .NET 10 SDK
- Node.js 20+
- A local model runtime such as Ollama or LM Studio (optional for UI work)

```sh
# Install desktop dependencies
npm run desktop:install

# Start the Electron + React desktop app
npm run desktop:dev

# Or build the renderer and open the desktop shell
npm run desktop:build
npm run open:desktop

# Run the shared Core checks
dotnet run --project native/SkaiDesktop.Core.Tests/SkaiDesktop.Core.Tests.csproj
```

### Linux window managers

- **Installing a Linux build:** extract the `Skai-Desktop-electron-linux-x64` archive and run `./install.sh`. It installs for your user (no root needed) and adds Skai to your app launcher and a `skai-desktop` command. On distributions that restrict unprivileged user namespaces (such as Ubuntu 24.04+), it offers the one `sudo` step Chromium's sandbox needs. `./uninstall.sh` removes the app and keeps your data.
- **Wayland (Hyprland, Sway, GNOME, KDE):** Skai runs under XWayland by default because native Wayland does not let apps position their own windows. Set `SKAI_OZONE_PLATFORM=wayland` (or pass `--ozone-platform=wayland`) to use native Wayland; pets then stay where the compositor places them and use compositor-driven dragging.
- **Tiling WMs (i3, bspwm, Hyprland, Sway):** Pets ask to float. Your WM decides borders, stickiness and always-on-top, so add rules for the pet window title if needed.
- **X11 without a compositor** (plain i3, bspwm): transparent windows render with a black background. Run a compositor such as `picom`, or hide pets from the tray or Settings.
- **System tray:** closing the window keeps Skai in the tray only when a tray host is running (Waybar `tray`, KDE, the GNOME AppIndicator extension, or an X11 tray such as i3bar). Without one, closing the window quits Skai.

## Verification

Before opening a pull request, run the checks that match your change:

```sh
npm run check:syntax
npm run check:hygiene
npm run audit:electron-runtime
npm run audit:local-only
npm test
npm run desktop:typecheck
npm run desktop:build
```

The current-release audit is intentional: it prevents unreviewed hosted model
routes from entering the shipped runtime. The planned provider gateway will
replace this broad prohibition with checks for explicit user routing, secure
credential storage, remote-data disclosure, redaction, and offline-only mode.

## Repository map

```text
apps/desktop/              Electron + React desktop surface
services/agent-host/       Persistent .NET host and protocol boundary
native/SkaiDesktop.Core/   Headless provider, persistence, workflow, and safety logic
assets/                    Skai branding and built-in pet sprite assets
docs/                      Product guides, plans, release evidence, and archived research
```

## Documentation

Use the [documentation index](docs/README.md) for the organized guides, plans,
engineering references, release evidence, and research archive. The
[capability matrix](docs/planning/CAPABILITY_MATRIX.md) is the source of truth for
current feature status; [To Do Next](docs/planning/TO_DO_NEXT.md) records active work;
the [future feature backlog](docs/planning/FUTURE_FEATURES.md) holds longer-term ideas.
The [project site](https://wowlolcoolman.github.io/skai-desktop/) provides a
short public overview.

## What is next

Pick up active work from [To Do Next](docs/planning/TO_DO_NEXT.md). The [capability
matrix](docs/planning/CAPABILITY_MATRIX.md) records current evidence and boundaries; the
[future feature backlog](docs/planning/FUTURE_FEATURES.md) holds longer-term work.

## Contributing

Keep changes incremental, local-first, and testable. Preserve the Electron → isolated IPC → .NET Agent Host boundary, never expose provider secrets to the renderer, and include validation evidence for user-facing changes. Cloud routes remain unavailable until the provider-gateway plan's privacy and credential checks pass.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the contributor guide, development checks, and pull request process. The repository is source-available for reference; reuse rights are limited by the [Skai Desktop Source Reference License](LICENSE). Existing snapshots published under MIT remain under their original terms. Third-party components retain their own licenses; see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). Read the [Code of Conduct](CODE_OF_CONDUCT.md), [Security Policy](SECURITY.md), and [Accessibility statement](ACCESSIBILITY.md) before contributing.
