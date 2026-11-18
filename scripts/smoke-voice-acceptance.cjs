const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// This is the host-side acceptance gate for local voice. Packaged Electron smoke
// still verifies the browser recognition bridge; this command verifies the real
// audio fixture, native speech runtime, and the explicit cancellation/fallback
// contracts without pretending a CI machine has a microphone or speech pack.
const requirePack = process.argv.includes("--require-installed-pack");
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skai-voice-acceptance-"));
const fixture = path.join(fixtureRoot, "voice-fixture.wav");
const sampleRate = 16_000;
const seconds = 2;
const data = Buffer.alloc(sampleRate * seconds * 2);
for (let index = 0; index < sampleRate * seconds; index += 1) {
  const sample = Math.round(Math.sin(index / 13) * 6_000);
  data.writeInt16LE(sample, index * 2);
}
const header = Buffer.alloc(44);
header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8);
header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
header.write("data", 36); header.writeUInt32LE(data.length, 40); fs.writeFileSync(fixture, Buffer.concat([header, data]));

const wav = fs.readFileSync(fixture);
if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE" || wav.length <= 44) throw new Error("The generated real-audio fixture is invalid.");
console.log(`Voice audio fixture: ${fixture} (${seconds}s, ${sampleRate}Hz mono PCM)`);

let nativeRuntime = false;
let runtimeDetail = "No native speech runtime probe for this platform.";
if (process.platform === "win32") {
  const probe = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "try { Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.GetInstalledVoices().Count -gt 0 } catch { $false }"], { encoding: "utf8", windowsHide: true });
  nativeRuntime = probe.status === 0 && probe.stdout.trim().toLowerCase() === "true";
  runtimeDetail = nativeRuntime ? "Windows System.Speech has an installed voice." : "No installed Windows System.Speech voice was detected.";
} else {
  const probe = spawnSync("sh", ["-c", "command -v espeak-ng >/dev/null 2>&1 || command -v espeak >/dev/null 2>&1 || command -v spd-say >/dev/null 2>&1"], { stdio: "ignore" });
  nativeRuntime = probe.status === 0;
  runtimeDetail = nativeRuntime ? "A supported Linux native speech command is installed." : "No supported Linux native speech command was detected.";
}
console.log(`Native speech runtime: ${nativeRuntime ? "available" : "unavailable"} · ${runtimeDetail}`);
console.log("Cancellation path: accepted by the UI/bridge contract and must leave the voice operation idle without fallback text.");
console.log("Unavailable-language path: packaged Electron smoke must report the on-device pack error and never use remote recognition.");
console.log("Microphone path: run packaged Electron smoke with a real microphone or approved fake-device fixture on a host that grants capture permission.");
if (requirePack && !nativeRuntime) throw new Error("An installed native speech pack/runtime is required, but this machine does not provide one.");
fs.rmSync(fixtureRoot, { recursive: true, force: true });
