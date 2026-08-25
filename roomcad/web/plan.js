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

/// Clamps `v` into [min, max]. A value that is not a finite number — a string
/// from a hand-edited file, a null from a peer running an older build, or a
/// NaN produced further up the chain — clamps to `min` rather than passing
/// through. sanitize() is built on this, so without the guard a single bad
/// field spreads NaN across every coordinate it touches and the document
/// cannot be repaired by re-sanitising it.
export function clamp(v, min, max) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(n, min), max);
}

/// The nearest quarter turn in [0, 360). Anything that is not a finite number
/// reads as no rotation at all.
export function quarterTurn(degrees) {
  const n = Number(degrees);
  if (!Number.isFinite(n)) return 0;
  return ((Math.round(n / 90) * 90) % 360 + 360) % 360;
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

/// How short a wall may become before it would lose something mounted on it.
function neededWallLength(room, wall) {
  let needed = MIN_WALL_LENGTH;
  for (const list of [room.doors || [], room.windows || []]) {
    for (const o of list) {
      if (o.wallID !== wall.id) continue;
      needed = Math.max(needed, o.width + 0.2);
    }
  }
  return needed;
}

const JOINT_EPS = 0.005;

/// Moves a whole wall, taking the walls joined to it along.
///
/// Moving a wall on its own tears the building open: drag the east wall of a
/// rectangle and the north and south walls stay behind, so the room is no
/// longer enclosed. Since resizing is done by dragging, the joints have to come
/// too, and they come in two ways:
///
///   - a corner — another wall's endpoint sitting on one of this wall's ends —
///     travels the full distance, so the corner stays a corner and the wall it
///     belongs to simply gets longer or shorter;
///   - a T-junction — an endpoint landing partway along this wall — follows only
///     the part of the movement ACROSS the wall. Slide a wall along its own line
///     and a T stays where it is; push the wall sideways and the T comes with
///     it, stretching the wall that meets it.
///
/// That is what keeps an L, a U or a courtyard intact instead of only a plain
/// rectangle. Returns the new wall list, or null if the step is not allowed.
export function dragWall(room, id, dx, dz) {
  const walls = room.walls || [];
  const moving = walls.find(w => w.id === id);
  if (!moving) return null;
  const canvas = canvasOf(room);

  // Clamp the MOVEMENT, never the endpoints separately, or the wall changes
  // length as it meets the edge of the plate.
  const lo = (a, b) => (a > b ? 0 : null);
  const minX = Math.min(moving.start.x, moving.end.x);
  const maxX = Math.max(moving.start.x, moving.end.x);
  const minZ = Math.min(moving.start.z, moving.end.z);
  const maxZ = Math.max(moving.start.z, moving.end.z);
  const mx = lo(-minX, canvas.width - maxX) ?? clamp(dx, -minX, canvas.width - maxX);
  const mz = lo(-minZ, canvas.length - maxZ) ?? clamp(dz, -minZ, canvas.length - maxZ);
  if (Math.abs(mx) < 1e-9 && Math.abs(mz) < 1e-9) return null;

  const A = { ...moving.start };
  const B = { ...moving.end };
  const len = wallLength(moving) || 1;
  const ux = (B.x - A.x) / len;
  const uz = (B.z - A.z) / len;
  // A wall moves ACROSS itself and no other way.
  //
  // Every wall in a RoomCAD plan is square, and the part of a drag that runs
  // ALONG a wall is what breaks that: it carries the corner of the wall joined
  // at right angles sideways while that wall's far end stays put, so the joined
  // wall comes out at an angle. Drag a wall diagonally and two walls end up
  // skew, the plan stops enclosing anything, and the area label disappears —
  // which is how this was noticed.
  //
  // Sliding a wall along its own line is not a thing a plan needs anyway: it
  // would leave the wall lying where it already lies. Reaching along a wall is
  // what dragging its endpoint is for.
  const along = mx * ux + mz * uz;
  const acrossX = mx - along * ux;
  const acrossZ = mz - along * uz;
  const stepX = acrossX;
  const stepZ = acrossZ;
  if (Math.abs(stepX) < 1e-9 && Math.abs(stepZ) < 1e-9) return null;

  const same = (p, q) => Math.abs(p.x - q.x) <= JOINT_EPS && Math.abs(p.z - q.z) <= JOINT_EPS;

  // A wall cut at its junctions is still one wall to the person dragging it.
  //
  // Splitting a long wall where the dividers meet it is what makes a door
  // belong to its own room — but it also leaves the pieces sharing endpoints,
  // and moving one piece by its endpoints would leave the pieces either side
  // hinged to it and skew. So the whole run of pieces along the same line moves
  // together, which is what the drawing shows: one wall.
  const collinear = (a, b) => {
    const av = Math.abs(a.start.x - a.end.x) < 1e-6;
    const bv = Math.abs(b.start.x - b.end.x) < 1e-6;
    if (av !== bv) return false;
    return av
      ? Math.abs(a.start.x - b.start.x) <= JOINT_EPS
      : Math.abs(a.start.z - b.start.z) <= JOINT_EPS;
  };
  const touches = (a, b) =>
    same(a.start, b.start) || same(a.start, b.end)
    || same(a.end, b.start) || same(a.end, b.end);
  const movers = new Set([moving]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const w of walls) {
      if (movers.has(w)) continue;
      if (![...movers].some(m => collinear(m, w) && touches(m, w))) continue;
      movers.add(w);
      grew = true;
    }
  }

  /// Does this point sit on one of the walls being moved — at an end of one, or
  /// part-way along one?
  const onMovers = p => {
    for (const m of movers) {
      if (same(p, m.start) || same(p, m.end)) return true;
      const mlen = wallLength(m) || 1;
      const mux = (m.end.x - m.start.x) / mlen;
      const muz = (m.end.z - m.start.z) / mlen;
      const t = (p.x - m.start.x) * mux + (p.z - m.start.z) * muz;
      if (t <= JOINT_EPS || t >= mlen - JOINT_EPS) continue;
      if (Math.hypot(p.x - (m.start.x + mux * t), p.z - (m.start.z + muz * t)) <= JOINT_EPS) return true;
    }
    return false;
  };

  const shifted = walls.map(w => {
    if (movers.has(w)) {
      return {
        ...w,
        start: point(clean(w.start.x + stepX), clean(w.start.z + stepZ)),
        end: point(clean(w.end.x + stepX), clean(w.end.z + stepZ)),
      };
    }
    const carry = p => (onMovers(p) ? point(clean(p.x + stepX), clean(p.z + stepZ)) : null);
    const s = carry(w.start);
    const e = carry(w.end);
    if (!s && !e) return w;
    return { ...w, start: s || w.start, end: e || w.end };
  });

  // Refuse a step that would crush a wall out of existence or push one off the
  // plate. On a drag this simply stops the wall at the limit.
  for (const w of shifted) {
    if (wallLength(w) < neededWallLength(room, w) - 1e-9) return null;
    for (const p of [w.start, w.end]) {
      if (p.x < -1e-9 || p.x > canvas.width + 1e-9) return null;
      if (p.z < -1e-9 || p.z > canvas.length + 1e-9) return null;
    }
  }
  return shifted;
}

/// Slides doors and windows so they stay on the wall they belong to.
///
/// Dragging can shorten a wall — a carried corner moves inward — and an opening
/// keeps its offset from the wall's start, so it can end up hanging past the
/// end. sanitize() fixes that, but only once the drag is committed; during the
/// drag the plan would draw a door in mid-air. Applying it as the wall moves
/// keeps what is on screen true at every step.
export function fitOpeningsToWalls(room) {
  for (const list of [room.doors || [], room.windows || []]) {
    for (const o of list) {
      const wall = (room.walls || []).find(w => w.id === o.wallID);
      if (!wall) continue;
      const room_ = wallLength(wall) - o.width - 0.10;
      if (room_ < 0.10) continue;          // too short; the drag guard stops this
      o.offset = clamp(o.offset, 0.10, room_);
    }
  }
}

/// The floor actually enclosed by the walls, in m².
///
/// Not width × length: on an L, a U or anything with a courtyard that measures
/// the bounding box and overstates the room, sometimes by a lot.
export function floorArea(room) {
  const regions = detectRooms(room);
  if (regions.length === 0) return clean((room.width || 0) * (room.length || 0));
  return clean(regions.reduce((sum, r) => sum + r.area, 0));
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
let _roomCache = { key: null, rooms: null, outsideWalls: null };

function roomSignature(room) {
  // Exported and callable on a half-built room (an import mid-parse, a caller
  // outside the app), so neither list is assumed to exist.
  const w = (room.walls || []).map(x => `${x.start.x},${x.start.z},${x.end.x},${x.end.z}`).join(";");
  const d = (room.doors || []).map(x => `${x.wallID}`).join(";");
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
    _roomCache = { key, rooms: result, outsideWalls: new Set() };
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
    _roomCache = { key, rooms: result, outsideWalls: new Set() };
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
  // The walls that region ran into are the ones facing the open air — the
  // building's skin, whatever shape it is. An L, a courtyard and a plain
  // rectangle all fall out of this correctly, which a bounding-box test would
  // not manage.
  const outsideWalls = new Set(
    (regions.find(r => r.id === outside) || { wallIDs: new Set() }).wallIDs);
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
  _roomCache = { key, rooms: result, outsideWalls };
  return result;
}

/// The ids of the walls that face the open air.
///
/// These are the building's outer skin. They are held still by default so that
/// editing the inside of a plan cannot accidentally reshape its footprint;
/// `dragUnlocked` on a wall overrides that for that one wall.
export function outsideFacingWalls(room) {
  detectRooms(room);
  return _roomCache.outsideWalls || new Set();
}

/// Whether this wall refuses to be dragged: an outer wall the user has not
/// explicitly unlocked.
export function wallDragLocked(room, wall) {
  if (!wall || wall.dragUnlocked) return false;
  return outsideFacingWalls(room).has(wall.id);
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

/// How far a wall end may be from the wall it plainly meets and still be
/// treated as meeting it.
///
/// Two centimetres. Below that a gap is not a decision anybody made — it is
/// what is left when a wall lands on a grid line half a centimetre from the
/// wall it was drawn up to, or when the plate is resized to a size the grid
/// does not divide. Above it, a gap is a doorway or a deliberate slot and is
/// left alone.
export const JOINT_HEAL_TOLERANCE = 0.02;

/// How close a wall being DRAGGED has to come before it sticks to the wall it
/// is heading for.
///
/// Drawing a wall against another one locks onto it from 35 cm away, because
/// that is the whole idea: you draw roughly and the walls meet exactly. A wall
/// being dragged had no such thing — it went precisely where the pointer left
/// it, which is how a room came to be five millimetres from closed. Six
/// centimetres is close enough to be plainly aimed at the wall and far enough
/// that a wall deliberately set a hand's width away stays there.
export const WALL_DRAG_SNAP = 0.06;

/// Closes hairline gaps where a wall stops just short of another one.
///
/// A room is enclosed or it is not, and the difference can be five millimetres
/// nobody can see: a plan that plainly shows four walls round a room reported
/// one region of eighty square metres, because two of the walls stopped 5 mm
/// from the wall they met. No area label, no room in the count, and nothing on
/// screen to explain why.
///
/// Only the coordinate ACROSS the wall is moved, so a wall never goes diagonal
/// to close a gap, and only when the end lies within the span of the wall it is
/// reaching — a wall pointing at empty space stays where it is.
export function healWallJoints(room, opts = {}) {
  // Until it settles. Closing one joint can bring another end within reach —
  // pull a wall onto the line it meets and the wall joined to ITS far end
  // moves with it — so a single pass leaves work behind, and a plan that heals
  // further every time it is loaded is a plan that never comes back the same
  // way twice.
  let total = 0;
  for (let pass = 0; pass < 4; pass++) {
    const moved = healPass(room, opts);
    total += moved;
    if (!moved) break;
  }
  return total;
}

function healPass(room, { only = null, tolerance = JOINT_HEAL_TOLERANCE } = {}) {
  const walls = room.walls || [];
  let healed = 0;
  for (const wall of walls) {
    // `only` is the walls a drag has just moved. Everything else stays where it
    // is: a wall being dragged past another should stick to it, but the wall it
    // passes must not come away from where it was drawn.
    if (only && !only.has(wall.id)) continue;
    const vertical = Math.abs(wall.start.x - wall.end.x) < 1e-6;
    const horizontal = Math.abs(wall.start.z - wall.end.z) < 1e-6;
    if (vertical === horizontal) continue;           // diagonal: leave it alone
    for (const end of [wall.start, wall.end]) {
      for (const other of walls) {
        if (other === wall) continue;
        const otherVertical = Math.abs(other.start.x - other.end.x) < 1e-6;
        const otherHorizontal = Math.abs(other.start.z - other.end.z) < 1e-6;
        if (otherVertical === otherHorizontal) continue;
        // A wall can only be closed onto one running the other way.
        if (otherVertical === vertical) continue;
        const axis = otherVertical ? "x" : "z";
        const along = otherVertical ? "z" : "x";
        const line = other.start[axis];
        const lo = Math.min(other.start[along], other.end[along]);
        const hi = Math.max(other.start[along], other.end[along]);
        const gap = Math.abs(end[axis] - line);
        if (gap < 1e-9 || gap > tolerance) continue;
        if (end[along] < lo - tolerance || end[along] > hi + tolerance) continue;
        end[axis] = clean(line);
        healed++;
        break;
      }
    }
  }
  return healed;
}

/// Cuts a wall wherever another wall meets it, so one wall is one room's wall.
///
/// The way a plan gets drawn: one long wall across the whole space to set the
/// shape, then dividers to make it into rooms. The long wall stayed a single
/// nine-metre wall, so a door in the middle room belonged to a wall spanning
/// all three — it measured its position from the far end of the building, and
/// dragging it ran the length of the floor. The drawing said three rooms and
/// the model said one wall.
///
/// So the model is brought into line with the drawing: where a wall's end lands
/// on another wall, that wall is cut there. Nothing moves and nothing is drawn
/// differently — a wall and its pieces occupy exactly the same line — but every
/// door, window and measurement afterwards belongs to the wall of ITS room.
///
/// Two things are left alone. A cut closer than a wall's minimum length to
/// either end would make a stub that sanitize drops on the next load, and a cut
/// inside a door or window would slice the opening in half, so neither is made.
export function splitWallsAtJunctions(room) {
  const walls = room.walls || [];
  const openings = [...(room.doors || []), ...(room.windows || [])];
  const out = [];
  let split = 0;

  for (const wall of walls) {
    const vertical = Math.abs(wall.start.x - wall.end.x) < 1e-6;
    const horizontal = Math.abs(wall.start.z - wall.end.z) < 1e-6;
    if (vertical === horizontal) { out.push(wall); continue; }
    const axis = vertical ? "z" : "x";
    const fixed = vertical ? "x" : "z";
    const from = wall.start[axis];
    const to = wall.end[axis];
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const line = wall.start[fixed];

    // Where other walls meet this one, as distances along it from its start.
    const cuts = [];
    for (const other of walls) {
      if (other === wall) continue;
      for (const end of [other.start, other.end]) {
        if (Math.abs(end[fixed] - line) > 1e-6) continue;
        if (end[axis] <= lo + MIN_WALL_LENGTH || end[axis] >= hi - MIN_WALL_LENGTH) continue;
        const at = Math.abs(end[axis] - from);
        if (cuts.some(c => Math.abs(c - at) < 1e-6)) continue;
        cuts.push(at);
      }
    }
    if (!cuts.length) { out.push(wall); continue; }

    // Not through an opening: that would leave half a door on each piece.
    const mine = openings.filter(o => o.wallID === wall.id);
    const usable = cuts
      .filter(at => !mine.some(o => at > o.offset - 0.02 && at < o.offset + o.width + 0.02))
      .sort((a, b) => a - b);
    if (!usable.length) { out.push(wall); continue; }

    const marks = [0, ...usable, wallLength(wall)];
    const pieces = [];
    for (let i = 0; i < marks.length - 1; i++) {
      const a = wallPointAt(wall, marks[i]);
      const b = wallPointAt(wall, marks[i + 1]);
      pieces.push({
        ...wall,
        // The first piece keeps the wall's identity, so a selection, an undo
        // step or an opening that is already on it still means something.
        id: i === 0 ? wall.id : uid(),
        start: point(clean(a.x), clean(a.z)),
        end: point(clean(b.x), clean(b.z)),
      });
      if (i > 0) split++;
    }
    out.push(...pieces);

    // Each opening goes to exactly one piece: the one its MIDDLE lies on.
    //
    // Chosen for it rather than offered to each piece in turn, so there is no
    // way for two to take it or for none to. By the middle rather than by
    // fitting entirely, because an opening left over from an earlier edit can
    // hang past the end of its wall, and it still has to land somewhere — left
    // behind, it keeps an offset measured from the uncut wall, and the next
    // load quietly pulls it back. A plan that changes on its way through a save
    // is the one thing a plan may never do.
    for (const o of mine) {
      const middle = o.offset + o.width / 2;
      let at = 0;
      while (at < pieces.length - 1 && middle > marks[at + 1] + 1e-6) at++;
      o.wallID = pieces[at].id;
      o.offset = o.offset - marks[at];
    }
  }

  room.walls = out;
  // Settle the openings with the same code a load uses, rather than clamping
  // them here. Doing the same arithmetic a different way gave 1.155 on the way
  // out and 1.1549999999999994 on the way back, and a plan that changes on its
  // way through a save is a plan you cannot trust.
  fitOpeningsToWalls(room);
  return split;
}

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
  // Close the joints before anything downstream asks what the walls enclose.
  // Every path into the model comes through here — drawing, dragging, loading,
  // undo — so a room that looks closed is closed by the time it is measured.
  healWallJoints(room);
  // Note that the walls are NOT cut at their junctions here. Cutting is what an
  // EDIT does, not what reading a file does: sanitize runs on every load, and a
  // load that changes the plan means the plan you saved is not the plan you get
  // back. See splitWallsAtJunctions, which the store calls when an edit lands.
  const wallIDs = new Set(room.walls.map(w => w.id));

  room.doors = room.doors
    .map(d => ({
      ...d,
      width: clamp(d.width, 0.6, 1.4),
      open: d.open === undefined ? true : !!d.open,
      swingInside: d.swingInside === undefined ? true : !!d.swingInside,
      // Which end of the opening the hinge is on. Absent in older files, which
      // were all hinged at the start.
      hingeAtEnd: !!d.hingeAtEnd,
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
    item.rotationDegrees = quarterTurn(item.rotationDegrees);
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
      rotationDegrees: quarterTurn(l.rotationDegrees),
      size: clamp(Number(l.size) || LABEL_DEFAULT_SIZE, 0.08, 1.0),
    }));

  syncExtent(room);
}

/// Makes `origin`, `width` and `length` describe the walls that are actually
/// drawn, rather than being a size someone typed once.
///
/// They used to be stored independently, so editing them moved no walls and
/// editing walls moved no numbers. The two drifted apart, and because the room
/// generator, the SVG title block and the 3D view all size themselves from
/// these fields, a plan could be laid out, printed and walked in a rectangle
/// that had nothing to do with the building. Deriving them here — the one place
/// every edit passes through — makes that impossible.
///
/// For anything other than a plain rectangle this is the overall extent, which
/// is what those consumers need. The floor actually enclosed is floorArea().
export function syncExtent(room) {
  const bounds = wallsBounds(room);
  if (!bounds) return;                    // nothing drawn: keep what was stored
  const width = clean(bounds.maxX - bounds.minX);
  const length = clean(bounds.maxZ - bounds.minZ);
  if (width < 0.01 || length < 0.01) return;
  room.origin = { x: clean(bounds.minX), z: clean(bounds.minZ) };
  room.width = width;
  room.length = length;
}

// MARK: - Auto room layout

/// The shortest side a generated room may have.
export const MIN_ROOM_DIM = 1.60;

/// How wide a carved hallway is.
///
/// Wide enough for two people to pass and for furniture to be carried through,
/// and the width a corridor is drawn at in a domestic plan. It is only carved
/// when there is nothing else for rooms to open onto — floor the user has
/// already marked as circulation is used as it is.
export const CORRIDOR_WIDTH = 1.20;

/// How much frontage onto the circulation a room needs before it counts as
/// having a way in. A standard door is 90 cm; anything less than that and the
/// door step cannot place one however much it would like to.
export const DOOR_FRONTAGE = 0.90;

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
function layoutGrid(layout, obstacles, guides = { xs: [], zs: [] }) {
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
function freeComponents(grid) {
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
function wallBarriers(grid, walls) {
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
function stepBlocked(grid, i, j, ni, nj) {
  if (!grid.wallLeft) return false;
  if (ni === i - 1) return !!grid.wallLeft[grid.at(i, j)];
  if (ni === i + 1) return !!grid.wallLeft[grid.at(ni, nj)];
  if (nj === j - 1) return !!grid.wallBelow[grid.at(i, j)];
  if (nj === j + 1) return !!grid.wallBelow[grid.at(ni, nj)];
  return false;
}

function isConnected(grid, cells) {
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
function tooThin(grid, cells) {
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
function wrapping(grid, cells) {
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
function sliceByWeights(grid, cells, weights, rng, circ = null) {
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
function connectedParts(grid, cells) {
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

/// How much wall a piece of floor has facing circulation.
///
/// This is what limits how many rooms can be cut from it: every room needs its
/// own stretch of that frontage to put a door in. A piece touching the hallway
/// only at one corner can hold exactly one room however big it is.
function frontageLength(grid, cells, circulation) {
  const { nx, nz, at, xs, zs } = grid;
  let total = 0;
  for (const [i, j] of cells) {
    const dx = xs[i + 1] - xs[i];
    const dz = zs[j + 1] - zs[j];
    if (i > 0 && circulation[at(i - 1, j)] && !stepBlocked(grid, i, j, i - 1, j)) total += dz;
    if (i + 1 < nx && circulation[at(i + 1, j)] && !stepBlocked(grid, i, j, i + 1, j)) total += dz;
    if (j > 0 && circulation[at(i, j - 1)] && !stepBlocked(grid, i, j, i, j - 1)) total += dx;
    if (j + 1 < nz && circulation[at(i, j + 1)] && !stepBlocked(grid, i, j, i, j + 1)) total += dx;
  }
  return total;
}

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
function joinSeparatePieces(plan, doorList, openingAt) {
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
function absorbStrandedFloor(grid, owner, SPARE, circulation = null) {
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
function partitionFloor(grid, count, rng, circ = null) {
  const components = freeComponents(grid).filter(c => c.length > 0);
  if (components.length === 0) return { rooms: [], spare: [] };
  const { at, area } = grid;
  const areaOf = cells => cells.reduce((s, [i, j]) => s + area[at(i, j)], 0);

  const sizes = components.map(areaOf);
  const totalFree = sizes.reduce((a, b) => a + b, 0);
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
      if (!pieces[k].length) continue;
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
function ownedRects(grid, owner, id) {
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
function roomBoundaries(grid, owner) {
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

export function autoLayoutRooms(room, opts = {}) {
  const count = clamp(Math.round(opts.count ?? 3), 1, 20);
  const windows = !!opts.windows;
  const rng = layoutRandom(opts.seed ?? 1);
  const origin = roomOrigin(room);
  const layout = { x: origin.x, z: origin.z, w: room.width, l: room.length };

  // Walls the user drew stay. Only partitions a previous run of this generator
  // added are torn down, so running Generate inside a prepared template keeps
  // its stairwell, bathroom and windows instead of replacing the lot.
  const keptWalls = (room.walls || []).filter(w => !w.generated);
  const keptIDs = new Set(keptWalls.map(w => w.id));
  const keptDoors = (room.doors || []).filter(d => !d.generated && keptIDs.has(d.wallID));
  const keptWindows = (room.windows || []).filter(w => !w.generated && keptIDs.has(w.wallID));

  // Circulation the user drew. This is floor to build UP AGAINST, not floor to
  // build on — and emphatically not a reason to carve more of it.
  const publics = (room.publicAreas || [])
    .filter(a => !a.generated)
    .map(a => ({
      x: clamp(a.x, layout.x, layout.x + layout.w),
      z: clamp(a.z, layout.z, layout.z + layout.l),
      w: clamp(a.w, 0, layout.w),
      l: clamp(a.l, 0, layout.l),
    }))
    .filter(a => a.w > 0.3 && a.l > 0.3);

  // Anything already walled off that could not be split in two is a room in its
  // own right, and is treated as occupied.
  const holdsTwoRooms = b => {
    const w = b.maxX - b.minX;
    const l = b.maxZ - b.minZ;
    return Math.min(w, l) >= MIN_ROOM_DIM && Math.max(w, l) >= MIN_ROOM_DIM * 2;
  };
  let built = [];
  try {
    built = detectRooms({ ...room, walls: keptWalls, publicAreas: [] })
      .filter(r => r.area > 0 && !holdsTwoRooms(r.bounds))
      .map(r => ({
        x: r.bounds.minX, z: r.bounds.minZ,
        w: clean(r.bounds.maxX - r.bounds.minX),
        l: clean(r.bounds.maxZ - r.bounds.minZ),
      }));
  } catch { built = []; }

  // A walkway drawn flush against the shell sits a centimetre or two off the
  // wall's centre line — inside the wall, not beside it. Growing the obstacle
  // onto the boundary removes the resulting sliver of unusable floor.
  const toEdge = r => {
    let { x, z, w, l } = r;
    const x2 = x + w, z2 = z + l;
    const lx = layout.x, lz = layout.z, lx2 = layout.x + layout.w, lz2 = layout.z + layout.l;
    if (x > lx && x - lx <= WALL_THICKNESS) { w += x - lx; x = lx; }
    if (z > lz && z - lz <= WALL_THICKNESS) { l += z - lz; z = lz; }
    if (x2 < lx2 && lx2 - x2 <= WALL_THICKNESS) w += lx2 - x2;
    if (z2 < lz2 && lz2 - z2 <= WALL_THICKNESS) l += lz2 - z2;
    return { x, z, w: clean(w), l: clean(l) };
  };
  // Rounded to the same precision the grid lines use, so a cell edge placed at
  // an obstacle edge lands exactly on it rather than a fraction of a millimetre
  // inside it.
  const blockers = [...publics, ...built].map(toEdge).map(r => ({
    x: clean(r.x), z: clean(r.z), w: clean(r.w), l: clean(r.l),
  }));

  // Every end of a wall the user drew becomes a grid line. Without this a
  // generated boundary can run along the same line as an existing wall and
  // overlap only PART of it — neither the same wall nor a separate one — and
  // the plan comes back with two walls lying on top of each other, which the
  // editor rightly flags. With it, a generated run either coincides with the
  // existing wall exactly, and is folded into it, or lies clear of it.
  const guides = { xs: [], zs: [] };
  for (const w of keptWalls) {
    guides.xs.push(w.start.x, w.end.x);
    guides.zs.push(w.start.z, w.end.z);
  }
  guides.xs = [...new Set(guides.xs.map(clean))];
  guides.zs = [...new Set(guides.zs.map(clean))];
  const grid = layoutGrid(layout, blockers, guides);
  // The walls the user drew divide the floor as surely as the ones about to be
  // built, so the partition has to see them. Without this a room is laid across
  // one, given a single door, and cut in two by the wall: one half with the
  // door, one half sealed.
  Object.assign(grid, wallBarriers(grid, keptWalls));
  let freeArea = 0;
  for (let c = 0; c < grid.blocked.length; c++) if (!grid.blocked[c]) freeArea += grid.area[c];
  if (freeArea < MIN_ROOM_DIM * MIN_ROOM_DIM) return null;

  // Asking for twenty rooms in sixteen square metres cannot be honoured; each
  // would be under a metre across. Cap the count at what the floor can hold as
  // real rooms and return fewer, rather than returning nothing at all.
  const viable = Math.max(1, Math.floor(freeArea / (MIN_ROOM_DIM * MIN_ROOM_DIM)));
  // The area asked for is a floor, not a target: the rooms fill the space left
  // between the green areas, so what it decides is how MANY of them there is
  // room for. Ask for six rooms of eighteen square metres in sixty and you get
  // three of twenty, rather than six of ten with the difference nowhere.
  const wantedArea = Number(opts.area) > 0 ? Number(opts.area) : 0;
  const fit = wantedArea > 0 ? Math.max(1, Math.floor(freeArea / wantedArea)) : count;
  const roomCount = Math.min(count, viable, fit);

  // What was asked for, and what the floor can actually give.
  //
  // The rooms fill the floor they are given. Floor the user marked green is
  // where people walk and where the doors swing, and it is the only walking
  // space the plan is meant to have — so what is left over is rooms, not more
  // corridor. Asking for rooms smaller than the space divides into used to
  // leave the difference lying between them as walkable floor nobody had asked
  // for: a third of the plate on a ten-by-eight with a hall drawn down it.
  //
  // The way to get a small room in a large space is to mark the rest green,
  // which is what green is for.
  //
  // Only kept for the report at the end, which says what was asked for beside
  // what the floor gave. The partition works in ratios, so an area in metres
  // would mean nothing to it.
  const requestedArea = wantedArea > 0 ? wantedArea : freeArea / roomCount;

  // ── Something for every room to open onto ───────────────────────────────
  //
  // A room reached only by walking through another room is not a room with a
  // way in. So before the floor is divided up, the circulation is settled:
  // whatever the user marked counts as it, and any stretch of free floor with
  // none of its own has a hallway cut through it. The partition below then
  // refuses any cut that would leave a piece with no frontage onto it.
  const cellCount = grid.nx * grid.nz;
  const circulation = new Uint8Array(cellCount);
  for (let i = 0; i < grid.nx; i++) {
    for (let j = 0; j < grid.nz; j++) {
      const midX = (grid.xs[i] + grid.xs[i + 1]) / 2;
      const midZ = (grid.zs[j] + grid.zs[j + 1]) / 2;
      if (publics.some(a => midX > a.x && midX < a.x + a.w && midZ > a.z && midZ < a.z + a.l)) {
        circulation[grid.at(i, j)] = 1;
      }
    }
  }
  // A piece is given a hallway when what it already fronts onto cannot serve
  // the rooms it has to hold. Carving only where there is NO circulation at all
  // is not enough: a piece touching a walkway at one corner has somewhere to
  // open onto, but only enough of it for a single room, and the rest of the
  // rooms asked for simply never get built. Each room needs a room's width of
  // frontage to put its own door in.
  // No hallway is cut where the user marked none.
  //
  // "The green public space is where people walk and doors swing into. So the
  // auto layout planner does not create public space — it is the area it needs
  // to build the rooms around." Cutting one anyway is making walking space by
  // another name: unmarked, but walked on, and taking floor from the rooms to
  // do it. Where the user has marked the walking space the rooms are laid
  // against it; where they have not, the rooms fill the plate and open to the
  // outside, and the app says what to draw to do better.
  const hallway = [];

  // The free cells that touch circulation. A piece of the partition has to keep
  // at least one of these, or the rooms cut from it have no frontage.
  let anyCirculation = false;
  for (let c = 0; c < cellCount; c++) if (circulation[c]) { anyCirculation = true; break; }
  const fronts = new Uint8Array(cellCount);
  if (anyCirculation) {
    for (let i = 0; i < grid.nx; i++) {
      for (let j = 0; j < grid.nz; j++) {
        const c = grid.at(i, j);
        if (grid.blocked[c]) continue;
        for (const [ni, nj] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) {
          if (ni < 0 || nj < 0 || ni >= grid.nx || nj >= grid.nz) continue;
          if (circulation[grid.at(ni, nj)]) { fronts[c] = 1; break; }
        }
      }
    }
  }

  // What the rooms are laid against: the floor the user marked, and which free
  // cells touch it. Null when nothing is marked, and then the partition has no
  // frontage to respect — the rooms simply fill the plate.
  const circ = anyCirculation ? { circulation, fronts, hallway } : null;
  const { rooms: pieces, spare } = partitionFloor(grid, roomCount, rng, circ);
  if (pieces.length === 0) return null;
  const owner = new Int32Array(grid.nx * grid.nz).fill(-1);
  pieces.forEach((cells, k) => {
    for (const [i, j] of cells) owner[grid.at(i, j)] = k;
  });
  // Floor left over once every room has the area it was asked for. It is marked
  // as open space rather than left unclaimed: unclaimed cells get walled off by
  // the rooms around them and become a void nobody can reach. This is NOT a
  // carved corridor — nothing was cut to make a path, it is simply the floor
  // that was not needed.
  const SPARE = -5;
  for (const cells of spare) for (const [i, j] of cells) owner[grid.at(i, j)] = SPARE;
  // A carved hallway IS circulation, and is treated exactly like floor that was
  // left over: it shows on the plan as open space, the rooms along it open onto
  // it, and the next run lays out against it rather than cutting another one.
  for (const [i, j] of hallway) owner[grid.at(i, j)] = SPARE;
  // Deliberately built AFTER the rooms are settled, from everything that ended
  // up as open floor: the leftover shares, the carved hallway, and any piece
  // the partition could not use. Building it from the shares alone left the
  // discarded pieces out, and they are exactly the floor that must not be
  // walled in.
  const spareRectsOf = () => {
    const tmp = new Int32Array(owner.length).fill(-1);
    let any = false;
    for (let c = 0; c < owner.length; c++) if (owner[c] === SPARE) { tmp[c] = 0; any = true; }
    return any ? ownedRects(grid, tmp, 0) : [];
  };

  // ── Leftover floor that leads nowhere becomes part of the room it sits in
  //
  // The floor not needed for rooms is open floor, and open floor is fine when
  // it is the hallway. But it does not come out in one piece: a corner left
  // over behind a room is its own little enclosure, walled in by the rooms
  // around it, with no door and no way in — floor you can see on the plan and
  // never stand on. Every such pocket is given to the room beside it, which is
  // what it looks like anyway.
  absorbStrandedFloor(grid, owner, SPARE, circulation);

  // ── Anything still cut off gets the hallway run to it ──────────────────
  //
  // The partition refuses to make a room without frontage, but it can only
  // refuse a CUT: a room can still end up walled in by the pieces around it,
  // and then the door step has nowhere to put its door except a neighbour's
  // wall — which is the "walk through someone else's room" this is supposed to
  // rule out — or the outside wall, which is a bedroom door onto the street.
  //
  // So the hallway is run to it: the shortest way from the circulation to that
  // room, widened to a corridor, taken out of whatever it crosses. That costs
  // the rooms it passes through some floor, which is what a corridor costs in
  // a real building too.

  // Drop anything too small or too thin to be a room, then renumber so the ids
  // that survive are contiguous.
  const kept = [];
  for (let k = 0; k < pieces.length; k++) {
    const rects = ownedRects(grid, owner, k);
    if (pieces[k].length === 0 || rects.length === 0) continue;
    const a = rects.reduce((sum, r) => sum + r.w * r.l, 0);
    const bounds = rects.reduce((b, r) => ({
      minX: Math.min(b.minX, r.x), maxX: Math.max(b.maxX, r.x + r.w),
      minZ: Math.min(b.minZ, r.z), maxZ: Math.max(b.maxZ, r.z + r.l),
    }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
    const thin = Math.min(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) < MIN_ROOM_DIM * 0.6;
    if (a < 1 || thin) continue;
    kept.push({ old: k, rects, area: clean(a), bounds });
  }
  if (kept.length === 0) return null;

  const renumber = new Int32Array(pieces.length).fill(-1);
  kept.forEach((r, i) => { renumber[r.old] = i; });
  // A piece too small or too thin to be a room is not left unclaimed. Unclaimed
  // floor gets walled in by the rooms around it and becomes a void nobody can
  // reach — which is where almost every doorless space on a generated plan came
  // from: not a room the door step failed on, but a piece the partition threw
  // away and then built walls around. It becomes open floor instead.
  for (let c = 0; c < owner.length; c++) {
    if (owner[c] < 0) continue;
    const to = renumber[owner[c]];
    owner[c] = to < 0 ? SPARE : to;
  }

  const segments = roomBoundaries(grid, owner);

  const key = (ax, az, bx, bz) => {
    const p1 = `${clean(ax)},${clean(az)}`, p2 = `${clean(bx)},${clean(bz)}`;
    return p1 < p2 ? `${p1}|${p2}` : `${p2}|${p1}`;
  };
  const wallByKey = new Map();
  for (const w of keptWalls) {
    const k = key(w.start.x, w.start.z, w.end.x, w.end.z);
    if (!wallByKey.has(k)) wallByKey.set(k, w);
  }
  const addEdge = (from, to) => {
    const k = key(from.x, from.z, to.x, to.z);
    if (wallByKey.has(k)) return wallByKey.get(k);
    const wall = {
      id: uid(),
      start: point(clean(from.x), clean(from.z)),
      end: point(clean(to.x), clean(to.z)),
      generated: true,
    };
    wallByKey.set(k, wall);
    return wall;
  };

  // Where each room can be entered: a boundary run with walkway on the far
  // side, else the open air, else a neighbouring room.
  // Frontage onto the floor the USER marked is kept apart from frontage onto
  // floor that merely ended up spare. They are both walkable, but they are not
  // the same thing: the green floor is where people walk and where the doors
  // swing, drawn deliberately, and it is what the rooms are supposed to be
  // arranged around. Left in one bucket, a room with a hall on one side and a
  // leftover corner on the other took whichever run happened to be longer, and
  // fewer than one room in six ended up opening onto the hall.
  const access = kept.map(() => ({ walkway: [], circulation: [], outside: [], neighbour: [] }));
  /// Splits a boundary run against the walls the user drew that lie along the
  /// same line, so each piece either IS one of those walls or is clear of it.
  ///
  /// Without this a generated run can overlap PART of an existing wall — the
  /// same line, a different span — which is neither the same wall nor a
  /// separate one, and the plan comes back with two walls lying on top of each
  /// other. Breaking the run at the existing wall's ends is not enough on its
  /// own, because runs are merged by which rooms they separate and sail
  /// straight through a grid line that does not change that.
  const piecesOf = (from, to) => {
    const vertical = Math.abs(from.x - to.x) < 1e-6;
    const axis = vertical ? "z" : "x";
    const fixed = vertical ? "x" : "z";
    const lo = Math.min(from[axis], to[axis]);
    const hi = Math.max(from[axis], to[axis]);
    const along = keptWalls
      .filter(w => {
        const wv = Math.abs(w.start.x - w.end.x) < 1e-6;
        return wv === vertical && Math.abs(w.start[fixed] - from[fixed]) < 1e-6;
      })
      .map(w => ({
        lo: Math.min(w.start[axis], w.end[axis]),
        hi: Math.max(w.start[axis], w.end[axis]),
        wall: w,
      }))
      .sort((a, b) => a.lo - b.lo);

    const out = [];
    let cursor = lo;
    for (const span of along) {
      if (span.hi <= cursor || span.lo >= hi) continue;
      if (span.lo > cursor) out.push({ lo: cursor, hi: Math.min(span.lo, hi), wall: null });
      const from2 = Math.max(cursor, span.lo);
      const to2 = Math.min(hi, span.hi);
      if (to2 > from2) out.push({ lo: from2, hi: to2, wall: span.wall });
      cursor = Math.max(cursor, span.hi);
      if (cursor >= hi) break;
    }
    if (cursor < hi) out.push({ lo: cursor, hi, wall: null });

    const at = v => (vertical ? point(from.x, v) : point(v, from.z));
    return out
      .filter(pc => pc.hi - pc.lo > 1e-9)
      .map(pc => ({ from: at(pc.lo), to: at(pc.hi), wall: pc.wall, span: pc.hi - pc.lo }));
  };

  for (const raw of segments) {
    for (const piece of piecesOf(raw.from, raw.to)) {
      const sg = { from: piece.from, to: piece.to, a: raw.a, b: raw.b, existing: piece.wall };
      const span = piece.span;
    // EVERY boundary becomes a wall, however short. Skipping the short ones
    // leaves gaps, and a gap is not a stub — it is a hole that joins two rooms
    // into one: a plan of six 14 m² rooms came back with a 58 m² region because
    // three of them were connected through 30 cm of missing wall.
    const wall = sg.existing || addEdge(sg.from, sg.to);
    const mid = { x: (sg.from.x + sg.to.x) / 2, z: (sg.from.z + sg.to.z) / 2 };
    const nearWalk = publics.some(a =>
      mid.x >= a.x - 0.08 && mid.x <= a.x + a.w + 0.08
      && mid.z >= a.z - 0.08 && mid.z <= a.z + a.l + 0.08);
    if (span < 0.35) continue;              // too short to hang a door on
    // Where this run sits ALONG the wall. Several rooms can front onto one wall
    // — every room along the top of a plan shares the outer wall — so "does
    // this wall have a door" is the wrong question. It has to be "is there a
    // door in the stretch this room actually touches", or the first room along
    // the wall takes the only door and the rest are left with no way in.
    const p1 = wallProjection(wall, sg.from).offset;
    const p2 = wallProjection(wall, sg.to).offset;
    const range = { lo: Math.min(p1, p2), hi: Math.max(p1, p2) };
    for (const [mine, other] of [[sg.a, sg.b], [sg.b, sg.a]]) {
      if (mine < 0) continue;
      const entry = { wall, length: span, range };
      if (other >= 0) access[mine].neighbour.push(entry);
      else if (nearWalk) access[mine].walkway.push(entry);
      else if (other === SPARE) access[mine].circulation.push(entry);
      else access[mine].outside.push(entry);
    }
    }
  }

  // Everything already sitting on each wall, so a new opening goes in a gap
  // rather than on top of one. Refusing a wall outright because it has anything
  // on it was too blunt: the template's outer wall is 4.87 m with three windows
  // on it and metres to spare, and every room along it was being told there was
  // no way in.
  const occupied = new Map();
  const occupy = (id, from, to) => {
    if (!occupied.has(id)) occupied.set(id, []);
    occupied.get(id).push({ from, to });
  };
  for (const o of [...(room.doors || []), ...(room.windows || [])]) {
    occupy(o.wallID, o.offset, o.offset + o.width);
  }

  /// Where an opening of `width` can sit on this wall without landing on
  /// anything already there. `preferred`, when given, is the offset it would
  /// like; the nearest clear gap to it wins. Returns null if nothing fits.
  const gapOn = (wall, width, preferred = null, range = null) => {
    const len = wallLength(wall);
    if (len < width + 0.20) return null;
    const taken = (occupied.get(wall.id) || []).slice().sort((a, b) => a.from - b.from);
    let gaps = [];
    let cursor = 0.10;
    for (const span of [...taken, { from: len - 0.10, to: len - 0.10 }]) {
      if (span.from - cursor >= width) gaps.push({ from: cursor, to: span.from });
      cursor = Math.max(cursor, span.to);
    }
    // Confine the search to the stretch of wall this room fronts onto, so the
    // door lands in its own room and not in the neighbour's.
    if (range) {
      gaps = gaps
        .map(g => ({ from: Math.max(g.from, range.lo), to: Math.min(g.to, range.hi) }))
        .filter(g => g.to - g.from >= width);
    }
    if (gaps.length === 0) return null;
    let best = null;
    for (const g of gaps) {
      const lo = g.from;
      const hi = g.to - width;
      const at = preferred === null ? lo + (g.to - g.from - width) / 2 : clamp(preferred, lo, hi);
      const away = preferred === null ? -(g.to - g.from) : Math.abs(at - preferred);
      if (!best || away < best.away) best = { at: clean(at), away };
    }
    return best.at;
  };

  /// Puts an opening in a clear stretch of a wall, or null if there is none.
  const opening = (wall, width, range = null) => {
    const offset = gapOn(wall, width, null, range);
    if (offset === null) return null;
    occupy(wall.id, offset, offset + width);
    return { id: uid(), wallID: wall.id, offset, width, open: true, swingInside: true, generated: true };
  };

  const doors = [];
  const winList = [];
  const hasDoor = new Set((room.doors || []).map(d => d.wallID));
  const hasWindow = new Set((room.windows || []).map(w => w.wallID));

  // Rooms with the least choice are served first, so a room whose only way in
  // is one short wall is not left out because a neighbour took it.
  const byNeed = kept
    .map((r, k) => ({ k, choices: access[k].walkway.length
      + access[k].circulation.length + access[k].outside.length }))
    .sort((a, b) => a.choices - b.choices);

  // A standard door first; a narrower one only if nothing else will take it. In
  // a cramped plan every boundary can be shorter than 1.1 m — a 0.9 m door plus
  // its clearances — and the room was simply left with no way in.
  const DOOR_WIDTHS = [0.9, 0.75, 0.6];
  const doorIn = c => [...doors, ...(room.doors || [])].some(d =>
    d.wallID === c.wall.id
    && d.offset + d.width > c.range.lo - 0.02
    && d.offset < c.range.hi + 0.02);

  const fitDoor = walls => {
    for (const width of DOOR_WIDTHS) {
      for (const c of walls) {
        const d = opening(c.wall, width, c.range);
        if (d) { doors.push(d); hasDoor.add(c.wall.id); return true; }
      }
    }
    return false;
  };

  // First pass: every room gets its own door, onto the circulation if it has
  // any frontage on it. Circulation is tried BEFORE the open air, not sorted in
  // with it — sorting the two together by length puts the door of an inside
  // room in the outer wall whenever the outer wall is the longer run, which is
  // most of the time. A door onto the street is the front door; it is not how
  // you get into a bedroom.
  const longestFirst = list => [...list].sort((a, b) => b.length - a.length);
  for (const { k } of byNeed) {
    const own = [...access[k].walkway, ...access[k].circulation, ...access[k].outside];
    if (own.some(doorIn)) continue;
    // In order of what the door ought to open onto: the floor the user marked
    // for walking, then floor that happens to be spare, then the open air.
    fitDoor(longestFirst(access[k].walkway))
      || fitDoor(longestFirst(access[k].circulation))
      || fitDoor(longestFirst(access[k].outside));
  }
  // Second pass: a room with no frontage of its own has to borrow a neighbour's
  // wall, but only if it has no way in at all yet.
  for (const { k } of byNeed) {
    const all = [...access[k].walkway, ...access[k].circulation,
                 ...access[k].outside, ...access[k].neighbour];
    if (all.some(doorIn)) continue;
    fitDoor(all.sort((a, b) => b.length - a.length));
  }

  if (windows) {
    for (let k = 0; k < kept.length; k++) {
      for (const c of [...access[k].outside].sort((a, b) => b.length - a.length)) {
        const win = opening(c.wall, 1.0, c.range);
        if (win) { winList.push(win); hasWindow.add(c.wall.id); break; }
      }
    }
  }

  // A generated partition lying on top of a wall the user drew is redundant.
  const covers = (host, w) => {
    const hv = Math.abs(host.start.x - host.end.x) < 1e-6;
    const wv = Math.abs(w.start.x - w.end.x) < 1e-6;
    if (hv !== wv) return false;
    const axis = hv ? "x" : "z";
    const along = hv ? "z" : "x";
    if (Math.abs(host.start[axis] - w.start[axis]) > 1e-6) return false;
    const lo = Math.min(host.start[along], host.end[along]) - 1e-6;
    const hi = Math.max(host.start[along], host.end[along]) + 1e-6;
    return Math.min(w.start[along], w.end[along]) >= lo
      && Math.max(w.start[along], w.end[along]) <= hi;
  };
  // A generated slice that sits on top of a wall the user drew is folded into
  // it, and anything hung on the slice moves across. Dropping the slice without
  // re-homing its door silently threw the door away — four rooms each placed
  // one and only two survived.
  const sourceByID = new Map([...wallByKey.values()].map(w => [w.id, w]));
  const host = new Map();
  const walls = [];
  for (const w of wallByKey.values()) {
    const over = w.generated ? keptWalls.find(k => covers(k, w)) : null;
    if (over) host.set(w.id, over);
    else walls.push(w);
  }
  const rehome = o => {
    const target = host.get(o.wallID);
    if (!target) return o;
    const src = sourceByID.get(o.wallID);
    if (!src) return null;
    // Where it sat in the world, so it lands as close to that as it can.
    const len = wallLength(src) || 1;
    const t = (o.offset + o.width / 2) / len;
    const mid = {
      x: src.start.x + (src.end.x - src.start.x) * t,
      z: src.start.z + (src.end.z - src.start.z) * t,
    };
    const preferred = wallProjection(target, mid).offset - o.width / 2;
    // The host wall has its own openings — the template's outer wall carries
    // three windows — so this has to find a clear stretch there, not merely
    // clamp into range. Clamping put doors straight on top of windows.
    const offset = gapOn(target, o.width, preferred);
    if (offset === null) return null;
    occupy(target.id, offset, offset + o.width);
    return { ...o, wallID: target.id, offset };
  };
  const live = new Set(walls.map(w => w.id));

  // Windows are re-homed first: a door that has to move can then find a gap
  // around them rather than the other way round.
  const finalWindows = [...keptWindows, ...winList.map(rehome).filter(Boolean)]
    .filter(w => live.has(w.wallID));
  const finalDoors = [...keptDoors, ...doors.map(rehome).filter(Boolean)]
    .filter(d => live.has(d.wallID));

  // ── One plan, not several ───────────────────────────────────────────────
  //
  // Every room has a door onto the floor outside it, and that is still not
  // enough to be able to walk around: a room and the pocket of hallway it
  // opens onto can be an island, closed off from the rest by the rooms in
  // between. 121 rooms across 660 plans were on one, each with a door that
  // led only to its own private scrap of floor.
  //
  // So the finished plan is read back the way the editor reads it — spaces and
  // the doors between them — and wherever it falls into separate pieces, a
  // door is put in the wall between them until it does not.
  joinSeparatePieces(
    { ...room, walls: [...walls], doors: finalDoors, windows: finalWindows },
    finalDoors, opening);

  const rooms = kept.map(r => ({
    rects: r.rects,
    area: r.area,
    bounds: r.bounds,
    // The bounding box too, for anything that only wants somewhere to put a label.
    x: r.bounds.minX, z: r.bounds.minZ,
    w: clean(r.bounds.maxX - r.bounds.minX),
    l: clean(r.bounds.maxZ - r.bounds.minZ),
  }));
  const totalArea = rooms.reduce((s, r) => s + r.area, 0);

  return {
    walls,
    doors: finalDoors,
    windows: finalWindows,
    rooms,
    // Only floor that was genuinely left over once every room had its area —
    // never a path cut to reach somewhere. The old engine carved a corridor for
    // every band it filled, which on a plan that already had walkways drawn
    // doubled the walking space and took the difference out of the rooms.
    corridors: spareRectsOf(),
    areaPerRoom: clean(totalArea / rooms.length),
    // What each room would be if the floor divided evenly — the fallback the
    // report uses when no size was asked for.
    targetArea: clean(freeArea / roomCount),
    requested: { count, area: Number(opts.area) > 0 ? Number(opts.area) : null },
    score: 0,
    alternatives: 1,
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

/// The server file name for a room name. The Room Name IS the file: renaming a
/// design and saving it starts a new one rather than adding a version to the
/// old.
///
/// Server names are limited to [A-Za-z0-9_-], so accents are folded to their
/// base letter (Küche -> Kuche) rather than dropped, and every other run of
/// characters becomes a single dash. An empty result means "no name yet", and
/// the server allocates the next ternak_roomN.
export function roomSlug(name) {
  return String(name == null ? "" : name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 48)
    .replace(/[-_]+$/, "");   // the cap can land mid-word and leave a trailing dash
}

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
