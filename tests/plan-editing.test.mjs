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

// ── Existing designs pick up the new indicators on load ────────────────
// Dimensions and handles are derived from the model at render time, never
// stored, so any saved design gets them the moment it opens. What has to hold
// is that every element RESOLVES — an id-less object used to resolve to the
// first one of its kind, which drew two dimensions on top of each other and
// left the second element with none.
{
  const legacy = {
    format: P.ROOM_FILE_FORMAT,
    version: 1,
    room: {
      name: "Legacy", width: 6, length: 4, height: 2.6, grid: "fiveCentimeters",
      // No canvas, no origin, no publicAreas, no labels — and no ids anywhere.
      walls: [
        { start: { x: 0, z: 0 }, end: { x: 6, z: 0 } },
        { start: { x: 6, z: 0 }, end: { x: 6, z: 4 } },
        { start: { x: 6, z: 4 }, end: { x: 0, z: 4 } },
        { start: { x: 0, z: 4 }, end: { x: 0, z: 0 } },
      ],
      doors: [], windows: [], furniture: [],
    },
  };
  const room = P.parseRoom(JSON.stringify(legacy));
  check("a document with no ids still loads", room.walls.length === 4);
  check("walls are given distinct ids on load",
    new Set(room.walls.map(w => w.id)).size === 4);
  check("a document with no canvas or origin gets both",
    !!room.canvas && !!room.origin);
  check("a document with no public areas or labels gets empty lists",
    Array.isArray(room.publicAreas) && Array.isArray(room.labels));

  // Two openings on the same wall, neither carrying an id.
  const wall = room.walls[0];
  room.doors = [
    { wallID: wall.id, offset: 0.5, width: 0.9, open: true, swingInside: true },
    { wallID: wall.id, offset: 3.0, width: 0.8, open: true, swingInside: true },
  ];
  room.windows = [{ wallID: room.walls[1].id, offset: 1.0, width: 1.2 }];
  P.sanitize(room);

  check("openings are given distinct ids on load",
    new Set(room.doors.map(d => d.id)).size === 2 && !!room.windows[0].id);

  // Each opening must resolve to ITS OWN position, not the first one's.
  const offsets = room.doors.map(d => {
    const ends = P.openingEndpoints(room, "door", d.id);
    return ends ? Number(P.wallProjection(wall, ends.start).offset.toFixed(2)) : null;
  });
  check("each opening's dimension is drawn at its own position",
    near(offsets[0], 0.5) && near(offsets[1], 3.0), JSON.stringify(offsets));

  // And every element resolves, which is what makes the indicators appear.
  let unresolved = 0;
  for (const kind of ["door", "window"]) {
    for (const o of (kind === "door" ? room.doors : room.windows)) {
      if (!P.openingEndpoints(room, kind, o.id)) unresolved++;
    }
  }
  check("every opening in a legacy document resolves", unresolved === 0, String(unresolved));
  check("every wall in a legacy document has a drawable length",
    room.walls.every(w => P.wallLength(w) >= 0.01));
}

// ── Room area captions ─────────────────────────────────────────────────
{
  const room = P.freshRoom("T", 14, 10, 2.6);
  P.centerRoom(room);
  const gen = P.autoLayoutRooms(room, { count: 6, area: 14, seed: 1 });
  room.walls = gen.walls;
  room.doors = gen.doors;
  room.windows = gen.windows;
  room.publicAreas = gen.corridors.map((c, i) => ({ id: "g" + i, ...c, generated: true }));

  const regions = P.detectRooms(room);
  check("every enclosed room is found", regions.length >= gen.rooms.length,
    `${regions.length} vs ${gen.rooms.length}`);
  check("detected areas account for the whole floor",
    Math.abs(regions.reduce((s, r) => s + r.area, 0) - 140) < 1,
    String(regions.reduce((s, r) => s + r.area, 0)));
  check("detected areas match what the generator laid out",
    gen.rooms.every(g => regions.some(r => Math.abs(r.area - g.w * g.l) < 0.15)));

  // Doors are walls, not gaps: a doorway must not merge two rooms into one.
  check("a doorway does not merge the rooms it links", regions.length > 2, `${regions.length}`);

  const captions = P.roomCaptions(room, 0.9, 0.32);
  check("a caption for each room with a door", captions.length === gen.rooms.length,
    `${captions.length} vs ${gen.rooms.length}`);
  check("circulation gets no caption",
    !captions.some(c => Math.abs(c.area - gen.corridors.reduce((s, x) => s + x.w * x.l, 0)) < 0.5));

  // A room with no door gets no caption.
  const sealed = P.freshRoom("S", 6, 4, 2.6);
  P.centerRoom(sealed);
  check("a room with no door gets no caption", P.roomCaptions(sealed, 0.9, 0.32).length === 0);

  // The caption has to dodge whatever is on the floor.
  const target = regions.find(r => r.hasDoor && r.area > 8);
  const before = P.captionSpot(room, target, 0.9, 0.32);
  check("a caption is placed in an empty room", !!before);
  room.furniture = [{ id: "f", kind: "bed", center: { x: before.x, z: before.z }, rotationDegrees: 0 }];
  const after = P.captionSpot(room, target, 0.9, 0.32);
  check("the caption moves off furniture put on its spot", !!after
    && Math.hypot(after.x - before.x, after.z - before.z) > 0.3,
    JSON.stringify(after));
  const f = P.furnitureFootprint(room.furniture[0]);
  check("the caption box no longer overlaps the furniture",
    !(after.x - 0.45 < f.maxX && f.minX < after.x + 0.45
      && after.z - 0.16 < f.maxZ && f.minZ < after.z + 0.16));

  // A room with no clear space at all must yield NO caption rather than one
  // laid over the furniture. Scoring by clearance alone would still return the
  // least-bad overlapping spot, so this is what proves the hard check is there.
  {
    const tight = P.freshRoom("Tight", 2.6, 2.4, 2.6);
    P.centerRoom(tight);
    const w0 = tight.walls[0];
    tight.doors = [{ id: "d", wallID: w0.id, offset: 0.6, width: 0.9, open: true, swingInside: true }];
    const region = P.detectRooms(tight).find(r => r.hasDoor);
    check("the tight room is detected", !!region);
    const centre = { x: region.bounds.minX + (region.bounds.maxX - region.bounds.minX) / 2,
      z: region.bounds.minZ + (region.bounds.maxZ - region.bounds.minZ) / 2 };
    // Two wardrobes side by side leave no gap wide enough for the caption.
    tight.furniture = [
      { id: "a", kind: "bed", center: { x: centre.x, z: centre.z - 0.5 }, rotationDegrees: 90 },
      { id: "b", kind: "bed", center: { x: centre.x, z: centre.z + 0.5 }, rotationDegrees: 90 },
    ];
    const crowded = P.captionSpot(tight, region, 1.1, 0.42);
    if (crowded) {
      const clashes = tight.furniture.map(P.furnitureFootprint).some(f =>
        crowded.x - 0.55 < f.maxX && f.minX < crowded.x + 0.55 &&
        crowded.z - 0.21 < f.maxZ && f.minZ < crowded.z + 0.21);
      check("a caption is never laid over furniture, even when space is tight", !clashes,
        JSON.stringify(crowded));
    } else {
      check("a caption is never laid over furniture, even when space is tight", true);
    }
  }

  // And labels count as things to avoid, not just furniture.
  room.furniture = [];
  const spot = P.captionSpot(room, target, 0.9, 0.32);
  room.labels = [{ id: "l", text: "Bedroom one", center: { x: spot.x, z: spot.z },
    rotationDegrees: 0, size: 0.3 }];
  const dodged = P.captionSpot(room, target, 0.9, 0.32);
  check("the caption also dodges labels",
    !!dodged && Math.hypot(dodged.x - spot.x, dodged.z - spot.z) > 0.2,
    JSON.stringify(dodged));
}

// ── Public areas: on the grid, flush, never overlapping ────────────────
{
  const onGrid = (room, r) => {
    const step = P.GRID_STEPS[room.grid].meters;
    return [r.x, r.z, r.w, r.l].every(v => Math.abs(v / step - Math.round(v / step)) < 1e-6);
  };

  for (const grid of ["oneCentimeter", "twoCentimeters", "fiveCentimeters"]) {
    const room = P.freshRoom("T", 12, 8, 2.6);
    room.canvas = { width: 25, length: 25 };
    room.grid = grid;
    const r = P.settlePublicArea(room, { x: 7.037, z: 1.023, w: 2.114, l: 2.087 });
    check(`a public area lands on the ${P.GRID_STEPS[grid].label} grid`, onGrid(room, r),
      JSON.stringify(r));
  }

  const room = P.freshRoom("T", 12, 8, 2.6);
  room.canvas = { width: 25, length: 25 };
  room.publicAreas = [{ id: "a", x: 2, z: 2, w: 4, l: 3 }];   // spans x 2..6, z 2..5

  const fromLeft = P.settlePublicArea(room, { x: 0.5, z: 2.5, w: 3.0, l: 2.0 });
  check("an area drawn into a neighbour stops at its edge",
    Math.abs(fromLeft.x + fromLeft.w - 2) < 1e-6, JSON.stringify(fromLeft));
  const fromRight = P.settlePublicArea(room, { x: 5.0, z: 2.5, w: 3.0, l: 2.0 });
  check("and from the other side too",
    Math.abs(fromRight.x - 6) < 1e-6, JSON.stringify(fromRight));
  const nearlyFlush = P.settlePublicArea(room, { x: 6.04, z: 2.03, w: 2.0, l: 2.97 });
  check("an edge that is nearly flush snaps exactly onto its neighbour",
    Math.abs(nearlyFlush.x - 6) < 1e-6 && Math.abs(nearlyFlush.z - 2) < 1e-6,
    JSON.stringify(nearlyFlush));
  const clear = P.settlePublicArea(room, { x: 9, z: 6, w: 2, l: 2 });
  check("an area clear of everything is left where it was drawn",
    clear.x === 9 && clear.z === 6 && clear.w === 2 && clear.l === 2, JSON.stringify(clear));

  // Areas stay separate objects — settling must never merge them.
  room.publicAreas = [];
  for (const [x, z, w, l] of [[2, 2, 4, 3], [5.4, 2.1, 3, 3], [1.7, 4.6, 4, 2], [8, 1, 2, 6], [7.5, 5.5, 3, 2]]) {
    const r = P.settlePublicArea(room, { x, z, w, l });
    if (r.w > 0.3 && r.l > 0.3) room.publicAreas.push({ id: "p" + room.publicAreas.length, ...r });
  }
  let clashes = 0;
  for (let i = 0; i < room.publicAreas.length; i++) {
    for (let j = i + 1; j < room.publicAreas.length; j++) {
      const a = room.publicAreas[i], b = room.publicAreas[j];
      if (a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6
        && a.z < b.z + b.l - 1e-6 && b.z < a.z + a.l - 1e-6) clashes++;
    }
  }
  check("five overlapping draws leave five separate areas",
    room.publicAreas.length === 5, `${room.publicAreas.length}`);
  check("and none of them overlap", clashes === 0, `${clashes}`);
  check("each keeps its own id, so each stays selectable",
    new Set(room.publicAreas.map(a => a.id)).size === 5);
}

// ── A wall may not be started out in the empty grid ────────────────────
// A wall begun far from the building joins nothing and encloses nothing; it is
// a misclick, not a plan.
{
  const room = P.freshRoom("T", 6, 4, 2.6);
  room.origin = { x: 0, z: 0 };
  room.canvas = { width: 25, length: 25 };
  P.sanitize(room);

  check("a wall can start inside the building", P.canStartWallAt(room, { x: 3, z: 2 }));
  check("a wall can start on a corner", P.canStartWallAt(room, { x: 0, z: 0 }));
  check("a wall can start just outside a wall, to extend it",
    P.canStartWallAt(room, { x: 6.3, z: 2 }));
  check("a wall cannot start out in the empty grid",
    !P.canStartWallAt(room, { x: 15, z: 15 }));
  check("nor just beyond the reach of the building",
    !P.canStartWallAt(room, { x: 6.9, z: 2 }));

  // The very first wall has nothing to join, so it may start anywhere.
  const empty = P.freshRoom("E", 6, 4, 2.6);
  empty.walls = [];
  check("the first wall of an empty plan can start anywhere",
    P.canStartWallAt(empty, { x: 15, z: 15 }));

  const bounds = P.wallsBounds(room);
  check("wall bounds cover the drawn walls",
    bounds && bounds.minX === 0 && Math.abs(bounds.maxX - 6) < 0.001);
  check("an empty plan has no wall bounds", P.wallsBounds(empty) === null);
}

// ── Overlapping walls are reported ─────────────────────────────────────
{
  const room = P.freshRoom("O", 6, 4, 2.6);
  room.origin = { x: 0, z: 0 };
  room.canvas = { width: 25, length: 25 };
  P.sanitize(room);

  // The corners of an ordinary room are shared by design. Reporting them would
  // paint every corner of every plan as a fault.
  check("a plain rectangle of walls reports no overlap",
    P.overlappingWallAreas(room).length === 0);

  room.walls.push({ id: "dup", start: P.point(1, 0), end: P.point(4, 0) });
  const doubled = P.overlappingWallAreas(room);
  check("a wall drawn on top of another is reported", doubled.length === 1, `${doubled.length}`);
  check("the reported area is the stretch they share",
    Math.abs(doubled[0].w - 3) < 0.001 && Math.abs(doubled[0].l - P.WALL_THICKNESS) < 0.001,
    JSON.stringify(doubled[0]));
  check("the report names both walls involved",
    doubled[0].walls.length === 2 && doubled[0].walls.includes("dup"));

  // A wall crossing another at a right angle is a junction, not a fault.
  room.walls.push({ id: "cross", start: P.point(3, 0), end: P.point(3, 4) });
  check("a wall crossing at 90° is still not reported",
    P.overlappingWallAreas(room).length === 1,
    String(P.overlappingWallAreas(room).length));

  // Near-parallel counts too: a wall a few centimetres off still doubles up.
  const near = P.freshRoom("N", 6, 4, 2.6);
  near.origin = { x: 0, z: 0 };
  near.canvas = { width: 25, length: 25 };
  near.walls = [
    { id: "a", start: P.point(0, 0), end: P.point(6, 0) },
    { id: "b", start: P.point(0, 0.03), end: P.point(6, 0.03) },
  ];
  check("a parallel wall a few centimetres off is reported",
    P.overlappingWallAreas(near).length === 1);

  // Walls that merely meet end to end are a continuation, not an overlap.
  const chain = P.freshRoom("C", 6, 4, 2.6);
  chain.origin = { x: 0, z: 0 };
  chain.canvas = { width: 25, length: 25 };
  chain.walls = [
    { id: "a", start: P.point(0, 0), end: P.point(3, 0) },
    { id: "b", start: P.point(3, 0), end: P.point(6, 0) },
  ];
  check("walls meeting end to end are not an overlap",
    P.overlappingWallAreas(chain).length === 0);
}

// ── The Room Name is the file name ─────────────────────────────────────
{
  check("a plain name becomes a usable file name", P.roomSlug("My Bedroom") === "My-Bedroom");
  check("accents fold to their base letter rather than being dropped",
    P.roomSlug("Küche") === "Kuche", P.roomSlug("Küche"));
  check("punctuation collapses to single dashes",
    P.roomSlug("Flat #3 / attic") === "Flat-3-attic", P.roomSlug("Flat #3 / attic"));
  check("surrounding space and dashes are trimmed",
    P.roomSlug("  spaced  out  ") === "spaced-out", P.roomSlug("  spaced  out  "));
  check("an empty or punctuation-only name yields nothing, so the server names it",
    P.roomSlug("") === "" && P.roomSlug("---") === "");
  check("the result is always a legal server name",
    /^[A-Za-z0-9_-]*$/.test(P.roomSlug("Ünïcödé Rööm ✳ 2/3")), P.roomSlug("Ünïcödé Rööm ✳ 2/3"));
  check("very long names are capped", P.roomSlug("a".repeat(200)).length === 48);
  check("renaming changes the file it saves to",
    P.roomSlug("Attic") !== P.roomSlug("Attic Copy"));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
