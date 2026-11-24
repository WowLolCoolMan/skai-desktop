# Skai Desktop workflow and workspace concepts — revision 2

This pass makes user actions, feedback states, and next steps more visible. It uses the current app routes, local-first product direction, and supplied references in `docs/ui-references/`.

These are visual concepts for review, not literal screenshots or implementation specs. Sample content, names, statuses, and values in generated mockups are illustrative. Check all details against the running app before implementation. No app UI code has been changed.

## Collection

1. **Workflow map** — shared shell and Start → Chat → Project work → Review.
2. **Chat actions and states** — draft/attachment, local send, queued follow-up, and response actions.
3. **Projects and Coding Agent** — create/open project, send task, inspect files and diffs, run checks, commit/push deliberately.
4. **Marketplace and Images** — browse and inspect, review install/connect, verify local setup, generate and reuse an image.
5. **A/B Compare and Terminal** — compare two local models sequentially with one prompt; run and inspect a user-triggered command in a selected project.
6. **Supporting pages** — Settings, Scheduled, Memory, Usage, Pet and Persona workshops, and Voice Workbench.

## Functional behaviors represented

- Chat drafts and attachments persist locally; a follow-up can be queued while a response is running. Message and conversation actions stay with their context.
- Project work stays connected to its selected project and conversation. Files, Git changes, terminal, preflight, and explicit review/commit actions stay inspectable.
- Marketplace exposes local discovery sections, selection details, install/connect review, progress, cancellation, and verification states.
- Image generation has local runtime setup, workflow controls, cancellation, a gallery, and result reuse.
- A/B comparison runs one model at a time and is not saved to chat history.
- Scheduled tasks use a standalone prompt and do not automatically include project files. Usage concepts stick to truthful local inventory rather than invented telemetry.

The boards describe intended workflows. Some fine print or sample details may be inaccurate because the images are generated; treat current app behavior and host capabilities as authoritative.
