function createSingleInstanceLease({ fs, path, appDataPath, processObject, pid, randomUUID }) {
  const directory = path.join(appDataPath, "Skai Desktop");
  const lockPath = path.join(directory, "instance.lock");
  const token = randomUUID();
  let held = false;

  function isProcessAlive(ownerPid) {
    try {
      processObject.kill(ownerPid, 0);
      return true;
    } catch (error) {
      if (error?.code === "ESRCH") return false;
      if (error?.code === "EPERM") return true;
      throw error;
    }
  }

  function readOwner() {
    const owner = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    if (!Number.isSafeInteger(owner.pid) || owner.pid < 1 || typeof owner.token !== "string") {
      throw new Error("Skai Desktop instance lock is malformed; refusing to start another session.");
    }
    return owner;
  }

  function acquire() {
    fs.mkdirSync(directory, { recursive: true });
    const owner = JSON.stringify({ pid, token });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const temporaryPath = path.join(directory, `instance-${pid}-${token}.tmp`);
      try {
        fs.writeFileSync(temporaryPath, owner, { flag: "wx", mode: 0o600 });
        try {
          // Hard-link creation is atomic and publishes the complete owner record.
          fs.linkSync(temporaryPath, lockPath);
          held = true;
          return true;
        } catch (error) {
          if (error?.code !== "EEXIST") throw error;
        }
      } finally {
        try { fs.unlinkSync(temporaryPath); } catch (error) { if (error?.code !== "ENOENT") throw error; }
      }

      let existing;
      try {
        existing = readOwner();
      } catch (error) {
        if (error?.code === "ENOENT") continue;
        throw error;
      }
      if (isProcessAlive(existing.pid)) return false;

      try { fs.unlinkSync(lockPath); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    }
    return false;
  }

  function release() {
    if (!held) return false;
    held = false;
    try {
      const existing = readOwner();
      if (existing.pid !== pid || existing.token !== token) return false;
      fs.unlinkSync(lockPath);
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
  }

  return { acquire, release };
}

module.exports = { createSingleInstanceLease };
