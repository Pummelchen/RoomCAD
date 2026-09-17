// Walls, doors and windows.
//
// Drawing a wall, dragging one, and everything that hangs off one: doors,
//   windows and the ends of an opening.
//
// Part of the store; the public entry point is ../store.js, which composes
// every file here into one object. Import from there, not from here.

import * as P from "../plan.js";
import { playDoorSound } from "../audio.js";

export const walls = {
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
    // The same floor the editor draws to. This used to accept 0.15 — the
    // threshold sanitize() uses to repair a FILE — so a wall could be dragged
    // down to half the length it was allowed to be drawn at: 20 cm was legal to
    // hold, and impossible to make.
    //
    // A wall that is ALREADY shorter than the minimum, from an older document,
    // is the one exception: it may keep its length, grow, or turn, but a drag
    // may not make it shorter still. Without that it could never be reoriented,
    // because every drag that did not lengthen it would be refused and the wall
    // would simply look stuck.
    const before = P.wallLength(this.room.walls[index]);
    const after = P.wallLength(wall);
    if (after >= P.MIN_WALL_LENGTH || (before < P.MIN_WALL_LENGTH && after >= before)) {
      this.room.walls[index] = wall;
    }
  },

  /// True if this wall is part of the outer skin and has not been unlocked.
  /// Whether this wall is held still. The one place that decides it: the plan
  /// says which walls face outwards, this says whether that means anything.
  wallIsLocked(id) {
    if (this.outsideWallsFree) return false;
    const wall = this.room.walls.find(w => w.id === id);
    return P.wallDragLocked(this.room, wall);
  },

  moveWall(id, dx, dz) {
    const index = this.room.walls.findIndex(w => w.id === id);
    if (index < 0) return false;
    // An outer wall holds the footprint of the building. Moving one by accident
    // while rearranging the inside is the mistake this prevents; the wall says
    // how to allow it rather than just refusing.
    if (this.wallIsLocked(id)) {
      this.status = "Outside wall is fixed — right-click it to free it, "
        + "or tick Outside walls free to drag";
      this.emit();
      return false;
    }
    // Take the joined walls along, or dragging one wall tears the building
    // open. Returns null when the step would crush a wall or leave the plate,
    // which on a drag just stops the wall at its limit.
    const before = new Map(this.room.walls.map(w =>
      [w.id, `${w.start.x},${w.start.z},${w.end.x},${w.end.z}`]));
    const moved = P.dragWall(this.room, id, dx, dz);
    if (!moved) return false;
    this.beginDrag();
    // Doors and windows are positioned along their wall, so they travel with it
    // for free — as long as the wall keeps its identity and its length.
    this.room.walls = moved;
    // A drag runs inside a transaction, so sanitize() does not see it until the
    // drag ends. Without these two the model is briefly inconsistent with
    // itself: the sidebar reports the size the room had before the drag began,
    // and an opening on a wall that got shorter is drawn past its end.
    P.fitOpeningsToWalls(this.room);
    // Walls stick to each other, the way they do when you draw one against
    // another. Drawing locks on from 35 cm; dragging used to go precisely
    // where the pointer left it, which is how a room came to be five
    // millimetres from closed — no label, no room in the count, nothing to see.
    //
    // Only the walls this drag actually moved are snapped: the wall you are
    // dragging sticks to what it meets, and the walls it passes stay where they
    // were drawn. And it happens per step rather than at the end, so the room
    // reads as enclosed while you are still sizing it — which is when the area
    // is what you are dragging towards.
    const shifted = new Set();
    for (const w of this.room.walls) {
      const was = before.get(w.id);
      if (!was || was !== `${w.start.x},${w.start.z},${w.end.x},${w.end.z}`) shifted.add(w.id);
    }
    P.healWallJoints(this.room, { only: shifted, tolerance: P.WALL_DRAG_SNAP });
    P.syncExtent(this.room);
    // Say so while the wall is still moving. The canvas redraws itself from the
    // drag, but the panel does not: floor area, overall size and the room count
    // all sat at what they were when the drag STARTED and only caught up when
    // the mouse came up — which is exactly when you have stopped looking at
    // them. Dragging a wall to reach an area you want needs the number to move
    // with the wall.
    this.emit();
    return true;
  },

  /// Frees every outside wall for dragging, or puts them all back under lock.
  setOutsideWallsFree(free) {
    if (this.outsideWallsFree === !!free) return;
    this.outsideWallsFree = !!free;
    this.status = free
      ? "Outside walls are free to drag"
      : "Outside walls are held still — right-click one to free just that one";
    this.emit();
  },

  /// Lets one outer wall be dragged, or puts it back under lock.
  setWallDragUnlocked(id, unlocked) {
    const wall = this.room.walls.find(w => w.id === id);
    if (!wall) return;
    if (!!wall.dragUnlocked === !!unlocked) return;
    this.commit(unlocked ? "Unlocked an outside wall" : "Locked an outside wall", room => {
      const w = room.walls.find(x => x.id === id);
      if (!w) return;
      if (unlocked) w.dragUnlocked = true;
      else delete w.dragUnlocked;
    });
    this.status = unlocked
      ? "Outside wall unlocked — drag it, or right-click to lock it again"
      : "Outside wall locked again";
    this.emit();
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

  /// Turns a door round so its hinge is on the other side of the opening.
  ///
  /// Not the same as changing which way it swings: the leaf still opens into
  /// the same room, it just opens from the other edge. That is what you want
  /// when the door as drawn would swing back against a wall, cover a light
  /// switch, or open into the path of the one next to it.
  flipDoorHinge(id) {
    const door = this.room.doors.find(d => d.id === id);
    if (!door) return;
    this.commit("Turned the door round", room => {
      const d = room.doors.find(x => x.id === id);
      if (d) d.hingeAtEnd = !d.hingeAtEnd;
    });
    playDoorSound();
    this.selectedDoorID = id;
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
    // From plan.js, not typed out again: the inspector slider, this clamp and
    // the one sanitize() applies on load all have to be the same range, or a
    // width can be set to one the model then rewrites.
    const clamped = P.clamp(width, P.MIN_OPENING_WIDTH[kind], P.MAX_OPENING_WIDTH[kind]);
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
};
