# Voice Mode session surface

## Goal

Make hands-free voice interaction feel like a deliberate ChatGPT-style session rather than a small inline toggle, while keeping Skai's local-only speech boundary explicit.

## Integration plan

1. Keep the existing on-device recognition and native speech-output turn loop as the source of truth.
2. Replace the inline hands-free strip with a modal session surface that reports listening, waiting for the model, and preparing the next turn.
3. Provide one prominent End voice mode action and retain Escape as a safe exit.
4. Make the visual state communicate that the microphone is local and that no turn is submitted until on-device recognition produces final text.
5. Preserve one-shot dictation and audio-file transcription as separate composer actions.

## Acceptance criteria

- Starting Voice Mode opens a focused session surface without navigating away from the chat.
- The surface distinguishes listening, model response, and next-turn preparation.
- End voice mode stops recognition, cancels speech output, and returns focus to the composer.
- Speech-pack and microphone errors remain visible and actionable.
- No remote speech fallback is introduced.
- Typecheck, build, syntax, hygiene, future-feature audit, native tests, and Agent Host smoke pass.
- Before commit, fetch `origin/main`, rebase if it advanced, rerun checks, then push the finished commit to `main`.
