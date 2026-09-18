// The city's instance collector: many boxes merged into one InstancedMesh.
//
// Part of city.js, which is split under roomcad/web/city/.

import * as THREE from "three";
import { _color } from "./matrices.js";

/// A collector that turns many boxes into one InstancedMesh.
export class InstanceSet {
  /// `spare` leaves room in the built mesh for instances added later. An
  /// InstancedMesh is a fixed allocation, so anything that changes the city
  /// after it is built — a hole blown through a wall becomes four pieces of
  /// wall where one used to be — has to have somewhere to put the new pieces.
  constructor(geometry, material,
              { colored = true, spare = 0, casts = false, receives = false } = {}) {
    this.geometry = geometry;
    this.material = material;
    this.colored = colored;
    this.spare = spare;
    this.casts = casts;
    this.receives = receives;
    this.items = [];
    this.mesh = null;
  }

  add(matrix, color) {
    this.items.push({ matrix, color });
  }

  build(parent, name) {
    if (this.items.length === 0) {
      this.geometry.dispose();
      this.material.dispose();
      return null;
    }
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, this.items.length + this.spare);
    mesh.name = name;
    // The city used to be scenery that neither cast a shadow nor took one —
    // the sun's shadow camera was kept tight around the room, and everything
    // outside it was lit flat from every direction at once. A street with no
    // shadows in it does not look like a street at noon; it looks like a
    // drawing of one.
    mesh.castShadow = this.casts;
    mesh.receiveShadow = this.receives;
    mesh.frustumCulled = false; // one mesh spans the whole city
    const c = new THREE.Color();
    for (let i = 0; i < this.items.length; i++) {
      mesh.setMatrixAt(i, this.items[i].matrix);
      if (this.colored) mesh.setColorAt(i, c.setHex(this.items[i].color));
    }
    // Only the real ones are drawn; the spare slots wait.
    mesh.count = this.items.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (this.colored && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    parent.add(mesh);
    this.mesh = mesh;
    return mesh;
  }

  /// Rewrites one instance in place.
  replace(index, matrix, color) {
    if (!this.mesh || index < 0 || index >= this.mesh.count) return;
    this.items[index] = { matrix, color };
    this.mesh.setMatrixAt(index, matrix);
    if (this.colored && this.mesh.instanceColor) {
      this.mesh.setColorAt(index, _color.setHex(color));
      this.mesh.instanceColor.needsUpdate = true;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /// Takes one of the spare slots. Returns false when they have run out, which
  /// is a full city rather than an error — the wall simply does not shatter.
  append(matrix, color) {
    if (!this.mesh || this.mesh.count >= this.mesh.instanceMatrix.count) return false;
    const index = this.mesh.count++;
    this.items[index] = { matrix, color };
    this.mesh.setMatrixAt(index, matrix);
    if (this.colored && this.mesh.instanceColor) {
      this.mesh.setColorAt(index, _color.setHex(color));
      this.mesh.instanceColor.needsUpdate = true;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    return true;
  }
}
