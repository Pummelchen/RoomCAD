// Editor2D's draw items methods.
//
// Part of editor2d.js; they are applied to `Editor2D.prototype` there, so `this`
// is the editor and every method still reaches every other one.

import * as P from "../plan.js";
import { store } from "../store.js";

export const draw_items = {

  drawOpeningMeasurements(kind, id) {
    const room = store.room;
    const spacing = P.openingSpacing(room, id, kind);
    const wall = P.openingWall(room, id, kind);
    if (!spacing || !wall) return;
    const offset = spacing.toWallStart;
    let width;
    if (kind === "door") {
      const d = room.doors.find(x => x.id === id);
      width = d ? d.width : 0;
    } else {
      const w = room.windows.find(x => x.id === id);
      width = w ? w.width : 0;
    }
    if (!width) return;
    const toEnd = spacing.toWallEnd;
    const perp = P.wallPerp(wall);
    const labelPoint = (o, push) => {
      const pt = P.wallPointAt(wall, o);
      return this.screen({ x: pt.x + perp.x * push, z: pt.z + perp.z * push });
    };
    // Show the distance to the nearest boundary on each side: a neighbour
    // opening when there is one, otherwise the end of the wall.
    if (spacing.gapToPrevious !== null) {
      this.drawChip(Math.round(spacing.gapToPrevious * 100), labelPoint(offset - spacing.gapToPrevious / 2, 0.5));
    } else {
      this.drawChip(Math.round(offset * 100), labelPoint(offset / 2, 0.5));
    }
    this.drawChip(Math.round(width * 100), labelPoint(offset + width / 2, 0.5));
    if (spacing.gapToNext !== null) {
      this.drawChip(Math.round(spacing.gapToNext * 100), labelPoint(offset + width + spacing.gapToNext / 2, 0.5));
    } else {
      this.drawChip(Math.round(toEnd * 100), labelPoint(offset + width + toEnd / 2, 0.5));
    }
  },

  /// Shows the length of the selected wall (or the wall being resized) so the
  /// current measurement in centimetres is always visible.
  drawSelectedWallLength() {
    const wall = store.selectedWall();
    if (!wall) return;
    const mid = P.wallMidpoint(wall);
    const perp = P.wallPerp(wall);
    const at = this.screen({ x: mid.x + perp.x * 0.5, z: mid.z + perp.z * 0.5 });
    this.drawChip(Math.round(P.wallLength(wall) * 100), at);
  },

  /// Shows the size of the selected furniture in centimetres on the plan.
  drawFurnitureSize() {
    const item = store.selectedFurniture();
    if (!item) return;
    const kind = P.FURNITURE_KINDS[item.kind];
    const swaps = item.rotationDegrees === 90 || item.rotationDegrees === 270;
    const w = Math.round((swaps ? kind.d : kind.w) * 100);
    const d = Math.round((swaps ? kind.w : kind.d) * 100);
    const f = P.furnitureFootprint(item);
    const c = this.screen({ x: (f.minX + f.maxX) / 2, z: f.maxZ });
    this.drawChipText(w + " × " + d + " cm", { x: c.x, y: c.y + 14 });
  },

  /// Shows how much space surrounds the selected/moving furniture: distance to
  /// the nearest wall and to the nearest other piece of furniture, in cm.
  drawFurnitureGaps() {
    const gaps = store.furnitureGaps;
    if (!gaps) return;
    const item = store.room.furniture.find(f => f.id === gaps.id);
    if (!item) return;
    const f = P.furnitureFootprint(item);
    const c = this.screen({ x: (f.minX + f.maxX) / 2, z: f.maxZ });
    let y = c.y + 34; // below the size chip
    if (gaps.wall) {
      this.drawChipText("wall " + gaps.wall.cm + " cm", { x: c.x, y });
      y += 22;
    }
    if (gaps.furniture) {
      const title = P.FURNITURE_KINDS[gaps.furniture.kind].title.toLowerCase();
      this.drawChipText(gaps.furniture.cm + " cm to " + title, { x: c.x, y });
    }
  },

  /// Draws the measure-tool ruler (dragging or the last result).
  drawMeasure() {
    const m = this.measureDrag || this.measureResult;
    if (!m) return;
    const ctx = this.ctx;
    const a = this.screen(m.start);
    const b = this.screen(m.end);
    ctx.strokeStyle = "#3ddc6a";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const pt of [a, b]) {
      ctx.fillStyle = "#3ddc6a";
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    this.drawChip(Math.round(P.distance(m.start, m.end) * 100), {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    });
  },

  drawChip(cmValue, at) {
    const ctx = this.ctx;
    const text = cmValue + " cm";
    ctx.font = "600 11px -apple-system, sans-serif";
    const metrics = ctx.measureText(text);
    const padX = 5;
    const padY = 3;
    const w = metrics.width + padX * 2;
    const h = 18;
    ctx.fillStyle = "rgba(30,30,34,0.95)";
    this.roundRect(at.x - w / 2, at.y - h / 2, w, h, 5);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 0.5;
    this.roundRect(at.x - w / 2, at.y - h / 2, w, h, 5);
    ctx.stroke();
    ctx.fillStyle = "#f0f0f2";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, at.x, at.y + 0.5);
  },

  /// Like drawChip, but for an arbitrary label (e.g. "90 × 200 cm").
  drawChipText(text, at) {
    const ctx = this.ctx;
    ctx.font = "600 11px -apple-system, sans-serif";
    const metrics = ctx.measureText(text);
    const padX = 5;
    const padY = 3;
    const w = metrics.width + padX * 2;
    const h = 18;
    ctx.fillStyle = "rgba(30,30,34,0.95)";
    this.roundRect(at.x - w / 2, at.y - h / 2, w, h, 5);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 0.5;
    this.roundRect(at.x - w / 2, at.y - h / 2, w, h, 5);
    ctx.stroke();
    ctx.fillStyle = "#f0f0f2";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, at.x, at.y + 0.5);
  },

  furnitureState(item, selected) {
    if (store.furnitureFeedback && store.furnitureFeedback.id === item.id) {
      return store.furnitureFeedback.state; // "valid" | "invalid"
    }
    // Red is a property of where the item IS, not of what just happened to it.
    // Deriving it means a piece left overlapping stays red after the drag ends,
    // and clears itself the moment it is moved or turned somewhere it fits.
    if (this._clashing && this._clashing.has(item.id)) return "invalid";
    return selected ? "selected" : "default";
  },

  /// Ids of every furniture item currently overlapping a wall or another item.
  /// Computed once per frame rather than per item.
  clashingFurniture(room) {
    const out = new Set();
    for (const item of room.furniture || []) {
      if (!P.isFurniturePlacementValid(room, item, new Set([item.id]))) out.add(item.id);
    }
    return out;
  },

  furnitureColors(state) {
    switch (state) {
      case "valid":
        return { fill: "rgba(57,255,20,0.32)", stroke: "#39ff14", text: "#39ff14", front: "#39ff14", width: 2.5 };
      case "invalid":
        return { fill: "rgba(255,59,48,0.32)", stroke: "#ff3b30", text: "#ff3b30", front: "#ff3b30", width: 2.5 };
      case "selected":
        return { fill: "rgba(0,0,0,0.85)", stroke: "#3d8bfd", text: "#3d8bfd", front: "#3d8bfd", width: 3 };
      default:
        return { fill: "rgba(0,0,0,0.85)", stroke: "#4a4a50", text: "#e8e8ea", front: "#5a5a60", width: 2 };
    }
  },

  drawFurniture(item, selected) {
    const ctx = this.ctx;
    const rect = this.rect(P.furnitureFootprint(item));
    const kind = P.FURNITURE_KINDS[item.kind];
    const state = this.furnitureState(item, selected);

    if (kind.category === "fixture") {
      this.drawFixture(rect, state, kind);
      return;
    }

    const c = this.furnitureColors(state);
    this.roundRect(rect.x, rect.y, rect.w, rect.h, 6);
    ctx.fillStyle = c.fill;
    ctx.fill();
    ctx.strokeStyle = c.stroke;
    ctx.lineWidth = c.width;
    ctx.stroke();

    ctx.font = "600 10px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = c.text;
    ctx.fillText(kind.label, rect.x + rect.w / 2, rect.y + rect.h / 2);

    // Special-side indicator (backrest / pillows / door knobs).
    this.drawFurnitureFeature(item, state, c);
  },

  /// Draws the furniture's "special side" so its orientation is clear in 2D:
  /// a chair shows its backrest, a bed its pillow side, and a wardrobe the
  /// edge with its two door knobs. Square tables need no indicator.
  drawFurnitureFeature(item, state, c) {
    if (item.kind === "table") return;
    const ctx = this.ctx;
    const f = P.furnitureFootprint(item);
    const dir = this.featureDirection(item);

    let a, b;
    if (dir === "top") { a = { x: f.minX, z: f.minZ }; b = { x: f.maxX, z: f.minZ }; }
    else if (dir === "bottom") { a = { x: f.minX, z: f.maxZ }; b = { x: f.maxX, z: f.maxZ }; }
    else if (dir === "left") { a = { x: f.minX, z: f.minZ }; b = { x: f.minX, z: f.maxZ }; }
    else { a = { x: f.maxX, z: f.minZ }; b = { x: f.maxX, z: f.maxZ }; } // right

    const sa = this.screen(a);
    const sb = this.screen(b);
    const color = state === "default" ? "#cfd2d8" : c.front;

    if (item.kind === "wardrobe" || item.kind === "dresser") {
      // Two door/drawer knobs mark the front edge.
      const t = 0.22;
      ctx.fillStyle = color;
      for (const k of [t, 1 - t]) {
        const kx = sa.x + (sb.x - sa.x) * k;
        const ky = sa.y + (sb.y - sa.y) * k;
        ctx.beginPath();
        ctx.arc(kx, ky, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (item.kind === "nightstand") {
      // A single centred drawer knob.
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc((sa.x + sb.x) / 2, (sa.y + sb.y) / 2, 2.4, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Backrest (chair/sofa/armchair) / pillow or open side (bed, desk, shelf):
      // a thick band along the edge.
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(sa.x, sa.y);
      ctx.lineTo(sb.x, sb.y);
      ctx.stroke();
    }
  },

  /// Which footprint edge holds the special feature for the current rotation.
  featureDirection(item) {
    const r = ((item.rotationDegrees % 360) + 360) % 360;
    const idx = r / 90;
    if (item.kind === "chair" || item.kind === "sofa" || item.kind === "armchair") {
      // Backrest sits on the +D side.
      return ["bottom", "left", "top", "right"][idx];
    }
    // Bed pillows, desk/shelf fronts and wardrobe/dresser/nightstand fronts sit
    // on the -D side.
    return ["top", "right", "bottom", "left"][idx];
  },

  drawFixture(rect, state, kind) {
    const ctx = this.ctx;
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    const rgb = kind.color.map(c => Math.round(c * 255)).join(",");
    const base = `rgb(${rgb})`;
    const c = this.furnitureColors(state);
    const glow = state === "invalid" ? "rgba(255,59,48,0.22)"
      : state === "valid" ? "rgba(57,255,20,0.22)"
      : state === "selected" ? "rgba(47,125,225,0.22)"
      : "rgba(255,228,140,0.16)";
    const body = state === "invalid" ? "rgba(255,59,48,0.4)"
      : state === "valid" ? "rgba(57,255,20,0.4)"
      : state === "selected" ? "rgba(47,125,225,0.4)"
      : `rgba(${rgb},0.19)`;   // 0x30 alpha over the fixture's own colour

    if (kind === P.FURNITURE_KINDS.lightPanel) {
      // Square 60×60 cm office panel.
      const pad = 4;
      ctx.fillStyle = glow;
      this.roundRect(rect.x - pad, rect.y - pad, rect.w + pad * 2, rect.h + pad * 2, 8);
      ctx.fill();
      ctx.fillStyle = body;
      this.roundRect(rect.x, rect.y, rect.w, rect.h, 6);
      ctx.fill();
      ctx.strokeStyle = state === "default" ? base : c.stroke;
      ctx.lineWidth = state === "default" ? 2 : c.width;
      this.roundRect(rect.x, rect.y, rect.w, rect.h, 6);
      ctx.stroke();
      // Diffuser.
      ctx.fillStyle = "#fff6d8";
      this.roundRect(rect.x + rect.w * 0.18, rect.y + rect.h * 0.18, rect.w * 0.64, rect.h * 0.64, 4);
      ctx.fill();
    } else {
      // Classic round bulb.
      const r = Math.max(5, Math.min(rect.w, rect.h) / 2);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, r + 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = state === "default" ? base : c.stroke;
      ctx.lineWidth = state === "default" ? 2 : c.width;
      ctx.stroke();
      ctx.fillStyle = "#fff6d8";
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.34, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.font = "600 9px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = state === "default" ? "#e8e8ea" : c.text;
    ctx.fillText(kind.label, cx, rect.y + rect.h + 3);
  },

  drawFurnitureGhost(kind, raw) {
    const ctx = this.ctx;
    // Drawn the way round it will actually land, so R shows its effect before
    // the piece is put down rather than after.
    const item = {
      kind, center: P.point(raw.x, raw.z),
      rotationDegrees: store.pendingFurnitureRotation || 0,
    };
    item.center = P.furnitureCenter(store.room, raw, item);
    const valid = P.isFurniturePlacementValid(store.room, item);
    const rect = this.rect(P.furnitureFootprint(item));
    const k = P.FURNITURE_KINDS[kind];
    const color = valid ? "#34c759" : "#ff3b30";
    if (k.category === "fixture") {
      ctx.fillStyle = valid ? "rgba(52,199,89,0.22)" : "rgba(255,59,48,0.22)";
      if (k === P.FURNITURE_KINDS.lightPanel) {
        this.roundRect(rect.x, rect.y, rect.w, rect.h, 6);
        ctx.fill();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        this.roundRect(rect.x, rect.y, rect.w, rect.h, 6);
        ctx.stroke();
      } else {
        const cx = rect.x + rect.w / 2;
        const cy = rect.y + rect.h / 2;
        const r = Math.max(5, Math.min(rect.w, rect.h) / 2);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.setLineDash([]);
      return;
    }
    this.roundRect(rect.x, rect.y, rect.w, rect.h, 6);
    ctx.fillStyle = valid ? "rgba(52,199,89,0.22)" : "rgba(255,59,48,0.22)";
    ctx.fill();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
  },

  drawSnapDot(p) {
    const ctx = this.ctx;
    const c = this.screen(p);
    ctx.fillStyle = "#3ddc6a";
    ctx.beginPath();
    ctx.arc(c.x, c.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#0e0e10";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 7, 0, Math.PI * 2);
    ctx.stroke();
  },

  roundRect(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
};
