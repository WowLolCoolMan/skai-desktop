// Theme token audit: components must take colors from --skai-* tokens, never
// literals, so every theme (built-in or a user's theme file) can restyle them.
// Color literals are allowed only in apps/desktop/src/design-system/tokens.css
// and in theme files (apps/desktop/src/theme/presets/). The rest is a ratchet:
// scripts/theme-token-baseline.json records the literals still left (pet art,
// backdrop art, the pixel editor's paint colors); a file may go down, never up.
// Run with --update to lower the baseline after a migration.
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const srcRoot = path.join(root, "apps", "desktop", "src");
const baselinePath = path.join(__dirname, "theme-token-baseline.json");
const allowed = [/^apps\/desktop\/src\/design-system\/tokens\.css$/, /^apps\/desktop\/src\/theme\/presets\//];
const literal = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/g;

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(full) : /\.(css|ts|tsx)$/.test(entry.name) ? [full] : [];
});

function countLiterals(file) {
  let text = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  // In TS/TSX, ignore // comments.
  if (!file.endsWith(".css")) text = text.replace(/(^|[^:])\/\/.*$/gm, "$1");
  return (text.match(literal) || []).length;
}

const counts = {};
for (const file of walk(srcRoot)) {
  const relative = path.relative(root, file).replaceAll("\\", "/");
  if (allowed.some((pattern) => pattern.test(relative))) continue;
  const count = countLiterals(file);
  if (count) counts[relative] = count;
}

if (process.argv.includes("--update")) {
  fs.writeFileSync(baselinePath, `${JSON.stringify(Object.fromEntries(Object.entries(counts).sort()), null, 2)}\n`);
  console.log(`Theme token baseline updated: ${Object.values(counts).reduce((a, b) => a + b, 0)} literals in ${Object.keys(counts).length} files.`);
  process.exit(0);
}

const baseline = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, "utf8")) : {};
const failures = [];
for (const [file, count] of Object.entries(counts)) {
  const limit = baseline[file] ?? 0;
  if (count > limit) failures.push(`${file}: ${count} color literals (allowed ${limit}). Use a --skai-* token (add it to tokens.css in both palettes) or color-mix() on one.`);
}
if (failures.length) {
  console.error("Theme token audit failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
const total = Object.values(counts).reduce((a, b) => a + b, 0);
const stale = Object.entries(baseline).filter(([file, limit]) => (counts[file] ?? 0) < limit).map(([file]) => file);
console.log(`Theme token audit passed: ${total} color literals left outside tokens (baseline ${Object.values(baseline).reduce((a, b) => a + b, 0)}).${stale.length ? ` Lower the baseline with --update: ${stale.join(", ")}.` : ""}`);
