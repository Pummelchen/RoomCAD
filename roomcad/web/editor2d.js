// editor2d.js — the 2D plan canvas: rendering, tools, zoom/pan, cm readouts.

import * as P from "./plan.js";
import { store } from "./store.js";

// Grab handles are drawn at a constant on-screen size, whatever the zoom.
const HANDLE_RADIUS_PX = 5;
const HANDLE_COLOR = "#ff3b30";
const HANDLE_STROKE = "#ffffff";
// CAD-style dimension lines.
const DIM_COLOR = "rgba(226, 232, 240, 0.62)";
const DIM_TEXT = "rgba(240, 245, 252, 0.95)";
const DIM_OFFSET_PX = 16;   // how far the dimension line sits off the element
const DIM_TICK_PX = 4;
// Room area captions.
const CAPTION_PX = 12;
const CAPTION_COLOR = "rgba(226, 236, 248, 0.78)";
// Where two walls sit on top of each other.
const CLASH_FILL = "rgba(255, 214, 0, 0.42)";
const CLASH_EDGE = "#ffd600";

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
  }

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
  }

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
  }

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
  }

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

  /// Steps the zoom by a fixed number of percentage points (e.g. ±10).
  zoomStep(delta) {
    this.zoomTo(this.scale + delta);
  }

  /// Current zoom as a percentage of the 100 px/m baseline.
  zoomPercent() {
    return Math.round(this.scale);
  }

  /// Double-clicking the zoom readout opens an inline number input (no "%").
  beginZoomEdit() {
    if (this.zoomEditing) return;
    this.zoomEditing = true;
    this.zoomEl.innerHTML = `<input type="number" id="zoom-input" value="${this.zoomPercent()}" min="20" max="400" step="5">`;
    const input = this.zoomEl.querySelector("input");
    input.focus();
    input.select();
    const finish = () => {
      const v = Math.round(Number(input.value));
      if (!isNaN(v)) this.zoomTo(v);
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
    const hit = P.labelNear(store.room, p)
      || P.furnitureNear(store.room, p)
      || P.openingNear(store.room, p)
      || P.wallNear(store.room, p)
      || P.publicAreaAt(store.room, p);
    if (!hit) {
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
      if (!item.action) {
        const note = document.createElement("div");
        note.className = "ctx-note";
        note.textContent = item.label;
        this.contextMenu.appendChild(note);
        continue;
      }
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
    if (store.selectedLabelID) {
      title = "Label";
      items.push({ label: "Turn 90°", action: "turn-label" });
      items.push({ label: "Delete label", danger: true, action: "delete" });
    } else if (store.selectedPublicID) {
      const area = store.selectedPublicArea();
      title = "Public area";
      if (area) items.push({ label: P.cm(area.w) + " × " + P.cm(area.l), action: null });
      items.push({ label: "Delete public area", danger: true, action: "delete" });
    } else if (store.selectedFurnitureID) {
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
      const wall = store.selectedWall();
      const outer = wall && P.outsideFacingWalls(store.room).has(wall.id);
      title = outer ? "Outside wall" : "Wall";
      if (wall) items.push({ label: P.cm(P.wallLength(wall)), action: null });
      if (outer) {
        items.push(wall.dragUnlocked
          ? { label: "Lock Drag", action: "lock-wall" }
          : { label: "Unlock Drag", action: "unlock-wall" });
      }
      items.push({ label: "Delete wall", danger: true, action: "delete" });
    }
    return { title, items };
  }

  runContextMenuAction(action) {
    switch (action) {
      case "turn":
        store.rotateSelectedFurniture();
        break;
      case "turn-label":
        store.rotateSelectedLabel();
        break;
      case "toggle-open": {
        const id = store.selectedDoorID;
        if (id) store.toggleDoorOpen(id);
        break;
      }
      case "unlock-wall":
        if (store.selectedWallID) store.setWallDragUnlocked(store.selectedWallID, true);
        break;
      case "lock-wall":
        if (store.selectedWallID) store.setWallDragUnlocked(store.selectedWallID, false);
        break;
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

    // Right button belongs to the context menu. Without this, right-clicking
    // with a drawing tool active also started (and immediately committed) a
    // zero-sized drag.
    if (e.button !== 0) {
      this.drag = null;
      return;
    }

    const p = this.plan(c);
    // Clicking anything at all — selecting, drawing, erasing — answers a new
    // question, so the previous measurement stops being relevant.
    if (store.tool !== "measure") this.clearMeasurement();
    switch (store.tool) {
      case "select":
        this.drag = this.beginSelectDrag(p);
        break;
      case "wall": {
        if (!P.canStartWallAt(store.room, p)) {
          // Out in the empty grid a new wall would stand alone, joined to
          // nothing. Hold and drag to pan the view instead; a plain click
          // falls back to Select, which is what was almost certainly meant.
          this.drag = { type: "wallOutside" };
          break;
        }
        const anchor = P.snapPoint(store.room, p);
        this.drag = { type: "drawWall", anchor, current: anchor };
        break;
      }
      case "public":
        this.drag = { type: "publicArea", anchor: p, current: p };
        break;
      case "rooms":
        this.drag = { type: "roomSelect", anchor: p, current: p };
        break;
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

  /// Plan-space radius of a grab handle at the current zoom. Handles have to
  /// stay the same size on screen, so the tolerance shrinks as you zoom in.
  handleTolerance() {
    return HANDLE_RADIUS_PX * 1.6 / this.scale;
  }

  /// The grab handle under `p`, if any. Handles belong to whatever is selected,
  /// so they never steal a click from an unselected object underneath.
  handleAt(p) {
    const tol = this.handleTolerance();
    const room = store.room;

    const openingKind = store.selectedOpeningKind();
    if (openingKind) {
      const id = openingKind === "door" ? store.selectedDoorID : store.selectedWindowID;
      const ends = P.openingEndpoints(room, openingKind, id);
      if (ends) {
        if (P.distance(ends.start, p) <= tol) return { kind: "openingEnd", openingKind, id, which: "start" };
        if (P.distance(ends.end, p) <= tol) return { kind: "openingEnd", openingKind, id, which: "end" };
      }
    }

    const wall = store.selectedWall();
    // A wall that cannot move offers no grab handles; showing them would invite
    // a drag that is then refused.
    if (wall && !this.wallHeld(wall)) {
      if (P.distance(wall.start, p) <= tol) return { kind: "wallEnd", id: wall.id, part: "start" };
      if (P.distance(wall.end, p) <= tol) return { kind: "wallEnd", id: wall.id, part: "end" };
    }

    const area = store.selectedPublicArea();
    if (area) {
      for (const c of P.publicAreaCorners(area)) {
        if (P.distance(c, p) <= tol) return { kind: "publicCorner", id: area.id, corner: c.corner };
      }
    }
    return null;
  }

  beginSelectDrag(p) {
    // A handle on the current selection always wins.
    const handle = this.handleAt(p);
    if (handle) {
      store.beginDrag();
      if (handle.kind === "openingEnd") {
        return { type: "openingEnd", kind: handle.openingKind, id: handle.id, which: handle.which };
      }
      if (handle.kind === "wallEnd") {
        return { type: "wallEndpoint", id: handle.id, part: handle.part };
      }
      return { type: "publicCorner", id: handle.id, corner: handle.corner };
    }

    const label = P.labelNear(store.room, p);
    if (label) {
      store.clearSelection();
      store.selectedLabelID = label.id;
      store.beginDrag();
      return { type: "moveLabel", id: label.id };
    }

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
      if (this.wallHeld(wall)) {
        // Select it and say how to free it, rather than moving the footprint of
        // the building because someone meant to grab the wall behind it.
        store.status = "Outside wall is fixed — right-click it to free it, "
          + "or switch Outside walls to Free in the panel";
        store.emit();
        return { type: "click" };
      }
      store.beginDrag();
      const startDist = P.distance(wall.start, p);
      const endDist = P.distance(wall.end, p);
      if (Math.min(startDist, endDist) <= 0.18) {
        return { type: "wallEndpoint", id: wall.id, part: startDist <= endDist ? "start" : "end" };
      }
      return { type: "moveWall", id: wall.id };
    }
    const area = P.publicAreaAt(store.room, p);
    if (area) {
      store.clearSelection();
      store.selectedPublicID = area.id;
      store.beginDrag();
      return { type: "movePublic", id: area.id };
    }
    return { type: "click" };
  }

  onPointerMove(e) {
    // Keep suppressing native autoscroll while a drag is in progress.
    if (e.buttons > 0) e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const c = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const entry = this.pointers.get(e.pointerId);
    const previous = entry ? entry.c : null;   // where this pointer was last seen
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
      this.requestDraw();
      return;
    }
    if (this.pinch && this.pointers.size < 2) {
      this.pinch = null;
    }

    // Left-click-and-hold on empty space pans the view: once the pointer has
    // actually moved, a pending "click" becomes a pan (Wall keeps drawing).
    if (this.drag && (this.drag.type === "click" || this.drag.type === "wallOutside")
      && this.pointerMoved) {
      this.drag = { type: "pan" };
    }

    const p = this.plan(c);
    if (this.drag) {
      switch (this.drag.type) {
        case "pan": {
          this.canvas.style.cursor = "grabbing";
          // Pan by how far the pointer actually travelled since we last saw it.
          // movementX/movementY look like the obvious source, but they are
          // optional on a pointer event, and one event without them turns the
          // origin into NaN — from which no amount of further dragging
          // recovers, because NaN propagates. The plan simply disappears until
          // the page is reloaded. The previous position is already tracked
          // here, so the delta is computed from that instead.
          const dx = previous ? c.x - previous.x : (Number.isFinite(e.movementX) ? e.movementX : 0);
          const dy = previous ? c.y - previous.y : (Number.isFinite(e.movementY) ? e.movementY : 0);
          this.origin.x += dx;
          this.origin.y += dy;
          break;
        }
        case "drawWall":
          this.drag.current = P.snapWallEnd(store.room, p, this.drag.anchor);
          break;
        case "publicArea":
        case "roomSelect":
          this.drag.current = p;
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
        case "openingEnd":
          store.dragOpeningEnd(this.drag.kind, this.drag.id, this.drag.which, p);
          break;
        case "publicCorner":
          store.resizePublicArea(this.drag.id, this.drag.corner, p);
          break;
        case "movePublic":
          if (this.lastPlan) {
            store.movePublicArea(this.drag.id, p.x - this.lastPlan.x, p.z - this.lastPlan.z);
          }
          break;
        case "moveLabel":
          store.moveLabel(this.drag.id, p);
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
    this.requestDraw();
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
          case "label":
            store.placeLabel(p);
            break;
          case "select":
            store.select(p);
            break;
        }
        break;
      case "wallOutside":
        store.chooseTool("select");
        store.status = "Start walls on the building — drag out here to move the view";
        store.emit();
        break;
      case "drawWall":
        if (P.distance(drag.anchor, drag.current) >= P.MIN_WALL_LENGTH) {
          store.addWall(drag.anchor, drag.current);
        } else {
          store.status = "Walls need to be at least 30 cm long";
          store.emit();
        }
        break;
      case "roomSelect":
        store.setRoomSelection({
          x1: drag.anchor.x, z1: drag.anchor.z,
          x2: drag.current.x, z2: drag.current.z,
        });
        break;
      case "publicArea":
        store.markPublicArea({
          x1: drag.anchor.x, z1: drag.anchor.z,
          x2: drag.current.x, z2: drag.current.z,
        });
        break;
      case "moveFurniture": {
        // Read the verdict before endDrag clears it.
        const clashes = store.furnitureFeedback
          && store.furnitureFeedback.id === drag.id
          && store.furnitureFeedback.state === "invalid";
        if (moved) store.endDrag(clashes ? "Moved furniture — it overlaps here" : "Moved furniture");
        else {
          store.discardDrag();
          store.select(p);
        }
        break;
      }
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
      case "openingEnd":
        if (moved) store.endDrag(drag.kind === "door" ? "Resized door" : "Resized window");
        else store.discardDrag();
        break;
      case "publicCorner":
        if (moved) store.endDrag("Resized public area");
        else store.discardDrag();
        break;
      case "movePublic":
        // Put down where it was dropped, then settled — snapped to the grid and
        // to its neighbours, and slid clear of anything it landed on. Only on a
        // real drag: a click is not a move, and settling one would nudge an
        // area the user merely tapped.
        if (moved) {
          store.settleDraggedPublicArea(drag.id);
          store.endDrag("Moved public area");
        }
        else {
          store.discardDrag();
          store.select(p);
        }
        break;
      case "moveLabel":
        if (moved) store.endDrag("Moved label");
        else {
          store.discardDrag();
          store.select(p);
        }
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

    // Main room floor, drawn on top of the plate (centred via the room origin).
    const origin = P.roomOrigin(room);
    const floor = this.rect({ minX: origin.x, maxX: origin.x + room.width, minZ: origin.z, maxZ: origin.z + room.length });
    ctx.fillStyle = "#1b1916";
    ctx.fillRect(floor.x, floor.y, floor.w, floor.h);

    this.drawGrid(room);

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

    // Readouts claim screen space in draw order; the list resets each frame.
    this.dimensionBoxes = [];
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
  }

  activeOpening() {
    if (this.drag && this.drag.type === "slideOpening") {
      return { kind: this.drag.kind, id: this.drag.id };
    }
    if (store.selectedDoorID) return { kind: "door", id: store.selectedDoorID };
    if (store.selectedWindowID) return { kind: "window", id: store.selectedWindowID };
    return null;
  }

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
  }

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
  }

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
  }

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
  }

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
  }

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
  }

  /// Is this wall held still?
  ///
  /// Deferred to the store, which is where the drag itself asks the question.
  /// Working it out here as well is how the handles came to promise a drag that
  /// was then refused: five places asking, two of them with different answers.
  wallHeld(wall) {
    return !!wall && store.wallIsLocked(wall.id);
  }

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
      const c = this.screen({ x: cap.x, z: cap.z });
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
  }

  /// Everything a caption's position depends on: the walls and doors that
  /// define the rooms, and the things it has to avoid.
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
  }

  /// The rooms picked out by the Rooms tool, plus the box being dragged.
  /// Each selected room is shaded and captioned with the measurement that
  /// matters for evening them out — its width along the row.
  drawRoomSelection(room) {
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
    // Red is a property of where the item IS, not of what just happened to it.
    // Deriving it means a piece left overlapping stays red after the drag ends,
    // and clears itself the moment it is moved or turned somewhere it fits.
    if (this._clashing && this._clashing.has(item.id)) return "invalid";
    return selected ? "selected" : "default";
  }

  /// Ids of every furniture item currently overlapping a wall or another item.
  /// Computed once per frame rather than per item.
  clashingFurniture(room) {
    const out = new Set();
    for (const item of room.furniture || []) {
      if (!P.isFurniturePlacementValid(room, item, new Set([item.id]))) out.add(item.id);
    }
    return out;
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
  }

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
