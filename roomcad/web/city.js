// city.js — the stylised city the room stands in.
//
// Purely a visual reference: it gives the 3D walkthrough a sense of scale and
// place, and it is what you see through a window. It has no colliders, no
// lights of its own and no knowledge of the room model — walk3d.js hands it a
// building envelope and it builds a neighbourhood around it.
//
// Realism target: 4/10. Still readable, friendly, blocky shapes with flat
// colours rather than photoreal materials, but the things that read as "alive"
// from a window are modelled properly rather than faked:
//
//   - traffic obeys the lights, keeps its distance, brakes, accelerates and
//     indicates before it turns, and includes trucks and buses, not just cars;
//   - the ground is terrain rather than a slab, rising into hills beyond the
//     last street so the world has a visible end instead of dissolving in fog;
//   - nearby buildings are hollow, with real rooms behind their windows and a
//     bulb in the lit ones, so the windows have genuine depth as you move;
//   - weather is a state of the whole scene: rain, snow, or heavy cloud.
//
// Everything is instanced, so the whole city is roughly two dozen draw calls no
// matter how many buildings, vehicles or raindrops are on screen.

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

// Terrain. The streets themselves stay dead flat — a city is levelled ground,
// and the room's own floor sits on it — so the land only starts moving beyond
// the last kerb, and climbs into hills far enough out to read as the horizon.
const TERRAIN_SEGMENTS = 168;
// Close enough that the fog has not swallowed them — walk3d fogs out at 380 m
// and the camera stops at 400 — and far enough that the whole city sits in
// front of them. Push the ridge further out and it becomes flat fog-coloured
// nothing, which is the problem it exists to solve.
const HILL_REACH = 105;         // metres from the last street to the ridge
// Tall enough to clear the rooflines. A six-storey building 60 m away hides
// everything below about 60 m at the far side of the city, so a ridge of half
// that height is behind the skyline and might as well not be there — which is
// exactly how the first attempt at this looked from a window.
const HILL_HEIGHT = 100;
export const TERRAIN_FLAT_MARGIN = 0.35;  // of one block span, kept level

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
// Hills: pasture near the bottom, bare rock towards the tops.
const HILL_GRASS_COLOR = 0x5f8a4c;
const HILL_ROCK_COLOR = 0x7c7466;

// Building interiors. A room is a box open towards its window, so what you see
// through the opening is its far wall — which is why the windows have depth.
const CITY_WALL_T = 0.34;       // thickness of a city building's outer wall
const ROOM_DEPTH = 2.6;         // how far a room reaches back from its window
const WIN_W = 1.25;
const WIN_H = 1.55;
const WIN_SILL = 0.85;
const WIN_PITCH = 2.1;          // horizontal spacing between window centres
// Clearance between the back of a room and the solid middle of the building.
// Without it the two surfaces land on exactly the same plane, both get drawn —
// the core's face towards the viewer, the room's back wall away from it — and
// the depth buffer cannot choose between them. That is the flicker you see
// through every window of every building.
const CORE_CLEAR = 0.16;
const INTERIOR_COLOR = 0x5d564c;
const INTERIOR_LIT_COLOR = 0x7a6a55;
const INTERIOR_GLOW = 0xffd9a2;
const BULB_COLOR = 0xfff0cc;
const CORE_COLOR = 0x241f1b;    // the solid middle, so you cannot see through

const CAR_COLORS = [
  0xd94f4f, 0x4f7fd9, 0xe0c04a, 0x53b06a, 0xdedede,
  0x2f3238, 0xd98a4f, 0x8f6fd0,
];
const TRUCK_COLORS = [0xdfe2e6, 0x3f6fa8, 0xc8563c, 0x4a4f57, 0xd9c89a];
const BUS_COLORS = [0xd23f36, 0x2f6f3f, 0xe0a52c, 0x3a5f9e];
const TYRE_COLOR = 0x1b1d21;
const GLASS_COLOR = 0x2a3038;

// Traffic.
const LANE_OFFSET = 3.1;        // lane centre from the road centreline
const LIGHT_CYCLE = 26;         // seconds for a full two-phase cycle
const LIGHT_AMBER = 2.4;
// All-red after the amber. A bus entering on the last of the green needs
// several seconds to drag twelve metres of itself out of a thirteen-metre
// box; without this interval the crossing traffic is released while it is
// still in there.
const LIGHT_CLEAR = 3.5;
const TURN_RADIUS = 5.4;
const INDICATE_FROM = 24;       // metres before a junction the indicator starts
// Which way round a turn is, given traffic keeps left: one crosses the
// oncoming lane and has to give way, the other does not.
const NEAR_SIDE_TURN = -1;
const CROSSING_TURN = 1;
const BLINK_HZ = 1.5;
const SAFE_GAP = 2.4;           // bumper-to-bumper metres at a standstill
// The hardest any vehicle on these streets can brake. A follower has to assume
// the one in front might stop as fast as that, which is what keeps a truck —
// which cannot — far enough back from a car that can.
const BRAKE_MAX = 5.6;

// Weather is drawn as a box of drops around the viewer rather than over the
// whole city: a few thousand is then enough to fill any window in the room.
const PRECIP_RADIUS = 26;
const PRECIP_HEIGHT = 30;

/// The kinds of vehicle on the streets. `share` is how common each is; the
/// rest is what makes them behave differently — a bus pulls away from a light
/// far more slowly than a hatchback, and needs a great deal more room to stop.
const VEHICLE_KINDS = [
  {
    kind: "car", share: 0.66, length: [4.0, 4.9], width: 1.78,
    bodyH: 0.70, roofH: 0.58, roofFrac: 0.52, axles: 2,
    cruise: [9.5, 13.5], accel: 2.8, brake: 5.6, colors: CAR_COLORS,
  },
  {
    kind: "truck", share: 0.2, length: [8.4, 11.0], width: 2.42,
    bodyH: 1.18, roofH: 1.25, roofFrac: 0.3, axles: 3,
    cruise: [7.5, 10.0], accel: 1.5, brake: 4.2, colors: TRUCK_COLORS,
  },
  {
    kind: "bus", share: 0.14, length: [10.5, 12.2], width: 2.5,
    bodyH: 2.05, roofH: 0.5, roofFrac: 0.9, axles: 3,
    cruise: [7.0, 10.0], accel: 1.4, brake: 4.0, colors: BUS_COLORS,
  },
];

// Weather. `wet` darkens the ground the way rain does; `haze` is how much the
// air itself closes in, which walk3d reads to pull the fog in around the
// viewer. Snow settles as a pale wash rather than a dark one.
export const WEATHER_KINDS = ["clear", "cloudy", "rain", "snow"];
const WEATHER = {
  clear: { drops: 0, wet: 0, haze: 0, fall: 0, sway: 0, dim: 0 },
  cloudy: { drops: 0, wet: 0.12, haze: 0.35, fall: 0, sway: 0, dim: 0.25 },
  rain: { drops: 2600, wet: 0.62, haze: 0.75, fall: 17, sway: 0.7, dim: 0.45 },
  snow: { drops: 1700, wet: 0.30, haze: 0.6, fall: 1.5, sway: 1.5, dim: 0.35 },
};

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

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = t => t * t * (3 - 2 * t);
const smootherstep = t => t * t * t * (t * (t * 6 - 15) + 10);

/// Hash of a lattice point, for the terrain. Deterministic in the seed, so the
/// same room gets the same hills every time it is opened.
function latticeHash(ix, iz, seed) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/// Value noise in 0..1, smooth enough that the terrain has no visible lattice.
function valueNoise(x, z, seed) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const u = smootherstep(x - ix);
  const v = smootherstep(z - iz);
  const a = latticeHash(ix, iz, seed);
  const b = latticeHash(ix + 1, iz, seed);
  const c = latticeHash(ix, iz + 1, seed);
  const d = latticeHash(ix + 1, iz + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/// Several octaves of it, which is what turns smooth blobs into landscape.
function fbm(x, z, seed, octaves = 4) {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, z * freq, seed + i * 1013) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
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
const _color = new THREE.Color();
const _colorB = new THREE.Color();

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
    this.roomsLit = null;
    this.bulbs = null;
    this.lampHeads = null;
    this.headlights = null;
    this.terrain = null;
    this.precipitation = null;
    this.drops = [];
    this.junctions = [];
    this.roadX = [];
    this.roadZ = [];
    this.key = null;
    this._disposables = [];
    this._dayAmount = 1;
    this._weather = "clear";
    this._groundMaterials = [];
    this._clock = 0;       // seconds of traffic time, drives the lights
    this._viewer = new THREE.Vector3();
    this._turning = [];
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

    const sets = {
      facades: new InstanceSet(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 })
      ),
      roofs: new InstanceSet(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 })
      ),
      flats: new InstanceSet(       // pavements, kerbs, grass, road paint
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 })
      ),
      darkGlass: new InstanceSet(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: WINDOW_DARK, roughness: 0.25, metalness: 0.1 }),
        { colored: false }
      ),
      litGlass: new InstanceSet(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({
          color: WINDOW_DARK, emissive: WINDOW_LIT, emissiveIntensity: 0, roughness: 0.3,
        }),
        { colored: false }
      ),
      // Interiors are boxes seen from the inside: only their back faces are
      // drawn, so looking through a window opening shows the far wall of the
      // room rather than the outside of a block sitting in the hole.
      roomsDark: new InstanceSet(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({
          color: INTERIOR_COLOR, roughness: 0.95, metalness: 0, side: THREE.BackSide,
        }),
        { colored: false }
      ),
      roomsLit: new InstanceSet(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({
          color: INTERIOR_LIT_COLOR, emissive: INTERIOR_GLOW, emissiveIntensity: 0,
          roughness: 0.95, metalness: 0, side: THREE.BackSide,
        }),
        { colored: false }
      ),
      bulbs: new InstanceSet(
        new THREE.SphereGeometry(0.085, 6, 4),
        new THREE.MeshStandardMaterial({
          color: BULB_COLOR, emissive: BULB_COLOR, emissiveIntensity: 0, roughness: 0.4,
        }),
        { colored: false }
      ),
      trunks: new InstanceSet(
        new THREE.CylinderGeometry(0.13, 0.18, 1, 6),
        new THREE.MeshStandardMaterial({ color: TRUNK_COLOR, roughness: 1 }),
        { colored: false }
      ),
      canopies: new InstanceSet(
        new THREE.IcosahedronGeometry(1, 0),   // low-poly blob reads as stylised
        new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true })
      ),
      poles: new InstanceSet(
        new THREE.CylinderGeometry(0.07, 0.09, 1, 6),
        new THREE.MeshStandardMaterial({ color: LAMP_POLE_COLOR, roughness: 0.7, metalness: 0.3 }),
        { colored: false }
      ),
      lampHeads: new InstanceSet(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({
          color: 0xf6efd8, emissive: 0xffe6b0, emissiveIntensity: 0, roughness: 0.4,
        }),
        { colored: false }
      ),
    };

    this._groundMaterials = [sets.flats.material];
    this._terrain(cx, cz, reach, span, seed);

    for (let gx = -GRID_RADIUS; gx <= GRID_RADIUS; gx++) {
      for (let gz = -GRID_RADIUS; gz <= GRID_RADIUS; gz++) {
        const bx = cx + gx * span;
        const bz = cz + gz * span;
        const home = gx === 0 && gz === 0;
        this._blockPad(sets.flats, bx, bz, block, home ? plot : null);
        if (home) {
          this._homeTower(sets, bounds, floorLift, rnd);
        } else {
          // Only the ring of blocks you can actually see into gets hollow
          // buildings with rooms behind the windows. Further out the fog has
          // them, and a solid block with flat windows is indistinguishable.
          const near = Math.abs(gx) <= 1 && Math.abs(gz) <= 1;
          this._blockBuildings(sets, bx, bz, block, rnd, near);
        }
        this._blockTrees(sets, bx, bz, block, rnd);
      }
    }

    this._roadMarkings(sets.flats, cx, cz, block, span);
    this._streetLamps(sets.poles, sets.lampHeads, cx, cz, block, span);
    this._buildTraffic(cx, cz, span, reach, rnd);
    this._buildPrecipitation(rnd);

    sets.facades.build(this.group, "city-facades");
    sets.roofs.build(this.group, "city-roofs");
    sets.flats.build(this.group, "city-ground-details");
    sets.darkGlass.build(this.group, "city-windows-dark");
    this.litWindows = sets.litGlass.build(this.group, "city-windows-lit");
    sets.roomsDark.build(this.group, "city-rooms-dark");
    this.roomsLit = sets.roomsLit.build(this.group, "city-rooms-lit");
    this.bulbs = sets.bulbs.build(this.group, "city-bulbs");
    sets.trunks.build(this.group, "city-tree-trunks");
    sets.canopies.build(this.group, "city-tree-canopies");
    sets.poles.build(this.group, "city-lamp-poles");
    this.lampHeads = sets.lampHeads.build(this.group, "city-lamp-heads");

    this.group.traverse(node => {
      if (node.isInstancedMesh) {
        this._disposables.push(node.geometry, node.material);
      }
    });
    this.applyTimeOfDay(this._dayAmount);
    this.setWeather(this._weather);
  }

  // MARK: - Ground and blocks

  /// The land the city sits on. Flat under every street — a city is levelled
  /// ground, and the room's own floor sits at the same datum — then rolling
  /// beyond the last kerb and climbing into hills at the far edge, so the
  /// world ends in a horizon rather than fading out into empty fog.
  _terrain(cx, cz, reach, span, seed) {
    const flatTo = reach + span * TERRAIN_FLAT_MARGIN;
    const outer = flatTo + HILL_REACH;
    // The mesh carries on well past the ridge. `t` is clamped, so everything
    // beyond stays at ridge height — a plateau rather than an edge. Without it
    // the world simply stops at the top of the hills, and any dip in the ridge
    // line is a window onto nothing. What is out there is fogged out long
    // before the camera's far plane clips it.
    const size = (outer + 90) * 2;
    const geo = new THREE.PlaneGeometry(size, size, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const ground = new THREE.Color(ASPHALT_COLOR);
    const grass = new THREE.Color(HILL_GRASS_COLOR);
    const rock = new THREE.Color(HILL_ROCK_COLOR);

    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i);
      const lz = pos.getZ(i);
      // Chebyshev distance, because the city is a square of blocks: this keeps
      // the flat region square with the street grid instead of cutting corners
      // off the outermost blocks.
      const d = Math.max(Math.abs(lx), Math.abs(lz));
      const t = clamp01((d - flatTo) / (outer - flatTo));
      let y = 0;
      if (t > 0) {
        const wx = cx + lx;
        const wz = cz + lz;
        // Gentle undulation that grows with distance, so the join at the last
        // street is seamless rather than a step. It only ever rises: the
        // street datum is also the room's own floor level, and ground that
        // dips below it opens a gap at the edge of the city that you can see
        // straight under the pavement through.
        const roll = fbm(wx / 90, wz / 90, seed);   // 0..1, never negative
        y += smoothstep(clamp01(t * 2.2)) * 9 * roll;
        // The ridge itself. It has to reach full height WELL before the edge
        // of the mesh: ramping all the way out means the only part of it above
        // the city's rooflines is its lowest shoulder, and from a window there
        // is nothing to see. Full height by about 240 m, plateau beyond.
        const ridge = smootherstep(clamp01((t - 0.10) / 0.50));
        y += ridge * HILL_HEIGHT * (0.45 + 0.55 * fbm(wx / 165 + 40, wz / 165 - 25, seed + 7));
        pos.setY(i, y);
      }

      // Asphalt under the streets, blending out to pasture and then to bare
      // rock as the hills rise. The colour turns at the last block rather than
      // where the ground starts to move: keeping it grey out to there leaves a
      // wide apron of asphalt around the city with nothing on it, which reads
      // as a car park the size of the town.
      _color.copy(grass).lerp(rock, clamp01((y - 8) / (HILL_HEIGHT * 0.72)));
      const shade = 0.9 + 0.2 * valueNoise((cx + lx) / 11, (cz + lz) / 11, seed + 3);
      _color.multiplyScalar(shade);
      _colorB.copy(ground).lerp(_color, clamp01((d - (reach - ROAD_WIDTH)) / 16));
      colors[i * 3] = _colorB.r;
      colors[i * 3 + 1] = _colorB.g;
      colors[i * 3 + 2] = _colorB.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    const land = new THREE.Mesh(geo, mat);
    land.name = "city-terrain";
    land.position.set(cx, ROAD_Y, cz);
    land.receiveShadow = false;
    land.castShadow = false;
    land.frustumCulled = false;
    this.group.add(land);
    this.terrain = land;
    this._groundMaterials.push(mat);
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

  // MARK: - Buildings

  /// Two to four buildings per block, set back from the pavement. `detailed`
  /// builds them hollow, with rooms behind the windows; without it they are
  /// solid blocks with windows painted on, which is all the fog lets you see
  /// further out.
  _blockBuildings(sets, bx, bz, block, rnd, detailed) {
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
        if (detailed) {
          this._hollowBuilding(sets, x, z, w, d, storeys, PAVEMENT_Y, color, rnd);
        } else {
          sets.facades.add(boxMatrix(x, PAVEMENT_Y + h / 2, z, w, h, d), color);
          this._facadeWindows(sets.darkGlass, sets.litGlass, x, z, w, d, storeys, PAVEMENT_Y, rnd);
        }
        // A parapet reads as a roof without modelling one, and caps the shell
        // of a hollow building so you cannot see down into it from above.
        sets.roofs.add(boxMatrix(x, PAVEMENT_Y + h + 0.25, z, w + 0.5, 0.5, d + 0.5), ROOF_COLOR);
      }
    }
  }

  /// A building with an actual inside. Each wall is built as the masonry
  /// AROUND its windows — piers between them and bands above and below — so a
  /// window is a real hole, and behind every hole sits a room: a box open
  /// towards the street, with a bulb hanging in it if the light is on. That is
  /// where the depth comes from. Looking along a facade, the rooms slide past
  /// their openings exactly the way real ones do, which no amount of painted-on
  /// glass achieves.
  _hollowBuilding(sets, x, z, w, d, storeys, baseY, color, rnd) {
    const h = storeys * FLOOR_HEIGHT;
    const t = CITY_WALL_T;
    // Rooms are shallower in a small building, so that the ones behind facing
    // walls cannot meet in the middle.
    const depth = Math.min(ROOM_DEPTH, Math.min(w, d) / 4.2);
    const roomW = WIN_W + 0.35;

    // Where the windows sit vertically. The top storey stops short of the
    // parapet so there is always a band of wall under it.
    const rowsY = [];
    for (let s = 0; s < storeys; s++) {
      const y0 = baseY + s * FLOOR_HEIGHT + WIN_SILL;
      const y1 = Math.min(y0 + WIN_H, baseY + h - 0.3);
      if (y1 - y0 > 0.4) rowsY.push([y0, y1]);
    }

    for (const face of [{ nx: 0, nz: 1 }, { nx: 0, nz: -1 }, { nx: 1, nz: 0 }, { nx: -1, nz: 0 }]) {
      const alongX = face.nz !== 0;
      const other = alongX ? d : w;
      // The two side walls stop short of the front and back ones instead of
      // running the full depth. Four walls each taking the whole length all
      // meet in the corners, where their outer faces share a plane and fight
      // over it.
      const span = alongX ? w : d - t * 2;
      if (span <= 0.5) continue;
      // Centre of the wall slab, half a thickness in from the outer face.
      const wallX = alongX ? x : x + face.nx * (other / 2 - t / 2);
      const wallZ = alongX ? z + face.nz * (other / 2 - t / 2) : z;

      // Window centres are confined so that a room never reaches into the
      // depth the return wall's own rooms occupy — two rooms sharing a corner
      // interpenetrate, and their ceilings land on the same plane.
      const half = span / 2 - depth - roomW / 2;
      const centres = [];
      if (half > 0) {
        let count = Math.max(1, Math.floor((half * 2) / WIN_PITCH));
        // And no two rooms along this same wall may touch either.
        while (count > 1 && (half * 2) / (count + 1) < roomW + 0.12) count--;
        const step = (half * 2) / (count + 1);
        for (let i = 1; i <= count; i++) centres.push(-half + step * i);
      }

      // Piers: the full-height masonry between and beside the window columns.
      let cursor = -span / 2;
      const piers = [];
      for (const c of centres) {
        piers.push([cursor, c - WIN_W / 2]);
        cursor = c + WIN_W / 2;
      }
      piers.push([cursor, span / 2]);
      for (const [a, b] of piers) {
        if (b - a <= 0.02) continue;
        const mid = (a + b) / 2;
        sets.facades.add(boxMatrix(
          alongX ? wallX + mid : wallX,
          baseY + h / 2,
          alongX ? wallZ : wallZ + mid,
          alongX ? b - a : t, h, alongX ? t : b - a
        ), color);
      }

      // Bands: within each window column, the masonry above and below the
      // openings — sill to sill, and the parapet band over the top row.
      for (const c of centres) {
        const segs = [];
        let y = baseY;
        for (const [y0, y1] of rowsY) {
          segs.push([y, y0]);
          y = y1;
        }
        segs.push([y, baseY + h]);
        for (const [a, b] of segs) {
          if (b - a <= 0.02) continue;
          sets.facades.add(boxMatrix(
            alongX ? wallX + c : wallX,
            (a + b) / 2,
            alongX ? wallZ : wallZ + c,
            alongX ? WIN_W : t, b - a, alongX ? t : WIN_W
          ), color);
        }
      }

      // The rooms themselves, one per opening. The box starts at the outer
      // face and reaches back, so there is no gap at the reveal, and it is
      // drawn from the inside — its front face is culled, and what you see
      // through the window is its back and side walls.
      const roomH = FLOOR_HEIGHT - 0.35;
      for (const c of centres) {
        for (let r = 0; r < rowsY.length; r++) {
          const lit = rnd() < 0.34;
          const roomCY = baseY + r * FLOOR_HEIGHT + roomH / 2 + 0.12;
          const back = other / 2 - depth / 2;
          const rx = alongX ? x + c : x + face.nx * back;
          const rz = alongX ? z + face.nz * back : z + c;
          const box = boxMatrix(
            rx, roomCY, rz,
            alongX ? roomW : depth, roomH, alongX ? depth : roomW
          );
          (lit ? sets.roomsLit : sets.roomsDark).add(box);
          if (lit) {
            // The bulb hangs a little back from the glass, near the ceiling,
            // so it reads as the source of the light rather than as a sticker
            // on the window.
            const bulbIn = other / 2 - depth * 0.55;
            sets.bulbs.add(boxMatrix(
              alongX ? x + c : x + face.nx * bulbIn,
              roomCY + roomH / 2 - 0.34,
              alongX ? z + face.nz * bulbIn : z + c,
              1, 1, 1
            ));
          }
        }
      }
    }

    // A solid middle, so the building is not a lantern you can see straight
    // through from one street to the next. It stops clear of the backs of the
    // rooms rather than meeting them exactly.
    const coreW = w - 2 * (depth + CORE_CLEAR);
    const coreD = d - 2 * (depth + CORE_CLEAR);
    if (coreW > 0.2 && coreD > 0.2) {
      sets.facades.add(boxMatrix(x, baseY + h / 2, z, coreW, h, coreD), CORE_COLOR);
    }
  }

  /// The tower the room sits on, so an upper-floor room has a building beneath
  /// it instead of thin air. Floor 1 gets a low podium instead of a tower.
  /// Deliberately solid: this is the one piece of city geometry that comes
  /// within centimetres of the room's own floor slab, and a hollow shell here
  /// would put more surfaces near that depth for no visible gain — you are
  /// standing on top of it, not looking at it.
  _homeTower(sets, bounds, floorLift, rnd) {
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
    sets.facades.add(boxMatrix(x, height / 2, z, w, height, d), color);
    const storeys = Math.max(1, Math.round(height / FLOOR_HEIGHT));
    this._facadeWindows(sets.darkGlass, sets.litGlass, x, z, w, d, storeys, 0, rnd);
  }

  /// A grid of windows on all four faces, a few of them lit. Used for the
  /// buildings too far away to be worth hollowing out.
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

  _blockTrees(sets, bx, bz, block, rnd) {
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
        sets.trunks.add(boxMatrix(x, PAVEMENT_Y + trunkH / 2, z, 1, trunkH, 1));
        const canopy = new THREE.Matrix4().compose(
          new THREE.Vector3(x, PAVEMENT_Y + trunkH + r * 0.6, z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 0.6, rnd() * 3, 0)),
          new THREE.Vector3(r, r * 0.9, r)
        );
        sets.canopies.add(canopy, CANOPY_COLORS[Math.floor(rnd() * CANOPY_COLORS.length)]);
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

  /// Which side of the centreline a lane sits on. Traffic keeps LEFT, which is
  /// what Singapore does — and the sun in walk3d is a Singapore sun, so the
  /// streets may as well agree with the sky. Heading east that puts you on the
  /// northern side of the road, and so on round.
  static laneOffset(axis, dir) {
    return axis === "x" ? -LANE_OFFSET * dir : LANE_OFFSET * dir;
  }

  /// Unit vector for a lane direction. Turns are described relative to travel
  /// by rotating it: turning(A, +1) = (-az, ax) swings east to south, which
  /// with traffic keeping left is the turn ACROSS the oncoming lane; -1 is the
  /// near-side turn that crosses nothing.
  static forwardOf(axis, dir) {
    return axis === "x" ? { x: dir, z: 0 } : { x: 0, z: dir };
  }

  _buildTraffic(cx, cz, span, reach, rnd) {
    // Every road in the grid, as a coordinate and an index. Lights are timed
    // off the index, so neighbouring junctions are deliberately out of step.
    this.roadX = [];
    this.roadZ = [];
    for (let g = -GRID_RADIUS; g <= GRID_RADIUS + 1; g++) {
      this.roadX.push(cx + (g - 0.5) * span);
      this.roadZ.push(cz + (g - 0.5) * span);
    }

    // A lane object per road per direction. Every lane exists even where no
    // vehicle starts, because a turn has to have somewhere to turn into.
    this.lanes = new Map();
    const makeLane = (axis, dir, roadIndex) => {
      const road = axis === "x" ? this.roadZ[roadIndex] : this.roadX[roadIndex];
      const fixed = road + City.laneOffset(axis, dir);
      const lane = {
        axis, dir, roadIndex, fixed,
        center: axis === "x" ? cx : cz,
        reach,
        members: [],
      };
      this.lanes.set(`${axis}|${dir}|${roadIndex}`, lane);
      return lane;
    };
    for (let i = 0; i < this.roadZ.length; i++) {
      makeLane("x", 1, i);
      makeLane("x", -1, i);
    }
    for (let i = 0; i < this.roadX.length; i++) {
      makeLane("z", 1, i);
      makeLane("z", -1, i);
    }

    // Populate only the roads near enough to be seen through the fog.
    const populated = [];
    for (let i = 0; i < this.roadZ.length; i++) {
      if (Math.abs(this.roadZ[i] - cz) > span * 1.6) continue;
      populated.push(this.lanes.get(`x|1|${i}`), this.lanes.get(`x|-1|${i}`));
    }
    for (let i = 0; i < this.roadX.length; i++) {
      if (Math.abs(this.roadX[i] - cx) > span * 1.6) continue;
      populated.push(this.lanes.get(`z|1|${i}`), this.lanes.get(`z|-1|${i}`));
    }

    const PER_LANE = 4;
    this.cars = [];
    let id = 0;
    for (const lane of populated) {
      // Somewhere to put them that is not in a junction. Nudging a vehicle out
      // of one is not enough on its own: several in the same lane get nudged
      // to the same side of the same junction and start life on top of each
      // other. So the clear stretches are worked out first, and the vehicles
      // spread along those.
      const crossing = lane.axis === "x" ? this.roadX : this.roadZ;
      const clearOf = ROAD_WIDTH / 2 + 12;
      const slots = [];
      for (let a = lane.center - reach; a <= lane.center + reach; a += 4) {
        if (!crossing.some(road => Math.abs(a - road) < clearOf)) slots.push(a);
      }
      if (!slots.length) continue;
      for (let k = 0; k < PER_LANE; k++) {
        const pick = Math.floor((k + 0.2 + rnd() * 0.6) * slots.length / PER_LANE);
        const along = slots[Math.max(0, Math.min(slots.length - 1, pick))];
        const spec = City.pickKind(rnd());
        const length = spec.length[0] + rnd() * (spec.length[1] - spec.length[0]);
        const cruise = spec.cruise[0] + rnd() * (spec.cruise[1] - spec.cruise[0]);
        const forward = City.forwardOf(lane.axis, lane.dir);
        const v = {
          id: id++,
          kind: spec.kind,
          spec,
          lane,
          axis: lane.axis,
          dir: lane.dir,
          fixed: lane.fixed,
          center: lane.center,
          reach,
          x: lane.axis === "x" ? along : lane.fixed,
          z: lane.axis === "x" ? lane.fixed : along,
          heading: Math.atan2(forward.z, forward.x),
          // Everything starts off slowly and works up to its cruising speed,
          // rather than the whole city being at full tilt on frame one.
          speed: cruise * (0.15 + rnd() * 0.3),
          cruise,
          accel: spec.accel,
          brakeRate: spec.brake,
          length,
          width: spec.width,
          bodyH: spec.bodyH,
          roofH: spec.roofH,
          roofFrac: spec.roofFrac,
          axles: spec.axles,
          wheelR: spec.kind === "car" ? 0.34 : 0.5,
          color: spec.colors[Math.floor(rnd() * spec.colors.length)],
          braking: false,
          stopped: false,
          indicate: 0,
          turnDecidedAt: -1,
          turn: 0,
          arc: null,
          rng: makeRandom(Math.floor(rnd() * 0xffffff) + 1),
        };
        lane.members.push(v);
        this.cars.push(v);
      }
    }

    this._allocateVehicleMeshes();
    this._writeCarMatrices();
  }

  static pickKind(r) {
    let acc = 0;
    for (const spec of VEHICLE_KINDS) {
      acc += spec.share;
      if (r <= acc) return spec;
    }
    return VEHICLE_KINDS[0];
  }

  /// One InstancedMesh per kind of part, sized for the whole fleet. Vehicles
  /// never change type, so each one owns a fixed slice of every buffer and the
  /// per-frame work is pure matrix writing. The lamps are the exception: they
  /// are packed each frame and the instance count moved, so a lamp that is off
  /// is simply not drawn rather than drawn at zero size.
  _allocateVehicleMeshes() {
    const n = this.cars.length;
    if (!n) return;
    let boxes = 0;
    let wheels = 0;
    for (const v of this.cars) {
      v.boxStart = boxes;
      v.boxCount = v.kind === "truck" ? 2 : 1;
      boxes += v.boxCount;
      v.wheelStart = wheels;
      v.wheelCount = v.axles * 2;
      wheels += v.wheelCount;
    }

    const make = (geo, mat, count) => {
      const mesh = new THREE.InstancedMesh(geo, mat, count);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this._disposables.push(geo, mat);
      return mesh;
    };

    const lamp = (color, emissive, intensity) => new THREE.MeshStandardMaterial({
      color, emissive, emissiveIntensity: intensity, roughness: 0.4,
    });

    this.carParts = {
      body: make(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.25 }),
        n
      ),
      box: make(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.2 }),
        boxes
      ),
      wheel: make(
        new THREE.CylinderGeometry(1, 1, 1, 8),
        new THREE.MeshStandardMaterial({ color: TYRE_COLOR, roughness: 0.9 }),
        wheels
      ),
      head: make(
        new THREE.BoxGeometry(1, 1, 1),
        lamp(0xfff3d0, 0xffe9b8, 0),
        n * 2
      ),
      tail: make(
        new THREE.BoxGeometry(1, 1, 1),
        lamp(0x4a1210, 0xd8241a, 1.1),
        n * 2
      ),
      brake: make(
        new THREE.BoxGeometry(1, 1, 1),
        lamp(0x5a1512, 0xff2a18, 3.0),
        n * 2
      ),
      indicator: make(
        new THREE.BoxGeometry(1, 1, 1),
        lamp(0x5a3a10, 0xffa621, 3.0),
        n * 2
      ),
    };
    this.headlights = this.carParts.head;

    // Body colour, and the secondary boxes: a car's roof takes the body
    // colour, a bus's window band is glass, a truck gets a dark cab roof and a
    // pale box body.
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const v = this.cars[i];
      this.carParts.body.setColorAt(i, c.setHex(v.color));
      if (v.kind === "truck") {
        this.carParts.box.setColorAt(v.boxStart, c.setHex(GLASS_COLOR));
        this.carParts.box.setColorAt(v.boxStart + 1, c.setHex(v.color));
      } else if (v.kind === "bus") {
        this.carParts.box.setColorAt(v.boxStart, c.setHex(GLASS_COLOR));
      } else {
        this.carParts.box.setColorAt(v.boxStart, c.setHex(GLASS_COLOR));
      }
    }
    if (this.carParts.body.instanceColor) this.carParts.body.instanceColor.needsUpdate = true;
    if (this.carParts.box.instanceColor) this.carParts.box.instanceColor.needsUpdate = true;
  }

  /// Junction timing. The offset is derived from the road indices so that
  /// neighbouring junctions run out of phase, which is what produces the
  /// stop-start rhythm rather than the whole grid moving as one.
  _junctionOffset(ix, iz) {
    return (((ix * 5 + iz * 3) % 4) + 4) % 4 / 4 * LIGHT_CYCLE;
  }

  /// True while the light lets `axis` through. Amber counts as stop: a vehicle
  /// too close to pull up is carried through by its own braking distance
  /// rather than by permission.
  _isGreen(axis, ix, iz, t) {
    const local = (((t + this._junctionOffset(ix, iz)) % LIGHT_CYCLE) + LIGHT_CYCLE) % LIGHT_CYCLE;
    const half = LIGHT_CYCLE / 2;
    return axis === "x"
      ? local < half - LIGHT_AMBER - LIGHT_CLEAR
      : local >= half && local < LIGHT_CYCLE - LIGHT_AMBER - LIGHT_CLEAR;
  }

  /// How long until the CROSSING direction gets its green. A vehicle that
  /// cannot be clear of the junction by then does not enter it, which is both
  /// what a driver does and what keeps the box empty at the changeover.
  _timeToCrossGreen(axis, ix, iz, t) {
    const local = (((t + this._junctionOffset(ix, iz)) % LIGHT_CYCLE) + LIGHT_CYCLE) % LIGHT_CYCLE;
    const half = LIGHT_CYCLE / 2;
    const until = axis === "x" ? half - local : LIGHT_CYCLE - local;
    return ((until % LIGHT_CYCLE) + LIGHT_CYCLE) % LIGHT_CYCLE;
  }

  /// How far the vehicle has travelled along its lane, measured so that larger
  /// always means further ahead whichever way it is pointing.
  static progressOf(v) {
    return v.axis === "x" ? v.x * v.dir : v.z * v.dir;
  }

  /// The nearest vehicle ahead in the same lane, and the clear gap to it.
  _leader(v) {
    const mine = City.progressOf(v);
    let best = null;
    let bestGap = Infinity;
    for (const other of v.lane.members) {
      if (other === v || other.arc) continue;
      // Ordered by position along the lane, not by the gap: a gap tolerance
      // here means that a vehicle which has crept too close stops seeing the
      // one in front of it altogether, and then has no reason to brake — so
      // the pair stays locked together instead of recovering.
      if (City.progressOf(other) <= mine) continue;
      const gap = City.progressOf(other) - mine - (other.length + v.length) / 2;
      if (gap < bestGap) {
        bestGap = gap;
        best = other;
      }
    }
    return best ? { leader: best, gap: bestGap } : null;
  }

  /// Distance from this vehicle's nose to the stop line of the next junction,
  /// plus which junction it is. Negative once it is inside the junction.
  _nextJunction(v) {
    const coords = v.axis === "x" ? this.roadX : this.roadZ;
    const here = v.axis === "x" ? v.x : v.z;
    let bestIndex = -1;
    let bestDist = Infinity;
    for (let i = 0; i < coords.length; i++) {
      const ahead = (coords[i] - here) * v.dir;
      if (ahead < -ROAD_WIDTH) continue;
      if (ahead < bestDist) {
        bestDist = ahead;
        bestIndex = i;
      }
    }
    if (bestIndex < 0) return null;
    return {
      index: bestIndex,
      coord: coords[bestIndex],
      // To the near edge of the carriageway, less the vehicle's own nose.
      distance: bestDist - ROAD_WIDTH / 2 - v.length / 2,
    };
  }

  /// Chooses whether this vehicle turns at the junction it is approaching.
  /// Decided once, well before the junction, so the indicator has time to run
  /// before anything actually happens — which is the whole point of one.
  _decideTurn(v, junction) {
    if (v.turnDecidedAt === junction.index) return;
    v.turnDecidedAt = junction.index;
    v.turn = 0;
    // Never turn at the outermost junctions: there is no modelled road beyond
    // them, so the vehicle would drive off the end of the world.
    const coords = v.axis === "x" ? this.roadX : this.roadZ;
    if (junction.index === 0 || junction.index === coords.length - 1) return;
    // A bus on a route turns less often than a car running errands, and any
    // driver would rather take the turn that does not involve crossing the
    // oncoming lane.
    const appetite = v.kind === "car" ? 0.34 : 0.16;
    const r = v.rng();
    if (r < appetite * 0.68) v.turn = NEAR_SIDE_TURN;
    else if (r < appetite) v.turn = CROSSING_TURN;
  }

  /// Sets up the quarter-circle a turning vehicle follows. The arc is tangent
  /// to both lane centrelines, so the vehicle leaves its lane and joins the
  /// next one without a kink at either end.
  _beginTurn(v, junction) {
    const forward = City.forwardOf(v.axis, v.dir);
    // right(ax, az) = (-az, ax); left is its negative.
    const side = v.turn === 1
      ? { x: -forward.z, z: forward.x }
      : { x: forward.z, z: -forward.x };
    const newAxis = Math.abs(side.x) > 0.5 ? "x" : "z";
    const newDir = newAxis === "x" ? Math.sign(side.x) : Math.sign(side.z);
    // The road being turned onto is the one that makes this junction, so its
    // index is the junction's own index.
    const newIndex = junction.index;
    const lane = this.lanes.get(`${newAxis}|${newDir}|${newIndex}`);
    if (!lane) { v.turn = 0; return; }

    const R = TURN_RADIUS;
    // The two lane centrelines cross here.
    const P = newAxis === "z"
      ? { x: lane.fixed, z: v.fixed }
      : { x: v.fixed, z: lane.fixed };
    const C = {
      x: P.x - R * forward.x + R * side.x,
      z: P.z - R * forward.z + R * side.z,
    };
    const start = { x: P.x - R * forward.x, z: P.z - R * forward.z };
    // Only commit once the vehicle has actually reached the tangent point.
    if ((start.x - v.x) * forward.x + (start.z - v.z) * forward.z > 0.35) return;

    const theta0 = Math.atan2(start.z - C.z, start.x - C.x);
    const theta1 = Math.atan2(R * forward.z, R * forward.x);
    let sweep = theta1 - theta0;
    while (sweep > Math.PI) sweep -= Math.PI * 2;
    while (sweep < -Math.PI) sweep += Math.PI * 2;

    // The crossing turn cuts straight over the oncoming lane, so it has to
    // give way to it. Without this the turn is taken regardless and the
    // vehicle sweeps through whatever is coming the other way — which is by
    // far the commonest way two of them end up occupying the same ground.
    if (v.turn === CROSSING_TURN) {
      const oncoming = this.lanes.get(`${v.axis}|${-v.dir}|${v.lane.roadIndex}`);
      if (oncoming) {
        const turnSeconds = (R * Math.PI / 2) / Math.max(2, v.speed);
        for (const other of oncoming.members) {
          if (other.arc) continue;
          const here = other.axis === "x" ? other.x : other.z;
          const toJunction = (junction.coord - here) * other.dir;
          if (toJunction > -ROAD_WIDTH
            && toJunction < other.speed * (turnSeconds + 1.5) + ROAD_WIDTH) return;
        }
      }
    }

    // Never turn into a queue. Joining a lane is the one move that puts a
    // vehicle somewhere it was not a moment ago, so it is the one move that
    // can land on top of something; everything else is continuous.
    const exitProgress = newAxis === "x"
      ? (P.x + R * side.x) * newDir
      : (P.z + R * side.z) * newDir;
    // The gap has to be clear when the vehicle ARRIVES, not when it sets off:
    // a quarter circle takes over a second, and a car fifteen metres back down
    // the new road is exactly where the turn ends by the time it gets there.
    const turnTime = (R * Math.abs(sweep)) / Math.max(2, v.speed);
    for (const other of lane.members) {
      if (other.arc) continue;
      const need = (other.length + v.length) / 2 + SAFE_GAP + 1.5;
      const now = City.progressOf(other);
      const then = now + other.speed * turnTime;
      if (Math.abs(now - exitProgress) < need) return;   // occupied now
      if (Math.abs(then - exitProgress) < need) return;  // occupied on arrival
      if ((now - exitProgress) * (then - exitProgress) < 0) return;  // passes through
    }
    // And whoever else is already part-way round a turn into the same lane.
    // They are not in its member list yet — they join only when their arc
    // finishes — so without this two vehicles turning in from different
    // directions both aim at the same spot and one lands on the other.
    for (const other of this.cars) {
      if (other === v || !other.arc || other.arc.lane !== lane) continue;
      const need = (other.length + v.length) / 2 + SAFE_GAP + 1.5;
      if (Math.abs(other.arc.exitProgress - exitProgress) < need) return;
    }

    v.arc = { cx: C.x, cz: C.z, r: R, theta0, sweep, u: 0, lane, newAxis, newDir, exitProgress };
  }

  /// Moves a vehicle round its turn. Returns true while the turn is running.
  _advanceTurn(v, dt) {
    const arc = v.arc;
    const sweepLen = arc.r * Math.abs(arc.sweep);
    arc.u += (v.speed * dt) / Math.max(0.01, sweepLen);
    const u = Math.min(1, arc.u);
    const theta = arc.theta0 + arc.sweep * u;
    v.x = arc.cx + arc.r * Math.cos(theta);
    v.z = arc.cz + arc.r * Math.sin(theta);
    // Tangent to the circle, pointing the way round the vehicle is going.
    const sign = arc.sweep >= 0 ? 1 : -1;
    v.heading = Math.atan2(sign * Math.cos(theta), -sign * Math.sin(theta));
    if (arc.u < 1) return true;

    // Joined the new lane.
    const from = v.lane.members.indexOf(v);
    if (from >= 0) v.lane.members.splice(from, 1);
    v.lane = arc.lane;
    v.lane.members.push(v);
    v.axis = arc.newAxis;
    v.dir = arc.newDir;
    v.fixed = arc.lane.fixed;
    v.center = arc.lane.center;
    if (v.axis === "x") v.z = v.fixed; else v.x = v.fixed;
    const forward = City.forwardOf(v.axis, v.dir);
    v.heading = Math.atan2(forward.z, forward.x);
    v.arc = null;
    v.turn = 0;
    v.indicate = 0;
    v.turnDecidedAt = -1;
    return false;
  }

  /// One step of the traffic model for one vehicle: look at what is ahead,
  /// pick a speed, then accelerate or brake towards it. Everything visible —
  /// the brake lights, the indicators, the queue at a red light — falls out of
  /// this rather than being animated separately.
  _driveVehicle(v, dt) {
    if (v.arc) {
      v.braking = false;
      v.indicate = v.turn;
      // Drive THROUGH the turn. Without this the speed is frozen at whatever
      // it happened to be when the arc began, so a vehicle that crept into the
      // junction crawls all the way round at walking pace — several seconds
      // lying across the box, with the whole approach stopped behind it.
      const through = Math.min(v.cruise, 7);
      v.speed = v.speed < through
        ? Math.min(through, v.speed + v.accel * dt)
        : Math.max(through, v.speed - v.brakeRate * dt);
      this._advanceTurn(v, dt);
      return;
    }

    let desired = v.cruise;
    const heading = City.forwardOf(v.axis, v.dir);

    // Anything part-way round a turn is in no lane at all, but it is very much
    // in the way. Without this it is invisible to the traffic bearing down on
    // the junction, which then drives straight through it — the commonest
    // collision in the whole model, and entirely a perception failure rather
    // than a driving one.
    for (const other of this._turning) {
      if (other === v) continue;
      const dx = other.x - v.x;
      const dz = other.z - v.z;
      const along = dx * heading.x + dz * heading.z;
      if (along <= 0 || along > 40) continue;
      // A turning vehicle sits across the road, so its own LENGTH is what
      // sticks out sideways; assuming its width would badly underestimate a
      // bus halfway round.
      const across = Math.abs(dx * -heading.z + dz * heading.x);
      if (across > (v.width + other.length) / 2 + 0.8) continue;
      const room = along - (v.length + other.length) / 2 - SAFE_GAP;
      desired = Math.min(desired, Math.sqrt(Math.max(0, 2 * v.brakeRate * room)));
    }

    // Keep station behind whoever is in front.
    const ahead = this._leader(v);
    if (ahead) {
      // Travel no faster than lets you pull up in the room you actually have.
      // A flat proportional rule looks fine most of the time and then closes
      // the last metre anyway, because it does not know the vehicle's own
      // braking rate; a bus needs far more warning than a hatchback.
      // Safe-following speed: fast enough only that this vehicle can still
      // pull up in the room it has, plus however far the one in front will
      // travel before IT stops. Taking the leader's speed at face value —
      // "it is doing 8, so I can do 8" — is the optimistic version, and it
      // closes the last couple of metres whenever the leader brakes too.
      const room = ahead.gap - SAFE_GAP - 0.3;
      const leadRoom = ahead.leader.speed * ahead.leader.speed * (v.brakeRate / BRAKE_MAX);
      desired = Math.min(desired, Math.sqrt(Math.max(0, leadRoom + 2 * v.brakeRate * room)));
    }

    // Stop at a red light, and start looking far enough ahead to do it
    // smoothly rather than by slamming on at the line.
    const junction = this._nextJunction(v);
    if (junction) {
      this._decideTurn(v, junction);
      v.indicate = junction.distance < INDICATE_FROM ? v.turn : 0;
      const ix = v.axis === "x" ? junction.index : v.lane.roadIndex;
      const iz = v.axis === "x" ? v.lane.roadIndex : junction.index;
      const green = this._isGreen(v.axis, ix, iz, this._clock);
      // Three separate reasons not to enter a junction, all of which look the
      // same from outside — the vehicle waits at the line.
      let mayEnter = green;
      if (green) {
        // Would it still be in the box when the other direction is released?
        const crossSpeed = Math.max(v.speed, v.cruise * 0.55);
        const crossTime = (ROAD_WIDTH + v.length) / crossSpeed;
        if (crossTime > this._timeToCrossGreen(v.axis, ix, iz, this._clock)) mayEnter = false;
        // Is there anywhere to come out into? Stopping in the middle of a
        // junction because the queue beyond it has not moved is the other way
        // traffic ends up across someone else's right of way.
        if (mayEnter && ahead) {
          const needed = junction.distance + ROAD_WIDTH + v.length + SAFE_GAP;
          if (ahead.gap < needed) mayEnter = false;
        }
      }
      if (!mayEnter && junction.distance > -0.5) {
        // The speed it could still be doing here and stop by the line.
        const room = Math.max(0, junction.distance - 0.5);
        desired = Math.min(desired, Math.sqrt(2 * v.brakeRate * room));
      }
      if (v.turn !== 0 && mayEnter && junction.distance < TURN_RADIUS + 3) {
        desired = Math.min(desired, 6.5);   // slow down into the corner
        this._beginTurn(v, junction);
        if (v.arc) return;
      }
    } else {
      v.indicate = 0;
    }

    desired = Math.max(0, Math.min(desired, v.cruise));
    if (desired > v.speed) {
      v.speed = Math.min(desired, v.speed + v.accel * dt);
      v.braking = false;
    } else {
      v.speed = Math.max(desired, v.speed - v.brakeRate * dt);
      // Brake lights come on for a real deceleration, and stay on at a
      // standstill, which is what a driver sees in a queue.
      v.braking = desired < v.speed - 0.05 || v.speed < 0.3;
    }
    v.stopped = v.speed < 0.15;

    const forward = City.forwardOf(v.axis, v.dir);
    v.x += forward.x * v.speed * dt;
    v.z += forward.z * v.speed * dt;
    // Hold the lane exactly; a hundred frames of floating point otherwise
    // walks a vehicle sideways out of its own carriageway.
    if (v.axis === "x") v.z = v.fixed; else v.x = v.fixed;
    v.heading = Math.atan2(forward.z, forward.x);

    // Wrap beyond the fog, where the jump cannot be seen. A vehicle only ever
    // leaves by the end it is driving towards, and it re-enters BEHIND
    // whatever is already queued at the other end — without that, two vehicles
    // that wrap moments apart are placed on the same spot and drive along
    // inside one another.
    const coord = v.axis === "x" ? v.x : v.z;
    if ((coord - (v.center + v.reach * v.dir)) * v.dir <= 0) return;

    let entry = v.center - v.reach * v.dir;
    // Slot in behind the vehicle furthest back in the lane. That one is by
    // definition the closest to where this one is re-entering, so clearing it
    // clears everything — including a vehicle that wrapped a moment ago and
    // was itself pushed back past the nominal entry point.
    let rear = null;
    for (const other of v.lane.members) {
      if (other === v || other.arc) continue;
      if (rear === null || City.progressOf(other) < City.progressOf(rear)) rear = other;
    }
    if (rear) {
      const rearCoord = rear.axis === "x" ? rear.x : rear.z;
      const behind = rearCoord - v.dir * ((rear.length + v.length) / 2 + SAFE_GAP);
      if ((behind - entry) * v.dir < 0) entry = behind;
    }
    if (v.axis === "x") v.x = entry; else v.z = entry;
    v.turnDecidedAt = -1;
  }

  _writeCarMatrices() {
    if (!this.carParts) return;
    const { body, box, wheel, head, tail, brake, indicator } = this.carParts;
    const night = 1 - clamp01(this._dayAmount);
    const lightsOn = night > 0.25;
    const blinkOn = ((this._clock * BLINK_HZ) % 1) < 0.55;
    let heads = 0;
    let tails = 0;
    let brakes = 0;
    let indicators = 0;

    for (let i = 0; i < this.cars.length; i++) {
      const v = this.cars[i];
      const rotY = -v.heading;
      const fx = Math.cos(v.heading);
      const fz = Math.sin(v.heading);
      const rx = -fz;          // the vehicle's right-hand side
      const rz = fx;
      const L = v.length;
      const W = v.width;
      const wheelR = v.wheelR;
      const floor = ROAD_Y + wheelR * 0.55;

      body.setMatrixAt(i, boxMatrix(v.x, floor + v.bodyH / 2, v.z, L, v.bodyH, W, rotY, _m));

      // Secondary boxes: a cabin, a bus's window band, or a truck's cab and
      // its box body.
      const bodyTop = floor + v.bodyH;
      if (v.kind === "truck") {
        const cabAt = L * 0.34;
        box.setMatrixAt(v.boxStart, boxMatrix(
          v.x + fx * cabAt, bodyTop + v.roofH / 2, v.z + fz * cabAt,
          L * v.roofFrac, v.roofH, W * 0.94, rotY, _m
        ));
        const cargoAt = -L * 0.2;
        box.setMatrixAt(v.boxStart + 1, boxMatrix(
          v.x + fx * cargoAt, bodyTop + v.roofH * 0.62, v.z + fz * cargoAt,
          L * 0.58, v.roofH * 1.24, W * 0.99, rotY, _m
        ));
      } else {
        const at = v.kind === "bus" ? 0 : -L * 0.07;
        const bandH = v.kind === "bus" ? 0.9 : v.roofH;
        const bandY = v.kind === "bus" ? floor + v.bodyH * 0.66 : bodyTop + v.roofH / 2;
        box.setMatrixAt(v.boxStart, boxMatrix(
          v.x + fx * at, bandY, v.z + fz * at,
          L * v.roofFrac, bandH, W * (v.kind === "bus" ? 1.01 : 0.87), rotY, _m
        ));
      }

      // Wheels. A cylinder's axis is Y, so it is tipped a quarter turn to put
      // the axle across the vehicle, then turned with the body.
      const axleSpacing = v.axles === 2 ? [0.32, -0.32] : [0.36, -0.16, -0.32];
      let w = 0;
      for (const a of axleSpacing) {
        for (const s of [-1, 1]) {
          const px = v.x + fx * (L * a) + rx * (W * 0.46) * s;
          const pz = v.z + fz * (L * a) + rz * (W * 0.46) * s;
          _pos.set(px, ROAD_Y + wheelR, pz);
          _euler.set(Math.PI / 2, rotY, 0, "YXZ");
          _q.setFromEuler(_euler);
          _scale.set(wheelR, W * 0.11, wheelR);
          wheel.setMatrixAt(v.wheelStart + w, _m.compose(_pos, _q, _scale));
          w++;
        }
      }

      // Lamps, arranged the way a real car's are: a cluster at each of the four
      // corners. The white headlight and the red tail light sit outboard where
      // the corner is, and the amber indicator sits immediately inboard of each
      // — one housing, read as one unit. Nothing is drawn at zero size; a lamp
      // that is off is simply not written, and the instance count moves.
      const nose = L / 2 + 0.02;
      const back = -L / 2 - 0.02;
      const lampY = floor + v.bodyH * 0.55;
      const outer = W * 0.36;   // headlight / tail light, on the corner
      const inner = W * 0.19;   // indicator, beside it in the same cluster

      // Headlights and tail lights are position lamps: both come on after
      // dark and stay on. The tail light shares its housing with the brake
      // light, so it gives way to it rather than being drawn underneath.
      if (lightsOn) {
        for (const s of [-1, 1]) {
          head.setMatrixAt(heads++, boxMatrix(
            v.x + fx * nose + rx * outer * s,
            lampY, v.z + fz * nose + rz * outer * s,
            0.16, 0.17, 0.30, rotY, _m
          ));
        }
        if (!v.braking) {
          for (const s of [-1, 1]) {
            tail.setMatrixAt(tails++, boxMatrix(
              v.x + fx * back + rx * outer * s,
              lampY, v.z + fz * back + rz * outer * s,
              0.13, 0.19, 0.32, rotY, _m
            ));
          }
        }
      }

      // Brake lights are the same lamp lit hard, and are meant to be visible
      // in daylight as well — that is the whole point of them.
      if (v.braking) {
        for (const s of [-1, 1]) {
          brake.setMatrixAt(brakes++, boxMatrix(
            v.x + fx * back + rx * outer * s,
            lampY, v.z + fz * back + rz * outer * s,
            0.13, 0.19, 0.34, rotY, _m
          ));
        }
      }

      // Indicators: both lamps down the side being turned towards, front and
      // rear, each one tucked in beside its cluster's main lamp.
      if (v.indicate !== 0 && blinkOn) {
        const s = v.indicate;   // +1 right-hand side, -1 left-hand side
        indicator.setMatrixAt(indicators++, boxMatrix(
          v.x + fx * nose + rx * inner * s,
          lampY, v.z + fz * nose + rz * inner * s,
          0.12, 0.16, 0.20, rotY, _m
        ));
        indicator.setMatrixAt(indicators++, boxMatrix(
          v.x + fx * back + rx * inner * s,
          lampY, v.z + fz * back + rz * inner * s,
          0.12, 0.16, 0.20, rotY, _m
        ));
      }
    }

    head.count = heads;
    tail.count = tails;
    brake.count = brakes;
    indicator.count = indicators;
    body.instanceMatrix.needsUpdate = true;
    box.instanceMatrix.needsUpdate = true;
    wheel.instanceMatrix.needsUpdate = true;
    head.instanceMatrix.needsUpdate = true;
    tail.instanceMatrix.needsUpdate = true;
    brake.instanceMatrix.needsUpdate = true;
    indicator.instanceMatrix.needsUpdate = true;
  }

  /// Advances the traffic and the weather. `viewer` is where the camera is, so
  /// the precipitation can follow it rather than being a fixed block of rain
  /// somewhere over the neighbourhood.
  update(dt, viewer = null) {
    // The simulation has a stability limit of its own, independent of whatever
    // the render loop hands it: a single enormous step would carry a vehicle
    // through a junction, past the car in front and out of its lane in one go.
    if (!Number.isFinite(dt)) return;
    const step = Math.min(Math.max(dt, 0), 0.1);
    this._clock += step;
    if (viewer) this._viewer.copy(viewer);

    if (this.cars.length) {
      // Who is part-way round a turn. They belong to no lane while they are
      // crossing, so everyone else has to be told about them explicitly.
      this._turning.length = 0;
      for (const v of this.cars) if (v.arc) this._turning.push(v);
      for (const v of this.cars) this._driveVehicle(v, step);
      this._writeCarMatrices();
    }
    this._updatePrecipitation(step);
  }

  // MARK: - Weather

  _buildPrecipitation(rnd) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xcdd8e6, transparent: true, opacity: 0.5, depthWrite: false, fog: true,
    });
    const most = Math.max(...WEATHER_KINDS.map(k => WEATHER[k].drops));
    const mesh = new THREE.InstancedMesh(geo, mat, most);
    mesh.name = "city-precipitation";
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.count = 0;
    this.group.add(mesh);
    this._disposables.push(geo, mat);
    this.precipitation = mesh;

    // Offsets from the viewer, so the field travels with whoever is looking.
    this.drops = [];
    for (let i = 0; i < most; i++) {
      this.drops.push({
        ox: (rnd() - 0.5) * PRECIP_RADIUS * 2,
        oy: rnd() * PRECIP_HEIGHT,
        oz: (rnd() - 0.5) * PRECIP_RADIUS * 2,
        rate: 0.75 + rnd() * 0.5,
        phase: rnd() * Math.PI * 2,
      });
    }
  }

  /// Rain and snow fall relative to the viewer and wrap within a box around
  /// them, which is why a few thousand drops are enough to look like weather
  /// from any window in the room.
  _updatePrecipitation(dt) {
    const mesh = this.precipitation;
    if (!mesh) return;
    const cfg = WEATHER[this._weather] || WEATHER.clear;
    if (!cfg.drops) {
      mesh.count = 0;
      return;
    }
    const snow = this._weather === "snow";
    const w = snow ? 0.075 : 0.022;
    const h = snow ? 0.075 : 0.6;
    const vx = this._viewer.x;
    const vy = this._viewer.y;
    const vz = this._viewer.z;
    for (let i = 0; i < cfg.drops; i++) {
      const d = this.drops[i];
      d.oy -= cfg.fall * d.rate * dt;
      if (cfg.sway) {
        d.phase += dt * (snow ? 1.6 : 4.2) * d.rate;
        d.ox += Math.cos(d.phase) * cfg.sway * dt;
        d.oz += Math.sin(d.phase * 0.7) * cfg.sway * dt;
      }
      // Wrap through the box around the viewer.
      if (d.oy < -PRECIP_HEIGHT * 0.35) d.oy += PRECIP_HEIGHT;
      if (d.ox > PRECIP_RADIUS) d.ox -= PRECIP_RADIUS * 2;
      else if (d.ox < -PRECIP_RADIUS) d.ox += PRECIP_RADIUS * 2;
      if (d.oz > PRECIP_RADIUS) d.oz -= PRECIP_RADIUS * 2;
      else if (d.oz < -PRECIP_RADIUS) d.oz += PRECIP_RADIUS * 2;
      mesh.setMatrixAt(i, boxMatrix(vx + d.ox, vy + d.oy, vz + d.oz, w, h, w, 0, _m));
    }
    mesh.count = cfg.drops;
    mesh.instanceMatrix.needsUpdate = true;
  }

  /// Sets the weather for the whole scene. walk3d reads `atmosphere()` back to
  /// pull the fog in and take the edge off the sun to match.
  setWeather(kind) {
    this._weather = WEATHER_KINDS.includes(kind) ? kind : "clear";
    const cfg = WEATHER[this._weather];
    if (this.precipitation) {
      const snow = this._weather === "snow";
      this.precipitation.material.color.setHex(snow ? 0xffffff : 0xcdd8e6);
      this.precipitation.material.opacity = snow ? 0.85 : 0.45;
      this.precipitation.count = 0;   // repopulated on the next frame
    }
    // Wet ground is darker ground. The materials are white and the colour
    // comes from the instances, so scaling the material colour dims the whole
    // street at once — the same trick the day/night code uses on emissives.
    const wetness = 1 - cfg.wet * 0.45;
    for (const mat of this._groundMaterials) {
      if (mat) mat.color.setScalar(wetness);
    }
    this.applyTimeOfDay(this._dayAmount);
  }

  /// What the weather is doing to the air, for walk3d's fog and sun.
  atmosphere() {
    const cfg = WEATHER[this._weather] || WEATHER.clear;
    return { kind: this._weather, haze: cfg.haze, dim: cfg.dim, wet: cfg.wet };
  }

  /// `dayAmount` is 1 in full daylight and 0 at night: windows, street lamps,
  /// room bulbs and headlights come on as it falls. Heavy weather brings them
  /// on a little early, the way a dark afternoon does.
  applyTimeOfDay(dayAmount) {
    this._dayAmount = dayAmount;
    const cfg = WEATHER[this._weather] || WEATHER.clear;
    const night = clamp01(1 - Math.max(0, Math.min(1, dayAmount)) + cfg.dim * 0.5);
    if (this.litWindows) this.litWindows.material.emissiveIntensity = night * 1.7;
    if (this.roomsLit) this.roomsLit.material.emissiveIntensity = night * 1.15;
    if (this.bulbs) this.bulbs.material.emissiveIntensity = night * 3.2;
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
    this.lanes = new Map();
    this.junctions = [];
    this.roadX = [];
    this.roadZ = [];
    this.drops = [];
    this._turning = [];
    this.precipitation = null;
    this.terrain = null;
    this.litWindows = null;
    this.roomsLit = null;
    this.bulbs = null;
    this.lampHeads = null;
    this.headlights = null;
    this._groundMaterials = [];
    this.key = null;
  }

  dispose() {
    this.clear();
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
