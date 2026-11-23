# Smart Personas

## Integration plan

1. Extend the existing local `SavedPersona` setting rather than introducing a second store. Store the source mode, cutoff, voice/personality card, user material, bounded excerpts, and source records.
2. Add bounded `persona.*` Agent Host methods for listing, activating, saving, removing, and opt-in public-figure research. Reuse `WebSearchProvider`; fetch only a few text-only result pages with size and timeout limits.
3. Treat public status as an evidence gate: require multiple results and at least one reputable-source domain before allowing a researched card to be saved. If evidence is unclear, the UI directs the user to own-material mode.
4. Bind the active persona to chat and persisted conversations. Inject a clearly labeled simulation instruction with cutoff, quote attribution, privacy, and counterfeit-artifact rules before local inference.
5. Keep the builder in-app with two explicit modes, a reviewable card, a local library, and visible persona context in chat. Exports and copied messages retain the simulation label.

## Acceptance criteria

- Public research is opt-in, bounded, and records source title, URL, type, reliability note, and short excerpt.
- Own-material mode performs no web request and accepts bounded notes, messages, memories, and descriptions.
- A saved persona has an explicit cutoff and source basis; a private or unclear person cannot be researched through the save path.
- Chat always receives the simulation identity and cutoff policy; it cannot claim to be the real person or invent real quotes.
- Conversations remember the persona and exports/copies preserve the “AI simulation … Not the real person” label.
- Electron bridge, local-only audit, desktop typecheck, Agent Host build, and native tests pass.

## Live acceptance

`npm run smoke:personas -- --only "David Lynch"` now saves the researched death
date as the persona's knowledge cutoff and asks a second question about 2026 in
the same conversation. The 2026-11-22 run with local `qwen3:14b` passed with
three sources, 60 attributed transcript turns, nine drafted fields, and a
cutoff-aware follow-up. A separate Joe Rogan run passed with three sources, 59
attributed turns, nine fields, and a conversational response. The smoke now
accepts `--era-date YYYY-MM-DD`, applies that date to research before drafting,
persists it on the test card, and probes the following year. Joe Rogan's 2010
era run passed discovery, research, drafting, and its first in-character turn,
but three follow-up attempts ended with the local Ollama server closing the
stream without a reply. Era-cutoff dialogue therefore remains unverified; this
is recorded as a model-runtime failure, not a pass or a product-policy failure.
On 2026-11-23, the prompt was tightened to state that all events after the
effective cutoff are unknown from the persona's perspective, even if already
public in the real world, and must not be repeated or elaborated on. Native core
acceptance passed. A live David Lynch 2010-era run on `qwen3:14b` passed identity,
research, nine-field drafting, in-character chat, and cutoff follow-up (2011 was
treated as beyond the persona's time). The same scenario on `lfm3-omni:2b-q4_K_M`
failed persona identity and cutoff acceptance despite successful research and
drafting. The product still needs a minimum supported local-model tier decision;
until then, broad persona quality across model sizes remains open.
