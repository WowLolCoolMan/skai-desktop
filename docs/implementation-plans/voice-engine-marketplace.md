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
  cloud voice option. This does not add a hosted model route or weaken the
  local model boundary.
- Persona cards can persist an assigned local voice profile. Chat and Coding
  continue to use the shared Settings default when no persona override is
  present.
- Persona Groups can read turns aloud sequentially, selecting each speaker's
  assigned voice profile and waiting for speech to finish before the next
  speaker starts.
- Structured effect tags such as `[cough]` and `[laugh]` are removed at the
  native fallback boundary when the current engine cannot render them. The
  fallback never says the tag aloud.

## Honest remaining integration work

The catalog is intentionally capability metadata, not a claim that every
upstream project is already bundled. The next vertical slices must add:

1. Adapter-first installation records and verified model downloads.
2. A local adapter protocol for streaming audio, cancellation, cloning, and
   typed prosody/effect cues.
3. Voice Workbench clip storage, one-time rights notice, incremental rebuild
   state, and profile assignment UI.
4. Secure user-key storage and an explicit optional cloud voice adapter.
5. Full-duplex Voice Mode with streaming audio, interruption, barge-in, and
   device acceptance tests.

Until those slices land, unconnected engines remain visibly catalog-only and
Skai falls back to OS-native speech with an explicit failure message.
