const assert = require("node:assert/strict");
const { PetWanderGrid, PetWanderPlanner, PetWalk } = require("../apps/desktop/electron/pet-wander.cjs");

const grid = new PetWanderGrid(1440, 900, { x: 220, y: 190 }, 16);
assert.equal(grid.isUsable, true);
assert.deepEqual(grid.clampPetPosition({ x: -100, y: 10_000 }), { x: 16, y: 694 });

const blocked = grid.blockedCells([{ x: 500, y: 360, width: 440, height: 180 }]);
assert.ok(blocked.size > 0);

const planner = new PetWanderPlanner(() => 0.75);
const from = grid.cellForPetPosition({ x: 16, y: 16 });
const plan = planner.tryPlanWalk(from, blocked);
assert.equal(plan.planned, true);
assert.ok(plan.path.length > 0);
let previous = from;
for (const step of plan.path) {
  assert.equal(PetWanderPlanner.areNeighbors(previous, step), true);
  assert.equal(blocked.has(`${step.column}:${step.row}`), false);
  previous = step;
}

const walk = new PetWalk({ x: 16, y: 16 }, plan.path.map((cell) => grid.petPositionFor(cell)), 90);
assert.ok(walk.duration > 0);
assert.deepEqual(walk.positionAt(0), { x: 16, y: 16 });
assert.ok(Number.isFinite(walk.positionAt(walk.duration / 2).x));
assert.equal(walk.isFinished(walk.duration + 1), true);

const leftMonitor = { x: -1920, y: 0, width: 1920, height: 1080 };
const rightMonitor = { x: 0, y: 0, width: 1920, height: 1080 };
const desktopGrid = new PetWanderGrid(3840, 1080, { x: 220, y: 190 }, 16);
const desktopBlocked = desktopGrid.blockedCellsOutsideDisplays([leftMonitor, rightMonitor], { x: -1920, y: 0 });
assert.equal(desktopBlocked.size, 0, "adjacent displays should form one continuous walkable desktop");
const seamPath = PetWanderPlanner.planPath({ column: 4, row: 5 }, { column: 5, row: 5 }, desktopBlocked);
assert.deepEqual(seamPath, [{ column: 5, row: 5 }], "the planner should cross the monitor seam in one walk");
const seamStart = desktopGrid.petPositionFor({ column: 4, row: 5 });
const seamEnd = desktopGrid.petPositionFor({ column: 5, row: 5 });
const seamWalk = new PetWalk(seamStart, [seamEnd], 90);
assert.ok(seamWalk.positionAt(seamWalk.duration / 2).x > seamStart.x, "the seam transition should remain a continuous animated walk");
assert.ok(seamEnd.x + leftMonitor.x > leftMonitor.x + leftMonitor.width, "the destination should land on the second display");

const separatedDisplays = [
  { x: 0, y: 0, width: 1000, height: 800 },
  { x: 1200, y: 0, width: 1000, height: 800 },
];
const separatedGrid = new PetWanderGrid(2200, 800, { x: 100, y: 80 }, 16);
assert.ok(separatedGrid.blockedCellsOutsideDisplays(separatedDisplays).size > 0, "empty gaps between displays should not be walkable cells");

console.log("Pet wander single- and multi-monitor checks passed.");
