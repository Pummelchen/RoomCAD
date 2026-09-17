// How short a wall may be — and the two different answers to that.
//
// Two thresholds exist and they are not the same rule:
//
//   MIN_WALL_LENGTH       the shortest wall the EDITOR will make. Drawing one
//                         this short is refused, with the message the user sees.
//   MIN_WALL_LENGTH_KEPT  the shortest wall a FILE may keep. It repairs stubs,
//                         so an older document with a 20 cm wall still opens.
//
// The bug was that the endpoint drag used the FILE threshold as if it were the
// editor's: a wall could be dragged down to 15 cm while drawing refused
// anything under 30 cm, so 20 cm was legal to hold and impossible to make.
//
// Run:  node tests/wall-lengths.test.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..", "roomcad", "web");
const asDataUrl = src => "data:text/javascript;base64," + Buffer.from(src).toString("base64");

// The real store, with its imports resolved inline: plan.js as a nested data
// URL and the Web Audio helper stubbed, exactly as furniture-freedom does.
// plan.js re-exports roomcad/web/plan/*.js, so it is loaded by URL: a data:
// URL cannot resolve the relative imports inside the facade.
const planUrl = pathToFileURL(join(web, "plan.js")).href;
const storeSrc = readFileSync(join(web, "store.js"), "utf8")
  .replace('import * as P from "./plan.js";', `import * as P from "${planUrl}";`)
  .replace('import { playDoorSound } from "./audio.js";', "const playDoorSound = () => {};");
const { store } = await import(asDataUrl(storeSrc));
const P = await import(planUrl);

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; return; }
  failed++;
  console.error("FAIL: " + name + (detail ? " — " + detail : ""));
}

// A room holding one wall and nothing else, so nothing else can snap to it.
function roomWithWall(length) {
  const room = P.freshRoom("lengths", 10, 10, 2.6);
  room.walls = [{ id: "w1", start: { x: 0, z: 0 }, end: { x: length, z: 0 } }];
  return room;
}
const len = r => P.wallLength(r.walls[0]);

// ── The two thresholds are distinct, and named ────────────────────────────
check("the editor's minimum is 0.30 m", P.MIN_WALL_LENGTH === 0.30);
check("the file's stub threshold is lower than the editor's",
  P.MIN_WALL_LENGTH_KEPT < P.MIN_WALL_LENGTH,
  `${P.MIN_WALL_LENGTH_KEPT} vs ${P.MIN_WALL_LENGTH}`);

// ── Loading: a stub is dropped, a short wall is kept ──────────────────────
{
  const stub = roomWithWall(0.10);
  P.sanitize(stub);
  check("a wall under the stub threshold is dropped on load", stub.walls.length === 0);

  const short = roomWithWall(0.20);
  P.sanitize(short);
  check("a wall between the two thresholds is KEPT on load",
    short.walls.length === 1 && Math.abs(len(short) - 0.20) < 1e-9,
    `${short.walls.length} walls`);

  // The saved document must survive its own repair, or saving and reopening
  // would quietly lose a wall every time.
  const again = JSON.parse(JSON.stringify(short));
  P.sanitize(again);
  check("and repairing it twice drops nothing more", again.walls.length === 1);
}

// ── Drawing: below the editor's minimum is refused, with a message ────────
{
  store.room = roomWithWall(0);
  store.room.walls = [];
  const added = store.addWall({ x: 0, z: 0 }, { x: 0.25, z: 0 });
  check("drawing a 25 cm wall is refused", added === false && store.room.walls.length === 0);
  check("and the user is told why", /30 cm/.test(store.status), store.status);

  store.room = roomWithWall(0);
  store.room.walls = [];
  const ok = store.addWall({ x: 0, z: 0 }, { x: 0.50, z: 0 });
  check("drawing a 50 cm wall is allowed", ok === true && store.room.walls.length === 1);
}

// ── Resizing: the drag uses the SAME floor as drawing ────────────────────
{
  // The bug itself. 0.60 -> 0.20 is under the editor's minimum, and the drag
  // used to wave it through at 0.15.
  store.room = roomWithWall(0.60);
  store.updateWallEndpoint("w1", "end", { x: 0.20, z: 0 });
  check("dragging a wall down to 20 cm is refused",
    Math.abs(len(store.room) - 0.60) < 1e-9, `ended at ${len(store.room).toFixed(2)} m`);

  // Just under the minimum is still under it.
  store.room = roomWithWall(0.60);
  store.updateWallEndpoint("w1", "end", { x: 0.25, z: 0 });
  check("and so is 25 cm", Math.abs(len(store.room) - 0.60) < 1e-9,
    `ended at ${len(store.room).toFixed(2)} m`);

  // A legitimate resize still works.
  store.room = roomWithWall(0.60);
  store.updateWallEndpoint("w1", "end", { x: 0.45, z: 0 });
  check("dragging a wall to 45 cm is allowed",
    Math.abs(len(store.room) - 0.45) < 1e-9, `ended at ${len(store.room).toFixed(2)} m`);

  // Lengthening past the minimum from below it also works.
  store.room = roomWithWall(0.20);
  store.updateWallEndpoint("w1", "end", { x: 0.80, z: 0 });
  check("a short wall can be dragged longer",
    Math.abs(len(store.room) - 0.80) < 1e-9, `ended at ${len(store.room).toFixed(2)} m`);
}

// ── A legacy short wall must not be stuck ────────────────────────────────
{
  // Someone opens an older document holding a 20 cm wall. It is below the
  // editor's minimum but it is not the drag's job to punish that: the wall must
  // still turn and grow. It may not be made shorter still.
  store.room = roomWithWall(0.20);
  store.updateWallEndpoint("w1", "end", { x: 0.25, z: 0 });
  check("a legacy short wall can be nudged longer while still short",
    Math.abs(len(store.room) - 0.25) < 1e-9, `ended at ${len(store.room).toFixed(2)} m`);

  // Turning it keeps its length, which is the case that made a strict minimum
  // leave the wall looking frozen.
  store.room = roomWithWall(0.20);
  store.updateWallEndpoint("w1", "end", { x: 0, z: 0.20 });
  check("and it can be turned onto the other axis",
    Math.abs(len(store.room) - 0.20) < 1e-9 && Math.abs(store.room.walls[0].end.z - 0.20) < 1e-9,
    `ended at ${len(store.room).toFixed(2)} m`);

  store.room = roomWithWall(0.20);
  store.updateWallEndpoint("w1", "end", { x: 0.10, z: 0 });
  check("but it cannot be made shorter still",
    Math.abs(len(store.room) - 0.20) < 1e-9, `ended at ${len(store.room).toFixed(2)} m`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
