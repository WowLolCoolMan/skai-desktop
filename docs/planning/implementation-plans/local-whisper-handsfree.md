# Local Whisper hands-free Voice Mode

## Goal

Make the existing local turn-based Voice Mode work when Chromium's optional
offline SpeechRecognition pack is unavailable. Use Skai's installed local
Whisper runtime for microphone turns. Do not introduce remote recognition or
change one-shot dictation behavior.

## Integration plan

1. Replace only the persistent hands-free loop with microphone capture,
   silence-based utterance segmentation, and the existing cancellable local
   Whisper transcription API.
2. Stop microphone capture while Whisper transcribes, while the model runs,
   and while local speech playback runs, then resume listening after playback.
3. Keep the microphone stream, recorder, level-monitor timer, and transcription
   abort controller under Voice Mode lifecycle cleanup. Ending the session
   cancels in-flight transcription and prevents a late transcript from being
   submitted.
4. Clearly report missing Whisper, microphone denial, empty speech, and
   transcription failures in the active Voice Mode panel. Never fall back to
   browser or remote speech recognition.
5. Preserve one-shot recording and its existing Whisper/native-local options.
6. Add focused segmenter tests and extend packaged microphone acceptance to
   exercise hands-free capture through local Whisper, including session stop.

## Acceptance criteria

- Hands-free Voice Mode works without browser `SpeechRecognition` support.
- Each detected utterance is transcribed through the installed local Whisper
  adapter and submitted once to the active chat.
- Microphone capture is stopped during transcription/model response/speech
  playback to reduce echo and unnecessary recording.
- End Voice Mode stops the microphone and aborts current Whisper work; no late
  transcript is submitted after stop. The packaged smoke ends a real fixture
  turn while Whisper is transcribing and confirms no chat turn appears during
  a 10-second observation window; the adapter smoke verifies worker-process
  cancellation directly.
- Missing Whisper or unavailable microphone is explained without remote
  fallback.
- Existing one-shot dictation and audio-file transcription remain intact.
- Typecheck, build, focused audio-level checks, packaged microphone acceptance,
  syntax, and local-only/bridge audits pass.
- Fetch `origin/main` immediately before commit; integrate upstream changes,
  rerun relevant checks, then push the completed slice.

## Known boundary

This remains turn-based voice. It does not add streamed speech, barge-in, or
full-duplex interruption.
