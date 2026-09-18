// Which ceiling lights actually light the room.
//
// The pool used to be dealt out in PLAN ORDER at build time: the first sixteen
// fixtures won, and the seventeenth was dead for the life of the room no matter
// where you stood — while still being drawn glowing, so it looked like a broken
// lamp. Nothing said a word about it.
//
// Now the pool follows the viewer, and a plan holding more fixtures than the
// renderer will light is reported rather than left to be discovered.
//
// Walk3D cannot be instantiated here — it needs WebGPU — so the object under
// test is built from the REAL Walk3D.prototype with fake resources, the way
// tests/walk3d-dispose.test.mjs does. The methods driven below are the ones the
// app ships, not a copy lifted out of the source.

import { register } from "node:module";
import { walk3dSource } from "./harness/walk3d-source.mjs";

// walk3d.js imports the bare "three" specifier, so it is resolved through the
// page's own import map before it is imported.
register("./harness/three-resolver.mjs", import.meta.url);
const { Walk3D } = await import("../roomcad/web/walk3d.js");

// The source is still read for the contracts at the bottom of this file (the
// named budget, the removed plan-order gate) — those are assertions about the
// shipped source, and the package-wide helper reads walk3d.js plus walk3d/.
const walk = walk3dSource();

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; return; }
  failed++;
  console.error("FAIL: " + name + (detail ? " — " + detail : ""));
}

// ── The two methods, on the real prototype ────────────────────────────────
const start = walk.indexOf("  updateRoomLights() {");
// start..end covers updateRoomLights AND assignRoomLight, which it calls — the
// boundary is roomLightReport's doc comment, as it always was. The methods are
// still adjacent after the split, so the marker still lands in the right place.
const end = walk.indexOf("  /// How the room's fixtures are lit");
check("the light-pool code can be located", start > 0 && end > start);

function fakeLight() {
  return {
    visible: true, intensity: 0, distance: 1,
    position: { set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    color: { setHex(hex) { this.hex = hex; } },
    shadow: { camera: { far: 0 } },
  };
}

/// Builds a viewer from the real prototype with `poolSize` lights and fixtures
/// at the given x positions. Everything the methods touch is a fake; the
/// methods themselves are the ones walk3d.js puts on the prototype.
function probe(poolSize, slotXs, cameraX = 0) {
  const p = Object.create(Walk3D.prototype);
  p.pointLights = Array.from({ length: poolSize }, fakeLight);
  p.roomLightSlots = slotXs.map(x => ({ x, y: 2.4, z: 0, color: 0xffffff, intensity: 40, distance: 10 }));
  p.camera = { position: { x: cameraX, z: 0 } };
  p.roomLightsAssigned = -1;
  return p;
}
const litAt = p => p.pointLights.map(l => (l.intensity > 0 ? l.position.x : null));

// ── Fewer fixtures than lights: every fixture gets one ────────────────────
{
  const p = probe(3, [1, 2, 3]);
  p.updateRoomLights();
  check("a light is placed at every fixture when the pool is big enough",
    litAt(p).join(",") === "1,2,3", litAt(p).join(","));
  check("the light adopts the fixture's own colour and reach",
    p.pointLights[0].color.hex === 0xffffff && p.pointLights[0].distance === 10);

  // Idempotent: the assigning pass must not run again for nothing.
  p.pointLights[0].position.x = 99;
  p.updateRoomLights();
  check("a settled assignment is not redone", p.pointLights[0].position.x === 99);

  // A camera move must not disturb it either — nothing to re-choose.
  p.camera.position.x = 50;
  p.updateRoomLights();
  check("moving the camera does not re-choose when there is no choice to make",
    p.pointLights[0].position.x === 99);
}

// ── More fixtures than lights: the nearest win, and it follows you ────────
{
  // Fixtures at 0, 5, 9 and the camera at 0: the two nearest are 0 and 5.
  const p = probe(2, [9, 5, 0], 0);
  p.updateRoomLights();
  check("the nearest fixtures are the ones lit",
    litAt(p).sort((a, b) => a - b).join(",") === "0,5", litAt(p).join(","));

  // Walk to the far end and the lights follow you. This is the whole point:
  // under the old plan-order deal, fixture 9 would never light, ever.
  p.camera.position.x = 9;
  p.updateRoomLights();
  check("and they follow the viewer",
    litAt(p).sort((a, b) => a - b).join(",") === "5,9", litAt(p).join(","));

  // The one you were just standing under goes dark rather than staying lit.
  check("nothing is left lit behind you by accident",
    litAt(p).filter(v => v === 0).length === 0);
}

// ── A pool with no fixtures, and a fixture list with no pool ─────────────
{
  const p = probe(0, [1, 2]);
  let threw = null;
  try { p.updateRoomLights(); } catch (e) { threw = e.message; }
  check("an empty pool is harmless", threw === null, threw || "");

  const q = probe(2, []);
  q.updateRoomLights();
  check("a plan with no fixtures lights nothing", litAt(q).join(",") === ",");
}

// ── The report the inspector shows ───────────────────────────────────────
{
  const p = probe(2, [1, 2, 3, 4]);
  p.updateRoomLights();
  const report = p.roomLightReport();
  check("the report counts every fixture",
    report.fixtures === 4, `${report.fixtures}`);
  check("and how many of them are actually lit",
    report.lit === 2, `${report.lit}`);
}

// ── Source contracts: the cap, and no plan-order deal ────────────────────
check("the pool is capped by a named budget",
  /const MAX_ROOM_LIGHTS = \d+;/.test(walk));
check("and is sized to the plan, not always to the cap",
  /Math\.min\(this\.roomLightSlots\.length, MAX_ROOM_LIGHTS\)/.test(walk),
  "a one-bulb room must not pay for sixteen cube maps");
check("the pool is rebuilt per room, not per frame",
  /buildRoomLightPool\(\) \{/.test(walk));
check("the old plan-order gate is gone",
  !/lightCount < MAX_POINT_LIGHTS/.test(walk) && !/MAX_POINT_LIGHTS/.test(walk),
  "the first sixteen fixtures winning is the bug");
check("every light in the pool casts a shadow",
  /pl\.castShadow = true;/.test(walk),
  "a point light that does not goes through walls");
check("the viewer is asked where it is, each frame",
  /this\.updateRoomLights\(\);/.test(walk));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
