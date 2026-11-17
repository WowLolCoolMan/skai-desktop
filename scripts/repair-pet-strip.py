from __future__ import annotations

import argparse
from pathlib import Path
from PIL import Image


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract and ground-align an eight-cell pet strip.")
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--frames", type=int, default=8)
    parser.add_argument("--size", type=int, default=256)
    # Motion packages use a footAnchor at y=245 in a 256px logical canvas.
    parser.add_argument("--margin", type=int, default=11)
    parser.add_argument("--sheet-output", type=Path, help="also save the aligned frames as one horizontal PNG strip")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    with Image.open(args.source) as image:
        src = image.convert("RGBA")
    frames = []
    max_width = 0
    max_height = 0
    for index in range(args.frames):
        x0, x1 = round(index * src.width / args.frames), round((index + 1) * src.width / args.frames)
        frame = src.crop((x0, 0, x1, src.height))
        alpha = frame.getchannel("A")
        bbox = alpha.point(lambda a: 255 if a >= 24 else 0).getbbox()
        if not bbox:
            raise SystemExit(f"Frame {index} is empty")
        subject = frame.crop(bbox)
        frames.append(subject)
        max_width = max(max_width, subject.width)
        max_height = max(max_height, subject.height)

    # Apply one scale to the entire strip. Per-frame scaling makes characters
    # subtly grow and shrink while playing, even when the source poses are stable.
    max_w = args.size - 2 * args.margin
    max_h = args.size - 2 * args.margin
    scale = min(max_w / max_width, max_h / max_height)
    for index, subject in enumerate(frames):
        subject = subject.resize((round(subject.width * scale), round(subject.height * scale)), Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", (args.size, args.size))
        canvas.alpha_composite(subject, ((args.size - subject.width) // 2, args.size - args.margin - subject.height))
        canvas.save(args.output / f"frame_{index:03}.png")
    if args.sheet_output:
        strip = Image.new("RGBA", (args.size * args.frames, args.size))
        for index in range(args.frames):
            with Image.open(args.output / f"frame_{index:03}.png") as frame:
                strip.alpha_composite(frame.convert("RGBA"), (index * args.size, 0))
        args.sheet_output.parent.mkdir(parents=True, exist_ok=True)
        strip.save(args.sheet_output)
    print(f"Extracted {args.frames} frames into {args.output}")


if __name__ == "__main__":
    main()
