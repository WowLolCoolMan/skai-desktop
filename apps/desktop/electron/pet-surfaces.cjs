// Best-effort visible-window discovery for the opt-in companion interaction demo.
// This uses only Win32 window bounds, never screenshots or window contents.
const { spawn } = require("node:child_process");

const powershellScript = String.raw`
$ErrorActionPreference = 'Stop'
$source = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public struct SkaiRect { public int Left; public int Top; public int Right; public int Bottom; }
public class SkaiWindowSurface {
  public int X; public int Y; public int Width; public int Height;
}
public static class SkaiWindowCatalog {
  private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hWnd, out SkaiRect rect);
  public static SkaiWindowSurface[] Read(long excludedHandle) {
    var found = new List<SkaiWindowSurface>();
    EnumWindows((hWnd, _) => {
      if (hWnd.ToInt64() == excludedHandle || !IsWindowVisible(hWnd) || IsIconic(hWnd)) return true;
      SkaiRect rect;
      if (!GetWindowRect(hWnd, out rect)) return true;
      int width = rect.Right - rect.Left, height = rect.Bottom - rect.Top;
      if (width < 180 || height < 100 || width > 30000 || height > 30000) return true;
      found.Add(new SkaiWindowSurface { X = rect.Left, Y = rect.Top, Width = width, Height = height });
      return true;
    }, IntPtr.Zero);
    return found.ToArray();
  }
}
'@
Add-Type -TypeDefinition $source
[SkaiWindowCatalog]::Read($args[0]) | ConvertTo-Json -Compress
`;

function listVisibleWindows(excludedHandle, { timeoutMs = 1800 } = {}) {
  if (process.platform !== "win32") return Promise.resolve([]);
  const encoded = Buffer.from(powershellScript, "utf16le").toString("base64");
  const handle = String(excludedHandle ?? "0").replace(/[^0-9]/g, "") || "0";
  return new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded, handle], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    let settled = false;
    const finish = (windows) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(windows);
    };
    const timeout = setTimeout(() => { child.kill(); finish([]); }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.length > 128_000) { child.kill(); finish([]); }
    });
    child.on("error", () => finish([]));
    child.on("close", (code) => {
      if (code !== 0) return finish([]);
      try {
        const parsed = JSON.parse(output || "[]");
        const windows = (Array.isArray(parsed) ? parsed : [parsed])
          .map(({ X, Y, Width, Height }) => ({ x: Number(X), y: Number(Y), width: Number(Width), height: Number(Height) }))
          .filter(({ x, y, width, height }) => [x, y, width, height].every(Number.isFinite) && width >= 180 && height >= 100);
        finish(windows);
      } catch { finish([]); }
    });
  });
}

module.exports = { listVisibleWindows };
