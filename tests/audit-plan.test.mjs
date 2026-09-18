// Regression tests for the plan-model audit of 2026-09-18.
//
// One section per finding, and each one is written against the failure as it
// was measured rather than against the fix: every section below failed on the
// branch before the audit's fixes landed, and passes after. The model is the
// real one — plan.js is the facade over roomcad/web/plan/*.js and is imported
// by path, the way the app imports it.
//
// Run:  node tests/audit-plan.test.mjs

import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const planURL = pathToFileURL(join(here, "..", "roomcad", "web", "plan.js")).href;
const P = await import(planURL);

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; return; }
  failed++;
  console.error("FAIL: " + name + (detail ? " — " + detail : ""));
}

/// A fresh room with an id for every wall, through the pass the app uses.
function settledRoom(name = "audit", w = 8, l = 6) {
  const room = P.freshRoom(name, w, l, 2.6);
  P.sanitize(room);
  return room;
}

/// Loads a document the way the app does, collecting the repair report.
function load(room) {
  const report = {};
  const parsed = P.parseRoom(P.serializeRoom(room), report);
  return { room: parsed, report };
}

/// The count recorded against one reason, or 0.
const countOf = (list, what, why) => {
  const hit = list.find(e => e.what === what && e.why.includes(why));
  return hit ? hit.count : 0;
};

// ── T0002: sanitize() is total ────────────────────────────────────────────
//
// Five dereference sites read a field straight off whatever the document
// carried there. A well-formed envelope with `walls:[null]`, a piece of
// furniture with no `center`, or a canvas written as a number was a TypeError
// part-way through loading — the whole document lost over one bad entry, which
// is the one failure a repair pass must not have. Each oddity must instead be
// treated the way a stub wall already is: gone, counted, and reported.
{
  const cases = [
    ["a wall that is null", r => { r.walls = [null]; }],
    ["a wall with no coordinates at all", r => { r.walls = [{}]; }],
    ["a wall with no start or end", r => { r.walls = [{ id: "w" }]; }],
    ["a wall with a null end", r => { r.walls = [{ id: "w", start: { x: 0, z: 0 }, end: null }]; }],
    ["furniture with no center", r => { r.furniture = [{ id: "f", kind: "chair" }]; }],
    ["furniture with a null center", r => { r.furniture = [{ id: "f", kind: "chair", center: null }]; }],
    ["a null public area", r => { r.publicAreas = [null]; }],
    ["a public area with no numbers", r => { r.publicAreas = [{}]; }],
    ["a canvas written as a number", r => { r.canvas = 5; }],
    ["a canvas written as a string", r => { r.canvas = "big"; }],
    ["an origin written as a string", r => { r.origin = "left"; }],
    ["an origin written as a boolean", r => { r.origin = true; }],
  ];
  for (const [label, mutate] of cases) {
    const room = P.freshRoom("total", 8, 6, 2.6);
    mutate(room);
    let out = null;
    let threw = null;
    try { out = load(room); } catch (e) { threw = e; }
    check(`${label} loads rather than throwing`,
      threw === null, threw ? `${threw.constructor.name}: ${threw.message}` : "");
    if (out) {
      // Whatever the oddity was, the document still opened with a usable shape.
      check(`${label} leaves a usable room`,
        Array.isArray(out.room.walls) && Array.isArray(out.room.furniture)
        && Array.isArray(out.room.publicAreas) && Number.isFinite(out.room.canvas.width)
        && Number.isFinite(out.room.origin.x), JSON.stringify(out.room).slice(0, 120));
    }
  }

  // A non-object canvas/origin is absent, not fatal — and it is defaulted.
  {
    const room = P.freshRoom("primitive", 8, 6, 2.6);
    room.canvas = 5;
    room.origin = "left";
    let opened = null;
    let threw = null;
    try { opened = load(room).room; } catch (e) { threw = e; }
    check("a primitive canvas/origin does not throw",
      threw === null, threw ? `${threw.constructor.name}: ${threw.message}` : "");
    if (opened) {
      check("a primitive canvas defaults to the room's own footprint",
        opened.canvas.width >= opened.width && opened.canvas.length >= opened.length,
        JSON.stringify(opened.canvas));
      check("a primitive origin defaults to the corner",
        opened.origin.x === 0 && opened.origin.z === 0, JSON.stringify(opened.origin));
    }
  }

  // Each drop is reported, so the load can say so.
  {
    const room = P.freshRoom("report", 8, 6, 2.6);
    room.walls = [
      ...room.walls,
      null,
      { id: "noPos" },
    ];
    room.furniture = [{ id: "f", kind: "chair" }];
    room.publicAreas = [{}];
    let opened = null;
    let report = null;
    let threw = null;
    try { ({ room: opened, report } = load(room)); } catch (e) { threw = e; }
    check("a document with several oddities loads at all",
      threw === null, threw ? `${threw.constructor.name}: ${threw.message}` : "");
    if (opened) {
      check("a wall that is not a usable wall is dropped and reported",
        countOf(report.dropped, "wall", "not a usable wall") === 2,
        JSON.stringify(report.dropped));
      check("furniture with no position is dropped and reported",
        countOf(report.dropped, "piece of furniture", "no position") === 1,
        JSON.stringify(report.dropped));
      check("a public area with no position is dropped and reported",
        countOf(report.dropped, "public area", "no position") === 1,
        JSON.stringify(report.dropped));
      check("the report names them in the sentence the user reads",
        /not a usable wall/.test(P.describeReport(report))
        && /no position/.test(P.describeReport(report)),
        P.describeReport(report));
      check("and the room really lost exactly those things",
        opened.walls.length === 4 && opened.furniture.length === 0 && opened.publicAreas.length === 0,
        `${opened.walls.length} walls, ${opened.furniture.length} furniture, `
        + `${opened.publicAreas.length} areas`);
    }
  }
}

// ── T0003: the room cache is keyed on wall identity, not only geometry ────
//
// roomSignature() keys on coordinates and door wallIDs, while the cached
// outsideWalls is a set of wall IDS. Two door-less rooms with identical
// geometry and different ids — exactly two freshRoom()s — share a signature, so
// the second was handed the first's ids: none of its own outer walls were
// recognised and every one of them was unlocked.
{
  const a = settledRoom("A", 6, 4);
  const b = settledRoom("B", 6, 4);
  const idsA = new Set(a.walls.map(w => w.id));
  const idsB = new Set(b.walls.map(w => w.id));
  // The premise: same geometry, different identities.
  check("two fresh rooms share a geometry but not ids",
    a.walls.length === b.walls.length
    && a.walls.every((w, i) => w.start.x === b.walls[i].start.x
      && w.start.z === b.walls[i].start.z && w.end.x === b.walls[i].end.x
      && w.end.z === b.walls[i].end.z)
    && [...idsA].every(id => !idsB.has(id)));

  const outsideA = P.outsideFacingWalls(a);
  const outsideB = P.outsideFacingWalls(b);
  check("the first room's outer walls are its own",
    [...outsideA].every(id => idsA.has(id)), JSON.stringify([...outsideA]));
  check("the second room's outer walls are ITS own, not the first's",
    [...outsideB].every(id => idsB.has(id)), JSON.stringify([...outsideB]));
  check("both rooms have the same number of outer walls",
    outsideA.size === outsideB.size, `${outsideA.size} vs ${outsideB.size}`);
  check("every one of the second room's walls is drag-locked as an outer wall",
    b.walls.every(w => P.wallDragLocked(b, w)),
    JSON.stringify(b.walls.map(w => [w.id.slice(0, 8), P.wallDragLocked(b, w)])));
  check("and none of the first room's ids leaked into the second room",
    [...outsideB].every(id => !outsideA.has(id)));
}

// ── T0010: a wall clamped onto the plate is not dropped on the next load ──
//
// The 15 cm test runs on the raw wall and the endpoints are then clamped, so a
// wall entirely off the plate clamps to zero length and SURVIVES that pass.
// serializeRoom -> parseRoom was not idempotent: the next load dropped it. The
// first test stays where it is — clamping can turn a diagonal into a
// rectilinear wall, and the order is deliberate — with the second added after.
{
  const room = P.freshRoom("off", 6, 4, 2.6);
  room.canvas = { width: 25, length: 25 };
  room.origin = { x: 0, z: 0 };
  room.walls = [{ id: "off", start: { x: 30, z: 30 }, end: { x: 32, z: 30 } }];

  const first = load(room);
  check("a wall entirely off the plate is dropped in the same pass",
    first.room.walls.length === 0, `${first.room.walls.length} left`);
  check("and that drop is counted in the stub bucket, not left silent",
    countOf(first.report.dropped, "wall", "shorter than") === 1,
    JSON.stringify(first.report.dropped));

  // Save -> load again must change nothing at all.
  const second = load(first.room);
  check("a second save/load reports nothing further",
    P.reportIsEmpty(second.report), P.describeReport(second.report));
  check("and the two loads agree wall for wall",
    second.room.walls.length === first.room.walls.length);
}

// ── T0011: centerRoom() moves the labels and the public areas too ─────────
//
// Labels and public areas are canvas-absolute, and a canvas resize calls
// centerRoom(). The walls and furniture moved and the text and green floor did
// not, so resizing the plate left the user's own annotations behind. Openings
// are wall-relative and must NOT move.
{
  const room = settledRoom("centre", 6, 4);
  room.canvas = { width: 25, length: 25 };
  room.origin = { x: 0, z: 0 };
  // Put everything at the top-left corner, then centre it.
  P.centerRoom(room);
  const start = { x: 0, z: 0 };
  room.labels = [{ id: "l", text: "hi", center: { ...start }, rotationDegrees: 0, size: 0.22 }];
  room.publicAreas = [{ id: "p", x: start.x, z: start.z, w: 2, l: 2 }];
  room.walls = room.walls.map(w => ({
    ...w,
    start: { x: w.start.x - room.origin.x, z: w.start.z - room.origin.z },
    end: { x: w.end.x - room.origin.x, z: w.end.z - room.origin.z },
  }));
  room.origin = { x: 0, z: 0 };

  const dx = (room.canvas.width - room.width) / 2 - 0;
  const dz = (room.canvas.length - room.length) / 2 - 0;
  P.centerRoom(room);

  check("the label moved with the room",
    Math.abs(room.labels[0].center.x - (start.x + dx)) < 1e-9
    && Math.abs(room.labels[0].center.z - (start.z + dz)) < 1e-9,
    JSON.stringify(room.labels[0].center));
  check("the public area moved with the room",
    Math.abs(room.publicAreas[0].x - (start.x + dx)) < 1e-9
    && Math.abs(room.publicAreas[0].z - (start.z + dz)) < 1e-9,
    JSON.stringify(room.publicAreas[0]));
  check("the walls moved by the same amount",
    Math.abs(room.walls[0].start.x - (dx)) < 1e-9
    && Math.abs(room.walls[0].start.z - (dz)) < 1e-9,
    JSON.stringify(room.walls[0].start));

  // A door keeps its offset on its wall — an offset is measured along the wall
  // and does not move when the whole plan does.
  {
    const r2 = settledRoom("openings", 6, 4);
    r2.canvas = { width: 25, length: 25 };
    r2.origin = { x: 0, z: 0 };
    P.centerRoom(r2);
    r2.doors = [{ id: "d", wallID: r2.walls[0].id, offset: 1.5, width: 0.9, open: true, swingInside: true }];
    r2.windows = [{ id: "w", wallID: r2.walls[1].id, offset: 0.8, width: 1.0 }];
    const beforeDoor = r2.doors[0].offset;
    const beforeWindow = r2.windows[0].offset;
    P.centerRoom(r2);
    check("openings are wall-relative and are not moved",
      r2.doors[0].offset === beforeDoor && r2.windows[0].offset === beforeWindow,
      `${r2.doors[0].offset} / ${r2.windows[0].offset}`);
  }
}

// ── T0012: the base case of sliceByWeights asks about frontage ────────────
//
// `fronting()` is documented as being asked of a piece about to become ONE
// room as well as of the two halves of a cut, and it was only called for
// candidate cuts. A one-room piece was returned unconditionally, so a piece
// with no way onto the circulation became a room anyway and the door step had
// nowhere to put a door but the outside wall or a neighbour. On this plate the
// right-hand room was given a front door onto the street plus a second door
// through the divider.
{
  const room = P.freshRoom("T", 8, 6, 2.6);
  P.centerRoom(room);
  const o = P.roomOrigin(room);
  room.walls.push({
    id: "userdiv",
    start: { x: o.x + 4, z: o.z },
    end: { x: o.x + 4, z: o.z + 6 },
  });
  room.publicAreas = [{ id: "hall", x: o.x, z: o.z, w: 1, l: 1 }];
  P.sanitize(room);

  const r = P.autoLayoutRooms(room, { count: 2, seed: 1 });
  check("the plate still lays out", !!r);
  if (r) {
    // The outer right wall of the plate. The right-hand piece of floor has no
    // frontage onto the hall, so it must not become a room with a front door:
    // the partition's one-room base case asks the frontage question now.
    const outer = r.walls.filter(w =>
      Math.abs(w.start.x - (o.x + 8)) < 1e-6 && Math.abs(w.end.x - (o.x + 8)) < 1e-6);
    check("the plate's outer wall is one of the generated walls",
      outer.length === 1, `${outer.length}`);
    const outsideDoor = r.doors.find(d => outer.some(w => w.id === d.wallID));
    check("no room is entered through the outer wall onto the street",
      !outsideDoor,
      outsideDoor ? `door at ${outsideDoor.offset}` : "");

    // Every generated room must be one the layout actually kept, and the floor
    // the partition could not use must be open floor rather than a walled-in
    // void: whatever is not a room is either circulation or spare, and a spare
    // rect is open.
    check("the floor the partition could not use is reported as open floor",
      r.corridors.length >= 1, JSON.stringify(r.corridors));
  }
}

// ── T0013: the grid table is not Object.prototype ─────────────────────────
//
// `GRID_STEPS[room.grid]` is truthy for "constructor", "toString", "valueOf"
// and "__proto__", so those names loaded and every snap read `.meters` off a
// function — undefined — and returned {0,0}. Only an own key is a grid.
{
  for (const grid of ["constructor", "toString", "valueOf", "__proto__", "hasOwnProperty"]) {
    const room = P.freshRoom("grid", 6, 4, 2.6);
    room.grid = grid;
    const { room: opened } = load(room);
    check(`grid "${grid}" is refused and defaulted`,
      Object.hasOwn(P.GRID_STEPS, opened.grid) && opened.grid === "fiveCentimeters",
      opened.grid);
    const snap = P.gridSnap(opened, { x: 3.33, z: 1.11 });
    check(`grid "${grid}" still snaps to a real step`,
      Number.isFinite(snap.x) && Number.isFinite(snap.z)
      && (Math.abs(snap.x - 3.33) > 1e-9 || Math.abs(snap.z - 1.11) > 1e-9),
      JSON.stringify(snap));
    const snapped = P.snapPoint(opened, { x: 2.03, z: 1.02 });
    check(`grid "${grid}" leaves snapPoint finite`,
      Number.isFinite(snapped.x) && Number.isFinite(snapped.z), JSON.stringify(snapped));
  }
  // And a real name is kept.
  {
    const room = P.freshRoom("grid", 6, 4, 2.6);
    room.grid = "oneCentimeter";
    const { room: opened } = load(room);
    check("a real grid name survives the load", opened.grid === "oneCentimeter", opened.grid);
  }
}

// ── T0014: the furniture table is not Object.prototype either ─────────────
//
// `kind:"constructor"` bypassed the unknown-kind drop, `kind.w`/`kind.d` were
// undefined, the centre became NaN, the save wrote nulls, the report said
// nothing and isFurniturePlacementValid said yes. Every lookup site asks for an
// own key.
{
  for (const kind of ["constructor", "toString", "valueOf", "__proto__", "hasOwnProperty"]) {
    const room = P.freshRoom("kind", 6, 4, 2.6);
    room.furniture = [{ id: "f", kind, center: { x: 1, z: 1 }, rotationDegrees: 0 }];
    const { room: opened, report } = load(room);
    check(`furniture kind "${kind}" is dropped as unknown`,
      opened.furniture.length === 0, JSON.stringify(opened.furniture));
    check(`furniture kind "${kind}" is reported as dropped`,
      countOf(report.dropped, "piece of furniture", "does not know") === 1,
      JSON.stringify(report.dropped));
    // The loud end of the same rule: an item that reaches the geometry is
    // refused rather than measured, whichever lookup it gets to first.
    let threw = null;
    try { P.furnitureFootprint({ kind, center: { x: 1, z: 1 }, rotationDegrees: 0 }); }
    catch (e) { threw = e; }
    check(`furnitureFootprint refuses kind "${kind}"`,
      threw !== null && /Unknown furniture kind/.test(threw.message),
      threw ? threw.message : "no throw");
    check(`isFurniturePlacementValid refuses kind "${kind}"`,
      P.isFurniturePlacementValid(opened, { id: "x", kind, center: { x: 1, z: 1 } }) === false);
  }
  // A real kind still works.
  {
    const room = P.freshRoom("kind", 6, 4, 2.6);
    room.furniture = [{ id: "f", kind: "chair", center: { x: 1, z: 1 }, rotationDegrees: 0 }];
    const { room: opened } = load(room);
    check("a real kind is kept", opened.furniture.length === 1 && opened.furniture[0].kind === "chair");
    check("and its position is a real number",
      Number.isFinite(opened.furniture[0].center.x) && Number.isFinite(opened.furniture[0].center.z));
  }
}

// ── T0028: detectRooms bounds the allocation it documents ─────────────────
//
// The docstring bounds the largest array at about 4 MB, but every grid cell was
// materialised as a new two-element array in `region.cells`: a plan of a few
// hundred stubs peaked at +139.7 MB. The cells are held in flat typed arrays
// now. The claim being measured is the peak allocation, not the shape of the
// code, so this measures it end to end — in a child process with --expose-gc,
// because the runner invokes node without it and an uncollected heap would
// measure the previous case instead.
{
  /// The peak heap a fresh detectRooms() adds for a plan of `stubs` short
  /// stubs, measured in a child process so a cache hit or leftover garbage
  /// cannot be mistaken for the work.
  const peakFor = stubs => {
    const script = `
      const P = await import(process.env.ROOMCAD_PLAN_URL);
      const n = Number(process.env.ROOMCAD_STUBS);
      const room = P.freshRoom("busy", 10, 10, 2.6);
      room.walls = [
        { id: "a", start: { x: 0, z: 0 }, end: { x: 10, z: 0 } },
        { id: "b", start: { x: 10, z: 0 }, end: { x: 10, z: 10 } },
        { id: "c", start: { x: 10, z: 10 }, end: { x: 0, z: 10 } },
        { id: "d", start: { x: 0, z: 10 }, end: { x: 0, z: 0 } },
      ];
      // Short stubs add unique coordinates without enclosing anything: the cell
      // count climbs while the number of real rooms stays at one.
      for (let i = 0; i < n; i++) {
        const off = 20 + i * 0.01;
        room.walls.push({ id: "v" + i, start: { x: off, z: 0 }, end: { x: off, z: 0.05 } });
        room.walls.push({ id: "h" + i, start: { x: 0, z: off }, end: { x: 0.05, z: off } });
      }
      P.detectRooms(P.freshRoom("buster", 5, 3, 2.6));   // cache the miss elsewhere
      globalThis.gc();
      const before = process.memoryUsage().heapUsed;
      P.detectRooms(room);
      console.log(process.memoryUsage().heapUsed - before);
    `;
    const out = execFileSync(process.execPath, ["--expose-gc", "--input-type=module", "-e", script], {
      env: { ...process.env, ROOMCAD_PLAN_URL: planURL, ROOMCAD_STUBS: String(stubs) },
      encoding: "utf8",
    });
    return Number(out.trim());
  };

  // Two sizes, so the fixed overhead of the plan itself cancels and what is
  // left is the cost of the cells the decomposition materialises.
  const small = peakFor(250);
  const large = peakFor(700);
  const perStub = (large - small) / 450;
  // The old shape measured about 0.17 MB a stub here (roughly 55 bytes a cell);
  // the documented budget is about 4 bytes a cell, which is 12 kB a stub on
  // this plan. 25 kB leaves room for the owner map, the region lists and the
  // wall spans without leaving room for an object per cell.
  check("the allocation probe measured something", Number.isFinite(perStub) && large > 0,
    `small ${small}, large ${large}`);
  check("detectRooms allocates within its documented per-cell budget",
    perStub < 25e3, `+${(perStub / 1e3).toFixed(1)} kB a stub (${small} -> ${large})`);
}

// ── T0029: the repair report is faithful in both directions ───────────────
//
// (a) a door with no offset/width is materialised to {0.1, 0.6} while the
// report is empty, because Math.abs(0.6 - undefined) is NaN; (b) turn(undefined)
// is 0 and 0 !== undefined, so a piece that merely omits rotationDegrees
// reported "repaired rotation"; (c) ids were counted for objects that were then
// dropped. A change is a change; an absence is an absence.
{
  // (a) A missing offset/width is filled in and counted.
  {
    const room = settledRoom("door-defaults");
    room.doors = [{ id: "d1", wallID: room.walls[0].id }];
    const { room: opened, report } = load(room);
    check("a door with no offset or width still loads",
      opened.doors.length === 1 && opened.doors[0].width === P.MIN_OPENING_WIDTH.door
      && opened.doors[0].offset === 0.10,
      JSON.stringify(opened.doors[0]));
    check("and the two repairs it needed are reported",
      countOf(report.repaired, "opening", "resized or moved") === 2,
      JSON.stringify(report.repaired));
  }

  // (a2) A door value that is wrong-but-present is reported once, not twice.
  {
    const room = settledRoom("door-one");
    room.doors = [{ id: "d1", wallID: room.walls[0].id, offset: 40, width: 0.9 }];
    const { report } = load(room);
    check("moving one opening is reported once",
      countOf(report.repaired, "opening", "resized or moved") === 1,
      JSON.stringify(report.repaired));
  }

  // (b) A missing rotationDegrees is not a repair.
  {
    const room = settledRoom("rot");
    room.furniture = [{ id: "f1", kind: "chair", center: { x: 1, z: 1 } }];
    const { room: opened, report } = load(room);
    check("a piece that omits rotationDegrees reports no repair",
      countOf(report.repaired, "rotation", "") === 0, JSON.stringify(report.repaired));
    check("but it still has a rotation when it is read", opened.furniture[0].rotationDegrees === 0);
  }

  // (b2) A rotation that really moves is reported exactly once.
  {
    const room = settledRoom("rot2");
    room.furniture = [{ id: "f1", kind: "chair", center: { x: 1, z: 1 }, rotationDegrees: 17 }];
    const { report } = load(room);
    check("a rotation that moved is reported once",
      countOf(report.repaired, "rotation", "") === 1, JSON.stringify(report.repaired));
  }

  // (c) An id is only reported for an object that survives.
  {
    const room = settledRoom("ids");
    // Two labels with ids and no position: both dropped, so neither id counts.
    room.labels = [{ id: "a", text: "one" }, { id: "b", text: "two" }];
    const { room: opened, report } = load(room);
    check("both id-carrying labels were dropped",
      opened.labels.length === 0 && countOf(report.dropped, "label", "no position") === 2,
      JSON.stringify(report.dropped));
    check("no id is reported as repaired for objects that are gone",
      countOf(report.repaired, "id", "") === 0, JSON.stringify(report.repaired));
  }
  {
    const room = settledRoom("ids2");
    // One label with no id that survives: one id is genuinely filled in.
    room.labels = [{ text: "kept", center: { x: 1, z: 1 } }];
    const { room: opened, report } = load(room);
    check("a surviving object with no id is given one",
      opened.labels.length === 1 && !!opened.labels[0].id);
    check("and that id is reported exactly once",
      countOf(report.repaired, "id", "") === 1, JSON.stringify(report.repaired));
  }

  // Both ways: a clean document reports nothing, and every real repair is
  // reported exactly once — checked per-kind above and end to end here.
  {
    const { report } = load(P.demoRoom());
    check("a clean document reports nothing at all", P.reportIsEmpty(report),
      P.describeReport(report));
  }
}

// ── T0030: duplicate ids do not survive sanitize ──────────────────────────
//
// name() only filled a missing id, so two walls `id:"same"` both loaded; every
// lookup acted on the first, and store/editing.js deletes with
// `filter(w => w.id !== id)`, so one delete removed both. Any object whose id is
// already taken is given a fresh one, after the drops, so a dropped object's id
// is not reserved.
{
  const room = settledRoom("dup");
  const wall = room.walls[0];
  room.walls = [
    { id: "same", start: { x: 0, z: 0 }, end: { x: 6, z: 0 } },
    { id: "same", start: { x: 0, z: 4 }, end: { x: 6, z: 4 } },
  ];
  room.doors = [
    { id: "dd", wallID: wall.id, offset: 0.5, width: 0.9 },
    { id: "dd", wallID: wall.id, offset: 2.0, width: 0.9 },
  ];
  room.windows = [
    { id: "ww", wallID: wall.id, offset: 0.5, width: 0.8 },
    { id: "ww", wallID: wall.id, offset: 3.0, width: 0.8 },
  ];
  room.furniture = [
    { id: "f", kind: "chair", center: { x: 1, z: 1 }, rotationDegrees: 0 },
    { id: "f", kind: "chair", center: { x: 3, z: 1 }, rotationDegrees: 0 },
  ];
  room.labels = [
    { id: "L", text: "a", center: { x: 1, z: 1 }, rotationDegrees: 0, size: 0.22 },
    { id: "L", text: "b", center: { x: 2, z: 1 }, rotationDegrees: 0, size: 0.22 },
  ];
  room.publicAreas = [
    { id: "P", x: 0, z: 0, w: 1, l: 1 },
    { id: "P", x: 2, z: 0, w: 1, l: 1 },
  ];

  const { room: opened } = load(room);
  const unique = list => new Set(list.map(x => x.id)).size === list.length;
  check("wall ids are unique after a load", unique(opened.walls),
    JSON.stringify(opened.walls.map(w => w.id)));
  check("door ids are unique after a load", unique(opened.doors));
  check("window ids are unique after a load", unique(opened.windows));
  check("furniture ids are unique after a load", unique(opened.furniture));
  check("label ids are unique after a load", unique(opened.labels));
  check("public area ids are unique after a load", unique(opened.publicAreas));

  // The proof that mattered: deleting one of two same-id walls removed both.
  const target = opened.walls[0].id;
  const left = opened.walls.filter(w => w.id !== target);
  check("deleting one wall leaves the other", left.length === 1,
    `${left.length} left of ${opened.walls.length}`);

  // A dropped object's id must not be reserved. Both walls here want "gone";
  // the first is a real stub record that is dropped, so the survivor is the
  // FIRST claimant of that id and keeps it — no rename, and no id repair
  // reported. If the drop had reserved the id, the survivor would have been
  // renamed and the report would say so.
  {
    const r2 = settledRoom("reserve");
    r2.walls = [
      { id: "gone", start: { x: 0, z: 0 }, end: { x: 0.05, z: 0 } },   // stub, dropped
      { id: "gone", start: { x: 0, z: 0 }, end: { x: 6, z: 0 } },      // the same id, kept
    ];
    const { room: kept, report } = load(r2);
    check("a dropped object does not reserve its id",
      kept.walls.length === 1 && kept.walls[0].id === "gone",
      JSON.stringify(kept.walls.map(w => w.id)));
    check("so the survivor is not renamed",
      countOf(report.repaired, "id", "") === 0, JSON.stringify(report.repaired));
    check("and the drop is still reported", countOf(report.dropped, "wall", "shorter than") === 1,
      JSON.stringify(report.dropped));
  }

  // The first object to claim an id keeps it; the later one is renamed.
  {
    const r3 = settledRoom("first");
    r3.walls = [
      { id: "same", start: { x: 0, z: 0 }, end: { x: 6, z: 0 } },
      { id: "same", start: { x: 0, z: 4 }, end: { x: 6, z: 4 } },
    ];
    const { room: out } = load(r3);
    check("the first claimant keeps its id and the second is renamed",
      out.walls[0].id === "same" && out.walls[1].id !== "same");
  }
}

console.log(`${passed} passed, ${failed} failed — the 2026-09-18 plan audit`);
process.exit(failed ? 1 : 0);
