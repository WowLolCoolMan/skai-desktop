"""Convert built-in pet sheets to 11 cells: rest at 0, motion at 1-9, rest at 10."""

from pathlib import Path
from PIL import Image
import os

ROOT = Path(__file__).parent / "generated"
SOURCE = Path(__file__).parent / "source"
PETS = ("percy", "rocky", "byte", "sprout", "nova", "ember", "blaze")
STATES = ("idle", "walk", "thinking", "coding", "coding_malicious", "stuck", "success", "error")


def read_rest_pose(path: Path):
    with Image.open(path) as source:
        image = source.convert("RGBA")
    frame_count = next((count for count in (11, 10, 6) if image.width % count == 0), 0)
    if not frame_count:
        raise ValueError(f"Unexpected idle strip width: {path} ({image.width})")
    frame_width = image.width // frame_count
    return image.crop((0, 0, frame_width, image.height))


def idle_source_path(pet: str) -> Path:
    source = SOURCE / f"{pet}-idle-frames.png"
    return source if source.exists() else ROOT / f"{pet}-idle-frames.png"


def convert(path: Path, rest: Image.Image, output_path: Path | None = None):
    with Image.open(path) as source:
        image = source.convert("RGBA")
    frame_count = next((count for count in (11, 10, 6) if image.width % count == 0), 0)
    if not frame_count:
        raise ValueError(f"Unexpected strip width: {path} ({image.width})")
    frame_width = image.width // frame_count
    if rest.size != (frame_width, image.height):
        raise ValueError(f"Idle rest pose dimensions do not match {path}")
    output = Image.new("RGBA", (frame_width * 11, image.height), (0, 0, 0, 0))
    state = path.stem.split("-")[1]
    # Idle is a real breathing loop too: retain and resample its authored
    # intermediate poses instead of leaving nine transparent cells.
    active_source_count = max(0, frame_count - 2)
    if state == "idle" and active_source_count == 0:
        active_source_count = max(0, frame_count - 1)
    for index in range(1, 10):
        source_index = 1 if active_source_count <= 1 else 1 + round((index - 1) * (active_source_count - 1) / 8)
        source_index = min(frame_count - 2 if frame_count > 2 else frame_count - 1, max(1, source_index))
        cell = image.crop((source_index * frame_width, 0, (source_index + 1) * frame_width, image.height))
        if state == "idle":
            # Built-in idle sheets have a static source pose. Add a restrained,
            # grounded breathing pulse instead of exposing nine duplicate cels.
            factors = (.996, .992, .988, .984, .98, .984, .988, .992, .996)
            resized = cell.resize((frame_width, max(1, round(image.height * factors[index - 1]))), Image.Resampling.NEAREST)
            cell = Image.new("RGBA", (frame_width, image.height), (0, 0, 0, 0))
            cell.alpha_composite(resized, (0, image.height - resized.height))
        output.alpha_composite(cell, (index * frame_width, 0))
    output.alpha_composite(rest, (0, 0))
    output.alpha_composite(rest, (10 * frame_width, 0))
    output_path = output_path or path
    temporary = output_path.with_suffix(".eleven-frame.tmp.png")
    output.save(temporary, format="PNG", optimize=True)
    os.replace(temporary, output_path)


strips = []
for pet in PETS:
    idle_path = idle_source_path(pet)
    rest = read_rest_pose(idle_path)
    for state in STATES:
        path = ROOT / f"{pet}-{state}-frames.png"
        if not path.exists():
            raise FileNotFoundError(f"Missing built-in strip: {path}")
        convert(idle_path if state == "idle" else path, rest, path)
        strips.append(path)

print(f"Converted {len(strips)} built-in strips to 11 cells; frame 10 now exactly repeats frame 0.")
