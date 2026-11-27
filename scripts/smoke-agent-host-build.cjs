const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function ensureSmokeAgentHostBuild(root) {
  const output = path.join(root, ".tmp", "agent-host-smoke");
  const assembly = path.join(output, "SkaiDesktop.AgentHost.dll");
  const result = spawnSync("dotnet", [
    "build",
    path.join(root, "services", "agent-host", "SkaiDesktop.AgentHost.csproj"),
    "--configuration", "Release",
    "--output", output,
  ], { cwd: root, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0 || !fs.existsSync(assembly)) {
    throw new Error("The isolated Agent Host smoke build failed.");
  }
  return assembly;
}

module.exports = { ensureSmokeAgentHostBuild };
