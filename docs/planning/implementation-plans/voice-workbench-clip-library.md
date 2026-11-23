# Voice Workbench clip library

## Goal

Make recordings attached to a Voice Workbench profile truly manageable. Clips
remain local, survive app restarts, can be previewed before use, and can be
removed without deleting the voice profile. This slice prepares a reliable
source library for a future compatible voice-cloning adapter; it does not claim
that Skai can train or synthesize a custom clone today.

## Requirements and decisions

- Keep IndexedDB as the local audio-byte store and localStorage for small
  profile metadata; never upload clips or put audio bytes in localStorage.
- Give every clip a stable unique key so two files with the same name do not
  overwrite one another.
- Load actual stored clips when a profile is selected; show accurate clip count,
  filename, size, and local audio preview.
- Let the user remove an individual clip. Update the profile's displayed
  metadata only after the IndexedDB transaction succeeds.
- Accept the existing WAV, MP3, M4A, OGG, and FLAC formats; reject oversized
  files and cap each add operation to the remaining profile capacity.
- Handle unavailable IndexedDB, quota/write failures, and profile switching
  without showing unsaved filenames as stored clips. Revoke preview object URLs
  when clips are replaced or the page unmounts.
- Preserve the one-time rights notice and the pending/adapter-unavailable state.
  No automatic upload, model build, or claim of cloning support is added.

## Integration steps

1. Extend the existing IndexedDB helper with list and remove operations and
   unique clip keys, preserving old stored records.
2. Make the selected profile load its stored clips asynchronously and reconcile
   visible clip metadata with successful database writes.
3. Add per-clip playback and removal controls with accessible names, size
   disclosure, and storage/error status.
4. Verify TypeScript, production renderer build, and a focused disposable
   Electron workflow covering duplicate names, reload/list, decoded local audio
   previews, and removal. Update the voice plan and capability matrix with the
   exact boundary.

## Acceptance boundary

Acceptance proves persistent local clip management only. It does not prove
voice-clone model training, reference-voice inference, automatic rebuild,
cross-profile export, subjective audio quality, or cloud storage.
