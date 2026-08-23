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
    if (rnd() < 0.4) {
      room.walls.push({ id: "iw" + trial, start: P.point(snap(W * 0.4), 0), end: P.point(snap(W * 0.4), snap(L * 0.5)) });
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
  }
}

check("the engine lays out the plans it is given", laidOut > 500, `${laidOut} laid out, ${empty} empty`);
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
