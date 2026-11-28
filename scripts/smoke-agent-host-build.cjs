const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function acquireBuildLock(root) {
  const lockPath = path.join(root, ".tmp", "agent-host-smoke.build.lock");
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    try {
      const handle = fs.openSync(lockPath, "wx");
      fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      return () => {
        try { fs.closeSync(handle); } catch { /* already closed */ }
        try { fs.unlinkSync(lockPath); } catch { /* another cleanup already removed it */ }
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      // A crashed smoke process must not strand every later smoke run forever.
      try {
        const age = Date.now() - fs.statSync(lockPath).mtimeMs;
        if (age > 15 * 60_000) fs.unlinkSync(lockPath);
      } catch { /* the owner may be replacing the lock */ }
      sleepSync(250);
    }
  }
  throw new Error(`Timed out waiting for the isolated Agent Host build lock: ${lockPath}`);
}

function ensureSmokeAgentHostBuild(root) {
  const release = acquireBuildLock(root);
  const output = path.join(root, ".tmp", "agent-host-smoke", `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(output, { recursive: true });
  const assembly = path.join(output, "SkaiDesktop.AgentHost.dll");
  try {
    const result = spawnSync("dotnet", [
      "build",
      path.join(root, "services", "agent-host", "SkaiDesktop.AgentHost.csproj"),
      "--configuration", "Release",
      "--output", output,
      "--disable-build-servers",
      "-p:UseSharedCompilation=false",
    ], { cwd: root, stdio: "inherit", windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0 || !fs.existsSync(assembly)) {
      throw new Error("The isolated Agent Host smoke build failed.");
    }
    return assembly;
  } finally {
    release();
  }
}

module.exports = { ensureSmokeAgentHostBuild };
