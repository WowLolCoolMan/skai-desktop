# Capacity execution status

## Goal

Make the existing local capacity advisory explain active and queued local task
execution without implying that Skai can yet predict runtime allocation or
admit multiple model runs safely.

## Integration plan

1. Extend the local `system.capacity` response with a scheduler snapshot built
   from the durable task store: active task count, queued task count, and the
   conservative execution-slot limit.
2. Keep the snapshot local-only and bounded. Do not add provider telemetry,
   model-weight accounting, or a new persistence file.
3. Add optional fields to the renderer contract and show them in the existing
   model-capacity popover, including a clear explanation when work is queued.
4. Add protocol smoke coverage while the isolated host has queued and running
   tasks, then run native tests, typecheck, build, bridge/syntax audits, and
   the full Agent Host smoke.

## Acceptance

- `system.capacity` reports scheduler state without exposing prompts or paths.
- The capacity popover distinguishes device measurements from scheduler state.
- A user can see why a second local coding task is waiting.
- Missing/invalid task data fails closed to zero counts.
- No claims are made that RAM/VRAM measurements guarantee a model will fit.

## Deferred

Capacity-derived parallel slots, loaded-model weight accounting, context-cache
costs, user RAM/VRAM budgets, AirLLM compatibility routing, and automatic model
fallback remain later slices.
