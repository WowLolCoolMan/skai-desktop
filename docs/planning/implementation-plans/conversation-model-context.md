# Conversation Model Context

## Goal

Keep the selected model, provider, and known runtime metadata attached to each conversation so switching or reopening a conversation restores the context the user was working with.

## Integration plan

1. Extend the local conversation record with nullable model/provider and optional size/context metadata so existing conversations remain valid.
2. Include that metadata in conversation listing/search responses and persist it whenever the active conversation is saved.
3. Restore the saved model and provider when a conversation is first loaded or selected, using the local provider fallback when an older or unavailable provider is encountered.
4. Copy the metadata when a conversation is forked so the new thread starts with the same execution context.
5. Keep the data local and backward-compatible; no provider credentials or message content are added to this persistence path.

## Acceptance criteria

- A conversation save records its selected model, provider, size, and context length when available.
- Reopening or selecting a conversation restores its model and provider without changing unrelated workspace state.
- Forked conversations preserve the source model context.
- Conversations written before this change still load with null metadata and normal defaults.
- Desktop typecheck, Agent Host build, and native core tests pass.
