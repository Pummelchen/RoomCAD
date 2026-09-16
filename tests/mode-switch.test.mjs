// The 2D/3D mode switch, and the paths that change mode without using it.
//
// store.newRoom() and store.loadRoom() put the app back on the 2D plan
// themselves, because they run in the model and know nothing about the view.
// Pressed while standing in the walkthrough, they used to switch the model to
// 2D and leave the 3D view on screen — with its render loop, physics and
// traffic simulation still running behind a plan the user could not see.
//
// app.js cannot be imported directly: it pulls in walk3d.js, which imports the
// bare specifier "three". So, like sidebar-panels.test.mjs, the real functions
// are lifted out of the source and run against fakes.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const app = readFileSync(join(root, "roomcad", "web", "app.js"), "utf8");

let failed = 0;
let passed = 0;
function check(name, condition) {
  if (!condition) {
    failed++;
    console.error("FAIL: " + name);
    return;
  }
  passed++;
}

const start = app.indexOf("let shownMode");
const end = app.indexOf("// MARK: - Rendering");
check("the mode code can be located", start > 0 && end > start);

function build({ walk3d = null, walk3dHasPause = true } = {}) {
  const code = app.slice(start, end);
  const fake = {
    store: { mode: "2d", room: {}, emitted: 0, emit() { this.emitted++; } },
    planCanvas: { hidden: false },
    walkHost: { hidden: true },
    document: { querySelectorAll: () => [] },
    // Objects, not numbers: build() spreads this record, and a spread copies a
    // number by value, so a plain counter would be read stale.
    toolbar: { n: 0 },
    status: { n: 0 },
  };
  fake.Walk3D = function (host) {
    this.host = host;
    this.resumes = 0;
    this.pauses = 0;
    if (walk3dHasPause) {
      this.resume = function () { this.resumes++; };
      this.pause = function () { this.pauses++; };
    }
  };
  const api = new Function(
    "store", "planCanvas", "walkHost", "document", "Walk3D",
    "renderToolbar", "renderStatus", "initialWalk3d",
    "let walk3d = initialWalk3d;\n" + code +
    "\nreturn { setMode, syncMode, shown: () => shownMode, walk3d: () => walk3d };"
  )(
    fake.store, fake.planCanvas, fake.walkHost, fake.document, fake.Walk3D,
    () => { fake.toolbar.n++; }, () => { fake.status.n++; },
    walk3d,
  );
  return { ...fake, api };
}

// ── Switching modes drives the DOM and the 3D loop ────────────────────────
{
  const f = build();

  f.api.setMode("3d");
  check("3D hides the plan canvas", f.planCanvas.hidden === true);
  check("3D shows the walk host", f.walkHost.hidden === false);
  check("3D builds the walkthrough on first entry", !!f.api.walk3d());
  check("3D resumes the render loop", f.api.walk3d().resumes === 1);
  check("the toolbar and status are refreshed", f.toolbar.n > 0 && f.status.n > 0);

  f.api.setMode("2d");
  check("2D shows the plan canvas", f.planCanvas.hidden === false);
  check("2D hides the walk host", f.walkHost.hidden === true);
  check("2D pauses the render loop", f.api.walk3d().pauses === 1);
  check("the mode the DOM shows is tracked", f.api.shown() === "2d");
}

// ── The bug: a mode change made below the UI is followed ──────────────────
{
  const f = build();
  f.api.setMode("3d");
  check("we start in 3D", f.api.shown() === "3d" && f.planCanvas.hidden === true);

  // Exactly what store.newRoom() does: change the model, emit, no setMode().
  f.store.mode = "2d";
  const switched = f.api.syncMode();

  check("the view follows a mode change made below the UI", switched === true);
  check("the plan canvas is shown again", f.planCanvas.hidden === false);
  check("the walk host is hidden again", f.walkHost.hidden === true);
  check("the 3D render loop is paused", f.api.walk3d().pauses === 1);
  check("the tracked mode agrees with the store", f.api.shown() === f.store.mode);

  // setMode() re-emits, so the guard runs again on the way out. It must settle
  // rather than ping-pong.
  check("a second pass does nothing", f.api.syncMode() === false);
}

// ── And the reverse: 2D -> 3D made below the UI ───────────────────────────
{
  const f = build();
  f.store.mode = "3d";
  check("a switch up to 3D is followed too", f.api.syncMode() === true);
  check("the walk host is shown", f.walkHost.hidden === false);
  check("the plan canvas is hidden", f.planCanvas.hidden === true);
}

// ── Degenerate cases must not throw ───────────────────────────────────────
{
  const f = build({ walk3dHasPause: false });
  let threw = false;
  try { f.api.setMode("3d"); f.api.setMode("2d"); } catch { threw = true; }
  check("a walkthrough without pause()/resume() does not throw", !threw);

  const g = build();
  g.api.setMode("2d"); // never created a walkthrough
  check("switching to 2D with no walkthrough is harmless", g.planCanvas.hidden === false);

  // Passing an explicit null must not break the guard either.
  const h = build({ walk3d: null });
  h.api.setMode("2d");
  check("a null walkthrough is handled", h.walkHost.hidden === true);
}

// ── The seam is actually wired into the change handler ────────────────────
check("app.js follows mode changes from its store subscription",
  /store\.onChange\(\(\) => \{[^]*?syncMode\(\);/.test(app));

console.log(`${passed} passed, ${failed} failed — 2D/3D mode switching`);
if (failed) process.exit(1);
