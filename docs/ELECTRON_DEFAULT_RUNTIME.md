# Electron default runtime

Electron + React + the persistent .NET agent host are the only desktop
runtime for this repository. Shared .NET Core services remain headless and are
consumed by the Agent Host; there is no second desktop UI architecture.

## Commands

```text
npm run start          # Electron development runtime
npm run build          # Electron renderer production build
npm run open           # Open the built Electron runtime
npm run package:electron        # Stage a portable Electron + Agent Host artifact
npm run smoke:electron:artifact # Verify the staged artifact renders its core shell
```

The renderer is sandboxed and communicates with the .NET host through the
context-isolated preload bridge. Shared Core is not a desktop UI and cannot be
launched as an alternate shell.

The portable artifact bundles a self-contained Agent Host under
`resources/agent-host`; it does not require a source checkout or a local .NET
installation to start. Signed installer delivery remains a separate release
gate.

## CI evidence

`.github/workflows/electron-ci.yml` installs the renderer dependencies,
typechecks and builds the Electron surface, builds the persistent host, and
runs the disposable protocol smoke. This is the minimum replacement-runtime
gate for every push and pull request.
