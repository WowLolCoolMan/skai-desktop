import { useEffect } from "react";
import type { AgentResponse } from "../../shared/contracts";
import type { ThemeMode } from "../app/types";

type Request = (method: string, params?: Record<string, unknown>) => Promise<AgentResponse>;

// Theme: keep Electron's nativeTheme in step with the app's Light/Dark/System pick.
// Without it, native pieces (select popups, scrollbars, dialogs, the window frame)
// follow the OS theme, so a dark app on a light desktop gets light popups.
export function useNativeThemeSync(request: Request, themeMode: ThemeMode) {
  useEffect(() => {
    if (!window.skaiAgent) return;
    void request("appearance.setNativeTheme", { mode: themeMode }).catch(() => undefined);
  }, [request, themeMode]);
}
