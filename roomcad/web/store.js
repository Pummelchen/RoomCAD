// store.js — editing state and operations for RoomCAD web.
// Mirrors the native Swift RoomStore.

import * as P from "./plan.js";
import { playDoorSound } from "./audio.js";

export const TOOL_HELP = {
  select: "Drag walls, doors, windows, and furniture · click to select",
  label: "Click the plan to place a text label",
  wall: "Drag on the plan to draw a wall",
  door: "Click a wall to add a door, then drag it to slide",
  window: "Click a wall to add a window, then drag it to slide",
  furniture: "Pick furniture from the palette, then click the floor to place it",
  erase: "Click anything to erase it",
  measure: "Click and drag between two points to measure the distance in cm",
  public: "Drag a rectangle to mark shared (public) floor space",
};

export const store = {
  room: P.demoRoom(),
  mode: "2d", // "2d" | "3d"
  tool: "select",
  pendingFurnitureKind: null,
  lastFurnitureKind: null,
  rotation: 0, // 2D plan view rotation in degrees (0/90/180/270)
  floor: 2, // which building floor the room is on (1 = ground floor)
  selectedWallID: null,
  selectedDoorID: null,
  selectedWindowID: null,
  selectedFurnitureID: null,
  selectedLabelID: null,
  selectedPublicID: null,
  documentName: null,
  serverRoomName: null, // the ternak_roomN slot this room was opened from (if any)
  serverRoomVersion: null, // the current save version of that slot
  live: false, // real-time (unsaved) collaboration with teammates
  presenceCount: 1, // how many browser sessions are connected (from /api/status)
  serverLatency: null, // round-trip ms to the server (from the status poll)
  serverOffline: false, // true only after a status poll actually failed (network)
  timeOfDay: 15, // hour of day (0–24, 24 h clock) driving the 3D sun + city lights
  layoutSeed: 1, // seed for the auto room layout; "redesign" bumps it for a new variant
  layoutCount: 3, // how many private rooms to generate
  layoutArea: 12, // target m² per room (guide for the layout)
  layoutWindows: false, // add one window per room (only on outside-facing walls)
  edited: false,
  status: "Ready",
  undoStack: [],
  redoStack: [],
  dragTransactionActive: false,
  furnitureFeedback: null, // { id, state: "valid" | "invalid" } during move/rotate
  furnitureGaps: null,     // { wall: {cm,dir}, furniture: {cm,kind} } for the selected/moving item
  feedbackTimer: null,
  listeners: new Set(),

  // MARK: Notifications

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  },

  emit() {
    this.listeners.forEach(fn => fn());
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
    if (!item) {
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
      if (P.FURNITURE_KINDS[other.kind].category === "fixture") continue; // ceiling lights don't count as floor neighbours
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

  // MARK: Walls

  addWall(rawStart, rawEnd) {
    const start = P.snapPoint(this.room, rawStart);
    const end = P.snapWallEnd(this.room, rawEnd, start);
    const wall = { id: P.uid(), start, end };
    if (P.wallLength(wall) < P.MIN_WALL_LENGTH) {
      this.status = "Walls need to be at least 30 cm long";
      this.emit();
      return false;
    }
    this.commit("Added " + P.cm(P.wallLength(wall)) + " wall", room => {
      room.walls.push(wall);
    });
    this.selectedWallID = wall.id;
    this.selectedDoorID = null;
    this.selectedWindowID = null;
    this.selectedFurnitureID = null;
    return true;
  },

  updateWallEndpoint(id, part, raw) {
    const index = this.room.walls.findIndex(w => w.id === id);
    if (index < 0) return;
    this.beginDrag();
    const wall = { ...this.room.walls[index] };
    // The dragged endpoint snaps to the closer axis through the fixed one, so
    // grabbing it can resize the wall or reorient it onto a 90° side.
    const fixed = part === "start" ? wall.end : wall.start;
    // Exclude this wall so the end never snaps onto the wall it belongs to,
    // and so it can lock onto whatever other wall it is being dragged into.
    const p = P.snapWallEndpoint(this.room, raw, fixed, id);
    if (part === "start") wall.start = p;
    else wall.end = p;
    if (P.wallLength(wall) >= 0.15) {
      this.room.walls[index] = wall;
    }
  },

  moveWall(id, dx, dz) {
    const index = this.room.walls.findIndex(w => w.id === id);
    if (index < 0) return;
    this.beginDrag();
    const canvas = P.canvasOf(this.room);
    this.room.walls[index] = P.translateWall(
      this.room.walls[index], dx, dz, canvas.width, canvas.length
    );
  },

  // MARK: Doors and windows

  placeOpening(kind, p) {
    const placement = P.wallForPlacement(this.room, p);
    if (!placement) {
      this.status = kind === "door"
        ? "Click on a wall to place a door"
        : "Click on a wall to place a window";
      this.emit();
      return false;
    }
    const { wall, offset } = placement;
    const width = kind === "door" ? 0.9 : 1.0;
    if (P.wallLength(wall) < width + 0.2) {
      this.status = "That wall is too short for a " + (kind === "door" ? "door" : "window");
      this.emit();
      return false;
    }
    const snapped = P.clamp(
      P.clean(Math.round((offset - width / 2) / Math.max(P.GRID_STEPS[this.room.grid].meters, 0.001))
        * Math.max(P.GRID_STEPS[this.room.grid].meters, 0.001)),
      0.10, P.wallLength(wall) - width - 0.10
    );
    const opening = {
      id: P.uid(),
      wallID: wall.id,
      offset: snapped,
      width,
      open: true,
      swingInside: true,
    };
    this.commit(kind === "door" ? "Added door" : "Added window", room => {
      if (kind === "door") room.doors.push(opening);
      else room.windows.push(opening);
    });
    if (kind === "door") this.selectedDoorID = opening.id;
    else this.selectedWindowID = opening.id;
    this.selectedWallID = null;
    this.selectedFurnitureID = null;
    this.tool = "select";
    this.status = kind === "door"
      ? "Door placed · double-click it to open/close"
      : "Window placed · drag it along the wall to position";
    this.emit();
    return true;
  },

  /// Toggles a door between open and closed (default is open).
  toggleDoorOpen(id) {
    const door = this.room.doors.find(d => d.id === id);
    if (!door) return;
    const willOpen = !door.open;
    this.commit(willOpen ? "Opened door" : "Closed door", room => {
      const d = room.doors.find(x => x.id === id);
      if (d) d.open = willOpen;
    });
    playDoorSound();
    this.selectedDoorID = id;
    this.selectedWallID = null;
    this.selectedWindowID = null;
    this.selectedFurnitureID = null;
  },

  /// Sets which side of the wall a door swings toward.
  setDoorSwing(id, inside) {
    if (!this.room.doors.some(d => d.id === id)) return;
    this.commit(inside ? "Door opens inside" : "Door opens outside", room => {
      const d = room.doors.find(x => x.id === id);
      if (d) d.swingInside = inside;
    });
    playDoorSound();
  },

  /// Right-click door toggle: open → close, closed → open to the opposite side.
  toggleDoorSwing(id) {
    const door = this.room.doors.find(d => d.id === id);
    if (!door) return;
    const wasOpen = door.open;
    const message = wasOpen
      ? "Closed door"
      : (door.swingInside ? "Opened door to the outside" : "Opened door to the inside");
    this.commit(message, room => {
      const d = room.doors.find(x => x.id === id);
      if (!d) return;
      if (wasOpen) {
        d.open = false;
      } else {
        d.open = true;
        d.swingInside = !d.swingInside;
      }
    });
    playDoorSound();
    this.selectedDoorID = id;
    this.selectedWallID = null;
    this.selectedWindowID = null;
    this.selectedFurnitureID = null;
  },

  slideOpening(kind, id, raw) {
    this.beginDrag();
    if (kind === "door") {
      const index = this.room.doors.findIndex(d => d.id === id);
      if (index < 0) return;
      const door = this.room.doors[index];
      const wall = this.room.walls.find(w => w.id === door.wallID);
      if (!wall) return;
      const offset = this.snappedOpeningOffset(
        P.wallProjection(wall, raw).offset - door.width / 2, door.width, wall
      );
      if (offset !== null) door.offset = offset;
    } else {
      const index = this.room.windows.findIndex(w => w.id === id);
      if (index < 0) return;
      const window = this.room.windows[index];
      const wall = this.room.walls.find(w => w.id === window.wallID);
      if (!wall) return;
      const offset = this.snappedOpeningOffset(
        P.wallProjection(wall, raw).offset - window.width / 2, window.width, wall
      );
      if (offset !== null) window.offset = offset;
    }
  },

  slideOpeningToOffset(kind, id, offset) {
    this.beginDrag();
    if (kind === "door") {
      const index = this.room.doors.findIndex(d => d.id === id);
      if (index < 0) return;
      const door = this.room.doors[index];
      const wall = this.room.walls.find(w => w.id === door.wallID);
      if (!wall) return;
      door.offset = P.clamp(offset, 0.10, P.wallLength(wall) - door.width - 0.10);
    } else {
      const index = this.room.windows.findIndex(w => w.id === id);
      if (index < 0) return;
      const window = this.room.windows[index];
      const wall = this.room.walls.find(w => w.id === window.wallID);
      if (!wall) return;
      window.offset = P.clamp(offset, 0.10, P.wallLength(wall) - window.width - 0.10);
    }
  },

  updateOpeningWidth(kind, width) {
    this.beginDrag();
    const clamped = P.clamp(width, kind === "door" ? 0.6 : 0.4, kind === "door" ? 1.4 : 2.0);
    if (kind === "door") {
      const index = this.room.doors.findIndex(d => d.id === this.selectedDoorID);
      if (index >= 0) this.room.doors[index].width = clamped;
    } else {
      const index = this.room.windows.findIndex(w => w.id === this.selectedWindowID);
      if (index >= 0) this.room.windows[index].width = clamped;
    }
  },

  snappedOpeningOffset(rawOffset, width, wall) {
    if (P.wallLength(wall) < width + 0.2) return null;
    const step = Math.max(P.GRID_STEPS[this.room.grid].meters, 0.001);
    const snapped = P.clean(Math.round(rawOffset / step) * step);
    return P.clamp(snapped, 0.10, P.wallLength(wall) - width - 0.10);
  },

  // MARK: Furniture

  placeFurniture(kind, raw) {
    const candidate = { id: P.uid(), kind, center: P.point(raw.x, raw.z), rotationDegrees: 0 };
    candidate.center = P.furnitureCenter(this.room, raw, candidate);
    // Placing is not blocked either: the piece lands where it was asked to go
    // and reads red until it is somewhere it fits.
    const valid = P.isFurniturePlacementValid(this.room, candidate);
    this.commit("Placed " + P.FURNITURE_KINDS[kind].title.toLowerCase(), room => {
      room.furniture.push(candidate);
    });
    this.selectedFurnitureID = candidate.id;
    this.refreshFurnitureGaps(candidate.id);
    // Return to the default Select tool so the palette button de-selects and
    // the cursor goes back to normal after one placement.
    this.pendingFurnitureKind = null;
    this.tool = "select";
    this.status = valid
      ? P.FURNITURE_KINDS[kind].title + " placed"
      : P.FURNITURE_KINDS[kind].title + " placed — it overlaps here, drag or turn it to fit";
    this.emit();
  },

  moveFurniture(id, raw) {
    this.beginDrag();
    const index = this.room.furniture.findIndex(f => f.id === id);
    if (index < 0) return;
    const item = this.room.furniture[index];
    const center = P.furnitureCenter(this.room, raw, item);
    const candidate = { ...item, center };
    // Never block a drag. Refusing to apply an invalid position made the item
    // stick against walls and other furniture, so it could not be carried
    // across a room. It follows the cursor wherever it goes and simply reads
    // red until it is somewhere it fits — the same rule a turn already used.
    const valid = P.isFurniturePlacementValid(this.room, candidate, new Set([id]));
    this.room.furniture[index] = candidate;
    this.furnitureFeedback = { id, state: valid ? "valid" : "invalid" };
    this.refreshFurnitureGaps(id);
  },

  rotateSelectedFurniture() {
    const id = this.selectedFurnitureID;
    if (!id) {
      this.status = "Select a furniture item first";
      this.emit();
      return;
    }
    const index = this.room.furniture.findIndex(f => f.id === id);
    if (index < 0) return;
    const candidate = { ...this.room.furniture[index] };
    candidate.rotationDegrees = (candidate.rotationDegrees + 90) % 360;
    const kind = P.FURNITURE_KINDS[candidate.kind];
    const swaps = candidate.rotationDegrees === 90 || candidate.rotationDegrees === 270;
    const w = swaps ? kind.d : kind.w;
    const d = swaps ? kind.w : kind.d;
    const canvas = P.canvasOf(this.room);
    candidate.center = {
      x: P.clamp(candidate.center.x, w / 2, canvas.width - w / 2),
      z: P.clamp(candidate.center.z, d / 2, canvas.length - d / 2),
    };
    // Never block a turn. Apply it and colour the item green (fits) or red
    // (conflict) so it's clear when the piece is in a bad spot — the user can
    // keep turning until it turns green.
    const valid = P.isFurniturePlacementValid(this.room, candidate, new Set([id]));
    this.furnitureFeedback = { id, state: valid ? "valid" : "invalid" };
    this.commit(
      (valid ? "Turned " : "Turned — it overlaps, turn back until it fits · ") +
        P.FURNITURE_KINDS[candidate.kind].title.toLowerCase(),
      room => { room.furniture[index] = candidate; }
    );
  },

  nudgeSelectedFurniture(dx, dz) {
    const id = this.selectedFurnitureID;
    if (!id) return;
    const index = this.room.furniture.findIndex(f => f.id === id);
    if (index < 0) return;
    const candidate = {
      ...this.room.furniture[index],
      center: P.point(this.room.furniture[index].center.x + dx, this.room.furniture[index].center.z + dz),
    };
    // Nudging is a drag by another name, so it is not blocked either.
    const valid = P.isFurniturePlacementValid(this.room, candidate, new Set([id]));
    this.flashFurniture(id, valid ? "valid" : "invalid");
    const name = P.FURNITURE_KINDS[candidate.kind].title.toLowerCase();
    this.commit(valid ? "Moved " + name : "Moved " + name + " — it overlaps here", room => {
      room.furniture[index] = candidate;
    });
  },

  // MARK: Labels

  placeLabel(raw, text = "Label") {
    const canvas = P.canvasOf(this.room);
    const center = {
      x: P.clamp(P.clean(raw.x), 0, canvas.width),
      z: P.clamp(P.clean(raw.z), 0, canvas.length),
    };
    const label = {
      id: P.uid(),
      text,
      center,
      rotationDegrees: 0,
      size: P.LABEL_DEFAULT_SIZE,
    };
    this.commit("Placed label", room => {
      room.labels = room.labels || [];
      room.labels.push(label);
    });
    this.selectedLabelID = label.id;
    this.tool = "select";
    this.emit();
  },

  moveLabel(id, raw) {
    this.beginDrag();
    const label = (this.room.labels || []).find(l => l.id === id);
    if (!label) return;
    const canvas = P.canvasOf(this.room);
    label.center = {
      x: P.clamp(P.clean(raw.x), 0, canvas.width),
      z: P.clamp(P.clean(raw.z), 0, canvas.length),
    };
  },

  renameLabel(id, text) {
    const label = (this.room.labels || []).find(l => l.id === id);
    if (!label || label.text === text) return;
    this.commit("Renamed label", room => {
      const l = (room.labels || []).find(x => x.id === id);
      if (l) l.text = String(text).slice(0, 60);
    });
  },

  setLabelSize(id, size) {
    const label = (this.room.labels || []).find(l => l.id === id);
    if (!label) return;
    this.commit("Resized label", room => {
      const l = (room.labels || []).find(x => x.id === id);
      if (l) l.size = P.clamp(Number(size) || P.LABEL_DEFAULT_SIZE, 0.08, 1.0);
    });
  },

  rotateSelectedLabel() {
    const id = this.selectedLabelID;
    if (!id) return false;
    this.commit("Turned label", room => {
      const l = (room.labels || []).find(x => x.id === id);
      if (l) l.rotationDegrees = (l.rotationDegrees + 90) % 360;
    });
    return true;
  },

  // MARK: Public areas

  /// Drags one corner of a public area; the opposite corner stays put.
  resizePublicArea(id, corner, raw) {
    this.beginDrag();
    const areas = this.room.publicAreas || [];
    const index = areas.findIndex(a => a.id === id);
    if (index < 0) return;
    const dragged = P.resizePublicArea(areas[index], corner, raw, this.room);
    // Trimmed against the others, so a corner stops where the neighbour starts.
    const next = P.settlePublicArea(this.room, dragged, id);
    if (next.w >= 0.3 && next.l >= 0.3) {
      areas[index] = { ...areas[index], ...next };
      this.status = P.cm(next.w) + " × " + P.cm(next.l);
    }
  },

  movePublicArea(id, dx, dz) {
    this.beginDrag();
    const area = (this.room.publicAreas || []).find(a => a.id === id);
    if (!area) return;
    const canvas = P.canvasOf(this.room);
    const clear = candidate => {
      const settled = P.settlePublicArea(this.room, candidate, id);
      // Moving must never resize: if settling had to trim, this position is
      // blocked. Trying each axis on its own then lets the area slide along a
      // neighbour it is pressed against instead of sticking.
      const sameSize = Math.abs(settled.w - area.w) < 0.001 && Math.abs(settled.l - area.l) < 0.001;
      return sameSize ? settled : null;
    };
    const put = candidate => ({
      x: P.clamp(candidate.x, 0, canvas.width - area.w),
      z: P.clamp(candidate.z, 0, canvas.length - area.l),
      w: area.w,
      l: area.l,
    });
    const both = clear(put({ x: area.x + dx, z: area.z + dz }));
    const alongX = both || clear(put({ x: area.x + dx, z: area.z }));
    const target = both || alongX || clear(put({ x: area.x, z: area.z + dz }));
    if (!target) return;
    area.x = target.x;
    area.z = target.z;
  },

  deletePublicArea(id) {
    this.commit("Deleted public area", room => {
      room.publicAreas = (room.publicAreas || []).filter(a => a.id !== id);
    });
    if (this.selectedPublicID === id) this.selectedPublicID = null;
    this.emit();
  },

  // MARK: Opening ends

  /// Drags one end of a door or window, keeping the other end anchored.
  dragOpeningEnd(kind, id, which, raw) {
    this.beginDrag();
    const next = P.resizeOpeningEnd(this.room, kind, id, which, raw);
    if (!next) return;
    const list = kind === "door" ? this.room.doors : this.room.windows;
    const o = list.find(x => x.id === id);
    if (!o) return;
    o.offset = next.offset;
    o.width = next.width;
    this.status = (kind === "door" ? "Door " : "Window ") + P.cm(next.width) + " wide";
  },

  // MARK: Erase and delete

  erase(p) {
    const label = P.labelNear(this.room, p);
    if (label) {
      this.commit("Erased label", room => {
        room.labels = (room.labels || []).filter(l => l.id !== label.id);
      });
      if (this.selectedLabelID === label.id) this.selectedLabelID = null;
      this.emit();
      return;
    }
    const furniture = P.furnitureNear(this.room, p);
    if (furniture) {
      this.commit("Erased " + P.FURNITURE_KINDS[furniture.kind].title.toLowerCase(), room => {
        room.furniture = room.furniture.filter(f => f.id !== furniture.id);
      });
      if (this.selectedFurnitureID === furniture.id) this.selectedFurnitureID = null;
      this.emit();
      return;
    }
    const opening = P.openingNear(this.room, p);
    if (opening) {
      this.commit("Erased " + (opening.kind === "door" ? "door" : "window"), room => {
        if (opening.kind === "door") {
          room.doors = room.doors.filter(d => d.id !== opening.id);
        } else {
          room.windows = room.windows.filter(w => w.id !== opening.id);
        }
      });
      if (this.selectedDoorID === opening.id) this.selectedDoorID = null;
      if (this.selectedWindowID === opening.id) this.selectedWindowID = null;
      this.emit();
      return;
    }
    const wall = P.wallNear(this.room, p);
    if (wall) {
      this.commit("Erased wall", room => {
        room.walls = room.walls.filter(w => w.id !== wall.id);
        room.doors = room.doors.filter(d => d.wallID !== wall.id);
        room.windows = room.windows.filter(w => w.wallID !== wall.id);
      });
      if (this.selectedWallID === wall.id) this.selectedWallID = null;
      this.emit();
      return;
    }
    const area = P.publicAreaAt(this.room, p);
    if (area) {
      this.commit("Erased public area", room => {
        room.publicAreas = (room.publicAreas || []).filter(a => a.id !== area.id);
      });
      if (this.selectedPublicID === area.id) this.selectedPublicID = null;
      this.emit();
      return;
    }
    this.status = "Nothing to erase there";
    this.emit();
  },

  deleteSelection() {
    if (this.selectedLabelID) {
      const id = this.selectedLabelID;
      this.commit("Deleted label", room => {
        room.labels = (room.labels || []).filter(l => l.id !== id);
      });
      this.selectedLabelID = null;
    } else if (this.selectedPublicID) {
      const id = this.selectedPublicID;
      this.commit("Deleted public area", room => {
        room.publicAreas = (room.publicAreas || []).filter(a => a.id !== id);
      });
      this.selectedPublicID = null;
    } else if (this.selectedFurnitureID) {
      const id = this.selectedFurnitureID;
      this.commit("Deleted furniture", room => {
        room.furniture = room.furniture.filter(f => f.id !== id);
      });
      this.selectedFurnitureID = null;
    } else if (this.selectedDoorID) {
      const id = this.selectedDoorID;
      this.commit("Deleted door", room => {
        room.doors = room.doors.filter(d => d.id !== id);
      });
      this.selectedDoorID = null;
    } else if (this.selectedWindowID) {
      const id = this.selectedWindowID;
      this.commit("Deleted window", room => {
        room.windows = room.windows.filter(w => w.id !== id);
      });
      this.selectedWindowID = null;
    } else if (this.selectedWallID) {
      const id = this.selectedWallID;
      this.commit("Deleted wall", room => {
        room.walls = room.walls.filter(w => w.id !== id);
        room.doors = room.doors.filter(d => d.wallID !== id);
        room.windows = room.windows.filter(w => w.wallID !== id);
      });
      this.selectedWallID = null;
    }
    this.emit();
  },

  // MARK: Room settings

  updateRoomSize(width, length) {
    const w = P.clamp(width, 2, 20);
    const l = P.clamp(length, 2, 20);
    if (w === this.room.width && l === this.room.length) return;
    this.commit("Resized room to " + P.cm(w) + " × " + P.cm(l), room => {
      room.width = w;
      room.length = l;
    });
    this.clearSelection();
  },

  /// Resizes the buildable base plate (canvas). The plate always keeps at
  /// least the main room's footprint and stays centred around the room.
  updateCanvasSize(width, length) {
    const canvas = P.canvasOf(this.room);
    const w = P.clamp(width, Math.max(2, this.room.width), 60);
    const l = P.clamp(length, Math.max(2, this.room.length), 60);
    if (w === canvas.width && l === canvas.length) return;
    this.commit("Resized canvas to " + P.cm(w) + " × " + P.cm(l), room => {
      room.canvas = { width: w, length: l };
      P.centerRoom(room);
    });
    this.clearSelection();
  },

  updateRoomHeight(height) {
    const h = P.clamp(height, 2.2, 5);
    if (h === this.room.height) return;
    this.commit("Set ceiling height to " + Math.round(h * 100) / 100 + " m", room => {
      room.height = h;
    });
  },

  setGrid(step) {
    if (step === this.room.grid) return;
    this.commit("Grid set to " + P.GRID_STEPS[step].label, room => {
      room.grid = step;
    });
  },

  /// Turns the 2D plan view in 90° steps. The room rotates on screen; all
  /// labels and text stay upright.
  rotatePlan(delta) {
    this.rotation = ((this.rotation + delta) % 360 + 360) % 360;
    this.status = "Rotated plan " + (delta > 0 ? "right" : "left")
      + " · labels stay upright";
    this.emit();
  },

  /// Shifts the simulated building floor (1 = ground floor) for the 3D view.
  setFloor(delta) {
    const next = Math.max(1, Math.min(30, this.floor + delta));
    if (next === this.floor) return;
    this.floor = next;
    this.status = "Floor " + next;
    this.emit();
  },

  /// Sets the hour of day (24 h clock, wraps 0–24) that drives the 3D sun and
  /// the city's street / office lights.
  setTimeOfDay(hour) {
    this.timeOfDay = ((Math.round(hour) % 24) + 24) % 24;
    this.status = "Time " + this.timeOfDay + ":00";
    this.emit();
  },

  /// Adds a user-drawn rectangle to the shared (public) floor space. Public
  /// areas are left untouched by the auto room layout.
  markPublicArea(rect) {
    // On the grid, flush with its neighbours, and trimmed back rather than
    // laid on top of one.
    const settled = P.settlePublicArea(this.room, {
      x: Math.min(rect.x1, rect.x2),
      z: Math.min(rect.z1, rect.z2),
      w: Math.abs(rect.x2 - rect.x1),
      l: Math.abs(rect.z2 - rect.z1),
    });
    const area = { id: P.uid(), ...settled };
    if (area.w < 0.5 || area.l < 0.5) {
      this.status = "Drag a bigger public area — that one had no room left beside its neighbour";
      this.emit();
      return;
    }
    this.commit("Marked public space · " + P.cm(area.w) + " × " + P.cm(area.l), room => {
      room.publicAreas = room.publicAreas || [];
      room.publicAreas.push(area);
    });
    this.selectedPublicID = area.id;
    this.emit();
  },

  /// Runs the auto room layout and replaces the walls/doors/windows with the
  /// generated design. Each call is a commit, so undo/redo steps between designs.
  generateLayout(config) {
    const result = P.autoLayoutRooms(this.room, {
      count: config.count,
      area: config.area,
      windows: config.windows,
      seed: this.layoutSeed,
    });
    if (!result) {
      this.status = "Not enough free space to lay rooms out there";
      this.emit();
      return false;
    }
    this.commit("Generated " + result.rooms.length + " rooms", room => {
      room.walls = result.walls;
      room.doors = result.doors;
      room.windows = result.windows;
      // The corridors the generator carved become public floor, so they show
      // on the plan and are excluded from the next run's partition. Only this
      // generator's own corridors are replaced; floor the user marked stays.
      const kept = (room.publicAreas || []).filter(a => !a.generated);
      room.publicAreas = kept.concat(result.corridors.map(c => ({
        id: P.uid(), x: c.x, z: c.z, w: c.w, l: c.l, generated: true,
      })));
    });
    this.status = this.describeLayout(result);
    this.emit();
    return true;
  },

  /// An honest summary: what was asked for, what the space actually allowed,
  /// and how much floor went to circulation.
  describeLayout(result) {
    const target = result.targetArea;
    const actual = result.areaPerRoom;
    const off = target > 0 ? Math.abs(actual - target) / target : 0;
    const walk = result.corridors.reduce((s, c) => s + c.w * c.l, 0);
    let text = result.rooms.length + " rooms · " + actual.toFixed(1) + " m² each";
    if (off > 0.02) {
      text += " (asked " + target.toFixed(1) + " — that is the closest the space allows)";
    }
    if (walk > 0.5) text += " · " + walk.toFixed(1) + " m² walk paths";
    return text;
  },

  /// Generates a different (but still balanced) design by using the next seed.
  redesignLayout(config) {
    this.layoutSeed = (this.layoutSeed + 1) % 100000;
    return this.generateLayout(config);
  },

  renameRoom(name) {
    const trimmed = name.trim();
    if (!trimmed || trimmed === this.room.name) return;
    this.commit("Renamed room to " + trimmed, room => {
      room.name = trimmed;
    });
  },

  // MARK: Undo, redo, transactions

  canUndo() {
    return this.undoStack.length > 0;
  },

  canRedo() {
    return this.redoStack.length > 0;
  },

  undo() {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(this.cloneRoom());
    this.room = previous;
    this.clearSelection();
    this.edited = true;
    this.status = "Undid change";
    this.emit();
  },

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.cloneRoom());
    this.room = next;
    this.clearSelection();
    this.edited = true;
    this.status = "Redid change";
    this.emit();
  },

  commit(message, mutation) {
    if (this.dragTransactionActive) {
      this.dragTransactionActive = false;
      this.undoStack.pop();
    }
    this.undoStack.push(this.cloneRoom());
    if (this.undoStack.length > 100) this.undoStack.shift();
    mutation(this.room);
    P.sanitize(this.room);
    this.redoStack.length = 0;
    this.edited = true;
    this.status = message;
    this.emit();
  },

  beginDrag() {
    if (this.dragTransactionActive) return;
    this.undoStack.push(this.cloneRoom());
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.dragTransactionActive = true;
  },

  endDrag(message) {
    if (!this.dragTransactionActive) return;
    this.dragTransactionActive = false;
    this.furnitureFeedback = null;
    P.sanitize(this.room);
    this.redoStack.length = 0;
    this.edited = true;
    this.status = message;
    this.emit();
  },

  discardDrag() {
    if (!this.dragTransactionActive) return;
    this.dragTransactionActive = false;
    this.furnitureFeedback = null;
    this.undoStack.pop();
  },

  cloneRoom() {
    return JSON.parse(JSON.stringify(this.room));
  },

  // MARK: Rooms

  newRoom() {
    this.room = P.demoRoom();
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.clearSelection();
    this.pendingFurnitureKind = null;
    this.tool = "select";
    this.mode = "2d";
    this.rotation = 0;
    this.documentName = null;
    this.serverRoomName = null;
    this.serverRoomVersion = null;
    this.live = false;
    this.timeOfDay = 15;
    this.edited = false;
    this.status = "Started a new room (7-room demo)";
    this.emit();
  },

  loadRoom(room, name, fromServer = false) {
    this.room = room;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.clearSelection();
    this.pendingFurnitureKind = null;
    this.tool = "select";
    this.mode = "2d";
    this.rotation = 0;
    this.documentName = name || room.name;
    this.serverRoomName = fromServer ? name : null;
    this.serverRoomVersion = null;
    this.live = false;
    this.timeOfDay = 15;
    this.edited = false;
    this.status = "Opened " + this.documentName;
    this.emit();
  },

  /// Applies a room pushed from a teammate over the live channel, without
  /// resetting the current view mode or tool.
  applyRemoteRoom(room, version) {
    this.room = room;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.clearSelection();
    if (version) this.serverRoomVersion = version;
    this.edited = false;
    this.status = "Room updated by teammate";
    this.emit();
  },

};
