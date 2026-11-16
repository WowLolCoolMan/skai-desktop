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

### Round 2: tokens, scheme attribute, color audit (Phase 2, part 1)

Round 1 was committed as 6b16659 and pushed to main in the merge acbccbb.

- **Inventory:** `styles.css` had about 200 color literals (40 of them pet-window art), 420 px font sizes,
  229 px radii and 40 shadows. It had no light-theme overrides, so every literal looked the same in light mode.
  The **Accent** setting (Cyan/Violet/Amber/Rose) sets `data-accent`, but no CSS reads it, so
  it does nothing yet (Phase 7, accent override).
- **New tokens** (`tokens.css`, dark in `:root`, light in one block): on-accent, focus ring, selection, link,
  scrollbar thumb and track, success, warning (it was referenced but never defined), info, danger text and
  danger strong, favorite, overlay, shadow color plus popover and dialog shadows, user bubble and its
  border, inline-code text, attachment text, brand mark, transparency checkerboard, document page,
  diff added/removed (surface + text), terminal surface/text/muted, ANSI 16, and 8 syntax colors.
  Light now has its own danger, code surface and code text (it used the dark values before).
- **One light palette:** `src/theme` sets `<html data-scheme="light|dark">` from the theme mode
  (System follows the OS live through `matchMedia`). `tokens.css` now has a single
  `[data-scheme="light"]` block instead of a light block plus a duplicate inside
  `@media (prefers-color-scheme: light)`.
- **Migration:** 140 literals in `styles.css` became tokens or `color-mix()` tints of tokens. Accent,
  danger, success and info tints keep their alpha as a percentage; shadows use `--skai-color-shadow`;
  dialog backdrops use `--skai-color-overlay`. The migration is a re-runnable script, so a conflict with
  the owner's edits can be re-applied to his version.
- **Audit:** `scripts/audit-theme-tokens.cjs` (`npm run audit:theme-tokens`, also run by
  `check:syntax`) fails when a file gains a color literal outside `tokens.css` and
  `src/theme/presets/`. It's a ratchet: `scripts/theme-token-baseline.json` holds what's left
  (56 in pet-window and backdrop art, 3 paint colors in the pet pixel editor), and counts can
  only go down (`--update` lowers them). Checked that it fails when a literal is added.
- **Screens:** before/after CDP screenshots of 10 routes in dark and light (`.theme-shots/r2-*`):
  at most 0.4% of sampled bytes changed. Light checkerboards are now light.
- **Found for later:** in light, the accent `#b39af5` is used as text (eyebrows, the selected chip)
  at about 2.2:1 on white, below AA. Fix in the contrast pass (light accent plus white on-accent).

### Round 3: type and corner scales (Phase 2, part 2)

Round 2 was committed as 17bb50e and pushed to main in the merge 8cce092.

- **Type scale:** all 420 px font sizes in `styles.css` and `pluginsMcpHealth.css` now use 13 steps,
  `--skai-text-3xs` (8px) through `--skai-text-6xl` (34px). Each step is
  `calc(Npx * var(--skai-text-scale))`, so Phase 7's text-size setting only sets
  `--skai-text-scale`. In-between sizes snap to the nearest step (ties round up): 15→16, 17→18, 19/21→20,
  22/23/25→24, 26→28.
- **Corner scale:** all 229 px radii (multi-value ones too) use `--skai-radius-xs` (4px) through
  `--skai-radius-3xl` (20px) plus `--skai-radius-pill`, each multiplied by `--skai-radius-scale` (the
  Phase 7 corner-style knob). 9px snapped to 10px; 50% circles stay 50%. The six old
  `--skai-radius-lg` (12px) uses became `--skai-radius-xl`, which keeps them at 12px.
- **Fonts:** the two hard-coded monospace stacks now use `--skai-font-mono`. Font roles and weights are
  Phase 4.
- **Shadows:** all 40 now take their color from `--skai-color-shadow` (round 2), so themes control them.
  Their geometry stays per component.
- **Audit:** `audit:theme-tokens` also fails on px `font-size` and px radii in CSS (both baselines are 0).
- **Screens** (`.theme-shots/r3-after`): 0.1–3% of sampled bytes changed against round 2. The
  only visible change is a few headings 1px larger (17→18px).

### Round 4: theme file format, validator, schema (Phase 3, part 1)

Round 3 was committed and pushed as 01fbbc3.

- **Validator** `apps/desktop/electron/theme-files.cjs`, used by the main process. It accepts a theme family
  (`name`, `author`, `license`, `themes[]` of `{ name, appearance, colors, gradients, fonts }`). It keeps only
  values that match strict shapes and canonicalizes colors (rgb/hsl are rebuilt from their numbers), and
  builds gradients from validated stops. Font names must be plain names. It rejects `url()`, `@import`,
  `var()`, `color-mix()`, `expression()`, keywords, oversized files (over 256 KB), more than 16 themes,
  unknown keys and out-of-range numbers. Each problem is reported as `{ file, key, problem }`, and a bad key
  doesn't sink the file.
- **Keys:** 78 color keys, one per color token (`ansi-*` and `syntax-*` keep their prefix), 10 gradient surfaces and 4 font roles.
- **Built-in Skai family:** `src/theme/presets/skai.json` (Skai Dark + Skai Light) is generated from
  `tokens.css` by `scripts/theme-generate.cjs`. The 4 tokens defined as `var()` or `color-mix()`
  (focus ring, selection, link, scrollbar thumb) stay CSS defaults.
- **Schema** `docs/theme.schema.json` is generated from the validator's key lists.
- **Docs:** `docs/THEMING.md` covers locations (userData on Linux is `~/.config/skai-desktop/`), the format,
  every color key and what it colors, gradients, fonts, and what is rejected and why.
- **Tests** `scripts/test-theme-files.cjs` (`npm run test:themes`, also run by `check:syntax`) cover
  12 groups: accepted colors; injection attempts (`url()`, `;` breakouts, `expression()`, `var()`, `@import`);
  dropped keys reported with problems; prefixes; structure; caps and bad JSON; gradients; fonts; every key
  maps to a real token; `skai.json` and the schema in sync; every shipped preset valid with a license.
- **Next:** load user themes from `<userData>/themes`, watch and live-reload them, bridge the validated
  themes to the renderer, apply tokens live, and add theme picks and folder actions in Appearance.

### Round 5: user themes, live reload, theme picks (Phase 3, part 2)

Round 4 was committed and pushed in the merge e13a3ab.

- **Main process:** `electron/theme-service.cjs` (new) reads `<userData>/themes/*.json` (up to 64 files;
  symlinks and oversized files are refused) and the picks in `<userData>/appearance.json`, and validates
  them with `theme-files.cjs`. It keeps each file's **last good** version while the file is broken,
  watches the folder and `appearance.json` (200 ms debounce), and pushes the validated snapshot over
  `appearance:changed`. The changes to `main.cjs` are one `require`, two setup lines and one dispatch line for
  the shell-handled methods `appearance.getThemes`, `appearance.saveThemeSelection` and
  `appearance.openThemesFolder`. `preload.cjs` gained `appearance.onChanged`.
- **Renderer:** `src/theme/themeEngine.ts` (new) merges the built-in presets (bundled through
  `import.meta.glob`) with the user's families. It resolves the light or dark pick for the current
  scheme (missing pick → Skai default) and applies its colors as inline `--skai-*` properties on
  `<html>`, after re-checking each value against a plain-color pattern. The built-in Skai family applies
  nothing inline: `tokens.css` already defines it, and inline values would override the per-backdrop
  accents. `useThemeEngine` (renamed from `useNativeThemeSync`) starts the engine and feeds it the
  resolved scheme.
- **Appearance:** `src/theme/ThemeSettings.tsx` adds **Light theme** and **Dark theme** pickers (grouped by
  family, with the file name for user themes), **Open themes folder**, **Reload themes**, the folder path, and a
  non-blocking problem list. It's one line in `SettingsPage.tsx`, with styles in `src/theme/theme.css` (tokens only).
- **Smoke test:** `smoke:electron:themes` now writes a theme into the isolated profile's `themes/` folder,
  picks it, edits it while the app runs (live reload), and breaks it. It then checks the last good version
  stays and a problem is shown, and that the pick was saved to `appearance.json`. The final screenshot is
  best-effort, because on the real desktop the compositor sometimes doesn't hand over a frame (the
  same steps on the private display screenshot fine).
- **Docs:** `THEMING.md` gained "Using a theme".

### Round 6: Edit, Duplicate, Import Base16/Base24, Export, Reset, palette (Phase 3, part 3)

Round 5 was pushed as 60f8861. On its last push attempt the push wasn't gated on the checks, so it went
out after a `Page.captureScreenshot` timeout in the smoke test. The same tree then passed the smoke test
3 out of 3 times. Pushes are now gated on every check in the same command.

- **Main:** `theme-service.cjs` gained the shell-handled methods `appearance.editTheme` (user themes only;
  the id must name a plain `.json` file in the folder, so traversal and the schema file are refused),
  `appearance.duplicateTheme`, `appearance.importBase16` (open dialog; `.yaml`/`.yml` up to 64 KB) and
  `appearance.exportTheme` (save dialog). Anything written is re-validated first and refused if any value
  would be dropped. New files never overwrite (`wx`, unique `-2`, `-3` names). `theme.schema.json` is
  written into the themes folder, and the folder scan skips it.
- **Base16/Base24:** `electron/theme-base16.cjs` reads the flat Tinted Theming shape (quoted or not,
  `palette:` or top-level, `#` comments) with a line parser, so there's no YAML dependency, and only
  6-digit hex values are accepted. The mapping table is in `THEMING.md`. On-accent is picked by contrast,
  and light or dark comes from `variant` or base00's brightness.
- **Renderer:** `themeEngine` gained `editCurrent`, `duplicateCurrent` (switches to the copy and opens
  it), `importBase16` (switches to the import), `exportCurrent` and `resetToDefault`, each with a
  dismissible notice. Appearance shows the seven buttons; Edit is disabled for built-ins with a tooltip
  that says why.
- **Command palette:** commands can now run an action as well as navigate (`run?`), and seven "Theme: …"
  entries come from `src/theme/themeCommands.ts`. This is a small edit to `CommandPalette.tsx`.
- **Schema** generation moved into `theme-files.cjs` (`buildSchema`), so the app can write it. The output
  is byte-identical.
- **Tests:** 16 groups now: Base16 conversion with no dropped values, the old unquoted format, Base24 brights,
  light detection, refused incomplete or oversized schemes, and service tests on a temp folder (schema
  copy, duplicate naming, unsafe definitions refused, built-in edit refused, traversal ids refused, edit
  opens the right file).
- **Smoke:** per-theme screenshots are now best-effort too (they're evidence, not assertions).
