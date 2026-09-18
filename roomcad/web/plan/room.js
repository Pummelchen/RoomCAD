// The room object itself: a fresh one, and the rectangle it occupies.
//
// Part of the plan model; the public entry point is ../plan.js, which re-exports
// every module here.

import { point, uid } from "./core.js";


export function freshRoom(name = "My Room", width = 6, length = 4, height = 2.6) {
  return {
    id: uid(),
    name,
    width,
    length,
    height,
    // The buildable base plate (25 × 25 m by default). The room sits inside it
    // at `origin`, so it can be centred on the grid.
    canvas: { width: 25, length: 25 },
    origin: { x: 0, z: 0 },
    grid: "fiveCentimeters",
    walls: [
      { id: uid(), start: point(0, 0), end: point(width, 0) },
      { id: uid(), start: point(width, 0), end: point(width, length) },
      { id: uid(), start: point(width, length), end: point(0, length) },
      { id: uid(), start: point(0, length), end: point(0, 0) },
    ],
    doors: [],
    windows: [],
    furniture: [],
    publicAreas: [], // shared floor rectangles (living room, corridor…) excluded from auto-layout
    labels: [],      // free text placed on the plan
  };
}

/// The buildable base-plate bounds. Falls back to the main room for rooms
/// saved before the canvas existed.
export function canvasOf(room) {
  if (room.canvas && typeof room.canvas.width === "number" && typeof room.canvas.length === "number") {
    return room.canvas;
  }
  return { width: room.width, length: room.length };
}

/// The room's bottom-left corner on the canvas (0,0 for rooms saved before the
/// origin field existed).
export function roomOrigin(room) {
  if (room.origin && typeof room.origin.x === "number" && typeof room.origin.z === "number") {
    return room.origin;
  }
  return { x: 0, z: 0 };
}

/// Shifts the room's walls, furniture, labels and public areas so the room
/// footprint is centred on the canvas, and records the resulting origin.
///
/// Labels and public areas are canvas-absolute, not room-relative, so they have
/// to travel with the walls. They did not: resizing the plate — which goes
/// through here — moved the building and the furniture and left the user's own
/// text and green circulation floor at their old coordinates, sitting off the
/// room they were written about.
///
/// Openings are deliberately NOT moved. A door's `offset` is measured along its
/// wall, and a window's likewise, so moving the wall moves the opening with it.
/// Shifting an offset by dx would take it off the wall it belongs to.
export function centerRoom(room) {
  const canvas = canvasOf(room);
  const marginX = (canvas.width - room.width) / 2;
  const marginZ = (canvas.length - room.length) / 2;
  const prev = roomOrigin(room);
  const dx = marginX - prev.x;
  const dz = marginZ - prev.z;
  room.origin = { x: marginX, z: marginZ };
  if (dx !== 0 || dz !== 0) {
    room.walls = room.walls.map(w => ({
      ...w,
      start: { x: w.start.x + dx, z: w.start.z + dz },
      end: { x: w.end.x + dx, z: w.end.z + dz },
    }));
    room.furniture = room.furniture.map(f => ({
      ...f,
      center: { x: f.center.x + dx, z: f.center.z + dz },
    }));
    room.labels = (room.labels || []).map(l => ({
      ...l,
      center: { x: l.center.x + dx, z: l.center.z + dz },
    }));
    room.publicAreas = (room.publicAreas || []).map(a => ({
      ...a,
      x: a.x + dx,
      z: a.z + dz,
    }));
  }
  return room;
}
