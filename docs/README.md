# Skai Desktop documentation

Start with the [project overview](../README.md), then use this index to find
current status, user guides, engineering references, release procedures, and
historical research. The public [project site](https://wowlolcoolman.github.io/skai-desktop/)
is a short introduction; this repository is the detailed source of truth.

## Start here

| If you want to… | Read… |
| --- | --- |
| Understand the app and run it | [Project overview](../README.md) |
| See what works and what remains | [Capability matrix](planning/CAPABILITY_MATRIX.md) |
| Pick up active contributor work | [To Do Next](planning/TO_DO_NEXT.md) |
| Propose future product work | [Future features](planning/FUTURE_FEATURES.md) |
| Contribute changes | [Contributor guide](../CONTRIBUTING.md) |
| Report a security issue | [Security policy](../SECURITY.md) |

## Product planning and design

- [Capability matrix](planning/CAPABILITY_MATRIX.md) — current implementation
  evidence and limits.
- [To Do Next](planning/TO_DO_NEXT.md) — active assignments and handoff notes.
- [Future features](planning/FUTURE_FEATURES.md) — longer-term proposals.
- [Implementation plans](planning/implementation-plans/README.md) — bounded
  technical approaches; current priority comes from To Do Next.
- [UI evidence and progress](planning/SKAI_PREMIUM_UI_PROGRESS.md) — visual
  acceptance notes and remaining review.
- [UI reference guide](planning/UI_REFERENCE_GUIDE.md) — product direction and
  the supplied reference screenshots.

## User guides

- [Model library](guides/MODEL_LIBRARY.md) — local model discovery, install,
  selection, and compatibility.
- [Local image generation](guides/LOCAL_IMAGE_GENERATION.md) — Diffusers and
  ComfyUI setup, use, and acceptance limits.
- [Pets and companions](guides/PETS_AND_COMPANIONS.md) — built-in companions,
  animation, Workshop, and local concept generation.
- [Theming](guides/THEMING.md) — themes, palettes, fonts, and appearance.
- [GitHub integration](guides/GITHUB_INTEGRATION.md) — repository connection,
  credentials, and guarded Git workflows.
- [Theme schema](theme.schema.json) — machine-readable format for custom themes.

## Engineering references

- [Architecture](engineering/ARCHITECTURE.md) — Electron, renderer, preload,
  Agent Host, and Core boundaries.
- [Electron runtime](engineering/ELECTRON_DEFAULT_RUNTIME.md) — supported
  desktop runtime, commands, and CI.
- [Voice architecture](engineering/ELECTRON_CSHARP_VOICE_ARCHITECTURE.md) —
  local dictation, speech output, and hands-free session boundaries.
- [Integrations inventory](engineering/INTEGRATIONS.md) — local runtimes,
  Marketplace sources, storage, and external connections.
- [Agent Host guide](../services/agent-host/README.md) — protocol and host
  development notes.
- [AirLLM runtime guide](../services/airllm/README.md) — optional local runtime.

## Operations and releases

- [Release readiness](operations/RELEASE_READINESS.md) — current release
  evidence and blockers.
- [Production readiness gaps](operations/PRODUCTION_READINESS_GAPS.md) —
  platform, accessibility, and operational gaps.
- [Release guide](operations/RELEASING.md) — artifact, signing, and publication
  process.
- [In-app updates](operations/ROLLING_UPDATES.md) — update checks, downloads,
  and verification behavior.
- [Windows installer](operations/WINDOWS_INSTALLER.md) — installer setup and
  lifecycle evidence.
- [Feature backtest](operations/backtesting/feature-backtest.md) — workflow
  acceptance evidence and environment-dependent checks.
- [GitHub Pages](operations/GITHUB_PAGES.md) — public site maintenance and
  deployment.
- [Changelog](../CHANGELOG.md) — version history.

## Research and archive

- [Super-app research](research/SUPER_APP_RESEARCH.md) — product landscape and
  architecture notes; not a roadmap commitment.
- [Open WebUI research](research/OPEN_WEBUI_RESEARCH.md) — design inspiration
  and license boundary.
- [Reference implementation registry](research/REFERENCE_IMPLEMENTATION_REGISTRY.md)
  — patterns and licensing notes for engineering references.
- [Historical ChatGPT/Codex comparison](archive/research/CHATGPT_CODEX_VS_SKAI_DIFFERENCES.md)
  — dated comparison; use the capability matrix for current Skai status.
- [Archived implementation notes](archive/README.md) — completed work logs,
  superseded plans, and prototypes retained for history.

## Project policies and licensing

- [Code of Conduct](../CODE_OF_CONDUCT.md)
- [Accessibility statement](../ACCESSIBILITY.md)
- [Support](../SUPPORT.md)
- [Security policy](../SECURITY.md)
- [Source Reference License](../LICENSE)
- [Third-party notices](../THIRD_PARTY_NOTICES.md)
- [Contributor License Agreement](../CONTRIBUTOR_LICENSE_AGREEMENT.md)
