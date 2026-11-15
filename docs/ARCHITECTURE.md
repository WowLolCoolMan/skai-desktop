# Skai Desktop architecture

Skai Desktop has one desktop UI architecture: Electron + React + TypeScript,
backed by a persistent .NET Agent Host.

```text
Electron main process
  ├─ sandboxed React renderer
  ├─ context-isolated typed preload bridge
  └─ companion window (Percy, when enabled)
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
  file-picker mediation, and the separate always-on-top companion window.
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

## Validation

The Electron-only release boundary is checked by the syntax, hygiene, runtime,
local-only, renderer typecheck/build, Core test, packaging, artifact smoke, and
responsive overflow commands in `package.json`.
