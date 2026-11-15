// Linux window-manager compatibility decisions for the Electron shell.
//
// Percy (the desktop companion) relies on absolute window positioning, cursor
// tracking, and always-on-top. Native Wayland (xdg-shell) deliberately offers
// none of those to clients: the compositor ignores setPosition(), getBounds()
// reports 0,0, and getCursorScreenPoint() only works over our own surfaces.
// Electron >= 38 picks native Wayland automatically whenever WAYLAND_DISPLAY is
// set, which broke Percy on Hyprland, Sway, GNOME and KDE Wayland sessions.
//
// Policy:
//   * Explicit user choice always wins (--ozone-platform / --ozone-platform-hint
//     flags, ELECTRON_OZONE_PLATFORM_HINT, or SKAI_OZONE_PLATFORM).
//   * On a Wayland session with XWayland available, run under XWayland so every
//     window feature keeps working.
//   * On native Wayland (opt-in, or no XWayland), Percy switches to
//     compositor-driven dragging and stops wandering instead of misbehaving.
//
// Kept free of Electron imports so scripts/test-linux-windowing.cjs can run it
// in plain Node.

const { execFile } = require("node:child_process");

const VALID_BACKENDS = new Set(["x11", "wayland"]);

function hasArgSwitch(argv, name) {
  return argv.some((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
}

function argSwitchValue(argv, name) {
  const prefix = `--${name}=`;
  const match = argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length).trim().toLowerCase() : null;
}

function isWaylandSession(env) {
  return Boolean(env.WAYLAND_DISPLAY) || String(env.XDG_SESSION_TYPE || "").toLowerCase() === "wayland";
}

/**
 * Decide which Ozone backend Chromium should use.
 * Returns { switchValue, backend, reason }:
 *   switchValue – value to pass to app.commandLine.appendSwitch("ozone-platform"), or null to leave Chromium alone.
 *   backend     – the backend we expect to end up on ("x11" | "wayland" | null when not Linux).
 */
function resolveDisplayBackend({ platform = process.platform, env = process.env, argv = process.argv } = {}) {
  if (platform !== "linux") return { switchValue: null, backend: null, reason: "not-linux" };

  const flagValue = argSwitchValue(argv, "ozone-platform");
  if (VALID_BACKENDS.has(flagValue)) return { switchValue: null, backend: flagValue, reason: "command-line-flag" };
  if (hasArgSwitch(argv, "ozone-platform")) return { switchValue: null, backend: isWaylandSession(env) ? "wayland" : "x11", reason: "command-line-flag" };

  const hintValue = argSwitchValue(argv, "ozone-platform-hint") || String(env.ELECTRON_OZONE_PLATFORM_HINT || "").trim().toLowerCase() || null;
  if (hintValue) {
    if (VALID_BACKENDS.has(hintValue)) return { switchValue: null, backend: hintValue, reason: "ozone-platform-hint" };
    // "auto" and anything unrecognised follow the session type, as Chromium does.
    return { switchValue: null, backend: isWaylandSession(env) ? "wayland" : "x11", reason: "ozone-platform-hint" };
  }

  const preference = String(env.SKAI_OZONE_PLATFORM || "").trim().toLowerCase();
  if (VALID_BACKENDS.has(preference)) {
    // Electron >= 38 already picks Wayland on a Wayland session; skip the relaunch.
    const alreadyDefault = preference === "wayland" && isWaylandSession(env);
    return { switchValue: alreadyDefault ? null : preference, backend: preference, reason: "SKAI_OZONE_PLATFORM" };
  }

  if (!isWaylandSession(env)) return { switchValue: null, backend: "x11", reason: "x11-session" };
  if (env.DISPLAY) return { switchValue: "x11", backend: "x11", reason: "wayland-session-with-xwayland" };
  return { switchValue: null, backend: "wayland", reason: "wayland-session-without-xwayland" };
}

/** Whether the app can place windows itself (false on native Wayland). */
function canPositionWindows(decision) {
  return decision.backend !== "wayland";
}

/**
 * Ask the session bus whether a StatusNotifierItem host (Waybar tray, KDE,
 * GNOME AppIndicator extension, swaybar, ...) is running. Without one the tray
 * icon is invisible, so "close to tray" would strand a hidden, unreachable app.
 * Resolves true/false, or null when the bus could not be queried.
 */
function hasStatusNotifierHost({ platform = process.platform, env = process.env, timeoutMs = 1500 } = {}) {
  if (platform !== "linux") return Promise.resolve(true);
  if (!env.DBUS_SESSION_BUS_ADDRESS && !env.XDG_RUNTIME_DIR) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(
      "dbus-send",
      ["--session", "--print-reply", "--dest=org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus.NameHasOwner", "string:org.kde.StatusNotifierWatcher"],
      { timeout: timeoutMs, windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        resolve(/boolean\s+true/.test(stdout));
      },
    );
  });
}

/**
 * Combine the StatusNotifier probe with the session type.
 * Chromium shows the tray icon over StatusNotifierItem when a watcher exists,
 * and otherwise falls back to a GTK XEmbed icon, which only an X11 tray (i3bar,
 * polybar, xfce4-panel, ...) can display. A Wayland compositor never hosts
 * XEmbed icons, even for XWayland clients, so it needs a StatusNotifier host.
 */
function isTrayLikelyVisible({ platform = process.platform, env = process.env, statusNotifierHost } = {}) {
  if (platform !== "linux") return true;
  if (statusNotifierHost === true) return true;
  return !isWaylandSession(env);
}

module.exports = { resolveDisplayBackend, canPositionWindows, hasStatusNotifierHost, isTrayLikelyVisible, isWaylandSession };
