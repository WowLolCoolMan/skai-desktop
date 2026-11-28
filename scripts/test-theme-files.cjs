// Theme file tests: the validator rejects anything that could inject CSS or
// load remote content, keeps good values, and every shipped preset is valid,
// in sync with tokens.css (Skai) and maps only to tokens that exist.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const themes = require("../apps/desktop/electron/theme-files.cjs");
const os = require("node:os");
const { base16ToFamily, parseScheme } = require("../apps/desktop/electron/theme-base16.cjs");
const { createThemeService } = require("../apps/desktop/electron/theme-service.cjs");
const fontsModule = require("../apps/desktop/electron/theme-fonts.cjs");
const { buildSkaiFamily, buildSchema, serialize, presetPath, schemaPath } = require("./theme-generate.cjs");
const community = require("./theme-community.cjs");

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
  assert.equal(fs.readFileSync(presetPath, "utf8").replace(/\r\n/g, "\n"), serialize(buildSkaiFamily()), "skai.json is stale: run node scripts/theme-generate.cjs --write");
});

test("docs/theme.schema.json is in sync with the validator", () => {
  assert.equal(fs.readFileSync(schemaPath, "utf8").replace(/\r\n/g, "\n"), serialize(buildSchema()), "theme.schema.json is stale: run node scripts/theme-generate.cjs --write");
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

const base16 = (extra = "") => [
  'system: "base16"', 'name: "Test Scheme"', 'author: "Someone <a@b.c>"', 'variant: "dark"', "palette:",
  ...Array.from({ length: 16 }, (_, i) => `  base0${i.toString(16).toUpperCase()}: "${["#101010", "#202020", "#303030", "#505050", "#a0a0a0", "#d0d0d0", "#e0e0e0", "#f0f0f0", "#ff5555", "#ffaa55", "#ffdd55", "#55ff88", "#55ddff", "#5599ff", "#cc77ff", "#aa7755"][i]}"  # comment`),
  extra,
].join("\n");

test("base16: converts to a valid family with no dropped values", () => {
  const converted = base16ToFamily(base16());
  assert.equal(converted.name, "Test Scheme");
  assert.equal(converted.themes[0].appearance, "dark");
  assert.equal(converted.themes[0].colors.accent, "#5599ff");
  assert.equal(converted.themes[0].colors["ansi-bright-red"], "#ff5555");
  const { family: result, problems } = themes.validateThemeFamily(converted, "scheme.yaml");
  assert.ok(result);
  assert.deepEqual(problems, []);
});

test("base16: old unquoted format, base24 brights, light detection", () => {
  const old = ['scheme: "Old"', ...Array.from({ length: 16 }, (_, i) => `base0${i.toString(16).toUpperCase()}: "${(i < 2 ? "f8f8f8" : i < 8 ? "777777" : "336699")}"`), 'base12: "ff0000"', 'base13: "ffff00"', 'base14: "00ff00"', 'base15: "00ffff"', 'base16: "0000ff"', 'base17: "ff00ff"'].join("\n");
  const converted = base16ToFamily(old);
  assert.equal(converted.themes[0].appearance, "light");
  assert.equal(converted.themes[0].colors["ansi-bright-magenta"], "#ff00ff");
  assert.match(converted.license, /Base24/);
});

test("base16: incomplete or junk schemes are refused", () => {
  assert.throws(() => parseScheme("name: x\nbase00: \"101010\""), /missing/);
  assert.throws(() => parseScheme("x".repeat(70 * 1024)), /64 KB/);
  assert.throws(() => base16ToFamily(base16().replace("#5599ff", "url(x)")), /missing base0D/i);
});

test("fonts: signatures and file-name families", () => {
  assert.equal(fontsModule.hasFontSignature(Buffer.from([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])), true);
  for (const tag of ["OTTO", "wOFF", "wOF2", "true"]) assert.equal(fontsModule.hasFontSignature(Buffer.from(`${tag}........`)), true, tag);
  for (const junk of ["<svg>.......", "PK\u0003\u0004........", "abc"]) assert.equal(fontsModule.hasFontSignature(Buffer.from(junk)), false, junk);
  assert.equal(fontsModule.familyFromFileName("Inter-Variable.ttf"), "Inter Variable");
  assert.equal(fontsModule.familyFromFileName("My_Font  Bold.otf"), "My Font Bold");
  assert.equal(fontsModule.familyFromFileName("\"; } body { x.ttf"), "body x");
  assert.equal(fontsModule.familyFromFileName("....ttf"), null);
});

// Contrast for every shipped preset (WCAG 2.x). Keys a preset leaves out use the Skai
// defaults for its appearance. Text must pass on every background and against EVERY
// gradient stop on the surface it sits on (SURFACE_TEXT mirrors src/theme/gradients.ts).
const SURFACE_TEXT = { canvas: ["text", "text-muted"], sidebar: ["sidebar-text", "sidebar-muted"], toolbar: ["text"], rail: ["sidebar-icon"], composer: ["text"], "user-bubble": ["text"], "primary-button": ["on-accent"], "brand-mark": ["on-brand-mark"], "empty-state": ["text", "text-muted"], backdrop: ["text"] };
function rgba(value) {
  const hex = /^#([0-9a-f]{3,8})$/i.exec(value);
  if (hex) {
    let digits = hex[1];
    if (digits.length <= 4) digits = [...digits].map((d) => d + d).join("");
    return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)).concat(digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1);
  }
  const fn = /^rgb\(([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)$/.exec(value);
  return fn ? [Number(fn[1]), Number(fn[2]), Number(fn[3]), fn[4] === undefined ? 1 : Number(fn[4])] : null;
}
const over = (top, base) => [0, 1, 2].map((i) => top[i] * top[3] + base[i] * (1 - top[3])).concat(1);
const lum = (c) => c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

test("presets: text, on-accent and every gradient stop pass contrast", () => {
  const skai = buildSkaiFamily().themes;
  const dir = path.dirname(presetPath);
  const failures = [];
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".json"))) {
    const preset = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    for (const theme of preset.themes) {
      const colors = { ...skai.find((entry) => entry.appearance === theme.appearance).colors, ...theme.colors };
      colors["accent-text"] ??= colors.accent; // tokens.css default: accent-text follows the accent
      const canvas = rgba(colors.canvas);
      const color = (key) => over(rgba(colors[key]), canvas);
      const check = (fg, bg, bgName, minimum) => { const value = ratio(fg, bg); if (value < minimum) failures.push(`${file} ${theme.name}: ${bgName} ${value.toFixed(2)}:1 < ${minimum}`); };
      for (const background of ["canvas", "surface", "surface-raised"]) for (const text of ["text", "text-muted"]) check(color(text), color(background), `${text} on ${background}`, 4.5);
      for (const text of ["sidebar-text", "sidebar-muted"]) check(color(text), color("sidebar"), `${text} on sidebar`, 4.5);
      for (const background of ["canvas", "surface", "surface-raised"]) check(color("accent-text"), color(background), `accent-text on ${background}`, 4.5);
      check(color("text"), over(rgba(colors["user-bubble"]), color("canvas")), "text on user-bubble", 4.5);
      // High-contrast themes: 7:1 for text and on-accent. Every theme: the focus ring (accent) 3:1.
      const strict = /high contrast/i.test(theme.name) ? 7 : 4.5;
      if (strict > 4.5) for (const background of ["canvas", "surface", "surface-raised", "sidebar"]) for (const text of ["text", "text-muted"]) check(color(text), color(background), `${text} on ${background} (high contrast)`, 7);
      check(color("on-accent"), color("accent"), "on-accent on accent", strict);
      for (const background of ["canvas", "surface"]) check(color("accent"), color(background), `focus ring (accent) on ${background}`, 3);
      for (const [surface, gradient] of Object.entries(theme.gradients ?? {})) {
        const stops = typeof gradient === "string" ? [gradient] : gradient.stops.map((stop) => stop.color);
        for (const text of SURFACE_TEXT[surface]) stops.forEach((stop, index) => check(color(text), over(rgba(stop), canvas), `${text} on ${surface} stop ${index + 1}`, surface === "rail" ? 3 : 4.5));
      }
    }
  }
  assert.deepEqual(failures, []);
});

test("community presets are generated from their recorded sources and licensed permissively", () => {
  for (const { id, json } of community.buildFamilies()) {
    const file = path.join(community.presetDir, `${id}.json`);
    assert.equal(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n"), community.serialize(json), `${id}.json is stale: run node scripts/theme-community.cjs --write`);
    assert.match(json.license, /^(MIT|Apache-2\.0|Original Skai Desktop theme)/, `${id} license`);
  }
  assert.equal(fs.readFileSync(community.noticesPath, "utf8").replace(/\r\n/g, "\n"), community.buildNotices(), "licenses/THEME-PALETTES.md is stale: run node scripts/theme-community.cjs --write");
  for (const entry of Object.values(community.SOURCES)) if (entry.copyright) assert.ok(community.buildNotices().includes(entry.copyright), `${entry.name} copyright missing from the notices`);
});

test("gradient presets are original Skai themes with light and dark variants", () => {
  for (const file of ["aurora.json", "sunset.json", "deep-sea.json", "synthwave.json"]) {
    const preset = JSON.parse(fs.readFileSync(path.join(path.dirname(presetPath), file), "utf8"));
    assert.match(preset.license, /^Original Skai Desktop theme/);
    assert.deepEqual(preset.themes.map((theme) => theme.appearance).sort(), ["dark", "light"]);
    assert.ok(preset.themes.every((theme) => Object.keys(theme.gradients ?? {}).length >= 2), `${file} needs gradients`);
  }
});

async function serviceTests() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skai-theme-test-"));
  const opened = [];
  const service = createThemeService({ userDataPath: dir, getWindow: () => null, shell: { openPath: async (file) => { opened.push(file); return ""; } }, dialog: {} });
  try {
    service.start();
    assert.ok(fs.existsSync(path.join(dir, "themes", "theme.schema.json")), "schema copy is written next to themes");
    const skaiDark = buildSkaiFamily().themes[0];
    const definition = { name: skaiDark.name, appearance: "dark", colors: Object.fromEntries(Object.entries(skaiDark.colors).map(([key, value]) => [themes.tokenForColorKey(key), value])), gradients: {}, fonts: {} };
    const duplicated = await service.handle("appearance.duplicateTheme", { theme: definition });
    assert.equal(duplicated.ok, true);
    assert.equal(duplicated.result.file, "my-skai-dark.json");
    const snapshot = await service.snapshot();
    assert.equal(snapshot.problems.length, 0, JSON.stringify(snapshot.problems));
    assert.equal(snapshot.families[0].themes[0].id, "user:my-skai-dark.json/Skai Dark (mine)");
    assert.equal((await service.handle("appearance.duplicateTheme", { theme: definition })).result.file, "my-skai-dark-2.json");
    const bad = await service.handle("appearance.duplicateTheme", { theme: { ...definition, colors: { "--skai-color-canvas": "url(https://example.com/x)" } } }).catch((error) => error);
    assert.ok(bad instanceof Error, "a definition with an unsafe value is not written");
    assert.equal((await service.handle("appearance.editTheme", { id: "builtin:Skai/Skai Dark" })).ok, false);
    for (const id of ["user:../../etc/passwd.json/x", "user:..\\x.json/x", "user:theme.schema.json/x"]) assert.equal((await service.handle("appearance.editTheme", { id })).ok, false, id);
    assert.equal((await service.handle("appearance.editTheme", { id: "user:my-skai-dark.json/Skai Dark (mine)" })).ok, true);
    assert.deepEqual(opened, [path.join(dir, "themes", "my-skai-dark.json")]);
    assert.equal(await service.handle("appearance.unknown", {}), null);
    // Gradient editor saves: only into a user theme file, validated, and removable.
    const mine = "user:my-skai-dark.json/Skai Dark (mine)";
    const gradient = { gradient: "linear", angle: 135, stops: [{ color: "#304050", at: 1 }, { color: "#102030", at: 0 }] };
    assert.equal((await service.handle("appearance.saveThemeGradient", { id: mine, surface: "canvas", gradient })).ok, true);
    const written = JSON.parse(fs.readFileSync(path.join(dir, "themes", "my-skai-dark.json"), "utf8")).themes[0].gradients.canvas;
    assert.deepEqual(written, { gradient: "linear", angle: 135, stops: [{ color: "#102030", at: 0 }, { color: "#304050", at: 1 }] });
    assert.equal((await service.handle("appearance.saveThemeGradient", { id: "builtin:Skai/Skai Dark", surface: "canvas", gradient })).ok, false);
    await assert.rejects(service.handle("appearance.saveThemeGradient", { id: mine, surface: "canvas", gradient: { gradient: "linear", stops: [{ color: "url(x)", at: 0 }, { color: "#000", at: 1 }] } }));
    await assert.rejects(service.handle("appearance.saveThemeGradient", { id: mine, surface: "title-bar", gradient }));
    assert.equal((await service.handle("appearance.saveThemeGradient", { id: mine, surface: "canvas", gradient: null })).ok, true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "themes", "my-skai-dark.json"), "utf8")).themes[0].gradients.canvas, undefined);
    // Appearance options: validated on save and read; reset restores every default.
    assert.equal((await service.handle("appearance.saveAppearanceOptions", { textScale: 1.2, cornerStyle: "round", chatWidth: "wide", messageStyle: "cards", motion: "full", accent: "#3366ff" })).ok, true);
    assert.deepEqual((await service.snapshot()).options, { animateBackground: false, textScale: 1.2, cornerStyle: "round", chatWidth: "wide", messageStyle: "cards", motion: "full", accent: "#3366ff" });
    assert.equal((await service.handle("appearance.saveAppearanceOptions", { textScale: 2 })).ok, true);
    assert.equal((await service.snapshot()).options.textScale, 2);
    for (const bad of [{ textScale: 3 }, { cornerStyle: "pointy" }, { accent: "red" }, { accent: "#33f; x" }, { motion: true }, { sidebarSecret: 1 }]) await assert.rejects(service.handle("appearance.saveAppearanceOptions", bad), JSON.stringify(bad));
    assert.equal((await service.handle("appearance.resetAppearance", {})).ok, true);
    const reset = await service.snapshot();
    assert.deepEqual([reset.options.textScale, reset.options.cornerStyle, reset.options.accent, reset.picks.darkTheme, reset.fonts], [1, "default", null, "builtin:Skai/Skai Dark", {}]);
    // Custom fonts: real signature + caps; junk, oversize and symlinks are reported, not loaded.
    const fontsDir = path.join(dir, "fonts");
    fs.writeFileSync(path.join(fontsDir, "Good-Sans.ttf"), Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.alloc(60)]));
    fs.writeFileSync(path.join(fontsDir, "Fake.ttf"), "not a font at all");
    fs.writeFileSync(path.join(fontsDir, "Huge.woff2"), Buffer.alloc(fontsModule.MAX_FONT_BYTES + 1));
    // Symlinks need extra privileges on Windows; test them where the OS allows it.
    let linked = true;
    try { fs.symlinkSync(path.join(dir, "appearance-outside.bin"), path.join(fontsDir, "Link.otf")); } catch { linked = false; }
    fs.writeFileSync(path.join(fontsDir, "notes.txt"), "ignored");
    const withFonts = await service.snapshot();
    assert.deepEqual(withFonts.customFonts.map((font) => font.family), ["Good Sans"]);
    assert.deepEqual(withFonts.problems.map((problem) => problem.file).sort(), ["Fake.ttf", "Huge.woff2", ...(linked ? ["Link.otf"] : [])]);
    assert.equal((await service.handle("appearance.readCustomFont", { file: "Good-Sans.ttf" })).ok, true);
    for (const file of ["../appearance.json", "Fake.ttf", "Link.otf", "notes.txt", "..\\Good-Sans.ttf"]) assert.equal((await service.handle("appearance.readCustomFont", { file })).ok, false, file);
    // Font overrides in appearance.json: validated on save and on read.
    const saved = await service.handle("appearance.saveFonts", { fonts: { reading: { family: ["Good Sans"], size: 15 } } });
    assert.deepEqual(saved.result, { reading: { family: ["Good Sans"], size: 15 } });
    await assert.rejects(service.handle("appearance.saveFonts", { fonts: { reading: { family: "x; y: url(z)" } } }));
    await assert.rejects(service.handle("appearance.saveFonts", { fonts: { sidebar: { size: 12 } } }));
    assert.deepEqual((await service.handle("appearance.saveFonts", { fonts: { reading: null } })).result, {});
    const picks = JSON.parse(fs.readFileSync(path.join(dir, "appearance.json"), "utf8"));
    picks.fonts = { code: { size: 99 }, ui: { family: "Inter" } };
    fs.writeFileSync(path.join(dir, "appearance.json"), JSON.stringify(picks));
    const read = await service.snapshot();
    assert.deepEqual(read.fonts, { ui: { family: ["Inter"] } });
    assert.ok(read.problems.some((problem) => problem.key === "fonts.code"));
  } finally {
    service.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  passed += 1;
}

serviceTests().then(() => console.log(`Theme file tests passed: ${passed} groups.`)).catch((error) => { console.error(error); process.exitCode = 1; });
