const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "assets", "pets", "generated");
const pets = ["percy", "rocky", "byte", "sprout", "nova", "ember"];
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
    if (size.width !== 1536 || size.height !== 256) throw new Error(`${pet} ${state} strip must be 1536x256; got ${size.width}x${size.height}.`);
    if (size.bytes < 10_000) throw new Error(`${pet} ${state} strip is unexpectedly small.`);
  }
}

console.log(`Pet assets passed: ${pets.length * states.length} independent six-frame strips, fixed 256px cells.`);
