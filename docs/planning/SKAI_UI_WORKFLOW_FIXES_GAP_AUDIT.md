# Skai Desktop UI and layout gap audit

**Purpose:** Supplemental findings that do not appear as discrete fixes in
[`SKAI_UI_WORKFLOW_FIXES_200.md`](SKAI_UI_WORKFLOW_FIXES_200.md). The referenced
backlog currently contains 400 numbered items; this document adds 120 narrower,
reviewable fixes rather than replacing or renumbering it.

**Research basis:** Local research and design records include the reference
implementation registry, super-app research, Codex gap closure, overhaul
opportunities, UI reference guide, and Revision 4 packaged workflow captures.
The local registry scans Odysseus, Happy, Codex, Continue, Open WebUI,
OpenHands, AnythingLLM, Ruflo, Omnigent, and other tracked projects. The
proposals below adapt interaction patterns; they do not direct copying source,
branding, or product-specific visual styles.

**Observed screenshot:** A live 1920×1080 capture of the Coding workspace on
2026-11-27 is available at
`C:\Users\basic\AppData\Local\Temp\codex-shot-2026-11-27_16-31-19.png`.
It shows a large unused upper editor region, scratchpad and preview bands
consuming vertical space, lower chat/editor panels compressed, a global
horizontal scrollbar, and a composer partly below the viewport. These are
evidence from that window and state, not claims that every route or size has
the same defect.

## How to read this list

- Each item describes one incremental UI change and an observable completion
  condition. `[Observed]` means the current screenshot directly supports it.
- `P0` means it blocks legibility or a primary action in the named workflow;
  `P1` means it materially reduces friction; `P2` is a refinement.
- Source tags identify relevant research patterns: Codex workspace and review
  flows, Happy's reusable desktop UI and session controls, Continue's unified
  chat/agent surface, Open WebUI's tabbed/split workspace, Odysseus's
  workspace-oriented layout, and OpenHands' multi-surface task workspace.
- Items were compared against all 400 entries in the existing backlog. General
  ideas such as responsive layouts, split panes, keyboard access, and visual
  regression are already there; these entries specify a distinct behavior,
  geometry rule, or state-level acceptance detail.

## 1. Viewport fit and scroll ownership

1. `[P0][Observed][Open WebUI]` Remove document-level horizontal scrolling from
   Coding; at 1920×1080, every horizontal overflow must be contained by the
   pane that owns it (for example, code lines inside Monaco).
2. `[P0][Observed][Codex]` Allocate Coding's first viewport by task priority:
   keep the active thread, editor, and composer visible before optional
   scratchpad or preview content.
3. `[P0][Observed][Happy]` Replace the empty editor area with an explicit
   useful state (open file, project overview, or compact placeholder); the
   pane must not reserve a large blank height when no file is selected.
4. `[P0][Observed][Open WebUI]` Make scratchpad and preview independently
   collapsible without leaving persistent full-width strips after collapse.
5. `[P0][Observed][Codex]` Keep the chat composer fully within the viewport at
   the supported minimum height, while the transcript and editor take the
   scroll instead.
6. `[P1][Codex]` Define per-route minimum content widths and let secondary
   inspectors collapse before the main conversation becomes narrower than its
   readable measure.
7. `[P1][Happy]` Preserve panel ratios on resize, but clamp them to each
   panel's minimum useful width and height.
8. `[P1][Open WebUI]` Give nested panes independent scroll containers so
   scrolling the file tree never moves the transcript or composer.
9. `[P1][Codex]` Add a one-step “fit workspace” action that restores a usable
   panel arrangement after accidental dragging or extreme resizing.
10. `[P2][Happy]` Restore panel geometry after moving between monitors with
    different work areas; clamp saved bounds to the current display.

## 2. Panel, tab, and route transitions

11. `[P0][Codex]` Keep the selected route's page title and primary action in a
    stable header location while its content changes below.
12. `[P0][Continue]` Preserve keyboard focus when switching between Chat and
    Coding modes; return focus to the originating control when switching back.
13. `[P1][Open WebUI]` Show a close affordance only on hover/focus for
    non-selected workspace tabs, while keeping the selected tab's title
    unobscured.
14. `[P1][Open WebUI]` Warn on closing a tab with an unsaved editor draft and
    offer Save, Discard, and Cancel in the same dialog.
15. `[P1][Codex]` Add a recently closed workspace-tab action that restores the
    tab and its last active pane.
16. `[P1][Happy]` When reopening a session, scroll to the last viewed point
    only if the conversation has not gained new messages; otherwise show a
    “new activity” jump affordance.
17. `[P1][Codex]` Animate panel resizing only while dragging; on release,
    settle immediately to avoid distracting layout motion.
18. `[P1][Open WebUI]` Make tab dragging show a clear insertion marker and
    prevent accidental detachment outside the tab strip.
19. `[P2][Codex]` When a route transition invalidates a panel, explain which
    view closed and provide a one-click reopen action.
20. `[P2][Happy]` Keep independent scroll restoration for each workspace tab,
    not just the most recently active tab.

## 3. Coding workspace composition

21. `[P0][Observed][Codex]` Give the thread/editor split a configurable
    default ratio that exposes both the latest assistant turn and useful code
    width at the initial window size.
22. `[P0][Observed][Open WebUI]` Dock project scratchpad and preview as tabs or
    secondary panes instead of stacking them as full-width rows above the
    primary work area.
23. `[P0][Observed][Codex]` Keep the active task's composer attached to the
    conversation pane rather than the whole page grid.
24. `[P1][OpenHands]` Group Coding surfaces by task: thread, editor, diff, and
    terminal should be switchable within one workspace without losing task
    context.
25. `[P1][Codex]` Show a compact project/task identity strip above the split;
    collapse it to one line when the project name and task title are long.
26. `[P1][Open WebUI]` Let users swap the thread and editor sides while keeping
    each pane's state and scroll position.
27. `[P1][Codex]` Distinguish an inactive editor, an editor loading a file, and
    an editor with no file using separate compact empty/loading states.
28. `[P1][OpenHands]` Keep a task's changed-file indicator in the same visual
    region as the thread/editor tabs so file activity is discoverable without
    opening another dashboard.
29. `[P2][Happy]` Offer a focus layout that temporarily hides project
    metadata and secondary panels, then restores the previous layout exactly.
30. `[P2][Codex]` Provide a project layout reset scoped to the current project
    so one experiment does not reset every workspace.

## 4. Editor and file-navigation readability

31. `[P0][Observed][Codex]` Keep file names and editor actions visible when
    the editor pane narrows; move secondary actions into an overflow menu
    before truncating the filename to nothing.
32. `[P0][Continue]` Highlight the exact selected text range represented by an
    attached code context item when reopening that context from the composer.
33. `[P1][Open WebUI]` Show a modified-state dot on editor tabs and expose the
    full path in a tooltip and accessible label.
34. `[P1][Codex]` Add a “reveal in tree” action for the active editor tab and
    keep its ancestor folders expanded while that tab remains open.
35. `[P1][Continue]` Keep editor font size and chat font size independent, with
    separate reset controls and no accidental zoom of the whole app.
36. `[P1][Codex]` Make long file paths wrap or horizontally scroll inside the
    file breadcrumb instead of widening the entire workspace.
37. `[P1][OpenHands]` Add a compact diff/editor toggle in each changed-file
    tab; preserve the selected file and scroll offset when toggling.
38. `[P1][Codex]` Display a non-modal save confirmation beside the active file
    tab and clear it only after the saved content is confirmed.
39. `[P2][Continue]` Keep code block line numbers aligned during horizontal
    scrolling and text zoom, including wrapped-line mode.
40. `[P2][Happy]` Use a consistent active-tab underline, modified marker, and
    close target geometry across editor, terminal, preview, and chat tabs.

## 5. Chat transcript reading flow

41. `[P0][Observed][Codex]` Constrain prose response width independently from
    the full workspace width so long lines remain easy to scan on wide screens.
42. `[P0][Observed][Codex]` Place long answer headings and code/table content
    inside one readable transcript column; prevent markdown tables from
    forcing the whole page wider.
43. `[P1][Codex]` Add a “new messages” divider when returning to an older
    scroll position in an active conversation.
44. `[P1][Happy]` Keep the transcript anchored while streaming unless the
    reader is already near the bottom; show an explicit new-output count when
    they have scrolled away.
45. `[P1][Continue]` Add per-message “collapse long content” with a visible
    expansion control that preserves the reader's place in the transcript.
46. `[P1][Codex]` Keep message action buttons discoverable on keyboard focus
    and touch-sized on hover, without reserving a permanent row of chrome.
47. `[P1][Open WebUI]` Align user and assistant message edges to a consistent
    text grid even when attachments or tool cards are present.
48. `[P1][Codex]` Add a stable anchor for each message so copy-link and
    “return to result” actions land on the message rather than the route top.
49. `[P2][Happy]` Use compact date separators only when the day changes and
    expose exact timestamps on hover/focus.
50. `[P2][Codex]` Preserve code-block horizontal position when a streaming
    update appends text, instead of snapping the code viewport to its start.

## 6. Composer and attachment ergonomics

51. `[P0][Observed][Continue]` Keep composer controls on one compact footer
    row at common desktop widths; wrap labels before the text entry area is
    squeezed below a usable minimum.
52. `[P0][Codex]` Expand the text area upward as the draft grows, with a
    maximum height that leaves a minimum transcript reading area visible.
53. `[P1][Continue]` Keep attachment chips above the draft text and expose
    remove controls on focus/hover without changing composer height abruptly.
54. `[P1][Codex]` Show a file's type, name, and size in attachment chips;
    reserve thumbnails for image/media attachments that benefit from preview.
55. `[P1][Continue]` Maintain the cursor and selection when adding or removing
    an attachment from the keyboard.
56. `[P1][Codex]` Differentiate “send” from “queue” visually and keep the
    selected action label visible when queueing is available.
57. `[P1][Happy]` Show the active input method (text, dictation, or live voice)
    next to the composer without duplicating mode information elsewhere.
58. `[P1][Codex]` Keep the stop-generation control in the same position as
    Send so the user's pointer does not chase a changing footer.
59. `[P2][Continue]` Render `@` suggestions above the composer when there is
    insufficient room below, without covering the send controls.
60. `[P2][Codex]` Indicate when a pasted image or file is still processing and
    disable submission only for that attachment until its preview is ready.

## 7. Sidebar and navigation density

61. `[P0][Codex]` Reserve a fixed minimum width for sidebar labels at each
    density setting; truncate titles with an ellipsis instead of clipping at
    arbitrary mid-word positions.
62. `[P1][Codex]` Keep project and chat scroll positions independent when the
    user switches sidebar sections.
63. `[P1][Odysseus]` Add a compact project row secondary line for folder or
    repository identity, hiding it before the project name.
64. `[P1][Codex]` Show the count of hidden projects/chats beside “Show more”
    and retain the expansion state per sidebar section.
65. `[P1][Happy]` Make the sidebar collapse handle remain reachable when the
    sidebar is scrolled to the bottom.
66. `[P1][Codex]` Separate hover, selected, unread, and active-task states by
    shape or icon in addition to color.
67. `[P1][Continue]` Keep the recent-chat search field visible while the chat
    list scrolls, without pinning the project list header unnecessarily.
68. `[P2][Codex]` Show chat list timestamps as relative labels, then switch to
    exact date/time on hover and keyboard focus.
69. `[P2][Happy]` Preserve sidebar scroll offset and selected item when a
    background refresh updates the list.
70. `[P2][Odysseus]` Add a subtle divider between projects and loose chats that
    remains visible in both expanded and compact sidebar modes.

## 8. Cards, rows, and action hierarchy

71. `[P0][Codex]` Make status labels and action controls share one card header
    row with consistent alignment; wrap details below rather than pushing the
    status into a detached corner.
72. `[P1][Codex]` Use one row height per content density and allow only rows
    with secondary metadata to grow, preventing uneven list rhythm.
73. `[P1][Happy]` Keep destructive actions visually and spatially separated
    from the primary action in cards and menus.
74. `[P1][OpenHands]` Show the next actionable step in blocked/error task
    cards as a single primary button; put diagnostics under a secondary link.
75. `[P1][Codex]` Make icon-only buttons show an accessible tooltip on hover
    and focus, with no tooltip clipping at the window edge.
76. `[P1][Codex]` Standardize status icon alignment and text baselines across
    queued, running, blocked, failed, and completed cards.
77. `[P2][Happy]` Use skeletons that match the final card geometry so loading
    does not cause a list to jump when real content arrives.
78. `[P2][Odysseus]` Add a compact list/grid density switch only on inventories
    where both layouts improve scanning; remember the choice per inventory.
79. `[P2][Codex]` Make row selection and row navigation separate hit targets
    so opening a file does not accidentally select a bulk-action checkbox.
80. `[P2][Codex]` Keep card action menus anchored to their trigger and flip
    within the viewport instead of clipping off-screen.

## 9. Forms, dialogs, and settings layout

81. `[P0][Happy]` Use consistent dialog width tiers and safe window gutters;
    content-heavy review dialogs should scroll internally while keeping
    decision buttons visible.
82. `[P1][Codex]` Keep form labels above controls at narrow widths and align
    helper text to the control edge rather than the label edge.
83. `[P1][Codex]` Show unsaved form state in the dialog title/action area and
    offer a predictable Escape behavior based on whether changes exist.
84. `[P1][Odysseus]` Keep settings category navigation fixed while the chosen
    category content scrolls independently.
85. `[P1][Codex]` Put validation text directly below its field and scroll the
    first invalid field into view when a form is submitted.
86. `[P1][Happy]` Align toggles, their labels, and descriptions to one row
    grid; descriptions must not collide with adjacent controls at 125% text
    scaling.
87. `[P2][Codex]` Show setting defaults and changed values with different
    visual treatment, plus a nearby reset action for the changed value.
88. `[P2][Codex]` Make dialog footers sticky only when the dialog body
    overflows, avoiding an unnecessary footer band in short dialogs.
89. `[P2][Happy]` Keep focus inside a dialog while open, then restore it to
    the exact launcher after close or cancel.
90. `[P2][Codex]` Use inline confirmation for reversible settings; reserve
    modal confirmation for settings that discard data or alter a running
    session.

## 10. Model, marketplace, and media surfaces

91. `[P1][Odysseus]` Keep model-card names and local/cloud source visible at
    narrow card widths; move less-used metadata to a secondary detail line.
92. `[P1][Codex]` Show benchmark value, measurement date, and whether a value
    is measured or estimated in the same visual cluster.
93. `[P1][Continue]` Keep model capability badges from wrapping into an
    unreadable block; show a short summary with an expandable full list.
94. `[P1][Open WebUI]` Preserve the selected model in the picker header while
    filtering results, so search does not erase context.
95. `[P1][Codex]` In media generation, keep prompt controls and current
    source/result visible together at desktop widths; collapse metadata before
    hiding either image.
96. `[P1][Odysseus]` Use consistent card aspect ratios within an asset gallery
    while allowing the image itself to use contain/cover based on media type.
97. `[P2][Codex]` Keep download progress attached to its inventory card as
    users change catalog filters or switch pages.
98. `[P2][Open WebUI]` Use a side-by-side compare view only above a width
    threshold; below it, provide a single-tap candidate switcher.
99. `[P2][Codex]` Make disabled or unavailable catalog actions explain the
    missing prerequisite inline rather than only through a hover tooltip.
100. `[P2][Happy]` Standardize preview lightbox controls, keyboard escape,
     zoom, and previous/next navigation across image and document previews.

## 11. Typography, input, and accessibility details

101. `[P0][Codex]` Establish minimum text sizes for timestamps, badges, helper
     text, and sidebar metadata; no essential state may depend on the smallest
     caption style.
102. `[P0][Happy]` Ensure focus indicators remain visible against both raised
     and inset surfaces and are not clipped by rounded containers.
103. `[P1][Codex]` Use tabular numerals for counters, token counts, latency,
     and progress values so live updates do not shift neighboring controls.
104. `[P1][Continue]` Keep keyboard shortcuts in menus aligned and readable,
     including platform-specific Ctrl/Cmd labels.
105. `[P1][Happy]` Make hover-only actions appear on keyboard focus and remain
     available at 200% text scale.
106. `[P1][Codex]` Support text selection and copying in status, error, and
     model metadata without selecting the card's navigation action.
107. `[P1][Codex]` Do not use animated color alone for live states; pair it
     with a text status that remains understandable when motion is reduced.
108. `[P2][Happy]` Align icon optical size with adjacent text rather than
     relying on equal CSS dimensions for visibly unequal glyphs.
109. `[P2][Codex]` Keep mixed-language labels and long translated strings from
     overlapping adjacent icons or action buttons.
110. `[P2][Happy]` Preserve readable contrast for syntax highlighting in both
     themes and at the selected editor opacity/contrast settings.

## 12. Design system and visual verification gaps

111. `[P1][Happy]` Render shared shell primitives in an isolated component
     workbench with all sizes, states, and theme variants visible together.
112. `[P1][Happy]` Give each shared visual component stable geometry hooks so
     layout checks can measure its bounds without route-specific selectors.
113. `[P1][Codex]` Add visual review fixtures for the exact failure states in
     the screenshot: no selected file, scratchpad visible, preview visible,
     narrow editor, and composer at minimum window height.
114. `[P1][Codex]` Compare before/after captures at the same viewport and
     scroll position, with an overlay that exposes shifted edges and clipped
     content.
115. `[P1][Happy]` Verify nested border radii and pane insets as a geometry
     contract, not only by visual snapshot similarity.
116. `[P1][Codex]` Add a global-overflow assertion that identifies the
     overflowing element and route instead of reporting only a failed page.
117. `[P2][Happy]` Keep deterministic visual fixtures free of live clocks,
     network-loaded imagery, entrance animation, and machine-specific fonts.
118. `[P2][Codex]` Document token roles for surface, divider, focus, selection,
     warning, and disabled states and flag route-level raw color overrides.
119. `[P2][Codex]` Add screenshot annotations for intentional deviations from
     reference layouts so later polish does not “fix” product-specific choices.
120. `[P2][Happy]` Require each reusable visual component to render from props
     alone, including error, empty, loading, disabled, and focused states.

## Research references

- [Local UI reference guide](UI_REFERENCE_GUIDE.md) and [Revision 4 packaged
  workflow evidence](../design-review/workflow-collection/revision-4/README.md)
- [Local super-app research](../research/SUPER_APP_RESEARCH.md) and
  [reference implementation registry](../research/REFERENCE_IMPLEMENTATION_REGISTRY.md)
- [Codex repository](https://github.com/openai/codex) and [Codex desktop app
  workflow](https://openai.com/index/introducing-the-codex-app/)
- [Continue Agent and Plan quick start](https://github.com/continuedev/continue/blob/main/docs/ide-extensions/agent/quick-start.mdx)
- [Happy Desktop design system](https://github.com/slopus/happy-desktop/blob/main/DESIGN.md)
- [Happy session-control roadmap](https://github.com/slopus/happy/blob/main/docs/experimental/roadmap.md)
- [Odysseus workspace and research UI module summary](https://github.com/odysseus-dev/odysseus/blob/dev/static/js/MODULE_SUMMARY.md)
- [Open WebUI workspace layout documentation](https://github.com/open-webui/docs/blob/main/docs/ecosystem/computer/workspace/index.md)
- [OpenHands](https://github.com/OpenHands/OpenHands)

