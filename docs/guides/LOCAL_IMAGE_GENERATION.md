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
renderer. It supports text-to-image and image-to-image from a validated local
PNG/JPEG source. Recent output history is kept in IndexedDB on this device,
including Diffusers image bytes, prompt, provider, and timestamp. History is
limited to 24 records and 32 MiB of URL data.

On 2026-11-22, packaged Windows acceptance cancelled active inference, generated
a valid 512×512 JPEG, reopened it from history for image-to-image editing,
generated a second valid JPEG, and restored both outputs after app reload.
Reported progress matched the runtime's effective scheduler steps (4/4 for
text-to-image and 2/2 for editing). The `smoke:image:workflow` acceptance path
uses cached weights and Hugging Face offline mode. The packaged
`smoke:image:runtime-unavailable` and `smoke:image:model-unavailable` recovery
checks also pass. Generation used CPU; the separate ComfyUI GPU execution path
has only the partial live acceptance described below.

`npm run smoke:image:model-unavailable` verifies the packaged offline cache-miss
path. The UI explains that SD-Turbo is not cached, offers one-time internet
download guidance, and remains ready for retry. Python tracebacks and local
cache paths are reduced to a short diagnostic before reaching the UI. Focused
native tests cover this case and ordinary first-line worker errors.

## ComfyUI integration

The Electron client can connect to a user-configured local ComfyUI server,
discover installed checkpoints, create built-in text-to-image and image-edit
workflows, import and save workflows, upload a source image, and queue and poll
local jobs. Live generation acceptance against a running ComfyUI instance
passed on 2026-11-23. Skai discovered the locally installed
`Juggernaut-XL_v9.safetensors` checkpoint, submitted a text-to-image workflow,
reported queue/progress updates, retrieved the generated 512×512 PNG from the
local ComfyUI endpoint, and validated the payload (438,972 bytes). A repeatable
Agent Host acceptance smoke also cancelled a live ComfyUI job and verified the
queue cleared, then uploaded a generated source image, completed image-to-image,
and retrieved a valid edited PNG (351,304 bytes). Run it with
`npm run smoke:image:comfy-live`; it requires an already-running loopback
ComfyUI service and an installed checkpoint, and leaves successful outputs in
the ComfyUI output directory. The server reported an AMD Radeon RX 7900 XTX
with 23.8 GiB free VRAM at the start of the check; ComfyUI's own execution logs
were not inspected, so this does not yet confirm which device performed
inference. ComfyUI remains a separate local service and is not required for the
built-in Diffusers path.

## Current boundaries and next work

- The built-in worker currently supports `stabilityai/sd-turbo` only. The UI does
  not yet provide general model search, an installed-model library, arbitrary
  model selection, or advanced generation controls.
- The worker selects CUDA when PyTorch reports it available and otherwise uses
  CPU. AMD GPU acceleration and backend selection are not implemented or
  verified; CPU may be slow.
- ComfyUI history retains local output URLs, so the local ComfyUI service must be
  available to view those outputs later. Live ComfyUI acceptance, resumable
  downloads/jobs, and broader hardware acceptance remain open.
- Runtime setup and model download need clear disk/network requirements. Model
  weights and Python packages are separate downloads.
- Prompts and model execution remain local. Model downloads contact Hugging Face
  and follow that repository's license and access requirements. The packaged
  workflow smoke uses only cached model weights.

## Acceptance criteria

The built-in Diffusers path has passed local text-to-image, image-to-image,
active cancellation, and history restoration after reload on packaged Windows
using cached SD-Turbo weights and CPU inference. This does not establish GPU or
ComfyUI support; those live acceptance items remain open in the
[capability matrix](../planning/CAPABILITY_MATRIX.md). Mocked-worker tests verify
plumbing only and do not substitute for real runtime acceptance.

## References

- [Diffusers installation](https://huggingface.co/docs/diffusers/installation)
- [Stable Diffusion Turbo model card](https://huggingface.co/stabilityai/sd-turbo)
