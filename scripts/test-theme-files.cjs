// Theme file tests: the validator rejects anything that could inject CSS or
// load remote content, keeps good values, and every shipped preset is valid,
// in sync with tokens.css (Skai) and maps only to tokens that exist.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const themes = require("../apps/desktop/electron/theme-files.cjs");
const { buildSkaiFamily, buildSchema, serialize, presetPath, schemaPath } = require("./theme-generate.cjs");

const root = path.resolve(__dirname, "..");
let passed = 0;
const test = (name, fn) => { fn(); passed += 1; void name; };
const family = (theme) => ({ name: "Test", themes: [{ name: "T", appearance: "dark", ...theme }] });

test("colors: accepted shapes", () => {
  for (const ok of ["#abc", "#abcd", "#aabbcc", "#aabbcc80", "rgb(1, 2, 3)", "rgba(1,2,3,.5)", "rgb(10% 20% 30% / 0.4)", "hsl(120deg, 50%, 40%)", "hsla(200 30% 20% / 0.2)", "transparent"]) assert.ok(themes.parseColor(ok), ok);
});

test("colors: injection and junk rejected", () => {
  for (const bad of ["red", "#ggg", "url(https://example.com/x.png)", "#fff; background: url(x)", "rgb(1,2,3) url(x)", "expression(alert(1))", "var(--skai-color-text)", "color-mix(in srgb, red, blue)", "@import 'x'", "rgb(300,0,0)", "rgb(1,2)", "hsl(1, 2, 3)", "", "#fff /* */", "rgb(1,2,3,4,5)", 42, null, {}, "a".repeat(80)]) assert.equal(themes.parseColor(bad), null, String(bad));
});

test("unknown keys and bad values are dropped with a problem, good ones kept", () => {
  const { family: result, problems } = themes.validateThemeFamily(family({ colors: { canvas: "#101010", bogus: "#fff", text: "url(x)" } }), "t.json");
  assert.deepEqual(result.themes[0].colors, { "--skai-color-canvas": "#101010" });
  assert.equal(problems.length, 2);
  assert.ok(problems.every((p) => p.file === "t.json" && p.key && p.problem));
});

test("token mapping keeps ansi/syntax prefixes", () => {
  assert.equal(themes.tokenForColorKey("ansi-red"), "--skai-ansi-red");
  assert.equal(themes.tokenForColorKey("syntax-string"), "--skai-syntax-string");
  assert.equal(themes.tokenForColorKey("canvas"), "--skai-color-canvas");
});

test("structure: bad roots and themes rejected", () => {
  assert.equal(themes.validateThemeFamily([], "x").family, null);
  assert.equal(themes.validateThemeFamily({ name: "x" }, "x").family, null);
  assert.equal(themes.validateThemeFamily({ name: "x", themes: [{ name: "a", appearance: "sepia" }] }, "x").family, null);
  const dup = themes.validateThemeFamily({ name: "x", themes: [{ name: "a", appearance: "dark" }, { name: "A", appearance: "light" }] }, "x");
  assert.equal(dup.family.themes.length, 1);
});

test("file caps and JSON errors", () => {
  assert.equal(themes.parseThemeFile("{", "f").family, null);
  assert.equal(themes.parseThemeFile(" ".repeat(themes.MAX_FILE_BYTES + 1), "f").family, null);
  assert.ok(themes.parseThemeFile(JSON.stringify(family({})), "f").family);
});

test("gradients: built from validated stops only", () => {
  const ok = themes.parseGradient({ gradient: "linear", angle: 135, stops: [{ color: "#1e1e2e", at: 1 }, { color: "#313244", at: 0 }] });
  assert.deepEqual(ok, { gradient: "linear", angle: 135, stops: [{ color: "#313244", at: 0 }, { color: "#1e1e2e", at: 1 }] });
  assert.deepEqual(themes.parseGradient("#123456"), { gradient: "solid", color: "#123456" });
  for (const bad of [{ gradient: "linear", stops: [{ color: "#fff", at: 0 }] }, { gradient: "repeating-linear", stops: [] }, { gradient: "linear", angle: 400, stops: [{ color: "#fff", at: 0 }, { color: "#000", at: 1 }] }, { gradient: "linear", stops: [{ color: "url(x)", at: 0 }, { color: "#000", at: 1 }] }, { gradient: "radial", stops: [{ color: "#fff", at: -1 }, { color: "#000", at: 1 }] }, "linear-gradient(red, blue)"]) assert.equal(themes.parseGradient(bad), null, JSON.stringify(bad));
  const { problems } = themes.validateThemeFamily(family({ gradients: { "not-a-surface": "#fff" } }), "g");
  assert.equal(problems.length, 1);
});

test("fonts: plain names and ranged numbers only", () => {
  assert.deepEqual(themes.parseFont({ family: "IBM Plex Sans, Inter", size: 14, weight: 500, lineHeight: 1.5, letterSpacing: 0 }), { family: ["IBM Plex Sans", "Inter"], size: 14, weight: 500, lineHeight: 1.5, letterSpacing: 0 });
  for (const bad of [{ family: "x; background: url(y)" }, { family: "'Quoted'" }, { family: "a,b,c,d,e" }, { size: 100 }, { weight: 50 }, { family: "url(x)" }, {}]) assert.equal(themes.parseFont(bad), null, JSON.stringify(bad));
});

test("every color key maps to a token defined in tokens.css", () => {
  const css = fs.readFileSync(path.join(root, "apps/desktop/src/design-system/tokens.css"), "utf8");
  for (const key of themes.COLOR_KEYS) assert.ok(css.includes(`${themes.tokenForColorKey(key)}:`), `${key} → ${themes.tokenForColorKey(key)} is not defined in tokens.css`);
});

test("skai.json is in sync with tokens.css", () => {
  assert.equal(fs.readFileSync(presetPath, "utf8"), serialize(buildSkaiFamily()), "skai.json is stale: run node scripts/theme-generate.cjs --write");
});

test("docs/theme.schema.json is in sync with the validator", () => {
  assert.equal(fs.readFileSync(schemaPath, "utf8"), serialize(buildSchema()), "theme.schema.json is stale: run node scripts/theme-generate.cjs --write");
});

test("every shipped preset is valid with no problems and has a license", () => {
  const dir = path.dirname(presetPath);
  const files = fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
  assert.ok(files.length >= 1);
  for (const file of files) {
    const { family: result, problems } = themes.parseThemeFile(fs.readFileSync(path.join(dir, file), "utf8"), file);
    assert.ok(result, `${file} was rejected`);
    assert.deepEqual(problems, [], `${file} has problems: ${JSON.stringify(problems)}`);
    assert.ok(result.license, `${file} needs a license`);
  }
});

console.log(`Theme file tests passed: ${passed} groups.`);
