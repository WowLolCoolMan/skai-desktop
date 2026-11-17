from __future__ import annotations

import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / "assets" / "pets" / "motion"
PET_IDS = ["percy", "byte", "ember", "blaze", "nova", "rocky", "sprout"]
required_animations = {"idle", "running-right", "running-left", "review", "running", "waiting", "waving", "jumping", "failed"}

checked = 0
for pet_id in PET_IDS:
    root = ROOT / pet_id
    manifest = json.loads((root / "pet.json").read_text(encoding="utf-8"))
    assert manifest["format"] == "motion" and manifest["version"] == 1
    assert manifest["id"] == pet_id
    assert set(manifest["animations"]) >= required_animations
    assert manifest["bindings"]["movement"] == {"left": "running-left", "right": "running-right"}
    assert manifest["geometry"]["footAnchor"]["y"] == 245
    for clip_id, clip in manifest["clips"].items():
        path = root / clip["file"]
        assert path.exists(), path
        with Image.open(path) as image:
            assert image.format == "WEBP"
            assert image.n_frames == clip["frames"], (pet_id, clip_id, image.n_frames, clip["frames"])
            assert image.size == (256, 256), (pet_id, clip_id, image.size)
            assert image.mode in ("RGBA", "LA"), (pet_id, clip_id, image.mode)
        checked += 1
    if pet_id == "blaze":
        assert {item["id"] for item in manifest["activities"]} >= {"pounce", "fire-breath", "fire-impact"}

print(f"Motion pet assets passed: {len(PET_IDS)} packages, {checked} animated WebP clips, directional bindings, alpha, geometry, and Blaze activities.")
