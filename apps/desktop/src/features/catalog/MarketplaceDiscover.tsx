import type { Route } from "../../app/types";
import { Button, EmptyState } from "../../components/ui/Primitives";
import { NavIcon, type NavIconName } from "../../components/ui/NavIcon";
import type { MarketplaceSection } from "./MarketplacePage";

type Category = {
  title: string;
  description: string;
  section: MarketplaceSection;
  icon: NavIconName;
  status: string;
  availability: "ready" | "setup" | "limited";
};

type Props = {
  query: string;
  setQuery: (query: string) => void;
  setSection: (section: MarketplaceSection) => void;
  categories: Category[];
  installedCount: number;
  modelError: string | null;
  modelLoading: boolean;
  activeRuntimeAvailable: boolean | null;
  activeLocalRuntime: string;
  onNavigate?: (route: Route) => void;
};

export function MarketplaceDiscover({ query, setQuery, setSection, categories, installedCount, modelError, modelLoading, activeRuntimeAvailable, activeLocalRuntime, onNavigate }: Props) {
  return <div className="marketplace-discover">
    <div className="marketplace-search-row"><label className="sr-only" htmlFor="marketplace-search">Search marketplace</label><input id="marketplace-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search categories, skills, tools, and capabilities…" /><span>{categories.length} categories</span></div>
    <section className="marketplace-next-step" aria-labelledby="marketplace-next-step-title">
      <div><p className="section-kicker">START HERE</p><h3 id="marketplace-next-step-title">Build a useful local workspace</h3><p>Choose a model, confirm the runtime it needs, and keep the install reviewable. Skai will not claim an item is ready until the local path is actually available.</p></div>
      <div className="marketplace-next-step-status"><span><strong>Active runtime</strong>{activeRuntimeAvailable ? activeLocalRuntime : activeRuntimeAvailable === false ? "No runtime responding" : "Not checked yet"}</span><span><strong>Installed locally</strong>{installedCount} core items</span><span><strong>Model catalog</strong>{modelError ? "Needs attention" : modelLoading ? "Checking providers" : "Ready to search"}</span></div>
      <div className="marketplace-next-step-actions"><Button variant="primary" type="button" onClick={() => { setSection("Models"); setQuery(""); }}>Find a model</Button><Button variant="secondary" type="button" onClick={() => { setSection("Installed"); setQuery(""); }}>Installed &amp; updates</Button>{onNavigate && <Button variant="ghost" type="button" onClick={() => onNavigate("settings")}>Runtime settings</Button>}</div>
    </section>
    {categories.length === 0 ? <EmptyState title="No matching categories" description="Try a different search term." action={<Button variant="ghost" onClick={() => setQuery("")}>Clear search</Button>} /> : (
      <div className="marketplace-category-grid" aria-label="Marketplace categories">
        {categories.map((category) => (
          <button key={category.section} type="button" className="marketplace-category-card" onClick={() => { setSection(category.section); setQuery(""); }}>
            <span className="marketplace-category-icon"><NavIcon name={category.icon} /></span>
            <span className="marketplace-category-copy"><strong>{category.title}</strong><small>{category.description}</small><em className={`marketplace-category-status is-${category.availability}`}>{category.status}</em></span><NavIcon name="arrow-right" className="marketplace-category-arrow" />
          </button>
        ))}
      </div>
    )}
    <p className="marketplace-discover-note">Downloads stay local. Each install shows its source, runtime, size, and next action before anything changes on this device.</p>
  </div>;
}
