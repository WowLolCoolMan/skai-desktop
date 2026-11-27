import { useEffect, useRef, useState } from "react";
import type { Route } from "../../app/types";
import { Button, StatusBadge } from "../ui/Primitives";
import { NavIcon } from "../ui/NavIcon";
import { PRODUCT_DISPLAY_NAME } from "../../../shared/productIdentity";
import { unlockAchievement } from "../../features/settings/easterEggs";
import { commandPreferencesEvent, readCommandPreferences } from "../../features/commands/preferences";

const SKAI_WOLF_ICON = new URL("../../../../../assets/branding/skaiwolficon.png", import.meta.url).href;

type MenuItem = { label: string; shortcut?: string; onSelect: () => void; separatorBefore?: boolean };
export type WorkspaceLayoutPreset = "chat" | "coding" | "review" | "research" | "media";
const ariaShortcut = (shortcut?: string) => shortcut?.replace(/^Ctrl\+/, "Control+").replace(/^⌘\+/, "Meta+");
const routeLabels: Partial<Record<Route, string>> = { chat: "Chat", projects: "Projects", coding: "Coding", models: "Models", compare: "Compare", images: "Visuals", video: "Video", marketplace: "Marketplace", plugins: "Tools", terminal: "Terminal", memory: "Memory", usage: "Usage", scheduled: "Scheduled", search: "Search", settings: "Settings", onboarding: "Getting started", workbench: "Workspace", "voice-workbench": "Voice", "persona-workshop": "Personas", personas: "Personas", "persona-groups": "Personas", "pet-workshop": "Pet workshop" };

function AppMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  return <div className="app-menu" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <button className="app-menu-trigger" type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{label}</button>
    {open && <div className="app-menu-popover" role="menu" aria-label={`${label} menu`}>{items.map((item) => <button key={`${label}-${item.label}`} className={`app-menu-item ${item.separatorBefore ? "has-separator" : ""}`} type="button" role="menuitem" aria-keyshortcuts={ariaShortcut(item.shortcut)} title={item.shortcut ? `${item.label} (${item.shortcut})` : item.label} onMouseDown={(event) => event.preventDefault()} onClick={() => { setOpen(false); item.onSelect(); }}><span>{item.label}</span>{item.shortcut && <kbd>{item.shortcut}</kbd>}</button>)}</div>}
  </div>;
}

export function Toolbar({ route = "chat", contextDetail, modeLabel, connection, canGoBack, canGoForward, onBack, onForward, onRetryConnection, onNavigate, onNewChat, onOpenCommandPalette, onApplyLayoutPreset, onToggleSidebar, sidebarOpen = false, windowsTitleBarOverlay = false }: { route?: Route; contextDetail?: string; modeLabel?: string; connection: "checking" | "ready" | "error"; canGoBack: boolean; canGoForward: boolean; onBack: () => void; onForward: () => void; onRetryConnection: () => void; onNavigate: (route: Route) => void; onNewChat: () => void; onOpenCommandPalette: () => void; onApplyLayoutPreset: (preset: WorkspaceLayoutPreset) => void; onToggleSidebar?: () => void; sidebarOpen?: boolean; windowsTitleBarOverlay?: boolean }) {
  const [helpPanel, setHelpPanel] = useState<"shortcuts" | "about" | null>(null);
  const [shortcuts, setShortcuts] = useState(() => readCommandPreferences().shortcuts);
  const logoTaps = useRef(0);
  const navigate = (nextRoute: Route) => () => onNavigate(nextRoute);
  useEffect(() => { const refresh = () => setShortcuts(readCommandPreferences().shortcuts); window.addEventListener(commandPreferencesEvent, refresh); return () => window.removeEventListener(commandPreferencesEvent, refresh); }, []);
  const shortcutLabel = (id: string) => { const value = shortcuts[id] ?? ""; return navigator.platform.toLowerCase().includes("mac") ? value.replace(/^Ctrl\+/, "⌘+") : value; };
  return <header className={`app-toolbar ${windowsTitleBarOverlay ? "is-titlebar-overlay" : ""}`}>
    {onToggleSidebar && <button className="toolbar-sidebar-toggle" type="button" aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"} title="Toggle sidebar (Ctrl+Shift+S)" aria-expanded={sidebarOpen} aria-controls="workspace-sidebar" onClick={onToggleSidebar}><NavIcon name="sidebar" /></button>}
    <button className="toolbar-brand" type="button" aria-label={`${PRODUCT_DISPLAY_NAME} logo`} title="Skai Desktop" onClick={() => { logoTaps.current += 1; if (logoTaps.current >= 7) { logoTaps.current = 0; unlockAchievement("mascot-fan"); } }}><img src={SKAI_WOLF_ICON} alt="" aria-hidden="true" /></button>
    <nav className="app-menu-bar" aria-label="Application menu">
      <AppMenu label="Skai" items={[{ label: "Quick actions…", shortcut: shortcutLabel("palette"), onSelect: onOpenCommandPalette }, { label: "New chat", shortcut: shortcutLabel("newChat"), onSelect: onNewChat }, { label: "Projects", onSelect: navigate("projects"), separatorBefore: true }, { label: "Coding workspace", shortcut: shortcutLabel("coding"), onSelect: navigate("coding") }, { label: "Settings", shortcut: shortcutLabel("settings"), onSelect: navigate("settings") }]} />
      <AppMenu label="Edit" items={[{ label: "Undo", shortcut: "Ctrl+Z", onSelect: () => document.execCommand("undo") }, { label: "Redo", shortcut: "Ctrl+Y", onSelect: () => document.execCommand("redo") }, { label: "Cut", shortcut: "Ctrl+X", onSelect: () => document.execCommand("cut"), separatorBefore: true }, { label: "Copy", shortcut: "Ctrl+C", onSelect: () => document.execCommand("copy") }, { label: "Paste", shortcut: "Ctrl+V", onSelect: () => document.execCommand("paste") }, { label: "Select all", shortcut: "Ctrl+A", onSelect: () => document.execCommand("selectAll"), separatorBefore: true }]} />
      <AppMenu label="View" items={[{ label: "Chat focus", shortcut: "Ctrl+Alt+1", onSelect: () => onApplyLayoutPreset("chat") }, { label: "Coding", shortcut: "Ctrl+Alt+2", onSelect: () => onApplyLayoutPreset("coding") }, { label: "Review", shortcut: "Ctrl+Alt+3", onSelect: () => onApplyLayoutPreset("review") }, { label: "Research", shortcut: "Ctrl+Alt+4", onSelect: () => onApplyLayoutPreset("research") }, { label: "Media", shortcut: "Ctrl+Alt+5", onSelect: () => onApplyLayoutPreset("media") }]} />
      <AppMenu label="Help" items={[{ label: "Keyboard shortcuts", onSelect: () => setHelpPanel("shortcuts") }, { label: "About Skai Desktop", onSelect: () => setHelpPanel("about"), separatorBefore: true }]} />
    </nav>
    <div className="toolbar-route-context" aria-live="polite"><NavIcon name={route === "chat" ? "chat" : route === "coding" ? "code" : route === "settings" ? "settings" : "project"} /><span className="toolbar-route-context-copy"><strong>{routeLabels[route] ?? "Workspace"}</strong>{contextDetail && <small title={contextDetail}>{contextDetail}</small>}</span>{modeLabel && <span className="toolbar-mode-chip">{modeLabel}</span>}</div>
    <div className="toolbar-history"><Button variant="ghost" aria-label="Go back" title="Go back" disabled={!canGoBack} onClick={onBack}><NavIcon name="chevron-left" /></Button><Button variant="ghost" aria-label="Go forward" title="Go forward" disabled={!canGoForward} onClick={onForward}><NavIcon name="chevron-right" /></Button></div>
    <div className="toolbar-actions"><StatusBadge tone={connection === "ready" ? "success" : connection === "error" ? "danger" : "warning"}>{connection === "ready" ? "Agent ready" : connection === "error" ? "Offline" : "Connecting"}</StatusBadge>{connection === "error" && <Button variant="ghost" onClick={onRetryConnection}>Retry connection</Button>}</div>
    {helpPanel && <div className="app-help-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setHelpPanel(null); }}><section className="app-help-dialog" role="dialog" aria-modal="true" aria-labelledby="app-help-title"><button className="app-help-close" type="button" aria-label="Close help" onClick={() => setHelpPanel(null)}>×</button><p className="eyebrow">SKAI DESKTOP</p><h2 id="app-help-title">{helpPanel === "shortcuts" ? "Keyboard shortcuts" : "About Skai Desktop"}</h2>{helpPanel === "shortcuts" ? <dl><div><dt>New chat</dt><dd><kbd>{shortcutLabel("newChat")}</kbd></dd></div><div><dt>Quick actions</dt><dd><kbd>{shortcutLabel("palette")}</kbd></dd></div><div><dt>Settings</dt><dd><kbd>{shortcutLabel("settings")}</kbd></dd></div><div><dt>Chat</dt><dd><kbd>{shortcutLabel("chat")}</kbd></dd></div><div><dt>Coding workspace</dt><dd><kbd>{shortcutLabel("coding")}</kbd></dd></div><div><dt>Terminal</dt><dd><kbd>{shortcutLabel("terminal")}</kbd></dd></div><div><dt>Chat, coding, review, research, media layouts</dt><dd><kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>1–5</kbd></dd></div><div><dt>Find file</dt><dd><kbd>Ctrl</kbd> + <kbd>P</kbd></dd></div></dl> : <p className="app-help-about">A local-first workspace for chat, coding, and creative tools.</p>}<Button variant="secondary" type="button" onClick={() => setHelpPanel(null)}>Done</Button></section></div>}
  </header>;
}
