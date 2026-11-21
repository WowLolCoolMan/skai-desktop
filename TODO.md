# Skai Desktop — TODO

_Last updated: 2026-11-20 (end of session)._

## In progress: pets (uncommitted on `main` working tree — not pushed)

Files: `apps/desktop/electron/main.cjs`, `apps/desktop/electron/pet-chase.cjs` (new),
`apps/desktop/src/components/overlays/PetWindow.tsx`, `apps/desktop/src/styles.css`,
`scripts/test-pet-attack.cjs`, `scripts/test-pet-animations.cjs` (new), `package.json`.

Done and passing (`npm run test:pet`, `npm run check:syntax`, `npm run desktop:typecheck`, hygiene):
- [x] Animation asset smoke (`scripts/test-pet-animations.cjs`, part of `test:pet`): all 7 companions,
      69 animated-WebP clips (frame counts match manifests), 11 state animations, 64 fallback strips.
- [x] Ember's own `ember-curl` / `curious-scan` animations now play (were mapped to generic idle/review).
- [x] Cursor chase (`pet-chase.cjs`): Blaze follows a moving cursor (throttled re-plans), strikes within
      260 px, gives up after 7 s by walking home. Previously any cursor move > 22 px cancelled the attack.
      Unit-tested with simulated cursor paths.
- [x] More dramatic attacks: rage aura and bristle wind-up, reticle lock-on, pounce lunge across the
      scene (crouch → leap → impact squash) with shockwaves, spark burst, flash and scene shake; fire breath
      with recoil, embers streaming to the cursor, and a scorch mark. Reduced-motion/paused states disable them.

Still to do before committing:
- [ ] Live visual check of a real Blaze attack (script drafted at
      `/tmp/claude-1000/-home-leith/05ed4696-17fe-4ee6-b606-c8fa74d22d80/scratchpad/pet-attack-live.cjs`
      — temp profile, Blaze, 10 s interval, records pose/position/cursor and screenshots each attack pose).
      Confirm the lunge lands on the cursor and effects line up with the target in the widened scene.
- [ ] Verify fire-breath now using the 460 px fight scene still positions Blaze's flame clip correctly.
- [ ] Run the full suite (artifact/themes/overflow smokes), then commit and push to `main`.
- [ ] Non-Blaze companions have no pounce/fire-breath clips by design (only Blaze attacks the cursor);
      decide whether other pets should get cursor attacks (needs new animation clips).

## Personas (pushed in a178cf8)

- [ ] Rerun the full live persona smoke on the uncensored model; SpongeBob and Boog have not had a full
      run since the memory cap and host-concurrency fix, and Jack Sparrow's chat was lost to an OOM kill:
      `SKAI_PERSONA_SMOKE_MODEL=huihui_ai/llama3.2-abliterate:3b npm run smoke:personas` (~45 min on CPU).
- [ ] Review persona chat replies for immersion once that run completes; tune prompt/voice reference.
- [ ] Linux dictation / audio transcription needs a local Whisper runtime (feature decision pending).

## Machine notes (this PC)

- Ollama: user install at `~/.local/share/ollama`, user service `~/.config/systemd/user/ollama.service`
  with `OLLAMA_CONTEXT_LENGTH=8192`, `OLLAMA_NUM_PARALLEL=1`, `OLLAMA_MAX_LOADED_MODELS=1` (8 GB RAM;
  avoids OOM kills).
- Default model: `huihui_ai/llama3.2-abliterate:3b`. Stock `llama3.2` still installed for two older
  conversations; remove with `ollama rm llama3.2` when no longer needed. Settings backup:
  `~/.config/SkaiDesktop/AI/settings.json.bak-before-abliterate`.
- Don't compile while a model is generating: the extra RAM pressure has OOM-killed Ollama twice.
- README Linux section: optional Hyprland rule to hide the border around the pet window (not added yet).
