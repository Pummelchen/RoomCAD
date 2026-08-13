// plan.js — room model and geometry for RoomCAD V2 web.
// Mirrors the native Swift app 1:1, including the .room JSON format, so rooms
// can be exchanged between the web version and the native app.

export const GRID_STEPS = {
  oneCentimeter:   { label: "1 cm", meters: 0.01 },
  twoCentimeters:  { label: "2 cm", meters: 0.02 },
  fiveCentimeters: { label: "5 cm", meters: 0.05 },
};

export const FURNITURE_KINDS = {
  bed:      { title: "Bed",      category: "furniture", w: 0.90, d: 2.00, h: 0.90, color: [0.30, 0.65, 0.85], label: "BED", standHeight: 0.44 },
  table:    { title: "Table",    category: "furniture", w: 0.70, d: 0.70, h: 0.75, color: [0.95, 0.72, 0.22], label: "TABLE", standHeight: 0.75 },
  chair:    { title: "Chair",    category: "furniture", w: 0.45, d: 0.47, h: 0.82, color: [0.90, 0.38, 0.32], label: "CHAIR", standHeight: 0.50 },
  wardrobe: { title: "Wardrobe", category: "furniture", w: 1.00, d: 0.60, h: 2.00, color: [0.82, 0.52, 0.28], label: "WARDROBE", standHeight: 2.00 },
  light:    { title: "Light",    category: "fixture",  w: 0.24, d: 0.24, h: 0.24, color: [0.98, 0.85, 0.35], label: "LIGHT", standHeight: 0, ceiling: true },
};

export const WALL_THICKNESS = 0.10;
export const SILL_HEIGHT = 0.90;
export const GLASS_HEIGHT = 1.00;
export const DOOR_HEIGHT = 2.10;
export const MIN_WALL_LENGTH = 0.30;
export const ROOM_FILE_FORMAT = "com.maria.roomcad-v2.room";
export const ROOM_FILE_VERSION = 1;

export function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

export function clean(v) {
  return Math.round(v * 1000) / 1000;
}

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

export function point(x = 0, z = 0) {
  return { x, z };
}

export function distance(a, b) {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

export function cm(v) {
  return Math.round(v * 100) + " cm";
}

export function freshRoom(name = "My Room", width = 6, length = 4, height = 2.6) {
  return {
    id: uid(),
    name,
    width,
    length,
    height,
    grid: "fiveCentimeters",
    walls: [
      { id: uid(), start: point(0, 0), end: point(width, 0) },
      { id: uid(), start: point(width, 0), end: point(width, length) },
      { id: uid(), start: point(width, length), end: point(0, length) },
      { id: uid(), start: point(0, length), end: point(0, 0) },
    ],
    doors: [],
    windows: [],
    furniture: [],
  };
}

// MARK: - Grid and snapping

export function gridSnap(room, p) {
  const step = Math.max(GRID_STEPS[room.grid].meters, 0.001);
  const snap = v => clean(Math.round(v / step) * step);
  return { x: clamp(snap(p.x), 0, room.width), z: clamp(snap(p.z), 0, room.length) };
}

export function snapPoint(room, raw, excludeWallID = null) {
  const p = { x: clamp(raw.x, 0, room.width), z: clamp(raw.z, 0, room.length) };
  const tolerance = Math.max(0.12, GRID_STEPS[room.grid].meters * 1.5);
  let best = null;
  const consider = candidate => {
    const d = distance(candidate, p);
    if (d <= tolerance && (!best || d < best.d)) best = { p: candidate, d };
  };
  consider(point(0, 0));
  consider(point(room.width, 0));
  consider(point(0, room.length));
  consider(point(room.width, room.length));
  for (const wall of room.walls) {
    if (wall.id === excludeWallID) continue;
    consider(wall.start);
    consider(wall.end);
    consider(wallMidpoint(wall));
  }
  return best ? best.p : gridSnap(room, p);
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
  let end = axisAligned(rawEnd, start);
  const tolerance = Math.max(0.12, GRID_STEPS[room.grid].meters * 1.5);
  let best = null;
  const consider = candidate => {
    // Only accept candidates that share a line with the start, so the wall
    // stays perfectly horizontal or vertical.
    if (Math.abs(candidate.x - start.x) > 0.001 && Math.abs(candidate.z - start.z) > 0.001) return;
    const d = distance(candidate, end);
    if (d <= tolerance && (!best || d < best.d)) best = { p: candidate, d };
  };
  consider(point(0, 0));
  consider(point(room.width, 0));
  consider(point(0, room.length));
  consider(point(room.width, room.length));
  for (const wall of room.walls) {
    consider(wall.start);
    consider(wall.end);
    consider(wallMidpoint(wall));
  }
  if (best) return best.p;
  const snapped = gridSnap(room, end);
  // Keep the shared axis coordinate exact so the wall stays connected to its
  // starting point, even when that point is off the plain grid.
  if (Math.abs(end.x - start.x) <= 0.0001) snapped.x = start.x;
  else snapped.z = start.z;
  return snapped;
}

// MARK: - Walls

export function wallLength(w) {
  return distance(w.start, w.end);
}

export function wallDirection(w) {
  const dx = w.end.x - w.start.x;
  const dz = w.end.z - w.start.z;
  const len = Math.max(Math.hypot(dx, dz), 0.0001);
  return { x: dx / len, z: dz / len };
}

export function wallPerp(w) {
  const d = wallDirection(w);
  return { x: -d.z, z: d.x };
}

export function wallMidpoint(w) {
  return { x: (w.start.x + w.end.x) / 2, z: (w.start.z + w.end.z) / 2 };
}

export function wallPointAt(w, offset) {
  const d = wallDirection(w);
  const o = clamp(offset, 0, wallLength(w));
  return { x: w.start.x + d.x * o, z: w.start.z + d.z * o };
}

export function wallProjection(w, p) {
  const dx = w.end.x - w.start.x;
  const dz = w.end.z - w.start.z;
  const lenSq = dx * dx + dz * dz;
  if (lenSq <= 0.0001) {
    return { point: { ...w.start }, offset: 0, distance: distance(w.start, p) };
  }
  const t = clamp(((p.x - w.start.x) * dx + (p.z - w.start.z) * dz) / lenSq, 0, 1);
  const proj = { x: w.start.x + dx * t, z: w.start.z + dz * t };
  return { point: proj, offset: wallLength(w) * t, distance: distance(proj, p) };
}

export function translateWall(w, dx, dz, width, length) {
  return {
    ...w,
    start: { x: clamp(w.start.x + dx, 0, width), z: clamp(w.start.z + dz, 0, length) },
    end: { x: clamp(w.end.x + dx, 0, width), z: clamp(w.end.z + dz, 0, length) },
  };
}

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
      // The gap in the wall, or the quarter-circle swept by the leaf.
      const sign = o.swingInside ? 1 : -1;
      const swing = cross * sign;
      const inGap = along >= -tolerance && along <= o.width + tolerance
        && Math.abs(cross) <= tolerance;
      const inArc = along >= -tolerance && swing >= -tolerance
        && along * along + swing * swing <= (o.width + tolerance) * (o.width + tolerance);
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
  const kind = FURNITURE_KINDS[item.kind];
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

// MARK: - Opening spacing

export function openingSpacing(room, id, kind) {
  const o = kind === "door" ? room.doors.find(d => d.id === id) : room.windows.find(w => w.id === id);
  if (!o) return null;
  const wall = room.walls.find(w => w.id === o.wallID);
  if (!wall) return null;
  const others = [];
  room.doors.forEach(d => {
    if (d.wallID === o.wallID && d.id !== id) others.push({ offset: d.offset, width: d.width });
  });
  room.windows.forEach(w => {
    if (w.wallID === o.wallID && w.id !== id) others.push({ offset: w.offset, width: w.width });
  });
  const previous = others.filter(x => x.offset + x.width <= o.offset)
    .sort((a, b) => a.offset - b.offset).pop();
  const next = others.filter(x => x.offset >= o.offset + o.width)
    .sort((a, b) => a.offset - b.offset)[0];
  return {
    toWallStart: o.offset,
    toWallEnd: wallLength(wall) - o.offset - o.width,
    gapToPrevious: previous ? o.offset - (previous.offset + previous.width) : null,
    gapToNext: next ? next.offset - (o.offset + o.width) : null,
  };
}

export function openingWall(room, id, kind) {
  const o = kind === "door" ? room.doors.find(d => d.id === id) : room.windows.find(w => w.id === id);
  return o ? room.walls.find(w => w.id === o.wallID) || null : null;
}

export function clampedOpeningOffset(room, offset, width, wallID) {
  const wall = room.walls.find(w => w.id === wallID);
  if (!wall) return null;
  return clamp(offset, 0.10, wallLength(wall) - width - 0.10);
}

// MARK: - Wall slicing for the 3D view

export function solidSpans(length, cuts) {
  const spans = [];
  let cursor = 0;
  const sorted = [...cuts].sort((a, b) => a.from - b.from);
  for (const cut of sorted) {
    const from = Math.max(cut.from, cursor);
    const to = Math.min(cut.to, length);
    if (from > cursor) spans.push({ from: cursor, to: Math.min(from, length) });
    cursor = Math.max(cursor, to);
  }
  if (cursor < length) spans.push({ from: cursor, to: length });
  return spans;
}

export function wallBuildPlan(wall, doors, windows, height) {
  const doorSpans = doors
    .filter(d => d.wallID === wall.id)
    .sort((a, b) => a.offset - b.offset)
    .map(d => ({ from: d.offset, to: d.offset + d.width }));
  const windowSpans = windows
    .filter(w => w.wallID === wall.id)
    .sort((a, b) => a.offset - b.offset)
    .map(w => ({ from: w.offset, to: w.offset + w.width }));
  const length = wallLength(wall);
  return {
    doorSpans,
    windowSpans,
    baseSpans: solidSpans(length, doorSpans),
    midSpans: solidSpans(length, [...doorSpans, ...windowSpans]),
    glassSpans: windowSpans,
    stripSpans: windowSpans,
    headerSpan: { from: 0, to: length },
    doorLeafSpans: doorSpans,
  };
}

// MARK: - Furniture placement

/// Photo-derived 60 × 60 cm floor tile layout: full tiles plus a cut strip at
/// the far walls (the survey module came from the photos; for the 4.87 × 16.44
/// room this is 8 full + 0.07 m across and 27 full + 0.24 m down).
export function tileLayout(room) {
  const tile = 0.6;
  function axis(length) {
    const quotient = length / tile;
    if (Math.abs(quotient - Math.round(quotient)) < 0.001) {
      return { full: Math.round(quotient), cut: 0 };
    }
    const full = Math.floor(quotient);
    return { full, cut: length - full * tile };
  }
  const across = axis(room.width);
  const down = axis(room.length);
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

export function isFurniturePlacementValid(room, item, excluded = new Set()) {
  const f = furnitureFootprint(item);
  if (f.minX < 0 || f.maxX > room.width || f.minZ < 0 || f.maxZ > room.length) return false;
  const itemIsFixture = FURNITURE_KINDS[item.kind].category === "fixture";
  return !room.furniture.some(other => {
    if (excluded.has(other.id)) return false;
    // Ceiling fixtures may hover above furniture, but not above other
    // fixtures (and floor furniture still can't overlap floor furniture).
    const otherIsFixture = FURNITURE_KINDS[other.kind].category === "fixture";
    if (itemIsFixture !== otherIsFixture) return false;
    const g = furnitureFootprint(other);
    return f.minX < g.maxX && f.maxX > g.minX && f.minZ < g.maxZ && f.maxZ > g.minZ;
  });
}

export function furnitureCenter(room, raw, item) {
  const kind = FURNITURE_KINDS[item.kind];
  const swaps = item.rotationDegrees === 90 || item.rotationDegrees === 270;
  const w = swaps ? kind.d : kind.w;
  const d = swaps ? kind.w : kind.d;
  const center = gridSnap(room, raw);
  center.x = clamp(center.x, w / 2, room.width - w / 2);
  center.z = clamp(center.z, d / 2, room.length - d / 2);
  const tolerance = Math.max(GRID_STEPS[room.grid].meters * 1.5, 0.08);
  let bestX = null;
  let bestZ = null;
  for (const other of room.furniture) {
    if (other.id === item.id) continue;
    if (Math.abs(other.center.x - center.x) <= tolerance &&
        (bestX === null || Math.abs(other.center.x - center.x) < Math.abs(bestX - center.x))) {
      bestX = other.center.x;
    }
    if (Math.abs(other.center.z - center.z) <= tolerance &&
        (bestZ === null || Math.abs(other.center.z - center.z) < Math.abs(bestZ - center.z))) {
      bestZ = other.center.z;
    }
  }
  if (bestX !== null) center.x = bestX;
  if (bestZ !== null) center.z = bestZ;
  return center;
}

// MARK: - Walkthrough collision

export function blocksPlayer(room, p, radius) {
  const half = WALL_THICKNESS / 2 + 0.02;
  for (const w of wallCollisionSegments(room)) {
    if (wallProjection(w, p).distance <= radius + half) return true;
  }
  // Closed doors block the doorway; open doors leave it clear.
  for (const door of room.doors) {
    if (door.open === false) {
      const wall = room.walls.find(w => w.id === door.wallID);
      if (!wall) continue;
      const a = wallPointAt(wall, door.offset);
      const b = wallPointAt(wall, door.offset + door.width);
      if (wallProjection({ start: a, end: b }, p).distance <= radius + 0.03) return true;
    }
  }
  for (const item of room.furniture) {
    const f = furnitureFootprint(item);
    if (p.x >= f.minX - radius && p.x <= f.maxX + radius
      && p.z >= f.minZ - radius && p.z <= f.maxZ + radius) return true;
  }
  return false;
}

/// Collision segments for the walls: each wall is split by its door openings,
/// so open doorways are passable (closed doors are handled separately).
export function wallCollisionSegments(room) {
  const segments = [];
  for (const wall of room.walls) {
    const doorCuts = room.doors
      .filter(d => d.wallID === wall.id)
      .map(d => ({ from: d.offset, to: d.offset + d.width }));
    for (const span of solidSpans(wallLength(wall), doorCuts)) {
      segments.push({
        start: wallPointAt(wall, span.from),
        end: wallPointAt(wall, span.to),
      });
    }
  }
  return segments;
}

/// The highest surface the player can stand on at (x, z), given their current
/// feet height. Floor is 0; furniture tops count only when they're at or below
/// the player's feet (so you land on them, not under them).
export function supportHeight(room, x, z, feetY) {
  let ground = 0;
  for (const item of room.furniture) {
    const stand = FURNITURE_KINDS[item.kind].standHeight;
    if (stand > feetY + 0.001) continue;
    const f = furnitureFootprint(item);
    if (x >= f.minX && x <= f.maxX && z >= f.minZ && z <= f.maxZ) {
      ground = Math.max(ground, stand);
    }
  }
  return ground;
}

/// Pushes a player position out of walls, closed doors, and furniture, so it
/// can never stay stuck inside geometry. Returns the resolved position.
/// `feetY` makes furniture height-aware: furniture only blocks when the player
/// is below its top surface.
export function resolvePlayer(room, pos, radius, feetY = 0) {
  let x = pos.x;
  let z = pos.z;
  const wallClearance = WALL_THICKNESS / 2 + 0.02;
  const wallSegments = wallCollisionSegments(room);

  for (let iter = 0; iter < 6; iter++) {
    let moved = false;

    for (const segment of wallSegments) {
      const proj = wallProjection(segment, { x, z });
      const minDist = radius + wallClearance;
      if (proj.distance < minDist) {
        const dx = x - proj.point.x;
        const dz = z - proj.point.z;
        const len = Math.hypot(dx, dz);
        if (len < 1e-6) {
          const perp = wallPerp(segment);
          x += perp.x * minDist;
          z += perp.z * minDist;
        } else {
          const push = minDist - proj.distance;
          x += (dx / len) * push;
          z += (dz / len) * push;
        }
        moved = true;
      }
    }

    for (const door of room.doors) {
      if (door.open !== false) continue;
      const wall = room.walls.find(w => w.id === door.wallID);
      if (!wall) continue;
      const seg = {
        start: wallPointAt(wall, door.offset),
        end: wallPointAt(wall, door.offset + door.width),
      };
      const proj = wallProjection(seg, { x, z });
      const minDist = radius + 0.03;
      if (proj.distance < minDist) {
        const dx = x - proj.point.x;
        const dz = z - proj.point.z;
        const len = Math.hypot(dx, dz) || 1;
        x += (dx / len) * (minDist - proj.distance);
        z += (dz / len) * (minDist - proj.distance);
        moved = true;
      }
    }

    for (const item of room.furniture) {
      // On or above the top surface: walkable (jump onto, stand on, walk off).
      if (feetY >= FURNITURE_KINDS[item.kind].standHeight - 0.10) continue;
      const f = furnitureFootprint(item);
      const cx = clamp(x, f.minX, f.maxX);
      const cz = clamp(z, f.minZ, f.maxZ);
      const dx = x - cx;
      const dz = z - cz;
      const dist = Math.hypot(dx, dz);
      if (dist < radius) {
        if (dist < 1e-6) {
          // The player center is inside the footprint: escape along the
          // nearest edge.
          const left = x - f.minX;
          const right = f.maxX - x;
          const top = z - f.minZ;
          const bottom = f.maxZ - z;
          const m = Math.min(left, right, top, bottom);
          if (m === left) x = f.minX - radius - 0.001;
          else if (m === right) x = f.maxX + radius + 0.001;
          else if (m === top) z = f.minZ - radius - 0.001;
          else z = f.maxZ + radius + 0.001;
        } else {
          const push = radius - dist;
          x += (dx / dist) * push;
          z += (dz / dist) * push;
        }
        moved = true;
      }
    }

    if (!moved) break;
  }

  return { x, z };
}

// MARK: - Sanitizing

export function sanitize(room) {
  room.width = clamp(room.width, 2, 20);
  room.length = clamp(room.length, 2, 20);
  room.height = clamp(room.height, 2.2, 5);

  room.walls = room.walls
    .filter(w => wallLength(w) >= 0.15)
    .map(w => ({
      ...w,
      start: { x: clamp(w.start.x, 0, room.width), z: clamp(w.start.z, 0, room.length) },
      end: { x: clamp(w.end.x, 0, room.width), z: clamp(w.end.z, 0, room.length) },
    }));
  const wallIDs = new Set(room.walls.map(w => w.id));

  room.doors = room.doors
    .map(d => ({
      ...d,
      width: clamp(d.width, 0.6, 1.4),
      open: d.open === undefined ? true : !!d.open,
      swingInside: d.swingInside === undefined ? true : !!d.swingInside,
    }))
    .filter(d => {
      if (!wallIDs.has(d.wallID)) return false;
      const w = room.walls.find(x => x.id === d.wallID);
      return w && wallLength(w) >= d.width + 0.2;
    });
  room.doors.forEach(d => {
    const w = room.walls.find(x => x.id === d.wallID);
    if (w) d.offset = clamp(d.offset, 0.10, wallLength(w) - d.width - 0.10);
  });

  room.windows = room.windows
    .map(w => ({ ...w, width: clamp(w.width, 0.4, 2.0) }))
    .filter(w => {
      if (!wallIDs.has(w.wallID)) return false;
      const wall = room.walls.find(x => x.id === w.wallID);
      return wall && wallLength(wall) >= w.width + 0.2;
    });
  room.windows.forEach(w => {
    const wall = room.walls.find(x => x.id === w.wallID);
    if (wall) w.offset = clamp(w.offset, 0.10, wallLength(wall) - w.width - 0.10);
  });

  room.furniture = room.furniture.map(item => {
    item.rotationDegrees = ((Math.round(item.rotationDegrees / 90) * 90) % 360 + 360) % 360;
    const kind = FURNITURE_KINDS[item.kind];
    const swaps = item.rotationDegrees === 90 || item.rotationDegrees === 270;
    const w = swaps ? kind.d : kind.w;
    const d = swaps ? kind.w : kind.d;
    item.center = {
      x: clamp(item.center.x, w / 2, room.width - w / 2),
      z: clamp(item.center.z, d / 2, room.length - d / 2),
    };
    return item;
  });
}

// MARK: - The seven-room demo (restored from the original Swift plan)

function frontFurnitureSet(bounds) {
  const clearance = 0.05;
  // Front beds face east (rotation 90°): 2.00 × 0.90 footprint.
  const bedWidth = 2.00;
  const bedDepth = 0.90;
  const bedCenter = point(bounds.minX + clearance + bedWidth / 2, bounds.minZ + clearance + bedDepth / 2);
  return [
    { id: uid(), kind: "bed", center: bedCenter, rotationDegrees: 90 },
    {
      id: uid(), kind: "chair",
      center: point(bedCenter.x + bedWidth / 2 + 0.15 + 0.45 / 2, bounds.minZ + clearance + 0.47 / 2),
      rotationDegrees: 0,
    },
    {
      id: uid(), kind: "wardrobe",
      center: point(bounds.minX + clearance + 1.0 / 2, bounds.maxZ - clearance - 0.6 / 2),
      rotationDegrees: 0,
    },
  ];
}

function rearFurnitureSet(bounds) {
  const clearance = 0.05;
  return [
    {
      id: uid(), kind: "bed",
      center: point(bounds.minX + clearance + 0.9 / 2, bounds.minZ + clearance + 2.0 / 2),
      rotationDegrees: 0,
    },
    {
      id: uid(), kind: "wardrobe",
      center: point(bounds.minX + clearance + 0.6 / 2, bounds.minZ + 4.30),
      rotationDegrees: 90,
    },
    {
      id: uid(), kind: "chair",
      center: point(bounds.minX + clearance + 0.45 / 2, bounds.minZ + 2.35),
      rotationDegrees: 0,
    },
  ];
}

/// The original bathroom-connected concept: six front rooms, a rear Room 7,
/// and the fixed stair/bathroom core at the back. This is the default room.
export function demoRoom() {
  const room = freshRoom("7-Room Demo", 4.87, 16.44, 3.60);
  room.walls = [];
  room.doors = [];
  room.windows = [];
  room.furniture = [];

  const core = stairBathroomLayout(room);

  // Outer shell
  room.walls.push(
    { id: uid(), start: point(0, 0), end: point(room.width, 0) },
    { id: uid(), start: point(room.width, 0), end: point(room.width, room.length) },
    { id: uid(), start: point(room.width, room.length), end: point(0, room.length) },
    { id: uid(), start: point(0, room.length), end: point(0, 0) },
  );

  // Front rooms
  const corridorMinX = core.lowerOpening.minX;
  const frontRoomCount = 6;
  const standardDepth = 1.70;
  const lastFrontStart = standardDepth * (frontRoomCount - 1);
  const turnConnector = {
    minX: core.upperFlight.minX,
    maxX: core.lowerOpening.maxX,
    minZ: core.core.minZ - 0.90,
    maxZ: core.core.minZ,
  };

  for (let index = 0; index < frontRoomCount; index++) {
    const isLast = index === frontRoomCount - 1;
    const startZ = isLast ? lastFrontStart : index * standardDepth;
    const endZ = isLast ? core.core.minZ : (index + 1) * standardDepth;
    const entranceEndZ = isLast ? turnConnector.minZ : endZ;
    const entranceWall = {
      id: uid(),
      start: point(corridorMinX, startZ),
      end: point(corridorMinX, entranceEndZ),
    };
    const entranceLength = wallLength(entranceWall);
    const doorWidth = Math.min(0.90, Math.max(0.60, entranceLength - 0.20));
    const door = {
      id: uid(),
      wallID: entranceWall.id,
      offset: Math.max(0, (entranceLength - doorWidth) / 2),
      width: doorWidth,
      open: true,
      swingInside: true,
    };
    room.walls.push(entranceWall);
    room.doors.push(door);

    if (isLast) {
      room.walls.push(
        { id: uid(), start: point(core.upperFlight.minX, turnConnector.minZ), end: point(corridorMinX, turnConnector.minZ) },
        { id: uid(), start: point(core.upperFlight.minX, turnConnector.minZ), end: point(core.upperFlight.minX, endZ) },
        { id: uid(), start: point(0, endZ), end: point(core.upperFlight.minX, endZ) },
      );
    } else {
      room.walls.push({ id: uid(), start: point(0, endZ), end: point(corridorMinX, endZ) });
    }

    room.furniture.push(...frontFurnitureSet({
      minX: 0, maxX: corridorMinX, minZ: startZ, maxZ: endZ,
    }));
  }

  // Rear Room 7
  const rearStartZ = core.core.minZ;
  const rearBounds = { minX: 0, maxX: core.rearWindowEndX, minZ: rearStartZ, maxZ: room.length };
  const rearEntranceWall = {
    id: uid(),
    start: point(1.10, rearStartZ),
    end: point(1.10, core.upperFlight.maxZ),
  };
  const rearDoor = {
    id: uid(),
    wallID: rearEntranceWall.id,
    offset: core.upperFlight.minZ - rearStartZ - 0.80,
    width: 0.90,
    open: true,
    swingInside: true,
  };
  room.walls.push(
    rearEntranceWall,
    { id: uid(), start: point(1.10, core.upperFlight.maxZ), end: point(core.rearWindowEndX, core.upperFlight.maxZ) },
    { id: uid(), start: point(core.rearWindowEndX, core.upperFlight.maxZ), end: point(core.rearWindowEndX, room.length) },
  );
  room.doors.push(rearDoor);
  room.furniture.push(...rearFurnitureSet(rearBounds));

  // The two-pane rear window of Room 7
  const rearWall = room.walls.find(w => w.start.x === 0 && w.start.z === room.length);
  if (rearWall) {
    room.windows.push(
      { id: uid(), wallID: rearWall.id, offset: 0.08, width: 0.72 },
      { id: uid(), wallID: rearWall.id, offset: 0.88, width: 0.72 },
    );
  }

  return room;
}

// MARK: - Room files (same format as the native app)

export function serializeRoom(room) {
  return JSON.stringify(
    { format: ROOM_FILE_FORMAT, version: ROOM_FILE_VERSION, room },
    null,
    2
  );
}

export function parseRoom(text) {
  const data = JSON.parse(text);
  if (!data || data.format !== ROOM_FILE_FORMAT) {
    throw new Error("This is not a RoomCAD V2 room file.");
  }
  if (data.version > ROOM_FILE_VERSION) {
    throw new Error("This room uses a newer format version.");
  }
  const room = data.room;
  if (!room || typeof room !== "object") {
    throw new Error("This file does not contain a room.");
  }
  room.id = room.id || uid();
  room.name = room.name || "My Room";
  room.width = Number(room.width) || 6;
  room.length = Number(room.length) || 4;
  room.height = Number(room.height) || 2.6;
  room.grid = GRID_STEPS[room.grid] ? room.grid : "fiveCentimeters";
  room.walls = Array.isArray(room.walls) ? room.walls : [];
  room.doors = Array.isArray(room.doors) ? room.doors : [];
  room.windows = Array.isArray(room.windows) ? room.windows : [];
  room.furniture = Array.isArray(room.furniture) ? room.furniture : [];
  sanitize(room);
  return room;
}
