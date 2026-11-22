// Theme files: validation of theme families (built-in presets and the user's
// <userData>/themes/*.json). Theme files are UNTRUSTED input. Nothing from a
// file is ever passed through as raw CSS: only values that match strict
// shapes are kept (colors, ranged numbers, font names, gradient stops), and
// the renderer builds every CSS string itself. A bad key is dropped with a
// problem report; a bad file is rejected and the last good theme stays.

const MAX_FILE_BYTES = 256 * 1024;
const MAX_THEMES = 16;
const MAX_NAME = 64;
const MAX_META = 160;

// Theme "colors" keys and the token each one sets. ansi-* and syntax-* keep
// their own prefix; everything else is --skai-color-<key>.
const COLOR_KEYS = [
  "canvas", "surface", "surface-raised", "surface-soft", "border", "border-strong",
  "text", "text-muted", "accent", "accent-strong", "accent-text", "on-accent", "danger", "danger-text", "danger-strong",
  "success", "warning", "info", "favorite", "focus-ring", "selection", "link",
  "scrollbar-thumb", "scrollbar-track", "overlay", "shadow",
  "sidebar", "sidebar-text", "sidebar-strong", "sidebar-muted", "sidebar-subtle", "sidebar-icon",
  "sidebar-hover", "sidebar-history-hover", "sidebar-active", "sidebar-active-border", "sidebar-border",
  "code-surface", "code-text", "inline-code-text", "attachment-text",
  "user-bubble", "user-bubble-border", "brand-mark", "on-brand-mark",
  "checker-a", "checker-b", "document-page",
  "diff-added-surface", "diff-added-text", "diff-removed-surface", "diff-removed-text",
  "terminal-surface", "terminal-text", "terminal-muted",
  ...["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"].flatMap((name) => [`ansi-${name}`, `ansi-bright-${name}`]),
  ...["keyword", "string", "number", "comment", "function", "type", "variable", "punctuation"].map((name) => `syntax-${name}`),
];
const COLOR_KEY_SET = new Set(COLOR_KEYS);
const tokenForColorKey = (key) => (key.startsWith("ansi-") || key.startsWith("syntax-") ? `--skai-${key}` : `--skai-color-${key}`);

// Surfaces that may take a gradient instead of a solid color (Phase 5).
const GRADIENT_SURFACES = ["canvas", "sidebar", "toolbar", "rail", "composer", "user-bubble", "primary-button", "brand-mark", "empty-state", "backdrop"];
const GRADIENT_TYPES = new Set(["linear", "radial", "conic"]);
const FONT_ROLES = ["ui", "heading", "reading", "code"];

function parseColor(value) {
  if (typeof value !== "string" || value.length > 64) return null;
  const text = value.trim().toLowerCase();
  if (text === "transparent") return text;
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(text)) return text;
  const fn = /^(rgba?|hsla?)\(([^()]*)\)$/.exec(text);
  if (!fn) return null;
  const parts = fn[2].split(/\s*,\s*|\s*\/\s*|\s+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return null;
  const number = (part, { percent = false, max, alpha = false } = {}) => {
    const match = /^(-?\d+(?:\.\d+)?|-?\.\d+)(%|deg)?$/.exec(part);
    if (!match) return null;
    const n = Number(match[1]);
    if (match[2] === "deg") return alpha ? null : n;
    if (match[2] === "%") return n >= 0 && n <= 100 ? n : null;
    if (percent) return null;
    return n >= 0 && n <= max ? n : null;
  };
  const isHsl = fn[1].startsWith("hsl");
  const channels = parts.slice(0, 3).map((part, index) => isHsl
    ? (index === 0 ? number(part, { max: 360 }) : (part.endsWith("%") ? number(part) : null))
    : number(part, { max: 255 }));
  if (channels.some((n) => n === null)) return null;
  if (parts[3] !== undefined && number(parts[3], { max: 1, alpha: true }) === null) return null;
  const canonical = isHsl
    ? `hsl(${parts[0]} ${parts[1]} ${parts[2]}${parts[3] !== undefined ? ` / ${parts[3]}` : ""})`
    : `rgb(${parts[0]} ${parts[1]} ${parts[2]}${parts[3] !== undefined ? ` / ${parts[3]}` : ""})`;
  return canonical;
}

function parseGradient(value) {
  const color = parseColor(value);
  if (color) return { gradient: "solid", color };
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!GRADIENT_TYPES.has(value.gradient)) return null;
  const angle = value.angle === undefined ? 180 : value.angle;
  if (typeof angle !== "number" || !Number.isFinite(angle) || angle < 0 || angle > 360) return null;
  if (!Array.isArray(value.stops) || value.stops.length < 2 || value.stops.length > 8) return null;
  const stops = [];
  for (const stop of value.stops) {
    const stopColor = parseColor(stop?.color);
    const at = stop?.at;
    if (!stopColor || typeof at !== "number" || !Number.isFinite(at) || at < 0 || at > 1) return null;
    stops.push({ color: stopColor, at });
  }
  stops.sort((a, b) => a.at - b.at);
  return { gradient: value.gradient, angle, stops };
}

const FONT_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.\-]{0,62}$/;
function parseFont(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const font = {};
  if (value.family !== undefined) {
    const names = typeof value.family === "string" ? value.family.split(",").map((name) => name.trim()) : Array.isArray(value.family) ? value.family : null;
    if (!names || !names.length || names.length > 4 || !names.every((name) => typeof name === "string" && FONT_NAME.test(name))) return null;
    font.family = names;
  }
  const ranged = (key, min, max) => {
    if (value[key] === undefined) return true;
    if (typeof value[key] !== "number" || !Number.isFinite(value[key]) || value[key] < min || value[key] > max) return false;
    font[key] = value[key];
    return true;
  };
  if (!ranged("size", 8, 32) || !ranged("weight", 100, 900) || !ranged("lineHeight", 1, 2.5) || !ranged("letterSpacing", -0.1, 0.3)) return null;
  return Object.keys(font).length ? font : null;
}

const cleanText = (value, max) => (typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max) : "");

// Validate a parsed theme family. Returns { family, problems } where family is
// null when the file can't be used at all. `source` names the file in problems.
function validateThemeFamily(input, source = "theme") {
  const problems = [];
  const problem = (key, message) => problems.push({ file: source, key, problem: message });
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    problem("(root)", "must be a JSON object");
    return { family: null, problems };
  }
  const name = cleanText(input.name, MAX_NAME);
  if (!name) problem("name", "is required (text, up to 64 characters)");
  if (!Array.isArray(input.themes) || !input.themes.length) problem("themes", "must be a non-empty list");
  if (!name || !Array.isArray(input.themes) || !input.themes.length) return { family: null, problems };
  if (input.themes.length > MAX_THEMES) problem("themes", `only the first ${MAX_THEMES} themes are used`);

  const themes = [];
  const seen = new Set();
  input.themes.slice(0, MAX_THEMES).forEach((theme, index) => {
    const at = `themes[${index}]`;
    const themeName = cleanText(theme?.name, MAX_NAME);
    if (!themeName) return problem(`${at}.name`, "is required");
    if (seen.has(themeName.toLowerCase())) return problem(`${at}.name`, `"${themeName}" is used twice`);
    if (theme.appearance !== "light" && theme.appearance !== "dark") return problem(`${at}.appearance`, 'must be "light" or "dark"');
    seen.add(themeName.toLowerCase());
    const colors = {};
    if (theme.colors !== undefined && (typeof theme.colors !== "object" || theme.colors === null || Array.isArray(theme.colors))) problem(`${at}.colors`, "must be an object");
    else for (const [key, value] of Object.entries(theme.colors ?? {})) {
      if (!COLOR_KEY_SET.has(key)) { problem(`${at}.colors.${key}`, "is not a known color key"); continue; }
      const color = parseColor(value);
      if (!color) { problem(`${at}.colors.${key}`, "must be a color: #rgb, #rrggbb, #rrggbbaa, rgb(), hsl() or transparent"); continue; }
      colors[tokenForColorKey(key)] = color;
    }
    const gradients = {};
    for (const [key, value] of Object.entries(theme.gradients && typeof theme.gradients === "object" ? theme.gradients : {})) {
      if (!GRADIENT_SURFACES.includes(key)) { problem(`${at}.gradients.${key}`, "is not a surface that takes a gradient"); continue; }
      const gradient = parseGradient(value);
      if (!gradient) { problem(`${at}.gradients.${key}`, "must be a color or { gradient: linear|radial|conic, angle: 0-360, stops: 2-8 × { color, at: 0-1 } }"); continue; }
      gradients[key] = gradient;
    }
    const fonts = {};
    for (const [key, value] of Object.entries(theme.fonts && typeof theme.fonts === "object" ? theme.fonts : {})) {
      if (!FONT_ROLES.includes(key)) { problem(`${at}.fonts.${key}`, `is not a font role (${FONT_ROLES.join(", ")})`); continue; }
      const font = parseFont(value);
      if (!font) { problem(`${at}.fonts.${key}`, "needs family (up to 4 plain font names), size 8-32, weight 100-900, lineHeight 1-2.5, letterSpacing -0.1-0.3"); continue; }
      fonts[key] = font;
    }
    themes.push({ id: `${name}/${themeName}`, name: themeName, appearance: theme.appearance, colors, gradients, fonts });
  });
  if (!themes.length) return { family: null, problems };
  return { family: { name, author: cleanText(input.author, MAX_META), license: cleanText(input.license, MAX_META), themes }, problems };
}

// Parse and validate theme file text (size-capped before JSON.parse).
function parseThemeFile(text, source) {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > MAX_FILE_BYTES) return { family: null, problems: [{ file: source, key: "(file)", problem: `is larger than ${MAX_FILE_BYTES / 1024} KB` }] };
  let json;
  try { json = JSON.parse(text); } catch (error) { return { family: null, problems: [{ file: source, key: "(file)", problem: `is not valid JSON (${String(error.message).slice(0, 120)})` }] }; }
  return validateThemeFamily(json, source);
}

// JSON Schema for theme families, generated from the key lists above. Written to
// docs/theme.schema.json (scripts/theme-generate.cjs) and next to the user's themes.
function buildSchema() {
  const color = { type: "string", maxLength: 64, description: "#rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba(), hsl()/hsla() with plain numbers, or transparent. Nothing else (no url(), var() or keywords)." };
  const gradient = {
    oneOf: [
      { $ref: "#/$defs/color" },
      {
        type: "object", additionalProperties: false, required: ["gradient", "stops"],
        properties: {
          gradient: { enum: ["linear", "radial", "conic"] },
          angle: { type: "number", minimum: 0, maximum: 360, description: "Degrees, for linear and conic. Default 180 (top to bottom)." },
          stops: { type: "array", minItems: 2, maxItems: 8, items: { type: "object", additionalProperties: false, required: ["color", "at"], properties: { color: { $ref: "#/$defs/color" }, at: { type: "number", minimum: 0, maximum: 1 } } } },
        },
      },
    ],
  };
  const font = {
    type: "object", additionalProperties: false,
    properties: {
      family: { description: "Up to 4 plain font names, first one wins (letters, digits, space, _ . -).", oneOf: [{ type: "string", maxLength: 300 }, { type: "array", maxItems: 4, items: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9 _.\\-]{0,62}$" } }] },
      size: { type: "number", minimum: 8, maximum: 32, description: "px" },
      weight: { type: "number", minimum: 100, maximum: 900 },
      lineHeight: { type: "number", minimum: 1, maximum: 2.5 },
      letterSpacing: { type: "number", minimum: -0.1, maximum: 0.3, description: "em" },
    },
  };
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:skai-desktop:theme-schema:1",
    title: "Skai Desktop theme family",
    description: "Generated by scripts/theme-generate.cjs from the validator in apps/desktop/electron/theme-files.cjs. See docs/guides/THEMING.md.",
    type: "object", required: ["name", "themes"],
    properties: {
      $schema: { type: "string" },
      name: { type: "string", minLength: 1, maxLength: 64 },
      author: { type: "string", maxLength: 160 },
      license: { type: "string", maxLength: 160 },
      themes: {
        type: "array", minItems: 1, maxItems: 16,
        items: {
          type: "object", required: ["name", "appearance"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 64 },
            appearance: { enum: ["light", "dark"] },
            colors: { type: "object", additionalProperties: false, properties: Object.fromEntries(COLOR_KEYS.map((key) => [key, { $ref: "#/$defs/color", description: `Sets ${tokenForColorKey(key)}` }])) },
            gradients: { type: "object", additionalProperties: false, properties: Object.fromEntries(GRADIENT_SURFACES.map((key) => [key, { $ref: "#/$defs/gradient" }])) },
            fonts: { type: "object", additionalProperties: false, properties: Object.fromEntries(FONT_ROLES.map((key) => [key, { $ref: "#/$defs/font" }])) },
          },
        },
      },
    },
    $defs: { color, gradient, font },
  };
}


// Theme key for a token (inverse of tokenForColorKey), or null.
const colorKeyForToken = (token) => COLOR_KEYS.find((key) => tokenForColorKey(key) === token) ?? null;

module.exports = { buildSchema, colorKeyForToken, COLOR_KEYS, GRADIENT_SURFACES, FONT_ROLES, MAX_FILE_BYTES, tokenForColorKey, parseColor, parseGradient, parseFont, validateThemeFamily, parseThemeFile };
