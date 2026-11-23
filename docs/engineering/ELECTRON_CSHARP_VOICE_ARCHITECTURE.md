# Electron + C# voice boundary

Skai Desktop uses Electron/React for the UI and the existing C# agent host for
local desktop capabilities. Voice uses the same validated JSON-lines bridge as
the rest of the desktop app:

```text
React renderer
  ├─ local Web Speech Recognition (`processLocally = true`)
  ├─ MediaRecorder → local Whisper transcription (`voice.whisper.transcribe`)
  └─ window.skaiAgent.request("voice.*")
       └─ Electron main-process IPC allowlist
            └─ Skai Desktop C# agent host
                 ├─ Windows Speech or Linux espeak-ng, espeak, or spd-say
                 └─ Verified Pocket TTS worker on Windows x64 (loopback only)
```

The C# host provides:

- `voice.models` — the installed OS-native default and catalog entries for
  optional Kokoro and Pocket TTS model packs.
- `voice.speak` — generates bounded OS-native speech or requests a complete WAV
  from an installed local adapter.
- `voice.stop` — stops native speech and terminates Pocket TTS generation when
  it is active.
- `voice.status` — reports whether the OS-native speech process is still active,
  so hands-free chat can wait before reopening the microphone.

One-shot dictation uses the installed local Whisper large-v3 runtime when
available: microphone audio is captured as WebM, limited to five minutes and
20 MB, and transcribed through the offline host. The recording is inserted
into the draft for review before sending. If Whisper is not installed, the
composer may use the browser's local recognition mode (`processLocally = true`);
it never falls back to remote recognition. Hands-free mode uses local Whisper
with pause-segmented microphone turns and requests speech for replies. During
reply playback it monitors the microphone with echo cancellation and requires
sustained input before interrupting speech; the new turn is recorded and
transcribed locally, retaining a short microphone pre-roll so the beginning of
the user's utterance is not discarded. Ending hands-free mode stops capture,
transcription, and playback. Packaged barge-in acceptance remains open, and
voice responses are still turn-based rather than streamed.

The renderer owns the selected voice profile, primary model, and low-resource
model. OS-native speech ships as the installed default. Pocket TTS is
Marketplace-installable on Windows x64; it verifies a pinned standalone
runtime, warms both English model variants, uses the built-in attributed
`alba` voice, and returns local WAV audio. Its resident worker binds only to
`127.0.0.1`. Custom voice clips and streamed playback are not integrated.
Kokoro and other catalog entries have separate install and runtime coverage;
availability is reported per adapter rather than inferred from a listing.
