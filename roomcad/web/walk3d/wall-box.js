// The collider box for a run of wall — see the comment on wallRunBox for why it
// exists and what it replaced.
//
// Part of walk3d.js, split under roomcad/web/walk3d/.


/// The box to give a run of wall, as half-extents in x and z plus the rotation
/// that turns the box to lie along the run.
///
/// Callers build `cuboid(hx, <half height>, hz)` with it. This replaces an
/// "is the wall horizontal?" test that picked between two axis-aligned boxes:
///
///     const horizontal = Math.abs(dz) < 0.001;
///     const desc = horizontal ? cuboid(len/2, h, t/2) : cuboid(t/2, h, len/2);
///
/// Read that `else` as what it is — an ASSUMPTION, not a guard. Anything that is
/// not horizontal is treated as vertical, so a run at any other angle got a box
/// pointing the wrong way: solid where the wall is not, and passable where it
/// is. `sanitize()` drops a diagonal wall on load, so nothing in this app could
/// reach that; which is the reason it was never noticed, and not a reason for
/// the collider to depend on another module's filter to be correct.
///
/// The two axis-aligned cases are left EXACTLY as they were, unrotated, because
/// those are the only runs this app produces and a rotation would be a change to
/// the geometry of every wall in every room for no gain. Only a run that is
/// genuinely neither gets a real angle, which is the case that used to be wrong.
// AXIS_EPS is a module-level constant like the rest, so it moved to
// constants.js with them.
import { AXIS_EPS } from "./constants.js";

export function wallRunBox(ax, az, bx, bz, thickness) {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  const halfThickness = thickness / 2;
  if (Math.abs(dz) <= AXIS_EPS) {
    return { len, hx: len / 2, hz: halfThickness, rotation: null };
  }
  if (Math.abs(dx) <= AXIS_EPS) {
    return { len, hx: halfThickness, hz: len / 2, rotation: null };
  }
  // A rotation about +Y by θ sends the box's local +X to (cos θ, 0, −sin θ), so
  // the angle that lays its length along (dx, dz) is atan2(−dz, dx).
  const half = Math.atan2(-dz, dx) / 2;
  return {
    len,
    hx: len / 2,
    hz: halfThickness,
    rotation: { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) },
  };
}
