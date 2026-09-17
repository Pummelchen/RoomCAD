// A wall at an angle the collider was never built to take.
//
// The collider used to pick between two axis-aligned boxes with one test:
//
//     const horizontal = Math.abs(dz) < 0.001;
//     const desc = horizontal ? cuboid(len/2, h, t/2) : cuboid(t/2, h, len/2);
//
// so anything that was not horizontal was treated as VERTICAL. That is an
// assumption wearing a guard's clothes, and for a run at any other angle it put
// the box in the wrong place: solid where the wall is not, and open where it is.
// Against a slanted wall you walk through the wall itself, and then a metre
// later you are stopped in the middle of the room by nothing at all.
//
// Nothing in the app could reach it, because the editor only draws axis-locked
// walls and sanitize() drops a diagonal one on load. That is why it went
// unnoticed. It is not a reason to leave it, and it is not a reason for the
// collider to depend on another module's filter to be correct.
//
// This drives a slanted wall through the REAL Rapier build and walks a
// player-sized capsule at it, because the question is where the solver puts the
// box, not what the geometry says it ought to. The old shape is built here too,
// and the capsule walks through it — so these assertions are about the fix
// rather than about Rapier.
//
// Run:  node tests/wall-collider.test.mjs

import { register } from "node:module";
import * as RAPIER from "../roomcad/web/lib/rapier.mjs";

// walk3d.js imports three/addons/…, so it is resolved through the page's own
// import map rather than rewritten into a copy.
register("./harness/three-resolver.mjs", import.meta.url);
const { wallRunBox } = await import("../roomcad/web/walk3d.js");

// The compiled build needs its WASM instantiated before a World can exist —
// walk3d.js does the same at its own startup.
await RAPIER.init();

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; return; }
  failed++;
  console.error("FAIL: " + name + (detail ? " — " + detail : ""));
}

// The run under test: (1,1) to (3,3), which is 45 degrees and 2*sqrt(2) long.
const AX = 1, AZ = 1, BX = 3, BZ = 3;
const WALL_H = 1.2;
const THICKNESS = 0.10;
const DIAGONAL = Math.hypot(BX - AX, BZ - AZ);

// ── The two axis-aligned runs keep exactly the box they always had ────────
//
// This is the part that must not move: every wall in every room is one of
// these, and it is why the slanted case can be fixed without touching them.

{
  const alongX = wallRunBox(0, 0, 4, 0, THICKNESS);
  check("a wall along X is still a box along X, unrotated",
    alongX.hx === 2 && Math.abs(alongX.hz - THICKNESS / 2) < 1e-12 && alongX.rotation === null,
    `hx=${alongX.hx} hz=${alongX.hz} rotation=${alongX.rotation}`);

  const alongZ = wallRunBox(0, 0, 0, 4, THICKNESS);
  check("a wall along Z is still the same box turned, unrotated",
    Math.abs(alongZ.hx - THICKNESS / 2) < 1e-12 && alongZ.hz === 2 && alongZ.rotation === null,
    `hx=${alongZ.hx} hz=${alongZ.hz} rotation=${alongZ.rotation}`);

  // The old code's two branches, to the last bit, so "nothing moved" is a
  // measurement rather than a claim.
  const oldX = { hx: 4 / 2, hz: THICKNESS / 2 };
  const oldZ = { hx: THICKNESS / 2, hz: 4 / 2 };
  check("and both match what the old horizontal test produced exactly",
    alongX.hx === oldX.hx && alongX.hz === oldX.hz
    && alongZ.hx === oldZ.hx && alongZ.hz === oldZ.hz,
    `${alongX.hx}/${alongX.hz} and ${alongZ.hx}/${alongZ.hz}`);
}

// ── A slanted run gets a box that lies along it ──────────────────────────

{
  const box = wallRunBox(AX, AZ, BX, BZ, THICKNESS);
  check("a slanted run is measured along the run",
    Math.abs(box.len - DIAGONAL) < 1e-12, `${box.len} vs ${DIAGONAL}`);
  check("its length is the box's long axis, not a guess",
    Math.abs(box.hx - DIAGONAL / 2) < 1e-12 && Math.abs(box.hz - THICKNESS / 2) < 1e-12,
    `hx=${box.hx} hz=${box.hz}`);
  check("it is rotated, because no axis-aligned box fits it",
    box.rotation !== null);

  // Where the box's long axis actually points: rotate (1,0,0) by the
  // quaternion about Y and compare with the run's direction. This is what
  // catches a wrong sign in the angle, which is the mistake this kind of fix
  // is made of.
  const q = box.rotation;
  const vx = 1 - 2 * (q.y * q.y + q.z * q.z);
  const vz = 2 * (q.x * q.z - q.w * q.y);
  const want = { x: (BX - AX) / DIAGONAL, z: (BZ - AZ) / DIAGONAL };
  check("and its long axis points along the wall",
    Math.abs(vx - want.x) < 1e-9 && Math.abs(vz - want.z) < 1e-9,
    `axis (${vx.toFixed(4)}, ${vz.toFixed(4)}) vs wall (${want.x.toFixed(4)}, ${want.z.toFixed(4)})`);
}

// ── And the solver agrees ────────────────────────────────────────────────

const GRAVITY = 11;
const STAND_HALF_HEIGHT = 0.55;   // as walk3d.js uses
const PLAYER_RADIUS = 0.20;

/// Walks a player capsule from (x, z) in the direction (dx, dz) for `steps`,
/// in a world holding the floor and whatever `makeDesc` adds, and returns where
/// it came to rest.
function walk(x, z, dx, dz, makeDesc, steps = 420) {
  const world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(40, 0.03, 40).setTranslation(0, -0.03, 0));
  const desc = makeDesc();
  if (desc) world.createCollider(desc);
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 0, z).lockRotations());
  world.createCollider(
    RAPIER.ColliderDesc.capsule(STAND_HALF_HEIGHT, PLAYER_RADIUS)
      .setTranslation(0, STAND_HALF_HEIGHT + PLAYER_RADIUS, 0),
    body);
  const speed = 2.4;
  for (let i = 0; i < steps; i++) {
    const v = body.linvel();
    body.setLinvel({ x: dx * speed, y: v.y, z: dz * speed }, true);
    world.timestep = 1 / 60;
    world.step();
  }
  const p = body.translation();
  world.free();
  return { x: p.x, z: p.z };
}

/// The collider the fix builds for the run.
function newDesc() {
  const box = wallRunBox(AX, AZ, BX, BZ, THICKNESS);
  const d = RAPIER.ColliderDesc.cuboid(box.hx, WALL_H / 2, box.hz)
    .setTranslation((AX + BX) / 2, WALL_H / 2, (AZ + BZ) / 2);
  if (box.rotation) d.setRotation(box.rotation);
  return d;
}

/// The collider the old code built for the same run: its else-branch, an
/// axis-aligned box along Z with the run's length, at the run's midpoint.
function oldDesc() {
  return RAPIER.ColliderDesc.cuboid(THICKNESS / 2, WALL_H / 2, DIAGONAL / 2)
    .setTranslation((AX + BX) / 2, WALL_H / 2, (AZ + BZ) / 2);
}

{
  // Walk at the wall from the low side, along the perpendicular. The run meets
  // x = z, so a capsule starting at (0.4,0.4) and pushed along (1,1) should be
  // stopped at the wall — its surface touching x = z, which for a 0.2 m radius
  // puts its centre just short of it.
  const start = 0.4;
  const dir = 1 / Math.SQRT2;
  const through = walk(start, start, dir, dir, newDesc);
  check("a capsule walking at a slanted wall is stopped by it",
    through.x < 1.05,
    `walked to (${through.x.toFixed(3)}, ${through.z.toFixed(3)}); the wall is at x = z = 1`);

  const throughOld = walk(start, start, dir, dir, oldDesc);
  check("the old box let it walk straight through the wall instead",
    throughOld.x > 1.6,
    `stopped at x = ${throughOld.x.toFixed(3)}, which is ${(throughOld.x - 1).toFixed(2)} m past the wall`);

  // Now the other half of the same bug: floor the old box covered although no
  // wall is there. At x = 2 the run is at z = 2, so (2, 3.1) is 0.78 m clear of
  // it — well inside a box that ran 1.41 m along Z from the midpoint.
  const openNew = walk(2, 3.4, 0, -1, newDesc);
  check("floor beside the slanted wall is open, and the capsule walks it",
    openNew.z < 2.6,
    `stopped at z = ${openNew.z.toFixed(3)}; the wall is at z = 2 there`);

  const openOld = walk(2, 3.4, 0, -1, oldDesc);
  check("where the old box stopped it dead in the middle of the floor",
    openOld.z > 3.0,
    `stopped at z = ${openOld.z.toFixed(3)} after barely moving`);
}

console.log(`${passed} passed, ${failed} failed — the collider for a wall at an angle`);
process.exit(failed ? 1 : 0);
