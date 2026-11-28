# UI Workflow Fixes Context Map

Scope: the 400 ordered UI and workflow fixes in
[`SKAI_UI_WORKFLOW_FIXES_200.md`](SKAI_UI_WORKFLOW_FIXES_200.md), with the
gap-audit document used as supporting evidence.
This map identifies the implementation surfaces and verification entry points;
it is not a completion report.

## Files to Modify

| File | Purpose | Changes Needed |
|---|---|---|
| `apps/desktop/src/styles.css` | Shared route layout, split-pane geometry, responsive rules, focus, typography, overflow | Keep route-level behavior and shared visual contracts coherent; avoid token bypasses |
| `apps/desktop/src/features/coding/CodingSessionView.tsx` | Coding chat/editor composition, project panes, task inspector, focus layout | Keep chat/composer present when secondary pane changes; compact empty editor; preserve pane state |
| `apps/desktop/src/features/coding/CodingPaneTabs.tsx` | Coding workspace and subagent pane tabs | Maintain split affordances, focus access, and active pane visibility |
| `apps/desktop/src/features/coding/useCodingPaneWorkspace.ts` | Per-project pane persistence, selection, reorder, split state | Preserve independent workspace state and restore transitions |
| `apps/desktop/src/features/coding/CodingPage.tsx` | Project identity, project overview, activity, harness and project entry states | Keep project context compact when an active task/split needs viewport space |
| `apps/desktop/src/features/chat/ChatMessageList.tsx` | Transcript scrolling, restoration, unread output | Preserve scroll position and expose new activity without moving the composer |
| `apps/desktop/src/features/chat/ChatMessage.tsx` | Message structure and actions | Provide timestamps, stable anchors, keyboard-visible controls, and readable content width |
| `apps/desktop/src/features/chat/ChatComposer.tsx` | Draft, attachment and composer footer | Keep draft selection, attachment processing, and send/queue state usable |
| `apps/desktop/src/features/chat/useChatWorkspace.ts` | Message and conversation state | Stamp message times and preserve streaming/read state |
| `apps/desktop/src/components/layout/Sidebar.tsx` | Project and chat navigation | Keep scroll/search/selection state independent and labels legible |
| `apps/desktop/src/components/layout/WorkspaceTabs.tsx` | Top-level conversation tabs | Handle focus, close/reopen, reorder, and overflow states consistently |
| `apps/desktop/src/components/ui/Primitives.tsx` | Shared buttons, cards, badges, empty states, headers | Use prop-driven states and stable measurement hooks |
| `apps/desktop/src/components/ui/ModalDialog.tsx` | Dialog size, focus, scrolling, footer | Keep content and decisions reachable under small viewports and text scaling |
| `apps/desktop/src/features/catalog/{ModelsPage,MarketplacePage,MarketplaceCatalogBrowser,MarketplaceModelResults,ImagesPage}.tsx` | Model, marketplace and media inventories | Retain selection context, status, and responsive image/model actions |
| `apps/desktop/src/features/settings/SettingsPage.tsx` | Settings navigation and controls | Keep category and value editing accessible at narrow widths/scaling |
| `scripts/smoke-electron-ui-matrix.cjs` | Packaged route/theme/viewport regression suite | Add state-level geometry, split-state, and restoration assertions plus captures |
| `scripts/smoke-electron-accessibility.cjs` | Keyboard/accessibility smoke | Cover focus visibility, action discoverability, labels, and dialog focus |
| `scripts/smoke-electron-overflow.cjs` | Global and nested overflow smoke | Report offending route/element and verify local scroll ownership |
| `scripts/compare-ui-captures.cjs` | Before/after overlay generation | Compare same-size, same-state captures and retain outputs |
| `docs/design-review/ui-visual-fixtures.json` | Deterministic visual fixture definitions | Keep failure-state annotations and expected geometry current |
| `apps/desktop/src/design-system/tokens.css` | Semantic color, typography, radius, and spacing token source | Document and audit semantic roles and raw-color guardrails |

## Dependencies (may need updates)

| File | Relationship |
|---|---|
| `apps/desktop/src/app/AppRouteView.tsx` | Composes route components and hands shared state to them |
| `apps/desktop/src/app/useWorkspaceSessionTabs.ts` | Restores routes and active workspace tabs |
| `apps/desktop/src/app/workspaceTabStore.ts` | Persists tab order, selection, and closures |
| `apps/desktop/shared/contracts.ts` | Shared front-end and desktop bridge view models |
| `apps/desktop/src/features/coding/useCodingWorkspace.ts` | Loads projects, files, Git, checks, and activity |
| `apps/desktop/src/features/coding/useCodingFileTabs.ts` | File tab and unsaved-draft behavior |
| `apps/desktop/src/features/chat/useChatDraft.ts` | Composer draft persistence and selection coordination |
| `apps/desktop/src/features/chat/MessageContent.tsx` | Markdown, code blocks, tables, and link rendering |
| `apps/desktop/src/components/ui/OverflowMenu.tsx` | Shared menu positioning and keyboard interaction |
| `apps/desktop/src/design-system/tokens.css` and `scripts/theme-token-baseline.json` | Semantic design tokens and token-drift verification |

## Test Files

| Test | Coverage |
|---|---|
| `scripts/smoke-electron-ui-matrix.cjs` | Packaged routes across window sizes/themes/sidebar states; targeted Coding split, project, and chat interactions |
| `scripts/smoke-electron-accessibility.cjs` | Keyboard traversal and accessibility attributes in a real Electron window |
| `scripts/smoke-electron-overflow.cjs` | Page-level overflow and clipped controls |
| `scripts/smoke-electron-themes.cjs` | Dark/light theme token behavior |
| `scripts/smoke-project-editor.cjs` | Editor, file navigation, editing, and save workflow |
| `scripts/smoke-conversation-metadata.cjs` | Conversation metadata persistence and rendering |
| `scripts/smoke-chat-queue.cjs` | Queue composer state and interactions |
| `scripts/test-theme-files.cjs` and `scripts/audit-theme-tokens.cjs` | Theme package and token integrity |

## Reference Patterns

| File | Pattern |
|---|---|
| `apps/desktop/src/features/coding/useCodingPaneWorkspace.ts` | Project-scoped pane tabs, persisted split state, and fallback restoration |
| `apps/desktop/src/features/coding/useCodingFileTabs.ts` | File tab selection, close confirmation, and reordering |
| `apps/desktop/src/features/chat/ChatMessageList.tsx` | Per-conversation scroll restoration and new-activity affordance |
| `apps/desktop/src/components/ui/ModalDialog.tsx` | Shared focus boundary and safe dialog geometry |
| `apps/desktop/src/components/ui/Primitives.tsx` | Reusable visual components and inspectable state attributes |

## Risk Assessment

- Public bridge contracts should only change when the observed payload requires it.
- No database migration is expected for presentation-only fixes; persisted UI state needs versioned, tolerant parsing.
- Keep project and conversation identity scoped when persisting pane or scroll state.
- Packaged Electron captures are required for layout claims; DOM-only checks do not prove viewport fit.
