# Runtime-aware capacity accounting

## Goal

Make durable local-task admission account for model memory that is already
resident in a supported local runtime and only use the lower AirLLM estimate
when the optional AirLLM runtime is actually ready. Runtimes that cannot
report loaded allocations remain conservative rather than claiming precision.

## Integration plan

1. Extend the local capacity contract with a bounded loaded-model summary:
   runtime, model identifier, and reported size when the runtime exposes it.
2. Query Ollama's local process list through the existing local-only provider
   boundary; treat malformed, unavailable, or remote responses as unknown and
   preserve the current conservative policy.
3. Cache the AirLLM readiness result briefly in the Agent Host so admission
   checks do not launch Python for every queue poll. A failed or expired check
   must never be treated as ready.
4. Subtract only known loaded-model bytes from the measured RAM/VRAM headroom,
   bounded to the measured totals, and expose the accounting note in
   `system.capacity` for the existing capacity popover.
5. Add pure policy tests for loaded-model subtraction and host-level tests for
   readiness/unavailable behavior without downloading or installing anything.

## Safety boundary

- All probes stay on local loopback endpoints and never expose model names,
  paths, or telemetry outside the desktop process.
- Unknown loaded-model data leaves the conservative slot limit unchanged.
- AirLLM is never selected implicitly by this slice; it only changes the
  estimate after a verified local readiness check and explicit task metadata.

## Acceptance

- Ollama-loaded model memory is reflected in the local capacity result when
  the runtime reports it.
- AirLLM-compatible tasks use the lower estimate only when readiness is true.
- Missing/unsupported runtime telemetry remains conservative and actionable.
- Native tests, agent-host smoke, typecheck, build, syntax, hygiene, and future
  feature audits pass.
