// The built-in Three.js city is intentionally absent. A future city library
// can be integrated separately without coupling it to the room renderer.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const walk = readFileSync(join(root, "roomcad", "web", "walk3d.js"), "utf8");

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

check("no Three.js generator imports remain", !walk.includes("addons/generators/"));
check("no city build method remains", !walk.includes("buildCity("));
check("no exterior road ring remains", !walk.includes("buildExteriorRing("));
check("no city scene state remains", !walk.includes("cityGenerator"));
check("no tree generator state remains", !walk.includes("treeMaterial"));
check("no terrain generator state remains", !walk.includes("terrainGenerator"));
check("Singapore latitude remains", walk.includes("const SG_LAT = 1.3521;"));
check("Singapore longitude remains", walk.includes("const SG_LON = 103.8198;"));
check("solar position is calculated from the chosen hour", walk.includes("const { altitude, azimuth } = sunForHour(hour);"));
check("sun position continues to follow the calculated direction", walk.includes("this.sun.position.set(cx + dir.x * dist"));

if (failed) process.exit(1);
console.log(`${passed} passed, 0 failed — standalone 3D environment contracts`);
