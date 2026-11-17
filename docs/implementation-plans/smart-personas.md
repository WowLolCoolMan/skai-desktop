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
