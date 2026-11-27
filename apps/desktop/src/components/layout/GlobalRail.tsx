import { useEffect, useMemo, useRef, useState } from "react";
import type { Route } from "../../app/types";
import type { DesktopTask } from "../../../shared/contracts";
import { NavIcon, type NavIconName } from "../ui/NavIcon";
import { installedVoiceModels } from "../../services/nativeTts";

const destinations: Array<{ route: Route; icon: NavIconName; label: string }> = [
  { route: "chat", icon: "chat", label: "Chat" },
  { route: "projects", icon: "project", label: "Projects" },
  { route: "scheduled", icon: "clock", label: "Tasks" },
  { route: "coding", icon: "code", label: "Files" },
  { route: "marketplace", icon: "marketplace", label: "Tools" },
  { route: "models", icon: "model", label: "Models" },
  { route: "images", icon: "image", label: "Media" },
  { route: "usage", icon: "activity", label: "Usage" },
];

const recentExtraRoutes: Route[] = ["memory", "voice-workbench", "pet-workshop"];
const railOrderKey = "skai.global-rail.order.v1";
const pinnedRoutesKey = "skai.global-rail.pinned.v1";
const pinnableRoutes: Route[] = ["search", "onboarding", "compare", "video", "terminal", "persona-workshop", "memory", "voice-workbench", "pet-workshop"];

function readRailOrder(): Route[] {
  const fallback = destinations.map((item) => item.route);
  try {
    const value = JSON.parse(localStorage.getItem(railOrderKey) ?? "[]") as unknown;
    if (!Array.isArray(value)) return fallback;
    const stored = value.filter((item): item is Route => fallback.includes(item as Route));
    return [...stored, ...fallback.filter((route) => !stored.includes(route))];
  } catch { return fallback; }
}

function readPinnedRoutes(): Route[] {
  try {
    const value = JSON.parse(localStorage.getItem(pinnedRoutesKey) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((item): item is Route => pinnableRoutes.includes(item as Route)).filter((route, index, items) => items.indexOf(route) === index) : [];
  } catch { return []; }
}

export function GlobalRail({ route, tasks, onNavigate }: { route: Route; tasks: DesktopTask[]; onNavigate: (route: Route) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [customizeRail, setCustomizeRail] = useState(false);
  const [railOrder, setRailOrder] = useState<Route[]>(readRailOrder);
  const [pinnedRoutes, setPinnedRoutes] = useState<Route[]>(readPinnedRoutes);
  const [showPetWorkshop, setShowPetWorkshop] = useState(() => localStorage.getItem("skai.pet.workshop.enabled") === "true");
  const [query, setQuery] = useState("");
  const [lastActivityVisit, setLastActivityVisit] = useState(() => Number(localStorage.getItem("skai.workspace-activity.last-visit.v1") ?? 0));
  const [recentRoutes, setRecentRoutes] = useState<Route[]>(() => {
    try { const value = JSON.parse(localStorage.getItem("skai.extras.recent") ?? "[]"); return Array.isArray(value) ? value.filter((route): route is Route => recentExtraRoutes.includes(route)).filter((route, index, items) => items.indexOf(route) === index).slice(0, 3) : []; }
    catch { return []; }
  });
  const menuRef = useRef<HTMLDivElement>(null);
  const draggedRailRouteRef = useRef<Route | null>(null);
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
  useEffect(() => { localStorage.setItem(railOrderKey, JSON.stringify(railOrder)); }, [railOrder]);
  useEffect(() => { localStorage.setItem(pinnedRoutesKey, JSON.stringify(pinnedRoutes)); }, [pinnedRoutes]);
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
  const pinnedItems = filteredItems.filter((item) => pinnedRoutes.includes(item.route));
  const availableItems = filteredItems.filter((item) => !pinnedRoutes.includes(item.route));
  const pinnedDestinations = pinnedRoutes.map((itemRoute) => menuItems.find((item) => item.route === itemRoute)).filter((item): item is (typeof menuItems)[number] => Boolean(item));
  const railDestinations = [...destinations, ...pinnedDestinations];
  const railRoutes = railDestinations.map((item) => item.route);
  const orderedDestinations = [...railOrder.filter((itemRoute) => railRoutes.includes(itemRoute)), ...railRoutes.filter((itemRoute) => !railOrder.includes(itemRoute))].map((itemRoute) => railDestinations.find((item) => item.route === itemRoute)).filter((item): item is (typeof railDestinations)[number] => Boolean(item));
  const moveRailRoute = (targetRoute: Route) => {
    const sourceRoute = draggedRailRouteRef.current;
    draggedRailRouteRef.current = null;
    if (!sourceRoute || sourceRoute === targetRoute) return;
    setRailOrder((current) => {
      const next = current.filter((item) => item !== sourceRoute);
      const targetIndex = Math.max(0, next.indexOf(targetRoute));
      next.splice(targetIndex, 0, sourceRoute);
      return next;
    });
  };
  const togglePinned = (itemRoute: Route) => {
    setPinnedRoutes((current) => {
      const isPinned = current.includes(itemRoute);
      setRailOrder((order) => isPinned ? order.filter((route) => route !== itemRoute) : [...order.filter((route) => route !== itemRoute), itemRoute]);
      return isPinned ? current.filter((route) => route !== itemRoute) : [...current, itemRoute];
    });
  };
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
  const renderExtraRow = (item: (typeof menuItems)[number]) => {
    const isPinned = pinnedRoutes.includes(item.route);
    return <div className="global-rail-extra-row" key={item.route}>
      <button className="global-rail-extra" type="button" onClick={() => openExtra(item.route)}>
        <span className="global-rail-extra-icon"><NavIcon name={item.icon} /></span>
        <span className="global-rail-extra-copy"><strong>{item.label}</strong><small>{item.description}</small></span>
        {item.attention ? <span className="global-rail-extra-status">{item.attention} new</span> : item.unavailable ? <span className="global-rail-extra-status">Set up</span> : <span className="global-rail-extra-arrow">↗</span>}
      </button>
      <button type="button" className={`global-rail-pin-toggle${isPinned ? " is-pinned" : ""}`} aria-pressed={isPinned} aria-label={isPinned ? `Remove ${item.label} from the rail` : `Add ${item.label} to the rail`} title={isPinned ? `Remove ${item.label} from the rail` : `Add ${item.label} to the rail`} onClick={() => togglePinned(item.route)}>{isPinned ? "Remove" : "Add"}</button>
    </div>;
  };
  return <aside className="global-rail" aria-label="Global navigation">
    <nav className="global-rail-destinations" aria-label="Primary navigation">
      {orderedDestinations.map((item) => <button key={item.route} className={`${route === item.route ? "is-active" : ""}${customizeRail ? " is-customizing" : ""}`} draggable={customizeRail} type="button" aria-current={route === item.route ? "page" : undefined} aria-label={item.label} title={customizeRail ? `Drag to reorder ${item.label}` : item.label} onDragStart={() => { draggedRailRouteRef.current = item.route; }} onDragOver={(event) => { if (customizeRail) event.preventDefault(); }} onDrop={() => { if (customizeRail) moveRailRoute(item.route); }} onClick={() => { if (!customizeRail) onNavigate(item.route); }}><NavIcon name={item.icon} /></button>)}
      <div className="global-rail-app-menu" ref={menuRef}>
        <button className={menuOpen ? "is-active" : ""} type="button" aria-label="Extras" title="Extras" aria-haspopup="dialog" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><NavIcon name="more" />{menuItems.some((item) => item.unavailable) && <span className="global-rail-attention-dot" aria-label="Setup needs attention" />}</button>
        {menuOpen && <section className="global-rail-extras-panel" aria-label="Extras">
          <header><div><p className="section-kicker">YOUR WORKSPACE</p><strong>Extras</strong><span>Open a destination or manage your rail</span></div><div className="global-rail-extras-header-actions"><button type="button" className="global-rail-customize-toggle" onClick={() => setCustomizeRail((open) => !open)} aria-pressed={customizeRail}>{customizeRail ? "Done" : "Arrange"}</button><button type="button" aria-label="Close Extras" onClick={() => setMenuOpen(false)}>×</button></div></header>
          {customizeRail && <p className="global-rail-customize-hint" role="status">Drag the primary destinations to reorder them. Add or remove extras below; changes stay on this device.</p>}
          {menuItems.length > 5 && <label className="global-rail-extras-search"><NavIcon name="search" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search features" aria-label="Search features" /></label>}
          <div className="global-rail-extras-list">
            {recentRoutes.length > 0 && <div className="global-rail-extras-group"><p className="global-rail-extras-label">RECENTLY OPENED</p>{recentRoutes.map((recent) => { const item = menuItems.find((entry) => entry.route === recent); return item ? <button className="global-rail-extra is-recent" type="button" key={`recent-${item.route}`} onClick={() => openExtra(item.route)}><span className="global-rail-extra-icon"><NavIcon name={item.icon} /></span><span className="global-rail-extra-copy"><strong>{item.label}</strong><small>Recently opened</small></span><span className="global-rail-extra-arrow">↗</span></button> : null; })}</div>}
            {pinnedItems.length > 0 && <div className="global-rail-extras-group"><p className="global-rail-extras-label">PINNED TO RAIL</p>{pinnedItems.map(renderExtraRow)}</div>}
            <div className="global-rail-extras-group"><p className="global-rail-extras-label">{pinnedItems.length > 0 ? "AVAILABLE FEATURES" : "FEATURES"}</p>{filteredItems.length === 0 ? <p className="global-rail-extras-empty">No matching features.</p> : availableItems.length === 0 && pinnedItems.length > 0 ? <p className="global-rail-extras-empty">Everything matching your search is already pinned.</p> : availableItems.map(renderExtraRow)}</div>
          </div>
        </section>}
      </div>
    </nav>
    <div className="global-rail-more">
      <button className={route === "settings" ? "is-active" : ""} type="button" aria-current={route === "settings" ? "page" : undefined} aria-label="Settings" title="Settings" onClick={() => onNavigate("settings")}><NavIcon name="settings" /></button>
    </div>
  </aside>;
}
