// Wall geometry: length, direction, projection, joins, seals, dragging, and the whole-wall queries.
//
// Part of the plan model; the public entry point is ../plan.js, which re-exports
// every module here.

import { MIN_WALL_LENGTH, WALL_ATTACH_TOLERANCE, WALL_JOIN_SEAL, WALL_THICKNESS, clamp, clean, distance, point } from "./core.js";
import { canvasOf } from "./room.js";
import { detectRooms } from "./rooms.js";


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
export function attachAlongAxis(room, end, fixed, excludeWallID) {
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
