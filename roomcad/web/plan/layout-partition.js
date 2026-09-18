import { sliceByWeights, connectedParts } from "./layout-slice.js";
// Cutting free space into rooms: slicing, absorbing stranded floor, and the boundaries.
//
// Part of the plan model; the public entry point is ../plan.js, which re-exports
// every module here.

import { clean, point } from "./core.js";
import { apportion } from "./layout.js";
import { freeComponents, stepBlocked } from "./layout-grid.js";
import { detectRooms } from "./rooms.js";
import { wallLength, wallPerp, wallPointAt } from "./walls.js";

/// Puts doors in until you can walk from any space on the plan to any other.
///
/// Reads the finished plan the way the editor reads it — the spaces the walls
/// enclose, and which spaces each door joins — rather than from the grid the
/// partition worked on. That is the difference that matters here: the grid
/// knows what the layout MEANT, and this has to work on what the walls actually
/// did. Adds doors to `doorList` in place; returns how many it added.
///
/// `openingAt(wall, width, range)` is the same door-fitting the layout uses, so
/// a door added here lands in a free stretch of wall and never on a window.
export function joinSeparatePieces(plan, doorList, openingAt) {
  const DOOR_WIDTHS = [0.9, 0.75, 0.6];
  let added = 0;

  for (let attempt = 0; attempt < 24; attempt++) {
    const spaces = detectRooms(plan);
    if (spaces.length <= 1) return added;

    const inSpace = pt => spaces.findIndex(r =>
      r.rects.some(c => pt.x > c.x && pt.x < c.x + c.w && pt.z > c.z && pt.z < c.z + c.l));

    // Which spaces each door joins. Probed a little to either side of the
    // opening, and a little along it as well: a door's midpoint often sits
    // exactly on the line between two cells, which is inside neither.
    const linked = spaces.map(() => new Set());
    for (const d of plan.doors) {
      const wall = plan.walls.find(w => w.id === d.wallID);
      if (!wall) continue;
      const n = wallPerp(wall);
      const nudge = Math.min(0.13, d.width / 4);
      const probe = sign => {
        for (const along of [nudge, -nudge, 0]) {
          const at = wallPointAt(wall, d.offset + d.width / 2 + along);
          const hit = inSpace({ x: at.x + n.x * 0.14 * sign, z: at.z + n.z * 0.14 * sign });
          if (hit >= 0) return hit;
        }
        return -1;
      };
      const a = probe(1);
      const b = probe(-1);
      if (a >= 0 && b >= 0) { linked[a].add(b); linked[b].add(a); }
    }

    // The piece containing the largest space is the plan; anything not
    // connected to it is what has to be joined on.
    let main = 0;
    for (let i = 1; i < spaces.length; i++) if (spaces[i].area > spaces[main].area) main = i;
    const reached = new Array(spaces.length).fill(false);
    const stack = [main];
    reached[main] = true;
    while (stack.length) {
      const at = stack.pop();
      for (const j of linked[at]) if (!reached[j]) { reached[j] = true; stack.push(j); }
    }
    if (reached.every((r, i) => r || spaces[i].area < 1)) return added;

    // Every wall with a connected space on one side and a cut-off one on the
    // other, best first. Taking only the best one and giving up when it had no
    // room for a door left plans in pieces that a second choice would have
    // joined.
    const candidates = [];
    for (const wall of plan.walls) {
      const length = wallLength(wall);
      if (length < 0.6) continue;
      const n = wallPerp(wall);
      // Walked along the wall so a run between two particular spaces is found
      // even when the wall borders several.
      const step = Math.min(0.25, length / 4);
      for (let t = step / 2; t < length; t += step) {
        const at = wallPointAt(wall, t);
        const a = inSpace({ x: at.x + n.x * 0.14, z: at.z + n.z * 0.14 });
        const b = inSpace({ x: at.x - n.x * 0.14, z: at.z - n.z * 0.14 });
        if (a < 0 || b < 0 || a === b) continue;
        if (reached[a] === reached[b]) continue;
        const cutOff = reached[a] ? b : a;
        candidates.push({ wall, at: t, score: spaces[cutOff].area, cutOff });
      }
    }
    if (!candidates.length) return added;
    candidates.sort((x, y) => y.score - x.score);

    // Centre the door on the run that was found, and let the door fitter push
    // it into whatever gap the wall actually has. Walls are tried in turn: a
    // wall with no free stretch left on it is a reason to try the next one,
    // not to leave the plan in pieces.
    let door = null;
    for (const candidate of candidates) {
      const span = wallLength(candidate.wall);
      const near = { lo: Math.max(0, candidate.at - 1.2), hi: Math.min(span, candidate.at + 1.2) };
      for (const range of [near, { lo: 0, hi: span }]) {
        for (const width of DOOR_WIDTHS) {
          door = openingAt(candidate.wall, width, range);
          if (door) break;
        }
        if (door) break;
      }
      if (door) break;
    }
    if (!door) return added;
    doorList.push(door);
    plan.doors = doorList;
    added++;
  }
  return added;
}

/// Gives away pockets of open floor that lead nowhere.
///
/// The largest run of open floor is the hallway — that is what the rooms open
/// onto. Anything else is a piece cut off from it by the rooms in between, and
/// on the finished plan it is a space with walls all round and no door. It
/// becomes part of whichever room it borders most, so it is floor somebody can
/// actually stand on rather than a hole in the middle of the drawing.
export function absorbStrandedFloor(grid, owner, SPARE, circulation = null) {
  const { nx, nz, at, xs, zs } = grid;
  const open = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) if (owner[at(i, j)] === SPARE) open.push([i, j]);
  }
  if (!open.length) return;
  const parts = connectedParts(grid, open);
  if (parts.length <= 1) return;

  /// Is this run of floor the walking space, or is it merely floor?
  ///
  /// The walking space is what was deliberately made: the hallway carved for
  /// the rooms to open onto, and the floor the user marked green. Keeping the
  /// LARGEST run instead was wrong in exactly the case that matters — carve a
  /// hallway across a bare plate for one room and the far side of it is bigger
  /// than the hallway, so the far side was kept as walking space and the
  /// hallway was given away.
  const isWalkingSpace = part => part.some(([i, j]) => {
    if (circulation && circulation[at(i, j)]) return true;
    if (!circulation) return false;
    for (const [ni, nj] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) {
      if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
      if (circulation[at(ni, nj)] && !stepBlocked(grid, i, j, ni, nj)) return true;
    }
    return false;
  });
  const keep = parts.map(isWalkingSpace);
  // Nothing identifiable as walking space: fall back to the largest run, which
  // is what the rooms will have been laid against.
  if (!keep.some(Boolean)) {
    let biggest = 0;
    for (let k = 1; k < parts.length; k++) {
      const size = parts[k].reduce((sum, [i, j]) => sum + grid.area[at(i, j)], 0);
      const most = parts[biggest].reduce((sum, [i, j]) => sum + grid.area[at(i, j)], 0);
      if (size > most) biggest = k;
    }
    keep[biggest] = true;
  }

  for (let k = 0; k < parts.length; k++) {
    if (keep[k]) continue;
    // Which room does this pocket share the most wall with?
    const shared = new Map();
    for (const [i, j] of parts[k]) {
      for (const [ni, nj] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) {
        if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
        if (stepBlocked(grid, i, j, ni, nj)) continue;
        const id = owner[at(ni, nj)];
        if (id < 0) continue;                       // not a room
        const run = ni === i ? xs[i + 1] - xs[i] : zs[j + 1] - zs[j];
        shared.set(id, (shared.get(id) || 0) + run);
      }
    }
    let best = -1;
    let most = 0;
    for (const [id, run] of shared) if (run > most) { most = run; best = id; }
    if (best < 0) continue;                         // nothing borders it; leave it
    for (const [i, j] of parts[k]) owner[at(i, j)] = best;
  }
}

/// Shares `count` rooms of `targetArea` out over the free floor.
///
/// Any floor left over once every room has its area becomes one more share,
/// which is then dropped — that is what keeps the leftover as a single clean
/// open area instead of padding every room past the size that was asked for.
export function partitionFloor(grid, count, rng, circ = null) {
  const components = freeComponents(grid).filter(c => c.length > 0);
  if (components.length === 0) return { rooms: [], spare: [] };
  const { at, area } = grid;
  const areaOf = cells => cells.reduce((s, [i, j]) => s + area[at(i, j)], 0);

  const sizes = components.map(areaOf);
  const shares = apportion(count, sizes);

  const rooms = [];
  const spare = [];
  components.forEach((cells, idx) => {
    const n = shares[idx];
    // A piece of floor that gets no rooms is still floor. Returned untouched it
    // is left unclaimed, and unclaimed floor is walled in by the rooms around
    // it — a space with no door, which is where the doorless rooms on generated
    // plans came from. It becomes open floor instead.
    if (n <= 0) { spare.push(cells); return; }
    // One weight per room and nothing else. Shares used to be added for the
    // floor left over, so the recursion had something to cut a small room
    // against — but the rooms fill the floor now, so there is no leftover to
    // carry, and a share that is not a room is a piece of corridor by another
    // name.
    const weights = new Array(n).fill(sizes[idx] / n);
    const pieces = sliceByWeights(grid, cells, weights, rng, circ);
    // Pieces come back in weight order, so the first n are the rooms.
    //
    // A piece is not always in one lump. A hallway carved through it while the
    // floor was being divided leaves it in two or three, and a piece asked for
    // as a single room is handed back whole without anything ever checking —
    // there is nothing to check when there is only one way to divide it. Handed
    // on as it is, those lobes become ONE room: one door goes in one of them
    // and the others are walled in with no way in at all.
    //
    // So a room keeps the largest lump it was given and the rest becomes open
    // floor. Open floor is reachable; floor that belongs to a room you cannot
    // get to is not.
    for (let k = 0; k < pieces.length; k++) {
      if (!pieces[k].length) {
        // sliceByWeights() refused this piece because it has no frontage onto
        // the circulation — a room nobody could enter is not a room. The floor
        // is not left unclaimed either: unclaimed floor is walled in by the
        // rooms around it and becomes a void. It joins the open floor.
        if (k === 0) spare.push(cells);
        continue;
      }
      // Floor that was turned into hallway while this piece was being divided
      // is still listed among its cells. It is not the room's any more, and
      // leaving it in makes the lobes either side of it look joined.
      const own = pieces[k].filter(([i, j]) => !grid.blocked[at(i, j)]);
      if (!own.length) continue;
      if (k >= n) { spare.push(own); continue; }
      const parts = connectedParts(grid, own);
      if (parts.length === 1) { rooms.push(own); continue; }
      parts.sort((a, b) => areaOf(b) - areaOf(a));
      rooms.push(parts[0]);
      for (let i = 1; i < parts.length; i++) spare.push(parts[i]);
    }
  });
  return { rooms, spare };
}

/// The cells of one room, merged into as few rectangles as possible.
///
/// Used for area, for hit-testing and for drawing — a rectilinear room is just
/// a handful of rectangles, and keeping it that way means the rest of the app
/// does not need a polygon type.
export function ownedRects(grid, owner, id) {
  const { nx, nz, at } = grid;
  const used = new Uint8Array(nx * nz);
  const out = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const c = at(i, j);
      if (owner[c] !== id || used[c]) continue;
      // Extend down as far as this column allows, then right while whole
      // columns match — the usual greedy maximal-rectangle sweep.
      let j2 = j;
      while (j2 + 1 < nz && owner[at(i, j2 + 1)] === id && !used[at(i, j2 + 1)]) j2++;
      let i2 = i;
      grow: while (i2 + 1 < nx) {
        for (let k = j; k <= j2; k++) {
          if (owner[at(i2 + 1, k)] !== id || used[at(i2 + 1, k)]) break grow;
        }
        i2++;
      }
      for (let a = i; a <= i2; a++) for (let b = j; b <= j2; b++) used[at(a, b)] = 1;
      out.push({
        x: grid.xs[i], z: grid.zs[j],
        w: clean(grid.xs[i2 + 1] - grid.xs[i]),
        l: clean(grid.zs[j2 + 1] - grid.zs[j]),
      });
    }
  }
  return out;
}

/// Every straight run along the grid where one room meets something else.
///
/// A wall belongs wherever two cells disagree about who owns them: room against
/// a different room, against a walkway, or against the open air. Runs are
/// merged so a five-metre boundary is one wall and not fourteen.
export function roomBoundaries(grid, owner) {
  const { nx, nz, at } = grid;
  const outside = -9;
  const who = (i, j) => (i < 0 || j < 0 || i >= nx || j >= nz) ? outside : owner[at(i, j)];
  const segments = [];

  // Vertical boundaries: the line x = xs[i] between column i-1 and column i.
  for (let i = 0; i <= nx; i++) {
    let run = null;
    for (let j = 0; j < nz; j++) {
      const a = who(i - 1, j);
      const b = who(i, j);
      const wall = a !== b && (a >= 0 || b >= 0);
      if (wall) {
        if (run && run.a === a && run.b === b) run.j1 = j + 1;
        else { if (run) segments.push(run); run = { vertical: true, i, j0: j, j1: j + 1, a, b }; }
      } else if (run) { segments.push(run); run = null; }
    }
    if (run) segments.push(run);
  }
  // Horizontal boundaries: the line z = zs[j] between row j-1 and row j.
  for (let j = 0; j <= nz; j++) {
    let run = null;
    for (let i = 0; i < nx; i++) {
      const a = who(i, j - 1);
      const b = who(i, j);
      const wall = a !== b && (a >= 0 || b >= 0);
      if (wall) {
        if (run && run.a === a && run.b === b) run.i1 = i + 1;
        else { if (run) segments.push(run); run = { vertical: false, j, i0: i, i1: i + 1, a, b }; }
      } else if (run) { segments.push(run); run = null; }
    }
    if (run) segments.push(run);
  }
  return segments.map(sg => sg.vertical
    ? { from: point(grid.xs[sg.i], grid.zs[sg.j0]), to: point(grid.xs[sg.i], grid.zs[sg.j1]), a: sg.a, b: sg.b }
    : { from: point(grid.xs[sg.i0], grid.zs[sg.j]), to: point(grid.xs[sg.i1], grid.zs[sg.j]), a: sg.a, b: sg.b });
}
