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
/// How far a wall end has to reach past a join to close it. A corner is only
/// solid once each wall crosses its neighbour's *half* thickness — anything
/// less leaves a notch of open air at the join, for the wall's full height.
export const WALL_JOIN_SEAL = 0.055; // WALL_THICKNESS / 2 + 5 mm overlap
export const SILL_HEIGHT = 0.90;
export const GLASS_HEIGHT = 1.00;
export const DOOR_HEIGHT = 2.10;
export const MIN_WALL_LENGTH = 0.30;
export const MIN_OPENING_WIDTH = { door: 0.6, window: 0.4 };
export const MAX_OPENING_WIDTH = { door: 1.4, window: 2.0 };
/// How close a wall end has to come to another wall before it locks onto it.
export const WALL_ATTACH_TOLERANCE = 0.35;
export const LABEL_DEFAULT_SIZE = 0.22;   // cap height in metres
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
    labels: [],      // free text placed on the plan
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

/// How far each end of `wall` must be extended so its joins are closed solids.
/// An end that meets another wall reaches across that wall's half thickness;
/// a free-standing end is never extended, so a drawn wall keeps its length.
export function wallEndSeals(room, wall) {
  const joined = p => room.walls.some(o =>
    o.id !== wall.id && wallProjection(o, p).distance <= WALL_THICKNESS);
  return {
    start: joined(wall.start) ? WALL_JOIN_SEAL : 0,
    end: joined(wall.end) ? WALL_JOIN_SEAL : 0,
  };
}

/// The point on another wall that `raw` should lock onto, or null if nothing is
/// near enough. Corners win over a point part-way along a wall, so an end that
/// is close to a corner joins the corner rather than landing beside it.
///
/// This is what stops a wall end from overshooting through the wall it meets,
/// or stopping just short of it — both of which leave a gap in 3D.
export function wallAttachPoint(room, raw, tolerance = WALL_ATTACH_TOLERANCE, excludeWallID = null) {
  let best = null;
  const consider = (candidate, d, bonus) => {
    if (d > tolerance) return;
    const score = d - bonus;
    if (!best || score < best.score) best = { p: candidate, score };
  };
  for (const wall of room.walls) {
    if (excludeWallID !== null && wall.id === excludeWallID) continue;
    if (wallLength(wall) < 0.01) continue;
    consider({ ...wall.start }, distance(wall.start, raw), tolerance * 0.4);
    consider({ ...wall.end }, distance(wall.end, raw), tolerance * 0.4);
    const proj = wallProjection(wall, raw);
    consider({ ...proj.point }, proj.distance, 0);
  }
  return best ? best.p : null;
}

/// Locks a free wall end onto a nearby wall while keeping the wall axis-aligned
/// to its fixed end. Returns null when nothing is close enough.
function attachAlongAxis(room, end, fixed, excludeWallID) {
  const attach = wallAttachPoint(room, end, WALL_ATTACH_TOLERANCE, excludeWallID);
  if (!attach) return null;
  const horizontal = Math.abs(end.z - fixed.z) <= 0.0001;
  // Take only the coordinate the wall is free to move in, so the wall never
  // goes diagonal just to reach the thing it is snapping to.
  return horizontal
    ? point(clean(attach.x), fixed.z)
    : point(fixed.x, clean(attach.z));
}

export function translateWall(w, dx, dz, width, length) {
  return {
    ...w,
    start: { x: clamp(w.start.x + dx, 0, width), z: clamp(w.start.z + dz, 0, length) },
    end: { x: clamp(w.end.x + dx, 0, width), z: clamp(w.end.z + dz, 0, length) },
  };
}

/// The rectangle the drawn walls occupy, or null when nothing is drawn yet.
export function wallsBounds(room) {
  const walls = (room.walls || []).filter(w => wallLength(w) >= 0.01);
  if (walls.length === 0) return null;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const w of walls) {
    minX = Math.min(minX, w.start.x, w.end.x);
    maxX = Math.max(maxX, w.start.x, w.end.x);
    minZ = Math.min(minZ, w.start.z, w.end.z);
    maxZ = Math.max(maxZ, w.start.z, w.end.z);
  }
  return { minX, maxX, minZ, maxZ };
}

/// Whether a new wall may START at `p`.
///
/// A wall begun out in the empty grid stands alone: it belongs to no room, it
/// encloses nothing, and it is almost always a misclick rather than an
/// intention. So a wall may only start where it will be part of the building —
/// on or beside an existing wall, or inside the footprint the walls already
/// enclose — with the obvious exception of the very first wall, when there is
/// nothing to be part of yet.
export function canStartWallAt(room, p, margin = 0.6) {
  const walls = (room.walls || []).filter(w => wallLength(w) >= 0.01);
  if (walls.length === 0) return true;
  if (wallAttachPoint(room, p, Math.max(WALL_ATTACH_TOLERANCE, margin))) return true;
  const b = wallsBounds(room);
  if (!b) return true;
  return p.x >= b.minX - margin && p.x <= b.maxX + margin
    && p.z >= b.minZ - margin && p.z <= b.maxZ + margin;
}

/// Where two walls lie on top of each other.
///
/// Only walls running the SAME way are reported. Two walls meeting at a right
/// angle share a corner by design — that is how a room is built, and flagging
/// it would make every corner in the plan look like a fault. Two parallel walls
/// whose bodies overlap along their length are the accident: a wall drawn twice,
/// or dragged onto its neighbour.
export function overlappingWallAreas(room) {
  const walls = (room.walls || []).filter(w => wallLength(w) >= 0.01);
  const half = WALL_THICKNESS / 2;
  const minOverlap = 0.02;
  const out = [];
  const axisOf = w => {
    if (Math.abs(w.start.z - w.end.z) < 0.001) return "x";
    if (Math.abs(w.start.x - w.end.x) < 0.001) return "z";
    return null;
  };
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const a = walls[i];
      const b = walls[j];
      const axis = axisOf(a);
      if (!axis || axisOf(b) !== axis) continue;

      if (axis === "x") {
        // Bodies have to overlap across the wall as well as along it.
        const across = Math.min(a.start.z + half, b.start.z + half)
          - Math.max(a.start.z - half, b.start.z - half);
        if (across <= 0.0001) continue;
        const from = Math.max(Math.min(a.start.x, a.end.x), Math.min(b.start.x, b.end.x));
        const to = Math.min(Math.max(a.start.x, a.end.x), Math.max(b.start.x, b.end.x));
        if (to - from < minOverlap) continue;
        out.push({
          x: clean(from), w: clean(to - from),
          z: clean(Math.max(a.start.z - half, b.start.z - half)), l: clean(across),
          walls: [a.id, b.id],
        });
      } else {
        const across = Math.min(a.start.x + half, b.start.x + half)
          - Math.max(a.start.x - half, b.start.x - half);
        if (across <= 0.0001) continue;
        const from = Math.max(Math.min(a.start.z, a.end.z), Math.min(b.start.z, b.end.z));
        const to = Math.min(Math.max(a.start.z, a.end.z), Math.max(b.start.z, b.end.z));
        if (to - from < minOverlap) continue;
        out.push({
          x: clean(Math.max(a.start.x - half, b.start.x - half)), w: clean(across),
          z: clean(from), l: clean(to - from),
          walls: [a.id, b.id],
        });
      }
    }
  }
  return out;
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
    const seals = wallEndSeals(room, wall);
    const doorCuts = room.doors
      .filter(d => d.wallID === wall.id)
      .map(d => ({ from: d.offset, to: d.offset + d.width }));
    for (const span of solidSpans(length, doorCuts)) {
      const atWallStart = span.from <= 0.001;
      const atWallEnd = span.to >= length - 0.001;
      segments.push({
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

// MARK: - Openings as draggable segments

/// The two plan points where an opening meets its wall. These are what the 2D
/// editor puts grab handles on.
export function openingEndpoints(room, kind, id) {
  const list = kind === "door" ? room.doors : room.windows;
  const o = list.find(x => x.id === id);
  if (!o) return null;
  const wall = room.walls.find(w => w.id === o.wallID);
  if (!wall) return null;
  return {
    wall,
    start: wallPointAt(wall, o.offset),
    end: wallPointAt(wall, o.offset + o.width),
  };
}

/// Moves one end of an opening to `raw`, keeping the other end where it is.
/// Returns the new `{ offset, width }`, clamped to the opening's legal width
/// and to the 10 cm of wall that has to remain at each end.
export function resizeOpeningEnd(room, kind, id, which, raw) {
  const list = kind === "door" ? room.doors : room.windows;
  const o = list.find(x => x.id === id);
  if (!o) return null;
  const wall = room.walls.find(w => w.id === o.wallID);
  if (!wall) return null;
  const wallLen = wallLength(wall);
  const minW = MIN_OPENING_WIDTH[kind];
  const maxW = MAX_OPENING_WIDTH[kind];
  const step = GRID_STEPS[room.grid].meters;
  const along = clamp(clean(Math.round(wallProjection(wall, raw).offset / step) * step), 0.10, wallLen - 0.10);

  if (which === "start") {
    const fixedEnd = o.offset + o.width;
    const width = clamp(fixedEnd - along, minW, Math.min(maxW, fixedEnd - 0.10));
    return { offset: clean(fixedEnd - width), width: clean(width) };
  }
  const fixedStart = o.offset;
  const width = clamp(along - fixedStart, minW, Math.min(maxW, wallLen - 0.10 - fixedStart));
  return { offset: clean(fixedStart), width: clean(width) };
}

// MARK: - Public areas

export function publicAreaAt(room, p) {
  const areas = room.publicAreas || [];
  // Topmost first, so the most recently drawn area wins an overlap.
  for (let i = areas.length - 1; i >= 0; i--) {
    const a = areas[i];
    if (p.x >= a.x && p.x <= a.x + a.w && p.z >= a.z && p.z <= a.z + a.l) return a;
  }
  return null;
}

/// The four draggable corners of a public area, in a fixed order.
export function publicAreaCorners(a) {
  return [
    { corner: "nw", x: a.x, z: a.z },
    { corner: "ne", x: a.x + a.w, z: a.z },
    { corner: "se", x: a.x + a.w, z: a.z + a.l },
    { corner: "sw", x: a.x, z: a.z + a.l },
  ];
}

export function publicAreaCornerNear(room, p, tolerance = 0.22) {
  for (const a of (room.publicAreas || [])) {
    for (const c of publicAreaCorners(a)) {
      if (distance(c, p) <= tolerance) return { area: a, corner: c.corner };
    }
  }
  return null;
}

/// Moves one corner of a public area, keeping the opposite corner pinned.
export function resizePublicArea(a, corner, raw, room) {
  const canvas = canvasOf(room);
  const step = GRID_STEPS[room.grid].meters;
  const snap = v => clean(Math.round(v / step) * step);
  const x0 = corner === "nw" || corner === "sw" ? snap(raw.x) : a.x;
  const x1 = corner === "ne" || corner === "se" ? snap(raw.x) : a.x + a.w;
  const z0 = corner === "nw" || corner === "ne" ? snap(raw.z) : a.z;
  const z1 = corner === "sw" || corner === "se" ? snap(raw.z) : a.z + a.l;
  const minX = clamp(Math.min(x0, x1), 0, canvas.width);
  const maxX = clamp(Math.max(x0, x1), 0, canvas.width);
  const minZ = clamp(Math.min(z0, z1), 0, canvas.length);
  const maxZ = clamp(Math.max(z0, z1), 0, canvas.length);
  return {
    x: minX, z: minZ,
    w: Math.max(0.5, clean(maxX - minX)),
    l: Math.max(0.5, clean(maxZ - minZ)),
  };
}

// MARK: - Enclosed rooms

const MAX_ROOM_CELLS = 60000;   // decomposition guard for pathological plans
let _roomCache = { key: null, rooms: null };

function roomSignature(room) {
  const w = room.walls.map(x => `${x.start.x},${x.start.z},${x.end.x},${x.end.z}`).join(";");
  const d = room.doors.map(x => `${x.wallID}`).join(";");
  return w + "|" + d;
}

/// The enclosed rooms of the plan.
///
/// Walls are all axis-aligned, so the plan can be cut into the exact grid
/// implied by every wall coordinate; two neighbouring cells belong to the same
/// room unless a wall runs along the boundary between them. Doors deliberately
/// do NOT connect cells — treating a doorway as a gap would merge every room it
/// links into one region, and then there is nothing to measure.
///
/// Returns [{ area, cells, bounds, wallIDs, hasDoor }], outermost space
/// excluded. Cached on the wall/door layout, since the 2D canvas redraws far
/// more often than the plan changes.
export function detectRooms(room) {
  const key = roomSignature(room);
  if (_roomCache.key === key) return _roomCache.rooms;

  const walls = (room.walls || []).filter(w => wallLength(w) >= 0.01);
  const result = [];
  if (walls.length < 3) {
    _roomCache = { key, rooms: result };
    return result;
  }

  const xsSet = new Set();
  const zsSet = new Set();
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const w of walls) {
    for (const pt of [w.start, w.end]) {
      xsSet.add(clean(pt.x));
      zsSet.add(clean(pt.z));
      minX = Math.min(minX, pt.x); maxX = Math.max(maxX, pt.x);
      minZ = Math.min(minZ, pt.z); maxZ = Math.max(maxZ, pt.z);
    }
  }
  // A ring of margin outside every wall, so the space outside the building is
  // always one identifiable region rather than several.
  xsSet.add(clean(minX - 1)); xsSet.add(clean(maxX + 1));
  zsSet.add(clean(minZ - 1)); zsSet.add(clean(maxZ + 1));
  const xs = [...xsSet].sort((a, b) => a - b);
  const zs = [...zsSet].sort((a, b) => a - b);
  const nx = xs.length - 1;
  const nz = zs.length - 1;
  if (nx < 1 || nz < 1 || nx * nz > MAX_ROOM_CELLS) {
    _roomCache = { key, rooms: result };
    return result;
  }

  // Wall spans indexed by the line they sit on, so a boundary test is a lookup.
  const vertical = new Map();     // x -> [{ from, to, id }]
  const horizontal = new Map();   // z -> [{ from, to, id }]
  for (const w of walls) {
    if (Math.abs(w.start.x - w.end.x) < 0.001) {
      const x = clean(w.start.x);
      const list = vertical.get(x) || [];
      list.push({ from: Math.min(w.start.z, w.end.z), to: Math.max(w.start.z, w.end.z), id: w.id });
      vertical.set(x, list);
    } else if (Math.abs(w.start.z - w.end.z) < 0.001) {
      const z = clean(w.start.z);
      const list = horizontal.get(z) || [];
      list.push({ from: Math.min(w.start.x, w.end.x), to: Math.max(w.start.x, w.end.x), id: w.id });
      horizontal.set(z, list);
    }
  }
  // Every wall endpoint is a grid line, so a wall either covers a whole cell
  // boundary or none of it — testing the midpoint is exact.
  const blocker = (map, line, mid) => {
    const spans = map.get(clean(line));
    if (!spans) return null;
    for (const s of spans) if (mid > s.from + 0.0005 && mid < s.to - 0.0005) return s.id;
    return null;
  };

  const owner = new Int32Array(nx * nz).fill(-1);
  const at = (i, j) => i * nz + j;
  let regionCount = 0;
  const regions = [];

  for (let i0 = 0; i0 < nx; i0++) {
    for (let j0 = 0; j0 < nz; j0++) {
      if (owner[at(i0, j0)] !== -1) continue;
      const id = regionCount++;
      const cells = [];
      const wallIDs = new Set();
      const stack = [[i0, j0]];
      owner[at(i0, j0)] = id;
      while (stack.length) {
        const [i, j] = stack.pop();
        cells.push([i, j]);
        const midZ = (zs[j] + zs[j + 1]) / 2;
        const midX = (xs[i] + xs[i + 1]) / 2;
        const step = (ni, nj, blockedBy) => {
          if (blockedBy) { wallIDs.add(blockedBy); return; }
          if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) return;
          if (owner[at(ni, nj)] !== -1) return;
          owner[at(ni, nj)] = id;
          stack.push([ni, nj]);
        };
        step(i - 1, j, blocker(vertical, xs[i], midZ));
        step(i + 1, j, blocker(vertical, xs[i + 1], midZ));
        step(i, j - 1, blocker(horizontal, zs[j], midX));
        step(i, j + 1, blocker(horizontal, zs[j + 1], midX));
      }
      regions.push({ id, cells, wallIDs });
    }
  }

  // Whatever contains the margin corner is the outside.
  const outside = owner[at(0, 0)];
  const doorWalls = new Set((room.doors || []).map(d => d.wallID));
  for (const region of regions) {
    if (region.id === outside) continue;
    let area = 0;
    let rMinX = Infinity, rMaxX = -Infinity, rMinZ = Infinity, rMaxZ = -Infinity;
    const rects = [];
    for (const [i, j] of region.cells) {
      const r = { x: xs[i], z: zs[j], w: xs[i + 1] - xs[i], l: zs[j + 1] - zs[j] };
      area += r.w * r.l;
      rects.push(r);
      rMinX = Math.min(rMinX, r.x); rMaxX = Math.max(rMaxX, r.x + r.w);
      rMinZ = Math.min(rMinZ, r.z); rMaxZ = Math.max(rMaxZ, r.z + r.l);
    }
    if (area < 0.5) continue;   // slivers between doubled-up walls
    let hasDoor = false;
    for (const id of region.wallIDs) if (doorWalls.has(id)) { hasDoor = true; break; }
    result.push({
      area: clean(area),
      rects,
      bounds: { minX: rMinX, maxX: rMaxX, minZ: rMinZ, maxZ: rMaxZ },
      wallIDs: [...region.wallIDs],
      hasDoor,
    });
  }
  _roomCache = { key, rooms: result };
  return result;
}

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
    if (!region.hasDoor) continue;
    if (publicCoverage(room, region) > 0.6) continue;
    const spot = captionSpot(room, region, boxW, boxH);
    if (!spot) continue;
    out.push({ area: region.area, x: spot.x, z: spot.z, clearance: spot.score });
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
  // order the areas happen to be stored in.
  for (let pass = 0; pass < 4; pass++) {
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

  out.x = clamp(out.x, 0, Math.max(0, canvas.width - out.w));
  out.z = clamp(out.z, 0, Math.max(0, canvas.length - out.l));
  out.w = clean(Math.min(out.w, canvas.width - out.x));
  out.l = clean(Math.min(out.l, canvas.length - out.z));
  return out;
}

// MARK: - Labels

/// A label's footprint on the plan, used for hit testing and for the selection
/// outline. Width is estimated from the text — good enough for picking.
export function labelBounds(label) {
  const size = label.size || LABEL_DEFAULT_SIZE;
  const text = label.text || "";
  const w = Math.max(size * 1.2, text.length * size * 0.58);
  const h = size * 1.5;
  return {
    minX: label.center.x - w / 2, maxX: label.center.x + w / 2,
    minZ: label.center.z - h / 2, maxZ: label.center.z + h / 2,
    w, h,
  };
}

export function labelNear(room, p, tolerance = 0.08) {
  const labels = room.labels || [];
  for (let i = labels.length - 1; i >= 0; i--) {
    const b = labelBounds(labels[i]);
    if (p.x >= b.minX - tolerance && p.x <= b.maxX + tolerance
      && p.z >= b.minZ - tolerance && p.z <= b.maxZ + tolerance) return labels[i];
  }
  return null;
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

  // Identity first. Everything downstream — an opening finding its wall, a
  // dimension line finding its opening, a grab handle finding what it drags —
  // looks objects up by id. A document that reaches us without them (an older
  // export, a hand-edited file) would otherwise have every id-less object
  // resolve to the *first* one, so two doors would draw one dimension on top
  // of each other and the second would get none.
  room.walls = room.walls.map(w => (w.id ? w : { ...w, id: uid() }));
  const firstWallID = room.walls.length ? room.walls[0].id : null;
  const withOpeningID = o => {
    const next = o.id ? o : { ...o, id: uid() };
    // Preserve what a document without wallIDs used to resolve to, rather than
    // silently dropping its openings now that wall ids are always distinct.
    return next.wallID === undefined ? { ...next, wallID: firstWallID } : next;
  };
  room.doors = room.doors.map(withOpeningID);
  room.windows = room.windows.map(withOpeningID);
  room.furniture = room.furniture.map(f => (f.id ? f : { ...f, id: uid() }));

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
    const w = clamp(a.w, 0.5, canvas.width);
    const l = clamp(a.l, 0.5, canvas.length);
    return {
      // Areas saved before they were selectable have no id; give them one so
      // selection survives edits that reorder the list.
      id: a.id || uid(),
      x: clamp(a.x, 0, canvas.width - w),
      z: clamp(a.z, 0, canvas.length - l),
      w,
      l,
      // Walk paths the layout generator carved. Kept apart from floor the user
      // marked so a re-run reclaims its own corridors and never eats theirs.
      ...(a.generated ? { generated: true } : {}),
    };
  });

  room.labels = (room.labels || [])
    .filter(l => l && l.center && typeof l.center.x === "number")
    .map(l => ({
      id: l.id || uid(),
      text: String(l.text === undefined ? "" : l.text).slice(0, 60),
      center: {
        x: clamp(l.center.x, 0, canvas.width),
        z: clamp(l.center.z, 0, canvas.length),
      },
      rotationDegrees: ((Math.round((l.rotationDegrees || 0) / 90) * 90) % 360 + 360) % 360,
      size: clamp(Number(l.size) || LABEL_DEFAULT_SIZE, 0.08, 1.0),
    }));
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

// Circulation. A corridor narrower than this is not a usable walk path; wider
// than the maximum it stops reading as a corridor and starts wasting floor.
export const CORRIDOR_MIN_WIDTH = 1.00;
/// Above this a walk path stops reading as a corridor and starts being a hall.
/// It is a scoring preference, not a limit — see arrangeRect.
export const CORRIDOR_COMFORTABLE_WIDTH = 2.60;
/// The shortest side a generated room may have.
export const MIN_ROOM_DIM = 1.60;

/// Splits `total` into whole shares proportional to `weights`, summing exactly
/// to `total` (largest-remainder). Plain rounding does not sum correctly, which
/// is how the previous generator ended up discarding rooms it had just made.
function apportion(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const exact = weights.map(w => (total * w) / sum);
  const base = exact.map(Math.floor);
  let left = total - base.reduce((a, b) => a + b, 0);
  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < order.length && left > 0; k++, left--) base[order[k].i]++;
  return base;
}

/// Cuts a band into `k` rooms across its length, each as close to `targetArea`
/// as the band depth allows. Rooms are never stretched past the target just to
/// fill the band — the remainder comes back as `leftover` and becomes public
/// floor, which is what lets a request for a few small rooms in a large space
/// produce exactly that instead of a few enormous ones.
function splitBand(band, k, alongX, targetArea) {
  const rooms = [];
  const span = alongX ? band.w : band.l;
  const depth = alongX ? band.l : band.w;
  if (k <= 0 || span <= 0 || depth <= 0) return { rooms, leftover: null };

  const even = span / k;
  const wanted = targetArea > 0 ? targetArea / depth : even;
  const step = clamp(Math.min(even, wanted), Math.min(MIN_ROOM_DIM, even), even);

  for (let i = 0; i < k; i++) {
    rooms.push(alongX
      ? { x: band.x + step * i, z: band.z, w: step, l: band.l }
      : { x: band.x, z: band.z + step * i, w: band.w, l: step });
  }
  const usedSpan = step * k;
  const spare = span - usedSpan;
  const leftover = spare > 0.3
    ? (alongX
      ? { x: band.x + usedSpan, z: band.z, w: spare, l: band.l }
      : { x: band.x, z: band.z + usedSpan, w: band.w, l: spare })
    : null;
  return { rooms, leftover };
}

/// Arranges `n` rooms inside one free rectangle, carving the circulation the
/// rooms need to be reachable.
///
/// The target area is what decides how much floor becomes room and how much
/// becomes corridor: the corridor is sized so the remaining depth, times the
/// span, comes to `n × targetArea`. Ask for small rooms and you get a generous
/// walk path; ask for large ones and the corridor shrinks to its minimum and
/// the rooms take everything else.
function arrangeRect(rect, n, targetArea, rng) {
  if (n <= 0) return null;

  // Corridors normally run the long way, but not always — that is one of the
  // things that makes a redesign genuinely different rather than jittered.
  const preferX = rect.w >= rect.l;
  const alongX = rng() < 0.78 ? preferX : !preferX;
  const span = alongX ? rect.w : rect.l;
  const depth = alongX ? rect.l : rect.w;

  const canDouble = depth >= MIN_ROOM_DIM * 2 + CORRIDOR_MIN_WIDTH;
  const doubleLoaded = canDouble && rng() < 0.72;
  const sides = doubleLoaded ? 2 : 1;

  // Room depth wanted for the target area; whatever depth is left over becomes
  // public floor. There is deliberately no upper cap here: asking for four
  // small rooms in a large space should give you four small rooms and an open
  // hall, not four oversized rooms. The score decides whether the trade is
  // worth it, rather than a hard clamp forcing the slack into the rooms.
  const wantedRoomDepth = (n * targetArea) / span;
  const corridorW = clamp(depth - wantedRoomDepth, CORRIDOR_MIN_WIDTH,
    depth - MIN_ROOM_DIM * sides);
  if (corridorW < CORRIDOR_MIN_WIDTH) {
    // No depth for circulation: split the rectangle directly and let the doors
    // find the outside.
    const flat = splitBand(rect, n, alongX, targetArea);
    return { rooms: flat.rooms, corridors: flat.leftover ? [flat.leftover] : [] };
  }

  const usable = depth - corridorW;
  let front;
  if (doubleLoaded) {
    const lo = MIN_ROOM_DIM;
    const hi = usable - MIN_ROOM_DIM;
    front = lo >= hi ? usable / 2 : lo + (hi - lo) * (0.3 + rng() * 0.4);
  } else {
    front = rng() < 0.5 ? 0 : usable;
  }
  const back = usable - front;

  const bandRects = [];
  const mk = (offset, thickness) => (alongX
    ? { x: rect.x, z: rect.z + offset, w: rect.w, l: thickness }
    : { x: rect.x + offset, z: rect.z, w: thickness, l: rect.l });
  if (front >= MIN_ROOM_DIM) bandRects.push(mk(0, front));
  if (back >= MIN_ROOM_DIM) bandRects.push(mk(front + corridorW, back));
  if (bandRects.length === 0) {
    const flat = splitBand(rect, n, alongX, targetArea);
    return { rooms: flat.rooms, corridors: flat.leftover ? [flat.leftover] : [] };
  }

  const corridor = mk(front, corridorW);

  // Share the rooms out by band area, then cap each band so no room falls under
  // the minimum side.
  const depths = bandRects.map(b => (alongX ? b.l : b.w));
  // How many rooms a band can hold before they drop under the minimum side.
  const capacity = Math.max(1, Math.floor(span / MIN_ROOM_DIM));
  const caps = bandRects.map(() => capacity);
  const counts = apportion(n, depths);

  // Move any overflow to a band that still has capacity. The previous version
  // added the whole overflow to every other band and never rechecked them,
  // which could leave one band holding more rooms than fit.
  for (let pass = 0; pass < 4; pass++) {
    let spill = 0;
    for (let i = 0; i < counts.length; i++) {
      if (counts[i] > caps[i]) { spill += counts[i] - caps[i]; counts[i] = caps[i]; }
    }
    if (spill === 0) break;
    for (let i = 0; i < counts.length && spill > 0; i++) {
      const free = caps[i] - counts[i];
      const take = Math.min(free, spill);
      counts[i] += take;
      spill -= take;
    }
    // Anything still spilling has nowhere to go: the plan honestly comes out
    // with fewer rooms than asked rather than with unusable slivers.
    if (spill > 0) break;
  }
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] === 0 && counts.length > 1) {
      const donor = counts.indexOf(Math.max(...counts));
      if (donor !== i && counts[donor] > 1) { counts[donor]--; counts[i] = 1; }
    }
  }

  const rooms = [];
  const corridors = [corridor];
  for (let i = 0; i < bandRects.length; i++) {
    if (counts[i] <= 0) {
      // A band that ended up with no rooms is still floor: it becomes public
      // rather than vanishing from the plan unaccounted for.
      corridors.push(bandRects[i]);
      continue;
    }
    const split = splitBand(bandRects[i], counts[i], alongX, targetArea);
    rooms.push(...split.rooms);
    if (split.leftover) corridors.push(split.leftover);
  }
  return { rooms, corridors };
}

/// How good an arrangement is; lower is better. Dominated by how far the rooms
/// land from the requested area, with a nudge away from corridor-shaped rooms
/// and away from spending the whole floor on circulation.
function scoreArrangement(rooms, corridors, targetArea, freeArea) {
  if (rooms.length === 0) return Infinity;
  let score = 0;
  for (const r of rooms) {
    const area = r.w * r.l;
    score += Math.abs(area - targetArea) / targetArea;
    const long = Math.max(r.w, r.l);
    const short = Math.min(r.w, r.l);
    if (short < MIN_ROOM_DIM) score += 6;                 // unusable
    const aspect = short > 0 ? long / short : 99;
    if (aspect > 2.6) score += (aspect - 2.6) * 0.7;      // corridor-shaped
  }
  score /= rooms.length;
  const corridorArea = corridors.reduce((s, c) => s + c.w * c.l, 0);
  score += (corridorArea / Math.max(freeArea, 0.01)) * 0.55;
  return score;
}

/// Generates a fresh room layout.
///
/// Partitions the free space — the room rectangle minus any floor the user
/// marked public — into `count` rooms as close as it can get to `area` m²
/// each, carving the corridors the rooms need to be reachable, and giving
/// every room a door onto circulation (and optionally a window on an
/// outside-facing wall).
///
/// It is a scored search, not a single pass: `attempts` arrangements are built
/// with different corridor axes, positions and single- or double-loaded
/// layouts, and the one that lands closest to the requested area wins. That is
/// also what makes "redesign" produce a different plan rather than a jittered
/// version of the same one.
///
/// Returns { walls, doors, windows, rooms, corridors, areaPerRoom, targetArea,
/// score } or null when there is no usable free space.
export function autoLayoutRooms(room, opts = {}) {
  const count = clamp(Math.round(opts.count ?? 3), 1, 20);
  const windows = !!opts.windows;
  const attempts = clamp(Math.round(opts.attempts ?? 240), 1, 4000);
  const rng = layoutRandom(opts.seed ?? 1);
  const origin = roomOrigin(room);
  const layout = { x: origin.x, z: origin.z, w: room.width, l: room.length };

  // Only floor the user marked stays out of the partition. Corridors this
  // generator produced on a previous run are reclaimed.
  const publics = (room.publicAreas || [])
    .filter(a => !a.generated)
    .map(a => ({
      x: clamp(a.x, layout.x, layout.x + layout.w),
      z: clamp(a.z, layout.z, layout.z + layout.l),
      w: clamp(a.w, 0, layout.w),
      l: clamp(a.l, 0, layout.l),
    }))
    .filter(a => a.w > 0.3 && a.l > 0.3);

  let freeRects = [layout];
  for (const p of publics) {
    const next = [];
    for (const r of freeRects) next.push(...rectSubtract(r, p));
    freeRects = next;
  }
  freeRects = freeRects.filter(r => r.w >= MIN_ROOM_DIM && r.l >= MIN_ROOM_DIM);
  if (freeRects.length === 0) return null;

  const freeArea = freeRects.reduce((s, r) => s + r.w * r.l, 0);
  // Fall back to an even share when no target is given, and never accept a
  // target the space cannot hold.
  const requested = Number(opts.area) > 0 ? Number(opts.area) : freeArea / count;
  const targetArea = clamp(requested, 1, freeArea / count);

  // Rooms go to the free rectangles in proportion to their area.
  const share = apportion(count, freeRects.map(r => r.w * r.l));
  for (let i = 0; i < share.length; i++) {
    if (share[i] === 0) {
      const donor = share.indexOf(Math.max(...share));
      if (share[donor] > 1) { share[donor]--; share[i] = 1; }
    }
  }

  // Search, then keep every distinct arrangement that came out close to the
  // best one — not just the single winner. Picking only the winner makes
  // "redesign" useless: the search converges on the same optimum whatever the
  // seed, so you get the same plan back. Choosing from the near-optimal pool by
  // seed gives a genuinely different layout that is still a good one.
  const pool = new Map();
  let bestScore = Infinity;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const rooms = [];
    const corridors = [];
    for (let i = 0; i < freeRects.length; i++) {
      if (share[i] <= 0) continue;
      const got = arrangeRect(freeRects[i], share[i], targetArea, rng);
      if (!got) continue;
      rooms.push(...got.rooms);
      corridors.push(...got.corridors);
    }
    if (rooms.length === 0) continue;
    const score = scoreArrangement(rooms, corridors, targetArea, freeArea);
    if (score < bestScore) bestScore = score;
    const signature = rooms
      .map(r => `${r.x.toFixed(2)},${r.z.toFixed(2)},${r.w.toFixed(2)},${r.l.toFixed(2)}`)
      .sort()
      .join("|");
    if (!pool.has(signature)) pool.set(signature, { rooms, corridors, score, signature });
  }
  if (pool.size === 0) return null;

  const tolerance = bestScore * 1.18 + 0.03;
  const contenders = [...pool.values()]
    .filter(c => c.score <= tolerance)
    .sort((a, b) => (a.score - b.score) || (a.signature < b.signature ? -1 : 1));
  // Deterministic per seed, so the same seed always reproduces its plan.
  const pickRng = layoutRandom((opts.seed ?? 1) * 2654435761 + 12345);
  const best = contenders[Math.floor(pickRng() * contenders.length) % contenders.length];
  if (!best || best.rooms.length === 0) return null;

  // Snap the EDGES, not the position and size separately. Rounding x and w
  // independently lets two neighbours disagree about the boundary they share —
  // one ends at 6.70 while the next starts at 6.65 — which produces rooms that
  // overlap by a few centimetres (and elsewhere, hairline gaps).
  const snapV = v => clean(Math.round(v / 0.05) * 0.05);
  const snap = r => {
    const x0 = snapV(r.x);
    const z0 = snapV(r.z);
    const x1 = snapV(r.x + r.w);
    const z1 = snapV(r.z + r.l);
    return { x: x0, z: z0, w: clean(x1 - x0), l: clean(z1 - z0) };
  };
  const rooms = best.rooms.map(snap).filter(r => r.w > 0.05 && r.l > 0.05);
  const corridors = best.corridors.map(snap).filter(r => r.w > 0.05 && r.l > 0.05);
  const snapPublics = publics.map(snap);
  // Circulation the doors may open onto: what the user marked, plus what this
  // run carved.
  const circulation = [...snapPublics, ...corridors];

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

  const neighbor = (r, e) => {
    const cx = r.x + r.w / 2, cz = r.z + r.l / 2;
    const mx = (e.a.x + e.b.x) / 2, mz = (e.a.z + e.b.z) / 2;
    let dx = mx - cx, dz = mz - cz;
    const len = Math.hypot(dx, dz) || 1;
    const p = { x: mx + dx / len * 0.3, z: mz + dz / len * 0.3 };
    if (!rectInRect(p, layout)) return "outer";
    for (const c of circulation) if (rectInRect(p, c)) return "public";
    return "interior";
  };
  const opening = (e, width) => {
    const wall = wallByKey.get(key(e.a.x, e.a.z, e.b.x, e.b.z));
    if (!wall) return null;
    const len = wallLength(wall);
    if (len < width + 0.2) return null;
    const mid = { x: (e.a.x + e.b.x) / 2, z: (e.a.z + e.b.z) / 2 };
    const offset = clamp(clean(wallProjection(wall, mid).offset - width / 2), 0.10, len - width - 0.10);
    return { id: uid(), wallID: wall.id, offset, width, open: true, swingInside: true };
  };

  const doors = [];
  const winList = [];
  const rank = { public: 0, interior: 1, outer: 2 };
  for (const r of rooms) {
    const edges = edgeOf(r).map(e => ({ ...e, kind: neighbor(r, e) }));
    // A room's door goes onto circulation wherever one is available — that is
    // the whole point of carving corridors. Only when a room touches none does
    // it fall back to a neighbour or the outside.
    const ordered = [...edges].sort((a, b) => rank[a.kind] - rank[b.kind]);
    let door = null;
    for (const e of ordered) {
      door = opening(e, 0.9);
      if (door) break;
    }
    if (door) doors.push(door);

    if (windows) {
      const winEdge = edges.find(e => e.kind === "outer"
        && Math.hypot(e.b.x - e.a.x, e.b.z - e.a.z) >= 1.2
        && !doors.some(d => d.wallID === (wallByKey.get(key(e.a.x, e.a.z, e.b.x, e.b.z)) || {}).id));
      if (winEdge) {
        const win = opening(winEdge, 1.0);
        if (win) winList.push(win);
      }
    }
  }

  const areas = rooms.map(r => r.w * r.l);
  return {
    walls: [...wallByKey.values()],
    doors,
    windows: winList,
    rooms,
    corridors,
    areaPerRoom: clean(areas.reduce((a, b) => a + b, 0) / areas.length),
    targetArea: clean(targetArea),
    score: best.score,
    alternatives: contenders.length,
  };
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
  room.publicAreas = Array.isArray(room.publicAreas) ? room.publicAreas : [];
  room.labels = Array.isArray(room.labels) ? room.labels : [];
  sanitize(room);
  return room;
}
