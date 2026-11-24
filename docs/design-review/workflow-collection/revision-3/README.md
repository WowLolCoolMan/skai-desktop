# Skai Desktop workflow concepts — revision 3

This expansion focuses on clean navigation, ease of use, and the connective workflows between Skai features. It is grounded in current app routes and behavior, along with the user-provided references in `docs/ui-references/`.

## Boards

1. **Navigation and return paths** — switch ChatBot/Coding Agent, find secondary tools, and return to the same workspace.
2. **Local model setup and selection** — discover, inspect, review an Ollama download, and use a chosen model with an honest capacity estimate.
3. **MCP tools and approval** — connect to a local loopback server, inspect untrusted tool metadata, review arguments, approve one read/write call, inspect its result, and manage connection state.
4. **Memory and documents** — explicitly save scoped notes, enable/disable memory, import local documents into a searchable corpus, and remove/export data.
5. **Task and scheduled runs** — distinguish saving a plan from starting an agent run; keep progress and review in-thread; show thread-linked schedules separately from standalone scheduled prompts.
6. **Optional pets and personas** — choose/show/hide/customize a companion, then select a persona for a dedicated conversation.

## Design priorities

- One clear primary action per step, shallow navigation, persistent work context.
- Explain state before asking for a consequential action; show progress, cancellation, and results in the owning page/thread.
- Keep model choice explicit, keep local/unknown/estimated states honest, and do not swap silently.
- Keep personalisation optional and never let companion UI obscure the work surface.
- Preserve a visible return path when opening Settings, tools, or inspectors.

## Prompt set used

Generated with the built-in image generation tool using the repository's dark Skai shell and supplied references. The six prompts respectively requested: (1) workspace navigation and return; (2) local model discovery/review/use; (3) local MCP connection and per-call approval; (4) explicit memory and document corpus operations; (5) in-thread task planning/execution and separate scheduling flows; (6) optional companion and persona selection/conversation.

These are still concept images, not literal screenshots or implementation specifications. Generated names, sample content, labels, statuses, and values can be inaccurate; confirm fine details against the running app before implementation. No app UI code has been changed.
