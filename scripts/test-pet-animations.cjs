#!/usr/bin/env node
// Pet animation asset smoke: every built-in companion must be able to play every state the main
// process can send. For each Motion manifest it checks that the animations the pet window requests
// resolve to clips, that each clip is a decodable WebP strip whose width is frames × frame width, and
// that every fallback strip the pet window references exists. Run by npm run test:pet.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const motionRoot = path.join(root, "assets", "pets", "motion");
const petWindow = fs.readFileSync(path.join(root, "apps", "desktop", "src", "components", "overlays", "PetWindow.tsx"), "utf8");
const mainSource = fs.readFileSync(path.join(root, "apps", "desktop", "electron", "main.cjs"), "utf8");

/** Width and height of a WebP image (VP8X, VP8L, or lossy VP8). */
function webpSize(file) {
  const data = fs.readFileSync(file);
  assert.equal(data.toString("ascii", 0, 4), "RIFF", `${file} is not a RIFF container`);
  assert.equal(data.toString("ascii", 8, 12), "WEBP", `${file} is not a WebP image`);
  const chunk = data.toString("ascii", 12, 16);
  if (chunk === "VP8X") {
    // Animated WebP: one canvas, one ANMF chunk per frame.
    let frames = 0;
    for (let offset = 12; offset + 8 <= data.length;) {
      const id = data.toString("ascii", offset, offset + 4);
      const size = data.readUInt32LE(offset + 4);
      if (id === "ANMF") frames += 1;
      offset += 8 + size + (size % 2);
    }
    return { width: 1 + data.readUIntLE(24, 3), height: 1 + data.readUIntLE(27, 3), animated: Boolean(data[20] & 0x02), frames };
  }
  if (chunk === "VP8L") {
    const bits = data.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, animated: false };
  }
  if (chunk === "VP8 ") return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff, animated: false };
  throw new Error(`${file}: unsupported WebP chunk ${chunk}`);
}

// Every state the main process may send (setPetActivity's allow-list) …
const allowed = /const allowedStates = new Set\(\[([^\]]+)\]\)/.exec(mainSource);
assert.ok(allowed, "main.cjs no longer declares the pet activity allow-list");
const states = [...allowed[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]).concat(["success", "error"]);
// … and the Motion animation the pet window asks for in each state.
const mapping = /const motionAnimationId = [^;]*?\(\{([^}]+)\}\s*as Record/.exec(petWindow);
assert.ok(mapping, "PetWindow.tsx no longer maps pet states to Motion animations");
const animationForState = Object.fromEntries([...mapping[1].matchAll(/"?([\w-]+)"?:\s*"([\w-]+)"/g)].map((match) => [match[1], match[2]]));
const requiredAnimations = new Set(["running-left", "running-right"]);
for (const state of states) {
  if (state === "walk") continue;
  assert.ok(animationForState[state], `PetWindow.tsx has no Motion animation for state "${state}"`);
  requiredAnimations.add(animationForState[state]);
}

const pets = fs.readdirSync(motionRoot).filter((entry) => fs.existsSync(path.join(motionRoot, entry, "pet.json"))).sort();
assert.deepEqual(pets, ["blaze", "byte", "ember", "nova", "percy", "rocky", "sprout"], "built-in Motion pets changed; update this smoke");
const attackAnimations = ["pounce", "fire-breath"];
let clipCount = 0;
const missingByPet = {};
for (const pet of pets) {
  const manifest = JSON.parse(fs.readFileSync(path.join(motionRoot, pet, "pet.json"), "utf8"));
  assert.equal(manifest.format, "motion", `${pet}: manifest format`);
  assert.equal(manifest.id, pet, `${pet}: manifest id`);
  const { width, height } = manifest.geometry;
  for (const [id, clip] of Object.entries(manifest.clips)) {
    const file = path.join(motionRoot, pet, clip.file);
    assert.ok(fs.existsSync(file), `${pet}: clip "${id}" file ${clip.file} is missing`);
    assert.ok(Number.isInteger(clip.frames) && clip.frames >= 1 && clip.frames <= 64, `${pet}: clip "${id}" frame count ${clip.frames}`);
    const size = webpSize(file);
    assert.equal(size.height, height, `${pet}: clip "${id}" is ${size.height}px tall, expected ${height}`);
    if (size.animated) {
      assert.equal(size.width, width, `${pet}: animated clip "${id}" canvas is ${size.width}px wide, expected ${width}`);
      assert.equal(size.frames, clip.frames, `${pet}: clip "${id}" holds ${size.frames} frames, manifest says ${clip.frames}`);
    } else assert.equal(size.width, width * clip.frames, `${pet}: strip clip "${id}" is ${size.width}px wide, expected ${clip.frames} × ${width}`);
    clipCount += 1;
  }
  for (const [id, animation] of Object.entries(manifest.animations)) {
    for (const clip of [animation.intro, animation.loop, animation.clip, animation.outro].filter(Boolean))
      assert.ok(manifest.clips[clip], `${pet}: animation "${id}" uses missing clip "${clip}"`);
  }
  const missing = [...requiredAnimations].filter((id) => !manifest.animations[id]);
  // Attacks are Blaze's (and Ember's fire breath); other companions never receive those states.
  const unexpected = missing.filter((id) => !attackAnimations.includes(id));
  assert.deepEqual(unexpected, [], `${pet}: missing Motion animations ${unexpected.join(", ")}`);
  missingByPet[pet] = missing;
}
assert.deepEqual(missingByPet.blaze, [], "Blaze, the cursor attacker, must have every attack animation");
for (const id of ["fire-impact", "pounce", "fire-breath"]) assert.ok(JSON.parse(fs.readFileSync(path.join(motionRoot, "blaze", "pet.json"), "utf8")).animations[id], `Blaze lacks "${id}"`);

// Fallback strips (used when a Motion manifest cannot load) must all exist.
const strips = [...petWindow.matchAll(/new URL\("(\.\.\/[^"]+\.(?:png|webp))", import\.meta\.url\)/g)].map((match) => path.resolve(path.dirname(path.join(root, "apps/desktop/src/components/overlays/PetWindow.tsx")), match[1]));
const missingStrips = strips.filter((file) => !fs.existsSync(file)).map((file) => path.relative(root, file));
assert.deepEqual(missingStrips, [], `PetWindow.tsx references missing fallback strips`);

console.log(`Pet animation checks passed: ${pets.length} companions, ${clipCount} clips, ${requiredAnimations.size} state animations, ${strips.length} fallback strips.`);
