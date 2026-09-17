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


// MARK: - Sanitizing

/// How far a wall end may be from the wall it plainly meets and still be
/// treated as meeting it.
///
/// Two centimetres. Below that a gap is not a decision anybody made — it is
/// what is left when a wall lands on a grid line half a centimetre from the
/// wall it was drawn up to, or when the plate is resized to a size the grid
/// does not divide. Above it, a gap is a doorway or a deliberate slot and is
/// left alone.
export const JOINT_HEAL_TOLERANCE = 0.02;

/// How close a wall being DRAGGED has to come before it sticks to the wall it
/// is heading for.
///
/// Drawing a wall against another one locks onto it from 35 cm away, because
/// that is the whole idea: you draw roughly and the walls meet exactly. A wall
/// being dragged had no such thing — it went precisely where the pointer left
/// it, which is how a room came to be five millimetres from closed. Six
/// centimetres is close enough to be plainly aimed at the wall and far enough
/// that a wall deliberately set a hand's width away stays there.
export const WALL_DRAG_SNAP = 0.06;

/// Closes hairline gaps where a wall stops just short of another one.
///
/// A room is enclosed or it is not, and the difference can be five millimetres
/// nobody can see: a plan that plainly shows four walls round a room reported
/// one region of eighty square metres, because two of the walls stopped 5 mm
/// from the wall they met. No area label, no room in the count, and nothing on
/// screen to explain why.
///
/// Only the coordinate ACROSS the wall is moved, so a wall never goes diagonal
/// to close a gap, and only when the end lies within the span of the wall it is
/// reaching — a wall pointing at empty space stays where it is.
export function healWallJoints(room, opts = {}) {
  // Until it settles. Closing one joint can bring another end within reach —
  // pull a wall onto the line it meets and the wall joined to ITS far end
  // moves with it — so a single pass leaves work behind, and a plan that heals
  // further every time it is loaded is a plan that never comes back the same
  // way twice.
  let total = 0;
  for (let pass = 0; pass < 4; pass++) {
    const moved = healPass(room, opts);
    total += moved;
    if (!moved) break;
  }
  return total;
}

function healPass(room, { only = null, tolerance = JOINT_HEAL_TOLERANCE } = {}) {
  const walls = room.walls || [];
  let healed = 0;
  for (const wall of walls) {
    // `only` is the walls a drag has just moved. Everything else stays where it
    // is: a wall being dragged past another should stick to it, but the wall it
    // passes must not come away from where it was drawn.
    if (only && !only.has(wall.id)) continue;
    const vertical = Math.abs(wall.start.x - wall.end.x) < 1e-6;
    const horizontal = Math.abs(wall.start.z - wall.end.z) < 1e-6;
    if (vertical === horizontal) continue;           // diagonal: leave it alone
    for (const end of [wall.start, wall.end]) {
      for (const other of walls) {
        if (other === wall) continue;
        const otherVertical = Math.abs(other.start.x - other.end.x) < 1e-6;
        const otherHorizontal = Math.abs(other.start.z - other.end.z) < 1e-6;
        if (otherVertical === otherHorizontal) continue;
        // A wall can only be closed onto one running the other way.
        if (otherVertical === vertical) continue;
        const axis = otherVertical ? "x" : "z";
        const along = otherVertical ? "z" : "x";
        const line = other.start[axis];
        const lo = Math.min(other.start[along], other.end[along]);
        const hi = Math.max(other.start[along], other.end[along]);
        const gap = Math.abs(end[axis] - line);
        if (gap < 1e-9 || gap > tolerance) continue;
        if (end[along] < lo - tolerance || end[along] > hi + tolerance) continue;
        end[axis] = clean(line);
        healed++;
        break;
      }
    }
  }
  return healed;
}

/// Cuts a wall wherever another wall meets it, so one wall is one room's wall.
///
/// The way a plan gets drawn: one long wall across the whole space to set the
/// shape, then dividers to make it into rooms. The long wall stayed a single
/// nine-metre wall, so a door in the middle room belonged to a wall spanning
/// all three — it measured its position from the far end of the building, and
/// dragging it ran the length of the floor. The drawing said three rooms and
/// the model said one wall.
///
/// So the model is brought into line with the drawing: where a wall's end lands
/// on another wall, that wall is cut there. Nothing moves and nothing is drawn
/// differently — a wall and its pieces occupy exactly the same line — but every
/// door, window and measurement afterwards belongs to the wall of ITS room.
///
/// Two things are left alone. A cut closer than a wall's minimum length to
/// either end would make a stub that sanitize drops on the next load, and a cut
/// inside a door or window would slice the opening in half, so neither is made.
export function splitWallsAtJunctions(room) {
  const walls = room.walls || [];
  const openings = [...(room.doors || []), ...(room.windows || [])];
  const out = [];
  let split = 0;

  for (const wall of walls) {
    const vertical = Math.abs(wall.start.x - wall.end.x) < 1e-6;
    const horizontal = Math.abs(wall.start.z - wall.end.z) < 1e-6;
    if (vertical === horizontal) { out.push(wall); continue; }
    const axis = vertical ? "z" : "x";
    const fixed = vertical ? "x" : "z";
    const from = wall.start[axis];
    const to = wall.end[axis];
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const line = wall.start[fixed];

    // Where other walls meet this one, as distances along it from its start.
    const cuts = [];
    for (const other of walls) {
      if (other === wall) continue;
      for (const end of [other.start, other.end]) {
        if (Math.abs(end[fixed] - line) > 1e-6) continue;
        if (end[axis] <= lo + MIN_WALL_LENGTH || end[axis] >= hi - MIN_WALL_LENGTH) continue;
        const at = Math.abs(end[axis] - from);
        if (cuts.some(c => Math.abs(c - at) < 1e-6)) continue;
        cuts.push(at);
      }
    }
    if (!cuts.length) { out.push(wall); continue; }

    // Not through an opening: that would leave half a door on each piece.
    const mine = openings.filter(o => o.wallID === wall.id);
    const usable = cuts
      .filter(at => !mine.some(o => at > o.offset - 0.02 && at < o.offset + o.width + 0.02))
      .sort((a, b) => a - b);
    if (!usable.length) { out.push(wall); continue; }

    // Two cuts can crowd each other even when each is far from the wall's own
    // ends: two junctions 4 cm apart left a 4 cm piece between them, and
    // sanitize drops anything under 15 cm on the next load, so that boundary
    // became a hole and two rooms merged. A cut is therefore only made when it
    // leaves a whole wall between it and the last one accepted. The junction it
    // skips is not lost — the wall still meets this one part-way along, which is
    // exactly a T-junction. MIN_WALL_LENGTH rather than sanitize's 15 cm, to
    // match the end guard above: a cut piece should be a wall you could draw.
    const spaced = [];
    for (const at of usable) {
      if (at - (spaced.length ? spaced[spaced.length - 1] : 0) < MIN_WALL_LENGTH) continue;
      spaced.push(at);
    }
    if (!spaced.length) { out.push(wall); continue; }

    const marks = [0, ...spaced, wallLength(wall)];
    const pieces = [];
    for (let i = 0; i < marks.length - 1; i++) {
      const a = wallPointAt(wall, marks[i]);
      const b = wallPointAt(wall, marks[i + 1]);
      pieces.push({
        ...wall,
        // The first piece keeps the wall's identity, so a selection, an undo
        // step or an opening that is already on it still means something.
        id: i === 0 ? wall.id : uid(),
        start: point(clean(a.x), clean(a.z)),
        end: point(clean(b.x), clean(b.z)),
      });
      if (i > 0) split++;
    }
    out.push(...pieces);

    // Each opening goes to exactly one piece: the one its MIDDLE lies on.
    //
    // Chosen for it rather than offered to each piece in turn, so there is no
    // way for two to take it or for none to. By the middle rather than by
    // fitting entirely, because an opening left over from an earlier edit can
    // hang past the end of its wall, and it still has to land somewhere — left
    // behind, it keeps an offset measured from the uncut wall, and the next
    // load quietly pulls it back. A plan that changes on its way through a save
    // is the one thing a plan may never do.
    for (const o of mine) {
      const middle = o.offset + o.width / 2;
      let at = 0;
      while (at < pieces.length - 1 && middle > marks[at + 1] + 1e-6) at++;
      o.wallID = pieces[at].id;
      o.offset = o.offset - marks[at];
    }
  }

  room.walls = out;
  // Settle the openings with the same code a load uses, rather than clamping
  // them here. Doing the same arithmetic a different way gave 1.155 on the way
  // out and 1.1549999999999994 on the way back, and a plan that changes on its
  // way through a save is a plan you cannot trust.
  fitOpeningsToWalls(room);
  return split;
}

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
