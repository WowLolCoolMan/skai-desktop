import type { LocalCapacitySnapshot } from "../../../shared/contracts";
import type { Model } from "../../app/types";
import { StatusBadge } from "../../components/ui/Primitives";
import { estimateModelCapacity } from "./capacityEstimate";

type ChatCapacityPopoverProps = {
  capacity: LocalCapacitySnapshot | null;
  model: Model | undefined;
  modelName: string;
};

function formatCapacityBytes(value: number | null | undefined) {
  if (value == null) return "Unknown";
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  return `${(value / 1024 ** 2).toFixed(0)} MB`;
}

export function ChatCapacityPopover({ capacity, model, modelName }: ChatCapacityPopoverProps) {
  const estimate = estimateModelCapacity(model, capacity);
  const tone = estimate.state === "room" ? "success" : estimate.state === "tight" ? "warning" : "neutral";
  const label = estimate.state === "room" ? "rough fit" : estimate.state === "tight" ? "tight" : "unknown";

  return <details className="capacity-popover">
    <summary><StatusBadge tone={tone}>Device capacity · {label}</StatusBadge></summary>
    <div className="capacity-popover-content">
      <strong>Local device · measurements stay here</strong>
      <span>Selected model: {modelName || "None selected"}</span>
      <span>Model size: {formatCapacityBytes(estimate.modelBytes)}</span>
      <span>Rough startup RAM floor: {formatCapacityBytes(estimate.startupRamBytes)}</span>
      <span>Available RAM (OS measured): {formatCapacityBytes(estimate.availableRamBytes)}</span>
      <span>Model context: {estimate.contextLength ? `${estimate.contextLength.toLocaleString()} tokens` : "Unknown"}</span>
      <span>CPU load: {capacity?.cpuUtilizationPercent == null ? "Unknown" : `${capacity.cpuUtilizationPercent.toFixed(0)}%`}</span>
      <span>GPU: {capacity?.gpu?.name ?? "Not detected"}</span>
      <span>Capacity source: RAM and CPU are sampled locally from the operating system; GPU memory is sampled with NVIDIA telemetry when available.</span>
      <span>GPU memory: {formatCapacityBytes(estimate.gpuAvailableBytes)}</span>
      {capacity?.runtime && <span>Loaded models: {capacity.runtime.loadedModelsKnown ? `${capacity.runtime.loadedModels.length} reported · ${formatCapacityBytes(capacity.runtime.loadedRamBytes)} RAM` : "Not reported by this runtime"}</span>}
      {capacity?.runtime?.airLlmReady !== null && capacity?.runtime?.airLlmReady !== undefined && <span>AirLLM readiness: {capacity.runtime.airLlmReady ? "Ready" : "Not ready"}</span>}
      {capacity?.scheduler && <span>Local runs: {capacity.scheduler.activeTaskCount} active · {capacity.scheduler.queuedTaskCount} queued · {capacity.scheduler.executionSlotLimit} slot</span>}
      {capacity?.scheduler?.queuedTaskCount ? <small>{capacity.scheduler.executionSlotLimit === 0 ? "Queued coding tasks start automatically when the local machine has enough measured capacity." : "Queued coding tasks start automatically when a FIFO execution slot becomes available."}</small> : null}
      <small>{estimate.note}</small>
      {capacity?.runtime?.loadedModelNote && <small>{capacity.runtime.loadedModelNote}</small>}
      {capacity?.measurementNote && <small>{capacity.measurementNote}</small>}
    </div>
  </details>;
}
