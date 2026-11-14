const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "apps", "desktop", "electron", "main.cjs"), "utf8");
const preload = fs.readFileSync(path.join(root, "apps", "desktop", "electron", "preload.cjs"), "utf8");
const contracts = fs.readFileSync(path.join(root, "apps", "desktop", "shared", "contracts.ts"), "utf8");
const workspace = fs.readFileSync(path.join(root, "apps", "desktop", "src", "app", "useDesktopWorkspace.ts"), "utf8");
const packageScript = fs.readFileSync(path.join(root, "scripts", "package-electron.cjs"), "utf8");

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

expect(main.includes("Tray") && main.includes("new Tray"), "Electron main must create a system tray icon.");
expect(main.includes("mainWindow.on(\"close\""), "Main window close must be intercepted for resident tray behavior.");
expect(main.includes("event.preventDefault()") && main.includes("hideMainWindow()"), "Close-to-tray behavior must hide the window without quitting.");
expect(main.includes("Recent chats") && main.includes("conversations.list"), "Tray menu must expose host-backed recent chats.");
expect(main.includes("Show Percy") && main.includes("Hide Percy"), "Tray menu must control Percy visibility.");
expect(main.includes("process.platform") && main.includes("window-all-closed"), "Tray lifecycle must retain explicit platform handling.");
expect(preload.includes("onOpenConversation") && preload.includes("onNewChat"), "Preload must expose tray chat actions without Node access.");
expect(contracts.includes("TrayBridge") && contracts.includes("tray: TrayBridge"), "Renderer contracts must describe the tray bridge.");
expect(workspace.includes("tray.onOpenConversation") && workspace.includes("tray.onNewChat"), "Workspace must consume tray chat actions.");
expect(packageScript.includes("assets", "branding") && packageScript.includes("skaiwolficon.png"), "Electron packaging must include the tray icon asset.");

if (failures.length) {
  console.error("Electron tray audit failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Electron tray audit passed: resident close, recent chats, Percy controls, and cross-platform packaging are present.");
}
