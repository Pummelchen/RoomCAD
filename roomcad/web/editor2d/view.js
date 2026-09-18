// Editor2D's view methods.
//
// Part of editor2d.js; they are applied to `Editor2D.prototype` there, so `this`
// is the editor and every method still reaches every other one.

import * as P from "../plan.js";
import { store } from "../store.js";

export const view = {

  // MARK: Size handling

  observeSize() {
    const resize = () => {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
      this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!this.didFit) this.fit();
      this.draw();
    };
    new ResizeObserver(resize).observe(this.canvas);
    resize();
  },

  // MARK: Events

  attachEvents() {
    this.canvas.addEventListener("pointerdown", e => this.onPointerDown(e));
    this.canvas.addEventListener("pointermove", e => this.onPointerMove(e));
    this.canvas.addEventListener("pointerup", e => this.onPointerUp(e));
    this.canvas.addEventListener("pointercancel", e => this.onPointerUp(e));
    // A release outside the canvas never reaches it — unless the pointer was
    // captured, and capture is not universal. The window sees it either way, so
    // a drag released off the edge still ends instead of staying live and
    // carrying the next button-less move. Only pointers this editor is
    // tracking are handled, so the sidebar's own releases are ignored.
    const release = e => {
      if (this.pointers.has(e.pointerId)) this.onPointerUp(e);
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    this.canvas.addEventListener("wheel", e => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      // `deltaY` is in pixels only for DOM_DELTA_PIXEL. A line-mode wheel
      // (Firefox with a mouse, some trackpads) reports one to three lines per
      // notch, and a page-mode one reports a fraction of the viewport; read as
      // pixels those changed the zoom by a fraction of a percent instead of a
      // visible step. Normalise to pixels first.
      const LINE_HEIGHT_PX = 16;
      const unit = e.deltaMode === 1 ? LINE_HEIGHT_PX : e.deltaMode === 2 ? rect.height : 1;
      const factor = Math.exp(-e.deltaY * unit * 0.0015);
      this.zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });
    this.canvas.addEventListener("contextmenu", e => this.onContextMenu(e));
    this.canvas.addEventListener("dblclick", e => {
      const rect = this.canvas.getBoundingClientRect();
      const c = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const p = this.plan(c);
      const opening = P.openingNear(store.room, p);
      if (opening && opening.kind === "door") {
        store.toggleDoorOpen(opening.id);
        e.preventDefault();
      }
    });

    window.addEventListener("keydown", e => {
      if (e.code === "Space" && !this.isTyping()) {
        this.spaceDown = true;
        this.canvas.classList.add("selecting");
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", e => {
      if (e.code === "Space") {
        this.spaceDown = false;
        this.canvas.classList.remove("selecting");
        this.draw();
      }
    });
    window.addEventListener("blur", () => {
      this.spaceDown = false;
      this.canvas.classList.remove("selecting");
      // Hand every captured pointer back before forgetting it, or the canvas
      // keeps receiving its moves with no drag to apply them to.
      this.releasePointers();
      this.abortDrag();
      this.pointers.clear();
      this.draw();
    });
    // Dismiss the context menu on any outside click or on Escape.
    window.addEventListener("pointerdown", e => {
      if (this.contextMenu && !this.contextMenu.hidden && !this.contextMenu.contains(e.target)) {
        this.hideContextMenu();
      }
    });
    window.addEventListener("keydown", e => {
      if (e.code === "Escape") this.hideContextMenu();
    });
  },

  isTyping() {
    // Same rule as app.js's isTyping(), contentEditable included. This decides
    // whether a key belongs to the canvas or to whatever has focus, and the two
    // modules answering it differently meant a key could be acted on twice — or
    // not at all — depending on which handler saw it first.
    const el = document.activeElement;
    return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA"
      || el.tagName === "SELECT" || el.isContentEditable);
  }
};
