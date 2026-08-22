// Behavioural tests for the plan-editing features: wall-end attachment,
// resizable openings, public areas and labels. These exercise the real
// geometry in plan.js rather than grepping source.
//
// Run:  node tests/plan-editing.test.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const planSrc = readFileSync(join(root, "roomcad", "web", "plan.js"), "utf8");
const P = await import("data:text/javascript;base64," + Buffer.from(planSrc).toString("base64"));

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; return; }
  failed++;
  console.error("FAIL: " + name + (detail ? " — " + detail : ""));
}
const near = (a, b, eps = 0.011) => Math.abs(a - b) <= eps;

// ── Wall ends attach to the wall they meet ─────────────────────────────
{
  const room = P.freshRoom("Attach", 6, 4, 2.6);
  room.canvas = { width: 20, length: 20 };
  room.origin = { x: 0, z: 0 };
  // One vertical wall at x = 5, and a horizontal stub aimed at it.
  const target = { id: "target", start: P.point(5, 0), end: P.point(5, 10) };
  const stub = { id: "stub", start: P.point(0, 3), end: P.point(4.7, 3) };
  room.walls = [target, stub];

  // Dragging the stub's free end to just SHORT of the wall should still land
  // exactly on its centreline.
  const short = P.snapWallEndpoint(room, { x: 4.78, z: 3 }, stub.start, "stub");
  check("an end stopping short snaps onto the wall it meets", near(short.x, 5), `x=${short.x}`);
  check("snapping never breaks the 90° axis", near(short.z, 3), `z=${short.z}`);

  // And dragging it PAST the wall should pull it back, not leave it crossing.
  const past = P.snapWallEndpoint(room, { x: 5.22, z: 3 }, stub.start, "stub");
  check("an end overshooting is pulled back onto the wall", near(past.x, 5), `x=${past.x}`);

  // Far away, it must not snap — otherwise the wall could never be short.
  const far = P.snapWallEndpoint(room, { x: 3.0, z: 3 }, stub.start, "stub");
  check("a distant end is left where it was put", !near(far.x, 5), `x=${far.x}`);

  // A corner beats a mid-wall point at a comparable distance.
  const corner = P.wallAttachPoint(room, { x: 5.05, z: 0.06 }, 0.35, "stub");
  check("a nearby corner wins over the wall body",
    near(corner.x, 5) && near(corner.z, 0), JSON.stringify(corner));

  // A new wall drawn toward an existing one connects too.
  const drawn = P.snapWallEnd(room, { x: 4.8, z: 7 }, P.point(0, 7));
  check("a newly drawn wall connects to what it runs into", near(drawn.x, 5), `x=${drawn.x}`);
}

// ── Openings resize from either end ────────────────────────────────────
{
  const room = P.freshRoom("Openings", 6, 4, 2.6);
  const wall = room.walls[0];                       // (0,0) → (6,0) after centring
  const len = P.wallLength(wall);
  room.doors = [{ id: "d1", wallID: wall.id, offset: 2, width: 0.9, open: true, swingInside: true }];

  const ends = P.openingEndpoints(room, "door", "d1");
  check("an opening reports both of its endpoints", !!ends && !!ends.start && !!ends.end);
  check("the endpoints are the opening's real width apart",
    near(P.distance(ends.start, ends.end), 0.9), String(P.distance(ends.start, ends.end)));

  // Dragging the far end out widens it and leaves the near end alone.
  const wider = P.resizeOpeningEnd(room, "door", "d1", "end", P.wallPointAt(wall, 3.2));
  check("dragging the far end widens the opening", near(wider.width, 1.2), String(wider.width));
  check("dragging the far end leaves the near end pinned", near(wider.offset, 2), String(wider.offset));

  // Dragging the near end moves the offset and keeps the far end pinned.
  const fromStart = P.resizeOpeningEnd(room, "door", "d1", "start", P.wallPointAt(wall, 1.7));
  check("dragging the near end moves the offset", near(fromStart.offset, 1.7), String(fromStart.offset));
  check("dragging the near end keeps the far end pinned",
    near(fromStart.offset + fromStart.width, 2.9), String(fromStart.offset + fromStart.width));

  // Width limits hold from both directions.
  const tooWide = P.resizeOpeningEnd(room, "door", "d1", "end", P.wallPointAt(wall, len));
  check("a door cannot exceed its maximum width", tooWide.width <= P.MAX_OPENING_WIDTH.door + 1e-6,
    String(tooWide.width));
  const tooNarrow = P.resizeOpeningEnd(room, "door", "d1", "end", P.wallPointAt(wall, 2.05));
  check("a door cannot go below its minimum width", tooNarrow.width >= P.MIN_OPENING_WIDTH.door - 1e-6,
    String(tooNarrow.width));

  // And an opening always leaves wall at both ends.
  check("an opening never runs off the end of its wall",
    tooWide.offset >= 0.1 - 1e-6 && tooWide.offset + tooWide.width <= len - 0.1 + 1e-6);
}

// ── Public areas: pick, corners, resize ────────────────────────────────
{
  const room = P.freshRoom("Public", 6, 4, 2.6);
  room.publicAreas = [{ id: "a1", x: 2, z: 2, w: 3, l: 2 }];

  check("a point inside a public area finds it", P.publicAreaAt(room, { x: 3, z: 3 })?.id === "a1");
  check("a point outside finds nothing", P.publicAreaAt(room, { x: 9, z: 9 }) === null);

  const corners = P.publicAreaCorners(room.publicAreas[0]);
  check("a public area has four corners", corners.length === 4);
  check("the corners span the rectangle",
    corners.some(c => c.x === 2 && c.z === 2) && corners.some(c => c.x === 5 && c.z === 4));

  const hit = P.publicAreaCornerNear(room, { x: 5.02, z: 3.98 });
  check("a corner is grabbable near its position", hit && hit.corner === "se", JSON.stringify(hit));

  // Dragging the SE corner keeps the NW corner pinned.
  const resized = P.resizePublicArea(room.publicAreas[0], "se", { x: 6, z: 5 }, room);
  check("resizing keeps the opposite corner pinned", resized.x === 2 && resized.z === 2,
    JSON.stringify(resized));
  check("resizing updates the size", near(resized.w, 4) && near(resized.l, 3), JSON.stringify(resized));

  // Dragging a corner past its opposite flips rather than going negative.
  const flipped = P.resizePublicArea(room.publicAreas[0], "se", { x: 0.5, z: 0.5 }, room);
  check("dragging a corner past its opposite never yields a negative size",
    flipped.w > 0 && flipped.l > 0, JSON.stringify(flipped));
}

// ── Labels ─────────────────────────────────────────────────────────────
{
  const room = P.freshRoom("Labels", 6, 4, 2.6);
  room.labels = [{ id: "l1", text: "Kitchen", center: { x: 3, z: 2 }, rotationDegrees: 0, size: 0.22 }];

  check("a fresh room starts with an empty label list", Array.isArray(P.freshRoom("x").labels));
  const b = P.labelBounds(room.labels[0]);
  check("a label's box is wider than it is tall for normal text", b.w > b.h, `${b.w} ${b.h}`);
  check("clicking a label's centre finds it", P.labelNear(room, { x: 3, z: 2 })?.id === "l1");
  check("clicking well away from a label finds nothing", P.labelNear(room, { x: 0.2, z: 0.2 }) === null);

  // Labels survive a save/load round trip, with ids and clamped values.
  room.labels.push({ text: "  ", center: { x: 1, z: 1 }, rotationDegrees: 47, size: 99 });
  const restored = P.parseRoom(P.serializeRoom(room));
  check("labels round-trip through the file format", restored.labels.length === 2);
  check("a label without an id is given one", restored.labels.every(l => !!l.id));
  check("label rotation is snapped to 90° steps",
    restored.labels.every(l => l.rotationDegrees % 90 === 0),
    JSON.stringify(restored.labels.map(l => l.rotationDegrees)));
  check("label size is clamped to something drawable",
    restored.labels.every(l => l.size > 0 && l.size <= 1.0));
  check("public areas round-trip and gain ids",
    P.parseRoom(P.serializeRoom({ ...room, publicAreas: [{ x: 1, z: 1, w: 2, l: 2 }] }))
      .publicAreas.every(a => !!a.id));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
