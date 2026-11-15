# Local image generation

Skai has two local image paths. Both keep prompts and generated content on this
computer; there is no hosted inference fallback.

## Built-in Diffusers runtime

The Images page can install an optional Python environment in
`%LOCALAPPDATA%\Skai\Diffusers` (Windows) and run Stable Diffusion Turbo through
Hugging Face Diffusers. Setup is user initiated and reports pip output; PyTorch
and related packages can use several gigabytes. The first generation downloads
the `stabilityai/sd-turbo` model weights (about 5.2 GB). The current worker uses
512×512 output, four inference steps, and CPU when CUDA is unavailable. The
managed Python environment is installed on the local machine and is not bundled
inside the desktop installer.

The worker accepts one prompt per process and returns a bounded JPEG to the
renderer. The renderer keeps recent output history in IndexedDB on this device,
including the Diffusers image bytes, prompt, provider, and timestamp. History is
limited to 24 records and 32 MiB of URL data. Runtime dependency installation,
the first model download, and local CPU generation were exercised in Skai on
2026-11-15. The persistent IndexedDB database and image blob were present after
closing and relaunching the app; visually reopening the gallery entry after that
restart still needs acceptance. Cancellation during inference and the packaged
hardware matrix also remain unverified.

## ComfyUI integration

The Electron client can connect to a user-configured local ComfyUI server,
discover installed checkpoints, create built-in text-to-image and image-edit
workflows, import and save workflows, upload a source image, and queue and poll
local jobs. Live generation acceptance against a running ComfyUI instance is
still open. ComfyUI is a separate local service; it is not required for the
built-in Diffusers path.

## Current boundaries and next work

- The built-in worker currently supports `stabilityai/sd-turbo` only. The UI does
  not yet provide general model search, an installed-model library, arbitrary
  model selection, or advanced generation controls.
- The worker selects CUDA when PyTorch reports it available and otherwise uses
  CPU. AMD GPU acceleration and backend selection are not implemented or
  verified; CPU may be slow.
- ComfyUI history retains local output URLs, so the local ComfyUI service must be
  available to view those outputs later. Built-in Diffusers editing, resumable
  downloads/jobs, inference progress, and cancellation of active generation
  remain open.
- Runtime setup and model download need clear disk/network requirements. Model
  weights and Python packages are separate downloads.
- Prompts and model execution remain local. Model downloads contact Hugging Face
  and follow that repository's license and access requirements.

## Acceptance criteria

Do not call built-in generation complete until a real supported model has been
downloaded, generated an image locally, and that image has been reopened from
local storage. The first two steps were verified on Windows with Python 3,
PyTorch 2.15.0+cpu, Diffusers 0.43.0, and CPU inference on 2026-11-15; visual
reopen after restart remains outstanding. Mocked-worker tests verify plumbing
only; they do not substitute for real model acceptance.

## References

- [Diffusers installation](https://huggingface.co/docs/diffusers/installation)
- [Stable Diffusion Turbo model card](https://huggingface.co/stabilityai/sd-turbo)
