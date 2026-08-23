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

/// The same question, asked of the triangles inside ONE merged geometry.
///
/// The instanced check above cannot see in here: a vehicle body is a single
/// geometry built from many parts, and once they are merged the parts are gone.
/// So the surfaces are recovered from the triangles — every triangle lying in
/// an axis-aligned plane is grouped with the others in that plane, and two
/// facing the SAME way that overlap are two surfaces the depth buffer will have
/// to choose between.
///
/// The overlap has to be measured exactly. Comparing bounding boxes does not
/// work: the end cap of a cylinder is a fan of triangles that share edges but
/// never overlap, and their boxes all cover the middle of the cap, so every
/// wheel in the city reads as hundreds of clashes. The real intersection area
/// is computed instead, by clipping one triangle against the other.

/// Area of the intersection of two convex polygons, by Sutherland–Hodgman.
function clippedArea(subject, clip) {
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const edge = [b[0] - a[0], b[1] - a[1]];
    const inside = q => edge[0] * (q[1] - a[1]) - edge[1] * (q[0] - a[0]) >= -1e-12;
    const next = [];
    for (let k = 0; k < out.length; k++) {
      const cur = out[k];
      const prev = out[(k + out.length - 1) % out.length];
      const curIn = inside(cur);
      const prevIn = inside(prev);
      if (curIn !== prevIn) {
        const d = [cur[0] - prev[0], cur[1] - prev[1]];
        const denom = edge[0] * d[1] - edge[1] * d[0];
        if (Math.abs(denom) > 1e-15) {
          const t = (edge[0] * (prev[1] - a[1]) - edge[1] * (prev[0] - a[0])) / -denom;
          next.push([prev[0] + d[0] * t, prev[1] + d[1] * t]);
        }
      }
      if (curIn) next.push(cur);
    }
    out = next;
  }
  let area = 0;
  for (let i = 0; i < out.length; i++) {
    const [x1, y1] = out[i];
    const [x2, y2] = out[(i + 1) % out.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

/// Triangles in the same plane, facing the same way, that actually overlap.
export function coplanarInGeometry(geometry, { minArea = 0.0015, tolerance = 0.0005 } = {}) {
  const p = geometry.attributes.position;
  const n = geometry.attributes.normal;
  const index = geometry.index;
  const count = index ? index.count : p.count;
  const planes = new Map();

  for (let t = 0; t < count; t += 3) {
    const v = [0, 1, 2].map(k => (index ? index.getX(t + k) : t + k));
    const nx = n.getX(v[0]);
    const ny = n.getY(v[0]);
    const nz = n.getZ(v[0]);
    let axis = -1;
    let sign = 0;
    if (Math.abs(Math.abs(nx) - 1) < 1e-4) { axis = 0; sign = Math.sign(nx); }
    else if (Math.abs(Math.abs(ny) - 1) < 1e-4) { axis = 1; sign = Math.sign(ny); }
    else if (Math.abs(Math.abs(nz) - 1) < 1e-4) { axis = 2; sign = Math.sign(nz); }
    if (axis < 0) continue;

    const get = (i, a) => (a === 0 ? p.getX(i) : a === 1 ? p.getY(i) : p.getZ(i));
    const at = get(v[0], axis);
    if (Math.abs(get(v[1], axis) - at) > tolerance || Math.abs(get(v[2], axis) - at) > tolerance) continue;

    const others = [0, 1, 2].filter(a => a !== axis);
    const tri = v.map(i => [get(i, others[0]), get(i, others[1])]);
    const key = axis + ":" + sign + ":" + Math.round(at / tolerance);
    if (!planes.has(key)) planes.set(key, []);
    planes.get(key).push({ axis, sign, at, tri });
  }

  const clashes = [];
  for (const [, faces] of planes) {
    if (faces.length < 2) continue;
    for (let i = 0; i < faces.length; i++) {
      for (let j = i + 1; j < faces.length; j++) {
        const area = clippedArea(faces[i].tri, faces[j].tri);
        if (area > minArea) {
          clashes.push({ axis: "xyz"[faces[i].axis], at: faces[i].at, sign: faces[i].sign, area });
        }
      }
    }
  }
  return clashes;
}
