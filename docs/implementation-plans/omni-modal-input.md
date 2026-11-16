# Omni-modal input

## Goal

Make text, image, document, audio, and video input feel like one coherent Skai chat workflow. The existing local pipeline already validates text/PDF/image files, samples MP4/WebM into bounded image frames, and transcribes audio locally. This slice closes the integration gap by representing a completed audio transcript as a normal, reviewable attachment instead of silently merging it into the draft.

## Integration plan

1. Keep raw audio local and process it through the existing on-device transcription path.
2. Convert successful transcription into a bounded `text/plain` attachment named as an audio transcript.
3. Show that transcript in the existing attachment list so users can inspect or remove it before sending.
4. Persist it through the existing message and queue attachment contracts; the provider already treats attachment text as untrusted context.
5. Preserve microphone dictation as draft input, since it is live speech-to-text rather than a source file.
6. Add focused frontend helper coverage through typecheck/build and update the capability backlog to distinguish integrated behavior from environment-dependent speech-pack availability.

## Context map

| File | Purpose | Change |
|---|---|---|
| `apps/desktop/src/features/chat/ChatComposer.tsx` | Audio picker/drop handling | Emit a transcript attachment callback after local transcription. |
| `apps/desktop/src/features/chat/ChatPage.tsx` | Composer wiring | Pass the transcript attachment action into the composer. |
| `apps/desktop/src/features/chat/useChatWorkspace.ts` | Draft attachment state | Add bounded transcript attachment state update. |
| `apps/desktop/src/features/chat/AttachmentList.tsx` | Attachment presentation | Label transcript attachments clearly. |
| `docs/FUTURE_FEATURES.md` | Backlog status | Record the unified attachment behavior and remaining speech-pack acceptance gap. |

## Acceptance criteria

- Selecting a supported local audio file produces a visible “Audio transcript” attachment after successful transcription.
- The transcript can be removed before send and is included in normal/queued conversation attachment persistence.
- Live microphone dictation still inserts text into the draft.
- Audio remains local; no raw audio payload is sent to the model host.
- Existing image, PDF, text, and video-frame flows remain unchanged.
- Typecheck, build, syntax, hygiene, future-feature audit, native tests, and Agent Host smoke pass.
- Before commit, fetch `origin/main`; rebase if it advanced, rerun checks, then push the finished commit to `main`.
