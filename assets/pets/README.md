# Companion sprite sheets

The runtime format is one independent generated strip per pet and state in `generated/`:
`<pet>-<state>-frames.png` is a 2560×256 transparent image with ten 256×256 frames. Frame 0 is
the pet's idle rest pose, and frame 9 repeats it to close the cycle. The states
are `idle`, `walk`, `thinking`, `coding`, `coding_malicious`, `stuck`, `success`, and `error`.
The Electron companion loads the matching strip directly and only plays `walk` while the native
window is actually moving.

The older source sheets that used to live in `archive/legacy-sheets/` were removed during the asset
de-bloat. They were never loaded by the production companion; restore them from git history
(the parent of the `chore(debloat): step 4` commit) if the archived tools in `archive/legacy-tools/` are ever needed again.

To rebuild walk artwork, place source walk strips in `generated/`, run
`pwsh -NoProfile -ExecutionPolicy Bypass -File assets/pets/normalize-pet-animations.ps1`, then run
`python assets/pets/convert-six-to-ten.py`. The first pass crops by alpha, rejects missing/invalid
frames, preserves aspect ratio, and keeps the authored gait poses. The conversion pass closes each
loop with the matching idle rest pose and expands legacy six-cel strips to ten cels. It accepts
already converted strips too, so rerunning it is safe. Pass `-InputDirectory` to the PowerShell
normalizer to copy replacement strips in from somewhere else.

Custom companion profiles live on the device. Use Pet Workshop to draw ten-frame PNG strips or
import/export companion profiles; legacy six-frame strips remain viewable until they are redrawn.

Byte, Nova and Rocky use hand-tuned walk strips that weren't made from their walk sources, so the rebuild
script leaves their `walk` strip alone. Edit those strips directly.

Percy is the official Skai Desktop mascot and the default companion for new profiles. The walk
source strips in `generated/` are the editable inputs for Percy, Ember and Sprout (Byte, Nova and Rocky's
are kept for reference). No atlas is required or loaded by the renderer.
