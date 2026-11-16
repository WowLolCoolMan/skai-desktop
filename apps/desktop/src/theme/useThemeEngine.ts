import { useEffect } from "react";
import type { AgentResponse } from "../../shared/contracts";
import type { ThemeMode } from "../app/types";
import { themeEngine } from "./themeEngine";

type Request = (method: string, params?: Record<string, unknown>) => Promise<AgentResponse>;

export function resolveScheme(themeMode: ThemeMode, prefersDark: boolean): "light" | "dark" {
  return themeMode === "system" ? (prefersDark ? "dark" : "light") : themeMode;
}

export function useThemeEngine(request: Request, themeMode: ThemeMode) {
  // Theme: load built-in and user themes and keep them live-reloading.
  useEffect(() => { themeEngine.start(request); }, [request]);

  // Theme: keep Electron's nativeTheme in step with the app's Light/Dark/System pick.
  // Without it, native pieces (select popups, scrollbars, dialogs, the window frame)
  // follow the OS theme, so a dark app on a light desktop gets light popups.
  useEffect(() => {
    if (!window.skaiAgent) return;
    void request("appearance.setNativeTheme", { mode: themeMode }).catch(() => undefined);
  }, [request, themeMode]);

  // Theme: publish the resolved scheme as <html data-scheme="light|dark"> (tokens.css
  // writes each palette once) and apply the picked light or dark theme. System
  // follows OS changes live.
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const scheme = resolveScheme(themeMode, media.matches);
      document.documentElement.dataset.scheme = scheme;
      themeEngine.setScheme(scheme);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [themeMode]);
}
