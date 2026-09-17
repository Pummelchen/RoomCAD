// The layout engine's grid: free-space components, wall barriers and connectivity.
//
// Part of the plan model; the public entry point is ../plan.js, which re-exports
// every module here.

import { MIN_WALL_LENGTH, clean } from "./core.js";
import { MIN_ROOM_DIM } from "./layout.js";


/// Cuts a band into `k` rooms across its length, each as close to `targetArea`
/// as the band depth allows. Rooms are never stretched past the target just to
/// fill the band — the remainder comes back as `leftover` and becomes public
/// floor, which is what lets a request for a few small rooms in a large space
/// produce exactly that instead of a few enormous ones.
// MARK: - Layout engine: growing rooms into the space that is actually free
//
// The old engine sliced the free space into bands and cut rectangles out of
// them. Two things were wrong with that, and both were what a user noticed
// first. It carved a corridor for every band even when the plan already had
// walkways drawn on it, so a template with 17 m² of circulation came back with
// 25 m² and the rooms lost the difference. And a guillotine cut can only ever
// produce rectangles, so rooms could not follow an L-shaped pocket or wrap
// around a stairwell — they just left those corners empty.
//
// This grows rooms instead. The free floor is cut into a fine grid, seeds are
// placed as far apart as the space allows, and each room absorbs one cell at a
// time — always the cell that keeps it most compact — until it reaches the area
// asked for. A room is therefore whatever rectilinear shape the space allows,
// including an L or a U, and it grows up against the walkways that are already
// there instead of demanding new ones.

const LAYOUT_MAX_CELLS = 6000;
const LAYOUT_TARGET_CELL = 0.35;   // metres; refined per plan, see layoutGrid
// No subdivision finer than the shortest wall the app itself lets you draw, so
// the generator cannot produce a partition it would refuse from a user. Edges
// of existing obstacles are still honoured exactly, so a genuinely short jog in
// the geometry is still reproduced faithfully.
const LAYOUT_MIN_CELL = MIN_WALL_LENGTH;
// The closest two grid lines may sit. Below this a boundary becomes a wall that
// sanitize discards on load, which turns it into a hole.
const LAYOUT_MIN_LINE_GAP = 0.15;

/// Cuts `layout` into a grid fine enough to shape rooms with.
///
/// Every obstacle edge becomes a grid line, so a room boundary can always land
/// exactly on the edge of a walkway rather than near it. Long spans between
/// those lines are then subdivided, because a room grown out of 4-metre cells
/// can only ever be a crude staircase.
export function layoutGrid(layout, obstacles, guides = { xs: [], zs: [] }) {
  // Lines come in two kinds. HARD lines are the edges of things that already
  // exist — the plate, a walkway, the end of a wall the user drew — and a room
  // boundary has to be able to land exactly on them, or it ends up overlapping
  // an existing wall by a few centimetres. SOFT lines are the subdivisions this
  // function adds to make the grid fine enough to shape rooms with, and they
  // can go anywhere. Only soft lines are dropped when the grid gets crowded.
  const lines = (lo, hi, edges, preferred = []) => {
    const set = new Set([clean(lo), clean(hi)]);
    for (const v of edges) if (v > lo + 1e-9 && v < hi - 1e-9) set.add(clean(v));
    const wins = new Set(preferred.map(clean));
    let sorted = [...set].sort((a, b) => a - b);
    // Two obstacle edges a few millimetres apart would give a cell that thin,
    // and a boundary that thin becomes a wall shorter than sanitize keeps —
    // dropped on the next load, leaving a hole that merges two rooms into one.
    // Lines closer together than that are collapsed.
    //
    // The threshold is deliberately the smallest that works. Using the minimum
    // CELL size here instead discarded obstacle edges up to 30 cm apart, and a
    // cell then straddled the edge of a walkway: rooms ended up overlapping the
    // circulation by as much as 0.63 m², which is the very thing the grid is
    // built to prevent.
    const spaced = [sorted[0]];
    for (const v of sorted.slice(1)) {
      const last = spaced[spaced.length - 1];
      if (v - last >= LAYOUT_MIN_LINE_GAP) { spaced.push(v); continue; }
      // Too close to keep both. If one of them is the line of a wall that
      // already exists, that is the one to keep: a boundary a few centimetres
      // to the side of an existing wall is not a separate wall, it is two walls
      // overlapping — they are 10 cm thick, so 5 cm apart is an overlap.
      if (wins.has(v) && !wins.has(last) && spaced.length > 1) spaced[spaced.length - 1] = v;
    }
    const last = sorted[sorted.length - 1];
    if (spaced[spaced.length - 1] !== last) {
      // Make room for the boundary rather than sitting just short of it.
      if (spaced.length > 1 && last - spaced[spaced.length - 2] < LAYOUT_MIN_LINE_GAP) spaced.pop();
      spaced[spaced.length - 1] = last;
    }
    sorted = spaced;
    // Subdivide any span that is coarser than the target cell.
    const out = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const span = sorted[i] - sorted[i - 1];
      // Never split a span so finely that a slice falls under the minimum, and
      // never so that a subdivision crowds the hard line at either end.
      const steps = Math.max(1, Math.min(
        Math.round(span / LAYOUT_TARGET_CELL),
        Math.floor(span / LAYOUT_MIN_CELL),
      ));
      for (let k = 1; k < steps; k++) {
        const v = clean(sorted[i - 1] + (span * k) / steps);
        if (v - out[out.length - 1] >= LAYOUT_MIN_LINE_GAP && sorted[i] - v >= LAYOUT_MIN_LINE_GAP) {
          out.push(v);
        }
      }
      out.push(sorted[i]);        // a hard line is never moved and never dropped
    }
    return out;
  };

  let xs = lines(layout.x, layout.x + layout.w,
    [...obstacles.flatMap(o => [o.x, o.x + o.w]), ...guides.xs], guides.xs);
  let zs = lines(layout.z, layout.z + layout.l,
    [...obstacles.flatMap(o => [o.z, o.z + o.l]), ...guides.zs], guides.zs);
  // Keep the grid affordable on a very large plate by coarsening evenly.
  while ((xs.length - 1) * (zs.length - 1) > LAYOUT_MAX_CELLS) {
    xs = xs.filter((_, i) => i % 2 === 0 || i === xs.length - 1);
    zs = zs.filter((_, i) => i % 2 === 0 || i === zs.length - 1);
  }

  const nx = xs.length - 1;
  const nz = zs.length - 1;
  const blocked = new Uint8Array(nx * nz);
  const area = new Float64Array(nx * nz);
  for (let i = 0; i < nx; i++) {
    const x0 = xs[i];
    const x1 = xs[i + 1];
    for (let j = 0; j < nz; j++) {
      const z0 = zs[j];
      const z1 = zs[j + 1];
      const at = i * nz + j;
      area[at] = (x1 - x0) * (z1 - z0);
      for (const o of obstacles) {
        // A cell that OVERLAPS an obstacle is blocked, not one whose centre
        // happens to fall inside it. Testing the centre leaves a cell that
        // straddles the edge of a walkway looking free, and a room then takes
        // it: rooms were overlapping the circulation by up to 0.63 m² wherever
        // two grid lines had been collapsed together.
        const ox = Math.min(x1, o.x + o.w) - Math.max(x0, o.x);
        const oz = Math.min(z1, o.z + o.l) - Math.max(z0, o.z);
        if (ox > 1e-9 && oz > 1e-9) { blocked[at] = 1; break; }
      }
    }
  }
  return { xs, zs, nx, nz, blocked, area, at: (i, j) => i * nz + j };
}

/// The connected pieces of free floor, as lists of cell indices.
///
/// Free space is not necessarily one piece — a stairwell can cut a plan in two
/// — and rooms must be shared out between the pieces rather than grown across
/// the gap between them.
export function freeComponents(grid) {
  const { nx, nz, blocked, at } = grid;
  const seen = new Uint8Array(nx * nz);
  const out = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const c0 = at(i, j);
      if (blocked[c0] || seen[c0]) continue;
      const cells = [];
      const stack = [[i, j]];
      seen[c0] = 1;
      while (stack.length) {
        const [ci, cj] = stack.pop();
        cells.push([ci, cj]);
        for (const [ni, nj] of [[ci-1,cj],[ci+1,cj],[ci,cj-1],[ci,cj+1]]) {
          if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
          const n = at(ni, nj);
          if (blocked[n] || seen[n]) continue;
          if (stepBlocked(grid, ci, cj, ni, nj)) continue;
          seen[n] = 1;
          stack.push([ni, nj]);
        }
      }
      out.push(cells);
    }
  }
  return out;
}

/// True if these cells form one connected piece.
/// Marks the cell edges a wall the user drew runs along.
///
/// The grid knows where the walls END — their ends are grid lines — but nothing
/// stopped a room being laid across one. The room then arrives as one piece,
/// gets one door, and the user's wall cuts it into a half with the door and a
/// half with none: the sealed spaces on a generated plan were made this way,
/// not by the door step failing.
///
/// `wallLeft[at(i, j)]` means the edge between (i-1, j) and (i, j) is walled;
/// `wallBelow[at(i, j)]` means the edge between (i, j-1) and (i, j) is.
export function wallBarriers(grid, walls) {
  const { nx, nz, xs, zs, at } = grid;
  const wallLeft = new Uint8Array(nx * nz);
  const wallBelow = new Uint8Array(nx * nz);
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  for (const w of walls) {
    const vertical = near(w.start.x, w.end.x);
    const horizontal = near(w.start.z, w.end.z);
    if (vertical === horizontal) continue;         // only rectilinear walls divide cells
    if (vertical) {
      const lo = Math.min(w.start.z, w.end.z), hi = Math.max(w.start.z, w.end.z);
      for (let i = 1; i < nx; i++) {
        if (!near(xs[i], w.start.x)) continue;
        for (let j = 0; j < nz; j++) {
          // The whole cell edge has to be behind the wall. Half-covered means
          // there is a way round it, and a room may legitimately wrap it.
          if (zs[j] >= lo - 1e-9 && zs[j + 1] <= hi + 1e-9) wallLeft[at(i, j)] = 1;
        }
      }
    } else {
      const lo = Math.min(w.start.x, w.end.x), hi = Math.max(w.start.x, w.end.x);
      for (let j = 1; j < nz; j++) {
        if (!near(zs[j], w.start.z)) continue;
        for (let i = 0; i < nx; i++) {
          if (xs[i] >= lo - 1e-9 && xs[i + 1] <= hi + 1e-9) wallBelow[at(i, j)] = 1;
        }
      }
    }
  }
  return { wallLeft, wallBelow };
}

/// Can you step straight from one cell to the next, or is there a wall in the
/// way? Grids built without barriers say yes to everything, as before.
export function stepBlocked(grid, i, j, ni, nj) {
  if (!grid.wallLeft) return false;
  if (ni === i - 1) return !!grid.wallLeft[grid.at(i, j)];
  if (ni === i + 1) return !!grid.wallLeft[grid.at(ni, nj)];
  if (nj === j - 1) return !!grid.wallBelow[grid.at(i, j)];
  if (nj === j + 1) return !!grid.wallBelow[grid.at(ni, nj)];
  return false;
}

export function isConnected(grid, cells) {
  if (cells.length <= 1) return true;
  const { at, nx, nz } = grid;
  const inSet = new Set(cells.map(([i, j]) => at(i, j)));
  const seen = new Set([at(cells[0][0], cells[0][1])]);
  const stack = [cells[0]];
  while (stack.length) {
    const [i, j] = stack.pop();
    for (const [ni, nj] of [[i-1,j],[i+1,j],[i,j-1],[i,j+1]]) {
      // Cells are indexed i * nz + j, so stepping off the bottom of a column
      // (j = -1) lands on a REAL cell: the top of the column to the left. Two
      // halves of a piece either side of a walkway were joined through that
      // wrap, so a piece in two disconnected lobes passed as connected, was
      // given one door, and arrived as one room with a door and one without.
      if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
      const n = at(ni, nj);
      if (!inSet.has(n) || seen.has(n)) continue;
      if (stepBlocked(grid, i, j, ni, nj)) continue;
      seen.add(n);
      stack.push([ni, nj]);
    }
  }
  return seen.size === cells.length;
}

/// True if a piece is too narrow to be a room. Measured on the bounding box, so
/// an L with a generous body but a slim arm still counts as usable.
export function tooThin(grid, cells) {
  let minI = Infinity, maxI = -Infinity, minJ = Infinity, maxJ = -Infinity;
  for (const [i, j] of cells) {
    minI = Math.min(minI, i); maxI = Math.max(maxI, i);
    minJ = Math.min(minJ, j); maxJ = Math.max(maxJ, j);
  }
  const w = grid.xs[maxI + 1] - grid.xs[minI];
  const l = grid.zs[maxJ + 1] - grid.zs[minJ];
  return Math.min(w, l) < MIN_ROOM_DIM;
}

/// How much of a piece's own bounding box is taken up by things it has grown
/// around. Zero for a rectangle or a plain L; high for a room that has closed
/// around a walkway or a stairwell.
export function wrapping(grid, cells) {
  const { at, blocked } = grid;
  let minI = Infinity, maxI = -Infinity, minJ = Infinity, maxJ = -Infinity;
  for (const [i, j] of cells) {
    minI = Math.min(minI, i); maxI = Math.max(maxI, i);
    minJ = Math.min(minJ, j); maxJ = Math.max(maxJ, j);
  }
  let enclosed = 0;
  for (let i = minI; i <= maxI; i++) {
    for (let j = minJ; j <= maxJ; j++) if (blocked[at(i, j)]) enclosed++;
  }
  const box = (maxI - minI + 1) * (maxJ - minJ + 1);
  return box > 0 ? enclosed / box : 0;
}
