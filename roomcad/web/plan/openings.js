// Doors and windows as draggable segments, public floor areas, and the wall slices the 3D view builds.
//
// Part of the plan model; the public entry point is ../plan.js, which re-exports
// every module here.

import { GRID_STEPS, MAX_OPENING_WIDTH, MIN_OPENING_WIDTH, clamp, clean } from "./core.js";
import { canvasOf } from "./room.js";
import { wallLength, wallPointAt, wallProjection } from "./walls.js";


// MARK: - Opening spacing

export function openingSpacing(room, id, kind) {
  const o = kind === "door" ? room.doors.find(d => d.id === id) : room.windows.find(w => w.id === id);
  if (!o) return null;
  const wall = room.walls.find(w => w.id === o.wallID);
  if (!wall) return null;
  const others = [];
  room.doors.forEach(d => {
    if (d.wallID === o.wallID && d.id !== id) others.push({ offset: d.offset, width: d.width });
  });
  room.windows.forEach(w => {
    if (w.wallID === o.wallID && w.id !== id) others.push({ offset: w.offset, width: w.width });
  });
  const previous = others.filter(x => x.offset + x.width <= o.offset)
    .sort((a, b) => a.offset - b.offset).pop();
  const next = others.filter(x => x.offset >= o.offset + o.width)
    .sort((a, b) => a.offset - b.offset)[0];
  return {
    toWallStart: o.offset,
    toWallEnd: wallLength(wall) - o.offset - o.width,
    gapToPrevious: previous ? o.offset - (previous.offset + previous.width) : null,
    gapToNext: next ? next.offset - (o.offset + o.width) : null,
  };
}

export function openingWall(room, id, kind) {
  const o = kind === "door" ? room.doors.find(d => d.id === id) : room.windows.find(w => w.id === id);
  return o ? room.walls.find(w => w.id === o.wallID) || null : null;
}

// MARK: - Wall slicing for the 3D view

export function solidSpans(length, cuts) {
  const spans = [];
  let cursor = 0;
  const sorted = [...cuts].sort((a, b) => a.from - b.from);
  for (const cut of sorted) {
    const from = Math.max(cut.from, cursor);
    const to = Math.min(cut.to, length);
    if (from > cursor) spans.push({ from: cursor, to: Math.min(from, length) });
    cursor = Math.max(cursor, to);
  }
  if (cursor < length) spans.push({ from: cursor, to: length });
  return spans;
}

export function wallBuildPlan(wall, doors, windows, height) {
  const doorSpans = doors
    .filter(d => d.wallID === wall.id)
    .sort((a, b) => a.offset - b.offset)
    .map(d => ({ from: d.offset, to: d.offset + d.width }));
  const windowSpans = windows
    .filter(w => w.wallID === wall.id)
    .sort((a, b) => a.offset - b.offset)
    .map(w => ({ from: w.offset, to: w.offset + w.width }));
  const length = wallLength(wall);
  return {
    doorSpans,
    windowSpans,
    baseSpans: solidSpans(length, doorSpans),
    midSpans: solidSpans(length, [...doorSpans, ...windowSpans]),
    glassSpans: windowSpans,
    stripSpans: windowSpans,
    headerSpan: { from: 0, to: length },
    doorLeafSpans: doorSpans,
  };
}

// MARK: - Openings as draggable segments

/// The two plan points where an opening meets its wall. These are what the 2D
/// editor puts grab handles on.
export function openingEndpoints(room, kind, id) {
  const list = kind === "door" ? room.doors : room.windows;
  const o = list.find(x => x.id === id);
  if (!o) return null;
  const wall = room.walls.find(w => w.id === o.wallID);
  if (!wall) return null;
  return {
    wall,
    start: wallPointAt(wall, o.offset),
    end: wallPointAt(wall, o.offset + o.width),
  };
}

/// Moves one end of an opening to `raw`, keeping the other end where it is.
/// Returns the new `{ offset, width }`, clamped to the opening's legal width
/// and to the 10 cm of wall that has to remain at each end.
export function resizeOpeningEnd(room, kind, id, which, raw) {
  const list = kind === "door" ? room.doors : room.windows;
  const o = list.find(x => x.id === id);
  if (!o) return null;
  const wall = room.walls.find(w => w.id === o.wallID);
  if (!wall) return null;
  const wallLen = wallLength(wall);
  const minW = MIN_OPENING_WIDTH[kind];
  const maxW = MAX_OPENING_WIDTH[kind];
  const step = GRID_STEPS[room.grid].meters;
  const along = clamp(clean(Math.round(wallProjection(wall, raw).offset / step) * step), 0.10, wallLen - 0.10);

  if (which === "start") {
    const fixedEnd = o.offset + o.width;
    const width = clamp(fixedEnd - along, minW, Math.min(maxW, fixedEnd - 0.10));
    return { offset: clean(fixedEnd - width), width: clean(width) };
  }
  const fixedStart = o.offset;
  const width = clamp(along - fixedStart, minW, Math.min(maxW, wallLen - 0.10 - fixedStart));
  return { offset: clean(fixedStart), width: clean(width) };
}

// MARK: - Public areas

export function publicAreaAt(room, p) {
  const areas = room.publicAreas || [];
  // Topmost first, so the most recently drawn area wins an overlap.
  for (let i = areas.length - 1; i >= 0; i--) {
    const a = areas[i];
    if (p.x >= a.x && p.x <= a.x + a.w && p.z >= a.z && p.z <= a.z + a.l) return a;
  }
  return null;
}

/// The four draggable corners of a public area, in a fixed order.
export function publicAreaCorners(a) {
  return [
    { corner: "nw", x: a.x, z: a.z },
    { corner: "ne", x: a.x + a.w, z: a.z },
    { corner: "se", x: a.x + a.w, z: a.z + a.l },
    { corner: "sw", x: a.x, z: a.z + a.l },
  ];
}

/// Moves one corner of a public area, keeping the opposite corner pinned.
export function resizePublicArea(a, corner, raw, room) {
  const canvas = canvasOf(room);
  const step = GRID_STEPS[room.grid].meters;
  const snap = v => clean(Math.round(v / step) * step);
  const x0 = corner === "nw" || corner === "sw" ? snap(raw.x) : a.x;
  const x1 = corner === "ne" || corner === "se" ? snap(raw.x) : a.x + a.w;
  const z0 = corner === "nw" || corner === "ne" ? snap(raw.z) : a.z;
  const z1 = corner === "sw" || corner === "se" ? snap(raw.z) : a.z + a.l;
  const minX = clamp(Math.min(x0, x1), 0, canvas.width);
  const maxX = clamp(Math.max(x0, x1), 0, canvas.width);
  const minZ = clamp(Math.min(z0, z1), 0, canvas.length);
  const maxZ = clamp(Math.max(z0, z1), 0, canvas.length);
  return {
    x: minX, z: minZ,
    w: Math.max(0.5, clean(maxX - minX)),
    l: Math.max(0.5, clean(maxZ - minZ)),
  };
}
