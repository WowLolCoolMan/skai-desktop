import { useMemo, useState } from "react";
import type { Model } from "../../app/types";
import { Button, Card, EmptyState, PageHeader, StatusBadge } from "../../components/ui/Primitives";
import { NavIcon } from "../../components/ui/NavIcon";
import type { LocalCapacitySnapshot } from "../../../shared/contracts";

function modelProvider(model: Model) {
  return `${model.provider ?? "Local runtime"} · ${model.runtime ?? "Runtime route unknown"}`;
}

function modelVisionLabel(vision: string) {
  return vision.toLowerCase() === "supported" ? "Vision capable" : vision.toLowerCase() === "unsupported" ? "Text only" : "Capability unknown";
}

function modelCapabilityLabels(model: Model) {
  const labels = [modelVisionLabel(model.vision), ...model.capabilities.filter(Boolean)];
  return [...new Set(labels)].slice(0, 5);
}

const modelKey = (model: Model) => `${model.provider ?? ""}|${model.endpoint ?? ""}|${model.model}`;

function recommendation(model: Model, capacity: LocalCapacitySnapshot | null) {
  if (model.isLoaded) return "Loaded now";
  if (!capacity?.ramAvailableBytes || !model.sizeBytes) return null;
  const headroom = capacity.ramAvailableBytes * 0.7;
  if (model.sizeBytes <= headroom) return "Fits current headroom";
  return null;
}

export function ModelsPage({ models, capacity, onDiscover, onPull, onCancelPull, onSelect, onNavigate }: { models: Model[]; capacity: LocalCapacitySnapshot | null; onDiscover: () => void | Promise<boolean>; onPull: (model: string, onProgress: (message: string) => void) => Promise<boolean>; onCancelPull: () => Promise<boolean>; onSelect: (model: Model) => void; onNavigate?: (route: "marketplace") => void }) {
  const [query, setQuery] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [discoveryState, setDiscoveryState] = useState<"idle" | "success" | "error">("idle");
  const [pullName, setPullName] = useState("");
  const [pulling, setPulling] = useState(false);
  const [pullProgress, setPullProgress] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [reviewPullName, setReviewPullName] = useState<string | null>(null);
  const filtered = useMemo(() => models.filter((model) => `${model.displayName ?? ""} ${model.model} ${model.provider ?? ""} ${model.runtime ?? ""} ${model.format ?? ""} ${model.task ?? ""} ${model.capabilities.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase())), [models, query]);
  const selected = models.find((model) => modelKey(model) === selectedModel) ?? null;
  const loadedCount = models.filter((model) => model.isLoaded).length;
  const visionCount = models.filter((model) => model.vision.toLowerCase() === "supported").length;
  const runtimeCount = new Set(models.map((model) => model.provider ?? model.runtime ?? "Local runtime")).size;
  const discover = async () => {
    if (discovering) return;
    setDiscovering(true);
    try { const result = await onDiscover(); setDiscoveryState(result === false ? "error" : "success"); }
    catch { setDiscoveryState("error"); }
    finally { setDiscovering(false); }
  };
  const registryStatus = discovering ? { tone: "warning" as const, label: "Discovering" } : discoveryState === "error" ? { tone: "danger" as const, label: "Needs attention" } : models.length ? { tone: "success" as const, label: "Registry ready" } : { tone: "neutral" as const, label: "No models loaded" };
  const pull = async (requestedName = pullName.trim()) => {
    const name = requestedName.trim();
    if (!name || pulling) return;
    setPulling(true); setPullProgress([`Preparing local download for ${name}…`]);
    try { const completed = await onPull(name, (message) => setPullProgress((current) => [...current.slice(-3), message])); if (!completed) setPullProgress((current) => [...current.slice(-3), "Local download did not complete. Check the runtime message."]); else setPullProgress((current) => [...current.slice(-3), "Model download completed locally."]); }
    catch { setPullProgress(["Local download failed. Review the local runtime message."]); }
    finally { setPulling(false); }
  };
  const cancelPull = async () => { if (!pulling) return; await onCancelPull(); setPullProgress((current) => [...current.slice(-3), "Cancellation requested for the local download."]); };
  return <div className="feature-page models-page">
    <PageHeader eyebrow="MODEL LIBRARY" title="Choose your model" description="Choose models already running on this computer, or prepare a very large local model through AirLLM." actions={<><span role="status" aria-live="polite" aria-atomic="true"><StatusBadge tone={registryStatus.tone}>{registryStatus.label}</StatusBadge></span>{onNavigate && <Button variant="ghost" onClick={() => onNavigate("marketplace")}>Manage installed items</Button>}<Button variant="primary" disabled={discovering} aria-busy={discovering} onClick={() => void discover()}><NavIcon name="refresh" />{discovering ? "Discovering…" : "Discover local models"}</Button></>} />
    <section className="models-page-overview" aria-label="Local model readiness">
      <div><span>Ready on this computer</span><strong>{models.length}</strong><small>Models visible to Skai</small></div>
      <div><span>Loaded now</span><strong>{loadedCount}</strong><small>{loadedCount ? "Available without a cold start" : "No runtime-reported loaded models"}</small></div>
      <div><span>Vision capable</span><strong>{visionCount}</strong><small>{visionCount ? "Useful for image and screen tasks" : "Text-only inventory"}</small></div>
      <div><span>Runtimes</span><strong>{runtimeCount}</strong><small>Local providers reporting models</small></div>
    </section>
    <Card className="catalog-card model-install-card"><div className="panel-heading"><div><p className="section-kicker">LOCAL OLLAMA</p><h3>Download a model</h3><p className="panel-subtitle">Review the model name before pulling it into the local Ollama runtime. Progress stays on this computer.</p></div><StatusBadge tone={pulling ? "warning" : "neutral"}>{pulling ? "Downloading" : reviewPullName ? "Review required" : "Local only"}</StatusBadge></div><div className="model-install-form"><input value={pullName} onChange={(event) => setPullName(event.target.value)} placeholder="e.g. llama3.2:latest" aria-label="Ollama model name" /><Button variant="secondary" disabled={pulling || !pullName.trim()} aria-busy={pulling} onClick={() => setReviewPullName(pullName.trim())}>{pulling ? "Downloading…" : "Review download"}</Button>{pulling && <Button variant="ghost" onClick={() => void cancelPull()}>Cancel</Button>}</div>{reviewPullName && <div className="model-install-review" role="dialog" aria-label="Review local model download"><p className="section-kicker">DOWNLOAD REVIEW</p><strong>{reviewPullName}</strong><span>This will ask the local Ollama runtime to download the named model. No remote package verification is performed by this free-form path.</span><div className="model-install-review-actions"><Button variant="ghost" type="button" onClick={() => setReviewPullName(null)}>Cancel</Button><Button variant="primary" type="button" disabled={pulling} onClick={() => { const name = reviewPullName; setReviewPullName(null); void pull(name); }}>Confirm local download</Button></div></div>}{pullProgress.length > 0 && <div className="model-install-progress" role="status" aria-live="polite">{pullProgress.map((item, index) => <span key={`${item}-${index}`}>{item}</span>)}</div>}</Card>
    <Card className="catalog-card model-library-card"><div className="catalog-toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search local models…" aria-label="Search local models" /><span>{filtered.length} available</span>{query && <Button variant="ghost" type="button" onClick={() => setQuery("")}>Clear</Button>}{capacity?.ramAvailableBytes ? <span className="catalog-discovery-status" role="status">Recommendations use measured local headroom.</span> : <span className="catalog-discovery-status" role="status">Capacity unavailable · recommendations are hidden.</span>}{discoveryState === "error" && <span className="catalog-discovery-status" role="status" aria-live="polite">Last inventory shown; refresh failed.</span>}</div>{models.length === 0 ? <EmptyState title="No local models discovered" description="Start Ollama, LM Studio, or another compatible server on this computer, then discover its models. For a very large model, choose AirLLM in the local runtime settings." action={<Button variant="secondary" disabled={discovering} aria-busy={discovering} onClick={() => void discover()}><NavIcon name="refresh" />{discovering ? "Discovering…" : "Discover local models"}</Button>} /> : filtered.length === 0 ? <EmptyState title="No matching local models" description="Try a different model name or capability." action={<Button variant="secondary" onClick={() => setQuery("")}>Clear search</Button>} /> : <div className="models-library-layout"><div className="catalog-list" role="region" aria-label="Available local models">{filtered.map((model) => <button className={`catalog-row${selected && modelKey(selected) === modelKey(model) ? " is-selected" : ""}`} key={modelKey(model)} onClick={() => setSelectedModel(modelKey(model))} type="button" aria-pressed={Boolean(selected && modelKey(selected) === modelKey(model))}><span className="catalog-icon"><NavIcon name="model" /></span><span className="catalog-row-copy"><strong>{model.displayName || model.model}</strong><small>{modelProvider(model)}</small><span className="model-capability-badges" aria-label="Model capabilities">{modelCapabilityLabels(model).map((capability) => <span key={capability}>{capability}</span>)}</span></span><span className="catalog-row-meta">{recommendation(model, capacity) && <StatusBadge tone="success">{recommendation(model, capacity)}</StatusBadge>}{model.provider === "AirLLM" ? <StatusBadge tone="warning">Requires AirLLM</StatusBadge> : <StatusBadge tone="success">On this computer</StatusBadge>}<span className="catalog-action">Inspect <NavIcon name="arrow-right" /></span></span></button>)}</div>{selected ? <aside className="model-inspector" aria-label="Selected model details"><div className="model-inspector-heading"><div><p className="section-kicker">SELECTED MODEL</p><h3>{selected.displayName || selected.model}</h3></div><StatusBadge tone={selected.provider === "AirLLM" ? "warning" : "success"}>{selected.provider === "AirLLM" ? "Requires AirLLM" : selected.isLoaded ? "Loaded now" : "Available locally"}</StatusBadge></div><dl className="model-detail-list"><div><dt>Model ID</dt><dd>{selected.model}</dd></div><div><dt>Runtime</dt><dd>{modelProvider(selected)}</dd></div><div><dt>Input</dt><dd>{modelVisionLabel(selected.vision)}</dd></div><div><dt>Capabilities</dt><dd><span className="model-capability-badges model-capability-badges-inspector" aria-label="Model capabilities">{modelCapabilityLabels(selected).map((capability) => <span key={capability}>{capability}</span>)}</span></dd></div>{selected.sizeBytes != null && <div><dt>Disk size</dt><dd>{(selected.sizeBytes / (1024 ** 3)).toFixed(1)} GB</dd></div>}</dl><p className="model-inspector-note">{selected.provider === "AirLLM" ? "This model is cached locally and needs the optional AirLLM runtime. Selecting it routes chat through AirLLM and may be much slower." : `This model is available through ${modelProvider(selected)}. Selecting it also switches chat to that local runtime.`}</p><Button variant="primary" onClick={() => onSelect(selected)}>{selected.provider === "AirLLM" ? "Use with AirLLM" : "Use in chat"}</Button></aside> : <aside className="model-inspector model-inspector-empty" aria-label="Model details"><EmptyState title="Inspect a model" description="Select a model to review its local runtime and capabilities before using it in Chat." /></aside>}</div>}</Card>
  </div>;
}
