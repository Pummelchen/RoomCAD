// Moving furniture must never be blocked.
//
// The editor used to refuse to apply a position that overlapped a wall or
// another item, so a piece stuck against whatever it touched and could not be
// carried across a room. Placing and nudging refused outright. The rule now
// matches the one turning a piece already used: the move always happens, and
// the piece simply reads red until it is somewhere it fits.
//
// Run:  node tests/furniture-freedom.test.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..", "roomcad", "web");
const asDataUrl = src => "data:text/javascript;base64," + Buffer.from(src).toString("base64");

// store.js is loaded for real, with its two imports resolved inline: plan.js as
// a nested data URL, and the Web Audio helper stubbed out.
const planUrl = asDataUrl(readFileSync(join(web, "plan.js"), "utf8"));
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
  console.error(`FAIL: ${name}${detail ? " — " + detail : ""}`);
}

/// A two-room plan with a dividing wall, and a bed in the left room.
function scenario() {
  const room = P.freshRoom("T", 8, 6, 2.6);
  room.origin = { x: 0, z: 0 };
  room.canvas = { width: 20, length: 20 };
  room.walls.push({ id: "divider", start: P.point(4, 0), end: P.point(4, 6) });
  room.furniture = [
    { id: "bed", kind: "bed", center: { x: 1.5, z: 3 }, rotationDegrees: 0 },
    { id: "table", kind: "table", center: { x: 6, z: 1.5 }, rotationDegrees: 0 },
  ];
  P.sanitize(room);
  store.room = room;
  store.clearSelection();
  store.undoStack = [];
  store.redoStack = [];
  store.dragTransactionActive = false;
  return room;
}
const bedOf = () => store.room.furniture.find(f => f.id === "bed");
const isValid = item => P.isFurniturePlacementValid(store.room, item, new Set([item.id]));

// ── A drag is never blocked ───────────────────────────────────────────────
{
  const room = scenario();
  const before = { ...bedOf().center };

  // Straight onto the dividing wall.
  store.moveFurniture("bed", { x: 4, z: 3 });
  const onWall = bedOf();
  check("a drag onto a wall actually moves the item",
    Math.abs(onWall.center.x - before.x) > 0.5, JSON.stringify(onWall.center));
  check("the item is reported invalid while it is there", !isValid(onWall));
  check("the drag feedback says so",
    store.furnitureFeedback && store.furnitureFeedback.state === "invalid");

  // Carry it right through the wall into the far room.
  store.moveFurniture("bed", { x: 6, z: 4 });
  const through = bedOf();
  check("the item can be carried through a wall to the other side",
    through.center.x > 4.5, JSON.stringify(through.center));

  // And onto another piece of furniture.
  store.moveFurniture("bed", { x: 6, z: 1.5 });
  check("a drag onto other furniture also moves the item",
    Math.abs(bedOf().center.z - 1.5) < 0.6, JSON.stringify(bedOf().center));
  check("overlapping furniture reads invalid", !isValid(bedOf()));

  // Ending the drag leaves it where it was dropped.
  store.endDrag("Moved furniture");
  check("ending the drag keeps the position it was dropped at",
    Math.abs(bedOf().center.z - 1.5) < 0.6, JSON.stringify(bedOf().center));
  check("and the item is still in an invalid position afterwards", !isValid(bedOf()));

  // Moving somewhere clear resolves it, with nothing to reset by hand.
  store.moveFurniture("bed", { x: 1.5, z: 3 });
  store.endDrag("Moved furniture");
  check("moving back to open floor makes it valid again", isValid(bedOf()),
    JSON.stringify(bedOf().center));
}

// ── Placing is never blocked ──────────────────────────────────────────────
{
  scenario();
  const countBefore = store.room.furniture.length;
  store.placeFurniture("chair", { x: 6, z: 1.5 });   // right on the table
  check("a piece dropped on an occupied spot is still placed",
    store.room.furniture.length === countBefore + 1,
    `${store.room.furniture.length} vs ${countBefore}`);
  const placed = store.room.furniture[store.room.furniture.length - 1];
  check("the placed piece is where it was asked for",
    Math.abs(placed.center.x - 6) < 0.6 && Math.abs(placed.center.z - 1.5) < 0.6,
    JSON.stringify(placed.center));
  check("and it is reported as overlapping", !isValid(placed));
  check("the status says why rather than silently refusing",
    /overlaps/i.test(store.status), store.status);
}

// ── Nudging is never blocked ──────────────────────────────────────────────
{
  scenario();
  store.selectedFurnitureID = "bed";
  const startX = bedOf().center.x;
  // Walk it step by step into, and then past, the dividing wall at x = 4.
  const trail = [];
  for (let i = 0; i < 30; i++) {
    store.nudgeSelectedFurniture(0.1, 0);
    trail.push({ x: bedOf().center.x, valid: isValid(bedOf()), status: store.status });
  }
  const moved = bedOf().center.x - startX;
  check("nudging keeps moving the item instead of stopping at a wall",
    moved > 1.5, `moved ${moved.toFixed(2)} m`);
  // The point is that it went THROUGH: some steps were invalid and it kept going.
  check("it passes through positions that overlap the wall",
    trail.some(t => !t.valid), JSON.stringify(trail.map(t => t.valid)));
  check("the status reports the overlap while it is inside the wall",
    trail.some(t => /overlaps/i.test(t.status)));
  check("it ends up on the far side of the wall it walked into",
    bedOf().center.x > 4, JSON.stringify(bedOf().center));
  check("and is valid again once clear of it", isValid(bedOf()));
  check("the status is clean again on the far side",
    !/overlaps/i.test(store.status), store.status);

  // Nudging back the way it came works the same.
  for (let i = 0; i < 30; i++) store.nudgeSelectedFurniture(-0.1, 0);
  check("nudging back to where it started leaves it valid", isValid(bedOf()),
    JSON.stringify(bedOf().center));
}

// ── The canvas is still a hard boundary ───────────────────────────────────
// Overlapping is allowed; leaving the drawable area is not.
{
  const room = scenario();
  store.moveFurniture("bed", { x: -50, z: -50 });
  const b = bedOf();
  const f = P.furnitureFootprint(b);
  const canvas = P.canvasOf(room);
  check("a piece cannot be dragged off the canvas",
    f.minX >= -0.001 && f.minZ >= -0.001
    && f.maxX <= canvas.width + 0.001 && f.maxZ <= canvas.length + 0.001,
    JSON.stringify(f));
}

// ── The layout status line must report the ask, not the compromise ────────
//
// It used to print the internal target — the value the space forced the ask
// down to — labelled "asked", so a user who typed 14 m² and got 9 was told
// they had asked for 11.1. It also stayed silent when the space would not take
// as many rooms as were requested.
{
  const room = P.freshRoom("Status", 10, 8, 2.6);
  P.centerRoom(room);

  const big = P.autoLayoutRooms(room, { count: 3, area: 40, seed: 1 });
  check("an oversized ask still produces a layout", !!big);
  check("the result remembers what was actually asked for",
    big.requested && big.requested.count === 3 && big.requested.area === 40,
    JSON.stringify(big && big.requested));
  const bigText = store.describeLayout(big);
  check("the status quotes the area the user typed, not the clamped target",
    bigText.includes("asked 40.0"), bigText);
  check("the status never quotes the internal target as the ask",
    !bigText.includes(`asked ${big.targetArea.toFixed(1)}`)
    || big.targetArea === 40, bigText);

  // A layout that comes up short must say so.
  const short = { rooms: [{}, {}], corridors: [], areaPerRoom: 8,
    targetArea: 8, requested: { count: 5, area: 8 } };
  const shortText = store.describeLayout(short);
  check("a shortfall in room count is reported", shortText.includes("2 of 5 rooms"), shortText);

  // And one that delivers must not cry wolf.
  const exact = { rooms: [{}, {}], corridors: [], areaPerRoom: 8,
    targetArea: 8, requested: { count: 2, area: 8 } };
  const exactText = store.describeLayout(exact);
  check("a layout that matched the ask reports no shortfall",
    !exactText.includes(" of ") && !exactText.includes("asked"), exactText);

  // No area given: fall back to the target rather than printing "asked null".
  const noArea = { rooms: [{}], corridors: [], areaPerRoom: 5,
    targetArea: 9, requested: { count: 1, area: null } };
  const noAreaText = store.describeLayout(noArea);
  check("with no area asked for, the status still reads sensibly",
    !noAreaText.includes("null") && !noAreaText.includes("NaN"), noAreaText);
}

const near = (a, b, eps = 0.011) => Math.abs(a - b) <= eps;

// ── Dragging a wall carries what is mounted on it ─────────────────────────
//
// Doors and windows are positioned along their wall, so moving the wall should
// take them with it — provided the wall keeps its identity and its length.
{
  const room = P.freshRoom("Drag", 8, 6, 2.6);
  room.origin = { x: 0, z: 0 };
  room.canvas = { width: 20, length: 20 };
  const divider = { id: "divider", start: P.point(4, 0), end: P.point(4, 6) };
  room.walls.push(divider);
  room.doors = [{ id: "d1", wallID: "divider", offset: 2.0, width: 0.9, open: true, swingInside: true }];
  const outerWall = room.walls[0];
  room.windows = [{ id: "n1", wallID: outerWall.id, offset: 1.0, width: 1.2, open: true, swingInside: true }];
  store.room = P.parseRoom(P.serializeRoom(room));

  const centreOf = (list, id) => {
    const o = store.room[list].find(x => x.id === id);
    const w = store.room.walls.find(x => x.id === o.wallID);
    const t = (o.offset + o.width / 2) / P.wallLength(w);
    return { x: w.start.x + (w.end.x - w.start.x) * t, z: w.start.z + (w.end.z - w.start.z) * t };
  };

  check("the divider is not part of the skin", !store.wallIsLocked("divider"));
  check("the outer wall is locked", store.wallIsLocked(outerWall.id));

  // Locked: refused, and nothing moves.
  const beforeOuter = { ...store.room.walls.find(w => w.id === outerWall.id).start };
  check("moving a locked wall is refused", store.moveWall(outerWall.id, 0.5, 0.5) === false);
  const afterOuter = store.room.walls.find(w => w.id === outerWall.id).start;
  check("a refused move leaves the wall alone",
    afterOuter.x === beforeOuter.x && afterOuter.z === beforeOuter.z);
  // Not the exact wording — what matters is that the refusal names a way out,
  // and there are two now: free this one wall from its menu, or free them all
  // from the panel.
  check("the refusal explains how to allow it",
    /free it/i.test(store.status) && /free to drag/i.test(store.status), store.status);

  // The divider moves, and its door goes along.
  const wallBefore = { ...store.room.walls.find(w => w.id === "divider").start };
  const lenBefore = P.wallLength(store.room.walls.find(w => w.id === "divider"));
  const doorBefore = centreOf("doors", "d1");
  check("an inside wall moves", store.moveWall("divider", 0.30, 0.20) === true);
  const wallAfter = store.room.walls.find(w => w.id === "divider").start;
  const doorAfter = centreOf("doors", "d1");
  // Across itself by the full amount, and not at all along it: the divider is
  // vertical, so the 0.20 that ran along it is ignored. A wall that slid along
  // its own line would drag the corner of everything joined to it sideways and
  // leave those walls skew.
  check("the wall moved across itself by what was asked",
    near(wallAfter.x - wallBefore.x, 0.30),
    `${wallAfter.x - wallBefore.x}`);
  check("and not along itself",
    near(wallAfter.z - wallBefore.z, 0), `${wallAfter.z - wallBefore.z}`);
  check("the wall kept its length",
    near(P.wallLength(store.room.walls.find(w => w.id === "divider")), lenBefore, 1e-9));
  check("the door is still on the wall", !!store.room.doors.find(d => d.id === "d1"));
  check("the door travelled with the wall",
    near(doorAfter.x - doorBefore.x, 0.30) && near(doorAfter.z - doorBefore.z, 0),
    `${doorAfter.x - doorBefore.x}, ${doorAfter.z - doorBefore.z}`);

  // Unlock the outer wall, then it moves and keeps its window.
  store.setWallDragUnlocked(outerWall.id, true);
  check("unlocking is reflected in the model",
    store.room.walls.find(w => w.id === outerWall.id).dragUnlocked === true);
  check("an unlocked outer wall is no longer locked", !store.wallIsLocked(outerWall.id));
  const winBefore = centreOf("windows", "n1");
  check("an unlocked outer wall moves", store.moveWall(outerWall.id, 0, 0.25) === true);
  const winAfter = centreOf("windows", "n1");
  check("its window came too", near(winAfter.z - winBefore.z, 0.25), `${winAfter.z - winBefore.z}`);

  // And it can be locked again.
  store.setWallDragUnlocked(outerWall.id, false);
  check("locking again sticks",
    store.room.walls.find(w => w.id === outerWall.id).dragUnlocked === undefined);
  check("and it refuses to move once more", store.moveWall(outerWall.id, 0.4, 0) === false);

  // The flag has to survive a save/load round trip, or a reopened plan forgets.
  store.setWallDragUnlocked(outerWall.id, true);
  const reloaded = P.parseRoom(P.serializeRoom(store.room));
  check("dragUnlocked survives a save and reload",
    reloaded.walls.find(w => w.id === outerWall.id).dragUnlocked === true);
}

// ── Resizing by dragging, through the store ───────────────────────────────
{
  const room = P.freshRoom("R", 6, 4, 2.6);
  room.origin = { x: 0, z: 0 };
  room.canvas = { width: 25, length: 25 };
  store.room = P.parseRoom(P.serializeRoom(room));
  const east = store.room.walls.find(w => near(w.start.x, 6) && near(w.end.x, 6));

  check("the plan starts sealed", P.detectRooms(store.room).length === 1);
  check("size starts equal to the walls", near(store.room.width, 6) && near(store.room.length, 4));

  store.setWallDragUnlocked(east.id, true);
  check("dragging the east wall out works", store.moveWall(east.id, 1, 0) === true);
  store.commit("settle", () => {});
  check("the room is still one sealed space",
    P.detectRooms(store.room).length === 1, `${P.detectRooms(store.room).length}`);
  check("and the recorded size followed the wall",
    near(store.room.width, 7), `${store.room.width}`);
  check("floor area followed too", near(P.floorArea(store.room), 28, 0.6), `${P.floorArea(store.room)}`);

  // The size cannot be set behind the walls' back any more.
  check("there is no way to set the size directly", typeof store.updateRoomSize === "undefined");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
