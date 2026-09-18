// What is under the pointer: walls, openings, furniture, and the distances behind them.
//
// Part of the plan model; the public entry point is ../plan.js, which re-exports
// every module here.

import { furnitureKind, unknownFurnitureKind } from "./core.js";
import { wallDirection, wallPerp, wallPointAt, wallProjection } from "./walls.js";


// MARK: - Hit testing

export function wallNear(room, p, tolerance = 0.18) {
  let best = null;
  for (const w of room.walls) {
    const proj = wallProjection(w, p);
    if (proj.distance <= tolerance && (!best || proj.distance < best.d)) best = { w, d: proj.distance };
  }
  return best ? best.w : null;
}

export function wallForPlacement(room, p, tolerance = 0.5) {
  let best = null;
  for (const w of room.walls) {
    const proj = wallProjection(w, p);
    if (proj.distance <= tolerance && (!best || proj.distance < best.d)) {
      best = { w, offset: proj.offset, d: proj.distance };
    }
  }
  return best ? { wall: best.w, offset: best.offset } : null;
}

/// Finds the opening (door or window) whose occupied area contains `p`.
/// Where a door is hinged and which way its leaf sweeps.
///
/// A door has two choices, and they are separate: which SIDE of the wall it
/// opens into (`swingInside`), and which END of the opening the hinge is on
/// (`hingeAtEnd`). Turning a door round so its axle is on the other side is the
/// second one — the leaf still swings into the same room, it just opens the
/// other way, which is what you change when the door would otherwise open onto
/// a wall or block a light switch.
///
/// Returned as the hinge point plus the unit vector from the hinge towards the
/// far edge of the opening, so everything that has to draw or hit-test a door
/// works from the same answer: the 2D arc, the 3D leaf and the selection.
export function doorHinge(wall, door) {
  const dir = wallDirection(wall);
  const atEnd = !!door.hingeAtEnd;
  const hinge = wallPointAt(wall, atEnd ? door.offset + door.width : door.offset);
  const towards = atEnd ? -1 : 1;
  return {
    point: hinge,
    // Along the wall, from the hinge to the other edge of the opening.
    along: { x: dir.x * towards, z: dir.z * towards },
    // The far edge itself, which is where a closed leaf reaches to.
    far: wallPointAt(wall, atEnd ? door.offset : door.offset + door.width),
    // Which way the leaf sweeps, as a quarter turn from hinge-towards-far.
    //
    // The compensation matters: turning the door round reverses that reference
    // direction, so a quarter turn the same way would land the leaf on the
    // OTHER side of the wall. A door turned round opens the other way into the
    // same room — it does not move to the room behind.
    swingSign: (door.swingInside ? 1 : -1) * (atEnd ? -1 : 1),
  };
}

/// A door is selectable anywhere in its gap or its swing area; a window is
/// selectable anywhere along its gap in the wall.
export function openingNear(room, p, tolerance = 0.25) {
  let best = null;
  const consider = (kind, o) => {
    const wall = room.walls.find(w => w.id === o.wallID);
    if (!wall) return;
    const dir = wallDirection(wall);
    const perp = wallPerp(wall);
    const start = wallPointAt(wall, o.offset);
    const dx = p.x - start.x;
    const dz = p.z - start.z;
    const along = dx * dir.x + dz * dir.z;   // distance along the wall from the opening start
    const cross = dx * perp.x + dz * perp.z; // signed distance across the wall

    let hit = false;
    if (kind === "door") {
      // The gap in the wall, or the quarter-circle swept by the leaf — measured
      // from the HINGE, which may be at either end of the opening.
      const sign = o.swingInside ? 1 : -1;
      const swing = cross * sign;
      const inGap = along >= -tolerance && along <= o.width + tolerance
        && Math.abs(cross) <= tolerance;
      const fromHinge = o.hingeAtEnd ? o.width - along : along;
      const inArc = fromHinge >= -tolerance && swing >= -tolerance
        && fromHinge * fromHinge + swing * swing <= (o.width + tolerance) * (o.width + tolerance);
      hit = inGap || inArc;
    } else {
      hit = along >= -tolerance && along <= o.width + tolerance
        && Math.abs(cross) <= tolerance;
    }

    if (hit) {
      const center = wallPointAt(wall, o.offset + o.width / 2);
      const d = Math.hypot(along - o.width / 2, cross);
      if (!best || d < best.d) {
        best = { kind, id: o.id, wallID: o.wallID, center, d };
      }
    }
  };
  room.doors.forEach(o => consider("door", o));
  room.windows.forEach(o => consider("window", o));
  return best ? { kind: best.kind, id: best.id, wallID: best.wallID, center: best.center } : null;
}

export function furnitureFootprint(item) {
  const kind = furnitureKind(item.kind);
  // No entry, no footprint — see unknownFurnitureKind(). This is the loud end of
  // a decision whose quiet end is sanitize() dropping the item on load. An own
  // key only: `FURNITURE_KINDS["constructor"]` is truthy, and `kind.w` off it
  // is undefined, which is a footprint of NaN rather than a refusal.
  if (!kind) throw unknownFurnitureKind(item.kind);
  const swaps = item.rotationDegrees === 90 || item.rotationDegrees === 270;
  const w = swaps ? kind.d : kind.w;
  const d = swaps ? kind.w : kind.d;
  return {
    minX: item.center.x - w / 2,
    maxX: item.center.x + w / 2,
    minZ: item.center.z - d / 2,
    maxZ: item.center.z + d / 2,
  };
}

export function furnitureContains(item, p, tolerance = 0) {
  const f = furnitureFootprint(item);
  return p.x >= f.minX - tolerance && p.x <= f.maxX + tolerance
    && p.z >= f.minZ - tolerance && p.z <= f.maxZ + tolerance;
}

export function furnitureNear(room, p, tolerance = 0.02) {
  for (let i = room.furniture.length - 1; i >= 0; i--) {
    if (furnitureContains(room.furniture[i], p, tolerance)) return room.furniture[i];
  }
  return null;
}

/// Minimum distance between two axis-aligned footprints (0 when touching or
/// overlapping).
export function rectDistance(a, b) {
  const dx = Math.max(0, Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX));
  const dz = Math.max(0, Math.max(a.minZ, b.minZ) - Math.min(a.maxZ, b.maxZ));
  return Math.hypot(dx, dz);
}

/// Minimum distance from a footprint to an axis-aligned wall centreline.
export function wallRectDistance(wall, f) {
  const horizontal = Math.abs(wall.end.z - wall.start.z) < 1e-6;
  if (horizontal) {
    const z0 = wall.start.z;
    const x0 = Math.min(wall.start.x, wall.end.x);
    const x1 = Math.max(wall.start.x, wall.end.x);
    const dz = z0 < f.minZ ? f.minZ - z0 : z0 > f.maxZ ? z0 - f.maxZ : 0;
    const dx = x1 < f.minX ? f.minX - x1 : x0 > f.maxX ? x0 - f.maxX : 0;
    return Math.hypot(dx, dz);
  }
  const x0 = wall.start.x;
  const z0 = Math.min(wall.start.z, wall.end.z);
  const z1 = Math.max(wall.start.z, wall.end.z);
  const dx = x0 < f.minX ? f.minX - x0 : x0 > f.maxX ? x0 - f.maxX : 0;
  const dz = z1 < f.minZ ? f.minZ - z1 : z0 > f.maxZ ? z0 - f.maxZ : 0;
  return Math.hypot(dx, dz);
}
