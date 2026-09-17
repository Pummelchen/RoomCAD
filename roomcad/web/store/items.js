// Furniture, labels, room selection, and public floor.
//
// The things that sit on the floor rather than in the walls.
//
// Part of the store; the public entry point is ../store.js, which composes
// every file here into one object. Import from there, not from here.

import * as P from "../plan.js";

export const items = {
  // MARK: Furniture

  /// Turns the piece that is being placed, before it is put down. Returns
  /// false when nothing is waiting to be placed, so the caller can go on to
  /// turn whatever is selected instead.
  rotatePendingFurniture() {
    if (!this.pendingFurnitureKind) return false;
    this.pendingFurnitureRotation = (this.pendingFurnitureRotation + 90) % 360;
    const kind = P.FURNITURE_KINDS[this.pendingFurnitureKind];
    this.status = kind.title + " · " + this.pendingFurnitureRotation
      + "° — click to place it";
    this.emit();
    return true;
  },

  placeFurniture(kind, raw) {
    const candidate = {
      id: P.uid(), kind, center: P.point(raw.x, raw.z),
      rotationDegrees: this.pendingFurnitureRotation,
    };
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

  // MARK: Room selection

  setRoomSelection(rect) {
    const x = Math.min(rect.x1, rect.x2);
    const z = Math.min(rect.z1, rect.z2);
    const w = Math.abs(rect.x2 - rect.x1);
    const l = Math.abs(rect.z2 - rect.z1);
    if (w < 0.2 || l < 0.2) {
      this.roomSelection = null;
      this.status = "Drag a box across the rooms you want to even out";
      this.emit();
      return;
    }
    this.roomSelection = { x, z, w, l };
    const rooms = this.selectedRooms();
    this.status = rooms.length === 0
      ? "No whole rooms in that box — drag across the rooms themselves"
      : rooms.length + (rooms.length === 1 ? " room selected — select at least two to even them out"
        : " rooms selected · " + rooms.map(r => P.cm(Math.max(
          r.bounds.maxX - r.bounds.minX, r.bounds.maxZ - r.bounds.minZ))).join(" · "));
    this.emit();
  },

  selectedRooms() {
    if (!this.roomSelection) return [];
    return P.roomsInRect(this.room, this.roomSelection);
  },

  /// Slides the walls between the selected rooms so they come out the same
  /// size. Only the dividers move; the outside of the row stays put.
  equalizeSelectedRooms() {
    const rooms = this.selectedRooms();
    const result = P.equalizeRooms(this.room, rooms);
    if (result.reason) {
      this.status = result.reason;
      this.emit();
      return false;
    }
    this.commit("Evened out " + rooms.length + " rooms", room => {
      room.walls = result.walls;
    });
    this.status = "Evened out " + rooms.length + " rooms · "
      + P.cm(result.size) + " each";
    this.emit();
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

  /// Drags one area of public floor. It follows the cursor and does not stick.
  ///
  /// It used to be settled against its neighbours on every step of the drag,
  /// and any step that settling would have RESIZED was refused outright. So an
  /// area pressed up against another one stopped dead — and could never be
  /// taken past it, however far the cursor went: dragging seven metres across a
  /// neighbour moved it eighty centimetres and left it there.
  ///
  /// It goes where it is put, reads as clashing while it is on top of somebody,
  /// and is settled once, on release — the same rule furniture already used,
  /// and for the same reason.
  movePublicArea(id, dx, dz) {
    this.beginDrag();
    const area = (this.room.publicAreas || []).find(a => a.id === id);
    if (!area) return;
    const canvas = P.canvasOf(this.room);
    area.x = P.clean(P.clamp(area.x + dx, 0, Math.max(0, canvas.width - area.w)));
    area.z = P.clean(P.clamp(area.z + dz, 0, Math.max(0, canvas.length - area.l)));
    this.publicFeedback = {
      id,
      state: this.publicAreaClashes(area, id) ? "invalid" : "valid",
    };
  },

  /// Is this area lying on top of another one?
  publicAreaClashes(rect, ignoreID) {
    return (this.room.publicAreas || []).some(a => a.id !== ignoreID
      && rect.x < a.x + a.w - 0.0001 && a.x < rect.x + rect.w - 0.0001
      && rect.z < a.z + a.l - 0.0001 && a.z < rect.z + rect.l - 0.0001);
  },

  /// Puts a dragged area down: snapped to the grid and to whatever it has been
  /// laid alongside, and slid clear of anything it was dropped on top of.
  ///
  /// Sliding rather than trimming, because the size is the user's: an area
  /// dropped on a neighbour moves out of it by the shortest way, and only if
  /// there is nowhere at all for it to go does it return where it came from.
  settleDraggedPublicArea(id) {
    const area = (this.room.publicAreas || []).find(a => a.id === id);
    if (!area) return;
    this.publicFeedback = null;
    const canvas = P.canvasOf(this.room);
    const fits = rect => rect.x >= -0.0001 && rect.z >= -0.0001
      && rect.x + rect.w <= canvas.width + 0.0001
      && rect.z + rect.l <= canvas.length + 0.0001
      && !this.publicAreaClashes(rect, id);

    const snapped = P.settlePublicArea(this.room, { x: area.x, z: area.z, w: area.w, l: area.l }, id);
    // settlePublicArea may trim to resolve a clash. A move must not resize, so
    // its answer is taken only when it kept the size.
    if (Math.abs(snapped.w - area.w) < 0.001 && Math.abs(snapped.l - area.l) < 0.001
      && fits(snapped)) {
      area.x = snapped.x;
      area.z = snapped.z;
      return;
    }
    if (!this.publicAreaClashes(area, id)) return;   // where it is, is fine

    // Out of the way of whatever it landed on, by the shortest move.
    let best = null;
    for (const other of this.room.publicAreas || []) {
      if (other.id === id) continue;
      if (!this.publicAreaClashes(area, id)) break;
      for (const candidate of [
        { x: other.x - area.w, z: area.z },
        { x: other.x + other.w, z: area.z },
        { x: area.x, z: other.z - area.l },
        { x: area.x, z: other.z + other.l },
      ]) {
        const rect = { x: P.clean(candidate.x), z: P.clean(candidate.z), w: area.w, l: area.l };
        if (!fits(rect)) continue;
        const moved = Math.abs(rect.x - area.x) + Math.abs(rect.z - area.z);
        if (!best || moved < best.moved) best = { rect, moved };
      }
    }
    if (best) {
      area.x = best.rect.x;
      area.z = best.rect.z;
    }
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
};
