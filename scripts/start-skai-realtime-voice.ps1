param(
  [string]$OllamaModel = "qwen3:4b",
  [int]$Port = 8765
)

$ErrorActionPreference = "Stop"
$runtimeRoot = Join-Path $PSScriptRoot "..\.voice-runtime"
$runtimeRoot = [IO.Path]::GetFullPath($runtimeRoot)
$uv = Get-Command uv -ErrorAction SilentlyContinue
if (-not $uv) { throw "uv is required. Install it from https://docs.astral.sh/uv/" }
if (-not (Test-Path (Join-Path $runtimeRoot ".venv"))) {
  Push-Location $runtimeRoot
  try { & $uv.Source sync --python 3.12 } finally { Pop-Location }
}

Write-Host "Starting Skai realtime voice on ws://127.0.0.1:$Port/v1/realtime"
Write-Host "LLM: Ollama $OllamaModel"
Write-Host "Pipeline: Silero VAD -> Parakeet TDT -> Ollama -> streaming Qwen3-TTS"
Push-Location $runtimeRoot
try {
  & $uv.Source run speech-to-speech serve `
    --host 127.0.0.1 `
    --port $Port `
    --stt parakeet-tdt `
    --tts qwen3 `
    --llm-backend responses-api `
    --model-name $OllamaModel `
    --responses-api-base-url "http://127.0.0.1:11434/v1" `
    --responses-api-api-key "" `
    --responses-api-stream `
    --qwen3-tts-speaker Ryan `
    --qwen3-tts-instruct "warm, slightly excited, conversational, concise, and expressive" `
    --no-qwen3-tts-non-streaming-mode `
    --qwen3-tts-streaming-chunk-size 4
} finally { Pop-Location }
