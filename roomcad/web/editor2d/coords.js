// Editor2D's coords methods.
//
// Part of editor2d.js; they are applied to `Editor2D.prototype` there, so `this`
// is the editor and every method still reaches every other one.

import * as P from "../plan.js";
import { store } from "../store.js";

export const coords = {

  // MARK: Coordinate helpers

  screen(p, rotation = store.rotation) {
    const { width: w, length: l } = P.canvasOf(store.room);
    let dx = p.x;
    let dz = p.z;
    if (rotation === 90) { dx = p.z; dz = w - p.x; }
    else if (rotation === 180) { dx = w - p.x; dz = l - p.z; }
    else if (rotation === 270) { dx = l - p.z; dz = p.x; }
    return { x: this.origin.x + dx * this.scale, y: this.origin.y + dz * this.scale };
  },

  plan(c, rotation = store.rotation) {
    const { width: w, length: l } = P.canvasOf(store.room);
    const px = (c.x - this.origin.x) / this.scale;
    const pz = (c.y - this.origin.y) / this.scale;
    if (rotation === 90) return { x: w - pz, z: px };
    if (rotation === 180) return { x: w - px, z: l - pz };
    if (rotation === 270) return { x: pz, z: l - px };
    return { x: px, z: pz };
  },

  rect(r) {
    const corners = [
      this.screen({ x: r.minX, z: r.minZ }),
      this.screen({ x: r.maxX, z: r.minZ }),
      this.screen({ x: r.minX, z: r.maxZ }),
      this.screen({ x: r.maxX, z: r.maxZ }),
    ];
    const xs = corners.map(c => c.x);
    const ys = corners.map(c => c.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  },

  /// The extent of what the user actually drew, in plan metres.
  ///
  /// Not the canvas: the canvas is a 25 m base plate that exists so there is
  /// somewhere to put new rooms, and fitting to it leaves a 5 m room as a stamp
  /// in the middle of the screen.
  contentBounds() {
    const room = store.room;
    let b = P.wallsBounds(room);
    const grow = (minX, minZ, maxX, maxZ) => {
      if (!b) b = { minX, minZ, maxX, maxZ };
      else {
        b.minX = Math.min(b.minX, minX);
        b.minZ = Math.min(b.minZ, minZ);
        b.maxX = Math.max(b.maxX, maxX);
        b.maxZ = Math.max(b.maxZ, maxZ);
      }
    };
    for (const a of room.publicAreas || []) grow(a.x, a.z, a.x + a.w, a.z + a.l);
    for (const l of room.labels || []) {
      const lb = P.labelBounds(l);
      grow(lb.minX, lb.minZ, lb.maxX, lb.maxZ);
    }
    for (const f of room.furniture || []) {
      const fb = P.furnitureFootprint(f);
      grow(fb.minX, fb.minZ, fb.maxX, fb.maxZ);
    }
    if (!b || b.maxX - b.minX < 0.01 || b.maxZ - b.minZ < 0.01) {
      // Nothing drawn yet — the base plate is all there is to show.
      const canvas = P.canvasOf(room);
      return { minX: 0, minZ: 0, maxX: canvas.width, maxZ: canvas.length };
    }
    return b;
  },

  /// The part of the canvas the user can actually see the plan in: the whole
  /// element, less a margin, less anything floating on top of it.
  viewport() {
    const rect = this.canvas.getBoundingClientRect();
    const margin = 18;
    let bottom = margin;
    // The zoom bar floats over the canvas rather than sitting beside it, so the
    // strip underneath it is not usable space.
    const zoom = document.getElementById("zoom-controls");
    if (zoom) {
      const z = zoom.getBoundingClientRect();
      if (z.height > 0 && z.bottom > rect.top && z.top < rect.bottom) {
        bottom = Math.max(bottom, rect.bottom - z.top + 8);
      }
    }
    return {
      w: rect.width,
      h: rect.height,
      left: margin,
      top: margin,
      right: margin,
      bottom,
      availW: Math.max(40, rect.width - margin * 2),
      availH: Math.max(40, rect.height - margin - bottom),
    };
  },

  /// Screen-space box of everything painted last frame: the plan itself plus
  /// the dimension readouts and area captions drawn around it.
  paintedExtent() {
    const b = this.contentBounds();
    const r = this.rect(b);
    let minX = r.x, minY = r.y, maxX = r.x + r.w, maxY = r.y + r.h;
    for (const d of this.dimensionBoxes) {
      minX = Math.min(minX, d.x);
      minY = Math.min(minY, d.y);
      maxX = Math.max(maxX, d.x + d.w);
      maxY = Math.max(maxY, d.y + d.h);
    }
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  },

  /// Centres the plan at `scale` so that its painted extent — geometry plus the
  /// annotations around it — sits in the middle of the usable area.
  placeAt(scale, view) {
    this.scale = P.clamp(scale, 20, 400);
    const b = this.contentBounds();
    // rect() needs an origin to project through; start from zero and correct.
    this.origin = { x: 0, y: 0 };
    const r = this.rect(b);
    this.origin = {
      x: view.left + (view.availW - r.w) / 2 - r.x,
      y: view.top + (view.availH - r.h) / 2 - r.y,
    };
  },

  fit() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return;
    const view = this.viewport();
    const b = this.contentBounds();
    const wide = Math.max(0.01, b.maxX - b.minX);
    const tall = Math.max(0.01, b.maxZ - b.minZ);
    const rotated = store.rotation === 90 || store.rotation === 270;
    const geomW = rotated ? tall : wide;
    const geomH = rotated ? wide : tall;

    // First pass: fit the geometry alone, leaving room for the annotations.
    this.placeAt(Math.min(view.availW / geomW, view.availH / geomH) * 0.82, view);
    this.draw();

    // The readouts and captions are drawn at a fixed pixel size, so they do not
    // shrink with the zoom. Measure how much room they actually took and solve
    // for the scale that makes geometry + annotations exactly fill the view:
    //   painted = geometry × scale + annotation   (annotation independent of scale)
    const painted = this.paintedExtent();
    const annoW = Math.max(0, painted.w - geomW * this.scale);
    const annoH = Math.max(0, painted.h - geomH * this.scale);
    const exact = Math.min(
      (view.availW - annoW) / geomW,
      (view.availH - annoH) / geomH,
    );
    if (exact > 0 && Number.isFinite(exact)) {
      this.placeAt(exact, view);
      // Re-centre on what is actually painted, so the annotation margin is
      // shared evenly rather than all falling on one side.
      this.draw();
      const after = this.paintedExtent();
      this.origin = {
        x: this.origin.x + (view.left + (view.availW - after.w) / 2 - after.minX),
        y: this.origin.y + (view.top + (view.availH - after.h) / 2 - after.minY),
      };
    }
    this.didFit = true;
    this.draw();
  },

  zoomAt(factor, cx, cy) {
    const newScale = P.clamp(this.scale * factor, 20, 400);
    if (Math.abs(newScale - this.scale) < 0.0001) return;
    const plan = this.plan({ x: cx, y: cy });
    this.scale = newScale;
    this.origin = { x: cx - plan.x * this.scale, y: cy - plan.z * this.scale };
    this.draw();
  },

  /// Sets an absolute zoom (pixels per metre), anchored at the canvas centre.
  zoomTo(scale) {
    const rect = this.canvas.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const plan = this.plan({ x: cx, y: cy });
    this.scale = P.clamp(scale, 20, 400);
    this.origin = { x: cx - plan.x * this.scale, y: cy - plan.z * this.scale };
    this.draw();
  },

  /// Steps the zoom by a fixed number of percentage points (e.g. ±10).
  zoomStep(delta) {
    this.zoomTo(this.scale + delta);
  },

  /// Current zoom as a percentage of the 100 px/m baseline.
  zoomPercent() {
    return Math.round(this.scale);
  },

  /// Double-clicking the zoom readout opens an inline number input (no "%").
  beginZoomEdit() {
    if (this.zoomEditing) return;
    this.zoomEditing = true;
    // Built with DOM APIs rather than an interpolated innerHTML. The editor must
    // not import app/ui.js for an escaper — that is the wrong dependency
    // direction — and the only value here is this editor's own numeric zoom, so
    // there is nothing to interpolate in the first place. The clear uses a
    // literal, which is the one innerHTML form that needs no escaping.
    this.zoomEl.innerHTML = "";
    const input = document.createElement("input");
    input.type = "number";
    input.id = "zoom-input";
    input.value = String(this.zoomPercent());
    input.min = "20";
    input.max = "400";
    input.step = "5";
    this.zoomEl.appendChild(input);
    input.focus();
    input.select();
    const finish = () => {
      // An emptied field is not a request for 0%: `Number("")` is 0 and
      // `isNaN(0)` is false, so clearing the field committed `zoomTo(0)`, which
      // clamped to the 20% floor. `blur` calls this too, so merely clicking away
      // from the field did it. Only a real, finite number applies.
      const raw = String(input.value).trim();
      const v = Math.round(Number(raw));
      if (raw !== "" && Number.isFinite(v)) this.zoomTo(v);
      this.zoomEditing = false;
      this.zoomEl.textContent = this.zoomPercent() + "%";
    };
    input.addEventListener("change", finish);
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") finish();
      else if (e.key === "Escape") {
        this.zoomEditing = false;
        this.zoomEl.textContent = this.zoomPercent() + "%";
      }
    });
    input.addEventListener("blur", () => {
      if (this.zoomEditing) finish();
    });
  }
};
