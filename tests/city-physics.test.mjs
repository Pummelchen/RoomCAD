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
import { readFileSync } from "node:fs";
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

// ── The hole the city leaves for the building must be floored ────────────
//
// The city does not pave the building's own plot — paving there would push a
// slab up inside a ground-floor room. So the room's floor has to cover that
// plot exactly, and the plot is cut to the building ENVELOPE: the declared room
// together with every wall drawn beyond it.
//
// Cut the floor to the declared room instead and a multi-room plan is left with
// a ring of nothing between the two: no floor, because the room said it was
// smaller, and no pavement, because the city thought a building was standing
// there. You walk off the edge of the floor and drop to the street. That is
// exactly what 7.0 shipped.
{
  const unpaved = (x, z) => !pavements.some(pad =>
    Math.abs(x - pad.x) <= pad.w / 2 && Math.abs(z - pad.z) <= pad.d / 2);

  // Where the city stopped paving, around the room's own plot.
  const plot = { x0: -9 / 2, x1: 9 / 2, z0: -7 / 2, z1: 7 / 2 };
  let bare = 0;
  let tested = 0;
  for (let x = plot.x0 - 1; x <= plot.x1 + 1; x += 0.5) {
    for (let z = plot.z0 - 1; z <= plot.z1 + 1; z += 0.5) {
      tested++;
      if (unpaved(x, z)) bare++;
    }
  }
  check("the city really does leave the building's plot unpaved",
    bare > 0, "nothing to floor, so nothing to check");

  // Every bare square metre has to fall inside what the room floors, which is
  // the envelope plus a wall thickness. Stated from the envelope the city was
  // built with, because that is the shape the hole was cut to.
  const floored = { x0: -9 / 2 - 0.3, x1: 9 / 2 + 0.3, z0: -7 / 2 - 0.3, z1: 7 / 2 + 0.3 };
  let outside = 0;
  for (let x = plot.x0 - 1; x <= plot.x1 + 1; x += 0.5) {
    for (let z = plot.z0 - 1; z <= plot.z1 + 1; z += 0.5) {
      if (!unpaved(x, z)) continue;
      if (x < floored.x0 || x > floored.x1 || z < floored.z0 || z > floored.z1) outside++;
    }
  }
  check("nothing the city left unpaved falls outside what the room floors",
    outside === 0,
    `${outside} of ${bare} bare points are beyond the floor — you would fall through there`);

  // And the renderer must size that floor to the envelope, not to the declared
  // room. Matched on the assignment, because it is the value that matters.
  const walk = readFileSync(new URL("../roomcad/web/walk3d.js", import.meta.url), "utf8");
  check("the room floor is sized to the building envelope",
    /const envelope = this\.currentBuildingBounds \|\| this\.buildingBounds\(room\);/.test(walk)
    && /const fw = envelope\.width \/ 2 \+ pad;/.test(walk),
    "sizing it to room.width leaves a multi-room plan standing over nothing");
  check("and not to the whole editing canvas",
    !/cuboid\(canvas\.width \/ 2, 0\.03, canvas\.length \/ 2\)/.test(walk),
    "the canvas is bigger than the building and hangs a slab over the street");
}


// ── Knocking a hole in a building ────────────────────────────────────────
//
// A paintball takes a metre square out of a wall, in the masonry AND in what
// holds you up. The two are cut from the same box by the same routine, because
// cutting them separately is how you get a hole you can see through and not
// walk through — or, worse, one you can walk through and not see.
{
  const hitCity = new City();
  hitCity.build(bounds(9, 7), 2718, 0);
  const facades = hitCity.group.children.find(n => n.name === "city-facades");

  check("the facade mesh keeps slots free for damage",
    facades.instanceMatrix.count > facades.count,
    `${facades.instanceMatrix.count - facades.count} spare of ${facades.instanceMatrix.count}`);

  const tall = hitCity.solids.filter(s => s.h > 4).sort((a, b) => b.h - a.h)[0];
  const face = tall.x - tall.w / 2;
  const wallsBefore = facades.count;
  const solidsBefore = hitCity.solids.length;

  const hole = hitCity.punchHole({ x: face + 0.02, y: 1.2, z: tall.z }, { x: -1, y: 0, z: 0 });
  check("a shot at a wall makes a hole", !!hole);
  check("the wall it hit becomes the pieces around the hole",
    facades.count > wallsBefore, `${wallsBefore} -> ${facades.count} instances`);
  // The masonry itself, not just the instance count. Splitting the wall into
  // more pieces while leaving the original standing gives a building that has
  // a hole in what you walk through and none in what you look at.
  {
    const m = facades.instanceMatrix.array;
    const centre = { x: face + 0.02, y: (tall.y - tall.h / 2) + 0.5, z: tall.z };
    let covering = 0;
    for (let i = 0; i < facades.count; i++) {
      const e = m.slice(i * 16, i * 16 + 16);
      const bx = { x: e[12], y: e[13], z: e[14], w: e[0], h: e[5], d: e[10] };
      if (Math.abs(centre.x - bx.x) <= bx.w / 2
        && Math.abs(centre.y - bx.y) <= bx.h / 2
        && Math.abs(centre.z - bx.z) <= bx.d / 2) covering++;
    }
    check("there is no masonry left where the hole is",
      covering === 0, `${covering} pieces of wall still fill it`);
  }

  check("and so does what holds you up",
    hole.brokeCollision && hitCity.solids.length > solidsBefore,
    `${solidsBefore} -> ${hitCity.solids.length} solids`);

  // The hole is a metre square, sitting on the pavement because the shot was on
  // the ground storey. Measured as the gap left in the collision.
  {
    const base = tall.y - tall.h / 2;
    // "Not the ground" is anything standing above pavement level, not anything
    // over a given height: the pieces left beside a hole are only a metre tall
    // and they are very much walls.
    const blocking = (y, z) => hitCity.solids.some(sd =>
      sd.y + sd.h / 2 > PAVEMENT_Y + 0.01
      && Math.abs(face + 0.5 - sd.x) <= sd.w / 2
      && Math.abs(z - sd.z) <= sd.d / 2
      && Math.abs(y - sd.y) <= sd.h / 2);
    check("the hole is open at pavement level",
      !blocking(base + 0.2, tall.z), "a sill you cannot step over is not a way in");
    check("the hole is about a metre tall",
      !blocking(base + 0.9, tall.z) && blocking(base + 1.4, tall.z),
      "open at 0.9 m and closed at 1.4 m");
    check("the hole is about a metre wide",
      !blocking(base + 0.5, tall.z) && blocking(base + 0.5, tall.z + 1.2),
      "open on the centreline and closed 1.2 m to the side");
    check("the rest of the building is still standing",
      blocking(base + 4, tall.z), "the storeys above the hole must not fall in");
  }

  // And you can get through it — crouched, because a metre is not standing
  // height and no amount of geometry makes it one.
  {
    const world2 = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    for (const sd of hitCity.solids) {
      world2.createCollider(
        RAPIER.ColliderDesc.cuboid(sd.w / 2, sd.h / 2, sd.d / 2).setTranslation(sd.x, sd.y, sd.z));
    }
    const walk = (halfH) => {
      const body = world2.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(face - 3, 0.05, tall.z).lockRotations());
      const col = world2.createCollider(
        RAPIER.ColliderDesc.capsule(halfH, PLAYER_RADIUS).setTranslation(0, halfH + PLAYER_RADIUS, 0), body);
      for (let i = 0; i < 700; i++) {
        const v = body.linvel();
        body.setLinvel({ x: 2.6, y: v.y, z: 0 }, true);
        world2.timestep = 1 / 60;
        world2.step();
      }
      const x = body.translation().x;
      world2.removeCollider(col, false);
      world2.removeRigidBody(body);
      return x;
    };
    check("you can duck through the hole", walk(0.25) > face + 0.4,
      "crouched, the way a person gets through a metre-high hole");
    check("but not stroll through it upright", walk(STAND_HALF_HEIGHT) < face + 0.4,
      "a metre is a metre — if this passes, the hole is bigger than it says");
  }

  hitCity.dispose();
}

// A wall the shot did not hit is untouched, and the spare slots run out rather
// than overrunning the mesh.
{
  const c2 = new City();
  c2.build(bounds(9, 7), 4242, 0);
  const mesh = c2.group.children.find(n => n.name === "city-facades");
  const capacity = mesh.instanceMatrix.count;
  const tall = c2.solids.filter(s => s.h > 4).sort((a, b) => b.h - a.h)[0];
  let made = 0;
  for (let i = 0; i < 400; i++) {
    const z = tall.z - tall.d / 2 + 0.4 + (i % 30) * 0.45;
    if (c2.punchHole({ x: tall.x - tall.w / 2 + 0.02, y: 0.8, z }, { x: -1, y: 0, z: 0 })) made++;
  }
  check("a lot of shots make a lot of holes", made > 5, `${made} holes`);
  check("the mesh is never overrun",
    mesh.count <= capacity, `${mesh.count} of ${capacity}`);
  check("every instance is still a real box",
    (() => {
      const a = mesh.instanceMatrix.array;
      for (let i = 0; i < mesh.count * 16; i++) if (!Number.isFinite(a[i])) return false;
      return true;
    })());
  c2.dispose();
}

city.dispose();
console.log(`${passed} passed, ${failed} failed — the city as something to walk on`);
if (failed) process.exit(1);
