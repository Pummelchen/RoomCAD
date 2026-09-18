// The auto-layout entry point: how many rooms, how big, and the search over arrangements.
//
// Part of the plan model; the public entry point is ../plan.js, which re-exports
// every module here.

import { WALL_THICKNESS, clamp, clean, point, uid } from "./core.js";
import { layoutGrid, wallBarriers } from "./layout-grid.js";
import { absorbStrandedFloor, joinSeparatePieces, ownedRects, partitionFloor, roomBoundaries } from "./layout-partition.js";
import { roomOrigin } from "./room.js";
import { detectRooms } from "./rooms.js";
import { wallLength, wallProjection } from "./walls.js";


// MARK: - Auto room layout

/// The shortest side a generated room may have.
export const MIN_ROOM_DIM = 1.60;

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
export function apportion(total, weights) {
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

  // ── Something for every room to open onto ───────────────────────────────
  //
  // A room reached only by walking through another room is not a room with a
  // way in. So before the floor is divided up, the circulation is settled: the
  // floor the user marked green is it, and nothing is added to it. The
  // partition below then refuses any cut that would leave a piece with no
  // frontage onto it.
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
  // No hallway is cut when a piece's own frontage cannot serve the rooms asked
  // of it. Touching a walkway at one corner is not enough for more than one
  // room: each room needs a room's width of frontage to put its own door in,
  // and the partition refuses a cut it cannot give that frontage to rather than
  // cutting a path through the piece to reach it.
  //
  // "The green public space is where people walk and doors swing into. So the
  // auto layout planner does not create public space — it is the area it needs
  // to build the rooms around." Cutting one anyway is making walking space by
  // another name: unmarked, but walked on, and taking floor from the rooms to
  // do it. Where the user has marked the walking space the rooms are laid
  // against it; where they have not, the rooms fill the plate and open to the
  // outside, and the app says what to draw to do better.

  // Is there any circulation at all? Null when there is none, and then the
  // partition has no frontage to respect — the rooms simply fill the plate.
  let anyCirculation = false;
  for (let c = 0; c < cellCount; c++) if (circulation[c]) { anyCirculation = true; break; }

  // What the rooms are laid against: the floor the user marked. `fronting()` in
  // layout-slice.js recomputes which cells touch it, so the partition is handed
  // the circulation itself and nothing else. (A precomputed `fronts` mask used
  // to be passed here as well; nothing ever read it, and it went with the
  // hallway machinery.)
  const circ = anyCirculation ? { circulation } : null;
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
  // Deliberately built AFTER the rooms are settled, from everything that ended
  // up as open floor: the leftover shares and any piece the partition could not
  // use. Building it from the shares alone left the discarded pieces out, and
  // they are exactly the floor that must not be walled in.
  const spareRectsOf = () => {
    const tmp = new Int32Array(owner.length).fill(-1);
    let any = false;
    for (let c = 0; c < owner.length; c++) if (owner[c] === SPARE) { tmp[c] = 0; any = true; }
    return any ? ownedRects(grid, tmp, 0) : [];
  };

  // ── Leftover floor that leads nowhere becomes part of the room it sits in
  //
  // The floor not needed for rooms is open floor, and open floor is fine when
  // it can be walked to. But it does not come out in one piece: a corner left
  // over behind a room is its own little enclosure, walled in by the rooms
  // around it, with no door and no way in — floor you can see on the plan and
  // never stand on. Every such pocket is given to the room beside it, which is
  // what it looks like anyway.
  absorbStrandedFloor(grid, owner, SPARE, circulation);

  // ── Anything that cannot be a room becomes open floor ──────────────────
  //
  // The partition refuses to make a room without frontage, but it can only
  // refuse a CUT: a room can still end up walled in by the pieces around it,
  // and then the door step has nowhere to put its door except a neighbour's
  // wall — which is the "walk through someone else's room" this is supposed to
  // rule out — or the outside wall, which is a bedroom door onto the street.
  //
  // The old engine answered that by running a hallway to the room: the shortest
  // way from the circulation to it, widened to a corridor, taken out of
  // whatever it crossed, which cost the rooms it passed through some floor. The
  // planner does not create public space, so there is no hallway to run: the
  // floor that would have been the corridor stays with the rooms, and a piece
  // that has no door frontage is handed back as open floor rather than built
  // into a room nobody can enter.

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
        if (d) { doors.push(d); return true; }
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
        if (win) { winList.push(win); break; }
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
  // enough to be able to walk around: a room and the pocket of open floor it
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
    // Only floor that was genuinely left over once every room had its area.
    // Despite the name this is leftover open floor, never a path cut to reach
    // somewhere: nothing is carved here. The old engine carved a corridor for
    // every band it filled, which on a plan that already had walkways drawn
    // doubled the walking space and took the difference out of the rooms.
    corridors: spareRectsOf(),
    areaPerRoom: clean(totalArea / rooms.length),
    // What each room would be if the floor divided evenly — the fallback the
    // report uses when no size was asked for.
    targetArea: clean(freeArea / roomCount),
    requested: { count, area: Number(opts.area) > 0 ? Number(opts.area) : null },
  };
}
