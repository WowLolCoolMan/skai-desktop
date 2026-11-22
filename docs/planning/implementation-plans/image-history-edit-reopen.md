# Image history edit/reopen flow

## Goal

Close the user-facing gap between generated image history and image editing. A saved local output should be reopenable in the inspector and reusable as the source image for the existing Diffusers or ComfyUI edit workflow, without requiring the user to find and re-import the file manually.

## Integration plan

1. Add a `Use for edit` action to the existing output inspector.
2. Convert only local data URLs and loopback-hosted output URLs into the existing bounded `ChatAttachment` source-image shape.
3. Reject non-local URLs and oversized/non-image responses before the source enters an image workflow.
4. Close the inspector, set the source image, and leave the existing provider/workflow readiness checks responsible for the next action.
5. Keep history persistence unchanged; this is a workflow integration over the existing local IndexedDB and ComfyUI output URL records.

## Context map

| File | Purpose | Change |
|---|---|---|
| `apps/desktop/src/features/catalog/ImagesPage.tsx` | Image studio and inspector | Add bounded local output-to-source conversion and edit action. |
| `docs/planning/FUTURE_FEATURES.md` | Backlog status | Record the reusable history-to-edit workflow. |

## Acceptance criteria

- A saved Diffusers data URL can become the selected source image for editing.
- A saved loopback ComfyUI URL can become the selected source image when it is still available.
- Remote/unsupported/oversized outputs fail with an actionable local error and do not enter the workflow.
- Existing gallery preview, download, generation, and source picker behavior remains unchanged.
- Typecheck, build, syntax, hygiene, future-feature audit, native tests, and Agent Host smoke pass.
- Fetch `origin/main` before commit; rebase if it advanced, rerun checks, then push the finished feature to `main`.
