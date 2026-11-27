# Skai capability gap closure

## Objective

Build the prioritized Codex-like workflow in Skai's existing Electron and .NET Agent Host architecture. Keep model execution, workspace changes, and integrations local to the user's configured runtimes. Use Bonsai 2.5 27B for the coding manager and Bonsai 2 9B for delegated workers when those model IDs are available from the selected local provider.

## Implementation status

| Priority | Capability | Status | Runtime setup |
| --- | --- | --- | --- |
| 1 | Manager and worker orchestration | Implemented | Select a coding model and a separate subagent model in Settings. Workers have independent task contexts, a maximum of six per manager, and share the local capacity scheduler. |
| 2 | Pixal3D through ComfyUI | Implemented as a workflow integration | Import a ComfyUI API workflow that accepts `{{prompt}}`, returns a GLB output, and uses the installed 3D nodes/models. Configure it under Settings → Image Generation → 3D workflow JSON, then save settings. |
| 3 | SkinTokens rigging | Implemented as a local CLI tool | Set `SKAI_SKINTOKENS_CLI` and `SKAI_SKINTOKENS_MODEL_DIR` for the Agent Host runtime and install the SkinTokens binary/model files. The agent can call `rig_3d` on a GLB produced in the project. |
| 4 | In-app browser preview | Implemented | Run the project preview server and open its localhost URL in the Coding browser. The agent can inspect visible text, local links, and console messages. Browser navigation is restricted to loopback. |
| 5 | SSH devbox terminal | Implemented | Use the Terminal's SSH target with a host already trusted in `known_hosts` and local OpenSSH keys or agent. Password prompts and forwarding are disabled. |
| 6 | Plugin tool access | Implemented for connected MCP servers | Connect a reviewed local MCP integration in Marketplace. Coding tasks can invoke its discovered tools; Electron asks for approval for every call, and write-capable calls are labeled. |

## Model roles and capacity

The main coding model and subagent model have separate settings and persist provider, model ID, estimated weight size, and context length. Delegated tasks inherit the subagent assignment unless a task explicitly overrides it. The coding manager uses the coding assignment; ordinary chat remains independently configurable.

The model selector supports discovered models, and the agent settings also accept an exact runtime model ID for models that are not currently listed. The model must still be installed and exposed by the chosen provider before execution will succeed. Current local Ollama discovery did not include Bonsai, so set the IDs only after installing/exposing those models. Reported download sizes in the supplied model table are about 5.93 GB for 27B and 2.00 GB for 9B, with about 6 GB and 2 GB of weight VRAM respectively; actual runtime headroom also depends on KV cache, context length, and offload settings.

## End-to-end asset flow

1. The manager plans the asset and chooses `generate_3d` when a 3D ComfyUI workflow is configured.
2. ComfyUI receives the prompt and optional source image. Skai reads the completed job history, retrieves a GLB, validates the GLB v2 header and declared length, and writes it under `generated-assets/` in the selected project.
3. If requested, the manager calls `rig_3d`. Skai invokes the configured SkinTokens CLI without a shell, applies bounded execution/output limits, validates the result, and saves the rigged GLB in the project.

Image generation and 3D generation use separate ComfyUI workflow settings so an image workflow cannot be mistaken for a model-producing graph.

## Orchestration and review boundaries

- A coding manager may delegate up to six independent tasks; workers cannot delegate further. The manager releases its local execution slot while it waits, then reviews worker summaries and integrates the result.
- The Agent Host persists task state and run journal events. Existing workspace file hash checks, bounded commands, cancellation, capacity admission, and task approval behavior remain in the execution path.
- Browser preview returns page content as untrusted input and exposes no general remote browsing surface.
- MCP tool names, descriptions, schemas, results, and arguments are treated as untrusted. Each tool invocation receives a native one-time approval dialog before it is sent to the connected server.
- SSH stays in the guarded terminal workflow and uses the system OpenSSH client with strict host-key checking.

## Verification completed

- Agent Host build completed with zero warnings and errors.
- Desktop TypeScript typecheck completed.
- Electron main, preload, and Agent Host client JavaScript syntax checks completed.
- `git diff --check` completed; Git reports only existing line-ending normalization notices.

## Not bundled by this change

Skai does not download or package Bonsai weights, ComfyUI 3D node/model assets, or SkinTokens binaries/model weights. Those runtimes remain locally installed dependencies; configure their IDs, workflows, and paths in the host environment before using the corresponding tools.
