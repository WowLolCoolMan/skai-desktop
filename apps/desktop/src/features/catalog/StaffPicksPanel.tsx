import { Button, EmptyState, StatusBadge } from "../../components/ui/Primitives";
import { NavIcon } from "../../components/ui/NavIcon";
import type { Route } from "../../app/types";
import type { MarketplaceCatalogSection } from "./marketplaceEntries";

type StaffPickKind = "Model" | "MCP server" | "Skill" | "Plugin" | "Voice pack" | "Persona" | "Highlight";
type StaffPickAction =
  | { label: string; type: "external"; url: string }
  | { label: string; type: "section"; section: MarketplaceCatalogSection; query?: string }
  | { label: string; type: "route"; route: Route };
type StaffPick = { id: string; kind: StaffPickKind; title: string; description: string; details: string; publisher: string; icon: "model" | "activity" | "sparkle" | "terminal" | "project" | "image"; actions: StaffPickAction[] };

// Type-specific installs continue through the reviewed Marketplace flows.
const staffPicks: StaffPick[] = [
  { id: "sophon-realtime", kind: "Model", title: "Sophon-Realtime v1", description: "Open full-duplex speech-to-speech by Adventists.ai, with expressive voice and interruption handling.", details: "Apache-2.0 · Recommended Tag build: about 42 GB and an 80 GB GPU · Self-hosting requires Linux and CUDA.", publisher: "Adventists.ai", icon: "activity", actions: [{ label: "Open model card", type: "external", url: "https://huggingface.co/adventists-ai/Sophon-Realtime-v1" }, { label: "Browse models", type: "section", section: "Models", query: "adventists-ai/Sophon-Realtime-v1" }] },
  { id: "lfm3-omni-2b", kind: "Model", title: "LFM3-Omni-2B", description: "Compact all-in-one model from Liquid AI for text, images, video, and audio, with text or speech output.", details: "LFM Open License v1.0 · 32K context · GGUF is supported by llama.cpp for local use.", publisher: "Liquid AI", icon: "model", actions: [{ label: "Open model card", type: "external", url: "https://huggingface.co/LiquidAI/LFM3-Omni-2B" }, { label: "Find GGUF build", type: "section", section: "Models", query: "LiquidAI/LFM3-Omni-2B-GGUF" }] },
];

export function StaffPicksPanel({ onNavigate, onNavigateRoute }: {
  onNavigate: (section: MarketplaceCatalogSection, query?: string) => void;
  onNavigateRoute: (route: Route) => void;
}) {
  const iconFor: Record<StaffPickKind, StaffPick["icon"]> = { Model: "model", "MCP server": "terminal", Skill: "sparkle", Plugin: "project", "Voice pack": "activity", Persona: "sparkle", Highlight: "image" };
  return <section className="marketplace-staff-picks" aria-label="Developer staff picks">
    <header className="plugins-topbar"><div><h2>Staff Picks</h2><p className="page-description">Developer-curated models, skills, voices, personas, plugins, servers, and other things worth a look.</p></div></header>
    {staffPicks.length === 0 ? <EmptyState title="No staff picks yet" description="Developer-curated Marketplace highlights will appear here." /> : <div className="marketplace-staff-picks-list">{staffPicks.map((pick) => <article className="marketplace-developer-pick" key={pick.id}>
      <div className="marketplace-developer-pick-mark" aria-hidden="true"><NavIcon name={iconFor[pick.kind] ?? pick.icon} /></div>
      <div className="marketplace-developer-pick-copy"><div className="marketplace-developer-pick-heading"><h3>{pick.title}</h3><span className="marketplace-developer-favorite"><span aria-hidden="true">★</span> Developer Favorite</span><StatusBadge tone="neutral">{pick.kind}</StatusBadge></div><p>{pick.description}</p><small>{pick.details} · {pick.publisher}</small></div>
      <div className="marketplace-developer-pick-actions">{pick.actions.map((action) => <Button key={`${pick.id}:${action.label}`} variant={action.type === "section" ? "primary" : "secondary"} type="button" onClick={() => { if (action.type === "external") void window.skaiAgent?.updates?.open(action.url); else if (action.type === "section") onNavigate(action.section, action.query); else onNavigateRoute(action.route); }}>{action.label}</Button>)}</div>
    </article>)}</div>}
  </section>;
}
