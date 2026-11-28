import { useState, type FormEvent } from "react";
import type { Model, Route } from "../../app/types";
import { MessageContent } from "./MessageContent";
import { NavIcon } from "../../components/ui/NavIcon";
import { Button, StatusBadge } from "../../components/ui/Primitives";
import "./CompareModes.css";

type CompareSide = "a" | "b";
type CompareResult = { status: "waiting" | "running" | "complete" | "error"; content?: string; error?: string };
type CompareMode = "named" | "blind" | "weighted";

function modelKey(model: Model) {
  return `${model.provider ?? ""}|${model.endpoint ?? ""}|${model.model}`;
}

function modelName(model: Model) {
  return model.displayName?.trim() || model.model;
}

function modelOptionLabel(model: Model) {
  const runtime = model.provider || "Local runtime";
  return model.displayName && model.displayName !== model.model
    ? `${model.displayName} · ${model.model} · ${runtime}`
    : `${model.model} · ${runtime}`;
}

export function ComparePage({ models, onNavigate, onCompareModel }: {
  models: Model[];
  onNavigate: (route: Route) => void;
  onCompareModel: (model: Model, prompt: string) => Promise<string>;
}) {
  const [modelAKey, setModelAKey] = useState("");
  const [modelBKey, setModelBKey] = useState("");
  const [prompt, setPrompt] = useState("");
  const [results, setResults] = useState<Record<CompareSide, CompareResult>>({ a: { status: "waiting" }, b: { status: "waiting" } });
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<CompareMode>("named");
  const [ratings, setRatings] = useState<Record<CompareSide, number>>({ a: 0, b: 0 });
  const [weights, setWeights] = useState<Record<CompareSide, number>>({ a: 50, b: 50 });
  const modelA = models.find((model) => modelKey(model) === modelAKey) ?? null;
  const modelB = models.find((model) => modelKey(model) === modelBKey) ?? null;
  const canCompare = Boolean(modelA && modelB && modelAKey !== modelBKey && prompt.trim() && !running);

  const selectModel = (side: CompareSide, key: string) => {
    if (side === "a") setModelAKey(key);
    else setModelBKey(key);
    setResults({ a: { status: "waiting" }, b: { status: "waiting" } });
    setRatings({ a: 0, b: 0 });
  };

  const updateWeight = (side: CompareSide, value: number) => {
    const other: CompareSide = side === "a" ? "b" : "a";
    const next = Math.max(0, Math.min(100, Math.round(value)));
    setWeights(side === "a" ? { a: next, b: 100 - next } : { a: 100 - next, b: next });
  };

  const compare = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canCompare || !modelA || !modelB) return;
    const submittedPrompt = prompt.trim();
    setRunning(true);
    setResults({ a: { status: "running" }, b: { status: "waiting" } });
    try {
      // Run one local model at a time to avoid doubling peak memory use.
      const selectedModels: Array<[CompareSide, Model]> = [["a", modelA], ["b", modelB]];
      for (const [side, model] of selectedModels) {
        setResults((current) => ({ ...current, [side]: { status: "running" } }));
        try {
          const content = await onCompareModel(model, submittedPrompt);
          setResults((current) => ({ ...current, [side]: { status: "complete", content } }));
        } catch (error) {
          setResults((current) => ({ ...current, [side]: { status: "error", error: error instanceof Error ? error.message : "This model could not complete the comparison." } }));
        }
      }
    } finally {
      setRunning(false);
    }
  };

  const renderPane = (side: CompareSide, model: Model | null) => {
    const result = results[side];
    const label = side === "a" ? "Model A" : "Model B";
    const visibleName = mode === "blind" ? label : model ? modelName(model) : label;
    const visibleRuntime = mode === "blind" ? "Blind response" : model ? `${model.provider || "Local runtime"} · ${model.model}` : "Choose a local model above";
    const weightedScore = ratings[side] * weights[side];
    return <section className={`compare-pane compare-pane-${side}`} aria-label={`${label} response`}>
      <header className="compare-pane-header"><div><span className="compare-pane-mark">{side.toUpperCase()}</span><div><h2>{visibleName}</h2><p>{visibleRuntime}</p></div></div>{result.status === "running" ? <StatusBadge tone="warning">Running</StatusBadge> : result.status === "complete" ? <StatusBadge tone="success">Complete</StatusBadge> : result.status === "error" ? <StatusBadge tone="danger">Failed</StatusBadge> : null}</header>
      <div className="compare-pane-content" aria-live="polite">
        {result.status === "running" && <p className="compare-placeholder">Generating with {model ? modelName(model) : label}…</p>}
        {result.status === "complete" && <MessageContent content={result.content ?? ""} />}
        {result.status === "error" && <p className="compare-error" role="alert">{result.error}</p>}
        {result.status === "waiting" && <p className="compare-placeholder">{model ? "Ready when you are. Enter a prompt below." : `Select ${label} to begin.`}</p>}
        {mode === "weighted" && result.status === "complete" && <div className="compare-rating-card"><div><strong>Rate this response</strong><span>Only your local rating contributes to the weighted score.</span></div><label><span className="sr-only">{label} rating from 0 to 5</span><input type="range" min="0" max="5" step="1" value={ratings[side]} onChange={(event) => setRatings((current) => ({ ...current, [side]: Number(event.target.value) }))} /><strong>{ratings[side]}/5</strong></label><small>{weights[side]}% weight · {weightedScore} weighted points</small></div>}
      </div>
    </section>;
  };

  return <div className="feature-page compare-page">
    <header className="compare-page-header">
      <Button variant="ghost" type="button" className="compare-back-button" aria-label="Back to chat" onClick={() => onNavigate("chat")}><NavIcon name="chevron-left" /><span>Back</span></Button>
      <h1>A/B Compare</h1>
      <div className="compare-model-selectors">
        <label className="compare-select compare-select-a"><span className="sr-only">Select Model A</span><select value={modelAKey} disabled={running} onChange={(event) => selectModel("a", event.target.value)}><option value="">Select Model A</option>{models.map((model) => <option key={modelKey(model)} value={modelKey(model)}>{modelOptionLabel(model)}</option>)}</select></label>
        <span className="compare-versus" aria-hidden="true">vs</span>
        <label className="compare-select compare-select-b"><span className="sr-only">Select Model B</span><select value={modelBKey} disabled={running} onChange={(event) => selectModel("b", event.target.value)}><option value="">Select Model B</option>{models.map((model) => <option key={modelKey(model)} value={modelKey(model)}>{modelOptionLabel(model)}</option>)}</select></label>
      </div>
      <label className="compare-mode-select"><span>Mode</span><select value={mode} disabled={running} onChange={(event) => setMode(event.target.value as CompareMode)}><option value="named">Named · show model identities</option><option value="blind">Blind · hide model identities</option><option value="weighted">Weighted · rate responses</option></select></label>
    </header>
    {models.length === 0 && <div className="compare-no-models" role="status">No local models are loaded. Discover models in <button type="button" onClick={() => onNavigate("models")}>Models</button> first.</div>}
    <main className="compare-results">{renderPane("a", modelA)}{renderPane("b", modelB)}</main>
    {mode === "weighted" && <div className="compare-weight-strip" aria-label="Weighted scoring controls"><span>Weights</span><label>Model A <input type="number" min="0" max="100" value={weights.a} disabled={running} onChange={(event) => updateWeight("a", Number(event.target.value))} />%</label><label>Model B <input type="number" min="0" max="100" value={weights.b} disabled={running} onChange={(event) => updateWeight("b", Number(event.target.value))} />%</label><strong>{ratings.a * weights.a + ratings.b * weights.b} total weighted points</strong></div>}
    <form className="compare-composer" onSubmit={(event) => void compare(event)}>
      <label className="sr-only" htmlFor="compare-prompt">Prompt to send to both models</label>
      <textarea id="compare-prompt" value={prompt} onChange={(event) => { setPrompt(event.target.value); setResults({ a: { status: "waiting" }, b: { status: "waiting" } }); }} maxLength={120000} rows={2} placeholder="Ask both models the same thing…" disabled={running} />
      <div className="compare-composer-footer"><p>{running ? "Running one model at a time to reduce memory use." : mode === "blind" ? "Both models receive the same prompt; identities stay hidden until you switch modes." : "Both models receive the same prompt. Comparison stays local and is not saved to chat history."}</p><Button variant="primary" type="submit" disabled={!canCompare} aria-busy={running}>{running ? "Comparing…" : "Compare"}<NavIcon name="arrow-right" /></Button></div>
      {modelAKey && modelAKey === modelBKey && <p className="compare-validation" role="status">Choose two different models to compare.</p>}
    </form>
  </div>;
}
