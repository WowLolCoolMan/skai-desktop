# Skai Desktop UI evidence

This file is the current UI evidence index. It replaces historical agent
handoffs and temporary screenshot paths. The live Electron artifact and the
automated acceptance scripts are authoritative; this document only summarizes
what they cover.

## Targeted Revision 4 continuity pass — 2026-11-24

- Refined Images against references #24–25. Generate and Edit are the two
  primary modes, secondary ComfyUI tools are under More tools, and the local
  runtime state is visible beside the engine selector. Generate uses a centered
  prompt-first form when history is empty. Edit places the source image left,
  prompt/actions right, and history in a bottom strip. Reopening history with
  **Use for edit** switches to Edit automatically and preserves both source
  previews.
- Captured and reviewed the packaged Generate state at 1440×900 and 390×844,
  and the Edit state at 1440×900. See the three tracked screenshots in the
  [Revision 4 collection](../design-review/workflow-collection/revision-4/README.md).
- `npm run desktop:typecheck`, `npm run desktop:build`, and
  `npm run package:electron` passed. The one-route packaged layout smoke passed
  for Images at both 1440×900 and 390×844. The mobile pass showed no page-level
  horizontal overflow after stacking the runtime and engine controls.
- `node scripts/smoke-image-workflow.cjs --edit-ui` passed: it seeds a local
  512×512 test history item in a throwaway profile, reopens it for editing,
  checks both source previews, checks the Edit action, and verifies the
  1440×900 layout has 0px horizontal overflow. The fixture does not claim to
  verify inference.
- `node scripts/smoke-image-workflow.cjs --model-unavailable` passed and
  verifies the actionable retry state. The full `npm run smoke:image:workflow`
  completed cancellation but could not generate: the packaged runtime is
  installed, while the local `stabilityai/sd-turbo` cache contains only partial
  `.incomplete` blobs. The smoke was kept offline and did not download the
  several-gigabyte model. Rerun after completing the local model cache to verify
  generation, image-to-image edit, and history persistence.
- A fresh packaged 1440×900 route capture passed for all 20 routes in the dark,
  expanded-sidebar variant. Focused smokes passed for Chat queue, conversation
  search/import, task planner handoff, task journaling and schedules, project
  browser/terminal/editor, PDF attachment validation, Memory, REA MCP,
  Marketplace host, and the Voice Workbench clip lifecycle. Persona UI
  selection/start was covered by the earlier interaction matrix. A local
  David Lynch persona run created all nine profile fields on Qwen3 14B and
  respected the 2010 cutoff, while its reply missed the smoke's phrase matcher;
  LFM3 2B matched the opening style but made unsupported claims about 2011.
  These are model-content findings, and the broad suite also defaults to the
  uninstalled `llama3.2` model on this machine.
- Three focused smoke harnesses were repaired after live packaged runs exposed
  stale assumptions: isolated Electron app-data launch in Image and Task
  Re-plan, current Images selectors and actions, and Voice Workbench's isolated
  app-data switch. AirLLM status in the Agent Host smoke now has enough time for
  its local Python/Torch import; the packaged Agent Host smoke then passed its
  schedule, memory, persona, voice-protocol, and task lifecycle checks.

## Revision 4 implementation pass — 2026-11-23

### Changes made

- Kept Persona Workshop and Pet Workshop as separate pages; the Persona page
  uses a selectable persona list with a focused profile editor and a direct
  Start conversation action. The Pet page presents optional companion
  selection, visibility, appearance, animation, and return-to-work actions
  before the advanced editor.
- Kept the Coding Agent thread beside Monaco on desktop. The Monaco editor
  now has a project/file-specific model identity. Its Review diff action shows
  a read-only Original / Working copy comparison because the packaged Monaco
  DiffEditor cleanup raised a runtime error during view changes. Git's actual
  line-level diff review remains separate and available.
- Tightened mobile Coding context actions and kept the editor/chat workspace
  scrollable within the work surface.
- Kept Video labeled as a planned future destination; no generation or editing
  capability is represented as available.

### Packaged evidence

- `npm run desktop:typecheck`, `npm run desktop:build`, and
  `npm run package:electron` passed after the UI changes. Vite still prints
  the existing large-chunk advisory.
- The packaged route matrix passed 20 routes at 1440×900 in dark/light themes
  with the sidebar expanded/collapsed, with no renderer runtime or layout
  findings.
- Packaged Chat and Coding checks passed at 390×844. The active Coding
  project flow was checked at that size after the editor workspace was scrolled
  internally; there was no page-level horizontal overflow or clipped control.
- Chat's seeded history search, task-tools visibility toggle, and import-menu
  availability passed. Coding's edit → compare → save → undo flow passed at
  desktop and mobile sizes. Persona selection/start-conversation and Pet
  select/visibility/customization/return-to-work smokes pass.

### Waiting for acceptance

- Compare each of the 30 supported Revision 4 workflow references against its
  matching live state and record screenshot plus interaction evidence. The 20
  route matrix renders screens but does not by itself prove all 30 workflows.
- Add focused interaction checks for references #4–#19 and #21–#29 where the
  matching state is not covered above, especially document grounding, Voice
  Mode, task/schedule lifecycle, GitHub, model-download review, Marketplace
  voice installation, MCP approval, image edit/history, multimodal input,
  Voice Workbench, Memory/corpus, and Usage/Settings.
- Confirm local model-backed generation against a responsive local runtime;
  UI rendering alone does not verify inference. Keep Video future-only.
- Finish keyboard/focus, screen-reader, theme, and user-perceived visual
  review. The automated package checks do not establish spoken assistive
  technology behavior.

## Current shell

- Electron + React + TypeScript is the only desktop UI architecture.
- The narrow global rail owns Home, Image Gen, Usage, and Settings.
- The adjacent sidebar owns projects, conversations, search, and the active
  session context.
- Secondary tools are opened through the searchable command launcher rather
  than being permanently listed in the thread sidebar.
- Pets use a separate transparent always-on-top Electron window with drag,
  bounded placement, optional wandering, sprite customization, and reduced
  motion support. All seven built-ins are inspectable in Pet Workshop.

## Current feature surfaces

- Chat has persisted conversations, attachments, drag-and-drop, queueing,
  keyboard-accessible commands, retry/edit flows, and local task planning.
- Marketplace has host-backed catalog/search, model filters, selected-item
  details, verified local install review, and installed/update states.
- Settings has searchable categories, Pet controls, model/provider settings,
  AirLLM readiness checks, voice, image, agent, storage, privacy, and update
  states.
- Models uses inspect-first rows and a selected-model details inspector.
- Coding, Workbench, Terminal, Memory, Images, Usage, and project/GitHub flows
  expose honest empty, unavailable, loading, and failure states.

## Professional and comfortable UI goal loop

The product owner wants every Skai Desktop page to feel professional and
comfortable, with Settings and Coding Agent as the first priorities. Keep this
work in the existing Electron + React design system and preserve the behavior
behind every control.

For each page or closely related page group, repeat this loop:

1. Inspect the live page, its behavior, the relevant UI reference, and its
   empty, loading, error, and success states.
2. Make a focused hierarchy, spacing, navigation, and responsive-layout pass
   with existing components and theme tokens.
3. Run renderer typecheck/build. Inspect the Electron page at 1920, 1440,
   1280, 960, and 640 px in dark, light, and system themes; fix overflow,
   clipped controls, poor contrast, and confusing states.
4. Record evidence and remaining gaps here, then pick the next page from the
   active task in [`TO_DO_NEXT.md`](TO_DO_NEXT.md).

The goal is complete after every listed route has been reviewed in the live
app and representative screenshots and interaction evidence are recorded.

### First pass completed

- Settings now has a clearer modal header, searchable preference navigation,
  active-category state, stronger section hierarchy, and responsive layouts.
  Existing categories, save behavior, runtime controls, and platform states are
  preserved.
- The Coding Agent project session now separates conversation, project files,
  Git review, and task inspection more clearly. The repeated project title was
  removed from the status strip, and the workspace adapts at narrower widths.
- Shared page headers, panel headings, empty states, and form controls received
  a consistent spacing and hierarchy pass.
- Marketplace Discover now starts with a concrete local-workspace action strip,
  reports the active runtime and local inventory, routes directly to model
  search or installed inventory, and labels catalog entries as ready, setup
  required, or limited instead of presenting every card as an available
  feature. Its catalog cards now describe the actual next action. The main
  Marketplace hub also has direct starting actions for model discovery, MCP
  connection, and installed inventory; Updates now performs a real release
  channel check through the existing update bridge. Usage now reports truthful
  local workspace counts and selected provider/model context while keeping
  unmeasured token, cost, GPU, and latency values out.
- Marketplace now exposes Voices as a first-class destination, includes locally
  installed voice runtimes when the host catalog has no voice entries, and
  General settings now stores per-job preferred model assignments for chat,
  coding, prompt rewriting, vision, and voice. The Chat assignment is restored
  as the default model on the next workspace start.
- `npm run desktop:typecheck` and `npm run desktop:build` passed after these
  changes. Vite still reports its existing large-chunk warning.
- `npm run package:electron` published the Agent Host but could not finish
  staging runtime dependencies because `registry.npmjs.org` was unreachable
  while fetching `universalify@2.0.1`. Retrying the UI matrix against that
  partial package failed before the renderer opened, so it is not acceptance
  evidence.

### Remaining visual review

The first pass has not been visually accepted in a running Electron window.
Continue the route-by-route review with Chat and the Coding Agent, then Projects,
Models, Images, Marketplace, Plugins, Memory, Personas, Pet Workshop, Voice
Workbench, Terminal, Usage, and the remaining Settings sections. Check the
supported widths and dark, light, and system themes; retain the existing shell
and verify that each page's controls and empty, loading, error, and success
states remain clear.

## Acceptance evidence

Run `npm run smoke:windows` from the repository root. It currently runs:

1. JavaScript syntax validation.
2. Renderer typecheck and production build.
3. Portable Electron packaging with the self-contained Agent Host and AirLLM
   worker.
4. Agent Host, Marketplace, and task-replan protocol smoke.
5. Packaged Electron shell and separate companion surface smoke.
6. Dark/light/system theme acceptance.
7. Packaged route, viewport, and theme/sidebar acceptance. The latest recorded
   matrix covers 17 routes × 5 widths × 4 variants; manual visual review remains
   open.

Additional evidence commands:

- `npm test` — headless Core behavior and persistence checks.
- `npm run check:hygiene` — repository hygiene.
- `npm run audit:electron-runtime` — single-architecture and secure-boundary
  guard, including rejection of XAML/Uno/WinUI/native desktop artifacts.
- `npm run audit:release-workflow` — Electron-only gated release workflow.

### 2026-11-23 packaged accessibility smoke

The freshly staged Windows Electron package passed the automated accessibility
smoke across all 14 routes: zero WCAG A/AA violations, zero incomplete checks,
a working skip link and main landmark, and valid expanded-popup relationships
for the model picker and overflow menu. The run also verified the smoke-only
isolated instance profile and OS-assigned DevTools port while the regular Skai
instance remained open. The popup probe uses a short timer rather than
`requestAnimationFrame`, so hidden or throttled windows do not stall it.
- `npm run audit:local-only` — local transport boundary.

### Accessibility semantic follow-up — 2026-11-23

- The packaged Axe audit covers 14 routes. It reports zero WCAG violations,
  zero serious/critical violations, a working skip link and main landmark, and
  correct expanded popup relationships for the Model Picker (`dialog`) and
  overflow menu (`menu`).
- Fixed the Model Picker's popup role, omitted `aria-controls` while popups are
  closed, and gave labeled thread/model/recipe/frame groups semantic region
  roles. Tab control icons are decorative SVGs rather than visible text glyphs.
- The follow-up packaged scan now reports zero violations and zero incomplete
  checks, including contrast checks. Zero automated findings is not full
  accessibility acceptance; assistive-technology and route-by-route visual
  reviews remain open.
- A live 1440×900 dark-theme spot check covered Chat and Marketplace. Text and
  controls looked readable in the inspected areas. Marketplace was showing its
  Agent Host unavailable recovery state, so this remains limited visual
  evidence; manual route, theme, and pet-motion review is still open.

### Packaged UI and accessibility rerun — 2026-11-23

- The packaged route matrix passed: 17 routes × 5 window sizes × 4 theme/sidebar
  variants, with no reported layout failures or renderer runtime errors.
- Follow-up packaged acceptance passed the theme/contrast sweep for dark, light,
  system, custom-theme live reload/recovery, and constrained width. Packaged
  overflow acceptance also passed 11 routes × 5 viewport widths. The contrast
  probe now excludes text under effectively transparent ancestor states, such
  as assistant message actions hidden until hover or keyboard focus.
- The full Axe scan passed on 14 routes with zero WCAG A/AA violations, zero
  serious/critical findings, zero inconclusive checks, a working skip link and
  main landmark, and valid expanded Model Picker (`dialog`) and overflow-menu
  (`menu`) relationships. The latest packaged rerun also verified keyboard
  focus for scrollable message code blocks and found 907 focusable controls
  across its audited route state.
- The interaction probe originally waited on nested animation frames and could
  time out when the Electron renderer was not presenting frames. It now waits
  on short timers after opening and closing the popups; the full interaction
  check completed successfully.
- To make contrast measurable, the task composer and selected Plugins navigation
  surfaces now use solid theme-token backgrounds; the Marketplace/Plugins header
  and page canvas no longer allow text to sit over unmeasurable transparent
  gradients. The next full scan reported no inconclusive contrast checks.
- The 1440×900 dark-theme Marketplace screenshot was from an isolated temporary
  review profile and showed the Agent Host unavailable recovery state. The
  actual running Skai app was separately observed as Agent-ready. The screenshot
  remains limited visual evidence. Screen-reader behavior and pet animation
  motion/reduced-motion behavior still need hands-on review before the full UI
  item can close.
- The current packaged Electron artifact smoke passed the Percy companion
  renderer checks, including advancing animation frames and a static sprite under
  `prefers-reduced-motion`. For voice input, it routed a Windows System.Speech
  phrase through Chromium microphone capture, recorded/stopped it, and confirmed
  the installed local Whisper path created a transcript attachment whose
  preview matched the expected phrase. Transcript contents are not printed.
  Chromium's native offline `en-US` recognition remains unavailable on this
  host, so hands-free turn quality, permission recovery, and cancellation still
  need focused acceptance.

## Known boundaries

Hosted model routing is not implemented in the current release. The approved
provider-gateway direction is tracked in
[`implementation-plans/provider-gateway.md`](implementation-plans/provider-gateway.md).
Signed installer lifecycle evidence, background model dispatch, resumable
downloads, and Worktree task execution remain explicitly partial or planned in
[`CAPABILITY_MATRIX.md`](CAPABILITY_MATRIX.md) and
[`PRODUCTION_READINESS_GAPS.md`](../operations/PRODUCTION_READINESS_GAPS.md).
They must not be represented as working
controls until their host contracts and packaged acceptance evidence exist.

The full `smoke:windows` run passed on 2026-11-16. Pet asset and behavior checks
passed as well. The latest packaged UI matrix passed on 2026-11-22 across 17
routes, five supported sizes, and four theme/sidebar variants. Automated
coverage does not replace the open live visual, keyboard, assistive-technology,
and cross-platform acceptance.

### Marketplace focused rebuild — 2026-11-22

- Reduced the Marketplace navigation to Discover, Models, Voices, MCP, Installed,
  and Updates. Staff Picks, Skills, and Plugins are no longer promoted as primary
  destinations.
- Replaced the Discover pitch panel with direct model search, MCP connection,
  Installed, and Updates actions. Added Voice, Coding, Chat, Image, and MCP
  category shortcuts. The hub reports the configured local runtime and whether
  its existing local model inventory endpoint responds.
- Normalized catalog availability labels to ready, limited, installed, or
  unavailable, and disclose when model source metadata has no license value.
- Kept catalog discovery and model installation on the existing Agent Host
  contracts. Model installs still require review, poll host progress, allow
  cancellation, verify through the host, and move to Installed on completion.
- Removed cloud voice connectors from the local voice catalog surface. Model
  results include an explicit license disclosure when the source catalog does not
  publish one. Updates run the existing signed release check when opened from the
  Marketplace action.
- Installed inventory now supports locally stored pins, MCP health checks and
  revocation, and image asset removal. The existing host protocol does not expose
  model deletion, so model rows do not claim to offer removal.
- Added compact theme-token-based styling and focus states for the action strip,
  category shortcuts, and installed rows at narrow widths. The Electron shell,
  command palette, theme system, and Agent Host contracts were not changed.
- Verification on 2026-11-22: `npm run desktop:typecheck` passed and
  `npm run desktop:build` passed. Vite emitted its existing large-chunk warning.
  A live Electron width/theme matrix was not run for this pass.

### Marketplace three-panel refinement — 2026-11-22

- Removed the embedded Marketplace section rail from Models, Voices, Installed,
  and Updates. The Marketplace browse navigation is now the sole page menu.
- Kept the content and selected-item inspector side by side. Installed inventory
  now uses a compact selectable list in the center and a details/actions card on
  the right; pin, MCP health/revoke, and image asset removal are in that card.
- Added a route key so switching from Installed to Updates (or another catalog
  page) resets the content page to the selected destination instead of retaining
  the previous section state.
- Verification: `desktop:typecheck` and `desktop:build` passed. No live visual
  matrix was run after this refinement.

### Theme acceptance reliability — 2026-11-22

- Fixed a race in the packaged theme acceptance script: applying a gallery
  theme saves `appearance.json` asynchronously, and the poll could read an
  incomplete file and fail before the write completed. The predicate now
  retries until valid JSON contains the saved theme.
- `npm run smoke:electron:themes` passed after the fix. It exercised dark,
  light, and system themes, alternate backdrops, a constrained 960×640 window,
  text contrast on Settings and Chat, and custom-theme live reload/recovery.
- Visually inspected the packaged dark Settings appearance screenshot at
  1440×900; the header, preference rail, preview, gallery, and save action were
  visible without clipping. Native-window interaction and route-by-route visual
  acceptance remain open; this does not close the professional UI pass.
