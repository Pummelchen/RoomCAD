// plan.js — room model and geometry for RoomCAD web.
// Mirrors the native Swift app 1:1, including the .room JSON format, so rooms
// can be exchanged between the web version and the native app.

export const GRID_STEPS = {
  oneCentimeter:   { label: "1 cm", meters: 0.01 },
  twoCentimeters:  { label: "2 cm", meters: 0.02 },
  fiveCentimeters: { label: "5 cm", meters: 0.05 },
};

export const FURNITURE_KINDS = {
  bed:      { title: "Bed",       category: "furniture", w: 0.90, d: 2.00, h: 0.90, color: [0.30, 0.65, 0.85], label: "BED", standHeight: 0.44 },
  table:    { title: "Table",     category: "furniture", w: 0.70, d: 0.70, h: 0.75, color: [0.95, 0.72, 0.22], label: "TABLE", standHeight: 0.75 },
  chair:    { title: "Chair",     category: "furniture", w: 0.45, d: 0.47, h: 0.82, color: [0.90, 0.38, 0.32], label: "CHAIR", standHeight: 0.50 },
  wardrobe: { title: "Wardrobe",  category: "furniture", w: 1.00, d: 0.60, h: 2.00, color: [0.82, 0.52, 0.28], label: "WARDROBE", standHeight: 2.00 },
  desk:     { title: "Desk",      category: "furniture", w: 1.20, d: 0.60, h: 0.75, color: [0.62, 0.42, 0.28], label: "DESK", standHeight: 0.75 },
  sofa:     { title: "Sofa",      category: "furniture", w: 1.80, d: 0.85, h: 0.85, color: [0.45, 0.55, 0.68], label: "SOFA", standHeight: 0.42 },
  shelf:    { title: "Bookshelf", category: "furniture", w: 0.80, d: 0.30, h: 1.80, color: [0.75, 0.58, 0.40], label: "SHELF", standHeight: 0 },
  nightstand: { title: "Nightstand", category: "furniture", w: 0.40, d: 0.35, h: 0.50, color: [0.55, 0.45, 0.35], label: "NIGHT", standHeight: 0.50 },
  dresser:  { title: "Dresser",   category: "furniture", w: 0.90, d: 0.45, h: 1.00, color: [0.48, 0.42, 0.55], label: "DRESSER", standHeight: 1.00 },
  armchair: { title: "Armchair",  category: "furniture", w: 0.75, d: 0.80, h: 0.90, color: [0.55, 0.40, 0.30], label: "ARMCHAIR", standHeight: 0.42 },
  light:      { title: "Bulb",        category: "fixture", w: 0.24, d: 0.24, h: 0.24, color: [0.98, 0.85, 0.35], label: "BULB",  standHeight: 0, ceiling: true, watts: 60 },
  lightPanel: { title: "Office Panel", category: "fixture", w: 0.60, d: 0.60, h: 0.06, color: [0.95, 0.97, 1.00], label: "PANEL", standHeight: 0, ceiling: true, watts: 200 },
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
    // The buildable base plate (25 × 25 m by default). The room sits inside it
    // at `origin`, so it can be centred on the grid.
    canvas: { width: 25, length: 25 },
    origin: { x: 0, z: 0 },
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
    publicAreas: [], // shared floor rectangles (living room, corridor…) excluded from auto-layout
  };
}

/// The buildable base-plate bounds. Falls back to the main room for rooms
/// saved before the canvas existed.
export function canvasOf(room) {
  if (room.canvas && typeof room.canvas.width === "number" && typeof room.canvas.length === "number") {
    return room.canvas;
  }
  return { width: room.width, length: room.length };
}

/// The room's bottom-left corner on the canvas (0,0 for rooms saved before the
/// origin field existed).
export function roomOrigin(room) {
  if (room.origin && typeof room.origin.x === "number" && typeof room.origin.z === "number") {
    return room.origin;
  }
  return { x: 0, z: 0 };
}

/// Shifts the room's walls and furniture so the room footprint is centred on
/// the canvas, and records the resulting origin.
export function centerRoom(room) {
  const canvas = canvasOf(room);
  const marginX = (canvas.width - room.width) / 2;
  const marginZ = (canvas.length - room.length) / 2;
  const prev = roomOrigin(room);
  const dx = marginX - prev.x;
  const dz = marginZ - prev.z;
  room.origin = { x: marginX, z: marginZ };
  if (dx !== 0 || dz !== 0) {
    room.walls = room.walls.map(w => ({
      ...w,
      start: { x: w.start.x + dx, z: w.start.z + dz },
      end: { x: w.end.x + dx, z: w.end.z + dz },
    }));
    room.furniture = room.furniture.map(f => ({
      ...f,
      center: { x: f.center.x + dx, z: f.center.z + dz },
    }));
  }
  return room;
}

// MARK: - Grid and snapping

export function gridSnap(room, p) {
  const step = Math.max(GRID_STEPS[room.grid].meters, 0.001);
  const snap = v => clean(Math.round(v / step) * step);
  const canvas = canvasOf(room);
  return { x: clamp(snap(p.x), 0, canvas.width), z: clamp(snap(p.z), 0, canvas.length) };
}

export function snapPoint(room, raw, excludeWallID = null) {
  const canvas = canvasOf(room);
  const p = { x: clamp(raw.x, 0, canvas.width), z: clamp(raw.z, 0, canvas.length) };
  const tolerance = Math.max(0.12, GRID_STEPS[room.grid].meters * 1.5);
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
  const canvas = canvasOf(room);
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
  consider(point(canvas.width, 0));
  consider(point(0, canvas.length));
  consider(point(canvas.width, canvas.length));
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

/// Snaps a dragged wall endpoint. Unlike `snapWallEnd`, the free end is not
/// locked to the wall's current axis: it can snap to the perpendicular axis
/// through the fixed end, so grabbing an endpoint can reorient the wall 90°.
export function snapWallEndpoint(room, raw, fixed) {
  const canvas = canvasOf(room);
  const end = axisAligned(
    { x: clamp(raw.x, 0, canvas.width), z: clamp(raw.z, 0, canvas.length) },
    fixed
  );
  const tolerance = Math.max(0.12, GRID_STEPS[room.grid].meters * 1.5);
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
    consider(wall.start);
    consider(wall.end);
    consider(wallMidpoint(wall));
  }
  if (best) return best.p;
  const snapped = gridSnap(room, end);
  // Keep the shared axis coordinate exact so the wall stays connected to its
  // fixed endpoint.
  if (Math.abs(end.x - fixed.x) <= 0.0001) snapped.x = fixed.x;
  else snapped.z = fixed.z;
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
  const f = furnitureFootprint(item);
  const canvas = canvasOf(room);
  if (f.minX < 0 || f.maxX > canvas.width || f.minZ < 0 || f.maxZ > canvas.length) return false;
  if (furnitureIntersectsWall(room, item)) return false;
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
  const canvas = canvasOf(room);
  center.x = clamp(center.x, w / 2, canvas.width - w / 2);
  center.z = clamp(center.z, d / 2, canvas.length - d / 2);
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

/// Collision segments for the walls: each wall is split by its door openings,
/// so open doorways are passable (closed doors are handled separately). The
/// real wall ends are marked so the physics layer can overlap snapped joints
/// without enlarging a doorway.
export function wallCollisionSegments(room) {
  const segments = [];
  for (const wall of room.walls) {
    const length = wallLength(wall);
    const doorCuts = room.doors
      .filter(d => d.wallID === wall.id)
      .map(d => ({ from: d.offset, to: d.offset + d.width }));
    for (const span of solidSpans(length, doorCuts)) {
      segments.push({
        start: wallPointAt(wall, span.from),
        end: wallPointAt(wall, span.to),
        atWallStart: span.from <= 0.001,
        atWallEnd: span.to >= length - 0.001,
      });
    }
  }
  return segments;
}

// MARK: - Sanitizing

export function sanitize(room) {
  room.width = clamp(room.width, 2, 20);
  room.length = clamp(room.length, 2, 20);
  room.height = clamp(room.height, 2.2, 5);

  // Canvas: the buildable base plate. Always at least as large as the main
  // room so walls and furniture drawn outside it stay reachable.
  if (!room.canvas) room.canvas = { width: room.width, length: room.length };
  room.canvas.width = clamp(room.canvas.width, 2, 60);
  room.canvas.length = clamp(room.canvas.length, 2, 60);
  if (room.canvas.width < room.width) room.canvas.width = room.width;
  if (room.canvas.length < room.length) room.canvas.length = room.length;
  const canvas = room.canvas;

  // Room origin on the canvas (defaults to the top-left corner for old files).
  if (!room.origin) room.origin = { x: 0, z: 0 };
  room.origin.x = clamp(room.origin.x, 0, canvas.width);
  room.origin.z = clamp(room.origin.z, 0, canvas.length);

  room.walls = room.walls
    .filter(w => wallLength(w) >= 0.15)
    .map(w => ({
      ...w,
      start: { x: clamp(w.start.x, 0, canvas.width), z: clamp(w.start.z, 0, canvas.length) },
      end: { x: clamp(w.end.x, 0, canvas.width), z: clamp(w.end.z, 0, canvas.length) },
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
      x: clamp(item.center.x, w / 2, canvas.width - w / 2),
      z: clamp(item.center.z, d / 2, canvas.length - d / 2),
    };
    return item;
  });

  room.publicAreas = (room.publicAreas || []).map(a => {
    const w = clamp(a.w, 1, canvas.width);
    const l = clamp(a.l, 1, canvas.length);
    return {
      x: clamp(a.x, 0, canvas.width - w),
      z: clamp(a.z, 0, canvas.length - l),
      w,
      l,
    };
  });
}

// MARK: - Auto room layout

/// Deterministic PRNG so a seed always gives the same design, and a different
/// seed gives a different (but still balanced) one for "redesign".
function layoutRandom(seed) {
  let s = (seed >>> 0) || 1;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/// `a − b`: the up-to-four rectangles of `a` remaining after removing `b`.
function rectSubtract(a, b) {
  const ax2 = a.x + a.w, az2 = a.z + a.l;
  const bx2 = b.x + b.w, bz2 = b.z + b.l;
  const ox = Math.min(ax2, bx2) - Math.max(a.x, b.x);
  const oz = Math.min(az2, bz2) - Math.max(a.z, b.z);
  if (ox <= 0 || oz <= 0) return [a];
  const out = [];
  if (b.x > a.x) out.push({ x: a.x, z: a.z, w: b.x - a.x, l: a.l });
  if (bx2 < ax2) out.push({ x: bx2, z: a.z, w: ax2 - bx2, l: a.l });
  const x1 = Math.max(a.x, b.x), x2 = Math.min(ax2, bx2);
  if (b.z > a.z) out.push({ x: x1, z: a.z, w: x2 - x1, l: b.z - a.z });
  if (bz2 < az2) out.push({ x: x1, z: bz2, w: x2 - x1, l: az2 - bz2 });
  return out.filter(r => r.w > 0.01 && r.l > 0.01);
}

function rectInRect(p, r) {
  return p.x >= r.x - 0.01 && p.x <= r.x + r.w + 0.01
    && p.z >= r.z - 0.01 && p.z <= r.z + r.l + 0.01;
}

/// Recursive guillotine split of a rectangle into `n` roughly-equal rooms along
/// the longer axis. The rng jitters each cut so different seeds give different
/// (still balanced) designs.
function guillotineRooms(rect, n, rng, minDim) {
  if (n <= 1) return [rect];
  const k = clamp(n % 2 === 0 ? n / 2 : Math.floor(n / 2) + (rng() < 0.5 ? 1 : 0), 1, n - 1);
  const alongX = rect.w >= rect.l;
  if (alongX && rect.w < minDim * 2) return [rect];
  if (!alongX && rect.l < minDim * 2) return [rect];
  const ratio = clamp(k / n + (rng() * 2 - 1) * 0.08, 0.15, 0.85);
  let first, second;
  if (alongX) {
    const split = clamp(rect.w * ratio, minDim, rect.w - minDim);
    first = { x: rect.x, z: rect.z, w: split, l: rect.l };
    second = { x: rect.x + split, z: rect.z, w: rect.w - split, l: rect.l };
  } else {
    const split = clamp(rect.l * ratio, minDim, rect.l - minDim);
    first = { x: rect.x, z: rect.z, w: rect.w, l: split };
    second = { x: rect.x, z: rect.z + split, w: rect.w, l: rect.l - split };
  }
  return [...guillotineRooms(first, k, rng, minDim), ...guillotineRooms(second, n - k, rng, minDim)];
}

/// Generates a fresh room layout: partitions the private area (the room
/// rectangle minus the marked public areas) into `count` rooms, each with one
/// door, and (optionally) one window on a wall facing the outside of the layout.
/// Returns { walls, doors, windows, rooms, areaPerRoom } or null when no private
/// space fits two-by-two-metre rooms.
export function autoLayoutRooms(room, opts = {}) {
  const count = clamp(Math.round(opts.count ?? 3), 1, 20);
  const windows = !!opts.windows;
  const rng = layoutRandom(opts.seed ?? 1);
  const origin = roomOrigin(room);
  const layout = { x: origin.x, z: origin.z, w: room.width, l: room.length };

  const publics = (room.publicAreas || [])
    .map(a => ({
      x: clamp(a.x, layout.x, layout.x + layout.w),
      z: clamp(a.z, layout.z, layout.z + layout.l),
      w: clamp(a.w, 0, layout.w),
      l: clamp(a.l, 0, layout.l),
    }))
    .filter(a => a.w > 0.5 && a.l > 0.5);

  // Private = layout minus public rectangles.
  let privateRects = [layout];
  for (const p of publics) {
    const next = [];
    for (const r of privateRects) next.push(...rectSubtract(r, p));
    privateRects = next;
  }
  privateRects = privateRects.filter(r => r.w >= 2 && r.l >= 2);
  if (privateRects.length === 0) return null;

  // Partition each private rectangle in proportion to its area.
  const totalArea = privateRects.reduce((s, r) => s + r.w * r.l, 0);
  let rooms = [];
  for (const r of privateRects) {
    const share = Math.max(1, Math.round(count * r.w * r.l / totalArea));
    rooms.push(...guillotineRooms(r, share, rng, 2.0));
  }
  rooms = rooms.slice(0, count);

  // Snap every rectangle to the 5 cm grid.
  const snap = r => ({
    x: clean(Math.round(r.x / 0.05) * 0.05),
    z: clean(Math.round(r.z / 0.05) * 0.05),
    w: clean(Math.round(r.w / 0.05) * 0.05),
    l: clean(Math.round(r.l / 0.05) * 0.05),
  });
  rooms = rooms.map(snap);
  const snapPublics = publics.map(snap);

  // One wall per unique edge (outer boundary + public + rooms), so shared walls
  // between neighbours are not duplicated.
  const key = (ax, az, bx, bz) => {
    const p1 = `${clean(ax)},${clean(az)}`, p2 = `${clean(bx)},${clean(bz)}`;
    return p1 < p2 ? `${p1}|${p2}` : `${p2}|${p1}`;
  };
  const wallByKey = new Map();
  const addEdge = (ax, az, bx, bz) => {
    const k = key(ax, az, bx, bz);
    if (wallByKey.has(k)) return wallByKey.get(k);
    const wall = { id: uid(), start: point(clean(ax), clean(az)), end: point(clean(bx), clean(bz)) };
    wallByKey.set(k, wall);
    return wall;
  };
  const edgeOf = r => [
    { a: { x: r.x, z: r.z }, b: { x: r.x + r.w, z: r.z } },
    { a: { x: r.x, z: r.z + r.l }, b: { x: r.x + r.w, z: r.z + r.l } },
    { a: { x: r.x, z: r.z }, b: { x: r.x, z: r.z + r.l } },
    { a: { x: r.x + r.w, z: r.z }, b: { x: r.x + r.w, z: r.z + r.l } },
  ];

  addEdge(layout.x, layout.z, layout.x + layout.w, layout.z);
  addEdge(layout.x + layout.w, layout.z, layout.x + layout.w, layout.z + layout.l);
  addEdge(layout.x + layout.w, layout.z + layout.l, layout.x, layout.z + layout.l);
  addEdge(layout.x, layout.z + layout.l, layout.x, layout.z);
  for (const p of snapPublics) for (const e of edgeOf(p)) addEdge(e.a.x, e.a.z, e.b.x, e.b.z);
  for (const r of rooms) for (const e of edgeOf(r)) addEdge(e.a.x, e.a.z, e.b.x, e.b.z);

  // What lies just beyond an edge's midpoint: public, another room, or outside.
  const neighbor = (r, e) => {
    const cx = r.x + r.w / 2, cz = r.z + r.l / 2;
    const mx = (e.a.x + e.b.x) / 2, mz = (e.a.z + e.b.z) / 2;
    let dx = mx - cx, dz = mz - cz;
    const len = Math.hypot(dx, dz) || 1;
    const p = { x: mx + dx / len * 0.3, z: mz + dz / len * 0.3 };
    if (!rectInRect(p, layout)) return "outer";
    for (const pub of snapPublics) if (rectInRect(p, pub)) return "public";
    return "interior";
  };
  const opening = (e, width) => {
    const wall = wallByKey.get(key(e.a.x, e.a.z, e.b.x, e.b.z));
    if (!wall) return null;
    const len = wallLength(wall);
    if (len < width + 0.2) return null;
    const mid = { x: (e.a.x + e.b.x) / 2, z: (e.a.z + e.b.z) / 2 };
    const offset = clamp(clean(wallProjection(wall, mid).offset - width / 2), 0.10, len - width - 0.10);
    return { wallID: wall.id, offset, width, open: true, swingInside: true };
  };

  const doors = [];
  const winList = [];
  const usedDoorEdges = new Set();
  const rank = { public: 0, interior: 1, outer: 2 };
  for (const r of rooms) {
    const edges = edgeOf(r).map(e => ({ ...e, kind: neighbor(r, e) }));
    // Door: prefer a wall toward the public space, then a neighbour, then out.
    const doorEdge = edges
      .filter(e => !usedDoorEdges.has(key(e.a.x, e.a.z, e.b.x, e.b.z)))
      .sort((a, b) => rank[a.kind] - rank[b.kind])[0]
      || edges.sort((a, b) => rank[a.kind] - rank[b.kind])[0];
    const dk = key(doorEdge.a.x, doorEdge.a.z, doorEdge.b.x, doorEdge.b.z);
    usedDoorEdges.add(dk);
    const door = opening(doorEdge, 0.9);
    if (door) doors.push(door);

    if (windows) {
      const winEdge = edges.find(e => e.kind === "outer"
        && Math.hypot(e.b.x - e.a.x, e.b.z - e.a.z) >= 1.2);
      if (winEdge) {
        const win = opening(winEdge, 1.0);
        if (win) winList.push(win);
      }
    }
  }

  return { walls: [...wallByKey.values()], doors, windows: winList, rooms, areaPerRoom: clean(totalArea / rooms.length) };
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

  // Centre the whole room on the 25 × 25 m canvas.
  centerRoom(room);
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
    throw new Error("This is not a RoomCAD room file.");
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
