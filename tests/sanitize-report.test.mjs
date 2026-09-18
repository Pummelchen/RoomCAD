// What a load had to repair, and whether it says so.
//
// `sanitize()` repaired and dropped in silence. A wall under 15 cm went, a
// diagonal wall went, a door whose wall was too short for it went, and the
// document opened looking whole — so the user built on it, saved it and printed
// it believing they had what they drew. That is the one failure a repair pass
// must not have, and it is what this file is about.
//
// Two halves, and the second matters as much as the first:
//
//   it must REPORT what it lost, precisely, with the reason
//   it must report NOTHING when nothing happened
//
// The second half is the one that goes wrong quietly. A repair pass that says
// "repaired 2 openings" every time you open a healthy file is worse than a silent
// one: it teaches the user to dismiss the message that exists to tell them a wall
// is gone. It very nearly did — casting a coordinate through `clamp` can move it
// by 1e-17, and the demo room's own doors do exactly that on one wall.
//
// Run:  node tests/sanitize-report.test.mjs

import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { appSource } from "./harness/app-source.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const P = await import(pathToFileURL(join(here, "..", "roomcad", "web", "plan.js")).href);

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; return; }
  failed++;
  console.error("FAIL: " + name + (detail ? " — " + detail : ""));
}

/// Parses a document and returns what the repair pass said about it.
function load(room) {
  const report = {};
  const parsed = P.parseRoom(P.serializeRoom(room), report);
  return { room: parsed, report };
}

/// The count recorded against one reason, or 0.
const countOf = (list, what, why) => {
  const hit = list.find(e => e.what === what && e.why.includes(why));
  return hit ? hit.count : 0;
};

// ── A healthy document must report nothing at all ────────────────────────
//
// The whole value of the message is that it does not appear when there is
// nothing to say.

{
  for (const [label, make] of [["a fresh room", () => P.freshRoom()],
                               ["the demo room", () => P.demoRoom()]]) {
    const { report } = load(make());
    check(`${label} opens with nothing to report`, P.reportIsEmpty(report),
      P.describeReport(report));
  }

  // And the same through sanitize() directly, which is what every in-app edit
  // path calls: drawing, dragging, undo.
  const room = P.demoRoom();
  check("re-running the pass over an open room reports nothing",
    P.reportIsEmpty(P.sanitize(room)));
}

// ── Every way a document can lose something, reported precisely ──────────

{
  const room = P.freshRoom("damaged", 8, 6, 2.6);
  room.walls = [
    { id: "keep", start: { x: 0, z: 0 }, end: { x: 8, z: 0 } },
    { id: "also", start: { x: 0, z: 6 }, end: { x: 8, z: 6 } },
    { id: "stub", start: { x: 0, z: 3 }, end: { x: 0.10, z: 3 } },
    { id: "slant", start: { x: 2, z: 0 }, end: { x: 4, z: 2 } },
  ];
  room.doors = [
    { id: "onGone", wallID: "nowhere", offset: 0.5, width: 0.9 },
    { id: "onGone2", wallID: "alsoNowhere", offset: 0.5, width: 0.9 },
    { id: "onSlant", wallID: "slant", offset: 0.1, width: 0.9 },
    { id: "onKeep", wallID: "keep", offset: 0.5, width: 0.9 },
  ];
  room.windows = [{ id: "winGone", wallID: "nowhere", offset: 0.5, width: 1.0 }];
  room.furniture = [
    { id: "ok", kind: "chair", center: { x: 1, z: 1 }, rotationDegrees: 0 },
    { id: "odd", kind: "sofa-bed", center: { x: 2, z: 2 }, rotationDegrees: 0 },
  ];
  room.labels = [{ id: "nowhere", text: "floating" }, { id: "fine", text: "ok", center: { x: 1, z: 1 } }];

  const { room: opened, report } = load(room);

  check("a wall under 15 cm is reported as dropped, with the threshold",
    countOf(report.dropped, "wall", "shorter than") === 1,
    JSON.stringify(report.dropped));
  check("a diagonal wall is reported as dropped, with the reason",
    countOf(report.dropped, "wall", "angle") === 1, JSON.stringify(report.dropped));
  check("a door on a wall that is not in the document says so",
    countOf(report.dropped, "door", "not in the document") === 2,
    JSON.stringify(report.dropped));
  check("a door on a wall that was removed as too short or angled says THAT, "
    + "rather than blaming a wall the user can see they drew",
    countOf(report.dropped, "door", "was removed") === 1,
    JSON.stringify(report.dropped));
  check("a window on a missing wall is reported too",
    countOf(report.dropped, "window", "not in the document") === 1,
    JSON.stringify(report.dropped));
  check("furniture of a kind this build does not know is reported",
    countOf(report.dropped, "piece of furniture", "does not know") === 1,
    JSON.stringify(report.dropped));
  check("a label with no position is reported",
    countOf(report.dropped, "label", "no position") === 1,
    JSON.stringify(report.dropped));

  // The count must match what actually went, not what was there.
  check("the room really did lose exactly those things",
    opened.walls.length === 2 && opened.doors.length === 1
    && opened.windows.length === 0 && opened.furniture.length === 1
    && opened.labels.length === 1,
    `${opened.walls.length} walls, ${opened.doors.length} doors, `
    + `${opened.windows.length} windows, ${opened.furniture.length} furniture, `
    + `${opened.labels.length} labels`);

  // The reason has to be readable, because it is what the user is shown.
  const said = P.describeReport(report);
  check("the sentence names the loss and the reason",
    /dropped /.test(said) && /shorter than/.test(said) && /angle/.test(said),
    said);
  check("and counts the ones that went for the same reason together",
    /2 × door \(on a wall that is not in the document\)/.test(said), said);
}

// ── A repair is reported, but does not read as loss ──────────────────────

{
  const room = P.freshRoom("repaired", 8, 6, 2.6);
  room.walls = [{ id: "w", start: { x: 0, z: 0 }, end: { x: 8, z: 0 } }];
  // A door pushed past the end of its wall: it cannot be dropped, it is fitted.
  room.doors = [{ id: "d", wallID: "w", offset: 40, width: 0.9 }];
  room.furniture = [{ id: "f", kind: "chair", center: { x: 900, z: 900 }, rotationDegrees: 17 }];

  const { room: opened, report } = load(room);
  check("nothing is reported as dropped when nothing was lost",
    report.dropped.length === 0, JSON.stringify(report.dropped));
  check("the opening that had to be moved is reported as repaired",
    countOf(report.repaired, "opening", "fit its wall") === 1,
    JSON.stringify(report.repaired));
  check("and the piece that had to be turned is reported",
    countOf(report.repaired, "rotation", "") === 1, JSON.stringify(report.repaired));

  // Repaired, not lost: it is still there, and it is inside the plate.
  check("the door is still in the room", opened.doors.length === 1);
  check("and it now sits on its wall", opened.doors[0].offset >= 0.09
    && opened.doors[0].offset <= 8 - 0.9 - 0.09, String(opened.doors[0].offset));
  check("the furniture is still there too", opened.furniture.length === 1);

  // The wording must not make a tidy-up read like damage.
  const said = P.describeReport(report);
  check("a document that was only tidied does not say it dropped anything",
    !/dropped/.test(said), said);
}

// ── The report must not become part of the document ─────────────────────

{
  const room = P.freshRoom("round trip", 6, 4, 2.6);
  room.labels = [{ id: "gone", text: "nowhere" }];
  const { room: opened, report } = load(room);
  check("the damage was reported", report.dropped.length === 1);

  // serializeRoom writes the WHOLE room object, so anything hung on it would be
  // saved and read back as part of the plan. This is why the report is passed to
  // a sink instead of attached to the room.
  const saved = P.serializeRoom(opened);
  check("nothing about the repair is written into the next save",
    !/repaired|dropped|report/i.test(saved), saved.slice(0, 200));
  check("and the room carries no such key",
    !Object.keys(opened).some(k => /report|repair/i.test(k)),
    Object.keys(opened).join(", "));

  // parseRoom with no sink at all still works — that is the live-update path.
  const withoutSink = P.parseRoom(P.serializeRoom(P.demoRoom()));
  check("parseRoom still returns the room when nobody asked for a report",
    withoutSink && Array.isArray(withoutSink.walls) && withoutSink.walls.length > 0);
}

// ── Idempotence: a repaired document is not repaired again ──────────────

{
  const room = P.freshRoom("twice", 8, 6, 2.6);
  room.walls = [
    { id: "w", start: { x: 0, z: 0 }, end: { x: 8, z: 0 } },
    { id: "stub", start: { x: 0, z: 3 }, end: { x: 0.10, z: 3 } },
  ];
  room.labels = [{ id: "l", text: "nowhere" }];
  const first = P.sanitize(room);
  check("the first pass reports the damage", first.dropped.length > 0);

  const second = P.sanitize(room);
  // If a second pass still had work to do, opening a file and then editing it
  // would report the same loss twice — and the report would be about the repair
  // rather than about the document.
  check("a second pass over the repaired room reports nothing",
    P.reportIsEmpty(second), P.describeReport(second));
}

// ── And the app actually says it ─────────────────────────────────────────
//
// A model that reports to nobody is the same silence this file exists to end, so
// the paths that open a document are pinned. These are source contracts: they
// cannot prove the toast appears, only that the call which makes it is still
// there. That is the point — without them, a later refactor could drop the call
// and quietly return the app to repairing documents behind the user's back,
// which is the exact failure being fixed.

{
  const app = appSource();
  const wired = (app.match(/announceRepairs\(repairs\);/g) || []).length;
  // A local file, a stored design, and the resumed last design.
  check("all three paths that open a document announce the repairs", wired === 3,
    `${wired} of 3`);
  check("the parse paths collect the report at all",
    (app.match(/P\.parseRoom\([^;]*,\s*repairs\)/g) || []).length === 3,
    "a load that parses without a sink has nothing to announce");
  check("only a DROP interrupts the user with a toast",
    /if \(report\.dropped\.length\) toast\(/.test(app),
    "a tidy-up must not raise the same alarm as a lost wall");
  check("and a repaired load still says so in the status line",
    /store\.status = \(store\.status \? store\.status \+ " · " : ""\) \+ "with repairs: "/.test(app));
  check("a document with nothing to report is left completely alone",
    /if \(!report \|\| P\.reportIsEmpty\(report\)\) return;/.test(app));
}
console.log(`${passed} passed, ${failed} failed — what a load says it had to repair`);
process.exit(failed ? 1 : 0);
