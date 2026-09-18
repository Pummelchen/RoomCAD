// Editor2D's draw room methods.
//
// Part of editor2d.js; they are applied to `Editor2D.prototype` there, so `this`
// is the editor and every method still reaches every other one.

import * as P from "../plan.js";
import { store } from "../store.js";
import { CLASH_EDGE, CLASH_FILL } from "./theme.js";

export const draw_room = {

  /// Paints the stretch where two walls lie on top of each other. Nothing is
  /// blocked or moved — the point is only to make a mistake that is otherwise
  /// invisible (one wall hidden exactly under another) obvious enough to fix.
  drawWallClashes(room) {
    const clashes = P.overlappingWallAreas(room);
    if (clashes.length === 0) return;
    const ctx = this.ctx;
    ctx.save();
    for (const c of clashes) {
      const r = this.rect({ minX: c.x, maxX: c.x + c.w, minZ: c.z, maxZ: c.z + c.l });
      ctx.fillStyle = CLASH_FILL;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = CLASH_EDGE;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, Math.max(r.w - 1, 0), Math.max(r.h - 1, 0));
      ctx.setLineDash([]);
    }
    ctx.restore();
  },

  /// The rooms picked out by the Rooms tool, plus the box being dragged.
  /// Each selected room is shaded and captioned with the measurement that
  /// matters for evening them out — its width along the row.
  drawRoomSelection() {
    const ctx = this.ctx;
    if (this.drag && this.drag.type === "roomSelect") {
      const r = this.rect({
        minX: Math.min(this.drag.anchor.x, this.drag.current.x),
        maxX: Math.max(this.drag.anchor.x, this.drag.current.x),
        minZ: Math.min(this.drag.anchor.z, this.drag.current.z),
        maxZ: Math.max(this.drag.anchor.z, this.drag.current.z),
      });
      ctx.fillStyle = "rgba(61, 139, 253, 0.12)";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = "#3d8bfd";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      ctx.setLineDash([]);
    }
    if (store.tool !== "rooms" || !store.roomSelection) return;

    const rooms = store.selectedRooms();
    ctx.save();
    for (const region of rooms) {
      for (const piece of region.rects) {
        const r = this.rect({
          minX: piece.x, maxX: piece.x + piece.w,
          minZ: piece.z, maxZ: piece.z + piece.l,
        });
        ctx.fillStyle = "rgba(61, 139, 253, 0.22)";
        ctx.fillRect(r.x, r.y, r.w, r.h);
      }
    }
    // One outline and one size per room, on top of the shading.
    ctx.strokeStyle = "#6fb3ff";
    ctx.lineWidth = 2;
    ctx.font = "600 11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const region of rooms) {
      const b = region.bounds;
      const r = this.rect({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ });
      ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      if (r.w < 34 || r.h < 18) continue;
      const across = P.cm(b.maxX - b.minX) + " × " + P.cm(b.maxZ - b.minZ);
      const tw = ctx.measureText(across).width;
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      ctx.fillStyle = "rgba(10, 22, 40, 0.85)";
      ctx.fillRect(cx - tw / 2 - 5, cy - 9, tw + 10, 18);
      ctx.fillStyle = "#cfe6ff";
      ctx.fillText(across, cx, cy);
    }
    ctx.restore();
  },

  drawGrid(room) {
    const ctx = this.ctx;
    const scale = this.scale;
    const minorStep = P.GRID_STEPS[room.grid].meters;
    const drawMinor = minorStep * scale >= 3;
    const x0 = this.origin.x;
    const y0 = this.origin.y;
    const { width, length } = P.canvasOf(room);
    const w = width * scale;
    const h = length * scale;

    ctx.lineWidth = 1;
    if (drawMinor) {
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.beginPath();
      for (let x = 0; x <= width + 0.0001; x += minorStep) {
        const px = x0 + x * scale;
        ctx.moveTo(px, y0);
        ctx.lineTo(px, y0 + h);
      }
      for (let z = 0; z <= length + 0.0001; z += minorStep) {
        const py = y0 + z * scale;
        ctx.moveTo(x0, py);
        ctx.lineTo(x0 + w, py);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,255,255,0.13)";
    ctx.beginPath();
    for (let x = 0; x <= width + 0.0001; x += 0.1) {
      const px = x0 + x * scale;
      ctx.moveTo(px, y0);
      ctx.lineTo(px, y0 + h);
    }
    for (let z = 0; z <= length + 0.0001; z += 0.1) {
      const py = y0 + z * scale;
      ctx.moveTo(x0, py);
      ctx.lineTo(x0 + w, py);
    }
    ctx.stroke();
  },

  drawWall(wall, selected) {
    const ctx = this.ctx;
    const room = store.room;
    const thickness = selected ? 9 : 7;
    // Outer walls are held still, and look it: light brown rather than the blue
    // of a wall you can move. Unlocking one returns it to the normal colour, so
    // the plan shows at a glance which parts of the shell are in play.
    const locked = this._lockedWalls && this._lockedWalls.has(wall.id);
    const color = selected
      ? (locked ? "#e0b877" : "#2ecc40")
      : (locked ? "#c8a06a" : "#4a90e2");

    const doorSpans = room.doors
      .filter(d => d.wallID === wall.id)
      .map(d => ({ from: d.offset, to: d.offset + d.width }));
    const windowSpans = room.windows
      .filter(w => w.wallID === wall.id)
      .map(w => ({ from: w.offset, to: w.offset + w.width }));
    const solid = P.solidSpans(P.wallLength(wall), [...doorSpans, ...windowSpans]);

    ctx.strokeStyle = color;
    ctx.lineWidth = thickness;
    ctx.lineCap = "round";
    for (const span of solid) {
      const a = this.screen(P.wallPointAt(wall, span.from));
      const b = this.screen(P.wallPointAt(wall, span.to));
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    for (const door of room.doors.filter(d => d.wallID === wall.id)) {
      this.drawDoor(wall, door);
    }
    for (const win of room.windows.filter(w => w.wallID === wall.id)) {
      this.drawWindow(wall, win, win.id === store.selectedWindowID);
    }
  },

  drawDoor(wall, door) {
    const ctx = this.ctx;
    // The hinge may be at either end of the opening — the plan decides, here it
    // is only drawn. Everything below works from the hinge outwards, so a door
    // turned round draws its arc from the other side without a second case.
    const swingAt = P.doorHinge(wall, door);
    const hinge = this.screen(swingAt.point);
    const end = this.screen(swingAt.far);
    const radius = Math.hypot(end.x - hinge.x, end.y - hinge.y);
    // Screen-space angle along the wall, so the arc swings correctly even
    // when the plan is rotated.
    const angle = Math.atan2(end.y - hinge.y, end.x - hinge.x);
    const swingSign = swingAt.swingSign;
    const swing = angle + swingSign * (Math.PI / 2);
    const color = "#8b5a2b";

    if (door.open) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(hinge.x, hinge.y, radius, angle, swing, swingSign < 0);
      ctx.stroke();

      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(hinge.x, hinge.y);
      ctx.lineTo(hinge.x + Math.cos(swing) * radius, hinge.y + Math.sin(swing) * radius);
      ctx.stroke();
    } else {
      // Closed: the leaf fills the gap.
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(hinge.x, hinge.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(hinge.x, hinge.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  drawWindow(wall, window, selected = false) {
    const ctx = this.ctx;
    const a = this.screen(P.wallPointAt(wall, window.offset));
    const b = this.screen(P.wallPointAt(wall, window.offset + window.width));
    const color = selected ? "#ff3b30" : "#8fc4ec";
    const inner = selected ? "#ff9b94" : "#eaf4fb";
    ctx.strokeStyle = color;
    ctx.lineWidth = selected ? 7 : 5;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.strokeStyle = inner;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
};
