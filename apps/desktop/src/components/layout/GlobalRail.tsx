import { useEffect, useRef, useState } from "react";
import type { Route } from "../../app/types";
import { NavIcon, type NavIconName } from "../ui/NavIcon";

const destinations: Array<{ route: Route; icon: NavIconName; label: string }> = [
  { route: "chat", icon: "chat", label: "Home" },
  { route: "images", icon: "image", label: "Images" },
  { route: "usage", icon: "activity", label: "Usage" },
  { route: "marketplace", icon: "marketplace", label: "Marketplace" },
];

export function GlobalRail({ route, onNavigate }: { route: Route; onNavigate: (route: Route) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false); };
    const closeEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeEscape); };
  }, [menuOpen]);
  const menuItems: Array<{ route: Route; label: string; icon: NavIconName }> = [
    { route: "projects", label: "Projects", icon: "project" },
    { route: "coding", label: "Coding workspace", icon: "code" },
    { route: "workbench", label: "Agent workbench", icon: "sparkle" },
    { route: "terminal", label: "Terminal", icon: "terminal" },
    { route: "models", label: "Models", icon: "model" },
    { route: "memory", label: "Memory", icon: "memory" },
  ];
  return <aside className="global-rail" aria-label="Global navigation">
    <nav className="global-rail-destinations" aria-label="Primary navigation">
      {destinations.map((item) => <button key={item.route} className={route === item.route ? "is-active" : ""} type="button" aria-current={route === item.route ? "page" : undefined} aria-label={item.label} title={item.label} onClick={() => onNavigate(item.route)}><NavIcon name={item.icon} /></button>)}
      <div className="global-rail-app-menu" ref={menuRef}>
        <button className={menuOpen ? "is-active" : ""} type="button" aria-label="Quick actions" title="Quick actions" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><NavIcon name="more" /></button>
        {menuOpen && <div className="global-rail-app-menu-panel" role="group" aria-label="Quick actions">{menuItems.map((item) => <button type="button" key={item.route} onClick={() => { setMenuOpen(false); onNavigate(item.route); }}><NavIcon name={item.icon} /><span>{item.label}</span></button>)}<div className="global-rail-app-menu-divider" /><button type="button" onClick={() => { setMenuOpen(false); onNavigate("marketplace"); }}><NavIcon name="marketplace" /><span>Voice Workbench &amp; tools</span></button></div>}
      </div>
    </nav>
    <div className="global-rail-more">
      <button className={route === "settings" ? "is-active" : ""} type="button" aria-current={route === "settings" ? "page" : undefined} aria-label="Settings" title="Settings" onClick={() => onNavigate("settings")}><NavIcon name="settings" /></button>
    </div>
  </aside>;
}
