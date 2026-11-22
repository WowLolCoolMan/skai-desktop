# Reference implementation registry

This registry records implementation patterns for Skai Desktop. It is a
design and integration guide, not permission to copy source. Recheck each
upstream license, pinned revision, transitive dependency, model license, and
third-party asset before adding code or redistributing a runtime. Repository
licenses can change; the links below point to the current upstream source as
reviewed on 2026-11-22.

## Projects and Skai decisions

| Project | What is useful | Skai application | Integration decision | License and obligations |
| --- | --- | --- | --- | --- |
| [Unsloth](https://github.com/unslothai/unsloth) | Optimized training and fine-tuning workflows, explicit hardware/model compatibility, memory-aware options, and a desktop-oriented Studio flow. Source: [training request model](https://github.com/unslothai/unsloth/blob/main/studio/backend/models/training.py), [license](https://github.com/unslothai/unsloth/blob/main/LICENSE). | Build a guided Model Training area around dataset review, compatibility preflight, LoRA/QLoRA presets, real resource estimates, checkpoints, evaluation, and export. Keep GPU-heavy training in an isolated Python worker and make every step resumable and observable. | Reuse supported upstream training packages through a managed worker where compatible; keep Skai's Electron/.NET UI and job lifecycle native. Do not recreate kernel optimizations. Audit each dependency and supported model before bundling. | Mixed: core `unsloth/*`, tests, and scripts are Apache-2.0; optional `studio/*` and `unsloth_cli/*` are AGPL-3.0. A Studio integration or redistribution needs a separate copyleft review; do not assume the core license covers it. |
| [Open WebUI](https://github.com/open-webui/open-webui) | A unified interface for local Ollama and OpenAI-compatible local/cloud endpoints, with a consistent model selection and conversation experience. Source: [provider overview](https://github.com/open-webui/open-webui#open-webui), [license](https://github.com/open-webui/open-webui/blob/main/LICENSE). | Shape Skai's provider gateway around explicit connections, per-chat model choice, capability labels, streaming, and clear local/cloud destination disclosure. Preserve a true offline mode and never silently change providers. | Adapt the UX and provider abstraction; do not embed or fork its application. The current Skai Electron + React + .NET architecture remains authoritative. | Current repository license includes an Open WebUI branding restriction; earlier revisions have different MIT/BSD terms. No source reuse or rebranding is planned. Review exact file history and terms before any direct dependency. |
| [CrewAI](https://github.com/crewAIInc/crewAI) | Separates autonomous role-based Crews from event-driven, structured Flows. Flows offer clearer control for production tasks. Source: [Flows docs](https://docs.crewai.com/concepts/flows), [repository](https://github.com/crewAIInc/crewAI). | Keep a durable typed task/run state machine as the execution backbone. Delegate specialist agents only for bounded subproblems, with shared task specs, explicit dependencies, progress, and evidence. | Adapt orchestration concepts; do not couple the .NET Agent Host to a Python framework for routine runs. Consider a separately managed adapter only if a real use case justifies the operational cost. | MIT. Preserve notices if any code is ever reused; dependency and transitive-license review still required. |
| [Everything Claude Code (ECC)](https://github.com/affaan-m/ECC) | Large, harness-oriented library of on-demand skills, agent roles, hooks, rules, memory patterns, and verification workflows. Source: [skill and hook instructions](https://github.com/affaan-m/ECC/blob/main/AGENTS.md), [license](https://github.com/affaan-m/ECC/blob/main/LICENSE). | Grow Skai's reviewed Skills and Marketplace model with clear scope, discoverability, compatibility, and real verification steps. Use a repeatable review/build/test loop for Skai contributions. | Adapt the packaging and workflow patterns. Do not import harness-specific configs wholesale; translate useful rules into Skai's own skill and policy contracts. | MIT. Retain notices for copied substantial portions; individual external tools remain under their own terms. |
| [Browser Use](https://github.com/browser-use/browser-use) | Persistent browser sessions over CDP, reusable browser helpers, user-controlled sessions, and clear worker/environment boundaries. Source: [agent architecture notes](https://github.com/browser-use/browser-use/blob/main/AGENTS.md), [persistent REPL](https://github.com/browser-use/browser-use/tree/main/browser_use/repl), [license](https://github.com/browser-use/browser-use/blob/main/LICENSE). | Add browser automation as an observable, cancelable project tool with a persistent session, action log, explicit permissions, and recovery. Keep browser credentials in the user's browser profile and out of prompts, logs, and child-process environments. | Adapt the session lifecycle and helper interface. Keep browser control behind Electron IPC and Agent Host permissions; do not adopt cloud browser services by default. | MIT for the repository/package reviewed. Check `browser-harness` and other separately versioned dependencies before bundling. |
| [Taste Skill](https://github.com/Leonxlnx/taste-skill) | Art direction, reference-led design decisions, screenshot review, and a real-browser look-and-fix loop. Source: [skill instructions](https://github.com/Leonxlnx/taste-skill/blob/main/skills/taste-skill/SKILL.md), [license](https://github.com/Leonxlnx/taste-skill/blob/main/LICENSE). | Apply the evidence loop to Skai's actual desktop routes: establish a per-page design intent, inspect at target widths/themes, fix observed issues, and retain screenshots with acceptance notes. | Use visual review principles, not its website-specific layout rules as a desktop-app template. Keep Skai's current brand, accessible controls, and native workspace density. | MIT for the reviewed skill repository. Any photographs, fonts, or other assets it sources have separate rights and must not be assumed covered. |
| [Archify](https://github.com/tt-a1i/archify) | Typed JSON intermediate representations, strict schemas, validated renderers, and portable interactive diagrams. Source: [schema catalog](https://github.com/tt-a1i/archify/blob/main/archify/schemas/README.md), [license notice](https://github.com/tt-a1i/archify/blob/main/NOTICE). | Generate interactive architecture maps, task plans, research maps, and workflow views from typed data. Validate inputs and keep artifacts portable and editable. | Adapt the strict-IR and validation pattern first. Integrate a renderer only after evaluating bundle size, accessibility, licensing, and the existing artifact preview boundary. | Current code is Apache-2.0 with preserved historical MIT grants and third-party notices; older releases retain their original terms. Review the target revision and bundled components. |
| [DeerFlow](https://github.com/bytedance/deer-flow) | Long-running agent runs, sandbox-aware filesystem access, explicit run status, specialist delegation, and durable task-oriented execution. Source: [backend sandbox/runtime overview](https://github.com/bytedance/deer-flow/blob/main/backend/README.md), [license](https://github.com/bytedance/deer-flow/blob/main/LICENSE). | Strengthen Skai's checkpoint/recovery, cancellation, per-run resource leases, delegation boundaries, and isolation. Make active work understandable in its originating conversation. | Adapt the runtime concepts, not the full LangGraph/LangChain service stack. Preserve Skai's persistent .NET Agent Host and make sandbox availability explicit. | MIT for the reviewed repository revision. Recheck model/provider SDKs, sandbox providers, and other separately licensed dependencies before integration. |

## Cross-project implementation rules

1. **One execution record:** Every long task has a durable ID, state, event log,
   cancellation state, outputs, and verification evidence. The originating
   chat remains the user's primary view.
2. **Adapters at boundaries:** Providers, runtimes, browsers, and training
   engines plug into narrow typed contracts; they do not create a parallel app
   shell or duplicate Skai's storage and workflow state.
3. **Make network use a visible choice:** Local, connected-cloud, and hybrid
   routes are explicit. Show what leaves the device, require the user's
   configured provider credentials, keep credentials in OS-protected storage,
   and never silently fall back to a different provider.
4. **Fail closed on execution isolation:** Time/output bounds and process-tree
   cleanup do not equal filesystem or network sandboxing. Do not claim sandbox
   protection or expand unattended/parallel commands until OS isolation is
   verified on the target platform.
5. **Show measured progress:** Use provider/runtime events and exit status.
   Label unknown progress as unknown; never invent percentages or report
   completion before the worker exits.
6. **Use interface references as evidence:** Compare actual user paths and
   interaction cost. Do not clone unrelated product details or sacrifice
   accessibility and Skai's product identity.

## Integration priorities

| Priority | Workstream | First useful deliverable | Main dependency or gate |
| --- | --- | --- | --- |
| P0 | Provider gateway | User-managed provider connections, OS-protected credentials, explicit per-chat routing, streaming/error/cancel behavior, and offline mode | Secure credential bridge and a provider contract; no remote route until secret and consent tests pass |
| P0 | Agent execution | Durable evented task lifecycle with recovery and evidence | Verified OS sandbox before unattended or parallel shell work |
| P1 | Voice and media | Capability-aware engines, user-selected local/cloud routes, cancellation, and truthful status | Real microphone, speech pack, runtime, and packaged acceptance |
| P1 | Model training | Guided local fine-tune job that checks hardware/data before downloads, saves checkpoints, and evaluates outputs | License review, compatible GPU/runtime matrix, isolated worker, and real hardware validation |
| P1 | Browser automation | User-visible browser session with bounded tools, explicit actions, and robust recovery | Browser-profile/credential separation and platform sandbox acceptance |
| P2 | Interactive artifacts | Typed, validated, portable diagrams linked to conversations and tasks | Safe preview, keyboard access, schema versioning, and bounded rendering |
| Continuous | Desktop UI | Evidence-backed route review at supported widths, themes, and keyboard states | Running packaged Electron app and saved review evidence |

## Review cadence

Update this file when a reference materially changes, a new project is adopted,
an integration decision changes, or a dependency is proposed. Add concrete
implementation evidence to the [capability matrix](../planning/CAPABILITY_MATRIX.md)
and release or user-visible work to [To Do Next](../planning/TO_DO_NEXT.md). Treat
repository popularity as discovery input, not proof of security, quality, or
compatibility.
