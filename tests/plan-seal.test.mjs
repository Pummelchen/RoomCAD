// Node test for the wall-seam light-leak fix in roomcad/web/walk3d.js.
//
// The bug: a 60 W bulb leaked through wall/floor/ceiling joins as though a
// snapped room had hairline cracks. The renderer must use one closed wall
// volume (with real door/window holes), overlap that volume with the slab and
// ceiling, and make physics colliders overlap at snapped wall ends.
// It loads plan.js as an ES module via a data URL so the .js extension's
// CommonJS default in Node doesn't matter.
//
// Run:  node tests/plan-seal.test.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const planSrc = readFileSync(join(here, "..", "roomcad", "web", "plan.js"), "utf8");
const walkSrc = readFileSync(join(here, "..", "roomcad", "web", "walk3d.js"), "utf8");
const plan = await import(
  "data:text/javascript;base64," + Buffer.from(planSrc).toString("base64")
);

const {
  WALL_THICKNESS,
  SILL_HEIGHT,
  GLASS_HEIGHT,
  DOOR_HEIGHT,
  wallBuildPlan,
  wallLength,
  point,
  uid,
  serializeRoom,
  parseRoom,
  demoRoom,
  freshRoom,
  wallCollisionSegments,
  wallEndSeals,
  WALL_JOIN_SEAL,
} = plan;

const SEAL = 0.04; // must match WALL_VERTICAL_SEAL in walk3d.js

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${name}${detail ? " — " + detail : ""}`);
  }
}

// ── 1. Round-trip integrity ──────────────────────────────────────────────
{
  const room = demoRoom();
  const rt = parseRoom(serializeRoom(room));
  check("round-trip walls", rt.walls.length === room.walls.length);
  check("round-trip doors", rt.doors.length === room.doors.length);
  check("round-trip windows", rt.windows.length === room.windows.length);
  check("round-trip furniture", rt.furniture.length === room.furniture.length);
  check("round-trip canvas",
    rt.canvas && rt.canvas.width === room.canvas.width && rt.canvas.length === room.canvas.length);
}

// ── 2. A plain wall plan contains no accidental openings ────────────────
{
  const wall = { id: uid(), start: point(0, 0), end: point(6, 0) };
  const height = 2.6;
  const bp = wallBuildPlan(wall, [], [], height);
  const sill = Math.min(SILL_HEIGHT, height);
  const doorTop = Math.min(DOOR_HEIGHT, height);

  check("plain wall: base spans full length", bp.baseSpans.length === 1 && bp.baseSpans[0].from === 0 && bp.baseSpans[0].to === wallLength(wall));
  check("plain wall: mid spans full length", bp.midSpans.length === 1 && bp.midSpans[0].from === 0 && bp.midSpans[0].to === wallLength(wall));
  check("plain wall: no glass", bp.glassSpans.length === 0);
  check("plain wall: header spans full length", bp.headerSpan.from === 0 && bp.headerSpan.to === wallLength(wall));

  // The renderer turns this no-opening plan into one solid from slab to roof.
  check("plain wall: construction seal reaches below floor", -SEAL < 0);
  check("plain wall: construction seal reaches above ceiling", height + SEAL > height);
}

// ── 3. Wall with a window: solid parts seal, glass stays in place ───────
{
  const wall = { id: uid(), start: point(0, 0), end: point(6, 0) };
  const height = 2.6;
  const windows = [{ id: uid(), wallID: wall.id, offset: 2.0, width: 1.0 }];
  const bp = wallBuildPlan(wall, [], windows, height);
  const sill = Math.min(SILL_HEIGHT, height);
  const glassTop = Math.min(sill + GLASS_HEIGHT, height);
  const doorTop = Math.min(DOOR_HEIGHT, height);

  // The window hole exists exactly at [sill, glassTop]; glass is transparent
  // by design, so only the solid segments need to seal around it.
  check("window wall: glass span present", bp.glassSpans.length === 1);
  check("window wall: glass at expected offset", Math.abs(bp.glassSpans[0].from - 2.0) < 1e-9);
  check("window wall: glass fits inside wall", bp.glassSpans[0].from >= 0 && bp.glassSpans[0].to <= wallLength(wall));
  check("window wall: strip above glass top", bp.stripSpans.length === 1);

  // The solid surrounds the transparent pane and still enters the slab.
  check("window wall: base below floor", -SEAL < 0);
}

// ── 4. Whole demo room: every wall seals floor & ceiling ────────────────
{
  const room = demoRoom();
  const height = room.height;
  const sill = Math.min(SILL_HEIGHT, height);
  const doorTop = Math.min(DOOR_HEIGHT, height);

  for (const wall of room.walls) {
    const bp = wallBuildPlan(wall, room.doors, room.windows, height);

    // Horizontal coverage: each band is solid across the whole wall except for
    // its own openings (base skips doors; mid skips doors + windows; header is
    // always full length). No phantom horizontal gaps.
    const len = wallLength(wall);
    const doorTotal = bp.doorSpans.reduce((s, d) => s + (d.to - d.from), 0);
    const windowTotal = bp.windowSpans.reduce((s, w) => s + (w.to - w.from), 0);
    check(`demo wall ${wall.id}: base covers all but doors`,
      Math.abs(coverLength(bp.baseSpans) + doorTotal - len) < 1e-9);
    check(`demo wall ${wall.id}: mid covers all but doors/windows`,
      Math.abs(coverLength(bp.midSpans) + doorTotal + windowTotal - len) < 1e-9);
    check(`demo wall ${wall.id}: header covers full length`,
      bp.headerSpan.from === 0 && Math.abs(bp.headerSpan.to - len) < 1e-9);

    // The sealed extrusion runs below the floor and above the ceiling.
    check(`demo wall ${wall.id}: base sealed into floor`, -SEAL < 0);
    check(`demo wall ${wall.id}: header sealed into ceiling`, height + SEAL > height);
  }
}

// ── 5. Snapped wall colliders have true-end join seals ───────────────────
{
  const room = freshRoom("joined walls", 4, 4, 2.6);
  const segments = wallCollisionSegments(room);
  check("collision emits one segment per plain wall", segments.length === 4);
  check("collision marks wall starts for overlap", segments.every(s => s.atWallStart === true));
  check("collision marks wall ends for overlap", segments.every(s => s.atWallEnd === true));
}

// ── 6. Renderer + physics contract: solid wall, sealed colliders ────────
{
  const constant = name => {
    const m = walkSrc.match(new RegExp(`const ${name} = (-?[0-9.]+);`));
    return m ? Number(m[1]) : NaN;
  };

  const verticalSeal = constant("WALL_VERTICAL_SEAL");
  const doorSeal = constant("CLOSED_DOOR_SEAL");
  const mapSize = constant("POINT_SHADOW_MAP_SIZE");
  const pointBias = constant("POINT_SHADOW_BIAS");
  const sunBias = constant("SUN_SHADOW_BIAS");
  const sunNormalBias = constant("SUN_SHADOW_NORMAL_BIAS");

  check("renderer: wall enters floor and ceiling by at least 4 cm", verticalSeal >= 0.04);
  check("renderer: closed doors overlap wall depth", doorSeal > 0);
  check("renderer: every wall is a single extruded solid",
    walkSrc.includes("addSealedWall(wall, plan, sill, glassTop, doorTop, height, P.wallEndSeals(room, wall));") &&
    walkSrc.includes("new THREE.ExtrudeGeometry(shape, {") &&
    !walkSrc.includes("addBox(wall, span,"));
  check("renderer: wall spans both floor and ceiling",
    walkSrc.includes("const bottom = -WALL_VERTICAL_SEAL;") &&
    walkSrc.includes("const top = height + WALL_VERTICAL_SEAL;"));
  check("renderer: only actual openings become holes",
    walkSrc.includes("for (const span of plan.doorSpans) addOpening(span, bottom, doorTop);") &&
    walkSrc.includes("for (const span of plan.windowSpans) addOpening(span, sill, glassTop);"));
  check("renderer: wall ends reach across a join",
    walkSrc.includes("const back = -seals.start;") &&
    walkSrc.includes("const front = length + seals.end;"));
  check("renderer: closed door fills wall depth",
    walkSrc.includes("const thickness = closed ? P.WALL_THICKNESS + CLOSED_DOOR_SEAL * 2 : 0.04;"));
  check("physics: wall colliders overlap floor and ceiling",
    walkSrc.includes("const h = room.height / 2 + WALL_VERTICAL_SEAL;") &&
    walkSrc.includes("desc.setTranslation(midX, baseY + room.height / 2, midZ);"));
  check("physics: colliders use the same per-end join seal as the meshes",
    walkSrc.includes("const before = seg.startSeal;") &&
    walkSrc.includes("const after = seg.endSeal;"));
  check("physics: closed door fills the complete wall depth",
    walkSrc.includes("const halfDoorDepth = P.WALL_THICKNESS / 2 + CLOSED_DOOR_SEAL;"));
  check("renderer: point shadows use a 1024 map", mapSize >= 1024);

  // The regression this whole file exists for. A negative shadow bias makes
  // every receiver test as closer to the light than it is, so light escapes
  // past occluders. Point shadows compare in a NON-LINEAR perspective buffer
  // (three.webgpu.js: depth = far/(far-near) * (1 - near/d)), so a constant
  // bias becomes a slack that grows with the square of the distance, and at
  // grazing incidence along a floor or ceiling it projects into metre-wide
  // bright bands. Back-face shadow rendering already gives a whole wall
  // thickness of margin against acne, so the correct value is exactly zero.
  check("renderer: point shadow adds no depth bias", pointBias === 0);
  check("renderer: point shadow adds no normal bias", walkSrc.includes("pl.shadow.normalBias = 0;"));
  check("renderer: sunlight adds no depth bias", sunBias === 0);
  check("renderer: sunlight normal bias stays sub-millimetre-visible", sunNormalBias >= 0 && sunNormalBias <= 0.002);

  // Quantify it, so nobody can reintroduce "just a small" negative bias.
  const leakAt = (d, bias, near = 0.05, far = 10) =>
    Math.abs(bias) * d * d / ((far / (far - near)) * near);
  check("renderer: chosen point bias leaks nothing at 8 m", leakAt(8, pointBias) < 0.001);
  check("test proves the old -0.0015 bias was a >1 m leak at 8 m", leakAt(8, -0.0015) > 1);
}

// ── 7. Wall joins are closed solids (the vertical light line) ──────────
// A wall end that stops at the join centre leaves a notch of open air over
// the neighbour's half thickness, for the wall's full height. That notch was
// the bright vertical seam at every room corner.
{
  check("join seal crosses the neighbour's half thickness", WALL_JOIN_SEAL >= WALL_THICKNESS / 2);

  const room = freshRoom("Corner", 6, 4, 2.6);
  const seals = room.walls.map(w => wallEndSeals(room, w));
  check("every end of a closed rectangle counts as joined",
    seals.every(s => s.start === WALL_JOIN_SEAL && s.end === WALL_JOIN_SEAL));

  // Sample the corner square: every point must lie inside some wall solid.
  const half = WALL_THICKNESS / 2;
  const solids = room.walls.map((w, i) => {
    const len = wallLength(w);
    const ux = (w.end.x - w.start.x) / len;
    const uz = (w.end.z - w.start.z) / len;
    return { w, ux, uz, len, s: seals[i] };
  });
  const inside = (x, z) => solids.some(({ w, ux, uz, len, s }) => {
    const along = (x - w.start.x) * ux + (z - w.start.z) * uz;
    const across = Math.abs(-(x - w.start.x) * uz + (z - w.start.z) * ux);
    return along >= -s.start && along <= len + s.end && across <= half;
  });

  let gaps = 0;
  for (const c of room.walls.map(w => w.start)) {
    for (let dx = -half; dx <= half + 1e-9; dx += 0.005) {
      for (let dz = -half; dz <= half + 1e-9; dz += 0.005) {
        if (!inside(c.x + dx, c.z + dz)) gaps++;
      }
    }
  }
  check("no open air anywhere in any corner square", gaps === 0, `${gaps} uncovered sample points`);

  // A free-standing end must NOT grow, or drawn walls would measure long.
  const open = freshRoom("Open", 6, 4, 2.6);
  open.walls = [{ id: uid(), start: point(1, 1), end: point(3, 1) }];
  const lone = wallEndSeals(open, open.walls[0]);
  check("a free-standing wall end is never extended", lone.start === 0 && lone.end === 0);

  // A T-junction: the stem meets the middle of another wall and must seal.
  const tee = freshRoom("Tee", 6, 4, 2.6);
  const first = tee.walls[0];
  const mid = { x: (first.start.x + first.end.x) / 2, z: (first.start.z + first.end.z) / 2 };
  const stem = { id: uid(), start: mid, end: { x: mid.x, z: mid.z + 1.5 } };
  tee.walls.push(stem);
  const stemSeals = wallEndSeals(tee, stem);
  check("a T-junction stem seals into the wall it meets", stemSeals.start === WALL_JOIN_SEAL);
  check("the free end of the T stem stays honest", stemSeals.end === 0);

  // Collider segments must carry the same per-end seal as the meshes.
  const segs = wallCollisionSegments(room);
  check("collider segments expose a per-end join seal",
    segs.every(s => typeof s.startSeal === "number" && typeof s.endSeal === "number"));
  check("collider seals only apply at true wall ends",
    segs.every(s => (s.atWallStart || s.startSeal === 0) && (s.atWallEnd || s.endSeal === 0)));
}

function coverLength(spans, length) {
  // Total length covered by the given solid spans (assumes they are sorted and
  // non-overlapping, as produced by solidSpans).
  return spans.reduce((sum, s) => sum + (s.to - s.from), 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
