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
renderer. It supports both text-to-image and image-to-image from a validated
local PNG/JPEG source. The renderer keeps recent output history in IndexedDB on this device,
including the Diffusers image bytes, prompt, provider, and timestamp. History is
limited to 24 records and 32 MiB of URL data. Runtime dependency installation,
the first model download, and local CPU generation were exercised in Skai on
2026-11-15. On 2026-11-22, direct worker acceptance returned 512×512 JPEGs for
text-to-image and image-to-image; progress reported four actual text steps and
two effective edit steps. Packaged-app history restoration and live cancellation
are now covered by the acceptance run below. The packaged hardware matrix and
live ComfyUI behavior remain unverified.

On 2026-11-22, the packaged Windows app was exercised end to end with the local
runtime and cached SD-Turbo weights. The Images page cancelled active inference,
then generated a valid 512×512 JPEG, reopened it from history for image-to-image
editing, generated a second valid 512×512 JPEG, and restored both images after
reloading the packaged app. `npm run smoke:image:workflow` automates this path
against a packaged artifact using a disposable app profile. It requires the
local runtime and cached weights and sets Hugging Face offline mode so it never
downloads a model as part of the smoke. `npm run
smoke:image:runtime-unavailable` checks the packaged missing-dependency state
with an unavailable Python executable and verifies that the UI offers setup
while disabling generation. Live generation was CPU-backed on this machine;
this does not validate GPU or ComfyUI behavior.

`npm run smoke:image:model-unavailable` verifies the packaged offline cache-miss
path. The UI should explain that SD-Turbo is not cached, offer one-time internet
download guidance, and remain ready for retry. Python tracebacks and local cache
paths are reduced to a short diagnostic before reaching the UI. Focused native
tests cover this case and ordinary first-line worker errors.

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
  available to view those outputs later. Live cancellation through the
  packaged UI, resumable downloads/jobs, and broader hardware acceptance remain
  open.
- Runtime setup and model download need clear disk/network requirements. Model
  weights and Python packages are separate downloads.
- Prompts and model execution remain local. Model downloads contact Hugging Face
  and follow that repository's license and access requirements. The packaged
  workflow smoke uses only cached model weights.

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
