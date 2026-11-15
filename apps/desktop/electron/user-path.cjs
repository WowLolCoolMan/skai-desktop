// PATH for the Agent Host on Linux.
//
// Apps started from a desktop launcher inherit the session PATH, not the one a
// login shell builds from ~/.bashrc or ~/.zshrc. Node installed with nvm, fnm,
// volta, asdf or mise, and Python from pyenv or pip --user, is then invisible to
// the host, so REA's `npx` and the AirLLM/Diffusers runtime installers fail with
// "install Node.js/Python" even though the user has them.
//
// We append the well-known per-user tool directories that exist. Nothing is
// executed (sourcing an interactive shell can print banners, prompt, or hang),
// and system directories keep precedence because the additions go last.
//
// Kept free of Electron imports so scripts/test-linux-windowing.cjs can run it.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function compareVersionsDescending(a, b) {
  const parse = (name) => name.replace(/^v/, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const [left, right] = [parse(a), parse(b)];
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (right[index] ?? 0) - (left[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

/** Candidate per-user bin directories, most preferred first. */
function userToolDirectories({ env = process.env, home = os.homedir(), readdir = (dir) => fs.readdirSync(dir) } = {}) {
  const dataHome = env.XDG_DATA_HOME || path.join(home, ".local", "share");
  const nvmDir = env.NVM_DIR || path.join(home, ".nvm");
  const candidates = [
    path.join(home, ".local", "bin"),
    path.join(home, "bin"),
    env.VOLTA_HOME ? path.join(env.VOLTA_HOME, "bin") : path.join(home, ".volta", "bin"),
    path.join(dataHome, "fnm", "aliases", "default", "bin"),
    path.join(home, ".fnm", "aliases", "default", "bin"),
    path.join(dataHome, "mise", "shims"),
    path.join(env.ASDF_DATA_DIR || path.join(home, ".asdf"), "shims"),
    path.join(env.PYENV_ROOT || path.join(home, ".pyenv"), "shims"),
    path.join(home, ".bun", "bin"),
  ];
  // nvm has no stable "current" link; use the newest installed Node.
  try {
    const versions = readdir(path.join(nvmDir, "versions", "node")).filter((name) => /^v\d/.test(name)).sort(compareVersionsDescending);
    if (versions.length) candidates.splice(3, 0, path.join(nvmDir, "versions", "node", versions[0], "bin"));
  } catch { /* nvm not installed */ }
  return candidates;
}

/**
 * Return PATH with existing per-user tool directories appended (Linux only).
 * Directories already on PATH are not repeated.
 */
function augmentUserPath({ platform = process.platform, env = process.env, home = os.homedir(), exists = (dir) => fs.existsSync(dir), readdir } = {}) {
  const current = env.PATH || "";
  if (platform !== "linux" || !home) return current;
  const entries = current.split(path.delimiter).filter(Boolean);
  const seen = new Set(entries);
  for (const directory of userToolDirectories({ env, home, readdir })) {
    if (seen.has(directory) || !exists(directory)) continue;
    entries.push(directory);
    seen.add(directory);
  }
  return entries.join(path.delimiter);
}

module.exports = { augmentUserPath, userToolDirectories };
