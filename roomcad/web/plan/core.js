// Units, constants and the small maths the rest of the model is built on.
//
// Part of the plan model; the public entry point is ../plan.js, which re-exports
// every module here.

// plan.js — room model and geometry for RoomCAD web.
// The room it builds is the .rcad document (ROOM_FILE_FORMAT below) and that is
// the only format there is: the 2D editor, the 3D walkthrough and the SVG
// export all read and write a room through the functions here.

export const GRID_STEPS = {
  oneCentimeter:   { label: "1 cm", meters: 0.01 },
  twoCentimeters:  { label: "2 cm", meters: 0.02 },
  fiveCentimeters: { label: "5 cm", meters: 0.05 },
};

export const FURNITURE_KINDS = {
  bed:      { title: "Bed",       category: "furniture", w: 0.90, d: 2.00, h: 0.90, color: [0.30, 0.65, 0.85], label: "BED", standHeight: 0.44 },
  table:    { title: "Table",     category: "furniture", w: 0.70, d: 0.70, h: 0.75, color: [0.95, 0.72, 0.22], label: "TABLE", standHeight: 0.75 },
  chair:    { title: "Chair",     category: "furniture", w: 0.45, d: 0.47, h: 0.82, color: [0.90, 0.38, 0.32], label: "CHAIR", standHeight: 0.50 },
  wardrobe: { title: "Wardrobe",  category: "furniture", w: 1.00, d: 0.60, h: 2.00, color: [0.82, 0.52, 0.28], label: "WARDROBE", standHeight: 2.00 },
  desk:     { title: "Desk",      category: "furniture", w: 1.20, d: 0.60, h: 0.75, color: [0.62, 0.42, 0.28], label: "DESK", standHeight: 0.75 },
  sofa:     { title: "Sofa",      category: "furniture", w: 1.80, d: 0.85, h: 0.85, color: [0.45, 0.55, 0.68], label: "SOFA", standHeight: 0.42 },
  shelf:    { title: "Bookshelf", category: "furniture", w: 0.80, d: 0.30, h: 1.80, color: [0.75, 0.58, 0.40], label: "SHELF", standHeight: 0 },
  nightstand: { title: "Nightstand", category: "furniture", w: 0.40, d: 0.35, h: 0.50, color: [0.55, 0.45, 0.35], label: "NIGHT", standHeight: 0.50 },
  dresser:  { title: "Dresser",   category: "furniture", w: 0.90, d: 0.45, h: 1.00, color: [0.48, 0.42, 0.55], label: "DRESSER", standHeight: 1.00 },
  armchair: { title: "Armchair",  category: "furniture", w: 0.75, d: 0.80, h: 0.90, color: [0.55, 0.40, 0.30], label: "ARMCHAIR", standHeight: 0.42 },
  light:      { title: "Bulb",        category: "fixture", w: 0.24, d: 0.24, h: 0.24, color: [0.98, 0.85, 0.35], label: "BULB",  standHeight: 0, ceiling: true, watts: 60 },
  lightPanel: { title: "Office Panel", category: "fixture", w: 0.60, d: 0.60, h: 0.06, color: [0.95, 0.97, 1.00], label: "PANEL", standHeight: 0, ceiling: true, watts: 200 },
};

export const WALL_THICKNESS = 0.10;
/// How far a wall end has to reach past a join to close it. A corner is only
/// solid once each wall crosses its neighbour's *half* thickness — anything
/// less leaves a notch of open air at the join, for the wall's full height.
export const WALL_JOIN_SEAL = 0.055; // WALL_THICKNESS / 2 + 5 mm overlap
export const SILL_HEIGHT = 0.90;
export const GLASS_HEIGHT = 1.00;
export const DOOR_HEIGHT = 2.10;
/// The shortest wall the editor will let you make: draw one this short and it
/// is refused, with the message the user sees. Every path that CREATES or
/// RESIZES a wall goes through this.
export const MIN_WALL_LENGTH = 0.30;
/// The shortest wall a loaded document may keep.
///
/// Lower than MIN_WALL_LENGTH on purpose, and it is not the same rule: this is
/// the stub threshold for repairing a file, not a constraint the editor
/// enforces. An older export, or a plan the generator once made, can hold a
/// 20 cm wall and it still opens; refusing to load it would throw away work to
/// enforce a drawing rule that did not exist when it was written.
export const MIN_WALL_LENGTH_KEPT = 0.15;
export const MIN_OPENING_WIDTH = { door: 0.6, window: 0.4 };
export const MAX_OPENING_WIDTH = { door: 1.4, window: 2.0 };
/// How close a wall end has to come to another wall before it locks onto it.
export const WALL_ATTACH_TOLERANCE = 0.35;
export const LABEL_DEFAULT_SIZE = 0.22;   // cap height in metres
export const ROOM_FILE_FORMAT = "com.maria.roomcad-v2.room";
export const ROOM_FILE_VERSION = 1;

/// Clamps `v` into [min, max]. A value that is not a finite number — a string
/// from a hand-edited file, a null from a peer running an older build, or a
/// NaN produced further up the chain — clamps to `min` rather than passing
/// through. sanitize() is built on this, so without the guard a single bad
/// field spreads NaN across every coordinate it touches and the document
/// cannot be repaired by re-sanitising it.
export function clamp(v, min, max) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(n, min), max);
}

/// The nearest quarter turn in [0, 360). Anything that is not a finite number
/// reads as no rotation at all.
export function quarterTurn(degrees) {
  const n = Number(degrees);
  if (!Number.isFinite(n)) return 0;
  return ((Math.round(n / 90) * 90) % 360 + 360) % 360;
}

export function clean(v) {
  return Math.round(v * 1000) / 1000;
}

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

export function point(x = 0, z = 0) {
  return { x, z };
}

export function distance(a, b) {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

export function cm(v) {
  return Math.round(v * 100) + " cm";
}
