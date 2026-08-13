// editor2d.js — the 2D plan canvas: rendering, tools, zoom/pan, cm readouts.

import * as P from "./plan.js";
import { store } from "./store.js";

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

    this.attachEvents();
    this.observeSize();
    store.onChange(() => this.requestDraw());
  }

  // MARK: Coordinate helpers

  /// The plan dimensions as seen on screen under the current rotation.
  displaySize() {
    const { width, length } = store.room;
    const rotated = store.rotation === 90 || store.rotation === 270;
    return rotated ? { width: length, height: width } : { width, height: length };
  }

  screen(p, rotation = store.rotation) {
    const w = store.room.width;
    const l = store.room.length;
    let dx = p.x;
    let dz = p.z;
    if (rotation === 90) { dx = p.z; dz = w - p.x; }
    else if (rotation === 180) { dx = w - p.x; dz = l - p.z; }
    else if (rotation === 270) { dx = l - p.z; dz = p.x; }
    return { x: this.origin.x + dx * this.scale, y: this.origin.y + dz * this.scale };
  }

  plan(c, rotation = store.rotation) {
    const w = store.room.width;
    const l = store.room.length;
    const px = (c.x - this.origin.x) / this.scale;
    const pz = (c.y - this.origin.y) / this.scale;
    if (rotation === 90) return { x: w - pz, z: px };
    if (rotation === 180) return { x: w - px, z: l - pz };
    if (rotation === 270) return { x: pz, z: l - px };
    return { x: px, z: pz };
  }

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
  }

  fit() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return;
    const size = this.displaySize();
    const padding = 70;
    const s = Math.min(
      (rect.width - padding) / size.width,
      (rect.height - padding) / size.height
    );
    this.scale = P.clamp(s, 20, 400);
    this.origin = {
      x: (rect.width - size.width * this.scale) / 2,
      y: (rect.height - size.height * this.scale) / 2,
    };
    this.didFit = true;
    this.draw();
  }

  zoomAt(factor, cx, cy) {
    const newScale = P.clamp(this.scale * factor, 20, 400);
    if (Math.abs(newScale - this.scale) < 0.0001) return;
    const plan = this.plan({ x: cx, y: cy });
    this.scale = newScale;
    this.origin = { x: cx - plan.x * this.scale, y: cy - plan.z * this.scale };
    this.draw();
  }

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
  }

  // MARK: Events

  attachEvents() {
    this.canvas.addEventListener("pointerdown", e => this.onPointerDown(e));
    this.canvas.addEventListener("pointermove", e => this.onPointerMove(e));
    this.canvas.addEventListener("pointerup", e => this.onPointerUp(e));
    this.canvas.addEventListener("pointercancel", e => this.onPointerUp(e));
    this.canvas.addEventListener("wheel", e => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * 0.0015);
      this.zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });
    this.canvas.addEventListener("contextmenu", e => e.preventDefault());
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
      }
    });
    window.addEventListener("blur", () => {
      this.spaceDown = false;
      this.canvas.classList.remove("selecting");
      this.drag = null;
      this.pointers.clear();
    });
  }

  isTyping() {
    const el = document.activeElement;
    return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
  }

  onPointerDown(e) {
    if (this.isTyping()) return;
    // Stop the browser's native behaviors — middle-click auto-scroll, text
    // selection, and drag handling — so click-and-hold only does what the
    // active tool does.
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const c = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    this.pointers.set(e.pointerId, { c, moved: false });
    this.pointerStart = c;
    this.pointerMoved = false;

    // Two-finger pinch
    if (this.pointers.size === 2) {
      const pts = [...this.pointers.values()];
      this.pinch = {
        dist: Math.hypot(pts[0].c.x - pts[1].c.x, pts[0].c.y - pts[1].c.y),
        mid: { x: (pts[0].c.x + pts[1].c.x) / 2, y: (pts[0].c.y + pts[1].c.y) / 2 },
        scale: this.scale,
      };
      this.drag = null;
      return;
    }

    if (this.pointers.size > 1) return;

    // Pan with space or middle button
    if (this.spaceDown || e.button === 1) {
      this.drag = { type: "pan" };
      return;
    }

    const p = this.plan(c);
    switch (store.tool) {
      case "select":
        this.drag = this.beginSelectDrag(p);
        break;
      case "wall": {
        const anchor = P.snapPoint(store.room, p);
        this.drag = { type: "drawWall", anchor, current: anchor };
        break;
      }
      default:
        // click tools resolve on pointerup
        this.drag = { type: "click" };
    }
    this.pointerMoved = false;
  }

  beginSelectDrag(p) {
    const furniture = P.furnitureNear(store.room, p);
    if (furniture) {
      store.beginDrag();
      return { type: "moveFurniture", id: furniture.id };
    }
    const opening = P.openingNear(store.room, p);
    if (opening) {
      store.beginDrag();
      return { type: "slideOpening", kind: opening.kind, id: opening.id };
    }
    const wall = P.wallNear(store.room, p);
    if (wall) {
      store.beginDrag();
      const startDist = P.distance(wall.start, p);
      const endDist = P.distance(wall.end, p);
      if (Math.min(startDist, endDist) <= 0.18) {
        return { type: "wallEndpoint", id: wall.id, part: startDist <= endDist ? "start" : "end" };
      }
      return { type: "moveWall", id: wall.id };
    }
    return { type: "click" };
  }

  onPointerMove(e) {
    // Keep suppressing native autoscroll while a drag is in progress.
    if (e.buttons > 0) e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const c = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const entry = this.pointers.get(e.pointerId);
    if (entry) {
      if (Math.hypot(c.x - entry.c.x, c.y - entry.c.y) > 2) entry.moved = true;
      entry.c = c;
    }
    this.hover = this.plan(c);
    this.pointerMoved = this.pointerMoved || (this.pointerStart && Math.hypot(c.x - this.pointerStart.x, c.y - this.pointerStart.y) > 4);

    // Pinch zoom
    if (this.pinch && this.pointers.size === 2) {
      const pts = [...this.pointers.values()];
      const dist = Math.hypot(pts[0].c.x - pts[1].c.x, pts[0].c.y - pts[1].c.y);
      if (this.pinch.dist > 0) {
        const factor = dist / this.pinch.dist;
        const mid = { x: (pts[0].c.x + pts[1].c.x) / 2, y: (pts[0].c.y + pts[1].c.y) / 2 };
        const newScale = P.clamp(this.pinch.scale * factor, 20, 400);
        const plan = this.plan({ x: mid.x, y: mid.y });
        this.scale = newScale;
        this.origin = { x: mid.x - plan.x * this.scale, y: mid.y - plan.z * this.scale };
      }
      this.draw();
      return;
    }
    if (this.pinch && this.pointers.size < 2) {
      this.pinch = null;
    }

    // Left-click-and-hold on empty space pans the view: once the pointer has
    // actually moved, a pending "click" becomes a pan (Wall keeps drawing).
    if (this.drag && this.drag.type === "click" && this.pointerMoved) {
      this.drag = { type: "pan" };
    }

    const p = this.plan(c);
    if (this.drag) {
      switch (this.drag.type) {
        case "pan":
          this.canvas.style.cursor = "grabbing";
          this.origin.x += e.movementX;
          this.origin.y += e.movementY;
          break;
        case "drawWall":
          this.drag.current = P.snapWallEnd(store.room, p, this.drag.anchor);
          break;
        case "moveFurniture":
          store.moveFurniture(this.drag.id, p);
          break;
        case "slideOpening":
          store.slideOpening(this.drag.kind, this.drag.id, p);
          break;
        case "wallEndpoint":
          store.updateWallEndpoint(this.drag.id, this.drag.part, p);
          break;
        case "moveWall":
          if (this.lastPlan) {
            store.moveWall(this.drag.id, p.x - this.lastPlan.x, p.z - this.lastPlan.z);
          }
          break;
      }
    }
    this.lastPlan = p;
    this.draw();
  }

  onPointerUp(e) {
    const rect = this.canvas.getBoundingClientRect();
    const c = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    this.pointers.delete(e.pointerId);
    if (this.pinch && this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size > 0) return;

    const p = this.plan(c);
    const moved = this.pointerMoved;
    const drag = this.drag;
    this.drag = null;
    this.lastPlan = null;
    this.pointerStart = null;
    this.pointerMoved = false;
    this.canvas.style.cursor = "";

    if (!drag) return;
    switch (drag.type) {
      case "pan":
        break;
      case "click":
        switch (store.tool) {
          case "door":
            store.placeOpening("door", p);
            break;
          case "window":
            store.placeOpening("window", p);
            break;
          case "furniture":
            if (store.pendingFurnitureKind) store.placeFurniture(store.pendingFurnitureKind, p);
            break;
          case "erase":
            store.erase(p);
            break;
          case "select":
            store.select(p);
            break;
        }
        break;
      case "drawWall":
        if (P.distance(drag.anchor, drag.current) >= P.MIN_WALL_LENGTH) {
          store.addWall(drag.anchor, drag.current);
        } else {
          store.status = "Walls need to be at least 30 cm long";
          store.emit();
        }
        break;
      case "moveFurniture":
        if (moved) store.endDrag("Moved furniture");
        else {
          store.discardDrag();
          store.select(p);
        }
        break;
      case "slideOpening":
        if (moved) store.endDrag(drag.kind === "door" ? "Slid door" : "Slid window");
        else {
          store.discardDrag();
          store.select(p);
        }
        break;
      case "wallEndpoint":
        if (moved) store.endDrag("Reshaped wall");
        else store.discardDrag();
        break;
      case "moveWall":
        if (moved) store.endDrag("Moved wall");
        else store.discardDrag();
        break;
    }
    this.draw();
  }

  // MARK: Drawing

  requestDraw() {
    this.draw();
  }

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

    // Floor
    const floor = this.rect({ minX: 0, maxX: room.width, minZ: 0, maxZ: room.length });
    ctx.fillStyle = "#1b1916";
    ctx.fillRect(floor.x, floor.y, floor.w, floor.h);

    this.drawGrid(room);

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

    for (const wall of room.walls) {
      this.drawWall(wall, wall.id === store.selectedWallID);
    }

    const measured = this.activeOpening();
    if (measured) {
      this.drawOpeningMeasurements(measured.kind, measured.id);
    }

    for (const item of room.furniture) {
      this.drawFurniture(item, item.id === store.selectedFurnitureID);
    }

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

    if (store.tool === "wall" && this.hover) {
      this.drawSnapDot(P.snapPoint(room, this.hover));
    }
  }

  activeOpening() {
    if (this.drag && this.drag.type === "slideOpening") {
      return { kind: this.drag.kind, id: this.drag.id };
    }
    if (store.selectedDoorID) return { kind: "door", id: store.selectedDoorID };
    if (store.selectedWindowID) return { kind: "window", id: store.selectedWindowID };
    return null;
  }

  drawGrid(room) {
    const ctx = this.ctx;
    const scale = this.scale;
    const minorStep = P.GRID_STEPS[room.grid].meters;
    const drawMinor = minorStep * scale >= 3;
    const x0 = this.origin.x;
    const y0 = this.origin.y;
    const w = room.width * scale;
    const h = room.length * scale;

    ctx.lineWidth = 1;
    if (drawMinor) {
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.beginPath();
      for (let x = 0; x <= room.width + 0.0001; x += minorStep) {
        const px = x0 + x * scale;
        ctx.moveTo(px, y0);
        ctx.lineTo(px, y0 + h);
      }
      for (let z = 0; z <= room.length + 0.0001; z += minorStep) {
        const py = y0 + z * scale;
        ctx.moveTo(x0, py);
        ctx.lineTo(x0 + w, py);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,255,255,0.13)";
    ctx.beginPath();
    for (let x = 0; x <= room.width + 0.0001; x += 0.1) {
      const px = x0 + x * scale;
      ctx.moveTo(px, y0);
      ctx.lineTo(px, y0 + h);
    }
    for (let z = 0; z <= room.length + 0.0001; z += 0.1) {
      const py = y0 + z * scale;
      ctx.moveTo(x0, py);
      ctx.lineTo(x0 + w, py);
    }
    ctx.stroke();
  }

  drawWall(wall, selected) {
    const ctx = this.ctx;
    const room = store.room;
    const thickness = selected ? 9 : 7;
    const color = selected ? "#3d8bfd" : "#c9cbd2";

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
    for (const span of windowSpans) this.drawWindow(wall, span);
  }

  drawDoor(wall, door) {
    const ctx = this.ctx;
    const hinge = this.screen(P.wallPointAt(wall, door.offset));
    const end = this.screen(P.wallPointAt(wall, door.offset + door.width));
    const radius = Math.hypot(end.x - hinge.x, end.y - hinge.y);
    // Screen-space angle along the wall, so the arc swings correctly even
    // when the plan is rotated.
    const angle = Math.atan2(end.y - hinge.y, end.x - hinge.x);
    const swingSign = door.swingInside ? 1 : -1;
    const swing = angle + swingSign * (Math.PI / 2);
    const color = "#b08860";

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
  }

  drawWindow(wall, span) {
    const ctx = this.ctx;
    const a = this.screen(P.wallPointAt(wall, span.from));
    const b = this.screen(P.wallPointAt(wall, span.to));
    ctx.strokeStyle = "#5a9fd6";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.strokeStyle = "#cfd2d8";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

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
    this.drawChip(Math.round(offset * 100), labelPoint(offset / 2, 0.5));
    this.drawChip(Math.round(width * 100), labelPoint(offset + width / 2, 0.5));
    this.drawChip(Math.round(toEnd * 100), labelPoint(offset + width + toEnd / 2, 0.5));
    if (spacing.gapToPrevious !== null) {
      this.drawChip(Math.round(spacing.gapToPrevious * 100), labelPoint(offset - spacing.gapToPrevious / 2, 0.5));
    }
    if (spacing.gapToNext !== null) {
      this.drawChip(Math.round(spacing.gapToNext * 100), labelPoint(offset + width + spacing.gapToNext / 2, 0.5));
    }
  }

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
  }

  drawFurniture(item, selected) {
    const ctx = this.ctx;
    const rect = this.rect(P.furnitureFootprint(item));
    const kind = P.FURNITURE_KINDS[item.kind];
    const base = `rgb(${kind.color.map(c => Math.round(c * 255)).join(",")})`;

    if (kind.category === "fixture") {
      this.drawFixture(rect, selected, kind, base);
      return;
    }

    this.roundRect(rect.x, rect.y, rect.w, rect.h, 6);
    ctx.fillStyle = selected ? "rgba(47,125,225,0.35)" : base + "2e";
    ctx.fill();
    ctx.strokeStyle = selected ? "#2f7de1" : base;
    ctx.lineWidth = selected ? 3 : 2;
    ctx.stroke();

    ctx.font = "600 10px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = selected ? "#3d8bfd" : "#e8e8ea";
    ctx.fillText(kind.label, rect.x + rect.w / 2, rect.y + rect.h / 2);

    // Front indicator
    ctx.strokeStyle = base + "cc";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(rect.x + rect.w / 2, rect.y + rect.h / 2);
    ctx.lineTo(rect.x + rect.w / 2, rect.y + Math.max(6, Math.min(14, rect.h * 0.25)));
    ctx.stroke();
  }

  drawFixture(rect, selected, kind, base) {
    const ctx = this.ctx;
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    const r = Math.max(5, Math.min(rect.w, rect.h) / 2);

    // Soft glow, as if the ceiling lamp is lit.
    ctx.fillStyle = selected ? "rgba(47,125,225,0.22)" : "rgba(255,228,140,0.16)";
    ctx.beginPath();
    ctx.arc(cx, cy, r + 5, 0, Math.PI * 2);
    ctx.fill();

    // Lamp body.
    ctx.fillStyle = selected ? "rgba(47,125,225,0.4)" : base + "30";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = selected ? "#2f7de1" : base;
    ctx.lineWidth = selected ? 3 : 2;
    ctx.stroke();

    // Bulb.
    ctx.fillStyle = "#fff6d8";
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.34, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = "600 9px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = selected ? "#3d8bfd" : "#e8e8ea";
    ctx.fillText(kind.label, cx, cy + r + 3);
  }

  drawFurnitureGhost(kind, raw) {
    const ctx = this.ctx;
    const item = { kind, center: P.point(raw.x, raw.z), rotationDegrees: 0 };
    item.center = P.furnitureCenter(store.room, raw, item);
    const valid = P.isFurniturePlacementValid(store.room, item);
    const rect = this.rect(P.furnitureFootprint(item));
    const k = P.FURNITURE_KINDS[kind];
    const color = valid ? "#34c759" : "#ff3b30";
    if (k.category === "fixture") {
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      const r = Math.max(5, Math.min(rect.w, rect.h) / 2);
      ctx.fillStyle = valid ? "rgba(52,199,89,0.22)" : "rgba(255,59,48,0.22)";
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
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
  }

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
  }

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
}
