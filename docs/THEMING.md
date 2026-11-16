# Theming Skai Desktop

Skai Desktop's look comes from theme files: plain JSON you can open, copy and edit.
The schema is `docs/theme.schema.json`; most editors use it for completion when the file's
`$schema` points at a copy of it (Export puts one next to your themes).

> Status: theme files, light/dark picks, the themes folder, live reload, Edit, Duplicate,
> Import Base16/Base24, Export and Reset all work (theme work, Phase 3). Fonts work: theme
> fonts, the font picker, your overrides and a custom fonts folder (Phase 4). Gradients are
> validated now and applied in Phase 5.

## Using a theme

1. Settings → Appearance → **Open themes folder**.
2. Save a `.json` theme family there (see below), or copy one and edit it.
3. Pick it under **Light theme** or **Dark theme**. **Color theme** (Light / Dark / System) decides
   which of the two is shown; System follows your OS as it changes.

Skai watches the folder: saving a theme file updates the app straight away. **Reload themes**
re-reads everything by hand. A file with mistakes doesn't block anything: the problems are listed
under the buttons (file, key, what's wrong), and a theme that was already working stays as it was
until the file is fixed. Your picks are saved in `appearance.json`.

## Appearance buttons (also in the command palette, under "Theme:")

| Button | What it does |
|---|---|
| Open themes folder | Opens `<userData>/themes/` in your file manager |
| Edit current theme | Opens the active theme's file in your default editor (your own themes; built-ins are read-only) |
| Duplicate as my theme | Copies the active theme to `my-<name>.json`, switches to the copy and opens it for editing |
| Import Base16/Base24… | Converts a [Tinted Theming](https://github.com/tinted-theming/schemes) `.yaml` scheme into a theme file and switches to it |
| Export current theme… | Saves the active theme as a standalone JSON file anywhere |
| Reload themes | Re-reads the folder (it's also watched automatically) |
| Reset to default | Switches back to Skai Light and Skai Dark (your files are kept) |

`theme.schema.json` is written into the themes folder, and new theme files point their `$schema` at it.

## Base16 / Base24 mapping

Imported schemes use the Base16 styling guidelines. Base24 adds real bright ANSI colors.

| Base | Skai keys |
|---|---|
| base00 | `canvas`, `terminal-surface`, `ansi-black` |
| base01 | `surface`, `sidebar`, `code-surface`, `checker-a` |
| base02 | `surface-raised`, hover fills, `user-bubble`, `checker-b` |
| base03 | `border-strong` (and `border` at 55%), `syntax-comment`, `ansi-bright-black`, scrollbar |
| base04 | `text-muted`, sidebar muted/icon text, `terminal-muted` |
| base05 | `text`, `code-text`, `sidebar-text`, `terminal-text`, `ansi-white` |
| base06 | `sidebar-strong` |
| base07 | `ansi-bright-white` |
| base08 | `danger`, `diff-removed-*`, `ansi-red`, `syntax-variable` |
| base09 | `syntax-number` |
| base0A | `warning`, `ansi-yellow`, `syntax-type` |
| base0B | `success`, `diff-added-*`, `ansi-green`, `syntax-string` |
| base0C | `info`, `inline-code-text`, `attachment-text`, `ansi-cyan` |
| base0D | `accent`, `link`, `focus-ring`, selection, sidebar active, `brand-mark`, `ansi-blue`, `syntax-function` |
| base0E | `accent-strong`, `ansi-magenta`, `syntax-keyword` |
| base0F | `favorite` |
| base12–base17 (Base24) | `ansi-bright-red`, `-yellow`, `-green`, `-cyan`, `-blue`, `-magenta` (Base16 reuses the normal ones) |

`on-accent` is whichever of base00, base07, white or black contrasts most with base0D. Light or dark
comes from the scheme's `variant`, or from base00's brightness. Check the scheme's own license
before you share an imported theme.

## Where themes live

| What | Where |
|---|---|
| Built-in presets (read-only) | shipped inside the app (`apps/desktop/src/theme/presets/`) |
| Your themes | `<userData>/themes/*.json` |
| Your appearance settings | `<userData>/appearance.json` |

`<userData>` is Electron's user data folder:

- Linux: `~/.config/skai-desktop/`
- Windows: `%APPDATA%\skai-desktop\`
- macOS: `~/Library/Application Support/skai-desktop/`

## A theme family

One file holds a family: one or more themes, each light or dark. Light / Dark / System
picks a light theme and a dark theme separately, so a family usually ships one of each.

```json
{
  "$schema": "./theme.schema.json",
  "name": "Harbor",
  "author": "You",
  "license": "CC0-1.0",
  "themes": [
    {
      "name": "Harbor Night",
      "appearance": "dark",
      "colors": { "canvas": "#14181f", "surface": "#1b2029", "text": "#e6e9ef", "text-muted": "#9aa3b2", "accent": "#7cc4ff", "on-accent": "#0b1622" },
      "gradients": { "canvas": { "gradient": "linear", "angle": 135, "stops": [{ "color": "#14181f", "at": 0 }, { "color": "#1d2533", "at": 1 }] } },
      "fonts": { "reading": { "family": "Literata, Georgia", "size": 15, "lineHeight": 1.65 } }
    },
    { "name": "Harbor Day", "appearance": "light", "colors": { "canvas": "#f6f8fb", "text": "#18202d", "accent": "#0b63b6", "on-accent": "#ffffff" } }
  ]
}
```

Any key you leave out keeps the built-in Skai value for that light or dark appearance, so
a small theme only needs the colors it changes.

## Colors

Each key under `colors` sets one CSS token: `canvas` sets `--skai-color-canvas`, `ansi-red` sets
`--skai-ansi-red` and `syntax-string` sets `--skai-syntax-string`. Values can be `#rgb`, `#rgba`,
`#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()` and `hsl()`/`hsla()` with plain numbers, or `transparent`.

| Group | Keys | What they color |
|---|---|---|
| Surfaces | `canvas`, `surface`, `surface-raised`, `surface-soft` | App background, panels and cards, raised controls and menus, hover fills |
| Lines | `border`, `border-strong` | Default borders, hover or emphasized borders |
| Text | `text`, `text-muted` | Body text, secondary text |
| Accent | `accent`, `accent-strong`, `on-accent` | Selection, primary actions, links; its darker step; text on an accent fill |
| Status | `success`, `warning`, `info`, `danger`, `danger-text`, `danger-strong`, `favorite` | Status dots and messages, error text and headings, starred items |
| Focus and selection | `focus-ring`, `selection`, `link` | Keyboard focus ring, selected text, links (default: the accent) |
| Scrollbars | `scrollbar-thumb`, `scrollbar-track` | Scrollbars |
| Depth | `overlay`, `shadow` | Backdrop behind dialogs; the color every shadow is mixed from |
| Sidebar | `sidebar`, `sidebar-text`, `sidebar-strong`, `sidebar-muted`, `sidebar-subtle`, `sidebar-icon`, `sidebar-hover`, `sidebar-history-hover`, `sidebar-active`, `sidebar-active-border`, `sidebar-border` | The left sidebar and its rows |
| Chat | `user-bubble`, `user-bubble-border`, `attachment-text` | Your message bubble, attachment chips |
| Code | `code-surface`, `code-text`, `inline-code-text`, `syntax-keyword`, `syntax-string`, `syntax-number`, `syntax-comment`, `syntax-function`, `syntax-type`, `syntax-variable`, `syntax-punctuation` | Code blocks, inline code, syntax highlighting |
| Diffs | `diff-added-surface`, `diff-added-text`, `diff-removed-surface`, `diff-removed-text` | Added and removed lines |
| Terminal | `terminal-surface`, `terminal-text`, `terminal-muted`, `ansi-black` … `ansi-white`, `ansi-bright-black` … `ansi-bright-white` | Terminal output and its 16 ANSI colors |
| Brand and media | `brand-mark`, `on-brand-mark`, `checker-a`, `checker-b`, `document-page` | App mark, transparency checkerboard, PDF/HTML preview page |

## Gradients

These surfaces can be a gradient instead of a solid color: `canvas`, `sidebar`, `toolbar`,
`rail`, `composer`, `user-bubble`, `primary-button`, `brand-mark`, `empty-state`, `backdrop`.
A plain color string works too.

```json
"gradients": {
  "canvas": { "gradient": "linear", "angle": 135, "stops": [{ "color": "#1e1e2e", "at": 0 }, { "color": "#313244", "at": 1 }] },
  "composer": { "gradient": "radial", "stops": [{ "color": "#24273a", "at": 0 }, { "color": "#1e2030", "at": 1 }] }
}
```

`gradient` is `linear`, `radial` or `conic`. `angle` (0–360°, default 180) applies to linear and conic.
`stops` has 2–8 entries with `at` from 0 to 1. Skai builds the CSS from these values itself. Text must stay
readable against every stop, not just the average.

## Fonts

Four roles: `ui` (menus, buttons, sidebar, everything by default), `heading` (all headings),
`reading` (chat messages) and `code` (code blocks, inline code, terminal, diffs, the file editor).
Each role takes:

| Key | Range | Effect |
|---|---|---|
| `family` | up to 4 plain font names | First installed one wins; then the system UI font (or the system monospace font for `code`), then a generic family, so a missing font never shows boxes |
| `size` | 8–32 px | `ui`: scales the whole interface (13 = default). `heading`: scales every heading (20 = default). `reading`: the chat text size in px. `code`: scales code text (12 = default) |
| `weight` | 100–900 | Font weight for the role |
| `lineHeight` | 1–2.5 | Line height for the role |
| `letterSpacing` | −0.1 to 0.3 em | Tracking for the role |

```json
"fonts": {
  "reading": { "family": "Literata, Georgia", "size": 15, "lineHeight": 1.65 },
  "code": { "family": "JetBrains Mono, Fira Code", "size": 13 }
}
```

### Choosing fonts in Appearance

Settings → Appearance → **Fonts** has one row per role. **Choose** opens a searchable list of
the fonts installed on this computer, each drawn in its own font. For **Code**, monospace fonts
come first and are marked, and choosing a font that isn't monospace shows a warning.
Size, weight, line height and spacing apply as you leave each field (or press Enter), with a live
preview line per role. Your choices are saved under `fonts` in `appearance.json` and override
the active theme's fonts property by property. **Reset** on a row goes back to the theme's
fonts.

The installed-font list comes from Chromium's Local Font Access API (`queryLocalFonts()`) on
Windows, macOS and Linux. If that isn't available, Linux falls back to fontconfig (`fc-list`).

### Your own font files

Put `.ttf`, `.otf`, `.woff2` or `.woff` files in `<userData>/fonts/` (**Open fonts folder**). Linux:
`~/.config/skai-desktop/fonts/`. Each file becomes a family named after the file
(`Literata-Regular.ttf` → "Literata Regular") and shows up first in the picker. Skai checks each
file before using it: up to 32 files, 10 MB each and 40 MB in total, regular files only (no links),
and the file must start with a real font signature. It then loads the bytes with the browser's
`FontFace` API. Loading from bytes works the same way on every platform and every Linux display
server (X11 and Wayland alike), because no file paths or URLs are involved. A file that fails any
check, or that the browser can't parse, is listed under the problems and skipped; it never breaks
the UI. The folder is watched, so new files appear straight away.

Skai doesn't bundle extra fonts. Use the fonts already on your computer or put your own in
this folder.

## What is rejected, and why

Theme files are treated as untrusted. Skai never copies text from a theme file into CSS: it keeps
only values that match the shapes above and builds the CSS itself. So a theme can't load anything
from the internet or run code. `url()`, `@import`, `var()`, `color-mix()`, `expression()`, color
keywords other than `transparent`, and quotes or semicolons in font names are all rejected.
Files over 256 KB are rejected too. A bad key is skipped, and a bad file is ignored while
the last good theme stays in use. Each problem is reported with the file, the key and what's wrong.
