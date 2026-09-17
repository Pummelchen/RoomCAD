// Editor2D's drag methods.
//
// Part of editor2d.js; they are applied to `Editor2D.prototype` there, so `this`
// is the editor and every method still reaches every other one.

import * as P from "../plan.js";
import { store } from "../store.js";
import { HANDLE_RADIUS_PX } from "./theme.js";

export const drag = {

  runContextMenuAction(action) {
    switch (action) {
      case "turn":
        store.rotateSelectedFurniture();
        break;
      case "flip-door":
        if (store.selectedDoorID) store.flipDoorHinge(store.selectedDoorID);
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
  },

  /// Ends a drag that is not going to be committed, and tells the store.
  ///
  /// A drag the store still believes is active silences teammates' live edits
  /// and swallows the undo snapshot of the next drag, so every teardown path —
  /// losing the window, a second finger starting a pinch, a right-click — has
  /// to come through here. Harmless when no drag is in progress.
  abortDrag() {
    this.drag = null;
    store.discardDrag();
  },

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
      this.abortDrag();
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
      this.abortDrag();
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
  },

  /// Plan-space radius of a grab handle at the current zoom. Handles have to
  /// stay the same size on screen, so the tolerance shrinks as you zoom in.
  handleTolerance() {
    return HANDLE_RADIUS_PX * 1.6 / this.scale;
  },

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
  },

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
  },

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
  },

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
        // A plain click is not a measurement: committing one painted a dotted
        // zero-length line with a persistent "0 cm" chip. Require a real drag,
        // using the same click-vs-drag threshold as the rest of the editor.
        if (moved && this.measureDrag
          && P.distance(this.measureDrag.start, this.measureDrag.end) > 0) {
          this.measureResult = { start: this.measureDrag.start, end: this.measureDrag.end };
        }
        this.measureDrag = null;
        break;
    }
    this.draw();
  }
};
