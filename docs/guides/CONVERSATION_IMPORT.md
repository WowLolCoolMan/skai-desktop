# Import conversations

Skai Desktop can merge a portable JSON conversation archive or a legacy Skai
Electron `localStorage` export into this device's local conversation history.

1. In Chat, open **More → Import conversations…** and choose the `.json` file.
2. Review the archive name, number of new chats, duplicates, and ID conflicts.
3. Choose **Cancel** to leave history unchanged, or confirm the import.

Imports are local. Skai reads at most 25 MB of UTF-8 JSON. Preview does not
write to your conversation store. On confirmation, Skai merges new chats,
skips repeats, and assigns a new ID when an archive ID collides with a native
chat. Existing chats are never replaced. Legacy project IDs, instructions,
folder links, and file-context permissions are not transferred into native
projects.

The same archive can be imported again safely. Skai recognizes previously
imported source IDs and duplicate content, including chats that have since been
edited locally. Chat export currently produces Markdown transcripts; import
accepts JSON archives.
