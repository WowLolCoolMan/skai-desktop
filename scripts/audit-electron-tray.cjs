const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const main = read("apps/desktop/electron/main.cjs");
const preload = read("apps/desktop/electron/preload.cjs");
const contracts = read("apps/desktop/shared/contracts.ts");
const workspace = read("apps/desktop/src/app/useDesktopWorkspace.ts");
const packageScript = read("scripts/package-electron.cjs");
const releaseWorkflow = read(".github/workflows/release.yml");

const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

expect(main.includes("requestSingleInstanceLock") && main.includes('app.on("second-instance"'), "tray app must restore the existing resident instance");
expect(main.includes('mainWindow.on("close"') && main.includes("event.preventDefault()") && main.includes("mainWindow.hide()"), "closing the main window must hide it instead of quitting");
expect(main.includes("new Tray") && main.includes('tray.on("click"') && main.includes('tray.on("right-click"'), "tray must support click and context-menu interactions");
expect(main.includes("Recent chats") && main.includes("conversations.list") && main.includes("tray:open-conversation"), "tray must expose host-backed recent chats");
expect(main.includes('petVisible ? "Hide all pets" : "Show all pets"') && main.includes("setPetVisible"), "tray must expose an all-pets visibility toggle");
expect(main.includes("Quit Skai Desktop") && main.includes("app.quit()"), "tray must expose an explicit quit action");
expect(main.includes('process.platform === "win32" ? source.resize({ width: 16, height: 16 }) : source'), "tray icon sizing must use the Windows-specific size while preserving the native Linux icon");
expect(releaseWorkflow.includes("rid: linux-x64") && releaseWorkflow.includes("runner.os == 'Linux'"), "release workflow must build and smoke-test the Linux Electron artifact");
expect(releaseWorkflow.includes("Skai-Desktop-electron-linux-x64.tar.gz") && releaseWorkflow.includes("SHA256SUMS-electron-linux-x64.txt"), "Linux Electron releases must be archived and checksummed");
expect(preload.includes("onTrayOpenConversation") && preload.includes("onTrayNewChat"), "preload must expose tray navigation events");
expect(contracts.includes("onTrayOpenConversation?") && contracts.includes("onTrayNewChat?"), "tray events must remain typed in the renderer contract");
expect(workspace.includes("onTrayOpenConversation") && workspace.includes("onTrayNewChat"), "renderer must handle tray recent-chat and new-chat actions");
expect(packageScript.includes('process.platform === "linux" ? "linux-x64"') && packageScript.includes('const packagedBinary = process.platform === "win32" ? "Skai Desktop.exe" : "Skai Desktop"'), "Electron packaging must publish a Linux x64 artifact with the native executable name");

// Linux desktop integration: the launcher entry must match the window class so docks
// and "reopen from your app launcher" (Linux close prompt) work, and the sandbox must never be disabled.
const linuxInstaller = read("packaging/linux/install.sh");
expect(packageScript.includes('"install.sh"') && packageScript.includes('"uninstall.sh"') && packageScript.includes("skai-desktop.png"), "Linux artifacts must ship install.sh, uninstall.sh and the launcher icon");
expect(linuxInstaller.includes("StartupWMClass=skai-desktop") && JSON.parse(read("apps/desktop/package.json")).name === "skai-desktop", "Linux launcher StartupWMClass must match the Electron window class (package name skai-desktop)");
expect(main.includes('app.setDesktopName("skai-desktop.desktop")') && linuxInstaller.includes('DESKTOP_FILE="$DATA_HOME/applications/skai-desktop.desktop"'), "Electron desktop name must match the installed Linux launcher entry");
expect(!/--no-sandbox/.test(linuxInstaller.replace(/^\s*#.*$/gm, "")), "Linux installer must not disable Chromium's sandbox");

if (failures.length > 0) {
  console.error("Electron tray audit failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Electron tray audit passed: resident app behavior and Windows/Linux packaging contracts are present.");
