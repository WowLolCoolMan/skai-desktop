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
  const availableRamBytes = Number.isFinite(capacity?.ramAvailableBytes) ? capacity!.ramAvailableBytes : null;
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
    note: "Rough startup RAM floor uses model size plus 25% headroom. Context cache, runtime allocation, GPU offload, and other active processes are not reliably attributable; this advisory cannot guarantee a run will fit.",
  };
}
