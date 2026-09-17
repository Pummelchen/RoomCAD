// Cutting a run of free cells into proportional pieces, and the connected parts of one.
//
// Part of the plan model; the public entry point is ../plan.js, which re-exports
// every module here.

import { DOOR_FRONTAGE } from "./layout.js";
import { isConnected, stepBlocked, tooThin, wrapping } from "./layout-grid.js";



/// Splits a piece of floor into rooms sized by `weights`, using straight cuts.
///
/// This is a guillotine partition: every cut runs clean across the piece, so
/// each room is bounded by straight lines and whatever the original outline
/// gave it. That is what makes the result buildable. Growing rooms cell by cell
/// instead — which is the obvious approach, and what this replaced — produces
/// shapes with staircase edges that no one would build: a 13 m² room came out
/// of fourteen little rectangles.
///
/// Cutting an L-shaped piece across the arm gives an L and a rectangle, so the
/// complex shapes come out of the geometry rather than being sought after.
export function sliceByWeights(grid, cells, weights, rng, circ = null) {
  const { at, area } = grid;
  const fronts = circ && circ.fronts;

  /// Does this piece have somewhere to put its door?
  ///
  /// Asked of a piece about to become ONE room as well as of the two halves of
  /// a cut. It used to be asked only about cuts, so a piece that reached the
  /// bottom of the recursion — the common case once the rooms filled the floor
  /// — became a room without anyone checking it had a way in, and 97 rooms
  /// across the corpus could only be entered through the room next door.
  ///
  /// Not "does it touch the circulation" — touching is not enough. A room whose
  /// only contact with the hallway is the 35 cm where a walkway ends cannot
  /// have a door onto it, and the door step, finding nowhere to put one, put it
  /// in the outside wall instead: a bedroom opening onto the street. So this
  /// asks for a door's worth of frontage, which is what the room actually
  /// needs. Stops as soon as it has found enough, because it is asked once per
  /// candidate cut.
  ///
  /// `circ` is null when there is no circulation to front onto at all, and then
  /// this says yes to everything — there is nothing to strand.
  const fronting = piece => {
    if (!circ) return true;
    let along = 0;
    for (const [i, j] of piece) {
      const dx = grid.xs[i + 1] - grid.xs[i];
      const dz = grid.zs[j + 1] - grid.zs[j];
      if (i > 0 && circ.circulation[at(i - 1, j)] && !stepBlocked(grid, i, j, i - 1, j)) along += dz;
      if (i + 1 < grid.nx && circ.circulation[at(i + 1, j)] && !stepBlocked(grid, i, j, i + 1, j)) along += dz;
      if (j > 0 && circ.circulation[at(i, j - 1)] && !stepBlocked(grid, i, j, i, j - 1)) along += dx;
      if (j + 1 < grid.nz && circ.circulation[at(i, j + 1)] && !stepBlocked(grid, i, j, i, j + 1)) along += dx;
      if (along >= DOOR_FRONTAGE) return true;
    }
    return false;
  };

  // One room's worth: no cut to make, but it still has to have a way in. If it
  // has none, run the hallway through it — the piece then falls either side of
  // the new stretch, and partitionFloor keeps the larger half as the room.
  if (weights.length <= 1) return [cells];

  const half = Math.max(1, Math.round(weights.length / 2));
  const left = weights.slice(0, half);
  const right = weights.slice(half);
  const wantRatio = left.reduce((a, b) => a + b, 0)
    / weights.reduce((a, b) => a + b, 0);

  const total = cells.reduce((s, [i, j]) => s + area[at(i, j)], 0);
  const want = total * wantRatio;

  let minI = Infinity, maxI = -Infinity, minJ = Infinity, maxJ = -Infinity;
  for (const [i, j] of cells) {
    minI = Math.min(minI, i); maxI = Math.max(maxI, i);
    minJ = Math.min(minJ, j); maxJ = Math.max(maxJ, j);
  }

  let best = null;
  let stranded = false;
  const candidates = [];
  for (const axis of ["x", "z"]) {
    const lo = axis === "x" ? minI : minJ;
    const hi = axis === "x" ? maxI : maxJ;
    for (let cut = lo + 1; cut <= hi; cut++) {
      const a = [];
      const b = [];
      let areaA = 0;
      for (const cell of cells) {
        const v = axis === "x" ? cell[0] : cell[1];
        if (v < cut) { a.push(cell); areaA += area[at(cell[0], cell[1])]; }
        else b.push(cell);
      }
      if (a.length === 0 || b.length === 0) continue;
      // A cut that severs a piece into islands is not a wall anyone can build.
      if (!isConnected(grid, a) || !isConnected(grid, b)) continue;
      // Nor is a cut that leaves a slice too narrow to stand in. Rejecting it
      // here is what stops the partition producing one-metre slivers when it is
      // asked for more rooms than the space can hold.
      if (tooThin(grid, a) || tooThin(grid, b)) continue;
      // Nor is a cut that walls a piece off from the circulation.
      if (!fronting(a) || !fronting(b)) { stranded = true; continue; }
      // Shorter cuts mean shorter walls, so use that to break ties.
      const cutLength = axis === "x" ? (maxJ - minJ + 1) : (maxI - minI + 1);
      const err = Math.abs(areaA - want) / total;
      // A piece that closes around a walkway becomes a U-shaped room with a
      // corridor running through the middle of it. Prefer the cut that puts the
      // walkway on a boundary instead — which is also the cut that makes rooms
      // line up with the circulation already drawn.
      const wrap = wrapping(grid, a) + wrapping(grid, b);
      const score = err * 100 + cutLength * 0.01 + wrap * 12;
      candidates.push({ a, b, score, err, wrap });
      if (!best || score < best.score) best = candidates[candidates.length - 1];
    }
  }
  // Every cut would have left one side with no way in. That is a reason to run
  // the hallway further, not a reason to give up and hand the whole piece to
  // one room: giving up is what turned six rooms into three. Carve on through
  // the piece and cut again — both halves then front the new stretch.
  // Nothing can be cut cleanly. Hand the piece over as it is — but a piece is
  // not always in one lump: carving a hallway through it, or a wall the user
  // drew, can leave it in two. Handing that over whole makes ONE room out of
  // two separate spaces, and only one of them gets the door. So it is handed
  // over in the pieces it actually falls into, biggest first.
  if (!best) {
    const parts = connectedParts(grid, cells);
    if (parts.length > 1) {
      parts.sort((p, q) =>
        q.reduce((s, [i, j]) => s + area[at(i, j)], 0)
        - p.reduce((s, [i, j]) => s + area[at(i, j)], 0));
      return weights.map((_, k) => parts[k] || []);
    }
    return [cells, ...weights.slice(1).map(() => [])];
  }

  // Choose among the cuts that are near enough to the best one. Without this
  // the partition is fully determined by the geometry and "Redesign" returns
  // the identical plan every time; with it every seed gives a different but
  // equally good arrangement.
  //
  // There is less to choose from than there used to be. Rooms have to front the
  // circulation now, which rules out whole families of arrangement — a back row
  // of rooms reached through the front row is not one of the options any more —
  // so Redesign has fewer genuinely different plans to offer. Widening this to
  // buy some back was tried and rejected: it let a cut that was merely tidier
  // beat one that was the right size, and a 6 m² room came back at 3.7 m².
  const tolerance = best.score + 4;
  const shortlist = candidates.filter(c => c.score <= tolerance);
  const chosen = shortlist.length > 1
    ? shortlist[Math.floor(rng() * shortlist.length) % shortlist.length]
    : best;

  return [
    ...sliceByWeights(grid, chosen.a, left, rng, circ),
    ...sliceByWeights(grid, chosen.b, right, rng, circ),
  ];
}

/// The pieces a set of cells falls into once you can no longer walk between
/// them — around a walkway, across a wall the user drew, or either side of a
/// hallway just carved through the middle of it.
export function connectedParts(grid, cells) {
  const { at, nx, nz } = grid;
  const left = new Set(cells.map(([i, j]) => at(i, j)));
  const byIndex = new Map(cells.map(c => [at(c[0], c[1]), c]));
  const parts = [];
  while (left.size) {
    const first = left.values().next().value;
    const part = [];
    const stack = [byIndex.get(first)];
    left.delete(first);
    while (stack.length) {
      const [i, j] = stack.pop();
      part.push([i, j]);
      for (const [ni, nj] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) {
        // Bounds first. Cells are indexed i * nz + j, so stepping off the
        // bottom of a column lands on a REAL cell — the top of the column to
        // the left — and two pieces of floor with a wall between them are
        // walked as if they were one.
        if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
        const n = at(ni, nj);
        if (!left.has(n) || stepBlocked(grid, i, j, ni, nj)) continue;
        left.delete(n);
        stack.push(byIndex.get(n));
      }
    }
    parts.push(part);
  }
  return parts;
}
