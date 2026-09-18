// Regression tests for the editor-side audit findings.
//
// These drive the REAL Editor2D against the stub DOM: a zoom field cleared by
// hand, a wheel notch in line mode, and a pointer released off the canvas are
// all things a source contract cannot see.
//
// Run:  node tests/audit-editor.test.mjs

import { installDOM } from "./harness/dom-stub.mjs";
import { loadWebModule } from "./harness/load-web-module.mjs";

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

const editor = new Editor2D(dom.canvas);

// ── T0033 — clearing the zoom field must not commit 0 (clamped to 20%) ────
//
// `Number("")` is 0 and `isNaN(0)` is false, so clearing the field — select-all
// then Delete, or clicking away, since `blur` also calls finish — committed
// `zoomTo(0)`, which clamped to the 20% floor.
{
  editor.zoomTo(150);
  editor.beginZoomEdit();
  const input = editor.zoomEl.querySelector("input");
  check("T0033 the zoom editor opens showing the current zoom",
    !!input && input.value === "150", input ? input.value : "no input");

  input.value = "";
  input.dispatch("change", {});
  check("T0033 clearing the field leaves the zoom where it was",
    editor.scale === 150, `${editor.scale}`);
  check("T0033 and the readout is restored",
    editor.zoomEl.textContent === "150%", editor.zoomEl.textContent);
  check("T0033 and the inline editor is closed", editor.zoomEditing === false);

  // A non-number is the same case, for the same reason.
  editor.beginZoomEdit();
  const junk = editor.zoomEl.querySelector("input");
  junk.value = "abc";
  junk.dispatch("change", {});
  check("T0033 a non-numeric entry is ignored too",
    editor.scale === 150, `${editor.scale}`);

  // A real number still applies.
  editor.beginZoomEdit();
  const typed = editor.zoomEl.querySelector("input");
  typed.value = "220";
  typed.dispatch("change", {});
  check("T0033 a real number still zooms",
    Math.abs(editor.scale - 220) < 1e-9, `${editor.scale}`);
}

// ── T0034 — wheel zoom must read deltaMode, not assume pixels ─────────────
//
// `Math.exp(-e.deltaY * 0.0015)` treated a DOM_DELTA_LINE notch as one pixel,
// so a mouse wheel (Firefox reports lines) changed the zoom by a fraction of a
// percent instead of a visible step. Line = 16 px, page = the canvas height.
{
  const wheel = (deltaMode, deltaY) => {
    editor.scale = 100;
    dom.canvas.dispatch("wheel", { clientX: 600, clientY: 400, deltaMode, deltaY });
    return editor.scale;
  };
  const pixels = wheel(0, 10);
  const lines = wheel(1, 10);
  const pages = wheel(2, 0.1);

  check("T0034 a pixel delta is still taken at face value",
    Math.abs(pixels - 100 * Math.exp(-10 * 0.0015)) < 0.01, `${pixels}`);
  check("T0034 a line delta is normalised to 16 px per line",
    Math.abs(lines - 100 * Math.exp(-10 * 16 * 0.0015)) < 0.01, `${lines}`);
  check("T0034 a page delta is normalised to the canvas height",
    Math.abs(pages - 100 * Math.exp(-0.1 * dom.canvas.clientHeight * 0.0015)) < 0.01,
    `${pages}`);
  check("T0034 a line-mode notch actually zooms now",
    100 - lines > 15, `${(100 - lines).toFixed(1)}%`);
}

// ── T0021 — a pointer released off the canvas still ends the drag ─────────
//
// pointerup/pointercancel were bound to the canvas only and pointerdown never
// called setPointerCapture, so a release outside the canvas left `editor.drag`
// set, `editor.pointers` non-empty and `store.dragTransactionActive` true. A
// following button-less pointermove then moved the wall again, and the drag's
// undo boundary was consumed.
{
  store.room = P.freshRoom("Capture", 6, 4, 2.6);
  P.centerRoom(store.room);
  P.sanitize(store.room);
  store.undoStack.length = 0;
  store.redoStack.length = 0;
  store.dragTransactionActive = false;
  store.outsideWallsFree = true;
  store.chooseTool("select");
  // The zoom field above still holds focus, and the editor deliberately ignores
  // pointer input while a text field is focused. Clicking the plan in a browser
  // would move focus; the stub does not, so it is moved here.
  dom.document.activeElement = dom.document.body;
  editor.fit();
  editor.draw();

  const snapshot = () => JSON.stringify(store.room.walls.map(w => [w.id, w.start, w.end]));
  const wall = store.room.walls[0];
  const mid = P.wallMidpoint(wall);
  const at_ = editor.screen(mid);

  // The pointerdown must ask the browser to capture it, or a release past the
  // edge of the canvas is delivered to whatever is under the cursor instead.
  const captured = [];
  const realCapture = dom.canvas.setPointerCapture;
  dom.canvas.setPointerCapture = id => { captured.push(id); };
  dom.canvas.dispatch("pointerdown",
    { clientX: at_.x, clientY: at_.y, button: 0, buttons: 1, pointerId: 7 });
  dom.canvas.setPointerCapture = realCapture;
  check("T0021 a pointerdown captures the pointer",
    captured.includes(7), JSON.stringify(captured));
  check("T0021 the press starts a drag", editor.drag !== null && editor.drag.type === "moveWall",
    JSON.stringify(editor.drag));

  dom.canvas.dispatch("pointermove",
    { clientX: at_.x, clientY: at_.y + 30, button: 0, buttons: 1, pointerId: 7 });

  // The release lands on the window, never on the canvas, exactly as it does
  // when the pointer comes up past the edge of the plan.
  dom.window.dispatch("pointerup",
    { clientX: at_.x, clientY: at_.y + 30, button: 0, buttons: 0, pointerId: 7 });
  check("T0021 a release off the canvas ends the drag",
    editor.drag === null, JSON.stringify(editor.drag));
  check("T0021 and forgets the pointer",
    editor.pointers.size === 0, `${editor.pointers.size} tracked`);
  check("T0021 and ends the store's drag transaction",
    store.dragTransactionActive === false);

  // A button-less move is the other half: the release was never delivered, so
  // the drag is still live when a move with no buttons arrives. It must not
  // carry the wall any further.
  store.room = P.freshRoom("Capture2", 6, 4, 2.6);
  P.centerRoom(store.room);
  P.sanitize(store.room);
  store.undoStack.length = 0;
  store.redoStack.length = 0;
  store.dragTransactionActive = false;
  store.outsideWallsFree = true;
  editor.fit();
  editor.draw();
  const wall2 = store.room.walls[0];
  const at2 = editor.screen(P.wallMidpoint(wall2));
  const preDrag = snapshot();

  dom.canvas.dispatch("pointerdown",
    { clientX: at2.x, clientY: at2.y, button: 0, buttons: 1, pointerId: 8 });
  dom.canvas.dispatch("pointermove",
    { clientX: at2.x, clientY: at2.y + 30, button: 0, buttons: 1, pointerId: 8 });
  const duringDrag = snapshot();
  dom.canvas.dispatch("pointermove",
    { clientX: at2.x, clientY: at2.y + 80, button: 0, buttons: 0, pointerId: 8 });
  check("T0021 a button-less move does not continue the drag",
    snapshot() === duringDrag || snapshot() === preDrag,
    `pre ${preDrag} during ${duringDrag} after ${snapshot()}`);
  check("T0021 and it drops the abandoned drag",
    editor.drag === null && editor.pointers.size === 0
    && store.dragTransactionActive === false,
    `drag ${JSON.stringify(editor.drag)}, pointers ${editor.pointers.size}, active ${store.dragTransactionActive}`);
}

console.log(`${passed} passed, ${failed} failed — audit editor`);
process.exit(failed ? 1 : 0);
