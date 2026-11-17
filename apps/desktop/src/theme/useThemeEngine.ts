import { useEffect } from "react";
import type { AgentResponse } from "../../shared/contracts";
import type { ThemeMode } from "../app/types";
import { themeEngine } from "./themeEngine";
import "./surfaces.css";

type Request = (method: string, params?: Record<string, unknown>) => Promise<AgentResponse>;

export function resolveScheme(themeMode: ThemeMode, prefersDark: boolean): "light" | "dark" {
  return themeMode === "system" ? (prefersDark ? "dark" : "light") : themeMode;
}

export function useThemeEngine(request: Request, themeMode: ThemeMode) {
  // Theme: load built-in and user themes and keep them live-reloading.
  useEffect(() => { themeEngine.start(request); }, [request]);

  // Theme: keep Electron's nativeTheme in step with the app's Light/Dark/System pick
  // (otherwise select popups, scrollbars, dialogs and the window frame follow the OS),
  // and publish the resolved scheme as <html data-scheme="light|dark"> so tokens.css
  // writes each palette once. System follows OS changes live. Switching from an
  // explicit mode to System, Chromium's prefers-color-scheme updates a moment after
  // nativeTheme does, so the bridge's answer (dark or not) is applied straight away.
  useEffect(() => {
    let current = true;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = (prefersDark: boolean) => {
      if (!current) return;
      const scheme = resolveScheme(themeMode, prefersDark);
      document.documentElement.dataset.scheme = scheme;
      themeEngine.setScheme(scheme);
    };
    const onChange = () => apply(media.matches);
    apply(media.matches);
    media.addEventListener("change", onChange);
    if (window.skaiAgent) {
      void request("appearance.setNativeTheme", { mode: themeMode })
        .then((response) => { const result = response.result as { dark?: unknown } | undefined; if (response.ok && typeof result?.dark === "boolean") apply(result.dark); })
        .catch(() => undefined);
    }
    return () => { current = false; media.removeEventListener("change", onChange); };
  }, [request, themeMode]);
}
