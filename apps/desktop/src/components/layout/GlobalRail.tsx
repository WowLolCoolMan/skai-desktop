import type { Route } from "../../app/types";
import { NavIcon, type NavIconName } from "../ui/NavIcon";

const destinations: Array<{ route: Route; icon: NavIconName; label: string }> = [
  { route: "chat", icon: "chat", label: "Home" },
  { route: "images", icon: "image", label: "Images" },
  { route: "usage", icon: "activity", label: "Usage" },
  { route: "marketplace", icon: "marketplace", label: "Marketplace" },
];

export function GlobalRail({ route, onNavigate, onOpenLauncher }: { route: Route; onNavigate: (route: Route) => void; onOpenLauncher: () => void }) {
  const quickActionsActive = ["coding", "models", "plugins", "workbench", "terminal", "memory"].includes(route);
  return <aside className="global-rail" aria-label="Global navigation">
    <nav className="global-rail-destinations" aria-label="Primary navigation">
      {destinations.map((item) => <button key={item.route} className={route === item.route ? "is-active" : ""} type="button" aria-current={route === item.route ? "page" : undefined} aria-label={item.label} title={item.label} onClick={() => onNavigate(item.route)}><NavIcon name={item.icon} /></button>)}
      <button className={quickActionsActive ? "is-active" : ""} type="button" aria-label="Quick Actions" title="Quick Actions" aria-haspopup="dialog" onClick={onOpenLauncher}><NavIcon name="more" /></button>
    </nav>
    <div className="global-rail-more">
      <button className={route === "settings" ? "is-active" : ""} type="button" aria-current={route === "settings" ? "page" : undefined} aria-label="Settings" title="Settings" onClick={() => onNavigate("settings")}><NavIcon name="settings" /></button>
    </div>
  </aside>;
}
