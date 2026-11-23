# Local voice mode

## Goal

Turn Skai’s existing hands-free dictation/reply loop into an explicit Voice Mode that is easy to understand while it is active. The session remains local-first: Skai's installed Whisper runtime captures and transcribes turns, the selected model answers, and the existing local speech output reads the reply. This is turn-based and does not claim ChatGPT-style streaming or acoustic barge-in.

## Integration plan

1. Rename the hands-free entry point to Voice mode and make its active state unambiguous.
2. Add an in-composer Voice Mode panel with live state (listening, waiting for the local reply, or ready to listen again).
3. Provide a direct End voice mode control in that panel.
4. Preserve one-shot Voice dictation as a separate control and preserve Documents-only requirements.
5. Use installed local Whisper for hands-free capture; preserve one-shot dictation and audio-file transcription behavior.
6. Pause microphone capture during transcription and model speech, and cancel transcription when Voice Mode ends.
7. Keep true streaming/barge-in acceptance open.

## Context map

| File | Purpose | Change |
|---|---|---|
| `apps/desktop/src/features/chat/ChatComposer.tsx` | Voice controls and hands-free loop | Present explicit Voice Mode state and end-session action. |
| `apps/desktop/src/styles.css` | Composer visual language | Add compact voice-session panel styling using existing tokens. |
| `docs/planning/FUTURE_FEATURES.md` | Backlog status | Document the Voice Mode UX milestone and remaining runtime gaps. |

## Acceptance criteria

- The composer exposes separate one-shot `Voice` and persistent `Voice mode` actions.
- When Voice Mode is active, the user sees whether Skai is listening, waiting for a reply, or preparing to listen again.
- End voice mode stops recognition, stops speech output, clears reconnect timers, and returns to normal chat.
- Local-only speech-pack errors remain visible and actionable.
- Typecheck, build, syntax, hygiene, future-feature audit, native tests, and Agent Host smoke pass.
- Fetch `origin/main` before commit; rebase and rerun checks if it advanced, then push the finished feature to `main`.
