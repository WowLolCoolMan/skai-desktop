# Local conversation sharing boundary

Skai's first collaboration workflow uses files that the user chooses to move between devices. Skai does not run a LAN listener, relay, hosted service, or companion-device pairing endpoint. Sharing stays off until the user explicitly exports a snapshot.

## Data included

The owner chooses whether to include user messages, assistant replies, or both. The HTML snapshot contains only the selected message text, conversation title, owner display name, share identifier, and expiry. It excludes attachments, web-source metadata, system prompts, tool calls and results, project instructions and files, model/provider settings, task state, and local access capabilities. A separate private-fork archive has a new conversation ID and contains only the selected transcript text.

## Suggestions

The snapshot lets a recipient produce a small JSON suggestion file. It has no network requests and cannot call Skai's IPC bridge. The owner imports a suggestion through a review dialog; accepting adds text to the composer draft and never sends it or triggers a tool. Import validates the schema, share ID, conversation ID, timestamp, expiry, participant name, suggestion length, and file size. The suggestion is untrusted user input and must be reviewed like any other draft.

## Limits and threat model

- A downloaded snapshot is a copy. Closing a share only makes Skai reject later suggestion imports for that share on the owner's device; it cannot remotely erase a recipient's file.
- The expiry is checked by the snapshot UI and the owner-side import flow. The static HTML is not cryptographically protected, so a recipient can edit it or recover its embedded transcript. Do not share sensitive content with an untrusted recipient.
- Share IDs are routing labels, not secrets or authentication. Suggestion files are unsigned and forgeable. The workflow grants no authority beyond proposing text for owner review.
- No encryption-at-rest or end-to-end encryption is claimed. Transfer the file through a channel appropriate for the information it contains.
- Live LAN access, QR pairing, remote approvals, and remote tool execution remain disabled. Before adding them, define authenticated device identity, key rotation and revocation, transport encryption, replay resistance, host binding, permission scoping, and abuse/denial-of-service controls. A trusted host or endpoint and an independent threat-model review are prerequisites.

## Safe defaults

No snapshot is created until the user selects the share action. Live access and remote tool execution are unavailable. Attachments are omitted. Suggestions are previewed and only enter the unsent draft after an explicit action. The owner’s conversation remains local and unchanged when a recipient leaves or forks a snapshot.
