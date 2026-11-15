import type { Route } from "../../app/types";
import { NavIcon, type NavIconName } from "../ui/NavIcon";
import { OverflowMenu } from "../ui/OverflowMenu";

const destinations: Array<{ route: Route; icon: NavIconName; label: string }> = [
  { route: "chat", icon: "chat", label: "Home" },
  { route: "images", icon: "image", label: "Images" },
  { route: "usage", icon: "activity", label: "Usage" },
  { route: "marketplace", icon: "marketplace", label: "Marketplace" },
];

const pluginRoutes: Array<{ route: Route; label: string; icon: NavIconName }> = [
  { route: "terminal", label: "Terminal", icon: "terminal" },
  { route: "workbench", label: "Agent Workbench", icon: "activity" },
  { route: "memory", label: "Memory", icon: "memory" },
];

export function GlobalRail({ route, onNavigate, onOpenLauncher }: { route: Route; onNavigate: (route: Route) => void; onOpenLauncher: () => void }) {
  const pluginActive = route === "plugins" || pluginRoutes.some((item) => item.route === route);
  return <aside className="global-rail" aria-label="Global navigation">
    <nav className="global-rail-destinations" aria-label="Primary navigation">
      {destinations.map((item) => <button key={item.route} className={route === item.route ? "is-active" : ""} type="button" aria-current={route === item.route ? "page" : undefined} aria-label={item.label} title={item.label} onClick={() => onNavigate(item.route)}><NavIcon name={item.icon} /></button>)}
      <div className={`global-rail-plugin ${pluginActive ? "is-active" : ""}`}>
        <button className={`global-rail-plugin-main ${route === "plugins" ? "is-active" : ""}`} type="button" aria-current={route === "plugins" ? "page" : undefined} aria-label="Plugins" title="Plugins" onClick={() => onNavigate("plugins")}><NavIcon name="sparkle" /></button>
        <OverflowMenu
          label="More plugin tools"
          className="global-rail-plugin-menu"
          icon={<NavIcon name="more" />}
          items={[
            ...pluginRoutes.map((item) => ({ label: item.label, icon: <NavIcon name={item.icon} />, onSelect: () => onNavigate(item.route) })),
            { label: "Command palette", icon: <NavIcon name="more" />, onSelect: onOpenLauncher },
          ]}
        />
      </div>
    </nav>
    <div className="global-rail-more">
      <button className={route === "settings" ? "is-active" : ""} type="button" aria-current={route === "settings" ? "page" : undefined} aria-label="Settings" title="Settings" onClick={() => onNavigate("settings")}><NavIcon name="settings" /></button>
    </div>
  </aside>;
}
