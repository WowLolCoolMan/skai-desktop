const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// This host-side probe validates the WAV container, native speech synthesis,
// and installed local TTS runtimes. Local speech recognition availability is
// measured separately in the packaged Electron smoke because it belongs to
// Chromium's on-device recognition API.
const requireNativeTts = process.argv.includes("--require-native-tts");
if (process.argv.includes("--require-installed-pack")) {
  throw new Error("--require-installed-pack was ambiguous and is no longer supported. Use --require-native-tts for Windows SAPI output; the packaged Electron smoke reports local recognition-pack availability.");
}
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skai-voice-acceptance-"));
process.on("exit", () => {
  if (fs.existsSync(fixtureRoot)) fs.rmSync(fixtureRoot, { recursive: true, force: true });
});
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
console.log(`Synthetic WAV container fixture: ${fixture} (${seconds}s, ${sampleRate}Hz mono PCM tone; not speech)`);

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
console.log(`Native speech synthesis: ${nativeRuntime ? "available" : "unavailable"} · ${runtimeDetail}`);
console.log("This host-side probe does not test local speech-recognition packs, microphone capture, speech accuracy, or cancellation.");
console.log("Use the packaged Electron smoke to check local recognition capability and fail-closed unavailable-language behavior; a real-microphone turn and cancellation still need device acceptance.");
if (requireNativeTts && !nativeRuntime) throw new Error("A native speech-synthesis runtime is required, but this machine does not provide one.");

const localDataRoot = process.platform === "win32"
  ? process.env.LOCALAPPDATA
  : path.join(os.homedir(), ".local", "share");
const voiceRoot = localDataRoot ? path.join(localDataRoot, "Skai", "Voice") : "";
const localTtsChecks = [
  {
    id: "Kokoro ONNX",
    directory: "Kokoro",
    files: ["kokoro-v1.0.int8.onnx", "voices-v1.0.bin", path.join("venv", process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python")],
    script: "import json, os, sys, time, numpy as np, soundfile as sf\nfrom kokoro_onnx import Kokoro\nmodel, voices, output = sys.argv[1:]\nstart=time.perf_counter(); tts=Kokoro(model, voices); loaded=time.perf_counter()\ntry:\n audio, rate=tts.create('This is a local Skai speech quality and timing check.', voice='af_heart', speed=1.0, lang='en-us'); generated=time.perf_counter(); sf.write(output, audio, rate, subtype='PCM_16')\nfinally:\n tts.voices.close()\na=np.asarray(audio,dtype=np.float32); print(json.dumps({'sampleRate':int(rate),'audioSeconds':len(a)/rate,'rms':float(np.sqrt(np.mean(a*a))),'loadSeconds':loaded-start,'synthesisSeconds':generated-loaded}))",
    args: (root) => [path.join(root, "kokoro-v1.0.int8.onnx"), path.join(root, "voices-v1.0.bin")],
  },
  {
    id: "Piper",
    directory: "Piper",
    files: ["en_US-hifi_tts_92-medium.onnx", "en_US-hifi_tts_92-medium.onnx.json", path.join("venv", process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python")],
    script: "import json, os, sys, time, wave, numpy as np\nfrom piper import PiperVoice\nmodel, output = sys.argv[1:]\nstart=time.perf_counter(); voice=PiperVoice.load(model); loaded=time.perf_counter()\nwith wave.open(output,'wb') as wav: voice.synthesize_wav('This is a local Skai speech quality and timing check.',wav)\ngenerated=time.perf_counter()\nwith wave.open(output,'rb') as wav:\n rate=wav.getframerate(); frames=wav.getnframes(); samples=np.frombuffer(wav.readframes(frames),dtype=np.int16).astype(np.float32)/32768\nprint(json.dumps({'sampleRate':int(rate),'audioSeconds':frames/rate,'rms':float(np.sqrt(np.mean(samples*samples))),'loadSeconds':loaded-start,'synthesisSeconds':generated-loaded}))",
    args: (root) => [path.join(root, "en_US-hifi_tts_92-medium.onnx")],
  },
];

for (const check of localTtsChecks) {
  const runtimeRoot = path.join(voiceRoot, check.directory);
  const python = path.join(runtimeRoot, "venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const requiredFiles = [...check.files.map(file => path.join(runtimeRoot, file)), path.join(runtimeRoot, "installed.json")];
  if (!voiceRoot || requiredFiles.some(file => !fs.existsSync(file))) {
    console.log(`Local ${check.id} synthesis: skipped · not installed on this device.`);
    continue;
  }

  const output = path.join(fixtureRoot, `${check.directory.toLowerCase()}-synthesis.wav`);
  const args = ["-c", check.script, ...check.args(runtimeRoot), output];
  const startedAt = process.hrtime.bigint();
  const probe = spawnSync(python, args, {
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", HF_DATASETS_OFFLINE: "1" },
  });
  const oneShotSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
  if (probe.error || probe.status !== 0) {
    throw new Error(`Local ${check.id} synthesis failed: ${(probe.stderr || probe.error?.message || `exit ${probe.status}`).trim().slice(-1_500)}`);
  }
  const wav = fs.readFileSync(output);
  if (wav.length < 1_000 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`Local ${check.id} did not produce a valid WAV file.`);
  }
  let metrics;
  try { metrics = JSON.parse(probe.stdout.trim().split(/\r?\n/).at(-1)); }
  catch { throw new Error(`Local ${check.id} did not report valid synthesis measurements.`); }
  if (!Number.isFinite(metrics.audioSeconds) || metrics.audioSeconds < 0.5 || metrics.audioSeconds > 30
    || !Number.isFinite(metrics.sampleRate) || metrics.sampleRate < 8_000 || metrics.sampleRate > 48_000
    || !Number.isFinite(metrics.rms) || metrics.rms < 0.001 || metrics.rms > 1
    || !Number.isFinite(metrics.synthesisSeconds) || metrics.synthesisSeconds <= 0) {
    throw new Error(`Local ${check.id} generated invalid or silent audio: ${JSON.stringify(metrics)}`);
  }
  const oneShotRate = metrics.audioSeconds / oneShotSeconds;
  console.log(`Local ${check.id} synthesis passed · ${metrics.audioSeconds.toFixed(2)}s audio at ${metrics.sampleRate}Hz, ${oneShotSeconds.toFixed(2)}s end-to-end including process/model load (${oneShotRate.toFixed(2)}× real time). Model load: ${metrics.loadSeconds.toFixed(2)}s; synthesis: ${metrics.synthesisSeconds.toFixed(2)}s. This is signal/container evidence, not a subjective speech-quality rating.`);
}

fs.rmSync(fixtureRoot, { recursive: true, force: true });
