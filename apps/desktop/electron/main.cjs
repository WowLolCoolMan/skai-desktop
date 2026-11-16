const { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, screen, session, shell, systemPreferences, Tray } = require("electron");
const { spawn } = require("node:child_process");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const readline = require("node:readline");
const { randomUUID } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { PetWanderGrid, PetWanderPlanner, PetWalk } = require("./pet-wander.cjs");
const { listVisibleWindows } = require("./pet-surfaces.cjs");
const { normalizePetBehaviorSettings, randomAttackSequence } = require("./pet-attack.cjs");
const { resolveDisplayBackend, canPositionWindows, hasStatusNotifierHost, isTrayLikelyVisible, isWaylandSession, x11HasCompositor } = require("./linux-windowing.cjs");
const { augmentUserPath } = require("./user-path.cjs");
const { createThemeService } = require("./theme-service.cjs");

// Chromium fixes its display backend before any of this file runs, and
// app.commandLine.appendSwitch("ozone-platform") at this point is too late: the
// browser stays on Wayland while the GPU process starts on X11 and segfaults.
// The launchers (scripts/launch-electron.cjs) pass the flag up front; for any
// other entry point (packaged binary, `electron .`, desktop files) relaunch
// once with the flag. resolveDisplayBackend() returns no switch when the flag
// is already present, so this cannot loop.
const displayBackend = resolveDisplayBackend();
const relaunchingForDisplayBackend = Boolean(displayBackend.switchValue);
if (relaunchingForDisplayBackend) {
  const optOut = displayBackend.switchValue === "x11" ? "; set SKAI_OZONE_PLATFORM=wayland to keep native Wayland" : "";
  console.log(`[windowing] relaunching with --ozone-platform=${displayBackend.switchValue} (${displayBackend.reason})${optOut}.`);
  app.relaunch({ args: [...process.argv.slice(1), `--ozone-platform=${displayBackend.switchValue}`] });
  app.exit(0);
}
const windowPositioningAvailable = canPositionWindows(displayBackend);
if (process.platform === "linux" && !relaunchingForDisplayBackend) console.log(`[windowing] display backend: ${displayBackend.backend} (${displayBackend.reason})`);

const repoRoot = path.resolve(__dirname, "../../..");
const hostProject = path.join(repoRoot, "services", "agent-host", "SkaiDesktop.AgentHost.csproj");
const hostBinary = process.platform === "win32" ? "SkaiDesktop.AgentHost.exe" : "SkaiDesktop.AgentHost";
const packagedRoot = path.join(process.resourcesPath, "app");
const packagedHost = path.join(process.resourcesPath, "agent-host", hostBinary);
const packagedRuntime = fsSync.existsSync(path.join(packagedRoot, "dist", "index.html")) && fsSync.existsSync(packagedHost);
const runtimeRoot = packagedRuntime ? packagedRoot : repoRoot;
const rendererRoot = packagedRuntime ? runtimeRoot : path.join(runtimeRoot, "apps", "desktop");
let host;
let hostReader;
let nextRequestId = 1;
const pending = new Map();
const standardRequestTimeoutMs = 30_000;
// Local image generation includes a multi-gigabyte first-run model download and
// CPU inference. Keep the Agent Host alive long enough for that operation.
const imageGenerationRequestTimeoutMs = 60 * 60_000;
const chatRequestTimeoutMs = 5 * 60_000;
const chatHostDeadlineSeconds = 285;
const globalLauncherAccelerator = "CommandOrControl+Alt+Space";
let isQuitting = false;
let mainWindow;
let petWindow;
let tray;
let trayRefreshSequence = 0;
let petReady = false;
let petDragOffset = null;
let petEntranceTimer;
let petEntranceSequence = 0;
let petEntranceTargetBounds = null;
let petEntranceWalk = null;
let petEntranceStartedAt = 0;
let petEntranceMoving = false;
let petDragTimer;
let petWanderPauseTimer;
let petWanderStepTimer;
let petWanderMoving = false;
let petWanderWalk = null;
let petWanderStartedAt = 0;
let petWanderNextAt = 0;
let petWanderLayoutSignature = "";
let petWanderPlanning = false;
let petWanderPlanSequence = 0;
let petBehaviorSettings = normalizePetBehaviorSettings(null);
let petBehaviorPauseTimer;
let petBehaviorStepTimer;
let petBehaviorRunning = false;
let petBehaviorSequence = [];
let petBehaviorOrigin = null;
let petBehaviorTarget = null;
let petBehaviorCursorTarget = null;
let petAttackSceneBounds = null;
let petBehaviorWalk = null;
let petBehaviorWalkMode = null;
let petBehaviorWalkStartedAt = 0;
let petBehaviorResumeWander = false;
const petWanderPlanner = new PetWanderPlanner();
let petMotion = { wander: true, reduceMotion: false, interactionDemo: false };
// The OS "reduce motion" / "show animations: off" preference also stills Percy: the renderer's
// prefers-reduced-motion CSS stops the sprite, so wandering would slide a frozen sprite around.
function osPrefersReducedMotion() {
  try { return Boolean(systemPreferences.getAnimationSettings?.().prefersReducedMotion); } catch { return false; }
}
let petActivity = { state: "idle", facing: 1 };
const pendingPetMessages = [];
const PET_WINDOW_WIDTH = 220;
const PET_WINDOW_HEIGHT = 190;
const PET_WINDOW_MARGIN = 16;
const attachmentTextExtensions = new Set([".txt", ".md", ".markdown", ".csv", ".json", ".xml", ".yaml", ".yml", ".toml", ".html", ".htm", ".css", ".js", ".ts", ".jsx", ".tsx", ".cs", ".py", ".java", ".go", ".rs", ".c", ".h", ".cpp", ".hpp", ".sh", ".sql", ".log"]);
const blockedAttachmentNames = new Set([".env", ".env.local", ".env.production", "id_rsa", "id_ed25519", "credentials", "secrets"]);
const UPDATE_REPOSITORY = "WowLolCoolMan/skai-desktop";
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
let updateCheckTimer;

// Linux: name the launcher entry packaging/linux/install.sh creates, so desktop portals and
// docks can match the running app to it (Chromium exposes this as CHROME_DESKTOP).
if (process.platform === "linux") app.setDesktopName("skai-desktop.desktop");
const hasSingleInstanceLock = !relaunchingForDisplayBackend && app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => showMainWindow());
}
const isBlockedAttachmentName = (name) => blockedAttachmentNames.has(name.toLowerCase()) || name.toLowerCase().includes(".env.");
const isPng = (bytes) => bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const isJpeg = (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
const isMp4 = (bytes) => bytes.length >= 8 && bytes.toString("ascii", 4, 8) === "ftyp";
const isWebm = (bytes) => bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
const isAudioSignature = (bytes, mediaType) => mediaType === "audio/wav" ? bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE"
  : mediaType === "audio/mpeg" ? bytes.length >= 3 && (bytes.subarray(0, 3).toString("ascii") === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))
  : mediaType === "audio/ogg" ? bytes.length >= 4 && bytes.toString("ascii", 0, 4) === "OggS"
  : mediaType === "audio/mp4" ? isMp4(bytes)
  : mediaType === "audio/webm" ? isWebm(bytes) : false;

function decodeDroppedAttachment(attachment) {
  if (!attachment || typeof attachment.fileName !== "string" || typeof attachment.content !== "string") throw new Error("Dropped files must include a name and content.");
  const rawName = attachment.fileName.trim();
  const fileName = path.basename(rawName).slice(0, 240);
  if (!fileName || fileName !== rawName || isBlockedAttachmentName(fileName)) throw new Error(`That file name cannot be attached: ${rawName.slice(0, 80)}.`);
  if (attachment.content.length > 28_000_000 || attachment.content.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(attachment.content)) throw new Error(`The dropped file is not a valid local payload: ${fileName}`);
  const extension = path.extname(fileName).toLowerCase();
  const imageType = extension === ".png" ? "image/png" : [".jpg", ".jpeg"].includes(extension) ? "image/jpeg" : null;
  const isPdf = extension === ".pdf";
  if (!imageType && !isPdf && !attachmentTextExtensions.has(extension)) throw new Error(`That file type cannot be attached: ${fileName}`);
  const bytes = Buffer.from(attachment.content, "base64");
  if (bytes.length > (isPdf ? 20 * 1024 * 1024 : 2 * 1024 * 1024)) throw new Error(`The dropped file is too large: ${fileName}`);
  if (imageType) {
    if (!(imageType === "image/png" ? isPng(bytes) : isJpeg(bytes))) throw new Error(`The dropped image is not valid: ${fileName}`);
    return { fileName, mediaType: imageType, content: bytes.toString("base64"), byteLength: bytes.length, textLength: 0 };
  }
  if (isPdf) return { fileName, mediaType: null, content: bytes.toString("base64"), byteLength: bytes.length, textLength: 0 };
  const content = bytes.toString("utf8").slice(0, 16_000);
  return { fileName, mediaType: null, content, byteLength: bytes.length, textLength: content.length };
}

function petStatePath() {
  return path.join(app.getPath("userData"), "pet-window.json");
}

function readPetState() {
  try {
    const parsed = JSON.parse(fsSync.readFileSync(petStatePath(), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function petBounds() {
  const stored = readPetState().bounds;
  const width = PET_WINDOW_WIDTH;
  const height = PET_WINDOW_HEIGHT;
  const workArea = screen.getPrimaryDisplay().workArea;
  if (!stored || ![stored.x, stored.y].every(Number.isFinite)) {
    return { x: workArea.x + workArea.width - width - 28, y: workArea.y + workArea.height - height - 28, width, height };
  }

  // A saved position can outlive a monitor being disconnected. Keep Percy
  // recoverable instead of creating an invisible companion window.
  const display = screen.getAllDisplays().find(({ workArea: area }) => stored.x < area.x + area.width && stored.x + width > area.x && stored.y < area.y + area.height && stored.y + height > area.y) ?? screen.getPrimaryDisplay();
  const area = display.workArea;
  return {
    x: Math.min(Math.max(stored.x, area.x + PET_WINDOW_MARGIN), area.x + area.width - width - PET_WINDOW_MARGIN),
    y: Math.min(Math.max(stored.y, area.y + PET_WINDOW_MARGIN), area.y + area.height - height - PET_WINDOW_MARGIN),
    width,
    height,
  };
}

function stopPetWander() {
  if (petWanderPauseTimer) clearTimeout(petWanderPauseTimer);
  if (petWanderStepTimer) clearTimeout(petWanderStepTimer);
  petWanderPauseTimer = undefined;
  petWanderStepTimer = undefined;
  petWanderWalk = null;
  petWanderMoving = false;
  petWanderPlanning = false;
  petWanderPlanSequence += 1;
  if (!petEntranceMoving) setPetActivity("idle");
}

function setPetActivity(state, facing = petActivity.facing, target = undefined) {
  const allowedStates = new Set(["idle", "walk", "thinking", "coding", "coding_malicious", "stuck", "needs-attention", "angry", "pounce", "fire-breath", "celebrate", "curious-scan", "ember-curl", "star-orbit", "rock-roll", "sprout-stretch"]);
  const nextState = allowedStates.has(state) ? state : "idle";
  const nextFacing = facing === -1 ? -1 : 1;
  const nextTarget = target && Number.isFinite(target.x) && Number.isFinite(target.y) ? { x: target.x, y: target.y } : undefined;
  if (petActivity.state === nextState && petActivity.facing === nextFacing && petActivity.target?.x === nextTarget?.x && petActivity.target?.y === nextTarget?.y) return;
  petActivity = { state: nextState, facing: nextFacing, ...(nextTarget ? { target: nextTarget } : {}) };
  if (petReady && petWindow && !petWindow.isDestroyed()) petWindow.webContents.send("pet:activity", petActivity);
}

function stopPetDrag() {
  if (petDragTimer) clearInterval(petDragTimer);
  petDragTimer = undefined;
  petDragOffset = null;
}

function clampPetPosition(point) {
  const area = screen.getDisplayNearestPoint(point).workArea;
  const grid = new PetWanderGrid(area.width, area.height, { x: PET_WINDOW_WIDTH, y: PET_WINDOW_HEIGHT }, PET_WINDOW_MARGIN);
  const position = grid.clampPetPosition({ x: point.x - area.x, y: point.y - area.y });
  return {
    x: Math.round(area.x + position.x),
    y: Math.round(area.y + position.y),
  };
}

function petWanderLayout() {
  const displays = screen.getAllDisplays()
    .map(({ workArea }) => ({ x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height }))
    .filter(({ x, y, width, height }) => [x, y, width, height].every(Number.isFinite) && width > 0 && height > 0)
    .sort((left, right) => left.x - right.x || left.y - right.y);
  const primaryArea = screen.getPrimaryDisplay().workArea;
  const safePrimaryArea = [primaryArea.x, primaryArea.y, primaryArea.width, primaryArea.height].every(Number.isFinite) && primaryArea.width > 0 && primaryArea.height > 0
    ? primaryArea
    : { x: 0, y: 0, width: PET_WINDOW_WIDTH + PET_WINDOW_MARGIN * 2, height: PET_WINDOW_HEIGHT + PET_WINDOW_MARGIN * 2 };
  const availableDisplays = displays.length > 0 ? displays : [safePrimaryArea];
  const left = Math.min(...availableDisplays.map(({ x }) => x));
  const top = Math.min(...availableDisplays.map(({ y }) => y));
  const right = Math.max(...availableDisplays.map(({ x, width }) => x + width));
  const bottom = Math.max(...availableDisplays.map(({ y, height }) => y + height));
  const area = { x: left, y: top, width: right - left, height: bottom - top };
  const bounds = petWindow?.getBounds() ?? {
    x: primaryArea.x + primaryArea.width - PET_WINDOW_WIDTH - PET_WINDOW_MARGIN,
    y: primaryArea.y + primaryArea.height - PET_WINDOW_HEIGHT - PET_WINDOW_MARGIN,
  };
  const grid = new PetWanderGrid(area.width, area.height, { x: PET_WINDOW_WIDTH, y: PET_WINDOW_HEIGHT }, PET_WINDOW_MARGIN);
  const blocked = grid.blockedCellsOutsideDisplays(availableDisplays, { x: area.x, y: area.y });
  const signature = `${availableDisplays.map(({ x, y, width, height }) => `${x}:${y}:${width}:${height}`).join("|")}`;
  return { area, bounds, grid, blocked, signature };
}

function petBehaviorCanRun() {
  return Boolean(petWindow && !petWindow.isDestroyed() && petWindow.isVisible() && !petDragOffset && !petEntranceMoving && !petMotion.reduceMotion && !osPrefersReducedMotion());
}

function clearPetBehaviorTimers() {
  if (petBehaviorPauseTimer) clearTimeout(petBehaviorPauseTimer);
  if (petBehaviorStepTimer) clearTimeout(petBehaviorStepTimer);
  petBehaviorPauseTimer = undefined;
  petBehaviorStepTimer = undefined;
}

function setPetAttackScene(active) {
  if (!petWindow || petWindow.isDestroyed() || !windowPositioningAvailable) return;
  if (active) {
    if (petAttackSceneBounds) return;
    const bounds = petWindow.getBounds();
    const width = PET_WINDOW_WIDTH + 240;
    petAttackSceneBounds = bounds;
    try {
      petWindow.setIgnoreMouseEvents(true, { forward: true });
      petWindow.setBounds({ x: bounds.x - Math.round((width - bounds.width) / 2), y: bounds.y, width, height: bounds.height });
    } catch {
      petAttackSceneBounds = null;
      try { petWindow.setIgnoreMouseEvents(false); } catch {}
    }
    return;
  }
  if (!petAttackSceneBounds) return;
  const current = petWindow.getBounds();
  const original = petAttackSceneBounds;
  petAttackSceneBounds = null;
  try {
    petWindow.setBounds({ ...original, x: current.x + Math.round((current.width - original.width) / 2) });
    petWindow.setIgnoreMouseEvents(false);
  } catch {}
}

function stopPetBehavior(returnToOrigin = false) {
  const wasRunning = petBehaviorRunning;
  clearPetBehaviorTimers();
  setPetAttackScene(false);
  if (returnToOrigin && petBehaviorRunning && petBehaviorOrigin && windowPositioningAvailable && petWindow && !petWindow.isDestroyed()) {
    try { petWindow.setPosition(petBehaviorOrigin.x, petBehaviorOrigin.y); } catch {}
  }
  petBehaviorRunning = false;
  petBehaviorSequence = [];
  petBehaviorWalk = null;
  petBehaviorTarget = null;
  petBehaviorCursorTarget = null;
  petBehaviorWalkMode = null;
  petBehaviorOrigin = null;
  petBehaviorResumeWander = false;
  if (wasRunning || ["angry", "pounce", "fire-breath", "celebrate", "curious-scan", "ember-curl", "star-orbit", "rock-roll", "sprout-stretch"].includes(petActivity.state)) setPetActivity("idle");
  if (petBehaviorSettings.enabled) schedulePetBehaviorAttack();
}

function schedulePetBehaviorAttack() {
  if (petBehaviorPauseTimer || petBehaviorRunning || !petBehaviorSettings.enabled || !petBehaviorCanRun()) return;
  const minimum = petBehaviorSettings.minimumIntervalSeconds;
  const maximum = Math.max(minimum, petBehaviorSettings.maximumIntervalSeconds);
  const delay = (minimum + Math.random() * (maximum - minimum)) * 1000;
  petBehaviorPauseTimer = setTimeout(() => {
    petBehaviorPauseTimer = undefined;
    startPetBehaviorAttack();
  }, delay);
}

function petBehaviorActivityAllowed() {
  return (petActivity.state === "idle" && petBehaviorSettings.triggerDuringIdle)
    || (petActivity.state === "walk" && petBehaviorSettings.triggerDuringWalk);
}

function petBehaviorTargetPosition(cursor) {
  const bounds = petWindow.getBounds();
  const facing = cursor.x >= bounds.x + bounds.width / 2 ? 1 : -1;
  const targetCenterX = cursor.x - facing * 180;
  const position = clampPetPosition({
    x: targetCenterX - Math.floor(PET_WINDOW_WIDTH / 2),
    y: cursor.y - Math.floor(PET_WINDOW_HEIGHT / 2),
  });
  return { position, facing, cursor: { x: cursor.x, y: cursor.y } };
}

function petBehaviorAimPoint(cursor = petBehaviorCursorTarget) {
  if (!petWindow || petWindow.isDestroyed()) return undefined;
  const target = cursor ?? screen.getCursorScreenPoint();
  const bounds = petWindow.getBounds();
  return {
    x: Math.max(8, Math.min(bounds.width - 8, target.x - bounds.x)),
    y: Math.max(8, Math.min(bounds.height - 8, target.y - bounds.y)),
  };
}

function petCursorIsInScene(cursor) {
  if (!petWindow || petWindow.isDestroyed()) return false;
  const bounds = petWindow.getBounds();
  const petDisplay = screen.getDisplayNearestPoint({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
  const cursorDisplay = screen.getDisplayNearestPoint(cursor);
  return petDisplay.id === cursorDisplay.id;
}

function makePetBehaviorWalk(fromBounds, toBounds, speed = 380) {
  if (!windowPositioningAvailable) return null;
  const { area, grid, blocked } = petWanderLayout();
  const start = grid.clampPetPosition({ x: fromBounds.x - area.x, y: fromBounds.y - area.y });
  const target = grid.clampPetPosition({ x: toBounds.x - area.x, y: toBounds.y - area.y });
  const startCell = grid.cellForPetPosition(start);
  const targetCell = grid.cellForPetPosition(target);
  const cells = PetWanderPlanner.planPath(startCell, targetCell, blocked);
  const waypoints = cells.map((cell) => grid.petPositionFor(cell));
  if (waypoints.length === 0 && (Math.abs(start.x - target.x) > 2 || Math.abs(start.y - target.y) > 2)) waypoints.push(target);
  const walk = waypoints.length > 0 ? new PetWalk(start, waypoints, speed) : null;
  return walk;
}

function movePetForBehavior(mode, targetBounds) {
  if (!petBehaviorRunning || !petBehaviorCanRun() || !petBehaviorWalk || !petWindow || petWindow.isDestroyed()) {
    petBehaviorWalk = null;
    petBehaviorStepTimer = undefined;
    return;
  }
  const { area, grid } = petWanderLayout();
  const elapsed = (Date.now() - petBehaviorWalkStartedAt) / 1000;
  const relative = grid.clampPetPosition(petBehaviorWalk.positionAt(elapsed));
  const x = Math.trunc(area.x + relative.x);
  const y = Math.trunc(area.y + relative.y);
  try {
    petWindow.setPosition(x, y);
    if (mode === "approach") setPetActivity("walk", petBehaviorTarget?.facing ?? 1);
  } catch {
    petBehaviorWalk = null;
    petBehaviorStepTimer = undefined;
    if (mode === "return") finishPetBehavior();
    else performNextPetBehaviorAction();
    return;
  }
  if (petBehaviorWalk.isFinished(elapsed)) {
    petBehaviorWalk = null;
    petBehaviorStepTimer = undefined;
    if (mode === "approach") {
      petWindow.setPosition(Math.trunc(targetBounds.x), Math.trunc(targetBounds.y));
      setPetActivity("angry", petBehaviorTarget?.facing ?? 1, petBehaviorAimPoint());
      petBehaviorStepTimer = setTimeout(performNextPetBehaviorAction, 460);
    } else finishPetBehavior();
    return;
  }
  petBehaviorStepTimer = setTimeout(() => movePetForBehavior(mode, targetBounds), 55);
}

function startPetBehaviorWalk(mode, targetBounds) {
  if (!windowPositioningAvailable || !petWindow || petWindow.isDestroyed()) {
    if (mode === "return") finishPetBehavior();
    else performNextPetBehaviorAction();
    return;
  }
  const bounds = petWindow.getBounds();
  petBehaviorWalk = makePetBehaviorWalk(bounds, targetBounds);
  if (!petBehaviorWalk) {
    if (mode === "approach") {
      setPetActivity("angry", petBehaviorTarget?.facing ?? 1, petBehaviorAimPoint());
      petBehaviorStepTimer = setTimeout(performNextPetBehaviorAction, 460);
    } else finishPetBehavior();
    return;
  }
  petBehaviorWalkMode = mode;
  petBehaviorWalkStartedAt = Date.now();
  movePetForBehavior(mode, targetBounds);
}

function finishPetBehavior() {
  clearPetBehaviorTimers();
  setPetAttackScene(false);
  petBehaviorRunning = false;
  petBehaviorSequence = [];
  petBehaviorWalk = null;
  petBehaviorWalkMode = null;
  petBehaviorTarget = null;
  petBehaviorCursorTarget = null;
  petBehaviorOrigin = null;
  const resumeWander = petBehaviorResumeWander;
  petBehaviorResumeWander = false;
  petBehaviorTarget = null;
  setPetActivity("idle");
  persistPetState();
  if (resumeWander && petMotion.wander) {
    petWanderNextAt = Date.now() + 1;
    schedulePetWander();
  } else petWanderNextAt = Date.now() + petWanderPlanner.nextRestSeconds() * 1000;
  schedulePetBehaviorAttack();
}

function performNextPetBehaviorAction() {
  if (!petBehaviorRunning || !petBehaviorCanRun()) { stopPetBehavior(false); return; }
  const action = petBehaviorSequence.shift();
  if (!action) {
    setPetAttackScene(false);
    if (windowPositioningAvailable && petBehaviorOrigin && petWindow && !petWindow.isDestroyed()) {
      setPetActivity("walk", petActivity.facing);
      startPetBehaviorWalk("return", petBehaviorOrigin);
    } else finishPetBehavior();
    return;
  }
  if (action === "approach-cursor") {
    if (petBehaviorTarget && petBehaviorCursorTarget) startPetBehaviorWalk("approach", petBehaviorTarget.position);
    else performNextPetBehaviorAction();
    return;
  }
  if (action === "pounce") {
    setPetAttackScene(true);
    const aim = petBehaviorAimPoint();
    setPetActivity("pounce", petBehaviorTarget?.facing ?? 1, aim);
    petBehaviorStepTimer = setTimeout(performNextPetBehaviorAction, 760);
    return;
  }
  if (action === "fire-breath") {
    setPetAttackScene(true);
    const aim = petBehaviorAimPoint();
    setPetActivity("fire-breath", petBehaviorTarget?.facing ?? 1, aim);
    petBehaviorStepTimer = setTimeout(performNextPetBehaviorAction, 1500);
    return;
  }
  setPetActivity(action, petActivity.facing);
  petBehaviorStepTimer = setTimeout(performNextPetBehaviorAction, action === "celebrate" ? 1200 : 1600);
}

function startPetBehaviorAttack() {
  if (!petBehaviorSettings.enabled || !petBehaviorCanRun() || !petBehaviorActivityAllowed()) {
    schedulePetBehaviorAttack();
    return;
  }
  const sequence = randomAttackSequence(petBehaviorSettings);
  if (sequence.length === 0) { schedulePetBehaviorAttack(); return; }
  petBehaviorRunning = true;
  petBehaviorOrigin = petWindow.getBounds();
  petBehaviorResumeWander = petActivity.state === "walk" || Boolean(petWanderWalk);
  if (petWanderPauseTimer) clearTimeout(petWanderPauseTimer);
  if (petWanderStepTimer) clearTimeout(petWanderStepTimer);
  petWanderPauseTimer = undefined;
  petWanderStepTimer = undefined;
  petWanderWalk = null;
  petWanderMoving = false;
  petBehaviorSequence = sequence;
  const needsCursor = sequence.some((action) => ["approach-cursor", "pounce", "fire-breath"].includes(action));
  if (!needsCursor) {
    petBehaviorCursorTarget = null;
    petBehaviorTarget = null;
    performNextPetBehaviorAction();
    return;
  }
  const cursor = screen.getCursorScreenPoint();
  if (!petCursorIsInScene(cursor)) { stopPetBehavior(false); return; }
  petBehaviorCursorTarget = cursor;
  petBehaviorTarget = petBehaviorTargetPosition(cursor);
  setPetActivity("angry", petBehaviorTarget.facing, petBehaviorAimPoint(cursor));
  petBehaviorStepTimer = setTimeout(() => {
    if (!petBehaviorRunning || !petBehaviorCanRun()) { stopPetBehavior(false); return; }
    const current = screen.getCursorScreenPoint();
    if (!petCursorIsInScene(current) || Math.hypot(current.x - cursor.x, current.y - cursor.y) > 22) {
      stopPetBehavior(false);
      return;
    }
    performNextPetBehaviorAction();
  }, 420);
}

function schedulePetWander() {
  if (!windowPositioningAvailable) return;
  if (petBehaviorRunning) return;
  if (!petWindow || petWindow.isDestroyed() || !petWindow.isVisible() || !petMotion.wander || petMotion.reduceMotion || osPrefersReducedMotion() || petDragOffset || petEntranceMoving) return;
  if (petWanderPauseTimer || petWanderStepTimer || petWanderPlanning) return;
  const delay = Math.max(0, petWanderNextAt - Date.now()) || petWanderPlanner.nextRestSeconds() * 1000;
  petWanderPauseTimer = setTimeout(() => {
    petWanderPauseTimer = undefined;
    if (!petWindow || petWindow.isDestroyed() || !petWindow.isVisible() || !petMotion.wander || petMotion.reduceMotion || osPrefersReducedMotion() || petDragOffset || petEntranceMoving) return;
    startPetWander();
  }, delay);
}

function petDemoShelfTarget(area, grid, windows) {
  const taskbarDisplays = screen.getAllDisplays().filter((display) => {
    const { bounds, workArea } = display;
    return workArea.y === bounds.y && workArea.width > 0 && workArea.height > 0
      && bounds.y + bounds.height - (workArea.y + workArea.height) > 1;
  });
  const windowTargets = windows.filter((rect) => screen.getAllDisplays().some(({ workArea }) => {
    return rect.x < workArea.x + workArea.width && rect.x + rect.width > workArea.x
      && rect.y >= workArea.y && rect.y < workArea.y + workArea.height;
  }));
  const useWindow = windowTargets.length > 0 && (taskbarDisplays.length === 0 || Math.random() < 0.68);
  if (useWindow) {
    const rect = windowTargets[Math.floor(Math.random() * windowTargets.length)];
    const left = rect.x + 12;
    const right = Math.max(left, rect.x + rect.width - PET_WINDOW_WIDTH - 12);
    return grid.clampPetPosition({
      x: left + Math.random() * (right - left) - area.x,
      y: rect.y - PET_WINDOW_HEIGHT - area.y,
    });
  }
  if (taskbarDisplays.length === 0) return null;
  const display = taskbarDisplays[Math.floor(Math.random() * taskbarDisplays.length)];
  const left = display.workArea.x + 8;
  const right = Math.max(left, display.workArea.x + display.workArea.width - PET_WINDOW_WIDTH - 8);
  return grid.clampPetPosition({
    x: left + Math.random() * (right - left) - area.x,
    y: display.workArea.y + display.workArea.height - PET_WINDOW_HEIGHT - area.y,
  });
}

async function startPetWander() {
  if (petBehaviorRunning) return;
  if (!petWindow || petWindow.isDestroyed() || !petWindow.isVisible() || !petMotion.wander || petMotion.reduceMotion || osPrefersReducedMotion() || petDragOffset) return;
  const planSequence = ++petWanderPlanSequence;
  petWanderPlanning = true;
  const { area, bounds, grid, blocked, signature } = petWanderLayout();
  const relative = grid.clampPetPosition({ x: bounds.x - area.x, y: bounds.y - area.y });
  let demoTarget = null;
  if (petMotion.interactionDemo && process.platform === "win32") {
    let excludedHandle = "0";
    try { excludedHandle = petWindow.getNativeWindowHandle().readBigUInt64LE(0).toString(); } catch {}
    let visibleWindows = [];
    try { visibleWindows = await listVisibleWindows(excludedHandle); }
    catch { visibleWindows = []; }
    finally { petWanderPlanning = false; }
    if (planSequence !== petWanderPlanSequence || !petMotion.wander || !petMotion.interactionDemo || petDragOffset) return;
    demoTarget = petDemoShelfTarget(area, grid, visibleWindows);
  }
  petWanderPlanning = false;
  const plan = demoTarget
    ? petWanderPlanner.tryPlanWalkTo(grid.cellForPetPosition(relative), grid.cellForPetPosition(demoTarget), blocked)
    : petWanderPlanner.tryPlanWalk(grid.cellForPetPosition(relative), blocked);
  if (!plan.planned || plan.path.length === 0) {
    petWanderNextAt = Date.now() + petWanderPlanner.nextRestSeconds() * 1000;
    petWanderLayoutSignature = signature;
    schedulePetWander();
    return;
  }
  // Keep each walk smooth, then leave a longer idle interval before the next one.
  const waypoints = plan.path.map((cell) => grid.petPositionFor(cell));
  if (demoTarget && waypoints.length > 0) {
    const last = waypoints[waypoints.length - 1];
    if (Math.hypot(last.x - demoTarget.x, last.y - demoTarget.y) > 1) waypoints.push(demoTarget);
  }
  const walk = new PetWalk(relative, waypoints, 220);
  if (walk.length < 1) {
    petWanderNextAt = Date.now() + petWanderPlanner.nextRestSeconds() * 1000;
    schedulePetWander();
    return;
  }
  petWanderWalk = walk;
  petWanderStartedAt = Date.now();
  petWanderLayoutSignature = signature;
  setPetActivity("walk");
  movePetTowardTarget();
}

function movePetTowardTarget() {
  if (petBehaviorRunning) return;
  if (!petWindow || petWindow.isDestroyed() || !petWindow.isVisible() || !petWanderWalk || !petMotion.wander || petMotion.reduceMotion || osPrefersReducedMotion() || petDragOffset) {
    petWanderStepTimer = undefined;
    petWanderMoving = false;
    return;
  }
  const { area, grid, signature } = petWanderLayout();
  if (signature !== petWanderLayoutSignature) {
    petWanderWalk = null;
    petWanderStepTimer = undefined;
    petWanderMoving = false;
    petWanderNextAt = Date.now() + 250;
    schedulePetWander();
    return;
  }
  const elapsed = (Date.now() - petWanderStartedAt) / 1000;
  const position = grid.clampPetPosition(petWanderWalk.positionAt(elapsed));
  const screenX = area.x + position.x;
  const screenY = area.y + position.y;
  const targetX = Math.trunc(screenX);
  const targetY = Math.trunc(screenY);
  if (!Number.isSafeInteger(targetX) || !Number.isSafeInteger(targetY) || Math.abs(targetX) > 10_000_000 || Math.abs(targetY) > 10_000_000) {
    console.warn("[pet] Skipping wander step with invalid screen coordinates.");
    petWanderWalk = null;
    petWanderStepTimer = undefined;
    petWanderMoving = false;
    setPetActivity("idle");
    petWanderNextAt = Date.now() + 1000;
    schedulePetWander();
    return;
  }
  petWanderMoving = true;
  setPetActivity("walk", petWanderWalk.facingAt(elapsed) || petActivity.facing);
  try {
    petWindow.setPosition(targetX, targetY);
  } catch (error) {
    console.warn("[pet] Stopping wander after an invalid native window position.", { targetX, targetY, screenX, screenY, area }, error instanceof Error ? error.message : String(error));
    petWanderWalk = null;
    petWanderStepTimer = undefined;
    petWanderMoving = false;
    setPetActivity("idle");
    petWanderNextAt = Date.now() + 1000;
    schedulePetWander();
    return;
  }
  if (petWanderWalk.isFinished(elapsed)) {
    petWanderWalk = null;
    petWanderMoving = false;
    setPetActivity("idle");
    petWanderNextAt = Date.now() + petWanderPlanner.nextRestSeconds() * 1000;
    petWanderStepTimer = undefined;
    schedulePetWander();
    return;
  }
  petWanderStepTimer = setTimeout(movePetTowardTarget, 55);
}

function persistPetState() {
  if (!petWindow || petWindow.isDestroyed()) return;
  const state = readPetState();
  state.visible = petWindow.isVisible();
  // getBounds() reports 0,0 on native Wayland; keep the last real position.
  if (windowPositioningAvailable && !petEntranceMoving) state.bounds = petWindow.getBounds();
  void fs.mkdir(app.getPath("userData"), { recursive: true }).then(() => fs.writeFile(petStatePath(), JSON.stringify(state, null, 2), "utf8")).catch(() => {});
}

function movePetWithCursor() {
  if (!petWindow || petWindow.isDestroyed() || !petDragOffset) return;
  const cursor = screen.getCursorScreenPoint();
  const position = clampPetPosition({ x: cursor.x - petDragOffset.x, y: cursor.y - petDragOffset.y });
  const bounds = petWindow.getBounds();
  if (bounds.x !== position.x || bounds.y !== position.y) petWindow.setPosition(position.x, position.y);
}

function sendPetVisibility(visible) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("pet:visibility", visible);
}

function stopPetEntrance(restoreTarget = false) {
  if (petEntranceTimer) clearTimeout(petEntranceTimer);
  petEntranceTimer = undefined;
  petEntranceSequence += 1;
  if (restoreTarget && windowPositioningAvailable && petEntranceTargetBounds && petWindow && !petWindow.isDestroyed()) {
    try { petWindow.setPosition(petEntranceTargetBounds.x, petEntranceTargetBounds.y); } catch {}
  }
  petEntranceMoving = false;
  petEntranceWalk = null;
  petEntranceTargetBounds = null;
  if (!windowPositioningAvailable && petReady && petWindow && !petWindow.isDestroyed()) petWindow.webContents.send("pet:entrance", false);
  if (petActivity.state === "walk") setPetActivity("idle");
}

function finishPetEntrance(sequence) {
  if (sequence !== petEntranceSequence || !petWindow || petWindow.isDestroyed()) return;
  if (petEntranceTimer) clearTimeout(petEntranceTimer);
  petEntranceTimer = undefined;
  if (windowPositioningAvailable && petEntranceTargetBounds) {
    try { petWindow.setPosition(petEntranceTargetBounds.x, petEntranceTargetBounds.y); } catch {}
  }
  petEntranceMoving = false;
  petEntranceWalk = null;
  petEntranceTargetBounds = null;
  if (!windowPositioningAvailable && petReady) petWindow.webContents.send("pet:entrance", false);
  setPetActivity("idle");
  persistPetState();
  schedulePetWander();
  schedulePetBehaviorAttack();
}

function stepPetEntrance(sequence) {
  if (sequence !== petEntranceSequence || !petEntranceMoving || !petWindow || petWindow.isDestroyed() || !petWindow.isVisible()) return;
  if (windowPositioningAvailable && petEntranceWalk) {
    const elapsed = (Date.now() - petEntranceStartedAt) / 1000;
    const position = petEntranceWalk.positionAt(elapsed);
    try {
      petWindow.setPosition(Math.round(position.x), Math.round(position.y));
      const facing = petEntranceWalk.facingAt(elapsed);
      if (facing) setPetActivity("walk", facing);
    } catch {
      finishPetEntrance(sequence);
      return;
    }
    if (petEntranceWalk.isFinished(elapsed)) {
      finishPetEntrance(sequence);
      return;
    }
  }
  petEntranceTimer = setTimeout(() => stepPetEntrance(sequence), 32);
}

function startPetEntrance() {
  if (!petWindow || petWindow.isDestroyed() || petWindow.isVisible() || !petReady || petMotion.reduceMotion || osPrefersReducedMotion()) return false;
  const sequence = ++petEntranceSequence;
  petEntranceMoving = true;
  if (!windowPositioningAvailable) {
    const facing = Math.random() < 0.5 ? 1 : -1;
    setPetActivity("walk", facing);
    petWindow.webContents.send("pet:entrance", true);
    petWindow.showInactive();
    petEntranceTimer = setTimeout(() => finishPetEntrance(sequence), 1450);
    return true;
  }

  const bounds = petWindow.getBounds();
  const workArea = screen.getDisplayMatching(bounds).workArea;
  const target = clampPetPosition({ x: bounds.x, y: bounds.y });
  const fromLeft = target.x + PET_WINDOW_WIDTH / 2 < workArea.x + workArea.width / 2;
  const start = {
    x: fromLeft ? workArea.x - PET_WINDOW_WIDTH + 30 : workArea.x + workArea.width - 30,
    y: target.y,
  };
  petEntranceTargetBounds = { ...bounds, x: target.x, y: target.y };
  petEntranceWalk = new PetWalk(start, [target], 520);
  petEntranceStartedAt = Date.now();
  setPetActivity("walk", fromLeft ? 1 : -1);
  try { petWindow.setPosition(start.x, start.y); } catch { stopPetEntrance(false); return false; }
  petWindow.showInactive();
  stepPetEntrance(sequence);
  return true;
}

function setPetVisible(visible) {
  if (!petWindow || petWindow.isDestroyed()) return;
  if (visible) {
    const wasVisible = petWindow.isVisible();
    const entering = !wasVisible && startPetEntrance();
    if (!wasVisible && !entering) petWindow.showInactive();
    if (!entering) {
      schedulePetWander();
      schedulePetBehaviorAttack();
    }
  } else {
    stopPetEntrance(true);
    stopPetBehavior(true);
    stopPetWander();
    petWindow.hide();
  }
  if (visible && petReady) flushPetMessages();
  persistPetState();
  sendPetVisibility(visible);
  void refreshTrayMenu();
}

function flushPetMessages() {
  if (!petWindow || petWindow.isDestroyed() || !petReady || !petWindow.isVisible()) return;
  for (const event of pendingPetMessages.splice(0)) petWindow.webContents.send("pet:message", event);
}

function sendPetMessage(text, kind = "success") {
  if (!petWindow || petWindow.isDestroyed()) return;
  const event = { text, kind, at: Date.now() };
  if (!petReady) {
    pendingPetMessages.push(event);
    while (pendingPetMessages.length > 3) pendingPetMessages.shift();
    return;
  }
  if (!petWindow.isVisible()) {
    pendingPetMessages.push(event);
    while (pendingPetMessages.length > 3) pendingPetMessages.shift();
    return;
  }
  petWindow.webContents.send("pet:message", event);
}

function petTaskLabel(method) {
  const labels = {
    "chat.complete": "The local reply",
    "project.save": "The local project save",
    "project.file.write": "The reviewed file save",
    "project.file.undo": "The file restore",
    "project.command.run": "The local project command",
    "tasks.plan": "The local task plan",
    "tasks.queue": "The local task queue",
    "tasks.execute": "The local task execution",
    "tasks.retry": "The local task retry",
    "tasks.cancel": "The local task stop",
    "scheduled.create": "The local schedule",
    "scheduled.pause": "The scheduled task pause",
    "scheduled.resume": "The scheduled task resume",
    "scheduled.cancel": "The scheduled task cancellation",
    "scheduled.runNow": "The scheduled task run",
    "memory.save": "The approved memory note",
    "image.generate": "The local image workflow",
  };
  return labels[method] ?? null;
}

function petCompletionText(method, response) {
  const task = petTaskLabel(method);
  if (!task) return null;
  if (!response?.ok) return { text: `${task} needs attention. Open Skai for details.`, kind: "error" };
  const messages = {
    "chat.complete": "Finished your local reply.",
    "project.save": "Saved the local project.",
    "project.file.write": "Saved the reviewed file.",
    "project.file.undo": "Restored the previous file version.",
    "project.command.run": "Finished the local project command.",
    "tasks.plan": "Created a local task plan.",
    "tasks.queue": "Queued the local task.",
    "tasks.execute": "Started the local task execution.",
    "tasks.retry": "Retried the local task.",
    "tasks.cancel": "Stopped the local task.",
    "scheduled.create": "Scheduled the local task for review.",
    "scheduled.pause": "Paused the local scheduled task.",
    "scheduled.resume": "Resumed the local scheduled task.",
    "scheduled.cancel": "Canceled the scheduled local task.",
    "scheduled.runNow": "Marked the local scheduled task due.",
    "memory.save": "Saved the approved memory note.",
    "image.generate": "Finished the local image workflow.",
  };
  const text = messages[method];
  return text ? { text, kind: "success" } : null;
}

// X11 sessions without a compositor (plain i3/bspwm/Openbox) cannot show transparent
// windows; Percy would be a black box there, so it gets an opaque card instead.
let petOpaque = false;
async function resolvePetSurface() {
  if (process.platform !== "linux" || displayBackend.backend !== "x11" || isWaylandSession(process.env)) return;
  const composited = await x11HasCompositor();
  petOpaque = composited === false;
  if (petOpaque) console.log("[windowing] no X11 compositor detected; Percy uses an opaque window.");
}

function createPetWindow() {
  if (petWindow && !petWindow.isDestroyed()) return petWindow;
  const savedState = readPetState();
  petReady = false;
  petWindow = new BrowserWindow({
    // Native Wayland ignores client-chosen positions; let the compositor place it.
    ...(windowPositioningAvailable ? petBounds() : { width: PET_WINDOW_WIDTH, height: PET_WINDOW_HEIGHT }),
    // _NET_WM_WINDOW_TYPE_TOOLBAR makes tiling X11 window managers (i3, bspwm,
    // awesome, and Hyprland/Sway for XWayland clients) float Percy instead of
    // tiling it into the layout.
    ...(process.platform === "linux" ? { type: "toolbar" } : {}),
    title: "Skai Desktop · Pets",
    transparent: !petOpaque,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    closable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: petOpaque ? "#10141d" : "#00000000",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Percy is an unfocused companion; without this Chromium throttles or pauses its sprite
      // animation whenever another window has focus or the OS reports it occluded (Windows).
      backgroundThrottling: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  petWindow.setAlwaysOnTop(true, "floating");
  petWindow.on("moved", () => { if (!petWanderMoving && !petEntranceMoving) persistPetState(); });
  petWindow.webContents.on("did-finish-load", () => {
    petReady = true;
    petWindow.webContents.send("pet:activity", petActivity);
    flushPetMessages();
    schedulePetBehaviorAttack();
  });
  // Window managers can close Percy directly (Hyprland/i3 close-window keybinds
  // ignore `closable: false`). Treat that as "hide Percy" so the tray and
  // Settings can bring it back, instead of destroying the window for the session.
  petWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    setPetVisible(false);
  });
  petWindow.on("closed", () => { petReady = false; stopPetDrag(); petWindow = undefined; });
  if (typeof petWindow.setVisibleOnAllWorkspaces === "function") {
    petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  // On native Wayland, dragging is handed to the compositor (app-region drag →
  // xdg_toplevel.move) because the app can neither read nor set its position.
  const petQuery = { pet: "1", ...(process.env.SKAI_RIG_PET === "1" ? { rig: "1" } : {}), ...(windowPositioningAvailable ? {} : { drag: "compositor" }), ...(petOpaque ? { surface: "opaque" } : {}) };
  const devUrl = process.env.SKAI_DESKTOP_RENDERER_URL;
  if (devUrl) {
    const url = new URL(devUrl);
    for (const [key, value] of Object.entries(petQuery)) url.searchParams.set(key, value);
    void petWindow.loadURL(url.toString());
  } else {
    void petWindow.loadFile(path.join(rendererRoot, "dist", "index.html"), { query: petQuery });
  }
  petWindow.once("ready-to-show", () => {
    if (savedState.visible !== false) {
      const entering = startPetEntrance();
      if (!entering) {
        petWindow?.showInactive();
        schedulePetWander();
        schedulePetBehaviorAttack();
        persistPetState();
      }
    } else persistPetState();
  });
  return petWindow;
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function registerGlobalLauncher() {
  const registered = globalShortcut.register(globalLauncherAccelerator, () => {
    showMainWindow();
    sendTrayEvent("launcher:focus");
  });
  if (!registered) console.warn(`[windowing] Could not register the global launcher shortcut ${globalLauncherAccelerator}.`);
}

function sendTrayEvent(eventName, value) {
  showMainWindow();
  const send = () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(eventName, value);
  };
  if (mainWindow?.webContents.isLoading()) mainWindow.webContents.once("did-finish-load", send);
  else setTimeout(send, 0);
}

function resolveTrayIconPath() {
  const direct = resolveAppIconPath();
  if (direct && fsSync.existsSync(direct)) return direct;
  const distAssets = path.join(rendererRoot, "dist", "assets");
  try {
    const file = fsSync.readdirSync(distAssets).find((candidate) => candidate.startsWith("skaiwolficon") && candidate.endsWith(".png"));
    return file ? path.join(distAssets, file) : null;
  } catch {
    return null;
  }
}

function resolveAppIconPath() {
  const direct = path.join(runtimeRoot, "assets", "branding", "skaiwolficon.png");
  if (fsSync.existsSync(direct)) return direct;
  const packaged = path.join(rendererRoot, "dist", "assets");
  try {
    const file = fsSync.readdirSync(packaged).find((candidate) => candidate.startsWith("skaiwolficon") && candidate.endsWith(".png"));
    return file ? path.join(packaged, file) : null;
  } catch {
    return null;
  }
}

function recentConversationMenuItems(conversations) {
  if (!conversations.length) return [{ label: "No recent chats", enabled: false }];
  return conversations.slice(0, 8).map((conversation) => {
    const title = String(conversation.title || "Untitled chat").replace(/\s+/g, " ").trim().slice(0, 72) || "Untitled chat";
    const project = conversation.projectName ? ` · ${String(conversation.projectName).slice(0, 28)}` : "";
    return { label: `${title}${project}`, click: () => sendTrayEvent("tray:open-conversation", String(conversation.id)) };
  });
}

function setTrayMenu(conversations = []) {
  if (!tray || tray.isDestroyed()) return;
  const petVisible = Boolean(petWindow && !petWindow.isDestroyed() && petWindow.isVisible());
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show Skai Desktop", click: showMainWindow },
    { label: "New chat", click: () => sendTrayEvent("tray:new-chat") },
    { type: "separator" },
    { label: "Recent chats", submenu: recentConversationMenuItems(conversations) },
    { type: "separator" },
    { label: petVisible ? "Hide all pets" : "Show all pets", click: () => setPetVisible(!petVisible) },
    { type: "separator" },
    { label: "Quit Skai Desktop", click: () => app.quit() },
  ]));
}

async function refreshTrayMenu(popUp = false) {
  if (!tray || tray.isDestroyed()) return;
  const sequence = ++trayRefreshSequence;
  const response = await requestAgent("conversations.list", { includeArchived: false });
  if (sequence !== trayRefreshSequence || !tray || tray.isDestroyed()) return;
  const conversations = response.ok && Array.isArray(response.result) ? response.result : [];
  setTrayMenu(conversations);
  if (popUp && !isQuitting) tray.popUpContextMenu();
}

function createTray() {
  if (tray && !tray.isDestroyed()) return tray;
  const iconPath = resolveTrayIconPath();
  const source = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  tray = new Tray(process.platform === "win32" ? source.resize({ width: 16, height: 16 }) : source);
  tray.setToolTip("Skai Desktop");
  setTrayMenu();
  tray.on("click", showMainWindow);
  tray.on("right-click", () => { void refreshTrayMenu(true); });
  tray.on("double-click", showMainWindow);
  void refreshTrayMenu();
  return tray;
}

function parseReleaseVersion(value) {
  const match = String(value ?? "").replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function isNewerRelease(candidate, current) {
  const next = parseReleaseVersion(candidate);
  const installed = parseReleaseVersion(current);
  if (!next || !installed) return false;
  for (let index = 0; index < next.length; index += 1) {
    if (next[index] !== installed[index]) return next[index] > installed[index];
  }
  return false;
}

function updateAssetForPlatform(assets = []) {
  const name = process.platform === "win32" ? "win-x64.zip" : process.platform === "linux" ? "linux-x64.tar.gz" : null;
  if (!name) return null;
  return assets.find((asset) => String(asset?.name ?? "").toLowerCase().endsWith(name)) ?? null;
}

async function checkForUpdates() {
  const currentVersion = app.getVersion();
  const releaseUrl = `https://github.com/${UPDATE_REPOSITORY}/releases/latest`;
  try {
    const response = await fetch(`https://api.github.com/repos/${UPDATE_REPOSITORY}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Skai-Desktop-Update-Checker" },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 404) return { available: false, currentVersion, channel: "stable", releaseUrl, checkedAt: new Date().toISOString(), message: "No stable release has been published yet." };
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}.`);
    const release = await response.json();
    const version = String(release.tag_name ?? "");
    const asset = updateAssetForPlatform(release.assets);
    const available = isNewerRelease(version, currentVersion);
    return {
      available,
      currentVersion,
      version: version.replace(/^v/i, ""),
      channel: release.prerelease ? "preview" : "stable",
      releaseUrl: String(release.html_url || releaseUrl),
      downloadUrl: asset?.browser_download_url ?? String(release.html_url || releaseUrl),
      assetName: asset?.name ?? null,
      publishedAt: release.published_at ?? null,
      checkedAt: new Date().toISOString(),
      message: available ? `Skai Desktop ${version} is ready.` : "You are running the latest stable version.",
    };
  } catch (error) {
    return { available: false, currentVersion, channel: "stable", releaseUrl, checkedAt: new Date().toISOString(), error: error instanceof Error ? error.message : "Update check failed.", message: "Update check could not reach GitHub." };
  }
}

function scheduleUpdateCheck() {
  if (updateCheckTimer) clearInterval(updateCheckTimer);
  void checkForUpdates().then((result) => {
    if (result.available && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("updates:available", result);
  });
  updateCheckTimer = setInterval(() => {
    void checkForUpdates().then((result) => {
      if (result.available && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("updates:available", result);
    });
  }, UPDATE_CHECK_INTERVAL_MS);
}

const allowedMethods = new Set([
  "runtime.health", "models.list", "models.pull.start", "models.pull.status", "models.pull.cancel", "projects.list", "project.save", "project.files", "project.file.read", "project.preview.read", "tasks.list",
  "scheduled.list", "scheduled.create", "scheduled.pause", "scheduled.resume", "scheduled.cancel", "scheduled.runNow", "tasks.plan", "tasks.queue", "tasks.execute", "tasks.cancel", "tasks.retry", "project.terminal.start", "project.terminal.read", "project.terminal.write", "project.terminal.close", "project.git.status", "project.git.diff", "project.git.commit", "project.git.push", "project.git.pullRequest", "conversations.list", "conversations.search", "conversation.save", "conversation.metadata.save", "conversations.export", "conversation.fork", "memory.list", "memory.search", "memory.save", "memory.remove", "memory.enabled", "memory.export", "settings.get",
  "settings.save", "image.generate", "image.models.list", "image.runtime.status", "image.runtime.install.start", "image.runtime.install.status", "image.runtime.install.cancel", "pet.background.remove", "project.file.write", "project.file.undo", "project.command.run", "chat.queue.list", "chat.queue.enqueue", "chat.queue.remove", "chat.complete", "skills.list", "skills.read", "mcp.connections.list", "mcp.connection.connect", "mcp.connection.disconnect", "mcp.connection.revoke", "mcp.tools.list", "mcp.marketplace.download", "mcp.tool.call", "workspace.attachment.extract", "voice.models", "voice.speak", "voice.stop", "voice.status", "marketplace.catalog", "plugins.directory", "plugins.download", "marketplace.image-assets.search", "marketplace.image-assets.list", "marketplace.image-assets.install", "marketplace.image-assets.remove", "marketplace.models.search", "marketplace.models.install.start", "marketplace.models.install.status", "marketplace.models.install.cancel", "system.capacity", "airllm.status", "airllm.install.start", "airllm.install.status", "airllm.install.cancel", "corpus.list", "corpus.upsert", "corpus.remove",
  "workspace.pickFolder",
]);

function startAgentHost() {
  const command = packagedRuntime ? packagedHost : "dotnet";
  const args = packagedRuntime ? ["--stdio"] : ["run", "--project", hostProject, "--no-launch-profile", "--", "--stdio"];
  host = spawn(command, args, {
    cwd: packagedRuntime ? path.dirname(packagedHost) : repoRoot,
    // Launcher-started Linux sessions lack ~/.bashrc PATH additions (nvm, pyenv, ~/.local/bin).
    env: { ...process.env, PATH: augmentUserPath(), SKAI_PLUGIN_DOWNLOADS: path.join(app.getPath("downloads"), "Skai Plugins") },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const startedHost = host;

  // A dead host can close stdin between the destroyed check and write().
  // Writable emits EPIPE asynchronously, so a surrounding try/catch alone does
  // not protect Electron's main process from an uncaught pipe error.
  host.stdin.on("error", () => {
    const response = { v: 1, ok: false, error: { code: "HOST_WRITE_FAILED", message: "The local agent host closed its request pipe." } };
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      const completion = petCompletionText(entry.method, response);
      if (completion) sendPetMessage(completion.text, completion.kind);
      entry.resolve(response);
    }
    pending.clear();
  });

  hostReader = readline.createInterface({ input: host.stdout });
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

  host.stderr.on("data", (chunk) => {
    console.error(`[agent-host] ${chunk.toString().trimEnd()}`);
  });

  host.on("exit", (code, signal) => {
    const error = { v: 1, ok: false, error: { code: "HOST_EXITED", message: `Agent host exited (${code ?? signal}).` } };
    hostReader?.close();
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      const completion = petCompletionText(entry.method, error);
      if (completion) sendPetMessage(completion.text, completion.kind);
      entry.resolve(error);
    }
    pending.clear();
    if (host === startedHost) host = undefined;
  });
}

function stopAgentHost(onStopped) {
  if (!host) {
    onStopped?.();
    return;
  }
  const currentHost = host;
  host = undefined;
  const error = { v: 1, ok: false, error: { code: "HOST_STOPPED", message: "Agent host is shutting down." } };
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.resolve(error);
  }
  pending.clear();
  if (!currentHost.stdin.destroyed) currentHost.stdin.end();
  const forceStop = setTimeout(() => {
    if (currentHost.exitCode !== null) return;
    if (process.platform === "win32" && currentHost.pid) {
      const killer = spawn("taskkill", ["/pid", String(currentHost.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      killer.on("error", () => { if (!currentHost.killed) currentHost.kill(); });
    } else if (!currentHost.killed) currentHost.kill("SIGTERM");
  }, 1500);
  currentHost.once("exit", () => {
    clearTimeout(forceStop);
    onStopped?.();
  });
}

function restartAgentHost() {
  stopAgentHost(() => {
    if (!isQuitting) startAgentHost();
  });
}

function requestAgent(method, params) {
  if (typeof method !== "string" || !allowedMethods.has(method)) {
    return Promise.resolve({ v: 1, ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "That desktop operation is not exposed by the renderer bridge." } });
  }
  if (params !== undefined && (params === null || typeof params !== "object" || Array.isArray(params))) {
    return Promise.resolve({ v: 1, ok: false, error: { code: "INVALID_PARAMS", message: "Agent parameters must be an object." } });
  }
  if (!host || host.stdin.destroyed) {
    const response = { v: 1, ok: false, error: { code: "HOST_UNAVAILABLE", message: "Agent host is not running." } };
    const completion = petCompletionText(method, response);
    if (completion) sendPetMessage(completion.text, completion.kind);
    return Promise.resolve(response);
  }
  const id = `desktop-${nextRequestId++}`;
  const requestParams = method === "chat.complete"
    ? { ...params, timeoutSeconds: chatHostDeadlineSeconds }
    : params;
  return new Promise((resolve) => {
    const timeoutMs = method === "chat.complete"
      ? chatRequestTimeoutMs
      : method === "image.generate" || method === "pet.background.remove"
        ? imageGenerationRequestTimeoutMs
        : standardRequestTimeoutMs;
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      const response = { v: 1, ok: false, error: { code: "HOST_TIMEOUT", message: `The local agent host did not answer ${method} within the allowed time.` } };
      const completion = petCompletionText(method, response);
      if (completion) sendPetMessage(completion.text, completion.kind);
      resolve(response);
      restartAgentHost();
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    autoHideMenuBar: true,
    ...(process.platform === "win32" ? {
      titleBarStyle: "hidden",
      titleBarOverlay: { color: "#10141d", symbolColor: "#aab0bf", height: 48 },
    } : {}),
    backgroundColor: "#10141d",
    icon: resolveAppIconPath() || undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  mainWindow.setMenuBarVisibility(false);

  const devUrl = process.env.SKAI_DESKTOP_RENDERER_URL;
  if (devUrl) mainWindow.loadURL(devUrl);
  else mainWindow.loadFile(path.join(rendererRoot, "dist", "index.html"));
  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    void handleMainWindowClose();
  });
  mainWindow.on("closed", () => { mainWindow = undefined; closePromptOpen = false; });
  // A reload or renderer crash drops any open close prompt; let the next close ask again.
  mainWindow.webContents.on("did-start-loading", () => { closePromptOpen = false; });
  mainWindow.webContents.on("render-process-gone", () => { closePromptOpen = false; });
}

// --- Closing the main window -------------------------------------------------
// Windows/macOS: closing hides Skai to the tray. Linux: window managers close
// windows from keybindings (Hyprland/Sway/i3 "close window"), where silently
// vanishing to a tray reads as a full quit, so Skai asks "Fully close" or "Run
// in background" (remembered on request, changeable in Settings → General).
const CLOSE_BEHAVIORS = new Set(["ask", "background", "quit"]);
let closePromptOpen = false;

function windowBehaviorPath() {
  return path.join(app.getPath("userData"), "window-behavior.json");
}

function readCloseBehavior() {
  try {
    const value = JSON.parse(fsSync.readFileSync(windowBehaviorPath(), "utf8"))?.closeBehavior;
    if (CLOSE_BEHAVIORS.has(value)) return value;
  } catch { /* first run or unreadable: fall through to the default */ }
  return process.platform === "linux" ? "ask" : "background";
}

function writeCloseBehavior(value) {
  if (!CLOSE_BEHAVIORS.has(value)) return readCloseBehavior();
  fsSync.mkdirSync(app.getPath("userData"), { recursive: true });
  fsSync.writeFileSync(windowBehaviorPath(), JSON.stringify({ closeBehavior: value }, null, 2), "utf8");
  return value;
}

function runMainWindowInBackground() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.hide();
  void refreshTrayMenu();
}

async function handleMainWindowClose() {
  // Probe on every close because panels such as Waybar can start or restart at any time.
  const trayAvailable = isTrayLikelyVisible({ statusNotifierHost: await hasStatusNotifierHost() });
  if (isQuitting || !mainWindow || mainWindow.isDestroyed()) return;
  if (process.platform !== "linux") {
    if (trayAvailable) runMainWindowInBackground();
    else app.quit();
    return;
  }
  const behavior = readCloseBehavior();
  if (behavior === "quit") { app.quit(); return; }
  if (behavior === "background") { runMainWindowInBackground(); return; }
  if (closePromptOpen) return;
  closePromptOpen = true;
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
  const contents = mainWindow.webContents;
  if (contents.isLoading() || contents.isCrashed()) {
    // The renderer cannot show its prompt; fall back to a native dialog.
    await askCloseWithNativeDialog(trayAvailable);
    return;
  }
  contents.send("window:close-requested", { trayAvailable });
}

async function askCloseWithNativeDialog(trayAvailable) {
  const result = await dialog.showMessageBox(mainWindow, {
    type: "question",
    buttons: ["Run in background", "Fully close", "Cancel"],
    defaultId: 0,
    cancelId: 2,
    title: "Close Skai Desktop",
    message: "Keep Skai running in the background?",
    detail: trayAvailable
      ? "Skai stays in your system tray with desktop pets and the local agent host. Use the tray icon to reopen it or quit."
      : "No system tray was found. Skai keeps running; launch it again from your app launcher to reopen the window.",
    checkboxLabel: "Remember my choice",
  });
  applyCloseChoice(["background", "quit", "cancel"][result.response] ?? "cancel", result.checkboxChecked);
}

function applyCloseChoice(choice, remember) {
  closePromptOpen = false;
  if (choice !== "background" && choice !== "quit") return;
  if (remember) writeCloseBehavior(choice);
  if (choice === "quit") app.quit();
  else runMainWindowInBackground();
}

function applyProductionContentSecurityPolicy() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: http://127.0.0.1:8188 http://localhost:8188; media-src 'self' file:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        ],
      },
    });
  });
}

app.whenReady().then(() => {
  if (relaunchingForDisplayBackend || !hasSingleInstanceLock) return;
  Menu.setApplicationMenu(null);
  startAgentHost();
  const localMedia = new Map();
  ipcMain.handle("media:create-local-url", (event, payload) => {
    const mediaTypes = ["video/mp4", "video/webm", "audio/mp4", "audio/webm", "audio/mpeg", "audio/wav", "audio/ogg"];
    if (!payload || !mediaTypes.includes(payload.mediaType) || typeof payload.content !== "string" || payload.content.length > 28_000_000 || payload.content.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload.content))
      throw new Error("The local media payload is invalid or too large.");
    const bytes = Buffer.from(payload.content, "base64");
    const validSignature = payload.mediaType === "video/mp4" ? isMp4(bytes) : payload.mediaType === "video/webm" ? isWebm(bytes) : isAudioSignature(bytes, payload.mediaType);
    if (!bytes.length || bytes.length > 20 * 1024 * 1024 || !validSignature)
      throw new Error("The local media payload failed its size or signature check.");
    const extension = { "video/mp4": ".mp4", "video/webm": ".webm", "audio/mp4": ".m4a", "audio/webm": ".webm", "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/ogg": ".ogg" }[payload.mediaType];
    const directory = path.join(app.getPath("userData"), "media-samples");
    fsSync.mkdirSync(directory, { recursive: true });
    const filePath = path.join(directory, `${randomUUID()}${extension}`);
    fsSync.writeFileSync(filePath, bytes, { mode: 0o600, flag: "wx" });
    const url = pathToFileURL(filePath).href;
    localMedia.set(url, { filePath, webContentsId: event.sender.id });
    return url;
  });
  ipcMain.handle("media:revoke-local-url", (event, url) => {
    try {
      const entry = localMedia.get(String(url));
      if (entry?.webContentsId === event.sender.id) {
        localMedia.delete(String(url));
        void fs.unlink(entry.filePath).catch(() => {});
      }
    } catch { /* Ignore malformed cleanup requests. */ }
    return true;
  });
  if (!process.env.SKAI_DESKTOP_RENDERER_URL) applyProductionContentSecurityPolicy();
  // Theme: user theme files and picks (<userData>/themes, appearance.json), watched for live reload.
  const themeService = createThemeService({ userDataPath: app.getPath("userData"), getWindow: () => mainWindow, shell, dialog });
  themeService.start();
  ipcMain.handle("agent:request", async (event, method, params) => {
    if (method === "appearance.getThemes" || method === "appearance.saveThemeSelection" || method === "appearance.openThemesFolder" || method === "appearance.editTheme" || method === "appearance.duplicateTheme" || method === "appearance.importBase16" || method === "appearance.exportTheme" || method === "appearance.saveFonts" || method === "appearance.listFonts" || method === "appearance.readCustomFont" || method === "appearance.openFontsFolder") return themeService.handle(method, params);
    // Theme: follow the app's Light/Dark/System choice instead of the OS, so native
    // pieces (select popups, scrollbars, file dialogs, tray menu, window frame) match.
    if (method === "appearance.setNativeTheme") {
      const mode = params?.mode;
      if (mode !== "light" && mode !== "dark" && mode !== "system") return { v: 1, ok: false, error: { code: "INVALID_PARAMS", message: "Theme mode must be light, dark, or system." } };
      nativeTheme.themeSource = mode;
      return { v: 1, ok: true, result: { mode, dark: nativeTheme.shouldUseDarkColors } };
    }
    if (method === "workspace.pickFolder") {
      const window = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showOpenDialog(window, { properties: ["openDirectory"] });
      return { v: 1, ok: true, result: { path: result.canceled ? null : result.filePaths[0] ?? null } };
    }
    if (method === "workspace.pickFiles") {
      const window = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showOpenDialog(window, { properties: ["openFile", "multiSelections"], filters: [{ name: "Chat files", extensions: ["txt", "md", "markdown", "csv", "json", "xml", "yaml", "yml", "toml", "html", "css", "js", "ts", "jsx", "tsx", "cs", "py", "java", "go", "rs", "c", "h", "cpp", "hpp", "sh", "sql", "log", "pdf", "png", "jpg", "jpeg", "mp4", "webm"] }] });
      if (result.canceled) return { v: 1, ok: true, result: { attachments: [] } };
      const attachments = [];
      let textCharacters = 0;
      let imageBytes = 0;
      let videoBytes = 0;
      for (const filePath of result.filePaths.slice(0, 5)) {
        const fileName = path.basename(filePath);
        const extension = path.extname(fileName).toLowerCase();
        if (isBlockedAttachmentName(fileName)) throw new Error(`That file name cannot be attached: ${fileName}`);
        const imageType = extension === ".png" ? "image/png" : [".jpg", ".jpeg"].includes(extension) ? "image/jpeg" : null;
        const isPdf = extension === ".pdf";
        const videoType = extension === ".mp4" ? "video/mp4" : extension === ".webm" ? "video/webm" : null;
        if (!imageType && !isPdf && !videoType && !attachmentTextExtensions.has(extension)) throw new Error(`That file type cannot be attached: ${fileName}`);
        const bytes = await fs.readFile(filePath);
        if (bytes.length > (isPdf || videoType ? 20 * 1024 * 1024 : 2 * 1024 * 1024)) throw new Error(`The selected file is too large: ${fileName}`);
        if (imageType) {
          if (!(imageType === "image/png" ? isPng(bytes) : isJpeg(bytes))) throw new Error(`The selected image is not valid: ${fileName}`);
          imageBytes += bytes.length;
          if (imageBytes > 6 * 1024 * 1024) throw new Error("Selected images exceed the combined size limit.");
          attachments.push({ fileName, mediaType: imageType, content: bytes.toString("base64") });
        } else if (isPdf) {
          attachments.push({ fileName, mediaType: null, content: bytes.toString("base64") });
        } else if (videoType) {
          if (!(videoType === "video/mp4" ? isMp4(bytes) : isWebm(bytes))) throw new Error(`The selected video is not a valid ${videoType} file: ${fileName}`);
          videoBytes += bytes.length;
          if (videoBytes > 40 * 1024 * 1024) throw new Error("Selected videos exceed the combined 40 MB limit.");
          attachments.push({ fileName, mediaType: videoType, content: bytes.toString("base64") });
        } else {
          const content = bytes.toString("utf8").slice(0, 16000);
          textCharacters += content.length;
          if (textCharacters > 48_000) throw new Error("Selected text files exceed the combined character limit.");
          attachments.push({ fileName, mediaType: null, content });
        }
      }
      return { v: 1, ok: true, result: { attachments } };
    }
    if (method === "workspace.importDroppedFiles") {
      if (!params || !Array.isArray(params.attachments)) throw new Error("Dropped attachments were not provided.");
      const attachments = [];
      let textCharacters = 0;
      let imageBytes = 0;
      for (const candidate of params.attachments.slice(0, 5)) {
        const attachment = decodeDroppedAttachment(candidate);
        textCharacters += attachment.textLength;
        imageBytes += attachment.mediaType ? attachment.byteLength : 0;
        if (textCharacters > 48_000) throw new Error("Dropped text files exceed the combined character limit.");
        if (imageBytes > 6 * 1024 * 1024) throw new Error("Dropped images exceed the combined size limit.");
        const { byteLength, textLength, ...safeAttachment } = attachment;
        attachments.push(safeAttachment);
      }
      return { v: 1, ok: true, result: { attachments } };
    }
    return requestAgent(method, params);
  });
  ipcMain.on("window:close-choice", (event, response) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || !closePromptOpen) return;
    const choice = response?.choice;
    applyCloseChoice(choice === "background" || choice === "quit" ? choice : "cancel", Boolean(response?.remember));
  });
  ipcMain.handle("window:get-close-behavior", (event) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return "background";
    return readCloseBehavior();
  });
  ipcMain.handle("window:set-close-behavior", (event, behavior) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return readCloseBehavior();
    return writeCloseBehavior(behavior);
  });
  ipcMain.handle("updates:check", async (event) => {
    if (!BrowserWindow.fromWebContents(event.sender)) return { available: false, message: "Update checks are unavailable." };
    return checkForUpdates();
  });
  ipcMain.handle("updates:open", async (event, url) => {
    if (!BrowserWindow.fromWebContents(event.sender) || typeof url !== "string") return false;
    let parsed;
    try { parsed = new URL(url); } catch { return false; }
    if (parsed.protocol !== "https:" || !["github.com", "huggingface.co"].includes(parsed.hostname)) return false;
    await shell.openExternal(parsed.toString());
    return true;
  });
  ipcMain.handle("plugins:open-downloads", async (event) => {
    if (!BrowserWindow.fromWebContents(event.sender)) return false;
    const downloadsPath = path.join(app.getPath("downloads"), "Skai Plugins");
    await fs.mkdir(downloadsPath, { recursive: true });
    return !(await shell.openPath(downloadsPath));
  });
  ipcMain.on("pet:set-visible", (event, visible) => {
    if (BrowserWindow.fromWebContents(event.sender)) setPetVisible(Boolean(visible));
  });
  ipcMain.on("pet:set-motion", (event, settings) => {
    if (!BrowserWindow.fromWebContents(event.sender) || !settings || typeof settings !== "object") return;
    petMotion = {
      wander: Boolean(settings.wander),
      reduceMotion: Boolean(settings.reduceMotion),
      interactionDemo: process.platform === "win32" && Boolean(settings.interactionDemo),
    };
    if (petMotion.reduceMotion || osPrefersReducedMotion()) {
      stopPetEntrance(true);
      stopPetBehavior(true);
    }
    stopPetWander();
    petWindow?.webContents.send("pet:motion", petMotion);
    schedulePetWander();
    schedulePetBehaviorAttack();
  });
  ipcMain.on("pet:set-behavior", (event, settings) => {
    if (BrowserWindow.fromWebContents(event.sender) !== petWindow) return;
    stopPetBehavior(true);
    if (petBehaviorPauseTimer) clearTimeout(petBehaviorPauseTimer);
    petBehaviorPauseTimer = undefined;
    petBehaviorSettings = normalizePetBehaviorSettings(settings);
    schedulePetBehaviorAttack();
  });
  ipcMain.on("pet:set-state", (event, state) => {
    if (!BrowserWindow.fromWebContents(event.sender)) return;
    const allowedStates = new Set(["idle", "thinking", "coding", "coding_malicious", "stuck", "needs-attention"]);
    if (typeof state !== "string" || !allowedStates.has(state)) return;
    // Workspace activity is a higher-level source than a demo attack. If work
    // starts, cancel the attack cleanly; an idle update must never interrupt an
    // attack that is already in progress.
    if (petBehaviorRunning && state === "idle") return;
    if (petBehaviorRunning) stopPetBehavior(true);
    if (state === "idle" && petEntranceMoving) return;
    if (state === "idle") { schedulePetWander(); schedulePetBehaviorAttack(); }
    else { stopPetBehavior(true); stopPetWander(); }
    setPetActivity(state);
  });
  ipcMain.on("pet:drag-start", (event, point) => {
    if (!windowPositioningAvailable || BrowserWindow.fromWebContents(event.sender) !== petWindow || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    stopPetBehavior(false);
    stopPetWander();
    stopPetDrag();
    const bounds = petWindow.getBounds();
    petDragOffset = { x: point.x - bounds.x, y: point.y - bounds.y };
    petDragTimer = setInterval(movePetWithCursor, 16);
  });
  ipcMain.on("pet:drag-move", (event, point) => {
    if (BrowserWindow.fromWebContents(event.sender) !== petWindow || !petDragOffset || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    const position = clampPetPosition({ x: point.x - petDragOffset.x, y: point.y - petDragOffset.y });
    petWindow.setPosition(position.x, position.y);
  });
  ipcMain.on("pet:drag-end", (event) => {
    if (BrowserWindow.fromWebContents(event.sender) !== petWindow) return;
    stopPetDrag();
    persistPetState();
    schedulePetWander();
    schedulePetBehaviorAttack();
  });
  createWindow();
  registerGlobalLauncher();
  void resolvePetSurface().finally(createPetWindow);
  createTray();
  scheduleUpdateCheck();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") stopAgentHost();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
  globalShortcut.unregister(globalLauncherAccelerator);
  stopPetWander();
  stopPetBehavior(false);
  if (petWindow && !petWindow.isDestroyed()) petWindow.destroy();
  stopAgentHost();
});
