import { useMemo, useRef, useState } from "react";
import type { Model } from "../../app/types";
import { Button, Card, EmptyState, PageHeader, StatusBadge } from "../../components/ui/Primitives";
import { NavIcon } from "../../components/ui/NavIcon";
import type { LocalCapacitySnapshot } from "../../../shared/contracts";
import "./ModelMetadataSelection.css";

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
  if (model.isLoaded) return "Recommended · loaded";
  if (!capacity?.ramAvailableBytes || !model.sizeBytes) return null;
  const headroom = capacity.ramAvailableBytes * 0.7;
  if (model.sizeBytes <= headroom) return "Recommended · fits headroom";
  return null;
}

function modelFitReasons(model: Model, capacity: LocalCapacitySnapshot | null) {
  const reasons: string[] = [];
  if (model.isLoaded) reasons.push("Already loaded, so the first response should avoid a cold start.");
  if (model.vision.toLowerCase() === "supported") reasons.push("Supports vision input for image and screen-based tasks.");
  if (model.capabilities.length) reasons.push(`Advertises ${model.capabilities.slice(0, 3).join(", ")} capability${model.capabilities.length === 1 ? "" : "ies"}.`);
  if (capacity?.ramAvailableBytes && model.sizeBytes) reasons.push(model.sizeBytes <= capacity.ramAvailableBytes * 0.7 ? "Fits within the measured local RAM headroom." : "May exceed the measured local RAM headroom and start slowly.");
  reasons.push(`Runs through ${modelProvider(model)}.`);
  return reasons.slice(0, 4);
}

const modelRoles = [
  ["Chat and reasoning", (model: Model) => 4 + (model.isLoaded ? 3 : 0) + (model.contextLength && model.contextLength >= 32_768 ? 2 : 0)],
  ["Coding agent", (model: Model) => 4 + (model.capabilities.some((capability) => /code|tool|instruct/i.test(capability)) ? 3 : 0) + (model.isLoaded ? 1 : 0)],
  ["Vision and computer use", (model: Model) => (model.vision.toLowerCase() === "supported" ? 8 : 0)],
  ["Long-context research", (model: Model) => (model.contextLength ?? 0) >= 131_072 ? 9 : (model.contextLength ?? 0) >= 32_768 ? 5 : 1],
] as const;

type CapabilityKey = "tool" | "edit" | "json" | "vision" | "context";
type CapabilityResult = { status: "idle" | "running" | "pass" | "warn" | "fail"; detail: string };
const capabilityLabels: Record<CapabilityKey, string> = { tool: "Tool envelope", edit: "Edit format", json: "JSON output", vision: "Vision input", context: "Long context" };

function bestModelForRole(role: string, score: (model: Model) => number, models: Model[], capacity: LocalCapacitySnapshot | null) {
  return models.filter((model) => !capacity?.ramAvailableBytes || !model.sizeBytes || model.sizeBytes <= capacity.ramAvailableBytes * 0.9).sort((a, b) => score(b) - score(a))[0] ?? models.slice().sort((a, b) => score(b) - score(a))[0];
}

export function ModelsPage({ models, capacity, onDiscover, onPull, onCancelPull, onSelect, onNavigate }: { models: Model[]; capacity: LocalCapacitySnapshot | null; onDiscover: () => void | Promise<boolean>; onPull: (model: string, onProgress: (message: string) => void) => Promise<boolean>; onCancelPull: () => Promise<boolean>; onSelect: (model: Model) => void; onNavigate?: (route: "marketplace") => void }) {
  const selectionBeforePointer = useRef("");
  const [query, setQuery] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [discoveryState, setDiscoveryState] = useState<"idle" | "success" | "error">("idle");
  const [pullName, setPullName] = useState("");
  const [pulling, setPulling] = useState(false);
  const [pullProgress, setPullProgress] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [reviewPullName, setReviewPullName] = useState<string | null>(null);
  const [capabilityTest, setCapabilityTest] = useState<{ status: "idle" | "running" | "success" | "error"; message?: string; preview?: string; elapsedMs?: number; provider?: string; promptClass?: string; contextLength?: number | null; temperature?: number }>({ status: "idle" });
  const [capabilitySuite, setCapabilitySuite] = useState<Partial<Record<CapabilityKey, CapabilityResult>>>({});
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
  const runCapabilityTest = async () => {
    if (!selected || capabilityTest.status === "running") return;
    if (!selected.endpoint) {
      setCapabilityTest({ status: "error", message: "This inventory item does not advertise a local runtime endpoint." });
      return;
    }
    const started = performance.now();
    setCapabilityTest({ status: "running", message: "Sending a fixed, non-mutating probe to this local model…", promptClass: "JSON response contract", contextLength: selected.contextLength ?? null, temperature: 0 });
    try {
      const response = await window.skaiAgent?.request("chat.complete", {
        provider: selected.provider,
        endpoint: selected.endpoint,
        model: selected.model,
        modelContextLength: selected.contextLength ?? null,
        messages: [
          { role: "system", content: "You are a local capability probe. Reply with exactly one JSON object: {\"ok\":true,\"probe\":\"local\"}. Do not use tools, markdown, or extra text." },
          { role: "user", content: "Return the probe JSON now." },
        ],
        responseMode: "think",
        maxTokens: 80,
        timeoutSeconds: 30,
        suppressPersonaContinuity: true,
        temperature: 0,
      });
      if (!response?.ok) throw new Error(response?.error?.message ?? "The local model did not respond.");
      const content = typeof (response.result as { content?: unknown } | undefined)?.content === "string" ? (response.result as { content: string }).content.trim() : "";
      if (!content) throw new Error("The local runtime returned an empty response.");
      let message = "Local response received";
      try {
        const parsed = JSON.parse(content) as { ok?: unknown };
        message = parsed.ok === true ? "Returned the expected probe JSON" : "Returned valid JSON";
      } catch {
        message = "Responded locally, but did not follow the JSON probe format";
      }
      setCapabilityTest({ status: "success", message, preview: content.slice(0, 240), elapsedMs: Math.round(performance.now() - started), provider: typeof (response.result as { provider?: unknown } | undefined)?.provider === "string" ? (response.result as { provider: string }).provider : selected.provider ?? selected.runtime ?? "Local runtime", promptClass: "JSON response contract", contextLength: selected.contextLength ?? null, temperature: 0 });
    } catch (error) {
      setCapabilityTest({ status: "error", message: error instanceof Error ? error.message : "Local capability check failed.", elapsedMs: Math.round(performance.now() - started), provider: selected.provider ?? selected.runtime ?? "Local runtime", promptClass: "JSON response contract", contextLength: selected.contextLength ?? null, temperature: 0 });
    }
  };
  const runCapabilitySuite = async () => {
    if (!selected || !selected.endpoint || Object.values(capabilitySuite).some((item) => item?.status === "running")) return;
    const localResults: Partial<Record<CapabilityKey, CapabilityResult>> = {
      vision: { status: selected.vision.toLowerCase() === "supported" ? "pass" : "warn", detail: selected.vision.toLowerCase() === "supported" ? "Inventory reports image input support; no image was uploaded." : "Inventory does not report image input support." },
      context: { status: (selected.contextLength ?? 0) >= 32_768 ? "pass" : "warn", detail: selected.contextLength ? `${selected.contextLength.toLocaleString()} token context reported by the runtime.` : "Context length was not reported by the runtime." },
    };
    (Object.keys(capabilityLabels) as CapabilityKey[]).forEach((key) => { if (!localResults[key]) localResults[key] = { status: "running", detail: "Waiting for the local probe…" }; });
    setCapabilitySuite(localResults);
    const probes: Array<{ key: CapabilityKey; instruction: string; valid: (content: string) => boolean; success: string; mismatch: string }> = [
      { key: "json", instruction: "Return exactly this JSON object and nothing else: {\"ok\":true,\"format\":\"json\"}.", valid: (content) => { try { const value = JSON.parse(content) as { ok?: unknown; format?: unknown }; return value.ok === true && value.format === "json"; } catch { return false; } }, success: "Returned the expected JSON contract.", mismatch: "Responded, but did not return the expected JSON contract." },
      { key: "edit", instruction: "Return exactly one edit envelope and nothing else: <edit path=\"notes.txt\">hello</edit>.", valid: (content) => /<edit\s+path=[\"']notes\.txt[\"']>hello<\/edit>/i.test(content), success: "Returned the expected bounded edit envelope.", mismatch: "Responded, but did not follow the bounded edit format." },
      { key: "tool", instruction: "Return exactly this JSON tool envelope and nothing else: {\"tool\":\"read_file\",\"path\":\"README.md\"}. Do not call a tool.", valid: (content) => { try { const value = JSON.parse(content) as { tool?: unknown; path?: unknown }; return value.tool === "read_file" && value.path === "README.md"; } catch { return false; } }, success: "Returned the expected tool envelope without invoking it.", mismatch: "Responded, but did not follow the tool-envelope contract." },
    ];
    for (const probe of probes) {
      try {
        const response = await window.skaiAgent?.request("chat.complete", { provider: selected.provider, endpoint: selected.endpoint, model: selected.model, modelContextLength: selected.contextLength ?? null, messages: [{ role: "system", content: "You are a local capability probe. Follow the user's exact output contract. Do not use tools, markdown, or extra text." }, { role: "user", content: probe.instruction }], responseMode: "think", maxTokens: 100, timeoutSeconds: 30, suppressPersonaContinuity: true });
        if (!response?.ok) throw new Error(response?.error?.message ?? "The local model did not respond.");
        const content = typeof (response.result as { content?: unknown } | undefined)?.content === "string" ? (response.result as { content: string }).content.trim() : "";
        if (!content) throw new Error("The local runtime returned an empty response.");
        localResults[probe.key] = { status: probe.valid(content) ? "pass" : "warn", detail: probe.valid(content) ? probe.success : probe.mismatch };
      } catch (error) {
        localResults[probe.key] = { status: "fail", detail: error instanceof Error ? error.message : "Probe failed." };
      }
      setCapabilitySuite({ ...localResults });
    }
  };
  return <div className="feature-page models-page">
    <PageHeader eyebrow="MODEL LIBRARY" title="Choose your model" description="Choose models already running on this computer, or prepare a very large local model through AirLLM." actions={<><span role="status" aria-live="polite" aria-atomic="true"><StatusBadge tone={registryStatus.tone}>{registryStatus.label}</StatusBadge></span>{onNavigate && <Button variant="ghost" onClick={() => onNavigate("marketplace")}>Manage installed items</Button>}<Button variant="primary" disabled={discovering} aria-busy={discovering} onClick={() => void discover()}><NavIcon name="refresh" />{discovering ? "Discovering…" : "Discover local models"}</Button></>} />
    <section className="models-page-overview" aria-label="Local model readiness">
      <div><span>Ready on this computer</span><strong>{models.length}</strong><small>Models visible to Skai</small></div>
      <div><span>Loaded now</span><strong>{loadedCount}</strong><small>{loadedCount ? "Available without a cold start" : "No runtime-reported loaded models"}</small></div>
      <div><span>Vision capable</span><strong>{visionCount}</strong><small>{visionCount ? "Useful for image and screen tasks" : "Text-only inventory"}</small></div>
      <div><span>Runtimes</span><strong>{runtimeCount}</strong><small>Local providers reporting models</small></div>
    </section>
    <Card className="catalog-card model-cookbook-card"><div className="panel-heading"><div><p className="section-kicker">LOCAL MODEL COOKBOOK</p><h3>Best fit by job</h3><p className="panel-subtitle">Recommendations use installed model metadata, loaded state, context length, and current local RAM headroom. Skai never sends a benchmark request automatically.</p></div><StatusBadge tone={models.length ? "success" : "neutral"}>{models.length ? "Local inventory" : "Discover first"}</StatusBadge></div><div className="model-cookbook-grid">{modelRoles.map(([role, score]) => { const best = bestModelForRole(role, score, models, capacity); return <div className="model-cookbook-row" key={role}><span><strong>{role}</strong><small>{best ? `${best.displayName || best.model} · ${modelProvider(best)}` : "No matching model discovered"}</small></span>{best && <Button variant="ghost" type="button" onClick={() => onSelect(best)}>Use</Button>}</div>; })}</div></Card>
    <Card className="catalog-card model-install-card"><div className="panel-heading"><div><p className="section-kicker">LOCAL OLLAMA</p><h3>Download a model</h3><p className="panel-subtitle">Review the model name before pulling it into the local Ollama runtime. Progress stays on this computer.</p></div><StatusBadge tone={pulling ? "warning" : "neutral"}>{pulling ? "Downloading" : reviewPullName ? "Review required" : "Local only"}</StatusBadge></div><div className="model-install-form"><input value={pullName} onChange={(event) => setPullName(event.target.value)} placeholder="e.g. llama3.2:latest" aria-label="Ollama model name" /><Button variant="secondary" disabled={pulling || !pullName.trim()} aria-busy={pulling} onClick={() => setReviewPullName(pullName.trim())}>{pulling ? "Downloading…" : "Review download"}</Button>{pulling && <Button variant="ghost" onClick={() => void cancelPull()}>Cancel</Button>}</div>{reviewPullName && <div className="model-install-review" role="dialog" aria-label="Review local model download"><p className="section-kicker">DOWNLOAD REVIEW</p><strong>{reviewPullName}</strong><span>This will ask the local Ollama runtime to download the named model. No remote package verification is performed by this free-form path.</span><div className="model-install-review-actions"><Button variant="ghost" type="button" onClick={() => setReviewPullName(null)}>Cancel</Button><Button variant="primary" type="button" disabled={pulling} onClick={() => { const name = reviewPullName; setReviewPullName(null); void pull(name); }}>Confirm local download</Button></div></div>}{pullProgress.length > 0 && <div className="model-install-progress" role="status" aria-live="polite">{pullProgress.map((item, index) => <span key={`${item}-${index}`}>{item}</span>)}</div>}</Card>
    <Card className="catalog-card model-library-card"><div className="catalog-toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search local models…" aria-label="Search local models" /><span>{filtered.length} available</span>{query && <Button variant="ghost" type="button" onClick={() => setQuery("")}>Clear</Button>}{capacity?.ramAvailableBytes ? <span className="catalog-discovery-status" role="status">Recommendations use measured local headroom.</span> : <span className="catalog-discovery-status" role="status">Capacity unavailable · recommendations are hidden.</span>}{discoveryState === "error" && <span className="catalog-discovery-status" role="status" aria-live="polite">Last inventory shown; refresh failed.</span>}</div>{models.length === 0 ? <EmptyState title="No local models discovered" description="Start Ollama, LM Studio, or another compatible server on this computer, then discover its models. For a very large model, choose AirLLM in the local runtime settings." action={<Button variant="secondary" disabled={discovering} aria-busy={discovering} onClick={() => void discover()}><NavIcon name="refresh" />{discovering ? "Discovering…" : "Discover local models"}</Button>} /> : filtered.length === 0 ? <EmptyState title="No matching local models" description="Try a different model name or capability." action={<Button variant="secondary" onClick={() => setQuery("")}>Clear search</Button>} /> : <div className="models-library-layout"><div className="catalog-list" role="region" aria-label="Available local models">{filtered.map((model) => <button className={`catalog-row${selected && modelKey(selected) === modelKey(model) ? " is-selected" : ""}`} key={modelKey(model)} onPointerDownCapture={() => { selectionBeforePointer.current = window.getSelection()?.toString() ?? ""; }} onClick={(event) => { const selectedText = window.getSelection()?.toString() ?? ""; if (event.detail > 0 && selectedText && selectedText !== selectionBeforePointer.current) { event.preventDefault(); return; } setSelectedModel(modelKey(model)); }} type="button" aria-pressed={Boolean(selected && modelKey(selected) === modelKey(model))}><span className="catalog-icon"><NavIcon name="model" /></span><span className="catalog-row-copy"><strong>{model.displayName || model.model}</strong><small>{modelProvider(model)}</small><span className="model-capability-badges" aria-label="Model capabilities">{modelCapabilityLabels(model).map((capability) => <span key={capability}>{capability}</span>)}</span></span><span className="catalog-row-meta">{recommendation(model, capacity) && <StatusBadge tone="success">{recommendation(model, capacity)}</StatusBadge>}{model.provider === "AirLLM" ? <StatusBadge tone="warning">Requires AirLLM</StatusBadge> : <StatusBadge tone="success">On this computer</StatusBadge>}<span className="catalog-action">Inspect <NavIcon name="arrow-right" /></span></span></button>)}</div>{selected ? <aside className="model-inspector" aria-label="Selected model details"><div className="model-inspector-heading"><div><p className="section-kicker">SELECTED MODEL</p><h3>{selected.displayName || selected.model}</h3></div><StatusBadge tone={selected.provider === "AirLLM" ? "warning" : "success"}>{selected.provider === "AirLLM" ? "Requires AirLLM" : selected.isLoaded ? "Loaded now" : "Available locally"}</StatusBadge></div><dl className="model-detail-list"><div><dt>Model ID</dt><dd>{selected.model}</dd></div><div><dt>Runtime</dt><dd>{modelProvider(selected)}</dd></div><div><dt>Input</dt><dd>{modelVisionLabel(selected.vision)}</dd></div><div><dt>Capabilities</dt><dd><span className="model-capability-badges model-capability-badges-inspector" aria-label="Model capabilities">{modelCapabilityLabels(selected).map((capability) => <span key={capability}>{capability}</span>)}</span></dd></div>{selected.sizeBytes != null && <div><dt>Disk size</dt><dd>{(selected.sizeBytes / (1024 ** 3)).toFixed(1)} GB</dd></div>}</dl><p className="model-inspector-note">{selected.provider === "AirLLM" ? "This model is cached locally and needs the optional AirLLM runtime. Selecting it routes chat through AirLLM and may be much slower." : `This model is available through ${modelProvider(selected)}. Selecting it also switches chat to that local runtime.`}</p><Button variant="primary" onClick={() => onSelect(selected)}>{selected.provider === "AirLLM" ? "Use with AirLLM" : "Use in chat"}</Button></aside> : <aside className="model-inspector model-inspector-empty" aria-label="Model details"><EmptyState title="Inspect a model" description="Select a model to review its local runtime and capabilities before using it in Chat." /></aside>}</div>}</Card>
    {selected && <Card className="model-fit-card"><p className="section-kicker">WHY THIS MODEL</p><h3>{selected.displayName || selected.model}</h3><ul>{modelFitReasons(selected, capacity).map((reason) => <li key={reason}>{reason}</li>)}</ul><div className="model-capability-test" aria-label="Local model capability test"><div><p className="section-kicker">LOCAL RESPONSE CHECK</p><strong>Verify this model before switching chat</strong><span>Runs one fixed, non-mutating prompt through the advertised local endpoint. It does not save a conversation, use tools, or send project context.</span></div><div className="model-capability-test-actions"><Button variant="secondary" type="button" disabled={capabilityTest.status === "running" || !selected.endpoint} aria-busy={capabilityTest.status === "running"} onClick={() => void runCapabilityTest()}>{capabilityTest.status === "running" ? "Checking…" : "Run local response check"}</Button>{capabilityTest.status !== "idle" && <StatusBadge tone={capabilityTest.status === "error" ? "danger" : capabilityTest.status === "success" ? "success" : "warning"}>{capabilityTest.status === "error" ? "Check failed" : capabilityTest.status === "success" ? "Responded" : "Checking"}</StatusBadge>}</div>{capabilityTest.message && <p className={`model-capability-test-result is-${capabilityTest.status}`} role="status" aria-live="polite">{capabilityTest.message}{capabilityTest.elapsedMs != null && ` · ${capabilityTest.elapsedMs} ms`}</p>}{capabilityTest.preview && <code className="model-capability-test-preview">{capabilityTest.preview}</code>}{capabilityTest.status !== "idle" && <div className="model-benchmark-card" aria-label="Capability benchmark result"><p className="section-kicker">BENCHMARK RESULT</p><div className="model-benchmark-grid"><span><small>Prompt</small><strong>{capabilityTest.promptClass ?? "Fixed local probe"}</strong></span><span><small>Runtime</small><strong>{capabilityTest.provider ?? modelProvider(selected)}</strong></span><span><small>Context</small><strong>{capabilityTest.contextLength ? `${capabilityTest.contextLength.toLocaleString()} tokens` : "Not reported"}</strong></span><span><small>Temperature</small><strong>{capabilityTest.temperature ?? 0}</strong></span><span><small>Latency</small><strong>{capabilityTest.elapsedMs != null ? `${capabilityTest.elapsedMs} ms` : "Pending"}</strong></span></div></div>}</div><div className="model-capability-suite" aria-label="Role capability tests"><div className="model-capability-suite-heading"><div><p className="section-kicker">ROLE CAPABILITY MATRIX</p><strong>Check the formats this model can handle</strong><span>Runtime probes are explicit and local-only. Vision and context use the provider metadata; no image, project, or tool call is sent.</span></div><Button variant="ghost" type="button" disabled={!selected.endpoint || Object.values(capabilitySuite).some((item) => item?.status === "running")} aria-busy={Object.values(capabilitySuite).some((item) => item?.status === "running")} onClick={() => void runCapabilitySuite()}>{Object.values(capabilitySuite).some((item) => item?.status === "running") ? "Running…" : "Run capability suite"}</Button></div><div className="model-capability-grid">{(Object.keys(capabilityLabels) as CapabilityKey[]).map((key) => { const result = capabilitySuite[key]; const tone = result?.status === "pass" ? "success" : result?.status === "fail" ? "danger" : result?.status === "warn" ? "warning" : "neutral"; return <div className="model-capability-row" key={key}><span><strong>{capabilityLabels[key]}</strong><small>{result?.detail ?? "Not tested"}</small></span><StatusBadge tone={tone}>{result?.status === "pass" ? "Pass" : result?.status === "fail" ? "Failed" : result?.status === "warn" ? "Review" : result?.status === "running" ? "Running" : "Not tested"}</StatusBadge></div>; })}</div></div></Card>}
  </div>;
}
