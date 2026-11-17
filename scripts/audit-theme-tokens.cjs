// Theme token audit: components must take colors, font sizes and corner radii
// from --skai-* tokens, never literals, so every theme (built-in or a user's
// theme file) and the text-size / corner-style settings can restyle them.
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
const kinds = {
  colors: /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/g,
  // px only in CSS: font-size and border-radius must use --skai-text-* / --skai-radius-*.
  fontSizes: /font-size:\s*[\d.]+px/g,
  radii: /border(?:-[a-z]+)*-radius:[^;}]*\d+px/g,
  // Components never build gradients inline (TS/TSX): surfaces use the --skai-bg-* gradient
  // tokens that src/theme/gradients.ts builds from validated theme stops.
  inlineGradients: /\b(?:repeating-)?(?:linear|radial|conic)-gradient\(/g,
};
const kindApplies = (kind, file) => (kind === "inlineGradients" ? /\.tsx?$/.test(file) && !file.replaceAll("\\", "/").endsWith("src/theme/gradients.ts") : kind === "colors" || file.endsWith(".css"));

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(full) : /\.(css|ts|tsx)$/.test(entry.name) ? [full] : [];
});

// Remove comments but never text inside strings ("./presets/*.json" is not a comment).
function stripComments(text, lineComments) {
  let out = "";
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      out += char;
      if (char === "\\") { out += text[i + 1] ?? ""; i += 1; } else if (char === quote) quote = null;
      continue;
    }
    if (char === "/" && text[i + 1] === "*") { const end = text.indexOf("*/", i + 2); i = end < 0 ? text.length : end + 1; continue; }
    if (lineComments && char === "/" && text[i + 1] === "/") { const end = text.indexOf("\n", i); i = end < 0 ? text.length : end - 1; continue; }
    if (char === "\"" || char === "'" || char === "`") quote = char;
    out += char;
  }
  return out;
}

function countLiterals(file) {
  const text = stripComments(fs.readFileSync(file, "utf8"), !file.endsWith(".css"));
  const counts = {};
  for (const [kind, pattern] of Object.entries(kinds)) {
    if (!kindApplies(kind, file)) continue;
    const count = (text.match(pattern) || []).length;
    if (count) counts[kind] = count;
  }
  return counts;
}
const sum = (record) => Object.values(record).reduce((total, counts) => total + Object.values(counts).reduce((a, b) => a + b, 0), 0);

const counts = {};
for (const file of walk(srcRoot)) {
  const relative = path.relative(root, file).replaceAll("\\", "/");
  if (allowed.some((pattern) => pattern.test(relative))) continue;
  const found = countLiterals(file);
  if (Object.keys(found).length) counts[relative] = found;
}

if (process.argv.includes("--update")) {
  fs.writeFileSync(baselinePath, `${JSON.stringify(Object.fromEntries(Object.entries(counts).sort()), null, 2)}\n`);
  console.log(`Theme token baseline updated: ${sum(counts)} literals in ${Object.keys(counts).length} files.`);
  process.exit(0);
}

const baseline = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, "utf8")) : {};
const failures = [];
const advice = {
  colors: "Use a --skai-color-* token (add it to tokens.css in both palettes) or color-mix() on one.",
  fontSizes: "Use a --skai-text-* step.",
  radii: "Use a --skai-radius-* step.",
  inlineGradients: "Use a --skai-bg-* gradient token (theme gradients are built in src/theme/gradients.ts).",
};
for (const [file, found] of Object.entries(counts)) {
  for (const [kind, count] of Object.entries(found)) {
    const limit = baseline[file]?.[kind] ?? 0;
    if (count > limit) failures.push(`${file}: ${count} hard-coded ${kind} (allowed ${limit}). ${advice[kind]}`);
  }
}
if (failures.length) {
  console.error("Theme token audit failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
const stale = Object.entries(baseline).filter(([file, limits]) => Object.entries(limits).some(([kind, limit]) => (counts[file]?.[kind] ?? 0) < limit)).map(([file]) => file);
console.log(`Theme token audit passed: ${sum(counts)} hard-coded values left outside tokens (baseline ${sum(baseline)}).${stale.length ? ` Lower the baseline with --update: ${stale.join(", ")}.` : ""}`);
