// Closing the joints between walls, and cutting them at their junctions.
//
// Part of the plan model; the public entry point is ../plan.js, which re-exports
// every module here.

import { MIN_WALL_LENGTH, clean, point, uid } from "./core.js";
import { fitOpeningsToWalls, wallLength, wallPointAt } from "./walls.js";



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
