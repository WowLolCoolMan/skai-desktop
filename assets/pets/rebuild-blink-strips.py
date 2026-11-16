"""Build smooth, closed-loop 11-cel blink strips from the current shipped rest cels."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).parent / "generated"
PETS = ("percy", "byte", "ember", "blaze", "nova", "rocky", "sprout")
# Tiny per-eye masks and lid positions in the current 256px idle cels. Each
# closed pose starts from the exact rest art, so no body pixels can resize.
BLINKS = {
    "percy": {"eyes": [(170, 60, 192, 75), (210, 57, 225, 74)], "fill": (218, 217, 232, 255), "lid": (47, 40, 67, 255)},
    "byte": {"eyes": [(103, 101, 122, 123), (157, 101, 176, 123)], "fill": (5, 30, 48, 255), "lid": (108, 242, 255, 255)},
    "ember": {"eyes": [(147, 86, 178, 108), (193, 82, 215, 107)], "fill": (222, 68, 32, 255), "lid": (61, 27, 23, 255)},
    "blaze": {"eyes": [(168, 85, 196, 105), (221, 83, 235, 102)], "fill": (199, 26, 35, 255), "lid": (46, 22, 27, 255)},
    "nova": {"eyes": [(108, 126, 132, 148), (147, 126, 170, 148)], "fill": (22, 31, 134, 255), "lid": (133, 230, 255, 255)},
    "rocky": {"eyes": [(121, 107, 145, 131), (158, 107, 180, 131)], "fill": (2, 19, 54, 255), "lid": (25, 218, 226, 255)},
    "sprout": {"eyes": [(98, 105, 119, 129), (138, 105, 160, 129)], "fill": (199, 213, 88, 255), "lid": (39, 61, 24, 255)},
}


def closed_pose(rest: Image.Image, pet: str, phase: int) -> Image.Image:
    spec = BLINKS[pet]
    frame = rest.copy()
    draw = ImageDraw.Draw(frame)
    width = 4 if pet in ("byte", "rocky", "nova") else 5
    for x0, y0, x1, y1 in spec["eyes"]:
        draw.ellipse((x0, y0, x1, y1), fill=spec["fill"])
        mid_x = (x0 + x1) // 2
        base_y = (y0 + y1) // 2 + (1 if phase == 1 else 2)
        points = [(x0 + 1, base_y + 1), (mid_x, base_y - 1), (x1 - 1, base_y + 1)]
        draw.line(points, fill=spec["lid"], width=width)
    return frame


def main():
    for pet in PETS:
        idle = Image.open(ROOT / f"{pet}-idle-frames.png").convert("RGBA")
        rest = idle.crop((0, 0, 256, 256))
        target_bounds = rest.getchannel("A").getbbox()
        if target_bounds is None:
            raise ValueError(f"{pet} has an empty idle rest frame")
        path = ROOT / f"{pet}-blink-frames.png"
        output = Image.new("RGBA", (2816, 256), (0, 0, 0, 0))
        closed = closed_pose(rest, pet, 2)
        # Ease the eyelids shut, hold briefly, then reopen. The endpoint cel is
        # always the exact source rest frame so each blink has a clean seam.
        blends = (0.12, 0.28, 0.48, 0.72, 0.94, 1.0, 1.0, 0.72, 0.42)
        frames = [rest, *(Image.blend(rest, closed, amount) for amount in blends), rest]
        for frame_index, frame in enumerate(frames):
            if frame.getchannel("A").getbbox() != target_bounds:
                raise ValueError(f"{pet} blink frame {frame_index} changes the sprite bounds")
            output.alpha_composite(frame, (frame_index * 256, 0))
        output.save(path, format="PNG", optimize=True)
    print("Rebuilt seven smooth 11-cel blink loops from exact idle rest cels; sprite bounds and loop seams are stable.")


if __name__ == "__main__":
    main()
