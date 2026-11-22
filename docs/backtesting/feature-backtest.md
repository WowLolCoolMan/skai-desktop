# Skai Desktop feature backtest

Updated: 2026-11-22

This is the living acceptance matrix for the feature backtest goal. “Pass” means
the current repository check or packaged smoke test produced evidence for the
listed workflow. “Conditional” means the workflow is implemented but needs a
machine, credential, model, or release runner that is not available in this
worktree.

## Passing coverage

| Area | Evidence |
| --- | --- |
| Native core, persistence, capacity policy, memory, queues, task artifacts, persona knowledge | `npm test` |
| Agent Host protocol, voice protocol, persona/group lifecycle, task scheduler, AirLLM status | `npm run smoke:agent-host` |
| Capacity-aware concurrency and cancellation | Agent Host smoke with measured slot limit and oversized cancellation fixture |
| Marketplace catalog and model results | `npm run smoke:marketplace-host` |
| Project browser, terminal, editor, reviewed undo | `smoke-project-browser`, `smoke-project-terminal`, `smoke-project-editor` |
| Chat queue, conversation search, metadata, fork/export/archive | `smoke-chat-queue`, `smoke-conversation-search`, `smoke-conversation-metadata` |
| Memory workflows | `smoke-memory` |
| PDF attachment policy | `smoke-pdf-attachment` |
| Local voice output and cancellation contract | `smoke:voice:acceptance -- --require-installed-pack` |
| Installed AirLLM sidecar preflight | `npm run smoke:airllm` |
| Packaged Electron routes, Marketplace, Percy, video sampling, local audio fail-closed behavior | `smoke:electron:artifact` |
| Accessibility | 14 routes, 0 WCAG violations in `smoke:electron:accessibility` |
| Responsive overflow | 11 routes × 5 viewport widths |
| UI matrix | 17 routes × 5 sizes × 4 theme/sidebar variants |
| Themes and live reload | `smoke:electron:themes` |
| Pets, Linux windowing, update policy, bridge/runtime/tray/local-only audits | Corresponding `test:*` and `audit:*` scripts |
| Repository hygiene and release configuration | `check:hygiene`, `check:release-config`, `audit:future-features` |
| Windows 0.1.4 unsigned installer packaging and update metadata | `SKAI_ALLOW_UNSIGNED_INSTALLER=true node scripts/package-windows-installer.cjs` — NSIS artifact and `latest.yml` verified locally |
| Real local Diffusers generation progress | Installed SD-Turbo runtime generated a 512×512 CPU image; worker reported actual 1/4 through 4/4 inference steps. Agent Host now forwards step progress and cancellation to the image operation. |

## Conditional or incomplete coverage

| Area | Current evidence and next validation |
| --- | --- |
| AirLLM inference | AirLLM and Torch import successfully from `%LOCALAPPDATA%\\Skai\\AirLLM\\venv`; the worker’s CUDA preflight and malformed-input paths return structured errors. A real model run still requires an NVIDIA GPU and CUDA-capable PyTorch, plus a compatible Hugging Face model and enough disk/RAM/VRAM. |
| Microphone dictation | Packaged Electron reports the `en-US` on-device speech pack unavailable and correctly refuses remote recognition. Requires an installed speech pack or approved local STT fixture. |
| Packaged Marketplace workflow | `smoke:electron:artifact` opens the packaged app but fails its Marketplace DOM acceptance: the expected Marketplace heading and Models navigation entry are not detected. Reconcile the smoke with the current in-app navigation and verify the Installed destination under Tools. |
| Persona model quality | Research succeeds with installed `qwen3:14b`; one character draft returned a partial card. Core deterministic voice-card and source-boundary tests pass, but more model-specific quality evaluation is needed. |
| Cloud voice playback | ElevenLabs adapter validation and failure paths are covered; an end-to-end successful request requires a user-provided API key and voice ID. |
| Release signing and lifecycle | Release audit confirms the gates exist. Cryptographic signing and clean-machine upgrade/rollback still require configured CI secrets and Windows/Ubuntu runners. |
| Local Windows upgrade lifecycle | A current 0.1.4 installer can be built and metadata-verified locally, but the disposable 0.1.3 → 0.1.4 upgrade smoke needs a real 0.1.3 installer artifact. The unsigned local artifact is not release evidence. |
| Linux AppImage packaging | The packager correctly refuses to run on Windows; build and acceptance require an Ubuntu/Linux runner. |

## Test-harness notes

The scheduler smoke originally assumed one slot and serial execution. Capacity
is now measured dynamically, and the cancellation fixture uses an oversized
model estimate to deterministically exercise the single-slot path. Tasks also
inherit the saved provider when no task-specific provider is supplied, keeping
AirLLM-aware admission consistent with `system.capacity`.

The update-metadata verifier resolves `js-yaml` from the desktop dependency
tree, matching the repository's install layout and allowing the local Windows
installer packaging check to run after `npm --prefix apps/desktop install`.
