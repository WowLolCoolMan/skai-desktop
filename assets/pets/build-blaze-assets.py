"""Build Blaze's shipped, independent sprite strips from his approved source art."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).parent
GENERATED = ROOT / "generated"


def fit(path: Path) -> Image.Image:
    with Image.open(path) as source:
        image = source.convert("RGBA")
    bounds = image.getchannel("A").getbbox()
    if bounds is None:
        raise ValueError(f"The art source is empty: {path}")
    image = image.crop(bounds)
    scale = min(236 / image.width, 236 / image.height)
    size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
    image = image.resize(size, Image.Resampling.LANCZOS)
    # Lock the sprite to the bottom edge so walking/breathing doesn't make it float.
    cell = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    cell.alpha_composite(image, ((256 - image.width) // 2, 244 - image.height))
    return cell


def animate(base: Image.Image, index: int, state: str, walking: Image.Image) -> Image.Image:
    if state == "walk" and index % 2 == 1:
        return walking.copy()
    frame = base.copy()
    if state == "idle":
        # Gentle body breathing with grounded feet; the rest cell itself stays pristine.
        factors = [1.0, .996, .992, .988, .984, .988, .992, .996, 1.0]
        factor = factors[index - 1]
        resized = frame.resize((256, max(1, round(256 * factor))), Image.Resampling.NEAREST)
        result = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
        result.alpha_composite(resized, (0, 256 - resized.height))
        return result
    if state == "walk":
        return frame
    # Status poses keep Blaze recognizable while adding a small purposeful beat.
    offsets = {"thinking": (0, -1), "coding": (0, 1), "coding_malicious": (1, 0), "stuck": (-1, 0), "success": (0, -2), "error": (-1, 1)}
    x, y = offsets[state]
    result = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    result.alpha_composite(frame, (x + (index % 3 - 1), y + (1 if index % 2 else 0)))
    return result


def closed_eyes(frame: Image.Image) -> Image.Image:
    result = frame.copy()
    draw = ImageDraw.Draw(result)
    # Hide the bright eye interiors before drawing short closed lids on the face.
    # These coordinates are relative to Blaze's normalized 256px cel.
    draw.ellipse((163, 87, 185, 102), fill=(166, 31, 36, 255))
    draw.ellipse((218, 86, 232, 98), fill=(166, 31, 36, 255))
    draw.line((165, 96, 183, 96), fill=(49, 23, 30, 255), width=2)
    draw.line((220, 93, 231, 93), fill=(49, 23, 30, 255), width=2)
    return result


def main():
    rest = fit(ROOT / "blaze-source-rest.png")
    walking = fit(ROOT / "blaze-source-walk.png")
    for state in ("idle", "walk", "thinking", "coding", "coding_malicious", "stuck", "success", "error"):
        strip = Image.new("RGBA", (256 * 11, 256), (0, 0, 0, 0))
        strip.alpha_composite(rest, (0, 0))
        for index in range(1, 10):
            strip.alpha_composite(animate(rest, index, state, walking), (index * 256, 0))
        strip.alpha_composite(rest, (10 * 256, 0))
        strip.save(GENERATED / f"blaze-{state}-frames.png", format="PNG", optimize=True)
    blink = Image.new("RGBA", (256 * 4, 256), (0, 0, 0, 0))
    for index, frame in enumerate((rest, closed_eyes(rest), closed_eyes(rest), rest)):
        blink.alpha_composite(frame, (index * 256, 0))
    blink.save(GENERATED / "blaze-blink-frames.png", format="PNG", optimize=True)
    print("Built Blaze's dedicated 11-cell strips and 4-cell blink from his own rest and walking art.")


if __name__ == "__main__":
    main()
