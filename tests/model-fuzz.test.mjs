// Randomised invariant fuzz over the editing model.
//
// Reading code finds the bugs you thought to look for. This drives the store
// the way a user does — thousands of random edits, drags, deletes, undos and
// layout runs — and after every single one asserts that the model still holds
// together: no NaN anywhere, no opening pointing at a wall that is gone or
// hanging off its end, no duplicate ids, the recorded size still equal to the
// walls, and the document still stable across a save and reload.
//
// It earned its place immediately: it found three real faults in wall dragging
// that no amount of reading had turned up, all because a drag runs inside a
// transaction where sanitize() does not see it.
//
// Run:  node tests/model-fuzz.test.mjs

import { readFileSync } from "node:fs";
const planUrl = "data:text/javascript;base64," + Buffer.from(readFileSync("roomcad/web/plan.js","utf8")).toString("base64");
const P = await import(planUrl);
const storeSrc = readFileSync("roomcad/web/store.js","utf8")
  .replace('import * as P from "./plan.js";', `import * as P from "${planUrl}";`)
  .replace('import { playDoorSound } from "./audio.js";', "const playDoorSound = () => {};");
const { store } = await import("data:text/javascript;base64," + Buffer.from(storeSrc).toString("base64"));
let seed = 0;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = a => a[Math.floor(rnd() * a.length)];
const pt = () => ({ x: 8 + rnd() * 9, z: 8 + rnd() * 9 });
const violations = new Map();
const fail = (what, detail) => {
  if (!violations.has(what)) violations.set(what, { count: 0, first: detail });
  violations.get(what).count++;
};
const checkInvariants = (op) => {
  const r = store.room;
  const walk = (o, path) => {
    if (typeof o === "number") { if (!Number.isFinite(o)) fail("non-finite number", `${op}: ${path}`); return; }
    if (o && typeof o === "object") for (const k of Object.keys(o)) walk(o[k], `${path}.${k}`);
  };
  walk(r, "room");
  const ids = new Set(r.walls.map(w => w.id));
  for (const d of r.doors) if (!ids.has(d.wallID)) fail("orphan door", `${op}: ${d.id}`);
  for (const w of r.windows) if (!ids.has(w.wallID)) fail("orphan window", `${op}: ${w.id}`);
  for (const o of [...r.doors, ...r.windows]) {
    const w = r.walls.find(x => x.id === o.wallID);
    if (w && o.offset + o.width > P.wallLength(w) + 1e-6) fail("opening past the end of its wall", op);
    if (o.offset < -1e-9) fail("negative opening offset", op);
  }
  for (const [label, list] of [["walls",r.walls],["doors",r.doors],["windows",r.windows],["furniture",r.furniture],["publicAreas",r.publicAreas||[]],["labels",r.labels||[]]]) {
    if (new Set(list.map(x => x.id)).size !== list.length) fail(`duplicate ${label} ids`, op);
  }
  const before = P.serializeRoom(r);
  if (P.serializeRoom(P.parseRoom(before)) !== before) fail("save/load is not stable", op);
  const b = P.wallsBounds(r);
  if (b && (Math.abs((b.maxX-b.minX) - r.width) > 1e-6 || Math.abs((b.maxZ-b.minZ) - r.length) > 1e-6))
    fail("size disagrees with the walls", `${op}: ${r.width}x${r.length}`);
  for (const w of r.walls) if (P.wallLength(w) < P.MIN_WALL_LENGTH - 1e-6) fail("wall shorter than the minimum", op);
};
const ops = [
  () => { const a = pt(), b = { x: a.x + (rnd()<.5?2:0), z: a.z + (rnd()<.5?0:2) }; store.addWall(a, b); return "addWall"; },
  () => { store.placeOpening("door", pt()); return "placeDoor"; },
  () => { store.placeOpening("window", pt()); return "placeWindow"; },
  () => { store.placeFurniture(pick(["bed","table","chair","desk","sofa"]), pt()); return "placeFurniture"; },
  () => { const a = pt(); store.markPublicArea({x1:a.x,z1:a.z,x2:a.x+2,z2:a.z+1.5}); return "markPublic"; },
  () => { store.placeLabel(pt()); return "placeLabel"; },
  () => { store.erase(pt()); return "erase"; },
  () => { store.select(pt()); store.deleteSelection(); return "deleteSelection"; },
  () => { const w = pick(store.room.walls); if (w) { store.setWallDragUnlocked(w.id, true); store.moveWall(w.id, (rnd()-.5), (rnd()-.5)); } return "moveWall"; },
  () => { store.undo(); return "undo"; },
  () => { store.redo(); return "redo"; },
  () => { store.generateLayout({count: 1 + Math.floor(rnd()*4), area: 4 + rnd()*14, windows: rnd()<.5}); return "generate"; },
  () => { store.setGrid(pick(["oneCentimeter","twoCentimeters","fiveCentimeters"])); return "setGrid"; },
];
// Fixed seeds so a failure is reproducible and CI does not flap.
const SEEDS = [12345, 777, 2024, 31337, 8675309];
const PER_SEED = 800;
let ops_run = 0;
for (const s of SEEDS) {
  seed = s;
  store.newRoom();
  for (let i = 0; i < PER_SEED; i++) {
    let op = "?";
    try { op = pick(ops)(); } catch (e) { fail("operation threw", `${op}: ${e.message}`); }
    try { checkInvariants(op); } catch (e) { fail("invariant check threw", `${op}: ${e.message}`); }
    ops_run++;
  }
}

let passed = 0;
let failed = 0;
const INVARIANTS = [
  "non-finite number",
  "orphan door",
  "orphan window",
  "opening past the end of its wall",
  "negative opening offset",
  "duplicate walls ids",
  "duplicate doors ids",
  "duplicate windows ids",
  "duplicate furniture ids",
  "duplicate publicAreas ids",
  "duplicate labels ids",
  "save/load is not stable",
  "size disagrees with the walls",
  "wall shorter than the minimum",
  "operation threw",
  "invariant check threw",
];
for (const name of INVARIANTS) {
  const v = violations.get(name);
  if (v) {
    failed++;
    console.error(`FAIL: ${name} — ${v.count} times, e.g. ${v.first}`);
  } else {
    passed++;
  }
}
console.log(`${passed} passed, ${failed} failed — model invariants over ${ops_run} random operations`);
if (failed) process.exit(1);
