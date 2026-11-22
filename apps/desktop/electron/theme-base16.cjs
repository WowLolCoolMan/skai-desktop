// Theme: convert a Tinted Theming Base16 / Base24 scheme (.yaml) into a Skai
// theme family. Only the flat scheme shape is read (a hand-rolled line parser,
// no YAML library): `key: "value"` lines, optionally under `palette:`. Values
// must be 6-digit hex colors; everything else is ignored. The result still
// goes through validateThemeFamily before it is written anywhere.
//
// Mapping (documented in docs/guides/THEMING.md):
//   base00 canvas, terminal surface, ANSI black      base08 danger, ANSI red, syntax variable
//   base01 surface, sidebar, code surface            base09 syntax number
//   base02 raised surface, hover, borders, bubble    base0A warning, ANSI yellow, syntax type
//   base03 comments, ANSI bright black               base0B success, ANSI green, syntax string, diff added
//   base04 muted text                                base0C info, ANSI cyan
//   base05 text, code text                           base0D accent, link, ANSI blue, syntax function
//   base06 strong sidebar text                       base0E accent-strong, ANSI magenta, syntax keyword
//   base07 ANSI bright white                         base0F favorite
//   Base24 only: base12–base17 bright red, yellow, green, cyan, blue, magenta.

const MAX_BYTES = 64 * 1024;
const HEX = /^#?([0-9a-fA-F]{6})$/;

function parseScheme(text) {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > MAX_BYTES) throw new Error("The scheme file is empty or larger than 64 KB.");
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*$/.exec(line.replace(/\s+#(?![0-9a-fA-F]{6}\b).*$/, ""));
    if (!match) continue;
    const value = match[2].replace(/^(["'])(.*)\1$/, "$2");
    values[match[1].toLowerCase()] = value;
  }
  const palette = {};
  for (let index = 0; index < 24; index += 1) {
    const key = `base${index.toString(16).toUpperCase().padStart(2, "0")}`.toLowerCase();
    const hex = HEX.exec(values[key] ?? "");
    if (hex) palette[key] = `#${hex[1].toLowerCase()}`;
  }
  const missing = Array.from({ length: 16 }, (_, index) => `base0${index.toString(16)}`).filter((key) => !palette[key]);
  if (missing.length) throw new Error(`This isn't a Base16 scheme: missing ${missing.join(", ")}.`);
  const clean = (value, max) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
  return { name: clean(values.name || values.scheme, 64) || "Imported scheme", author: clean(values.author, 160), variant: values.variant, palette, base24: Boolean(palette.base17) };
}

const luminance = (hex) => {
  const channel = (offset) => { const c = parseInt(hex.slice(offset, offset + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
};
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const alpha = (hex, percent) => `${hex}${Math.round((percent / 100) * 255).toString(16).padStart(2, "0")}`;

function base16ToFamily(text) {
  const { name, author, variant, palette: p, base24 } = parseScheme(text);
  const appearance = variant === "light" || variant === "dark" ? variant : luminance(p.base00) > 0.4 ? "light" : "dark";
  const onAccent = [p.base00, p.base07, "#ffffff", "#000000"].sort((a, b) => contrast(b, p.base0d) - contrast(a, p.base0d))[0];
  const colors = {
    canvas: p.base00, surface: p.base01, "surface-raised": p.base02, "surface-soft": alpha(p.base02, 60),
    border: alpha(p.base03, 55), "border-strong": p.base03,
    text: p.base05, "text-muted": p.base04,
    accent: p.base0d, "accent-strong": p.base0e, "on-accent": onAccent, link: p.base0d, "focus-ring": p.base0d, selection: alpha(p.base0d, 32),
    danger: p.base08, "danger-text": p.base08, "danger-strong": p.base08, success: p.base0b, warning: p.base0a, info: p.base0c, favorite: p.base0f,
    sidebar: p.base01, "sidebar-text": p.base05, "sidebar-strong": p.base06, "sidebar-muted": p.base04, "sidebar-subtle": p.base04, "sidebar-icon": p.base04,
    "sidebar-hover": alpha(p.base02, 70), "sidebar-history-hover": alpha(p.base02, 55), "sidebar-active": alpha(p.base0d, 18), "sidebar-active-border": alpha(p.base0d, 40), "sidebar-border": alpha(p.base03, 45),
    "code-surface": p.base01, "code-text": p.base05, "inline-code-text": p.base0c, "attachment-text": p.base0c,
    "user-bubble": alpha(p.base02, 80), "user-bubble-border": p.base03, "brand-mark": p.base0d, "on-brand-mark": onAccent,
    "checker-a": p.base01, "checker-b": p.base02,
    "diff-added-surface": alpha(p.base0b, 15), "diff-added-text": p.base0b, "diff-removed-surface": alpha(p.base08, 15), "diff-removed-text": p.base08,
    "terminal-surface": p.base00, "terminal-text": p.base05, "terminal-muted": p.base04,
    "scrollbar-thumb": alpha(p.base03, 70),
    "ansi-black": p.base00, "ansi-red": p.base08, "ansi-green": p.base0b, "ansi-yellow": p.base0a, "ansi-blue": p.base0d, "ansi-magenta": p.base0e, "ansi-cyan": p.base0c, "ansi-white": p.base05,
    "ansi-bright-black": p.base03, "ansi-bright-red": base24 ? p.base12 : p.base08, "ansi-bright-green": base24 ? p.base14 : p.base0b, "ansi-bright-yellow": base24 ? p.base13 : p.base0a,
    "ansi-bright-blue": base24 ? p.base16 : p.base0d, "ansi-bright-magenta": base24 ? p.base17 : p.base0e, "ansi-bright-cyan": base24 ? p.base15 : p.base0c, "ansi-bright-white": p.base07,
    "syntax-keyword": p.base0e, "syntax-string": p.base0b, "syntax-number": p.base09, "syntax-comment": p.base03, "syntax-function": p.base0d, "syntax-type": p.base0a, "syntax-variable": p.base08, "syntax-punctuation": p.base05,
  };
  return {
    name,
    author,
    license: `Imported from a ${base24 ? "Base24" : "Base16"} scheme; check the scheme's own license before sharing`,
    themes: [{ name, appearance, colors }],
  };
}

module.exports = { parseScheme, base16ToFamily, MAX_BYTES };
