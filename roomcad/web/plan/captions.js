// What to draw for the rooms that were detected: captions, public-area settlement and even rows.
//
// Part of the plan model; the public entry point is ../plan.js, which re-exports
// every module here.

import { GRID_STEPS, clamp, clean, cm } from "./core.js";
import { furnitureFootprint } from "./hit.js";
import { labelBounds } from "./labels.js";
import { MIN_ROOM_DIM } from "./layout.js";
import { canvasOf } from "./room.js";
import { detectRooms } from "./rooms.js";


/// Where a room's area caption can sit without landing on anything.
///
/// Samples positions across the room and keeps the one whose caption box is
/// clear of furniture, labels and the room's own walls by the widest margin —
/// so the text ends up in the emptiest part of the floor rather than on the bed.
/// Returns null when the caption simply does not fit anywhere.
export function captionSpot(room, region, boxW, boxH) {
  const obstacles = [];
  for (const item of room.furniture || []) {
    const f = furnitureFootprint(item);
    if (f.maxX < region.bounds.minX || f.minX > region.bounds.maxX) continue;
    if (f.maxZ < region.bounds.minZ || f.minZ > region.bounds.maxZ) continue;
    obstacles.push(f);
  }
  for (const label of room.labels || []) {
    const b = labelBounds(label);
    if (b.maxX < region.bounds.minX || b.minX > region.bounds.maxX) continue;
    if (b.maxZ < region.bounds.minZ || b.minZ > region.bounds.maxZ) continue;
    obstacles.push(b);
  }

  const inside = (x, z) => region.rects.some(r =>
    x >= r.x - 0.001 && x <= r.x + r.w + 0.001 && z >= r.z - 0.001 && z <= r.z + r.l + 0.001);
  const boxFits = (cx, cz) => {
    const x0 = cx - boxW / 2, x1 = cx + boxW / 2;
    const z0 = cz - boxH / 2, z1 = cz + boxH / 2;
    // The whole caption has to be on this room's floor, corners included.
    if (!inside(x0, z0) || !inside(x1, z0) || !inside(x0, z1) || !inside(x1, z1)
      || !inside(cx, z0) || !inside(cx, z1) || !inside(x0, cz) || !inside(x1, cz)) return false;
    for (const o of obstacles) {
      if (x0 < o.maxX && o.minX < x1 && z0 < o.maxZ && o.minZ < z1) return false;
    }
    return true;
  };
  // Distance to the nearest thing to avoid; bigger is a calmer spot.
  const clearance = (cx, cz) => {
    let best = Infinity;
    for (const o of obstacles) {
      const dx = Math.max(o.minX - cx, 0, cx - o.maxX);
      const dz = Math.max(o.minZ - cz, 0, cz - o.maxZ);
      best = Math.min(best, Math.hypot(dx, dz));
    }
    const b = region.bounds;
    best = Math.min(best, cx - b.minX, b.maxX - cx, cz - b.minZ, b.maxZ - cz);
    return best;
  };

  const b = region.bounds;
  const spanX = b.maxX - b.minX;
  const spanZ = b.maxZ - b.minZ;
  const steps = 22;
  const stepX = spanX / (steps + 1);
  const stepZ = spanZ / (steps + 1);
  let best = null;
  for (let i = 1; i <= steps; i++) {
    for (let j = 1; j <= steps; j++) {
      const cx = b.minX + stepX * i;
      const cz = b.minZ + stepZ * j;
      if (!boxFits(cx, cz)) continue;
      const score = clearance(cx, cz);
      if (!best || score > best.score) best = { x: cx, z: cz, score };
    }
  }
  return best;
}

/// How much of a region is floor the user (or the generator) marked public.
function publicCoverage(room, region) {
  const areas = room.publicAreas || [];
  if (areas.length === 0) return 0;
  let covered = 0;
  for (const r of region.rects) {
    for (const a of areas) {
      const ox = Math.min(r.x + r.w, a.x + a.w) - Math.max(r.x, a.x);
      const oz = Math.min(r.z + r.l, a.z + a.l) - Math.max(r.z, a.z);
      if (ox > 0 && oz > 0) covered += ox * oz;
    }
  }
  const total = region.rects.reduce((s, r) => s + r.w * r.l, 0);
  return total > 0 ? Math.min(1, covered / total) : 0;
}

/// The area captions to draw: one per enclosed room that has a door, placed
/// where it will not sit on furniture or a label.
///
/// Circulation is skipped. A corridor is bounded by every door that opens onto
/// it, so it passes the "has a door" test, but it is not a room and already
/// reads as PUBLIC on the plan.
export function roomCaptions(room, boxW, boxH) {
  const out = [];
  for (const region of detectRooms(room)) {
    // Every enclosed space is measured, door or no door. The caption used to
    // wait for a door, which is backwards for drawing a plan by hand: the
    // moment you close a room is the moment you want to know how big it is,
    // and the door goes in afterwards. Floor the user has marked as
    // circulation is still left alone — that is drawing space, not a room.
    if (publicCoverage(room, region) > 0.6) continue;
    const spot = captionSpot(room, region, boxW, boxH);
    if (!spot) continue;
    // The room's own floor travels with the caption. The spot is the emptiest
    // place in the WHOLE room, which is where the label belongs when you can
    // see the whole room — and nowhere near you when you are zoomed in on one
    // wall of it. The drawing needs the floor to put the label back on screen.
    out.push({ area: region.area, x: spot.x, z: spot.z, clearance: spot.score, rects: region.rects });
  }
  return out;
}

/// Rounds a rectangle's EDGES to the active grid. Rounding position and size
/// separately would let two areas disagree about the edge they share.
export function snapRectToGrid(room, rect) {
  const step = Math.max(GRID_STEPS[room.grid].meters, 0.001);
  const q = v => clean(Math.round(v / step) * step);
  const x0 = q(rect.x);
  const z0 = q(rect.z);
  const x1 = q(rect.x + rect.w);
  const z1 = q(rect.z + rect.l);
  return { x: Math.min(x0, x1), z: Math.min(z0, z1), w: Math.abs(clean(x1 - x0)), l: Math.abs(clean(z1 - z0)) };
}

/// Pulls edges that are nearly flush with a neighbouring public area onto it
/// exactly, so areas sit side by side with no seam and no overlap.
function snapRectToNeighbours(room, rect, ignoreID) {
  const tolerance = Math.max(GRID_STEPS[room.grid].meters * 2, 0.12);
  let { x, z, w, l } = rect;
  const pull = (value, candidates) => {
    let best = value;
    let bestD = tolerance;
    for (const c of candidates) {
      const d = Math.abs(c - value);
      if (d <= bestD) { bestD = d; best = c; }
    }
    return best;
  };
  for (const a of room.publicAreas || []) {
    if (a.id === ignoreID) continue;
    // Only snap to an area we actually run alongside.
    const sharesZ = z < a.z + a.l + tolerance && a.z < z + l + tolerance;
    const sharesX = x < a.x + a.w + tolerance && a.x < x + w + tolerance;
    if (sharesZ) {
      const x1 = pull(x + w, [a.x, a.x + a.w]);
      const nx = pull(x, [a.x, a.x + a.w]);
      w = clean(x1 - nx);
      x = nx;
    }
    if (sharesX) {
      const z1 = pull(z + l, [a.z, a.z + a.l]);
      const nz = pull(z, [a.z, a.z + a.l]);
      l = clean(z1 - nz);
      z = nz;
    }
  }
  return { x: clean(x), z: clean(z), w: clean(Math.max(w, 0)), l: clean(Math.max(l, 0)) };
}

/// Trims `rect` back so it stops at `other` instead of running into it, along
/// whichever axis needs the least taken off.
function trimAgainst(rect, other) {
  const ox = Math.min(rect.x + rect.w, other.x + other.w) - Math.max(rect.x, other.x);
  const oz = Math.min(rect.z + rect.l, other.z + other.l) - Math.max(rect.z, other.z);
  if (ox <= 0.0001 || oz <= 0.0001) return rect;
  if (ox <= oz) {
    return rect.x + rect.w / 2 <= other.x + other.w / 2
      ? { ...rect, w: clean(other.x - rect.x) }
      : { ...rect, x: clean(other.x + other.w), w: clean(rect.x + rect.w - (other.x + other.w)) };
  }
  return rect.z + rect.l / 2 <= other.z + other.l / 2
    ? { ...rect, l: clean(other.z - rect.z) }
    : { ...rect, z: clean(other.z + other.l), l: clean(rect.z + rect.l - (other.z + other.l)) };
}

/// Settles a public-area rectangle: on the grid, flush against its neighbours,
/// never overlapping one, and inside the canvas. Areas stay separate objects —
/// each is still selectable and deletable on its own — they just cannot sit on
/// top of each other.
export function settlePublicArea(room, rect, ignoreID = null) {
  const canvas = canvasOf(room);
  let out = snapRectToGrid(room, rect);
  out = snapRectToNeighbours(room, out, ignoreID);
  out = snapRectToGrid(room, out);

  // Take the biggest conflict off first, so the result does not depend on the
  // order the areas happen to be stored in. One pass clears one neighbour, so
  // a crowded plan needs as many passes as there are areas — a fixed four left
  // the rectangle still overlapping when it ran out.
  const neighbours = (room.publicAreas || []).filter(a => a.id !== ignoreID).length;
  for (let pass = 0; pass < neighbours + 2; pass++) {
    const clashes = (room.publicAreas || [])
      .filter(a => a.id !== ignoreID)
      .map(a => {
        const ox = Math.min(out.x + out.w, a.x + a.w) - Math.max(out.x, a.x);
        const oz = Math.min(out.z + out.l, a.z + a.l) - Math.max(out.z, a.z);
        return { a, overlap: ox > 0.0001 && oz > 0.0001 ? ox * oz : 0 };
      })
      .filter(c => c.overlap > 0)
      .sort((p, q) => q.overlap - p.overlap);
    if (clashes.length === 0) break;
    out = trimAgainst(out, clashes[0].a);
    out = snapRectToGrid(room, out);
    if (out.w <= 0.0001 || out.l <= 0.0001) break;
  }

  // If it still clashes there is genuinely nowhere for it to go; hand back
  // nothing so the caller rejects it rather than laying it on a neighbour.
  const stillClashes = (room.publicAreas || []).some(a => a.id !== ignoreID
    && out.x < a.x + a.w - 0.0001 && a.x < out.x + out.w - 0.0001
    && out.z < a.z + a.l - 0.0001 && a.z < out.z + out.l - 0.0001);
  if (stillClashes) return { x: out.x, z: out.z, w: 0, l: 0 };

  out.x = clamp(out.x, 0, Math.max(0, canvas.width - out.w));
  out.z = clamp(out.z, 0, Math.max(0, canvas.length - out.l));
  out.w = clean(Math.min(out.w, canvas.width - out.x));
  out.l = clean(Math.min(out.l, canvas.length - out.z));
  return out;
}

/// The enclosed rooms whose floor lies mostly inside `rect`.
///
/// "Mostly" rather than "entirely" so a selection box dragged roughly over a
/// row of rooms picks them all up without having to be precise about it — the
/// whole point of the gesture is that the plan is not precise yet.
export function roomsInRect(room, rect, coverage = 0.6) {
  const out = [];
  for (const region of detectRooms(room)) {
    let inside = 0;
    let total = 0;
    for (const r of region.rects) {
      total += r.w * r.l;
      const ox = Math.min(r.x + r.w, rect.x + rect.w) - Math.max(r.x, rect.x);
      const oz = Math.min(r.z + r.l, rect.z + rect.l) - Math.max(r.z, rect.z);
      if (ox > 0 && oz > 0) inside += ox * oz;
    }
    if (total > 0 && inside / total >= coverage) out.push(region);
  }
  return out;
}

/// Works out whether a set of rooms forms one row, and along which axis.
///
/// Returns { axis, order } with the rooms sorted along that axis, or a
/// { reason } explaining why they cannot be evened out.
export function roomRow(regions, tolerance = 0.25) {
  if (regions.length < 2) return { reason: "Select at least two rooms" };
  for (const axis of ["x", "z"]) {
    const lo = axis === "x" ? r => r.bounds.minX : r => r.bounds.minZ;
    const hi = axis === "x" ? r => r.bounds.maxX : r => r.bounds.maxZ;
    const crossLo = axis === "x" ? r => r.bounds.minZ : r => r.bounds.minX;
    const crossHi = axis === "x" ? r => r.bounds.maxZ : r => r.bounds.maxX;
    const order = [...regions].sort((a, b) => lo(a) - lo(b));
    // They have to line up across the row...
    const cLo = crossLo(order[0]);
    const cHi = crossHi(order[0]);
    if (!order.every(r => Math.abs(crossLo(r) - cLo) <= tolerance
      && Math.abs(crossHi(r) - cHi) <= tolerance)) continue;
    // ...and follow one another along it, with no gap and no overlap.
    let contiguous = true;
    for (let i = 1; i < order.length; i++) {
      if (Math.abs(lo(order[i]) - hi(order[i - 1])) > tolerance) { contiguous = false; break; }
    }
    if (!contiguous) continue;
    return { axis, order, crossLo: cLo, crossHi: cHi };
  }
  return { reason: "Those rooms are not a single row — pick rooms that sit side by side" };
}

/// Evens out a row of rooms by sliding the walls between them.
///
/// Only the dividers move. The walls around the outside stay exactly where
/// they are, so the row keeps its overall size and nothing outside it shifts —
/// the point is to fix spacing that was eyeballed, not to redraw the plan.
///
/// Returns { walls, size, moved } or { reason }.
export function equalizeRooms(room, regions, opts = {}) {
  const row = roomRow(regions);
  if (row.reason) return { reason: row.reason };
  const { axis, order } = row;
  const lo = axis === "x" ? r => r.bounds.minX : r => r.bounds.minZ;
  const hi = axis === "x" ? r => r.bounds.maxX : r => r.bounds.maxZ;

  const start = lo(order[0]);
  const end = hi(order[order.length - 1]);
  const span = end - start;
  const n = order.length;
  if (span <= 0 || n < 2) return { reason: "Select at least two rooms" };
  const each = span / n;
  if (each < MIN_ROOM_DIM) {
    return { reason: "Those rooms would end up under " + cm(MIN_ROOM_DIM) + " wide" };
  }

  const step = Math.max(GRID_STEPS[room.grid].meters, 0.001);
  const snap = v => clean(Math.round(v / step) * step);
  const walls = room.walls.map(w => ({ ...w, start: { ...w.start }, end: { ...w.end } }));
  let moved = 0;
  // A wall only moves once. Boundaries are handled in order, so a divider
  // already slid to its new home can sit exactly where the NEXT boundary
  // currently is — and without this it would be picked up and moved again,
  // landing two dividers on the same line and deleting the room between them.
  const alreadyMoved = new Set();

  for (let i = 1; i < n; i++) {
    const from = hi(order[i - 1]);          // where the divider is now
    const to = snap(start + each * i);      // where it belongs
    if (Math.abs(to - from) < 0.0005) continue;
    // Every wall lying on the old boundary, running across the row.
    for (const w of walls) {
      if (alreadyMoved.has(w)) continue;
      const alongRow = axis === "x"
        ? Math.abs(w.start.x - w.end.x) < 0.001    // divider runs across X -> vertical
        : Math.abs(w.start.z - w.end.z) < 0.001;
      if (!alongRow) continue;
      const at = axis === "x" ? w.start.x : w.start.z;
      if (Math.abs(at - from) > 0.02) continue;
      // Ignore anything that does not actually span the row.
      const wLo = axis === "x" ? Math.min(w.start.z, w.end.z) : Math.min(w.start.x, w.end.x);
      const wHi = axis === "x" ? Math.max(w.start.z, w.end.z) : Math.max(w.start.x, w.end.x);
      if (Math.min(wHi, row.crossHi) - Math.max(wLo, row.crossLo) < 0.2) continue;
      if (axis === "x") { w.start.x = to; w.end.x = to; }
      else { w.start.z = to; w.end.z = to; }
      alreadyMoved.add(w);
      moved++;
    }
  }
  // Last line of defence: the row must still be divided into n pieces.
  const boundaries = [];
  for (const w of alreadyMoved) boundaries.push(axis === "x" ? w.start.x : w.start.z);
  for (let a = 0; a < boundaries.length; a++) {
    for (let b = a + 1; b < boundaries.length; b++) {
      if (Math.abs(boundaries[a] - boundaries[b]) < MIN_ROOM_DIM / 2) {
        return { reason: "Those walls would end up on top of each other — move them apart first" };
      }
    }
  }

  if (moved === 0 && !opts.allowNoop) {
    // Nothing moved for one of two very different reasons, and saying "already
    // the same size" for both is misleading: on a coarse grid an even split may
    // simply not be expressible, so the target snaps back onto the boundary it
    // came from. Tell the user which it is, and what to do about it.
    const sizes = order.map(r => hi(r) - lo(r));
    const even = sizes.every(v => Math.abs(v - sizes[0]) < 0.005);
    if (even) return { reason: "Those rooms are already the same size" };
    return {
      reason: "The " + GRID_STEPS[room.grid].label + " grid cannot split that evenly — "
        + "each would need to be " + cm(each) + ". Switch to a finer grid and try again.",
    };
  }
  return { walls, size: clean(each), axis, moved };
}
