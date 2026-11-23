const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const path = require("node:path");
const { createAgentHostClient } = require("../apps/desktop/electron/agent-host-client.cjs");

const requests = [];
const messages = [];
const launches = [];
let host;
const fakeProcess = { env: { PATH: "original" }, platform: "linux", stdout: new EventEmitter(), stderr: new EventEmitter() };
const logErrors = [];
let loggerThrowsBrokenPipe = false;

function fakeSpawn(command, args, options) {
  if (command === "taskkill") throw new Error("unexpected taskkill");
  launches.push({ command, args, options });
  const child = new EventEmitter();
  child.exitCode = null;
  child.killed = false;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new Writable({
    write(chunk, _encoding, callback) {
      requests.push(JSON.parse(chunk.toString().trim()));
      callback();
    },
  });
  child.kill = () => { child.killed = true; };
  host = child;
  return child;
}

const client = createAgentHostClient({
  app: { getPath: () => "C:/Downloads" },
  allowedMethods: new Set(["chat.complete", "settings.get"]),
  augmentUserPath: () => "augmented",
  chatHostDeadlineSeconds: 285,
  hostProject: "repo/Host.csproj",
  packagedHost: "resources/agent-host",
  packagedRuntime: false,
  petCompletionText: () => null,
  process: fakeProcess,
  repoRoot: "repo",
  sendPetMessage: (...args) => messages.push(args),
  logError: (...args) => {
    if (loggerThrowsBrokenPipe) throw Object.assign(new Error("simulated closed logger pipe"), { code: "EPIPE" });
    logErrors.push(args);
  },
  spawn: fakeSpawn,
  isQuitting: () => false,
});

async function run() {
  const unavailable = await client.request("unknown.method", {});
  assert.equal(unavailable.error.code, "METHOD_NOT_ALLOWED");
  const invalid = await client.request("settings.get", []);
  assert.equal(invalid.error.code, "INVALID_PARAMS");
  const beforeStart = await client.request("settings.get", {});
  assert.equal(beforeStart.error.code, "HOST_UNAVAILABLE");

  client.start();
  assert.equal(launches[0].command, "dotnet");
  assert.deepEqual(launches[0].args, ["run", "--project", "repo/Host.csproj", "--no-launch-profile", "--", "--stdio"]);
  assert.equal(launches[0].options.env.PATH, "augmented");
  assert.equal(launches[0].options.env.SKAI_PLUGIN_DOWNLOADS, path.join("C:/Downloads", "Skai Plugins"));

  const responsePromise = client.request("chat.complete", { prompt: "hello" });
  const request = requests.at(-1);
  assert.equal(request.method, "chat.complete");
  assert.equal(request.params.timeoutSeconds, 285);
  host.stdout.write(`${JSON.stringify({ v: 1, id: request.id, ok: true, result: "hi" })}\n`);
  const response = await responsePromise;
  assert.equal(response.result, "hi");

  host.stderr.emit("data", Buffer.from("agent host diagnostic\n"));
  assert.deepEqual(logErrors.at(-1), ["[agent-host] agent host diagnostic"]);
  loggerThrowsBrokenPipe = true;
  assert.doesNotThrow(() => host.stderr.emit("data", Buffer.from("late shutdown diagnostic\n")));
  loggerThrowsBrokenPipe = false;
  assert.doesNotThrow(() => fakeProcess.stderr.emit("error", Object.assign(new Error("closed stderr"), { code: "EPIPE" })));
  assert.throws(() => fakeProcess.stdout.emit("error", new Error("unexpected console stream failure")), /unexpected console stream failure/);

  const failedPipeRequest = client.request("settings.get", {});
  host.stdin.emit("error", new Error("simulated broken pipe"));
  assert.equal((await failedPipeRequest).error.code, "HOST_WRITE_FAILED");

  let stopped = false;
  client.stop(() => { stopped = true; });
  host.stdin.on("finish", () => {
    host.exitCode = 0;
    host.emit("exit", 0, null);
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopped, true);
  assert.equal((await client.request("settings.get", {})).error.code, "HOST_UNAVAILABLE");

  client.start();
  const crashedHost = host;
  crashedHost.exitCode = 1;
  crashedHost.emit("exit", 1, null);
  const launchesBeforeRecovery = launches.length;
  const recoveryPromise = client.request("settings.get", {});
  assert.equal(launches.length, launchesBeforeRecovery + 1, "a request after an unexpected host exit relaunches the host");
  const recoveryRequest = requests.at(-1);
  host.stdout.write(`${JSON.stringify({ v: 1, id: recoveryRequest.id, ok: true, result: "recovered" })}\n`);
  assert.equal((await recoveryPromise).result, "recovered", "the retried local request completes on the recovered host");
  console.log("Agent Host client checks passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
