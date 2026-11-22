#!/usr/bin/env node

// Exercises the packaged Images UI through its real Agent Host and local
// Diffusers runtime. Uses a disposable Electron profile; model/runtime files
// remain in the user's normal local cache and are not modified by this script.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { resolveDisplayBackend } = require("../apps/desktop/electron/linux-windowing.cjs");

const artifactRoot = path.resolve(process.argv[2] || path.join(__dirname, "..", "dist", "electron", `${process.platform === "win32" ? "win" : process.platform}-x64`));
const executable = path.join(artifactRoot, process.platform === "win32" ? "Skai Desktop.exe" : "Skai Desktop");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function findPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function main() {
  if (!fs.existsSync(executable)) throw new Error(`Packaged Skai executable not found: ${executable}`);
  if (!fs.existsSync(path.join(artifactRoot, "resources", "agent-host", process.platform === "win32" ? "SkaiDesktop.AgentHost.exe" : "SkaiDesktop.AgentHost")))
    throw new Error("Packaged Agent Host is missing from this artifact.");

  const localData = process.env.LOCALAPPDATA || path.join(os.homedir(), ".local", "share");
  const python = path.join(localData, "Skai", "Diffusers", "venv", process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python");
  const modelCache = process.env.HF_HUB_CACHE || process.env.HUGGINGFACE_HUB_CACHE || path.join(process.env.HF_HOME || path.join(os.homedir(), ".cache", "huggingface"), "hub");
  if (!fs.existsSync(python)) throw new Error(`Install Skai's local Diffusers runtime before running this smoke: ${python}`);
  if (!fs.existsSync(path.join(modelCache, "models--stabilityai--sd-turbo")))
    throw new Error(`This smoke never downloads model weights. Cache stabilityai/sd-turbo first: ${modelCache}`);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "skai-image-workflow-"));
  const port = await findPort();
  const display = resolveDisplayBackend({ argv: [] });
  const child = spawn(executable, [`--remote-debugging-port=${port}`, "--disable-gpu", ...(display.switchValue ? [`--ozone-platform=${display.switchValue}`] : []), `--user-data-dir=${userDataDir}`], {
    cwd: artifactRoot,
    env: { ...process.env, HF_HUB_OFFLINE: "1", SKAI_SKIP_LEGACY_DATA_MIGRATION: "true" },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  const sleep = (ms) => wait(ms);

  async function getMainTarget() {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = await response.json();
    return targets.find((target) => target.type === "page" && target.title?.includes("Skai Desktop") && !target.url?.includes("pet=1"));
  }

  async function evaluate(target, expression, timeout = 30_000) {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Packaged image workflow evaluation timed out.")), timeout);
        socket.addEventListener("message", (event) => {
          const message = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
          if (message.id !== 1) return;
          clearTimeout(timer);
          if (message.error) reject(new Error(message.error.message));
          else resolve(message.result?.result?.value);
        });
        socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
      });
    } finally { socket.close(); }
  }

  async function waitFor(target, expression, description, timeout = 240_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const result = await evaluate(target, expression, 15_000);
      if (result) return result;
      await sleep(500);
    }
    throw new Error(`Timed out waiting for ${description}.`);
  }

  try {
    const deadline = Date.now() + 30_000;
    let target;
    while (Date.now() < deadline && !target) { target = await getMainTarget().catch(() => undefined); if (!target) await sleep(250); }
    if (!target) throw new Error(`Packaged Skai did not start. ${output.slice(-2_000)}`);
    await waitFor(target, "Boolean(document.querySelector('[aria-label=\\\"Primary navigation\\\"]'))", "app navigation");
    await evaluate(target, "location.hash = '#/images'; 'navigated'");
    await waitFor(target, "Boolean(document.querySelector('.image-studio-page textarea[aria-describedby=\\\"image-prompt-help\\\"]'))", "Images page");

    const setPrompt = async (value) => evaluate(target, `(() => { const field = document.querySelector('.image-studio-page textarea[aria-describedby="image-prompt-help"]'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(field, ${JSON.stringify(value)}); field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true })); return field.value; })()`);
    await evaluate(target, "(() => { const field = document.querySelector('.image-provider-picker select'); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(field, 'diffusers'); field.dispatchEvent(new Event('change', { bubbles: true })); return field.value; })()");
    await waitFor(target, "document.querySelector('.image-runtime-callout')?.textContent.includes('Ready') || Boolean(document.querySelector('.image-runtime-callout .status-badge'))", "local image runtime status");

    await setPrompt("A small amber glass vase on a plain cream studio backdrop, centered product photo.");
    await waitFor(target, "[...document.querySelectorAll('.form-footer button')].some(button => button.textContent.trim() === 'Generate image' && !button.disabled)", "generation to become available");
    await evaluate(target, "[...document.querySelectorAll('.form-footer button')].find(button => button.textContent.trim() === 'Generate image').click(); true");
    await waitFor(target, "[...document.querySelectorAll('.form-footer button')].some(button => button.textContent.trim() === 'Cancel generation')", "active generation cancel control");
    await evaluate(target, "[...document.querySelectorAll('.form-footer button')].find(button => button.textContent.trim() === 'Cancel generation').click(); true");
    await waitFor(target, "[...document.querySelectorAll('.form-footer button')].some(button => button.textContent.trim() === 'Generate image') && !document.querySelector('.image-generation-progress')", "cancelled worker to stop", 60_000);
    console.log("Packaged UI cancellation: Cancel returned the Images page to idle before another run.");

    await evaluate(target, "[...document.querySelectorAll('.form-footer button')].find(button => button.textContent.trim() === 'Generate image').click(); true");
    await waitFor(target, "document.querySelectorAll('.image-result').length === 1", "generated output in local history");
    const generated = await evaluate(target, "JSON.stringify({ image: document.querySelector('.image-result img')?.src.slice(0, 23), natural: [document.querySelector('.image-result img')?.naturalWidth, document.querySelector('.image-result img')?.naturalHeight], historyCount: document.querySelectorAll('.image-result').length })");
    const generatedState = JSON.parse(generated);
    if (generatedState.image !== "data:image/jpeg;base64," || generatedState.natural[0] !== 512 || generatedState.natural[1] !== 512)
      throw new Error(`Generated UI output was not a valid local 512px JPEG: ${generated}`);
    console.log(`Packaged UI generation and history: ${JSON.stringify(generatedState)}.`);

    await evaluate(target, "document.querySelector('.image-result').click(); true");
    await waitFor(target, "[...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Use for edit')", "generated output inspector");
    await evaluate(target, "[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Use for edit').click(); true");
    await waitFor(target, "document.querySelector('.form-footer button')?.textContent.trim() === 'Edit image'", "history image reopened for editing");
    await setPrompt("The same vase with a green leaf beside it, same cream studio backdrop.");
    await evaluate(target, "document.querySelector('.form-footer button').click(); true");
    await waitFor(target, "document.querySelectorAll('.image-result').length === 2", "edited output retained beside source");
    await evaluate(target, "location.reload(); true");
    target = await waitForTarget();
    const persisted = await waitFor(target, "document.querySelectorAll('.image-result').length === 2 ? JSON.stringify([...document.querySelectorAll('.image-result img')].map(image => [image.naturalWidth, image.naturalHeight, image.src.slice(0, 23)])) : null", "generated and edited images after restart", 30_000);
    const persistedState = JSON.parse(persisted);
    if (persistedState.some((image) => image[0] !== 512 || image[1] !== 512 || image[2] !== "data:image/jpeg;base64,"))
      throw new Error(`Image history did not reopen valid local image blobs: ${persisted}`);
    console.log(`Packaged UI image edit and restart persistence passed: ${JSON.stringify(persistedState)}.`);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      if (process.platform === "win32") {
        await new Promise((resolve) => {
          const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
          killer.once("close", resolve); killer.once("error", resolve);
        });
      } else { child.kill("SIGTERM"); await new Promise((resolve) => child.once("close", resolve)); }
    }
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try { fs.rmSync(userDataDir, { recursive: true, force: true }); break; }
      catch { await sleep(100); }
    }
  }

  async function waitForTarget() {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const current = await getMainTarget().catch(() => undefined);
      if (current) return current;
      await sleep(250);
    }
    throw new Error("Packaged Skai did not restore its page after reload.");
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
