# Theme work: plan and log

The THEME session's plan for complete UI customization of Skai Desktop
(`apps/desktop`: Electron + React + TypeScript + Vite), and a log of every round.
User-facing theming docs will live in `docs/THEMING.md` (Phase 3).

## Plan

Phases run in order, one item per round. Each round: claim files in
`~/srai-coordination.md`, check what main changed in the last 3 hours, make the
change, run every check, push to `main`, log it below, release the claims.

1. **Dark-mode dropdowns.** Native `<select>` popups, menus, pickers and tooltips
   must match the app theme. Sync Electron's `nativeTheme.themeSource` with the
   app's Light/Dark/System setting through one bridge method; theme `<option>`s;
   the theme smoke test opens popups in each theme and fails on the wrong scheme.
2. **Everything themeable.** Move every hard-coded color, font, radius and shadow in
   `src/**/*.css` and inline styles to `--skai-*` tokens. Add the missing tokens
   (on-accent text, selection, focus ring, scrollbars, links, diff added/removed,
   terminal ANSI 16, code syntax). A check wired into `check:syntax` fails on
   color literals outside `tokens.css` and theme files.
3. **Theme files (dotfiles).** JSON theme families
   (`{ $schema, name, author, license, themes: [{ name, appearance, colors, gradients, fonts }] }`)
   with keys mapped to `--skai-*` tokens; `docs/theme.schema.json` and
   `docs/THEMING.md`. Built-in presets ship read-only. User themes go in
   `<userData>/themes/*.json`, settings in `<userData>/appearance.json` (which
   overrides a theme's fonts). Settings → Appearance and the command palette get:
   Open themes folder, Edit current theme, Duplicate as my theme, Import Base16/Base24
   (`.yaml`, documented base00–base0F/base17 mapping), Export, Reload, Reset.
   The main process watches the folder, validates files and sends parsed themes over
   the bridge; the renderer never gets raw filesystem access. **Security:** theme files are
   untrusted input. Only validated values are accepted: colors, ranged numbers,
   gradients built by our code from validated stops, and font names from a validated
   list. No raw CSS, `url()`, `@import` or expressions. Files are size-capped. A bad file
   shows a non-blocking message (file, key, problem) and the last good theme stays.
   Light / Dark / System with separate light and dark picks, following the OS live.
4. **Fonts.** Four roles: UI (menus, buttons, sidebar), headings, chat reading
   text, and code (code blocks, Monaco, terminal, diffs). Each role has family, size,
   weight, line height and letter spacing as tokens; hard-coded font values
   migrate to the role tokens. Font picker: a searchable list of installed fonts
   (`queryLocalFonts()` in Electron, or listed by the main process), each name drawn
   in its own font, with a live preview line per role. The code role lists or recommends
   monospace fonts and warns when the pick isn't monospace. Custom fonts: `.ttf/.otf/.woff2`
   in `<userData>/fonts/` (with an "Open fonts folder" button), loaded with the FontFace API
   through a safe local path that keeps `audit:local-only` green. Files are validated
   (size cap, real font signature); a bad font falls back with a clear message and never
   crashes. Each role falls back through chosen font → system UI font → safe default, so a
   missing font never shows boxes or a blank UI. Themes may carry a `fonts` section (same
   role keys); `appearance.json` overrides it. No new bundled fonts unless small and
   OFL (listed in `THIRD_PARTY_NOTICES.md`), because the DEBLOAT session is shrinking the app.
5. **Gradients.** Canvas, sidebar, toolbar, global rail, composer, user message
   bubble, primary buttons, brand mark, the empty-state backdrop and the existing
   `data-backdrop` surfaces may use a gradient instead of a solid color.
   Format: `{ "gradient": "linear" | "radial" | "conic", "angle": 135, "stops": [{ "color": "#1e1e2e", "at": 0 }, …] }`.
   A plain `"#RRGGBB"` string still works everywhere. Our code builds the CSS from validated
   stops, and theme switches swap gradients live. The gradient editor in Appearance has a
   surface picker, solid/linear/radial/conic, an angle dial, add/drag/remove stops and a
   live preview. It saves into the user's copy of the theme (Duplicate first for built-ins).
   Presets: Aurora, Sunset, Deep Sea, Synthwave, each light and dark, marked as original
   Skai themes in `license`. **Contrast** is checked against every stop, not the average:
   the editor warns, and a failing preset doesn't ship. Gradients are static unless reduce
   motion is off and the user turns on "animate background". Scroll smoothness is compared
   with and without gradients. An audit fails on inline gradient stops in views (only
   gradient tokens).
6. **Preset gallery.** Skai (dark + light), Catppuccin (Latte, Frappé, Macchiato,
   Mocha), Dracula, Nord, Gruvbox (dark + light), Tokyo Night (Night, Storm, Day),
   Solarized (dark + light), Rosé Pine (main, Moon, Dawn), One Dark + One Light,
   Everforest (dark + light), Kanagawa, GitHub (dark + light), Ayu (dark, mirage, light),
   Monokai, Material, Night Owl, high-contrast light + dark, plus the gradient presets.
   Official palette values from each project's repo. Each license is checked (non-permissive
   ones are skipped); source, license and copyright go in `THIRD_PARTY_NOTICES.md` and in
   the theme's `license` field. An automated contrast test covers every preset (text ≥ 4.5:1
   on every background, on-accent ≥ 4.5:1, borders/focus ≥ 3:1, high contrast ≥ 7:1);
   only the failing token is adjusted, with a note. Gallery UI: swatch cards with a mini
   preview, search, light/dark filter, a "Your themes" section, click to preview, then apply.
7. **Rest of Appearance** (in `appearance.json`). Text size scale, corner style, density,
   chat width, message style, sidebar/rail sections and widths, accent override, reduce
   motion (off/on/system), a live preview card, and "Reset appearance".

**Checks every round:** `desktop:typecheck`, `desktop:build`, `npm test`, `check:syntax`,
`check:hygiene`, `audit:bridge-methods`, `audit:local-only`, `audit:electron-runtime`,
`smoke:electron:themes` (needs `npm run package:electron` first), and screenshots of affected
screens with popups open in a light and a dark theme (1440x900, and 760x560 through CDP
emulation, since the window's minimum size is 960x640).

**Never:** `--force`, rebase, push anywhere but `main`, touch `codex/*` branches, push failing
code, inject raw CSS from files, or ship a preset without checking its license.

## Notes

- Screenshots go to `.theme-shots/` (excluded through `.git/info/exclude`). Native `<select>`
  popups are separate X windows, so CDP screenshots miss them. They're captured on a private
  display: `kwin_wayland --virtual` plus `Xwayland :7`, with the packaged app run with
  `DISPLAY=:7 --ozone-platform=x11` and the whole X screen grabbed.
- `smoke:electron:themes` launches the packaged app on the real display. One early run timed out
  on `system/deep-space`; the next runs passed unchanged, so treat a lone timeout as a flake
  and rerun.

## Log

### Round 1: dark-mode dropdowns (Phase 1)

**Before** (`.theme-shots/before/`): in the dark theme, every native `<select>` popup in the
app (21 `<select>`s in `src/`) opened as a white list with near-white option text, so it was
unreadable. This happened even with the OS in dark mode. The light theme was fine.
Custom menus (model picker, composer command menu, overflow menu, environment picker) already
used tokens and rendered correctly in both themes.

**Cause:** the expected cause (`nativeTheme.themeSource` never set) was only half of it. On Linux,
Chromium paints the popup from each `<option>`'s own computed colors, and a transparent option
paints white whatever `color-scheme` says. `nativeTheme` decides `prefers-color-scheme`, the
highlighted-row color and native frames/dialogs. Without syncing it, a light app on a dark desktop
(or the reverse) reports the OS scheme.

**Fix:**
- `tokens.css`: `option, optgroup` use `--skai-color-surface` and `--skai-color-text`. The light
  `system` block also gained the missing `--skai-color-border-strong`.
- New shell-handled bridge method `appearance.setNativeTheme` (`electron/main.cjs`, validated
  `light|dark|system`), called from `src/theme/useNativeThemeSync.ts` whenever the theme changes.
  It goes through the existing generic `agent:request` channel, so preload needs no change, and
  `audit:bridge-methods` counts it as handled by the shell.
- `smoke:electron:themes` now fails when an `<option>` is transparent or below 4.5:1 contrast,
  or when the native scheme disagrees with a light/dark app theme. Confirmed it fails without the
  option rule.

**After** (`.theme-shots/after/`): themed popups in dark, light and system. The dark highlight is
Chromium's light blue with dark text (readable).
