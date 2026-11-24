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

const artifactArgument = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
const artifactRoot = path.resolve(artifactArgument || path.join(__dirname, "..", "dist", "electron", `${process.platform === "win32" ? "win" : process.platform}-x64`));
const executable = path.join(artifactRoot, process.platform === "win32" ? "Skai Desktop.exe" : "Skai Desktop");
const verifyMissingRuntime = process.argv.includes("--runtime-unavailable");
const verifyMissingModel = process.argv.includes("--model-unavailable");
const verifyEditUi = process.argv.includes("--edit-ui");
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
  if (!verifyMissingRuntime && !fs.existsSync(python)) throw new Error(`Install Skai's local Diffusers runtime before running this smoke: ${python}`);
  if (!verifyMissingRuntime && !verifyMissingModel && !verifyEditUi && !fs.existsSync(path.join(modelCache, "models--stabilityai--sd-turbo")))
    throw new Error(`This smoke never downloads model weights. Cache stabilityai/sd-turbo first: ${modelCache}`);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "skai-image-workflow-"));
  const appDataDir = path.join(userDataDir, "appdata");
  fs.mkdirSync(appDataDir, { recursive: true });
  const agentProfile = path.join(userDataDir, "agent-profile");
  fs.mkdirSync(agentProfile, { recursive: true });
  const port = await findPort();
  const display = resolveDisplayBackend({ argv: [] });
  const child = spawn(executable, [`--remote-debugging-port=${port}`, "--disable-gpu", ...(display.switchValue ? [`--ozone-platform=${display.switchValue}`] : []), `--user-data-dir=${path.join(userDataDir, "electron")}`, `--skai-isolated-smoke-app-data=${appDataDir}`], {
    cwd: artifactRoot,
    env: {
      ...process.env,
      SKAI_ELECTRON_SMOKE: "true",
      HF_HUB_OFFLINE: "1",
      // Keep the real user model cache visible even though the desktop profile
      // and LOCALAPPDATA are redirected for smoke isolation.
      HF_HUB_CACHE: modelCache,
      HUGGINGFACE_HUB_CACHE: modelCache,
      SKAI_SKIP_LEGACY_DATA_MIGRATION: "true",
      APPDATA: appDataDir,
      LOCALAPPDATA: path.join(userDataDir, "localappdata"),
      XDG_CONFIG_HOME: path.join(userDataDir, "config"),
      XDG_DATA_HOME: path.join(userDataDir, "data"),
      XDG_CACHE_HOME: path.join(userDataDir, "cache"),
      SRAI_SETTINGS_PATH: path.join(agentProfile, "settings.json"),
      SRAI_MCP_CONNECTIONS_PATH: path.join(agentProfile, "mcp-connections.json"),
      SRAI_CONVERSATIONS_PATH: path.join(agentProfile, "conversations.json"),
      SRAI_MEMORY_PATH: path.join(agentProfile, "memory.json"),
      SRAI_CORPUS_PATH: path.join(agentProfile, "document-corpus.json"),
      SRAI_CHAT_QUEUE_PATH: path.join(agentProfile, "chat-queue.json"),
      SRAI_TASKS_PATH: path.join(agentProfile, "agent-tasks.json"),
      SRAI_SCHEDULED_TASKS_PATH: path.join(agentProfile, "scheduled-tasks.json"),
      SRAI_PROJECTS_PATH: path.join(agentProfile, "projects.json"),
      SRAI_UNDO_PATH: path.join(agentProfile, "workspace-undo.json"),
      SRAI_OPERATIONS_PATH: path.join(agentProfile, "operations.json"),
      SKAI_DIFFUSERS_PYTHON: verifyMissingRuntime ? path.join(userDataDir, "missing-python.exe") : python,
      ...(verifyMissingModel ? {
        HF_HOME: path.join(userDataDir, "empty-huggingface-home"),
        HF_HUB_CACHE: path.join(userDataDir, "empty-huggingface-home", "hub"),
        HUGGINGFACE_HUB_CACHE: path.join(userDataDir, "empty-huggingface-home", "hub"),
      } : {}),
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  const sleep = (ms) => wait(ms);

  let lastTargets = [];
  async function getMainTarget() {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    lastTargets = await response.json();
    return lastTargets.find((target) => target.type === "page" && target.title?.includes("Skai") && !target.url?.includes("pet=1"));
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

  async function callFunction(target, functionDeclaration, args, timeout = 30_000) {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    let nextId = 1;
    const pending = new Map();
    socket.addEventListener("message", (event) => {
      let message;
      try { message = JSON.parse(typeof event.data === "string" ? event.data : String(event.data)); }
      catch { return; }
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message);
    });

    const send = (method, params) => new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Packaged image workflow ${method} timed out.`)); }, timeout);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });

    try {
      const globalObject = await send("Runtime.evaluate", { expression: "window", returnByValue: false });
      const objectId = globalObject.result?.result?.objectId;
      if (!objectId) throw new Error("Packaged image workflow could not access its page context.");
      const response = await send("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration,
        arguments: args.map((value) => ({ value })),
        returnByValue: true,
        awaitPromise: true,
      });
      return response.result?.result?.value;
    } finally { socket.close(); }
  }

  async function captureScreenshot(target, outputPath) {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Image workflow screenshot timed out.")), 15_000);
        socket.addEventListener("message", (event) => {
          const message = JSON.parse(String(event.data));
          if (message.id !== 1) return;
          clearTimeout(timer);
          if (message.error) reject(new Error(message.error.message));
          else { fs.mkdirSync(path.dirname(outputPath), { recursive: true }); fs.writeFileSync(outputPath, Buffer.from(message.result.data, "base64")); resolve(); }
        });
        socket.send(JSON.stringify({ id: 1, method: "Page.captureScreenshot", params: { format: "png" } }));
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

  async function waitForImageOutput(target, timeout = 600_000) {
    const deadline = Date.now() + timeout;
    let nextLog = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const state = await evaluate(target, "JSON.stringify({ count: document.querySelectorAll('.visuals-gallery-item').length, progress: document.querySelector('.visuals-generation-state')?.innerText ?? null, error: document.querySelector('[role=alert]')?.innerText ?? null, action: document.querySelector('.visuals-composer-action button')?.innerText ?? null })", 15_000);
      const current = JSON.parse(state || "{}");
      if (current.count > 0) return current;
      if (!current.progress && current.action?.includes("Create image")) throw new Error(`The local image request ended without output: ${JSON.stringify(current)}`);
      if (Date.now() >= nextLog) { console.log(`Local image inference is still running: ${JSON.stringify(current)}`); nextLog = Date.now() + 30_000; }
      await sleep(1_000);
    }
    throw new Error(`Timed out waiting for generated output. ${await evaluate(target, "JSON.stringify({ progress: document.querySelector('.visuals-generation-state')?.innerText ?? null, error: document.querySelector('[role=alert]')?.innerText ?? null, action: document.querySelector('.visuals-composer-action button')?.innerText ?? null })")}`);
  }

  try {
    const deadline = Date.now() + 30_000;
    let target;
    while (Date.now() < deadline && !target) { target = await getMainTarget().catch(() => undefined); if (!target) await sleep(250); }
    if (!target) throw new Error(`Packaged Skai did not expose its main page. Targets: ${JSON.stringify(lastTargets)}. ${output.slice(-2_000)}`);
    await waitFor(target, "Boolean(document.querySelector('[aria-label=\\\"Primary navigation\\\"]'))", "app navigation");
    await evaluate(target, "location.hash = '#/images'; 'navigated'");
    await waitFor(target, "Boolean(document.querySelector('#visuals-prompt'))", "Images page");
    const setPrompt = async (value) => callFunction(target, "function(value) { const field = document.querySelector('#visuals-prompt'); if (!field) return null; const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(field, String(value)); field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true })); return field.value; }", [value]);

    if (verifyMissingRuntime) {
      await waitFor(target, "document.querySelector('.visuals-runtime-settings')?.textContent.includes('dependencies-missing')", "missing-runtime state");
      const unavailable = await evaluate(target, "JSON.stringify({ message: document.querySelector('.visuals-runtime-settings')?.innerText, installAction: [...document.querySelectorAll('.visuals-runtime-settings button')].some(button => button.textContent.includes('Install local image runtime')), generateDisabled: [...document.querySelectorAll('.visuals-composer-action button')].find(button => button.textContent.includes('Create image'))?.disabled })");
      const unavailableState = JSON.parse(unavailable);
      if (!unavailableState.installAction || unavailableState.generateDisabled !== true)
        throw new Error(`Missing-runtime state was not actionable or allowed a run: ${unavailable}`);
      console.log(`Packaged missing-runtime recovery passed: ${JSON.stringify(unavailableState)}.`);
      return;
    }

    if (verifyMissingModel) {
      await waitFor(target, "document.querySelector('.visuals-runtime-settings')?.textContent.includes('local image runtime')", "installed image dependencies");
      await setPrompt("A small red paper kite on a clear sky, simple illustration.");
      await waitFor(target, "[...document.querySelectorAll('.visuals-composer-action button')].some(button => button.textContent.includes('Create image') && !button.disabled)", "model-failure test to become available");
      await evaluate(target, "[...document.querySelectorAll('.visuals-composer-action button')].find(button => button.textContent.includes('Create image')).click(); true");
      const failure = await waitFor(target, "document.querySelector('[role=alert]')?.textContent.trim() || null", "offline model-cache error", 90_000);
      const recovered = await waitFor(target, "[...document.querySelectorAll('.visuals-composer-action button')].some(button => button.textContent.includes('Create image') && !button.disabled) && document.querySelectorAll('.visuals-gallery-item').length === 0 ? 'ready' : null", "retryable image page after worker failure", 30_000);
      if (!failure.includes("not in the local model cache") || !failure.includes("Connect to the internet once") || recovered !== "ready")
        throw new Error(`Missing-model failure was not actionable or retryable: ${JSON.stringify({ failure, recovered })}`);
      console.log(`Packaged missing-model recovery passed: ${failure.slice(0, 240)}.`);
      return;
    }

    if (verifyEditUi) {
      const seeded = await evaluate(target, `(async () => {
        const database = await new Promise((resolve, reject) => {
          const request = indexedDB.open('skai-image-history', 1);
          request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('outputs')) request.result.createObjectStore('outputs', { keyPath: 'id' }); };
          request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
        const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
        const context = canvas.getContext('2d');
        const sky = context.createLinearGradient(0, 0, 0, 512); sky.addColorStop(0, '#b1a0d4'); sky.addColorStop(1, '#f2b99f'); context.fillStyle = sky; context.fillRect(0, 0, 512, 512);
        context.fillStyle = '#59678c'; context.beginPath(); context.moveTo(0, 360); context.lineTo(180, 90); context.lineTo(310, 360); context.fill();
        context.fillStyle = '#303d5c'; context.beginPath(); context.moveTo(130, 390); context.lineTo(330, 130); context.lineTo(512, 390); context.fill();
        context.fillStyle = '#ece7f0'; context.beginPath(); context.moveTo(292, 180); context.lineTo(330, 130); context.lineTo(365, 181); context.lineTo(338, 168); context.lineTo(323, 180); context.fill();
        const entry = { id: 'revision4-edit-fixture', url: canvas.toDataURL('image/png'), fileName: 'alpine-dusk.png', createdAt: new Date().toISOString(), provider: 'diffusers', prompt: 'Alpine peaks at dusk' };
        await new Promise((resolve, reject) => { const tx = database.transaction('outputs', 'readwrite'); tx.objectStore('outputs').put(entry); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
        database.close(); return 'seeded';
      })()`);
      if (seeded !== "seeded") throw new Error(`Could not seed the isolated image history fixture: ${seeded}`);
      await evaluate(target, "location.reload(); true").catch(() => undefined);
      target = await waitForTarget();
      await waitFor(target, "document.querySelectorAll('.visuals-gallery-item').length === 1", "seeded image history");
      await waitFor(target, "document.querySelector('.visuals-runtime-settings .status-badge')?.textContent.trim().toLowerCase() === 'ready'", "local image runtime readiness");
      await evaluate(target, "document.querySelector('.visuals-gallery-item').click(); true");
      await waitFor(target, "[...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Use for edit')", "image history action");
      await evaluate(target, "[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Use for edit').click(); true");
      const editState = await waitFor(target, "document.querySelector('.visuals-workshop-page.is-editing') && document.querySelector('.visuals-edit-source-preview img') && document.querySelector('.visuals-source-image img') ? JSON.stringify({ page: true, source: document.querySelector('.visuals-edit-source-preview img').naturalWidth, miniature: document.querySelector('.visuals-source-image img').naturalWidth, prompt: Boolean(document.querySelector('#visuals-prompt')), action: document.querySelector('.visuals-composer-action button')?.textContent.trim(), gallery: document.querySelectorAll('.visuals-gallery-item').length }) : null", "Edit layout and source image preview");
      const edit = JSON.parse(editState);
      if (!edit.page || edit.source !== 512 || edit.miniature <= 0 || edit.prompt !== true || edit.action !== "Edit image" || edit.gallery !== 1) throw new Error(`Image edit flow did not preserve its source/history context: ${editState}`);
      const layout = await evaluate(target, "JSON.stringify({ viewport: [innerWidth, innerHeight], overflow: document.documentElement.scrollWidth - innerWidth, stage: (() => { const r=document.querySelector('.visuals-stage').getBoundingClientRect(); return [Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)]; })(), controls: (() => { const r=document.querySelector('.visuals-controls').getBoundingClientRect(); return [Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)]; })(), history: (() => { const r=document.querySelector('.visuals-gallery').getBoundingClientRect(); return [Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)]; })() })");
      const layoutState = JSON.parse(layout);
      if (layoutState.overflow > 1 || layoutState.stage[0] >= layoutState.controls[0] || layoutState.history[1] <= layoutState.stage[1]) throw new Error(`Image edit layout did not match the two-column editor and lower history flow: ${layout}`);
      const screenshot = path.join(__dirname, "..", ".tmp", "ui-matrix-review", "images-edit.png");
      await captureScreenshot(target, screenshot);
      console.log(`Packaged image history → Edit flow passed: ${JSON.stringify(edit)}. Layout ${JSON.stringify(layoutState)}. Screenshot ${screenshot}.`);
      return;
    }

    await evaluate(target, "(() => { const field = document.querySelector('.visuals-control-summary select'); if (!field) throw new Error('Image engine control is missing.'); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(field, 'diffusers'); field.dispatchEvent(new Event('change', { bubbles: true })); return field.value; })()");
    await waitFor(target, "document.querySelector('.visuals-runtime-settings .status-badge')?.textContent.trim() === 'ready'", "local image runtime status");

    await setPrompt("A small amber glass vase on a plain cream studio backdrop, centered product photo.");
    await waitFor(target, "[...document.querySelectorAll('.visuals-composer-action button')].some(button => button.textContent.includes('Create image') && !button.disabled)", "generation to become available");
    await evaluate(target, "[...document.querySelectorAll('.visuals-composer-action button')].find(button => button.textContent.includes('Create image')).click(); true");
    await waitFor(target, "[...document.querySelectorAll('.visuals-composer-action button')].some(button => button.textContent.trim() === 'Cancel')", "active generation cancel control");
    await evaluate(target, "[...document.querySelectorAll('.visuals-composer-action button')].find(button => button.textContent.trim() === 'Cancel').click(); true");
    await waitFor(target, "[...document.querySelectorAll('.visuals-composer-action button')].some(button => button.textContent.includes('Create image')) && !document.querySelector('.visuals-generation-state')", "cancelled worker to stop", 60_000);
    console.log("Packaged UI cancellation: Cancel returned the Images page to idle before another run.");

    await evaluate(target, "[...document.querySelectorAll('.visuals-composer-action button')].find(button => button.textContent.includes('Create image')).click(); true");
    await waitForImageOutput(target);
    const generated = await evaluate(target, "JSON.stringify({ image: document.querySelector('.visuals-output img')?.src.slice(0, 23), natural: [document.querySelector('.visuals-output img')?.naturalWidth, document.querySelector('.visuals-output img')?.naturalHeight], historyCount: document.querySelectorAll('.visuals-gallery-item').length })");
    const generatedState = JSON.parse(generated);
    if (generatedState.image !== "data:image/jpeg;base64," || generatedState.natural[0] !== 512 || generatedState.natural[1] !== 512)
      throw new Error(`Generated UI output was not a valid local 512px JPEG: ${generated}`);
    console.log(`Packaged UI generation and history: ${JSON.stringify(generatedState)}.`);

    await evaluate(target, "document.querySelector('.visuals-gallery-item').click(); true");
    await waitFor(target, "[...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Use for edit')", "generated output inspector");
    await evaluate(target, "[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Use for edit').click(); true");
    const reopened = await waitFor(target, "(() => { const page = document.querySelector('.visuals-workshop-page'); const preview = document.querySelector('.visuals-edit-source-preview img'); const error = document.querySelector('[role=alert]')?.textContent?.trim(); if (page?.classList.contains('is-editing') && preview) return JSON.stringify({ editing: true, source: preview.naturalWidth, prompt: Boolean(document.querySelector('#visuals-prompt')) }); return error ? JSON.stringify({ editing: false, error, selected: document.querySelector('.visuals-output-caption')?.innerText ?? null, tool: page?.className }) : null; })()", "history image reopened for editing", 45_000).catch(async () => {
      const state = await evaluate(target, "JSON.stringify({ page: document.querySelector('.visuals-workshop-page')?.className, activeTool: document.querySelector('.visuals-tool-tab.is-active')?.innerText ?? null, storedTool: localStorage.getItem('skai.visuals.tool'), output: document.querySelector('.visuals-output-caption')?.innerText ?? null, action: document.querySelector('.visuals-output-caption button')?.innerText ?? null, alert: document.querySelector('[role=alert]')?.innerText ?? null, source: document.querySelector('.visuals-source-image')?.innerText ?? null, history: [...document.querySelectorAll('.visuals-gallery-item')].map((item) => ({ selected: item.getAttribute('aria-pressed'), label: item.getAttribute('aria-label') })) })");
      throw new Error(`The Use for edit action did not switch to Edit: ${state}`);
    });
    if (reopened.includes('"editing":false')) throw new Error(`The saved image could not be reopened for editing: ${reopened}`);
    await setPrompt("The same vase with a green leaf beside it, same cream studio backdrop.");
    await evaluate(target, "document.querySelector('.visuals-composer-action button').click(); true");
    await waitFor(target, "document.querySelectorAll('.visuals-gallery-item').length === 2", "edited output retained beside source");
    await evaluate(target, "location.reload(); true");
    target = await waitForTarget();
    const persisted = await waitFor(target, "document.querySelectorAll('.visuals-gallery-item').length === 2 ? JSON.stringify([...document.querySelectorAll('.visuals-gallery-item img')].map(image => [image.naturalWidth, image.naturalHeight, image.src.slice(0, 23)])) : null", "generated and edited images after restart", 30_000);
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
