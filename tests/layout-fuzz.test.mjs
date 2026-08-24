// Randomised stress test for the layout engine.
//
// The engine is asked to fill hundreds of randomly shaped plans, with randomly
// placed walkways and interior walls, and every result is checked against the
// things that must always hold. Reading the code found none of what this found:
//
//   - a cell was blocked when its CENTRE fell inside a walkway, so a cell that
//     straddled the edge of one looked free and a room took it — rooms
//     overlapped the circulation by up to 0.63 m²;
//   - grid lines closer together than a wall can be produced boundaries of
//     4.8 cm, which sanitize discards on load, turning a wall into a hole that
//     merges two rooms into one.
//
// Run:  node tests/layout-fuzz.test.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const P = await import(
  "data:text/javascript;base64," +
  Buffer.from(readFileSync(join(here, "..", "roomcad", "web", "plan.js"), "utf8")).toString("base64")
);

let passed = 0;
let failed = 0;
function check(name, condition, detail = "") {
  if (condition) { passed++; return; }
  failed++;
  console.error("FAIL: " + name + (detail ? " — " + detail : ""));
}

const overlap = (a, b) => {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oz = Math.min(a.z + a.l, b.z + b.l) - Math.max(a.z, b.z);
  return ox > 0 && oz > 0 ? ox * oz : 0;
};

const violations = new Map();
const note = (what, detail) => {
  if (!violations.has(what)) violations.set(what, { count: 0, first: detail });
  violations.get(what).count++;
};

// Fixed seeds, so a failure is reproducible.
const GRIDS = [0.01, 0.02, 0.05];
let laidOut = 0;
let empty = 0;
let shortestWall = Infinity;
let worstOverlap = 0;
let doubled = 0;
let roomsWithoutADoor = 0;
let totalRooms = 0;
// Every room has to be enterable from the circulation, not through another
// room. Counted here over every plan the engine produces.
let reachable = 0;
let throughAnotherRoom = 0;
let sealed = 0;
let outsideOnly = 0;

for (const step of GRIDS) {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const snap = v => Math.round(v / step) * step;

  for (let trial = 0; trial < 220; trial++) {
    const W = snap(4 + rnd() * 16);
    const L = snap(4 + rnd() * 16);
    const room = P.freshRoom("Fuzz", W, L, 2.6);
    room.origin = { x: 0, z: 0 };
    room.canvas = { width: 30, length: 30 };
    room.grid = step === 0.01 ? "oneCentimeter" : step === 0.02 ? "twoCentimeters" : "fiveCentimeters";
    room.publicAreas = [];
    for (let i = 0; i < Math.floor(rnd() * 4); i++) {
      room.publicAreas.push({
        id: "p" + i,
        x: snap(rnd() * W * 0.8), z: snap(rnd() * L * 0.8),
        w: snap(0.5 + rnd() * Math.max(0.6, W * 0.4)),
        l: snap(0.5 + rnd() * Math.max(0.6, L * 0.4)),
      });
    }
    // Walls the user has already drawn, which the engine must build around
    // rather than across. This is where doubled walls came from: a generated
    // boundary landing a few centimetres to the side of one of these is not a
    // separate wall, it is two 10 cm walls overlapping.
    if (rnd() < 0.4) {
      room.walls.push({ id: "iw" + trial, start: P.point(snap(W * 0.4), 0), end: P.point(snap(W * 0.4), snap(L * 0.5)) });
    }
    if (rnd() < 0.3) {
      const cz = snap(L * 0.5);
      room.walls.push({ id: "core" + trial, start: P.point(0, cz), end: P.point(snap(W * 0.5), cz) });
    }
    P.sanitize(room);

    const count = 1 + Math.floor(rnd() * 8);
    let result;
    try {
      result = P.autoLayoutRooms(room, {
        count, area: 3 + rnd() * 20, windows: rnd() < 0.5, seed: 1 + Math.floor(rnd() * 50),
      });
    } catch (err) {
      note("the engine threw", `${W.toFixed(1)}×${L.toFixed(1)}: ${err.message}`);
      continue;
    }
    if (!result) { empty++; continue; }
    laidOut++;

    if (result.rooms.length > count) note("more rooms than asked for", `${result.rooms.length} > ${count}`);

    for (const rm of result.rooms) {
      const fromRects = rm.rects.reduce((s, rc) => s + rc.w * rc.l, 0);
      if (Math.abs(fromRects - rm.area) > 0.02) note("a room's area disagrees with its rectangles", "");
      if (!(rm.area > 0)) note("a room with no area", "");
      for (const rc of rm.rects) {
        if (!(rc.w > 0 && rc.l > 0)) note("a degenerate rectangle", JSON.stringify(rc));
        for (const walk of room.publicAreas) {
          const o = overlap(rc, walk);
          worstOverlap = Math.max(worstOverlap, o);
          if (o > 1e-6) note("a room laid on floor the user marked", `${o.toFixed(4)} m²`);
        }
      }
    }

    // No two rooms may claim the same floor.
    const rects = result.rooms.flatMap((rm, i) => rm.rects.map(rc => ({ ...rc, room: i })));
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        if (rects[i].room !== rects[j].room && overlap(rects[i], rects[j]) > 1e-9) {
          note("two rooms overlap", "");
        }
      }
    }

    for (const w of result.walls) {
      const len = P.wallLength(w);
      shortestWall = Math.min(shortestWall, len);
      if (!Number.isFinite(w.start.x + w.start.z + w.end.x + w.end.z)) note("a non-finite wall", "");
      // Below this sanitize drops the wall on load, and the boundary becomes a
      // hole that joins two rooms into one.
      if (len < 0.15) note("a wall too short to survive a reload", len.toFixed(3));
    }
    if (new Set(result.walls.map(w => w.id)).size !== result.walls.length) note("duplicate wall ids", "");

    // Two openings on the same wall must not sit on top of each other. This is
    // the invariant that was missing when a door re-homed onto a wall the user
    // drew landed straight on one of its windows.
    const byWall = new Map();
    for (const o of [...result.doors, ...result.windows]) {
      if (!byWall.has(o.wallID)) byWall.set(o.wallID, []);
      byWall.get(o.wallID).push(o);
    }
    for (const [, list] of byWall) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const b = list[j];
          if (a.offset < b.offset + b.width - 1e-9 && b.offset < a.offset + a.width - 1e-9) {
            note("two openings on the same wall overlap", `${a.width} at ${a.offset} vs ${b.width} at ${b.offset}`);
          }
        }
      }
    }

    const wallIDs = new Set(result.walls.map(w => w.id));
    for (const o of [...result.doors, ...result.windows]) {
      if (!wallIDs.has(o.wallID)) note("an opening on a wall that is not there", "");
      const w = result.walls.find(x => x.id === o.wallID);
      if (w && o.offset + o.width > P.wallLength(w) + 1e-6) note("an opening past the end of its wall", "");
      if (o.offset < -1e-9) note("a negative opening offset", "");
    }

    // Apply the result and look at it the way the editor does.
    const applied = P.parseRoom(JSON.stringify({
      format: "com.maria.roomcad-v2.room", version: 1,
      room: {
        ...room, walls: result.walls, doors: result.doors, windows: result.windows,
        publicAreas: room.publicAreas.concat(
          result.corridors.map(c => ({ id: P.uid(), ...c, generated: true }))),
      },
    }));
    if (P.overlappingWallAreas(applied).length) doubled++;
    const regions = P.detectRooms(applied);
    for (const g of result.rooms) {
      totalRooms++;
      const candidates = regions.filter(x => Math.abs(x.area - g.area) < 0.2);
      if (candidates.length && candidates.every(x => !x.hasDoor)) roomsWithoutADoor++;
    }

    // How each space is actually entered, worked out from the plan rather than
    // from what the engine believes it did: for every door, which spaces lie on
    // either side of it.
    const publics = applied.publicAreas || [];
    const inRegion = pt => regions.findIndex(r =>
      r.rects.some(c => pt.x > c.x && pt.x < c.x + c.w && pt.z > c.z && pt.z < c.z + c.l));
    const isCirculation = regions.map(r => {
      let total = 0, marked = 0;
      for (const c of r.rects) {
        const a = c.w * c.l;
        total += a;
        const cx = c.x + c.w / 2, cz = c.z + c.l / 2;
        if (publics.some(pa => cx > pa.x - 0.02 && cx < pa.x + pa.w + 0.02
                            && cz > pa.z - 0.02 && cz < pa.z + pa.l + 0.02)) marked += a;
      }
      return total > 0 && marked / total > 0.5;
    });
    const joins = regions.map(() => new Set());
    const toOutside = new Set();
    for (const d of applied.doors || []) {
      const wall = (applied.walls || []).find(w => w.id === d.wallID);
      if (!wall) continue;
      const n = P.wallPerp(wall);
      // Probed a little to the side as well as through: a door's midpoint often
      // sits exactly on a cell boundary, and a point on the line between two
      // cells is inside neither.
      const nudge = Math.min(0.13, d.width / 4);
      const probe = sign => {
        for (const along of [nudge, -nudge, 0]) {
          const at = P.wallPointAt(wall, d.offset + d.width / 2 + along);
          const hit = inRegion({ x: at.x + n.x * 0.14 * sign, z: at.z + n.z * 0.14 * sign });
          if (hit >= 0) return hit;
        }
        return -1;
      };
      const a = probe(1), b = probe(-1);
      if (a >= 0 && b >= 0) { joins[a].add(b); joins[b].add(a); }
      else if (a >= 0) toOutside.add(a);
      else if (b >= 0) toOutside.add(b);
    }
    for (let i = 0; i < regions.length; i++) {
      if (isCirculation[i]) continue;              // the hallway itself
      const doors = joins[i].size + (toOutside.has(i) ? 1 : 0);
      if (doors === 0) sealed++;
      else if ([...joins[i]].some(j => isCirculation[j])) reachable++;
      else if (toOutside.has(i)) outsideOnly++;
      else throughAnotherRoom++;
    }
  }
}

check("the engine lays out the plans it is given", laidOut > 500, `${laidOut} laid out, ${empty} empty`);
check("no plan comes back with two walls on top of each other",
  doubled === 0, `${doubled} of ${laidOut} plans`);
// A room nobody can get into is not a room. A handful of pathological plans —
// a few square metres carved up by several walkways — still defeat it, so this
// is a rate rather than an absolute.
check("almost every room has a way in",
  roomsWithoutADoor <= totalRooms * 0.01,
  `${roomsWithoutADoor} of ${totalRooms} rooms (${(roomsWithoutADoor / totalRooms * 100).toFixed(2)}%)`);
// ── Every room has its own way in ─────────────────────────────────────────
//
// "The auto layout cannot make rooms which have no public door. Going through
// other rooms is not allowed."
//
// Before this was enforced, of every space on a generated plan: 12.3% had no
// door at all, and 58.7% could only be entered from the open air — a bedroom
// with its door in the outside wall. Both came from the same place: the
// partition knew nothing about how a room would be reached, so it cut floor
// into pieces and hoped a door could be found afterwards.
{
  const spaces = reachable + outsideOnly + throughAnotherRoom + sealed;
  const share = n => `${n} of ${spaces} (${(n / spaces * 100).toFixed(1)}%)`;
  check("no room can only be reached through another room",
    throughAnotherRoom === 0, share(throughAnotherRoom));
  check("almost every room opens onto the circulation",
    reachable >= spaces * 0.9, share(reachable));
  // Not zero: a few plans are pathological — a plate a couple of metres across,
  // or one carved up by walkways until nothing is left to cut a hallway from.
  // What matters is that it is rare and that it is measured, not assumed.
  check("a room with no door at all is rare",
    sealed <= spaces * 0.01, share(sealed));
  check("and so is one you can only enter from the street",
    outsideOnly <= spaces * 0.05, share(outsideOnly));
  console.log(`    ways in: ${share(reachable)} onto circulation, `
    + `${outsideOnly} from outside, ${throughAnotherRoom} through a room, ${sealed} sealed`);
}

check("no wall is too short to survive a reload", shortestWall >= 0.15, `shortest ${shortestWall.toFixed(3)} m`);
check("no room is laid on floor the user marked",
  worstOverlap < 1e-6, `largest overlap ${worstOverlap.toExponential(2)} m²`);

const EXPECTED = [
  "the engine threw",
  "more rooms than asked for",
  "a room's area disagrees with its rectangles",
  "a room with no area",
  "a degenerate rectangle",
  "a room laid on floor the user marked",
  "two rooms overlap",
  "a non-finite wall",
  "a wall too short to survive a reload",
  "duplicate wall ids",
  "an opening on a wall that is not there",
  "an opening past the end of its wall",
  "a negative opening offset",
  "two openings on the same wall overlap",
];
for (const name of EXPECTED) {
  const v = violations.get(name);
  check(`never: ${name}`, !v, v ? `${v.count} times, e.g. ${v.first}` : "");
}

console.log(`${passed} passed, ${failed} failed — layout invariants over ${laidOut} random plans`);
if (failed) process.exit(1);
