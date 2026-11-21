// Electron adapter for the contributed SkaiDesktop.Core pet grid.
// Keep this module dependency-free so the always-on-top window can use the
// same 10x10, blocked-cell, king-move, and eased-glide semantics in packaged
// Electron builds without giving the renderer any native access.

const COLUMNS = 10;
const ROWS = 10;
const NEIGHBORS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

function cellKey(cell) {
  return `${cell.column}:${cell.row}`;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function contains(cell) {
  return cell.column >= 0 && cell.column < COLUMNS && cell.row >= 0 && cell.row < ROWS;
}

function clampCell(cell) {
  return { column: clamp(cell.column, 0, COLUMNS - 1), row: clamp(cell.row, 0, ROWS - 1) };
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function rectCoveredByDisplays(rect, displays) {
  // Keep this geometry check deliberately iterative. Display/work-area data is
  // native input; a malformed or self-referential value must never be able to
  // re-enter the layout calculation and overflow the Electron main process.
  if (!rect || !Array.isArray(displays) || !Number.isFinite(rect.x) || !Number.isFinite(rect.y) || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) return false;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const yBands = [rect.y, bottom];
  for (const display of displays.slice(0, 32)) {
    if (!display || !Number.isFinite(display.y) || !Number.isFinite(display.height) || display.height <= 0) continue;
    const top = display.y;
    const edge = display.y + display.height;
    if (top > rect.y && top < bottom) yBands.push(top);
    if (edge > rect.y && edge < bottom) yBands.push(edge);
  }
  yBands.sort((left, rightEdge) => left - rightEdge);
  const uniqueBands = yBands.filter((value, index) => index === 0 || value !== yBands[index - 1]);

  for (let band = 1; band < uniqueBands.length; band += 1) {
    const y = (uniqueBands[band - 1] + uniqueBands[band]) / 2;
    const intervals = [];
    for (const display of displays.slice(0, 32)) {
      if (!display || !Number.isFinite(display.x) || !Number.isFinite(display.y) || !Number.isFinite(display.width) || !Number.isFinite(display.height) || display.width <= 0 || display.height <= 0) continue;
      if (y >= display.y && y < display.y + display.height) intervals.push({ left: display.x, right: display.x + display.width });
    }
    intervals.sort((left, rightEdge) => left.left - rightEdge.left);
    let coveredTo = rect.x;
    for (const interval of intervals) {
      if (interval.left > coveredTo) break;
      coveredTo = Math.max(coveredTo, interval.right);
      if (coveredTo >= right) break;
    }
    if (coveredTo < right) return false;
  }
  return uniqueBands.length > 1;
}

class PetWanderGrid {
  static columns = COLUMNS;
  static rows = ROWS;

  constructor(width, height, petSize, margin = 8) {
    this.width = Math.max(0, finite(width));
    this.height = Math.max(0, finite(height));
    this.petSize = { x: Math.max(0, finite(petSize?.x)), y: Math.max(0, finite(petSize?.y)) };
    this.margin = Math.max(0, finite(margin));
  }

  get cellWidth() { return this.width / COLUMNS; }
  get cellHeight() { return this.height / ROWS; }
  get isUsable() { return this.width > 0 && this.height > 0; }

  cellAt(point) {
    if (!this.isUsable) return { column: 0, row: 0 };
    return clampCell({ column: Math.floor(finite(point?.x) / this.cellWidth), row: Math.floor(finite(point?.y) / this.cellHeight) });
  }

  cellCenter(cell) {
    const safe = clampCell(cell);
    return { x: (safe.column + 0.5) * this.cellWidth, y: (safe.row + 0.5) * this.cellHeight };
  }

  clampPetPosition(position) {
    const maxLeft = Math.max(this.margin, this.width - this.petSize.x - this.margin);
    const maxTop = Math.max(this.margin, this.height - this.petSize.y - this.margin);
    return {
      x: clamp(finite(position?.x, this.margin), this.margin, maxLeft),
      y: clamp(finite(position?.y, this.margin), this.margin, maxTop),
    };
  }

  petPositionFor(cell) {
    const center = this.cellCenter(cell);
    return this.clampPetPosition({ x: center.x - this.petSize.x / 2, y: center.y - this.petSize.y / 2 });
  }

  petRectFor(cell) {
    const position = this.petPositionFor(cell);
    return { x: position.x, y: position.y, width: this.petSize.x, height: this.petSize.y };
  }

  cellForPetPosition(position) {
    return this.cellAt({ x: finite(position?.x) + this.petSize.x / 2, y: finite(position?.y) + this.petSize.y / 2 });
  }

  blockedCellsOutsideDisplays(displays = [], origin = { x: 0, y: 0 }) {
    const blocked = new Set();
    for (let row = 0; row < ROWS; row += 1) {
      for (let column = 0; column < COLUMNS; column += 1) {
        const rect = this.petRectFor({ column, row });
        if (!rectCoveredByDisplays({ ...rect, x: rect.x + origin.x, y: rect.y + origin.y }, displays)) {
          blocked.add(cellKey({ column, row }));
        }
      }
    }
    return blocked;
  }

  blockedCells(obstacles = [], clearance = 8) {
    const inflated = obstacles
      .filter((rect) => rect && rect.width > 0 && rect.height > 0)
      .map((rect) => ({ x: rect.x - clearance, y: rect.y - clearance, width: rect.width + clearance * 2, height: rect.height + clearance * 2 }));
    const blocked = new Set();
    for (let row = 0; row < ROWS; row += 1) {
      for (let column = 0; column < COLUMNS; column += 1) {
        const rect = this.petRectFor({ column, row });
        if (inflated.some((obstacle) => rect.x < obstacle.x + obstacle.width && rect.x + rect.width > obstacle.x && rect.y < obstacle.y + obstacle.height && rect.y + rect.height > obstacle.y)) {
          blocked.add(cellKey({ column, row }));
        }
      }
    }
    return blocked;
  }
}

class PetWanderPlanner {
  static minimumRestSeconds = 30;
  static maximumRestSeconds = 90;

  constructor(random = Math.random) {
    this.random = random;
  }

  nextRestSeconds() {
    return PetWanderPlanner.minimumRestSeconds + this.random() * (PetWanderPlanner.maximumRestSeconds - PetWanderPlanner.minimumRestSeconds);
  }

  static areNeighbors(first, second) {
    return Math.max(Math.abs(first.column - second.column), Math.abs(first.row - second.row)) === 1;
  }

  tryPlanWalk(from, blocked) {
    const start = clampCell(from);
    if (blocked.has(cellKey(start))) {
      const target = PetWanderPlanner.nearestFreeCell(start, blocked);
      const path = PetWanderPlanner.straightPath(start, target);
      return { target, path, planned: target.column !== start.column || target.row !== start.row };
    }
    const reachable = PetWanderPlanner.reachableFrom(start, blocked);
    reachable.delete(cellKey(start));
    if (reachable.size === 0) return { target: start, path: [], planned: false };
    const candidates = [...reachable.values()].sort((left, right) => left.row - right.row || left.column - right.column);
    const target = candidates[Math.floor(this.random() * candidates.length)];
    return { target, path: PetWanderPlanner.buildPath(start, target, reachable), planned: true };
  }

  tryPlanWalkTo(from, target, blocked) {
    const start = clampCell(from);
    const destination = clampCell(target);
    const reachable = PetWanderPlanner.reachableFrom(start, blocked);
    reachable.delete(cellKey(start));
    if (reachable.size === 0) return { target: start, path: [], planned: false };
    const candidates = [...reachable.values()].sort((left, right) => {
      const leftDistance = Math.max(Math.abs(left.column - destination.column), Math.abs(left.row - destination.row));
      const rightDistance = Math.max(Math.abs(right.column - destination.column), Math.abs(right.row - destination.row));
      return leftDistance - rightDistance || left.row - right.row || left.column - right.column;
    });
    const selected = candidates[0];
    return { target: selected, path: PetWanderPlanner.buildPath(start, selected, reachable), planned: true };
  }

  static planPath(from, to, blocked) {
    const start = clampCell(from);
    const target = { column: to.column, row: to.row };
    if (!contains(target) || blocked.has(cellKey(target)) || (start.column === target.column && start.row === target.row)) return [];
    const reachable = PetWanderPlanner.reachableFrom(start, blocked);
    return reachable.has(cellKey(target)) ? PetWanderPlanner.buildPath(start, target, reachable) : [];
  }

  static nearestFreeCell(cell, blocked) {
    const start = clampCell(cell);
    if (!blocked.has(cellKey(start))) return start;
    let best = start;
    let bestDistance = Number.MAX_SAFE_INTEGER;
    for (let row = 0; row < ROWS; row += 1) {
      for (let column = 0; column < COLUMNS; column += 1) {
        const candidate = { column, row };
        if (blocked.has(cellKey(candidate))) continue;
        const distance = Math.max(Math.abs(column - start.column), Math.abs(row - start.row));
        if (distance < bestDistance) { best = candidate; bestDistance = distance; }
      }
    }
    return best;
  }

  static straightPath(from, to) {
    const path = [];
    let current = { ...from };
    while (current.column !== to.column || current.row !== to.row) {
      current = { column: current.column + Math.sign(to.column - current.column), row: current.row + Math.sign(to.row - current.row) };
      path.push(current);
    }
    return path;
  }

  static reachableFrom(from, blocked) {
    const cameFrom = new Map([[cellKey(from), from]]);
    const queue = [from];
    while (queue.length > 0) {
      const current = queue.shift();
      for (const [columnOffset, rowOffset] of NEIGHBORS) {
        const next = { column: current.column + columnOffset, row: current.row + rowOffset };
        if (!contains(next) || blocked.has(cellKey(next)) || cameFrom.has(cellKey(next))) continue;
        cameFrom.set(cellKey(next), current);
        queue.push(next);
      }
    }
    return new Map([...cameFrom.entries()].map(([key, value]) => [key, value]));
  }

  static buildPath(from, to, cameFrom) {
    const path = [];
    let current = { ...to };
    while (current.column !== from.column || current.row !== from.row) {
      path.push(current);
      current = cameFrom.get(cellKey(current));
      if (!current) return [];
    }
    path.reverse();
    return path;
  }
}

class PetWalk {
  constructor(start, waypoints, pixelsPerSecond) {
    if (!(pixelsPerSecond > 0) || !Number.isFinite(pixelsPerSecond)) throw new RangeError("pixelsPerSecond must be positive and finite");
    this.points = [{ ...start }, ...waypoints.map((point) => ({ ...point }))];
    this.cumulative = [0];
    for (let index = 1; index < this.points.length; index += 1) this.cumulative[index] = this.cumulative[index - 1] + PetWalk.distance(this.points[index - 1], this.points[index]);
    this.length = this.cumulative[this.cumulative.length - 1];
    this.speed = pixelsPerSecond;
    this.rampDistance = Math.min(this.length / 2, Math.max(24, this.speed * 0.35));
    this.duration = this.length <= 0 ? 0 : (this.length - 2 * this.rampDistance) / this.speed + 2 * (2 * this.rampDistance / this.speed);
  }

  isFinished(seconds) { return seconds >= this.duration; }

  positionAt(seconds) { return this.pointAtDistance(this.distanceAt(seconds)); }

  facingAt(seconds) {
    const before = this.positionAt(Math.max(0, seconds - 0.01));
    const after = this.positionAt(Math.min(this.duration, seconds + 0.01));
    const delta = after.x - before.x;
    return Math.abs(delta) < 0.01 ? 0 : Math.sign(delta);
  }

  distanceAt(seconds) {
    if (this.length <= 0 || seconds <= 0) return 0;
    if (seconds >= this.duration) return this.length;
    const rampTime = 2 * this.rampDistance / this.speed;
    if (seconds < rampTime) {
      const progress = seconds / rampTime;
      return this.rampDistance * progress * progress;
    }
    const cruiseTime = this.duration - 2 * rampTime;
    if (seconds < rampTime + cruiseTime) return this.rampDistance + (seconds - rampTime) * this.speed;
    const remaining = (this.duration - seconds) / rampTime;
    return this.length - this.rampDistance * remaining * remaining;
  }

  pointAtDistance(distance) {
    if (distance <= 0) return this.points[0];
    if (distance >= this.length) return this.points[this.points.length - 1];
    for (let index = 1; index < this.points.length; index += 1) {
      if (distance > this.cumulative[index]) continue;
      const segment = this.cumulative[index] - this.cumulative[index - 1];
      const amount = segment <= 0 ? 1 : (distance - this.cumulative[index - 1]) / segment;
      const from = this.points[index - 1];
      const to = this.points[index];
      return { x: from.x + (to.x - from.x) * amount, y: from.y + (to.y - from.y) * amount };
    }
    return this.points[this.points.length - 1];
  }

  static distance(first, second) {
    return Math.hypot(second.x - first.x, second.y - first.y);
  }
}

module.exports = { PetWanderGrid, PetWanderPlanner, PetWalk, cellKey };
