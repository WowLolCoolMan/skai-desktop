import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { Monaco } from "@monaco-editor/react";
import { parseCssColor } from "./gradients";
import { themeStore } from "./themeEngine";

// Theme: the Monaco editor follows the active theme. Its colors and syntax rules are
// built from the --skai-* tokens (code surface and text, syntax colors, selection, diff
// colors), its font from the code role, and the theme is redefined live on changes.

const THEME_NAME = "skai";
const read = (token: string) => getComputedStyle(document.documentElement).getPropertyValue(token).trim();
// Monaco only accepts #rrggbb / #rrggbbaa.
function hex(token: string, withAlpha = false): string | undefined {
  const rgba = parseCssColor(read(token));
  if (!rgba) return undefined;
  const channels = rgba.slice(0, 3).map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");
  return withAlpha && rgba[3] < 1 ? `#${channels}${Math.round(rgba[3] * 255).toString(16).padStart(2, "0")}` : `#${channels}`;
}

function buildTheme() {
  const light = document.documentElement.dataset.scheme === "light";
  const rule = (token: string, key: string) => ({ token, foreground: hex(`--skai-syntax-${key}`)?.slice(1) ?? "" });
  const colors: Record<string, string | undefined> = {
    "editor.background": hex("--skai-color-code-surface"),
    "editor.foreground": hex("--skai-color-code-text"),
    "editorGutter.background": hex("--skai-color-code-surface"),
    "editorLineNumber.foreground": hex("--skai-color-text-muted"),
    "editorLineNumber.activeForeground": hex("--skai-color-text"),
    "editorCursor.foreground": hex("--skai-color-accent"),
    "editor.selectionBackground": hex("--skai-color-selection", true),
    "editor.lineHighlightBackground": hex("--skai-color-surface-soft", true),
    "editorIndentGuide.background1": hex("--skai-color-border", true),
    "editorWidget.background": hex("--skai-color-surface-raised"),
    "editorWidget.border": hex("--skai-color-border-strong", true),
    "diffEditor.insertedTextBackground": hex("--skai-color-diff-added-surface", true),
    "diffEditor.removedTextBackground": hex("--skai-color-diff-removed-surface", true),
    "scrollbarSlider.background": hex("--skai-color-scrollbar-thumb", true),
  };
  return {
    base: light ? "vs" as const : "vs-dark" as const,
    inherit: true,
    rules: [rule("comment", "comment"), rule("keyword", "keyword"), rule("string", "string"), rule("number", "number"), rule("type", "type"), rule("type.identifier", "type"), rule("function", "function"), rule("variable", "variable"), rule("identifier", "variable"), rule("delimiter", "punctuation")].filter((item) => item.foreground),
    colors: Object.fromEntries(Object.entries(colors).filter((entry): entry is [string, string] => Boolean(entry[1]))),
  };
}

export function useMonacoTheme() {
  const state = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot);
  const monacoRef = useRef<Monaco | null>(null);
  const apply = useCallback((monaco: Monaco) => { monaco.editor.defineTheme(THEME_NAME, buildTheme()); monaco.editor.setTheme(THEME_NAME); }, []);
  // Redefine on any theme, scheme, font or option change (tokens are already applied by then).
  useEffect(() => { if (monacoRef.current) apply(monacoRef.current); }, [apply, state.active, state.scheme, state.previewThemeId, state.options, state.userFonts]);
  const codeScale = Number(read("--skai-code-scale")) || 1;
  return {
    theme: THEME_NAME,
    beforeMount: (monaco: Monaco) => { monacoRef.current = monaco; apply(monaco); },
    fontOptions: { fontFamily: read("--skai-font-code") || undefined, fontSize: Math.round(13 * codeScale) },
  };
}
