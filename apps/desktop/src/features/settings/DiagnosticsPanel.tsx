import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentResponse } from "../../../shared/contracts";
import { Button, StatusBadge } from "../../components/ui/Primitives";
import "./DiagnosticsPanel.css";

type DiagnosticCard = {
  id: string;
  label: string;
  detail: string;
  state: "ready" | "warning" | "error" | "unknown";
};

type DiagnosticsSnapshot = {
  capturedAt: string;
  cards: DiagnosticCard[];
};

function tone(state: DiagnosticCard["state"]): "success" | "warning" | "danger" | "neutral" {
  return state === "ready" ? "success" : state === "error" ? "danger" : state === "warning" ? "warning" : "neutral";
}

function stateLabel(state: DiagnosticCard["state"]) {
  return state === "ready" ? "Ready" : state === "error" ? "Needs attention" : state === "warning" ? "Review" : "Unknown";
}

export function DiagnosticsPanel() {
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const request = useCallback(async (method: string): Promise<AgentResponse | undefined> => {
    return window.skaiAgent?.request(method);
  }, []);

  const refresh = useCallback(async () => {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const entries = await Promise.all([
        ["runtime.health", "Agent Host", "Protocol and local bridge availability"],
        ["system.capacity", "Local capacity", "RAM, GPU, and loaded-model telemetry"],
        ["models.runtime.status", "Model runtime", "Whether the selected local provider responds"],
        ["voice.status", "Voice runtime", "Local speech and playback readiness"],
        ["image.runtime.status", "Image runtime", "Local image workflow readiness"],
      ] as const).then(async (checks) => Promise.all(checks.map(async ([method, label, detail]) => {
        try {
          const response = await request(method);
          if (!response?.ok) return { id: method, label, detail: response?.error?.message ?? detail, state: "error" as const };
          const result = response.result as Record<string, unknown> | null;
          const available = result && Object.values(result).some((value) => value === true || value === "ready" || value === "healthy" || value === "available");
          return { id: method, label, detail: available ? detail : `${detail} · response received`, state: available ? "ready" as const : "warning" as const };
        } catch (cause) {
          return { id: method, label, detail: cause instanceof Error ? cause.message : "The local check failed.", state: "error" as const };
        }
      })));
      setSnapshot({ capturedAt: new Date().toISOString(), cards: entries });
    } finally { setBusy(false); }
  }, [busy, request]);

  useEffect(() => { void refresh(); }, [refresh]);

  const summary = useMemo(() => {
    if (!snapshot) return "No snapshot yet";
    const ready = snapshot.cards.filter((card) => card.state === "ready").length;
    return `${ready}/${snapshot.cards.length} checks ready`;
  }, [snapshot]);

  const copySummary = async () => {
    if (!snapshot) return;
    const text = ["Skai local diagnostics", `Captured: ${snapshot.capturedAt}`, ...snapshot.cards.map((card) => `${card.label}: ${stateLabel(card.state)} — ${card.detail}`)].join("\n");
    const copied = await window.skaiAgent?.clipboard?.writeText(text);
    setNotice(copied ? "Diagnostic summary copied to the local clipboard." : "Clipboard access is unavailable in this session.");
  };

  return <section className="diagnostics-panel" aria-labelledby="diagnostics-panel-title">
    <div className="diagnostics-panel-heading">
      <div><p className="section-kicker">DEVELOPER DIAGNOSTICS</p><h3 id="diagnostics-panel-title">Local health snapshot</h3><p>Run a read-only check across the bridge, model, voice, image, and capacity runtimes. Nothing is uploaded.</p></div>
      <StatusBadge tone={snapshot ? (snapshot.cards.some((card) => card.state === "error") ? "warning" : "success") : "neutral"}>{summary}</StatusBadge>
    </div>
    <div className="diagnostics-panel-actions"><Button variant="secondary" type="button" disabled={busy} onClick={() => void refresh()}>{busy ? "Checking locally…" : "Refresh checks"}</Button><Button variant="ghost" type="button" disabled={!snapshot} onClick={() => void copySummary()}>Copy summary</Button>{snapshot && <span className="settings-help">Captured {new Date(snapshot.capturedAt).toLocaleTimeString()}</span>}</div>
    {snapshot && <div className="diagnostics-card-grid" aria-label="Local diagnostic checks">{snapshot.cards.map((card) => <article className={`diagnostics-card is-${card.state}`} key={card.id}><div><strong>{card.label}</strong><small>{card.detail}</small></div><StatusBadge tone={tone(card.state)}>{stateLabel(card.state)}</StatusBadge></article>)}</div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="settings-help" role="status">{notice}</p>}
  </section>;
}
