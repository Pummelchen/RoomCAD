// Erasing, deleting, and the room settings.
//
// Removing things, and the settings that describe the room itself.
//
// Part of the store; the public entry point is ../store.js, which composes
// every file here into one object. Import from there, not from here.

import * as P from "../plan.js";
import { clockText } from "./base.js";

export const editing = {
  // MARK: Erase and delete

  erase(p) {
    // A wall you are pointing straight at wins over furniture standing against
    // it. Furniture was tested first, so aiming at a wall with a bed pushed up
    // to it deleted the bed — the wall's 18 cm grab zone reaches well inside
    // the furniture, and the two are flush by design.
    const aimedWall = P.wallNear(this.room, p, P.WALL_THICKNESS);
    if (aimedWall) {
      this.commit("Erased wall", room => {
        room.walls = room.walls.filter(w => w.id !== aimedWall.id);
        room.doors = room.doors.filter(d => d.wallID !== aimedWall.id);
        room.windows = room.windows.filter(w => w.wallID !== aimedWall.id);
      });
      if (this.selectedWallID === aimedWall.id) this.selectedWallID = null;
      this.emit();
      return;
    }
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

  /// Sets the time of day (24 h clock, wraps 0–24) that drives the 3D sun and
  /// the city's street / office lights.
  ///
  /// Kept to the MINUTE, not the hour. Rounding to the hour is what made dusk
  /// a switch: the sun drops about fifteen degrees in the hour after sunset, so
  /// 19:00 to 20:00 went from lit to dark in one step with none of the twilight
  /// in between — and twilight is most of what an evening looks like.
  setTimeOfDay(hour) {
    const minutes = Math.round(hour * 60);
    this.timeOfDay = (((minutes % 1440) + 1440) % 1440) / 60;
    this.status = "Time " + clockText(this.timeOfDay);
    this.emit();
  },

  /// Steps through the weather. It is a view setting like the time of day, not
  /// part of the plan: it changes what the walkthrough looks like out of the
  /// window and is never saved with the room.
  setWeather(kind) {
    const list = ["clear", "cloudy", "rain", "snow"];
    this.weather = list.includes(kind) ? kind : "clear";
    this.status = "Weather: " + this.weather;
    this.emit();
  },

  stepWeather(delta) {
    const list = ["clear", "cloudy", "rain", "snow"];
    const at = Math.max(0, list.indexOf(this.weather));
    this.setWeather(list[((at + delta) % list.length + list.length) % list.length]);
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
      // Public floor is the user's to mark, and only the user's. The generator
      // used to add its own hallways as public areas, so running it painted
      // grey floor over a plan nobody had asked it to paint. The hallways it
      // carves are still there — they are the floor between the rooms, and
      // every room opens onto them — they are simply not marked as shared
      // space. Anything a previous run marked is cleared out, since the
      // generator had no business putting it there either.
      room.publicAreas = (room.publicAreas || []).filter(a => !a.generated);
    });
    // The walking space is the planner's input, not its output. Say so when
    // there is none: without it the rooms fill the plate and open where they
    // can, which is a plan, but not the one the tool is for.
    const marked = (this.room.publicAreas || []).length > 0;
    this.status = this.describeLayout(result)
      + (marked ? "" : " · no walking space marked — draw the hall with 🟩 Public and generate again");
    this.emit();
    return true;
  },

  /// An honest summary: what was asked for, what the space actually allowed,
  /// and how much floor went to circulation.
  describeLayout(result) {
    const asked = result.requested || {};
    const actual = result.areaPerRoom;
    // Floor that ended up as hallway rather than as a room. Reported so the
    // count adds up to the space; NOT marked on the plan as public floor.
    const walk = result.corridors.reduce((s, c) => s + c.w * c.l, 0);

    // Say so when the space would not take as many rooms as were asked for,
    // rather than quietly reporting the smaller number as if it were the ask.
    let text = asked.count && result.rooms.length < asked.count
      ? result.rooms.length + " of " + asked.count + " rooms (no room for the rest)"
      : result.rooms.length + " rooms";
    text += " · " + actual.toFixed(1) + " m² each";

    // Compare against what the user typed, not the target the space imposed.
    const wanted = asked.area > 0 ? asked.area : result.targetArea;
    if (wanted > 0 && Math.abs(actual - wanted) / wanted > 0.02) {
      text += " (asked " + wanted.toFixed(1) + " — that is the closest the space allows)";
    }
    if (walk > 0.5) text += " · " + walk.toFixed(1) + " m² hallway";
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
};
