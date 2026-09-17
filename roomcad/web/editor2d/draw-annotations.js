// Editor2D's draw annotations methods.
//
// Part of editor2d.js; they are applied to `Editor2D.prototype` there, so `this`
// is the editor and every method still reaches every other one.

import * as P from "../plan.js";
import { store } from "../store.js";
import { CAPTION_COLOR, CAPTION_PX, DIM_OFFSET_PX } from "./theme.js";

export const draw_annotations = {

  /// Which side of a wall its dimension line should sit on. Always the side
  /// away from the room centre, so dimensions ring the plan rather than
  /// cluttering its middle.
  dimensionSide(from, to) {
    const room = store.room;
    const origin = P.roomOrigin(room);
    const cx = origin.x + room.width / 2;
    const cz = origin.z + room.length / 2;
    const mid = { x: (from.x + to.x) / 2, z: (from.z + to.z) / 2 };
    const a = this.screen(from);
    const b = this.screen(to);
    const m = this.screen(mid);
    const centre = this.screen({ x: cx, z: cz });
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    // Positive offset points along (nx, ny); flip it if that heads inward.
    const toward = (m.x + nx - centre.x) ** 2 + (m.y + ny - centre.y) ** 2;
    const away = (m.x - nx - centre.x) ** 2 + (m.y - ny - centre.y) ** 2;
    return toward >= away ? 1 : -1;
  },

  /// Permanent dimensions for every wall, door and window — the thing that
  /// makes the plan readable without clicking anything.
  drawPermanentDimensions(room) {
    for (const wall of room.walls) {
      const len = P.wallLength(wall);
      if (len < 0.01) continue;
      const side = this.dimensionSide(wall.start, wall.end);
      this.drawDimension(wall.start, wall.end, DIM_OFFSET_PX * side, len);
    }
    for (const kind of ["door", "window"]) {
      const list = kind === "door" ? room.doors : room.windows;
      for (const o of list) {
        const ends = P.openingEndpoints(room, kind, o.id);
        if (!ends) continue;
        const side = this.dimensionSide(ends.start, ends.end);
        // Openings dimension on the same side as their wall, but closer in, so
        // the two rows never collide.
        this.drawDimension(ends.start, ends.end, (DIM_OFFSET_PX - 9) * side, o.width, {
          color: kind === "door" ? "rgba(255, 196, 120, 0.75)" : "rgba(150, 220, 255, 0.8)",
          textColor: kind === "door" ? "#ffd9a8" : "#c8ecff",
        });
      }
    }
  },

  /// The red grab handles for whatever is selected.
  drawHandles(room) {
    const kind = store.selectedOpeningKind();
    if (kind) {
      const id = kind === "door" ? store.selectedDoorID : store.selectedWindowID;
      const ends = P.openingEndpoints(room, kind, id);
      if (ends) {
        this.drawHandle(ends.start);
        this.drawHandle(ends.end);
      }
    }
    const wall = store.selectedWall();
    // No red grab handles on a wall that is held still — they would promise a
    // drag that is then refused.
    if (wall && !this.wallHeld(wall)) {
      this.drawHandle(wall.start);
      this.drawHandle(wall.end);
    }
    const area = store.selectedPublicArea();
    if (area) {
      for (const c of P.publicAreaCorners(area)) this.drawHandle(c);
    }
  },

  /// A text label. Its position turns with the plan so it stays on whatever it
  /// names, but the text itself is flipped upright when the rotation would
  /// otherwise leave it upside down — the CAD convention.
  drawLabel(label, selected) {
    const ctx = this.ctx;
    const c = this.screen(label.center);
    const size = (label.size || P.LABEL_DEFAULT_SIZE) * this.scale;
    if (size < 4) return;
    let angle = ((label.rotationDegrees + store.rotation) % 360 + 360) % 360;
    if (angle > 90 && angle < 270) angle = (angle + 180) % 360;

    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(angle * Math.PI / 180);
    ctx.font = `600 ${size.toFixed(1)}px -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const text = label.text || "";
    const tw = ctx.measureText(text).width;
    const pad = size * 0.32;

    if (selected) {
      ctx.fillStyle = "rgba(46, 204, 64, 0.14)";
      ctx.strokeStyle = "#2ecc40";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.rect(-tw / 2 - pad, -size * 0.78, tw + pad * 2, size * 1.56);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = selected ? "#eaffea" : "#f0e6c8";
    ctx.fillText(text || "(empty)", 0, 0);
    ctx.restore();

    if (selected) this.drawHandle(label.center);
  },

  /// Is this wall held still?
  ///
  /// Deferred to the store, which is where the drag itself asks the question.
  /// Working it out here as well is how the handles came to promise a drag that
  /// was then refused: five places asking, two of them with different answers.
  wallHeld(wall) {
    return !!wall && store.wallIsLocked(wall.id);
  },

  /// The m² caption for every enclosed room, dropped into the
  /// emptiest part of the floor so it never lands on furniture or a label.
  ///
  /// The caption's footprint depends on the zoom, so the search is redone when
  /// the zoom changes — but only then, and only when the plan itself has
  /// changed. At small zooms the caption would be illegible, so it is left out
  /// rather than drawn as a smudge.
  drawRoomCaptions(room) {
    if (this.scale < 26) return;
    const ctx = this.ctx;
    ctx.font = `600 ${CAPTION_PX}px -apple-system, "Segoe UI", sans-serif`;
    // Widest plausible caption ("999.9 m²") in plan metres, plus breathing room.
    const boxW = (ctx.measureText("999.9 m²").width + 10) / this.scale;
    const boxH = (CAPTION_PX + 8) / this.scale;

    const key = `${boxW.toFixed(3)}|${boxH.toFixed(3)}|${store.room.walls.length}`;
    const stamp = this.captionStamp(room);
    if (!this._captions || this._captionKey !== key || this._captionStamp !== stamp) {
      this._captions = P.roomCaptions(room, boxW, boxH);
      this._captionKey = key;
      this._captionStamp = stamp;
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const cap of this._captions) {
      const c = this.visibleCaptionSpot(cap);
      if (!c) continue;
      const text = cap.area.toFixed(1) + " m²";
      const w = ctx.measureText(text).width;
      const box = { x: c.x - w / 2 - 5, y: c.y - CAPTION_PX * 0.72, w: w + 10, h: CAPTION_PX * 1.44 };
      // Claim the space before any dimension readout is drawn. Readouts already
      // give way to each other when they would collide; a room's area is the
      // more useful of the two, so it goes down first and the readout under it
      // steps aside instead of printing one number on top of the other.
      this.dimensionBoxes.push(box);
      ctx.fillStyle = "rgba(14, 14, 16, 0.55)";
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.fillStyle = CAPTION_COLOR;
      ctx.fillText(text, c.x, c.y);
    }
  },

  /// Everything a caption's position depends on: the walls and doors that
  /// define the rooms, and the things it has to avoid.
  /// Where to draw a room's area so it can actually be read.
  ///
  /// The caption belongs in the emptiest part of the room, and that is where it
  /// goes while the room fits on screen. Zoom in on one wall to drag it to a
  /// measurement — which is exactly when the number matters — and that spot is
  /// somewhere off the side of the screen, so the room shows no area at all.
  ///
  /// So: the chosen spot if it is visible, otherwise the middle of the largest
  /// piece of that room's floor that IS visible. Null when none of it is.
  visibleCaptionSpot(cap) {
    const margin = 46;
    // screen() works in CSS pixels, so the on-screen test has to as well:
    // canvas.width/height are device pixels and would make the test up to 2×
    // too generous on a high-DPR display, painting a caption off the canvas.
    const rect = this.canvas.getBoundingClientRect();
    const ideal = this.screen({ x: cap.x, z: cap.z });
    const onScreen = p => Number.isFinite(p.x) && Number.isFinite(p.y)
      && p.x >= margin && p.y >= margin
      && p.x <= rect.width - margin && p.y <= rect.height - margin;
    if (onScreen(ideal)) return ideal;
    if (!cap.rects || !cap.rects.length) return null;

    // The rooms are rectilinear, so the visible part of each rectangle is a
    // rectangle too — worked out on screen, where the viewport is, rather than
    // in plan coordinates, which the rotation would have to be undone for.
    let best = null;
    for (const r of cap.rects) {
      const a = this.screen({ x: r.x, z: r.z });
      const b = this.screen({ x: r.x + r.w, z: r.z + r.l });
      const x0 = Math.max(Math.min(a.x, b.x), margin);
      const x1 = Math.min(Math.max(a.x, b.x), rect.width - margin);
      const y0 = Math.max(Math.min(a.y, b.y), margin);
      const y1 = Math.min(Math.max(a.y, b.y), rect.height - margin);
      if (!(x1 > x0 && y1 > y0)) continue;
      const seen = (x1 - x0) * (y1 - y0);
      if (!best || seen > best.seen) best = { seen, x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    }
    return best ? { x: best.x, y: best.y } : null;
  },

  captionStamp(room) {
    const walls = room.walls.map(w => `${w.start.x},${w.start.z},${w.end.x},${w.end.z}`).join(";");
    const doors = room.doors.map(d => d.wallID).join(";");
    const furniture = (room.furniture || [])
      .map(f => `${f.kind},${f.center.x},${f.center.z},${f.rotationDegrees}`).join(";");
    const labels = (room.labels || [])
      .map(l => `${l.center.x},${l.center.z},${l.size},${(l.text || "").length}`).join(";");
    const publics = (room.publicAreas || []).map(a => `${a.x},${a.z},${a.w},${a.l}`).join(";");
    return `${walls}|${doors}|${furniture}|${labels}|${publics}`;
  }
};
