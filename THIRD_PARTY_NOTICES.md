# Third-party notices

Skai Desktop includes these renderer libraries. The packages are bundled for offline use; neither package contacts a service.

- `marked` — MIT License. Copyright (c) 2018+, MarkedJS. The complete license is included at `node_modules/marked/LICENSE` in the source distribution and in the packaged application.
- `DOMPurify` — Apache License 2.0 (one of the package's offered license choices). Copyright (c) 2014-2025 Cure53 and contributors. The complete Apache license is included at `node_modules/dompurify/LICENSE` in the source distribution and packaged application. The package also distributes its MPL-2.0 license text.

These notices do not change the licenses of the third-party packages. See the included upstream license files for their complete terms.

The native .NET app also uses `PdfPig` 0.1.16 to extract selectable text from user-selected PDFs locally. PdfPig is licensed under Apache License 2.0 and includes additional third-party notices; the full upstream license and notices are included in [licenses/PdfPig-LICENSE.txt](licenses/PdfPig-LICENSE.txt). The package source is pinned to [UglyToad/PdfPig commit a7bb356](https://github.com/UglyToad/PdfPig/tree/a7bb35662bbbf405efddad50aedc9bcdcf515afc).

Open WebUI was researched as product and architecture inspiration only. No Open WebUI source code or assets are included. See [docs/OPEN_WEBUI_RESEARCH.md](docs/OPEN_WEBUI_RESEARCH.md).

The built-in theme gallery (`apps/desktop/src/theme/presets/`) includes color palettes from Catppuccin, Dracula, Nord, Gruvbox, Tokyo Night, Solarized, Rosé Pine, One Dark/One Light (Atom), Everforest, Kanagawa, Night Owl and Monokai (as shipped in VS Code). They are used under the MIT License or, for Tokyo Night, the Apache License 2.0. Each palette's copyright line, license and source repository are listed in [licenses/THEME-PALETTES.md](licenses/THEME-PALETTES.md); the Apache License 2.0 text is in [licenses/Apache-2.0.txt](licenses/Apache-2.0.txt). The Material Theme palette was not included because no permissive license could be confirmed for it.
