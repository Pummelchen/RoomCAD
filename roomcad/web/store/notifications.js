// Notifications, selection, and the tool that is active.
//
// The store's own change notification, and the selection and tool state that
//   every other part of the editor reads and writes.
//
// Part of the store; the public entry point is ../store.js, which composes
// every file here into one object. Import from there, not from here.

import * as P from "../plan.js";
import { TOOL_HELP } from "./base.js";

export const notifications = {
  // MARK: Notifications

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  },

  emit() {
    // One listener must not be able to silence the rest. `forEach` runs them in
    // registration order and an exception from one aborts the whole loop, so a
    // single failing renderer stopped every renderer registered after it — the
    // inspector, the status line and the toolbar all went dead for that change
    // with nothing shown. Each is isolated over a COPY of the set (a listener
    // may add or remove one as it runs), and a failure is reported rather than
    // swallowed, so the next listener still runs and the cause is visible.
    for (const fn of [...this.listeners]) {
      try {
        fn();
      } catch (err) {
        console.error("store listener failed:", err);
      }
    }
  },

  /// Briefly colours a furniture item green (valid) or red (invalid) in the
  /// 2D editor, then clears itself.
  flashFurniture(id, state) {
    this.furnitureFeedback = { id, state };
    clearTimeout(this.feedbackTimer);
    this.emit();
    this.feedbackTimer = setTimeout(() => {
      this.furnitureFeedback = null;
      this.emit();
    }, 700);
  },

  /// Computes the nearest wall gap and nearest other-furniture gap (in cm) for
  /// a furniture item, so the 2D editor can show how much space surrounds it.
  refreshFurnitureGaps(id) {
    const item = this.room.furniture.find(f => f.id === id);
    // A kind this build has no footprint for cannot be measured. sanitize()
    // drops those when a document loads, so this only matters for a room
    // assembled in memory — and it must report nothing rather than throw.
    if (!item || !P.FURNITURE_KINDS[item.kind]) {
      this.furnitureGaps = null;
      return;
    }
    const f = P.furnitureFootprint(item);

    let wallGap = Infinity;
    for (const wall of this.room.walls) {
      const d = P.wallRectDistance(wall, f);
      const gap = Math.max(0, d - P.WALL_THICKNESS / 2);
      if (gap < wallGap) wallGap = gap;
    }

    let nearest = null;
    for (const other of this.room.furniture) {
      if (other.id === id) continue;
      // An unmeasurable neighbour is skipped, not compared against: there is no
      // footprint to take a distance from.
      const otherKind = P.FURNITURE_KINDS[other.kind];
      if (!otherKind) continue;
      if (otherKind.category === "fixture") continue; // ceiling lights don't count as floor neighbours
      const gap = P.rectDistance(f, P.furnitureFootprint(other));
      if (gap < (nearest ? nearest.cm / 100 : Infinity)) nearest = { cm: Math.round(gap * 100), kind: other.kind };
    }

    this.furnitureGaps = {
      id,
      wall: wallGap === Infinity ? null : { cm: Math.round(wallGap * 100) },
      furniture: nearest,
    };
  },

  // MARK: Selection

  selectedWall() {
    return this.selectedWallID
      ? this.room.walls.find(w => w.id === this.selectedWallID) || null
      : null;
  },

  selectedDoor() {
    return this.selectedDoorID
      ? this.room.doors.find(d => d.id === this.selectedDoorID) || null
      : null;
  },

  selectedWindow() {
    return this.selectedWindowID
      ? this.room.windows.find(w => w.id === this.selectedWindowID) || null
      : null;
  },

  selectedFurniture() {
    return this.selectedFurnitureID
      ? this.room.furniture.find(f => f.id === this.selectedFurnitureID) || null
      : null;
  },

  selectedOpeningKind() {
    if (this.selectedDoorID) return "door";
    if (this.selectedWindowID) return "window";
    return null;
  },

  selectedOpeningSpacing() {
    const kind = this.selectedOpeningKind();
    if (!kind) return null;
    const id = kind === "door" ? this.selectedDoorID : this.selectedWindowID;
    return id ? P.openingSpacing(this.room, id, kind) : null;
  },

  selectedOpeningWall() {
    const kind = this.selectedOpeningKind();
    if (!kind) return null;
    const id = kind === "door" ? this.selectedDoorID : this.selectedWindowID;
    return id ? P.openingWall(this.room, id, kind) : null;
  },

  clearSelection() {
    this.selectedWallID = null;
    this.selectedDoorID = null;
    this.selectedWindowID = null;
    this.selectedFurnitureID = null;
    this.selectedLabelID = null;
    this.selectedPublicID = null;
    this.furnitureFeedback = null;
    // The clash colour a carried public area shows is part of the drag, not
    // part of the plan, so it goes with the selection too — leaving it set
    // painted an area red for good.
    this.publicFeedback = null;
    this.furnitureGaps = null;
  },

  selectedLabel() {
    return this.selectedLabelID
      ? (this.room.labels || []).find(l => l.id === this.selectedLabelID) || null
      : null;
  },

  selectedPublicArea() {
    return this.selectedPublicID
      ? (this.room.publicAreas || []).find(a => a.id === this.selectedPublicID) || null
      : null;
  },

  select(p) {
    const label = P.labelNear(this.room, p);
    if (label) {
      this.clearSelection();
      this.selectedLabelID = label.id;
      this.status = "Selected label · drag to move · R turns it";
      this.emit();
      return;
    }
    const furniture = P.furnitureNear(this.room, p);
    if (furniture) {
      this.clearSelection();
      this.selectedFurnitureID = furniture.id;
      this.refreshFurnitureGaps(furniture.id);
      this.status = "Selected " + P.FURNITURE_KINDS[furniture.kind].title.toLowerCase()
        + " · drag to move, R to turn";
      this.emit();
      return;
    }
    const opening = P.openingNear(this.room, p);
    if (opening) {
      this.clearSelection();
      if (opening.kind === "door") {
        this.selectedDoorID = opening.id;
        this.status = "Selected door · drag to slide · double-click to open/close";
      } else {
        this.selectedWindowID = opening.id;
        this.status = "Selected window · drag along the wall to slide it";
      }
      this.emit();
      return;
    }
    const wall = P.wallNear(this.room, p);
    if (wall) {
      this.clearSelection();
      this.selectedWallID = wall.id;
      this.status = "Selected wall · " + P.cm(P.wallLength(wall)) + " long";
      this.emit();
      return;
    }
    // Public areas sit under everything else, so they are the last thing tried.
    const area = P.publicAreaAt(this.room, p);
    if (area) {
      this.clearSelection();
      this.selectedPublicID = area.id;
      this.status = "Selected public area · " + P.cm(area.w) + " × " + P.cm(area.l)
        + " · drag a corner to resize";
      this.emit();
      return;
    }
    this.clearSelection();
    this.status = "Click a wall, door, window, label, or furniture item";
    this.emit();
  },

  // MARK: Tools

  chooseTool(tool) {
    if (tool !== "rooms") this.roomSelection = null;
    this.tool = tool;
    this.pendingFurnitureKind = null;
    this.clearSelection();
    this.status = TOOL_HELP[tool];
    this.emit();
  },

  beginFurniturePlacement(kind) {
    this.tool = "furniture";
    this.pendingFurnitureKind = kind;
    this.lastFurnitureKind = kind;
    this.clearSelection();
    this.status = "Click on the floor to place the "
      + P.FURNITURE_KINDS[kind].title.toLowerCase() + " · click its icon again or press Esc to stop";
    this.emit();
  },

  cancelPlacement() {
    if (this.tool === "select") return;
    this.pendingFurnitureKind = null;
    this.tool = "select";
    this.status = "Stopped";
    this.emit();
  },
};
