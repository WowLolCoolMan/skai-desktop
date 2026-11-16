# Inline PDF previews

## Goal

Let users inspect normal-sized project PDFs in the workspace without leaving
the project tab, while retaining selectable-text extraction for oversized or
unsupported documents.

## Integration plan

1. Keep the existing bounded project path and PDF signature checks as the only
   way to read a preview.
2. For PDFs within a smaller inline-preview budget, return the validated bytes
   as a local base64 payload with `application/pdf`; do not persist or upload
   them.
3. For PDFs above that budget, preserve the existing extracted-text response
   and label it as the fallback.
4. Render the inline payload in a sandboxed iframe in the existing file preview
   pane; images and text editing remain unchanged.
5. Add protocol smoke coverage for both inline and fallback responses, then
   run native tests, typecheck, build, syntax/bridge audits, and Agent Host
   smoke.

## Acceptance

- Preview reads remain contained to the selected project folder.
- Inline PDF data is bounded and never sent to a model or remote service.
- Large PDFs still produce a useful selectable-text fallback.
- The preview pane remains in the project workspace; no route transition occurs.
- Invalid PDF signatures continue to fail closed.

## Deferred

PDF page thumbnails, OCR for scanned documents, annotations, editing, and
search across rendered page images remain later work.
