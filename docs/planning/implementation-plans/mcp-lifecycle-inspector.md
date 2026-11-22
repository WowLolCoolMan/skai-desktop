# MCP lifecycle inspector

## Goal

Close the remaining Marketplace lifecycle gap by making a connected MCP
server's health, manifest freshness, and tool permission surface reviewable in
place. This is a UI slice over the existing supervised MCP APIs; it must not
grant permissions or broaden the set of callable tools.

## Integration plan

1. Keep the existing connection list and lifecycle actions as the source of
   truth.
2. Add a selected-server inspector in the connected-server section with
   transport, connection state, last update, manifest digest, and tool counts.
3. Group the current tool manifest into read-only and mutating tools, showing
   required capabilities and a clear “approval still required” boundary.
4. Preserve refresh, disconnect, and revoke actions; keep failure messages
   local and redacted.
5. Add responsive styles and verify typecheck, build, syntax, hygiene, native
   tests, and Agent Host smoke before syncing and pushing the finished slice.

## Acceptance criteria

- Selecting a connected server reveals its current manifest and lifecycle
  metadata without leaving Marketplace.
- Read-only and mutating tools are visually distinct and required capabilities
  are visible.
- The inspector never implies that listing or selecting a tool grants access.
- Refresh, disconnect, revoke, error, and empty-manifest states remain usable.
- The existing MCP protocol and permission tests stay green.
