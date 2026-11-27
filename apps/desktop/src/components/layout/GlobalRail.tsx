import { useEffect, useMemo, useRef, useState } from "react";
import type { Route } from "../../app/types";
import type { DesktopTask } from "../../../shared/contracts";
import { NavIcon, type NavIconName } from "../ui/NavIcon";
import { installedVoiceModels } from "../../services/nativeTts";

const destinations: Array<{ route: Route; icon: NavIconName; label: string }> = [
  { route: "chat", icon: "home", label: "Home" },
  { route: "projects", icon: "project", label: "Projects" },
  { route: "scheduled", icon: "clock", label: "Scheduled" },
  { route: "coding", icon: "code", label: "Coding" },
  { route: "images", icon: "image", label: "Images" },
];

const recentExtraRoutes: Route[] = ["memory", "voice-workbench", "pet-workshop"];

export function GlobalRail({ route, tasks, onNavigate }: { route: Route; tasks: DesktopTask[]; onNavigate: (route: Route) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showPetWorkshop, setShowPetWorkshop] = useState(() => localStorage.getItem("skai.pet.workshop.enabled") === "true");
  const [query, setQuery] = useState("");
  const [lastActivityVisit, setLastActivityVisit] = useState(() => Number(localStorage.getItem("skai.workspace-activity.last-visit.v1") ?? 0));
  const [recentRoutes, setRecentRoutes] = useState<Route[]>(() => {
    try { const value = JSON.parse(localStorage.getItem("skai.extras.recent") ?? "[]"); return Array.isArray(value) ? value.filter((route): route is Route => recentExtraRoutes.includes(route)).filter((route, index, items) => items.indexOf(route) === index).slice(0, 3) : []; }
    catch { return []; }
  });
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const refresh = () => setShowPetWorkshop(localStorage.getItem("skai.pet.workshop.enabled") === "true");
    window.addEventListener("storage", refresh);
    window.addEventListener("skai:pet-workshop-setting", refresh);
    return () => { window.removeEventListener("storage", refresh); window.removeEventListener("skai:pet-workshop-setting", refresh); };
  }, []);
  useEffect(() => {
    const refresh = () => setLastActivityVisit(Number(localStorage.getItem("skai.workspace-activity.last-visit.v1") ?? 0));
    window.addEventListener("storage", refresh);
    window.addEventListener("skai:workspace-activity-read", refresh);
    return () => { window.removeEventListener("storage", refresh); window.removeEventListener("skai:workspace-activity-read", refresh); };
  }, []);
  useEffect(() => {
    localStorage.setItem("skai.extras.recent", JSON.stringify(recentRoutes));
  }, [recentRoutes]);
  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false); };
    const closeEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeEscape); };
  }, [menuOpen]);
  const menuItems = useMemo<Array<{ route: Route; label: string; icon: NavIconName; description: string; unavailable: boolean; attention?: number }>>(() => [
    { route: "search" as Route, label: "Search & Activity", icon: "search" as NavIconName, description: "Find work or review live task progress", unavailable: false, attention: tasks.filter((task) => ["awaiting_approval", "blocked", "paused", "proposed", "failed"].includes(task.status) || (task.status === "completed" && Date.parse(task.updatedAt) > lastActivityVisit)).length },
    { route: "onboarding" as Route, label: "Getting started", icon: "sparkle" as NavIconName, description: "Setup checklist, privacy, and local readiness", unavailable: false },
    { route: "models" as Route, label: "Models", icon: "model" as NavIconName, description: "Browse and manage local models", unavailable: false },
    { route: "compare" as Route, label: "Compare", icon: "compare" as NavIconName, description: "Compare model responses", unavailable: false },
    { route: "video" as Route, label: "Video · planned", icon: "video" as NavIconName, description: "Video tools planned for a future release", unavailable: false },
    { route: "marketplace" as Route, label: "Marketplace", icon: "marketplace" as NavIconName, description: "Browse available tools", unavailable: false },
    { route: "usage" as Route, label: "Usage", icon: "activity" as NavIconName, description: "Review local model usage", unavailable: false },
    { route: "terminal" as Route, label: "Terminal", icon: "terminal" as NavIconName, description: "Run a project command", unavailable: false },
    { route: "persona-workshop" as Route, label: "Personas", icon: "sparkle" as NavIconName, description: "Create and manage personas", unavailable: false },
    { route: "memory" as Route, label: "Memory", icon: "memory" as NavIconName, description: "Review saved notes and documents", unavailable: false },
    { route: "voice-workbench" as Route, label: "Voice Workbench", icon: "audio" as NavIconName, description: "Choose and preview local voices", unavailable: installedVoiceModels.length === 0 },
    ...(showPetWorkshop ? [{ route: "pet-workshop" as Route, label: "Pets", icon: "sparkle" as NavIconName, description: "Customize your desktop companion", unavailable: false }] : []),
  ], [lastActivityVisit, showPetWorkshop, tasks]);
  const filteredItems = menuItems.filter((item) => !query.trim() || item.label.toLowerCase().includes(query.trim().toLowerCase()));
  const openExtra = (itemRoute: Route) => {
    const next = recentExtraRoutes.includes(itemRoute)
      ? [itemRoute, ...recentRoutes.filter((route) => route !== itemRoute)].slice(0, 3)
      : recentRoutes;
    setRecentRoutes(next);
    localStorage.setItem("skai.extras.recent", JSON.stringify(next));
    setMenuOpen(false);
    setQuery("");
    onNavigate(itemRoute);
  };
  return <aside className="global-rail" aria-label="Global navigation">
    <nav className="global-rail-destinations" aria-label="Primary navigation">
      {destinations.map((item) => <button key={item.route} className={route === item.route ? "is-active" : ""} type="button" aria-current={route === item.route ? "page" : undefined} aria-label={item.label} title={item.label} onClick={() => onNavigate(item.route)}><NavIcon name={item.icon} /></button>)}
      <div className="global-rail-app-menu" ref={menuRef}>
        <button className={menuOpen ? "is-active" : ""} type="button" aria-label="Extras" title="Extras" aria-haspopup="dialog" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><NavIcon name="more" />{menuItems.some((item) => item.unavailable) && <span className="global-rail-attention-dot" aria-label="Setup needs attention" />}</button>
        {menuOpen && <section className="global-rail-extras-panel" aria-label="Extras">
          <header><div><p className="section-kicker">YOUR WORKSPACE</p><strong>Extras</strong><span>More ways to work with Skai</span></div><button type="button" aria-label="Close Extras" onClick={() => setMenuOpen(false)}>×</button></header>
          {menuItems.length > 5 && <label className="global-rail-extras-search"><NavIcon name="search" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search extras" aria-label="Search extras" /></label>}
          {recentRoutes.length > 0 && <div className="global-rail-extras-group"><p className="global-rail-extras-label">PICK UP WHERE YOU LEFT OFF</p>{recentRoutes.map((recent) => { const item = menuItems.find((entry) => entry.route === recent); return item ? <button className="global-rail-extra is-recent" type="button" key={`recent-${item.route}`} onClick={() => openExtra(item.route)}><span className="global-rail-extra-icon"><NavIcon name={item.icon} /></span><span className="global-rail-extra-copy"><strong>{item.label}</strong><small>Recently opened</small></span><span className="global-rail-extra-arrow">↗</span></button> : null; })}</div>}
          <div className="global-rail-extras-group"><p className="global-rail-extras-label">FEATURES</p>
          {filteredItems.length === 0 ? <p className="global-rail-extras-empty">No matching tools.</p> : filteredItems.map((item) => <button className="global-rail-extra" type="button" key={item.route} onClick={() => openExtra(item.route)}><span className="global-rail-extra-icon"><NavIcon name={item.icon} /></span><span className="global-rail-extra-copy"><strong>{item.label}</strong><small>{item.description}</small></span>{item.attention ? <span className="global-rail-extra-status">{item.attention} new</span> : item.unavailable ? <span className="global-rail-extra-status">Set up</span> : <span className="global-rail-extra-arrow">↗</span>}</button>)}
          </div>
        </section>}
      </div>
    </nav>
    <div className="global-rail-more">
      <button className={route === "settings" ? "is-active" : ""} type="button" aria-current={route === "settings" ? "page" : undefined} aria-label="Settings" title="Settings" onClick={() => onNavigate("settings")}><NavIcon name="settings" /></button>
    </div>
  </aside>;
}
