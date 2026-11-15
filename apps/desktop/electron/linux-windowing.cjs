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

/**
 * X11 only: is a compositing manager running? Without one (plain i3, bspwm,
 * Openbox without picom) transparent windows render black, so Percy needs an
 * opaque fallback. Compositors own the `_NET_WM_CM_S<screen>` selection (ICCCM/
 * EWMH); this asks the X server directly with two core requests (InternAtom,
 * GetSelectionOwner) because Electron does not expose it and no X11 client
 * library is bundled. Resolves true/false, or null if the server could not be
 * queried (callers should then keep the transparent default).
 */
function x11HasCompositor({ env = process.env, timeoutMs = 1500 } = {}) {
  const net = require("node:net");
  const fs = require("node:fs");
  const os = require("node:os");
  const match = /^(?<host>[^:]*):(?<display>\d+)(?:\.(?<screen>\d+))?$/.exec(String(env.DISPLAY || ""));
  if (!match) return Promise.resolve(null);
  const { host, display } = match.groups;
  const screen = Number(match.groups.screen || 0);

  // MIT-MAGIC-COOKIE-1 from the Xauthority file (absent with XWayland's -auth-less sockets).
  let authName = Buffer.alloc(0);
  let authData = Buffer.alloc(0);
  try {
    const file = fs.readFileSync(env.XAUTHORITY || `${env.HOME || os.homedir()}/.Xauthority`);
    let offset = 0;
    const field = () => { const length = file.readUInt16BE(offset); const value = file.subarray(offset + 2, offset + 2 + length); offset += 2 + length; return value; };
    while (offset + 2 <= file.length) {
      offset += 2; // family
      field(); // address
      const number = field().toString();
      const name = field();
      const data = field();
      if (name.toString() === "MIT-MAGIC-COOKIE-1" && (number === display || number === "")) { authName = name; authData = data; if (number === display) break; }
    }
  } catch { /* no Xauthority: try without credentials */ }

  const pad = (length) => (4 - (length % 4)) % 4;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (settled) return; settled = true; clearTimeout(timer); socket.destroy(); resolve(value); };
    const socket = host && host !== "unix"
      ? net.connect(6000 + Number(display), host)
      : net.connect(`/tmp/.X11-unix/X${display}`);
    const timer = setTimeout(() => finish(null), timeoutMs);
    socket.on("error", () => finish(null));

    const setup = Buffer.alloc(12 + authName.length + pad(authName.length) + authData.length + pad(authData.length));
    setup.write("l", 0); // little-endian
    setup.writeUInt16LE(11, 2);
    setup.writeUInt16LE(0, 4);
    setup.writeUInt16LE(authName.length, 6);
    setup.writeUInt16LE(authData.length, 8);
    authName.copy(setup, 12);
    authData.copy(setup, 12 + authName.length + pad(authName.length));

    const atomName = Buffer.from(`_NET_WM_CM_S${screen}`);
    const internAtom = Buffer.alloc(8 + atomName.length + pad(atomName.length));
    internAtom.writeUInt8(16, 0); // InternAtom
    internAtom.writeUInt8(1, 1); // only-if-exists
    internAtom.writeUInt16LE(internAtom.length / 4, 2);
    internAtom.writeUInt16LE(atomName.length, 4);
    atomName.copy(internAtom, 8);

    let buffer = Buffer.alloc(0);
    let stage = "setup";
    socket.on("connect", () => socket.write(setup));
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (stage === "setup") {
        if (buffer.length < 8) return;
        const total = 8 + buffer.readUInt16LE(6) * 4;
        if (buffer.length < total) return;
        if (buffer[0] !== 1) { finish(null); return; } // refused or needs other auth
        buffer = buffer.subarray(total);
        stage = "atom";
        socket.write(internAtom);
      }
      while (buffer.length >= 32) {
        const packet = buffer.subarray(0, 32);
        const extra = packet[0] === 1 ? packet.readUInt32LE(4) * 4 : 0;
        if (buffer.length < 32 + extra) return;
        buffer = buffer.subarray(32 + extra);
        if (packet[0] === 0) { finish(null); return; } // X error
        if (packet[0] !== 1) continue; // event
        if (stage === "atom") {
          const atom = packet.readUInt32LE(8);
          if (atom === 0) { finish(false); return; } // nobody ever created the selection atom
          const request = Buffer.alloc(8);
          request.writeUInt8(23, 0); // GetSelectionOwner
          request.writeUInt16LE(2, 2);
          request.writeUInt32LE(atom, 4);
          stage = "owner";
          socket.write(request);
        } else if (stage === "owner") {
          finish(packet.readUInt32LE(8) !== 0);
          return;
        }
      }
    });
  });
}

module.exports = { resolveDisplayBackend, canPositionWindows, hasStatusNotifierHost, isTrayLikelyVisible, isWaylandSession, x11HasCompositor };
