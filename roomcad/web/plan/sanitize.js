// Repairing a loaded room: joint healing, junction splitting, extents, and the drop-what-cannot-be-fixed pass.
//
// Part of the plan model; the public entry point is ../plan.js, which re-exports
// every module here.

import { FURNITURE_KINDS, LABEL_DEFAULT_SIZE, MAX_OPENING_WIDTH, MIN_OPENING_WIDTH, MIN_WALL_LENGTH, MIN_WALL_LENGTH_KEPT, clamp, clean, point, quarterTurn, uid } from "./core.js";

/// What a repair pass had to do, so a load can say so instead of doing it behind
/// the user's back.
///
/// `sanitize()` always repaired and dropped in silence: a wall under 15 cm went,
/// a diagonal wall went, a door whose wall was too short for it went, and the
/// document opened looking intact. That is the one failure a repair pass must not
/// have. A plan that quietly lost a wall is a plan the user believes is whole, and
/// they will build on it, save it and print it without ever being told.
///
/// So the pass now returns what it did, in two lists:
///
///   dropped   things that are GONE. This is loss, and the app shows it.
///   repaired  things that were adjusted in place — clamped into the plate,
///             turned to a quarter, given a missing id, a joint healed. A
///             healed joint is invisible either way, so this is reported more
///             quietly, but it is still reported: "it opened" and "it opened
///             unchanged" are different facts.
///
/// Each entry is `{ what, why, count }`, and `describeReport()` turns the whole
/// thing into the sentence the user reads. The wording lives there rather than in
/// app.js so that it is testable without a browser.
function emptyReport() {
  return { dropped: [], repaired: [] };
}

const note = (list, what, why, count) => {
  if (count > 0) list.push({ what, why, count });
};

/// A one-line summary of a report, or "" when the document needed nothing.
///
/// Drops come first and are counted in full, because they are the part that
/// changes what the user has. Repairs are summarised, because a plan that was
/// merely tidied should not read as alarming.
export function describeReport(report) {
  if (!report) return "";
  const parts = [];
  const spell = list => list
    .map(e => (e.count === 1 ? `1 ${e.what} (${e.why})` : `${e.count} × ${e.what} (${e.why})`))
    .join(", ");
  if (report.dropped.length) parts.push(`dropped ${spell(report.dropped)}`);
  if (report.repaired.length) parts.push(`repaired ${spell(report.repaired)}`);
  return parts.join(" · ");
}

/// True when a report describes a document that came through untouched.
export function reportIsEmpty(report) {
  return !report || (report.dropped.length === 0 && report.repaired.length === 0);
}
import { fitOpeningsToWalls, wallLength, wallPointAt, wallsBounds } from "./walls.js";
import { healWallJoints } from "./heal.js";

export function sanitize(room) {
  const report = emptyReport();
  // Counted where the value is changed rather than by comparing the room before
  // and after: `fit` and `turn` notice for themselves, so a repair cannot happen
  // without being counted, and none can be counted that did not happen.
  const fitted = { plate: 0, wall: 0, opening: 0, furniture: 0, label: 0 };
  // A change smaller than this is not a repair, it is rounding. Casting a
  // coordinate through `clamp` can move it by 1e-17 — the demo room's own doors
  // do exactly that on one wall — and reporting that as "repaired an opening"
  // would cry wolf on every load, which is how a warning becomes wallpaper. A
  // hundredth of a millimetre is far below anything the editor can draw.
  const NOISE = 1e-9;
  const fit = (area, v, lo, hi) => {
    const out = clamp(v, lo, hi);
    if (Math.abs(out - v) > NOISE) fitted[area]++;
    return out;
  };
  let turned = 0;
  const turn = deg => {
    const out = quarterTurn(deg);
    if (out !== deg) turned++;
    return out;
  };
  let named = 0;
  const name = item => {
    if (item && item.id) return item;
    named++;
    return { ...item, id: uid() };
  };

  // `width` and `length` are measured, not stored settings: syncExtent() at the
  // end overwrites both with the bounds of the walls that are actually drawn.
  // So there is no room-size range to enforce here, and the 2..20 clamp that
  // used to sit here was undone by syncExtent on the very next step — it never
  // described the room the engine went on to use. What these fields must obey
  // before the walls are read is the PLATE's own range, not a room range: they
  // seed the canvas for a document that has none and the canvas may never be
  // smaller than the room, so a corrupt 1e9 here would grow the plate without
  // limit. 60 m is the canvas's own maximum. A plan that draws no walls keeps
  // the size it stored, since there is nothing to measure.
  room.width = fit("plate", room.width, 2, 60);
  room.length = fit("plate", room.length, 2, 60);
  room.height = fit("plate", room.height, 2.2, 5);

  // Canvas: the buildable base plate. Always at least as large as the main
  // room so walls and furniture drawn outside it stay reachable.
  if (!room.canvas) room.canvas = { width: room.width, length: room.length };
  room.canvas.width = fit("plate", room.canvas.width, 2, 60);
  room.canvas.length = fit("plate", room.canvas.length, 2, 60);
  if (room.canvas.width < room.width) {
    fitted.plate++;
    room.canvas.width = room.width;
  }
  if (room.canvas.length < room.length) {
    fitted.plate++;
    room.canvas.length = room.length;
  }
  const canvas = room.canvas;

  // Room origin on the canvas (defaults to the top-left corner for old files).
  if (!room.origin) room.origin = { x: 0, z: 0 };
  room.origin.x = fit("plate", room.origin.x, 0, canvas.width);
  room.origin.z = fit("plate", room.origin.z, 0, canvas.length);

  // Identity first. Everything downstream — an opening finding its wall, a
  // dimension line finding its opening, a grab handle finding what it drags —
  // looks objects up by id. A document that reaches us without them (an older
  // export, a hand-edited file) would otherwise have every id-less object
  // resolve to the *first* one, so two doors would draw one dimension on top
  // of each other and the second would get none.
  room.walls = room.walls.map(name);
  const firstWallID = room.walls.length ? room.walls[0].id : null;
  const withOpeningID = o => {
    const next = name(o);
    // Preserve what a document without wallIDs used to resolve to, rather than
    // silently dropping its openings now that wall ids are always distinct.
    return next.wallID === undefined ? { ...next, wallID: firstWallID } : next;
  };
  room.doors = room.doors.map(withOpeningID);
  room.windows = room.windows.map(withOpeningID);
  room.furniture = room.furniture.map(name);

  // The walls, in the order the original chained: drop the stubs, clamp every
  // endpoint into the plate, THEN drop what is still not rectilinear. The order
  // matters and is kept — clamping can bring two far-out coordinates onto the
  // same value, which is exactly what turns a diagonal wall into a straight one,
  // so testing for diagonals before the clamp would keep a wall this used to
  // drop. It is written as three steps rather than one chain so each drop can be
  // counted where it happens.
  let stubs = 0;
  let diagonals = 0;
  const removedStubs = new Set();
  const removedDiagonals = new Set();
  const upright = [];
  for (const w of room.walls) {
    if (wallLength(w) < MIN_WALL_LENGTH_KEPT) {
      stubs++;
      removedStubs.add(w.id);
      continue;
    }
    upright.push({
      ...w,
      start: {
        x: fit("wall", w.start.x, 0, canvas.width),
        z: fit("wall", w.start.z, 0, canvas.length),
      },
      end: {
        x: fit("wall", w.end.x, 0, canvas.width),
        z: fit("wall", w.end.z, 0, canvas.length),
      },
    });
  }
  // This model has no diagonal walls. detectRooms() reads the plan off a grid
  // built from wall ENDPOINTS, which only works when every wall lies on one
  // of its two lines, and the 3D collider builds an axis-aligned box per wall.
  // A wall with both dx and dz is therefore a shape nothing downstream can
  // represent — left in, it silently corrupts the room count and the physics
  // rather than failing. It cannot be repaired without inventing geometry the
  // file did not draw: snapping one end to the other's line means choosing an
  // end, and either choice can tear a join apart. So it is dropped, exactly
  // as a stub wall or a label with no centre is, and the plan around it still
  // opens. `1e-6` is the tolerance healWallJoints and splitWallsAtJunctions
  // already use for "this wall is axis-aligned"; the paths the UI draws and
  // drags through (axisAligned, dragWall) only ever produce exactly-equal
  // coordinates, so a rectilinear plan passes through here untouched and
  // running sanitize twice drops nothing more.
  room.walls = upright.filter(w => {
    const straight = Math.abs(w.end.x - w.start.x) < 1e-6 || Math.abs(w.end.z - w.start.z) < 1e-6;
    if (!straight) {
      diagonals++;
      removedDiagonals.add(w.id);
    }
    return straight;
  });
  // Close the joints before anything downstream asks what the walls enclose.
  // Every path into the model comes through here — drawing, dragging, loading,
  // undo — so a room that looks closed is closed by the time it is measured.
  // Healed joints are counted by watching which walls move, because healWallJoints
  // repairs in place and reports nothing.
  const beforeHeal = room.walls.map(w => [w.start.x, w.start.z, w.end.x, w.end.z]);
  healWallJoints(room);
  let healed = 0;
  if (room.walls.length === beforeHeal.length) {
    room.walls.forEach((w, i) => {
      const was = beforeHeal[i];
      if (was[0] !== w.start.x || was[1] !== w.start.z || was[2] !== w.end.x || was[3] !== w.end.z) healed++;
    });
  }
  note(report.dropped, "wall", `shorter than ${MIN_WALL_LENGTH_KEPT * 100} cm`, stubs);
  note(report.dropped, "wall", "drawn at an angle, which this model cannot hold", diagonals);
  note(report.repaired, "wall joint", "closed up", healed);
  // Note that the walls are NOT cut at their junctions here. Cutting is what an
  // EDIT does, not what reading a file does: sanitize runs on every load, and a
  // load that changes the plan means the plan you saved is not the plan you get
  // back. See splitWallsAtJunctions, which the store calls when an edit lands.
  const wallIDs = new Set(room.walls.map(w => w.id));

  const fittedDoors = room.doors.map(d => ({
      ...d,
      width: fit("opening", d.width, MIN_OPENING_WIDTH.door, MAX_OPENING_WIDTH.door),
      open: d.open === undefined ? true : !!d.open,
      swingInside: d.swingInside === undefined ? true : !!d.swingInside,
      // Which end of the opening the hinge is on. Absent in older files, which
      // were all hinged at the start.
      hingeAtEnd: !!d.hingeAtEnd,
    }));
  let doorsWallGone = 0;
  let doorsWallShort = 0;
  let doorsWallRemoved = 0;
  room.doors = fittedDoors.filter(d => {
    if (!wallIDs.has(d.wallID)) {
      if (removedStubs.has(d.wallID) || removedDiagonals.has(d.wallID)) doorsWallRemoved++;
      else doorsWallGone++;
      return false;
    }
    const w = room.walls.find(x => x.id === d.wallID);
    if (w && wallLength(w) >= d.width + 0.2) return true;
    doorsWallShort++;
    return false;
  });
  room.doors.forEach(d => {
    const w = room.walls.find(x => x.id === d.wallID);
    if (w) d.offset = fit("opening", d.offset, 0.10, wallLength(w) - d.width - 0.10);
  });

  const fittedWindows = room.windows
    .map(w => ({ ...w, width: fit("opening", w.width, MIN_OPENING_WIDTH.window, MAX_OPENING_WIDTH.window) }));
  let windowsWallGone = 0;
  let windowsWallShort = 0;
  let windowsWallRemoved = 0;
  room.windows = fittedWindows.filter(w => {
    if (!wallIDs.has(w.wallID)) {
      if (removedStubs.has(w.wallID) || removedDiagonals.has(w.wallID)) windowsWallRemoved++;
      else windowsWallGone++;
      return false;
    }
    const wall = room.walls.find(x => x.id === w.wallID);
    if (wall && wallLength(wall) >= w.width + 0.2) return true;
    windowsWallShort++;
    return false;
  });
  room.windows.forEach(w => {
    const wall = room.walls.find(x => x.id === w.wallID);
    if (wall) w.offset = fit("opening", w.offset, 0.10, wallLength(wall) - w.width - 0.10);
  });

  // A kind with no palette entry — a typo in a hand-edited file, or a piece from
  // a newer build — has no width, depth or height, and reading those was a
  // TypeError part-way through loading: the whole document lost over one name,
  // which is the one failure a repair pass must not have. There is no footprint
  // to fall back on without inventing one, so the item is dropped, the way a stub
  // wall or a door on a wall too short for it already is, and the rest of the
  // plan still opens.
  const knownKinds = room.furniture.filter(item => FURNITURE_KINDS[item.kind]);
  const unknownKinds = room.furniture.length - knownKinds.length;
  room.furniture = knownKinds.map(item => {
      item.rotationDegrees = turn(item.rotationDegrees);
      const kind = FURNITURE_KINDS[item.kind];
      const swaps = item.rotationDegrees === 90 || item.rotationDegrees === 270;
      const w = swaps ? kind.d : kind.w;
      const d = swaps ? kind.w : kind.d;
      item.center = {
        x: fit("furniture", item.center.x, w / 2, canvas.width - w / 2),
        z: fit("furniture", item.center.z, d / 2, canvas.length - d / 2),
      };
      return item;
    });

  room.publicAreas = (room.publicAreas || []).map(a => {
    const w = clamp(a.w, 0.5, canvas.width);
    const l = clamp(a.l, 0.5, canvas.length);
    return {
      // Areas saved before they were selectable have no id; give them one so
      // selection survives edits that reorder the list.
      id: a.id || uid(),
      x: clamp(a.x, 0, canvas.width - w),
      z: clamp(a.z, 0, canvas.length - l),
      w,
      l,
      // Walk paths the layout generator carved. Kept apart from floor the user
      // marked so a re-run reclaims its own corridors and never eats theirs.
      ...(a.generated ? { generated: true } : {}),
    };
  });

  const labelList = room.labels || [];
  const centred = labelList.filter(l => l && l.center && typeof l.center.x === "number");
  const uncentred = labelList.length - centred.length;
  room.labels = centred
    .map(l => ({
      id: l.id || uid(),
      text: String(l.text === undefined ? "" : l.text).slice(0, 60),
      center: {
        x: fit("label", l.center.x, 0, canvas.width),
        z: fit("label", l.center.z, 0, canvas.length),
      },
      rotationDegrees: turn(l.rotationDegrees),
      size: fit("label", Number(l.size) || LABEL_DEFAULT_SIZE, 0.08, 1.0),
    }));

  // ── What the pass did ──────────────────────────────────────────────────
  note(report.dropped, "door", "on a wall that is not in the document", doorsWallGone);
  note(report.dropped, "door", "on a wall that was removed as too short or angled", doorsWallRemoved);
  note(report.dropped, "door", "on a wall too short to hold it", doorsWallShort);
  note(report.dropped, "window", "on a wall that is not in the document", windowsWallGone);
  note(report.dropped, "window", "on a wall that was removed as too short or angled", windowsWallRemoved);
  note(report.dropped, "window", "on a wall too short to hold it", windowsWallShort);
  note(report.dropped, "piece of furniture", "of a kind this build does not know", unknownKinds);
  note(report.dropped, "label", "with no position", uncentred);
  note(report.repaired, "id", "filled in for an object that had none", named);
  note(report.repaired, "measurement", "clamped into the plate",
    fitted.plate + fitted.wall + fitted.furniture + fitted.label);
  note(report.repaired, "opening", "resized or moved to fit its wall", fitted.opening);
  note(report.repaired, "rotation", "turned to a quarter turn", turned);

  syncExtent(room);
  return report;
}

/// Makes `origin`, `width` and `length` describe the walls that are actually
/// drawn, rather than being a size someone typed once.
///
/// They used to be stored independently, so editing them moved no walls and
/// editing walls moved no numbers. The two drifted apart, and because the room
/// generator, the SVG title block and the 3D view all size themselves from
/// these fields, a plan could be laid out, printed and walked in a rectangle
/// that had nothing to do with the building. Deriving them here — the one place
/// every edit passes through — makes that impossible.
///
/// For anything other than a plain rectangle this is the overall extent, which
/// is what those consumers need. The floor actually enclosed is floorArea().
export function syncExtent(room) {
  const bounds = wallsBounds(room);
  if (!bounds) return;                    // nothing drawn: keep what was stored
  const width = clean(bounds.maxX - bounds.minX);
  const length = clean(bounds.maxZ - bounds.minZ);
  if (width < 0.01 || length < 0.01) return;
  room.origin = { x: clean(bounds.minX), z: clean(bounds.minZ) };
  room.width = width;
  room.length = length;
}
