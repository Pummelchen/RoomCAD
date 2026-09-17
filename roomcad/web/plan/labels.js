// Text labels: their bounds and hit-testing.
//
// Part of the plan model; the public entry point is ../plan.js, which re-exports
// every module here.

import { LABEL_DEFAULT_SIZE } from "./core.js";


// MARK: - Labels

/// A label's footprint on the plan, used for hit testing and for the selection
/// outline. Width is estimated from the text — good enough for picking.
export function labelBounds(label) {
  const size = label.size || LABEL_DEFAULT_SIZE;
  const text = label.text || "";
  const w = Math.max(size * 1.2, text.length * size * 0.58);
  const h = size * 1.5;
  return {
    minX: label.center.x - w / 2, maxX: label.center.x + w / 2,
    minZ: label.center.z - h / 2, maxZ: label.center.z + h / 2,
    w, h,
  };
}

export function labelNear(room, p, tolerance = 0.08) {
  const labels = room.labels || [];
  for (let i = labels.length - 1; i >= 0; i--) {
    const b = labelBounds(labels[i]);
    if (p.x >= b.minX - tolerance && p.x <= b.maxX + tolerance
      && p.z >= b.minZ - tolerance && p.z <= b.maxZ + tolerance) return labels[i];
  }
  return null;
}
