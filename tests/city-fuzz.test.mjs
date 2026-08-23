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

const { City, BLOCK_SIZE, ROAD_WIDTH, GRID_RADIUS, ROOM_SLAB_THICKNESS, seedFromString } =
  await loadWebModule("city.js");

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
  for (const dt of [0, 1 / 120, 1 / 60, 0.05, 0.1, 1, 5, -1]) {
    try { city.update(dt); }
    catch (err) { note("update threw", `dt ${dt}: ${err.message}`); }
  }
  // A car runs along one axis: `pos` is how far down the lane it is, `fixed`
  // is the other coordinate. After any number of frames it must still be on
  // its own lane, between the two ends it wraps between.
  for (const car of city.cars) {
    if (!finite(car.pos) || !finite(car.fixed)) { note("a car at a non-finite position", car.axis); continue; }
    const start = car.center - car.reach;
    const limit = car.center + car.reach;
    if (car.pos < start - 1e-6 || car.pos > limit + 1e-6) {
      note("a car driven off the end of its lane", `${car.pos.toFixed(0)} outside ${start.toFixed(0)}..${limit.toFixed(0)}`);
    }
    const x = car.axis === "x" ? car.pos : car.fixed;
    const z = car.axis === "x" ? car.fixed : car.pos;
    if (Math.abs(x - centerX) > reach * 2 || Math.abs(z - centerZ) > reach * 2) {
      note("a car driven off the map", `${x.toFixed(0)},${z.toFixed(0)}`);
    }
    if (!(car.speed > 0)) note("a car that never moves", String(car.speed));
    if (car.dir !== 1 && car.dir !== -1) note("a car with no direction", String(car.dir));
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
  check("the city is driven with that same capped value",
    /this\.city\.update\(dt\)/.test(walk));
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
  "a car driven off the end of its lane",
  "a car that never moves",
  "a car with no direction",
  "a city does not recognise its own inputs",
  "a city claims to match a different seed",
];
for (const name of EXPECTED) {
  const v = violations.get(name);
  check(`never: ${name}`, !v, v ? `${v.count} times, e.g. ${v.first}` : "");
}

console.log(`${passed} passed, ${failed} failed — city built ${built} times, ${totalInstances} placements checked`);
if (failed) process.exit(1);
