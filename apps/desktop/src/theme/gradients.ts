import type { ThemeGradient } from "../../shared/contracts";

// Theme: gradients. Built by this code from validated stops (theme-files.cjs), never
// copied from a file. Each surface's background becomes --skai-bg-<surface>, and
// src/theme/surfaces.css only paints it when <html data-skai-gradient-<surface>> is set.

export const GRADIENT_SURFACES = ["canvas", "sidebar", "toolbar", "rail", "composer", "user-bubble", "primary-button", "brand-mark", "empty-state", "backdrop"] as const;
export type GradientSurface = typeof GRADIENT_SURFACES[number];

// Text token that sits on each surface (used for the per-stop contrast check).
export const SURFACE_TEXT: Record<GradientSurface, string[]> = {
  canvas: ["--skai-color-text", "--skai-color-text-muted"],
  sidebar: ["--skai-color-sidebar-text", "--skai-color-sidebar-muted"],
  toolbar: ["--skai-color-text"],
  rail: ["--skai-color-sidebar-icon"],
  composer: ["--skai-color-text"],
  "user-bubble": ["--skai-color-text"],
  "primary-button": ["--skai-color-on-accent"],
  "brand-mark": ["--skai-color-on-brand-mark"],
  "empty-state": ["--skai-color-text", "--skai-color-text-muted"],
  backdrop: ["--skai-color-text"],
};

const SAFE_COLOR = /^(?:#[0-9a-f]{3,8}|(?:rgb|hsl)\([0-9.%deg /]+\)|transparent)$/i;

export function gradientCss(gradient: ThemeGradient): string | null {
  if (gradient.gradient === "solid") return SAFE_COLOR.test(gradient.color) ? gradient.color : null;
  if (!Array.isArray(gradient.stops) || gradient.stops.length < 2 || gradient.stops.length > 8) return null;
  const stops: string[] = [];
  for (const stop of gradient.stops) {
    if (!SAFE_COLOR.test(stop.color) || typeof stop.at !== "number" || stop.at < 0 || stop.at > 1) return null;
    stops.push(`${stop.color} ${Math.round(stop.at * 1000) / 10}%`);
  }
  const angle = Math.min(360, Math.max(0, Number.isFinite(gradient.angle) ? gradient.angle : 180));
  if (gradient.gradient === "linear") return `linear-gradient(${angle}deg, ${stops.join(", ")})`;
  if (gradient.gradient === "radial") return `radial-gradient(ellipse at center, ${stops.join(", ")})`;
  if (gradient.gradient === "conic") return `conic-gradient(from ${angle}deg at 50% 50%, ${stops.join(", ")})`;
  return null;
}

// Contrast (WCAG 2.x). Colors are normalized by the browser's canvas parser, and
// translucent stops are blended over the canvas color first.
type Rgba = [number, number, number, number];
let parser: CanvasRenderingContext2D | null = null;
export function parseCssColor(value: string): Rgba | null {
  parser ??= document.createElement("canvas").getContext("2d");
  if (!parser || !value) return null;
  parser.fillStyle = "transparent"; // reset, so an invalid value reads back as transparent
  parser.fillStyle = value.trim();
  const normalized = String(parser.fillStyle);
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(normalized);
  if (hex) return [parseInt(hex[1], 16), parseInt(hex[2], 16), parseInt(hex[3], 16), 1];
  const rgba = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/.exec(normalized);
  return rgba ? [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), rgba[4] === undefined ? 1 : Number(rgba[4])] : null;
}
const blend = (top: Rgba, base: Rgba): Rgba => [0, 1, 2].map((i) => top[i] * top[3] + base[i] * (1 - top[3])).concat(1) as Rgba;
const luminance = ([r, g, b]: Rgba) => [r, g, b].map((c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
export function contrastRatio(a: Rgba, b: Rgba) { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); }

export type ContrastWarning = { surface: GradientSurface; stop: number; color: string; token: string; ratio: number };
// Text must pass against EVERY stop, not the average: 4.5:1 for text (muted too), 3:1 for rail icons.
export function gradientContrastWarnings(gradients: Partial<Record<GradientSurface, ThemeGradient>>, read: (token: string) => string): ContrastWarning[] {
  const base = parseCssColor(read("--skai-color-canvas")) ?? [0, 0, 0, 1];
  const warnings: ContrastWarning[] = [];
  for (const surface of GRADIENT_SURFACES) {
    const gradient = gradients[surface];
    if (!gradient) continue;
    const colors = gradient.gradient === "solid" ? [gradient.color] : gradient.stops.map((stop) => stop.color);
    for (const token of SURFACE_TEXT[surface]) {
      const text = parseCssColor(read(token));
      if (!text) continue;
      colors.forEach((color, index) => {
        const stop = parseCssColor(color);
        if (!stop) return;
        const ratio = contrastRatio(blend(text, base), blend(stop, base));
        const minimum = surface === "rail" || token.endsWith("-icon") ? 3 : 4.5;
        if (ratio < minimum) warnings.push({ surface, stop: index + 1, color, token, ratio: Math.round(ratio * 100) / 100 });
      });
    }
  }
  return warnings;
}
