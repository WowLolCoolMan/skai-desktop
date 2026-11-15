const assert = require("node:assert/strict");
const { resolveDisplayBackend, canPositionWindows, isTrayLikelyVisible, x11HasCompositor } = require("../apps/desktop/electron/linux-windowing.cjs");

const hyprland = { WAYLAND_DISPLAY: "wayland-1", XDG_SESSION_TYPE: "wayland", DISPLAY: ":1" };
const waylandOnly = { WAYLAND_DISPLAY: "wayland-1", XDG_SESSION_TYPE: "wayland" };
const i3 = { DISPLAY: ":0", XDG_SESSION_TYPE: "x11" };
const argv = ["electron", "."];
const decide = (env, extraArgv = []) => resolveDisplayBackend({ platform: "linux", env, argv: [...argv, ...extraArgv] });

// Non-Linux platforms are never touched.
assert.deepEqual(resolveDisplayBackend({ platform: "win32", env: hyprland, argv }), { switchValue: null, backend: null, reason: "not-linux" });
assert.equal(resolveDisplayBackend({ platform: "darwin", env: hyprland, argv }).switchValue, null);

// Wayland session with XWayland (Hyprland, Sway, GNOME, KDE): prefer XWayland so Percy can position itself.
assert.deepEqual(decide(hyprland), { switchValue: "x11", backend: "x11", reason: "wayland-session-with-xwayland" });
assert.equal(decide({ WAYLAND_DISPLAY: "wayland-0", DISPLAY: ":0" }).switchValue, "x11", "WAYLAND_DISPLAY alone marks a Wayland session");

// Wayland without XWayland stays native and disables self-positioning.
const native = decide(waylandOnly);
assert.equal(native.switchValue, null);
assert.equal(native.backend, "wayland");
assert.equal(canPositionWindows(native), false);

// X11 sessions (i3, bspwm, Openbox, ...) need nothing.
assert.deepEqual(decide(i3), { switchValue: null, backend: "x11", reason: "x11-session" });
assert.equal(canPositionWindows(decide(i3)), true);

// Explicit user choices always win and never trigger a relaunch loop.
assert.deepEqual(decide(hyprland, ["--ozone-platform=wayland"]), { switchValue: null, backend: "wayland", reason: "command-line-flag" });
assert.deepEqual(decide(hyprland, ["--ozone-platform=x11"]), { switchValue: null, backend: "x11", reason: "command-line-flag" });
assert.equal(decide(hyprland, ["--ozone-platform-hint=wayland"]).backend, "wayland");
assert.equal(decide({ ...hyprland, ELECTRON_OZONE_PLATFORM_HINT: "wayland" }).switchValue, null);
assert.equal(decide({ ...hyprland, ELECTRON_OZONE_PLATFORM_HINT: "auto" }).backend, "wayland");
assert.deepEqual(decide({ ...hyprland, SKAI_OZONE_PLATFORM: "wayland" }), { switchValue: null, backend: "wayland", reason: "SKAI_OZONE_PLATFORM" });
assert.deepEqual(decide({ ...i3, SKAI_OZONE_PLATFORM: "x11" }), { switchValue: "x11", backend: "x11", reason: "SKAI_OZONE_PLATFORM" });
assert.equal(decide({ ...hyprland, SKAI_OZONE_PLATFORM: "bogus" }).switchValue, "x11", "unknown preference falls back to the default policy");

// Tray visibility: Wayland compositors need a StatusNotifier host; X11 can fall back to XEmbed trays.
assert.equal(isTrayLikelyVisible({ platform: "win32", env: {}, statusNotifierHost: false }), true);
assert.equal(isTrayLikelyVisible({ platform: "linux", env: hyprland, statusNotifierHost: true }), true);
assert.equal(isTrayLikelyVisible({ platform: "linux", env: hyprland, statusNotifierHost: false }), false);
assert.equal(isTrayLikelyVisible({ platform: "linux", env: hyprland, statusNotifierHost: null }), false);
assert.equal(isTrayLikelyVisible({ platform: "linux", env: i3, statusNotifierHost: false }), true);

// Agent Host PATH: append existing per-user tool dirs on Linux only, never reorder or duplicate.
{
  const { augmentUserPath } = require("../apps/desktop/electron/user-path.cjs");
  const home = "/home/u";
  const present = new Set(["/home/u/.local/bin", "/home/u/.nvm/versions/node/v22.11.0/bin", "/home/u/.pyenv/shims"]);
  const readdir = (dir) => { if (dir === "/home/u/.nvm/versions/node") return ["v18.20.0", "v22.11.0", "v9.0.0", "system"]; throw new Error("ENOENT"); };
  const env = { PATH: "/usr/bin:/home/u/.local/bin" };
  assert.equal(augmentUserPath({ platform: "linux", env, home, exists: (dir) => present.has(dir), readdir }), "/usr/bin:/home/u/.local/bin:/home/u/.nvm/versions/node/v22.11.0/bin:/home/u/.pyenv/shims");
  assert.equal(augmentUserPath({ platform: "win32", env, home, exists: () => true, readdir }), env.PATH);
  assert.equal(augmentUserPath({ platform: "linux", env: { PATH: "" }, home, exists: () => false, readdir }), "");
}

// X11 compositor probe: unparsable or unreachable displays are "unknown" (null), never a false "no compositor".
(async () => {
  assert.equal(await x11HasCompositor({ env: { DISPLAY: "" } }), null);
  assert.equal(await x11HasCompositor({ env: { DISPLAY: "wayland-1" } }), null);
  assert.equal(await x11HasCompositor({ env: { DISPLAY: ":4242", HOME: "/nonexistent" }, timeoutMs: 500 }), null);
  console.log("Linux windowing checks passed.");
})().catch((error) => { console.error(error); process.exit(1); });
