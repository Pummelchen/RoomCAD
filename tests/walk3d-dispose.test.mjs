// Tearing the 3D view down.
//
// `Walk3D.dispose()` had no caller and no test. In the app the walkthrough is
// built once and lives for the session, so nothing exercised teardown at all —
// which is the worst state for it to be in, because it RELEASES things. A
// renderer, a Rapier world, a 4096² shadow map, a 1024² cube map per lit
// fixture, every geometry and material in the scene. If it is wrong, the cost
// is GPU memory that never comes back, and nothing anywhere would say so.
//
// It is also the method nobody runs until they run it for real: a reload in a
// long session, or a future mode switch that disposes. So it is driven here on
// an object built from the real prototype with fake fields — real method, fake
// resources — and every release it claims to do is checked by watching the
// fakes. `walk3d.js` is importable now (tests/harness/three-resolver.mjs), so
// this is finally possible; before that it was not.
//
// What is NOT covered: that three.js actually frees GPU memory when asked. That
// needs a WebGPU device, and this suite has no browser by design.
//
// Run:  node tests/walk3d-dispose.test.mjs

import { register } from "node:module";

// walk3d.js imports three/addons/…, so it is resolved through the page's own
// import map rather than rewritten into a copy.
register("./harness/three-resolver.mjs", import.meta.url);
const { Walk3D } = await import("../roomcad/web/walk3d.js");

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; return; }
  failed++;
  console.error("FAIL: " + name + (detail ? " — " + detail : ""));
}

// ── Fakes that record what was done to them ──────────────────────────────

const freed = {
  city: 0, world: 0, pipeline: 0, renderer: 0, geometries: 0, materials: 0,
  maps: 0, shadows: 0, removed: [], removedChildren: [],
};

function fakeMaterial() {
  const material = { dispose() { freed.materials++; } };
  material.map = { dispose() { freed.maps++; } };
  material.emissiveMap = { dispose() { freed.maps++; } };
  return material;
}

function fakeMesh() {
  return {
    isMesh: true,
    geometry: { dispose() { freed.geometries++; } },
    material: fakeMaterial(),
  };
}

function fakeLight() {
  return {
    isLight: true,
    shadow: { dispose() { freed.shadows++; } },
  };
}

/// An object with the real methods and fake everything else.
function fakeWalk3D(overrides = {}) {
  const self = Object.create(Walk3D.prototype);
  const meshes = [fakeMesh(), fakeMesh()];
  const light = fakeLight();
  // A persistent subtree: the city owns its own resources and is far too
  // expensive to rebuild, so teardown must lift it out and NOT dispose it.
  const persistent = { userData: { persistent: true }, geometry: { dispose() { freed.removedChildren.push("disposed persistent!"); } } };

  const scene = {
    children: [meshes[0], meshes[1], persistent, light],
    // Faithful in the one way that matters: it walks the CURRENT children, so
    // the persistent subtree that disposeScene() lifted out first is not among
    // them and cannot be visited.
    traverse(fn) { for (const child of this.children) fn(child); },
    remove(node) { freed.removed.push(node === persistent ? "persistent" : "other"); this.children = this.children.filter(c => c !== node); },
    add(node) { this.children.push(node); },
    clear() { this.children = []; },
  };

  const container = {
    child: null,
    removeChild(el) { freed.removedChildren.push(el === container.child ? "canvas" : "wrong node"); this.child = null; },
  };

  Object.assign(self, {
    scene,
    container,
    floorMaterial: fakeMaterial(),
    glassMaterial: { reused: true },
    reusableTextures: new Set(),
    _listeners: [
      [fakeListenerTarget(), "pointerdown", () => {}, undefined],
      [fakeListenerTarget(), "resize", () => {}, { passive: true }],
    ],
    raf: 0,
    running: true,
    ready: true,
    city: { dispose() { freed.city++; } },
    world: { free() { freed.world++; } },
    renderPipeline: { dispose() { freed.pipeline++; } },
    renderer: { dispose() { freed.renderer++; }, domElement: null },
    ...overrides,
  });
  self.renderer.domElement = { parentElement: container };
  container.child = self.renderer.domElement;
  return self;
}

/// A removeEventListener that reports to `freed`.
const listeners = { removed: 0 };
function fakeListenerTarget() {
  return { removeEventListener() { listeners.removed++; } };
}

// ── The teardown runs, and stops the frames first ────────────────────────

{
  const disposables = fakeWalk3D();
  const targets = [fakeListenerTarget(), fakeListenerTarget()];
  disposables._listeners = [
    [targets[0], "pointerdown", () => {}, undefined],
    [targets[1], "resize", () => {}, { passive: true }],
  ];

  let cancelled = null;
  // cancelAnimationFrame is a browser global; Node has none. Providing it is
  // part of exercising the path rather than skipping it. raf is 0 on this
  // instance, so the branch is NOT taken — the next block covers that.
  const had = "cancelAnimationFrame" in globalThis;
  const before = globalThis.cancelAnimationFrame;
  globalThis.cancelAnimationFrame = id => { cancelled = id; };

  let threw = null;
  try {
    disposables.dispose();
  } catch (e) {
    threw = e;
  } finally {
    if (had) globalThis.cancelAnimationFrame = before;
    else delete globalThis.cancelAnimationFrame;
  }

  check("dispose() runs without throwing", threw === null,
    threw ? threw.constructor.name + ": " + threw.message : "");
  check("the frame chain is stopped before anything is torn down",
    disposables.running === false && disposables.ready === false);
  check("no frame is cancelled when none is pending",
    cancelled === null, "cancelAnimationFrame was called with " + cancelled);
  check("every listener is removed from its target", listeners.removed === 2,
    `${listeners.removed} of 2`);
  check("and the listener list is emptied", disposables._listeners.length === 0);
}

// ── Every release it promises actually happens ───────────────────────────

{
  for (const k of Object.keys(freed)) {
    if (Array.isArray(freed[k])) freed[k].length = 0; else freed[k] = 0;
  }
  listeners.removed = 0;

  // A real pending frame number, so the cancel branch is taken.
  const disposables = fakeWalk3D({ raf: 42 });
  const had = "cancelAnimationFrame" in globalThis;
  const before = globalThis.cancelAnimationFrame;
  globalThis.cancelAnimationFrame = () => {};
  try {
    disposables.dispose();
  } finally {
    if (had) globalThis.cancelAnimationFrame = before;
    else delete globalThis.cancelAnimationFrame;
  }

  check("the city is disposed", freed.city === 1, String(freed.city));
  check("every mesh geometry in the scene is disposed", freed.geometries === 2,
    `${freed.geometries} of 2`);
  check("every material is disposed", freed.materials === 2, `${freed.materials} of 2`);
  check("and their maps with them — a shadow map is the expensive one",
    freed.maps === 4, `${freed.maps} of 4`);
  check("a light's shadow map is disposed, because clear() does not free it",
    freed.shadows === 1, String(freed.shadows));
  check("the physics world is freed", freed.world === 1, String(freed.world));
  check("the render pipeline is disposed", freed.pipeline === 1, String(freed.pipeline));
  check("the renderer is disposed", freed.renderer === 1, String(freed.renderer));
  check("the canvas is taken out of the container",
    freed.removedChildren.includes("canvas"), JSON.stringify(freed.removedChildren));

  // The persistent subtree is the one thing that must NOT be freed.
  check("a persistent subtree is lifted out, not disposed",
    !freed.removedChildren.includes("disposed persistent!"),
    JSON.stringify(freed.removedChildren));
  check("and it was removed from the scene before the traversal",
    freed.removed.includes("persistent"), JSON.stringify(freed.removed));
  check("floorMaterial is dropped with the scene it belonged to",
    disposables.floorMaterial === null);
}

// ── The optional pieces, absent, must not break it ───────────────────────
//
// dispose() is reached from states where the walkthrough never finished
// starting: `start()` is async, and a dispose before it completed leaves no
// world and no pipeline.

{
  for (const k of Object.keys(freed)) {
    if (Array.isArray(freed[k])) freed[k].length = 0; else freed[k] = 0;
  }
  const disposables = fakeWalk3D({ world: null, renderPipeline: null, raf: 0 });

  let threw = null;
  try {
    disposables.dispose();
  } catch (e) {
    threw = e;
  }
  check("dispose() survives a walkthrough that never finished starting",
    threw === null, threw ? threw.constructor.name + ": " + threw.message : "");
  check("it still disposes the city and the renderer",
    freed.city === 1 && freed.renderer === 1,
    `city ${freed.city}, renderer ${freed.renderer}`);
}

// ── A pipeline object that cannot dispose itself ─────────────────────────
//
// `renderPipeline` is built by the post-processing setup, and the guard around
// it (`this.renderPipeline && this.renderPipeline.dispose`) is there because a
// pipeline that failed to finish setting up is an object without the method.
// That guard is exactly the kind of thing a rewrite drops, so it is checked.

{
  for (const k of Object.keys(freed)) {
    if (Array.isArray(freed[k])) freed[k].length = 0; else freed[k] = 0;
  }
  const disposables = fakeWalk3D({ renderPipeline: {} });

  let threw = null;
  try {
    disposables.dispose();
  } catch (e) {
    threw = e;
  }
  check("a render pipeline without a dispose() is tolerated", threw === null,
    threw ? threw.constructor.name + ": " + threw.message : "");
  check("and the rest of the teardown still ran",
    freed.city === 1 && freed.world === 1 && freed.renderer === 1,
    `city ${freed.city}, world ${freed.world}, renderer ${freed.renderer}`);
}

console.log(`${passed} passed, ${failed} failed — tearing the 3D view down`);
process.exit(failed ? 1 : 0);
