// The 3D view builds a stylised city around the room so the walkthrough has a
// sense of scale and place. The city is a SEPARATE module (city.js) that knows
// nothing about the room model — walk3d.js hands it a building envelope. That
// decoupling is the contract this file protects, along with the performance
// and correctness rules that keep the city from degrading the room itself.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const walk = readFileSync(join(root, "roomcad", "web", "walk3d.js"), "utf8");
const city = readFileSync(join(root, "roomcad", "web", "city.js"), "utf8");

let failed = 0;
let passed = 0;
function check(name, condition) {
  if (!condition) {
    failed++;
    console.error("FAIL: " + name);
  } else {
    passed++;
  }
}

// — Decoupling —————————————————————————————————————————————
check("the city lives in its own module", city.length > 0);
check("the city never imports the room model", !city.includes('from "./plan.js"'));
check("the city never imports the editing store", !city.includes('from "./store.js"'));
check("walk3d owns the integration, not the city", walk.includes('from "./city.js"'));
check("the city is handed a building envelope, not a room",
  city.includes("build(bounds, seed, floorLift)"));

// — Performance ————————————————————————————————————————————
check("the city is instanced, not one mesh per building",
  city.includes("new THREE.InstancedMesh("));
check("city scenery never casts into the room's shadow maps",
  !/castShadow\s*=\s*true/.test(city));
check("the city is not rebuilt on every room edit",
  walk.includes("if (!this.city.matches(bounds, seed, lift)) this.city.build(bounds, seed, lift);"));
check("scene teardown preserves persistent subtrees",
  walk.includes("const persistent = this.scene.children.filter(c => c.userData && c.userData.persistent);") &&
  walk.includes("for (const node of persistent) this.scene.add(node);"));
check("the city releases its own GPU resources", city.includes("dispose()") &&
  walk.includes("this.city.dispose();"));

// — Correctness ————————————————————————————————————————————
check("the same room always yields the same city (seeded, not random)",
  !city.includes("Math.random()") && city.includes("makeRandom(seed)"));
check("the room's plot is never paved over",
  city.includes("_padLayer(flats, rect, hole,"));
check("pavement tops out at the room's own floor level",
  city.includes("const PAVEMENT_Y = 0;") && city.includes("const ROAD_Y = PAVEMENT_Y - KERB_HEIGHT;"));
check("the city sits in the scene, never in the floor-lifted room group",
  walk.includes("this.scene.add(this.city.group)") && !walk.includes("roomGroup.add(this.city"));
check("traffic is animated from the render loop", walk.includes("this.city.update(dt);"));
check("city lighting follows the same daylight as the sun",
  walk.includes("this.city.applyTimeOfDay(dayAmount * (day ? 1 : 0));"));

// — Nothing the city builds shares a depth with the room —————————
// A surface at exactly the room's floor level z-fights across the whole floor
// and reads as flicker. The tower under an upper-floor room is the one piece
// of city geometry that can reach that height, so it has to stop clear of the
// slab rather than level with it.
check("the tower stops below the room's floor slab",
  city.includes("floorLift - ROOM_SLAB_THICKNESS - TOWER_REVEAL"));
check("the slab thickness the tower avoids matches the one walk3d builds",
  /ROOM_SLAB_THICKNESS = 0\.06/.test(city) &&
  walk.includes("new THREE.BoxGeometry(building.width, 0.06, building.length)"));
check("the tower keeps a positive height even for a shallow lift",
  city.includes("Math.max(0.05, floorLift - ROOM_SLAB_THICKNESS - TOWER_REVEAL)"));

// — The render loop must not churn the heap ————————————————————
// The traffic runs every frame. Allocating a fresh matrix per car per part was
// roughly 11,500 throwaway objects a second, which is real GC pressure in the
// one place that has a 16 ms budget.
{
  const carPath = city.slice(city.indexOf("_writeCarMatrices() {"),
    city.indexOf("/// Advances the traffic"));
  const calls = (carPath.match(/boxMatrix\(/g) || []).length;
  const scratch = (carPath.match(/, _m\s*\)/g) || []).length;
  check("the per-frame car path allocates no matrices", calls > 0 && calls === scratch,
    `${scratch} of ${calls} reuse the scratch matrix`);
  check("boxMatrix can compose into a caller's matrix",
    city.includes("into = null") && city.includes("(into || new THREE.Matrix4())"));
}
check("the 3D viewmodel reuses its offset vector rather than allocating each frame",
  walk.includes("_gunOffset.set(") && !/updateGun[\s\S]{0,400}new THREE\.Vector3/.test(walk));

// — The room's own environment is unchanged ————————————————————
check("Singapore latitude remains", walk.includes("const SG_LAT = 1.3521;"));
check("Singapore longitude remains", walk.includes("const SG_LON = 103.8198;"));
check("solar position is calculated from the chosen hour",
  walk.includes("const { altitude, azimuth } = sunForHour(hour);"));
check("sun position continues to follow the calculated direction",
  walk.includes("this.sun.position.set(cx + dir.x * dist"));

if (failed) process.exit(1);
console.log(`${passed} passed, 0 failed — city + 3D environment contracts`);
