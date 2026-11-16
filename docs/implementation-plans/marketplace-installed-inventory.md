# Marketplace Tools → Installed inventory — implementation plan

## Goal
Keep Marketplace navigation in place and give users one predictable place to review the local items Skai can use.

## Integration
- Marketplace already discovers local models through `models.list`, installed image assets through `marketplace.image-assets.list`, and its catalog contains built-in tools, installed skills, and installed voice profiles.
- MCP configured/healthy state is available from `mcp.connections.list`.
- The current Installed page is a top-level nav item containing only models; image assets are duplicated in their catalog, while the other installed items are mixed with discovery entries.

## This slice
1. Move Installed into a secondary tab under Tools; Tools remains the active primary section for both subviews.
2. Build a searchable inventory from local models, MCP connections, Skai built-ins, installed skills, installed voice profiles, and installed image assets.
3. Retain the catalog sections for discovery and their availability labels; remove the duplicate installed asset list from Image Models and the embedded Models inventory.
4. Keep refresh and removal actions where supported; report partial inventory failures without hiding successfully loaded groups.

## Acceptance
- Installed is reachable only as Tools → Installed and does not navigate out of Marketplace.
- Every supported local inventory source is represented and searchable; connected/configured state is visible.
- Model search/install remains within Models, while installed models appear in the unified Installed inventory.
- Typecheck/build pass; missing sources produce an inline partial-refresh message rather than an empty success state.
