// Behavioural stress test for the 3D neighbourhood.
//
// city.js had contract tests that read the source and checked it still said
// what it used to say. That catches a deleted line; it does not catch geometry
// that comes out wrong. This builds the real City — the vendored Three.js
// imports fine outside a browser, so the actual meshes and instance matrices
// are produced here — over many random buildings, and checks what must hold of
// the result:
//
//   - nothing is NaN, so nothing silently vanishes from the scene;
//   - the neighbourhood keeps clear of the building it surrounds, which is what
//     the floor-flicker fix was about;
//   - rebuilding does not leak, and a rebuild is skipped when nothing changed;
//   - every hour of the day, and every frame length, leaves the cars finite and
//     on the map.
//
// Run:  node tests/city-fuzz.test.mjs

import { loadWebModule } from "./harness/load-web-module.mjs";
import { vehiclesOverlap } from "./harness/overlap.mjs";
import { coplanarClashes, coplanarInGeometry } from "./harness/coplanar.mjs";
import { readFileSync } from "node:fs";

// The same Three.js the city itself builds with, so a matrix composed here is
// composed the way the renderer will compose it.
const THREE = await import(new URL("../roomcad/web/lib/three.webgpu.js", import.meta.url).href);

const {
  City, BLOCK_SIZE, ROAD_WIDTH, SIDEWALK, KERB_HEIGHT, GRID_RADIUS,
  ROOM_SLAB_THICKNESS, WEATHER_KINDS, NEAR_SIDE_TURN, CROSSING_TURN, seedFromString,
  PARK_OFFSET, BAY_PITCH, PARK_CLEAR, PARK_SHARE, PARK_MIN, PARK_MAX,
  REVERSE_ANGLE, REVERSE_RUN,
  UNLOAD_MIN, UNLOAD_MAX, BUS_DWELL_MIN, BUS_DWELL_MAX, BUS_STOPS_PER_BLOCK,
  BUS_STOP_OFFSET, RESERVE_TTL,
} = await loadWebModule("city.js");

// Derived rather than exported: the carriageway sits one kerb below the
// pavement, and the pavement is the room's own floor datum.
const ROAD_Y = -KERB_HEIGHT;
const WIN_W = 1.25;   // one window opening, as city.js lays them out

let passed = 0;
let failed = 0;
function check(name, condition, detail = "") {
  if (condition) { passed++; return; }
  failed++;
  console.error("FAIL: " + name + (detail ? " — " + detail : ""));
}

const violations = new Map();
const note = (what, detail) => {
  if (!violations.has(what)) violations.set(what, { count: 0, first: detail });
  violations.get(what).count++;
};

/// The world-space box each piece of geometry occupies. Centres alone are not
/// enough: a pavement slab whose centre sits outside the building can still
/// have half of itself inside it, which is exactly the overlap that made the
/// floor flicker. So each placement carries the real extent, obtained by
/// pushing the geometry's own bounding box through the instance matrix.
function placements(group) {
  const out = [];
  /// Axis-aligned world extent of `box` after transform `e` (column-major).
  const extentOf = (box, e, o) => {
    if (!box) return null;
    let lo = [Infinity, Infinity, Infinity];
    let hi = [-Infinity, -Infinity, -Infinity];
    for (let c = 0; c < 8; c++) {
      const lx = c & 1 ? box.max.x : box.min.x;
      const ly = c & 2 ? box.max.y : box.min.y;
      const lz = c & 4 ? box.max.z : box.min.z;
      const w = [
        e[o + 0] * lx + e[o + 4] * ly + e[o + 8] * lz + e[o + 12],
        e[o + 1] * lx + e[o + 5] * ly + e[o + 9] * lz + e[o + 13],
        e[o + 2] * lx + e[o + 6] * ly + e[o + 10] * lz + e[o + 14],
      ];
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], w[k]); hi[k] = Math.max(hi[k], w[k]); }
    }
    return { lo, hi };
  };
  group.traverse(node => {
    if (!node.isMesh) return;
    if (node.geometry && !node.geometry.boundingBox) node.geometry.computeBoundingBox();
    const local = node.geometry ? node.geometry.boundingBox : null;
    if (node.isInstancedMesh) {
      for (let i = 0; i < node.count; i++) {
        const e = node.instanceMatrix.array;
        const o = i * 16;
        // The scale of an instance is the length of each basis column, not
        // the matrix diagonal: a car turned to face along Z, or a wheel
        // cylinder laid on its side, has a near-zero diagonal and a perfectly
        // good size in the off-diagonal terms.
        out.push({
          x: e[o + 12], y: e[o + 13], z: e[o + 14],
          sx: Math.hypot(e[o + 0], e[o + 1], e[o + 2]),
          sy: Math.hypot(e[o + 4], e[o + 5], e[o + 6]),
          sz: Math.hypot(e[o + 8], e[o + 9], e[o + 10]),
          box: extentOf(local, e, o),
          mesh: node.name || node.type,
        });
      }
    } else {
      node.updateMatrixWorld(true);
      out.push({
        x: node.position.x, y: node.position.y, z: node.position.z,
        sx: node.scale.x, sy: node.scale.y, sz: node.scale.z,
        box: extentOf(local, node.matrixWorld.elements, 0),
        mesh: node.name || node.type,
      });
    }
  });
  return out;
}

const finite = v => Number.isFinite(v);

/// The bounds object walk3d actually hands the city, built the same way its
/// buildingBounds() does. The plot the city keeps clear is derived from the
/// min/max corners, not from width/length — a bounds object missing them puts
/// NaN into the pavement, so the test has to build a real one.
function boundsFor(centerX, centerZ, width, length, maxY = 3) {
  const minX = centerX - width / 2;
  const maxX = centerX + width / 2;
  const minZ = centerZ - length / 2;
  const maxZ = centerZ + length / 2;
  return {
    minX, maxX, minZ, maxZ,
    width: Math.max(0.1, maxX - minX),
    length: Math.max(0.1, maxZ - minZ),
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    minY: 0, maxY,
  };
}

// ── The neighbourhood, built over many random buildings ───────────────────
let seed = 20260823;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

let built = 0;
let maxReach = 0;
let totalInstances = 0;

for (let trial = 0; trial < 120; trial++) {
  const width = 2 + rnd() * 18;
  const length = 2 + rnd() * 18;
  const centerX = (rnd() - 0.5) * 40;
  const centerZ = (rnd() - 0.5) * 40;
  const floorLift = rnd() < 0.3 ? rnd() * 12 : 0;
  const bounds = boundsFor(centerX, centerZ, width, length, 2.2 + rnd() * 3);
  const city = new City();
  try {
    city.build(bounds, seedFromString("plan-" + trial), floorLift);
  } catch (err) {
    note("build threw", `${width.toFixed(1)}×${length.toFixed(1)}: ${err.message}`);
    continue;
  }
  built++;

  const spots = placements(city.group);
  totalInstances += spots.length;
  if (spots.length === 0) note("a city with no geometry at all", "");

  // The neighbourhood spans a fixed number of blocks; nothing should be flung
  // far outside it.
  const reach = (GRID_RADIUS + 1) * (BLOCK_SIZE + ROAD_WIDTH) + 60;
  for (const s of spots) {
    if (!finite(s.x) || !finite(s.y) || !finite(s.z)) { note("a non-finite position", s.mesh); continue; }
    if (!finite(s.sx) || !finite(s.sy) || !finite(s.sz)) { note("a non-finite scale", s.mesh); continue; }
    if (Math.abs(s.sx) < 1e-9 || Math.abs(s.sy) < 1e-9 || Math.abs(s.sz) < 1e-9) {
      note("a zero-scaled copy, which renders as nothing", s.mesh);
    }
    const away = Math.max(Math.abs(s.x - centerX), Math.abs(s.z - centerZ));
    maxReach = Math.max(maxReach, away);
    if (away > reach) note("geometry far outside the neighbourhood", `${away.toFixed(0)} m from the building`);
    if (s.y < -50 || s.y > 400) note("geometry at an impossible height", `y ${s.y.toFixed(1)}`);
  }

  // Time of day must stay well behaved at both ends and everywhere between.
  for (const amount of [0, 0.01, 0.25, 0.5, 0.75, 0.99, 1]) {
    try { city.applyTimeOfDay(amount); }
    catch (err) { note("applyTimeOfDay threw", `${amount}: ${err.message}`); }
  }
  for (const mesh of [city.litWindows, city.lampHeads, city.headlights]) {
    if (mesh && !finite(mesh.material.emissiveIntensity)) note("a non-finite emissive strength", "");
  }

  // Frame lengths walk3d can actually produce — it feeds the city
  // Math.min(clock.getDelta(), 0.05), so dt is finite, non-negative and
  // capped — plus larger and negative ones as headroom in case that clamp
  // is ever relaxed. NaN is not in the sweep because nothing can deliver it;
  // that the clamp exists at all is checked separately below.
  for (const dt of [0, 1 / 120, 1 / 60, 0.05, 0.1, 1, 5, -1, NaN]) {
    try { city.update(dt, { x: centerX, y: 1.6, z: centerZ }); }
    catch (err) { note("update threw", `dt ${dt}: ${err.message}`); }
  }
  // A vehicle has a world position and a heading, and belongs to a lane. While
  // it is not part-way round a turn it must be exactly on that lane, pointing
  // along it, at a speed it is actually capable of.
  for (const car of city.cars) {
    if (!finite(car.x) || !finite(car.z) || !finite(car.heading)) {
      note("a car at a non-finite position", car.kind);
      continue;
    }
    if (!finite(car.speed) || car.speed < -1e-9) note("a car in reverse", String(car.speed));
    if (car.speed > car.cruise + 0.01) note("a car above its own top speed", `${car.speed} > ${car.cruise}`);
    if (Math.abs(car.x - centerX) > reach * 2 || Math.abs(car.z - centerZ) > reach * 2) {
      note("a car driven off the map", `${car.x.toFixed(0)},${car.z.toFixed(0)}`);
    }
    if (car.dir !== 1 && car.dir !== -1) note("a car with no direction", String(car.dir));
    if (!car.arc) {
      const cross = car.axis === "x" ? car.z : car.x;
      // Its lane centreline, plus however far it has pulled towards the kerb to
      // park or to call at a stop. Still exact: the offset is a value the model
      // holds, so a vehicle that is anywhere else is drifting.
      const want = car.fixed + Math.sign(City.laneOffset(car.axis, car.dir)) * (car.kerbOffset || 0);
      if (Math.abs(cross - want) > 1e-6) {
        note("a car that has drifted out of its lane", (cross - want).toExponential(1));
      }
      if (car.lane.axis !== car.axis || car.lane.dir !== car.dir) {
        note("a car whose lane disagrees with where it is pointing", car.kind);
      }
    }
  }

  // Rebuilding the same thing must be recognised as unnecessary.
  if (!city.matches(bounds, seedFromString("plan-" + trial), floorLift)) {
    note("a city does not recognise its own inputs", "");
  }
  if (city.matches(bounds, seedFromString("plan-" + trial) + 1, floorLift)) {
    note("a city claims to match a different seed", "");
  }
  city.dispose();
}

check("the neighbourhood builds for every building tried", built === 120, `${built} of 120`);
check("it produces geometry", totalInstances > 120 * 100, `${totalInstances} copies over ${built} builds`);
check("nothing lands far outside the neighbourhood",
  maxReach < (GRID_RADIUS + 1) * (BLOCK_SIZE + ROAD_WIDTH) + 60,
  `furthest ${maxReach.toFixed(0)} m`);

// ── The hole the building sits in ──────────────────────────────────────────
//
// The city is built around the room, and the room's own floor sits at a known
// height. Anything of the city inside that footprint at the same height is what
// made the floor flicker.
{
  // Measured over several plans, because one plan happens to sit where the
  // block grid has nothing to intrude with.
  let worst = 0;
  let worstMesh = "";
  let intruders = 0;
  for (const [w, l, cx, cz] of [[8, 6, 0, 0], [12, 9, 3, -2], [5, 5, -7, 4], [18, 4, 0, 11], [3, 14, -5, -9]]) {
    const bounds = boundsFor(cx, cz, w, l);
    const city = new City();
    city.build(bounds, 4242, 0);
    // The footprint, less a hair at the edge: the pavement is meant to meet
    // the wall line, so touching it is right and only real overlap is wrong.
    const fx0 = bounds.minX + 0.05, fx1 = bounds.maxX - 0.05;
    const fz0 = bounds.minZ + 0.05, fz1 = bounds.maxZ - 0.05;
    for (const s of placements(city.group)) {
      if (!s.box) continue;
      // The terrain is a single mesh spanning the whole world, so its bounding
      // box says nothing useful about the footprint — its hills are hundreds
      // of metres away. It gets its own check below, against real vertices.
      if (s.mesh === "city-terrain") continue;
      // Only geometry at floor level can fight with the room's own floor;
      // a roof passing overhead is not an intrusion.
      if (s.box.hi[1] < -ROOM_SLAB_THICKNESS - 0.01 || s.box.lo[1] > bounds.maxY) continue;
      const ox = Math.min(s.box.hi[0], fx1) - Math.max(s.box.lo[0], fx0);
      const oz = Math.min(s.box.hi[2], fz1) - Math.max(s.box.lo[2], fz0);
      if (ox > 1e-6 && oz > 1e-6) {
        intruders++;
        if (ox * oz > worst) { worst = ox * oz; worstMesh = s.mesh || "(unnamed)"; }
      }
    }
    city.dispose();
  }
  check("the neighbourhood keeps clear of the building's own footprint",
    intruders === 0,
    `${intruders} pieces intrude, worst ${worst.toFixed(3)} m² (${worstMesh})`);
}

// ── Nothing shares a depth with anything else ─────────────────────────────
//
// Two surfaces at exactly the same depth, both drawn, and the depth buffer has
// no basis to pick between them: the winner changes per pixel and per frame,
// and the result flickers. A screenshot will not show it and no invariant
// about positions or sizes will either — which is how the building interiors
// shipped with every window flickering. The solid middle of each building sat
// on precisely the plane of the backs of its rooms.
//
// Checked over a range of building sizes, because the layout is derived from
// them and a clash can exist at one size and not another.
{
  // Every mesh, not a chosen few: the pavement slab turned out to share a
  // plane with the floor of every ground-floor lobby, and that was only found
  // once the check stopped looking at buildings alone.
  const inspected = [
    "city-facades", "city-rooms-dark", "city-rooms-lit", "city-roofs",
    "city-ground-details", "city-windows-dark", "city-windows-lit", "city-bulbs",
    "city-lamp-poles", "city-lamp-heads",
    "city-signal-poles", "city-signal-housings", "city-signal-lenses",
  ];
  let worst = null;
  let total = 0;
  for (const [w, l, seed] of [[9, 7, 2718], [4, 4, 11], [22, 6, 99], [14, 14, 4242], [6, 19, 555]]) {
    const city = new City();
    city.build(boundsFor(0, 0, w, l), seed, 0);
    const clashes = coplanarClashes(city.group, { meshNames: inspected });
    total += clashes.length;
    for (const c of clashes) {
      if (!worst || c.area > worst.area) worst = c;
    }
    city.dispose();
  }
  check("no two surfaces in the city share a depth and both get drawn",
    total === 0,
    worst ? `${total} clashes, worst ${worst.area.toFixed(2)} m² on ${worst.axis} between ${worst.between}` : "");
}

// ── The land under the city ───────────────────────────────────────────────
//
// Terrain is the one thing that could put ground THROUGH the room: a hill
// wandering into the street grid would come up under the floor. So the flat
// region is checked vertex by vertex rather than taken on trust, and the hills
// are checked to actually exist — a "terrain" that came out perfectly flat
// would pass every other test in this file.
{
  const bounds = boundsFor(0, 0, 9, 7);
  const city = new City();
  city.build(bounds, 3141, 0);
  const land = city.group.children.find(n => n.name === "city-terrain");
  check("the city builds terrain", !!land);
  if (land) {
    const pos = land.geometry.attributes.position;
    // The city's own outer extent, worked out the way city.js does: the
    // outermost road centre plus half a carriageway. Sampling beyond this is
    // sampling the countryside, which is supposed to have bumps in it.
    const span = BLOCK_SIZE + ROAD_WIDTH;
    const reach = GRID_RADIUS * span + BLOCK_SIZE / 2 + ROAD_WIDTH;
    let bumpsInTown = 0;
    let worstBump = 0;
    let highest = 0;
    let lowest = Infinity;
    let nonFinite = 0;
    let coloured = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      if (!finite(x) || !finite(y) || !finite(z)) { nonFinite++; continue; }
      highest = Math.max(highest, y);
      lowest = Math.min(lowest, y);
      // Anywhere a street could be, the ground must be exactly level: the
      // room's own floor sits on this datum.
      if (Math.max(Math.abs(x), Math.abs(z)) <= reach) {
        if (Math.abs(y) > 1e-9) { bumpsInTown++; worstBump = Math.max(worstBump, Math.abs(y)); }
      }
    }
    const colour = land.geometry.attributes.color;
    for (let i = 0; colour && i < colour.count; i++) {
      if (finite(colour.getX(i)) && colour.getX(i) >= 0 && colour.getX(i) <= 1) coloured++;
    }
    check("no terrain vertex is non-finite", nonFinite === 0, `${nonFinite} of ${pos.count}`);
    check("the ground under every street is dead level",
      bumpsInTown === 0, `${bumpsInTown} bumps, worst ${worstBump.toFixed(3)} m`);
    // Never below the street datum either: ground that dips under the
    // pavement opens a gap at the edge of the city. The tolerance is for
    // floating point, not for slack — a real dip is metres, not nanometres.
    check("the land never drops below the level the streets sit on",
      lowest >= -1e-6 && lowest <= 1e-6, `lowest vertex ${lowest}`);
    // High enough to be seen over the city's own rooflines from a window —
    // the whole reason they exist — and not so high they read as a wall.
    check("there are actual hills, not a flat plane called terrain",
      highest > 60, `highest ${highest.toFixed(1)} m`);
    check("the hills are not so tall they read as a wall",
      highest < 150, `highest ${highest.toFixed(1)} m`);
    check("the terrain is coloured per vertex, so it is not one flat green",
      !!colour && coloured === colour.count, `${coloured} of ${colour ? colour.count : 0}`);
    // Two cities from the same seed must be identical, hills included.
    const twin = new City();
    twin.build(bounds, 3141, 0);
    const twinLand = twin.group.children.find(n => n.name === "city-terrain");
    let differs = 0;
    for (let i = 0; i < pos.count; i += 37) {
      if (twinLand.geometry.attributes.position.getY(i) !== pos.getY(i)) differs++;
    }
    check("the same seed gives the same hills", differs === 0, `${differs} vertices differ`);
    twin.dispose();
  }
  city.dispose();
}

// ── Rebuilding does not accumulate ────────────────────────────────────────
{
  const city = new City();
  const bounds = boundsFor(0, 0, 6, 4);
  city.build(bounds, 1, 0);
  const first = city.group.children.length;
  const firstCopies = placements(city.group).length;
  for (let i = 2; i <= 12; i++) {
    city.build(boundsFor(0, 0, 6 + i * 0.1, 4), i, 0);
  }
  const after = city.group.children.length;
  const afterCopies = placements(city.group).length;
  check("rebuilding replaces the neighbourhood rather than stacking another on top",
    after <= first + 2, `${first} meshes became ${after}`);
  check("and the number of copies stays in the same range",
    afterCopies < firstCopies * 3, `${firstCopies} became ${afterCopies}`);
  city.dispose();
  check("disposing empties the group", city.group.children.length === 0,
    `${city.group.children.length} left`);
}

// ── Degenerate buildings must not produce degenerate cities ───────────────
for (const [w, l, label] of [
  [0.5, 0.5, "a building smaller than a room"],
  [0.01, 20, "a building with no width"],
  [40, 40, "a building larger than a city block"],
]) {
  const city = new City();
  let threw = null;
  try { city.build(boundsFor(0, 0, w, l), 7, 0); }
  catch (err) { threw = err.message; }
  check(`${label} does not break the neighbourhood`, threw === null, threw || "");
  if (!threw) {
    const bad = placements(city.group).filter(s => !finite(s.x) || !finite(s.y) || !finite(s.z));
    check(`${label} produces finite geometry`, bad.length === 0, `${bad.length} non-finite`);
  }
  city.dispose();
}

// ── The traffic, driven for a quarter of an hour ──────────────────────────
//
// The point of the model is that everything visible falls out of it: the queue
// at a red light, the brake lights coming on down that queue, the indicator
// before a turn. So it is run properly and checked for the things that would
// give it away — a vehicle sliding sideways out of its lane, two of them
// occupying the same junction from crossing directions, a brake light on a
// vehicle that is accelerating.
{
  const city = new City();
  city.build(boundsFor(0, 0, 9, 7), 2718, 0);
  const viewer = { x: 0, y: 1.6, z: 0 };
  const kinds = new Set();
  let worstConflict = "";
  let movingTotal = 0;
  let movingSamples = 0;
  let distanceDriven = 0;
  let teleports = 0;
  let furthestOut = 0;
  const outermost = Math.max(...city.roadX);
  const startedWith = city.cars.length;
  let brakeMismatch = 0;
  let indicatorMismatch = 0;
  let lampOverflow = 0;
  let turnsCompleted = 0;
  let sawStopped = 0;
  let sawCruising = 0;
  let sawBraking = 0;
  let sawIndicating = 0;
  let overlapping = 0;
  const turning = new Set();
  const seenPairs = new Set();
  const buckets = new Map();
  const parts = () => city.carParts;

  for (const v of city.cars) kinds.add(v.kind);

  const FRAMES = 54000;  // fifteen minutes at 60 fps
  for (let f = 0; f < FRAMES; f++) {
    const was = city.cars.map(v => ({ x: v.x, z: v.z }));
    city.update(1 / 60, viewer);
    for (let i = 0; i < city.cars.length; i++) {
      const v = city.cars[i];
      const step = Math.hypot(v.x - was[i].x, v.z - was[i].z);
      distanceDriven += step;
      // Nothing moves three metres in one frame at these speeds; anything that
      // does was placed rather than driven.
      if (step > 3) teleports++;
      furthestOut = Math.max(furthestOut, Math.abs(v.x) - outermost, Math.abs(v.z) - outermost);
    }

    for (const v of city.cars) {
      if (v.arc) { turning.add(v.id); continue; }
      if (turning.delete(v.id)) turnsCompleted++;
    }
    // Contacts are brief — a vehicle clips another and is past it inside a
    // second — so this runs on almost every frame. Sampling it as rarely as
    // the checks below simply does not see them: at one sample every 90
    // frames, removing the model's ability to see vehicles part-way round a
    // turn went completely unnoticed.
    if (f % 3 === 0) {
      // Bucketed by position rather than compared pair by pair. With this many
      // vehicles the all-pairs scan is thirty thousand comparisons a sample,
      // and it was the slowest thing in the suite by an order of magnitude.
      buckets.clear();
      for (let i = 0; i < city.cars.length; i++) {
        const v = city.cars[i];
        const key = Math.floor(v.x / 20) + "," + Math.floor(v.z / 20);
        let cell = buckets.get(key);
        if (!cell) { cell = []; buckets.set(key, cell); }
        cell.push(i);
      }
      for (const [, cell] of buckets) {
        for (let a = 0; a < cell.length; a++) {
          for (let b = a + 1; b < cell.length; b++) {
            const A = city.cars[cell[a]];
            const B = city.cars[cell[b]];
            const key = cell[a] + ":" + cell[b];
            if (vehiclesOverlap(A, B)) {
              if (!seenPairs.has(key)) {
                seenPairs.add(key);
                overlapping++;
                if (!worstConflict) {
                  worstConflict = `${A.kind}${A.arc ? " mid-turn" : ""} and `
                    + `${B.kind}${B.arc ? " mid-turn" : ""}`;
                }
              }
            } else seenPairs.delete(key);
          }
        }
      }
    }

    if (f % 90 === 0) {
      sawStopped += city.cars.filter(v => v.speed < 0.15).length ? 1 : 0;
      sawCruising += city.cars.filter(v => v.speed > v.cruise * 0.9).length ? 1 : 0;
      sawBraking += city.cars.filter(v => v.braking).length ? 1 : 0;
      sawIndicating += city.cars.filter(v => v.indicate !== 0).length ? 1 : 0;
      movingTotal += city.cars.filter(v => v.speed > 0.3).length;
      movingSamples++;

      // The lamps drawn have to match the model's own state exactly: a brake
      // light that is not tied to braking is decoration, not behaviour.
      const p = parts();
      const braking = city.cars.filter(v => v.braking).length;
      if (p.brake.count !== braking * 2) brakeMismatch++;
      if (p.brake.count > p.brake.instanceMatrix.count) lampOverflow++;
      if (p.head.count > p.head.instanceMatrix.count) lampOverflow++;
      if (p.indicator.count > p.indicator.instanceMatrix.count) lampOverflow++;
      const signalling = city.cars.filter(v => v.indicate !== 0).length;
      if (p.indicator.count !== 0 && p.indicator.count !== signalling * 2) indicatorMismatch++;
    }
  }

  // The street grid is a CLOSED network. A vehicle that keeps driving keeps
  // finding junctions, so it circulates indefinitely: nothing is removed, and
  // nothing is teleported from one edge to the other. Before this, a vehicle
  // reaching the last road was wrapped round to the far side — a car vanishing
  // from one street and appearing in another.
  check("no vehicle is ever teleported", teleports === 0, `${teleports} jumps`);
  check("no vehicle ever leaves the street grid",
    furthestOut < ROAD_WIDTH, `${furthestOut.toFixed(1)} m past the outermost road`);
  check("and none had to be rescued after leaving it", city.strays === 0,
    `${city.strays} turned round by the safety net`);
  check("every vehicle that started is still here", city.cars.length === startedWith,
    `${city.cars.length} of ${startedWith}`);
  check("they turn often enough to actually circulate", turnsCompleted > 150,
    `${turnsCompleted} turns in 15 minutes`);

  check("all three kinds of vehicle are on the streets",
    kinds.has("car") && kinds.has("truck") && kinds.has("bus"), [...kinds].join(", "));
  check("vehicles complete turns at junctions", turnsCompleted > 50, `${turnsCompleted} turns`);

  check("traffic comes to a stop somewhere, at some point", sawStopped > 10, `${sawStopped} samples`);
  check("and gets back up to speed", sawCruising > 10, `${sawCruising} samples`);
  check("brake lights are on when something is braking", sawBraking > 10, `${sawBraking} samples`);
  check("indicators are used", sawIndicating > 10, `${sawIndicating} samples`);
  check("every brake light drawn belongs to a vehicle that is braking",
    brakeMismatch === 0, `${brakeMismatch} frames disagreed`);
  check("every indicator drawn belongs to a vehicle that is signalling",
    indicatorMismatch === 0, `${indicatorMismatch} frames disagreed`);
  check("no lamp buffer is ever overrun", lampOverflow === 0, `${lampOverflow} frames`);
  // Joining a lane out of a turn is the one discontinuous move left, and the
  // grid is closed, so every vehicle that reaches the edge turns along it.
  //
  // The bound is set from measurement, not chosen: over five seeds this runs at
  // 24-55 brief contacts per fifteen minutes of city time, mean 35, every one
  // of them between two MOVING vehicles. A tolerance inside that range is not a
  // contract, it is a coin toss — this one sat at 45 and failed about one run
  // in three. What it is really guarding is a change that makes contacts
  // routine: when parking pulled vehicles diagonally across occupied bays it
  // was 182, and when a moving leader was credited with room it had not vacated
  // yet it was the same. This is the ceiling, not a target.
  check("vehicles almost never end up inside one another",
    overlapping <= 75, `${overlapping} contacts in 15 minutes: ${worstConflict}`);
  // The streets are deliberately busy enough to queue — 240 vehicles on a
  // five-by-five grid with a thirty second cycle is congested, and standing
  // traffic is a fair picture of a city rather than a fault. What would be a
  // fault is the model seizing up entirely, so this checks that it keeps
  // moving, not that it keeps flowing freely.
  check("the traffic never seizes up altogether",
    movingSamples > 0 && movingTotal / movingSamples >= 5,
    `${(movingTotal / Math.max(1, movingSamples)).toFixed(1)} of ${city.cars.length} moving on average`);
  check("and it covers real distance", distanceDriven > 25_000,
    `${(distanceDriven / 1000).toFixed(0)} km driven`);

  // The lamps a real car has, behaving the way real ones do.
  // Running lamps: always lit, at both ends, day and night. What changes with
  // the time of day is how bright they are, not whether they are there.
  for (const [day, when] of [[1, "in daylight"], [0.5, "at dusk"], [0, "after dark"]]) {
    city.applyTimeOfDay(day);
    city.update(1 / 60, viewer);
    check(`headlights are on ${when}`, parts().head.count === city.cars.length * 2,
      `${parts().head.count} of ${city.cars.length * 2}`);
    // The tail light and the brake light are one housing at two brightnesses,
    // so every vehicle shows exactly one of them at the back — never both
    // stacked in the same place, and never neither.
    const rear = parts().tail.count / 2 + parts().brake.count / 2;
    check(`every vehicle shows exactly one rear lamp ${when}`, rear === city.cars.length,
      `${parts().tail.count / 2} tail + ${parts().brake.count / 2} brake = ${rear}`);
    check(`the brake lamp is only on the vehicles actually braking ${when}`,
      parts().brake.count === city.cars.filter(v => v.braking).length * 2,
      `${parts().brake.count} lit for ${city.cars.filter(v => v.braking).length} braking`);
  }
  // And brightness follows the time of day rather than switching.
  city.applyTimeOfDay(1);
  const dayHead = parts().head.material.emissiveIntensity;
  const dayTail = parts().tail.material.emissiveIntensity;
  city.applyTimeOfDay(0);
  check("lamps are dimmer by day than after dark, but never off",
    dayHead > 0 && dayTail > 0
    && parts().head.material.emissiveIntensity > dayHead
    && parts().tail.material.emissiveIntensity > dayTail,
    `head ${dayHead.toFixed(2)} -> ${parts().head.material.emissiveIntensity.toFixed(2)}`);
  check("the brake filament is brighter than the tail lamp it shares a housing with",
    parts().brake.material.emissiveIntensity > parts().tail.material.emissiveIntensity * 1.5);
  city.dispose();
}

// ── Where the traffic ends up ─────────────────────────────────────────────
//
// At every junction a vehicle chooses evenly between the options that exist:
// carry on, turn left, turn right. On a closed grid that should scatter it
// across every street, and the standing distribution should be roughly flat.
//
// It was not. Turning used to be weighted heavily towards carrying on — one
// junction in three for a car — so most vehicles ran the whole length of a
// street, and the turn at the END of a street is compulsory. Turning at the
// outermost junction is by construction what puts a vehicle on the outermost
// road, and the ring is closed under those same compulsory turns. Measured
// with 40 vehicles and no congestion whatsoever, half the fleet ended up
// circling the edge of the city.
{
  const city = new City();
  city.build(boundsFor(0, 0, 9, 7), 2718, 0);
  const viewer = { x: 0, y: 1.6, z: 0 };
  const last = city.roadX.length - 1;
  const occupancy = new Array(city.roadX.length).fill(0);
  let sampled = 0;
  let completedTurns = 0;
  const turning = new Set();

  for (let f = 0; f < 18000; f++) {
    city.update(1 / 60, viewer);
    for (const v of city.cars) {
      if (v.arc) turning.add(v.id);
      else if (turning.delete(v.id)) completedTurns++;
    }
    if (f % 300) continue;
    for (const v of city.cars) occupancy[v.lane.roadIndex]++;
    sampled++;
  }

  const total = occupancy.reduce((a, b) => a + b, 0);
  const outerShare = (occupancy[0] + occupancy[last]) / total;
  // Two road indices out of six, so an even spread is a third. The residue
  // above that is dwell time: the ring is where compulsory turns happen, and
  // waiting for one takes longer than driving past a junction.
  check("the fleet does not pile onto the ring road",
    outerShare < 0.48,
    `${(outerShare * 100).toFixed(0)}% on the outer roads, even would be 33%`);
  check("every street carries traffic",
    occupancy.every(n => n / total > 0.06),
    occupancy.map((n, i) => `${i}:${(n / total * 100).toFixed(0)}%`).join(" "));
  // Vehicles now drive TO somewhere rather than tossing a coin at each corner,
  // so the turn rate is whatever the journeys need and is no longer a number
  // worth pinning. What still has to hold is that the traffic reaches the whole
  // grid, which the two checks above measure directly. This one only guards
  // against turning stopping altogether — a fleet that never turns is a fleet
  // driving in straight lines until it hits the edge.
  check("vehicles still turn", completedTurns > 40, `${completedTurns} turns in five minutes`);
  city.dispose();
}

// ── How fast each vehicle goes ────────────────────────────────────────────
//
// The kind sets a base speed — a bus is not a hatchback — and each driver has
// their own pace on top of it, redrawn every time they come out of a turn. A
// lane of one kind used to move as a single block, which is the thing that
// makes model traffic look modelled.
{
  const city = new City();
  city.build(boundsFor(0, 0, 9, 7), 2718, 0);
  const viewer = { x: 0, y: 1.6, z: 0 };

  // A fixed total, shared over the lanes — so changing how many streets are
  // populated cannot silently change how much traffic there is.
  check("the fleet is the size it is meant to be", city.cars.length === 240,
    `${city.cars.length} vehicles`);
  check("the fleet is spread over every lane, not just the middle few",
    new Set(city.cars.map(v => `${v.lane.axis}${v.lane.dir}${v.lane.roadIndex}`)).size >= 20,
    `${new Set(city.cars.map(v => `${v.lane.axis}${v.lane.dir}${v.lane.roadIndex}`)).size} lanes in use`);

  let outOfRange = 0;
  let mismatched = 0;
  for (const v of city.cars) {
    if (v.pace < 0.9 - 1e-9 || v.pace > 1.2 + 1e-9) outOfRange++;
    if (Math.abs(v.cruise - v.spec.cruise * v.pace) > 1e-9) mismatched++;
  }
  check("every vehicle's pace is inside the range", outOfRange === 0, `${outOfRange} outside`);
  check("and its speed is that pace applied to its kind's base",
    mismatched === 0, `${mismatched} disagree`);

  // The spread is the pace and nothing else, so it is exactly what the
  // constants say. Compounding a per-kind range with it gave cars anything
  // from 34 to 58 km/h.
  for (const kind of ["car", "truck", "bus"]) {
    const speeds = city.cars.filter(v => v.kind === kind).map(v => v.cruise);
    if (speeds.length < 4) continue;
    const spread = Math.max(...speeds) / Math.min(...speeds);
    check(`${kind}s vary in speed, but only within the pace range`,
      spread > 1.05 && spread <= 1.2 / 0.9 + 1e-6,
      `fastest is ${((spread - 1) * 100).toFixed(0)}% quicker than the slowest`);
  }

  // A fresh pace out of every corner, so the order of a queue keeps changing.
  // Watched across the whole fleet rather than one car: the streets are busy
  // enough that any particular vehicle may spend a quarter of an hour in a
  // queue without reaching a junction at all.
  const startingSpeeds = city.cars.map(v => `${v.kind}${v.cruise.toFixed(4)}`).join();
  const before = new Map(city.cars.map(v => [v.id, v.pace]));
  const changes = new Map(city.cars.map(v => [v.id, 0]));
  const everySeen = [];
  let wasTurning = new Set();
  for (let f = 0; f < 18000; f++) {
    city.update(1 / 60, viewer);
    for (const v of city.cars) {
      if (v.arc) { wasTurning.add(v.id); continue; }
      if (!wasTurning.delete(v.id)) continue;
      if (v.pace !== before.get(v.id)) {
        changes.set(v.id, changes.get(v.id) + 1);
        before.set(v.id, v.pace);
        everySeen.push(v.pace);
      }
    }
  }
  const movedOn = [...changes.values()].filter(n => n > 0).length;
  check("vehicles pick a new pace coming out of a turn",
    movedOn > 20, `${movedOn} of ${city.cars.length} changed pace at least once`);
  check("every pace they pick is inside the range",
    everySeen.every(p => p >= 0.9 - 1e-9 && p <= 1.2 + 1e-9),
    everySeen.length ? `${Math.min(...everySeen).toFixed(2)}-${Math.max(...everySeen).toFixed(2)}` : "none seen");
  check("and they are genuinely varied, not one repeated value",
    new Set(everySeen.map(p => p.toFixed(4))).size > everySeen.length * 0.8,
    `${new Set(everySeen.map(p => p.toFixed(4))).size} distinct of ${everySeen.length}`);

  // The city is reproducible; the traffic in it is not. Two builds of the same
  // room give the same streets, the same buildings and the same fleet drawn up
  // in the same places at the same speeds — and then diverge, because which
  // way each vehicle turns is a real coin toss rather than a seeded one.
  const twin = new City();
  twin.build(boundsFor(0, 0, 9, 7), 2718, 0);
  check("two builds of a room start identically",
    twin.cars.map(v => `${v.kind}${v.cruise.toFixed(4)}`).join() ===
      startingSpeeds,
    "the fleet should be laid out from the seed");
  for (let f = 0; f < 9000; f++) twin.update(1 / 60, viewer);
  let apart = 0;
  for (let i = 0; i < twin.cars.length; i++) {
    if (Math.hypot(twin.cars[i].x - city.cars[i].x, twin.cars[i].z - city.cars[i].z) > 5) apart++;
  }
  check("and then go their own ways",
    apart > twin.cars.length / 2,
    `${apart} of ${twin.cars.length} ended up somewhere different`);
  twin.dispose();
  city.dispose();
}

// ── Which side of the road ────────────────────────────────────────────────
//
// Right-hand traffic, as in the United States and Germany. The side is decided
// in exactly one function; the stop lines and signal heads derive theirs from
// it rather than working it out again, because a stop line painted in the
// oncoming lane is not obviously wrong until you go looking for it.
{
  const city = new City();
  city.build(boundsFor(0, 0, 9, 7), 2718, 0);
  // Facing east your right is south, facing south your right is west, and so
  // on round the compass. +x is east and +z is south.
  const expected = [
    ["x", 1, "south", off => off > 0],
    ["x", -1, "north", off => off < 0],
    ["z", 1, "west", off => off < 0],
    ["z", -1, "east", off => off > 0],
  ];
  for (const [axis, dir, side, ok] of expected) {
    check(`traffic heading ${axis === "x" ? (dir > 0 ? "east" : "west") : (dir > 0 ? "south" : "north")} keeps to the ${side}`,
      ok(City.laneOffset(axis, dir)), `offset ${City.laneOffset(axis, dir)}`);
  }
  // And the vehicles really are on that side, not merely told to be.
  let wrongSide = 0;
  for (const v of city.cars) {
    const road = v.fixed - City.laneOffset(v.axis, v.dir);
    const off = v.fixed - road;
    const want = City.laneOffset(v.axis, v.dir);
    if (Math.sign(off) !== Math.sign(want)) wrongSide++;
  }
  check("every vehicle is in a lane on that side", wrongSide === 0, `${wrongSide} on the wrong side`);
  // The turn that crosses oncoming traffic is the LEFT one now.
  // right(A) = (-az, ax) is a right turn. On the right-hand side of the road
  // that one crosses nothing; the left turn is the one that has to give way.
  check("the give-way turn is the left one, as it is on the right-hand side",
    NEAR_SIDE_TURN === 1 && CROSSING_TURN === -1,
    `near ${NEAR_SIDE_TURN}, crossing ${CROSSING_TURN}`);
  city.dispose();
}

// ── Traffic signals ───────────────────────────────────────────────────────
//
// The lights are not decoration timed to look plausible: they read the same
// phase the drivers obey. So the thing worth checking is that the two cannot
// disagree, and that the sequence is one a real junction runs.
{
  const city = new City();
  city.build(boundsFor(0, 0, 9, 7), 2718, 0);
  const viewer = { x: 0, y: 1.6, z: 0 };
  check("every junction has a signal on every approach",
    city.signals.length === city.roadX.length * city.roadZ.length * 4,
    `${city.signals.length} for ${city.roadX.length}x${city.roadZ.length} junctions`);

  // Walk one junction through two full cycles.
  const s0 = city.signals[0];
  const seen = [];
  let last = "";
  for (let f = 0; f < 70 * 60; f++) {
    city.update(1 / 60, viewer);
    const x = city._signalState("x", s0.ix, s0.iz, city._clock);
    const z = city._signalState("z", s0.ix, s0.iz, city._clock);
    const key = x + "/" + z;
    if (key !== last) { seen.push({ t: city._clock, x, z }); last = key; }
  }
  // The cycle used to be exactly thirty seconds, always, everywhere. It is now
  // set by the controller from the queues actually waiting, so what can be
  // asserted is the envelope rather than a single number: every cycle is a real
  // cycle, none is so short it cannot clear anybody, and none so long that the
  // cross street is abandoned.
  const starts = seen.filter(e => e.x === "green");
  const cycles = starts.slice(1).map((e, i) => e.t - starts[i].t);
  check("the junction keeps cycling", cycles.length >= 1, `${starts.length} greens in 70 s`);
  check("no cycle is too short to clear a queue",
    cycles.every(c => c >= 2 * (6 + 2 + 2) - 0.1),
    cycles.length ? `shortest ${Math.min(...cycles).toFixed(1)} s` : "");
  check("no cycle starves the cross street",
    cycles.every(c => c <= 2 * (26 + 2 + 2) + 0.1),
    cycles.length ? `longest ${Math.max(...cycles).toFixed(1)} s` : "");
  check("green gives way to amber before red, never straight to it",
    seen.every((e, i) => !(i > 0 && seen[i - 1].x === "green" && e.x === "red")));
  check("there is an all-red gap between the two directions",
    seen.some(e => e.x === "red" && e.z === "red"));

  // The dangerous failure: both directions green at the same junction.
  let bothGreen = 0;
  for (const s of city.signals) {
    for (let t = 0; t < 60; t += 0.2) {
      if (city._signalState("x", s.ix, s.iz, t) === "green"
        && city._signalState("z", s.ix, s.iz, t) === "green") bothGreen++;
    }
  }
  check("no junction ever shows green in both directions", bothGreen === 0, `${bothGreen} moments`);

  // And exactly one lamp per signal is lit, always.
  let wrong = 0;
  for (let f = 0; f < 600; f++) {
    city.update(1 / 60, viewer);
    const lit = city.signalLamps.red.count + city.signalLamps.amber.count + city.signalLamps.green.count;
    if (lit !== city.signals.length) wrong++;
  }
  check("exactly one lamp is lit on every signal, every frame", wrong === 0, `${wrong} frames`);

  // A driver's view: the light governing a lane agrees with whether the model
  // lets that lane through.
  let disagreements = 0;
  for (let f = 0; f < 1800; f++) {
    city.update(1 / 60, viewer);
    for (const s of city.signals) {
      const green = city._isGreen(s.axis, s.ix, s.iz, city._clock);
      const shown = city._signalState(s.axis, s.ix, s.iz, city._clock);
      if (green !== (shown === "green")) disagreements++;
    }
  }
  check("what the lamp shows is what the traffic model obeys",
    disagreements === 0, `${disagreements} disagreements`);
  city.dispose();
}

// ── Road markings and crossings ───────────────────────────────────────────
{
  const city = new City();
  city.build(boundsFor(0, 0, 9, 7), 4242, 0);
  const paint = city.group.children.find(n => n.name === "city-ground-details");
  const e = paint.instanceMatrix.array;
  const marks = [];
  for (let i = 0; i < paint.count; i++) {
    const o = i * 16;
    marks.push({
      x: e[o + 12], y: e[o + 13], z: e[o + 14],
      w: Math.hypot(e[o + 0], e[o + 1], e[o + 2]),
      d: Math.hypot(e[o + 8], e[o + 9], e[o + 10]),
    });
  }
  // Lane dashes must stop clear of the junctions rather than running through
  // them — paint across a junction is the giveaway that it was drawn from one
  // side of the city to the other without looking.
  const halfRoad = ROAD_WIDTH / 2;
  let insideJunctions = 0;
  for (const m of marks) {
    if (m.y < ROAD_Y + 0.01) continue;          // pads sit lower than the paint
    const nearX = city.roadX.some(r => Math.abs(m.x - r) < halfRoad - 0.4);
    const nearZ = city.roadZ.some(r => Math.abs(m.z - r) < halfRoad - 0.4);
    if (nearX && nearZ) insideJunctions++;
  }
  check("no road paint is laid across a junction", insideJunctions === 0,
    `${insideJunctions} marks inside junction boxes`);

  // Every arm of every junction gets a crossing.
  let armsWithCrossing = 0;
  const arms = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const rx of city.roadX) {
    for (const rz of city.roadZ) {
      for (const [dx, dz] of arms) {
        const atX = rx + dx * (halfRoad + 1.9);
        const atZ = rz + dz * (halfRoad + 1.9);
        const bars = marks.filter(m => Math.abs(m.x - atX) < 2 && Math.abs(m.z - atZ) < 2
          && m.y > ROAD_Y + 0.01);
        if (bars.length >= 3) armsWithCrossing++;
      }
    }
  }
  const totalArms = city.roadX.length * city.roadZ.length * 4;
  check("every junction arm has a crossing", armsWithCrossing === totalArms,
    `${armsWithCrossing} of ${totalArms}`);
  city.dispose();
}

// ── The vehicles themselves ───────────────────────────────────────────────
{
  const city = new City();
  city.build(boundsFor(0, 0, 9, 7), 2718, 0);
  const kinds = ["car", "van", "truck", "bus"];
  for (const kind of kinds) {
    const mesh = city.vehicleMeshes[kind];
    check(`there is a ${kind} body`, !!mesh);
    if (!mesh) continue;
    const tris = mesh.geometry.attributes.position.count / 3;
    // The old car was a body box, a cabin box and four wheels: about 152
    // triangles. Three times that was the ask.
    check(`a ${kind} has real shape to it, not three boxes`, tris >= 456,
      `${Math.round(tris)} triangles`);
    check(`a ${kind} has glass and tyres, not one flat colour`,
      new Set(Array.from({ length: mesh.geometry.attributes.color.count },
        (_, i) => mesh.geometry.attributes.color.getX(i).toFixed(2))).size >= 3);
  }
  // Nothing inside a body may share a depth with anything else in it. The
  // instanced check cannot see in here — a body is one merged geometry, and
  // the parts are gone once it is built — so the surfaces are recovered from
  // the triangles. This is what the flickering wheels were: the tyres ended at
  // 0.44W + 0.06W, which is exactly 0.5W, the plane of the car's own flank.
  for (const kind of kinds) {
    const mesh = city.vehicleMeshes[kind];
    if (!mesh) continue;
    const clashes = coplanarInGeometry(mesh.geometry);
    check(`a ${kind} has no two surfaces at the same depth`,
      clashes.length === 0,
      clashes.length
        ? `${clashes.length} overlaps, e.g. ${clashes[0].axis} = ${clashes[0].at.toFixed(3)}`
        : "");
  }

  // Round wheels. A GPU draws triangles and nothing else, so "round" means
  // enough of them, shaded smoothly — twelve sides reads as a dodecagon.
  for (const kind of kinds) {
    const mesh = city.vehicleMeshes[kind];
    if (!mesh) continue;
    const p = mesh.geometry.attributes.position;
    const n = mesh.geometry.attributes.normal;
    // Wheel barrels are the only surfaces whose normals are neither axis
    // aligned nor shared between all three corners of a triangle.
    let smoothRound = 0;
    for (let t = 0; t < p.count; t += 3) {
      const same = Math.abs(n.getX(t) - n.getX(t + 1)) < 1e-6
        && Math.abs(n.getY(t) - n.getY(t + 1)) < 1e-6
        && Math.abs(n.getZ(t) - n.getZ(t + 1)) < 1e-6;
      if (!same) smoothRound++;
    }
    check(`a ${kind}'s wheels are smooth-shaded, not faceted`, smoothRound > 100,
      `${smoothRound} smoothly shaded triangles`);
  }

  // One instance per vehicle, so the detail costs nothing per frame.
  const instances = kinds.reduce((n, k) => n + (city.vehicleMeshes[k] ? city.vehicleMeshes[k].count : 0), 0);
  check("a vehicle is one instance, not a pile of parts written every frame",
    instances === city.cars.length, `${instances} instances for ${city.cars.length} vehicles`);
  city.dispose();
}

// ── Entrances and house numbers ───────────────────────────────────────────
{
  const city = new City();
  city.build(boundsFor(0, 0, 9, 7), 2718, 0);
  const facades = city.group.children.find(n => n.name === "city-facades");
  const e = facades.instanceMatrix.array;
  // Digits are the only thing on a facade this small — five-centimetre cubes
  // laid out in a 3x5 grid — so they can be counted by size without needing
  // to know what colour they were painted.
  let digitBlocks = 0;
  let lintels = 0;
  const doorPlaces = new Set();
  for (let i = 0; i < facades.count; i++) {
    const o = i * 16;
    const w = Math.hypot(e[o + 0], e[o + 1], e[o + 2]);
    const h = Math.hypot(e[o + 4], e[o + 5], e[o + 6]);
    const d = Math.hypot(e[o + 8], e[o + 9], e[o + 10]);
    if (Math.max(w, h, d) < 0.075 && Math.min(w, h, d) > 0.02) {
      digitBlocks++;
      doorPlaces.add(`${Math.round(e[o + 12] / 3)},${Math.round(e[o + 14] / 3)}`);
    }
    // A lintel: a wide, shallow stone band about a quarter of a metre thick.
    if (h > 0.2 && h < 0.35 && Math.max(w, d) > WIN_W + 0.4 && Math.min(w, d) < 0.35) lintels++;
  }
  check("buildings carry house numbers", digitBlocks > 40, `${digitBlocks} digit blocks`);
  check("the numbers are grouped over doorways, not scattered",
    doorPlaces.size >= 3 && digitBlocks / doorPlaces.size >= 8,
    `${digitBlocks} blocks at ${doorPlaces.size} places`);
  check("every entrance has its stone lintel", lintels >= 3, `${lintels} lintels`);

  // The doorway is a real opening: the masonry below the ground-floor window
  // of the door column is not built, so there is a lobby behind it rather
  // than a room.
  const lobbies = city.group.children.find(n => n.name === "city-rooms-dark");
  check("there are lobbies behind the doors", !!lobbies && lobbies.count > 0);
  city.dispose();
}

// ── Weather ───────────────────────────────────────────────────────────────
{
  const city = new City();
  city.build(boundsFor(0, 0, 6, 5), 1234, 0);
  for (const kind of WEATHER_KINDS) {
    city.setWeather(kind);
    const viewer = { x: 12, y: 1.7, z: -8 };
    for (let f = 0; f < 120; f++) city.update(1 / 60, viewer);
    const mesh = city.precipitation;
    const air = city.atmosphere();
    check(`${kind}: the atmosphere it reports is sane`,
      air.kind === kind && finite(air.haze) && air.haze >= 0 && air.haze <= 1
      && finite(air.dim) && air.dim >= 0 && air.dim <= 1, JSON.stringify(air));
    const falling = kind === "rain" || kind === "snow";
    check(`${kind}: ${falling ? "something falls" : "nothing falls"}`,
      falling ? mesh.count > 200 : mesh.count === 0, `${mesh.count} drops`);
    if (!falling) continue;

    // Every drop must be finite and in the box around the viewer — weather
    // that stays where the room used to be is worse than no weather at all.
    const e = mesh.instanceMatrix.array;
    let strays = 0;
    let bad = 0;
    for (let i = 0; i < mesh.count; i++) {
      const o = i * 16;
      const x = e[o + 12];
      const y = e[o + 13];
      const z = e[o + 14];
      if (!finite(x) || !finite(y) || !finite(z)) { bad++; continue; }
      if (Math.abs(x - viewer.x) > 40 || Math.abs(z - viewer.z) > 40 || Math.abs(y - viewer.y) > 45) strays++;
    }
    check(`${kind}: no drop is non-finite`, bad === 0, `${bad} of ${mesh.count}`);
    check(`${kind}: the weather stays around the viewer`, strays === 0, `${strays} strays`);

    // And it follows when they walk away.
    const moved = { x: viewer.x + 200, y: viewer.y, z: viewer.z - 150 };
    for (let f = 0; f < 60; f++) city.update(1 / 60, moved);
    let near = 0;
    for (let i = 0; i < mesh.count; i++) {
      const o = i * 16;
      if (Math.abs(e[o + 12] - moved.x) < 40 && Math.abs(e[o + 14] - moved.z) < 40) near++;
    }
    check(`${kind}: it follows the viewer when they move`, near === mesh.count,
      `${near} of ${mesh.count} drops came along`);
  }
  check("an unknown weather falls back to clear rather than throwing",
    (() => { city.setWeather("hurricane"); return city.atmosphere().kind === "clear"; })());
  city.dispose();
}

// ── The frame length the city is actually given ───────────────────────────
//
// The sweep above assumes dt arrives finite and capped. That is walk3d's job,
// not the city's, so it is pinned here: if the clamp is ever dropped, a long
// stall or a backgrounded tab would teleport every car down its lane in one
// frame, and this test would still be passing on assumptions that no longer
// hold.
{
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const web = join(dirname(fileURLToPath(import.meta.url)), "..", "roomcad", "web");
  const walk = readFileSync(join(web, "walk3d.js"), "utf8");
  const line = /const dt = ([^\n]+);/.exec(walk);
  check("walk3d caps the frame length before anything consumes it",
    !!line && /Math\.min\(/.test(line[1]) && /getDelta\(\)/.test(line[1]),
    line ? line[1] : "no dt found");
  check("the cap is short enough that a stalled tab does not teleport the world",
    !!line && (Number((/0?\.\d+/.exec(line[1]) || [])[0]) || 1) <= 0.05,
    line ? line[1] : "");
  check("the city is driven with that same capped value, and told where the viewer is",
    /this\.city\.update\(dt, this\.camera\.position\)/.test(walk));
}

// ── Kerbside stopping ──────────────────────────────────────────────────────
//
// Cars park along the kerb, trucks stop in the lane to load, and buses call at
// designated stops. Every number below is one that was wrong when first
// measured, so each is a regression guard rather than a restatement of the
// code:
//
//   - the cap on parked cars counted only the ones already stopped, so every
//     car passing a free bay in the same second reserved one while the count
//     was still low and they all arrived: 94 parked against a cap of 53;
//   - a bay is 7 m and a bus is up to 12.2 m, so a bus claiming one bay left
//     the space either side looking free and a car parked into it;
//   - arriving forced the vehicle onto the bay centre and to full kerb offset,
//     two teleports of up to 3.9 m and 1.3 m;
//   - a vehicle that reserved a bay and was then caught in traffic kept it:
//     one held a space for 356 s without ever reaching it;
//   - the truck rate was applied per frame rather than per second, 56x too
//     often, and a guard on "has a turn pending" stopped buses calling at
//     1492 of the 1502 stops they drove past.
{
  const city = new City();
  city.build(boundsFor(0, 0, 9, 7), 2718, 0);

  // The layout itself.
  const lanes = [...city.lanes.values()];
  const bays = lanes.flatMap(l => l.bays || []);
  check("there are parking bays along the streets", bays.length > 200, `${bays.length} bays`);

  // The distance is stated here rather than read from the code: a check that
  // imports the very constant it is testing moves with it, and passes however
  // wrong the constant becomes. What has to be true is that a parked car is
  // clear of the crossing and the stop line and leaves a few metres beyond
  // them — the "couple of metres before the traffic lights" this is for.
  const KEEP_CLEAR = ROAD_WIDTH / 2 + 4;
  let nearJunction = 0;
  let worstBay = Infinity;
  for (const lane of lanes) {
    const crossing = lane.axis === "x" ? city.roadX : city.roadZ;
    for (const bay of lane.bays || []) {
      const gap = Math.min(...crossing.map(road => Math.abs(bay.at - road)));
      worstBay = Math.min(worstBay, gap);
      if (gap < KEEP_CLEAR) nearJunction++;
    }
  }
  check("parking stops well before the traffic lights",
    nearJunction === 0,
    `${nearJunction} bays closer than ${KEEP_CLEAR.toFixed(1)} m; nearest is ${worstBay.toFixed(1)} m`);

  const stops = bays.filter(b => b.busStop).length;
  const blocks = (GRID_RADIUS * 2 + 1) ** 2;
  // Two per block, across its four sides — again as a literal, so raising the
  // constant is a failure rather than a silently accepted new expectation.
  check("a block has two bus stops across its four sides",
    stops === blocks * 2, `${stops} stops for ${blocks} blocks, expected ${blocks * 2}`);

  // And the behaviour, over ten simulated minutes.
  const cars = city.cars.filter(v => v.kind === "car").length;
  const cap = Math.ceil(city.cars.length * PARK_SHARE);
  let peakParked = 0;
  let everParked = 0;
  let everUnloaded = 0;
  let everAtAStop = 0;
  let jumps = 0;
  let worstJump = 0;
  let widestReach = 0;
  let doubleBooked = 0;
  let busAwayFromAStop = 0;
  let heldTooLong = 0;
  const dwell = { park: [Infinity, -Infinity], unload: [Infinity, -Infinity], busstop: [Infinity, -Infinity] };
  const held = new Map();

  for (let f = 0; f < 36000; f++) {
    const before = city.cars.map(v => ({ x: v.x, z: v.z }));
    city.update(1 / 60, { x: 0, y: 1.6, z: 0 });

    for (let i = 0; i < city.cars.length; i++) {
      const v = city.cars[i];
      const moved = Math.hypot(v.x - before[i].x, v.z - before[i].z);
      // A frame is 1/60 s and nothing in the city does 60 m/s. Anything this
      // far in one frame is a reposition, not driving.
      if (moved > 1.0) { jumps++; worstJump = Math.max(worstJump, moved); }
      if (v.stopTarget) {
        if (!held.has(v.id)) held.set(v.id, f);
        if ((f - held.get(v.id)) / 60 > RESERVE_TTL + 5) heldTooLong++;
      } else held.delete(v.id);
    }

    if (f % 120) continue;

    let parkedNow = 0;
    const claims = new Map();
    for (const v of city.cars) {
      if (!v.stop) continue;
      const span = dwell[v.stop.kind];
      const total = v.stop.until - (v.stop.at ?? city._clock);
      if (v.stop.kind === "park") { parkedNow++; everParked++; }
      if (v.stop.kind === "unload") everUnloaded++;
      if (v.stop.kind === "busstop") {
        everAtAStop++;
        if (!v.stop.bay || !v.stop.bay.busStop) busAwayFromAStop++;
      }
      // A stopped vehicle must be inside its own kerb, not up on the pavement.
      // Buses are excluded on purpose: a bus stop is a layby cut back into the
      // pavement, so a bus AT one is meant to be beyond the kerb line. That it
      // stays inside the layby is checked separately.
      if (v.kind !== "bus") {
        const road = v.fixed - City.laneOffset(v.axis, v.dir);
        const across = Math.abs((v.axis === "x" ? v.z : v.x) - road);
        widestReach = Math.max(widestReach, across + v.width / 2);
      }
      claims.set(v, true);
      void span; void total;
    }
    // No two stopped vehicles may occupy the same stretch of kerb. Tested as
    // bodies rather than as bay bookings: with one bay each, a bus and the car
    // in the next bay hold different bookings and still overlap by metres.
    const resting = [...claims.keys()];
    for (let a = 0; a < resting.length; a++) {
      for (let b = a + 1; b < resting.length; b++) {
        if (vehiclesOverlap(resting[a], resting[b])) doubleBooked++;
      }
    }
    peakParked = Math.max(peakParked, parkedNow);
  }

  check("the cap on parked cars holds",
    peakParked <= cap, `${peakParked} parked at once, cap ${cap} (${cars} cars)`);
  check("cars do park", everParked > 0, `${everParked} sightings`);
  check("trucks stop to load", everUnloaded > 0, `${everUnloaded} sightings`);
  check("buses call at their stops", everAtAStop > 0, `${everAtAStop} sightings`);
  check("a bus only ever stops at a designated stop",
    busAwayFromAStop === 0, `${busAwayFromAStop} sightings elsewhere`);
  check("no two stopped vehicles occupy the same stretch of kerb",
    doubleBooked === 0, `${doubleBooked} sightings`);
  check("stopping never teleports a vehicle",
    jumps === 0, `${jumps} jumps, worst ${worstJump.toFixed(2)} m in one frame`);
  check("a stopped car or van stays inside the kerb",
    widestReach <= ROAD_WIDTH / 2, `reached ${widestReach.toFixed(2)} m, kerb at ${ROAD_WIDTH / 2}`);
  check("no vehicle holds a space it cannot reach",
    heldTooLong === 0, `${heldTooLong} frames past the ${RESERVE_TTL} s limit`);

  // The durations the user asked for: five minutes to two hours parked, five
  // to ten minutes unloading. Sampled from the model rather than the clock, so
  // the test does not have to run for two hours.
  {
    const seen = { park: [], unload: [], busstop: [] };
    const probe = new City();
    probe.build(boundsFor(0, 0, 9, 7), 4242, 0);
    for (let f = 0; f < 60000; f++) {
      probe.update(1 / 60, { x: 0, y: 1.6, z: 0 });
      for (const v of probe.cars) {
        if (v.stop && !v.stop.counted) {
          v.stop.counted = true;
          seen[v.stop.kind].push(v.stop.until - probe._clock);
        }
      }
    }
    const range = list => [Math.min(...list), Math.max(...list)];
    check("some of every kind of stop happened",
      seen.park.length && seen.unload.length && seen.busstop.length,
      `park ${seen.park.length}, unload ${seen.unload.length}, bus ${seen.busstop.length}`);
    if (seen.park.length) {
      const [lo, hi] = range(seen.park);
      check("a car parks for between five minutes and two hours",
        lo >= 5 * 60 - 1 && hi <= 120 * 60 + 1,
        `${(lo / 60).toFixed(1)}-${(hi / 60).toFixed(1)} min`);
    }
    if (seen.unload.length) {
      const [lo, hi] = range(seen.unload);
      check("a van offloads for between five and fifteen minutes",
        lo >= 5 * 60 - 1 && hi <= 15 * 60 + 1,
        `${(lo / 60).toFixed(1)}-${(hi / 60).toFixed(1)} min`);
    }
    if (seen.busstop.length) {
      const [lo, hi] = range(seen.busstop);
      check("a bus calls for between one and five minutes",
        lo >= 60 - 1 && hi <= 300 + 1, `${lo.toFixed(0)}-${hi.toFixed(0)} s`);
    }
    probe.dispose();
  }

  // A long vehicle must make the kerb either side of it unavailable, because a
  // bay is 7 m and plenty of vehicles are longer. Put to the model directly:
  // waiting for two of them to want adjacent spaces in a ten-minute run does
  // not test it.
  //
  // This used to be asked of a bus at its stop. It is asked of a van now,
  // because a bus stop has the whole block side to itself — there is no
  // neighbouring bay left to claim, which is a stronger guarantee than
  // claiming one and is checked separately.
  {
    const van = city.cars.find(v => v.kind === "van");
    const car = city.cars.find(v => v.kind === "car");
    // A space that actually HAS one either side of it. Bays are not a
    // continuous run — junctions break them, and a block side with a bus stop
    // has none at all — so the middle of a lane's list can be an isolated one
    // with nothing a pitch away to test against.
    let lane = null;
    let target = null;
    let near = [];
    for (const candidate of city.lanes.values()) {
      for (const bay of candidate.bays || []) {
        const beside = (candidate.bays || []).filter(b =>
          b !== bay && Math.abs(Math.abs(b.at - bay.at) - BAY_PITCH) < 0.5);
        if (beside.length < 2) continue;
        lane = candidate;
        target = bay;
        near = beside;
        break;
      }
      if (lane) break;
    }
    check("the test found a space with one either side of it",
      !!lane && near.length >= 2,
      `van ${van.length.toFixed(1)} m, bays every ${BAY_PITCH} m`);
    check("a van very nearly fills a single space on its own",
      van.length > BAY_PITCH - 1.5,
      `${van.length.toFixed(1)} m in a ${BAY_PITCH} m space leaves too much room to matter`);

    const spare = { ...lane, members: [] };
    const standing = { ...van, lane: spare };
    const arriving = { ...car, lane: spare };
    for (const b of lane.bays) b.taken = null;
    city._takeBay(standing, target);
    check("a stopped van blocks the kerb its body covers",
      near.every(b => !city._bayFree(arriving, b)),
      `${near.filter(b => city._bayFree(arriving, b)).length} of ${near.length} neighbouring bays still offered`);
    check("and it does not block the whole street",
      lane.bays.some(b => city._bayFree(arriving, b)),
      "every bay in the lane was refused");
    for (const b of lane.bays) b.taken = null;
  }

  // Put to the model rather than grepped for: a call can be left in place and
  // disabled, and three earlier source-matching contracts here passed against
  // exactly that. A car whose time is up, with traffic bearing down on it, must
  // stay where it is.
  //
  // Built from scratch rather than borrowed from the fleet — a car picked out
  // of a city that has been running for ten minutes brings whatever state it
  // happens to be in, and the check then reports on unrelated changes.
  {
    const lane = { axis: "x", dir: 1, fixed: 3.1, members: [], bays: [] };
    const make = (at, speed) => ({
      kind: "car", id: "probe" + at, length: 4.4, width: 1.78,
      axis: "x", dir: 1, x: at, z: 3.1, fixed: 3.1, speed, arc: null,
      lane, stop: null, stopTarget: null, kerbOffset: 0, kerbTarget: 0,
      braking: false, indicate: 0,
    });

    const parked = make(0, 0);
    parked.kerbOffset = PARK_OFFSET;
    parked.kerbTarget = PARK_OFFSET;
    parked.stop = { kind: "park", bay: null, bays: [], until: city._clock - 1 };
    const coming = make(-6, 11);
    lane.members = [parked, coming];

    check("a car does not pull out in front of traffic already alongside",
      city._handleStopping(parked, 1 / 60) && parked.stop !== null,
      "it released into a 6 m gap at 11 m/s");

    coming.x = -90;
    check("and it does pull out once the road behind is clear",
      !city._handleStopping(parked, 1 / 60) && parked.stop === null,
      "it stayed put with 90 m of clear road behind");
  }

  city.dispose();
}

// ── The traffic controller ────────────────────────────────────────────────
//
// Two controllers share one realtime picture of the city: who is waiting at
// each junction and on which side, and where every vehicle intends to go next.
// One sets the green times from the queues, the other reds out the turn arrows
// that would feed a street already full.
//
// The numbers each of these guards is one that was measured wrong first:
//
//   - the lights ran a fixed thirty second timetable, and EIGHTY PER CENT of
//     green phases had nobody passing through them while the cross street
//     queued at red;
//   - a junction with four vehicles queued at it passed a median of ONE per
//     green, a seventh of what a real junction manages;
//   - queue heads waiting for a turn that had nowhere to go were 17% of
//     everything stopped at a junction, each one holding a whole approach;
//   - and the turn manager, when it was allowed to veto a stuck vehicle's way
//     out, cost more than it gained — throughput in the eighth minute fell
//     from 5.4 crossings a second to 1.0.
{
  const city = new City();
  city.build(boundsFor(0, 0, 9, 7), 2718, 0);
  const viewer = { x: 0, y: 1.6, z: 0 };
  for (let f = 0; f < 60 * 60; f++) city.update(1 / 60, viewer);

  check("every junction is running a phase",
    city.phases.size === city.roadX.length * city.roadZ.length,
    `${city.phases.size} phases`);
  check("every approach has its turn arrows decided",
    city.turnControl.size > 0 && city.turnStats.approaches === city.turnControl.size,
    `${city.turnControl.size} approaches`);

  // ── The arrows are not decoration ──────────────────────────────────────
  //
  // The one failure that would make the whole thing a lie: an arrow showing
  // green for a movement the junction is actually refusing, or red for one it
  // allows. Checked against the map the drivers themselves read.
  let arrowLies = 0;
  let litGreen = 0;
  let litRed = 0;
  for (const sig of city.signals) {
    const allow = city.turnsAllowedAt(sig.axis, sig.dir, sig.ix, sig.iz);
    for (const arrow of sig.arrows) {
      if (allow && !allow.has(arrow.turn)) continue;
      const shown = !allow || allow.get(arrow.turn) === true;
      if (shown) litGreen++; else litRed++;
      const driver = city._turnPermitted(
        { axis: sig.axis, dir: sig.dir, lane: { roadIndex: sig.axis === "x" ? sig.iz : sig.ix } },
        { index: sig.axis === "x" ? sig.ix : sig.iz }, arrow.turn);
      if (driver !== shown) arrowLies++;
    }
  }
  check("what a turn arrow shows is what the junction actually allows",
    arrowLies === 0, `${arrowLies} arrows disagreed with the drivers`);
  check("the arrows drawn are the arrows lit",
    city.turnArrows.green.count === litGreen && city.turnArrows.red.count === litRed,
    `drawn ${city.turnArrows.green.count}/${city.turnArrows.red.count}, expected ${litGreen}/${litRed}`);
  check("a movement that leads off the edge of the grid gets no arrow at all",
    litGreen + litRed < city.signals.length * 3,
    "every mount was lit, including ones with nowhere to go");

  // An arrow has to point where it means. Straight ahead points up; the
  // near-side arrow points to the driver's near side.
  let misaimed = 0;
  for (const sig of city.signals) {
    const forward = City.forwardOf(sig.axis, sig.dir);
    const near = { x: -forward.z, y: 0, z: forward.x };
    for (const arrow of sig.arrows) {
      const e = city._arrowMatrix(sig, arrow, new THREE.Matrix4()).elements;
      const tip = { x: e[4], y: e[5], z: e[6] };          // where local +Y went
      const len = Math.hypot(tip.x, tip.y, tip.z) || 1;
      const want = arrow.turn === 0
        ? { x: 0, y: 1, z: 0 }
        : { x: near.x * arrow.turn, y: 0, z: near.z * arrow.turn };
      const dot = (tip.x * want.x + tip.y * want.y + tip.z * want.z) / len;
      if (dot < 0.95) misaimed++;
    }
  }
  check("every turn arrow points the way it means", misaimed === 0, `${misaimed} of ${city.signals.length * 3}`);

  // ── No approach is ever shut out ───────────────────────────────────────
  let deadEnds = 0;
  for (const [, allow] of city.turnControl) {
    if (allow.size && ![...allow.values()].some(Boolean)) deadEnds++;
  }
  check("no approach is ever left with every arrow red",
    deadEnds === 0, `${deadEnds} approaches with nowhere legal to go`);

  // ── The lights follow the queues ───────────────────────────────────────
  //
  // Sampled over five minutes: how long each green ran, and whether the side
  // it was given to had anybody on it.
  const greens = [];
  const open = new Map();
  // Only greens whose START was seen. A phase already running when sampling
  // began yields a partial length — a 1.2 s "green" that never happened.
  const started = new Set();
  const paired = [];
  let emptyGreen = 0;
  let anyGreen = 0;
  let longestRed = 0;
  const redSince = new Map();
  for (let f = 0; f < 5 * 60 * 60; f++) {
    city.update(1 / 60, viewer);
    for (const phase of city.phases.values()) {
      for (const axis of ["x", "z"]) {
        const key = `${phase.ix}|${phase.iz}|${axis}`;
        const green = phase.axis === axis && phase.state === "green";
        if (green) {
          if (!open.has(key)) {
            open.set(key, city._clock);
            const cell = city._demand.get(`${phase.ix}|${phase.iz}`);
            open.set(key + "!q", cell ? cell[axis].queue : 0);
          }
          if (redSince.has(key)) {
            if (started.has(key)) longestRed = Math.max(longestRed, city._clock - redSince.get(key));
            redSince.delete(key);
            started.add(key);
          }
        } else {
          if (!redSince.has(key)) redSince.set(key, city._clock);
          if (open.has(key)) {
            if (started.has(key)) {
              const len = city._clock - open.get(key);
              greens.push(len);
              paired.push({ len, queue: open.get(key + "!q") || 0 });
            }
            open.delete(key);
            open.delete(key + "!q");
          }
        }
      }
    }
    if (f % 60) continue;
    for (const phase of city.phases.values()) {
      if (phase.state !== "green") continue;
      anyGreen++;
      const cell = city._demand.get(`${phase.ix}|${phase.iz}`);
      const side = cell ? cell[phase.axis] : null;
      if (!side || (side.queue === 0 && side.moving === 0)) emptyGreen++;
    }
  }
  greens.sort((a, b) => a - b);
  check("the lights are still running", greens.length > 100, `${greens.length} greens in 5 min`);
  // Stated outright rather than read from the code, so widening the bounds is
  // a failure and not a new expectation.
  check("no green is shorter than six seconds",
    greens[0] >= 6 - 0.2, `shortest ${greens[0].toFixed(1)} s`);
  check("no green runs longer than half a minute",
    greens[greens.length - 1] <= 30, `longest ${greens[greens.length - 1].toFixed(1)} s`);
  check("green times vary rather than being a fixed slot",
    greens[greens.length - 1] - greens[0] > 4,
    `every green was ${greens[0].toFixed(1)}-${greens[greens.length - 1].toFixed(1)} s`);
  // Varying is not enough — they have to vary WITH THE QUEUE. A fixed slot plus
  // a rule that cuts empty greens short also produces a spread of lengths, and
  // that spread passed the check above while the timing was back on a timetable.
  {
    // A queue of three, not five. Most cars are parked now, so five waiting at
    // one approach is rare enough that a five-minute sample sometimes contains
    // almost none of them and the check reported on an empty set.
    const busy = paired.filter(x => x.queue >= 3).map(x => x.len);
    const idle = paired.filter(x => x.queue === 0).map(x => x.len);
    const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    check("both busy and empty approaches were observed",
      busy.length > 5 && idle.length > 5, `${busy.length} busy, ${idle.length} empty`);
    // Stated as an absolute rather than as a margin over the empty case. A
    // green sized up front from the queue and then never extended clears the
    // margin easily and still gives a long queue a short green, which is the
    // failure that matters — measured, an approach with five or more waiting
    // runs about 24 s against the 6 s minimum.
    check("a queue of three or more is held green for at least ten seconds",
      mean(busy) >= 10,
      `${mean(busy).toFixed(1)} s with a queue of 3+, ${mean(idle).toFixed(1)} s with none`);
  }
  // Bounded by the maximum green rather than by a rule of its own: a green
  // cannot outrun GREEN_MAX, so the cross street waits at most one of those
  // plus the changeover.
  // The bound follows from the greens themselves: the longest possible green
  // (26 s, plus one 2 s extension) and the two changeovers around it, so
  // 28 + 2 x (2 + 2) = 36.
  check("no approach waits more than 36 seconds for its green",
    longestRed <= 36.5, `longest red ${longestRed.toFixed(1)} s`);
  // The headline number this was all built for.
  // Calibrated against the alternative rather than picked: with the extension
  // removed and a flat eleven second green the same city runs 52% of its greens
  // empty, and with it 37%. The bound sits between the two, so a build that
  // quietly went back to a timetable fails here.
  check("greens are mostly given to a side that has somebody on it",
    emptyGreen / anyGreen < 0.45,
    `${(emptyGreen / anyGreen * 100).toFixed(0)}% ran empty (37% adaptive, 52% on a fixed timetable)`);

  city.dispose();
}

// A vehicle held at the line for a turn that has nowhere to go blocks the whole
// approach behind it. A driver in that position goes straight on instead, and
// that escape is deliberately NOT subject to the turn arrows — vetoing it cost
// more throughput than the entire turn manager gained, so the case that matters
// is a blocked turn with the straight-ahead arrow ALSO red.
//
// Put to the model rather than grepped for. The grep version of this passed
// against a build with the veto restored, because what it matched was the
// comment explaining why the veto was gone.
{
  const city = new City();
  city.build(boundsFor(0, 0, 9, 7), 2718, 0);
  const viewer = { x: 0, y: 1.6, z: 0 };
  for (let f = 0; f < 30 * 60; f++) city.update(1 / 60, viewer);

  // A vehicle at the line, wanting to turn, with the turn's exit lane blocked.
  let probe = null;
  for (const v of city.cars) {
    if (v.arc || v.stop || v.kind !== "car") continue;
    const junction = city._nextJunction(v);
    if (!junction || junction.index + v.dir < 0 || junction.index + v.dir > city.roadX.length - 1) continue;
    const target = city._turnTarget({ ...v, turn: NEAR_SIDE_TURN }, junction);
    if (!target) continue;
    probe = { v, junction, target };
    break;
  }
  check("a vehicle to test the escape with was found", !!probe);
  if (probe) {
    const { v, junction, target } = probe;
    // Put it on the line, indicating, with the lane it wants blocked solid.
    // Placed BY MEASURED DISTANCE rather than by a guess at where the stop line
    // is: at six metres from the road centre the vehicle is already past it,
    // and the escape only applies to one still short of it.
    const coord = v.axis === "x" ? city.roadX[junction.index] : city.roadZ[junction.index];
    if (v.axis === "x") v.x = coord - v.dir * 30; else v.z = coord - v.dir * 30;
    const shift = city._nextJunction(v).distance - 1;
    if (v.axis === "x") v.x += v.dir * shift; else v.z += v.dir * shift;
    check("the probe is stopped just short of the line",
      Math.abs(city._nextJunction(v).distance - 1) < 0.01,
      `${city._nextJunction(v).distance.toFixed(2)} m from the line`);
    v.speed = 0;
    v.turn = NEAR_SIDE_TURN;
    v.mustTurn = false;
    v.turnDecidedAt = junction.index;
    const blocker = { ...v, id: "blocker", arc: null, speed: 0, length: 4.4, stop: null };
    if (target.newAxis === "x") blocker.x = target.exitProgress * target.newDir;
    else blocker.z = target.exitProgress * target.newDir;
    blocker.axis = target.newAxis;
    blocker.dir = target.newDir;
    target.lane.members = [blocker];
    check("the turn really is blocked",
      !city._turnExitClear(v, junction), "the probe did not set up the case");

    // Straight ahead is red too — the case the veto used to catch.
    const ix = v.axis === "x" ? junction.index : v.lane.roadIndex;
    const iz = v.axis === "x" ? v.lane.roadIndex : junction.index;
    const key = `${v.axis}|${v.dir}|${ix}|${iz}`;
    city.turnControl.set(key, new Map([[0, false], [NEAR_SIDE_TURN, true], [CROSSING_TURN, true]]));
    // Green, so the light is not what is holding it.
    const phase = city._phaseAt(ix, iz);
    phase.axis = v.axis;
    phase.state = "green";
    phase.until = city._clock + 20;

    v.lane.members = [v];      // nothing in front of it in its own lane
    city._driveVehicle(v, 1 / 60);
    check("a vehicle whose turn is blocked goes straight on instead of holding up the queue",
      v.turn === 0,
      "it kept indicating for a turn it could not make, with the whole approach behind it");
  }
  city.dispose();
}

// ── Destinations, kerbside spaces and the vehicles that use them ──────────
//
// Every car drives to a particular space, parks, and later sets off for another
// one. Vans offload at the kerb, buses call at laybys, and artics just pass
// through. Each number here is one that was measured wrong first:
//
//   - `blocksLane` named the KINDS that counted as out of the way, which was
//     right when loading meant an artic in the running lane. Vans load at the
//     kerb, so by kind they were still roadblocks — 38 of them, each closing
//     the lane it was parked beside, and the city stopped at 0.2 junction
//     crossings a second;
//   - a 6.6 m van claimed a single 7 m bay, four centimetres of room at each
//     end, reversed into it and clipped the car in front;
//   - pulling over began the moment a space was claimed, up to 26 m away, so
//     the vehicle drifted towards the kerb across several bays and clipped
//     whatever was parked in them;
//   - holding a vehicle straight because it was pulling in drove it off the end
//     of the grid at the one junction where straight on is not a road;
//   - and every layby was cut from the kerb and the pavement at exactly the
//     same line, leaving 158 pairs of surfaces at one depth down its side.
{
  const city = new City();
  city.build(boundsFor(0, 0, 9, 7), 2718, 0);
  const viewer = { x: 0, y: 1.6, z: 0 };

  const LANE_OFFSET_FROM_CENTRE = Math.abs(City.laneOffset("x", 1));
  const cars = city.cars.filter(v => v.kind === "car");
  const vans = city.cars.filter(v => v.kind === "van");
  check("there are delivery vans", vans.length > 5, `${vans.length} vans`);
  check("they are shorter than an artic",
    Math.max(...vans.map(v => v.length)) < Math.min(...city.cars.filter(v => v.kind === "truck").map(v => v.length)),
    "a delivery van has to fit a parking bay");
  check("every van is drawn", !!city.vehicleMeshes.van && city.vehicleMeshes.van.count === vans.length);

  // A street you can see is a street with cars parked in it.
  const parkedAtStart = city.cars.filter(v => v.stop && v.stop.kind === "park").length;
  check("the kerb has cars on it before the city has run a frame",
    parkedAtStart > cars.length * 0.3, `${parkedAtStart} of ${cars.length} cars`);
  check("every car that is driving has somewhere to be",
    cars.filter(v => !v.stop && !v.goal).length === 0,
    `${cars.filter(v => !v.stop && !v.goal).length} driving with no destination`);

  // Laybys, and the paint.
  const laybys = city._laybyRects();
  const stops = [...city.lanes.values()].reduce((n, l) => n + l.bays.filter(b => b.busStop).length, 0);
  check("every bus stop is a layby cut into the pavement",
    laybys.length === stops && stops > 0, `${laybys.length} laybys for ${stops} stops`);
  check("a layby is deep enough to take a bus out of the running lane",
    laybys.every(r => Math.max(r.x1 - r.x0, r.z1 - r.z0) >= 12
      && Math.min(r.x1 - r.x0, r.z1 - r.z0) >= 2),
    "a bus is over eleven metres long");

  let seenParked = 0;
  let seenUnloading = 0;
  let seenAtAStop = 0;
  let blockedByStopped = 0;
  let busOutsideLayby = 0;
  let articStopped = 0;
  let vanInTheLane = 0;
  let reversedIn = 0;
  const manoeuvred = new Set();
  const arrived = new Set();

  for (let f = 0; f < 15 * 60 * 60; f++) {
    city.update(1 / 60, viewer);
    for (const v of city.cars) {
      if (v.manoeuvre) manoeuvred.add(v.id);
      if (!v.stop) continue;
      if (v.stop.kind === "park") { seenParked++; arrived.add(v.id); }
      // Judged once the vehicle has finished easing over, not while it is still
      // on its way across — mid-manoeuvre it is legitimately part-way between
      // the lane and the kerb.
      const settled = Math.abs(v.kerbOffset - v.kerbTarget) < 0.01;
      if (v.stop.kind === "unload") {
        seenUnloading++;
        // A van offloads at the KERB. In the lane it is a closed road.
        if (settled && v.kerbOffset < 1.5) vanInTheLane++;
      }
      if (v.stop.kind === "busstop") {
        seenAtAStop++;
        if (settled) {
          const road = v.fixed - City.laneOffset(v.axis, v.dir);
          const across = Math.abs((v.axis === "x" ? v.z : v.x) - road);
          // Clear of the running lane on the inside, inside the layby on the
          // outside. The inner limit is derived from what has to get past it —
          // the widest vehicle in the city, in its own lane — rather than being
          // a number picked to suit the current offset.
          const widest = Math.max(...city.cars.map(x => x.width)) / 2;
          const mustClear = LANE_OFFSET_FROM_CENTRE + widest + 0.2;
          if (across - v.width / 2 < mustClear) busOutsideLayby++;
          if (across + v.width / 2 > ROAD_WIDTH / 2 + 2.6) busOutsideLayby++;
        }
      }
      // Nothing standing at the kerb may still count as being in the lane.
      if (!City.blocksLane(v) === false && v.kerbOffset - v.width / 2 >= 1.5) blockedByStopped++;
    }
    if (f % 600) continue;
    if (city.cars.some(v => v.kind === "truck" && v.stop)) articStopped++;
  }

  check("cars park", seenParked > 0, `${seenParked} sightings`);
  check("cars reach the space they set off for", arrived.size > 5, `${arrived.size} arrivals`);
  check("vans offload", seenUnloading > 0, `${seenUnloading} sightings`);
  check("buses call at their stops", seenAtAStop > 0, `${seenAtAStop} sightings`);
  check("an artic never stops in the road", articStopped === 0, `${articStopped} sightings`);
  check("a van offloads at the kerb, not in the lane",
    vanInTheLane === 0, `${vanInTheLane} sightings`);
  check("a bus at a stop is in its layby, out of the running lane",
    busOutsideLayby === 0, `${busOutsideLayby} sightings out of place`);
  check("a vehicle standing clear of the lane is not treated as blocking it",
    blockedByStopped === 0, `${blockedByStopped} sightings`);
  check("some vehicles reverse into their space",
    manoeuvred.size > 0, `${manoeuvred.size} reverse manoeuvres`);
  void reversedIn;
  city.dispose();
}

// The reverse manoeuvre, put to the model directly: the two arcs have to add up
// to exactly the distance from the running lane to the kerb, or the vehicle
// finishes the manoeuvre somewhere other than the space it was aiming at.
{
  const city = new City();
  city.build(boundsFor(0, 0, 9, 7), 4242, 0);
  const start = 0;
  const mid = City.reversePose(start, REVERSE_ANGLE, true);
  const end = City.reversePose(start, 0, false);
  check("the first arc swings the tail half way to the kerb",
    Math.abs(mid.across - PARK_OFFSET / 2) < 1e-9, `${mid.across.toFixed(3)} m`);
  check("the second brings it exactly to the kerb",
    Math.abs(end.across - PARK_OFFSET) < 1e-9, `${end.across.toFixed(3)} m`);
  check("and straightens the vehicle up again",
    Math.abs(end.turn) < 1e-9, `${(end.turn * 180 / Math.PI).toFixed(1)} deg`);
  check("the manoeuvre ends where the space is",
    Math.abs(end.along - (start - REVERSE_RUN)) < 1e-9);
  check("it never swings further out than a driver would",
    REVERSE_ANGLE < Math.PI / 4, `${(REVERSE_ANGLE * 180 / Math.PI).toFixed(0)} deg`);
  city.dispose();
}

// ── What a parking space is allowed to have next to it ────────────────────
//
// Two rules, both of which the layout broke before they were written:
//
//   - trees stood in the middle of the pavement, and the widest canopy reached
//     20 cm past the kerb — over the parking space beyond it, so a tree grew
//     through a parked car;
//   - a block side chosen for a bus stop kept its parking, leaving a row of
//     cars up to the mouth of the layby for the bus to get in and out around.
{
  for (const seed of [2718, 4242, 31337]) {
    const city = new City();
    city.build(boundsFor(0, 0, 9, 7), seed, 0);
    const lanes = [...city.lanes.values()];
    const bays = lanes.flatMap(l => l.bays);
    const stops = bays.filter(b => b.busStop);
    const spaces = bays.filter(b => !b.busStop);

    // The flat list cars choose destinations from must hold only spaces that
    // still exist. Built before the bus-stop sides are cleared it keeps the
    // ones that were removed, and cars set off for spaces that were never
    // painted and can never be parked in.
    const live = new Set(bays);
    check(`every destination on offer is a space that exists (seed ${seed})`,
      city.bayIndex.length > 0 && city.bayIndex.every(b => live.has(b)),
      `${city.bayIndex.filter(b => !live.has(b)).length} of ${city.bayIndex.length} no longer exist`);

    check(`there are still parking spaces (seed ${seed})`,
      spaces.length > 150, `${spaces.length} spaces, ${stops.length} stops`);
    check(`a block still has two bus stops (seed ${seed})`,
      stops.length === (GRID_RADIUS * 2 + 1) ** 2 * 2, `${stops.length} stops`);

    // A block side is the stretch of one lane running past one block, which is
    // one block and one road wide. Nothing may be parked along a side that has
    // a stop on it — so the nearest space on that lane is a whole side away.
    const sideLength = BLOCK_SIZE + ROAD_WIDTH;
    let tooClose = 0;
    let nearest = Infinity;
    for (const lane of lanes) {
      for (const stop of lane.bays.filter(b => b.busStop)) {
        for (const other of lane.bays) {
          if (other === stop || other.busStop) continue;
          const gap = Math.abs(other.at - stop.at);
          nearest = Math.min(nearest, gap);
          if (gap <= sideLength / 2) tooClose++;
        }
      }
    }
    check(`a block side with a bus stop has no parking on it (seed ${seed})`,
      tooClose === 0,
      `${tooClose} spaces within half a side; nearest is ${nearest.toFixed(1)} m from a stop`);

    // And nothing hangs over a space. Measured from the drawn canopies rather
    // than from where the code says it puts them.
    const canopies = city.group.children.find(n => n.name === "city-tree-canopies");
    check(`the city has trees (seed ${seed})`, !!canopies && canopies.count > 50,
      canopies ? `${canopies.count} canopies` : "no canopy mesh");
    if (canopies) {
      const m = canopies.instanceMatrix.array;
      let overRoad = 0;
      let overSpace = 0;
      const spaceAt = spaces.map(b => ({ x: b.x, z: b.z }));
      for (let i = 0; i < canopies.count; i++) {
        const e = m.slice(i * 16, i * 16 + 16);
        const x = e[12];
        const z = e[14];
        const r = Math.max(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[8], e[9], e[10]));
        const dx = Math.min(...city.roadX.map(v => Math.abs(x - v)));
        const dz = Math.min(...city.roadZ.map(v => Math.abs(z - v)));
        if (r > dx - ROAD_WIDTH / 2 || r > dz - ROAD_WIDTH / 2) overRoad++;
        if (spaceAt.some(b => Math.hypot(b.x - x, b.z - z) < r)) overSpace++;
      }
      check(`no tree reaches out over the carriageway (seed ${seed})`,
        overRoad === 0, `${overRoad} of ${canopies.count}`);
      check(`no tree stands over a parking space (seed ${seed})`,
        overSpace === 0, `${overSpace} of ${canopies.count}`);
    }
    city.dispose();
  }
}

// ── Lighting the street without paying for three hundred lights ──────────
//
// A hundred street lamps and a headlamp on the nose of every vehicle. No
// renderer will light a scene with three hundred of them; a dozen is ordinary.
// So every light carries the distance it reaches, only the ones that reach the
// view are candidates, and the nearest of those take turns in a fixed pool.
{
  const city = new City();
  city.build(boundsFor(0, 0, 9, 7), 2718, 0);
  const viewer = { x: 0, y: 1.6, z: 0 };
  for (let f = 0; f < 20 * 60; f++) city.update(1 / 60, viewer);

  check("the city has street lamps to light it",
    city.lampPosts.length > 50, `${city.lampPosts.length} lamp posts`);

  const out = [];
  city.applyTimeOfDay(0);                        // night
  city.collectLights(out, viewer, 60);
  const atNight = out.length;
  check("there are lights to choose from at night", atNight > 10, `${atNight} candidates`);
  check("every light says how far it reaches",
    out.every(l => Number.isFinite(l.distance) && l.distance > 0 && l.distance < 60),
    "a light that carries forever has to be considered everywhere");
  check("every light is finite and somewhere",
    out.every(l => [l.x, l.y, l.z, l.intensity].every(Number.isFinite) && l.intensity >= 0));
  check("the nearest come first",
    out.every((l, i) => i === 0 || out[i - 1].d2 <= l.d2 + 1e-9),
    "the pool takes the front of the list, so the order is the choice");

  // Reach really does exclude. Stated as a comparison between two radii rather
  // than against a constant, so it cannot pass by the reach being ignored.
  city.collectLights(out, viewer, 25);
  const near = out.length;
  check("a shorter view takes fewer lights into account",
    near < atNight, `${near} within 25 m against ${atNight} within 60 m`);
  check("nothing beyond the reach is offered",
    out.every(l => Math.sqrt(l.d2) <= 25 + 1e-6));

  // Street lamps burn at night and not by day; headlamps are on either way.
  city.applyTimeOfDay(1);                        // full day
  city.collectLights(out, viewer, 60);
  const byDay = out.length;
  check("the street lamps go out in daylight",
    byDay < atNight, `${byDay} by day against ${atNight} at night`);
  check("but the traffic keeps its lights on",
    byDay > 0, "vehicles run their lamps in daylight too");

  // ── The pool takes the nearest visible, and no more than it has slots ──
  {
    const candidates = [
      { x: 1, y: 0, z: 0, d2: 1, distance: 5, intensity: 1, color: 0xffffff },
      { x: 2, y: 0, z: 0, d2: 4, distance: 5, intensity: 1, color: 0xffffff },
      { x: 3, y: 0, z: 0, d2: 9, distance: 5, intensity: 1, color: 0xffffff },
      { x: 4, y: 0, z: 0, d2: 16, distance: 5, intensity: 1, color: 0xffffff },
    ];
    const chosen = [];
    City.selectLights(candidates, () => true, 2, chosen);
    check("the pool never takes more than it has slots", chosen.length === 2, `${chosen.length}`);
    check("and it takes the nearest", chosen[0].d2 === 1 && chosen[1].d2 === 4);

    City.selectLights(candidates, (l) => l.d2 !== 1, 2, chosen);
    check("a light that cannot be seen is skipped, not counted",
      chosen.length === 2 && chosen[0].d2 === 4 && chosen[1].d2 === 9,
      "skipping must not cost a slot, or the pool runs half empty facing away");

    City.selectLights(candidates, () => false, 2, chosen);
    check("nothing visible means nothing lit", chosen.length === 0);
  }

  city.dispose();
}

// The renderer's side: a pool built once and reused. The number of lights in a
// scene is something the renderer compiles its shaders around, so adding and
// removing them as you walk down a street recompiles on the move.
{
  const walk = readFileSync(new URL("../roomcad/web/walk3d.js", import.meta.url), "utf8");
  check("the street lights are a fixed pool",
    /for \(let i = 0; i < CITY_LIGHT_POOL; i\+\+\)/.test(walk));
  check("the pool is filled by the shared selection rule, not a second copy of it",
    /City\.selectLights\(this\.lightCandidates,/.test(walk));
  check("unused slots are turned down rather than removed",
    /pool\[i\]\.intensity = 0;/.test(walk),
    "removing one changes the light count and recompiles the shaders");
  check("the pool is refreshed every frame",
    /this\.updateCityLights\(\);/.test(walk));
  check("street lights cast no shadows",
    /light\.castShadow = false;/.test(walk),
    "a shadow-casting point light is six renders of the scene");
  check("what can be seen is judged on the light's reach, not the lamp's position",
    /this\.lightSphere\.radius = e\.distance;/.test(walk),
    "a lamp behind you still lights the wall in front of you");
}

// Near buildings have real rooms behind their windows — and now glass in front
// of them. Without it they read as buildings with the windows left out.
{
  const city = new City();
  city.build(boundsFor(0, 0, 9, 7), 4242, 0);
  const glass = city.group.children.find(n => n.name === "city-window-glass");
  check("the near buildings are glazed", !!glass && glass.count > 100,
    glass ? `${glass.count} panes` : "no glazing mesh at all");
  if (glass) {
    check("the glass is transparent, so the rooms behind it still show",
      glass.material.transparent === true && glass.material.opacity < 0.6,
      `opacity ${glass.material.opacity}`);
    check("and it does not write depth over what is behind it",
      glass.material.depthWrite === false);
  }
  const clashes = coplanarClashes(city.group, {
    meshNames: ["city-window-glass", "city-facades", "city-rooms-dark", "city-rooms-lit"],
  });
  check("no pane shares a plane with the masonry around it",
    clashes.length === 0, `${clashes.length} clashes`);
  city.dispose();
}

// ── Vehicles with weight ─────────────────────────────────────────────────
//
// Every car in the city used to accelerate at exactly the same rate; only its
// top speed differed. A vehicle now has a mass, and what it can do follows from
// that: acceleration is a force divided by it, cornering is limited by grip
// rather than by a flat number, and the body leans and dips because something
// with weight on springs does.
{
  const city = new City();
  city.build(boundsFor(0, 0, 9, 7), 2718, 0);
  const of = (kind) => city.cars.filter(v => v.kind === kind);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

  check("every vehicle has a mass",
    city.cars.every(v => Number.isFinite(v.mass) && v.mass > 0));
  check("an artic weighs more than a car",
    Math.min(...of("truck").map(v => v.mass)) > Math.max(...of("car").map(v => v.mass)),
    `truck from ${Math.min(...of("truck").map(v => v.mass)).toFixed(0)} kg, car to ${Math.max(...of("car").map(v => v.mass)).toFixed(0)} kg`);
  check("two vehicles of a kind are not the same weight",
    of("van").some(v => Math.abs(v.mass - of("van")[0].mass) > 100),
    "a load is most of a van's weight");

  // The point of the mass: it is what sets the acceleration.
  for (const kind of ["car", "van", "truck", "bus"]) {
    const list = of(kind);
    if (list.length < 4) continue;
    const heavy = list.slice().sort((a, b) => b.mass - a.mass)[0];
    const light = list.slice().sort((a, b) => a.mass - b.mass)[0];
    check(`a heavy ${kind} pulls away more slowly than a light one`,
      heavy.accel < light.accel - 1e-6,
      `${heavy.accel.toFixed(2)} against ${light.accel.toFixed(2)} m/s2`);
  }
  check("an artic takes far longer to reach speed than a car",
    mean(of("truck").map(v => v.accel)) < mean(of("car").map(v => v.accel)) / 2,
    `${mean(of("truck").map(v => v.accel)).toFixed(2)} against ${mean(of("car").map(v => v.accel)).toFixed(2)} m/s2`);

  // Cornering, which mass does NOT set — grip does, and the two cancel.
  {
    const R = 5.4;
    const car = City.corneringSpeed(of("car")[0], R);
    const bus = City.corneringSpeed(of("bus")[0], R);
    check("a corner is taken far slower than a straight",
      car < of("car")[0].cruise / 2, `${car.toFixed(1)} m/s against a cruise of ${of("car")[0].cruise.toFixed(1)}`);
    check("a bus corners slower than a car — it goes over before it slides",
      bus < car, `${bus.toFixed(1)} against ${car.toFixed(1)} m/s`);
    check("a wider bend can be taken faster",
      City.corneringSpeed(of("car")[0], R * 4) > car * 1.5,
      "speed goes with the square root of the radius");
  }

  // And they actually drive that way.
  let fastestCorner = 0;
  let overGrip = 0;
  let corners = 0;
  let dived = 0;
  let pitchSampled = 0;
  let pitchAgreed = 0;
  let squatted = 0;
  let leaned = 0;
  let wrongWay = 0;
  let extreme = 0;
  let nonFinite = 0;
  for (let f = 0; f < 6 * 60 * 60; f++) {
    city.update(1 / 60, { x: 0, y: 1.6, z: 0 });
    for (const v of city.cars) {
      if (!Number.isFinite(v.pitch) || !Number.isFinite(v.roll)) nonFinite++;
      if (Math.abs(v.pitch) > 0.09 || Math.abs(v.roll) > 0.12) extreme++;
      if (v.pitch > 0.01) squatted++;          // nose up under power
      if (v.pitch < -0.01) dived++;            // nose down under the brakes
      // Only while the force is firm and the springs have caught up with it,
      // so the easing lag is not counted as disagreement.
      if (Math.abs(v.accelNow) > 1.2 && Math.abs(v.pitch) > 0.008) {
        pitchSampled++;
        if (Math.sign(v.pitch) === Math.sign(v.accelNow)) pitchAgreed++;
      }
      if (!v.arc) continue;
      corners++;
      fastestCorner = Math.max(fastestCorner, v.speed);
      // A tenth of a metre a second of slack for the frame it is entered on.
      if (v.speed > City.corneringSpeed(v, v.arc.r) + 0.1) overGrip++;
      if (Math.abs(v.roll) > 0.005) {
        leaned++;
        // Leaning OUT of the corner: a right-hand turn sweeps positive, and the
        // body should go the other way.
        if (Math.sign(v.roll) === Math.sign(v.arc.sweep)) wrongWay++;
      }
    }
  }
  check("vehicles were seen going round corners", corners > 1000, `${corners} vehicle-frames`);
  check("nothing corners harder than its tyres allow",
    overGrip === 0, `${overGrip} of ${corners} vehicle-frames over the limit`);
  check("the suspension is always somewhere", nonFinite === 0, `${nonFinite} frames`);
  check("and never in an absurd place", extreme === 0, `${extreme} frames beyond a few degrees`);
  check("the nose dips under the brakes", dived > 1000, `${dived} frames`);
  check("and lifts under power", squatted > 1000, `${squatted} frames`);
  // Which way round, not just that it moves. Counting dips and lifts alone
  // passes just as happily with the sign inverted — a car that lifts its nose
  // under the brakes does both, only backwards.
  check("the nose goes the way the forces send it",
    pitchAgreed > pitchSampled * 0.9,
    `${pitchAgreed} of ${pitchSampled} hard accelerations tilted the right way`);
  check("the body leans in a corner", leaned > 200, `${leaned} frames`);
  check("and leans out of it, not into it",
    wrongWay === 0, `${wrongWay} of ${leaned} leaned the wrong way`);

  city.dispose();
}

const EXPECTED = [
  "build threw",
  "a city with no geometry at all",
  "a non-finite position",
  "a non-finite scale",
  "a zero-scaled copy, which renders as nothing",
  "geometry far outside the neighbourhood",
  "geometry at an impossible height",
  "applyTimeOfDay threw",
  "a non-finite emissive strength",
  "update threw",
  "a car at a non-finite position",
  "a car driven off the map",
  "a car in reverse",
  "a car above its own top speed",
  "a car with no direction",
  "a car that has drifted out of its lane",
  "a car whose lane disagrees with where it is pointing",
  "a city does not recognise its own inputs",
  "a city claims to match a different seed",
];
for (const name of EXPECTED) {
  const v = violations.get(name);
  check(`never: ${name}`, !v, v ? `${v.count} times, e.g. ${v.first}` : "");
}

console.log(`${passed} passed, ${failed} failed — city built ${built} times, ${totalInstances} placements checked`);
if (failed) process.exit(1);
