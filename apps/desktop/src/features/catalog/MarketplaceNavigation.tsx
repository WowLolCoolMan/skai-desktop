import { NavIcon, type NavIconName } from "../../components/ui/NavIcon";
import type { MarketplaceSection } from "./MarketplacePage";

const embeddedSections: MarketplaceSection[] = ["Models", "Voices", "Image workflows", "Installed"];
const sectionIcons: Record<MarketplaceSection, NavIconName> = {
  Discover: "sparkle", Models: "model", "Image models": "image", Voices: "activity",
  "Image workflows": "image", Skills: "sparkle", Tools: "terminal", Installed: "memory", Updates: "memory",
};

type Props = {
  section: MarketplaceSection;
  embedded: boolean;
  installedCount: number;
  setSection: (section: MarketplaceSection) => void;
  setQuery: (query: string) => void;
  onSectionChange?: (section: MarketplaceSection) => void;
};

export function MarketplaceNavigation({ section, embedded, installedCount, setSection, setQuery, onSectionChange }: Props) {
  const sections = embedded ? embeddedSections : ["Discover", "Models", "Image models", "Voices", "Image workflows", "Skills", "Tools", "Installed"] as MarketplaceSection[];
  return <aside className="marketplace-nav-panel">
    <div className="marketplace-nav-heading"><span>Browse</span><small>{embedded ? "Embedded" : "Skai catalog"}</small></div>
    <nav className="marketplace-sections" aria-label="Marketplace sections">
      {sections.map((item) => (
        <button key={item} className={(section === item || (item === "Installed" && section === "Updates")) ? "is-active" : ""} type="button" aria-current={(section === item || (item === "Installed" && section === "Updates")) ? "page" : undefined} onClick={() => { setSection(item); setQuery(""); onSectionChange?.(item); }}><NavIcon name={sectionIcons[item]} /><span>{item === "Installed" ? "Installed & updates" : item}</span>{item === "Installed" && <small>{installedCount}</small>}</button>
      ))}
    </nav>
    <div className="marketplace-nav-note"><span className="marketplace-nav-note-dot" /><div><strong>Everything stays local</strong><small>Review source, runtime, and permissions before installing.</small></div></div>
  </aside>;
}
