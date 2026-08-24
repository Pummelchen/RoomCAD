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
// Comments discuss the very calls being checked for, so anything that asserts
// a call HAPPENS has to look at code only — commenting a line out otherwise
// leaves the text in place and the check still passes.
const walkCode = walk.split("\n").filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
const city = readFileSync(join(root, "roomcad", "web", "city.js"), "utf8");
const store = readFileSync(join(root, "roomcad", "web", "store.js"), "utf8");

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
// The PLACE is reproducible; what the traffic does in it is not. Reopening a
// room must give back the same buildings, the same hills and the same lit
// windows — and cars that make different decisions than last time.
check("the city itself is built from the seed, not from chance",
  city.includes("makeRandom(seed)"));
{
  // Real randomness is reached for in exactly one place, so this can check
  // that the geometry never touches it.
  const rolls = (city.match(/Math\.random\(\)/g) || []).length;
  check("real randomness has a single entry point", rolls === 1, `${rolls} uses`);
  check("and it is the named helper", /function trueRandom\(\) \{\s*\n\s*return Math\.random\(\);/.test(city));
  const buildPath = city.slice(city.indexOf("build(bounds, seed, floorLift) {"),
    city.indexOf("// MARK: - Traffic"));
  check("nothing that builds the city uses it",
    !buildPath.includes("trueRandom"),
    "the same room would stop looking the same");
  check("but the turn a vehicle takes does",
    /const r = trueRandom\(\);/.test(city));
}
check("the room's plot is never paved over",
  city.includes("_padLayer(flats, rect, hole,"));
check("pavement tops out at the room's own floor level",
  city.includes("const PAVEMENT_Y = 0;") && city.includes("const ROAD_Y = PAVEMENT_Y - KERB_HEIGHT;"));
check("the city sits in the scene, never in the floor-lifted room group",
  walk.includes("this.scene.add(this.city.group)") && !walk.includes("roomGroup.add(this.city"));
// The city is driven from the render loop, and it is handed the camera as
// well as the frame length: the weather falls around the viewer rather than
// over some fixed patch of the neighbourhood, so it needs to know where they
// are standing.
check("traffic and weather are animated from the render loop",
  walk.includes("this.city.update(dt, this.camera.position);"));
check("the city knows where the viewer is, so weather follows them",
  city.includes("update(dt, viewer = null)") && city.includes("this._viewer.copy(viewer)"));
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

// — What the city is now responsible for ————————————————————————
//
// These are the pieces that make it read as a place rather than a backdrop.
// Each is cheap to delete by accident and expensive to notice missing.
check("the ground is terrain, not a slab", city.includes("_terrain(cx, cz, reach, span, seed)"));
check("the terrain is deterministic in the seed, like everything else",
  city.includes("function valueNoise(") && city.includes("function latticeHash("));
check("the streets themselves stay flat, whatever the land does",
  city.includes("TERRAIN_FLAT_MARGIN") && /const d = Math\.max\(Math\.abs\(lx\), Math\.abs\(lz\)\)/.test(city));
check("hills sit inside the fog, or they are invisible",
  /HILL_REACH = (\d+)/.test(city) && Number(/HILL_REACH = (\d+)/.exec(city)[1]) <= 140,
  "further out than the fog reaches and the ridge is just fog-coloured nothing");
check("walk3d's fog reaches past the hills",
  /FOG_FAR = (\d+)/.test(walk) && Number(/FOG_FAR = (\d+)/.exec(walk)[1]) >= 300);
check("and stops inside the camera's far plane, so clipped corners never show",
  Number(/FOG_FAR = (\d+)/.exec(walk)[1]) <= 400);

check("nearby buildings are hollow, with rooms behind the windows",
  city.includes("_hollowBuilding(") && city.includes("ROOM_DEPTH"));
check("a room is seen from the inside, which is what gives the window depth",
  /roomsDark[\s\S]{0,400}side: THREE\.BackSide/.test(city));
check("lit rooms have a bulb in them rather than a glowing pane",
  city.includes("sets.bulbs.add(") && city.includes("this.bulbs.material.emissiveIntensity"));

check("there are trucks and buses, not only cars",
  /kind: "truck"/.test(city) && /kind: "bus"/.test(city));
check("traffic stops at lights rather than driving through them",
  city.includes("_isGreen(") && city.includes("LIGHT_CYCLE"));
check("vehicles keep their distance from the one in front",
  city.includes("_leader(") && city.includes("BRAKE_MAX"));
check("brake lights and indicators are driven by the model, not animated",
  /if \(v\.braking\)/.test(city) && /if \(v\.indicate !== 0 && blinkOn\)/.test(city));
check("a lamp that is off is not drawn at all",
  city.includes("head.count = heads") && city.includes("brake.count = brakes")
  && city.includes("tail.count = tails"));
// Lamps are grouped the way a car's are: white or red on the corner, amber
// tucked in beside it. Scattering them along the body reads as decoration.
check("the lamps are arranged as corner clusters, not spread along the body",
  /const outer = W \* 0\.36;/.test(city) && /const inner = W \* 0\.19;/.test(city));
check("a car has tail lights, not just brake lights",
  /tail: make\(/.test(city) && /tail\.setMatrixAt/.test(city));
// One housing, two brightnesses: exactly one of the two meshes is written per
// side, so they can never stack in the same place.
check("the tail light gives way to the brake light rather than being drawn under it",
  /if \(v\.braking\) brake\.setMatrixAt\(brakes\+\+, m\);\s*\n\s*else tail\.setMatrixAt/.test(city));
check("headlights are running lamps, not something that switches on at dusk",
  !/lightsOn/.test(city) && /this\.headlights\.material\.emissiveIntensity = 0\.6 \+/.test(city));

// The street grid is a closed network: a vehicle that reaches the outermost
// road turns along it rather than being wrapped round to the far side, which
// is a car vanishing from one street and appearing in another.
check("the street grid is closed — nothing wraps",
  !/Wrap beyond the fog/.test(city) && /No wrapping, and nothing is ever removed/.test(city));
// Carry on, turn left, turn right. The junction's turn arrows narrow the
// choice, the vehicle's destination picks from what is left, and only where
// nothing distinguishes the options is it an even draw — so what is asserted
// is that the fallback is still even, not that every choice is.
check("a junction with nothing to choose between falls back to an even draw",
  /const options = \[0\];[\s\S]{0,2000}from\[Math\.floor\(r \* from\.length\)/.test(city));
check("a vehicle with a destination takes the way that gets it closer",
  /this\._costAfter\(v, junction, t, goalCell, v\.goal\.lane\)/.test(city));
check("ties between equally good ways are broken at random",
  /ties\[Math\.floor\(r \* ties\.length\) % ties\.length\]/.test(city));
check("the choice is taken from the movements showing green",
  /const green = options\.filter\(t => this\._turnPermitted\(/.test(city));
check("and it never empties the list — an approach always has one way out",
  /const from = green\.length \? green : options;/.test(city));
check("nothing weights it back towards carrying on",
  !/appetite/.test(city), "a low turn rate pushes the whole fleet onto the ring road");
check("a vehicle at the edge must turn, and takes the turn that needs no gap",
  /v\.mustTurn = true/.test(city) && /legal\.includes\(NEAR_SIDE_TURN\) \? NEAR_SIDE_TURN/.test(city));
check("the turn arc starts under the wheels rather than snapping the vehicle to it",
  /const R = Math\.min\(TURN_RADIUS, toCrossing\)/.test(city));
// A vehicle decides whether it can get OUT of a junction before it goes in.
// Deciding from inside means waiting inside, and a vehicle stopped in the box
// is blocking the traffic crossing it — which is waiting for the same kind of
// gap somewhere else. That is a deadlock rather than a queue.
// Matched on the CALL. A regex that also matches the method's own definition
// passes happily when nothing calls it — this has caught me out three times in
// this file now, so: `this.` prefix, always.
check("a turning vehicle checks its exit before entering the junction",
  /!this\._turnExitClear\(v, junction\)/.test(city) && /junction\.distance > -0\.5/.test(city));
check("the entry decision and the turn itself agree about where the turn goes",
  /_turnTarget\(v, junction\)/.test(city)
  && (city.match(/this\._turnTarget\(v, junction\)/g) || []).length >= 2);
check("a turn missed by the time it is due is abandoned, not taken late",
  /if \(!v\.mustTurn\) v\.turn = 0;/.test(city));

// — Shooting out a window ————————————————————————————————
check("window panes are marked so a shot can tell glass from wall",
  /mesh\.userData\.glass = true/.test(walk));
check("a paintball breaks the pane instead of splattering on it",
  /this\.breakGlass\(pane\);/.test(walkCode));
check("and carries on to whatever was behind it",
  /hits\.find\(h => h\.object !== pane && !h\.object\.userData\.glass\)/.test(walkCode));
check("broken glass leaves falling shards", /this\.updateShards\(dt\);/.test(walkCode)
  && /this\.shards\.push\(/.test(walkCode));
check("the shared glass material is never disposed with a pane",
  /the material is shared; only the pane is ours/.test(walk));
// — Paint on a moving car —————————————————————————————————
//
// A vehicle is one instance of an instanced mesh and moves every frame, so a
// splat recorded in world space is only correct for the instant it was placed:
// the car drives out from under its own paint.
// Matched on the CALL, not the definition. A check that greps for the method
// name passes just as happily when nothing calls it.
check("a hit on a vehicle is recorded in that vehicle's own frame",
  /this\.carrierFor\(hit\)/.test(walkCode) && /applyMatrix4\(toLocal\)/.test(walkCode));
check("the city can say which vehicle an instance is",
  /vehicleForInstance\(meshName, instanceId\)/.test(city));
check("and hands out the same transform it draws that vehicle with",
  /vehicleMatrix\(v, into = null\)/.test(city));
check("carried splats are put back on their vehicle every frame",
  /this\.updateSplats\(\);/.test(walkCode)
  && /if \(!carrier\) continue;[\s\S]{0,600}this\.positionSplat\(splat\);/.test(walkCode));
check("a shot leads a moving target rather than aiming where it was",
  /if \(ball\.carrier\) \{[\s\S]{0,200}ball\.to\.copy/.test(walkCode));
check("paint is dropped when the city it was stuck to is rebuilt",
  /carrier\.key !== this\.city\.key/.test(walkCode));
check("the per-frame carry allocates nothing",
  /const _carrierMatrix = new THREE\.Matrix4\(\);/.test(walk)
  && !/positionSplat\(splat\) \{[\s\S]{0,400}new THREE\./.test(walk));

check("the city is already in range of a shot, so nothing special is needed to hit it",
  /shootableMeshes\(\)/.test(walk) && /this\.scene\.traverse/.test(walk));

check("weather is a state of the whole scene", city.includes("setWeather(kind)") &&
  city.includes("atmosphere()") && walk.includes("this.city.setWeather(store.weather)"));
check("the weather setting lives in the store like the time of day",
  store.includes("setWeather(kind)") && store.includes("stepWeather(delta)"));
check("weather is a view setting, never saved into the plan",
  !/weather/.test(store.slice(store.indexOf("serializeRoom"), store.indexOf("serializeRoom") + 400)));

// — The render loop must not churn the heap ————————————————————
// The traffic runs every frame. Allocating a fresh matrix per car per part was
// roughly 11,500 throwaway objects a second, which is real GC pressure in the
// one place that has a 16 ms budget.
{
  const carPath = city.slice(city.indexOf("_writeCarMatrices() {"),
    city.indexOf("/// Advances the traffic"));
  // Both matrix helpers: the body is placed with bodyMatrix, which carries the
  // lean and the dip as well as the heading, and everything hung on it — lamps,
  // indicators — with boxMatrix. Counting only one of them let the other slip
  // back to allocating.
  const calls = (carPath.match(/\b(box|body)Matrix\(/g) || []).length;
  const scratch = (carPath.match(/, _m\s*\)/g) || []).length;
  check("the per-frame car path allocates no matrices", calls > 0 && calls === scratch,
    `${scratch} of ${calls} reuse the scratch matrix`);
  check("both matrix helpers can compose into a caller's matrix",
    city.includes("into = null") && city.includes("(into || new THREE.Matrix4())")
    && /function bodyMatrix\([^)]*into = null\)/.test(city));
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

console.log(`${passed} passed, ${failed} failed — city + 3D environment contracts`);
if (failed) process.exit(1);
