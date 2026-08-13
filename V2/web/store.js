// store.js — editing state and operations for RoomCAD V2 web.
// Mirrors the native Swift RoomStore.

import * as P from "./plan.js";
import { playDoorSound } from "./audio.js";

export const TOOL_HELP = {
  select: "Drag walls, doors, windows, and furniture · click to select",
  wall: "Drag on the plan to draw a wall",
  door: "Click a wall to add a door, then drag it to slide",
  window: "Click a wall to add a window, then drag it to slide",
  furniture: "Pick furniture from the palette, then click the floor to place it",
  erase: "Click anything to erase it",
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
  documentName: null,
  serverRoomName: null, // the ternak_roomN slot this room was opened from (if any)
  edited: false,
  status: "Ready",
  undoStack: [],
  redoStack: [],
  dragTransactionActive: false,
  furnitureFeedback: null, // { id, state: "valid" | "invalid" } during move/rotate
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

  // MARK: Selection

  hasSelection() {
    return this.selectedWallID !== null || this.selectedDoorID !== null
      || this.selectedWindowID !== null || this.selectedFurnitureID !== null;
  },

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
    this.furnitureFeedback = null;
  },

  select(p) {
    const furniture = P.furnitureNear(this.room, p);
    if (furniture) {
      this.clearSelection();
      this.selectedFurnitureID = furniture.id;
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
    this.clearSelection();
    this.status = "Click a wall, door, window, or furniture item";
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
    // The moved endpoint stays axis-aligned with the fixed one, so walls
    // always keep their 90° corners.
    const fixed = part === "start" ? wall.end : wall.start;
    const p = P.snapWallEnd(this.room, raw, fixed);
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
    this.room.walls[index] = P.translateWall(
      this.room.walls[index], dx, dz, this.room.width, this.room.length
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

  setOpeningWidth(kind, width) {
    const id = kind === "door" ? this.selectedDoorID : this.selectedWindowID;
    if (!id) return;
    const clamped = P.clamp(width, kind === "door" ? 0.6 : 0.4, kind === "door" ? 1.4 : 2.0);
    this.commit("Set " + (kind === "door" ? "door" : "window") + " width to " + P.cm(clamped), room => {
      if (kind === "door") {
        const index = room.doors.findIndex(d => d.id === id);
        if (index >= 0) room.doors[index].width = clamped;
      } else {
        const index = room.windows.findIndex(w => w.id === id);
        if (index >= 0) room.windows[index].width = clamped;
      }
    });
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
    if (!P.isFurniturePlacementValid(this.room, candidate)) {
      this.status = "That spot is taken · click an open space";
      this.emit();
      return;
    }
    this.commit("Placed " + P.FURNITURE_KINDS[kind].title.toLowerCase(), room => {
      room.furniture.push(candidate);
    });
    this.selectedFurnitureID = candidate.id;
    this.status = P.FURNITURE_KINDS[kind].title + " placed · click again or press Esc to stop";
    this.emit();
  },

  moveFurniture(id, raw) {
    this.beginDrag();
    const index = this.room.furniture.findIndex(f => f.id === id);
    if (index < 0) return;
    const item = this.room.furniture[index];
    const center = P.furnitureCenter(this.room, raw, item);
    const candidate = { ...item, center };
    const valid = P.isFurniturePlacementValid(this.room, candidate, new Set([id]));
    if (valid) this.room.furniture[index] = candidate;
    this.furnitureFeedback = { id, state: valid ? "valid" : "invalid" };
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
    candidate.center = {
      x: P.clamp(candidate.center.x, w / 2, this.room.width - w / 2),
      z: P.clamp(candidate.center.z, d / 2, this.room.length - d / 2),
    };
    if (!P.isFurniturePlacementValid(this.room, candidate, new Set([id]))) {
      this.status = "Can't turn it there — it would hit a wall";
      this.flashFurniture(id, "invalid");
      return;
    }
    this.flashFurniture(id, "valid");
    this.commit("Turned " + P.FURNITURE_KINDS[candidate.kind].title.toLowerCase(), room => {
      room.furniture[index] = candidate;
    });
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
    if (!P.isFurniturePlacementValid(this.room, candidate, new Set([id]))) {
      this.status = "Can't move any further that way";
      this.flashFurniture(id, "invalid");
      return;
    }
    this.commit("Moved " + P.FURNITURE_KINDS[candidate.kind].title.toLowerCase(), room => {
      room.furniture[index] = candidate;
    });
  },

  // MARK: Erase and delete

  erase(p) {
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
    this.status = "Nothing to erase there";
    this.emit();
  },

  deleteSelection() {
    if (this.selectedFurnitureID) {
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
    this.edited = false;
    this.status = "Opened " + this.documentName;
    this.emit();
  },

  /// Applies a room pushed from a teammate over the live channel, without
  /// resetting the current view mode or tool.
  applyRemoteRoom(room) {
    this.room = room;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.clearSelection();
    this.edited = false;
    this.status = "Room updated by teammate";
    this.emit();
  },

  markSaved() {
    this.edited = false;
    this.emit();
  },
};
