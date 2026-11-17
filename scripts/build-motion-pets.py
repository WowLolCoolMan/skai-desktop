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
        "fire-breath": 100,
        "fire-impact": 62,
        "curious-scan": 150,
        "ember-curl": 110,
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
        generated_sources = {
            "ember": {
                "idle": "ember-idle",
                "run": "ember-run",
                "review": "ember-curious",
                "running": "ember-working",
                "waiting": "ember-waiting",
                "waving": "ember-wave",
                "jumping": "ember-curl",
                "failed": "ember-failed",
                "malicious": "ember-alert",
            },
            "percy": {
                "idle": "percy-idle",
                "run": "percy-run",
                "review": "percy-thinking",
                "running": "percy-working",
                "waiting": "percy-waiting",
                "waving": "percy-wave",
                "jumping": "percy-celebrate",
                "failed": "percy-failed",
                "malicious": "percy-alert",
            },
            "byte": {
                "idle": "byte-idle",
                "run": "byte-run",
                "review": "byte-thinking",
                "running": "byte-working",
                "waiting": "byte-waiting",
                "waving": "byte-wave",
                "jumping": "byte-celebrate",
                "failed": "byte-failed",
                "malicious": "byte-alert",
            },
            "blaze": {
                "idle": "blaze-idle",
                "run": "blaze-run",
                "review": "blaze-review",
                "running": "blaze-running",
                "waiting": "blaze-waiting",
                "waving": "blaze-waving",
                "jumping": "blaze-jumping",
                "failed": "blaze-failed",
                "malicious": "blaze-malicious",
            },
            "nova": {
                "idle": "nova-idle", "run": "nova-run", "review": "nova-thinking",
                "running": "nova-working", "waiting": "nova-waiting", "waving": "nova-wave",
                "jumping": "nova-celebrate", "failed": "nova-failed", "malicious": "nova-alert",
            },
            "rocky": {
                "idle": "rocky-idle", "run": "rocky-run", "review": "rocky-thinking",
                "running": "rocky-working", "waiting": "rocky-waiting", "waving": "rocky-wave",
                "jumping": "rocky-celebrate", "failed": "rocky-failed", "malicious": "rocky-alert",
            },
            "sprout": {
                "idle": "sprout-idle", "run": "sprout-run", "review": "sprout-thinking",
                "running": "sprout-working", "waiting": "sprout-waiting", "waving": "sprout-wave",
                "jumping": "sprout-celebrate", "failed": "sprout-failed", "malicious": "sprout-alert",
            },
        }
        generated = generated_sources.get(pet_id, {}).get(clip_id)
        if generated:
            source_dir = ROOT / ".tmp" / f"{generated}-frames-v2"
            file = f"clips/{clip_id}.webp"
            paths = sorted(source_dir.glob("frame_*.png"))
            if len(paths) != 8: raise ValueError(f"Expected 8 generated frames in {source_dir}")
            frames = [Image.open(path).convert("RGBA") for path in paths]
            root.joinpath(file).parent.mkdir(parents=True, exist_ok=True)
            frames[0].save(root / file, "WEBP", save_all=True, append_images=frames[1:], duration=[frame_duration(clip_id)] * len(frames), loop=0, lossless=True, method=6)
            for frame in frames: frame.close()
            with Image.open(root / file) as encoded: count = encoded.n_frames
            clips[clip_id] = {"file": file, "frames": count, "playbackRate": 1}
            continue
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
        for activity_id, source_state in (("pounce", "pounce"), ("fire-breath", "fire-breath"), ("fire-impact", "fire-impact")):
            source = SOURCE / f"blaze-{source_state}-frames.png"
            file = f"clips/{activity_id}.webp"
            generated_dir = ROOT / ".tmp" / f"blaze-{activity_id}-frames-v2"
            generated_paths = sorted(generated_dir.glob("frame_*.png"))
            if len(generated_paths) == 8:
                generated_frames = [Image.open(path).convert("RGBA") for path in generated_paths]
                output = root / file
                output.parent.mkdir(parents=True, exist_ok=True)
                generated_frames[0].save(output, "WEBP", save_all=True, append_images=generated_frames[1:], duration=[frame_duration(activity_id)] * len(generated_frames), loop=0, lossless=True, method=6)
                for frame in generated_frames:
                    frame.close()
                with Image.open(output) as encoded:
                    frames = encoded.n_frames
            else:
                frames = to_webp(source, root / file, frame_duration(activity_id), 11)
            clips[activity_id] = {"file": file, "frames": frames, "playbackRate": 1}
            animations[activity_id] = {"play": "once", "clip": activity_id}

    if pet_id == "ember":
        clips["curious-scan"] = {"file": "clips/review.webp", "frames": clips["review"]["frames"], "playbackRate": 1}
        clips["ember-curl"] = {"file": "clips/jumping.webp", "frames": clips["jumping"]["frames"], "playbackRate": 1}
        fire_breath_frames = [Image.open(path).convert("RGBA") for path in sorted((ROOT / ".tmp" / "ember-firebreath-frames-v2").glob("frame_*.png"))]
        if len(fire_breath_frames) != 8:
            raise ValueError("Expected eight Ember fire-breath frames")
        fire_breath_file = root / "clips" / "fire-breath.webp"
        fire_breath_file.parent.mkdir(parents=True, exist_ok=True)
        fire_breath_frames[0].save(fire_breath_file, "WEBP", save_all=True, append_images=fire_breath_frames[1:], duration=[frame_duration("fire-breath")] * len(fire_breath_frames), loop=0, lossless=True, method=6)
        for frame in fire_breath_frames:
            frame.close()
        with Image.open(fire_breath_file) as encoded:
            fire_breath_count = encoded.n_frames
        clips["fire-breath"] = {"file": "clips/fire-breath.webp", "frames": fire_breath_count, "playbackRate": 1}
        animations.update({
            "curious-scan": {"play": "loop", "loop": "review"},
            "ember-curl": {"play": "once", "clip": "jumping"},
            "fire-breath": {"play": "once", "clip": "fire-breath"},
        })
        bindings["events"]["curious-scan"] = [{"animation": "curious-scan"}]
        bindings["events"]["fire-breath"] = [{"animation": "fire-breath"}]
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
        ] if pet_id == "blaze" else ([
            {"id": "ember-curl", "displayName": "Ember curl", "outfitId": "default", "animation": "ember-curl"},
            {"id": "fire-breath", "displayName": "Fire breath", "outfitId": "default", "animation": "fire-breath"},
        ] if pet_id == "ember" else [])),
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
