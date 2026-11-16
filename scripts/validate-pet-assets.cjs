const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "assets", "pets", "generated");
const pets = ["percy", "rocky", "byte", "sprout", "nova", "ember", "blaze"];
const states = ["idle", "walk", "thinking", "coding", "coding_malicious", "stuck", "success", "error"];

function pngDimensions(filePath) {
  const bytes = fs.readFileSync(filePath);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!bytes.subarray(0, 8).equals(signature)) throw new Error(`${filePath} is not a PNG.`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bytes: bytes.length };
}

for (const pet of pets) {
  for (const state of states) {
    const strip = path.join(root, `${pet}-${state}-frames.png`);
    if (!fs.existsSync(strip)) throw new Error(`Missing ${state} strip for ${pet}.`);
    const size = pngDimensions(strip);
    if (size.width !== 2816 || size.height !== 256) throw new Error(`${pet} ${state} strip must be 2816x256 (11 frames); got ${size.width}x${size.height}.`);
    if (size.bytes < 10_000) throw new Error(`${pet} ${state} strip is unexpectedly small.`);
  }
}

for (const pet of pets) {
  const blink = path.join(root, `${pet}-blink-frames.png`);
  if (!fs.existsSync(blink)) throw new Error(`Missing blink strip for ${pet}.`);
  const size = pngDimensions(blink);
  if (size.width !== 1024 || size.height !== 256) throw new Error(`${pet} blink strip must be 1024x256 (4 frames); got ${size.width}x${size.height}.`);
  if (size.bytes < 5_000) throw new Error(`${pet} blink strip is unexpectedly small.`);
}

const pixelValidation = `from PIL import Image, ImageChops
from pathlib import Path
import sys
root = Path(sys.argv[1])
pets = sys.argv[2:]
states = ${JSON.stringify(states)}
for pet in pets:
    idle = Image.open(root / f"{pet}-idle-frames.png").convert("RGBA")
    idle_rest = idle.crop((0, 0, 256, 256))
    for state in states:
        image = Image.open(root / f"{pet}-{state}-frames.png").convert("RGBA")
        alpha = image.getchannel("A").getextrema()
        if alpha[0] == 255 or alpha[1] == 0:
            raise SystemExit(f"{pet} {state} needs visible artwork and transparent pixels")
        rest = image.crop((0, 0, 256, 256))
        seam = image.crop((2560, 0, 2816, 256))
        if ImageChops.difference(rest, seam).getbbox() is not None:
            raise SystemExit(f"{pet} {state} has a broken 0/10 loop seam")
        if ImageChops.difference(rest, idle_rest).getbbox() is not None:
            raise SystemExit(f"{pet} {state} does not start in the idle rest pose")
        frames = [image.crop((index * 256, 0, (index + 1) * 256, 256)) for index in range(11)]
        changed = sum(ImageChops.difference(frames[index - 1], frames[index]).getbbox() is not None for index in range(1, 10))
        if changed < 4:
            raise SystemExit(f"{pet} {state} has too few changing animation frames")
    blink = Image.open(root / f"{pet}-blink-frames.png").convert("RGBA")
    alpha = blink.getchannel("A").getextrema()
    if alpha[0] == 255 or alpha[1] == 0:
        raise SystemExit(f"{pet} blink needs visible artwork and transparent pixels")
    blinks = [blink.crop((index * 256, 0, (index + 1) * 256, 256)) for index in range(4)]
    if not any(ImageChops.difference(blinks[index - 1], blinks[index]).getbbox() is not None for index in range(1, 4)):
        raise SystemExit(f"{pet} blink has no visible eye-state changes")
    idle_bounds = idle_rest.getchannel("A").getbbox()
    for index, frame in enumerate(blinks):
        if frame.getchannel("A").getbbox() != idle_bounds:
            raise SystemExit(f"{pet} blink frame {index} changes the character's visible bounds")
    for index in (0, 3):
        if ImageChops.difference(blinks[index], idle_rest).getbbox() is not None:
            raise SystemExit(f"{pet} blink frame {index} must be an exact copy of idle rest")`;
const uniqueBlazeValidation = `from PIL import Image, ImageChops
from pathlib import Path
import sys
root = Path(sys.argv[1])
blaze = Image.open(root / 'blaze-idle-frames.png').convert('RGBA').crop((0, 0, 256, 256))
ember = Image.open(root / 'ember-idle-frames.png').convert('RGBA').crop((0, 0, 256, 256))
if ImageChops.difference(blaze, ember).getbbox() is None:
    raise SystemExit('Blaze must ship with his own distinct art, not an Ember recolor')`;
try {
  execFileSync("python", ["-c", pixelValidation, root, ...pets], { stdio: "pipe" });
  execFileSync("python", ["-c", uniqueBlazeValidation, root], { stdio: "pipe" });
} catch (error) {
  const details = error && typeof error === "object" && "stderr" in error && Buffer.isBuffer(error.stderr) ? error.stderr.toString().trim() : "";
  throw new Error(details || "Built-in pet pixel validation failed (requires Python Pillow).");
}

console.log(`Pet assets passed: ${pets.length * states.length} eleven-frame state strips, exact rest-pose seams, visible movement, and ${pets.length} transparent four-frame blink strips.`);
