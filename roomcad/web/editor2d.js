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
    this.contextMenu = document.getElementById("context-menu");
    this.measureDrag = null;   // { start, end } while dragging the measure tool
    this.measureResult = null; // last measured { start, end } (stays on screen)
    this.zoomEl = document.getElementById("zoom-level");

    this.attachEvents();
    this.observeSize();
    store.onChange(() => this.requestDraw());
  }

  // MARK: Coordinate helpers

  /// The plan dimensions as seen on screen under the current rotation.
  displaySize() {
    const { width, length } = P.canvasOf(store.room);
    const rotated = store.rotation === 90 || store.rotation === 270;
    return rotated ? { width: length, height: width } : { width, height: length };
  }

  screen(p, rotation = store.rotation) {
    const { width: w, length: l } = P.canvasOf(store.room);
    let dx = p.x;
    let dz = p.z;
    if (rotation === 90) { dx = p.z; dz = w - p.x; }
    else if (rotation === 180) { dx = w - p.x; dz = l - p.z; }
    else if (rotation === 270) { dx = l - p.z; dz = p.x; }
    return { x: this.origin.x + dx * this.scale, y: this.origin.y + dz * this.scale };
  }

  plan(c, rotation = store.rotation) {
    const { width: w, length: l } = P.canvasOf(store.room);
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

  /// Sets an absolute zoom (pixels per metre), anchored at the canvas centre.
  zoomTo(scale) {
    const rect = this.canvas.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const plan = this.plan({ x: cx, y: cy });
    this.scale = P.clamp(scale, 20, 400);
    this.origin = { x: cx - plan.x * this.scale, y: cy - plan.z * this.scale };
    this.draw();
  }

  /// Steps the zoom by a factor, anchored at the canvas centre.
  zoomBy(factor) {
    this.zoomTo(this.scale * factor);
  }

  /// Current zoom as a percentage of the 100 px/m baseline.
  zoomPercent() {
    return Math.round(this.scale);
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
      this.drag = null;
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
  }

  isTyping() {
    const el = document.activeElement;
    return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
  }

  // MARK: Context menu (right-click)

  onContextMenu(e) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const c = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const p = this.plan(c);

    // Only show a menu when there is something to act on under the cursor.
    const furniture = P.furnitureNear(store.room, p);
    const opening = P.openingNear(store.room, p);
    const wall = P.wallNear(store.room, p);
    if (!furniture && !opening && !wall) {
      this.hideContextMenu();
      return;
    }
    store.select(p);
    this.showContextMenu(e.clientX, e.clientY);
  }

  showContextMenu(x, y) {
    if (!this.contextMenu) return;
    const { title, items } = this.contextMenuEntries();
    if (!title) {
      this.hideContextMenu();
      return;
    }

    this.contextMenu.innerHTML = "";
    const head = document.createElement("div");
    head.className = "ctx-title";
    head.textContent = title;
    this.contextMenu.appendChild(head);

    for (const item of items) {
      const button = document.createElement("button");
      button.textContent = item.label;
      if (item.danger) button.className = "danger";
      button.addEventListener("click", () => this.runContextMenuAction(item.action));
      this.contextMenu.appendChild(button);
    }

    this.contextMenu.hidden = false;
    const rect = this.contextMenu.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(x, window.innerWidth - rect.width - margin);
    const top = Math.min(y, window.innerHeight - rect.height - margin);
    this.contextMenu.style.left = Math.max(margin, left) + "px";
    this.contextMenu.style.top = Math.max(margin, top) + "px";
  }

  hideContextMenu() {
    if (this.contextMenu) this.contextMenu.hidden = true;
  }

  contextMenuEntries() {
    let title = "";
    const items = [];
    if (store.selectedFurnitureID) {
      const item = store.selectedFurniture();
      if (!item) return { title, items };
      const kind = P.FURNITURE_KINDS[item.kind];
      title = kind.title;
      if (kind.category !== "fixture") {
        items.push({ label: "Turn 90°", action: "turn" });
      }
      items.push({ label: "Delete " + kind.title.toLowerCase(), danger: true, action: "delete" });
    } else if (store.selectedDoorID) {
      const door = store.selectedDoor();
      title = "Door";
      if (door) items.push({ label: door.open ? "Close door" : "Open door", action: "toggle-open" });
      items.push({ label: "Delete door", danger: true, action: "delete" });
    } else if (store.selectedWindowID) {
      title = "Window";
      items.push({ label: "Delete window", danger: true, action: "delete" });
    } else if (store.selectedWallID) {
      title = "Wall";
      items.push({ label: "Delete wall", danger: true, action: "delete" });
    }
    return { title, items };
  }

  runContextMenuAction(action) {
    switch (action) {
      case "turn":
        store.rotateSelectedFurniture();
        break;
      case "toggle-open": {
        const id = store.selectedDoorID;
        if (id) store.toggleDoorOpen(id);
        break;
      }
      case "delete":
        store.deleteSelection();
        break;
    }
    this.hideContextMenu();
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
      case "measure":
        this.measureDrag = { start: p, end: p };
        this.drag = { type: "measure" };
        break;
      default:
        // click tools resolve on pointerup
        this.drag = { type: "click" };
    }
    this.pointerMoved = false;
  }

  beginSelectDrag(p) {
    const furniture = P.furnitureNear(store.room, p);
    if (furniture) {
      store.clearSelection();
      store.selectedFurnitureID = furniture.id;
      store.refreshFurnitureGaps(furniture.id);
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
      // Select the wall so it turns green and its length shows while resizing.
      store.clearSelection();
      store.selectedWallID = wall.id;
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
        case "measure":
          if (this.measureDrag) this.measureDrag.end = p;
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
      case "measure":
        this.measureResult = this.measureDrag
          ? { start: this.measureDrag.start, end: this.measureDrag.end }
          : null;
        this.measureDrag = null;
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

    // Canvas base plate (2D-only), larger than the main room.
    const canvasBounds = P.canvasOf(room);
    const plate = this.rect({ minX: 0, maxX: canvasBounds.width, minZ: 0, maxZ: canvasBounds.length });
    ctx.fillStyle = "#141218";
    ctx.fillRect(plate.x, plate.y, plate.w, plate.h);
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    ctx.strokeRect(plate.x + 0.5, plate.y + 0.5, plate.w - 1, plate.h - 1);

    // Main room floor, drawn on top of the plate.
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

    this.drawSelectedWallLength();

    const measured = this.activeOpening();
    if (measured) {
      this.drawOpeningMeasurements(measured.kind, measured.id);
    }

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

    if (store.tool === "wall" && this.hover) {
      this.drawSnapDot(P.snapPoint(room, this.hover));
    }

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

    // Keep the zoom readout in sync.
    if (this.zoomEl) this.zoomEl.textContent = this.zoomPercent() + "%";
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
  }

  drawWall(wall, selected) {
    const ctx = this.ctx;
    const room = store.room;
    const thickness = selected ? 9 : 7;
    const color = selected ? "#2ecc40" : "#4a90e2";

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
  }

  drawWindow(wall, span) {
    const ctx = this.ctx;
    const a = this.screen(P.wallPointAt(wall, span.from));
    const b = this.screen(P.wallPointAt(wall, span.to));
    ctx.strokeStyle = "#8fc4ec";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.strokeStyle = "#eaf4fb";
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
  }

  /// Shows the length of the selected wall (or the wall being resized) so the
  /// current measurement in centimetres is always visible.
  drawSelectedWallLength() {
    const wall = store.selectedWall();
    if (!wall) return;
    const mid = P.wallMidpoint(wall);
    const perp = P.wallPerp(wall);
    const at = this.screen({ x: mid.x + perp.x * 0.5, z: mid.z + perp.z * 0.5 });
    this.drawChip(Math.round(P.wallLength(wall) * 100), at);
  }

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
  }

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
  }

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
  }

  furnitureState(item, selected) {
    if (store.furnitureFeedback && store.furnitureFeedback.id === item.id) {
      return store.furnitureFeedback.state; // "valid" | "invalid"
    }
    return selected ? "selected" : "default";
  }

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
  }

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
  }

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

    if (item.kind === "wardrobe") {
      // Two door knobs mark the front edge.
      const t = 0.22;
      ctx.fillStyle = color;
      for (const k of [t, 1 - t]) {
        const kx = sa.x + (sb.x - sa.x) * k;
        const ky = sa.y + (sb.y - sa.y) * k;
        ctx.beginPath();
        ctx.arc(kx, ky, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // Backrest (chair) / pillow side (bed): a thick band along the edge.
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(sa.x, sa.y);
      ctx.lineTo(sb.x, sb.y);
      ctx.stroke();
    }
  }

  /// Which footprint edge holds the special feature for the current rotation.
  featureDirection(item) {
    const r = ((item.rotationDegrees % 360) + 360) % 360;
    const idx = r / 90;
    if (item.kind === "chair") {
      // Backrest sits on the +D side.
      return ["bottom", "left", "top", "right"][idx];
    }
    // Bed pillows and wardrobe doors/knobs sit on the -D side.
    return ["top", "right", "bottom", "left"][idx];
  }

  drawFixture(rect, state, kind) {
    const ctx = this.ctx;
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    const base = `rgb(${kind.color.map(c => Math.round(c * 255)).join(",")})`;
    const c = this.furnitureColors(state);
    const glow = state === "invalid" ? "rgba(255,59,48,0.22)"
      : state === "valid" ? "rgba(57,255,20,0.22)"
      : state === "selected" ? "rgba(47,125,225,0.22)"
      : "rgba(255,228,140,0.16)";
    const body = state === "invalid" ? "rgba(255,59,48,0.4)"
      : state === "valid" ? "rgba(57,255,20,0.4)"
      : state === "selected" ? "rgba(47,125,225,0.4)"
      : base + "30";

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
