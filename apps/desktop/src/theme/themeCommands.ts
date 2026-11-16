import { themeEngine } from "./themeEngine";

// Theme: command palette entries (see components/overlays/CommandPalette.tsx).
export const themeCommands = [
  { id: "theme-open-folder", label: "Theme: Open themes folder", detail: "Your theme files (JSON), watched for live reload", run: () => void themeEngine.openFolder() },
  { id: "theme-edit", label: "Theme: Edit current theme", detail: "Open the active theme file in your editor", run: () => void themeEngine.editCurrent() },
  { id: "theme-duplicate", label: "Theme: Duplicate as my theme", detail: "Copy the active theme into your themes folder", run: () => void themeEngine.duplicateCurrent() },
  { id: "theme-import", label: "Theme: Import Base16/Base24 scheme", detail: "Convert a .yaml scheme into a Skai theme", run: () => void themeEngine.importBase16() },
  { id: "theme-export", label: "Theme: Export current theme", detail: "Save the active theme as a JSON file", run: () => void themeEngine.exportCurrent() },
  { id: "theme-reload", label: "Theme: Reload themes", detail: "Re-read the themes folder", run: () => void themeEngine.reload() },
  { id: "theme-reset", label: "Theme: Reset to default", detail: "Back to Skai Light and Skai Dark", run: () => void themeEngine.resetToDefault() },
];
