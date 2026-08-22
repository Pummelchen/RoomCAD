// city.js — the stylised city the room stands in.
//
// Purely a visual reference: it gives the 3D walkthrough a sense of scale and
// place, and it is what you see through a window. It has no colliders, no
// lights of its own and no knowledge of the room model — walk3d.js hands it a
// building envelope and it builds a neighbourhood around it.
//
// Realism target: 3/10. Readable, friendly, blocky shapes with flat colours —
// deliberately not photoreal. Everything is instanced, so the whole city is
// roughly a dozen draw calls no matter how many buildings are on screen.

import * as THREE from "three";

// Layout, in metres.
export const BLOCK_SIZE = 46;   // one city block
export const ROAD_WIDTH = 13;   // carriageway between two blocks
export const SIDEWALK = 3.2;    // pavement inset around a block
export const KERB_HEIGHT = 0.16;
// The room's own floor slab is this thick (walk3d builds it), and the tower
// underneath has to stop clear of it. Ending the tower level with the slab put
// two horizontal faces at exactly the same depth across the whole room, which
// z-fought and read as a flickering floor.
export const ROOM_SLAB_THICKNESS = 0.06;
const TOWER_REVEAL = 0.02;
// Height datum. The pavement top is the room's own floor level, so a ground
// floor room opens straight onto the street; the carriageway is one kerb down.
const PAVEMENT_Y = 0;
const ROAD_Y = PAVEMENT_Y - KERB_HEIGHT;
export const GRID_RADIUS = 2;   // blocks each way from the room -> 5 x 5

const FLOOR_HEIGHT = 3;         // matches walk3d's per-storey lift

// A friendly, slightly sun-bleached palette. Saturated enough to read at a
// distance, muted enough not to fight the room's own materials.
const FACADE_COLORS = [
  0xe8ddc8, 0xd9a389, 0xa8b89a, 0x8fa9c0, 0xc98d7a,
  0xe4cf9a, 0x9fc4b8, 0xcbb9d4, 0xd7d2c8, 0xb08d76,
];
const ROOF_COLOR = 0x6f6a63;
const ASPHALT_COLOR = 0x3a3d44;
const SIDEWALK_COLOR = 0xb9b6ad;
const KERB_COLOR = 0x9a978f;
const GRASS_COLOR = 0x6f9457;
const MARKING_COLOR = 0xe6e2d4;
const TRUNK_COLOR = 0x6b4f36;
const CANOPY_COLORS = [0x5c8a45, 0x6f9c52, 0x4e7a3b];
const LAMP_POLE_COLOR = 0x4a4d53;
const WINDOW_DARK = 0x2d3a4a;
const WINDOW_LIT = 0xffd9a0;
const CAR_COLORS = [
  0xd94f4f, 0x4f7fd9, 0xe0c04a, 0x53b06a, 0xdedede,
  0x2f3238, 0xd98a4f, 0x8f6fd0,
];

/// Deterministic PRNG (mulberry32) so a given room always gets the same city.
function makeRandom(seed) {
  let s = (seed >>> 0) || 1;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/// Stable 32-bit hash of a string, so a room id maps to one city.
export function seedFromString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/// A collector that turns many boxes into one InstancedMesh.
class InstanceSet {
  constructor(geometry, material, { colored = true } = {}) {
    this.geometry = geometry;
    this.material = material;
    this.colored = colored;
    this.items = [];
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
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, this.items.length);
    mesh.name = name;
    // The city is scenery: it never casts into the room's shadow maps, which
    // keeps the sun's shadow camera tight around the actual building.
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false; // one mesh spans the whole city
    const c = new THREE.Color();
    for (let i = 0; i < this.items.length; i++) {
      mesh.setMatrixAt(i, this.items[i].matrix);
      if (this.colored) mesh.setColorAt(i, c.setHex(this.items[i].color));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (this.colored && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    parent.add(mesh);
    return mesh;
  }
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _euler = new THREE.Euler();

/// Composes a box transform. `into` lets a caller supply its own matrix, which
/// matters for the traffic: it runs every frame, and allocating a fresh Matrix4
/// three times per car was roughly 11,500 throwaway objects a second.
function boxMatrix(x, y, z, w, h, d, rotY = 0, into = null) {
  _pos.set(x, y, z);
  _scale.set(w, h, d);
  _q.setFromEuler(_euler.set(0, rotY, 0));
  return (into || new THREE.Matrix4()).compose(_pos, _q, _scale);
}

export class City {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = "city";
    // walk3d's scene teardown skips persistent subtrees, so editing the room
    // never rebuilds the neighbourhood.
    this.group.userData.persistent = true;

    this.cars = [];
    this.carParts = null;
    this.litWindows = null;
    this.lampHeads = null;
    this.headlights = null;
    this.key = null;
    this._disposables = [];
    this._dayAmount = 1;
  }

  /// True when the existing city still fits this building and floor.
  matches(bounds, seed, floorLift) {
    return this.key === City.keyFor(bounds, seed, floorLift);
  }

  static keyFor(bounds, seed, floorLift) {
    return [
      seed,
      bounds.centerX.toFixed(2), bounds.centerZ.toFixed(2),
      bounds.width.toFixed(2), bounds.length.toFixed(2),
      floorLift.toFixed(2),
    ].join("|");
  }

  /// Builds the neighbourhood around `bounds`. `floorLift` is how high the
  /// room sits, so the block it belongs to gets a tower of that height under
  /// it and the room never appears to float.
  build(bounds, seed, floorLift) {
    this.clear();
    this.key = City.keyFor(bounds, seed, floorLift);
    const rnd = makeRandom(seed);

    // The room's own block has to be big enough to hold the building.
    const block = Math.max(BLOCK_SIZE, bounds.width + SIDEWALK * 4, bounds.length + SIDEWALK * 4);
    const span = block + ROAD_WIDTH;
    const cx = bounds.centerX;
    const cz = bounds.centerZ;
    const reach = GRID_RADIUS * span + block / 2 + ROAD_WIDTH;
    // The building's plot, kept clear of paving. The edge tucks a few
    // centimetres under the wall line so the pavement meets the building
    // without either a gap or a slab poking up inside a ground-floor room.
    const tuck = 0.04;
    const plot = {
      x0: bounds.minX + tuck, x1: bounds.maxX - tuck,
      z0: bounds.minZ + tuck, z1: bounds.maxZ - tuck,
    };

    const facades = new InstanceSet(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 })
    );
    const roofs = new InstanceSet(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 })
    );
    const flats = new InstanceSet(       // pavements, kerbs, grass, road paint
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 })
    );
    const darkGlass = new InstanceSet(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: WINDOW_DARK, roughness: 0.25, metalness: 0.1 }),
      { colored: false }
    );
    const litGlass = new InstanceSet(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({
        color: WINDOW_DARK, emissive: WINDOW_LIT, emissiveIntensity: 0, roughness: 0.3,
      }),
      { colored: false }
    );
    const trunks = new InstanceSet(
      new THREE.CylinderGeometry(0.13, 0.18, 1, 6),
      new THREE.MeshStandardMaterial({ color: TRUNK_COLOR, roughness: 1 }),
      { colored: false }
    );
    const canopies = new InstanceSet(
      new THREE.IcosahedronGeometry(1, 0),   // low-poly blob reads as stylised
      new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true })
    );
    const poles = new InstanceSet(
      new THREE.CylinderGeometry(0.07, 0.09, 1, 6),
      new THREE.MeshStandardMaterial({ color: LAMP_POLE_COLOR, roughness: 0.7, metalness: 0.3 }),
      { colored: false }
    );
    const lampHeads = new InstanceSet(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({
        color: 0xf6efd8, emissive: 0xffe6b0, emissiveIntensity: 0, roughness: 0.4,
      }),
      { colored: false }
    );

    this._groundPlane(reach, cx, cz, span);

    for (let gx = -GRID_RADIUS; gx <= GRID_RADIUS; gx++) {
      for (let gz = -GRID_RADIUS; gz <= GRID_RADIUS; gz++) {
        const bx = cx + gx * span;
        const bz = cz + gz * span;
        const home = gx === 0 && gz === 0;
        this._blockPad(flats, bx, bz, block, home ? plot : null);
        if (home) {
          this._homeTower(facades, darkGlass, litGlass, bounds, floorLift, rnd);
        } else {
          this._blockBuildings(facades, roofs, darkGlass, litGlass, bx, bz, block, rnd);
        }
        this._blockTrees(trunks, canopies, bx, bz, block, rnd);
      }
    }

    this._roadMarkings(flats, cx, cz, block, span);
    this._streetLamps(poles, lampHeads, cx, cz, block, span);
    this._buildCars(cx, cz, span, reach, rnd);

    facades.build(this.group, "city-facades");
    roofs.build(this.group, "city-roofs");
    flats.build(this.group, "city-ground-details");
    darkGlass.build(this.group, "city-windows-dark");
    this.litWindows = litGlass.build(this.group, "city-windows-lit");
    trunks.build(this.group, "city-tree-trunks");
    canopies.build(this.group, "city-tree-canopies");
    poles.build(this.group, "city-lamp-poles");
    this.lampHeads = lampHeads.build(this.group, "city-lamp-heads");

    this.group.traverse(node => {
      if (node.isInstancedMesh) {
        this._disposables.push(node.geometry, node.material);
      }
    });
    this.applyTimeOfDay(this._dayAmount);
  }

  // MARK: - Ground and blocks

  _groundPlane(reach, cx, cz, span) {
    const size = reach * 2 + span;
    const geo = new THREE.BoxGeometry(size, 0.4, size);
    const mat = new THREE.MeshStandardMaterial({ color: ASPHALT_COLOR, roughness: 1 });
    const ground = new THREE.Mesh(geo, mat);
    ground.position.set(cx, ROAD_Y - 0.2, cz);
    ground.receiveShadow = false;
    ground.castShadow = false;
    this.group.add(ground);
    this._disposables.push(geo, mat);
  }

  /// One slab layer of a block, as up to four strips around an optional hole.
  /// The room's own plot is the hole: paving over it would push pavement up
  /// through the floor of a ground-floor room.
  _padLayer(flats, rect, hole, top, height, color) {
    const { x0, x1, z0, z1 } = rect;
    const strip = (ax0, ax1, az0, az1) => {
      const w = ax1 - ax0;
      const d = az1 - az0;
      if (w <= 0.01 || d <= 0.01) return;
      flats.add(boxMatrix((ax0 + ax1) / 2, top - height / 2, (az0 + az1) / 2, w, height, d), color);
    };
    if (!hole) {
      strip(x0, x1, z0, z1);
      return;
    }
    const hx0 = Math.max(x0, Math.min(x1, hole.x0));
    const hx1 = Math.max(x0, Math.min(x1, hole.x1));
    const hz0 = Math.max(z0, Math.min(z1, hole.z0));
    const hz1 = Math.max(z0, Math.min(z1, hole.z1));
    strip(x0, x1, z0, hz0);
    strip(x0, x1, hz1, z1);
    strip(x0, hx0, hz0, hz1);
    strip(hx1, x1, hz0, hz1);
  }

  /// The raised pavement pad for one block: kerb, pavement, and a lawn on the
  /// blocks that are not the room's own. Each layer tops out a few millimetres
  /// below the one outside it, so nothing z-fights.
  _blockPad(flats, bx, bz, block, hole) {
    const rect = { x0: bx - block / 2, x1: bx + block / 2, z0: bz - block / 2, z1: bz + block / 2 };
    this._padLayer(flats, rect, hole, PAVEMENT_Y, KERB_HEIGHT, KERB_COLOR);
    const inset = 0.35;
    this._padLayer(flats, {
      x0: rect.x0 + inset, x1: rect.x1 - inset, z0: rect.z0 + inset, z1: rect.z1 - inset,
    }, hole, PAVEMENT_Y - 0.005, KERB_HEIGHT, SIDEWALK_COLOR);
    if (!hole) {
      this._padLayer(flats, {
        x0: rect.x0 + SIDEWALK, x1: rect.x1 - SIDEWALK,
        z0: rect.z0 + SIDEWALK, z1: rect.z1 - SIDEWALK,
      }, null, PAVEMENT_Y - 0.002, KERB_HEIGHT, GRASS_COLOR);
    }
  }

  /// Two to four buildings per block, set back from the pavement.
  _blockBuildings(facades, roofs, darkGlass, litGlass, bx, bz, block, rnd) {
    const core = block - SIDEWALK * 2;
    const cols = rnd() < 0.5 ? 1 : 2;
    const rows = rnd() < 0.45 ? 1 : 2;
    const cellW = core / cols;
    const cellD = core / rows;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        if (cols * rows > 1 && rnd() < 0.18) continue; // leave a gap / courtyard
        const gapW = 2 + rnd() * 3;
        const gapD = 2 + rnd() * 3;
        const w = Math.max(6, cellW - gapW);
        const d = Math.max(6, cellD - gapD);
        const storeys = 1 + Math.floor(rnd() * 6);
        const h = storeys * FLOOR_HEIGHT;
        const x = bx - core / 2 + cellW * (i + 0.5);
        const z = bz - core / 2 + cellD * (j + 0.5);
        const color = FACADE_COLORS[Math.floor(rnd() * FACADE_COLORS.length)];
        facades.add(boxMatrix(x, PAVEMENT_Y + h / 2, z, w, h, d), color);
        // A parapet reads as a roof without modelling one.
        roofs.add(boxMatrix(x, PAVEMENT_Y + h + 0.25, z, w + 0.5, 0.5, d + 0.5), ROOF_COLOR);
        this._facadeWindows(darkGlass, litGlass, x, z, w, d, storeys, PAVEMENT_Y, rnd);
      }
    }
  }

  /// The tower the room sits on, so an upper-floor room has a building beneath
  /// it instead of thin air. Floor 1 gets a low podium instead of a tower.
  _homeTower(facades, darkGlass, litGlass, bounds, floorLift, rnd) {
    const w = bounds.width + 1.2;
    const d = bounds.length + 1.2;
    const x = bounds.centerX;
    const z = bounds.centerZ;
    const color = FACADE_COLORS[Math.floor(rnd() * FACADE_COLORS.length)];
    if (floorLift <= 0.01) {
      // Ground floor: the room sits directly on its plot. Adding anything
      // here would rise above the room's own floor.
      return;
    }
    // Stop below the underside of the room's floor slab. The tower is wider
    // than the room, so the small reveal reads as an ordinary floor line
    // rather than a gap.
    const height = Math.max(0.05, floorLift - ROOM_SLAB_THICKNESS - TOWER_REVEAL);
    facades.add(boxMatrix(x, height / 2, z, w, height, d), color);
    const storeys = Math.max(1, Math.round(height / FLOOR_HEIGHT));
    this._facadeWindows(darkGlass, litGlass, x, z, w, d, storeys, 0, rnd);
  }

  /// A grid of windows on all four faces, a few of them lit.
  /// `w` is the extent along X, `d` the extent along Z.
  _facadeWindows(darkGlass, litGlass, x, z, w, d, storeys, baseY, rnd) {
    const winW = 1.0;
    const winH = 1.3;
    const thin = 0.08;
    const proud = 0.06;
    // Each face: the axis the windows march along, and the outward offset.
    const faces = [
      { along: "x", span: w, offX: 0, offZ: d / 2 + proud },
      { along: "x", span: w, offX: 0, offZ: -(d / 2 + proud) },
      { along: "z", span: d, offX: w / 2 + proud, offZ: 0 },
      { along: "z", span: d, offX: -(w / 2 + proud), offZ: 0 },
    ];
    for (const face of faces) {
      const count = Math.max(1, Math.floor((face.span - 1.4) / 2.2));
      const step = face.span / (count + 1);
      for (let s = 0; s < storeys; s++) {
        const y = baseY + s * FLOOR_HEIGHT + FLOOR_HEIGHT * 0.55;
        for (let i = 1; i <= count; i++) {
          const along = -face.span / 2 + step * i;
          const px = x + face.offX + (face.along === "x" ? along : 0);
          const pz = z + face.offZ + (face.along === "z" ? along : 0);
          const sx = face.along === "x" ? winW : thin;
          const sz = face.along === "x" ? thin : winW;
          const m = boxMatrix(px, y, pz, sx, winH, sz);
          if (rnd() < 0.34) litGlass.add(m);
          else darkGlass.add(m);
        }
      }
    }
  }

  _blockTrees(trunks, canopies, bx, bz, block, rnd) {
    const ring = block / 2 - SIDEWALK / 2;
    const perSide = 3;
    for (const side of [0, 1, 2, 3]) {
      for (let i = 0; i < perSide; i++) {
        if (rnd() < 0.35) continue;
        const t = (i + 1) / (perSide + 1);
        const along = -block / 2 + block * t + (rnd() - 0.5) * 2;
        let x = bx;
        let z = bz;
        if (side === 0) { x = bx + along; z = bz + ring; }
        else if (side === 1) { x = bx + along; z = bz - ring; }
        else if (side === 2) { x = bx + ring; z = bz + along; }
        else { x = bx - ring; z = bz + along; }
        const trunkH = 1.6 + rnd() * 1.1;
        const r = 1.1 + rnd() * 0.7;
        trunks.add(boxMatrix(x, PAVEMENT_Y + trunkH / 2, z, 1, trunkH, 1));
        const canopy = new THREE.Matrix4().compose(
          new THREE.Vector3(x, PAVEMENT_Y + trunkH + r * 0.6, z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 0.6, rnd() * 3, 0)),
          new THREE.Vector3(r, r * 0.9, r)
        );
        canopies.add(canopy, CANOPY_COLORS[Math.floor(rnd() * CANOPY_COLORS.length)]);
      }
    }
  }

  // MARK: - Streets

  /// Dashed centre lines down every road, plus zebra crossings at the kerbs.
  _roadMarkings(flats, cx, cz, block, span) {
    const y = ROAD_Y + 0.02;
    const half = GRID_RADIUS * span + block / 2 + ROAD_WIDTH / 2;
    const dash = 2.2;
    const gap = 2.6;
    for (let g = -GRID_RADIUS; g <= GRID_RADIUS + 1; g++) {
      const line = cz + (g - 0.5) * span;
      for (let p = -half; p < half; p += dash + gap) {
        flats.add(boxMatrix(cx + p + dash / 2, y, line, dash, 0.04, 0.18), MARKING_COLOR);
      }
      const lineX = cx + (g - 0.5) * span;
      for (let p = -half; p < half; p += dash + gap) {
        flats.add(boxMatrix(lineX, y, cz + p + dash / 2, 0.18, 0.04, dash), MARKING_COLOR);
      }
    }
    // Zebra crossings on the approaches to the room's own block.
    const edge = block / 2 + 1.4;
    for (let i = 0; i < 6; i++) {
      const o = -3.4 + i * 1.35;
      flats.add(boxMatrix(cx + o, y, cz + edge, 0.55, 0.04, 3.2), MARKING_COLOR);
      flats.add(boxMatrix(cx + o, y, cz - edge, 0.55, 0.04, 3.2), MARKING_COLOR);
      flats.add(boxMatrix(cx + edge, y, cz + o, 3.2, 0.04, 0.55), MARKING_COLOR);
      flats.add(boxMatrix(cx - edge, y, cz + o, 3.2, 0.04, 0.55), MARKING_COLOR);
    }
  }

  _streetLamps(poles, heads, cx, cz, block, span) {
    const h = 4.6;
    for (let gx = -GRID_RADIUS; gx <= GRID_RADIUS; gx++) {
      for (let gz = -GRID_RADIUS; gz <= GRID_RADIUS; gz++) {
        const bx = cx + gx * span;
        const bz = cz + gz * span;
        const edge = block / 2 - 0.9;
        for (const [ox, oz] of [[edge, edge], [-edge, edge], [edge, -edge], [-edge, -edge]]) {
          poles.add(boxMatrix(bx + ox, PAVEMENT_Y + h / 2, bz + oz, 1, h, 1));
          heads.add(boxMatrix(bx + ox, PAVEMENT_Y + h + 0.12, bz + oz, 0.44, 0.16, 0.44));
        }
      }
    }
  }

  // MARK: - Traffic

  _buildCars(cx, cz, span, reach, rnd) {
    const bodyGeo = new THREE.BoxGeometry(1, 1, 1);
    const cabinGeo = new THREE.BoxGeometry(1, 1, 1);
    const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.22, 8);
    const lightGeo = new THREE.BoxGeometry(1, 1, 1);
    const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.25 });
    const cabinMat = new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 0.2, metalness: 0.3 });
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.9 });
    const lightMat = new THREE.MeshStandardMaterial({
      color: 0xfff3d0, emissive: 0xffe9b8, emissiveIntensity: 0, roughness: 0.4,
    });

    // Lanes on the roads nearest the room. Distant traffic is invisible
    // through the fog, so populating it would cost matrix updates for nothing.
    const lanes = [];
    for (let g = -GRID_RADIUS; g <= GRID_RADIUS + 1; g++) {
      const road = (g - 0.5) * span;
      if (Math.abs(road) > span * 1.6) continue;
      lanes.push({ axis: "x", fixed: cz + road - 3.1, dir: 1 });
      lanes.push({ axis: "x", fixed: cz + road + 3.1, dir: -1 });
      lanes.push({ axis: "z", fixed: cx + road + 3.1, dir: 1 });
      lanes.push({ axis: "z", fixed: cx + road - 3.1, dir: -1 });
    }

    // Several cars per lane, spread evenly with a little jitter, so there is
    // always traffic in view. They wrap beyond the fog, where the jump cannot
    // be seen.
    const PER_LANE = 4;
    this.cars = [];
    for (const lane of lanes) {
      const center = lane.axis === "x" ? cx : cz;
      for (let k = 0; k < PER_LANE; k++) {
        const t = (k + rnd() * 0.7) / PER_LANE;         // 0..1 along the loop
        this.cars.push({
          axis: lane.axis,
          fixed: lane.fixed,
          dir: lane.dir,
          pos: center - reach + t * reach * 2,
          speed: 5 + rnd() * 5,
          length: 3.8 + rnd() * 0.9,
          width: 1.7,
          color: CAR_COLORS[Math.floor(rnd() * CAR_COLORS.length)],
          center,
          reach,
        });
      }
    }

    const n = this.cars.length;
    const make = (geo, mat, per) => {
      const mesh = new THREE.InstancedMesh(geo, mat, n * per);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this._disposables.push(geo, mat);
      return mesh;
    };
    this.carParts = {
      body: make(bodyGeo, bodyMat, 1),
      cabin: make(cabinGeo, cabinMat, 1),
      wheel: make(wheelGeo, wheelMat, 4),
      light: make(lightGeo, lightMat, 2),
    };
    this.headlights = this.carParts.light;

    const c = new THREE.Color();
    for (let i = 0; i < n; i++) this.carParts.body.setColorAt(i, c.setHex(this.cars[i].color));
    if (this.carParts.body.instanceColor) this.carParts.body.instanceColor.needsUpdate = true;
    this._writeCarMatrices();
  }

  _writeCarMatrices() {
    if (!this.carParts) return;
    const { body, cabin, wheel, light } = this.carParts;
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      const alongX = car.axis === "x";
      const x = alongX ? car.pos : car.fixed;
      const z = alongX ? car.fixed : car.pos;
      const rot = alongX ? 0 : Math.PI / 2;
      const L = car.length;
      const W = car.width;

      body.setMatrixAt(i, boxMatrix(x, ROAD_Y + 0.52, z, L, 0.72, W, rot, _m));
      cabin.setMatrixAt(i, boxMatrix(
        x - (alongX ? car.dir * 0.25 : 0),
        ROAD_Y + 1.06,
        z - (alongX ? 0 : car.dir * 0.25),
        L * 0.5, 0.56, W * 0.86, rot, _m
      ));

      const dx = alongX ? L * 0.32 : W * 0.42;
      const dz = alongX ? W * 0.42 : L * 0.32;
      let w = 0;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          _pos.set(x + sx * dx, ROAD_Y + 0.34, z + sz * dz);
          // A cylinder's axis is Y. Tip it so the axle is perpendicular to
          // travel: along Z for an east-west car, along X for a north-south one.
          if (alongX) _euler.set(Math.PI / 2, 0, 0);
          else _euler.set(0, 0, Math.PI / 2);
          _q.setFromEuler(_euler);
          _scale.set(1, 1, 1);
          wheel.setMatrixAt(i * 4 + w, _m.compose(_pos, _q, _scale));
          w++;
        }
      }

      const nose = (L / 2) * car.dir;
      for (let k = 0; k < 2; k++) {
        const side = k === 0 ? -1 : 1;
        light.setMatrixAt(i * 2 + k, boxMatrix(
          x + (alongX ? nose : side * W * 0.3),
          ROAD_Y + 0.6,
          z + (alongX ? side * W * 0.3 : nose),
          alongX ? 0.12 : 0.3, 0.18, alongX ? 0.3 : 0.12, 0, _m
        ));
      }
    }
    body.instanceMatrix.needsUpdate = true;
    cabin.instanceMatrix.needsUpdate = true;
    wheel.instanceMatrix.needsUpdate = true;
    light.instanceMatrix.needsUpdate = true;
  }

  /// Advances the traffic. Cars run straight down a lane and wrap around.
  update(dt) {
    if (!this.cars.length) return;
    for (const car of this.cars) {
      car.pos += car.speed * car.dir * dt;
      const limit = car.center + car.reach;
      const start = car.center - car.reach;
      if (car.pos > limit) car.pos = start;
      else if (car.pos < start) car.pos = limit;
    }
    this._writeCarMatrices();
  }

  /// `dayAmount` is 1 in full daylight and 0 at night: windows, street lamps
  /// and headlights come on as it falls.
  applyTimeOfDay(dayAmount) {
    this._dayAmount = dayAmount;
    const night = 1 - Math.max(0, Math.min(1, dayAmount));
    if (this.litWindows) this.litWindows.material.emissiveIntensity = night * 1.7;
    if (this.lampHeads) this.lampHeads.material.emissiveIntensity = night * 2.2;
    if (this.headlights) this.headlights.material.emissiveIntensity = night * 2.6;
  }

  clear() {
    for (const d of this._disposables) {
      if (d && typeof d.dispose === "function") d.dispose();
    }
    this._disposables = [];
    this.group.clear();
    this.cars = [];
    this.carParts = null;
    this.litWindows = null;
    this.lampHeads = null;
    this.headlights = null;
    this.key = null;
  }

  dispose() {
    this.clear();
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
