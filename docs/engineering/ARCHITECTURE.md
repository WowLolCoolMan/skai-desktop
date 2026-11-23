# Skai Desktop architecture

Skai Desktop has one desktop UI architecture: Electron + React + TypeScript,
backed by a persistent .NET Agent Host.

```text
Electron main process
  ├─ sandboxed React renderer
  ├─ context-isolated typed preload bridge
  └─ companion window (selected built-in or custom pet, when enabled)
       │
       ▼
  persistent .NET Agent Host
       │
       ▼
  native/SkaiDesktop.Core (headless domain, persistence, providers, policy)
```

## Boundaries

- The renderer owns presentation, navigation, local UI state, and user
  interaction. It has no Node.js or direct filesystem access.
- Electron main owns window lifecycle, the typed IPC boundary, host lifecycle,
  file-picker mediation, and the separate always-on-top companion window. The
  renderer owns sprite playback and pet behavior preferences; attack actions
  read cursor coordinates but do not move or click the pointer.
- The Agent Host owns protocol handling, local model/provider requests,
  persistence, project boundaries, approvals, terminal sessions, and workflow
  state.
- `native/SkaiDesktop.Core` is a headless .NET library shared by the host and
  Core tests. It is not a desktop UI and has no alternate shell.

## Runtime commands

```text
npm run start                 # Electron development runtime
npm run build                 # Renderer production build
npm run open                  # Built Electron runtime
npm run package:electron      # Portable Electron + Agent Host artifact
npm run smoke:electron:artifact
```

The packaged artifact includes the self-contained Agent Host under
`resources/agent-host`, so a packaged install does not require a source
checkout or a separate .NET installation.

## Coding Agent command boundary

Approved project commands run inside OS-managed process boundaries. Linux
requires Bubblewrap and an active user systemd manager: the command runs in a
transient cgroup scope with `MemoryMax` (half of available memory, bounded to
256 MiB–8 GiB and any lower explicit budget), `MemorySwapMax=0`,
`TasksMax=128`, and a CPU quota capped at four cores. Bubblewrap grants write
access only to the selected project, mounts system paths read-only, isolates
temporary files, and separates PID, network, IPC, and UTS namespaces. Session
bus variables needed by the host-side systemd launcher are cleared before the
approved command starts. Missing namespace or cgroup support prevents
execution. Timeouts and cancellation terminate the scope.

Windows uses a capability-free AppContainer for project filesystem and network
isolation and a Job Object for process-tree memory and process-count limits.
Drive/share roots, project paths that traverse a symbolic link/junction/mount
point, and directories under Windows, Program Files, or ProgramData cannot be
selected as writable project roots. Failure to establish either required
boundary prevents execution. These controls apply only when the user explicitly
runs a detected project check or command; preflight only detects available
checks.

Coding Agent commands are currently disabled on macOS and any other platform
without a supported sandbox adapter. Skai refuses the command before launching
a shell instead of silently running it with host filesystem and network access.
The separately user-opened Interactive Terminal remains a host shell.

Built-in and custom pet profiles are managed in the renderer's Pet Workshop.
See [Pets and companions](../guides/PETS_AND_COMPANIONS.md) for the strip format, behavior
defaults, and local generation flow.

## Validation

The Electron-only release boundary is checked by the syntax, hygiene, runtime,
local-only, renderer typecheck/build, Core test, packaging, artifact smoke, and
responsive overflow commands in `package.json`.
