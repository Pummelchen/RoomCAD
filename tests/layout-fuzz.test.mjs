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
// Spaces you cannot walk to from the rest of the plan at all.
let cutOff = 0;
let spacesChecked = 0;
// Of the rooms on plans where the user marked some floor: does the door lead to
// THAT floor, or to floor that merely ended up spare?
let ontoUserFloor = 0;
let ontoOtherFloor = 0;

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
        // As the app applies it: the generator marks no public floor, so the
        // plan carries the user's areas and nothing else.
        publicAreas: room.publicAreas,
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
    const inRegion = pt => regions.findIndex(r =>
      r.rects.some(c => pt.x > c.x && pt.x < c.x + c.w && pt.z > c.z && pt.z < c.z + c.l));

    // Which detected spaces are the rooms the generator laid out, and which are
    // the floor between them.
    //
    // Worked out from the ROOMS rather than from public marking. The generator
    // no longer marks its hallways as public floor — that is the user's to
    // mark — so "is this space circulation" cannot be answered by looking for
    // grey any more. Each generated room is matched to the space containing a
    // point known to be inside it; every other space is floor between rooms.
    // And which of those spaces is the floor the user actually marked, as
    // opposed to floor that merely ended up between the rooms. The door of a
    // room should lead to the first kind.
    const userFloor = regions.map(reg => {
      let total = 0, marked = 0;
      for (const c of reg.rects) {
        const a = c.w * c.l;
        total += a;
        const cx = c.x + c.w / 2, cz = c.z + c.l / 2;
        if ((room.publicAreas || []).some(pa => cx > pa.x - 0.02 && cx < pa.x + pa.w + 0.02
          && cz > pa.z - 0.02 && cz < pa.z + pa.l + 0.02)) marked += a;
      }
      return total > 0 && marked / total > 0.5;
    });
    const isCirculation = regions.map(() => true);
    for (const room of result.rooms) {
      const biggest = room.rects.reduce((a, b) => (a.w * a.l >= b.w * b.l ? a : b));
      const at = inRegion({ x: biggest.x + biggest.w / 2, z: biggest.z + biggest.l / 2 });
      if (at >= 0) isCirculation[at] = false;
    }
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
      // The order matters, and it is the order of the question being asked:
      // can you get in from the walking space? If not, is the only way in
      // through somebody else's room? A door to the street is counted last —
      // a room can have one AND be entered through a neighbour, and scoring
      // the street door first hid exactly that.
      if (doors === 0) sealed++;
      else if ([...joins[i]].some(j => isCirculation[j])) {
        reachable++;
        if ([...joins[i]].some(j => userFloor[j])) ontoUserFloor++;
        else if ((room.publicAreas || []).length) ontoOtherFloor++;
      }
      else if (joins[i].size > 0) throughAnotherRoom++;
      else if (toOutside.has(i)) outsideOnly++;
    }

    // Can you walk from any space to any other? Doors are the only way between
    // spaces, so this is the plan's own connectivity — and it catches what
    // counting doors per room cannot: a piece of hallway closed off from the
    // rest of the hallway is a void whether or not it is called circulation.
    {
      const seen = new Array(regions.length).fill(false);
      const stack = [];
      // Start from the biggest space; in a plan that hangs together everything
      // else is reachable from it.
      let biggest = 0;
      for (let i = 1; i < regions.length; i++) {
        if (regions[i].area > regions[biggest].area) biggest = i;
      }
      if (regions.length) { seen[biggest] = true; stack.push(biggest); }
      while (stack.length) {
        const at = stack.pop();
        for (const j of joins[at]) if (!seen[j]) { seen[j] = true; stack.push(j); }
      }
      for (let i = 0; i < regions.length; i++) {
        if (regions[i].area < 1) continue;         // slivers between doubled walls
        spacesChecked++;
        if (!seen[i]) cutOff++;
      }
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
  // These plans get RANDOM rectangles as their walking space — three scattered
  // patches, a corner, a strip halfway across nothing — and a quarter of them
  // get none at all. Nobody draws circulation like that. The planner will not
  // invent more to make up for it, because that floor is the user's to mark, so
  // on input like this a fair number of rooms end up entered from the room next
  // door. That is the honest outcome and it stays visible here; the rule proper
  // is checked on plans with a hall actually drawn through them, below, where
  // it holds for every room without exception.
  //
  // These two bounds are here to catch a collapse, not to certify the layout.
  check("most rooms are still reached from the walking space",
    reachable >= spaces * 0.6, share(reachable));
  check("and being let in through the room next door stays the exception",
    throughAnotherRoom <= spaces * 0.4, share(throughAnotherRoom));
  // Not zero, and the reason is worth knowing. The two plans that still do it
  // are ones where walls the USER drew subdivide a generated room: the grid the
  // partition works on blocks a cell edge only when a wall covers the whole of
  // it, so a stub that stops part-way through a cell is a barrier to the plan
  // but not to the model, and the space it closes off is invisible until the
  // walls are built. Six spaces across 660 plans.
  check("a room with no door at all is rare",
    sealed <= spaces * 0.005, share(sealed));
  // A door onto the street is a front door. Some plans have nowhere else for
  // it to go — a plate too shallow to take a hallway at all — but it should
  // never be how you get into an ordinary room.
  // The bound is close to the measured value on purpose. The corpus is fixed,
  // so this number does not wander on its own — and the thing it guards is
  // easy to lose by accident: accepting a single cell of contact with the
  // hallway as "has a way in" rather than a door's width of it puts the number
  // straight back up to 1.7%, and the rooms that changed are ones whose door
  // moved into the outside wall.
  check("and so is one you can only enter from the street",
    outsideOnly <= spaces * 0.02, share(outsideOnly));
  // Doors are the only way between spaces, so this is the plan's own
  // connectivity — and it catches what counting doors per room cannot: a room
  // and the pocket of hallway it opens onto, closed off from the rest by the
  // rooms in between. Every room on such an island has a door, and every door
  // leads somewhere, and you still cannot get there.
  //
  // Was 536 of 3417 before the plan was checked for this at all.
  // Where the user has marked floor, that is what the rooms should open onto.
  // Both kinds are walkable, so nothing above can tell them apart — and while
  // they were in one bucket, the door took whichever run happened to be the
  // longer, which was the outside wall or a leftover corner more often than it
  // was the hall. It was 16% of rooms; it is now half, on plans whose marked
  // floor is scattered rectangles that cannot serve them all.
  {
    const both = ontoUserFloor + ontoOtherFloor;
    check("where the user marked floor, that is what the doors open onto",
      ontoUserFloor >= both * 0.45,
      `${ontoUserFloor} of ${both} (${(ontoUserFloor / both * 100).toFixed(1)}%)`);
    // The bound is loose on purpose, and the reason is worth writing down:
    // once the rooms filled the floor there was very little leftover floor for
    // the user's to compete with, so taking the priority away only moves this
    // from 69% to 65%. A bound tight enough to catch that would fail on any
    // unrelated change. The ordering itself is checked in plan.js, where it is
    // exact — see "doors are offered the user's floor first" below.
    const planSource = readFileSync(join(here, "..", "roomcad", "web", "plan.js"), "utf8");
    check("doors are offered the user's floor first",
      /fitDoor\(longestFirst\(access\[k\]\.walkway\)\)\s*\n\s*\|\| fitDoor\(longestFirst\(access\[k\]\.circulation\)\)\s*\n\s*\|\| fitDoor\(longestFirst\(access\[k\]\.outside\)\)/
        .test(planSource));
  }

  check("every space over a square metre connects to the rest of the plan",
    cutOff <= spacesChecked * 0.01, `${cutOff} of ${spacesChecked} cut off`);
  console.log(`    ways in: ${share(reachable)} onto circulation, `
    + `${outsideOnly} from outside, ${throughAnotherRoom} through a room, ${sealed} sealed`
    + ` · ${cutOff} of ${spacesChecked} spaces cut off from the rest`);
}

// ── Plans drawn the way the app asks for them ────────────────────────────
//
// "The green public space is where people walk and doors swing into. So the
// auto layout planner does not create public space — it is the area it needs
// to build the rooms around."
//
// That is the workflow: mark the hall, then generate. The sweep above feeds the
// planner random rectangles to see what it does with nonsense; this one feeds
// it what a person actually draws — a hall across the plate, down it, or along
// one side — and here the rule is absolute.
{
  let rooms = 0, ontoWalkway = 0, throughRoom = 0, street = 0, shut = 0;
  let floorTotal = 0, corridorTotal = 0;
  for (const [W, L] of [[10, 8], [12, 9], [8, 6], [14, 10], [16, 11], [9, 7], [11, 12], [18, 8]]) {
    for (const count of [2, 3, 4, 5, 6, 8]) {
      for (const hall of [
        { x: 0, z: L / 2 - 0.7, w: W, l: 1.4 },      // across the middle
        { x: W / 2 - 0.7, z: 0, w: 1.4, l: L },      // down the middle
        { x: 0, z: 0, w: W, l: 1.3 },                // along one side
      ]) {
        const room = P.freshRoom("Flat", W, L, 2.6);
        room.origin = { x: 0, z: 0 };
        room.canvas = { width: 30, length: 30 };
        room.publicAreas = [{ id: "hall", ...hall }];
        P.sanitize(room);
        const result = P.autoLayoutRooms(room, { count, area: 12, windows: false, seed: 3 });
        if (!result) continue;
        floorTotal += W * L;
        corridorTotal += result.corridors.reduce((sum, c) => sum + c.w * c.l, 0);

        const applied = P.parseRoom(JSON.stringify({
          format: "com.maria.roomcad-v2.room", version: 1,
          room: { ...room, walls: result.walls, doors: result.doors,
                  windows: result.windows, publicAreas: room.publicAreas },
        }));
        const regions = P.detectRooms(applied);
        const inRegion = pt => regions.findIndex(r =>
          r.rects.some(c => pt.x > c.x && pt.x < c.x + c.w && pt.z > c.z && pt.z < c.z + c.l));
        const isRoom = new Array(regions.length).fill(false);
        for (const rm of result.rooms) {
          const big = rm.rects.reduce((a, b) => (a.w * a.l >= b.w * b.l ? a : b));
          const at = inRegion({ x: big.x + big.w / 2, z: big.z + big.l / 2 });
          if (at >= 0) isRoom[at] = true;
        }
        const joins = regions.map(() => new Set());
        const toOut = new Set();
        for (const d of applied.doors || []) {
          const wall = (applied.walls || []).find(w => w.id === d.wallID);
          if (!wall) continue;
          const n = P.wallPerp(wall);
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
          else if (a >= 0) toOut.add(a);
          else if (b >= 0) toOut.add(b);
        }
        for (let i = 0; i < regions.length; i++) {
          if (!isRoom[i]) continue;
          rooms++;
          if (joins[i].size === 0 && !toOut.has(i)) shut++;
          else if ([...joins[i]].some(j => !isRoom[j])) ontoWalkway++;
          else if (joins[i].size > 0) throughRoom++;
          else street++;
        }
      }
    }
  }
  check("the sweep laid out a good number of plans", rooms > 400, `${rooms} rooms`);
  // Asking for less than the floor holds must not leave the difference lying
  // about as walkable floor: that is the planner making its own public space
  // by another name. Three small rooms asked for in a hundred and seventy
  // square metres used to leave nine tenths of it as corridor.
  {
    const big = P.freshRoom("Loft", 16, 11, 2.6);
    big.origin = { x: 0, z: 0 };
    big.canvas = { width: 30, length: 30 };
    big.publicAreas = [{ id: "hall", x: 0, z: 5.15, w: 16, l: 1.4 }];
    P.sanitize(big);
    const free = 16 * 11 - 16 * 1.4;
    const laid = P.autoLayoutRooms(big, { count: 3, area: 6, windows: false, seed: 2 });
    check("a small ask on a big floor still lays out", !!laid);
    if (laid) {
      const left = laid.corridors.reduce((sum, c) => sum + c.w * c.l, 0);
      const inRooms = laid.rooms.reduce((sum, r) => sum + r.area, 0);
      check("and the rooms fill it rather than leaving corridor",
        left <= free * 0.05,
        `${left.toFixed(0)} m² left of ${free.toFixed(0)} free`);
      check("with the floor accounted for by the rooms",
        inRooms >= free * 0.9, `${inRooms.toFixed(0)} m² in rooms of ${free.toFixed(0)}`);
    }
  }
  check("every room opens onto the walking space", ontoWalkway === rooms,
    `${ontoWalkway} of ${rooms}`);
  check("none is reached through another room", throughRoom === 0, `${throughRoom}`);
  check("none opens only onto the street", street === 0, `${street}`);
  check("none is shut in", shut === 0, `${shut}`);
  // The rooms fill what the hall leaves them, so there is no second walkway
  // the planner made up for itself.
  check("the planner leaves next to no floor of its own",
    corridorTotal <= floorTotal * 0.02,
    `${(corridorTotal / floorTotal * 100).toFixed(1)}% of the floor`);
  console.log(`    with a hall drawn: ${ontoWalkway} of ${rooms} rooms open onto it, `
    + `${(corridorTotal / floorTotal * 100).toFixed(1)}% floor left over`);
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
