// Can you actually stand on the city?
//
// The neighbourhood was scenery: 2000 metres of street you could see through a
// window and walk straight through. Shoot out a pane, climb out, and you sank
// through the pavement — there were no colliders outside the room at all, only
// four invisible walls round the edge of the plan area to stop you finding out.
//
// This drops a player-sized capsule onto the city from above, all over it, and
// checks where it comes to rest. Run with the real Rapier build the app uses,
// because the question is what that solver does with these boxes, not what the
// geometry says it ought to.
//
// Run:  node tests/city-physics.test.mjs

import * as RAPIER from "../roomcad/web/lib/rapier.mjs";
import { loadWebModule } from "./harness/load-web-module.mjs";

const {
  City, BLOCK_SIZE, ROAD_WIDTH, KERB_HEIGHT, GRID_RADIUS, SIDEWALK,
} = await loadWebModule("city.js");

// The player, as walk3d builds them.
const STAND_HALF_HEIGHT = 0.55;
const PLAYER_RADIUS = 0.20;
const GRAVITY = 11;
const ROAD_Y = -KERB_HEIGHT;
const PAVEMENT_Y = 0;

let passed = 0;
let failed = 0;
function check(name, condition, detail = "") {
  if (condition) { passed++; return; }
  failed++;
  console.error("FAIL: " + name + (detail ? " — " + detail : ""));
}

await RAPIER.init();

const bounds = (w, l) => ({
  minX: -w / 2, maxX: w / 2, minZ: -l / 2, maxZ: l / 2,
  width: w, length: l, centerX: 0, centerZ: 0, minY: 0, maxY: 3,
});

const city = new City();
city.build(bounds(9, 7), 2718, 0);
const span = Math.max(BLOCK_SIZE, 9 + SIDEWALK * 4, 7 + SIDEWALK * 4) + ROAD_WIDTH;
const block = span - ROAD_WIDTH;

// ── The solids themselves ────────────────────────────────────────────────
check("the city says what can be stood on",
  Array.isArray(city.solids) && city.solids.length > 50, `${city.solids ? city.solids.length : 0} solids`);
check("every solid is a real box",
  city.solids.every(s => [s.x, s.y, s.z, s.w, s.h, s.d].every(Number.isFinite)
    && s.w > 0 && s.h > 0 && s.d > 0),
  "a zero or non-finite box is a hole in the ground");
check("the carriageway is the lowest thing to stand on",
  Math.abs(city.groundY() - ROAD_Y) < 1e-9, `${city.groundY()}`);

// ── A world made of nothing but the city ────────────────────────────────
const world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
for (const s of city.solids) {
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(s.w / 2, s.h / 2, s.d / 2).setTranslation(s.x, s.y, s.z)
  );
}

/// Drops a capsule from well above a point and reports where its feet stop.
function dropAt(x, z, from = 30) {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(x, from, z).lockRotations()
  );
  const collider = world.createCollider(
    RAPIER.ColliderDesc.capsule(STAND_HALF_HEIGHT, PLAYER_RADIUS)
      .setTranslation(0, STAND_HALF_HEIGHT + PLAYER_RADIUS, 0),
    body
  );
  let last = from;
  for (let i = 0; i < 600; i++) {
    world.timestep = 1 / 60;
    world.step();
    const y = body.translation().y;
    if (Math.abs(y - last) < 1e-5 && i > 60) break;
    last = y;
  }
  const rest = body.translation().y;
  world.removeCollider(collider, false);
  world.removeRigidBody(body);
  return rest;
}

// ── The middle of a road ─────────────────────────────────────────────────
{
  let onTheRoad = 0;
  let fellThrough = 0;
  let worst = 0;
  const roads = city.roadX;
  for (let i = 0; i < roads.length; i++) {
    for (const along of [-span, 0, span]) {
      const y = dropAt(roads[i], along + span * 0.5);
      if (y < ROAD_Y - 1) { fellThrough++; continue; }
      if (Math.abs(y - ROAD_Y) < 0.05) onTheRoad++;
      worst = Math.max(worst, Math.abs(y - ROAD_Y));
    }
  }
  check("nobody falls through the road", fellThrough === 0, `${fellThrough} drops`);
  check("standing in the road puts you on the carriageway",
    onTheRoad > roads.length * 2, `${onTheRoad} of ${roads.length * 3} landed at road level`);
  void worst;
}

// ── The pavement, one kerb up ───────────────────────────────────────────
//
// The points are taken FROM the solids rather than guessed at from the block
// grid: a guessed point lands in a courtyard, or on a bus layby, and the test
// reports the city as broken when it is the test that was wrong.
const buildings = city.solids.filter(s => s.h > 2);
const pavements = city.solids.filter(s => Math.abs(s.h - KERB_HEIGHT) < 1e-6);
const insideABuilding = (x, z) => buildings.some(b =>
  Math.abs(x - b.x) < b.w / 2 + PLAYER_RADIUS && Math.abs(z - b.z) < b.d / 2 + PLAYER_RADIUS);

{
  check("the city has pavements and buildings",
    pavements.length > 20 && buildings.length > 10,
    `${pavements.length} pavement pieces, ${buildings.length} buildings`);

  let onThePavement = 0;
  let tried = 0;
  for (const pad of pavements) {
    // The middle of the piece, if that is clear of any building standing on it.
    if (pad.w < 1.5 || pad.d < 1.5) continue;
    if (insideABuilding(pad.x, pad.z)) continue;
    if (tried >= 40) break;
    tried++;
    if (Math.abs(dropAt(pad.x, pad.z) - PAVEMENT_Y) < 0.05) onThePavement++;
  }
  check("the pavement is a step up from the road, and you stand on it",
    tried > 10 && onThePavement === tried,
    `${onThePavement} of ${tried} landed at pavement level`);
  // Measured as a step between two drops rather than restated from the
  // constants, which would be arithmetic rather than a test.
  {
    const pad = pavements.find(x => x.w > 4 && x.d > 4 && !insideABuilding(x.x, x.z));
    const road = city.roadX.reduce((best, r) =>
      Math.abs(r - pad.x) < Math.abs(best - pad.x) ? r : best, city.roadX[0]);
    const step = dropAt(pad.x, pad.z) - dropAt(road, pad.z);
    check("the kerb is a step up of the height it looks",
      Math.abs(step - KERB_HEIGHT) < 0.02, `stepped up ${step.toFixed(3)} m`);
  }

  // A bus layby is a piece cut out of the pavement, down at road level. Walk
  // into one and you should walk DOWN into it, not across thin air at kerb
  // height — the paving and the thing you stand on are cut to one shape.
  {
    const laybys = city._laybyRects();
    check("the city has bus laybys to walk into", laybys.length > 0, `${laybys.length}`);
    let atRoadLevel = 0;
    let tried = 0;
    for (const r of laybys) {
      if (tried >= 12) break;
      tried++;
      const y = dropAt((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2);
      if (Math.abs(y - ROAD_Y) < 0.05) atRoadLevel++;
    }
    check("a bus layby is floored at road level, like the road it opens onto",
      tried > 0 && atRoadLevel === tried,
      `${atRoadLevel} of ${tried} — the rest were still at pavement height`);
  }
}

// ── Buildings are solid ─────────────────────────────────────────────────
{
  // Dropped onto a building, you land on its roof rather than inside it or on
  // the pavement underneath.
  let onTheRoof = 0;
  let tried = 0;
  for (const b of buildings) {
    if (tried >= 24) break;
    tried++;
    const roof = b.y + b.h / 2;
    const y = dropAt(b.x, b.z, roof + 40);
    if (Math.abs(y - roof) < 0.05) onTheRoof++;
  }
  check("a building is solid, not a picture of one",
    tried > 10 && onTheRoof === tried, `${onTheRoof} of ${tried} landed on the roof`);
}

// ── Nowhere in the whole neighbourhood swallows you ─────────────────────
{
  const reach = GRID_RADIUS * span + block / 2;
  let swallowed = 0;
  let tried = 0;
  for (let x = -reach; x <= reach; x += span / 3) {
    for (let z = -reach; z <= reach; z += span / 3) {
      tried++;
      if (dropAt(x, z, 120) < ROAD_Y - 1) swallowed++;
    }
  }
  check("there is ground everywhere in the city",
    swallowed === 0, `${swallowed} of ${tried} sample points had nothing under them`);
}

// ── You cannot walk through a wall of a building ────────────────────────
{
  // Pushed hard at a building from the pavement, the capsule is stopped by it.
  const target = city.solids.find(s => s.h > 4);
  check("the city has a building to walk into", !!target);
  if (target) {
    const startX = target.x - target.w / 2 - 3;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(startX, PAVEMENT_Y + 0.2, target.z).lockRotations()
    );
    world.createCollider(
      RAPIER.ColliderDesc.capsule(STAND_HALF_HEIGHT, PLAYER_RADIUS)
        .setTranslation(0, STAND_HALF_HEIGHT + PLAYER_RADIUS, 0),
      body
    );
    for (let i = 0; i < 240; i++) {
      const v = body.linvel();
      body.setLinvel({ x: 4, y: v.y, z: 0 }, true);
      world.timestep = 1 / 60;
      world.step();
    }
    const stoppedAt = body.translation().x;
    check("walking into a building stops you at its wall",
      stoppedAt < target.x - target.w / 2 + 0.05,
      `reached ${stoppedAt.toFixed(2)}, the wall is at ${(target.x - target.w / 2).toFixed(2)}`);
  }
}

city.dispose();
console.log(`${passed} passed, ${failed} failed — the city as something to walk on`);
if (failed) process.exit(1);
