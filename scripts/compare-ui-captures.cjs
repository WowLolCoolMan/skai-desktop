// Blend two same-size UI captures so moved edges, clipped copy, and density drift
// remain visible in one review image.
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

async function main() {
  const [beforePath, afterPath, outputPath] = process.argv.slice(2).map((value) => path.resolve(value));
  if (!beforePath || !afterPath || !outputPath) throw new Error("Usage: node scripts/compare-ui-captures.cjs <before.png> <after.png> <overlay.png>");
  const [before, after] = await Promise.all([sharp(beforePath).metadata(), sharp(afterPath).metadata()]);
  if (before.width !== after.width || before.height !== after.height) throw new Error(`Captures must use the same viewport: before=${before.width}x${before.height}; after=${after.width}x${after.height}`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await sharp(beforePath).composite([{ input: await sharp(afterPath).png().toBuffer(), blend: "over", opacity: 0.5 }]).png().toFile(outputPath);
  console.log(JSON.stringify({ before: beforePath, after: afterPath, output: outputPath, width: before.width, height: before.height, mode: "50/50 overlay" }));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
