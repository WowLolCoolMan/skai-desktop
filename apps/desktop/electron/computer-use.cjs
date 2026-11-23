const { spawn } = require("node:child_process");

const WINDOWS_INPUT = String.raw`
$ErrorActionPreference = 'Stop'
$request = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:SKAI_COMPUTER_REQUEST)) | ConvertFrom-Json
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SkaiComputerInput {
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public UNION U; }
  [StructLayout(LayoutKind.Explicit)] public struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx,dy; public uint mouseData,dwFlags,time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk,wScan; public uint dwFlags,time; public IntPtr extra; }
}
'@
$display = $request.display
$x = [int]($display.x + [Math]::Round($request.x * $display.width))
$y = [int]($display.y + [Math]::Round($request.y * $display.height))
if ($request.action -eq 'click') {
  if (-not [SkaiComputerInput]::SetCursorPos($x,$y)) { throw 'Could not move the pointer to that display point.' }
  $flag = if ($request.button -eq 'right') { 0x0008 } else { 0x0002 }
  $up = if ($request.button -eq 'right') { 0x0010 } else { 0x0004 }
  $inputs = @([SkaiComputerInput+INPUT]::new(),[SkaiComputerInput+INPUT]::new())
  $inputs[0].type=0; $inputs[0].U.mi.dwFlags=$flag; $inputs[1].type=0; $inputs[1].U.mi.dwFlags=$up
  if ([SkaiComputerInput]::SendInput(2,$inputs,[Runtime.InteropServices.Marshal]::SizeOf([type][SkaiComputerInput+INPUT])) -ne 2) { throw 'The mouse click could not be sent.' }
} elseif ($request.action -eq 'scroll') {
  if (-not [SkaiComputerInput]::SetCursorPos($x,$y)) { throw 'Could not move the pointer to that display point.' }
  $inputs = [SkaiComputerInput+INPUT]::new(); $inputs.type=0; $inputs.U.mi.mouseData=[uint32]([int]$request.delta); $inputs.U.mi.dwFlags=0x0800
  if ([SkaiComputerInput]::SendInput(1,@($inputs),[Runtime.InteropServices.Marshal]::SizeOf([type][SkaiComputerInput+INPUT])) -ne 1) { throw 'The scroll input could not be sent.' }
} elseif ($request.action -eq 'type') {
  foreach ($character in $request.text.ToCharArray()) {
    $down=[SkaiComputerInput+INPUT]::new(); $down.type=1; $down.U.ki.wScan=[uint16][char]$character; $down.U.ki.dwFlags=0x0004
    $up=[SkaiComputerInput+INPUT]::new(); $up.type=1; $up.U.ki.wScan=[uint16][char]$character; $up.U.ki.dwFlags=0x0006
    if ([SkaiComputerInput]::SendInput(2,@($down,$up),[Runtime.InteropServices.Marshal]::SizeOf([type][SkaiComputerInput+INPUT])) -ne 2) { throw 'Text input could not be sent.' }
  }
} elseif ($request.action -eq 'key') {
  $keys = @{ Enter=0x0D; Tab=0x09; Escape=0x1B; Backspace=0x08; Delete=0x2E; Up=0x26; Down=0x28; Left=0x25; Right=0x27; Home=0x24; End=0x23; PageUp=0x21; PageDown=0x22; Space=0x20 }
  if (-not $keys.ContainsKey($request.key)) { throw 'Unsupported key.' }
  $vk=[uint16]$keys[$request.key]
  $down=[SkaiComputerInput+INPUT]::new(); $down.type=1; $down.U.ki.wVk=$vk
  $up=[SkaiComputerInput+INPUT]::new(); $up.type=1; $up.U.ki.wVk=$vk; $up.U.ki.dwFlags=2
  if ([SkaiComputerInput]::SendInput(2,@($down,$up),[Runtime.InteropServices.Marshal]::SizeOf([type][SkaiComputerInput+INPUT])) -ne 2) { throw 'The key could not be sent.' }
}
`;

function validateAction(input) {
  if (!input || typeof input !== "object") throw new Error("Invalid computer action.");
  if (!["click", "scroll", "type", "key"].includes(input.action)) throw new Error("Unsupported computer action.");
  if (input.action === "click" || input.action === "scroll") {
    if (!Number.isFinite(input.x) || !Number.isFinite(input.y) || input.x < 0 || input.x > 1 || input.y < 0 || input.y > 1) throw new Error("Click coordinates must be within the captured screen.");
  }
  if (input.action === "click" && !["left", "right"].includes(input.button ?? "left")) throw new Error("Unsupported mouse button.");
  if (input.action === "scroll" && (!Number.isInteger(input.delta) || Math.abs(input.delta) > 1200)) throw new Error("Scroll amount is out of range.");
  if (input.action === "type" && (typeof input.text !== "string" || input.text.length > 2000)) throw new Error("Text must be 2,000 characters or fewer.");
  if (input.action === "key" && !["Enter", "Tab", "Escape", "Backspace", "Delete", "Up", "Down", "Left", "Right", "Home", "End", "PageUp", "PageDown", "Space"].includes(input.key)) throw new Error("Unsupported key.");
}

function performWindowsAction(input, display) {
  validateAction(input);
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(JSON.stringify({ ...input, display }), "utf8").toString("base64");
    const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_INPUT], {
      windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, SKAI_COMPUTER_REQUEST: encoded },
    });
    let stderr = "";
    child.stderr.setEncoding("utf8"); child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve({ ok: true }) : reject(new Error(stderr.trim() || "Windows input could not be sent.")));
  });
}

module.exports = { performWindowsAction, validateAction };
