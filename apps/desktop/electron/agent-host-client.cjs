const readline = require("node:readline");
const path = require("node:path");

const standardRequestTimeoutMs = 30_000;
const imageGenerationRequestTimeoutMs = 60 * 60_000;

function handleConsolePipeError(error) {
  if (error?.code !== "EPIPE") throw error;
}

function logSafely(logError, ...args) {
  try {
    logError(...args);
  } catch (error) {
    handleConsolePipeError(error);
  }
}

function createAgentHostClient(options) {
  const {
    app,
    allowedMethods,
    augmentUserPath,
    chatHostDeadlineSeconds,
    hostProject,
    packagedHost,
    packagedRuntime,
    petCompletionText,
    process: processObject,
    repoRoot,
    sendPetMessage,
    spawn,
    longRequestTimeouts = {},
    isQuitting = () => false,
    createLineReader = (input) => readline.createInterface({ input }),
    logError = (...args) => console.error(...args),
  } = options;

  let host;
  let hostReader;
  let restartOnNextRequest = false;
  let nextRequestId = 1;
  const pending = new Map();

  // The Electron launcher can close its inherited console pipe before the
  // app or a child process exits. Node treats an unhandled stream EPIPE as a
  // main-process exception, so absorb only that expected shutdown error.
  for (const stream of [processObject.stdout, processObject.stderr]) {
    stream?.on?.("error", handleConsolePipeError);
  }

  function settlePending(response, { notifyPet = true } = {}) {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      if (notifyPet) {
        const completion = petCompletionText(entry.method, response);
        if (completion) sendPetMessage(completion.text, completion.kind);
      }
      entry.resolve(response);
    }
    pending.clear();
  }

  function start() {
    if (host) return;
    restartOnNextRequest = false;
    const command = packagedRuntime ? packagedHost : "dotnet";
    const args = packagedRuntime ? ["--stdio"] : ["run", "--project", hostProject, "--no-launch-profile", "--", "--stdio"];
    host = spawn(command, args, {
      cwd: packagedRuntime ? path.dirname(packagedHost) : repoRoot,
      // Launcher-started Linux sessions lack shell PATH additions (nvm, pyenv, ~/.local/bin).
      env: { ...processObject.env, PATH: augmentUserPath(), SKAI_PLUGIN_DOWNLOADS: path.join(app.getPath("downloads"), "Skai Plugins") },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const startedHost = host;

    host.stdin.on("error", () => {
      settlePending({ v: 1, ok: false, error: { code: "HOST_WRITE_FAILED", message: "The local agent host closed its request pipe." } });
      if (host === startedHost) {
        host = undefined;
        restartOnNextRequest = !isQuitting();
        if (startedHost.exitCode === null && !startedHost.killed) {
          try { startedHost.kill(); } catch { /* The broken pipe may outlive the process handle. */ }
        }
      }
    });

    hostReader = createLineReader(host.stdout);
    hostReader.on("line", (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      const completion = petCompletionText(entry.method, message);
      if (completion) sendPetMessage(completion.text, completion.kind);
      entry.resolve(message);
    });

    host.stderr.on("data", (chunk) => logSafely(logError, `[agent-host] ${chunk.toString().trimEnd()}`));
    host.on("exit", (code, signal) => {
      const error = { v: 1, ok: false, error: { code: "HOST_EXITED", message: `Agent host exited (${code ?? signal}).` } };
      hostReader?.close();
      settlePending(error);
      if (host === startedHost) {
        host = undefined;
        restartOnNextRequest = !isQuitting();
      }
    });
  }

  function stop(onStopped) {
    restartOnNextRequest = false;
    if (!host) {
      onStopped?.();
      return;
    }
    const currentHost = host;
    host = undefined;
    settlePending({ v: 1, ok: false, error: { code: "HOST_STOPPED", message: "Agent host is shutting down." } }, { notifyPet: false });
    if (!currentHost.stdin.destroyed) currentHost.stdin.end();
    const forceStop = setTimeout(() => {
      if (currentHost.exitCode !== null) return;
      if (processObject.platform === "win32" && currentHost.pid) {
        const killer = spawn("taskkill", ["/pid", String(currentHost.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.on("error", () => { if (!currentHost.killed) currentHost.kill(); });
      } else if (!currentHost.killed) currentHost.kill("SIGTERM");
    }, 1500);
    currentHost.once("exit", () => {
      clearTimeout(forceStop);
      onStopped?.();
    });
  }

  function restart() {
    stop(() => {
      if (!isQuitting()) start();
    });
  }

  function request(method, params) {
    if (typeof method !== "string" || !allowedMethods.has(method)) {
      return Promise.resolve({ v: 1, ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "That desktop operation is not exposed by the renderer bridge." } });
    }
    if (params !== undefined && (params === null || typeof params !== "object" || Array.isArray(params))) {
      return Promise.resolve({ v: 1, ok: false, error: { code: "INVALID_PARAMS", message: "Agent parameters must be an object." } });
    }
    if (!host && restartOnNextRequest && !isQuitting()) start();
    if (!host || host.stdin.destroyed) {
      const response = { v: 1, ok: false, error: { code: "HOST_UNAVAILABLE", message: "Agent host is not running." } };
      const completion = petCompletionText(method, response);
      if (completion) sendPetMessage(completion.text, completion.kind);
      return Promise.resolve(response);
    }
    const id = `desktop-${nextRequestId++}`;
    const requestParams = method === "chat.complete" ? { ...params, timeoutSeconds: chatHostDeadlineSeconds } : params;
    return new Promise((resolve) => {
      const timeoutMs = method === "image.generate" || method === "pet.background.remove"
        ? imageGenerationRequestTimeoutMs
        : longRequestTimeouts[method] ?? standardRequestTimeoutMs;
      const timer = setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        const response = { v: 1, ok: false, error: { code: "HOST_TIMEOUT", message: `The local agent host did not answer ${method} within the allowed time.` } };
        const completion = petCompletionText(method, response);
        if (completion) sendPetMessage(completion.text, completion.kind);
        resolve(response);
        restart();
      }, timeoutMs);
      pending.set(id, { resolve, timer, method });
      try {
        host.stdin.write(`${JSON.stringify({ v: 1, id, method, params: requestParams })}\n`);
      } catch {
        clearTimeout(timer);
        pending.delete(id);
        const response = { v: 1, ok: false, error: { code: "HOST_WRITE_FAILED", message: "The local agent host could not accept the request." } };
        const completion = petCompletionText(method, response);
        if (completion) sendPetMessage(completion.text, completion.kind);
        resolve(response);
      }
    });
  }

  return { start, stop, restart, request };
}

module.exports = { createAgentHostClient };
