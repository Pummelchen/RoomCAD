// Room detection by grid decomposition, and the memory cap that reports rather than guesses.
//
// Part of the plan model; the public entry point is ../plan.js, which re-exports
// every module here.

import { clean } from "./core.js";
import { wallLength } from "./walls.js";


// MARK: - Enclosed rooms

/// How many grid cells the room decomposition may allocate.
///
/// A memory guard, not a policy: the owner map is one Int32 per cell and the
/// cells of every region are held in flat Int32Arrays, so this bounds the
/// detector's own allocation at about 8 MB — 4 MB of owner map and 4 MB of
/// region cells — rather than the ~140 MB it reached when each cell was a
/// two-element array. It used to be 60 000 — roughly 240 kB — which a plan of a
/// couple of hundred walls at 1 cm resolution could exceed. When it did, the
/// detector returned NO rooms, and everything that reads rooms went quietly
/// wrong: every m² caption vanished, floorArea fell back to the bounding box,
/// and because no region was recognisable as the outside, no wall was an
/// outside wall and every wall became draggable. Nothing said a word. The cap
/// is now generous enough not to be reached by real plans, and
/// `roomDetectionSkipped()` reports it if it ever is.
const MAX_ROOM_CELLS = 1000000;
let _roomCache = { key: null, rooms: null, outsideWalls: null };
/// True when the last detectRooms() gave up on the cell cap rather than
/// returning a real answer. Callers that show a measurement read this so a
/// degraded plan says so instead of displaying a guess as a fact.
let _detectionSkipped = false;

/// Whether the last room decomposition was skipped. See MAX_ROOM_CELLS.
export function roomDetectionSkipped() {
  return _detectionSkipped;
}

function roomSignature(room) {
  // The cached `outsideWalls` is a set of wall IDS, so the key has to name
  // those ids or a cache hit can hand one room's ids to another. It did: two
  // door-less rooms with identical geometry — exactly two freshRoom()s — share
  // every coordinate, so the second room was given the FIRST room's outside
  // walls, none of its own walls were recognised, and every one of them was
  // draggable. ids come first because they are the identity; the coordinates
  // and door wallIDs stay, so a move still invalidates the cache.
  //
  // Exported and callable on a half-built room (an import mid-parse, a caller
  // outside the app), so no list is assumed to exist.
  const ids = (room.walls || []).map(x => (x && x.id) || "").join(",");
  const w = (room.walls || []).map(x =>
    `${x.start.x},${x.start.z},${x.end.x},${x.end.z}`).join(";");
  const d = (room.doors || []).map(x => `${x.wallID}`).join(";");
  return ids + "|" + w + "|" + d;
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
  _detectionSkipped = false;

  const walls = (room.walls || []).filter(w => wallLength(w) >= 0.01);
  const result = [];
  if (walls.length < 3) {
    // Not a skip: three walls cannot enclose anything, and that is a real
    // answer rather than a refusal to work it out.
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
    // Too detailed to decompose within the memory budget. Report it rather than
    // returning an empty answer that looks like "this plan has no rooms".
    _detectionSkipped = nx >= 1 && nz >= 1;
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

  // Two passes: `fill` floods the region, assigning `owner` from `id` and
  // counting the cells; the second pass floods it again writing the cell
  // indices into an Int32Array sized exactly to the region. Nothing is built
  // per cell on the way through — a queue of indices is the only working set —
  // so the allocation for a grid of N cells is the 4-byte owner map, the
  // 4-byte per-region cell list and a small stack, rather than an object per
  // cell. The stack is a LIFO ring reused between regions: every push is
  // immediately followed by a pop, so a reused slot is always free.
  const visits = new Uint8Array(nx * nz);
  const stack = new Int32Array(nx * nz);
  const fill = (i0, j0, id, wallIDs, put) => {
    stack[0] = at(i0, j0);
    visits[at(i0, j0)] = 1;
    let top = 0;
    let count = 0;
    while (top >= 0) {
      const c = stack[top--];
      owner[c] = id;
      if (put) put(c, count);
      count++;
      const i = (c / nz) | 0;
      const j = c - i * nz;
      const midZ = (zs[j] + zs[j + 1]) / 2;
      const midX = (xs[i] + xs[i + 1]) / 2;
      const step = (ni, nj, blockedBy) => {
        if (blockedBy) { wallIDs.add(blockedBy); return; }
        if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) return;
        const n = at(ni, nj);
        if (visits[n]) return;
        visits[n] = 1;
        stack[++top] = n;
      };
      step(i - 1, j, blocker(vertical, xs[i], midZ));
      step(i + 1, j, blocker(vertical, xs[i + 1], midZ));
      step(i, j - 1, blocker(horizontal, zs[j], midX));
      step(i, j + 1, blocker(horizontal, zs[j + 1], midX));
    }
    return count;
  };
  for (let i0 = 0; i0 < nx; i0++) {
    for (let j0 = 0; j0 < nz; j0++) {
      if (owner[at(i0, j0)] !== -1) continue;
      const id = regionCount++;
      // The wall contacts are collected by the first pass; the second pass
      // reuses the same Set, which dedupes, so seeing them twice costs nothing.
      const wallIDs = new Set();
      const size = fill(i0, j0, id, wallIDs, null);
      visits.fill(0);
      const cells = new Int32Array(size);
      fill(i0, j0, id, wallIDs, (c, k) => { cells[k] = c; });
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
    for (let n = 0; n < region.cells.length; n++) {
      const c = region.cells[n];
      const i = (c / nz) | 0;
      const j = c - i * nz;
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
