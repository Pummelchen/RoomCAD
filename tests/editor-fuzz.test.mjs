// Behavioural stress test for the 2D editor.
//
// editor2d.js is 2000 lines of pointer handling, and until now it was checked
// by reading its own source: a test asserted the file still mentioned a
// function. That catches a deleted line and nothing else — it cannot tell you
// what happens when someone drags a wall onto another one, or lets go outside
// the canvas, or draws with two fingers.
//
// So this constructs the real Editor2D against a stub DOM and drives it with
// synthetic pointer, wheel and keyboard input across every tool, then checks
// the things that must hold of the plan no matter what was done to it:
//
//   - nothing in the plan is NaN, and nothing is shorter than a wall may be;
//   - every door and window is on a wall that exists, and within its ends;
//   - the plan can still be saved and reopened, with everything still there;
//   - undo genuinely goes back, and never throws;
//   - the view stays somewhere a person can see.
//
// Run:  node tests/editor-fuzz.test.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { installDOM } from "./harness/dom-stub.mjs";
import { loadWebModule } from "./harness/load-web-module.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const dom = installDOM();
const P = await loadWebModule("plan.js");
const { store } = await loadWebModule("store.js");
const { Editor2D } = await loadWebModule("editor2d.js");

let passed = 0;
let failed = 0;
function check(name, condition, detail = "") {
  if (condition) { passed++; return; }
  failed++;
  console.error("FAIL: " + name + (detail ? " — " + detail : ""));
}

const violations = new Map();
const note = (what, detail) => {
  if (!violations.has(what)) violations.set(what, { count: 0, first: detail });
  violations.get(what).count++;
};

const TOOLS = ["select", "wall", "door", "window", "furniture", "erase", "measure", "public", "label", "rooms"];
const FURNITURE = ["bed", "table", "chair", "sofa", "desk", "wardrobe"];

let seed = 991117;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = list => list[Math.floor(rnd() * list.length)];

const editor = new Editor2D(dom.canvas);

/// Where the plan currently sits on screen, so a gesture can be aimed at it.
function planBox() {
  const b = editor.contentBounds();
  if (!b || !Number.isFinite(b.minX)) return null;
  const a = editor.screen({ x: b.minX, z: b.minZ });
  const c = editor.screen({ x: b.maxX, z: b.maxZ });
  return {
    x0: Math.min(a.x, c.x), x1: Math.max(a.x, c.x),
    y0: Math.min(a.y, c.y), y1: Math.max(a.y, c.y),
  };
}

/// The screen point for a spot a given fraction across the plan.
function atPlan(fx, fz) {
  const b = editor.contentBounds();
  return editor.screen({
    x: b.minX + (b.maxX - b.minX) * fx,
    z: b.minZ + (b.maxZ - b.minZ) * fz,
  });
}

/// One complete gesture: press, some number of moves, release. Returns the
/// number of handlers that ran, so a gesture nothing listened to is visible.
function gesture(x0, y0, steps, opts = {}) {
  const mods = {
    shiftKey: opts.shift || false, altKey: opts.alt || false,
    ctrlKey: opts.ctrl || false, metaKey: opts.meta || false,
    button: opts.button || 0, buttons: 1, pointerId: opts.pointerId || 1,
    pointerType: opts.pointerType || "mouse",
  };
  let ran = 0;
  ran += dom.canvas.dispatch("pointerdown", { clientX: x0, clientY: y0, ...mods });
  let x = x0;
  let y = y0;
  for (const [dx, dy] of steps) {
    x += dx; y += dy;
    ran += dom.canvas.dispatch("pointermove", { clientX: x, clientY: y, ...mods });
  }
  ran += dom.canvas.dispatch("pointerup", { clientX: x, clientY: y, ...mods, buttons: 0 });
  return { ran, end: { x, y } };
}

/// Everything that must be true of the plan, whatever was just done to it.
function inspect(room, where) {
  const ids = new Set();
  const seeID = (id, kind) => {
    if (id === undefined || id === null || id === "") { note("something with no id", kind); return; }
    if (ids.has(id)) note("two things sharing an id", `${kind} ${id}`);
    ids.add(id);
  };
  const num = (v, what) => {
    if (!Number.isFinite(v)) { note("a non-finite number in the plan", `${what} in ${where}`); return false; }
    if (Math.abs(v) > 1e5) { note("a coordinate impossibly far out", `${what}=${v}`); return false; }
    return true;
  };

  for (const w of room.walls) {
    seeID(w.id, "wall");
    num(w.start.x, "wall.start.x"); num(w.start.z, "wall.start.z");
    num(w.end.x, "wall.end.x"); num(w.end.z, "wall.end.z");
    const len = P.wallLength(w);
    // Below this the wall does not survive a reload: sanitize drops it, and a
    // boundary silently becomes a doorway-sized hole.
    if (len < P.MIN_WALL_LENGTH - 1e-9) {
      note("a wall too short to survive a reload", `${len.toFixed(3)} m in ${where}`);
    }
  }

  const wallByID = new Map(room.walls.map(w => [w.id, w]));
  for (const [kind, list] of [["door", room.doors], ["window", room.windows]]) {
    for (const o of list) {
      seeID(o.id, kind);
      if (!num(o.offset, `${kind}.offset`) || !num(o.width, `${kind}.width`)) continue;
      if (!(o.width > 0)) note("an opening with no width", `${kind} ${o.width}`);
      if (o.offset < -1e-6) note("an opening before the start of its wall", `${kind} ${o.offset}`);
      const w = wallByID.get(o.wallID);
      if (!w) { note("an opening on a wall that is not there", kind); continue; }
      if (o.offset + o.width > P.wallLength(w) + 1e-6) {
        note("an opening past the end of its wall", `${kind} ${(o.offset + o.width).toFixed(3)} > ${P.wallLength(w).toFixed(3)}`);
      }
    }
  }

  // Two openings on one wall must not sit on top of each other.
  const byWall = new Map();
  for (const o of [...room.doors, ...room.windows]) {
    if (!byWall.has(o.wallID)) byWall.set(o.wallID, []);
    byWall.get(o.wallID).push(o);
  }
  for (const [, list] of byWall) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (a.offset < b.offset + b.width - 1e-6 && b.offset < a.offset + a.width - 1e-6) {
          note("two openings on the same wall overlap", where);
        }
      }
    }
  }

  for (const f of room.furniture || []) {
    seeID(f.id, "furniture");
    num(f.center.x, "furniture.center.x"); num(f.center.z, "furniture.center.z");
    if (!Number.isFinite(f.rotationDegrees)) {
      note("furniture with a non-finite angle", String(f.rotationDegrees));
    }
  }
  for (const l of room.labels || []) {
    seeID(l.id, "label");
    num(l.center.x, "label.center.x"); num(l.center.z, "label.center.z");
    if (!Number.isFinite(l.rotationDegrees)) note("a label at a non-finite angle", String(l.rotationDegrees));
    if (!(l.size > 0)) note("a label with no size", String(l.size));
  }
  for (const a of room.publicAreas || []) {
    seeID(a.id, "public area");
    num(a.x, "public.x"); num(a.z, "public.z");
    if (!(a.w > 0) || !(a.l > 0)) note("a public area with no size", `${a.w}×${a.l}`);
  }

  // A plan that cannot be reopened is a plan that has been lost.
  try {
    const reopened = P.parseRoom(P.serializeRoom(room));
    if (!reopened) note("a plan that will not reopen", where);
    else if (reopened.walls.length !== room.walls.length) {
      note("walls disappear when the plan is reopened",
        `${room.walls.length} saved, ${reopened.walls.length} came back`);
    }
  } catch (err) {
    note("saving the plan threw", `${where}: ${err.message}`);
  }
}

/// The view must stay somewhere a person can actually see.
function inspectView(where) {
  if (!Number.isFinite(editor.scale) || editor.scale <= 0) {
    note("a zoom level that shows nothing", `${editor.scale} in ${where}`);
  } else if (editor.scale < 1 || editor.scale > 100000) {
    note("a zoom level far outside anything usable", String(editor.scale));
  }
  if (!Number.isFinite(editor.origin.x) || !Number.isFinite(editor.origin.y)) {
    note("a non-finite view origin", where);
  }
}

// ── The sweep ─────────────────────────────────────────────────────────────
const startingRoom = store.room;
const startingCount = startingRoom.walls.length + startingRoom.doors.length
  + startingRoom.windows.length + (startingRoom.furniture || []).length
  + (startingRoom.labels || []).length + (startingRoom.publicAreas || []).length;

const W = dom.canvas.clientWidth;
const H = dom.canvas.clientHeight;
let gestures = 0;
let handled = 0;

for (let trial = 0; trial < 600; trial++) {
  const tool = pick(TOOLS);
  store.chooseTool(tool);
  if (tool === "furniture") store.beginFurniturePlacement(pick(FURNITURE));

  // Aim at where the plan actually is on screen. The room occupies a few
  // hundred pixels of a 1200×800 canvas, so uniformly random points would
  // spend the whole sweep dragging empty space and never touch a wall. A fifth
  // of gestures are still deliberately thrown outside it, since letting go off
  // the edge of the plan is a real thing people do.
  const box = planBox();
  let x0, y0;
  if (rnd() < 0.8 && box) {
    x0 = Math.round(box.x0 - 30 + rnd() * (box.x1 - box.x0 + 60));
    y0 = Math.round(box.y0 - 30 + rnd() * (box.y1 - box.y0 + 60));
  } else {
    x0 = Math.round((rnd() * 1.2 - 0.1) * W);
    y0 = Math.round((rnd() * 1.2 - 0.1) * H);
  }
  const moves = [];
  const n = Math.floor(rnd() * 6);
  for (let i = 0; i < n; i++) {
    moves.push([Math.round((rnd() - 0.5) * 300), Math.round((rnd() - 0.5) * 300)]);
  }

  try {
    const g = gesture(x0, y0, moves, {
      shift: rnd() < 0.2, alt: rnd() < 0.1, ctrl: rnd() < 0.1,
      button: rnd() < 0.05 ? 2 : 0,
    });
    gestures++;
    handled += g.ran;
  } catch (err) {
    note("a gesture threw", `${tool}: ${err.message}`);
    continue;
  }

  // Occasionally the other things a person does mid-edit.
  if (rnd() < 0.15) {
    try {
      dom.canvas.dispatch("wheel", {
        clientX: rnd() * W, clientY: rnd() * H,
        deltaY: (rnd() - 0.5) * 2000, ctrlKey: rnd() < 0.3,
      });
    } catch (err) { note("the wheel threw", err.message); }
  }
  if (rnd() < 0.1) {
    try { dom.canvas.dispatch("dblclick", { clientX: rnd() * W, clientY: rnd() * H }); }
    catch (err) { note("a double click threw", err.message); }
  }
  if (rnd() < 0.08) {
    try { dom.canvas.dispatch("contextmenu", { clientX: rnd() * W, clientY: rnd() * H }); }
    catch (err) { note("the context menu threw", err.message); }
  }
  if (rnd() < 0.2) {
    const key = pick(["Escape", "Delete", "Backspace", " ", "Shift", "r", "z", "ArrowLeft", "ArrowUp"]);
    try {
      dom.window.dispatch("keydown", { key, ctrlKey: key === "z", metaKey: false });
      dom.window.dispatch("keyup", { key });
    } catch (err) { note("a key threw", `${key}: ${err.message}`); }
  }
  // Losing the window mid-drag: the drag must not be left half-finished.
  if (rnd() < 0.05) {
    try { dom.window.dispatch("blur", {}); } catch (err) { note("blur threw", err.message); }
  }

  // Redrawing must survive whatever state the gesture left behind.
  try { dom.flushFrames(); }
  catch (err) { note("drawing threw", `after ${tool}: ${err.message}`); }

  inspect(store.room, tool);
  inspectView(tool);
}

check("every gesture was handled by the editor", handled >= gestures * 2,
  `${handled} handlers ran over ${gestures} gestures`);
check("the sweep actually ran", gestures >= 590, `${gestures} gestures`);

// A sweep that changes nothing proves nothing: if the gestures all miss, every
// invariant below holds trivially. So the sweep has to have moved the plan.
const r = store.room;
const touched = r.walls.length + r.doors.length + r.windows.length
  + (r.furniture || []).length + (r.labels || []).length + (r.publicAreas || []).length;
check("the sweep actually changed the plan", touched !== startingCount,
  `${startingCount} things before, ${touched} after`);
check("the sweep reached the undo history", store.undoStack.length > 5,
  `${store.undoStack.length} undoable steps recorded`);
console.log(`  sweep left: ${r.walls.length} walls, ${r.doors.length} doors, `
  + `${r.windows.length} windows, ${(r.furniture || []).length} furniture, `
  + `${(r.labels || []).length} labels, ${(r.publicAreas || []).length} public areas, `
  + `${store.undoStack.length} undo steps`);

// ── A click is not a drag ─────────────────────────────────────────────────
//
// Pressing and releasing without moving must never leave a wall behind: a
// zero-length wall is dropped on reload, and the boundary becomes a hole.
{
  store.chooseTool("wall");
  const before = store.room.walls.length;
  for (let i = 0; i < 30; i++) {
    const at = atPlan(0.2 + i * 0.02, 0.2 + i * 0.02);
    gesture(Math.round(at.x), Math.round(at.y), []);
  }
  check("clicking with the wall tool does not leave stray walls behind",
    store.room.walls.length === before,
    `${store.room.walls.length - before} walls appeared from clicks`);
}

// ── Drawing a wall actually draws one ─────────────────────────────────────
//
// On a plan of its own, then handed back. Run on whatever the random sweep
// happened to leave behind, this drew its wall into a plan already full of
// them and failed when the stroke landed on top of one — which says nothing
// about whether the wall tool works. The checks that follow still want the
// sweep's plan, so it is put back afterwards.
{
  const sweptPlan = store.room;
  store.room = P.freshRoom("Wall test", 8, 6, 2.6);
  P.centerRoom(store.room);
  P.sanitize(store.room);
  store.chooseTool("wall");
  const before = store.room.walls.length;
  const from = atPlan(0.25, 0.4);
  const to = atPlan(0.75, 0.4);
  const dx = Math.round((to.x - from.x) / 2);
  const dy = Math.round((to.y - from.y) / 2);
  gesture(Math.round(from.x), Math.round(from.y), [[dx, dy], [dx, dy]]);
  const after = store.room.walls.length;
  check("dragging with the wall tool draws a wall", after === before + 1,
    `${before} became ${after}`);
  if (after > before) {
    const w = store.room.walls[store.room.walls.length - 1];
    check("the wall it drew is long enough to survive a reload",
      P.wallLength(w) >= P.MIN_WALL_LENGTH, `${P.wallLength(w).toFixed(3)} m`);
    check("the wall it drew has finite ends",
      [w.start.x, w.start.z, w.end.x, w.end.z].every(Number.isFinite));
  }
  store.room = sweptPlan;
}

// ── A drag too short to be a wall ─────────────────────────────────────────
//
// Below 30 cm a wall does not survive sanitize on reload: it is dropped, and
// the boundary it formed becomes a hole that merges two rooms into one. So a
// short drag must be refused at the point of drawing, not saved and lost later.
{
  store.chooseTool("wall");
  const before = store.room.walls.length;
  const a = atPlan(0.4, 0.5);
  // A hair under the minimum, in pixels at the current zoom.
  const px = (P.MIN_WALL_LENGTH * 0.6) * editor.scale;
  for (let i = 0; i < 12; i++) {
    gesture(Math.round(a.x) + i * 3, Math.round(a.y) + i * 3, [[Math.round(px), 0]]);
  }
  // A short drag does not always mean no wall: the end snaps to nearby
  // geometry, so a 18 cm pull next to an existing wall can legitimately reach
  // far enough to be one. What must never happen is a wall being committed
  // that is still under the minimum — that one is dropped on the next load.
  const added = store.room.walls.slice(before);
  const unsavable = added.filter(w => P.wallLength(w) < P.MIN_WALL_LENGTH - 1e-9);
  check("a drag shorter than the minimum never commits an unsavable wall",
    unsavable.length === 0,
    unsavable.map(w => P.wallLength(w).toFixed(3) + " m").join(", "));
  check("either the drag was refused, or snapping made it a real wall",
    added.length === 0 ? /30 cm/.test(store.status || "") : true,
    added.length === 0 ? (store.status || "(no status)") : `${added.length} snapped out to full length`);
}

// ── Undo goes back ────────────────────────────────────────────────────────
{
  store.chooseTool("wall");
  const before = store.room.walls.length;
  const a = atPlan(0.3, 0.6);
  const b = atPlan(0.7, 0.6);
  gesture(Math.round(a.x), Math.round(a.y), [[Math.round(b.x - a.x), Math.round(b.y - a.y)]]);
  const drawn = store.room.walls.length;
  check("the wall for the undo test was drawn", drawn === before + 1, `${before} → ${drawn}`);
  let threw = null;
  try { if (store.canUndo()) store.undo(); } catch (err) { threw = err.message; }
  check("undo does not throw", threw === null, threw || "");
  check("undo removes the wall that was just drawn",
    store.room.walls.length === before, `${store.room.walls.length} left, expected ${before}`);
  inspect(store.room, "after undo");
}

// ── A drag interrupted by losing the window ───────────────────────────────
//
// Alt-tabbing mid-drag fires blur with no pointerup. The editor must not be
// left believing a drag is still in progress, or the next click continues it.
{
  store.chooseTool("wall");
  const before = store.room.walls.length;
  const p1 = atPlan(0.2, 0.25);
  const p2 = atPlan(0.6, 0.25);
  const p3 = atPlan(0.4, 0.8);
  dom.canvas.dispatch("pointerdown", { clientX: Math.round(p1.x), clientY: Math.round(p1.y) });
  dom.canvas.dispatch("pointermove", { clientX: Math.round(p2.x), clientY: Math.round(p2.y) });
  dom.window.dispatch("blur", {});
  // Now a completely separate click somewhere else.
  dom.canvas.dispatch("pointerdown", { clientX: Math.round(p3.x), clientY: Math.round(p3.y) });
  dom.canvas.dispatch("pointerup", { clientX: Math.round(p3.x), clientY: Math.round(p3.y), buttons: 0 });
  const after = store.room.walls.length;
  check("a drag abandoned by leaving the window does not run into the next click",
    after - before <= 1, `${after - before} walls appeared`);
  inspect(store.room, "after an interrupted drag");

  // The contract behind that: losing the window ends the drag outright. If it
  // did not, the editor would still believe a wall was being drawn, and the
  // next release anywhere on the plan would commit one between two points the
  // user never meant to connect.
  dom.canvas.dispatch("pointerdown", { clientX: Math.round(p1.x), clientY: Math.round(p1.y) });
  dom.canvas.dispatch("pointermove", { clientX: Math.round(p2.x), clientY: Math.round(p2.y) });
  check("a drag is in progress before the window is lost", editor.drag !== null);
  dom.window.dispatch("blur", {});
  check("losing the window ends the drag", editor.drag === null,
    JSON.stringify(editor.drag));
  check("and forgets the pointers that were down", editor.pointers.size === 0,
    `${editor.pointers.size} still tracked`);
}

// ── The two ways in that pointer input cannot reach ───────────────────────
//
// The editor refuses a too-short drag before it ever calls the store, so the
// store's own length guard is a second line of defence that no gesture can
// exercise — and a second line of defence nobody tests is one that can be
// removed without anything noticing. The sidebar's offset field is the other:
// it sets an opening's position by number, bypassing the drag handler
// entirely, so it needs its own check that the opening stays on its wall.
{
  const wall = store.room.walls[0];
  const before = store.room.walls.length;
  const along = P.MIN_WALL_LENGTH / 3;
  const dir = { x: (wall.end.x - wall.start.x), z: (wall.end.z - wall.start.z) };
  const len = Math.hypot(dir.x, dir.z) || 1;
  const from = { x: wall.start.x + 1, z: wall.start.z + 1 };
  const to = { x: from.x + (dir.x / len) * along, z: from.z + (dir.z / len) * along };
  const ok = store.addWall(from, to);
  const added = store.room.walls.slice(before);
  check("the store refuses a wall under the minimum even when asked directly",
    added.every(w => P.wallLength(w) >= P.MIN_WALL_LENGTH - 1e-9),
    added.map(w => P.wallLength(w).toFixed(3)).join(", ") || "none added");
  // Without the guard the wall is still not added — sanitize drops it during
  // the commit — but the call reports success, so the caller believes a wall
  // was drawn and the user is told nothing at all. Saying "done" while doing
  // nothing is the failure here, not a corrupt plan.
  check("refusing a too-short wall is reported, not silent",
    added.length > 0 ? ok !== false : (ok === false && /30 cm/.test(store.status || "")),
    `returned ${ok}, added ${added.length}, status "${store.status || ""}"`);
}
{
  // Both kinds, because they are two separate code paths in the store and a
  // fix applied to one has been left off the other before.
  let checked = 0;
  let escaped = 0;
  for (const [kind, list] of [["door", store.room.doors], ["window", store.room.windows]]) {
    for (const opening of list.slice(0, 4)) {
      const wall = store.room.walls.find(w => w.id === opening.wallID);
      if (!wall) continue;
      for (const asked of [-1e9, -500, -1, 0, 0.5, 999, 1e9, NaN]) {
        store.slideOpeningToOffset(kind, opening.id, asked);
        const now = list.find(o => o.id === opening.id);
        if (!now) continue;
        checked++;
        if (!Number.isFinite(now.offset)) {
          escaped++;
          note("an opening moved to a non-finite offset", `${kind}, asked for ${asked}`);
        } else if (now.offset < -1e-6 || now.offset + now.width > P.wallLength(wall) + 1e-6) {
          escaped++;
          note("an opening past the end of its wall", `${kind}, asked for ${asked}`);
        }
      }
    }
  }
  check("typing any offset at all keeps every opening on its wall",
    escaped === 0 && checked > 0, `${escaped} escaped over ${checked} attempts`);
}

// ── The plan survives the whole session ───────────────────────────────────
{
  const room = store.room;
  check("the plan still has its walls after everything", room.walls.length > 0,
    `${room.walls.length} walls`);
  let reopened = null;
  try { reopened = P.parseRoom(P.serializeRoom(room)); } catch (err) { /* noted below */ }
  check("the plan can still be saved and reopened at the end", !!reopened);
  if (reopened) {
    check("and comes back with the same walls",
      reopened.walls.length === room.walls.length,
      `${room.walls.length} saved, ${reopened.walls.length} returned`);
    check("and the same doors and windows",
      reopened.doors.length === room.doors.length && reopened.windows.length === room.windows.length,
      `${room.doors.length}/${room.windows.length} vs ${reopened.doors.length}/${reopened.windows.length}`);
  }
}

const EXPECTED = [
  "a gesture threw",
  "the wheel threw",
  "a double click threw",
  "the context menu threw",
  "a key threw",
  "blur threw",
  "drawing threw",
  "a non-finite number in the plan",
  "a coordinate impossibly far out",
  "a wall too short to survive a reload",
  "something with no id",
  "two things sharing an id",
  "an opening with no width",
  "an opening before the start of its wall",
  "an opening on a wall that is not there",
  "an opening past the end of its wall",
  "an opening moved to a non-finite offset",
  "two openings on the same wall overlap",
  "furniture with a non-finite angle",
  "a public area with no size",
  "a label at a non-finite angle",
  "a label with no size",
  "a plan that will not reopen",
  "walls disappear when the plan is reopened",
  "saving the plan threw",
  "a zoom level that shows nothing",
  "a zoom level far outside anything usable",
  "a non-finite view origin",
];
for (const name of EXPECTED) {
  const v = violations.get(name);
  check(`never: ${name}`, !v, v ? `${v.count} times, e.g. ${v.first}` : "");
}

// ── Dragging a wall, with the real store ─────────────────────────────────
//
// Two things a person doing this by hand needs: the numbers keep up with the
// wall while it is moving, and the wall moves at all.
{
  store.room = P.freshRoom("Drag", 6, 4, 2.6);
  P.centerRoom(store.room);
  P.sanitize(store.room);
  store.outsideWallsFree = false;

  const wall = store.room.walls[0];
  check("the plan starts as one closed room", P.detectRooms(store.room).length === 1);
  check("an outside wall is held still to begin with", store.wallIsLocked(wall.id));
  check("and moving it is refused", store.moveWall(wall.id, 0, -0.2) === false);
  check("with a message saying how to free it",
    /free it|free to drag/i.test(store.status), store.status);

  // Freed, in one switch rather than wall by wall.
  store.setOutsideWallsFree(true);
  check("freeing the outside walls unlocks this one", !store.wallIsLocked(wall.id));

  // Now drag it, and watch the area while it moves.
  let told = 0;
  const stop = store.onChange(() => told++);
  const areas = [];
  for (let i = 0; i < 5; i++) {
    if (store.moveWall(wall.id, 0, -0.1)) areas.push(P.floorArea(store.room));
  }
  if (typeof stop === "function") stop();
  check("the wall actually moves", areas.length === 5, `${areas.length} of 5 steps`);
  check("the area is recalculated at every step of the drag",
    new Set(areas.map(a => a.toFixed(3))).size === areas.length,
    areas.map(a => a.toFixed(2)).join(" -> "));
  check("and it changes in one direction, as a wall being slid should",
    areas.every((a, i) => i === 0 || a > areas[i - 1]) ||
    areas.every((a, i) => i === 0 || a < areas[i - 1]),
    areas.map(a => a.toFixed(2)).join(" -> "));
  // The panel only redraws when the store says something changed. Without this
  // the floor area sat at its pre-drag value until the mouse came up.
  check("the panel is told while the wall is still moving", told >= 5, `${told} times`);

  // And back under lock.
  store.setOutsideWallsFree(false);
  check("locking them again holds this one still", store.wallIsLocked(wall.id));
}

// ── The area label, while you are working on the wall ────────────────────
//
// Reported as "I still do not get realtime room m² labels when I drag a wall
// to resize a room". The label was being recomputed on every step of the drag
// — that part worked — but it is placed in the emptiest part of the ROOM, and
// when you have zoomed in on the wall you are dragging, the emptiest part of
// the room is off the side of the screen. So the room showed no area at all,
// at exactly the moment the number is what you are dragging towards.
{
  store.room = P.freshRoom("Big", 12, 9, 2.6);
  P.centerRoom(store.room);
  P.sanitize(store.room);
  // Fitted first: six hundred random gestures have left the view wherever they
  // left it, and "with the whole room in view" has to actually be true for the
  // first of these checks to mean anything.
  editor.fit();
  editor.draw();
  const first = (editor._captions || [])[0];
  check("a closed room has an area label", !!first, `${(editor._captions || []).length}`);
  check("and it reads the floor it encloses",
    first && Math.abs(first.area - 12 * 9) < 0.5, first ? `${first.area}` : "none");

  // Whole room in view: the label stays where the layout put it.
  const ideal = editor.screen({ x: first.x, z: first.z });
  const placed = editor.visibleCaptionSpot(first);
  check("with the whole room in view the label stays in its chosen spot",
    placed && Math.abs(placed.x - ideal.x) < 0.01 && Math.abs(placed.y - ideal.y) < 0.01);

  // Zoomed in on one corner, the way you do to drag a wall to a measurement.
  const savedScale = editor.scale;
  const savedOrigin = { ...editor.origin };
  const o = P.roomOrigin(store.room);
  editor.scale = 200;
  const corner = editor.screen({ x: o.x + 0.5, z: o.z + 0.5 });
  editor.origin = { x: editor.origin.x - corner.x + 100, y: editor.origin.y - corner.y + 100 };
  editor.draw();
  const zoomed = (editor._captions || [])[0];
  const off = editor.screen({ x: zoomed.x, z: zoomed.z });
  const onScreen = p => p.x >= 0 && p.y >= 0
    && p.x <= dom.canvas.width && p.y <= dom.canvas.height;
  check("zoomed in, the chosen spot really is off the screen", !onScreen(off),
    `${off.x.toFixed(0)},${off.y.toFixed(0)} on ${dom.canvas.width}x${dom.canvas.height}`);
  const shown = editor.visibleCaptionSpot(zoomed);
  check("so the label is drawn on the part of the room you can see",
    shown && onScreen(shown), shown ? `${shown.x.toFixed(0)},${shown.y.toFixed(0)}` : "not drawn");

  // And that is where it ACTUALLY lands on the canvas. Asking the method where
  // it would go says nothing about whether the drawing asks it.
  {
    const ctx = dom.canvas.getContext("2d");
    ctx.calls.length = 0;
    editor.draw();
    const written = ctx.calls.filter(c => c.name === "fillText" && /m²$/.test(String(c.args[0])));
    check("the area is written on the canvas", written.length > 0, `${written.length} labels`);
    const offCanvas = written.filter(c => !onScreen({ x: c.args[1], y: c.args[2] }));
    check("and every one of them lands on the canvas", offCanvas.length === 0,
      offCanvas.map(c => `${c.args[0]} at ${c.args[1].toFixed(0)},${c.args[2].toFixed(0)}`).join("; "));
  }

  // Scrolled off the room entirely: no label rather than one at the edge.
  editor.origin = { x: editor.origin.x - 6000, y: editor.origin.y - 6000 };
  editor.draw();
  const away = (editor._captions || [])[0];
  check("with none of the room in view there is no label",
    !away || !editor.visibleCaptionSpot(away));

  editor.scale = savedScale;
  editor.origin = savedOrigin;

  // And the number keeps up with the wall.
  store.outsideWallsFree = true;
  const wall = store.room.walls[0];
  const seen = [];
  for (let i = 0; i < 4; i++) {
    store.moveWall(wall.id, 0, -0.25);
    editor.draw();
    const c = (editor._captions || [])[0];
    if (c) seen.push(c.area);
  }
  check("the label is recomputed at every step of a wall drag",
    seen.length === 4 && new Set(seen.map(a => a.toFixed(2))).size === 4,
    seen.map(a => a.toFixed(1)).join(" -> "));
  check("and follows the wall in one direction",
    seen.every((a, i) => i === 0 || a > seen[i - 1]), seen.map(a => a.toFixed(1)).join(" -> "));
  store.outsideWallsFree = false;
}

// ── Dragging a public area ───────────────────────────────────────────────
//
// It was settled against its neighbours on every step of the drag, and any
// step that settling would have RESIZED was refused outright. So an area
// pressed against another stopped dead and could never be taken past it:
// dragging it seven metres across a neighbour moved it eighty centimetres and
// left it there. It follows the cursor now and is settled once, on release.
{
  const setup = areas => {
    store.room = P.freshRoom("Areas", 10, 8, 2.6);
    store.room.origin = { x: 0, z: 0 };
    store.room.canvas = { width: 25, length: 25 };
    store.room.publicAreas = areas.map(a => ({ ...a }));
    P.sanitize(store.room);
  };
  const at = id => store.room.publicAreas.find(a => a.id === id);
  const clashes = id => store.publicAreaClashes(at(id), id);
  // The whole gesture, in the steps a pointer actually delivers it.
  const drag = (id, dx, dz, steps = 40) => {
    for (let i = 0; i < steps; i++) store.movePublicArea(id, dx / steps, dz / steps);
    store.settleDraggedPublicArea(id);
  };

  setup([{ id: "a", x: 2, z: 2, w: 2, l: 1.5 }]);
  drag("a", 3, 2);
  check("an area on its own goes exactly where it is dragged",
    Math.abs(at("a").x - 5) < 0.01 && Math.abs(at("a").z - 4) < 0.01,
    `${at("a").x},${at("a").z}`);
  check("and keeps its size", at("a").w === 2 && at("a").l === 1.5);

  // The one that was reported: it could not be taken past a neighbour.
  setup([{ id: "a", x: 1, z: 2, w: 2, l: 1.5 }, { id: "b", x: 5, z: 2, w: 2, l: 1.5 }]);
  drag("a", 7, 0);
  check("an area can be dragged clear past another one",
    at("a").x > 7, `stopped at ${at("a").x}`);
  check("and does not end up lying on it", !clashes("a"));
  check("nor does the one it passed move", at("b").x === 5 && at("b").w === 2);

  // Up against one, it lands flush rather than stopping short.
  setup([{ id: "a", x: 2, z: 2, w: 2, l: 1.5 }, { id: "b", x: 5, z: 2, w: 2, l: 1.5 }]);
  drag("a", 2.4, 0);
  check("dragged up against a neighbour it settles against it",
    Math.abs(at("a").x + at("a").w - 5) < 0.01, `right edge at ${at("a").x + at("a").w}`);

  // Dropped on top of one, it moves out of the way rather than being trimmed.
  setup([{ id: "a", x: 1, z: 2, w: 2, l: 1.5 }, { id: "b", x: 5, z: 2, w: 2, l: 1.5 }]);
  drag("a", 4, 0);
  check("dropped on top of another it slides clear", !clashes("a"),
    `${at("a").x},${at("a").z}`);
  check("and is not cut down to fit", at("a").w === 2 && at("a").l === 1.5);

  // While it is being carried it says it cannot stay there.
  setup([{ id: "a", x: 1, z: 2, w: 2, l: 1.5 }, { id: "b", x: 5, z: 2, w: 2, l: 1.5 }]);
  for (let i = 0; i < 10; i++) store.movePublicArea("a", 0.4, 0);
  check("an area carried over another reads as clashing",
    store.publicFeedback && store.publicFeedback.state === "invalid",
    JSON.stringify(store.publicFeedback));
  store.settleDraggedPublicArea("a");
  check("and stops saying so once it is put down", store.publicFeedback === null);

  // It cannot be dragged off the canvas.
  setup([{ id: "a", x: 1, z: 1, w: 2, l: 1.5 }]);
  drag("a", -9, -9);
  check("an area cannot be dragged off the plate",
    at("a").x >= -0.001 && at("a").z >= -0.001, `${at("a").x},${at("a").z}`);

  // And the whole thing through the editor itself — press, move, release —
  // because the settling happens when the pointer comes up, and a test that
  // calls the settle by hand cannot tell you the editor calls it.
  {
    setup([{ id: "a", x: 1, z: 2, w: 2, l: 1.5 }, { id: "b", x: 5, z: 2, w: 2, l: 1.5 }]);
    store.chooseTool("select");
    const grab = editor.screen({ x: 2, z: 2.75 });          // the middle of "a"
    const drop = editor.screen({ x: 6, z: 2.75 });          // squarely on "b"
    const dx = Math.round((drop.x - grab.x) / 4);
    const dy = Math.round((drop.y - grab.y) / 4);
    gesture(Math.round(grab.x), Math.round(grab.y), [[dx, dy], [dx, dy], [dx, dy], [dx, dy]]);
    check("dragged with the pointer, it moves", at("a").x > 1.5, `${at("a").x}`);
    check("and the editor settles it when the pointer comes up",
      !clashes("a") && store.publicFeedback === null,
      `${at("a").x},${at("a").z} clash:${clashes("a")} feedback:${JSON.stringify(store.publicFeedback)}`);
  }
}

// ── Public floor is the user's ───────────────────────────────────────────
//
// The generator used to add the hallways it carved as public areas, so running
// it painted grey floor over the plan that nobody had asked for. It still
// carves hallways — that is the floor the rooms open onto — it just does not
// mark them as shared space, which is the user's to decide.
{
  store.room = P.freshRoom("Bare", 10, 8, 2.6);
  P.centerRoom(store.room);
  P.sanitize(store.room);
  check("a bare plate starts with no public floor", (store.room.publicAreas || []).length === 0);

  store.generateLayout({ count: 5, area: 12, windows: false });
  check("the generator lays out rooms on it", P.detectRooms(store.room).length > 1);
  check("and marks no public floor of its own",
    (store.room.publicAreas || []).length === 0,
    JSON.stringify(store.room.publicAreas));

  // Floor the user drew survives a run untouched.
  const origin = P.roomOrigin(store.room);
  store.room.publicAreas = [{ id: "mine", x: origin.x, z: origin.z, w: 10, l: 1.4 }];
  const mine = JSON.stringify(store.room.publicAreas);
  store.generateLayout({ count: 4, area: 12, windows: false });
  check("floor the user marked survives a run exactly as drawn",
    JSON.stringify(store.room.publicAreas) === mine,
    JSON.stringify(store.room.publicAreas));
  check("and nothing was added beside it", (store.room.publicAreas || []).length === 1);

  // An area some earlier version left behind is cleared out rather than kept:
  // the generator had no business marking it in the first place.
  store.room.publicAreas = [
    { id: "mine", x: origin.x, z: origin.z, w: 10, l: 1.4 },
    { id: "old", x: origin.x, z: origin.z + 4, w: 8, l: 1.2, generated: true },
  ];
  store.generateLayout({ count: 4, area: 12, windows: false });
  // And the code path itself is gone, not merely quiet. With the planner no
  // longer setting floor aside there is usually nothing for it to mark, so a
  // behavioural check alone would pass even if the marking came back.
  {
    const storeSource = readFileSync(join(root, "roomcad", "web", "store.js"), "utf8");
    // `generated: true` is the mark the planner used to stamp on the public
    // areas it made. Nothing else in the store has ever set it, so its absence
    // is the whole rule in one line.
    check("nothing in the store marks floor as the planner's own",
      !/generated:\s*true/.test(storeSource));
    check("and the layout's leftover floor is not turned into public areas",
      !/publicAreas[\s\S]{0,120}corridors/.test(storeSource));
  }

  check("floor an earlier run marked is cleared away",
    (store.room.publicAreas || []).length === 1
    && !(store.room.publicAreas || []).some(a => a.generated),
    JSON.stringify(store.room.publicAreas));
}

dom.restore();
console.log(`${passed} passed, ${failed} failed — ${gestures} gestures driven through the real editor`);
if (failed) process.exit(1);
