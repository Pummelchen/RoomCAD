// Node test for the auto room-layout algorithm in roomcad/web/plan.js.
//
// autoLayoutRooms partitions the private area (the room rectangle minus any
// marked public areas) into `count` rooms via recursive guillotine cuts, then
// adds walls, one door per room, and (optionally) one window per room on
// outside-facing walls. This test checks the geometry invariants:
//   - exactly `count` non-overlapping rooms inside the layout
//   - rooms cover the private area (no gaps)
//   - one door per room, each on a real wall
//   - windows only when enabled, only on walls, only where a room faces out
//   - no duplicate walls
//   - different seeds give different layouts
//
// Run:  node tests/auto-layout.test.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const planSrc = readFileSync(join(here, "..", "roomcad", "web", "plan.js"), "utf8");
const P = await import(
  "data:text/javascript;base64," + Buffer.from(planSrc).toString("base64")
);

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) passed++;
  else { failed++; console.error(`FAIL: ${name}${detail ? " — " + detail : ""}`); }
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.z < b.z + b.l && b.z < a.z + a.l;
}

function areaOf(r) { return r.w * r.l; }

// ── 1. Public strip along the top, 4 rooms, windows on ────────────────────
{
  const room = P.freshRoom("T", 10, 6, 2.6);
  room.publicAreas = [{ x: 0, z: 0, w: 10, l: 2 }];
  const r = P.autoLayoutRooms(room, { count: 4, windows: true, seed: 1 });

  check("returns a layout", !!r);
  check("4 rooms generated", r.rooms.length === 4);
  check("one door per room", r.doors.length === r.rooms.length);
  check("doors reference real walls",
    r.doors.every(d => r.walls.some(w => w.id === d.wallID)));

  // Rooms plus the corridors carved for them account for the whole private
  // area (10 × 4 = 40 m²): nothing is lost. Rooms alone no longer fill it —
  // floor the target area does not need becomes walk path, deliberately.
  const roomArea = r.rooms.reduce((s, x) => s + areaOf(x), 0);
  const walkArea = r.corridors.reduce((s, x) => s + areaOf(x), 0);
  check("rooms and walk paths together account for the private area",
    Math.abs(roomArea + walkArea - 40) < 0.5, `rooms ${roomArea.toFixed(1)} + walk ${walkArea.toFixed(1)}`);
  check("no floor is left unaccounted for", roomArea + walkArea <= 40.5, `${roomArea + walkArea}`);
  for (let i = 0; i < r.rooms.length; i++) {
    for (let j = i + 1; j < r.rooms.length; j++) {
      if (rectsOverlap(r.rooms[i], r.rooms[j])) {
        check("rooms do not overlap", false, `${i} vs ${j}`);
      }
    }
  }
  check("rooms do not overlap", true);

  // Every room touches the outer boundary here, so every room gets a window.
  check("window per room (all face outside)", r.windows.length === r.rooms.length,
    `got ${r.windows.length}`);
  check("windows reference real walls",
    r.windows.every(w => r.walls.some(x => x.id === w.wallID)));

  // No duplicate walls.
  const keys = new Set(r.walls.map(w =>
    `${Math.round(w.start.x * 1000)},${Math.round(w.start.z * 1000)}-${Math.round(w.end.x * 1000)},${Math.round(w.end.z * 1000)}`));
  check("walls are unique", keys.size === r.walls.length);
}

// ── 2. Windows off ────────────────────────────────────────────────────────
{
  const room = P.freshRoom("T", 10, 6, 2.6);
  room.publicAreas = [{ x: 0, z: 0, w: 10, l: 2 }];
  const r = P.autoLayoutRooms(room, { count: 3, windows: false, seed: 1 });
  check("no windows when disabled", r.windows.length === 0);
  check("3 rooms, 3 doors", r.rooms.length === 3 && r.doors.length === 3);
}

// ── 3. No public area: the whole layout is partitioned ───────────────────
{
  const room = P.freshRoom("T", 8, 6, 2.6);
  const r = P.autoLayoutRooms(room, { count: 3, windows: false, seed: 1 });
  check("whole layout partitioned", r.rooms.length === 3 && r.doors.length === 3);
}

// ── 4. Redesign actually redesigns ────────────────────────────────────────
//
// What matters is the behaviour behind the button, which steps the seed by one
// each press — not that two arbitrary seeds differ. In a narrow strip there are
// only so many good partitions, so any given pair may legitimately coincide;
// pressing Redesign a few times must not.
{
  const room = P.freshRoom("T", 10, 6, 2.6);
  room.publicAreas = [{ x: 0, z: 0, w: 10, l: 2 }];
  const shapeOf = seed => {
    const r = P.autoLayoutRooms(room, { count: 4, windows: false, seed });
    return r.rooms.map(x => `${x.w.toFixed(2)}x${x.l.toFixed(2)}`).sort().join("|");
  };
  const runs = [1, 2, 3, 4, 5, 6].map(shapeOf);
  check("pressing Redesign gives more than one arrangement",
    new Set(runs).size >= 3, `${new Set(runs).size} distinct in 6 presses`);
  check("consecutive presses change the plan",
    runs.some((r, i) => i > 0 && r !== runs[i - 1]), "no press changed anything");
  check("the same seed always reproduces its plan", shapeOf(3) === shapeOf(3));
}

// ── 5. Too many rooms for the space degrades gracefully ──────────────────
{
  const room = P.freshRoom("T", 4, 4, 2.6);
  const r = P.autoLayoutRooms(room, { count: 20, windows: false, seed: 1 });
  check("oversized request still returns something", !!r);
  check("oversized request yields fewer rooms", r.rooms.length >= 1 && r.rooms.length <= 20);
}

// ── 6. The requested area actually drives the layout ─────────────────────
// This is the whole point of the generator and was silently ignored before:
// the target was collected in the UI, passed to the store, and dropped.
{
  const room = P.freshRoom("T", 12, 8, 2.6);
  const shapes = [8, 12, 20].map(area => {
    const r = P.autoLayoutRooms(room, { count: 4, area, seed: 1 });
    return { area, r, avg: r.areaPerRoom };
  });
  check("different targets give different layouts",
    new Set(shapes.map(s => s.r.rooms.map(x => `${x.w}x${x.l}`).sort().join("|"))).size === 3,
    shapes.map(s => s.avg).join(", "));
  for (const s of shapes) {
    check(`rooms land near the ${s.area} m² asked for`,
      Math.abs(s.avg - s.area) / s.area < 0.12, `got ${s.avg}`);
  }
  // Floor the rooms do not need becomes circulation rather than bloating them.
  const small = shapes[0].r;
  const walk = small.corridors.reduce((s, c) => s + c.w * c.l, 0);
  check("slack becomes walk path, not oversized rooms", walk > 20, `${walk} m²`);
}

// ── 7. Every room is reachable ───────────────────────────────────────────
// A generated plan where a room has no door onto circulation is not a plan.
{
  for (const [count, area] of [[3, 12], [5, 10], [6, 8], [8, 6]]) {
    const room = P.freshRoom("T", 12, 8, 2.6);
    const r = P.autoLayoutRooms(room, { count, area, seed: 3 });
    check(`every one of ${count} rooms has a door`,
      r.doors.length === r.rooms.length, `${r.doors.length}/${r.rooms.length}`);
    check(`no room in the ${count}-room plan is below the usable minimum`,
      r.rooms.every(x => Math.min(x.w, x.l) >= P.MIN_ROOM_DIM - 0.06),
      JSON.stringify(r.rooms.map(x => Math.min(x.w, x.l))));
  }
}

// ── 8. Redesign explores genuinely different plans ───────────────────────
{
  const room = P.freshRoom("T", 12, 8, 2.6);
  const seen = new Set();
  let worstOff = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const r = P.autoLayoutRooms(room, { count: 5, area: 12, seed });
    seen.add(r.rooms.map(x => `${x.x},${x.z},${x.w},${x.l}`).sort().join("|"));
    worstOff = Math.max(worstOff, Math.abs(r.areaPerRoom - 12) / 12);
  }
  check("redesign yields several distinct plans", seen.size >= 4, `${seen.size} of 8`);
  check("every redesign is still close to the target", worstOff < 0.12, `worst ${(worstOff * 100).toFixed(0)}%`);
}

// ── 9. User-marked public floor is never built over ──────────────────────
{
  const room = P.freshRoom("T", 12, 8, 2.6);
  const origin = P.roomOrigin(room);
  const hall = { id: "h", x: origin.x, z: origin.z + 6.5, w: 12, l: 1.5 };
  room.publicAreas = [hall];
  const r = P.autoLayoutRooms(room, { count: 5, area: 12, seed: 1 });
  const intrudes = r.rooms.filter(x =>
    x.x < hall.x + hall.w - 0.01 && x.x + x.w > hall.x + 0.01 &&
    x.z < hall.z + hall.l - 0.01 && x.z + x.l > hall.z + 0.01);
  check("no room intrudes into floor the user marked public", intrudes.length === 0,
    JSON.stringify(intrudes));

  // A previous run's own corridors are reclaimed, not treated as user floor.
  room.publicAreas = [hall, { id: "g", x: origin.x, z: origin.z, w: 12, l: 1.2, generated: true }];
  const again = P.autoLayoutRooms(room, { count: 5, area: 12, seed: 1 });
  check("the generator reclaims its own previous corridors",
    Math.abs(again.rooms.reduce((s, x) => s + areaOf(x), 0)
      - r.rooms.reduce((s, x) => s + areaOf(x), 0)) < 0.5);
}

// ── 10. Broad sweep: the invariants must hold for every shape ────────────
// A generated plan is only usable if the rooms tile without overlapping, none
// is a sliver, none escapes the outline, and every one can be walked into.
// Snapping position and size independently used to break the first of these:
// neighbours disagreed about the boundary they shared and overlapped by 5 cm.
{
  let checked = 0, overlaps = 0, thin = 0, doorless = 0, outside = 0;
  for (const [w, l] of [[4, 4], [6, 5], [12, 8], [20, 3.2], [9, 9], [16, 6], [5, 14], [10, 7]]) {
    for (const count of [1, 2, 3, 4, 5, 6, 8, 10]) {
      for (const area of [6, 9, 12, 20]) {
        for (const seed of [1, 2, 3]) {
          const room = P.freshRoom("T", w, l, 2.6);
          P.centerRoom(room);
          const o = P.roomOrigin(room);
          const r = P.autoLayoutRooms(room, { count, area, seed });
          if (!r) continue;
          checked++;
          for (let i = 0; i < r.rooms.length; i++) {
            for (let j = i + 1; j < r.rooms.length; j++) {
              const a = r.rooms[i], b = r.rooms[j];
              if (a.x < b.x + b.w - 0.001 && b.x < a.x + a.w - 0.001
                && a.z < b.z + b.l - 0.001 && b.z < a.z + a.l - 0.001) { overlaps++; i = 1e9; break; }
            }
          }
          if (r.rooms.some(x => Math.min(x.w, x.l) < P.MIN_ROOM_DIM - 0.06)) thin++;
          if (r.doors.length !== r.rooms.length) doorless++;
          if (r.rooms.some(x => x.x < o.x - 0.01 || x.z < o.z - 0.01
            || x.x + x.w > o.x + w + 0.01 || x.z + x.l > o.z + l + 0.01)) outside++;
        }
      }
    }
  }
  check("the sweep actually ran", checked > 500, `${checked}`);
  check("no layout has overlapping rooms", overlaps === 0, `${overlaps} of ${checked}`);
  check("no layout has a room below the usable minimum", thin === 0, `${thin} of ${checked}`);
  check("every room in every layout has a door", doorless === 0, `${doorless} of ${checked}`);
  check("no room escapes the outline", outside === 0, `${outside} of ${checked}`);
}

// ── 11. A single small room in a large space stays small ─────────────────
// The generator used to hand back one room filling the whole floor, because
// the single-room path ignored the requested area entirely.
{
  const room = P.freshRoom("T", 12, 8, 2.6);
  P.centerRoom(room);
  const r = P.autoLayoutRooms(room, { count: 1, area: 6, seed: 1 });
  check("one 6 m² room is 6 m², not the whole 96 m² floor",
    Math.abs(areaOf(r.rooms[0]) - 6) < 1.2, `${areaOf(r.rooms[0])}`);
  const walk = r.corridors.reduce((s, c) => s + areaOf(c), 0);
  check("the rest of the floor becomes public", walk > 80, `${walk}`);
}

// ── Generating inside a prepared template ────────────────────────────────
//
// The intended workflow is to draw a shell with a fixed core (stairs, a
// bathroom) and a walkway, then let the generator fill what is left. That only
// works if it leaves the drawn structure alone and treats the walkway as floor
// to route around rather than floor to build on.
{
  // A 10 × 14 shell with a 1 m walkway down the left side and a small
  // already-walled room in the bottom-left corner.
  const room = P.freshRoom("Template", 10, 14, 2.6);
  P.centerRoom(room);
  const o = P.roomOrigin(room);
  const mkWall = (ax, az, bx, bz) => ({
    id: P.uid(), start: { x: o.x + ax, z: o.z + az }, end: { x: o.x + bx, z: o.z + bz },
  });
  const coreTop = mkWall(0, 11, 3, 11);
  const coreRight = mkWall(3, 11, 3, 14);
  room.walls = room.walls.concat([coreTop, coreRight]);
  const coreDoor = { id: P.uid(), wallID: coreTop.id, offset: 1.0, width: 0.9, open: true, swingInside: true };
  room.doors = [coreDoor];
  const outerTop = room.walls[0];
  const keptWindow = { id: P.uid(), wallID: outerTop.id, offset: 1.0, width: 1.2, open: true, swingInside: true };
  room.windows = [keptWindow];
  // Two strips meeting at a corner — the shape a real walkway actually takes.
  const walkway = { id: P.uid(), x: o.x + 3, z: o.z, w: 1, l: 11 };
  const walkwayArm = { id: P.uid(), x: o.x + 4, z: o.z + 10, w: 4, l: 1 };
  room.publicAreas = [walkway, walkwayArm];

  const before = room.walls.map(w => w.id);
  const r = P.autoLayoutRooms(room, { count: 3, area: 12, windows: true, seed: 5 });
  check("a template with a core and a walkway still lays out", !!r);

  const ids = new Set(r.walls.map(w => w.id));
  check("every wall the user drew survives generation",
    before.every(id => ids.has(id)), `${before.filter(id => !ids.has(id)).length} lost`);
  check("the door in the drawn core survives",
    r.doors.some(d => d.id === coreDoor.id));
  check("the window the user placed survives",
    r.windows.some(w => w.id === keptWindow.id));
  check("every opening points at a wall that exists",
    r.doors.concat(r.windows).every(x => ids.has(x.wallID)));

  // The walkway is floor, not a plot. Checked against the room's actual
  // rectangles rather than its bounding box: a room is allowed to be an L that
  // reaches around a walkway, and its bounding box then spans the walkway
  // without a single square metre of the room sitting on it.
  const onWalkway = r.rooms.flatMap(rm => (rm.rects || [rm]))
    .filter(rc => rectsOverlap(rc, walkway) || rectsOverlap(rc, walkwayArm));
  check("no generated room is built on the walkway", onWalkway.length === 0, `${onWalkway.length}`);
  check("rooms may still wrap around it",
    r.rooms.some(rm => (rm.rects || []).length >= 1), "rooms should exist");

  // Tracing each strip's outline as walls seals every strip into a box of its
  // own, so the two arms of one walkway end up separated by a wall. Where a
  // walkway meets a room the room's own wall already stands; where two strips
  // meet there must be nothing.
  const seamX = walkwayArm.x;
  const seam = r.walls.filter(w =>
    Math.abs(w.start.x - seamX) < 1e-6 && Math.abs(w.end.x - seamX) < 1e-6
    && Math.min(w.start.z, w.end.z) < walkwayArm.z + walkwayArm.l - 1e-6
    && Math.max(w.start.z, w.end.z) > walkwayArm.z + 1e-6);
  check("the two arms of the walkway are not walled apart",
    seam.length === 0, `${seam.length} walls across the join`);

  const walkFloor = [walkway, walkwayArm];
  const doorOnWalk = r.doors.some(d => {
    const w = r.walls.find(x => x.id === d.wallID);
    if (!w) return false;
    const t = (d.offset + d.width / 2) / (P.wallLength(w) || 1);
    const mx = w.start.x + (w.end.x - w.start.x) * t;
    const mz = w.start.z + (w.end.z - w.start.z) * t;
    // Just to either side of the door, is there walkway floor?
    return walkFloor.some(a =>
      mx > a.x - 0.2 && mx < a.x + a.w + 0.2 && mz > a.z - 0.2 && mz < a.z + a.l + 0.2);
  });
  check("at least one room opens onto the walkway", doorOnWalk);

  // The already-walled corner is a room, not a plot to subdivide.
  const inCore = r.rooms.filter(rm =>
    rm.x < o.x + 3 - 1e-6 && rm.z > o.z + 11 + 1e-6);
  check("the room already walled off is not re-partitioned", inCore.length === 0, `${inCore.length}`);

  // Two walls a centimetre apart read as a clash in the editor.
  const applied = P.parseRoom(JSON.stringify({
    format: "com.maria.roomcad-v2.room", version: 1,
    room: { ...room, walls: r.walls, doors: r.doors, windows: r.windows },
  }));
  check("generation leaves no overlapping walls",
    P.overlappingWallAreas(applied).length === 0,
    `${P.overlappingWallAreas(applied).length}`);

  // Nothing is carved any more, so there is no corridor to be too narrow. What
  // matters instead is that the walkway the user drew was not added to.
  check("the generator adds no circulation of its own",
    r.corridors.every(c => c.w * c.l > 0),
    "leftover pieces are open floor, never a carved path");
}

// Asking for more than the space can hold must give the best it can, not
// nothing. The "already walled off, leave it alone" test used to be measured
// against the requested area, so a large request marked every region smaller
// than that — including the whole open floor — as already built, and the
// generator reported there was nowhere to put anything.
{
  const asks = [
    { w: 6, l: 5, count: 2, area: 200 },
    { w: 6, l: 5, count: 1, area: 200 },
    { w: 10, l: 8, count: 2, area: 200 },
    { w: 10, l: 8, count: 6, area: 25 },
  ];
  for (const ask of asks) {
    const room = P.freshRoom("T", ask.w, ask.l, 2.6);
    P.centerRoom(room);
    const r = P.autoLayoutRooms(room, { count: ask.count, area: ask.area, seed: 1 });
    check(`${ask.count} rooms of ${ask.area} m² in ${ask.w}×${ask.l} still lays out`,
      !!r && r.rooms.length > 0, "got nothing");
    if (!r) continue;
    // It should hand back the largest rooms the space allows, not the ask.
    check(`${ask.count}×${ask.area} m² is capped at what the floor can give`,
      r.targetArea <= ask.w * ask.l, `target ${r.targetArea} in ${ask.w * ask.l} m²`);
    for (const rm of r.rooms) {
      check("no room from an oversized ask escapes the floor plate",
        rm.x >= P.roomOrigin(room).x - 1e-6 && rm.z >= P.roomOrigin(room).z - 1e-6
        && rm.x + rm.w <= P.roomOrigin(room).x + ask.w + 1e-6
        && rm.z + rm.l <= P.roomOrigin(room).z + ask.l + 1e-6);
    }
  }

  // The same ask on an empty room and on one with a big open region already
  // enclosed by the shell must not disagree about whether there is room.
  const plain = P.freshRoom("T", 6, 5, 2.6);
  P.centerRoom(plain);
  const withArea = P.autoLayoutRooms(plain, { count: 2, area: 200, seed: 1 });
  const withoutArea = P.autoLayoutRooms(plain, { count: 2, seed: 1 });
  check("an impossible area lands on the same target as giving no area at all",
    !!withArea && !!withoutArea && withArea.targetArea === withoutArea.targetArea,
    `${withArea && withArea.targetArea} vs ${withoutArea && withoutArea.targetArea}`);
}

// Free space cut up by scattered obstacles must still be usable. The old
// engine subtracted each obstacle from the last result in turn, which sliced
// the floor into slivers that were artefacts of the subtraction order — on the
// saved template it turned 80 m² into nineteen pieces, none wider than 145 cm,
// and concluded there was nowhere to put a room. The partition works on a grid
// instead, so scattered obstacles cost nothing.
{
  const room = P.freshRoom("Scattered", 10, 10, 2.6);
  room.origin = { x: 0, z: 0 };
  room.canvas = { width: 25, length: 25 };
  room.publicAreas = [
    { id: "spine", x: 0, z: 0, w: 1, l: 10 },     // a spine down one side
    { id: "stub1", x: 4, z: 8, w: 1, l: 2 },      // and two short stubs
    { id: "stub2", x: 7, z: 8, w: 1, l: 2 },
  ];
  P.sanitize(room);
  const r = P.autoLayoutRooms(room, { count: 4, area: 14, seed: 1 });
  check("scattered obstacles do not defeat the partition", !!r && r.rooms.length >= 3,
    r ? `${r.rooms.length} rooms` : "got nothing");
  check("and the rooms are a usable size",
    r.rooms.every(x => x.area >= 2), r.rooms.map(x => x.area.toFixed(1)).join(", "));
  // Not one square metre of a room may sit on floor the user marked.
  const onWalk = r.rooms.flatMap(x => x.rects)
    .filter(rc => room.publicAreas.some(a => rectsOverlap(rc, a)));
  check("no room is laid on top of marked floor", onWalk.length === 0, `${onWalk.length}`);
}

// ── The two things the old engine got wrong ───────────────────────────────
//
// It carved a corridor for every band it filled, even on a plan that already
// had walkways drawn on it — 17 m² of circulation came back as 25 m², and the
// rooms lost the difference. And a guillotine cut across a band can only make
// rectangles, so rooms could not follow an L-shaped pocket or wrap around a
// stairwell; those corners were simply left empty.
{
  // A plan with generous circulation already drawn, and an obstacle to shape
  // rooms around.
  const room = P.freshRoom("Given", 12, 12, 2.6);
  room.origin = { x: 0, z: 0 };
  room.canvas = { width: 25, length: 25 };
  room.publicAreas = [
    { id: "spine", x: 5, z: 0, w: 1.2, l: 12 },
    { id: "arm", x: 0, z: 5, w: 12, l: 1.2 },
  ];
  P.sanitize(room);
  const drawn = room.publicAreas.reduce((s, a) => s + a.w * a.l, 0);

  const r = P.autoLayoutRooms(room, { count: 4, area: 16, windows: true, seed: 2 });
  check("a plan with its own circulation still lays out", !!r);

  // 1. Nothing is carved. What comes back as circulation is exactly the floor
  //    left over once every room has its area — never a path cut to reach
  //    somewhere, which is what used to eat into the rooms.
  const added = r.corridors.reduce((s, c) => s + c.w * c.l, 0);
  const roomArea = r.rooms.reduce((s, x) => s + x.area, 0);
  const freeFloor = 12 * 12 - drawn;
  // The tolerance is for grid quantisation: a walkway drawn a couple of
  // centimetres off the wall's centre line is snapped flush to it, so the free
  // floor measured here and the floor the partition sees differ slightly.
  check("what is added is only the floor left over, never a carved path",
    added <= freeFloor - roomArea + freeFloor * 0.05,
    `${added.toFixed(1)} added, ${(freeFloor - roomArea).toFixed(1)} genuinely spare`);
  check("nothing is invented and nothing vanishes",
    Math.abs(added + roomArea - freeFloor) < freeFloor * 0.08,
    `rooms ${roomArea.toFixed(1)} + spare ${added.toFixed(1)} vs ${freeFloor.toFixed(1)} free`);

  // And when the rooms asked for would use nearly all the floor, almost nothing
  // is left over — the old engine still carved corridors in that case.
  const packed = P.autoLayoutRooms(room, { count: 6, area: 18, windows: false, seed: 2 });
  const packedSpare = packed.corridors.reduce((s, c) => s + c.w * c.l, 0);
  check("a plan asked to fill itself is not given corridors anyway",
    packedSpare < freeFloor * 0.25,
    `${packedSpare.toFixed(1)} m² spare out of ${freeFloor.toFixed(1)}`);
  check("no room is built on the circulation",
    r.rooms.flatMap(x => x.rects)
      .every(rc => !room.publicAreas.some(a => rectsOverlap(rc, a))));

  // 2. Rooms reach the area asked for, rather than losing it to corridor.
  check("rooms get close to the area asked for",
    r.rooms.every(x => x.area > 16 * 0.6), r.rooms.map(x => x.area.toFixed(1)).join(", "));

  // 3. Rooms are described as real shapes, not only bounding boxes.
  check("each room reports the rectangles it is made of",
    r.rooms.every(x => Array.isArray(x.rects) && x.rects.length >= 1));
  check("a room's area is its own, not its bounding box",
    r.rooms.every(x => {
      const fromRects = x.rects.reduce((s, rc) => s + rc.w * rc.l, 0);
      return Math.abs(fromRects - x.area) < 0.05;
    }));

  // 4. Every room can be entered.
  const applied = P.parseRoom(JSON.stringify({
    format: "com.maria.roomcad-v2.room", version: 1,
    room: {
      ...room, walls: r.walls, doors: r.doors, windows: r.windows,
      publicAreas: room.publicAreas.concat(r.corridors.map(c => ({ id: P.uid(), ...c, generated: true }))),
    },
  }));
  const regions = P.detectRooms(applied);
  const doorless = regions.filter(x => !x.hasDoor && x.area > 2);
  check("every enclosed area over 2 m² has a way in",
    doorless.length === 0, `${doorless.length} without a door`);
  check("the plan has no doubled walls", P.overlappingWallAreas(applied).length === 0);

  // 5. Walls are whole. A boundary skipped for being short is a hole, and a
  //    hole merges two rooms into one.
  check("no wall is too short to survive a reload",
    r.walls.every(w => P.wallLength(w) >= 0.15));
  check("the rooms laid out match the regions detected",
    regions.length >= r.rooms.length, `${regions.length} regions vs ${r.rooms.length} rooms`);
}

// An L-shaped floor must produce rooms that follow it rather than leaving the
// arm empty.
{
  const room = P.freshRoom("LFloor", 12, 12, 2.6);
  room.origin = { x: 0, z: 0 };
  room.canvas = { width: 25, length: 25 };
  // Block a quadrant, leaving an L of free floor.
  room.publicAreas = [{ id: "block", x: 6, z: 6, w: 6, l: 6 }];
  P.sanitize(room);
  const r = P.autoLayoutRooms(room, { count: 3, area: 30, seed: 1 });
  check("an L-shaped floor lays out", !!r && r.rooms.length >= 2, r ? `${r.rooms.length}` : "nothing");
  const covered = r.rooms.reduce((s, x) => s + x.area, 0);
  check("the arms of the L are actually used",
    covered > 60, `${covered.toFixed(1)} m² of the 108 m² available`);
  check("nothing was laid on the blocked quadrant",
    r.rooms.flatMap(x => x.rects)
      .every(rc => !rectsOverlap(rc, room.publicAreas[0])));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
