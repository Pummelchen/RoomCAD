// Regression tests for the 3D walkthrough defects the prototype split left
// behind: four runtime imports dropped (T0001), the TSL post-processing imports
// dropped (T0008), an unbounded floor-texture canvas (T0009), dispose() leaving
// live handles (T0026), and the sky being shootable (T0027).
//
// These run the REAL modules — tests/harness/three-resolver.mjs applies the
// page's import map to the whole graph — rather than a source text lifted into
// a `data:` URL. The solar half of T0023 lives here too, because the test that
// used to cover the sun supplied the very constants sun.js failed to import.
//
// Run:  node tests/audit-walk3d.test.mjs

import { register } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// walk3d.js imports three/addons/…, so it is resolved through the page's own
// import map rather than rewritten into a copy.
register("./harness/three-resolver.mjs", import.meta.url);

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..", "roomcad", "web");

const THREE = await import("../roomcad/web/lib/three.webgpu.js");
const { RoomEnvironment } = await import("../roomcad/web/lib/environments/RoomEnvironment.js");
const P = await import("../roomcad/web/plan.js");
const sun = await import("../roomcad/web/walk3d/sun.js");
const { Walk3D } = await import("../roomcad/web/walk3d.js");

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; return; }
  failed++;
  console.error("FAIL: " + name + (detail ? " — " + detail : ""));
}

// ── T0001: sun.js's constants are imported, not supplied by the test ──────
//
// This is the half the old three-environment test faked: it prepended SG_LAT,
// SG_LON and SG_UTC_OFFSET to sun.js's source before loading it, so it could
// only pass. The real module is called here and nothing is spliced in.

for (let hour = 0; hour < 24; hour++) {
  let result = null;
  let threw = null;
  try {
    result = sun.sunForHour(hour);
  } catch (err) {
    threw = err;
  }
  check(`sunForHour(${hour}) returns a position`,
    threw === null && result
      && Number.isFinite(result.altitude) && Number.isFinite(result.azimuth),
    threw ? threw.constructor.name + ": " + threw.message : "not finite");
  if (result) {
    check(`sunForHour(${hour}) stays in range`,
      result.altitude >= -Math.PI / 2 && result.altitude <= Math.PI / 2
      && result.azimuth >= 0 && result.azimuth <= 2 * Math.PI,
      `alt ${result.altitude}, az ${result.azimuth}`);
  }
}

// ── T0008: SSAO and bloom actually build, not silently fall back ──────────
//
// setupPostProcessing() catches its own ReferenceError on purpose (the
// last-resort fallback for a browser without TSL), so "did not throw" is not
// enough: the pipeline has to exist afterwards.

function fakeEnvironmentViewer() {
  const self = Object.create(Walk3D.prototype);
  self.renderer = {};
  self.scene = new THREE.Scene();
  self.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 400);
  return self;
}

{
  const self = fakeEnvironmentViewer();
  let threw = null;
  try {
    self.setupSaoBloom();
  } catch (err) {
    threw = err;
  }
  check("setupSaoBloom() runs with the TSL imports restored",
    threw === null,
    threw ? threw.constructor.name + ": " + threw.message : "");
  check("and it builds a render pipeline with an output node",
    self.renderPipeline && self.renderPipeline.outputNode,
    String(self.renderPipeline));
}

{
  const self = fakeEnvironmentViewer();
  let threw = null;
  try {
    self.setupPostProcessing();
  } catch (err) {
    threw = err;
  }
  check("setupPostProcessing() does not quietly fall back to a direct render",
    threw === null && self.renderPipeline !== null && self.renderPipeline !== undefined,
    threw ? threw.constructor.name + ": " + threw.message : "renderPipeline is " + self.renderPipeline);
}

// ── T0001: syncCity() resolves its seed through the real import ───────────

{
  const self = Object.create(Walk3D.prototype);
  let captured = null;
  self.currentBuildingBounds = {
    minX: 0, maxX: 4, minZ: 0, maxZ: 4, width: 4, length: 4, centerX: 2, centerZ: 2,
  };
  self.scene = { add() {} };
  self.city = {
    matches(bounds, seed, lift) { captured = { bounds, seed, lift }; return false; },
    build() {},
    group: { parent: null },
  };
  let threw = null;
  try {
    self.syncCity({ id: "abc", name: "Audit" });
  } catch (err) {
    threw = err;
  }
  check("syncCity() runs with seedFromString imported",
    threw === null,
    threw ? threw.constructor.name + ": " + threw.message : "");
  check("and it hands the city a real numeric seed",
    captured !== null && Number.isInteger(captured.seed),
    captured ? String(captured.seed) : "the city was never asked to build");
}

// A source check is an ADDITION to the runtime checks above, never the only
// one: it says which specifier each module reaches for, which the runtime
// cannot distinguish from a global.
{
  const roomEnv = readFileSync(join(web, "walk3d", "scene-building.js"), "utf8");
  const solarConstants = readFileSync(join(web, "walk3d", "sun.js"), "utf8");
  const citySeed = readFileSync(join(web, "walk3d", "scene-building-3.js"), "utf8");
  const plop = readFileSync(join(web, "walk3d", "paintball.js"), "utf8");
  check("RoomEnvironment is imported by the module that builds the PMREM",
    /import\s*\{\s*RoomEnvironment\s*\}\s*from\s*"three\/addons\/environments\/RoomEnvironment\.js";/.test(roomEnv));
  check("sun.js imports all three Singapore solar constants",
    /import\s*\{[^}]*\bSG_LAT\b[^}]*\bSG_LON\b[^}]*\bSG_UTC_OFFSET\b[^}]*\}\s*from\s*"\.\/constants\.js";/.test(solarConstants));
  check("scene-building-3.js imports seedFromString from the city",
    /import\s*\{[^}]*\bseedFromString\b[^}]*\}\s*from\s*"\.\.\/city\.js";/.test(citySeed));
  check("paintball.js imports playPlop from the audio module",
    /import\s*\{\s*playPlop\s*\}\s*from\s*"\.\.\/audio\.js";/.test(plop));
  // And the same module the import resolves to is a real, disposable scene:
  // the import is useless if the class cannot be constructed or disposed.
  check("the RoomEnvironment that import resolves to is a disposable scene",
    typeof RoomEnvironment === "function"
    && typeof RoomEnvironment.prototype.dispose === "function");
}

// The disposal start() now performs after fromScene() consumed the scene.
{
  let threw = null;
  try {
    const environment = new RoomEnvironment();
    environment.dispose();
  } catch (err) {
    threw = err;
  }
  check("a RoomEnvironment can be constructed and disposed headless",
    threw === null,
    threw ? threw.constructor.name + ": " + threw.message : "");
}

// ── T0009: the floor canvas is bounded by a pixel budget, not by area ─────
//
// A legal 60 m plate is 100 tiles across; at 96 px a tile that is 9600² —
// 351 MB of CPU bitmap and past WebGPU's default 8192 texture dimension.

{
  const ctx = {
    fillStyle: "", strokeStyle: "", lineWidth: 1, lineCap: "",
    fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {},
    quadraticCurveTo() {}, stroke() {},
  };
  const canvases = [];
  const hadDocument = "document" in globalThis;
  const before = globalThis.document;
  globalThis.document = {
    createElement(tag) {
      const canvas = { tag, width: 0, height: 0, getContext: () => ctx };
      canvases.push(canvas);
      return canvas;
    },
  };

  try {
    const self = Object.create(Walk3D.prototype);
    self.makeFloorCanvas({ width: 60, length: 60 });
    const canvas = canvases[0];
    const layout = P.tileLayout(60, 60);
    const tilePx = canvas.width / layout.columns;
    check("a 60 × 60 m floor canvas stays inside WebGPU's default texture limit",
      canvas.width <= 8192 && canvas.height <= 8192,
      `${canvas.width} × ${canvas.height}`);
    check("and inside the 4096 px budget that bounds its memory",
      canvas.width <= 4096 && canvas.height <= 4096,
      `${canvas.width} × ${canvas.height}`);
    check("the tile size keeps its grout line at one pixel or more",
      tilePx >= 1, `${tilePx} px`);
    check("and stays big enough to read as tile",
      tilePx >= 8, `${tilePx} px`);

    // An ordinary room is under the budget outright, so its tile size must not
    // have been shrunk by the cap.
    canvases.length = 0;
    self.makeFloorCanvas({ width: 4.87, length: 16.44 });
    const small = canvases[0];
    check("an ordinary room still gets the full 96 px tile",
      small.width / P.tileLayout(4.87, 16.44).columns === 96,
      `${small.width} × ${small.height}`);
  } finally {
    if (hadDocument) globalThis.document = before;
    else delete globalThis.document;
  }
}

// ── T0026: dispose() releases the resources it owns and detaches handles ──
//
// The fakes here only carry the NEW fields; walk3d-dispose.test.mjs covers the
// rest of teardown against the same real method.

{
  const freed = { sky: 0, cloud: 0, environment: 0, unsubscribed: 0, disconnected: 0 };
  const self = Object.create(Walk3D.prototype);
  const container = { removeChild() {} };
  Object.assign(self, {
    running: true,
    ready: true,
    raf: 0,
    container,
    scene: {
      children: [], traverse() {}, remove() {}, add() {}, clear() {},
    },
    renderer: { dispose() {}, domElement: null },
    city: { dispose() {} },
    world: { free() {} },
    renderPipeline: null,
    reusableTextures: new Set(),
    _listeners: [],
    skyTexture: { dispose() { freed.sky++; } },
    cloudTexture: { dispose() { freed.cloud++; } },
    environment: { dispose() { freed.environment++; } },
    skyMesh: null,
    cloudLayers: [],
    _unsubscribeStore: () => { freed.unsubscribed++; },
    _resizeObserver: { disconnect() { freed.disconnected++; } },
  });
  self.renderer.domElement = { parentElement: null };

  let threw = null;
  try {
    self.dispose();
  } catch (err) {
    threw = err;
  }
  check("dispose() survives with only the optional resources present",
    threw === null, threw ? threw.constructor.name + ": " + threw.message : "");
  check("it releases the reusable sky texture",
    freed.sky === 1, String(freed.sky));
  check("it releases the reusable cloud texture",
    freed.cloud === 1, String(freed.cloud));
  check("it releases the PMREM environment texture",
    freed.environment === 1, String(freed.environment));
  check("it calls the store subscription's unsubscribe",
    freed.unsubscribed === 1, String(freed.unsubscribed));
  check("it disconnects the ResizeObserver",
    freed.disconnected === 1, String(freed.disconnected));
  check("and it drops the physics world so a later store emit cannot use it",
    self.world === null && self.physicsReady === false,
    `world ${self.world}, physicsReady ${self.physicsReady}`);
}

// ── T0027: environment meshes are not shootable, and the fallback is real ──

{
  const self = Object.create(Walk3D.prototype);
  const sky = { isMesh: true, userData: { environment: true } };
  const cloud = { isMesh: true, userData: { environment: true } };
  const rain = { isMesh: true, name: "city-precipitation", userData: {} };
  const wall = { isMesh: true, userData: {} };
  const splat = { isMesh: true, userData: { splat: true } };
  const ball = { isMesh: true, userData: { ball: true } };
  const gun = { isMesh: true, userData: { gun: true } };
  self.scene = { traverse(fn) { for (const node of [sky, cloud, rain, wall, splat, ball, gun]) fn(node); } };
  self.skyMesh = sky;
  self.cloudLayers = [{ mesh: cloud }];
  const targets = self.shootableMeshes();
  check("the room's own meshes stay shootable", targets.includes(wall));
  check("the sky dome is not shootable", !targets.includes(sky));
  check("a cloud deck is not shootable", !targets.includes(cloud));
  check("precipitation is not shootable", !targets.includes(rain));
  check("paint, balls and the gun are still skipped",
    !targets.includes(splat) && !targets.includes(ball) && !targets.includes(gun));
}

/// Fires the real shoot() at one box and reports where the shot was sent.
function shotAt(boxX) {
  const self = Object.create(Walk3D.prototype);
  const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  box.position.set(boxX, 0, 0);
  box.updateMatrixWorld(true);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 400);
  camera.position.set(0, 0, 0);
  camera.lookAt(1, 0, 0);
  const shot = { sent: null, threw: null };
  Object.assign(self, {
    camera,
    raycaster: new THREE.Raycaster(),
    scene: { traverse(fn) { fn(box); }, add() {} },
    city: { vehicleForInstance: () => null },
    carrierFor: () => null,
    spawnPaintball(from, to) { shot.sent = to; },
  });
  try {
    self.shoot();
  } catch (err) {
    shot.threw = err;
  }
  return shot;
}

{
  const distant = shotAt(100);
  check("a shot at nothing solid falls back to the documented 60 m range",
    distant.threw === null && distant.sent !== null && Math.abs(distant.sent.length() - 60) < 0.01,
    distant.threw ? distant.threw.constructor.name + ": " + distant.threw.message
      : distant.sent ? String(distant.sent.length()) : "shoot() sent nothing");

  const near = shotAt(10);
  check("a shot at something inside the range still stops on it",
    near.threw === null && near.sent !== null && near.sent.x > 9 && near.sent.x < 10,
    near.threw ? near.threw.constructor.name + ": " + near.threw.message
      : near.sent ? String(near.sent.x) : "shoot() sent nothing");
}

console.log(`${passed} passed, ${failed} failed — the 3D walkthrough's dropped imports and leaks`);
process.exit(failed ? 1 : 0);
