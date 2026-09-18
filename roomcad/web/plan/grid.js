// The 1/2/5 cm grid, point snapping, and the 90-degree wall lock.
//
// Part of the plan model; the public entry point is ../plan.js, which re-exports
// every module here.

import { WALL_ATTACH_TOLERANCE, clamp, clean, distance, gridStep, point } from "./core.js";
import { canvasOf } from "./room.js";
import { attachAlongAxis, wallAttachPoint, wallMidpoint } from "./walls.js";


// MARK: - Grid and snapping

export function gridSnap(room, p) {
  const step = Math.max(gridStep(room.grid).meters, 0.001);
  const snap = v => clean(Math.round(v / step) * step);
  const canvas = canvasOf(room);
  return { x: clamp(snap(p.x), 0, canvas.width), z: clamp(snap(p.z), 0, canvas.length) };
}

export function snapPoint(room, raw, excludeWallID = null) {
  const canvas = canvasOf(room);
  const p = { x: clamp(raw.x, 0, canvas.width), z: clamp(raw.z, 0, canvas.length) };
  const tolerance = Math.max(0.12, gridStep(room.grid).meters * 1.5);
  let best = null;
  const consider = candidate => {
    const d = distance(candidate, p);
    if (d <= tolerance && (!best || d < best.d)) best = { p: candidate, d };
  };
  consider(point(0, 0));
  consider(point(canvas.width, 0));
  consider(point(0, canvas.length));
  consider(point(canvas.width, canvas.length));
  for (const wall of room.walls) {
    if (wall.id === excludeWallID) continue;
    consider(wall.start);
    consider(wall.end);
    consider(wallMidpoint(wall));
  }
  if (best) return best.p;
  // Starting a wall against an existing one begins it exactly on that wall.
  const attach = wallAttachPoint(room, p, WALL_ATTACH_TOLERANCE, excludeWallID);
  if (attach) return { x: clean(attach.x), z: clean(attach.z) };
  return gridSnap(room, p);
}

// MARK: - Axis-locked walls (90° only)

/// Locks a point to the horizontal or vertical line through `anchor`,
/// whichever is closer. Walls are always drawn at right angles.
export function axisAligned(p, anchor) {
  return Math.abs(p.x - anchor.x) >= Math.abs(p.z - anchor.z)
    ? { x: p.x, z: anchor.z }
    : { x: anchor.x, z: p.z };
}

/// Snaps the free end of a wall while keeping it axis-aligned with `start`.
export function snapWallEnd(room, rawEnd, start) {
  const end = axisAligned(rawEnd, start);
  const canvas = canvasOf(room);
  const tolerance = Math.max(0.12, gridStep(room.grid).meters * 1.5);
  let best = null;
  const consider = candidate => {
    // Only accept candidates that share a line with the start, so the wall
    // stays perfectly horizontal or vertical.
    if (Math.abs(candidate.x - start.x) > 0.001 && Math.abs(candidate.z - start.z) > 0.001) return;
    const d = distance(candidate, end);
    if (d <= tolerance && (!best || d < best.d)) best = { p: candidate, d };
  };
  consider(point(0, 0));
  consider(point(canvas.width, 0));
  consider(point(0, canvas.length));
  consider(point(canvas.width, canvas.length));
  for (const wall of room.walls) {
    consider(wall.start);
    consider(wall.end);
    consider(wallMidpoint(wall));
  }
  if (best) return best.p;
  // A new wall drawn up to an existing one locks onto it too, so rooms close
  // themselves instead of leaving a hairline gap at the join.
  const attached = attachAlongAxis(room, end, start, null);
  if (attached) return attached;
  const snapped = gridSnap(room, end);
  // Keep the shared axis coordinate exact so the wall stays connected to its
  // starting point, even when that point is off the plain grid.
  if (Math.abs(end.x - start.x) <= 0.0001) snapped.x = start.x;
  else snapped.z = start.z;
  return snapped;
}

/// Snaps a dragged wall endpoint. Unlike `snapWallEnd`, the free end is not
/// locked to the wall's current axis: it can snap to the perpendicular axis
/// through the fixed end, so grabbing an endpoint can reorient the wall 90°.
export function snapWallEndpoint(room, raw, fixed, excludeWallID = null) {
  const canvas = canvasOf(room);
  const end = axisAligned(
    { x: clamp(raw.x, 0, canvas.width), z: clamp(raw.z, 0, canvas.length) },
    fixed
  );
  const tolerance = Math.max(0.12, gridStep(room.grid).meters * 1.5);
  let best = null;
  const consider = candidate => {
    const d = distance(candidate, end);
    if (d <= tolerance && (!best || d < best.d)) best = { p: candidate, d };
  };
  consider(point(0, 0));
  consider(point(canvas.width, 0));
  consider(point(0, canvas.length));
  consider(point(canvas.width, canvas.length));
  for (const wall of room.walls) {
    if (excludeWallID !== null && wall.id === excludeWallID) continue;
    consider(wall.start);
    consider(wall.end);
    consider(wallMidpoint(wall));
  }
  if (best) return best.p;
  // Nothing exact to land on, but the end may still be crossing or stopping
  // short of a wall — pull it onto that wall's centreline.
  const attached = attachAlongAxis(room, end, fixed, excludeWallID);
  if (attached) return attached;
  const snapped = gridSnap(room, end);
  // Keep the shared axis coordinate exact so the wall stays connected to its
  // fixed endpoint.
  if (Math.abs(end.x - fixed.x) <= 0.0001) snapped.x = fixed.x;
  else snapped.z = fixed.z;
  return snapped;
}
