// Regression tests for the store-side audit findings.
//
// Each block names the finding it pins and drives the REAL store (and the real
// svg.js / audio.js), not a copy of their source: the defects were behavioural —
// a door silently deleted, a diagonal wall dropped on release, an undo step
// skipped — and a source contract cannot see any of them.
//
// Run:  node tests/audit-store.test.mjs

import { installDOM } from "./harness/dom-stub.mjs";
import { loadWebModule } from "./harness/load-web-module.mjs";

// The store reaches for WebAudio on the first door sound, so the stub DOM (and
// its `window`) has to exist before anything plays one. No AudioContext is
// supplied by default, so a sound is silence rather than a crash.
const dom = installDOM();

const P = await loadWebModule("plan.js");
const { store, createStore } = await loadWebModule("store.js");
const S = await loadWebModule("svg.js");
const audio = await loadWebModule("audio.js");

let passed = 0;
let failed = 0;
function check(name, condition, detail = "") {
  if (condition) { passed++; return; }
  failed++;
  console.error("FAIL: " + name + (detail ? " — " + detail : ""));
}

/// Puts the singleton store back to a known room with no history, so one
/// block's drag cannot leak into the next.
function resetStore(room) {
  store.room = room;
  store.undoStack.length = 0;
  store.redoStack.length = 0;
  store.dragTransactionActive = false;
  store.dragDroppedEntry = null;
  store.selectedWallID = null;
  store.selectedDoorID = null;
  store.selectedWindowID = null;
  store.selectedFurnitureID = null;
  store.selectedLabelID = null;
  store.selectedPublicID = null;
  store.furnitureFeedback = null;
  store.publicFeedback = null;
  store.outsideWallsFree = false;
  store.status = "";
}

// ── T0022 — a sound must never be able to abort an edit ───────────────────
//
// `ensureCtx()` guarded "no WebAudio at all" but not the documented
// NotSupportedError from `new AudioContext()`, and every node/param call was
// unguarded too. With a throwing constructor, `store.toggleDoorOpen` threw
// AFTER `commit()` had applied the change. A sound is a garnish: failure is
// silence, never an exception out of the edit that asked for it.
{
  let threw = null;

  // (a) No AudioContext on the page at all.
  dom.window.AudioContext = undefined;
  dom.window.webkitAudioContext = undefined;
  try { audio.playPlop(); audio.playDoorSound(); } catch (err) { threw = err; }
  check("T0022 (a) no AudioContext: the sounds are silence",
    threw === null, threw ? threw.message : "");

  // (b) WebAudio exists but the constructor raises.
  dom.window.AudioContext = function ThrowingContext() {
    throw new Error("NotSupportedError: no output device");
  };
  threw = null;
  try { audio.playPlop(); audio.playDoorSound(); } catch (err) { threw = err; }
  check("T0022 (b) a throwing AudioContext constructor is silence",
    threw === null, threw ? threw.message : "");

  // The proven path, not just the helper: `store.toggleDoorOpen` calls the
  // sound AFTER `commit()` has applied the change, so a throw there left the
  // door toggled but the rest of the handler — the selection state — unset, and
  // escaped into the canvas handler.
  {
    const room = P.freshRoom("Sound", 6, 4, 2.6);
    room.origin = { x: 0, z: 0 };
    room.canvas = { width: 25, length: 25 };
    room.doors = [{ id: "sd", wallID: room.walls[0].id, offset: 1, width: 0.9, open: true, swingInside: true }];
    P.sanitize(room);
    resetStore(room);
    let storeThrew = null;
    try { store.toggleDoorOpen("sd"); } catch (err) { storeThrew = err; }
    check("T0022 a door toggle survives a throwing AudioContext",
      storeThrew === null, storeThrew ? storeThrew.message : "");
    check("T0022 the change still landed and the handler finished",
      store.room.doors[0].open === false && store.selectedDoorID === "sd",
      `open ${store.room.doors[0] && store.room.doors[0].open}, selected ${store.selectedDoorID}`);
  }

  // (c) A working context, whose `resume()` REJECTS — the promise-side hole.
  // `ctx.resume()` returned a rejected promise that nothing handled, which is a
  // throw by another name. It must be caught, and the nodes must still build.
  const unhandled = [];
  const onUnhandled = reason => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  const param = () => ({
    value: 0,
    setValueAtTime() {},
    exponentialRampToValueAtTime() {},
  });
  let nodes = 0;
  class WorkingContext {
    constructor() { this.state = "suspended"; this.destination = {}; }
    get currentTime() { return 0; }
    resume() { return Promise.reject(new Error("output device is busy")); }
    createOscillator() {
      const o = { type: "", frequency: param(), connect: () => o, start() {}, stop() {} };
      nodes++;
      return o;
    }
    createGain() { const g = { gain: param(), connect: () => g }; return g; }
    createBiquadFilter() { const f = { type: "", frequency: param(), Q: {}, connect: () => f }; return f; }
  }
  dom.window.AudioContext = WorkingContext;
  threw = null;
  try { audio.playPlop(); audio.playDoorSound(); } catch (err) { threw = err; }
  await new Promise(resolve => { setTimeout(resolve, 0); });
  process.removeListener("unhandledRejection", onUnhandled);
  check("T0022 (c) a working context makes sound without throwing",
    threw === null && nodes >= 3, threw ? threw.message : `${nodes} nodes built`);
  check("T0022 (c) a rejected resume() is handled, not left unhandled",
    unhandled.length === 0, String(unhandled[0] && unhandled[0].message));
  // Leave the page without WebAudio, so later store sounds are silence.
  dom.window.AudioContext = undefined;
}

// ── T0004 — a legal slider value must never delete an opening ─────────────
//
// A 1.10 m wall holds a legal 0.90 m door. The inspector's slider offers widths
// up to MAX_OPENING_WIDTH (1.4 m), and `updateOpeningWidth` clamped only to that
// global range — so asking for 1.00 set a width the wall could not hold, and the
// `doorsWallShort` filter in sanitize dropped the door on release, leaving
// `selectedDoorID` dangling.
{
  const room = P.freshRoom("Width", 6, 4, 2.6);
  room.origin = { x: 0, z: 0 };
  room.canvas = { width: 25, length: 25 };
  room.walls = [{ id: "wall", start: P.point(0, 0), end: P.point(1.1, 0) }];
  room.doors = [{ id: "door", wallID: "wall", offset: 0.1, width: 0.9, open: true, swingInside: true }];
  room.windows = [];
  room.furniture = [];
  room.labels = [];
  room.publicAreas = [];
  P.sanitize(room);
  resetStore(room);
  store.selectedDoorID = "door";

  store.beginDrag();
  store.updateOpeningWidth("door", 1.0);
  const held = store.room.doors.find(d => d.id === "door");
  check("T0004 a width the wall cannot hold is clamped to what it can",
    held && held.width <= P.wallLength(store.room.walls[0]) - 0.2 + 1e-9,
    held ? `${held.width}` : "the door is gone");
  check("T0004 and the impossible request is said out loud",
    /limited|too short/i.test(store.status || ""), store.status);
  const note = store.status;
  store.endDrag("Set width");
  check("T0004 the opening survives a legal slider value",
    store.room.doors.length === 1, `${store.room.doors.length} doors`);
  check("T0004 and the selection still points at it",
    store.selectedDoor() !== null,
    `status was "${note}", now "${store.status}"`);
  check("T0004 the clamped width itself survives sanitize",
    (store.room.doors[0] || {}).width === held.width,
    JSON.stringify(store.room.doors[0] && store.room.doors[0].width));
}

// ── T0015 — an endpoint drag must not snap a wall off-axis ────────────────
//
// `snapWallEndpoint`'s `consider` accepts ANY wall end within tolerance, so a
// drag along a wall toward a neighbour endpoint a few centimetres off the line
// returns a point with both coordinates changed. The store guarded only the
// resulting LENGTH, so the diagonal was applied — and sanitize dropped it, and
// every opening on it, on release, with no warning.
{
  const room = P.freshRoom("Axis", 10, 10, 2.6);
  room.origin = { x: 0, z: 0 };
  room.canvas = { width: 25, length: 25 };
  room.walls = [
    { id: "A", start: P.point(0, 3), end: P.point(4, 3) },
    { id: "neighbour", start: P.point(2, 3.05), end: P.point(2, 5) },
  ];
  room.doors = [{ id: "d", wallID: "A", offset: 1, width: 0.9, open: true, swingInside: true }];
  room.windows = [];
  room.furniture = [];
  room.labels = [];
  room.publicAreas = [];
  P.sanitize(room);
  resetStore(room);

  const before = store.room.walls.length;
  const was = store.room.walls.find(w => w.id === "A");
  const wasStart = { ...was.start };
  store.beginDrag();
  // The pointer is at the neighbour's endpoint (2, 3.05) — the proven case.
  store.updateWallEndpoint("A", "start", { x: 2, z: 3.05 });
  const live = store.room.walls.find(w => w.id === "A");
  const square = w => Math.abs(w.start.x - w.end.x) < 1e-6 || Math.abs(w.start.z - w.end.z) < 1e-6;
  check("T0015 the drag never applies a non-rectilinear wall",
    square(live) || (live.start.x === wasStart.x && live.start.z === wasStart.z),
    `(${live.start.x},${live.start.z})-(${live.end.x},${live.end.z})`);
  store.endDrag("Reshaped wall");
  check("T0015 no wall is lost when the drag ends",
    store.room.walls.length === before,
    `${before} walls before, ${store.room.walls.length} after`);
  const after = store.room.walls.find(w => w.id === "A");
  check("T0015 the wall is still rectilinear after sanitize",
    after && square(after),
    after ? `(${after.start.x},${after.start.z})-(${after.end.x},${after.end.z})` : "the wall is gone");
  check("T0015 and the opening on it was not dropped",
    store.room.doors.some(d => d.id === "d"),
    `${store.room.doors.length} doors`);
}

// ── T0016 — a commit during an open drag must not destroy an undo boundary ─
//
// `commit()` popped the pre-drag snapshot `beginDrag()` pushed and then pushed
// the drag's own state, so the state A reached before the drag never entered the
// stack. Two undos then skipped it entirely and the drag was not separately
// undoable.
{
  const room = P.freshRoom("undo-base", 6, 4, 2.6);
  P.centerRoom(room);
  P.sanitize(room);
  resetStore(room);

  store.commit("A", r => { r.name = "A"; });
  store.beginDrag();
  store.room.name = "dragged";          // what a drag would have left behind
  store.commit("B", r => { r.name = "B"; });

  store.undo();
  check("T0016 the first undo returns to the state the drag had reached",
    store.room.name === "dragged", store.room.name);
  store.undo();
  check("T0016 the second undo returns to the state before the drag, not past it",
    store.room.name === "A", store.room.name);
  store.undo();
  check("T0016 and a third undo reaches the state before A",
    store.room.name === "undo-base", store.room.name);
}

// ── T0031 — publicFeedback is cleared on abort and on selection change ────
//
// `discardDrag()` cleared `furnitureFeedback` but not `publicFeedback`, and
// `clearSelection()` cleared neither of the two feedback fields. An invalid
// `movePublicArea` followed by an abort restored the area but left the feedback
// invalid, so the canvas painted it red indefinitely.
{
  const room = P.freshRoom("Feedback", 10, 8, 2.6);
  room.publicAreas = [
    { id: "a", x: 1, z: 1, w: 2, l: 2 },
    { id: "b", x: 3, z: 1, w: 2, l: 2 },
  ];
  P.sanitize(room);
  resetStore(room);

  store.beginDrag();
  store.movePublicArea("a", 2.5, 0);
  check("T0031 carrying an area onto another reads as clashing",
    store.publicFeedback && store.publicFeedback.state === "invalid",
    JSON.stringify(store.publicFeedback));
  store.discardDrag();
  check("T0031 discarding the drag clears the clash feedback",
    store.publicFeedback === null, JSON.stringify(store.publicFeedback));

  store.publicFeedback = { id: "a", state: "invalid" };
  store.furnitureFeedback = { id: "f", state: "invalid" };
  store.clearSelection();
  check("T0031 clearing the selection clears public feedback",
    store.publicFeedback === null, JSON.stringify(store.publicFeedback));
  check("T0031 clearing the selection clears furniture feedback",
    store.furnitureFeedback === null, JSON.stringify(store.furnitureFeedback));

  store.beginDrag();
  store.movePublicArea("a", 2.5, 0);
  store.endDrag("Moved public area");
  check("T0031 ending a drag also clears the clash feedback",
    store.publicFeedback === null, JSON.stringify(store.publicFeedback));
}

// ── T0032 — an aborted drag at the cap must not evict a real undo entry ───
//
// `beginDrag()` shifted the oldest entry when the stack passed 100, and
// `discardDrag()` popped only the drag's own snapshot, so the shift was never
// compensated. A click-select is beginDrag + discardDrag, so clicking around
// quietly evicted real history.
{
  const room = P.freshRoom("cap", 6, 4, 2.6);
  P.centerRoom(room);
  P.sanitize(room);
  resetStore(room);
  for (let i = 0; i < 100; i++) store.undoStack.push({ marker: i });
  const snapshot = JSON.stringify(store.undoStack);

  store.beginDrag();
  store.discardDrag();
  check("T0032 a discarded drag leaves the stack exactly as it was",
    JSON.stringify(store.undoStack) === snapshot,
    `${JSON.parse(snapshot).length} before, ${store.undoStack.length} after`);

  // And a drag that COMMITS still keeps the cap.
  store.beginDrag();
  store.endDrag("nothing");
  check("T0032 an ended drag still respects the 100-entry cap",
    store.undoStack.length <= 100, `${store.undoStack.length} entries`);
}

// ── T0005 — the SVG title block prints the floor area, not the extent ─────
//
// `svg.js` printed `room.width * room.length`, but `syncExtent()` sets those to
// the OVERALL wall extent. An L-shaped 6×6 plan therefore printed 36.00 m² when
// the floor it encloses is 27.00 m².
{
  const room = P.freshRoom("L", 6, 6, 2.6);
  room.origin = { x: 0, z: 0 };
  room.canvas = { width: 25, length: 25 };
  room.walls = [
    { id: "w1", start: P.point(0, 0), end: P.point(6, 0) },
    { id: "w2", start: P.point(0, 0), end: P.point(0, 6) },
    { id: "w3", start: P.point(6, 0), end: P.point(6, 3) },
    { id: "w4", start: P.point(6, 3), end: P.point(3, 3) },
    { id: "w5", start: P.point(3, 3), end: P.point(3, 6) },
    { id: "w6", start: P.point(3, 6), end: P.point(0, 6) },
  ];
  room.doors = [];
  room.windows = [];
  room.furniture = [];
  room.labels = [];
  room.publicAreas = [];
  P.sanitize(room);
  // The fixture is only interesting because the two numbers genuinely differ.
  check("T0005 the L-shaped fixture encloses 27 m² in a 6×6 extent",
    P.floorArea(room) === 27 && room.width * room.length === 36,
    `floor ${P.floorArea(room)}, extent ${room.width * room.length}`);

  const out = S.roomToSVG(room, {});
  check("T0005 the title block prints the enclosed floor area",
    out.includes("27.00 m²"), "no 27.00 m² readout");
  check("T0005 and not the bounding-box product",
    !out.includes("36.00 m²"), "the extent product was printed");
}

// ── T0035 — options.scale is made numeric, not spliced raw ───────────────
//
// Every room-derived string goes through `esc()`, but `options.scale` was
// spliced straight into the `<text>` element, so a crafted scale escaped it.
{
  const room = P.demoRoom();
  const evil = S.roomToSVG(room, { scale: '50</text><script>alert(1)</script>' });
  check("T0035 a non-numeric scale cannot inject markup",
    !evil.includes("<script"), "a script tag leaked into the SVG");
  check("T0035 and the sheet still states a real architectural scale",
    /1 : \d+/.test(evil), (evil.match(/1 : [^<]*/) || [])[0]);

  const numeric = S.roomToSVG(room, { scale: "100" });
  check("T0035 a numeric scale string is still honoured",
    numeric.includes("1 : 100"), (numeric.match(/1 : [^<]*/) || [])[0]);
}

// ── T0047 — one bad store listener must not silence the rest ──────────────
//
// `emit()` ran `listeners.forEach(fn => fn())`, so a throw from one listener
// aborted the loop and every listener registered after it never ran for that
// change. The failure has to stay loud (console.error) and every other listener
// must still run. Kept last because, left unfixed, the throw escapes `emit()`
// and ends the file — which would hide every finding after it.
{
  const s = createStore();
  let secondRan = 0;
  const reported = [];
  const realError = console.error;
  console.error = (...args) => { reported.push(args); };
  try {
    s.onChange(() => { throw new Error("renderer exploded"); });
    s.onChange(() => { secondRan++; });
    s.emit();
  } finally {
    console.error = realError;
  }
  check("T0047 a throwing listener does not stop the listeners after it",
    secondRan === 1, `${secondRan} ran`);
  check("T0047 and the failure is reported rather than swallowed",
    reported.some(args => String(args[0]).includes("store listener failed")),
    JSON.stringify(reported.map(a => String(a[0]))));
}

console.log(`${passed} passed, ${failed} failed — audit store`);
process.exit(failed ? 1 : 0);
