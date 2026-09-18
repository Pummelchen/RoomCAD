// Furniture placement: tile and stair/bathroom helpers, clash tests, snap lines and centres.
//
// Part of the plan model; the public entry point is ../plan.js, which re-exports
// every module here.

import { WALL_THICKNESS, clamp, clean, furnitureKind, gridStep, unknownFurnitureKind } from "./core.js";
import { furnitureFootprint } from "./hit.js";
import { solidSpans } from "./openings.js";
import { canvasOf } from "./room.js";
import { wallEndSeals, wallLength, wallPointAt } from "./walls.js";


// MARK: - Furniture placement

/// Photo-derived 60 × 60 cm floor tile layout: full tiles plus a cut strip at
/// the far walls (the survey module came from the photos; for the 4.87 × 16.44
/// room this is 8 full + 0.07 m across and 27 full + 0.24 m down).
export function tileLayout(width, length) {
  const tile = 0.6;
  function axis(size) {
    const quotient = size / tile;
    if (Math.abs(quotient - Math.round(quotient)) < 0.001) {
      return { full: Math.round(quotient), cut: 0 };
    }
    const full = Math.floor(quotient);
    return { full, cut: size - full * tile };
  }
  const across = axis(width);
  const down = axis(length);
  return {
    tile,
    fullColumns: across.full,
    fullRows: down.full,
    widthCut: across.cut,
    lengthCut: down.cut,
    columns: across.full + (across.cut > 0.001 ? 1 : 0),
    rows: down.full + (down.cut > 0.001 ? 1 : 0),
  };
}

/// Geometry of the survey's rear stair/bathroom core. Used to lay out the
/// demo room; the core itself is no longer drawn (placeholders removed).
export function stairBathroomLayout(room) {
  const stairCoreLength = Math.min(6.0, Math.max(2.0, room.length - 1));
  const stairCoreWidth = Math.min(2.5, Math.max(1.2, room.width - 0.4));
  const rect = (minX, maxX, minZ, maxZ) => ({ minX, maxX, minZ, maxZ });

  const coreStart = room.length - stairCoreLength;
  const landingLength = Math.min(3.50, stairCoreLength - 1.0);
  const rearBlockStart = coreStart + landingLength;
  const lowerWidth = Math.min(1.15, room.width - 1.0);
  const lowerMinX = room.width - lowerWidth;
  const bathroomMinX = Math.max(0, room.width - 1.75);
  const upperStartX = Math.min(2.40, lowerMinX - 0.60);
  const landingMinX = Math.max(upperStartX, lowerMinX - 1.35);
  const upperFlightDepth = Math.min(1.35, room.length - rearBlockStart);
  const upperFlightEnd = rearBlockStart + upperFlightDepth;

  return {
    core: rect(Math.max(0, room.width - stairCoreWidth), room.width, coreStart, room.length),
    bathroom: rect(bathroomMinX, room.width, upperFlightEnd, room.length),
    upperFlight: rect(upperStartX, room.width, rearBlockStart, upperFlightEnd),
    landing: rect(landingMinX, lowerMinX, coreStart, rearBlockStart),
    lowerOpening: rect(lowerMinX, room.width, coreStart, rearBlockStart),
    lowerCoveredFlight: rect(lowerMinX, room.width, rearBlockStart, upperFlightEnd),
    lowerUnderBathroom: rect(lowerMinX, room.width, upperFlightEnd, room.length),
    rearWindowStartX: 0.08,
    rearWindowEndX: Math.max(0.08 + 0.50, bathroomMinX - 1.52),
  };
}

/// True when the item's footprint overlaps any wall band (the physical wall
/// thickness). Touching a wall face (0 cm) is fine; only strict overlap is a
/// problem, so furniture can sit flush against a wall but never pass through it.
export function furnitureIntersectsWall(room, item) {
  const f = furnitureFootprint(item);
  const half = WALL_THICKNESS / 2;
  const EPS = 1e-6; // tolerate float noise so a 0 cm flush placement stays valid
  for (const wall of room.walls) {
    const minX = Math.min(wall.start.x, wall.end.x);
    const maxX = Math.max(wall.start.x, wall.end.x);
    const minZ = Math.min(wall.start.z, wall.end.z);
    const maxZ = Math.max(wall.start.z, wall.end.z);
    const horizontal = Math.abs(wall.end.z - wall.start.z) < 1e-6;
    const bx0 = horizontal ? minX : minX - half;
    const bx1 = horizontal ? maxX : maxX + half;
    const bz0 = horizontal ? minZ - half : minZ;
    const bz1 = horizontal ? maxZ + half : maxZ;
    if (f.minX < bx1 - EPS && f.maxX > bx0 + EPS && f.minZ < bz1 - EPS && f.maxZ > bz0 + EPS) return true;
  }
  return false;
}

export function isFurniturePlacementValid(room, item, excluded = new Set()) {
  // A kind with no palette entry has no footprint to test, and a document that
  // names one cannot be loaded at all: sanitize() drops those items, and this is
  // the same rule one step earlier, so a caller holding an un-repaired item gets
  // "that cannot go here" instead of a TypeError. An own key only — see
  // furnitureKind().
  const itemKind = furnitureKind(item.kind);
  if (!itemKind) return false;
  const f = furnitureFootprint(item);
  const canvas = canvasOf(room);
  if (f.minX < 0 || f.maxX > canvas.width || f.minZ < 0 || f.maxZ > canvas.length) return false;
  if (furnitureIntersectsWall(room, item)) return false;
  const itemIsFixture = itemKind.category === "fixture";
  return !room.furniture.some(other => {
    if (excluded.has(other.id)) return false;
    const otherKind = furnitureKind(other.kind);
    // An item this build cannot measure is not something a placement can be
    // said to collide with; sanitize() would have dropped it on load anyway.
    if (!otherKind) return false;
    // Ceiling fixtures may hover above furniture, but not above other
    // fixtures (and floor furniture still can't overlap floor furniture).
    const otherIsFixture = otherKind.category === "fixture";
    if (itemIsFixture !== otherIsFixture) return false;
    const g = furnitureFootprint(other);
    return f.minX < g.maxX && f.maxX > g.minX && f.minZ < g.maxZ && f.maxZ > g.minZ;
  });
}

/// Lines a piece can lock onto along one axis. RoomCAD snaps things onto each
/// other rather than asking for exact numbers, so the candidates are the parts
/// you can actually see: the faces of the walls that run across this axis, the
/// ends of the walls that run along it, and the edges and centres of the
/// pieces already placed.
///
function furnitureSnapLines(room, item, axis) {
  const half = WALL_THICKNESS / 2;
  const lines = [];
  for (const wall of room.walls) {
    // Only a wall lying across the way the piece is travelling can be pushed
    // against. A wall's *ends* are not worth offering: walls are drawn on the
    // grid, so an end is already a position the grid can reach.
    const horizontal = Math.abs(wall.end.z - wall.start.z) < 1e-6;
    if (axis === (horizontal ? "x" : "z")) continue;
    lines.push(wall.start[axis] - half, wall.start[axis] + half);
  }
  for (const other of room.furniture) {
    if (other.id === item.id) continue;
    const f = furnitureFootprint(other);
    lines.push(axis === "x" ? f.minX : f.minZ);
    lines.push(axis === "x" ? f.maxX : f.maxZ);
    lines.push(other.center[axis]);
  }
  return lines;
}

export function furnitureCenter(room, raw, item) {
  const kind = furnitureKind(item.kind);
  // As in furnitureFootprint(): no entry means no size, and no size can be
  // guessed. sanitize() is what keeps this unreachable for a loaded document.
  if (!kind) throw unknownFurnitureKind(item.kind);
  const swaps = item.rotationDegrees === 90 || item.rotationDegrees === 270;
  const w = swaps ? kind.d : kind.w;
  const d = swaps ? kind.w : kind.d;
  const canvas = canvasOf(room);
  const step = Math.max(gridStep(room.grid).meters, 0.001);

  const place = (want, size, limit, lines) => {
    /// Steps are counted from the near edge, not the centre. Half a chair is
    /// 22.5 cm, so a centre on the grid puts its edge half a step off it, and
    /// the piece can never be pushed flat against a wall — the closest grid
    /// position is either 5 mm inside the wall (red) or 5 mm shy of it.
    let best = clean(Math.round((want - size / 2) / step) * step + size / 2);
    /// The lines are offered as *extra* grid positions rather than as magnets
    /// with a reach of their own, and the nearest one wins. That is what keeps
    /// the grid honest: the choices are a superset of the grid, so every nudge
    /// of one step still moves the piece. The old version pulled from 8 cm
    /// away whatever the grid said, which on a 1 cm grid meant fifteen
    /// different drags all landing on the same spot.
    for (const line of lines) {
      // Either edge of the piece may meet the line, or its middle sit on it.
      for (const candidate of [line + size / 2, line, line - size / 2]) {
        // Ties go to the line, so a piece pushed at a wall lands flat on it.
        if (Math.abs(candidate - want) <= Math.abs(best - want)) best = clean(candidate);
      }
    }
    return clamp(best, size / 2, Math.max(size / 2, limit - size / 2));
  };

  return {
    x: place(raw.x, w, canvas.width, furnitureSnapLines(room, item, "x")),
    z: place(raw.z, d, canvas.length, furnitureSnapLines(room, item, "z")),
  };
}

// MARK: - Walkthrough collision

/// Collision segments for the walls: each wall is split by its door openings,
/// so open doorways are passable (closed doors are handled separately). The
/// real wall ends are marked so the physics layer can overlap snapped joints
/// without enlarging a doorway.
export function wallCollisionSegments(room) {
  const segments = [];
  for (const wall of room.walls) {
    const length = wallLength(wall);
    const seals = wallEndSeals(room, wall);
    const doorCuts = room.doors
      .filter(d => d.wallID === wall.id)
      .map(d => ({ from: d.offset, to: d.offset + d.width }));
    for (const span of solidSpans(length, doorCuts)) {
      const atWallStart = span.from <= 0.001;
      const atWallEnd = span.to >= length - 0.001;
      segments.push({
        // Which wall this piece came from, so a caller can line it up with
        // things measured along that wall — window openings, for one.
        wallID: wall.id,
        start: wallPointAt(wall, span.from),
        end: wallPointAt(wall, span.to),
        atWallStart,
        atWallEnd,
        // Only a true wall end that meets another wall is extended, so a
        // doorway never narrows and a free end never grows.
        startSeal: atWallStart ? seals.start : 0,
        endSeal: atWallEnd ? seals.end : 0,
      });
    }
  }
  return segments;
}
