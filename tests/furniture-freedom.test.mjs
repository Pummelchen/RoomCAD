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

// ── Placing follows the grid the user picked ─────────────────────────────
//
// "if I set 1cm as our grid, I want to be able to place furniture up to 1cm
// towards any way. currently I cannot do that, the gap to get 'green' is way
// to big and seem to not check the 1/2/5 cm grid option."
//
// Two separate faults were behind that. Only a piece's *centre* was put on the
// grid, and half a chair is 22.5 cm — never a whole number of steps — so its
// edge always sat half a step off, and it could not be pushed flat against a
// wall at any grid setting. And the pull that lined a piece up with its
// neighbours had a floor of 8 cm whatever the grid said, so on a 1 cm grid
// fifteen different drags all landed on the same spot.
{
  const GRIDS = { oneCentimeter: 0.01, twoCentimeters: 0.02, fiveCentimeters: 0.05 };

  /// Where the floor actually is: the four walls' inner faces, and the middle.
  const inside = room => {
    const xs = room.walls.flatMap(w => [w.start.x, w.end.x]);
    const zs = room.walls.flatMap(w => [w.start.z, w.end.z]);
    const h = P.WALL_THICKNESS / 2;
    const walls = [
      { axis: "x", face: Math.min(...xs) + h, sign: +1 },
      { axis: "x", face: Math.max(...xs) - h, sign: -1 },
      { axis: "z", face: Math.min(...zs) + h, sign: +1 },
      { axis: "z", face: Math.max(...zs) - h, sign: -1 },
    ];
    return { walls, middle: { x: (walls[0].face + walls[1].face) / 2,
                              z: (walls[2].face + walls[3].face) / 2 } };
  };

  const bench = grid => {
    const room = P.freshRoom("Grid", 6, 5, 2.6);
    room.origin = { x: 0, z: 0 };
    room.canvas = { width: 25, length: 25 };
    room.grid = grid;
    P.sanitize(room);
    room.furniture = [];
    return room;
  };

  for (const [grid, step] of Object.entries(GRIDS)) {
    const cm = Math.round(step * 100);

    // Flat against a wall, for every kind of thing there is to place. A piece
    // that cannot touch the wall leaves a strip of floor nobody can use.
    {
      const room = bench(grid);
      const { walls, middle } = inside(room);
      const stuck = [];
      // Turned a quarter round as well: a bed on its side is 2 m across, and
      // measuring it unturned puts its edge 55 cm from where it really is.
      for (const kind of Object.keys(P.FURNITURE_KINDS)) {
       for (const turn of [0, 90, 180, 270]) {
        const item = { id: "m", kind, center: P.point(middle.x, middle.z), rotationDegrees: turn };
        const k = P.FURNITURE_KINDS[kind];
        const swaps = turn === 90 || turn === 270;
        for (const wall of walls) {
          const reach = (wall.axis === "x" ? (swaps ? k.d : k.w) : (swaps ? k.w : k.d)) / 2;
          const rest = wall.face + wall.sign * reach;
          let flush = false;
          // Push at the wall from a few millimetres out, as a drag arrives.
          for (let mm = 0; mm <= 20 && !flush; mm++) {
            const want = { ...middle };
            want[wall.axis] = rest + wall.sign * mm / 1000;
            const c = P.furnitureCenter(room, want, item);
            flush = Math.abs(c[wall.axis] - rest) < 1e-6
              && P.isFurniturePlacementValid(room, { ...item, center: c }, new Set(["m"]));
          }
          if (!flush) stuck.push(`${kind}@${turn} ${wall.axis}${wall.sign > 0 ? "-" : "+"}`);
        }
       }
      }
      check(`on a ${cm} cm grid every kind can sit flat against a wall`,
        stuck.length === 0, stuck.join(", "));
    }

    // One position per step, no coarser. Measured by dragging the pointer
    // across 40 cm a tenth of a millimetre at a time and collecting what the
    // piece actually does — the gap between neighbouring stops is the finest
    // move the user can make.
    {
      const room = bench(grid);
      room.furniture = [{ id: "a", kind: "chair", center: P.point(3, 3), rotationDegrees: 0 }];
      const item = { id: "b", kind: "chair", center: P.point(6, 6), rotationDegrees: 0 };
      const stops = [];
      for (let t = 0; t <= 4000; t++) {
        const v = +P.furnitureCenter(room, { x: 2.8 + t / 10000, z: 6 }, item).x.toFixed(4);
        if (!stops.length || stops[stops.length - 1] !== v) stops.push(v);
      }
      const jumps = stops.slice(1).map((v, i) => v - stops[i]);
      const worst = Math.max(...jumps);
      // Which part of the piece the steps are counted from. Putting the
      // *centre* on the grid leaves the edge half a step off it for anything
      // whose half-width is not a whole number of steps — a chair is 45 cm —
      // and the edge is the part the user lines up against a wall or a
      // neighbour. Away from both, every edge lands on a grid line.
      {
        // Clear floor, so nothing is on offer but the grid itself.
        const plain = bench(grid);
        const half = P.FURNITURE_KINDS.chair.w / 2;
        const off = [];
        for (let t = 0; t <= 400; t++) {
          const x = P.furnitureCenter(plain, { x: 2.8 + t / 1000, z: 2.5 }, item).x;
          const edge = x - half;
          if (Math.abs(edge / step - Math.round(edge / step)) > 1e-6) off.push(+edge.toFixed(4));
        }
        check(`a ${cm} cm grid puts a piece's edge on a grid line`,
          off.length === 0, `${off.length} of 401 drags landed off it, e.g. ${off[0]}`);
      }

      check(`a ${cm} cm grid moves a piece ${cm} cm at a time, never coarser`,
        worst <= step + 1e-9, `biggest jump ${(worst * 1000).toFixed(1)} mm`);
      // Passing that on its own would be easy by ignoring the setting and
      // always working in millimetres, so the steps have to be the grid's.
      check(`and a ${cm} cm grid does not offer positions finer than the grid`,
        stops.length <= 0.40 / step + 4, `${stops.length} stops over 40 cm`);
    }

    // Alongside a neighbour: edges line up, and the piece can still be nudged.
    {
      const room = bench(grid);
      // The neighbour is put against the wall first, the way a room is really
      // furnished. That leaves its far edge off the grid for a chair — 5 cm
      // wall face plus 22.5 cm — so reaching it needs the neighbour's own edge
      // to be on offer, not just the grid.
      const { walls, middle } = inside(room);
      const chair = { id: "a", kind: "chair", center: P.point(middle.x, middle.z), rotationDegrees: 0 };
      chair.center = P.furnitureCenter(room,
        { x: walls[0].face + P.FURNITURE_KINDS.chair.w / 2, z: middle.z }, chair);
      room.furniture = [chair];
      const neighbour = P.furnitureFootprint(chair);
      const item = { id: "b", kind: "armchair", center: P.point(6, 6), rotationDegrees: 0 };
      const half = P.FURNITURE_KINDS.armchair.w / 2;
      let touching = false;
      for (let mm = 0; mm <= 20 && !touching; mm++) {
        const c = P.furnitureCenter(room, { x: neighbour.maxX + half + mm / 1000, z: middle.z }, item);
        touching = Math.abs(c.x - half - neighbour.maxX) < 1e-6;
      }
      check(`on a ${cm} cm grid a piece can be set edge to edge with another`,
        touching, `neighbour's edge at ${neighbour.maxX.toFixed(3)}`);
    }
  }

  // A wall that divides the room, rather than one of the four round the
  // outside. Both its faces have to be on offer: a piece is pushed flat
  // against whichever side of it the piece is on. On a bare rectangle this is
  // impossible to tell apart from offering the wrong walls' coordinates —
  // every wall of an outline starts where a wall across it stands — so the
  // divider is what makes the distinction real.
  {
    for (const [grid, step] of Object.entries(GRIDS)) {
      const room = bench(grid);
      const { middle } = inside(room);
      const zs = room.walls.flatMap(w => [w.start.z, w.end.z]);
      room.walls.push({ id: "divider", start: P.point(3, Math.min(...zs)),
                                       end: P.point(3, Math.max(...zs)) });
      const half = P.WALL_THICKNESS / 2;
      const stuck = [];
      for (const side of [{ face: 3 - half, sign: -1 }, { face: 3 + half, sign: +1 }]) {
        const item = { id: "m", kind: "shelf", center: P.point(middle.x, middle.z), rotationDegrees: 0 };
        const rest = side.face + side.sign * P.FURNITURE_KINDS.shelf.w / 2;
        let flush = false;
        for (let mm = 0; mm <= 20 && !flush; mm++) {
          const c = P.furnitureCenter(room, { x: rest + side.sign * mm / 1000, z: middle.z }, item);
          flush = Math.abs(c.x - rest) < 1e-6
            && P.isFurniturePlacementValid(room, { ...item, center: c }, new Set(["m"]));
        }
        if (!flush) stuck.push(side.sign > 0 ? "east side" : "west side");
      }
      check(`on a ${Math.round(step * 100)} cm grid a piece sits flat against a divider`,
        stuck.length === 0, stuck.join(", "));
    }
  }

  // Two pieces lined up on a shared centre line. A chair pushed against the
  // wall has its middle at 5 cm of wall plus 22.5 cm of chair — half a
  // centimetre off every grid there is once a table's own half-width is taken
  // off it, so the grid alone cannot get there.
  {
    const room = bench("oneCentimeter");
    const { walls, middle } = inside(room);
    const chair = { id: "a", kind: "chair", center: P.point(middle.x, middle.z), rotationDegrees: 0 };
    chair.center = P.furnitureCenter(room,
      { x: walls[1].face - P.FURNITURE_KINDS.chair.w / 2, z: middle.z }, chair);
    room.furniture = [chair];
    const table = { id: "b", kind: "table", center: P.point(8, 8), rotationDegrees: 0 };
    let shared = false;
    for (let mm = -10; mm <= 10 && !shared; mm++) {
      const c = P.furnitureCenter(room, { x: chair.center.x + mm / 1000, z: middle.z + 1 }, table);
      shared = Math.abs(c.x - chair.center.x) < 1e-6;
    }
    check("two pieces can be lined up on a shared centre line",
      shared, `the chair's middle is at ${chair.center.x.toFixed(3)}`);
  }

  // Snapping may never take a placement that was clear of the walls and put it
  // inside one. A wall face offering itself to a piece's *centre* does exactly
  // that: the piece lands straddling the wall, half of it in the next room,
  // and there is no drag position from which that is what was meant.
  {
    for (const [grid, step] of Object.entries(GRIDS)) {
      const room = bench(grid);
      const item = { id: "m", kind: "chair", center: P.point(3, 3), rotationDegrees: 0 };
      let buried = null;
      for (let t = 0; t <= 3000 && !buried; t++) {
        const want = { x: 0.02 + t / 5000, z: 1.5 };
        // Only asks that were themselves clear of every wall count: a drag
        // that genuinely aims into a wall is allowed to read red.
        if (P.furnitureIntersectsWall(room, { ...item, center: want })) continue;
        const c = P.furnitureCenter(room, want, item);
        if (P.furnitureIntersectsWall(room, { ...item, center: c })) buried = { want, c };
      }
      check(`on a ${Math.round(step * 100)} cm grid snapping never pushes a piece into a wall`,
        buried === null,
        buried && `asked ${buried.want.x.toFixed(3)}, landed ${buried.c.x.toFixed(3)}`);
    }
  }

  // The pull is the grid's, not a number of its own. A 1 cm grid that still
  // reached 8 cm is the reported fault, so the reach is checked directly:
  // nothing may move a piece further than half a step from where it was asked
  // for.
  {
    const worst = {};
    for (const [grid, step] of Object.entries(GRIDS)) {
      const room = bench(grid);
      room.furniture = [
        { id: "a", kind: "chair", center: P.point(3, 3), rotationDegrees: 0 },
        { id: "c", kind: "table", center: P.point(4.1, 3.3), rotationDegrees: 0 },
      ];
      const item = { id: "b", kind: "chair", center: P.point(6, 6), rotationDegrees: 0 };
      let off = 0;
      for (let t = 0; t <= 6000; t++) {
        const want = { x: 2.5 + t / 4000, z: 3 + (t % 700) / 1000 };
        const c = P.furnitureCenter(room, want, item);
        off = Math.max(off, Math.abs(c.x - want.x), Math.abs(c.z - want.z));
      }
      worst[grid] = off;
      check(`a ${Math.round(step * 100)} cm grid never moves a piece more than half a step`,
        off <= step / 2 + 1e-9, `moved it ${(off * 1000).toFixed(1)} mm`);
    }
    // And the three settings really are three different behaviours, rather
    // than one reach that happens to satisfy all of them.
    check("a coarser grid pulls further than a finer one",
      worst.fiveCentimeters > worst.twoCentimeters && worst.twoCentimeters > worst.oneCentimeter,
      JSON.stringify(worst));
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
