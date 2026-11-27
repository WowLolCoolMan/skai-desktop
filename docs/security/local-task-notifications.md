# Local task notifications

Task notifications are opt-in and run in the desktop renderer. Skai records task status transitions locally and uses the operating system notification permission only after the user enables notifications. Notification text is generic by default; task titles can be shown only through an explicit preference.

The local delivery history is bounded to 50 records and can be cleared in Settings. It records whether an alert was delivered or suppressed by disabled notifications, category rules, quiet hours, project mutes, missing permission, or unsupported notification APIs. Quiet hours use the computer's local timezone.

Clicking a notification returns to the task's conversation or project when available, otherwise to the local task inbox. Notifications do not approve, pause, cancel, or run a task. Phone approvals, remote task actions, and local-network status links remain unavailable until Skai has a trusted host and task-scoped authorization protocol.
