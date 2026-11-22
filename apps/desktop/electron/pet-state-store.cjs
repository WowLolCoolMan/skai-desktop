function createPetStateStore({ app, fs, fsSync, path }) {
  const filePath = () => path.join(app.getPath("userData"), "pet-window.json");

  function read() {
    try {
      const parsed = JSON.parse(fsSync.readFileSync(filePath(), "utf8"));
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function write(state) {
    const directory = app.getPath("userData");
    return fs.mkdir(directory, { recursive: true })
      .then(() => fs.writeFile(filePath(), JSON.stringify(state, null, 2), "utf8"));
  }

  return { read, write };
}

module.exports = { createPetStateStore };
