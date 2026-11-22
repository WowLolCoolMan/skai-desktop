# Omni-modal input menu

## Goal

Give the chat composer one predictable entry point for every supported input type: files and folders, audio transcription, microphone dictation, and hands-free Voice Mode. Keep text entry in the composer, keep all processing local, and preserve the existing review-before-send attachment behavior.

## Integration plan

1. Add an `Add` control beside the composer actions that opens a modal instead of forcing users to discover separate media controls.
2. Present the supported input actions with short descriptions and current attachment count.
3. Route each action into the existing guarded handlers: file picker, local audio transcription, one-shot dictation, or hands-free Voice Mode.
4. Close the modal after an action is selected and leave the draft/attachment state unchanged until the existing handler reports success.
5. Keep the existing controls available in the composer for keyboard and power-user workflows.

## Acceptance criteria

- One accessible modal exposes files, audio, voice input, and Voice Mode.
- Selecting an option invokes the existing local-only path and closes the modal.
- Existing drag/drop, attachment review, and keyboard submission behavior remains unchanged.
- The modal is keyboard navigable and Escape-safe through `ModalDialog`.
- Typecheck, build, syntax, hygiene, future-feature audit, native tests, and Agent Host smoke pass.
- Before commit, fetch `origin/main`, rebase if it advanced, rerun checks, then push the finished commit to `main`.
