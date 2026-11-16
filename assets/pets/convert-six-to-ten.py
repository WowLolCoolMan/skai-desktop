"""Expand the six-cel authored pet strips into ten-cel closed loops."""

from pathlib import Path
from PIL import Image
import os

ROOT = Path(__file__).parent / "generated"
PETS = ("percy", "rocky", "byte", "sprout", "nova", "ember")
STRIPS = sorted(ROOT.glob("*-frames.png"))

for pet in PETS:
    idle_path = ROOT / f"{pet}-idle-frames.png"
    with Image.open(idle_path) as image:
        idle = image.convert("RGBA")
    if idle.width % 6:
        raise ValueError(f"Unexpected source width: {idle_path}")
    frame_width = idle.width // 6
    rest = idle.crop((0, 0, frame_width, idle.height))

    for path in (item for item in STRIPS if item.name.startswith(f"{pet}-")):
        with Image.open(path) as image:
            source = image.convert("RGBA")
        if source.width != frame_width * 6 or source.height != idle.height:
            raise ValueError(f"Unexpected source dimensions: {path}")

        output = Image.new("RGBA", (frame_width * 10, source.height), (0, 0, 0, 0))
        idle_strip = path.name == idle_path.name
        for frame in range(10):
            if frame in (0, 9) or idle_strip:
                cell = rest
            else:
                source_index = min(5, (frame - 1) * 6 // 8)
                cell = source.crop((source_index * frame_width, 0, (source_index + 1) * frame_width, source.height))
            output.alpha_composite(cell, (frame * frame_width, 0))

        temporary = path.with_suffix(".ten-frame.tmp.png")
        output.save(temporary, format="PNG", optimize=True)
        os.replace(temporary, path)

print(f"Converted {len(STRIPS)} pet strips to ten frames; frame 0 and frame 9 use each pet's idle rest pose.")
