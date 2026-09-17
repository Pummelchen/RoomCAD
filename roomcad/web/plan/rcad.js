// The .rcad document format: slug, serialize, parse.
//
// Part of the plan model; the public entry point is ../plan.js, which re-exports
// every module here.

import { GRID_STEPS, ROOM_FILE_FORMAT, ROOM_FILE_VERSION, uid } from "./core.js";
import { sanitize } from "./sanitize.js";


// MARK: - Room files (the .rcad document format)

/// The server file name for a room name. The Room Name IS the file: renaming a
/// design and saving it starts a new one rather than adding a version to the
/// old.
///
/// Server names are limited to [A-Za-z0-9_-], so accents are folded to their
/// base letter (Küche -> Kuche) rather than dropped, and every other run of
/// characters becomes a single dash. An empty result means "no name yet", and
/// the server allocates the next ternak_roomN.
export function roomSlug(name) {
  return String(name == null ? "" : name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 48)
    .replace(/[-_]+$/, "");   // the cap can land mid-word and leave a trailing dash
}

export function serializeRoom(room) {
  return JSON.stringify(
    { format: ROOM_FILE_FORMAT, version: ROOM_FILE_VERSION, room },
    null,
    2
  );
}

/// Reads a .rcad document into a room, and repairs what cannot be loaded.
///
/// `report` is an optional object to fill with what `sanitize()` had to do — see
/// there for why a load is not allowed to keep that to itself. It is a sink
/// rather than something returned, because every caller already wants the room
/// and the room is what the function is for. It is NOT attached to the room:
/// `serializeRoom()` writes the whole object, so a note hung on the room would
/// travel into the next save and be read back as part of the document.
export function parseRoom(text, report = null) {
  const data = JSON.parse(text);
  if (!data || data.format !== ROOM_FILE_FORMAT) {
    throw new Error("This is not a RoomCAD room file.");
  }
  if (data.version > ROOM_FILE_VERSION) {
    throw new Error("This room uses a newer format version.");
  }
  const room = data.room;
  if (!room || typeof room !== "object") {
    throw new Error("This file does not contain a room.");
  }
  room.id = room.id || uid();
  room.name = room.name || "My Room";
  room.width = Number(room.width) || 6;
  room.length = Number(room.length) || 4;
  room.height = Number(room.height) || 2.6;
  room.grid = GRID_STEPS[room.grid] ? room.grid : "fiveCentimeters";
  room.walls = Array.isArray(room.walls) ? room.walls : [];
  room.doors = Array.isArray(room.doors) ? room.doors : [];
  room.windows = Array.isArray(room.windows) ? room.windows : [];
  room.furniture = Array.isArray(room.furniture) ? room.furniture : [];
  room.publicAreas = Array.isArray(room.publicAreas) ? room.publicAreas : [];
  room.labels = Array.isArray(room.labels) ? room.labels : [];
  const did = sanitize(room);
  if (report) {
    report.dropped = did.dropped;
    report.repaired = did.repaired;
  }
  return room;
}
