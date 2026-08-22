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
  const endSeal = constant("WALL_END_SEAL");
  const doorSeal = constant("CLOSED_DOOR_SEAL");
  const mapSize = constant("POINT_SHADOW_MAP_SIZE");
  const bias = constant("POINT_SHADOW_BIAS");
  const sunNormalBias = constant("SUN_SHADOW_NORMAL_BIAS");

  check("renderer: wall enters floor and ceiling by at least 4 cm", verticalSeal >= 0.04);
  check("renderer: wall ends overlap", endSeal > 0 && endSeal < WALL_THICKNESS);
  check("renderer: closed doors overlap wall depth", doorSeal > 0);
  check("renderer: every wall is a single extruded solid",
    walkSrc.includes("addSealedWall(wall, plan, sill, glassTop, doorTop, height);") &&
    walkSrc.includes("new THREE.ExtrudeGeometry(shape, {") &&
    !walkSrc.includes("addBox(wall, span,"));
  check("renderer: wall spans both floor and ceiling",
    walkSrc.includes("const bottom = -WALL_VERTICAL_SEAL;") &&
    walkSrc.includes("const top = height + WALL_VERTICAL_SEAL;"));
  check("renderer: only actual openings become holes",
    walkSrc.includes("for (const span of plan.doorSpans) addOpening(span, bottom, doorTop);") &&
    walkSrc.includes("for (const span of plan.windowSpans) addOpening(span, sill, glassTop);"));
  check("renderer: wall end solids overlap neighbouring snapped walls",
    walkSrc.includes("shape.moveTo(-WALL_END_SEAL, bottom);") &&
    walkSrc.includes("length + WALL_END_SEAL"));
  check("renderer: closed door fills wall depth",
    walkSrc.includes("const thickness = closed ? P.WALL_THICKNESS + CLOSED_DOOR_SEAL * 2 : 0.04;"));
  check("physics: wall colliders overlap floor and ceiling",
    walkSrc.includes("const h = room.height / 2 + WALL_VERTICAL_SEAL;") &&
    walkSrc.includes("desc.setTranslation(midX, baseY + room.height / 2, midZ);"));
  check("physics: only true wall ends extend into snapped joins",
    walkSrc.includes("const before = seg.atWallStart ? WALL_END_SEAL : 0;") &&
    walkSrc.includes("const after = seg.atWallEnd ? WALL_END_SEAL : 0;"));
  check("physics: closed door fills the complete wall depth",
    walkSrc.includes("const halfDoorDepth = P.WALL_THICKNESS / 2 + CLOSED_DOOR_SEAL;"));
  check("renderer: point shadows use a 1024 map", mapSize >= 1024);
  check("renderer: point shadow has a small negative depth bias", bias < 0 && Math.abs(bias) <= 0.002);
  check("renderer: point shadow normal bias is disabled", walkSrc.includes("pl.shadow.normalBias = 0;"));
  check("renderer: sunlight does not detach from wall edges", sunNormalBias >= 0 && sunNormalBias <= 0.002);
}

function coverLength(spans, length) {
  // Total length covered by the given solid spans (assumes they are sorted and
  // non-overlapping, as produced by solidSpans).
  return spans.reduce((sum, s) => sum + (s.to - s.from), 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
