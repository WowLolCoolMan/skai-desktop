// Generated theme files: the built-in "Skai" family (dark + light) is built
// from tokens.css and docs/theme.schema.json from the validator's key lists,
// so neither drifts. scripts/test-theme-files.cjs fails when either is stale;
// run `node scripts/theme-generate.cjs --write` to regenerate both.
const fs = require("node:fs");
const path = require("node:path");
const { COLOR_KEYS, tokenForColorKey, parseColor, buildSchema } = require("../apps/desktop/electron/theme-files.cjs");

const root = path.resolve(__dirname, "..");
const tokensPath = path.join(root, "apps", "desktop", "src", "design-system", "tokens.css");
const presetPath = path.join(root, "apps", "desktop", "src", "theme", "presets", "skai.json");
const schemaPath = path.join(root, "docs", "theme.schema.json");

function block(css, selector) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`${selector} block not found in tokens.css`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("\n}", start));
  return Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

function buildSkaiFamily() {
  const css = fs.readFileSync(tokensPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const dark = block(css, ":root");
  const light = { ...dark, ...block(css, '[data-scheme="light"]') };
  const colors = (tokens) => Object.fromEntries(COLOR_KEYS.map((key) => [key, parseColor(tokens[tokenForColorKey(key)] ?? "")]).filter(([, value]) => value));
  return {
    $schema: "../../../../../docs/theme.schema.json",
    name: "Skai",
    author: "Skai Desktop",
    license: "Original Skai Desktop theme (same license as the app)",
    themes: [
      { name: "Skai Dark", appearance: "dark", colors: colors(dark) },
      { name: "Skai Light", appearance: "light", colors: colors(light) },
    ],
  };
}

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;
if (require.main === module && process.argv.includes("--write")) {
  fs.writeFileSync(presetPath, serialize(buildSkaiFamily()));
  fs.writeFileSync(schemaPath, serialize(buildSchema()));
  console.log(`Wrote ${path.relative(root, presetPath)} and ${path.relative(root, schemaPath)}`);
}
module.exports = { buildSkaiFamily, buildSchema, serialize, presetPath, schemaPath };
