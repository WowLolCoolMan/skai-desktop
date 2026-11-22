# Skai Desktop documentation

Start with the [project overview](../README.md). This index separates current
status, product guides, engineering references, release work, and historical
material. The public [project site](https://wowlolcoolman.github.io/skai-desktop/)
provides a shorter introduction.

## Current status and planning

- [Capability matrix](CAPABILITY_MATRIX.md) — evidence-backed status and
  remaining boundaries; source of truth for what works today.
- [To Do Next](TO_DO_NEXT.md) — active contributor handoff, agreed approach,
  owner, and acceptance evidence.
- [Future features](FUTURE_FEATURES.md) — longer-term product backlog.
- [Implementation plans](implementation-plans/README.md) — detailed technical
  plans; delivery priority comes from To Do Next and the capability matrix.
- [UI evidence and progress](SKAI_PREMIUM_UI_PROGRESS.md) — visual and
  interaction acceptance status.
- [UI reference guide](UI_REFERENCE_GUIDE.md) — product goals and supplied
  reference screenshots.

## Product guides

- [Model library](MODEL_LIBRARY.md) — local model sources and installation.
- [Local image generation](LOCAL_IMAGE_GENERATION.md) — Diffusers and ComfyUI
  workflows and acceptance boundaries.
- [Pets and companions](PETS_AND_COMPANIONS.md) — built-in characters, motion,
  workshop, and local generation.
- [Theming](THEMING.md) — custom themes, palettes, and appearance controls.

## Architecture and integrations

- [Architecture](ARCHITECTURE.md) — Electron, renderer, preload, Agent Host, and
  Core boundaries.
- [Electron default runtime](ELECTRON_DEFAULT_RUNTIME.md) — supported runtime
  and migration evidence.
- [Electron + C# voice boundary](ELECTRON_CSHARP_VOICE_ARCHITECTURE.md) — local
  dictation, speech output, and voice-turn lifecycle.
- [GitHub integration](GITHUB_INTEGRATION.md) — repository workflows and
  permissions.
- [GitHub Pages](GITHUB_PAGES.md) — public site and deployment.
- [Integrations inventory](codebase/INTEGRATIONS.md) — local services and
  external connections.
- [Agent Host guide](../services/agent-host/README.md) — protocol and host
  development notes.
- [AirLLM runtime guide](../services/airllm/README.md) — optional local runtime.

## Release and operations

- [Release readiness](RELEASE_READINESS.md) — current acceptance status for the
  next release.
- [Production readiness gaps](PRODUCTION_READINESS_GAPS.md) — release-wide
  reliability, accessibility, and platform gaps.
- [Release guide](RELEASING.md) — artifact, signing, and publication process.
- [Rolling updates](ROLLING_UPDATES.md) — update manifest and rollout behavior.
- [Windows installer](WINDOWS_INSTALLER.md) — installer configuration and
  lifecycle evidence.
- [Changelog](../CHANGELOG.md) — released version history.

## Research and history

- [ChatGPT/Codex comparison](research/CHATGPT_CODEX_VS_SKAI_DIFFERENCES.md) —
  historical comparison based on the 2026-11-16 product snapshot; current Skai
  status lives in the capability matrix.
- [Super-app research](research/SUPER_APP_RESEARCH.md) — product and
  architecture research, not a roadmap commitment.
- [Reference implementation registry](research/REFERENCE_IMPLEMENTATION_REGISTRY.md)
  — patterns, Skai integration choices, and license boundaries for the eight
  engineering references.
- [Open WebUI research](research/OPEN_WEBUI_RESEARCH.md) — design inspiration
  and license review, not a source reuse grant.
- [Archived notes](archive/README.md) — completed work logs and superseded
  planning documents retained for historical context.

## Community and licensing

- [Contributor guide](../CONTRIBUTING.md)
- [Code of Conduct](../CODE_OF_CONDUCT.md)
- [Security policy](../SECURITY.md)
- [Accessibility statement](../ACCESSIBILITY.md)
- [Source Reference License](../LICENSE)
- [Third-party notices](../THIRD_PARTY_NOTICES.md)
