from __future__ import annotations

import json
import shutil
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "pets" / "generated"
OUT = ROOT / "assets" / "pets" / "motion"

PETS = {
    "percy": "percy",
    "byte": "byte",
    "ember": "ember",
    "blaze": "blaze",
    "nova": "nova",
    "rocky": "rocky",
    "sprout": "sprout",
}

STATE_FILES = {
    "idle": "idle",
    "run": "walk",
    "review": "thinking",
    "running": "coding",
    "waiting": "stuck",
    "waving": "success",
    "jumping": "success",
    "failed": "error",
    "malicious": "coding_malicious",
}

def frame_duration(state: str) -> int:
    return {
        "idle": 220,
        "run": 120,
        "review": 150,
        "running": 130,
        "waiting": 180,
        "waving": 110,
        "jumping": 105,
        "failed": 145,
        "malicious": 125,
        "pounce": 95,
        "fire-breath": 62,
        "fire-impact": 62,
    }[state]

def to_webp(source_path: Path, output_path: Path, duration: int, expected_frames: int | None = None) -> int:
    image = Image.open(source_path).convert("RGBA")
    frame_count = expected_frames or image.width // image.height
    frame_width = image.width // frame_count
    if image.width % frame_count or image.height != frame_width:
        raise ValueError(f"{source_path.name} is not a horizontal square sprite strip")
    frames = [image.crop((index * frame_width, 0, (index + 1) * frame_width, frame_width)) for index in range(frame_count)]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(output_path, "WEBP", save_all=True, append_images=frames[1:], duration=[duration] * len(frames), loop=0, lossless=True, method=6)
    with Image.open(output_path) as encoded:
        return encoded.n_frames

def clip(name: str, file: str, frames: int, duration: int, loop: bool = False) -> dict:
    return {"file": file, "frames": frames, "playbackRate": round(1000 / duration, 3), "loop": loop}

def build_pet(pet_id: str, source_name: str) -> None:
    root = OUT / pet_id
    clips: dict[str, dict] = {}
    animations: dict[str, dict] = {}

    for clip_id, state in STATE_FILES.items():
        source = SOURCE / f"{source_name}-{state}-frames.png"
        if not source.exists():
            raise FileNotFoundError(source)
        file = f"clips/{clip_id}.webp"
        frames = to_webp(source, root / file, frame_duration(clip_id), 11)
        clips[clip_id] = {"file": file, "frames": frames, "playbackRate": 1}

    animations.update({
        "idle": {"play": "loop", "loop": "idle"},
        "running-right": {"play": "loop", "loop": "run"},
        "running-left": {"play": "loop", "loop": "run"},
        "review": {"play": "loop", "loop": "review"},
        "running": {"play": "loop", "loop": "running"},
        "waiting": {"play": "loop", "loop": "waiting"},
        "waving": {"play": "once", "clip": "waving"},
        "jumping": {"play": "once", "clip": "jumping"},
        "failed": {"play": "once", "clip": "failed"},
        "malicious": {"play": "loop", "loop": "malicious"},
    })
    bindings = {
        "idle": [{"animation": "idle"}],
        "movement": {"left": "running-left", "right": "running-right"},
        "contexts": {
            "thinking": [{"animation": "review"}],
            "working": [{"animation": "running"}],
            "editing": [{"animation": "running"}],
            "running": [{"animation": "running"}],
            "testing": [{"animation": "waiting"}],
            "waiting": [{"animation": "waiting"}],
        },
        "events": {
            "waving": [{"animation": "waving"}],
            "success": [{"animation": "jumping"}],
            "error": [{"animation": "failed"}],
            "celebrating": [{"animation": "jumping"}],
        },
    }
    if pet_id == "blaze":
        for activity_id, source_state in (("pounce", "idle"), ("fire-breath", "fire-breath"), ("fire-impact", "fire-impact")):
            source = SOURCE / f"blaze-{source_state}-frames.png"
            file = f"clips/{activity_id}.webp"
            frames = to_webp(source, root / file, frame_duration(activity_id))
            clips[activity_id] = {"file": file, "frames": frames, "playbackRate": 1}
            animations[activity_id] = {"play": "once", "clip": activity_id}

    metadata = {
        "format": "motion",
        "version": 1,
        "id": pet_id,
        "displayName": pet_id.capitalize(),
        "description": f"Skai Motion companion: {pet_id.capitalize()}.",
        "geometry": {"width": 256, "height": 256, "pixelsPerUnit": 2, "footAnchor": {"x": 128, "y": 245}},
        "clips": clips,
        "animations": animations,
        "bindings": bindings,
        "activities": ([
            {"id": "pounce", "displayName": "Pounce", "outfitId": "default", "animation": "pounce"},
            {"id": "fire-breath", "displayName": "Fire breath", "outfitId": "default", "animation": "fire-breath"},
            {"id": "fire-impact", "displayName": "Fire impact", "outfitId": "default", "animation": "fire-impact"},
        ] if pet_id == "blaze" else []),
    }
    root.mkdir(parents=True, exist_ok=True)
    (root / "pet.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")

for pet_id, source_name in PETS.items():
    build_pet(pet_id, source_name)
PUBLIC = ROOT / "apps" / "desktop" / "public" / "pets" / "motion"
if PUBLIC.exists():
    shutil.rmtree(PUBLIC)
shutil.copytree(OUT, PUBLIC)
print(f"Built {len(PETS)} OpenPets Motion packages in {OUT}")
