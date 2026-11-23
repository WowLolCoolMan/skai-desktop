# Voice engine marketplace

## Implemented in this slice

- The native voice catalog now exposes OS-native speech plus a broad local
  engine catalog: Kokoro, Pocket TTS, F5-TTS, Fish Speech, CosyVoice,
  GPT-SoVITS, OpenVoice, StyleTTS 2, Piper, and XTTS v2.
- Every entry reports runtime, license/model caveat, streaming, cloning,
  emotion, audio-effect, low-resource, and adapter availability metadata.
- Marketplace distinguishes `Available locally`, `Ready to install`, and
  `Catalog only`. A source URL alone never makes an engine installable.
- Marketplace advertises an optional ElevenLabs connector as a user-key
  cloud voice option. Voice & Audio now lets the user choose local/system or
  ElevenLabs cloud speech, enter a voice ID, and test it from the same
  settings surface. Provider credentials are stored through the OS-protected
  secret store, never in workspace settings. The Agent Host reads a key only
  for an explicit cloud speech request; spoken reply text is sent to the
  selected provider and is disclosed in Voice settings.
- Persona cards can persist an assigned local voice profile. Chat and Coding
  continue to use the shared Settings default when no persona override is
  present.
- Persona Groups can read turns aloud sequentially, selecting each speaker's
  assigned voice profile and waiting for speech to finish before the next
  speaker starts.
- Pocket TTS now has a real Windows x64 Marketplace installer and local speech
  adapter. Skai verifies the official runtime archive and executable hashes,
  installs the pinned English standard and low-resource weights, attributes the
  built-in `alba` voice, and binds its local server only to `127.0.0.1`. A
  Marketplace-driven acceptance installs both model variants and confirms a
  valid WAV response through `voice.speak`. This adapter does not expose custom
  voice cloning, streamed playback, or effect cues.
- Voice Workbench now keeps audio bytes in local IndexedDB and profile metadata
  in localStorage. Users can add clips incrementally, preview saved recordings,
  and remove individual clips. Duplicate filenames remain distinct; each
  profile allows up to 48 clips, 12 per add, and 50 MB per clip. These are
  source-library controls only; no clone build is claimed while no compatible
  adapter is installed.
- Structured effect tags such as `[cough]` and `[laugh]` are removed at the
  native fallback boundary when the current engine cannot render them. The
  fallback never says the tag aloud.

## Honest remaining integration work

The catalog is intentionally capability metadata, not a claim that every
upstream project is already bundled. The remaining work includes:

1. Adapter-first installation and verified model downloads for the other
   catalog entries that can be supported in Skai.
2. A common local adapter protocol for streaming playback, cancellation,
   cloning, and typed prosody/effect cues. Pocket TTS currently returns a
   complete WAV and can cancel generation by stopping its local worker.
3. A compatible reference-voice adapter and build lifecycle for Voice
   Workbench; current clip storage and management are local-only.
4. Full-duplex Voice Mode with streaming audio, interruption, barge-in, and
   device acceptance tests.

Until those slices land, unconnected engines remain visibly catalog-only and
Skai falls back to OS-native speech with an explicit failure message.
