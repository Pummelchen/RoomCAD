// Finds surfaces that will fight over the depth buffer.
//
// Two flat faces at exactly the same depth, both drawn, and the GPU has no
// basis to choose between them: which one wins varies per pixel and per frame,
// and the result is the flicker that a still screenshot will not show you.
// This is the same class of bug as the floor flicker the room's own tower
// clearance exists to prevent, and no test caught it inside the city until
// the interiors made it visible through every window.
//
// Abutting boxes are NOT a clash: two boxes side by side share a plane, but
// their faces point away from each other, so from any one viewpoint only one
// of them is drawn. What matters is whether both faces are visible from the
// SAME side — which depends on the material, because a back-face-only mesh
// (the building interiors) shows the opposite face to the one a normal mesh
// would.

const BACK_FACE_MESHES = new Set(["city-rooms-dark", "city-rooms-lit"]);

/// Every axis-aligned box in the city, with the meshes it came from.
function boxesOf(group, meshNames) {
  const out = [];
  group.traverse(node => {
    if (!node.isInstancedMesh) return;
    if (meshNames && !meshNames.includes(node.name)) return;
    const e = node.instanceMatrix.array;
    const backFace = BACK_FACE_MESHES.has(node.name);
    // The instance scale is not the size: a cylinder carries its radius in the
    // geometry and is instanced at scale 1, so reading the matrix alone makes
    // a 16 cm lamp post look like a metre-wide block and invents clashes
    // between every pair of posts near a junction.
    if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
    const bb = node.geometry.boundingBox;
    const size = [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z];
    const mid = [(bb.max.x + bb.min.x) / 2, (bb.max.y + bb.min.y) / 2, (bb.max.z + bb.min.z) / 2];
    for (let i = 0; i < node.count; i++) {
      const o = i * 16;
      // Rotated instances are not axis-aligned, so they cannot be coplanar
      // with the building grid in the way this looks for.
      if (Math.abs(e[o + 1]) > 1e-6 || Math.abs(e[o + 2]) > 1e-6) continue;
      const scale = [
        Math.hypot(e[o + 0], e[o + 1], e[o + 2]),
        Math.hypot(e[o + 4], e[o + 5], e[o + 6]),
        Math.hypot(e[o + 8], e[o + 9], e[o + 10]),
      ];
      out.push({
        mesh: node.name,
        backFace,
        c: [
          e[o + 12] + mid[0] * scale[0],
          e[o + 13] + mid[1] * scale[1],
          e[o + 14] + mid[2] * scale[2],
        ],
        half: [size[0] * scale[0] / 2, size[1] * scale[1] / 2, size[2] * scale[2] / 2],
      });
    }
  });
  return out;
}

/// Pairs of faces sharing a plane, both drawn from the same side, overlapping
/// by more than `minArea` square metres.
export function coplanarClashes(group, { meshNames = null, minArea = 0.02, tolerance = 0.0005 } = {}) {
  const boxes = boxesOf(group, meshNames);
  const planes = new Map();
  for (const b of boxes) {
    for (let axis = 0; axis < 3; axis++) {
      for (const end of [-1, 1]) {
        const at = b.c[axis] + end * b.half[axis];
        // Which side of the plane this face can be seen from. A normal mesh
        // shows the face pointing outwards; a back-face-only mesh shows the
        // one pointing away from the viewer, which is the opposite.
        const seenFrom = b.backFace ? -end : end;
        const key = axis + ":" + Math.round(at / tolerance);
        if (!planes.has(key)) planes.set(key, []);
        planes.get(key).push({ box: b, axis, seenFrom, at });
      }
    }
  }

  const clashes = [];
  for (const [, faces] of planes) {
    if (faces.length < 2) continue;
    for (let i = 0; i < faces.length; i++) {
      for (let j = i + 1; j < faces.length; j++) {
        const A = faces[i];
        const B = faces[j];
        if (A.box === B.box) continue;
        if (A.seenFrom !== B.seenFrom) continue;   // back to back: only one is drawn
        const others = [0, 1, 2].filter(k => k !== A.axis);
        let area = 1;
        for (const k of others) {
          const lo = Math.max(A.box.c[k] - A.box.half[k], B.box.c[k] - B.box.half[k]);
          const hi = Math.min(A.box.c[k] + A.box.half[k], B.box.c[k] + B.box.half[k]);
          area *= Math.max(0, hi - lo);
        }
        if (area <= minArea) continue;
        clashes.push({
          axis: "xyz"[A.axis], at: A.at, area,
          between: [A.box.mesh, B.box.mesh].sort().join(" + "),
        });
      }
    }
  }
  return clashes;
}
