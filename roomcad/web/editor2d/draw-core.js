// Editor2D's draw core methods.
//
// Part of editor2d.js; they are applied to `Editor2D.prototype` there, so `this`
// is the editor and every method still reaches every other one.

import * as P from "../plan.js";
import { store } from "../store.js";
import { DIM_COLOR, DIM_TEXT, DIM_TICK_PX, HANDLE_COLOR, HANDLE_RADIUS_PX, HANDLE_STROKE } from "./theme.js";

export const draw_core = {

  // MARK: Drawing

  /// Coalesces redraws onto the next animation frame. Pointer moves arrive far
  /// faster than the display refreshes, and drawing synchronously on each one
  /// re-rendered the whole plan several times per frame for no visible gain.
  requestDraw() {
    if (this._drawPending) return;
    this._drawPending = true;
    requestAnimationFrame(() => {
      this._drawPending = false;
      this.draw();
    });
  },

  draw() {
    // When the plan is rotated, keep the plan point that was at the center of
    // the canvas stationary, so turning the plan doesn't jump around.
    if (this.lastRotation !== store.rotation) {
      const oldRotation = this.lastRotation;
      const rect = this.canvas.getBoundingClientRect();
      const center = { x: rect.width / 2, y: rect.height / 2 };
      const centerPlan = this.plan(center, oldRotation);
      this.lastRotation = store.rotation;
      const display = this.screen(centerPlan, store.rotation);
      this.origin.x += center.x - display.x;
      this.origin.y += center.y - display.y;
    }

    const ctx = this.ctx;
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const room = store.room;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#0e0e10";
    ctx.fillRect(0, 0, w, h);

    // Canvas base plate (2D-only), larger than the main room.
    const canvasBounds = P.canvasOf(room);
    const plate = this.rect({ minX: 0, maxX: canvasBounds.width, minZ: 0, maxZ: canvasBounds.length });
    ctx.fillStyle = "#141218";
    ctx.fillRect(plate.x, plate.y, plate.w, plate.h);
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    ctx.strokeRect(plate.x + 0.5, plate.y + 0.5, plate.w - 1, plate.h - 1);

    // Main room floor, drawn on top of the plate (centred via the room origin).
    const origin = P.roomOrigin(room);
    const floor = this.rect({ minX: origin.x, maxX: origin.x + room.width, minZ: origin.z, maxZ: origin.z + room.length });
    ctx.fillStyle = "#1b1916";
    ctx.fillRect(floor.x, floor.y, floor.w, floor.h);

    this.drawGrid(room);

    // Readouts claim screen space in draw order, so the set resets here — at
    // the start of this frame's annotation work, before the public-area side
    // lengths below push into it. Resetting after that pass (as it used to)
    // culled this frame's readouts against the previous frame's boxes and then
    // threw away the boxes they had just claimed.
    this.dimensionBoxes = [];

    // Public-space rectangles (excluded from auto-layout), drawn under walls.
    for (const a of room.publicAreas || []) {
      this.drawPublicArea(a, false, a.id === store.selectedPublicID);
    }
    if (this.drag && this.drag.type === "publicArea") {
      this.drawPublicArea({
        x: Math.min(this.drag.anchor.x, this.drag.current.x),
        z: Math.min(this.drag.anchor.z, this.drag.current.z),
        w: Math.abs(this.drag.current.x - this.drag.anchor.x),
        l: Math.abs(this.drag.current.z - this.drag.anchor.z),
      }, true);
    }

    // Highlight wall under the cursor for door/window placement
    if ((store.tool === "door" || store.tool === "window") && this.hover) {
      const placement = P.wallForPlacement(room, this.hover);
      if (placement) {
        const a = this.screen(placement.wall.start);
        const b = this.screen(placement.wall.end);
        ctx.strokeStyle = "rgba(61, 139, 253, 0.28)";
        ctx.lineWidth = 12;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    // Which walls face the open air — worked out once per frame and reused by
    // the drawing, the handles and the hit-testing, so they cannot disagree.
    this._lockedWalls = new Set();
    for (const wall of room.walls) {
      if (this.wallHeld(wall)) this._lockedWalls.add(wall.id);
    }
    for (const wall of room.walls) {
      this.drawWall(wall, wall.id === store.selectedWallID);
    }

    this.drawSelectedWallLength();

    const measured = this.activeOpening();
    if (measured) {
      this.drawOpeningMeasurements(measured.kind, measured.id);
    }

    this._clashing = this.clashingFurniture(room);
    for (const item of room.furniture) {
      this.drawFurniture(item, item.id === store.selectedFurnitureID);
    }
    this.drawFurnitureSize();
    this.drawFurnitureGaps();

    if (this.drag && this.drag.type === "drawWall") {
      const a = this.screen(this.drag.anchor);
      const b = this.screen(this.drag.current);
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = "#3d8bfd";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      // Live length readout while drawing
      const lengthCm = Math.round(P.distance(this.drag.anchor, this.drag.current) * 100);
      this.drawChip(lengthCm, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      this.drawSnapDot(this.drag.current);
    }

    if (store.tool === "furniture" && store.pendingFurnitureKind && this.hover) {
      this.drawFurnitureGhost(store.pendingFurnitureKind, this.hover);
    }

    if (store.tool === "wall" && this.hover && P.canStartWallAt(room, this.hover)) {
      this.drawSnapDot(P.snapPoint(room, this.hover));
    }

    for (const label of room.labels || []) {
      this.drawLabel(label, label.id === store.selectedLabelID);
    }

    if (store.tool === "label" && this.hover) {
      this.drawLabel({ text: "Label", center: this.hover, rotationDegrees: 0,
        size: P.LABEL_DEFAULT_SIZE }, false);
    }

    this.drawRoomSelection(room);

    // Readouts already drawn this frame claim their space; the set was cleared
    // at the top of the frame.
    this.drawWallClashes(room);
    this.drawRoomCaptions(room);

    // Permanent CAD dimensions, then the grab handles on top of everything.
    this.drawPermanentDimensions(room);
    this.drawHandles(room);

    this.drawMeasure();

    // Cursor reflects the active tool: arrow for Select, crosshair for tools.
    if (this.drag && this.drag.type === "pan") {
      this.canvas.style.cursor = "grabbing";
    } else if (this.spaceDown) {
      this.canvas.style.cursor = "grab";
    } else if (store.tool === "select") {
      this.canvas.style.cursor = "default";
    } else {
      this.canvas.style.cursor = "crosshair";
    }

    // Keep the zoom readout in sync (unless the user is typing a value).
    if (this.zoomEl && !this.zoomEditing) this.zoomEl.textContent = this.zoomPercent() + "%";
  },

  activeOpening() {
    if (this.drag && this.drag.type === "slideOpening") {
      return { kind: this.drag.kind, id: this.drag.id };
    }
    if (store.selectedDoorID) return { kind: "door", id: store.selectedDoorID };
    if (store.selectedWindowID) return { kind: "window", id: store.selectedWindowID };
    return null;
  },

  /// Draws a public-space rectangle (semi-transparent green) or its preview.
  drawPublicArea(area, preview = false, selected = false) {
    const ctx = this.ctx;
    const r = this.rect({ minX: area.x, maxX: area.x + area.w, minZ: area.z, maxZ: area.z + area.l });
    // An area being carried over another one reads red. It still follows the
    // cursor — the drag is never blocked — and this is how it says that where
    // it is now is not where it can stay.
    const clashing = store.publicFeedback
      && store.publicFeedback.id === area.id
      && store.publicFeedback.state === "invalid";
    if (clashing) {
      ctx.fillStyle = "rgba(255,72,60,0.18)";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = "#ff483c";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      ctx.setLineDash([]);
      return;
    }
    ctx.fillStyle = preview ? "rgba(57,255,20,0.14)"
      : selected ? "rgba(57,255,20,0.18)" : "rgba(57,255,20,0.10)";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = preview || selected ? "#39ff14" : "rgba(57,255,20,0.45)";
    ctx.lineWidth = preview || selected ? 2 : 1.5;
    ctx.setLineDash(preview ? [6, 4] : selected ? [] : [4, 4]);
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    ctx.setLineDash([]);
    if (!preview && r.w > 34 && r.h > 16) {
      ctx.font = "600 11px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(57,255,20,0.8)";
      ctx.fillText("PUBLIC", r.x + r.w / 2, r.y + r.h / 2);
    }
    // Side lengths: live while drawing or resizing, so the size is known before
    // letting go rather than after.
    if (preview || selected) {
      const nw = { x: area.x, z: area.z };
      const ne = { x: area.x + area.w, z: area.z };
      const sw = { x: area.x, z: area.z + area.l };
      const opts = { color: "rgba(57,255,20,0.85)", textColor: "#c9ffbe", force: true };
      if (area.w > 0.01) this.drawDimension(nw, ne, -14, area.w, opts);
      if (area.l > 0.01) this.drawDimension(nw, sw, 14, area.l, opts);
    }
  },

  /// A red grab handle. Everything the user can pull on gets the same marker,
  /// so "red dot means you can drag this" is learned once.
  drawHandle(planPoint) {
    const c = this.screen(planPoint);
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(c.x, c.y, HANDLE_RADIUS_PX, 0, Math.PI * 2);
    ctx.fillStyle = HANDLE_COLOR;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = HANDLE_STROKE;
    ctx.stroke();
  },

  /// A dimension line between two plan points, offset perpendicular to them,
  /// with extension lines, end ticks and a centred centimetre readout — the
  /// same anatomy a drafting program uses, kept deliberately plain.
  drawDimension(from, to, offsetPx, metres, options = {}) {
    const ctx = this.ctx;
    const a = this.screen(from);
    const b = this.screen(to);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    // Too short on screen to letter — a cramped label is worse than none.
    if (len < 26 && !options.force) return;

    // Perpendicular, pointing to whichever side the caller asked for.
    const nx = -dy / len;
    const ny = dx / len;
    const ox = nx * offsetPx;
    const oy = ny * offsetPx;
    const a2 = { x: a.x + ox, y: a.y + oy };
    const b2 = { x: b.x + ox, y: b.y + oy };

    ctx.save();
    ctx.strokeStyle = options.color || DIM_COLOR;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);

    // Extension lines, from just off the element out past the dimension line.
    const gap = 3;
    ctx.beginPath();
    ctx.moveTo(a.x + nx * gap, a.y + ny * gap);
    ctx.lineTo(a2.x + nx * 3, a2.y + ny * 3);
    ctx.moveTo(b.x + nx * gap, b.y + ny * gap);
    ctx.lineTo(b2.x + nx * 3, b2.y + ny * 3);
    ctx.stroke();

    // The dimension line itself.
    ctx.beginPath();
    ctx.moveTo(a2.x, a2.y);
    ctx.lineTo(b2.x, b2.y);
    ctx.stroke();

    // 45° architect's ticks rather than arrowheads: cheaper to read at 1 px.
    const ux = dx / len;
    const uy = dy / len;
    const tick = (pt, sign) => {
      ctx.beginPath();
      ctx.moveTo(pt.x - (ux + nx) * DIM_TICK_PX * sign, pt.y - (uy + ny) * DIM_TICK_PX * sign);
      ctx.lineTo(pt.x + (ux + nx) * DIM_TICK_PX * sign, pt.y + (uy + ny) * DIM_TICK_PX * sign);
      ctx.stroke();
    };
    tick(a2, 1);
    tick(b2, 1);

    // The readout, upright regardless of plan rotation, on a chip of the
    // background so it stays legible over walls and floor alike.
    const mid = { x: (a2.x + b2.x) / 2, y: (a2.y + b2.y) / 2 };
    const text = P.cm(metres);
    ctx.font = options.font || "600 10px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const tw = ctx.measureText(text).width;
    const box = { x: mid.x - tw / 2 - 3, y: mid.y - 7, w: tw + 6, h: 14 };
    // Zoomed out, a dense plan puts more readouts on screen than there is room
    // for and they pile on top of each other, which is worse than not showing
    // them: an unreadable number is still a number you might trust. Drop the
    // ones that would collide and let the zoom decide how much detail fits.
    if (this.dimensionBoxes.some(o =>
      box.x < o.x + o.w && o.x < box.x + box.w && box.y < o.y + o.h && o.y < box.y + box.h)) {
      ctx.restore();
      return;
    }
    this.dimensionBoxes.push(box);
    ctx.fillStyle = "rgba(14, 14, 16, 0.82)";
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.fillStyle = options.textColor || DIM_TEXT;
    ctx.fillText(text, mid.x, mid.y);
    ctx.restore();
  }
};
