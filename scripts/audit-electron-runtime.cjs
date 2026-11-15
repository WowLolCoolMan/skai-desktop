const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const desktopPackage = JSON.parse(fs.readFileSync(path.join(root, "apps", "desktop", "package.json"), "utf8"));
const main = fs.readFileSync(path.join(root, "apps", "desktop", "electron", "main.cjs"), "utf8");
const preload = fs.readFileSync(path.join(root, "apps", "desktop", "electron", "preload.cjs"), "utf8");
const petWindow = fs.readFileSync(path.join(root, "apps", "desktop", "src", "components", "overlays", "PetWindow.tsx"), "utf8");
const modelPicker = fs.readFileSync(path.join(root, "apps", "desktop", "src", "components", "ui", "ModelPicker.tsx"), "utf8");
const overflowMenu = fs.readFileSync(path.join(root, "apps", "desktop", "src", "components", "ui", "OverflowMenu.tsx"), "utf8");
const sidebar = fs.readFileSync(path.join(root, "apps", "desktop", "src", "components", "layout", "Sidebar.tsx"), "utf8");
const chatComposer = fs.readFileSync(path.join(root, "apps", "desktop", "src", "features", "chat", "ChatComposer.tsx"), "utf8");
const chatWorkspace = fs.readFileSync(path.join(root, "apps", "desktop", "src", "features", "chat", "useChatWorkspace.ts"), "utf8");
const navigation = fs.readFileSync(path.join(root, "apps", "desktop", "src", "app", "navigation.ts"), "utf8");
const packageScript = fs.readFileSync(path.join(root, "scripts", "package-electron.cjs"), "utf8");
const smokeScript = fs.readFileSync(path.join(root, "scripts", "smoke-electron-artifact.cjs"), "utf8");
const themeSmokeScript = fs.readFileSync(path.join(root, "scripts", "smoke-electron-themes.cjs"), "utf8");
const overflowSmokeScript = fs.readFileSync(path.join(root, "scripts", "smoke-electron-overflow.cjs"), "utf8");
const workspace = fs.readFileSync(path.join(root, "apps", "desktop", "src", "app", "useDesktopWorkspace.ts"), "utf8");

function findAlternateDesktopFiles(directory, results = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if ([".git", ".tmp", "node_modules", "dist", "bin", "obj"].includes(entry.name)) continue;
    // Visual Studio and other IDEs create per-user project settings beside
    // the source tree. They are not a desktop surface and must not make the
    // Electron-only architecture audit fail on a developer checkout.
    if (entry.name.endsWith(".csproj.user") || entry.name.endsWith(".sln.user")) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) findAlternateDesktopFiles(fullPath, results);
    else if (/\.(xaml|xaml\.cs)$/i.test(entry.name) || /(?:^|\.)?(?:uno|winui|native)\.(?:csproj|sln)$/i.test(entry.name) || /ServerRock\.Native/i.test(entry.name)) results.push(path.relative(root, fullPath));
  }
  return results;
}

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };
expect(packageJson.scripts.start === "node scripts/start-desktop.cjs", "root start must launch Electron");
expect(packageJson.scripts.build === "npm run desktop:build", "root build must build Electron");
expect(packageJson.scripts.open === "node scripts/open-desktop.cjs", "root open must launch Electron");
expect(!packageJson.scripts["start:native"] && !packageJson.scripts["start:legacy-native"], "legacy native start commands must not be shipped");
expect(!packageJson.scripts["build:native"] && !packageJson.scripts["open:native"] && !packageJson.scripts["open:legacy-native"], "legacy native build/open commands must not be shipped");
expect(desktopPackage.main === "electron/main.cjs", "desktop package must use Electron main");
expect(main.includes("contextIsolation: true"), "context isolation must remain enabled");
expect(main.includes("nodeIntegration: false"), "Node integration must remain disabled");
expect(main.includes("sandbox: true"), "renderer sandbox must remain enabled");
expect(preload.includes("contextBridge.exposeInMainWorld"), "renderer communication must use preload");
expect(!preload.includes("require(\"node:fs\")"), "preload must not expose filesystem access");
expect(main.includes('"tasks.plan"'), "Electron bridge must expose the review-first local task planning method");
expect(main.includes('"project.git.status"'), "Electron bridge must expose the read-only local Git status method");
expect(main.includes('"workspace.importDroppedFiles"') && main.includes("decodeDroppedAttachment"), "Electron bridge must validate dropped chat files at the local boundary");
expect(chatComposer.includes("onDrop={handleDrop}") && chatComposer.includes("Drop files to attach"), "Chat composer must expose a visible drag-and-drop attachment state");
expect(chatComposer.includes("SpeechRecognition") && chatComposer.includes("aria-pressed={voiceListening}"), "Chat composer must expose explicit system voice input with a visible listening state");
expect(chatComposer.includes("stopNativeSpeech();") && chatComposer.includes("setHandsFreeActive(false);"), "Disabling hands-free mode must interrupt local speech output");
expect(chatComposer.includes("aria-activedescendant={commandQuery !== null ? activeCommandId : undefined}") && chatComposer.includes("(index + 1) % commandMatches.length"), "Chat composer commands must expose the active option and wrap keyboard navigation");
expect(modelPicker.includes("const onPopoverKeyDown") && modelPicker.includes("aria-activedescendant={filtered[activeIndex]"), "Model picker must keep keyboard focus inside the popover and expose the active option");
expect(overflowMenu.includes('event.key === "Tab"') && sidebar.includes('event.key === "Tab"'), "Overflow and recent-chat menus must close when keyboard focus leaves with Tab");
expect(chatWorkspace.includes("importDroppedFiles") && chatWorkspace.includes("workspace.importDroppedFiles"), "Chat workspace must route dropped files through the guarded Electron method");
expect(navigation.includes("NavigationState") && navigation.includes("HISTORY_KEY"), "Renderer navigation must keep typed app history state");
expect(navigation.includes('window.location.protocol === "file:"') && navigation.includes("#/${route}"), "Electron navigation must use reload-safe hash routes for file URLs");
expect(navigation.includes("window.history.replaceState") && navigation.includes('window.history[replace ? "replaceState" : "pushState"]'), "Renderer navigation must preserve browser-like back/forward history");
for (const method of ["scheduled.create", "scheduled.pause", "scheduled.resume", "scheduled.cancel", "scheduled.runNow"]) {
  expect(main.includes(`"${method}"`), `Electron bridge must expose the local scheduled method ${method}`);
}
expect(main.includes("HOST_TIMEOUT"), "Electron bridge must bound pending host requests");
expect(main.includes("new Tray") && main.includes("event.preventDefault()") && main.includes("mainWindow.hide()"), "Closing the main Electron window must hide it to the system tray instead of quitting");
expect(main.includes("requestSingleInstanceLock") && main.includes('app.on("second-instance"'), "Electron must reopen the resident instance instead of creating duplicate desktop processes");
expect(main.includes("globalShortcut.register") && main.includes("CommandOrControl+Alt+Space") && main.includes("globalShortcut.unregister"), "Electron must expose and clean up the system-wide launcher shortcut");
expect(main.includes("Recent chats") && main.includes("tray:open-conversation") && main.includes("Quit Skai Desktop"), "The system tray menu must expose recent chats, reopen, and explicit quit actions");
expect(main.includes("Hide Percy") && main.includes("Show Percy"), "The system tray menu must expose Percy visibility control");
expect(preload.includes("onTrayOpenConversation") && preload.includes("onTrayNewChat"), "The preload bridge must expose typed tray navigation events");
expect(main.includes("taskkill") && main.includes("/T"), "Electron shutdown must terminate the full Windows host process tree");
expect(main.includes("restartAgentHost"), "Electron must restart a timed-out host after resolving pending requests");
expect(main.includes("timeoutSeconds: chatHostDeadlineSeconds"), "Electron must give chat requests a host-side deadline before the renderer deadline");
expect(main.includes("function clampPetPosition") && main.includes("petWindow.setPosition(position.x, position.y)"), "Percy drag movement must remain inside the active monitor work area");
expect(main.includes("function movePetWithCursor") && main.includes("setInterval(movePetWithCursor, 16)"), "Percy desktop dragging must continue while the pointer leaves the companion window");
// Percy stays transparent everywhere except X11 sessions where the probe confirms no compositor
// (transparency would render black there), which get the opaque card fallback.
const percyTransparent = main.includes("transparent: true") || (main.includes("transparent: !petOpaque") && main.includes("petOpaque = composited === false"));
expect(main.includes("setVisibleOnAllWorkspaces(true") && percyTransparent && main.includes("alwaysOnTop: true"), "Percy must remain a transparent always-on-top desktop companion across workspaces");
expect(main.includes('"tasks.retry": "Retried the local task."'), "Percy must summarize successful task retries");
expect(main.includes('kind = "success"') && main.includes('kind: "error"'), "Percy completion events must distinguish successful and failed local work");
expect(main.includes("if (!task) return null"), "Percy completion bubbles must stay scoped to tracked agent work");
expect(petWindow.includes("BUILTIN_STRIPS") && petWindow.includes("percy-error-frames.png") && petWindow.includes("event.kind"), "Percy must render independent six-frame state strips and completion states");
expect(petWindow.includes("window.addEventListener(\"blur\", cancelDrag)") && petWindow.includes("event.target instanceof Element"), "Percy renderer must cancel lost drags and protect its hide control from drag initiation");
expect(main.includes("packagedRuntime") && main.includes("process.resourcesPath"), "Electron must resolve packaged runtime paths");
expect(main.includes("packagedHost") && main.includes("ServerRock.AgentHost"), "Electron must launch a bundled Agent Host when packaged");
expect(packageScript.includes("dotnet\", [\"publish\"") && packageScript.includes("PublishSingleFile=true"), "Electron packaging must publish a self-contained Agent Host");
expect(packageScript.includes("electronDist") && packageScript.includes("const appRoot = path.join(outputRoot, \"resources\", \"app\")"), "Electron packaging must stage the renderer and runtime files");
expect(smokeScript.includes("remote-debugging-port") && smokeScript.includes("mainTarget") && smokeScript.includes("petTarget") && smokeScript.includes("Primary navigation") && smokeScript.includes("Percy desktop companion") && smokeScript.includes("pet-window-sprite"), "Electron packaged smoke must inspect the main navigation, Settings, and separate Percy surfaces");
expect(packageJson.scripts["smoke:electron:themes"] === "node scripts/smoke-electron-themes.cjs" && themeSmokeScript.includes("Emulation.setDeviceMetricsOverride") && themeSmokeScript.includes("Page.captureScreenshot") && themeSmokeScript.includes("deep-space"), "Packaged Electron theme acceptance must exercise constrained rendering and capture appearance states");
expect(packageJson.scripts["smoke:electron:overflow"] === "node scripts/smoke-electron-overflow.cjs" && overflowSmokeScript.includes("1920") && overflowSmokeScript.includes("routes") && overflowSmokeScript.includes("getBoundingClientRect"), "Packaged Electron overflow acceptance must exercise every route across supported viewport widths");
expect(workspace.includes("const hasActiveTasks") && workspace.includes("loadWorkbench(false)") && workspace.includes("window.setInterval"), "Workbench must refresh background task state while local execution is active");
const workbenchDetails = fs.readFileSync(path.join(root, "apps", "desktop", "src", "features", "agents", "WorkbenchTaskDetails.tsx"), "utf8");
expect(workbenchDetails.includes('task.status === "running" || task.status === "verifying"') && workbenchDetails.includes('onTransition(task.id, "cancel")') && workbenchDetails.includes("Stop run"), "Workbench must expose cancellation for active local task execution");
const alternateDesktopFiles = findAlternateDesktopFiles(root);
expect(alternateDesktopFiles.length === 0, `alternate desktop UI files must not return to the project: ${alternateDesktopFiles.join(", ")}`);

if (failures.length) {
  console.error("Electron replacement audit failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Electron runtime audit passed: Electron is the only shipped desktop architecture and its secure boundary is present.");
}
