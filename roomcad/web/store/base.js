// The store's initial state, and the two small things exported beside it.
//
// Part of the store; the public entry point is ../store.js, which composes
// every file here into one object. Import from there, not from here.

import * as P from "../plan.js";

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
  rooms: "Drag a box over rooms to select them, then even out their sizes",
};

/// An hour as a 24 h clock reading, to the minute: 19.5 is "19:30".
export function clockText(hour) {
  const minutes = Math.round((((hour % 24) + 24) % 24) * 60);
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

/// A fresh store state. A FUNCTION, not an object, because the store can be
/// created more than once: tests build several to stand for several people, and
/// a module-level object would be shared by all of them — which is exactly the
/// bug the old query-string trick hid (`store.js?client=2` gave a new FACADE
/// while its dependencies, and so this state, stayed the one instance).
export function freshState() {
  return {

  room: P.demoRoom(),
  mode: "2d", // "2d" | "3d"
  tool: "select",
  pendingFurnitureKind: null,
  /// Which way round the piece being placed is, before it is put down.
  ///
  /// A bed picked up from the palette followed the cursor at 0° and could only
  /// be turned after it had been dropped — so placing one along a wall meant
  /// drop, turn, drag back. R turns it while it is still in the air, and the
  /// ghost shows which way it will land.
  pendingFurnitureRotation: 0,
  lastFurnitureKind: null,
  rotation: 0, // 2D plan view rotation in degrees (0/90/180/270)
  floor: 2, // which building floor the room is on (1 = ground floor)
  selectedWallID: null,
  selectedDoorID: null,
  selectedWindowID: null,
  selectedFurnitureID: null,
  selectedLabelID: null,
  selectedPublicID: null,
  // The box last dragged with the Rooms tool. The rooms it covers are worked
  // out from the walls each time rather than stored, so the selection cannot
  // go stale when the plan changes underneath it.
  roomSelection: null,
  documentName: null,
  serverRoomName: null, // the ternak_roomN slot this room was opened from (if any)
  serverRoomVersion: null, // the current save version of that slot
  live: false, // real-time (unsaved) collaboration with teammates
  presenceCount: 1, // how many browser sessions are connected (from /api/status)
  serverLatency: null, // round-trip ms to the server (from the status poll)
  serverOffline: false, // true only after a status poll actually failed (network)
  timeOfDay: 15, // hour of day (0–24, 24 h clock) driving the 3D sun + city lights
  weather: "clear", // "clear" | "cloudy" | "rain" | "snow" — drives the 3D sky, fog and city
  layoutSeed: 1, // seed for the auto room layout; "redesign" bumps it for a new variant
  layoutCount: 3, // how many private rooms to generate
  layoutArea: 12, // smallest m² a room may be — decides how many fit
  layoutWindows: false, // add one window per room (only on outside-facing walls)
  edited: false,
  status: "Ready",
  undoStack: [],
  redoStack: [],
  dragTransactionActive: false,
  /// The oldest undo entry `beginDrag` had to evict when the stack was already
  /// at the 100 cap. A drag that is DISCARDED — a click-select is exactly that —
  /// has to put it back, or clicking around quietly evicts real history.
  dragDroppedEntry: null,
  /// How a public area being dragged reads: "valid", or "invalid" while it is
  /// lying on top of another one. Cleared when it is put down.
  publicFeedback: null,
  /// Whether the outside walls are held still.
  ///
  /// They are, by default: editing the inside of a plan should not reshape the
  /// building by accident. But which walls face outwards is worked out from the
  /// plan, so a wall that was an inside wall becomes an outside one the moment
  /// the room beyond it opens up — and locks itself, with no obvious reason and
  /// nothing the user did. This frees the lot in one place for people who would
  /// rather just draw. A view setting, not part of the plan: it says how you
  /// want to work, not what the building is.
  outsideWallsFree: false,
  furnitureFeedback: null, // { id, state: "valid" | "invalid" } during move/rotate
  furnitureGaps: null,     // { wall: {cm,dir}, furniture: {cm,kind} } for the selected/moving item
  feedbackTimer: null,
  listeners: new Set(),
  };
}
