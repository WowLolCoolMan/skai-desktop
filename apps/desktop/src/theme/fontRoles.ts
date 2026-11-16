import type { ThemeFont } from "../../shared/contracts";

// Theme: font roles. A theme (or Appearance) may set family, size, weight, line
// height and letter spacing for four roles. Values arrive validated (theme-files.cjs);
// they are re-checked here and the CSS is built by this code only: family names
// are quoted, numbers are clamped, nothing from a file is copied as CSS.

export const FONT_ROLES = ["ui", "heading", "reading", "code"] as const;
export type FontRole = typeof FONT_ROLES[number];
export type FontRoles = Partial<Record<FontRole, ThemeFont>>;

// Fallbacks after the chosen font: system UI font, then a generic family.
const FALLBACK: Record<FontRole, string> = {
  ui: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  heading: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  reading: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  code: 'ui-monospace, "Cascadia Code", Consolas, monospace',
};
// Reference sizes the role "size" is measured against (px).
const REFERENCE_SIZE: Record<FontRole, number> = { ui: 13, heading: 20, reading: 13, code: 12 };
// Where each role's weight / line height / letter spacing (and the reading size) apply.
const SELECTORS: Record<FontRole, string> = {
  ui: ":root",
  heading: "h1, h2, h3, h4, h5, h6",
  reading: ".message-content, .message-content p, .message-content li",
  code: "pre, code, kbd, samp, .terminal-result, .git-diff-preview, .diff-preview, .file-editor-panel textarea, .terminal-command-row input",
};

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,62}$/;
const clamp = (value: unknown, min: number, max: number) => (typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : undefined);

export function familyStack(role: FontRole, family: string[] | undefined): string | undefined {
  const names = (family ?? []).filter((name) => SAFE_NAME.test(name)).slice(0, 4);
  return names.length ? `${names.map((name) => `"${name}"`).join(", ")}, ${FALLBACK[role]}` : undefined;
}

export type FontRoleOutput = { properties: Record<string, string>; css: string };

export function buildFontRoles(roles: FontRoles): FontRoleOutput {
  const properties: Record<string, string> = {};
  const rules: string[] = [];
  for (const role of FONT_ROLES) {
    const font = roles[role];
    if (!font) continue;
    const stack = familyStack(role, font.family);
    if (stack) properties[`--skai-font-${role}`] = stack;
    const size = clamp(font.size, 8, 32);
    if (size !== undefined) {
      const ratio = (size / REFERENCE_SIZE[role]).toFixed(4);
      if (role === "ui") properties["--skai-text-scale"] = ratio;
      if (role === "heading") properties["--skai-heading-scale"] = ratio;
      if (role === "code") properties["--skai-code-scale"] = ratio;
    }
    const declarations: string[] = [];
    if (role === "reading" && size !== undefined) declarations.push(`font-size: ${size}px`);
    const weight = clamp(font.weight, 100, 900);
    if (weight !== undefined) declarations.push(`font-weight: ${Math.round(weight)}`);
    const lineHeight = clamp(font.lineHeight, 1, 2.5);
    if (lineHeight !== undefined) declarations.push(`line-height: ${lineHeight}`);
    const letterSpacing = clamp(font.letterSpacing, -0.1, 0.3);
    if (letterSpacing !== undefined) declarations.push(`letter-spacing: ${letterSpacing}em`);
    // !important: an explicit role choice beats per-component defaults in styles.css.
    if (declarations.length) rules.push(`${SELECTORS[role]} { ${declarations.map((d) => `${d} !important`).join("; ")}; }`);
  }
  return { properties, css: rules.join("\n") };
}
