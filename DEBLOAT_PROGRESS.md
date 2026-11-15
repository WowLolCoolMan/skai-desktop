# De-bloat progress

One small, verified step per commit. Removed files are backed up to `../skai-asset-backup/` (outside the repo)
before deletion. History is never rewritten, so these steps shrink the working tree and future clones of
new history, not the existing `.git` pack (127 MiB at the start).

## Checklist

- [x] 1. Audit: record folder sizes under `assets/`, duplicate files by hash, and unreferenced assets. — 0 bytes (audit only)
- [x] 2. Repoint references to `assets/pets/*-frames.png` (for example in `apps/desktop/src/features/settings/SettingsPage.tsx`) at the identical copies in `assets/pets/generated/`. — 0 bytes (the 6 Settings previews now load from `generated/`; no other code referenced the root strips)
- [x] 3. Remove the root-level `assets/pets/*.png` files that duplicate `generated/`. — 18,702,316 bytes (42 strips; `normalize-pet-animations.ps1` now reads them from `generated/`)
- [x] 4. Remove `assets/pets/archive/legacy-sheets/`, if nothing references it. — 30,703,586 bytes (13 sheets; only the pets README and the archived legacy tools mentioned them; restore from the parent of this step's commit)
- [x] 5. Remove unreferenced `generated/*-walk-source.png` files and walk frames replaced by `-v2` versions. — 0 bytes (all of them are still referenced; see Needs review)
- [x] 6. Remove unreferenced PNGs in `assets/branding/` (check README, docs and site HTML first). — 0 bytes (all 4 PNGs are referenced)
- [ ] 7. Compress the remaining PNGs losslessly with oxipng, keeping filenames and dimensions.
- [x] 8. Make sure `.gitignore` covers `bin/`, `obj/`, `.tmp/`, `dist/`, `release/` and `node_modules/`, and add a check that flags new files over 1 MB. — 0 bytes (`.gitignore` now ignores `bin/`, `obj/` and `.tmp/` everywhere; `npm run check:hygiene`, which runs in both CI workflows, now fails on tracked files over 1 MiB that aren't on its allowlist, and also rejects tracked `release/`, `node_modules/` and `.tmp/` paths)

**Total saved so far:** 49,405,902 bytes

## Verification gate

Each step must pass: `desktop:typecheck`, `desktop:build`, `check:syntax`, `check:pet-assets`, `test:pet`,
`audit:electron-runtime`, `check:hygiene`, `dotnet build` of `native/SkaiDesktop.Core`,
`native/SkaiDesktop.Core.Tests` and `services/agent-host`, and `npm test` (the native test runner, which uses
`dotnet run`; there is no `dotnet test` project).

Note: on a machine whose interactive bash profile is slow to exit, the PTY test
("interactive project terminal accepts input…") times out after 15 s. That happens on untouched `main` too.
The gate runs `npm test` with `SHELL=/bin/sh`, and all checks pass that way.

## Step 1 audit (2026-11-15, at `3312388`)

### Folder sizes

| Folder | Files | Bytes |
| --- | ---: | ---: |
| `assets/` (total) | 461 | 115,085,938 |
| `assets/branding/` | 5 | 6,916,364 |
| `assets/pets/` (root files only) | 383 | 48,679,862 |
| `assets/pets/generated/` | 57 | 28,774,712 |
| `assets/pets/archive/legacy-sheets/` | 13 | 30,703,586 |
| `assets/pets/archive/legacy-tools/` | 3 | 11,538 |

Breakdown of the `assets/pets/` root:

| Group | Files | Bytes | Referenced? |
| --- | ---: | ---: | --- |
| `<pet>-<state>-frames.png`, non-walk (byte-identical to `generated/`) | 42 | 18,702,316 | Settings page (6 idle strips) and `normalize-pet-animations.ps1` (rebuild input) |
| `<pet>-walk-frames.png` (differs from `generated/`) | 6 | 1,458,347 | No |
| `<pet>-<state>-<1..6>.png` individual frames | 288 | 25,715,741 | No |
| `<pet>-<state>.png` single images | 42 | 2,796,367 | No |
| `byte.svg`, `rocky.svg`, `sprout.svg` | 3 | small | — |

### Duplicates by SHA-256

42 duplicate pairs. Every one is `assets/pets/<pet>-<state>-frames.png` ⇔ `assets/pets/generated/<pet>-<state>-frames.png`
for the 6 pets × 7 non-walk states. There are no other duplicates under `assets/`.

### References

- Runtime (`PetWindow.tsx`) loads only `generated/<pet>-<state>-frames.png`, with `-walk-frames-v2.png` for byte, nova and rocky.
- `SettingsPage.tsx` loads root-level `assets/pets/<pet>-idle-frames.png`, which step 2 repoints.
- `scripts/validate-pet-assets.cjs` requires `generated/${pet}-${state}-frames.png` for **all** 8 states, including `walk`.
- `assets/pets/normalize-pet-animations.ps1` reads `generated/$pet-walk-source.png` and copies root-level
  `$pet-$state-frames.png` into `generated/` (its default input directory is `assets/pets/`).
- `assets/pets/README.md` says `archive/legacy-sheets/` is kept "for rollback only" and is not loaded at runtime,
  and that the walk source strips are "kept as the editable visual inputs".
- Branding: `skaiwolficon.png` is used by the app, the packager and the README; `skai-desktop-hero.png` by the README;
  `skai-desktop-mark.png` and `skai-desktop-architecture.png` are listed in `assets/branding/SKAI_UI_ASSET_PACK.md`
  (the site uses its own `.webp` copies in `docs/site-assets/`).

### Unreferenced assets

- `assets/pets/<pet>-<state>-<1..6>.png` — 288 files, 25.7 MB, not referenced anywhere.
- `assets/pets/<pet>-<state>.png` — 42 files, 2.8 MB, not referenced anywhere.
- `assets/pets/<pet>-walk-frames.png` (root) — 6 files, 1.5 MB, not referenced anywhere.
- `assets/pets/archive/legacy-sheets/*` — 13 files, 30.7 MB, referenced only by the README and the archived legacy tools.

## Needs review

- **Unlisted cleanup (≈30 MB):** the 288 individual frame PNGs, the 42 single-state PNGs and the 6 root walk strips
  above are unreferenced, but no step covers them. They're kept until the owner decides.
- **Walk sources (5,347,226 bytes, 6 files):** `normalize-pet-animations.ps1` reads `generated/$pet-walk-source.png`, and the
  pets README calls them the editable inputs. They're only removable if that rebuild path is retired.
- **Walk strips replaced by `-v2` (1,475,957 bytes):** `generated/{byte,nova,rocky}-walk-frames.png` aren't loaded at runtime,
  but `validate-pet-assets.cjs` requires `${pet}-walk-frames.png` for every pet, and the rebuild script writes that name
  (not `-v2`). Rerunning the rebuild would not update the `-v2` strips the app actually uses. To remove them, first make
  the validator and rebuild script aware of `-v2`.
- **`normalize-pet-animations.ps1`:** step 3 changed its default input to `generated/`. The change wasn't run, because
  PowerShell (`pwsh`) isn't installed here.
- **`archive/legacy-tools/`** (11 KB) still reads and writes the removed `*-sprite-sheet.png` files, so those scripts
  no longer have inputs. Kept, because no step covers them.
- **`skai-desktop-mark.png` and `skai-desktop-architecture.png` (3,356,954 bytes):** mentioned only in
  `assets/branding/SKAI_UI_ASSET_PACK.md`. Nothing in the app or site loads them (the site uses `docs/site-assets/*.webp`).
  Removable if that asset-pack guide is updated too.

## Failures

- **Step 7 blocked (2026-11-15):** no PNG optimiser is installed (`oxipng`, `pngquant`, `optipng` and `zopflipng` are all
  missing), installing from the `extra` repo needs sudo, and downloading the release binary was blocked by the permission
  check. Nothing was changed. To unblock it, run `sudo pacman -S oxipng`; the next run will then do step 7.
  Step 8 was done first because it doesn't depend on step 7.
- **Push (2026-11-15):** blocked at first because there were no HTTPS credentials. Steps 1–6 and 8 were rebased onto
  `a633b42`, re-verified, and pushed to `main` over SSH once the owner approved it.
