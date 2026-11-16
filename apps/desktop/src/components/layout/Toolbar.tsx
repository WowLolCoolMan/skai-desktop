import type { Route } from "../../app/types";
import { Button, StatusBadge } from "../ui/Primitives";
import { NavIcon } from "../ui/NavIcon";

const titles: Record<Route, string> = { chat: "Chat", projects: "Projects", coding: "Coding workspace", settings: "Settings", models: "Models", images: "Image Studio", marketplace: "Marketplace", plugins: "Marketplace", workbench: "Agent workbench", terminal: "Terminal", memory: "Memory", usage: "Usage" };

export function Toolbar({ route, connection, canGoBack, canGoForward, onBack, onForward, onRetryConnection }: { route: Route; connection: "checking" | "ready" | "error"; canGoBack: boolean; canGoForward: boolean; onBack: () => void; onForward: () => void; onRetryConnection: () => void }) {
  return <header className="app-toolbar"><div className="toolbar-history"><Button variant="ghost" aria-label="Go back" title="Go back" disabled={!canGoBack} onClick={onBack}><NavIcon name="chevron-left" /></Button><Button variant="ghost" aria-label="Go forward" title="Go forward" disabled={!canGoForward} onClick={onForward}><NavIcon name="chevron-right" /></Button></div><div className="toolbar-title"><p className="eyebrow">LOCAL WORKSPACE</p><h1>{titles[route]}</h1></div><div className="toolbar-actions"><StatusBadge tone={connection === "ready" ? "success" : connection === "error" ? "danger" : "warning"}>{connection === "ready" ? "Agent ready" : connection === "error" ? "Offline" : "Connecting"}</StatusBadge>{connection === "error" && <Button variant="ghost" onClick={onRetryConnection}>Retry connection</Button>}</div></header>;
}
