# Companion sprite sheets

The runtime loads one generated strip per pet and state from `generated/`:
`<pet>-<state>-frames.png` is a transparent 2816×256 image with eleven 256×256
cells. Cell 0 is the neutral rest pose, cells 1–9 animate, and cell 10 is an exact
copy of cell 0. The matching endpoint gives every loop a clean seam. States are
`idle`, `walk`, `thinking`, `coding`, `coding_malicious`, `stuck`, `success`, and
`error`. Blink strips are separate eleven-cell (2816×256) images. They ease the
eyes closed and open again; the blink duration is adjustable per pet in the
Workshop.

To rebuild walk artwork, put source walk strips in `generated/`, run
`pwsh -NoProfile -ExecutionPolicy Bypass -File assets/pets/normalize-pet-animations.ps1`,
then run `python assets/pets/build-blaze-assets.py` and
`python assets/pets/convert-pet-strips-to-eleven.py`, followed by
`python assets/pets/rebuild-blink-strips.py` to regenerate blink strips from the
current idle rest poses. Blink endpoints copy idle rest exactly, and all blink
frames retain its visible bounds so changing sheets cannot resize or shift a pet.
Blaze's large fire-breath plume and impact burst are separate eight-cell
(2048×256) effects, built from the transparent source sheets with
`python assets/pets/build-blaze-attack-assets.py`.
The converter accepts
six-, ten-, and eleven-cell input strips. It keeps the rest pose at both endpoints
and resamples the authored middle cells to nine animation cells. Original idle
motion source strips live in `source/`, so rebuilding does not turn idle into a
frozen pose. Run
`npm run check:pet-assets` to verify all built-in strip dimensions and exact loop
seams, changing idle/motion frames, blink, and Blaze's independent artwork; Python
Pillow is required for the pixel comparison.

Pet Workshop draws eleven-cell strips and keeps legacy six- and ten-cell custom
profiles intact until they are explicitly redrawn or replaced.

Byte, Nova, and Rocky use hand-tuned walk strips that are not made from their walk
sources, so the rebuild script leaves those strips alone. Edit them directly.

Percy is the default companion. Blaze is the attack-focused fire companion, ships
with approach, pounce, and fire-breath behavior enabled, and has original dragon
art from `blaze-source-rest.png` and `blaze-source-walk.png`; its strips are built
by `build-blaze-assets.py`. The attack scene adds a read-only cursor lock-on,
wind-up, animated large fire plume, impact burst, and return. Cursor attacks only
read cursor coordinates and never move or click the cursor. No atlas is loaded by
the renderer.
