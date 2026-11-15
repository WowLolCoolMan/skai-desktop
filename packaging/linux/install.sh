#!/usr/bin/env bash
# Install Skai Desktop for the current user (no root needed).
#
#   ./install.sh            install or update from this extracted release folder
#   ./install.sh --yes      also fix the Chromium sandbox helper with sudo without asking
#   ./install.sh --no-sudo  never ask for sudo (prints the command instead)
#
# Installs to ${XDG_DATA_HOME:-~/.local/share}/skai-desktop, adds an app-launcher
# entry and a `skai-desktop` command in ~/.local/bin. Your chats and settings live
# in ~/.config/ServerRock and ~/.config/skai-desktop and are never touched here.
set -euo pipefail

SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
PREFIX="$DATA_HOME/skai-desktop"
APP_DIR="$PREFIX/app"
BIN_DIR="$HOME/.local/bin"
DESKTOP_FILE="$DATA_HOME/applications/skai-desktop.desktop"
SUDO_MODE="ask"
for arg in "$@"; do
  case "$arg" in
    --yes) SUDO_MODE="yes" ;;
    --no-sudo) SUDO_MODE="no" ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [ ! -x "$SOURCE/Skai Desktop" ]; then
  echo "Run this script from an extracted Skai Desktop Linux release (missing \"Skai Desktop\")." >&2
  exit 1
fi
if pgrep -f -- "$APP_DIR/Skai Desktop" >/dev/null 2>&1; then
  echo "Skai Desktop is running from $APP_DIR. Quit it from the tray menu first, then run the installer again." >&2
  exit 1
fi

echo "Installing Skai Desktop to $APP_DIR"
mkdir -p "$PREFIX"
STAGING="$PREFIX/app.new"
rm -rf "$STAGING"
cp -a "$SOURCE/." "$STAGING/"
rm -rf "$PREFIX/app.old"
[ -d "$APP_DIR" ] && mv "$APP_DIR" "$PREFIX/app.old"
mv "$STAGING" "$APP_DIR"
rm -rf "$PREFIX/app.old"

# A launcher without spaces in its path, for desktop files and terminals.
cat > "$PREFIX/skai-desktop" <<LAUNCHER
#!/usr/bin/env bash
exec "$APP_DIR/Skai Desktop" "\$@"
LAUNCHER
chmod 755 "$PREFIX/skai-desktop"
mkdir -p "$BIN_DIR"
ln -sf "$PREFIX/skai-desktop" "$BIN_DIR/skai-desktop"

ICON="$APP_DIR/skai-desktop.png"
mkdir -p "$(dirname "$DESKTOP_FILE")"
cat > "$DESKTOP_FILE" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Skai Desktop
GenericName=Local AI Workspace
Comment=Local-first workspace for chat, coding, projects, and local AI models
Exec="$PREFIX/skai-desktop" %U
Icon=$ICON
Terminal=false
Categories=Development;
Keywords=AI;LLM;Ollama;chat;local;
StartupWMClass=skai-desktop
StartupNotify=true
DESKTOP
chmod 644 "$DESKTOP_FILE"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q "$(dirname "$DESKTOP_FILE")" || true

# Chromium's sandbox needs either unprivileged user namespaces or a setuid-root
# helper. Some distributions (Ubuntu 24.04+, hardened kernels) restrict user
# namespaces, and an extracted archive cannot carry root ownership, so the app
# would refuse to start. Never fall back to --no-sandbox; fix the helper instead.
userns_restricted() {
  [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)" = "1" ] && return 0
  [ "$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null || echo 1)" = "0" ] && return 0
  [ "$(cat /proc/sys/user/max_user_namespaces 2>/dev/null || echo 1)" = "0" ] && return 0
  return 1
}
SANDBOX="$APP_DIR/chrome-sandbox"
if userns_restricted && [ "$(stat -c '%U:%a' "$SANDBOX")" != "root:4755" ]; then
  FIX=(sudo chown root:root "$SANDBOX" '&&' sudo chmod 4755 "$SANDBOX")
  echo
  echo "This system restricts unprivileged user namespaces, so Chromium's sandbox"
  echo "helper must be owned by root to start Skai Desktop safely."
  answer="n"
  case "$SUDO_MODE" in
    yes) answer="y" ;;
    ask) [ -t 0 ] && read -r -p "Run 'sudo chown root:root' and 'chmod 4755' on chrome-sandbox now? [y/N] " answer ;;
  esac
  if [ "$answer" = "y" ] || [ "$answer" = "Y" ]; then
    sudo chown root:root "$SANDBOX" && sudo chmod 4755 "$SANDBOX"
    echo "Sandbox helper configured."
  else
    echo "Skipped. Before starting Skai Desktop, run:"
    echo "  ${FIX[*]}"
  fi
fi

echo
echo "Installed. Launch \"Skai Desktop\" from your app launcher, or run: skai-desktop"
case ":$PATH:" in *":$BIN_DIR:"*) ;; *) echo "(Add $BIN_DIR to your PATH to use the skai-desktop command.)" ;; esac
