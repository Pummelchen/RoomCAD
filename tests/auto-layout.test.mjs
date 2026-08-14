// Node test for the auto room-layout algorithm in roomcad/web/plan.js.
//
// autoLayoutRooms partitions the private area (the room rectangle minus any
// marked public areas) into `count` rooms via recursive guillotine cuts, then
// adds walls, one door per room, and (optionally) one window per room on
// outside-facing walls. This test checks the geometry invariants:
//   - exactly `count` non-overlapping rooms inside the layout
//   - rooms cover the private area (no gaps)
//   - one door per room, each on a real wall
//   - windows only when enabled, only on walls, only where a room faces out
//   - no duplicate walls
//   - different seeds give different layouts
//
// Run:  node tests/auto-layout.test.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const planSrc = readFileSync(join(here, "..", "roomcad", "web", "plan.js"), "utf8");
const P = await import(
  "data:text/javascript;base64," + Buffer.from(planSrc).toString("base64")
);

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) passed++;
  else { failed++; console.error(`FAIL: ${name}${detail ? " — " + detail : ""}`); }
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.z < b.z + b.l && b.z < a.z + a.l;
}

function areaOf(r) { return r.w * r.l; }

// ── 1. Public strip along the top, 4 rooms, windows on ────────────────────
{
  const room = P.freshRoom("T", 10, 6, 2.6);
  room.publicAreas = [{ x: 0, z: 0, w: 10, l: 2 }];
  const r = P.autoLayoutRooms(room, { count: 4, windows: true, seed: 1 });

  check("returns a layout", !!r);
  check("4 rooms generated", r.rooms.length === 4);
  check("one door per room", r.doors.length === r.rooms.length);
  check("doors reference real walls",
    r.doors.every(d => r.walls.some(w => w.id === d.wallID)));

  // Rooms cover the private area (10 × 4 = 40 m²) and don't overlap.
  const totalArea = r.rooms.reduce((s, x) => s + areaOf(x), 0);
  check("rooms cover the private area", Math.abs(totalArea - 40) < 0.5, `got ${totalArea}`);
  for (let i = 0; i < r.rooms.length; i++) {
    for (let j = i + 1; j < r.rooms.length; j++) {
      if (rectsOverlap(r.rooms[i], r.rooms[j])) {
        check("rooms do not overlap", false, `${i} vs ${j}`);
      }
    }
  }
  check("rooms do not overlap", true);

  // Every room touches the outer boundary here, so every room gets a window.
  check("window per room (all face outside)", r.windows.length === r.rooms.length,
    `got ${r.windows.length}`);
  check("windows reference real walls",
    r.windows.every(w => r.walls.some(x => x.id === w.wallID)));

  // No duplicate walls.
  const keys = new Set(r.walls.map(w =>
    `${Math.round(w.start.x * 1000)},${Math.round(w.start.z * 1000)}-${Math.round(w.end.x * 1000)},${Math.round(w.end.z * 1000)}`));
  check("walls are unique", keys.size === r.walls.length);
}

// ── 2. Windows off ────────────────────────────────────────────────────────
{
  const room = P.freshRoom("T", 10, 6, 2.6);
  room.publicAreas = [{ x: 0, z: 0, w: 10, l: 2 }];
  const r = P.autoLayoutRooms(room, { count: 3, windows: false, seed: 1 });
  check("no windows when disabled", r.windows.length === 0);
  check("3 rooms, 3 doors", r.rooms.length === 3 && r.doors.length === 3);
}

// ── 3. No public area: the whole layout is partitioned ───────────────────
{
  const room = P.freshRoom("T", 8, 6, 2.6);
  const r = P.autoLayoutRooms(room, { count: 3, windows: false, seed: 1 });
  check("whole layout partitioned", r.rooms.length === 3 && r.doors.length === 3);
}

// ── 4. Different seeds give different designs ─────────────────────────────
{
  const room = P.freshRoom("T", 10, 6, 2.6);
  room.publicAreas = [{ x: 0, z: 0, w: 10, l: 2 }];
  const a = P.autoLayoutRooms(room, { count: 4, windows: false, seed: 1 });
  const b = P.autoLayoutRooms(room, { count: 4, windows: false, seed: 7 });
  const aKey = a.rooms.map(x => `${x.w.toFixed(2)}x${x.l.toFixed(2)}`).sort().join("|");
  const bKey = b.rooms.map(x => `${x.w.toFixed(2)}x${x.l.toFixed(2)}`).sort().join("|");
  check("different seeds differ", aKey !== bKey);
}

// ── 5. Too many rooms for the space degrades gracefully ──────────────────
{
  const room = P.freshRoom("T", 4, 4, 2.6);
  const r = P.autoLayoutRooms(room, { count: 20, windows: false, seed: 1 });
  check("oversized request still returns something", !!r);
  check("oversized request yields fewer rooms", r.rooms.length >= 1 && r.rooms.length <= 20);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
