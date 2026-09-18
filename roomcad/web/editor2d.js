// editor2d.js — the 2D plan canvas: rendering, tools, zoom/pan, cm readouts.
//
// The class is declared here and its methods are applied from
// roomcad/web/editor2d/. They live on the prototype, so `this` is the editor and
// every method reaches every other one exactly as it did inside one class body —
// which is why no group needs to import another. The constants they draw with are
// in editor2d/theme.js.
//
// A prototype split is what makes this possible at all: JavaScript cannot spread
// a class declaration over several files, and `Object.assign` onto the prototype
// is behaviour-preserving here because nothing in this class is private — no
// `#field`, no `super`, no static member.

import { store } from "./store.js";
import { coords } from "./editor2d/coords.js";
import { view } from "./editor2d/view.js";
import { menu } from "./editor2d/menu.js";
import { drag } from "./editor2d/drag.js";
import { draw_core } from "./editor2d/draw-core.js";
import { draw_annotations } from "./editor2d/draw-annotations.js";
import { draw_room } from "./editor2d/draw-room.js";
import { draw_items } from "./editor2d/draw-items.js";

export class Editor2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.scale = 100; // pixels per metre
    this.origin = { x: 0, y: 0 };
    this.didFit = false;
    this.lastRotation = store.rotation;
    this.hover = null;
    this.drag = null;
    this.lastPlan = null;
    this.pointerStart = null;
    this.pointerMoved = false;
    this.spaceDown = false;
    this.pointers = new Map();
    this.pinch = null;
    this.contextMenu = document.getElementById("context-menu");
    this.dimensionBoxes = [];  // screen boxes already taken by a readout or caption
    this.measureDrag = null;   // { start, end } while dragging the measure tool
    this.measureResult = null; // last measured { start, end } (stays on screen)
    this.zoomEl = document.getElementById("zoom-level");
    this.zoomEditing = false;
    if (this.zoomEl) this.zoomEl.addEventListener("dblclick", () => this.beginZoomEdit());

    this.lastTool = store.tool;

    this.attachEvents();
    this.observeSize();
    store.onChange(() => {
      // A measurement is about the question you just asked. Switching tool is
      // asking a different one, so the line goes rather than lingering over
      // whatever you do next.
      if (store.tool !== this.lastTool) {
        this.lastTool = store.tool;
        if (store.tool !== "measure") this.clearMeasurement();
      }
      this.requestDraw();
    });
  }

  /// Drops the measurement line and its readout.
  clearMeasurement() {
    if (!this.measureDrag && !this.measureResult) return;
    this.measureDrag = null;
    this.measureResult = null;
    this.requestDraw();
  }
}

Object.assign(
  Editor2D.prototype,
  coords,
  view,
  menu,
  drag,
  draw_core,
  draw_annotations,
  draw_room,
  draw_items,
);
