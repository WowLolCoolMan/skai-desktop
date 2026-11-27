import type { LocalCapacitySnapshot } from "../../../shared/contracts";
import type { Model } from "../../app/types";

export type ModelCapacityEstimate = {
  modelBytes: number | null;
  startupRamBytes: number | null;
  availableRamBytes: number | null;
  state: "unknown" | "room" | "tight";
  contextLength: number | null;
  gpuAvailableBytes: number | null;
  note: string;
};

/** A deliberately rough local advisory; it is not a runtime allocation prediction. */
export function estimateModelCapacity(model: Model | undefined, capacity: LocalCapacitySnapshot | null): ModelCapacityEstimate {
  const modelBytes = Number.isFinite(model?.sizeBytes) && (model?.sizeBytes ?? 0) > 0 ? model!.sizeBytes! : null;
  const startupRamBytes = modelBytes === null ? null : Math.ceil(modelBytes * 1.25);
  const measuredRamBytes = Number.isFinite(capacity?.ramAvailableBytes) ? capacity!.ramAvailableBytes : null;
  const loadedRamBytes = capacity?.runtime?.loadedModelsKnown ? capacity.runtime.loadedRamBytes : 0;
  // The OS free-memory reading already reflects resident loaded models. Keep
  // runtime-reported sizes visible, but do not subtract the same allocation twice.
  const availableRamBytes = measuredRamBytes;
  const state = startupRamBytes === null || availableRamBytes === null
    ? "unknown"
    : availableRamBytes >= startupRamBytes ? "room" : "tight";

  return {
    modelBytes,
    startupRamBytes,
    availableRamBytes,
    state,
    contextLength: Number.isFinite(model?.contextLength) && (model?.contextLength ?? 0) > 0 ? model!.contextLength! : null,
    gpuAvailableBytes: Number.isFinite(capacity?.gpu?.availableBytes) ? capacity!.gpu!.availableBytes : null,
    note: capacity?.runtime?.loadedModelsKnown
      ? `Available RAM is measured by the OS; the runtime separately reports ${formatBytes(loadedRamBytes)} for loaded models, already reflected in that measurement. Startup RAM and context cache remain rough estimates.`
      : "Available RAM is measured by the OS. Loaded-model sizes are unavailable from this runtime; startup RAM and context cache remain rough estimates.",
  };
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}
