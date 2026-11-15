#!/usr/bin/env bash
# Remove a per-user Skai Desktop install created by install.sh.
# Your chats, projects, and settings are kept (see the paths printed at the end).
set -euo pipefail

DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
PREFIX="$DATA_HOME/skai-desktop"
DESKTOP_FILE="$DATA_HOME/applications/skai-desktop.desktop"
LINK="$HOME/.local/bin/skai-desktop"

if pgrep -f -- "$PREFIX/app/Skai Desktop" >/dev/null 2>&1; then
  echo "Skai Desktop is running. Quit it from the tray menu first, then run the uninstaller again." >&2
  exit 1
fi

# A root-owned chrome-sandbox (see install.sh) can still be removed without sudo:
# deleting a file only needs write access to its folder, which the user owns.
rm -rf "$PREFIX"
rm -f "$DESKTOP_FILE"
[ -L "$LINK" ] && rm -f "$LINK"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q "$(dirname "$DESKTOP_FILE")" || true

CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
echo "Skai Desktop was removed. Your data was kept in:"
echo "  $CONFIG_HOME/ServerRock    (chats, projects, memory, settings)"
echo "  $CONFIG_HOME/skai-desktop  (window and companion preferences)"
echo "Delete those folders yourself if you also want to remove your data."
