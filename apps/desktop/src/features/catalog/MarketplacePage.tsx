import { useEffect, useMemo, useState } from "react";
import type { AgentResponse } from "../../../shared/contracts";
import { Button, EmptyState, StatusBadge } from "../../components/ui/Primitives";
import { NavIcon, type NavIconName } from "../../components/ui/NavIcon";
import { saveVoiceSetting, selectedVoiceSettings, speakNativeResponse, stopNativeSpeech, voiceModels, voiceProfiles } from "../../services/nativeTts";

type Section = "Discover" | "Models" | "Skills" | "Tools" | "Installed" | "Updates";
type Filter = "All" | "Local models" | "Voices" | "Image workflows" | "Skills" | "Tools";
type CatalogItem = { id: string; title: string; filter: Filter; description: string; detail: string; icon: NavIconName; status: string; tone: "neutral" | "success" | "warning"; publisher: string; version: string; compatibility: string; nextStep: string; installable: boolean };
type MarketplaceModel = { id: string; repository: string; name?: string; source: string; kind: string; downloads: number; likes: number; uncensored: boolean; tags: string[]; sizeBytes?: number | null; installRoute: string; installable: boolean; files?: Array<{ path: string; sizeBytes: number; sha256?: string | null }> };
type MarketplaceCatalog = { providers: Array<{ id: string; name: string; kinds: string[]; remote: boolean }>; voices: Array<{ id: string; name: string; description: string; runtime: string; license: string; size: string; installed: boolean; lowResource: boolean; sourceUrl: string; installable: boolean }>; skills: Array<{ id: string; name: string; description: string; category: string; permissions: string[]; source: string; installed: boolean; enabled: boolean; installable: boolean }>; tools: Array<{ id: string; name: string; description: string; category: string; access: string; builtIn: boolean; status: string; source?: string | null; installable: boolean }> };

const items: CatalogItem[] = [
  { id: "local-models", title: "Local models", filter: "Local models", description: "Search Hugging Face and ModelScope for local GGUF models.", detail: "Remote catalog discovery is separated from inference. Every result shows its provider, provenance, safety label, size when available, and the verified local install route.", icon: "model", status: "Remote discovery", tone: "success", publisher: "Hugging Face · ModelScope", version: "Live catalog", compatibility: "Local runtime required", nextStep: "Search, filter, inspect the source, then start a verified local download.", installable: false },
  { id: "voices", title: "Voice profiles", filter: "Voices", description: "Configure the local OS voice and available speech profiles.", detail: "Voice settings are stored locally and preview through the configured desktop speech service.", icon: "activity", status: "Local ready", tone: "success", publisher: "Skai Desktop", version: "Profile set", compatibility: "OS voice service", nextStep: "Choose a voice profile and preview it below.", installable: false },
  { id: "image-workflows", title: "Image workflows", filter: "Image workflows", description: "Reuse reviewed ComfyUI workflows from Image Studio.", detail: "Workflow JSON is kept in the local profile. Marketplace does not download or activate remote image packages.", icon: "image", status: "Local source needed", tone: "warning", publisher: "Local profile", version: "User-managed", compatibility: "ComfyUI API workflow", nextStep: "Open Image Studio and save a workflow for reuse.", installable: false },
  { id: "skills", title: "Agent skills", filter: "Skills", description: "Inspect reviewed instruction packs and their permissions.", detail: "Built-in skills are listed from the host catalog with their permission scope. Remote skill installation requires a verified source, manifest, digest, and rollback checks.", icon: "sparkle", status: "Host catalog", tone: "success", publisher: "Skai Core", version: "Built in", compatibility: "Permission review required", nextStep: "Inspect a skill's permissions before enabling it.", installable: false },
  { id: "tools", title: "MCP tools", filter: "Tools", description: "Review local tools and integration boundaries.", detail: "Tool metadata comes from the host catalog. Built-in tools are labeled with their entry point; unavailable connectors do not expose install actions.", icon: "terminal", status: "Host catalog", tone: "success", publisher: "Local connectors", version: "Host-reported", compatibility: "Explicit permission required", nextStep: "Review permissions before enabling a connector.", installable: false },
];

function request(method: string, params?: Record<string, unknown>): Promise<AgentResponse> {
  return window.serverRockAgent?.request(method, params) ?? Promise.resolve({ v: 1, id: `marketplace-${method}`, ok: false, error: { code: "BRIDGE_UNAVAILABLE", message: "The Electron agent bridge is unavailable." } });
}

function formatSize(bytes?: number | null) {
  if (!bytes || bytes <= 0) return "Size unavailable";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

function normalizeSource(value: string) {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

export function MarketplacePage() {
  const [section, setSection] = useState<Section>("Discover");
  const [filter, setFilter] = useState<Filter>("All");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(items[0].id);
  const [voiceSettings, setVoiceSettings] = useState(selectedVoiceSettings);
  const [catalog, setCatalog] = useState<MarketplaceCatalog | null>(null);
  const [models, setModels] = useState<MarketplaceModel[]>([]);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [uncensored, setUncensored] = useState(false);
  const [provider, setProvider] = useState("All providers");
  const [size, setSize] = useState("Any size");
  const [installing, setInstalling] = useState<string | null>(null);
  const [installStatus, setInstallStatus] = useState<string | null>(null);

  useEffect(() => {
    void request("marketplace.catalog").then((response) => {
      if (response.ok) setCatalog(response.result as MarketplaceCatalog);
      else setModelError(response.error?.message ?? "Marketplace catalog could not be loaded.");
    });
    void searchModels("");
  }, []);

  const visible = useMemo(() => section === "Discover" || section === "Models" || section === "Skills" || section === "Tools" ? items.filter((item) => {
    const sectionMatch = section === "Discover" || section === "Models" && item.filter === "Local models" || section === "Skills" && item.filter === "Skills" || section === "Tools" && item.filter === "Tools";
    const filterMatch = filter === "All" || item.filter === filter;
    return sectionMatch && filterMatch && `${item.title} ${item.description} ${item.detail} ${item.publisher}`.toLowerCase().includes(query.trim().toLowerCase());
  }) : [], [filter, query, section]);
  const selected = visible.find((item) => item.id === selectedId) ?? visible[0] ?? null;
  // Live provider search gets the full width under Models; Discover stays a capability overview.
  const showModels = section === "Models";
  const filteredModels = useMemo(() => models.filter((model) => {
    const matchesProvider = provider === "All providers" || model.source === provider;
    const sizeLimit = size === "Any size" ? Number.POSITIVE_INFINITY : Number(size);
    const matchesSize = size === "Any size" || (model.sizeBytes != null && model.sizeBytes <= sizeLimit * 1024 ** 3);
    return matchesProvider && matchesSize;
  }), [models, provider, size]);

  async function searchModels(nextQuery = query, nextUncensored = uncensored) {
    setModelLoading(true);
    setModelError(null);
    const response = await request("marketplace.models.search", { query: nextQuery.trim(), uncensored: nextUncensored });
    setModelLoading(false);
    if (!response.ok) {
      setModelError(response.error?.message ?? "Remote model discovery failed.");
      return;
    }
    const result = response.result as { models?: MarketplaceModel[] };
    setModels(result.models ?? []);
  }

  async function installModel(model: MarketplaceModel) {
    const endpoint = localStorage.getItem("skai.endpoint") ?? "http://localhost:11434/v1";
    const source = normalizeSource(model.source);
    setInstalling(model.id);
    setInstallStatus("Starting verified local download…");
    const started = await request("marketplace.models.install.start", { source, repository: model.repository, name: model.name, endpoint, downloads: model.downloads, uncensored: model.uncensored, files: model.files });
    if (!started.ok) {
      setInstallStatus(started.error?.message ?? "The download could not start.");
      setInstalling(null);
      return;
    }
    const operationId = (started.result as { id?: string }).id;
    if (!operationId) {
      setInstallStatus("The host did not return a download operation.");
      setInstalling(null);
      return;
    }
    for (let attempt = 0; attempt < 600; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 750));
      const status = await request("marketplace.models.install.status", { id: operationId });
      if (!status.ok) {
        setInstallStatus(status.error?.message ?? "Download status was unavailable.");
        break;
      }
      const result = status.result as { status: string; progress?: string[]; error?: string };
      setInstallStatus(result.progress?.at(-1) ?? result.status);
      if (result.status === "completed" || result.status === "failed" || result.status === "cancelled") {
        if (result.error) setInstallStatus(result.error);
        break;
      }
    }
    setInstalling(null);
  }

  const updateVoice = (key: "profileId" | "primaryModelId" | "lowResourceModelId" | "lowResourceMode" | "voiceOutputEnabled", value: string | boolean) => { saveVoiceSetting(key, value); setVoiceSettings(selectedVoiceSettings()); };
  const sectionDescription = section === "Discover" ? "Local capabilities and remote model sources, each labeled with where it comes from." : section === "Models" ? "Results come from Hugging Face and ModelScope through the Agent Host; downloads start only after you choose Install locally." : section === "Installed" ? "Packages installed in this local profile will appear here after a verified installer is connected." : section === "Updates" ? "Update availability requires a verified local package source." : "Browse the local capability family without leaving your current workspace.";

  const modelResults = <section className="marketplace-remote-results" aria-label="Remote model sources">
    <div className="panel-heading"><div><p className="section-kicker">REMOTE MODEL SOURCES</p><h3>Local-ready models</h3></div><StatusBadge tone={modelError ? "warning" : "success"}>{modelLoading ? "Polling" : modelError ? "Partial" : "Live catalog"}</StatusBadge></div>
    <div className="marketplace-model-controls"><label>Provider<select value={provider} onChange={(event) => setProvider(event.target.value)}><option>All providers</option><option>Hugging Face</option><option>ModelScope</option></select></label><label>Maximum size<select value={size} onChange={(event) => setSize(event.target.value)}><option>Any size</option><option value="8">8 GB</option><option value="14">14 GB</option><option value="24">24 GB</option><option value="40">40 GB</option></select></label><label className="settings-toggle"><span><strong>Include abliterated</strong><small>Only show explicit uncensored/abliterated labels.</small></span><input type="checkbox" checked={uncensored} onChange={(event) => { setUncensored(event.target.checked); void searchModels(query, event.target.checked); }} /></label></div>
    {modelError && <p className="marketplace-honesty" role="status">{modelError}</p>}
    {installStatus && <p className="marketplace-honesty" role="status">{installStatus}</p>}
    {filteredModels.length === 0 ? <EmptyState title={modelLoading ? "Polling providers…" : "No matching models"} description="Change the search or filters. Unknown sizes are hidden only when a maximum size is selected." /> : <div className="marketplace-model-list">{filteredModels.slice(0, 36).map((model) => <article className="marketplace-model-row" key={model.id}><div><strong>{model.repository}</strong><small>{model.source} · {formatSize(model.sizeBytes)} · {model.downloads.toLocaleString()} downloads · {model.tags.slice(0, 3).join(" · ") || "GGUF"}</small></div><div className="marketplace-model-actions">{model.uncensored && <StatusBadge tone="warning">Abliterated label</StatusBadge>}<Button variant="secondary" disabled={!model.installable || installing === model.id} onClick={() => void installModel(model)}>{installing === model.id ? "Installing…" : "Install locally"}</Button></div></article>)}</div>}
  </section>;

  return <div className="feature-page marketplace-page"><header className="marketplace-header"><div><p className="eyebrow">MARKETPLACE</p><h2>Extend Skai</h2><p className="page-description">Search verified providers, inspect provenance, and install only through host-backed local adapters.</p></div><Button variant="ghost" type="button" onClick={() => setSection("Installed")}>Manage sources</Button></header><div className="marketplace-browser"><nav className="marketplace-sections" aria-label="Marketplace sections">{(["Discover", "Models", "Skills", "Tools", "Installed", "Updates"] as Section[]).map((item) => <button key={item} className={section === item ? "is-active" : ""} type="button" aria-current={section === item ? "page" : undefined} onClick={() => { setSection(item); setFilter("All"); }}>{item}</button>)}</nav>
    {section === "Installed" || section === "Updates" ? <div className="marketplace-empty-pane"><EmptyState title={section === "Installed" ? "No verified packages installed" : "No verified updates available"} description={section === "Installed" ? "Skai will show packages here only after a local installer has verified their source, digest, compatibility, and requested permissions." : "Skai will show updates here only when a verified local source provides version and integrity metadata."} /></div> : <><div className="marketplace-toolbar"><div className="marketplace-search-row"><label className="sr-only" htmlFor="marketplace-search">Search marketplace</label><input id="marketplace-search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && showModels) void searchModels(); }} placeholder="Search models, voices, skills, and tools…" />{showModels && <Button variant="secondary" disabled={modelLoading} onClick={() => void searchModels()}>{modelLoading ? "Searching…" : "Search providers"}</Button>}<span>{visible.length} results{showModels ? ` · ${models.length} models` : ""}</span></div><div className="marketplace-filters" role="group" aria-label="Capability filters">{(["All", "Local models", "Voices", "Image workflows", "Skills", "Tools"] as Filter[]).map((item) => <button className={`marketplace-filter${filter === item ? " is-active" : ""}`} key={item} type="button" aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}</button>)}</div></div>{showModels ? <div className="marketplace-models-pane">{modelResults}</div> : <div className="marketplace-layout"><div className="marketplace-results" aria-label="Marketplace results">{visible.length === 0 ? <EmptyState title="No matching capabilities" description="Try another search or clear the filter." action={<Button variant="ghost" onClick={() => { setQuery(""); setFilter("All"); }}>Clear filters</Button>} /> : visible.map((item) => <button className={`marketplace-row${selected?.id === item.id ? " is-selected" : ""}`} key={item.id} type="button" onClick={() => setSelectedId(item.id)} aria-pressed={selected?.id === item.id}><span className="marketplace-row-icon"><NavIcon name={item.icon} /></span><span className="marketplace-row-copy"><strong>{item.title}</strong><small>{item.description}</small><em>{item.publisher} · {item.version}</em></span><StatusBadge tone={item.tone}>{item.status}</StatusBadge></button>)}</div>{selected && <aside className="marketplace-detail" aria-label="Selected capability details"><div className="marketplace-detail-heading"><div><p className="section-kicker">SELECTED ITEM</p><h3>{selected.title}</h3></div><StatusBadge tone={selected.tone}>{selected.status}</StatusBadge></div><p>{selected.detail}</p><dl className="marketplace-detail-list"><div><dt>Publisher</dt><dd>{selected.publisher}</dd></div><div><dt>Version</dt><dd>{selected.version}</dd></div><div><dt>Compatibility</dt><dd>{selected.compatibility}</dd></div><div><dt>Next step</dt><dd>{selected.nextStep}</dd></div></dl>
      {selected.filter === "Voices" && <div className="marketplace-voice-controls"><label>Primary conversational voice<select value={voiceSettings.primaryModelId} onChange={(event) => updateVoice("primaryModelId", event.target.value)}>{voiceModels.map((voice) => <option key={voice.id} value={voice.id}>{voice.name} · {voice.size}</option>)}</select></label><label>Low-resource mode voice<select value={voiceSettings.lowResourceModelId} onChange={(event) => updateVoice("lowResourceModelId", event.target.value)}>{voiceModels.map((voice) => <option key={voice.id} value={voice.id}>{voice.name} · {voice.size}</option>)}</select></label><label>Voice profile<select value={voiceSettings.profileId} onChange={(event) => updateVoice("profileId", event.target.value)}>{voiceProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.description}</option>)}</select></label><label className="settings-toggle"><span><strong>Speak completed replies</strong><small>Voice output stays off until you turn it on.</small></span><input type="checkbox" checked={voiceSettings.voiceOutputEnabled} onChange={(event) => updateVoice("voiceOutputEnabled", event.target.checked)} /></label><label className="settings-toggle"><span><strong>Use low-resource mode</strong><small>Use the separately assigned voice model on constrained laptops.</small></span><input type="checkbox" checked={voiceSettings.lowResourceMode} onChange={(event) => updateVoice("lowResourceMode", event.target.checked)} /></label><div className="marketplace-voice-actions"><Button variant="secondary" onClick={() => void speakNativeResponse("Skai voice preview. This uses the operating system voice service.", true)}>Preview OS voice</Button><Button variant="ghost" onClick={stopNativeSpeech}>Stop preview</Button></div></div>}
      {selected.filter === "Skills" && <dl className="marketplace-detail-list">{(catalog?.skills ?? []).map((skill) => <div key={skill.id}><dt>{skill.name}</dt><dd>{skill.description} · {skill.permissions.join(", ") || "No extra permissions"}</dd></div>)}</dl>}
      {selected.filter === "Tools" && <dl className="marketplace-detail-list">{(catalog?.tools ?? []).slice(0, 8).map((tool) => <div key={tool.id}><dt>{tool.name}</dt><dd>{tool.status} · {tool.access}</dd></div>)}</dl>}
      {selected.filter === "Local models" ? <p className="marketplace-honesty" role="status">{installStatus ?? "Provider results and install progress stay visible here and are never presented as complete until the host confirms them."}</p> : <div className="marketplace-install-review"><p className="section-kicker">INSTALLATION REVIEW</p><strong>Verified source required</strong><span>Skai will inspect publisher, digest, compatibility, dependencies, and permissions before any download starts.</span><Button variant="secondary" type="button" disabled={!selected.installable} title="No verified package installer is connected for this item">Review before installing</Button></div>}
    </aside>}</div>}</>}</div><p className="marketplace-footer-note">{sectionDescription}</p></div>;
}
