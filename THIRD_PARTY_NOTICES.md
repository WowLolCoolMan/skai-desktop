# Third-party notices

The root [LICENSE](LICENSE) applies to Skai-owned material only. The components
and adaptations listed below, their bundled upstream license files, and any
other material marked with a separate license remain governed by their
respective licenses. Those third-party terms may grant rights that differ from
the terms for Skai-owned code.

Skai Desktop includes these renderer libraries. The packages are bundled for offline use; neither package contacts a service.

- `marked` — MIT License. Copyright (c) 2018+, MarkedJS. The complete license is included at `node_modules/marked/LICENSE` in the source distribution and in the packaged application.
- `DOMPurify` — Apache License 2.0 (one of the package's offered license choices). Copyright (c) 2014-2025 Cure53 and contributors. The complete Apache license is included at `node_modules/dompurify/LICENSE` in the source distribution and packaged application. The package also distributes its MPL-2.0 license text.

These notices do not change the licenses of the third-party packages. See the included upstream license files for their complete terms.

The native .NET app also uses `PdfPig` 0.1.16 to extract selectable text from user-selected PDFs locally. PdfPig is licensed under Apache License 2.0 and includes additional third-party notices; the full upstream license and notices are included in [licenses/PdfPig-LICENSE.txt](licenses/PdfPig-LICENSE.txt). The package source is pinned to [UglyToad/PdfPig commit a7bb356](https://github.com/UglyToad/PdfPig/tree/a7bb35662bbbf405efddad50aedc9bcdcf515afc).

Open WebUI was researched as product and architecture inspiration only. No Open WebUI source code or assets are included. See [the research note](docs/research/OPEN_WEBUI_RESEARCH.md).

The built-in theme gallery (`apps/desktop/src/theme/presets/`) includes color palettes from Catppuccin, Dracula, Nord, Gruvbox, Tokyo Night, Solarized, Rosé Pine, One Dark/One Light (Atom), Everforest, Kanagawa, Night Owl, Monokai (as shipped in VS Code), Ayu (ayu-vim) and GitHub (Primer primitives). They are used under the MIT License or, for Tokyo Night and Ayu, the Apache License 2.0. Each palette's copyright line, license and source repository are listed in [licenses/THEME-PALETTES.md](licenses/THEME-PALETTES.md); the Apache License 2.0 text is in [licenses/Apache-2.0.txt](licenses/Apache-2.0.txt). The Material Theme palette was not included because no permissive license could be confirmed for it.

OpenPets pet-runtime code is adapted in Skai's desktop-pet engine. Adapted subsystems include the generation-owned playback lifecycle from the OpenPets `pet-motion-player.cjs` and the shared-ticker/eased-motion design from `pet-motion-engine.ts`. The Skai integration retains its own Electron window, grid pathfinding, sprite profiles, and task-event contract. OpenPets is Copyright (c) 2026 OpenPets and is licensed under the MIT License; the complete notice is at [licenses/OpenPets-MIT.txt](licenses/OpenPets-MIT.txt). Source: https://github.com/OpenPetsHQ/openpets.
