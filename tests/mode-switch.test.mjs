// The 2D/3D mode switch, and the paths that change mode without using it.
//
// store.newRoom() and store.loadRoom() put the app back on the 2D plan
// themselves, because they run in the model and know nothing about the view.
// Pressed while standing in the walkthrough, they used to switch the model to
// 2D and leave the 3D view on screen — with its render loop, physics and
// traffic simulation still running behind a plan the user could not see.
//
// app.js is importable now, and so is the module that owns the switch:
// roomcad/web/app/view.js. It is imported for real, and `setMode`/`syncMode`
// are the exported functions the app calls. The one thing that cannot be real
// is the walkthrough itself — building one needs WebGPU — so the walk3d.js
// SPECIFIER is replaced through the resolver, and view.js's own
// `new Walk3D(...)` builds the fake.

import { registerHooks } from "node:module";
import { resolve, stubModule } from "./harness/three-resolver.mjs";
import { installDOM } from "./harness/dom-stub.mjs";
import { appSource } from "./harness/app-source.mjs";

// Before anything from the app is imported.
registerHooks({ resolve });

// A walkthrough that records resume()/pause() rather than rendering. `build()`
// below flips `walk3dHasPause` to cover an instance without either method.
stubModule("walk3d.js", `
export const walk3dStub = { hasPause: true };
export class Walk3D {
  constructor(host) {
    this.host = host;
    this.resumes = 0;
    this.pauses = 0;
    this.updates = 0;
    if (walk3dStub.hasPause) {
      this.resume = function () { this.resumes++; };
      this.pause = function () { this.pauses++; };
    }
  }
  update() { this.updates++; }
}
`);

// The real page, so the mode-picker buttons and the status line renderStatus
// writes are real elements.
const dom = installDOM({ width: 1200, height: 800, page: true });

const { setMode, syncMode } = await import("../roomcad/web/app/view.js");
const { appState } = await import("../roomcad/web/app/state.js");
const { store } = await import("../roomcad/web/store.js");
const { walk3dStub } = await import("../roomcad/web/walk3d.js");

const app = appSource();

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

const planCanvas = dom.document.getElementById("plan-canvas");
const walkHost = dom.document.getElementById("walk-host");
const statusHint = dom.document.getElementById("status-hint");
const modeButton = mode => dom.document.querySelector(`#mode-picker [data-mode="${mode}"]`);
// `shownMode` is module-private, but it is by definition the mode the DOM is
// showing, and setMode() writes both from the same value. Reading it back off
// the canvas is the same fact without reaching inside the module.
const shown = () => (planCanvas.hidden ? "3d" : "2d");

const start = app.indexOf("let shownMode");
const end = app.indexOf("// MARK: - Rendering");
check("the mode code can be located", start > 0 && end > start);

/// Puts the real module back where a fresh page starts: shown 2D,
/// no walkthrough, and a fake Walk3D with or without pause()/resume().
/// setMode("2d") is what rewrites the private `shownMode`.
function build({ walk3dHasPause = true } = {}) {
  walk3dStub.hasPause = walk3dHasPause;
  setMode("2d");
  appState.walk3d = null;
  store.mode = "2d";
  return {};
}

// ── Switching modes drives the DOM and the 3D loop ────────────────────────
{
  build();

  setMode("3d");
  check("3D hides the plan canvas", planCanvas.hidden === true);
  check("3D shows the walk host", walkHost.hidden === false);
  check("3D builds the walkthrough on first entry", !!appState.walk3d);
  check("3D resumes the render loop", appState.walk3d.resumes === 1);
  check("the toolbar and status are refreshed",
    modeButton("3d").classList.contains("active") && /Click to look/.test(statusHint.textContent),
    `${modeButton("3d").className} | ${statusHint.textContent}`);

  setMode("2d");
  check("2D shows the plan canvas", planCanvas.hidden === false);
  check("2D hides the walk host", walkHost.hidden === true);
  check("2D pauses the render loop", appState.walk3d.pauses === 1);
  check("the mode the DOM shows is tracked", shown() === "2d");
}

// ── The bug: a mode change made below the UI is followed ──────────────────
{
  build();
  setMode("3d");
  check("we start in 3D", shown() === "3d" && planCanvas.hidden === true);

  // Exactly what store.newRoom() does: change the model, emit, no setMode().
  store.mode = "2d";
  const switched = syncMode();

  check("the view follows a mode change made below the UI", switched === true);
  check("the plan canvas is shown again", planCanvas.hidden === false);
  check("the walk host is hidden again", walkHost.hidden === true);
  check("the 3D render loop is paused", appState.walk3d.pauses === 1);
  check("the tracked mode agrees with the store", shown() === store.mode);

  // setMode() re-emits, so the guard runs again on the way out. It must settle
  // rather than ping-pong.
  check("a second pass does nothing", syncMode() === false);
}

// ── And the reverse: 2D -> 3D made below the UI ───────────────────────────
{
  build();
  store.mode = "3d";
  check("a switch up to 3D is followed too", syncMode() === true);
  check("the walk host is shown", walkHost.hidden === false);
  check("the plan canvas is hidden", planCanvas.hidden === true);
}

// ── Degenerate cases must not throw ───────────────────────────────────────
{
  build({ walk3dHasPause: false });
  let threw = false;
  try { setMode("3d"); setMode("2d"); } catch { threw = true; }
  check("a walkthrough without pause()/resume() does not throw", !threw);

  build();
  setMode("2d"); // never created a walkthrough
  check("switching to 2D with no walkthrough is harmless", planCanvas.hidden === false);

  // Passing an explicit null must not break the guard either.
  build();
  appState.walk3d = null;
  setMode("2d");
  check("a null walkthrough is handled", walkHost.hidden === true);
}

// ── The seam is actually wired into the change handler ────────────────────
check("app.js follows mode changes from its store subscription",
  /store\.onChange\(\(\) => \{[^]*?syncMode\(\);/.test(app));

console.log(`${passed} passed, ${failed} failed — 2D/3D mode switching`);
if (failed) process.exit(1);
