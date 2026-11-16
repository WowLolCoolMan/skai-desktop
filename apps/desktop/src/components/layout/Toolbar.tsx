import { useState } from "react";
import type { Route } from "../../app/types";
import { Button, StatusBadge } from "../ui/Primitives";
import { NavIcon } from "../ui/NavIcon";
import { PRODUCT_DISPLAY_NAME } from "../../../shared/productIdentity";

const SKAI_WOLF_ICON = new URL("../../../../../assets/branding/skaiwolficon.png", import.meta.url).href;

const titles: Record<Route, string> = { chat: "Chat", projects: "Projects", coding: "Coding workspace", settings: "Settings", models: "Models", images: "Image Studio", marketplace: "Marketplace", plugins: "Marketplace", workbench: "Chat", terminal: "Terminal", memory: "Memory", usage: "Usage", "pet-workshop": "Pet Workshop", "voice-workbench": "Voice Workbench" };

type MenuItem = { label: string; shortcut?: string; onSelect: () => void; separatorBefore?: boolean };

function AppMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  return <div className="app-menu" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <button className="app-menu-trigger" type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{label}</button>
    {open && <div className="app-menu-popover" role="menu" aria-label={`${label} menu`}>{items.map((item) => <button key={`${label}-${item.label}`} className={`app-menu-item ${item.separatorBefore ? "has-separator" : ""}`} type="button" role="menuitem" onMouseDown={(event) => event.preventDefault()} onClick={() => { setOpen(false); item.onSelect(); }}><span>{item.label}</span>{item.shortcut && <kbd>{item.shortcut}</kbd>}</button>)}</div>}
  </div>;
}

function runEditCommand(command: string) {
  try { document.execCommand(command); } catch { /* Some commands are unavailable for the active control. */ }
}

export function Toolbar({ route, connection, canGoBack, canGoForward, onBack, onForward, onRetryConnection, onNavigate, onNewChat, onToggleSidebar, windowsTitleBarOverlay = false }: { route: Route; connection: "checking" | "ready" | "error"; canGoBack: boolean; canGoForward: boolean; onBack: () => void; onForward: () => void; onRetryConnection: () => void; onNavigate: (route: Route) => void; onNewChat: () => void; onToggleSidebar: () => void; windowsTitleBarOverlay?: boolean }) {
  const [helpPanel, setHelpPanel] = useState<"shortcuts" | "about" | null>(null);
  const editItems: MenuItem[] = [
    { label: "Undo", shortcut: "Ctrl+Z", onSelect: () => runEditCommand("undo") },
    { label: "Redo", shortcut: "Ctrl+Y", onSelect: () => runEditCommand("redo") },
    { label: "Cut", shortcut: "Ctrl+X", onSelect: () => runEditCommand("cut"), separatorBefore: true },
    { label: "Copy", shortcut: "Ctrl+C", onSelect: () => runEditCommand("copy") },
    { label: "Paste", shortcut: "Ctrl+V", onSelect: () => runEditCommand("paste") },
    { label: "Select all", shortcut: "Ctrl+A", onSelect: () => runEditCommand("selectAll"), separatorBefore: true },
  ];
  const navigate = (nextRoute: Route) => () => onNavigate(nextRoute);
  return <header className={`app-toolbar ${windowsTitleBarOverlay ? "is-titlebar-overlay" : ""}`}>
    <div className="toolbar-brand" role="img" aria-label={PRODUCT_DISPLAY_NAME}><img src={SKAI_WOLF_ICON} alt="" aria-hidden="true" /></div>
    <nav className="app-menu-bar" aria-label="Application menu">
      <AppMenu label="File" items={[{ label: "New chat", shortcut: "Ctrl+N", onSelect: onNewChat }, { label: "Projects", onSelect: navigate("projects"), separatorBefore: true }, { label: "Coding workspace", shortcut: "Ctrl+2", onSelect: navigate("coding") }]} />
      <AppMenu label="Edit" items={editItems} />
      <AppMenu label="View" items={[{ label: "Toggle sidebar", shortcut: "Ctrl+B", onSelect: onToggleSidebar }, { label: "Chat", shortcut: "Ctrl+1", onSelect: navigate("chat"), separatorBefore: true }, { label: "Images", onSelect: navigate("images") }, { label: "Marketplace", onSelect: navigate("marketplace") }, { label: "Settings", shortcut: "Ctrl+,", onSelect: navigate("settings") }]} />
      <AppMenu label="Help" items={[{ label: "Keyboard shortcuts", onSelect: () => setHelpPanel("shortcuts") }, { label: "About Skai Desktop", onSelect: () => setHelpPanel("about"), separatorBefore: true }]} />
    </nav>
    <div className="toolbar-history"><Button variant="ghost" aria-label="Go back" title="Go back" disabled={!canGoBack} onClick={onBack}><NavIcon name="chevron-left" /></Button><Button variant="ghost" aria-label="Go forward" title="Go forward" disabled={!canGoForward} onClick={onForward}><NavIcon name="chevron-right" /></Button></div>
    {route === "chat" && <div className="toolbar-title"><p className="eyebrow">LOCAL WORKSPACE</p><h1>{titles[route]}</h1></div>}
    <div className="toolbar-actions"><StatusBadge tone={connection === "ready" ? "success" : connection === "error" ? "danger" : "warning"}>{connection === "ready" ? "Agent ready" : connection === "error" ? "Offline" : "Connecting"}</StatusBadge>{connection === "error" && <Button variant="ghost" onClick={onRetryConnection}>Retry connection</Button>}</div>
    {helpPanel && <div className="app-help-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setHelpPanel(null); }}><section className="app-help-dialog" role="dialog" aria-modal="true" aria-labelledby="app-help-title"><button className="app-help-close" type="button" aria-label="Close help" onClick={() => setHelpPanel(null)}>×</button><p className="eyebrow">SKAI DESKTOP</p><h2 id="app-help-title">{helpPanel === "shortcuts" ? "Keyboard shortcuts" : "About Skai Desktop"}</h2>{helpPanel === "shortcuts" ? <dl><div><dt>New chat</dt><dd><kbd>Ctrl</kbd> + <kbd>N</kbd></dd></div><div><dt>Quick actions</dt><dd><kbd>Ctrl</kbd> + <kbd>K</kbd></dd></div><div><dt>Toggle sidebar</dt><dd><kbd>Ctrl</kbd> + <kbd>B</kbd></dd></div><div><dt>Chat</dt><dd><kbd>Ctrl</kbd> + <kbd>1</kbd></dd></div><div><dt>Coding workspace</dt><dd><kbd>Ctrl</kbd> + <kbd>2</kbd></dd></div><div><dt>Find file</dt><dd><kbd>Ctrl</kbd> + <kbd>P</kbd></dd></div><div><dt>Toggle terminal</dt><dd><kbd>Ctrl</kbd> + <kbd>J</kbd></dd></div></dl> : <p className="app-help-about">A local-first workspace for chat, coding, and creative tools.</p>}<Button variant="secondary" type="button" onClick={() => setHelpPanel(null)}>Done</Button></section></div>}
  </header>;
}
