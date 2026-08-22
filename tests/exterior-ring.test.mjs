// Contracts for the 3D exterior: the editable canvas must never be visible
// through a window. The actual wall envelope owns the indoor slab/roof, then
// a pedestrian ring, road ring, crossings and street links begin outside it.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const walk = readFileSync(join(root, "roomcad", "web", "walk3d.js"), "utf8");

let failed = 0;
function check(name, condition) {
  if (!condition) {
    failed++;
    console.error("FAIL: " + name);
  }
}

check("building envelope is distinct from the editor canvas", walk.includes("buildingBounds(room)"));
check("floor uses the real building envelope", walk.includes("new THREE.BoxGeometry(building.width, 0.06, building.length)"));
check("ceiling uses the real building envelope", walk.includes("new THREE.BoxGeometry(building.width, 0.05, building.length)"));
check("city ring is centred on the building", walk.includes("group.position.set(building.centerX, 0, building.centerZ);"));
check("pedestrian ring has an explicit width", walk.includes("const PEDESTRIAN_RING_WIDTH = 2.4;"));
check("road ring has an explicit width", walk.includes("const RING_ROAD_WIDTH = 7.0;"));
check("exterior creates pavement directly beside walls", walk.includes("addSurface(building.width + PEDESTRIAN_RING_WIDTH * 2, PEDESTRIAN_RING_WIDTH"));
check("exterior creates a full road ring", walk.includes("addSurface(building.width + PEDESTRIAN_RING_WIDTH * 2 + RING_ROAD_WIDTH * 2, RING_ROAD_WIDTH"));
check("road ring connects to the city in four directions", (walk.match(/ROAD_CONNECTOR_LENGTH/g) || []).length >= 5);
check("road crossings are rendered", walk.includes("const stripeWidth = RING_ROAD_WIDTH * 0.76;"));

if (failed) process.exit(1);
console.log("10 passed, 0 failed — exterior ring contracts");
