# Electron + C# voice boundary

Skai Desktop uses Electron/React for the UI and the existing C# agent host for
local desktop capabilities. Voice uses the same validated JSON-lines bridge as
the rest of the desktop app:

```text
React renderer
  ├─ local Web Speech Recognition (`processLocally = true`)
  └─ window.skaiAgent.request("voice.*")
       └─ Electron main-process IPC allowlist
            └─ Skai Desktop C# agent host
                 └─ Windows Speech or Linux espeak-ng, espeak, or spd-say
```

The C# host provides:

- `voice.models` — the installed OS-native default and catalog entries for
  optional Kokoro and Pocket TTS model packs.
- `voice.speak` — begins OS-native, interruptible speech for bounded text.
- `voice.stop` — immediately ends the current native speech process.
- `voice.status` — reports whether the OS-native speech process is still active,
  so hands-free chat can wait before reopening the microphone.

The chat composer uses the browser's local speech-recognition mode for dictation
and never falls back to remote recognition. One-shot dictation inserts text in
the composer. Hands-free mode submits the final transcript, requests speech for
that reply without changing the normal voice-output preference, waits for local
speech to finish, then resumes listening. Turning hands-free off stops both
recognition and any reply currently being spoken. If local recognition is unavailable
or a language pack is missing, the composer explains the limitation and keeps
remote recognition disabled. Runtime microphone/language-pack acceptance is
still open. Packaged Windows smoke confirms that Electron exposes the local
recognition and language-pack installer APIs; on the audited machine, the
runtime reports the en-US pack unavailable, and the composer fails closed
without requesting microphone access. Barge-in and streamed speech are not
implemented.

The renderer owns the selected voice profile, primary model, and low-resource
model. OS-native speech ships as the installed default. Kokoro and Pocket TTS
can be presented in Marketplace, but remain unavailable until their model-pack
runtime and verified download adapter are implemented in C#.
