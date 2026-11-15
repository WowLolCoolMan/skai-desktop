# Companion sprite sheets

The runtime format is one independent generated strip per pet and state in `generated/`:
`<pet>-<state>-frames.png` is a 1536×256 transparent image with six 256×256 frames. The states
are `idle`, `walk`, `thinking`, `coding`, `coding_malicious`, `stuck`, `success`, and `error`.
The Electron companion loads the matching strip directly and only plays `walk` while the native
window is actually moving.

The older source sheets that used to live in `archive/legacy-sheets/` were removed during the asset
de-bloat. They were never loaded by the production companion; restore them from git history
(the parent of the `chore(debloat): step 4` commit) if the archived tools in `archive/legacy-tools/` are ever needed again.

To rebuild the canonical runtime assets, place six-frame walk source strips in `generated/` and
run `pwsh -NoProfile -ExecutionPolicy Bypass -File assets/pets/normalize-pet-animations.ps1`.
That pass crops by alpha, rejects missing/invalid frames, preserves aspect ratio, and locks the
baseline. The other states are read from `generated/` by default; pass `-InputDirectory` to copy
replacement strips in from somewhere else.

Users can still assign local SVG/PNG/JPEG/WebP frames from the pet customization dialog; custom
files stay on the device.

Percy is the official Skai Desktop mascot and the default companion for new profiles. The six
walk source strips in `generated/` are kept as the editable visual inputs; no atlas is required
or loaded by the renderer.
