// Community preset gallery: palettes copied from each project's own repository
// (values and licenses checked at the source on 2026-11-16, listed in SOURCES),
// mapped onto Skai's color keys. Writes apps/desktop/src/theme/presets/<id>.json.
// Only permissive licenses ship. Where a mapped color would fail WCAG AA on this
// app's surfaces, ONLY that token is nudged toward the readable side until it
// passes, and the change is recorded in the preset's "adjusted" list.
//   node scripts/theme-community.cjs --write    (test:themes fails if output is stale)
const fs = require("node:fs");
const path = require("node:path");

const presetDir = path.join(__dirname, "..", "apps", "desktop", "src", "theme", "presets");

// --- color math -----------------------------------------------------------------
const hex = (value) => { let v = value.replace("#", "").toLowerCase(); if (v.length === 3) v = [...v].map((c) => c + c).join(""); return `#${v.slice(0, 6)}`; };
const rgb = (value) => { const v = hex(value).slice(1); return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)); };
const toHex = (channels) => `#${channels.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("")}`;
const hsl = (h, s, l) => { s /= 100; l /= 100; const k = (n) => (n + h / 30) % 12; const a = s * Math.min(l, 1 - l); return toHex([0, 8, 4].map((n) => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))))); };
const lum = (value) => rgb(value).map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const mix = (a, b, t) => toHex(rgb(a).map((c, i) => c + (rgb(b)[i] - c) * t));
const alpha = (value, percent) => `${hex(value)}${Math.round((percent / 100) * 255).toString(16).padStart(2, "0")}`;

// --- mapping --------------------------------------------------------------------
// p: { appearance, canvas, sidebar, surface, raised, text, muted, accent, accentStrong,
//      red, green, yellow, blue, magenta, cyan, orange, comment, ansi[16], highContrast? }
function mapPalette(p) {
  const dark = p.appearance === "dark";
  const minimum = p.highContrast ? 7 : 4.5;
  const adjusted = [];
  const backgrounds = [p.canvas, p.surface, p.raised, p.sidebar];
  // Nudge ONE token toward white (dark themes) or black (light) until it reaches `min` on every background.
  const readable = (key, value, on = backgrounds, min = minimum) => {
    let next = hex(value);
    const target = dark ? "#ffffff" : "#000000";
    for (let step = 0; step <= 50 && on.some((bg) => contrast(next, bg) < min); step += 1) next = mix(hex(value), target, step / 50);
    if (next !== hex(value)) adjusted.push({ key, from: hex(value), to: next, reason: `${Math.min(...on.map((bg) => contrast(hex(value), bg))).toFixed(2)}:1 on this theme's surfaces, below ${min}:1` });
    return next;
  };
  // The accent is also the focus ring, so it must reach 3:1 on the canvas and surfaces.
  const accent = readable("accent", p.accent, [p.canvas, p.surface], 3);
  const onAccent = [p.canvas, p.text, "#ffffff", "#000000"].map(hex).sort((a, b) => contrast(b, accent) - contrast(a, accent))[0];
  const text = readable("text", p.text);
  const muted = readable("text-muted", p.muted);
  const colors = {
    canvas: hex(p.canvas), surface: hex(p.surface), "surface-raised": hex(p.raised), "surface-soft": alpha(text, dark ? 6 : 5),
    border: alpha(text, p.highContrast ? 45 : 14), "border-strong": alpha(text, p.highContrast ? 75 : 26),
    text, "text-muted": muted,
    accent, "accent-strong": hex(p.accentStrong ?? p.accent), "on-accent": onAccent,
    danger: hex(p.red), "danger-text": readable("danger-text", p.red), "danger-strong": readable("danger-strong", p.red),
    success: readable("success", p.green), warning: readable("warning", p.yellow), info: readable("info", p.cyan), favorite: hex(p.yellow),
    overlay: alpha(dark ? p.canvas : p.text, dark ? 72 : 38), shadow: dark ? "#000000" : alpha(p.text, 55),
    sidebar: hex(p.sidebar), "sidebar-text": text, "sidebar-strong": text, "sidebar-muted": muted, "sidebar-subtle": muted, "sidebar-icon": muted,
    "sidebar-hover": alpha(text, 7), "sidebar-history-hover": alpha(text, 5), "sidebar-active": alpha(accent, 16), "sidebar-active-border": alpha(accent, 34), "sidebar-border": alpha(text, 10),
    "code-surface": hex(dark ? p.sidebar : p.raised), "code-text": text, "inline-code-text": readable("inline-code-text", p.cyan), "attachment-text": readable("attachment-text", p.cyan),
    "user-bubble": alpha(accent, 13), "user-bubble-border": alpha(accent, 34), "brand-mark": accent, "on-brand-mark": onAccent,
    "checker-a": hex(p.surface), "checker-b": hex(p.raised),
    "diff-added-surface": alpha(p.green, 15), "diff-added-text": readable("diff-added-text", p.green), "diff-removed-surface": alpha(p.red, 15), "diff-removed-text": readable("diff-removed-text", p.red),
    "terminal-surface": hex(p.canvas), "terminal-text": text, "terminal-muted": muted,
    "syntax-keyword": hex(p.magenta), "syntax-string": hex(p.green), "syntax-number": hex(p.orange), "syntax-comment": hex(p.comment), "syntax-function": hex(p.blue), "syntax-type": hex(p.yellow), "syntax-variable": text, "syntax-punctuation": muted,
  };
  ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"].forEach((name, i) => { colors[`ansi-${name}`] = hex(p.ansi[i]); colors[`ansi-bright-${name}`] = hex(p.ansi[i + 8]); });
  return { colors, adjusted };
}

// --- sources --------------------------------------------------------------------
const MIT = "MIT";
const SOURCES = {};
const theme = (name, appearance, palette) => ({ name, appearance, palette: { appearance, ...palette } });
const family = (id, name, meta, themes) => { SOURCES[id] = { name, ...meta, themes }; };

// Catppuccin — https://github.com/catppuccin/palette (palette.json v1.8.0)
const ctp = {
  latte: { rosewater: "#dc8a78", pink: "#ea76cb", mauve: "#8839ef", red: "#d20f39", peach: "#fe640b", yellow: "#df8e1d", green: "#40a02b", teal: "#179299", sky: "#04a5e5", blue: "#1e66f5", lavender: "#7287fd", text: "#4c4f69", subtext1: "#5c5f77", subtext0: "#6c6f85", overlay2: "#7c7f93", overlay0: "#9ca0b0", surface2: "#acb0be", surface1: "#bcc0cc", surface0: "#ccd0da", base: "#eff1f5", mantle: "#e6e9ef", crust: "#dce0e8", ansi: ["#5c5f77", "#d20f39", "#40a02b", "#df8e1d", "#1e66f5", "#ea76cb", "#179299", "#acb0be", "#6c6f85", "#de293e", "#49af3d", "#eea02d", "#456eff", "#fe85d8", "#2d9fa8", "#bcc0cc"] },
  frappe: { pink: "#f4b8e4", mauve: "#ca9ee6", red: "#e78284", peach: "#ef9f76", yellow: "#e5c890", green: "#a6d189", teal: "#81c8be", sky: "#99d1db", blue: "#8caaee", lavender: "#babbf1", text: "#c6d0f5", subtext1: "#b5bfe2", subtext0: "#a5adce", overlay2: "#949cbb", overlay0: "#737994", surface1: "#51576d", surface0: "#414559", base: "#303446", mantle: "#292c3c", crust: "#232634", ansi: ["#51576d", "#e78284", "#a6d189", "#e5c890", "#8caaee", "#f4b8e4", "#81c8be", "#a5adce", "#626880", "#e67172", "#8ec772", "#d9ba73", "#7b9ef0", "#f2a4db", "#5abfb5", "#b5bfe2"] },
  macchiato: { pink: "#f5bde6", mauve: "#c6a0f6", red: "#ed8796", peach: "#f5a97f", yellow: "#eed49f", green: "#a6da95", teal: "#8bd5ca", sky: "#91d7e3", blue: "#8aadf4", lavender: "#b7bdf8", text: "#cad3f5", subtext1: "#b8c0e0", subtext0: "#a5adcb", overlay2: "#939ab7", overlay0: "#6e738d", surface1: "#494d64", surface0: "#363a4f", base: "#24273a", mantle: "#1e2030", crust: "#181926", ansi: ["#494d64", "#ed8796", "#a6da95", "#eed49f", "#8aadf4", "#f5bde6", "#8bd5ca", "#a5adcb", "#5b6078", "#ec7486", "#8ccf7f", "#e1c682", "#78a1f6", "#f2a9dd", "#63cbc0", "#b8c0e0"] },
  mocha: { pink: "#f5c2e7", mauve: "#cba6f7", red: "#f38ba8", peach: "#fab387", yellow: "#f9e2af", green: "#a6e3a1", teal: "#94e2d5", sky: "#89dceb", blue: "#89b4fa", lavender: "#b4befe", text: "#cdd6f4", subtext1: "#bac2de", subtext0: "#a6adc8", overlay2: "#9399b2", overlay0: "#6c7086", surface1: "#45475a", surface0: "#313244", base: "#1e1e2e", mantle: "#181825", crust: "#11111b", ansi: ["#45475a", "#f38ba8", "#a6e3a1", "#f9e2af", "#89b4fa", "#f5c2e7", "#94e2d5", "#a6adc8", "#585b70", "#f37799", "#89d88b", "#ebd391", "#74a8fc", "#f2aede", "#6bd7ca", "#bac2de"] },
};
const ctpTheme = (name, f, appearance) => theme(name, appearance, { canvas: f.base, sidebar: f.mantle, surface: appearance === "dark" ? mix(f.base, f.surface0, 0.5) : "#ffffff", raised: appearance === "dark" ? f.surface0 : f.surface0, text: f.text, muted: f.subtext0, accent: f.mauve, accentStrong: f.lavender, red: f.red, green: f.green, yellow: f.yellow, blue: f.blue, magenta: f.pink, cyan: f.teal, orange: f.peach, comment: f.overlay2, ansi: f.ansi });
family("catppuccin", "Catppuccin", { license: MIT, copyright: "Copyright (c) 2021 Catppuccin", source: "https://github.com/catppuccin/palette (palette.json, LICENSE)" }, [ctpTheme("Catppuccin Latte", ctp.latte, "light"), ctpTheme("Catppuccin Frappé", ctp.frappe, "dark"), ctpTheme("Catppuccin Macchiato", ctp.macchiato, "dark"), ctpTheme("Catppuccin Mocha", ctp.mocha, "dark")]);

// Dracula — https://github.com/dracula/visual-studio-code (src/dracula.yml)
family("dracula", "Dracula", { license: MIT, copyright: "Copyright (c) 2016 Dracula Theme", source: "https://github.com/dracula/visual-studio-code (src/dracula.yml, LICENSE)" }, [
  theme("Dracula", "dark", { canvas: "#282A36", sidebar: "#21222C", surface: "#343746", raised: "#424450", text: "#F8F8F2", muted: "#6272A4", accent: "#BD93F9", accentStrong: "#FF79C6", red: "#FF5555", green: "#50FA7B", yellow: "#F1FA8C", blue: "#BD93F9", magenta: "#FF79C6", cyan: "#8BE9FD", orange: "#FFB86C", comment: "#6272A4", ansi: ["#21222C", "#FF5555", "#50FA7B", "#F1FA8C", "#BD93F9", "#FF79C6", "#8BE9FD", "#F8F8F2", "#6272A4", "#FF6E6E", "#69FF94", "#FFFFA5", "#D6ACFF", "#FF92DF", "#A4FFFF", "#FFFFFF"] }),
]);

// Nord — https://github.com/nordtheme/nord (src/nord.css)
const n = { 0: "#2e3440", 1: "#3b4252", 2: "#434c5e", 3: "#4c566a", 4: "#d8dee9", 5: "#e5e9f0", 6: "#eceff4", 7: "#8fbcbb", 8: "#88c0d0", 9: "#81a1c1", 10: "#5e81ac", 11: "#bf616a", 12: "#d08770", 13: "#ebcb8b", 14: "#a3be8c", 15: "#b48ead" };
family("nord", "Nord", { license: MIT, copyright: "Copyright (c) 2016-present Sven Greb <development@svengreb.de> (https://www.svengreb.de)", source: "https://github.com/nordtheme/nord (src/nord.css, license)" }, [
  theme("Nord", "dark", { canvas: n[0], sidebar: "#292e39", surface: n[1], raised: n[2], text: n[6], muted: n[4], accent: n[8], accentStrong: n[9], red: n[11], green: n[14], yellow: n[13], blue: n[9], magenta: n[15], cyan: n[7], orange: n[12], comment: n[3], ansi: [n[1], n[11], n[14], n[13], n[9], n[15], n[8], n[5], n[3], n[11], n[14], n[13], n[9], n[15], n[7], n[6]] }),
]);

// Gruvbox — https://github.com/morhetz/gruvbox (colors/gruvbox.vim; README: MIT/X11)
const g = { dark0_hard: "#1d2021", dark0: "#282828", dark1: "#3c3836", dark2: "#504945", dark3: "#665c54", dark4: "#7c6f64", gray: "#928374", light0_hard: "#f9f5d7", light0: "#fbf1c7", light1: "#ebdbb2", light2: "#d5c4a1", light4: "#a89984", bright_red: "#fb4934", bright_green: "#b8bb26", bright_yellow: "#fabd2f", bright_blue: "#83a598", bright_purple: "#d3869b", bright_aqua: "#8ec07c", bright_orange: "#fe8019", neutral_red: "#cc241d", neutral_green: "#98971a", neutral_yellow: "#d79921", neutral_blue: "#458588", neutral_purple: "#b16286", neutral_aqua: "#689d6a", faded_red: "#9d0006", faded_green: "#79740e", faded_yellow: "#b57614", faded_blue: "#076678", faded_purple: "#8f3f71", faded_aqua: "#427b58", faded_orange: "#af3a03" };
family("gruvbox", "Gruvbox", { license: "MIT/X11 (stated in the project README; the repository has no LICENSE file)", copyright: "Copyright (c) morhetz (Pavel Pertsev)", source: "https://github.com/morhetz/gruvbox (colors/gruvbox.vim, README.md)" }, [
  theme("Gruvbox Dark", "dark", { canvas: g.dark0, sidebar: g.dark0_hard, surface: g.dark1, raised: g.dark2, text: g.light1, muted: g.light4, accent: g.bright_yellow, accentStrong: g.bright_orange, red: g.bright_red, green: g.bright_green, yellow: g.bright_yellow, blue: g.bright_blue, magenta: g.bright_purple, cyan: g.bright_aqua, orange: g.bright_orange, comment: g.gray, ansi: [g.dark0, g.neutral_red, g.neutral_green, g.neutral_yellow, g.neutral_blue, g.neutral_purple, g.neutral_aqua, g.light4, g.gray, g.bright_red, g.bright_green, g.bright_yellow, g.bright_blue, g.bright_purple, g.bright_aqua, g.light1] }),
  theme("Gruvbox Light", "light", { canvas: g.light0, sidebar: g.light0_hard, surface: g.light0_hard, raised: g.light1, text: g.dark1, muted: g.dark4, accent: g.faded_blue, accentStrong: g.faded_aqua, red: g.faded_red, green: g.faded_green, yellow: g.faded_yellow, blue: g.faded_blue, magenta: g.faded_purple, cyan: g.faded_aqua, orange: g.faded_orange, comment: g.gray, ansi: [g.light0, g.neutral_red, g.neutral_green, g.neutral_yellow, g.neutral_blue, g.neutral_purple, g.neutral_aqua, g.dark4, g.gray, g.faded_red, g.faded_green, g.faded_yellow, g.faded_blue, g.faded_purple, g.faded_aqua, g.dark1] }),
]);

// Tokyo Night — https://github.com/folke/tokyonight.nvim (extras/kitty/*.conf, lua/tokyonight/colors/storm.lua)
const tnAnsi = ["#15161e", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff", "#a9b1d6", "#414868", "#ff899d", "#9fe044", "#faba4a", "#8db0ff", "#c7a9ff", "#a4daff", "#c0caf5"];
const tn = (canvas, sidebar, surface, raised, ansi0) => ({ canvas, sidebar, surface, raised, text: "#c0caf5", muted: "#a9b1d6", accent: "#7aa2f7", accentStrong: "#bb9af7", red: "#f7768e", green: "#9ece6a", yellow: "#e0af68", blue: "#7aa2f7", magenta: "#bb9af7", cyan: "#7dcfff", orange: "#ff9e64", comment: "#565f89", ansi: [ansi0, ...tnAnsi.slice(1)] });
family("tokyo-night", "Tokyo Night", { license: "Apache-2.0", copyright: "Copyright (c) Folke Lemaitre", source: "https://github.com/folke/tokyonight.nvim (extras/kitty/tokyonight_{night,storm,day}.conf, lua/tokyonight/colors/storm.lua, LICENSE)" }, [
  theme("Tokyo Night", "dark", tn("#1a1b26", "#16161e", "#292e42", "#283457", "#15161e")),
  theme("Tokyo Night Storm", "dark", tn("#24283b", "#1f2335", "#292e42", "#2e3c64", "#1d202f")),
  theme("Tokyo Night Day", "light", { canvas: "#e1e2e7", sidebar: "#d0d5e3", surface: "#e9e9ed", raised: "#c4c8da", text: "#3760bf", muted: "#6172b0", accent: "#2e7de9", accentStrong: "#9854f1", red: "#f52a65", green: "#587539", yellow: "#8c6c3e", blue: "#2e7de9", magenta: "#9854f1", cyan: "#007197", orange: "#b15c00", comment: "#8990b3", ansi: ["#b4b5b9", "#f52a65", "#587539", "#8c6c3e", "#2e7de9", "#9854f1", "#007197", "#6172b0", "#a1a6c5", "#ff4774", "#5c8524", "#a27629", "#358aff", "#a463ff", "#007ea8", "#3760bf"] }),
]);

// Solarized — https://github.com/altercation/solarized (README.md, LICENSE)
const s = { base03: "#002b36", base02: "#073642", base01: "#586e75", base00: "#657b83", base0: "#839496", base1: "#93a1a1", base2: "#eee8d5", base3: "#fdf6e3", yellow: "#b58900", orange: "#cb4b16", red: "#dc322f", magenta: "#d33682", violet: "#6c71c4", blue: "#268bd2", cyan: "#2aa198", green: "#859900" };
const solAnsi = [s.base02, s.red, s.green, s.yellow, s.blue, s.magenta, s.cyan, s.base2, s.base03, s.orange, s.base01, s.base00, s.base0, s.violet, s.base1, s.base3];
family("solarized", "Solarized", { license: MIT, copyright: "Copyright (c) 2011 Ethan Schoonover", source: "https://github.com/altercation/solarized (README.md, LICENSE)" }, [
  theme("Solarized Dark", "dark", { canvas: s.base03, sidebar: "#00212b", surface: s.base02, raised: "#0a4553", text: s.base1, muted: s.base0, accent: s.blue, accentStrong: s.violet, red: s.red, green: s.green, yellow: s.yellow, blue: s.blue, magenta: s.magenta, cyan: s.cyan, orange: s.orange, comment: s.base01, ansi: solAnsi }),
  theme("Solarized Light", "light", { canvas: s.base3, sidebar: s.base2, surface: s.base3, raised: s.base2, text: s.base01, muted: s.base00, accent: s.blue, accentStrong: s.violet, red: s.red, green: s.green, yellow: s.yellow, blue: s.blue, magenta: s.magenta, cyan: s.cyan, orange: s.orange, comment: s.base1, ansi: solAnsi }),
]);

// Rosé Pine — https://github.com/rose-pine/palette (palette.json, LICENSE)
const rp = {
  main: { base: "#191724", surface: "#1f1d2e", overlay: "#26233a", muted: "#6e6a86", subtle: "#908caa", text: "#e0def4", love: "#eb6f92", gold: "#f6c177", rose: "#ebbcba", pine: "#31748f", foam: "#9ccfd8", iris: "#c4a7e7" },
  moon: { base: "#232136", surface: "#2a273f", overlay: "#393552", muted: "#6e6a86", subtle: "#908caa", text: "#e0def4", love: "#eb6f92", gold: "#f6c177", rose: "#ea9a97", pine: "#3e8fb0", foam: "#9ccfd8", iris: "#c4a7e7" },
  dawn: { base: "#faf4ed", surface: "#fffaf3", overlay: "#f2e9e1", muted: "#9893a5", subtle: "#797593", text: "#464261", love: "#b4637a", gold: "#ea9d34", rose: "#d7827e", pine: "#286983", foam: "#56949f", iris: "#907aa9" },
};
const rpTheme = (name, v, appearance) => theme(name, appearance, { canvas: v.base, sidebar: appearance === "dark" ? v.surface : v.overlay, surface: v.surface, raised: v.overlay, text: v.text, muted: v.subtle, accent: v.iris, accentStrong: v.rose, red: v.love, green: v.pine, yellow: v.gold, blue: v.foam, magenta: v.iris, cyan: v.foam, orange: v.rose, comment: v.muted, ansi: [v.overlay, v.love, v.pine, v.gold, v.foam, v.iris, v.rose, v.text, v.muted, v.love, v.pine, v.gold, v.foam, v.iris, v.rose, v.text] });
family("rose-pine", "Rosé Pine", { license: MIT, copyright: "Copyright (c) mvllow", source: "https://github.com/rose-pine/palette (palette.json, LICENSE)" }, [rpTheme("Rosé Pine", rp.main, "dark"), rpTheme("Rosé Pine Moon", rp.moon, "dark"), rpTheme("Rosé Pine Dawn", rp.dawn, "light")]);

// One Dark / One Light — https://github.com/atom/atom (packages/one-{dark,light}-syntax/styles/colors.less), hsl() resolved to hex
const od = { bg: hsl(220, 13, 18), mono1: hsl(220, 14, 71), mono2: hsl(220, 9, 55), mono3: hsl(220, 10, 40), h1: hsl(187, 47, 55), h2: hsl(207, 82, 66), h3: hsl(286, 60, 67), h4: hsl(95, 38, 62), h5: hsl(355, 65, 65), h52: hsl(5, 48, 51), h6: hsl(29, 54, 61), h62: hsl(39, 67, 69) };
const ol = { bg: hsl(230, 1, 98), mono1: hsl(230, 8, 24), mono2: hsl(230, 6, 44), mono3: hsl(230, 4, 64), h1: hsl(198, 99, 37), h2: hsl(221, 87, 60), h3: hsl(301, 63, 40), h4: hsl(119, 34, 47), h5: hsl(5, 74, 59), h52: hsl(344, 84, 43), h6: hsl(35, 99, 36), h62: hsl(35, 99, 40) };
const oneAnsi = (c, black, white) => [black, c.h5, c.h4, c.h62, c.h2, c.h3, c.h1, white, c.mono3, c.h52, c.h4, c.h6, c.h2, c.h3, c.h1, c.mono1];
family("one", "One", { license: MIT, copyright: "Copyright (c) 2011-2022 GitHub Inc.", source: "https://github.com/atom/atom (packages/one-dark-syntax and one-light-syntax styles/colors.less, LICENSE.md)" }, [
  theme("One Dark", "dark", { canvas: od.bg, sidebar: mix(od.bg, "#000000", 0.18), surface: mix(od.bg, od.mono1, 0.07), raised: mix(od.bg, od.mono1, 0.14), text: od.mono1, muted: od.mono2, accent: od.h2, accentStrong: od.h3, red: od.h5, green: od.h4, yellow: od.h62, blue: od.h2, magenta: od.h3, cyan: od.h1, orange: od.h6, comment: od.mono3, ansi: oneAnsi(od, mix(od.bg, "#000000", 0.18), od.mono1) }),
  theme("One Light", "light", { canvas: ol.bg, sidebar: mix(ol.bg, ol.mono1, 0.05), surface: "#ffffff", raised: mix(ol.bg, ol.mono1, 0.08), text: ol.mono1, muted: ol.mono2, accent: ol.h2, accentStrong: ol.h3, red: ol.h52, green: ol.h4, yellow: ol.h6, blue: ol.h2, magenta: ol.h3, cyan: ol.h1, orange: ol.h62, comment: ol.mono3, ansi: oneAnsi(ol, ol.mono1, ol.mono3) }),
]);

// Everforest (medium) — https://github.com/sainnhe/everforest (autoload/everforest.vim, LICENSE)
const efd = { bg_dim: "#232a2e", bg0: "#2d353b", bg1: "#343f44", bg2: "#3d484d", fg: "#d3c6aa", red: "#e67e80", orange: "#e69875", yellow: "#dbbc7f", green: "#a7c080", aqua: "#83c092", blue: "#7fbbb3", purple: "#d699b6", grey0: "#7a8478", grey1: "#859289", grey2: "#9da9a0" };
const efl = { bg_dim: "#efebd4", bg0: "#fdf6e3", bg1: "#f4f0d9", bg2: "#efebd4", fg: "#5c6a72", red: "#f85552", orange: "#f57d26", yellow: "#dfa000", green: "#8da101", aqua: "#35a77c", blue: "#3a94c5", purple: "#df69ba", grey0: "#a6b0a0", grey1: "#939f91", grey2: "#829181" };
const efTheme = (name, e, appearance) => theme(name, appearance, { canvas: e.bg0, sidebar: e.bg_dim, surface: e.bg1, raised: e.bg2, text: e.fg, muted: e.grey2, accent: e.green, accentStrong: e.aqua, red: e.red, green: e.green, yellow: e.yellow, blue: e.blue, magenta: e.purple, cyan: e.aqua, orange: e.orange, comment: e.grey1, ansi: [appearance === "dark" ? e.bg2 : e.fg, e.red, e.green, e.yellow, e.blue, e.purple, e.aqua, appearance === "dark" ? e.fg : e.grey2, e.grey0, e.red, e.green, e.yellow, e.blue, e.purple, e.aqua, e.fg] });
family("everforest", "Everforest", { license: MIT, copyright: "Copyright (c) 2019 sainnhe", source: "https://github.com/sainnhe/everforest (autoload/everforest.vim, LICENSE)" }, [efTheme("Everforest Dark", efd, "dark"), efTheme("Everforest Light", efl, "light")]);

// Kanagawa — https://github.com/rebelot/kanagawa.nvim (lua/kanagawa/colors.lua, extras/kitty/kanagawa.conf)
family("kanagawa", "Kanagawa", { license: MIT, copyright: "Copyright (c) 2021 Tommaso Laurenzi", source: "https://github.com/rebelot/kanagawa.nvim (lua/kanagawa/colors.lua, extras/kitty/kanagawa.conf, LICENSE)" }, [
  theme("Kanagawa Wave", "dark", { canvas: "#1F1F28", sidebar: "#16161D", surface: "#2A2A37", raised: "#363646", text: "#DCD7BA", muted: "#C8C093", accent: "#7E9CD8", accentStrong: "#957FB8", red: "#E46876", green: "#98BB6C", yellow: "#E6C384", blue: "#7E9CD8", magenta: "#957FB8", cyan: "#7AA89F", orange: "#FFA066", comment: "#727169", ansi: ["#16161D", "#C34043", "#76946A", "#C0A36E", "#7E9CD8", "#957FB8", "#6A9589", "#C8C093", "#727169", "#E82424", "#98BB6C", "#E6C384", "#7FB4CA", "#938AA9", "#7AA89F", "#DCD7BA"] }),
  theme("Kanagawa Lotus", "light", { canvas: "#f2ecbc", sidebar: "#e5ddb0", surface: "#e7dba0", raised: "#dcd5ac", text: "#545464", muted: "#43436c", accent: "#4d699b", accentStrong: "#624c83", red: "#c84053", green: "#6f894e", yellow: "#77713f", blue: "#4d699b", magenta: "#b35b79", cyan: "#597b75", orange: "#cc6d00", comment: "#8a8980", ansi: ["#1F1F28", "#c84053", "#6f894e", "#77713f", "#4d699b", "#b35b79", "#597b75", "#545464", "#8a8980", "#d7474b", "#6e915f", "#836f4a", "#6693bf", "#624c83", "#5e857a", "#43436c"] }),
]);

// Night Owl — https://github.com/sdras/night-owl-vscode-theme (themes/*.json, LICENSE.md)
family("night-owl", "Night Owl", { license: MIT, copyright: "Copyright (c) 2018 Sarah Drasner", source: "https://github.com/sdras/night-owl-vscode-theme (themes/Night Owl-color-theme.json, Night Owl-Light-color-theme.json, LICENSE.md)" }, [
  theme("Night Owl", "dark", { canvas: "#011627", sidebar: "#010e1a", surface: "#0b2942", raised: "#1d3b53", text: "#d6deeb", muted: "#a2aabc", accent: "#82AAFF", accentStrong: "#C792EA", red: "#EF5350", green: "#22da6e", yellow: "#c5e478", blue: "#82AAFF", magenta: "#C792EA", cyan: "#21c7a8", orange: "#F78C6C", comment: "#637777", ansi: ["#011627", "#EF5350", "#22da6e", "#c5e478", "#82AAFF", "#C792EA", "#21c7a8", "#ffffff", "#575656", "#EF5350", "#22da6e", "#ffeb95", "#82AAFF", "#C792EA", "#7fdbca", "#ffffff"] }),
  theme("Night Owl Light", "light", { canvas: "#FBFBFB", sidebar: "#F0F0F0", surface: "#ffffff", raised: "#E0E0E0", text: "#403f53", muted: "#5f5e70", accent: "#2AA298", accentStrong: "#288ed7", red: "#de3d3b", green: "#08916a", yellow: "#E0AF02", blue: "#288ed7", magenta: "#d6438a", cyan: "#2AA298", orange: "#AA0982", comment: "#989fb1", ansi: ["#403f53", "#de3d3b", "#08916a", "#E0AF02", "#288ed7", "#d6438a", "#2AA298", "#93A1A1", "#403f53", "#de3d3b", "#08916a", "#daaa01", "#288ed7", "#d6438a", "#2AA298", "#93A1A1"] }),
]);

// Monokai — values from VS Code's built-in Monokai theme (microsoft/vscode, MIT), which
// says it is "based on the original Monokai" by Wimer Hazenberg (no separate license).
family("monokai", "Monokai", { license: "MIT (VS Code's built-in Monokai theme file)", copyright: "Copyright (c) 2015 - present Microsoft Corporation; palette based on the original Monokai by Wimer Hazenberg", source: "https://github.com/microsoft/vscode (extensions/theme-monokai/themes/monokai-color-theme.json, LICENSE.txt)" }, [
  theme("Monokai", "dark", { canvas: "#272822", sidebar: "#1e1f1c", surface: "#31322b", raised: "#3e3d32", text: "#f8f8f2", muted: "#a59f85", accent: "#A6E22E", accentStrong: "#66D9EF", red: "#f92672", green: "#A6E22E", yellow: "#e6db74", blue: "#66D9EF", magenta: "#AE81FF", cyan: "#66D9EF", orange: "#fd971f", comment: "#75715e", ansi: ["#333333", "#C4265E", "#86B42B", "#B3B42B", "#6A7EC8", "#8C6BC8", "#56ADBC", "#e3e3dd", "#666666", "#f92672", "#A6E22E", "#e2e22e", "#819aff", "#AE81FF", "#66D9EF", "#f8f8f2"] }),
]);

// High contrast — original Skai themes, 7:1 everywhere.
family("high-contrast", "Skai High Contrast", { license: "Original Skai Desktop theme (same license as the app)", copyright: "", source: "" }, [
  theme("High Contrast Dark", "dark", { highContrast: true, canvas: "#000000", sidebar: "#000000", surface: "#0a0a0a", raised: "#161616", text: "#ffffff", muted: "#d6d6d6", accent: "#ffd60a", accentStrong: "#7fdcff", red: "#ff8a8a", green: "#5cff8f", yellow: "#ffd60a", blue: "#7fdcff", magenta: "#ff9cf2", cyan: "#5cf2ff", orange: "#ffb35c", comment: "#c2c2c2", ansi: ["#000000", "#ff8a8a", "#5cff8f", "#ffd60a", "#7fdcff", "#ff9cf2", "#5cf2ff", "#ffffff", "#9e9e9e", "#ffb3b3", "#9dffbe", "#ffe866", "#b3ebff", "#ffc4f7", "#a3f7ff", "#ffffff"] }),
  theme("High Contrast Light", "light", { highContrast: true, canvas: "#ffffff", sidebar: "#ffffff", surface: "#ffffff", raised: "#f0f0f0", text: "#000000", muted: "#2b2b2b", accent: "#0035a8", accentStrong: "#6b00a8", red: "#a10000", green: "#005a1e", yellow: "#5c4300", blue: "#0035a8", magenta: "#8a0070", cyan: "#00525c", orange: "#7a3300", comment: "#3d3d3d", ansi: ["#000000", "#a10000", "#005a1e", "#5c4300", "#0035a8", "#8a0070", "#00525c", "#3d3d3d", "#2b2b2b", "#c40000", "#007a29", "#7a5a00", "#0047e0", "#b00090", "#006e7a", "#000000"] }),
]);

function buildFamilies() {
  return Object.entries(SOURCES).map(([id, entry]) => {
    const adjusted = [];
    const themes = entry.themes.map((item) => { const mapped = mapPalette(item.palette); adjusted.push(...mapped.adjusted.map((change) => ({ theme: item.name, ...change }))); return { name: item.name, appearance: item.appearance, colors: mapped.colors }; });
    const license = entry.copyright ? `${entry.license}. ${entry.copyright}. Source: ${entry.source}` : entry.license;
    return { id, json: { $schema: "../../../../../docs/theme.schema.json", name: entry.name, author: entry.copyright ? entry.copyright.replace(/^Copyright \(c\) [\d\s-]*(present)?\s*/, "").replace(/;.*$/, "") : "Skai Desktop", license, ...(adjusted.length ? { adjusted } : {}), themes } };
  });
}

const MIT_TEXT = `Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

// licenses/THEME-PALETTES.md: every community palette's copyright, license and source.
function buildNotices() {
  const entries = Object.values(SOURCES).filter((entry) => entry.copyright);
  return `# Theme palette licenses

Skai Desktop's built-in theme gallery includes color palettes from these projects. Values were copied
from each project's own repository (listed under "Source") and mapped onto Skai's color keys by
\`scripts/theme-community.cjs\`. Where a color had to change to meet WCAG AA in this app, the change is
listed in that preset's \`adjusted\` field (\`apps/desktop/src/theme/presets/\`). This file is generated.

${entries.map((entry) => `## ${entry.name}

- License: ${entry.license}
- ${entry.copyright}
- Source: ${entry.source}
`).join("\n")}
## MIT License text

Applies to every palette above marked MIT or MIT/X11, each under its own copyright line.

${MIT_TEXT}

## Apache License 2.0

Applies to Tokyo Night. The full license text is in [Apache-2.0.txt](Apache-2.0.txt).
`;
}
const noticesPath = path.join(__dirname, "..", "licenses", "THEME-PALETTES.md");

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;
if (require.main === module && process.argv.includes("--write")) {
  for (const { id, json } of buildFamilies()) fs.writeFileSync(path.join(presetDir, `${id}.json`), serialize(json));
  fs.writeFileSync(noticesPath, buildNotices());
  console.log(`Wrote ${Object.keys(SOURCES).length} community preset families.`);
}
module.exports = { buildFamilies, buildNotices, noticesPath, serialize, presetDir, SOURCES, contrast };
