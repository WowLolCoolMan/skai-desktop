"""Normalize generated Blaze effects into transparent eight-cel sprite strips."""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).parent
SOURCE = ROOT / "source"
GENERATED = ROOT / "generated"
FRAME_COUNT = 8
CELL_SIZE = 256


def build_strip(source_name: str, output_name: str) -> None:
    with Image.open(SOURCE / source_name) as opened:
        source = opened.convert("RGBA")
    if source.width < FRAME_COUNT or source.height < CELL_SIZE:
        raise ValueError(f"{source_name} is too small to contain eight effect cels")

    strip = Image.new("RGBA", (CELL_SIZE * FRAME_COUNT, CELL_SIZE), (0, 0, 0, 0))
    crop_top = (source.height - CELL_SIZE) // 2
    for index in range(FRAME_COUNT):
        left = round(index * source.width / FRAME_COUNT)
        right = round((index + 1) * source.width / FRAME_COUNT)
        cel = source.crop((left, crop_top, right, crop_top + CELL_SIZE))
        if cel.getchannel("A").getbbox() is None:
            raise ValueError(f"{source_name} cel {index} is empty")
        cel = cel.resize((CELL_SIZE, CELL_SIZE), Image.Resampling.LANCZOS)
        strip.alpha_composite(cel, (index * CELL_SIZE, 0))

    output_path = GENERATED / output_name
    strip.save(output_path, format="PNG", optimize=True)
    with Image.open(output_path) as check:
        if check.size != (CELL_SIZE * FRAME_COUNT, CELL_SIZE):
            raise ValueError(f"{output_name} did not normalize to eight 256px cels")
        if check.getchannel("A").getextrema() == (255, 255):
            raise ValueError(f"{output_name} must retain transparency")


def main() -> None:
    GENERATED.mkdir(parents=True, exist_ok=True)
    build_strip("blaze-fire-breath-sheet.png", "blaze-fire-breath-frames.png")
    build_strip("blaze-fire-impact-sheet.png", "blaze-fire-impact-frames.png")
    print("Built transparent eight-frame Blaze flame and impact strips at 256px per cel.")


if __name__ == "__main__":
    main()
