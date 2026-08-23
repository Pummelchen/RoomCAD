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

const {
  City, BLOCK_SIZE, ROAD_WIDTH, SIDEWALK, KERB_HEIGHT, GRID_RADIUS,
  ROOM_SLAB_THICKNESS, WEATHER_KINDS, NEAR_SIDE_TURN, CROSSING_TURN, seedFromString,
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
      if (Math.abs(cross - car.fixed) > 1e-6) {
        note("a car that has drifted out of its lane", (cross - car.fixed).toExponential(1));
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
      for (let i = 0; i < city.cars.length; i++) {
        for (let j = i + 1; j < city.cars.length; j++) {
          const A = city.cars[i];
          const B = city.cars[j];
          const key = i + ":" + j;
          if (Math.hypot(A.x - B.x, A.z - B.z) > 20) { seenPairs.delete(key); continue; }
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
  check("they turn often enough to actually circulate", turnsCompleted > 600,
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
  // Joining a lane out of a turn is the one discontinuous move left, and there
  // are now three times as many turns as there were: the grid is closed, so
  // every vehicle that reaches the edge turns along it instead of being
  // wrapped round to the far side. Measured across seeds at 19-29 brief
  // contacts per fifteen minutes of city time — about one every 36 seconds
  // across 64 vehicles. This is the ceiling on that, not a target.
  check("vehicles almost never end up inside one another",
    overlapping <= 45, `${overlapping} contacts in 15 minutes: ${worstConflict}`);
  check("the traffic never gridlocks",
    movingSamples > 0 && movingTotal / movingSamples > 64 / 4,
    `${(movingTotal / Math.max(1, movingSamples)).toFixed(1)} of ${city.cars.length} moving on average`);
  check("and it covers real distance", distanceDriven > 100_000,
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
  check("the fleet is the size it is meant to be", city.cars.length === 80,
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
  const watched = city.cars.find(v => v.kind === "car");
  const paces = [watched.pace];
  let turns = 0;
  let wasTurning = false;
  for (let f = 0; f < 54000; f++) {
    city.update(1 / 60, viewer);
    if (wasTurning && !watched.arc) { turns++; paces.push(watched.pace); }
    wasTurning = !!watched.arc;
  }
  check("a vehicle takes several turns in fifteen minutes", turns >= 4, `${turns} turns`);
  check("and picks a new pace coming out of each one",
    new Set(paces.map(p => p.toFixed(6))).size === paces.length,
    `${new Set(paces.map(p => p.toFixed(6))).size} distinct over ${paces.length}`);
  check("every one of them is still inside the range",
    paces.every(p => p >= 0.9 - 1e-9 && p <= 1.2 + 1e-9),
    `${Math.min(...paces).toFixed(2)}-${Math.max(...paces).toFixed(2)}`);

  // Drawn from the vehicle's own stream, so the city is still reproducible.
  const twin = new City();
  twin.build(boundsFor(0, 0, 9, 7), 2718, 0);
  const twinWatched = twin.cars.find(v => v.kind === "car");
  const twinPaces = [twinWatched.pace];
  wasTurning = false;
  for (let f = 0; f < 54000; f++) {
    twin.update(1 / 60, viewer);
    if (wasTurning && !twinWatched.arc) twinPaces.push(twinWatched.pace);
    wasTurning = !!twinWatched.arc;
  }
  check("the same city still behaves identically every time it is opened",
    JSON.stringify(paces) === JSON.stringify(twinPaces),
    `${paces.length} vs ${twinPaces.length} changes`);
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
  const starts = seen.filter(e => e.x === "green");
  check("the cycle is 30 seconds, as asked",
    starts.length >= 2 && Math.abs((starts[1].t - starts[0].t) - 30) < 0.1,
    starts.length >= 2 ? `${(starts[1].t - starts[0].t).toFixed(2)} s` : "never went green");
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
  const kinds = ["car", "truck", "bus"];
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
  const { readFileSync } = await import("node:fs");
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
