// Exact overlap test for two vehicles, by the separating axis theorem.
//
// The obvious test — "are two vehicles in the same junction box?" — measures
// the wrong thing: a junction is thirteen metres across, so two vehicles can
// both be inside one and be eight metres apart, and every completed turn ends
// with a vehicle still in the box on its way out. What actually matters is
// whether two of them are in the same place, and while they are turning they
// are at an angle, so an axis-aligned test does not answer that either.
//
// Two convex rectangles miss each other if and only if their projections are
// disjoint on one of their four edge normals — and opposite edges share a
// normal, so two axes per rectangle is the whole test.

/// True when the two vehicles' footprints intersect. `shrink` shaves a little
/// off both, so that touching mirrors do not read as a collision.
export function vehiclesOverlap(a, b, shrink = 0.94) {
  const boxes = [a, b].map(v => {
    const c = Math.cos(v.heading);
    const s = Math.sin(v.heading);
    return {
      cx: v.x, cz: v.z,
      axes: [{ x: c, z: s }, { x: -s, z: c }],
      half: [v.length / 2 * shrink, v.width / 2 * shrink],
    };
  });
  for (const box of boxes) {
    for (const axis of box.axes) {
      let lo = [Infinity, Infinity];
      let hi = [-Infinity, -Infinity];
      for (let i = 0; i < 2; i++) {
        const B = boxes[i];
        const centre = B.cx * axis.x + B.cz * axis.z;
        const reach = Math.abs(B.axes[0].x * axis.x + B.axes[0].z * axis.z) * B.half[0]
                    + Math.abs(B.axes[1].x * axis.x + B.axes[1].z * axis.z) * B.half[1];
        lo[i] = centre - reach;
        hi[i] = centre + reach;
      }
      if (hi[0] < lo[1] || hi[1] < lo[0]) return false;
    }
  }
  return true;
}
