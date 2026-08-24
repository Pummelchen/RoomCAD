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
const BAY_LINE_COLOR = 0xd8d3c2;    // the box a car parks inside
const BUS_BOX_COLOR = 0xb8452f;     // bus stops are painted, and only for buses
const TRUNK_COLOR = 0x6b4f36;
const GROUND_DEPTH = 2;         // how thick the walkable ground slab is made
const TREE_MAX_RADIUS = 1.8;    // the biggest canopy _blockTrees will draw
const TREE_KERB_CLEAR = 0.3;    // ... and how far short of the kerb it must stop
const CANOPY_COLORS = [0x5c8a45, 0x6f9c52, 0x4e7a3b];
const LAMP_POLE_COLOR = 0x4a4d53;
// City lighting. Every one of these has a REACH, because a light that carries
// forever is a light that has to be considered everywhere — and the only way to
// afford three hundred of them is to know which few can be seen.
const LAMP_LIGHT_COLOR = 0xffd9a0;
const LAMP_LIGHT_POWER = 26;
const LAMP_LIGHT_REACH = 17;
const HEADLAMP_COLOR = 0xfff4e0;
const HEADLAMP_POWER = 12;
const HEADLAMP_THROW = 13;
const BRAKE_LIGHT_COLOR = 0xff2a18;
const BRAKE_LIGHT_POWER = 4;
const BRAKE_LIGHT_REACH = 6;
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
// House numbers, drawn as blocks rather than as text. A texture per building
// would mean a canvas and an upload each; a 3x5 block font costs a handful of
// instances and suits a city made of boxes.
const DIGIT_ROWS = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
};
const DIGIT_CELL = 0.062;
const DOOR_W = 1.45;
const DOOR_H = 2.35;
const ENTRANCE_COLOR = 0x2b2622;   // the doorway itself, in shadow
const SURROUND_COLOR = 0xd8d2c4;   // stone surround and canopy
const STEP_COLOR = 0xb9b3a6;
const NUMBER_PLATE = 0x1d1a17;
const NUMBER_COLOR = 0xe8c46a;     // brass, and bright enough to read at night


const CAR_COLORS = [
  0xd94f4f, 0x4f7fd9, 0xe0c04a, 0x53b06a, 0xdedede,
  0x2f3238, 0xd98a4f, 0x8f6fd0,
];
const TRUCK_COLORS = [0xdfe2e6, 0x3f6fa8, 0xc8563c, 0x4a4f57, 0xd9c89a];
const BUS_COLORS = [0xd23f36, 0x2f6f3f, 0xe0a52c, 0x3a5f9e];
const VAN_COLORS = [0xf2f4f7, 0xdfe3e8, 0xc8ced6, 0x8d9aa8, 0x3f6fae];
const TYRE_COLOR = 0x1b1d21;
const GLASS_COLOR = 0x2a3038;
const CITY_GLASS_COLOR = 0xcfe2ee;  // the pane in a near building's window
const CITY_GLASS_T = 0.04;
const CITY_GLASS_INSET = 0.07;      // set back from the face, so it is in a reveal

// Traffic.
const LANE_OFFSET = 2.9;        // lane centre from the road centreline
const LIGHT_CYCLE = 30;         // the nominal cycle, and what a balanced junction still runs
const GREEN_MIN = 6;            // never shorter, however empty the approach
const GREEN_MAX = 26;           // never longer, however long the queue
const GREEN_EXTEND = 2;         // held on, while vehicles are still coming through
const QUEUE_REACH = 45;         // how far back from a junction a vehicle counts as queueing
const QUEUE_SLOW = 1.5;         // ... and how slow it has to be to count as waiting rather than arriving
const LIGHT_AMBER = 2.0;
// All-red after the amber. A bus entering on the last of the green needs
// several seconds to drag twelve metres of itself out of a thirteen-metre
// box; without this interval the crossing traffic is released while it is
// still in there.
// Two seconds, not the three and a half it started at. Nothing enters a
// junction it cannot clear before the crossing direction is released — that is
// checked per vehicle, against its own length and speed — so this interval is
// a margin rather than the thing keeping the junction safe, and every second of
// it is a second in which nobody moves.
const LIGHT_CLEAR = 2.0;
const TURN_RADIUS = 5.4;
const INDICATE_FROM = 24;       // metres before a junction the indicator starts
const TURN_REVIEW_FROM = 14;    // ... and the last point one can be reconsidered
// Which way round a turn is, given traffic keeps right: turning right stays on
// your own side of the road, turning left cuts across the oncoming lane and has
// to give way to it. Reversed from what these were when traffic kept left.
export const NEAR_SIDE_TURN = 1;
export const CROSSING_TURN = -1;
const BLINK_HZ = 1.5;
const SAFE_GAP = 2.4;           // bumper-to-bumper metres at a standstill
// Every driver has their own pace. The kind of vehicle sets the base speed —
// a bus is not a hatchback — and this is the multiplier on top of it, so some
// press on and some dawdle. Without it a lane of the same kind moves as one
// block, which is the thing that makes model traffic look modelled.
const PACE_SLOWEST = 0.90;
const PACE_FASTEST = 1.20;
// How many vehicles are on the streets altogether, spread over every lane.
const FLEET_SIZE = 240;

// Kerbside stopping.
//
// A thirteen-metre street will not take a parked bus AND passing buses: at any
// offset that clears the running lane the bus is up on the pavement, and at any
// offset inside the kerb something wide clips it. So only cars use the bays as
// parking. A bus at a stop pulls over as far as it fits and the traffic behind
// it waits, which is what a kerbside stop without a layby does; a truck loading
// stops in the lane outright, which is what they do everywhere.
export const PARK_OFFSET = 2.5;        // a parked car, clear of the running lane
export const VAN_OFFSET = 2.6;         // a van at the kerb, offloading
// How much room a stopped vehicle has to leave beside it before the traffic
// stops having to go round: half the widest vehicle, and a little.
const LANE_CLEAR = 1.5;
export const BUS_STOP_OFFSET = 3.4;    // right into the layby, out of the running lane
export const BAY_PITCH = 7.0;          // one parking space
export const RESERVE_TTL = 40;         // how long a vehicle may hold a space it has not reached
// No bay within this of a junction centre. The stop line is at ten metres and
// the crossing just inside it, so this leaves several metres of clear kerb
// before either.
export const PARK_CLEAR = 16;
export const PARK_SHARE = 0.5;         // at most this fraction of the fleet parked at once
export const PARK_MIN = 5 * 60;        // five minutes
export const PARK_MAX = 120 * 60;      // two hours
const PARK_APPROACH = 26;       // how far off a vehicle starts lining up for its space
const KERB_EASE_FROM = 7;       // ... and how close before it starts pulling over
const PARK_PATIENCE = 15 * 60;  // how long it holds out for the space it set off for
const START_PARKED = 0.9;       // of the parking cap, filled before the city starts
// Reversing into a space, as two arcs of opposite lock: swing the tail in, then
// straighten. The geometry is fixed by the two of them having to add up to the
// distance from the running lane to the kerb — 2R(1-cos t) across, 2R sin t
// along — so choosing the angle chooses the radius and the run-up.
export const REVERSE_ANGLE = 35 * Math.PI / 180;
export const REVERSE_RADIUS = PARK_OFFSET / (2 * (1 - Math.cos(REVERSE_ANGLE)));
export const REVERSE_RUN = 2 * REVERSE_RADIUS * Math.sin(REVERSE_ANGLE);
const REVERSE_SPEED = 1.1;      // walking pace, backwards
const REVERSE_SLACK = 1.8;      // the room a gap needs beyond the vehicle itself
const MANOEUVRE_WAIT = 1.2;     // the pause between stopping and selecting reverse
export const UNLOAD_MIN = 5 * 60;      // a van at the kerb, offloading
export const UNLOAD_MAX = 15 * 60;
const UNLOAD_CHANCE = 0.02;     // per free bay a van passes
export const BUS_DWELL_MIN = 60;       // a bus calls for a minute
export const BUS_DWELL_MAX = 300;      // ... and at most five
const BUS_STOP_COOLDOWN = 90;   // it does not call at two stops in a row
export const BUS_STOPS_PER_BLOCK = 2;  // out of the block's four sides
const LAYBY_DEPTH = 2.6;        // how far a bus stop is cut back into the pavement
const LAYBY_TAPER = 4.0;        // the angled run in and out of it
// How much kerb a vehicle needs beyond its own length. Parallel parking wants
// about half a vehicle of slack, and at 2.5 m a 6.6 m van claimed a single 7 m
// bay — four centimetres of room at each end. It reversed into it and clipped
// whatever was parked in front: 18 contacts in fifteen minutes. At 4 m a van
// takes two bays and simply pulls in, and a car still takes one.
const BAY_CLEARANCE = 4.0;
const BAY_LINE_W = 0.12;        // painted bay markings
const BAY_LENGTH = 5.6;         // the box itself, inside the pitch
const PARK_BOX_DEPTH = 2.3;     // how far the painted box reaches into the road
const BUS_LAYBY_LENGTH = 17;    // room for a bus and the taper either end
// Junction furniture. A driver meets the stop line, then the crossing, then
// the carriageway, so the crossing sits between the line and the junction.
const CROSS_GAP = 0.6;          // carriageway edge to the near edge of the crossing
const CROSS_DEPTH = 2.6;        // how deep the crossing is, along the road
const CROSS_BAR = 0.55;         // one white bar, across the road
const CROSS_BAR_GAP = 0.45;
const STOP_LINE_W = 0.35;
// Where a vehicle's nose comes to rest, measured out from the junction centre:
// the far side of the crossing, which is what the stop line is painted on.
const STOP_LINE_AT = ROAD_WIDTH / 2 + CROSS_GAP + CROSS_DEPTH + STOP_LINE_W;
// ── Turn control ──────────────────────────────────────────────────────────
// Each approach carries three turn arrows on top of its main signal, and the
// manager reds out the ones that would feed a street which is already full.
// This is what keeps the grid from seizing: the jam is not caused by too many
// vehicles but by spillback — a vehicle waiting at the line for room in the
// lane it wants to turn into blocks everyone behind it, including the ones
// who were going somewhere empty. Measured at 240 vehicles, 26 were held at
// stop lines with nowhere to turn into and 129 more were queued behind them.
export const TURN_CONTROL_PERIOD = 2;   // seconds between reviews
const TURN_SLOT = 8;            // road length one vehicle and its gap occupy
const TURN_LOAD_FLOOR = 0.5;    // never red-out a street emptier than this
const TURN_LOAD_FACTOR = 1.35;  // ... nor one within this much of the average
const ROUTE_CONGESTION = 2.5;   // how many junctions of detour a full street is worth

const SIGNAL_HEIGHT = 3.4;
const SIGNAL_HEAD_H = 0.86;
const SIGNAL_POLE_COLOR = 0x33363b;
const SIGNAL_HOUSING_COLOR = 0x24272b;
const SIGNAL_DARK = 0x15171a;
const SIGNAL_RED = 0xff2a1e;
const SIGNAL_AMBER = 0xffa617;
const SIGNAL_GREEN = 0x2ce05a;
const ARROW_PITCH = 0.17;       // sideways spacing of the three turn arrows
const ARROW_DROP = 0.11;        // how far the arrow bar hangs below the main head
const ARROW_SIZE = 0.115;
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
///
/// `cruise` is the base speed for the KIND, in metres per second. The spread
/// within a kind comes entirely from each driver's own pace, so the two do not
/// compound: a range here multiplied by a range there gave cars anything from
/// 34 to 58 km/h, which is a wider gap than the streets should have.
const VEHICLE_REF = {
  car: { L: 4.45, W: 1.78, wheelR: 0.34, lampY: 0.62 },
  van: { L: 6.0, W: 1.9, wheelR: 0.38, lampY: 0.70 },
  truck: { L: 9.7, W: 2.42, wheelR: 0.5, lampY: 0.86 },
  bus: { L: 11.35, W: 2.5, wheelR: 0.5, lampY: 0.72 },
};

const VEHICLE_KINDS = [
  {
    kind: "car", share: 0.66, length: [4.0, 4.9], width: 1.78,
    bodyH: 0.70, roofH: 0.58, roofFrac: 0.52, axles: 2,
    cruise: 11.5, accel: 2.8, brake: 5.6, colors: CAR_COLORS,
  },
  {
    // The delivery van: short enough to pull into a parking bay, which is the
    // whole point of it. Loading used to be done by the artics, standing in the
    // running lane for ten minutes at a time — a lane closed, on a grid with
    // one lane each way.
    kind: "van", share: 0.12, length: [5.4, 6.6], width: 1.9,
    bodyH: 1.02, roofH: 0.72, roofFrac: 0.62, axles: 2,
    cruise: 10.0, accel: 2.2, brake: 5.0, colors: VAN_COLORS,
  },
  {
    kind: "truck", share: 0.08, length: [8.4, 11.0], width: 2.42,
    bodyH: 1.18, roofH: 1.25, roofFrac: 0.3, axles: 3,
    cruise: 8.8, accel: 1.5, brake: 4.2, colors: TRUCK_COLORS,
  },
  {
    kind: "bus", share: 0.14, length: [10.5, 12.2], width: 2.5,
    bodyH: 2.05, roofH: 0.5, roofFrac: 0.9, axles: 3,
    cruise: 8.5, accel: 1.4, brake: 4.0, colors: BUS_COLORS,
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

/// Genuinely unpredictable, for decisions a vehicle makes while the city is
/// running. Everything that BUILDS the city — where the buildings go, how tall
/// they are, which windows are lit, where the hills are — uses the seeded
/// generator below instead, so reopening a room gives back the same place.
/// What the traffic then does in it is not meant to be the same twice: reload
/// the room and the cars take different turnings.
///
/// This is the only place the city reaches for real randomness, which is what
/// lets a test check that the geometry never does.
function trueRandom() {
  return Math.random();
}

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
const _arrowFace = new THREE.Matrix4();
const _arrowRoll = new THREE.Matrix4();
const _arrowScale = new THREE.Matrix4();
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

// MARK: - Vehicle bodies
//
// A vehicle is one merged mesh rather than a handful of boxes written
// separately every frame. That buys the detail — a greenhouse that steps in
// from the body, glass, door shut lines, bumpers, mirrors — for LESS per-frame
// work than the old three-box car cost, because the whole thing is a single
// instance with a single matrix. The lamps stay separate: they are the only
// part that changes independently of the body.
//
// Colour comes from the instance, which MULTIPLIES these vertex colours, so
// bodywork is left white to take the vehicle's own paint, and glass and tyres
// are dark enough to stay dark whatever colour is laid over them.
const PAINT = 0xffffff;      // takes the vehicle's colour
const GLASS = 0x24282e;
const TYRE = 0x101114;
const TRIM = 0x4a4d52;
const GRILLE = 0x2a2c30;

/// Collects boxes and cylinders into one indexed-free geometry.
function partBuilder() {
  const position = [];
  const normal = [];
  const color = [];
  const c = new THREE.Color();

  const push = (geo, matrix, hex) => {
    const g = geo.clone();
    g.applyMatrix4(matrix);
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const index = g.index;
    c.setHex(hex);
    const count = index ? index.count : p.count;
    for (let i = 0; i < count; i++) {
      const v = index ? index.getX(i) : i;
      position.push(p.getX(v), p.getY(v), p.getZ(v));
      normal.push(n.getX(v), n.getY(v), n.getZ(v));
      color.push(c.r, c.g, c.b);
    }
    g.dispose();
  };

  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  // A GPU only ever draws triangles, so "round" is a question of how many and
  // whether they are shaded smoothly. Twelve sides read as a dodecagon at any
  // distance you can see a wheel from; twenty-four does not, and Three.js gives
  // the barrel smooth normals, which the merge preserves.
  const wheelGeo = new THREE.CylinderGeometry(1, 1, 1, 24);

  return {
    /// A box, optionally pitched about Z (for a raked windscreen).
    box(x, y, z, w, h, d, hex, pitch = 0) {
      _pos.set(x, y, z);
      _scale.set(w, h, d);
      _q.setFromEuler(_euler.set(0, 0, pitch));
      push(unitBox, new THREE.Matrix4().compose(_pos, _q, _scale), hex);
    },
    /// A road wheel: a cylinder laid on its side, axle across the vehicle.
    wheel(x, y, z, r, width) {
      _pos.set(x, y, z);
      _scale.set(r, width, r);
      _q.setFromEuler(_euler.set(Math.PI / 2, 0, 0));
      push(wheelGeo, new THREE.Matrix4().compose(_pos, _q, _scale), TYRE);
      // Hub, so a wheel is not a plain black cylinder end-on. It stands clear
      // of the tyre's outer face rather than starting exactly on it — two
      // surfaces at one depth is the whole reason the wheels used to flicker.
      _pos.set(x, y, z + (width / 2 + 0.02) * Math.sign(z || 1));
      _scale.set(r * 0.5, 0.024, r * 0.5);
      push(wheelGeo, new THREE.Matrix4().compose(_pos, _q, _scale), TRIM);
    },
    build() {
      unitBox.dispose();
      wheelGeo.dispose();
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(normal, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(color, 3));
      return geo;
    },
  };
}

/// A wedge: low, wide, cab-forward, with the roofline falling straight into the
/// rear deck. Everything about it is angled — there is no horizontal bonnet and
/// no upright screen — which is what separates a supercar silhouette from a
/// saloon at the distance you actually see these from.
///
/// The wheels sit PROUD of the bodywork. They used to end exactly on the body's
/// side plane, which put two surfaces at one depth and made them flicker.
function buildCarGeometry(L, W, wheelR) {
  const b = partBuilder();
  const floor = wheelR * 0.42;
  const sill = floor + 0.10;

  // Lower body: a shallow slab, with the rear third flared out over the back
  // wheels the way a mid-engined car is.
  b.box(L * 0.02, floor + 0.34, 0, L * 0.94, 0.50, W * 0.92, PAINT);
  b.box(-L * 0.24, floor + 0.36, 0, L * 0.42, 0.52, W, PAINT);          // haunches
  // Nose: a low wedge running down to the splitter.
  b.box(L * 0.40, floor + 0.26, 0, L * 0.22, 0.26, W * 0.86, PAINT, -0.12);
  b.box(L * 0.485, floor + 0.13, 0, 0.16, 0.09, W * 0.9, TRIM);          // splitter

  // The wedge: a raked upper surface from the nose to the base of the screen,
  // then the roof, then the deck falling away behind it.
  const cowlY = floor + 0.60;
  b.box(L * 0.24, cowlY, 0, L * 0.30, 0.10, W * 0.84, PAINT, -0.16);
  const roofY = floor + 0.92;
  b.box(-L * 0.06, roofY, 0, L * 0.30, 0.06, W * 0.62, PAINT);           // roof
  b.box(-L * 0.30, cowlY + 0.16, 0, L * 0.26, 0.09, W * 0.80, PAINT, 0.20); // rear deck

  // Glass. A steeply raked screen, a short backlight over the engine, and a
  // side window that tapers into the C-pillar.
  b.box(L * 0.10, floor + 0.80, 0, 0.07, 0.46, W * 0.72, GLASS, -0.62);
  b.box(-L * 0.21, floor + 0.86, 0, 0.06, 0.30, W * 0.64, GLASS, 0.66);
  for (const s of [-1, 1]) {
    b.box(-L * 0.05, floor + 0.80, s * W * 0.34, L * 0.26, 0.24, 0.05, GLASS);
    // Buttress from the roof down to the haunch — the shape that makes the
    // profile read as mid-engined rather than as a fastback.
    b.box(-L * 0.19, floor + 0.80, s * W * 0.33, L * 0.16, 0.26, 0.10, PAINT, 0.30);
  }

  // Side intake ahead of the rear wheel, door shut line, mirror on a stalk.
  for (const s of [-1, 1]) {
    b.box(-L * 0.10, floor + 0.34, s * W * 0.465, L * 0.20, 0.20, 0.06, GRILLE);
    b.box(L * 0.05, floor + 0.34, s * W * 0.463, 0.04, 0.44, 0.04, TRIM);
    b.box(L * 0.14, floor + 0.66, s * W * 0.52, 0.16, 0.05, 0.11, TRIM);
  }

  // Tail: a fixed wing on two uprights, a diffuser and quad exhausts.
  for (const s of [-1, 1]) b.box(-L * 0.40, floor + 0.72, s * W * 0.30, 0.06, 0.20, 0.06, TRIM);
  b.box(-L * 0.41, floor + 0.84, 0, 0.26, 0.05, W * 0.74, TRIM);
  b.box(-L * 0.47, floor + 0.16, 0, 0.14, 0.16, W * 0.7, GRILLE);
  for (const s of [-1, 1]) {
    b.box(-L * 0.475, floor + 0.30, s * W * 0.16, 0.10, 0.07, 0.07, TRIM);
  }

  for (const s of [-1, 1]) b.box(L * 0.02, sill, s * W * 0.47, L * 0.5, 0.06, 0.05, TRIM);

  // Rear wheels wider than the front, and both standing proud of the body.
  for (const s of [-1, 1]) b.wheel(L * 0.32, wheelR, s * W * 0.46, wheelR, W * 0.12);
  for (const s of [-1, 1]) b.wheel(-L * 0.30, wheelR * 1.06, s * W * 0.46, wheelR * 1.06, W * 0.15);
  return b.build();
}

/// A rigid truck: cab, chassis, and a box body sitting above the frame.
/// A delivery van: one body, a raked nose, a tall box behind the cab, and the
/// sliding door and rear shutter that say what it is for. Short enough to fit a
/// parking bay, which is the point — the loading it does used to be done by the
/// artics, standing in the running lane.
function buildVanGeometry(L, W, wheelR) {
  const b = partBuilder();
  const floor = wheelR * 0.55;
  const bodyH = 1.34;
  const bodyY = floor + bodyH / 2;

  // The box: the whole length behind the nose, full height.
  b.box(-L * 0.08, bodyY, 0, L * 0.78, bodyH, W, PAINT);
  // Roof, slightly inset, so the top edge reads as an edge.
  b.box(-L * 0.08, floor + bodyH, 0, L * 0.74, 0.09, W * 0.94, PAINT);

  // Nose: short bonnet and a raked screen up to the cab roof.
  const noseX = L * 0.38;
  b.box(noseX, floor + 0.42, 0, L * 0.2, 0.62, W * 0.96, PAINT);
  b.box(L * 0.25, floor + bodyH * 0.78, 0, L * 0.13, 0.82, W * 0.92, GLASS, -0.34);
  // Cab side glass, one pane each side, and the door line under it.
  for (const side of [-1, 1]) {
    b.box(L * 0.14, floor + bodyH * 0.74, side * W * 0.49, L * 0.18, 0.5, 0.03, GLASS);
    // The cab door line and the sliding door stand off the flank by DIFFERENT
    // amounts. At the same one they shared both of their faces, which is two
    // surfaces at one depth down the side of the van.
    b.box(L * 0.13, floor + bodyH * 0.36, side * (W * 0.5 + 0.012), L * 0.22, 0.5, 0.02, TRIM);
    // The sliding side door, the panel a delivery van is recognised by.
    b.box(-L * 0.04, bodyY, side * (W * 0.5 + 0.030), L * 0.24, bodyH * 0.82, 0.02, TRIM);
  }
  // Rear shutter and bumpers.
  b.box(-L * 0.47, bodyY, 0, 0.04, bodyH * 0.86, W * 0.9, TRIM);
  b.box(L * 0.47, floor + 0.2, 0, 0.1, 0.24, W * 0.94, TRIM);
  b.box(-L * 0.49, floor + 0.22, 0, 0.08, 0.22, W * 0.94, TRIM);

  // Two axles, wheels proud of the flanks so the two never share a plane.
  const wheelW = 0.2;
  const track = W * 0.5 + 0.03;
  for (const ax of [L * 0.3, -L * 0.28]) {
    for (const side of [-1, 1]) b.wheel(ax, wheelR, side * track, wheelR, wheelW);
    // Arches, so a wheel is not simply stuck to a flat side.
    for (const side of [-1, 1]) {
      b.box(ax, wheelR + 0.3, side * (W * 0.5 - 0.02), wheelR * 2.3, 0.1, 0.06, TRIM);
    }
  }
  return b.build();
}

function buildTruckGeometry(L, W, wheelR) {
  const b = partBuilder();
  const floor = wheelR * 0.62;
  const frameY = floor + 0.28;

  // Chassis rails, visible under the box body.
  for (const s of [-1, 1]) b.box(-L * 0.06, frameY, s * W * 0.3, L * 0.86, 0.16, 0.12, TRIM);

  // Cab: body, roof, deep screen, side glass, mirrors.
  const cabL = L * 0.28;
  const cabX = L * 0.33;
  const cabY = frameY + 0.72;
  b.box(cabX, cabY, 0, cabL, 1.36, W * 0.98, PAINT);
  b.box(cabX, cabY + 0.74, 0, cabL * 0.94, 0.12, W * 0.94, PAINT);
  b.box(cabX + cabL * 0.5, cabY + 0.30, 0, 0.07, 0.62, W * 0.86, GLASS, -0.16);
  for (const s of [-1, 1]) {
    b.box(cabX - cabL * 0.1, cabY + 0.26, s * W * 0.495, cabL * 0.5, 0.42, 0.05, GLASS);
    b.box(cabX + cabL * 0.42, cabY + 0.34, s * W * 0.60, 0.08, 0.34, 0.10, TRIM);   // mirror
    b.box(cabX - cabL * 0.28, cabY - 0.1, s * W * 0.5, 0.04, 1.0, 0.04, TRIM);      // door line
  }
  b.box(cabX + cabL * 0.48, frameY + 0.16, 0, 0.10, 0.28, W * 0.95, TRIM);          // bumper
  b.box(cabX + cabL * 0.46, cabY - 0.42, 0, 0.07, 0.34, W * 0.7, GRILLE);

  // Box body, with a ribbed side and rear doors.
  const boxL = L * 0.60;
  const boxX = -L * 0.145;
  const boxY = frameY + 0.95;
  b.box(boxX, boxY, 0, boxL, 1.82, W, PAINT);
  b.box(boxX, boxY + 0.95, 0, boxL * 0.99, 0.09, W * 0.99, TRIM);      // roof cap
  for (const s of [-1, 1]) {
    for (let i = -2; i <= 2; i++) {
      b.box(boxX + i * boxL * 0.19, boxY, s * W * 0.503, 0.05, 1.7, 0.03, TRIM);
    }
  }
  b.box(boxX - boxL * 0.502, boxY, 0, 0.04, 1.7, W * 0.9, TRIM);       // rear doors
  b.box(boxX - boxL * 0.505, boxY, 0, 0.04, 1.7, 0.06, GRILLE);        // door seam

  for (const ax of [L * 0.34, -L * 0.16, -L * 0.34]) {
    for (const s of [-1, 1]) b.wheel(ax, wheelR, s * W * 0.44, wheelR, W * 0.13);
  }
  return b.build();
}

/// A city bus: a long slab of glass with a roof, doors and wheel arches.
function buildBusGeometry(L, W, wheelR) {
  const b = partBuilder();
  const floor = wheelR * 0.55;
  const bodyH = 2.1;
  const bodyY = floor + bodyH / 2 + 0.18;

  b.box(0, bodyY, 0, L * 0.98, bodyH, W, PAINT);
  b.box(0, bodyY + bodyH / 2 + 0.06, 0, L * 0.94, 0.14, W * 0.96, PAINT);   // roof
  b.box(0, floor + 0.16, 0, L * 0.9, 0.22, W * 0.94, TRIM);                 // skirt

  // Doorways first: they run the full height of the side, so the window bays
  // have to give way to them rather than being drawn across them.
  const doors = [L * 0.28, -L * 0.18];
  const doorW = 1.04;
  const bays = 7;
  const bayW = (L * 0.84 / bays) * 0.82;
  for (const s of [-1, 1]) {
    for (const at of doors) {
      b.box(at, bodyY + 0.06, s * W * 0.502, doorW, 1.94, 0.05, GLASS);
      b.box(at, bodyY + 0.06, s * W * 0.507, 0.06, 1.94, 0.04, TRIM);   // leaf split
    }
    for (let i = 0; i < bays; i++) {
      const at = -L * 0.42 + (L * 0.84) * ((i + 0.5) / bays);
      if (doors.some(d => Math.abs(d - at) < (doorW + bayW) / 2 + 0.1)) continue;
      b.box(at, bodyY + 0.42, s * W * 0.5, bayW, 0.82, 0.05, GLASS);
    }
  }
  // Windscreen and rear window, full width.
  b.box(L * 0.49, bodyY + 0.34, 0, 0.07, 1.0, W * 0.9, GLASS);
  b.box(-L * 0.49, bodyY + 0.34, 0, 0.07, 0.9, W * 0.9, GLASS);
  b.box(L * 0.5, floor + 0.34, 0, 0.09, 0.3, W * 0.95, TRIM);
  b.box(-L * 0.5, floor + 0.34, 0, 0.09, 0.3, W * 0.95, TRIM);
  for (const s of [-1, 1]) b.box(L * 0.44, bodyY + 0.78, s * W * 0.57, 0.09, 0.3, 0.1, TRIM);

  for (const ax of [L * 0.33, -L * 0.24, -L * 0.38]) {
    for (const s of [-1, 1]) b.wheel(ax, wheelR, s * W * 0.45, wheelR, W * 0.13);
  }
  return b.build();
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
    this.vehicleMeshes = null;
    this.litWindows = null;
    this.roomsLit = null;
    this.bulbs = null;
    this.lampHeads = null;
    this.headlights = null;
    this.terrain = null;
    this.precipitation = null;
    this.drops = [];
    this.junctions = [];
    this.turnControl = new Map();
    this.turnLoads = new Map();
    this.solids = [];
    this._turnControlAt = 0;
    this._turnLookahead = 0;
    this.strays = 0;
    this._parkedCars = 0;
    this._parkingSoon = 0;
    this.signals = [];
    this.signalLamps = null;
    this.turnArrows = null;
    this.roadX = [];
    this.roadZ = [];
    this.key = null;
    this._disposables = [];
    this._dayAmount = 1;
    this._weather = "clear";
    this._groundMaterials = [];
    this._clock = 0;       // seconds of traffic time, drives the lights
    this._parkedCars = 0;  // how many cars are in a bay right now
    this._parkingSoon = 0; // and how many are on their way into one
    this.strays = 0;       // vehicles that left the grid and had to be turned round
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
      // Glazing for the buildings you can see into. The distant ones get an
      // opaque pane apiece and that is all a window needs at that range; the
      // near ones have real rooms behind them, so their glass has to be glass —
      // a pane you look THROUGH, catching the light at a glance. Without it
      // they read as buildings with the windows left out.
      glazing: new InstanceSet(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({
          color: CITY_GLASS_COLOR, roughness: 0.06, metalness: 0.1,
          transparent: true, opacity: 0.26, depthWrite: false,
        }),
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
      signalPoles: new InstanceSet(
        new THREE.CylinderGeometry(0.06, 0.08, 1, 6),
        new THREE.MeshStandardMaterial({ color: SIGNAL_POLE_COLOR, roughness: 0.6, metalness: 0.4 }),
        { colored: false }
      ),
      signalHousings: new InstanceSet(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: SIGNAL_HOUSING_COLOR, roughness: 0.7 }),
        { colored: false }
      ),
      signalDark: new InstanceSet(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: SIGNAL_DARK, roughness: 0.5 }),
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

    // Roads, lanes and kerbside spaces are laid out BEFORE the pavements,
    // because a bus stop is a layby and a layby is a piece missing from the
    // pavement. The pads cannot be built until it is known where those pieces
    // go.
    this._layoutRoads(cx, cz, span);
    // Its OWN stream, not the one the blocks and buildings are drawing from.
    // Moving this work earlier moved every later draw from `rnd` along with it,
    // which quietly rebuilt the whole city — different buildings in different
    // places, and 1158 surfaces that now happened to land at the same depth as
    // each other. The layout must not care when the traffic is laid out.
    const trafficRnd = makeRandom(seed ^ 0x5bf03635);
    this._buildTraffic(cx, cz, span, reach, trafficRnd);
    this._layoutParking(cx, cz, span, block, trafficRnd);
    const laybys = this._laybyRects();

    // What the player can stand on and walk into, gathered as the city is
    // built rather than worked out again afterwards. Without it there is
    // nothing outside the room at all: step through a broken window and you
    // fall through the pavement you can plainly see.
    this.solids = [];
    // The carriageway, one slab under the whole neighbourhood. Everything else
    // is a step up from it.
    this.solids.push({
      x: cx, y: ROAD_Y - GROUND_DEPTH / 2, z: cz,
      w: reach * 2, h: GROUND_DEPTH, d: reach * 2,
    });

    for (let gx = -GRID_RADIUS; gx <= GRID_RADIUS; gx++) {
      for (let gz = -GRID_RADIUS; gz <= GRID_RADIUS; gz++) {
        const bx = cx + gx * span;
        const bz = cz + gz * span;
        const home = gx === 0 && gz === 0;
        this._blockPad(sets.flats, bx, bz, block, home ? plot : null, laybys);
        if (home) {
          this._homeTower(sets, bounds, floorLift, rnd);
        } else {
          // Only the ring of blocks you can actually see into gets hollow
          // buildings with rooms behind the windows. Further out the fog has
          // them, and a solid block with flat windows is indistinguishable.
          const near = Math.abs(gx) <= 1 && Math.abs(gz) <= 1;
          this._blockBuildings(sets, bx, bz, block, rnd, near, gx, gz);
        }
        this._blockTrees(sets, bx, bz, block, rnd);
      }
    }

    this._roadMarkings(sets.flats, cx, cz, block, span);
    this._paintKerbside(sets.flats, laybys);
    this._trafficSignals(sets.signalPoles, sets.signalHousings, sets.signalDark, cx, cz);
    this._streetLamps(sets.poles, sets.lampHeads, cx, cz, block, span);
    // Destinations come after the bays exist, and only for cars: a bus runs a
    // route and a truck stops where the work is.
    for (const v of this.cars) if (v.kind === "car") v.goal = this._pickGoal(v);
    this._parkStartingCars(trafficRnd);
    this._buildSignalLamps();
    this._buildTurnArrows();
    this._buildPrecipitation(rnd);

    sets.facades.build(this.group, "city-facades");
    sets.roofs.build(this.group, "city-roofs");
    sets.flats.build(this.group, "city-ground-details");
    sets.darkGlass.build(this.group, "city-windows-dark");
    sets.glazing.build(this.group, "city-window-glass");
    this.litWindows = sets.litGlass.build(this.group, "city-windows-lit");
    sets.roomsDark.build(this.group, "city-rooms-dark");
    this.roomsLit = sets.roomsLit.build(this.group, "city-rooms-lit");
    this.bulbs = sets.bulbs.build(this.group, "city-bulbs");
    sets.trunks.build(this.group, "city-tree-trunks");
    sets.canopies.build(this.group, "city-tree-canopies");
    sets.poles.build(this.group, "city-lamp-poles");
    this.lampHeads = sets.lampHeads.build(this.group, "city-lamp-heads");
    sets.signalPoles.build(this.group, "city-signal-poles");
    sets.signalHousings.build(this.group, "city-signal-housings");
    sets.signalDark.build(this.group, "city-signal-lenses");

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
  /// Every light in the city that could reach a given point, nearest first.
  ///
  /// Candidates, not lights: there are a hundred street lamps and a headlamp on
  /// the nose of every vehicle, and no renderer will light a scene with three
  /// hundred of them. What it will do is light it with a dozen, so long as they
  /// are the right dozen — which is what the caller picks, from this.
  ///
  /// Each carries the distance it reaches, so a light is only ever a candidate
  /// where it would actually be seen. A lamp two streets away contributes
  /// nothing but a slot in the pool that a nearer one needed.
  collectLights(out, viewer, reach) {
    out.length = 0;
    if (!this.lampPosts) return out;
    const night = 1 - clamp01(this._dayAmount);
    const far = reach * reach;

    if (night > 0.02) {
      for (const post of this.lampPosts) {
        const dx = post.x - viewer.x;
        const dz = post.z - viewer.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > far) continue;
        out.push({
          x: post.x, y: post.y, z: post.z, d2,
          color: LAMP_LIGHT_COLOR,
          intensity: LAMP_LIGHT_POWER * night,
          distance: LAMP_LIGHT_REACH,
        });
      }
    }

    for (const v of this.cars) {
      if (v.stop && v.stop.kind === "park") continue;   // parked, and dark
      const fx = Math.cos(v.heading);
      const fz = Math.sin(v.heading);
      const ref = VEHICLE_REF[v.kind];
      // One light for the pair, hung off the nose and pointing the way the
      // vehicle is: two would cost twice as much to look almost the same.
      const nose = v.length / 2 + HEADLAMP_THROW * 0.25;
      const x = v.x + fx * nose;
      const z = v.z + fz * nose;
      const dx = x - viewer.x;
      const dz = z - viewer.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > far) continue;
      out.push({
        x, y: ROAD_Y + ref.lampY, z, d2,
        color: HEADLAMP_COLOR,
        intensity: HEADLAMP_POWER * (0.35 + 0.65 * night),
        distance: HEADLAMP_THROW,
      });
      if (v.braking) {
        out.push({
          x: v.x - fx * (v.length / 2), y: ROAD_Y + ref.lampY, z: v.z - fz * (v.length / 2),
          d2,
          color: BRAKE_LIGHT_COLOR,
          intensity: BRAKE_LIGHT_POWER,
          distance: BRAKE_LIGHT_REACH,
        });
      }
    }
    out.sort((a, b) => a.d2 - b.d2);
    return out;
  }

  /// Which candidates get a slot in the pool.
  ///
  /// Nearest first, skipping any whose reach cannot be seen from here. Kept
  /// apart from the renderer so the rule can be stated and checked on its own —
  /// "the nearest lights that are visible, and no more of them than there are
  /// slots" is the whole of it, and it is easy to get subtly wrong in among the
  /// matrix work.
  static selectLights(candidates, visible, slots, out) {
    out.length = 0;
    for (const light of candidates) {
      if (out.length >= slots) break;
      if (!visible(light)) continue;
      out.push(light);
    }
    return out;
  }

  /// The level of the carriageway: the lowest thing in the city you can stand
  /// on. Everything else is a step up from it.
  groundY() {
    return ROAD_Y;
  }

  /// A list of rectangles with one rectangle cut out of every one of them.
  ///
  /// Shared by the paving and by the collision solids, so what you walk on is
  /// derived from the same shape as what you see. Two descriptions of one
  /// pavement is two chances for the player to stand on air.
  static subtractRect(pieces, cut) {
    const out = [];
    for (const r of pieces) {
      const cx0 = Math.max(r.x0, Math.min(r.x1, cut.x0));
      const cx1 = Math.max(r.x0, Math.min(r.x1, cut.x1));
      const cz0 = Math.max(r.z0, Math.min(r.z1, cut.z0));
      const cz1 = Math.max(r.z0, Math.min(r.z1, cut.z1));
      if (cx1 - cx0 <= 0.01 || cz1 - cz0 <= 0.01) { out.push(r); continue; }
      out.push({ x0: r.x0, x1: r.x1, z0: r.z0, z1: cz0 });
      out.push({ x0: r.x0, x1: r.x1, z0: cz1, z1: r.z1 });
      out.push({ x0: r.x0, x1: cx0, z0: cz0, z1: cz1 });
      out.push({ x0: cx1, x1: r.x1, z0: cz0, z1: cz1 });
    }
    return out.filter(r => r.x1 - r.x0 > 0.01 && r.z1 - r.z0 > 0.01);
  }

  _padLayer(flats, rect, hole, top, height, color, holeGrow = 0, notches = null) {
    const strip = (ax0, ax1, az0, az1) => {
      const w = ax1 - ax0;
      const d = az1 - az0;
      if (w <= 0.01 || d <= 0.01) return;
      flats.add(boxMatrix((ax0 + ax1) / 2, top - height / 2, (az0 + az1) / 2, w, height, d), color);
    };

    // The pad, less the room's own plot, less every bus layby cut into its
    // kerb. Done as rectangle subtraction rather than as a special case for
    // each, because a block can have a plot AND two laybys and the strips
    // either side of one have to be cut by the others in turn.
    let pieces = [{ ...rect }];
    const cutAll = (cut) => { pieces = City.subtractRect(pieces, cut); };

    if (hole) {
      // Each layer cuts the plot a little differently. Cut them all to exactly
      // the same edge and the kerb strip and the pavement strip share a
      // vertical face right along the boundary of the room's own plot — which
      // is a face you look straight at from a ground-floor room.
      cutAll({
        x0: hole.x0 - holeGrow, x1: hole.x1 + holeGrow,
        z0: hole.z0 - holeGrow, z1: hole.z1 + holeGrow,
      });
    }
    // Grown by the same amount as the plot, and for the same reason: cut every
    // layer to exactly the same edge and the kerb strip and the pavement strip
    // share a vertical face right down the side of the layby — a face you stand
    // next to at the bus stop. It was 158 of them.
    for (const notch of notches || []) {
      cutAll({
        x0: notch.x0 - holeGrow, x1: notch.x1 + holeGrow,
        z0: notch.z0 - holeGrow, z1: notch.z1 + holeGrow,
      });
    }
    for (const r of pieces) strip(r.x0, r.x1, r.z0, r.z1);
  }

  /// The raised pavement pad for one block: kerb, pavement, and a lawn on the
  /// blocks that are not the room's own. Each layer tops out a few millimetres
  /// below the one outside it, so nothing z-fights.
  _blockPad(flats, bx, bz, block, hole, laybys = null) {
    const rect = { x0: bx - block / 2, x1: bx + block / 2, z0: bz - block / 2, z1: bz + block / 2 };
    // The raised pavement, as something to stand on. Cut to the same shape as
    // the paving above — the room's own plot and every bus layby taken out of
    // it — because a kerb you can see and a kerb you can walk on that disagree
    // is a player standing in mid-air over a layby.
    let walkable = [rect];
    if (hole) walkable = City.subtractRect(walkable, hole);
    for (const notch of laybys || []) walkable = City.subtractRect(walkable, notch);
    for (const r of walkable) {
      this.solids.push({
        x: (r.x0 + r.x1) / 2, y: PAVEMENT_Y - KERB_HEIGHT / 2, z: (r.z0 + r.z1) / 2,
        w: r.x1 - r.x0, h: KERB_HEIGHT, d: r.z1 - r.z0,
      });
    }
    this._padLayer(flats, rect, hole, PAVEMENT_Y, KERB_HEIGHT, KERB_COLOR, 0, laybys);
    const inset = 0.35;
    this._padLayer(flats, {
      x0: rect.x0 + inset, x1: rect.x1 - inset, z0: rect.z0 + inset, z1: rect.z1 - inset,
    }, hole, PAVEMENT_Y - 0.005, KERB_HEIGHT, SIDEWALK_COLOR, 0.03, laybys);
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
  _blockBuildings(sets, bx, bz, block, rnd, detailed, gx, gz) {
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
          // Which way the front door faces: away from the middle of its own
          // block, towards the nearest street.
          const offX = x - bx;
          const offZ = z - bz;
          const street = Math.abs(offX) > Math.abs(offZ)
            ? { nx: Math.sign(offX) || 1, nz: 0 }
            : { nx: 0, nz: Math.sign(offZ) || 1 };
          // Numbered the way Manhattan is: the hundred comes from how far up
          // the grid the block is, and the last digits run along it, odd on
          // one side of the street and even on the other.
          const hundred = (gz + GRID_RADIUS + 1) * 100;
          const parity = ((gx + GRID_RADIUS) % 2 + 2) % 2;
          const number = hundred + (i * 2 + j) * 2 + parity;
          this._hollowBuilding(sets, x, z, w, d, storeys, PAVEMENT_Y, color, rnd, street, number);
        } else {
          sets.facades.add(boxMatrix(x, PAVEMENT_Y + h / 2, z, w, h, d), color);
          this._facadeWindows(sets.darkGlass, sets.litGlass, x, z, w, d, storeys, PAVEMENT_Y, rnd);
        }
        // A parapet reads as a roof without modelling one, and caps the shell
        // of a hollow building so you cannot see down into it from above.
        sets.roofs.add(boxMatrix(x, PAVEMENT_Y + h + 0.25, z, w + 0.5, 0.5, d + 0.5), ROOF_COLOR);
        // And it is solid, so the street outside is a street rather than a
        // painted backdrop you walk straight through.
        this.solids.push({ x, y: PAVEMENT_Y + h / 2, z, w, h, d });
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
  _hollowBuilding(sets, x, z, w, d, storeys, baseY, color, rnd, street, number) {
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

      // The street door replaces the ground-floor opening of the middle
      // column on the wall that faces the street, and the masonry beneath it
      // is simply not built — which is what makes it a doorway rather than a
      // picture of one.
      const onStreet = street && face.nx === street.nx && face.nz === street.nz;
      const doorAt = onStreet && centres.length && rowsY.length
        ? Math.floor((centres.length - 1) / 2)
        : -1;

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
      for (let ci = 0; ci < centres.length; ci++) {
        const c = centres[ci];
        const segs = [];
        let y = baseY;
        for (const [y0, y1] of rowsY) {
          segs.push([y, y0]);
          y = y1;
        }
        segs.push([y, baseY + h]);
        // Drop the spandrel under the first window of the door column, so the
        // opening runs from the pavement to the head of that window.
        if (ci === doorAt) segs.shift();
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
      for (let ci = 0; ci < centres.length; ci++) {
        const c = centres[ci];
        for (let r = 0; r < rowsY.length; r++) {
          // The ground floor of the door column is the lobby, not a room.
          if (ci === doorAt && r === 0) continue;
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

          // The pane, set INTO the opening rather than flush with the facade.
          // Flush puts its outer face in the same plane as the masonry around
          // it, which is two surfaces at one depth all over every building.
          const [wy0, wy1] = rowsY[r];
          const glassIn = other / 2 - CITY_GLASS_INSET;
          sets.glazing.add(boxMatrix(
            alongX ? x + c : x + face.nx * glassIn,
            (wy0 + wy1) / 2,
            alongX ? z + face.nz * glassIn : z + c,
            alongX ? WIN_W : CITY_GLASS_T, wy1 - wy0, alongX ? CITY_GLASS_T : WIN_W
          ));
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

      if (doorAt >= 0) {
        const c = centres[doorAt];
        const outer = other / 2;
        this._entrance(
          sets,
          alongX ? x + c : x + face.nx * outer,
          alongX ? z + face.nz * outer : z + c,
          face.nx, face.nz, alongX,
          baseY, rowsY[0][1], number
        );
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

  /// A street door, with the number over it. The opening is a real one — the
  /// masonry below the ground-floor window is simply not built for this column
  /// — so the recess behind it has the same depth the windows do, and the
  /// stone surround and canopy stand proud of the facade in front of it.
  ///
  /// (ox, oz) is the middle of the opening, on the plane of the outer wall.
  _entrance(sets, ox, oz, nx, nz, alongX, baseY, openTop, number) {
    const height = openTop - baseY;
    if (height < 1.6) return;
    const wide = alongX ? WIN_W + 0.5 : 1.4;      // extents along / into the wall
    const deep = alongX ? 1.4 : WIN_W + 0.5;
    const midY = baseY + height / 2;
    // Half a step out from the wall, per element, so nothing shares a plane.
    const at = (out) => ({ x: ox + nx * out, z: oz + nz * out });

    // The lobby behind the door, drawn from the inside like the rooms are.
    // Every piece here is deliberately off the wall's own planes. The
    // surround wraps the opening edge rather than starting exactly on it, the
    // lintel overlaps the masonry above instead of butting into it, and the
    // lobby stops short of that masonry — three separate coplanar clashes the
    // first version of this shipped with, all of which flicker.
    const back = at(-0.7);
    // Its floor sits a few centimetres above the pavement rather than exactly
    // on it: the block's paving slab runs on under the buildings, and its top
    // surface is at that same level.
    sets.roomsDark.add(boxMatrix(back.x, midY - 0.06, back.z, wide, height - 0.20, deep));

    // Glazed leaves, set back in the opening.
    const leaf = at(-0.09);
    sets.facades.add(boxMatrix(
      leaf.x, midY - 0.06, leaf.z,
      alongX ? WIN_W - 0.06 : 0.06, height - 0.28, alongX ? 0.06 : WIN_W - 0.06
    ), ENTRANCE_COLOR);

    // Stone surround: two jambs and a lintel, standing proud of the wall.
    const jamb = at(0.06);
    const side = alongX ? WIN_W / 2 + 0.09 : 0;
    const sideZ = alongX ? 0 : WIN_W / 2 + 0.09;
    for (const s of [-1, 1]) {
      sets.facades.add(boxMatrix(
        jamb.x + s * side, midY, jamb.z + s * sideZ,
        alongX ? 0.30 : 0.26, height + 0.2, alongX ? 0.26 : 0.30
      ), SURROUND_COLOR);
    }
    // Wider and deeper than the jambs it sits on, so the two stone pieces
    // meet in a rebate rather than sharing four faces at the corners.
    const lintel = at(0.10);
    sets.facades.add(boxMatrix(
      lintel.x, baseY + height + 0.08, lintel.z,
      alongX ? WIN_W + 0.58 : 0.30, 0.28, alongX ? 0.30 : WIN_W + 0.58
    ), SURROUND_COLOR);

    // Canopy over the door, and a threshold slab under it.
    const canopy = at(0.42);
    sets.roofs.add(boxMatrix(
      canopy.x, baseY + height + 0.34, canopy.z,
      alongX ? WIN_W + 0.8 : 1.0, 0.14, alongX ? 1.0 : WIN_W + 0.8
    ), SURROUND_COLOR);
    const sill = at(0.22);
    sets.facades.add(boxMatrix(
      sill.x, baseY + 0.055, sill.z,
      alongX ? WIN_W + 0.5 : 0.7, 0.09, alongX ? 0.7 : WIN_W + 0.5
    ), STEP_COLOR);

    // The number, over the canopy. Manhattan puts it where you can read it
    // from across the street, so it goes above the door rather than beside it.
    const text = String(number);
    const cells = text.length * 4 - 1;
    const plateW = cells * DIGIT_CELL + 0.14;
    const plateH = 5 * DIGIT_CELL + 0.1;
    const plateY = baseY + height + 0.72;
    const plate = at(0.09);
    sets.facades.add(boxMatrix(
      plate.x, plateY, plate.z,
      alongX ? plateW : 0.04, plateH, alongX ? 0.04 : plateW
    ), NUMBER_PLATE);

    const glyph = at(0.13);
    for (let i = 0; i < text.length; i++) {
      const rows = DIGIT_ROWS[text[i]];
      if (!rows) continue;
      const originCell = -cells / 2 + i * 4;
      for (let r = 0; r < 5; r++) {
        for (let col = 0; col < 3; col++) {
          if (rows[r][col] !== "1") continue;
          const alongOff = (originCell + col + 0.5) * DIGIT_CELL;
          const upOff = (2 - r) * DIGIT_CELL;
          sets.facades.add(boxMatrix(
            alongX ? glyph.x + alongOff : glyph.x,
            plateY + upOff,
            alongX ? glyph.z : glyph.z + alongOff,
            alongX ? DIGIT_CELL * 0.86 : 0.03, DIGIT_CELL * 0.86,
            alongX ? 0.03 : DIGIT_CELL * 0.86
          ), NUMBER_COLOR);
        }
      }
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
    // Far enough in that the widest canopy still stops short of the kerb. On
    // the middle of the pavement a big one reached 20 cm past it and hung over
    // the parking space beyond — a tree growing through a parked car.
    //
    // Clamped against the LARGEST canopy rather than each tree's own, so the
    // radius is still drawn in the same order as before and the seed still
    // builds the same city.
    const ring = Math.min(block / 2 - SIDEWALK / 2,
                          block / 2 - (TREE_MAX_RADIUS + TREE_KERB_CLEAR));
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

  /// Road paint, laid out from the junction grid rather than run blindly from
  /// one side of the city to the other. Lane dashes stop short of every
  /// junction, each approach gets a stop line, and the crossing sits between
  /// the line and the carriageway — which is the order a driver meets them in.
  _roadMarkings(flats, cx, cz, block, span) {
    const y = ROAD_Y + 0.02;
    const halfRoad = ROAD_WIDTH / 2;
    const outer = GRID_RADIUS * span + block / 2 + ROAD_WIDTH / 2;

    // How much of each approach is given over to the crossing and its line.
    const keepClear = halfRoad + CROSS_GAP + CROSS_DEPTH + STOP_LINE_W + 0.3;

    const dash = 2.2;
    const gap = 2.6;
    /// Centre dashes along one stretch of road, between two junctions.
    const dashes = (from, to, alongX, fixed) => {
      const usable = to - from;
      if (usable < dash) return;
      // Centre the pattern in the stretch so it does not start with a stub.
      const pitch = dash + gap;
      const n = Math.max(1, Math.floor((usable + gap) / pitch));
      const used = n * pitch - gap;
      let p = from + (usable - used) / 2;
      for (let i = 0; i < n; i++) {
        const at = p + dash / 2;
        flats.add(alongX
          ? boxMatrix(at, y, fixed, dash, 0.04, 0.16)
          : boxMatrix(fixed, y, at, 0.16, 0.04, dash), MARKING_COLOR);
        p += pitch;
      }
    };

    for (const [roads, crossRoads, alongX] of [
      [this.roadZ, this.roadX, true],
      [this.roadX, this.roadZ, false],
    ]) {
      for (const fixed of roads) {
        // Stretches between consecutive junctions, plus the two open ends.
        const stops = crossRoads.slice().sort((a, b) => a - b);
        const edges = [-outer + (alongX ? cx : cz), ...stops, outer + (alongX ? cx : cz)];
        for (let i = 0; i < edges.length - 1; i++) {
          const from = edges[i] + (i === 0 ? 0 : keepClear);
          const to = edges[i + 1] - (i === edges.length - 2 ? 0 : keepClear);
          dashes(from, to, alongX, fixed);
        }
      }
    }

    // Junction furniture: a crossing and a stop line on every arm.
    for (const rx of this.roadX) {
      for (const rz of this.roadZ) {
        for (const arm of [{ dx: 1, dz: 0 }, { dx: -1, dz: 0 }, { dx: 0, dz: 1 }, { dx: 0, dz: -1 }]) {
          this._crossing(flats, rx, rz, arm, y);
        }
      }
    }
  }

  /// One arm of one junction: the crossing, and the line traffic stops at.
  /// `arm` points outwards from the junction along the road being crossed.
  _crossing(flats, rx, rz, arm, y) {
    const alongX = arm.dx !== 0;
    const dir = alongX ? arm.dx : arm.dz;
    const halfRoad = ROAD_WIDTH / 2;
    // Distance out from the junction centre to the near and far edge of the
    // crossing band, then the stop line beyond it.
    const near = halfRoad + CROSS_GAP;
    const far = near + CROSS_DEPTH;

    // The bars run PARALLEL to the traffic, side by side across the road, so
    // a pedestrian steps over each one in turn. That is what a crossing looks
    // like; bars laid across the traffic are a ladder, not a crossing.
    const usable = ROAD_WIDTH - 0.5;
    const bars = Math.max(3, Math.round(usable / (CROSS_BAR + CROSS_BAR_GAP)));
    const pitch = usable / bars;
    for (let i = 0; i < bars; i++) {
      const off = -usable / 2 + pitch * (i + 0.5);
      const at = dir * (near + CROSS_DEPTH / 2);
      flats.add(alongX
        ? boxMatrix(rx + at, y, rz + off, CROSS_DEPTH, 0.04, CROSS_BAR)
        : boxMatrix(rx + off, y, rz + at, CROSS_BAR, 0.04, CROSS_DEPTH), MARKING_COLOR);
    }

    // The stop line covers the approaching half of the carriageway only. Which
    // half that is comes from laneOffset — the same function the vehicles use
    // to decide where to drive — so the paint cannot end up in the oncoming
    // lane if the driving side ever changes.
    const approach = -dir;
    const offset = City.laneOffset(alongX ? "x" : "z", approach);
    const side = Math.sign(offset);
    const lane = ROAD_WIDTH / 4;
    const at = dir * (far + STOP_LINE_W / 2);
    flats.add(alongX
      ? boxMatrix(rx + at, y, rz + side * lane, STOP_LINE_W, 0.04, ROAD_WIDTH / 2 - 0.25)
      : boxMatrix(rx + side * lane, y, rz + at, ROAD_WIDTH / 2 - 0.25, 0.04, STOP_LINE_W),
      MARKING_COLOR);
  }

  /// A signal head on every approach of every junction, showing what the model
  /// is actually doing. The lights are not decoration timed to look plausible:
  /// they read the same phase the vehicles obey, so what you see on the pole is
  /// why the queue in front of it is stopped.
  _trafficSignals(poles, housings, darkLamps, cx, cz) {
    this.signals = [];
    const poleH = SIGNAL_HEIGHT;
    const reach = ROAD_WIDTH / 2 + 1.6;
    for (let ix = 0; ix < this.roadX.length; ix++) {
      for (let iz = 0; iz < this.roadZ.length; iz++) {
        const rx = this.roadX[ix];
        const rz = this.roadZ[iz];
        for (const arm of [{ dx: 1, dz: 0 }, { dx: -1, dz: 0 }, { dx: 0, dz: 1 }, { dx: 0, dz: -1 }]) {
          const alongX = arm.dx !== 0;
          const axis = alongX ? "x" : "z";
          // The signal faces the traffic coming IN along this arm and stands on
          // that traffic's own kerb, which is whichever side laneOffset puts
          // its lane on.
          const dir = -(alongX ? arm.dx : arm.dz);      // direction of approach
          const side = Math.sign(City.laneOffset(axis, dir));
          const px = alongX ? rx + arm.dx * reach : rx + side * (ROAD_WIDTH / 2 + 1.1);
          const pz = alongX ? rz + side * (ROAD_WIDTH / 2 + 1.1) : rz + arm.dz * reach;
          const heading = alongX ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);

          poles.add(boxMatrix(px, PAVEMENT_Y + poleH / 2, pz, 1, poleH, 1));
          const headY = PAVEMENT_Y + poleH + SIGNAL_HEAD_H / 2 - 0.1;
          housings.add(boxMatrix(px, headY, pz, 0.34, SIGNAL_HEAD_H, 0.34, -heading));

          // The three dark lenses, always there. The lit one is drawn a
          // centimetre proud of its lens so the two never share a plane.
          const faceOut = 0.17;
          const fx = Math.cos(heading);
          const fz = Math.sin(heading);
          const lamps = [];
          for (let k = 0; k < 3; k++) {
            const ly = headY + SIGNAL_HEAD_H / 2 - 0.16 - k * 0.26;
            darkLamps.add(boxMatrix(px + fx * faceOut, ly, pz + fz * faceOut, 0.15, 0.15, 0.15, -heading));
            lamps.push({ x: px + fx * (faceOut + 0.03), y: ly, z: pz + fz * (faceOut + 0.03) });
          }
          // The three turn arrows, on a bar under the main head: left, straight
          // and right as the driver sees them. The signal's heading IS the
          // direction of travel, so the across-the-face direction is the
          // near-side turn — which makes the arrow for turn t sit at t * pitch
          // along it, right-hand turn to the right, with no separate table of
          // which way round the face is.
          const across = { x: -fz, z: fx };
          const armY = headY - SIGNAL_HEAD_H / 2 - ARROW_DROP;
          const arrows = [];
          for (const turn of [CROSSING_TURN, 0, NEAR_SIDE_TURN]) {
            arrows.push({
              turn,
              x: px + fx * faceOut + across.x * turn * ARROW_PITCH,
              y: armY,
              z: pz + fz * faceOut + across.z * turn * ARROW_PITCH,
            });
          }
          housings.add(boxMatrix(px + fx * (faceOut - 0.06), armY, pz + fz * (faceOut - 0.06),
            ARROW_PITCH * 2 + 0.16, 0.2, 0.1, -heading));
          this.signals.push({ axis, dir, ix, iz, heading, lamps, arrows });
        }
      }
    }
  }

  /// Lights the lamp the phase calls for, and only that one. Counts move
  /// rather than lamps being drawn at zero size or hidden inside the housing.
  _writeSignalLamps() {
    const parts = this.signalLamps;
    if (!parts || !this.signals.length) return;
    let red = 0;
    let amber = 0;
    let green = 0;
    for (const s of this.signals) {
      const state = this._signalState(s.axis, s.ix, s.iz, this._clock);
      const lamp = state === "green" ? s.lamps[2] : state === "amber" ? s.lamps[1] : s.lamps[0];
      const mesh = state === "green" ? parts.green : state === "amber" ? parts.amber : parts.red;
      const slot = state === "green" ? green++ : state === "amber" ? amber++ : red++;
      mesh.setMatrixAt(slot, boxMatrix(lamp.x, lamp.y, lamp.z, 0.16, 0.16, 0.16, -s.heading, _m));
    }
    parts.red.count = red;
    parts.amber.count = amber;
    parts.green.count = green;
    parts.red.instanceMatrix.needsUpdate = true;
    parts.amber.instanceMatrix.needsUpdate = true;
    parts.green.instanceMatrix.needsUpdate = true;
  }

  /// What one approach's signal is showing. Derived from the same phase the
  /// vehicles read, so the two cannot disagree.
  _signalState(axis, ix, iz, t) {
    void t;
    const phase = this._phaseAt(ix, iz);
    if (!phase || phase.axis !== axis) return "red";
    if (phase.state === "green") return "green";
    if (phase.state === "amber") return "amber";
    return "red";
  }

  _streetLamps(poles, heads, cx, cz, block, span) {
    const h = 4.6;
    this.lampPosts = [];
    for (let gx = -GRID_RADIUS; gx <= GRID_RADIUS; gx++) {
      for (let gz = -GRID_RADIUS; gz <= GRID_RADIUS; gz++) {
        const bx = cx + gx * span;
        const bz = cz + gz * span;
        const edge = block / 2 - 0.9;
        for (const [ox, oz] of [[edge, edge], [-edge, edge], [edge, -edge], [-edge, -edge]]) {
          poles.add(boxMatrix(bx + ox, PAVEMENT_Y + h / 2, bz + oz, 1, h, 1));
          heads.add(boxMatrix(bx + ox, PAVEMENT_Y + h + 0.12, bz + oz, 0.44, 0.16, 0.44));
          // Where the light actually comes from, kept so something can light
          // the street with it rather than only drawing a bright box.
          this.lampPosts.push({ x: bx + ox, y: PAVEMENT_Y + h - 0.02, z: bz + oz });
        }
      }
    }
  }

  // MARK: - Traffic

  /// Which side of the centreline a lane sits on. Traffic keeps RIGHT, as it
  /// does in the United States and Germany: heading east that puts you on the
  /// southern side of the road, and so on round.
  ///
  /// This is the ONLY place the driving side is decided. The stop lines and the
  /// signal heads both derive their side from this rather than working it out
  /// again from the arm direction — hand-computed signs in three places is
  /// three chances to get one of them backwards, and a stop line painted in the
  /// oncoming lane is not obviously wrong until you look for it.
  static laneOffset(axis, dir) {
    return axis === "x" ? LANE_OFFSET * dir : -LANE_OFFSET * dir;
  }

  /// Unit vector for a lane direction. Turns are described relative to travel
  /// by rotating it: turning(A, +1) = (-az, ax) swings east to south — a right
  /// turn, which with traffic keeping right crosses nothing; -1 is the left
  /// turn, across the oncoming lane.
  static forwardOf(axis, dir) {
    return axis === "x" ? { x: dir, z: 0 } : { x: 0, z: dir };
  }

  /// Every road in the grid, as a coordinate and an index. The paint, the
  /// signals and the traffic all read this, so it is worked out once up front
  /// rather than by each of them separately — three descriptions of the same
  /// street grid is three chances for them to disagree about where a junction
  /// is. Lights are timed off the index, so neighbouring junctions are
  /// deliberately out of step.
  _layoutRoads(cx, cz, span) {
    this.roadX = [];
    this.roadZ = [];
    for (let g = -GRID_RADIUS; g <= GRID_RADIUS + 1; g++) {
      this.roadX.push(cx + (g - 0.5) * span);
      this.roadZ.push(cz + (g - 0.5) * span);
    }
  }

  _buildTraffic(cx, cz, span, reach, rnd) {
    // How far beyond a junction the manager looks when judging whether the
    // street a turn feeds is full: one block and its road, which is exactly
    // the stretch a vehicle taking that turn commits itself to.
    this._turnLookahead = span;
    this._span = span;
    this.turnControl = new Map();
    this.turnLoads = new Map();
    this._turnControlAt = 0;
    this._demand = new Map();
    this._startSignals();
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

    // Every lane in the grid, not just the middle few. Traffic used to be
    // confined to the roads within a block and a half of the room, on the
    // grounds that the rest was lost in fog — but the fog now reaches past the
    // hills, so those streets are plainly visible and were conspicuously
    // empty. Spreading the same fleet over the whole grid also keeps it
    // moving: packed onto four roads, adding vehicles made the traffic slower
    // rather than busier, which is what saturation does.
    const populated = [];
    for (let i = 0; i < this.roadZ.length; i++) {
      populated.push(this.lanes.get(`x|1|${i}`), this.lanes.get(`x|-1|${i}`));
    }
    for (let i = 0; i < this.roadX.length; i++) {
      populated.push(this.lanes.get(`z|1|${i}`), this.lanes.get(`z|-1|${i}`));
    }

    // The fleet, shared out over every lane as evenly as it divides. Sized as
    // a total rather than a per-lane count so that changing how many streets
    // are populated does not silently change how much traffic there is.
    this.cars = [];
    let id = 0;
    for (let li = 0; li < populated.length; li++) {
      const lane = populated[li];
      const share = Math.floor(FLEET_SIZE / populated.length)
        + (li < FLEET_SIZE % populated.length ? 1 : 0);
      if (!share) continue;
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
      for (let k = 0; k < share; k++) {
        const pick = Math.floor((k + 0.2 + rnd() * 0.6) * slots.length / share);
        const along = slots[Math.max(0, Math.min(slots.length - 1, pick))];
        const spec = City.pickKind(rnd());
        const length = spec.length[0] + rnd() * (spec.length[1] - spec.length[0]);
        // The kind's base speed, times this driver's own pace. All of the
        // variation within a kind is the pace, so the spread is exactly the
        // one the constants describe.
        const pace = PACE_SLOWEST + rnd() * (PACE_FASTEST - PACE_SLOWEST);
        const cruise = spec.cruise * pace;
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
          pace,
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
          // Kerbside stopping: how far over towards the kerb it currently is,
          // where it is heading, and what it is doing there.
          kerbOffset: 0,
          kerbTarget: 0,
          stop: null,
          stopTarget: null,
          manoeuvre: null,
          goal: null,
          goalSince: 0,
          busStopAfter: 0,
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
  /// One InstancedMesh per kind of vehicle, each holding the whole merged
  /// body. A vehicle is then one matrix a frame instead of eight, which is how
  /// the detail pays for itself. The lamps are the exception: they come and go
  /// independently of the body, so they keep their own meshes and their counts
  /// move as lamps light and go out.
  _allocateVehicleMeshes() {
    const n = this.cars.length;
    if (!n) return;

    const geometryFor = {
      car: () => buildCarGeometry(VEHICLE_REF.car.L, VEHICLE_REF.car.W, VEHICLE_REF.car.wheelR),
      van: () => buildVanGeometry(VEHICLE_REF.van.L, VEHICLE_REF.van.W, VEHICLE_REF.van.wheelR),
      truck: () => buildTruckGeometry(VEHICLE_REF.truck.L, VEHICLE_REF.truck.W, VEHICLE_REF.truck.wheelR),
      bus: () => buildBusGeometry(VEHICLE_REF.bus.L, VEHICLE_REF.bus.W, VEHICLE_REF.bus.wheelR),
    };

    const c = new THREE.Color();
    this.vehicleMeshes = {};
    for (const kind of Object.keys(geometryFor)) {
      const list = this.cars.filter(v => v.kind === kind);
      if (!list.length) continue;
      const geo = geometryFor[kind]();
      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.42, metalness: 0.22,
      });
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      mesh.name = "city-vehicles-" + kind;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this._disposables.push(geo, mat);
      list.forEach((v, i) => {
        v.slot = i;
        // Paint multiplies the body's own vertex colours: white panels take
        // it, glass and tyres are dark enough to stay dark under it.
        mesh.setColorAt(i, c.setHex(v.color));
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.vehicleMeshes[kind] = mesh;
    }

    const make = (geo, mat, count) => {
      const mesh = new THREE.InstancedMesh(geo, mat, count);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.group.add(mesh);
      this._disposables.push(geo, mat);
      return mesh;
    };
    const lamp = (color, emissive, intensity) => new THREE.MeshStandardMaterial({
      color, emissive, emissiveIntensity: intensity, roughness: 0.4,
    });
    this.carParts = {
      head: make(new THREE.BoxGeometry(1, 1, 1), lamp(0xfff3d0, 0xffe9b8, 0), n * 2),
      tail: make(new THREE.BoxGeometry(1, 1, 1), lamp(0x4a1210, 0xd8241a, 1.1), n * 2),
      brake: make(new THREE.BoxGeometry(1, 1, 1), lamp(0x5a1512, 0xff2a18, 3.0), n * 2),
      indicator: make(new THREE.BoxGeometry(1, 1, 1), lamp(0x5a3a10, 0xffa621, 3.0), n * 2),
    };
    this.headlights = this.carParts.head;
  }
  /// One mesh per colour, each big enough for every signal in the city, since
  /// nothing stops a whole grid showing red together.
  _buildSignalLamps() {
    const n = this.signals.length;
    if (!n) { this.signalLamps = null; return; }
    const make = (color) => {
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const mat = new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 1.6, roughness: 0.35,
      });
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.group.add(mesh);
      this._disposables.push(geo, mat);
      return mesh;
    };
    this.signalLamps = {
      red: make(SIGNAL_RED),
      amber: make(SIGNAL_AMBER),
      green: make(SIGNAL_GREEN),
    };
    this.signalLamps.red.name = "city-signal-red";
    this.signalLamps.amber.name = "city-signal-amber";
    this.signalLamps.green.name = "city-signal-green";
    this._writeSignalLamps();
  }

  /// The turn arrows: one mesh per colour, each big enough for every arrow in
  /// the city, since nothing stops them all showing the same thing at once.
  ///
  /// An arrow is drawn pointing up and rolled about the face normal to point
  /// left or right, so there is one shape rather than three that could disagree
  /// about size or weight.
  _buildTurnArrows() {
    const n = this.signals.length * 3;
    if (!n) { this.turnArrows = null; return; }

    const shape = new THREE.Shape();
    shape.moveTo(-0.22, -1);
    shape.lineTo(0.22, -1);
    shape.lineTo(0.22, 0.05);
    shape.lineTo(0.62, 0.05);
    shape.lineTo(0, 1);
    shape.lineTo(-0.62, 0.05);
    shape.lineTo(-0.22, 0.05);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false });
    geo.translate(0, 0, -0.06);

    const make = (color) => {
      const mat = new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 1.5, roughness: 0.4,
      });
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.group.add(mesh);
      this._disposables.push(mat);
      return mesh;
    };
    this._disposables.push(geo);
    this.turnArrows = { green: make(SIGNAL_GREEN), red: make(SIGNAL_RED) };
    this.turnArrows.green.name = "city-turn-arrows-green";
    this.turnArrows.red.name = "city-turn-arrows-red";
    this._writeTurnArrows();
  }

  /// Shows what the manager has decided, on the pole. Read from the same map
  /// the drivers read, so an arrow cannot show green for a turn the junction is
  /// refusing — the failure that would make the whole thing decoration.
  _writeTurnArrows() {
    const parts = this.turnArrows;
    if (!parts || !this.signals.length) return;
    let green = 0;
    let red = 0;
    for (const s of this.signals) {
      const allow = this.turnsAllowedAt(s.axis, s.dir, s.ix, s.iz);
      for (const arrow of s.arrows) {
        // A turn that leads nowhere at all — off the edge of the grid — has no
        // arrow lit rather than a red one: there is no such movement to forbid.
        if (allow && !allow.has(arrow.turn)) continue;
        const on = !allow || allow.get(arrow.turn) === true;
        const mesh = on ? parts.green : parts.red;
        const slot = on ? green++ : red++;
        mesh.setMatrixAt(slot, this._arrowMatrix(s, arrow, _m));
      }
    }
    parts.green.count = green;
    parts.red.count = red;
    parts.green.instanceMatrix.needsUpdate = true;
    parts.red.instanceMatrix.needsUpdate = true;
  }

  /// One arrow's transform: sized, rolled to point its way, turned to face the
  /// traffic, and put on its mount.
  _arrowMatrix(signal, arrow, into) {
    const roll = arrow.turn * Math.PI / 2;
    const face = Math.PI / 2 - signal.heading;
    return into
      .makeTranslation(arrow.x, arrow.y, arrow.z)
      .multiply(_arrowFace.makeRotationY(face))
      .multiply(_arrowRoll.makeRotationZ(roll))
      .multiply(_arrowScale.makeScale(ARROW_SIZE, ARROW_SIZE, 1));
  }

  /// Junction timing. The offset is derived from the road indices so that
  /// neighbouring junctions run out of phase, which is what produces the
  /// stop-start rhythm rather than the whole grid moving as one.
  _junctionOffset(ix, iz) {
    return (((ix * 5 + iz * 3) % 4) + 4) % 4 / 4 * LIGHT_CYCLE;
  }

  // MARK: - Signal timing

  /// Every junction's own phase, started out of step with its neighbours.
  ///
  /// The timings used to be a pure function of the clock: a fixed thirty second
  /// cycle, split evenly, the same at every junction forever. That is a
  /// timetable rather than a controller, and it showed — measured at 240
  /// vehicles, EIGHTY PER CENT of green phases had nobody passing through them
  /// at all, while the queue on the cross street sat at red. Green given to an
  /// empty approach is throughput taken from a full one.
  _startSignals() {
    this.phases = new Map();
    for (let ix = 0; ix < this.roadX.length; ix++) {
      for (let iz = 0; iz < this.roadZ.length; iz++) {
        const offset = this._junctionOffset(ix, iz);
        this.phases.set(`${ix}|${iz}`, {
          ix, iz,
          axis: offset < LIGHT_CYCLE / 2 ? "x" : "z",
          state: "green",
          // Staggered, so neighbours do not all change together on the first
          // cycle before demand has had a chance to pull them apart.
          // Staggered, but never shorter than a green is allowed to be —
          // the first cycle is a cycle like any other.
          until: this._clock + GREEN_MIN * (1 + (offset / LIGHT_CYCLE)),
          greenFrom: this._clock,
        });
      }
    }
  }

  _phaseAt(ix, iz) {
    return this.phases ? this.phases.get(`${ix}|${iz}`) : null;
  }

  /// Who is waiting at each junction, and on which side.
  ///
  /// This is the realtime picture the controller runs on: every vehicle,
  /// which junction it is coming up to, which of the four sides it is on, and
  /// whether it is sitting in the queue or already coming through. Gathered
  /// once a frame, before anybody drives, so all four sides of a junction are
  /// judged from the same instant.
  _collectDemand() {
    if (!this._demand) this._demand = new Map();
    for (const cell of this._demand.values()) {
      cell.x.queue = 0; cell.x.moving = 0;
      cell.z.queue = 0; cell.z.moving = 0;
    }
    for (const v of this.cars) {
      if (v.arc || v.stop) continue;
      const junction = this._nextJunction(v);
      if (!junction || junction.distance > QUEUE_REACH) continue;
      const ix = v.axis === "x" ? junction.index : v.lane.roadIndex;
      const iz = v.axis === "x" ? v.lane.roadIndex : junction.index;
      const key = `${ix}|${iz}`;
      let cell = this._demand.get(key);
      if (!cell) {
        cell = { x: { queue: 0, moving: 0 }, z: { queue: 0, moving: 0 } };
        this._demand.set(key, cell);
      }
      const side = cell[v.axis];
      if (v.speed < QUEUE_SLOW) side.queue++;
      else if (junction.distance < ROAD_WIDTH) side.moving++;
    }
  }

  /// Runs each junction's phase, giving green to whoever is actually waiting.
  ///
  /// A minimum green, extended a couple of seconds at a time for as long as the
  /// traffic keeps coming, up to a maximum. That is what a real vehicle-actuated
  /// controller does, and the maximum is what keeps it fair: a green cannot
  /// outrun it, so the cross street never waits longer than one of those plus
  /// the changeover either side.
  ///
  /// Two more mechanisms lived here — a green sized up front from the queue, and
  /// a rule cutting a green short once its side had emptied — and measurement
  /// said neither was doing anything. Replacing the sizing with a flat constant
  /// left greens after a queue of five averaging 24.3 s against 24.7, because
  /// the extension had already been doing that work; disabling the early cut
  /// moved the share of greens running empty from 12% to 10%. What is left is
  /// what earns its place.
  _updateSignals(dt) {
    if (!this.phases) return;
    void dt;
    const demand = this._demand;
    for (const phase of this.phases.values()) {
      if (this._clock < phase.until) continue;
      const here = demand ? demand.get(`${phase.ix}|${phase.iz}`) : null;
      const other = phase.axis === "x" ? "z" : "x";
      const mine = here ? here[phase.axis] : { queue: 0, moving: 0 };
      const theirs = here ? here[other] : { queue: 0, moving: 0 };

      if (phase.state === "green") {
        // Worth holding? Either somebody is coming through right now, or the
        // queue on this side is longer than the one being kept waiting.
        const running = this._clock - phase.greenFrom;
        if ((mine.moving > 0 || mine.queue > theirs.queue) && running < GREEN_MAX) {
          phase.until = this._clock + GREEN_EXTEND;
          continue;
        }
        phase.state = "amber";
        phase.until = this._clock + LIGHT_AMBER;
        continue;
      }

      if (phase.state === "amber") {
        phase.state = "clear";
        phase.until = this._clock + LIGHT_CLEAR;
        continue;
      }

      phase.axis = other;
      phase.state = "green";
      phase.greenFrom = this._clock;
      phase.until = this._clock + GREEN_MIN;
    }
  }

  /// True while the light lets `axis` through. Amber counts as stop: a vehicle
  /// too close to pull up is carried through by its own braking distance
  /// rather than by permission.
  ///
  /// The time argument is no longer used — the phase is a state the controller
  /// advances, not a position in a timetable — but every caller passes the
  /// current clock and reads "is it green NOW", which is exactly what this
  /// still answers.
  _isGreen(axis, ix, iz, t) {
    void t;
    const phase = this._phaseAt(ix, iz);
    if (!phase) return false;
    return phase.axis === axis && phase.state === "green";
  }

  /// How long until the CROSSING direction gets its green. A vehicle that
  /// cannot be clear of the junction by then does not enter it, which is both
  /// what a driver does and what keeps the box empty at the changeover.
  _timeToCrossGreen(axis, ix, iz, t) {
    void t;
    const phase = this._phaseAt(ix, iz);
    if (!phase) return 0;
    if (phase.axis !== axis) return 0;
    // Amber and the all-red gap are still time to finish crossing in — that is
    // what they are for — so they count towards the room a vehicle has.
    if (phase.state === "green") {
      return (phase.until - this._clock) + LIGHT_AMBER + LIGHT_CLEAR;
    }
    if (phase.state === "amber") return (phase.until - this._clock) + LIGHT_CLEAR;
    return Math.max(0, phase.until - this._clock);
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
      // A car at the kerb is driven past, not queued behind. A truck unloading
      // and a bus at a stop are still in the way, which is the point of them.
      if (!City.blocksLane(other)) continue;
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

  /// The nearest vehicle bearing down on this one from BEHIND in its own lane.
  ///
  /// The mirror of _leader, and needed for exactly one thing: pulling out of a
  /// parking space. A car at the kerb that only looks ahead has checked the one
  /// direction the danger is not coming from — it then eases back into the lane
  /// from a standstill, taking about a second and a half to clear the kerb,
  /// straight into whatever was already coming. That is where the last of the
  /// parked-car contacts came from.
  _follower(v) {
    const mine = City.progressOf(v);
    let best = null;
    let bestGap = Infinity;
    for (const other of v.lane.members) {
      if (other === v || other.arc || other.stop) continue;
      if (City.progressOf(other) >= mine) continue;
      const gap = mine - City.progressOf(other) - (other.length + v.length) / 2;
      if (gap < bestGap) {
        bestGap = gap;
        best = other;
      }
    }
    return best ? { follower: best, gap: bestGap } : null;
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
      // To the painted stop line, less the vehicle's own nose — so the
      // queue pulls up where the paint says, leaving the crossing clear.
      distance: bestDist - STOP_LINE_AT - v.length / 2,
    };
  }

  // MARK: - Turn control

  /// Which turns each approach is currently allowing.
  ///
  /// The point is not to ration the traffic but to spread it: a turn is only
  /// forbidden when the stretch of road it feeds is markedly fuller than the
  /// city's average, so vehicles are steered off the streets that are filling
  /// and onto the ones that are not. Reviewed a few times a minute rather than
  /// every frame — a vehicle picks its turn two junctions in advance, so an
  /// arrow that flickered would decide nothing.
  _updateTurnControl() {
    if (!this.lanes || !this.lanes.size || this._clock < this._turnControlAt) return;
    this._turnControlAt = this._clock + TURN_CONTROL_PERIOD;

    const room = this._turnLookahead / TURN_SLOT;
    const last = this.roadX.length - 1;
    const laneKey = lane => `${lane.axis}|${lane.dir}|${lane.roadIndex}`;

    // ── 1. Where every vehicle is, right now ──────────────────────────────
    const positions = new Map();
    let standing = 0;
    let capacity = 0;
    for (const [key, lane] of this.lanes) {
      const at = [];
      for (const v of lane.members) {
        if (v.arc || !City.blocksLane(v)) continue;
        at.push(City.progressOf(v));
      }
      at.sort((a, b) => a - b);
      positions.set(key, at);
      standing += at.length;
      capacity += (lane.reach * 2) / TURN_SLOT;
    }
    const average = capacity > 0 ? standing / capacity : 0;
    const limit = Math.max(TURN_LOAD_FLOOR, average * TURN_LOAD_FACTOR);

    const countBeyond = (lane, from) => {
      const at = positions.get(laneKey(lane));
      if (!at) return 0;
      let n = 0;
      for (const p of at) {
        if (p < from) continue;
        if (p >= from + this._turnLookahead) break;
        n++;
      }
      return n;
    };

    // ── 2. Every junction, every approach, and where each turn leads ──────
    //
    // A segment is one stretch of one lane beyond one junction, and it is what
    // the manager actually protects. Two different approaches can pour into
    // the same stretch — the traffic going straight through, and the traffic
    // turning in off the cross street — so they have to be recognised as the
    // same place or each would be judged as though the other were not there.
    const segments = new Map();
    const segmentFor = (lane, from, entryIndex) => {
      const key = `${laneKey(lane)}@${entryIndex}`;
      let seg = segments.get(key);
      if (!seg) {
        seg = { key, standing: countBeyond(lane, from), inbound: 0 };
        segments.set(key, seg);
      }
      return seg;
    };

    const approaches = new Map();
    for (let ix = 0; ix < this.roadX.length; ix++) {
      for (let iz = 0; iz < this.roadZ.length; iz++) {
        for (const axis of ["x", "z"]) {
          for (const dir of [1, -1]) {
            const roadIndex = axis === "x" ? iz : ix;
            const index = axis === "x" ? ix : iz;
            const lane = this.lanes.get(`${axis}|${dir}|${roadIndex}`);
            if (!lane) continue;
            const coord = axis === "x" ? this.roadX[ix] : this.roadZ[iz];

            const moves = [];
            if (index + dir >= 0 && index + dir <= last) {
              // Carrying on enters this same lane's next stretch.
              moves.push({ turn: 0, demand: 0, seg: segmentFor(lane, coord * dir, index) });
            }
            for (const turn of [NEAR_SIDE_TURN, CROSSING_TURN]) {
              const target = this._turnTarget({ axis, dir, fixed: lane.fixed, turn },
                                              { index, coord });
              if (!target) continue;
              if (roadIndex + target.newDir < 0 || roadIndex + target.newDir > last) continue;
              // Turning enters the new lane at the road it is turning off, so
              // along THAT lane the entry is at this approach's road index.
              moves.push({
                turn, demand: 0,
                seg: segmentFor(target.lane, target.exitProgress, roadIndex),
              });
            }
            if (!moves.length) continue;
            approaches.set(`${axis}|${dir}|${ix}|${iz}`, { axis, dir, ix, iz, moves });
          }
        }
      }
    }

    // ── 3. What every vehicle intends to do next ─────────────────────────
    //
    // The occupancy above is where the traffic IS; this is where it is about
    // to be, which is the half that matters. A stretch with room for three
    // more vehicles and eleven already committed to entering it is full, and
    // waiting until they arrive to notice is waiting until the approach behind
    // them has already backed up.
    for (const v of this.cars) {
      if (v.arc || v.stop) continue;
      const junction = this._nextJunction(v);
      if (!junction) continue;
      const ix = v.axis === "x" ? junction.index : v.lane.roadIndex;
      const iz = v.axis === "x" ? v.lane.roadIndex : junction.index;
      const approach = approaches.get(`${v.axis}|${v.dir}|${ix}|${iz}`);
      if (!approach) continue;
      if (v.turnDecidedAt === junction.index) {
        const move = approach.moves.find(m => m.turn === v.turn);
        if (move) { move.demand++; move.seg.inbound++; }
        continue;
      }
      // Undecided. It will choose among whatever is green when it decides, so
      // it is counted as a share of each rather than not at all.
      const open = approach.moves.filter(m => this._permits(approach, m.turn));
      const spread = open.length ? open : approach.moves;
      for (const m of spread) {
        m.demand += 1 / spread.length;
        m.seg.inbound += 1 / spread.length;
      }
    }

    // ── 4. The decision, for all four sides of every junction ────────────
    const projected = seg => (seg.standing + seg.inbound) / room;
    let forbidden = 0;

    const settle = approach => {
      const allow = new Map();
      for (const m of approach.moves) allow.set(m.turn, projected(m.seg) <= limit);
      // Never all four sides of a junction closed to a vehicle at once: an
      // approach showing nothing but red is a deadlock the manager caused
      // rather than one it prevented. The emptiest way out always stays open.
      if (![...allow.values()].some(Boolean)) {
        let best = approach.moves[0];
        for (const m of approach.moves) if (projected(m.seg) < projected(best.seg)) best = m;
        allow.set(best.turn, true);
      }
      return allow;
    };

    for (const approach of approaches.values()) approach.allow = settle(approach);

    // Traffic turned away from a full stretch does not evaporate — it takes
    // one of the other exits from the same approach. Crediting it there before
    // deciding is what stops the manager solving one street by filling its
    // neighbour and only noticing at the next review.
    for (const approach of approaches.values()) {
      const shed = approach.moves.filter(m => approach.allow.get(m.turn) === false);
      const open = approach.moves.filter(m => approach.allow.get(m.turn) === true);
      if (!shed.length || !open.length) continue;
      let moved = 0;
      for (const m of shed) { moved += m.demand; m.seg.inbound -= m.demand; }
      for (const m of open) m.seg.inbound += moved / open.length;
    }

    for (const [key, approach] of approaches) {
      const allow = settle(approach);
      for (const [, ok] of allow) if (!ok) forbidden++;
      this.turnControl.set(key, allow);
      // How full each way out is, kept for the routing. A vehicle picking the
      // shortest way to its destination and nothing else pours every journey
      // that shares a direction onto the same streets; with this it can weigh
      // a longer way round against a queue, which is what a driver does.
      const loads = new Map();
      for (const m of approach.moves) loads.set(m.turn, projected(m.seg));
      this.turnLoads.set(key, loads);
    }

    this.turnStats = {
      average, limit, forbidden,
      approaches: approaches.size,
      busiest: Math.max(0, ...[...segments.values()].map(projected)),
    };
  }

  /// Whether an approach was allowing a turn at the last review. Used while
  /// building the next one, so an undecided vehicle is credited to the turns it
  /// could actually take.
  _permits(approach, turn) {
    const allow = this.turnControl.get(`${approach.axis}|${approach.dir}|${approach.ix}|${approach.iz}`);
    if (!allow || !allow.has(turn)) return true;
    return allow.get(turn) === true;
  }

  /// What the arrows are showing one approach. Vehicles and the arrows on the
  /// pole both read this, so what a driver is allowed to do and what the
  /// signal says cannot drift apart.
  turnsAllowedAt(axis, dir, ix, iz) {
    return this.turnControl.get(`${axis}|${dir}|${ix}|${iz}`) || null;
  }

  _turnPermitted(v, junction, turn) {
    const ix = v.axis === "x" ? junction.index : v.lane.roadIndex;
    const iz = v.axis === "x" ? v.lane.roadIndex : junction.index;
    const allow = this.turnsAllowedAt(v.axis, v.dir, ix, iz);
    if (!allow || !allow.has(turn)) return true;
    return allow.get(turn) === true;
  }

  /// Chooses whether this vehicle turns at the junction it is approaching.
  /// Decided once, well before the junction, so the indicator has time to run
  /// before anything actually happens — which is the whole point of one.
  /// Straight on, or left, or right — chosen fresh at every junction, and
  /// constrained so the choice always leads somewhere. The street grid is a
  /// CLOSED network: a vehicle that reaches the outermost road must turn along
  /// it rather than carry on into nothing, so traffic circulates indefinitely
  /// and no vehicle is ever removed or teleported. Before this, a vehicle ran
  /// to the edge and was wrapped round to the far side, which is a car
  /// vanishing from one street and appearing in another.
  _decideTurn(v, junction) {
    // Already pulling in somewhere. Its space is on THIS street, a few metres
    // ahead — taking a turn now carries it onto another one still holding a
    // reservation it can no longer reach, and the turn arc moves it sideways
    // out of the approach it was lined up on.
    //
    // Except at the edge of the grid, where carrying straight on is not a
    // choice: there is no road there. Holding a vehicle straight anyway drove
    // it off the end of the street network and into the safety net.
    if (v.stopTarget) {
      const last = this.roadX.length - 1;
      const onwards = junction.index + v.dir >= 0 && junction.index + v.dir <= last;
      if (onwards) { v.turn = 0; v.mustTurn = false; return; }
    }

    if (v.turnDecidedAt === junction.index) {
      // Already chosen — but the arrows are reviewed while it approaches, and a
      // driver whose exit has gone red picks another rather than queueing for a
      // turn they are not going to be allowed to make. Only while there is
      // still room to line up: changing your mind on the line is how a vehicle
      // ends up committed to a turn it has already driven past.
      if (junction.distance < TURN_REVIEW_FROM) return;
      if (this._turnPermitted(v, junction, v.turn)) return;
      v.turnDecidedAt = -1;
    }
    v.turnDecidedAt = junction.index;
    v.turn = 0;
    v.mustTurn = false;

    const last = this.roadX.length - 1;   // both road lists are the same length
    // Is there another junction beyond this one, on this road?
    const straightOn = junction.index + v.dir >= 0 && junction.index + v.dir <= last;

    // Which turns lead to a road that itself has somewhere to go. After
    // turning, the vehicle travels along the new axis starting from the road
    // it is on now, so the next junction it would meet is one step from its
    // CURRENT road index.
    const forward = City.forwardOf(v.axis, v.dir);
    const legal = [];
    for (const t of [NEAR_SIDE_TURN, CROSSING_TURN]) {
      const side = t === NEAR_SIDE_TURN
        ? { x: -forward.z, z: forward.x }
        : { x: forward.z, z: -forward.x };
      const newDir = Math.abs(side.x) > 0.5 ? Math.sign(side.x) : Math.sign(side.z);
      const next = v.lane.roadIndex + newDir;
      if (next >= 0 && next <= last) legal.push(t);
    }
    if (!legal.length) return;

    // Not the vehicle's seeded stream: which way it goes at a junction is
    // meant to differ every time the room is opened.
    const r = trueRandom();
    if (!straightOn) {
      // The edge of the grid. Turning is not optional here, so it takes the
      // NEAR-SIDE turn whenever that is available — always, if both are. The
      // crossing turn has to give way to oncoming traffic, and a compulsory
      // move that can be blocked is one the vehicle can be carried past while
      // it waits, leaving it driving away from the last junction it will ever
      // meet. Free choices further in are where the variety comes from.
      // The arrows deliberately do not apply here. This turn is compulsory, and
      // the near-side one is the only one that needs no gap in oncoming traffic
      // — sending a vehicle across the far side because an arrow was red is
      // sending it into a move it can be held out of indefinitely, at the last
      // junction it will ever meet.
      v.turn = legal.includes(NEAR_SIDE_TURN) ? NEAR_SIDE_TURN : legal[0];
      v.mustTurn = true;
      return;
    }

    // Otherwise it is a free choice, taken evenly between the options that
    // exist: carry on, turn left, turn right.
    //
    // It used to be weighted heavily towards carrying on — a car turned at
    // only one junction in three, a bus at one in six — and that quietly
    // pushed the whole fleet onto the ring road. A vehicle that does not turn
    // runs the length of the street, and the turn at the END of a street is
    // compulsory; turning at the outermost junction is, by construction, what
    // puts a vehicle ON the outermost road. The ring is then closed under
    // those same compulsory turns, because the only legal turn at a corner is
    // onto the other outer road. Easy to fall into, one chance in three per
    // junction to leave: with 40 vehicles and no congestion at all, half of
    // them ended up circling the edge of the city.
    //
    // An even choice means a vehicle almost never reaches the boundary by
    // default — three junctions of carrying on is one chance in twenty-seven —
    // and any that does has an even chance of turning back in at the next one.
    const options = [0];
    for (const t of legal) options.push(t);
    // ... and only among the ones the junction is currently allowing. The
    // manager guarantees at least one, so this never empties the list.
    const green = options.filter(t => this._turnPermitted(v, junction, t));
    const from = green.length ? green : options;

    // A vehicle with somewhere to be takes the way that gets it closer. Ties
    // are broken at random and so is the choice when nothing helps, which is
    // what keeps identical journeys from becoming a single worn path.
    if (v.goal && v.goal.lane) {
      // Already on the right street with the space still ahead: carry straight
      // on to it. Left to the cost function, a vehicle one junction short of
      // its space scores every movement the same and turns off at the last
      // corner before arriving.
      if (v.lane === v.goal.lane) {
        const along = v.axis === "x" ? v.x : v.z;
        if ((v.goal.at - along) * v.dir > 0 && straightOn
          && this._turnPermitted(v, junction, 0)) { v.turn = 0; return; }
      }
      const goalCell = City.cellOf(v.goal, this.roadX, this.roadZ);
      let best = Infinity;
      const ties = [];
      for (const t of from) {
        const cost = this._costAfter(v, junction, t, goalCell, v.goal.lane);
        if (cost < best - 1e-6) { best = cost; ties.length = 0; }
        if (cost <= best + 1e-6) ties.push(t);
      }
      if (ties.length && best < Infinity) {
        v.turn = ties[Math.floor(r * ties.length) % ties.length];
        return;
      }
    }
    v.turn = from[Math.floor(r * from.length) % from.length];
  }

  /// Sets up the quarter-circle a turning vehicle follows. The arc is tangent
  /// to both lane centrelines, so the vehicle leaves its lane and joins the
  /// next one without a kink at either end.
  /// Where a turn at this junction would put the vehicle: which lane, where
  /// the two lane centrelines cross, and where on the new lane it would come
  /// out. Shared, because the decision to ENTER the junction and the act of
  /// turning inside it must agree about the answer — the first is made at the
  /// stop line and the second several metres later.
  _turnTarget(v, junction) {
    const forward = City.forwardOf(v.axis, v.dir);
    // right(ax, az) = (-az, ax); left is its negative.
    const side = v.turn === 1
      ? { x: -forward.z, z: forward.x }
      : { x: forward.z, z: -forward.x };
    const newAxis = Math.abs(side.x) > 0.5 ? "x" : "z";
    const newDir = newAxis === "x" ? Math.sign(side.x) : Math.sign(side.z);
    // The road being turned onto is the one that makes this junction, so its
    // index is the junction's own index.
    const lane = this.lanes.get(`${newAxis}|${newDir}|${junction.index}`);
    if (!lane) return null;
    // The two lane centrelines cross here.
    const P = newAxis === "z"
      ? { x: lane.fixed, z: v.fixed }
      : { x: v.fixed, z: lane.fixed };
    const exitProgress = newAxis === "x"
      ? (P.x + TURN_RADIUS * side.x) * newDir
      : (P.z + TURN_RADIUS * side.z) * newDir;
    return { forward, side, newAxis, newDir, lane, P, exitProgress };
  }

  /// Is there somewhere to come OUT into? Asked at the stop line, before the
  /// vehicle commits to entering the junction.
  ///
  /// This is the difference between a queue and a deadlock. Held inside the
  /// box, a vehicle waiting for a gap blocks the traffic crossing it, which is
  /// waiting for the same kind of gap somewhere else — and at 240 vehicles the
  /// whole grid stopped, permanently, with 24 held mid-turn and 184 queued
  /// behind them. A driver decides before entering, and waits on the line,
  /// where waiting costs nobody else their right of way.
  _turnExitClear(v, junction) {
    const target = this._turnTarget(v, junction);
    if (!target) return true;
    const need = v.length / 2 + SAFE_GAP + 2.5;
    for (const other of target.lane.members) {
      if (other === v || other.arc) continue;
      const gap = Math.abs(City.progressOf(other) - target.exitProgress);
      if (gap < need + other.length / 2) return false;
    }
    return true;
  }

  _beginTurn(v, junction) {
    const target = this._turnTarget(v, junction);
    if (!target) { v.turn = 0; return; }
    const { forward, side, newAxis, newDir, lane, P } = target;

    // The arc is sized so that it STARTS where the vehicle already is. A fixed
    // radius means a fixed tangent point, and a vehicle that is past it —
    // which happens whenever a turn is taken late, and always for one that
    // entered the junction before its light changed — gets snapped backwards
    // onto the arc. That is a car jumping several metres, and it was the only
    // teleport left in the model. Tightening the radius instead keeps the
    // start exactly under the wheels, and the exit still lands on the centre
    // of the lane being joined.
    const toCrossing = (P.x - v.x) * forward.x + (P.z - v.z) * forward.z;
    if (toCrossing > TURN_RADIUS + 0.35) {
      v.atTurnPoint = false;
      return;   // still approaching
    }
    // Past the point where the two lane centrelines cross, no arc can both
    // start under the wheels and end on the centre of the lane being joined —
    // the vehicle would have to be dragged backwards onto it, which is a car
    // jumping several metres. A driver who has missed the turning carries on
    // instead, so an optional turn is simply abandoned here. A compulsory one
    // never gets this far: it holds at the turning point until it can go.
    // Below this the arc's minimum radius would put its start behind the
    // vehicle again, which is the same jump in miniature. Treated as "too late
    // to turn" rather than snapped.
    if (toCrossing < 1.5) {
      if (!v.mustTurn) v.turn = 0;
      v.atTurnPoint = false;
      return;
    }
    // From here on, every remaining reason to bail is traffic rather than
    // geometry. A vehicle that MUST turn can hold here; holding any earlier
    // means never reaching this point at all.
    v.atTurnPoint = true;
    // Exactly the distance to the crossing point, so the arc begins under the
    // wheels and there is no jump at all. Never larger than the standard
    // radius, so a turn taken early is still a normal-looking corner.
    const R = Math.min(TURN_RADIUS, toCrossing);
    const C = {
      x: P.x - R * forward.x + R * side.x,
      z: P.z - R * forward.z + R * side.z,
    };
    const start = { x: P.x - R * forward.x, z: P.z - R * forward.z };

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
        const turnSeconds = (TURN_RADIUS * Math.PI / 2) / Math.max(2, v.speed);
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
    //
    // Inside the junction this is a safety check rather than a fresh decision
    // — the same question was answered at the line — so the margin is the room
    // actually needed rather than a comfortable one. Refusing generously from
    // in here strands the vehicle in the box; refusing not at all drives it
    // into the side of whatever is there.
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

    // Finally, is the ground the vehicle will sweep over actually clear? The
    // checks above look at the lane being joined, which is not the same thing:
    // a long vehicle turning through a junction passes over a good deal of it,
    // and something queued on another approach is not in either lane but is
    // very much in the way. It cannot move aside either — it is stopped at a
    // light — so the turn has to wait instead. This was the commonest contact
    // left in the model, and every one of them was a turn crossing something
    // standing still.
    const sweptClear = (() => {
      for (let k = 1; k <= 4; k++) {
        const theta = theta0 + sweep * (k / 4);
        const px = C.x + R * Math.cos(theta);
        const pz = C.z + R * Math.sin(theta);
        for (const other of this.cars) {
          if (other === v || other.arc) continue;
          const need = other.length / 2 + v.width / 2 + 0.6;
          if (Math.hypot(other.x - px, other.z - pz) < need) return false;
        }
      }
      return true;
    })();
    if (!sweptClear) return;

    v.atTurnPoint = false;
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
    // A fresh pace out of every corner. A vehicle keeps one speed for the
    // length of a street and then picks another, so the same car is the one
    // holding everyone up on one road and the one pressing on down the next —
    // the traffic keeps rearranging itself instead of settling into a fixed
    // order. Drawn from the vehicle's own deterministic stream, so a given
    // city still behaves identically every time it is opened.
    v.pace = PACE_SLOWEST + trueRandom() * (PACE_FASTEST - PACE_SLOWEST);
    v.cruise = v.spec.cruise * v.pace;
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

    // Stopped, or on its way into a space: that takes over entirely.
    if (this._handleStopping(v, dt)) {
      this._holdAtKerb(v);
      return;
    }

    let desired = v.cruise;
    const heading = City.forwardOf(v.axis, v.dir);

    // Pulling in. It eases towards the kerb while it runs down to the space.
    // Part-way through reversing into a space: the manoeuvre owns the vehicle
    // until it is done.
    if (v.manoeuvre) return this._runManoeuvre(v, dt);

    if (v.stopTarget) {
      const along = v.axis === "x" ? v.x : v.z;
      const target = v.stopTarget;
      // A space with a car in front of it has to be reversed into, and the
      // run-up stops one car's length past it rather than at it.
      const reversing = target.reverse === true;
      const togo = (target.bay.at + (reversing ? v.dir * REVERSE_RUN : 0) - along) * v.dir;
      // The pull-over starts only once the space is close. Started the moment
      // the space was claimed — up to PARK_APPROACH away — the vehicle drifts
      // towards the kerb across several bays and clips whatever is parked in
      // them, which was the commonest contact in the model.
      v.kerbTarget = reversing || togo > KERB_EASE_FROM ? 0 : target.offset;
      // Indicating all the way in, as a driver does — this is the signal that
      // the car in front of you is about to stop, and it goes on well before
      // anything happens.
      v.indicate = NEAR_SIDE_TURN;

      // Give the space back rather than keep it at any cost. Overshooting it —
      // pushed past by the queue behind — used to snap the vehicle back to the
      // bay, a visible jump of up to 3.9 m. And a vehicle that reserves a bay
      // and is then held in traffic used to keep it: one was measured holding
      // a space for 356 s without ever reaching it, while cars that could have
      // used it drove past.
      if (togo < -1.2 || this._clock > v.stopTarget.giveUp) {
        this._releaseBays({ stop: v.stopTarget, lane: v.lane });
        if (v.stopTarget.kind === "park") this._parkingSoon--;
        v.stopTarget = null;
        v.kerbTarget = 0;
        return;
      }

      if (togo < 0.5 && v.speed < 0.6 && reversing) {
        // Stopped alongside. Pause, then take it back on the lock.
        v.speed = 0;
        v.manoeuvre = {
          kind: target.kind,
          bay: target.bay,
          bays: target.bays,
          from: (v.axis === "x" ? v.x : v.z) * v.dir,
          angle: 0,
          rising: true,
          waitUntil: this._clock + MANOEUVRE_WAIT,
          base: v.heading,
        };
        v.stopTarget = null;
        return true;
      }

      if (togo < 0.5 && v.speed < 0.6) {
        v.speed = 0;
        // NOT snapping kerbOffset to the target here. The ease at the top of
        // _handleStopping keeps running while the vehicle stands, so it drifts
        // the last few centimetres in; forcing it was a sideways jump of up to
        // 1.3 m at the moment of arrival.
        const kind = v.stopTarget.kind;
        v.stop = {
          kind,
          bay: v.stopTarget.bay,
          bays: v.stopTarget.bays,
          until: this._clock + (kind === "unload"
            ? UNLOAD_MIN + trueRandom() * (UNLOAD_MAX - UNLOAD_MIN)
            : kind === "park"
            // Five minutes to two hours, weighted towards the short end. Drawn
            // flat, the average stay is an hour and the city quietly empties:
            // every car is either parked or on its way to park, and almost
            // nobody is left driving. Squaring the draw keeps the same range
            // and brings the average down to about forty minutes, which is
            // also closer to how kerbside parking actually turns over.
            ? PARK_MIN + trueRandom() ** 2 * (PARK_MAX - PARK_MIN)
            : BUS_DWELL_MIN + trueRandom() * (BUS_DWELL_MAX - BUS_DWELL_MIN)),
        };
        if (kind === "park") { this._parkedCars++; this._parkingSoon--; }
        // Whatever it had decided to do at the next junction is forgotten; it
        // will decide again when it pulls out.
        v.turn = 0;
        v.mustTurn = false;
        v.turnDecidedAt = -1;
        v.stopTarget = null;
        this._holdAtKerb(v);
        return;
      }
      desired = Math.min(desired, Math.sqrt(Math.max(0, 2 * v.brakeRate * (togo - 0.2))));
    }

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
      // A vehicle lining up for a space is already indicating for the kerb, and
      // that signal outranks the junction's: it is the one that says "I am
      // stopping", which is what the traffic behind actually needs to know.
      if (!v.stopTarget) v.indicate = junction.distance < INDICATE_FROM ? v.turn : 0;
      const ix = v.axis === "x" ? junction.index : v.lane.roadIndex;
      const iz = v.axis === "x" ? v.lane.roadIndex : junction.index;
      const green = this._isGreen(v.axis, ix, iz, this._clock);
      // Three separate reasons not to enter a junction, all of which look the
      // same from outside — the vehicle waits at the line.
      let mayEnter = green;
      // Both of the checks below are about crossing the junction and coming
      // out the far side. A vehicle that MUST turn is not going to the far
      // side — it is leaving by the arm to its right — and the room it needs
      // is in the lane it is joining, which _beginTurn checks for itself.
      // Applying them here blocked forced turns behind a queue that was never
      // going to clear, and the vehicle followed that queue straight out of
      // the street grid.
      if (green) {
        // Would it still be in the box when the other direction is released?
        // This one applies to a compulsory turn as much as to anything else —
        // MORE so, in fact. Exempting forced turns from it let a slow truck
        // enter on the last of the green, run out of phase mid-manoeuvre, and
        // then find the turn unavailable because the light had changed; it
        // drifted out the far side with a turn it could no longer take.
        const crossSpeed = Math.max(v.speed, v.cruise * 0.55);
        const crossTime = (ROAD_WIDTH + v.length) / crossSpeed;
        if (crossTime > this._timeToCrossGreen(v.axis, ix, iz, this._clock)) mayEnter = false;
        // Is there anywhere to come out into? Stopping in the middle of a
        // junction because the queue beyond it has not moved is the other way
        // traffic ends up across someone else's right of way. A vehicle that
        // is turning is not going to the far side, so this does not apply to
        // it — the room it needs is in the lane it joins, and _beginTurn
        // checks that itself.
        if (mayEnter && ahead && !v.mustTurn) {
          const needed = junction.distance + ROAD_WIDTH + v.length + SAFE_GAP;
          if (ahead.gap < needed) mayEnter = false;
        }
        // A vehicle that means to turn asks the same question of the lane it
        // is turning INTO, and asks it here, at the line — not from inside the
        // junction, where waiting blocks the traffic crossing it.
        if (mayEnter && v.turn !== 0 && junction.distance > -0.5
          && !this._turnExitClear(v, junction)) {
          // Rather than sit on the line holding up everyone behind, go straight
          // on if that way is open — which is what a driver does when the turn
          // they wanted is plainly not happening this phase. Measured at 240
          // vehicles, queue heads waiting for a turn that had nowhere to go
          // were 17% of everything stopped at a junction, and each one was a
          // whole approach at a standstill behind it.
          //
          // Only ever onto the straight-ahead: it needs no arc and no room in
          // another lane, so it cannot fail halfway. Changing to the OTHER
          // turn at the line is the move that used to strand vehicles part-way
          // round a manoeuvre they had already driven past the start of.
          const last = this.roadX.length - 1;
          const onwards = junction.index + v.dir >= 0 && junction.index + v.dir <= last;
          const room = ahead ? ahead.gap : Infinity;
          const needed = junction.distance + ROAD_WIDTH + v.length + SAFE_GAP;
          // Deliberately NOT gated on the arrows. This is the escape valve for
          // a vehicle that is already at the line and stuck; closing it because
          // the street ahead is busy trades one blocked approach for another,
          // and measured at 240 vehicles it cost more than the whole manager
          // gained — throughput in the eighth minute fell from 5.4 to 1.0.
          if (!v.mustTurn && onwards && room >= needed) {
            v.turn = 0;
            v.indicate = 0;
          } else {
            mayEnter = false;
          }
        }
      }
      if (!mayEnter && junction.distance > -0.5) {
        // The speed it could still be doing here and stop by the line.
        const room = Math.max(0, junction.distance - 0.5);
        desired = Math.min(desired, Math.sqrt(2 * v.brakeRate * room));
      }
      // A compulsory turn is approached slowly, but only over the last few
      // metres: crawling all the way in makes a long vehicle too slow to clear
      // the junction inside one phase.
      if (v.mustTurn && junction.distance < 2.5) desired = Math.min(desired, 4.5);
      // Once it is INSIDE the junction the light no longer decides anything —
      // a manoeuvre already begun gets finished, which is both what a driver
      // does and what stops a vehicle being stranded mid-junction by a phase
      // change with nowhere legal to go.
      const committed = mayEnter || junction.distance < 0;
      if (v.turn !== 0 && committed && junction.distance < TURN_RADIUS + 3) {
        desired = Math.min(desired, 6.5);   // slow down into the corner
        this._beginTurn(v, junction);
        if (v.arc) return;
        // A wait inside the junction is bounded. Standing still in the box is
        // what turns a queue into a deadlock — the traffic crossing it is
        // waiting for a gap that this vehicle is the reason nobody has — so
        // after a few seconds it stops waiting and creeps out instead. Under
        // that it holds, which is the safe thing and almost always enough: the
        // decision not to be here at all was made back at the line.
        if (v.mustTurn && v.atTurnPoint) desired = 0;
      }
    } else {
      // No junction ahead at all means this vehicle is past the last one and
      // driving away from the grid for good. Every path that leads here is
      // meant to be closed off — the forced turn at the edge, the crawl on the
      // approach, the near-side choice that needs no gap — but "meant to" is
      // not the same as "cannot", and the failure mode is a car receding into
      // the distance forever. So it turns round and rejoins the network.
      v.indicate = 0;
      const back = this.lanes.get(`${v.axis}|${-v.dir}|${v.lane.roadIndex}`);
      if (back) {
        const from = v.lane.members.indexOf(v);
        if (from >= 0) v.lane.members.splice(from, 1);
        v.lane = back;
        back.members.push(v);
        v.dir = -v.dir;
        v.fixed = back.fixed;
        if (v.axis === "x") v.z = v.fixed; else v.x = v.fixed;
        const forward = City.forwardOf(v.axis, v.dir);
        v.heading = Math.atan2(forward.z, forward.x);
        v.speed = Math.min(v.speed, 4);
        v.turn = 0;
        v.mustTurn = false;
        v.turnDecidedAt = -1;
        this.strays++;
      }
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

    this._considerStopping(v, dt);

    const forward = City.forwardOf(v.axis, v.dir);
    v.x += forward.x * v.speed * dt;
    v.z += forward.z * v.speed * dt;
    // Hold the lane exactly; a hundred frames of floating point otherwise
    // walks a vehicle sideways out of its own carriageway. The kerb offset
    // rides on top of that, so a vehicle pulling in leaves the lane cleanly
    // and comes back to the middle of it.
    this._holdAtKerb(v);
    v.heading = Math.atan2(forward.z, forward.x);

    // No wrapping, and nothing is ever removed. The grid is closed, so a
    // vehicle that keeps driving keeps finding junctions; the only way it
    // leaves a street is by turning into another one.
  }


  /// Puts a vehicle on its lane, offset towards the kerb by however far it has
  /// pulled over.
  _holdAtKerb(v) {
    const kerb = Math.sign(City.laneOffset(v.axis, v.dir)) * v.kerbOffset;
    if (v.axis === "x") v.z = v.fixed + kerb; else v.x = v.fixed + kerb;
  }

  /// Kerbside spaces along every street, and the bus stops among them.
  ///
  /// Bays stop well clear of the junctions: the stop line is ten metres out and
  /// the crossing just inside that, so parking up to the corner would put a
  /// parked car across both. Bus stops are chosen per BLOCK rather than per
  /// street — two of a block's four sides get one, so a block is served but not
  /// surrounded, and the choice comes from the city's own seed so a given room
  /// always has its stops in the same places.
  _layoutParking(cx, cz, span, block, rnd) {
    for (const [, lane] of this.lanes) {
      const crossing = lane.axis === "x" ? this.roadX : this.roadZ;
      lane.bays = [];
      for (let at = lane.center - lane.reach; at <= lane.center + lane.reach; at += BAY_PITCH) {
        if (crossing.some(road => Math.abs(at - road) < PARK_CLEAR)) continue;
        lane.bays.push({ at, taken: null, busStop: false });
      }
    }

    // Which lane runs along a given side of a block with its KERB facing it.
    // Traffic keeps right, so the near-side lane is the one whose lane offset
    // points back towards the block.
    const laneAlong = (side, bx, bz) => {
      const axis = side === "north" || side === "south" ? "x" : "z";
      const road = side === "north" ? bz - span / 2
        : side === "south" ? bz + span / 2
        : side === "west" ? bx - span / 2
        : bx + span / 2;
      const wanted = side === "north" || side === "west" ? 1 : -1;   // towards the block
      const coords = axis === "x" ? this.roadZ : this.roadX;
      let index = 0;
      for (let i = 1; i < coords.length; i++) {
        if (Math.abs(coords[i] - road) < Math.abs(coords[index] - road)) index = i;
      }
      for (const dir of [1, -1]) {
        if (Math.sign(City.laneOffset(axis, dir)) === wanted) {
          return { lane: this.lanes.get(`${axis}|${dir}|${index}`), along: axis === "x" ? bx : bz };
        }
      }
      return null;
    };

    for (let gx = -GRID_RADIUS; gx <= GRID_RADIUS; gx++) {
      for (let gz = -GRID_RADIUS; gz <= GRID_RADIUS; gz++) {
        const sides = ["north", "south", "west", "east"];
        // Two of the four, drawn from the city's seed.
        for (let picked = 0; picked < BUS_STOPS_PER_BLOCK && sides.length; picked++) {
          const side = sides.splice(Math.floor(rnd() * sides.length), 1)[0];
          const found = laneAlong(side, cx + gx * span, cz + gz * span);
          if (!found || !found.lane || !found.lane.bays.length) continue;
          let best = null;
          for (const bay of found.lane.bays) {
            if (bay.busStop) continue;
            if (!best || Math.abs(bay.at - found.along) < Math.abs(best.at - found.along)) best = bay;
          }
          if (!best) continue;
          best.busStop = true;
          // The whole side is given over to the stop. A bus pulling into a
          // layby needs the kerb either side of it kept clear to get in and out
          // of, and a row of parked cars up to the mouth of one is the thing
          // that stops it — so a side with a stop on it has no parking at all,
          // rather than parking with a gap in it.
          found.lane.bays = found.lane.bays.filter(bay =>
            bay.busStop || Math.abs(bay.at - found.along) > span / 2);
        }
      }
    }

    // The flat list of every bay, built LAST — after the stops are chosen and
    // the sides they are on have been cleared. Built before that it holds bays
    // that no longer exist, and cars drive to spaces that were never painted.
    this.bayIndex = [];
    for (const [, lane] of this.lanes) {
      for (const bay of lane.bays) {
        bay.lane = lane;
        bay.x = lane.axis === "x" ? bay.at : lane.fixed;
        bay.z = lane.axis === "x" ? lane.fixed : bay.at;
        this.bayIndex.push(bay);
      }
    }
  }

  /// Claim a bay and every neighbour the vehicle's body actually covers.
  ///
  /// A bay is BAY_PITCH long and a bus is up to 12.2 m, so a bus that claims
  /// only the bay it stops at leaves the space either side of it looking free —
  /// a car then parks into the half of the bay the bus is standing in. The
  /// clearance allows for the neighbour being a car rather than a point.
  _takeBay(v, bay) {
    const reach = v.length / 2 + BAY_CLEARANCE;
    const claimed = [];
    for (const other of v.lane.bays) {
      if (other !== bay && Math.abs(other.at - bay.at) > reach) continue;
      if (other.taken && other.taken !== v) continue;
      other.taken = v;
      claimed.push(other);
    }
    return claimed;
  }

  /// Whether a vehicle can have that bay: it and everything its body would
  /// cover must be free.
  _bayFree(v, bay) {
    const reach = v.length / 2 + BAY_CLEARANCE;
    for (const other of v.lane.bays) {
      if (other !== bay && Math.abs(other.at - bay.at) > reach) continue;
      if (other.taken) return false;
    }
    return true;
  }

  _releaseBays(v) {
    if (!v.stop || !v.stop.bays) return;
    for (const bay of v.stop.bays) bay.taken = null;
  }

  /// Puts a share of the cars in bays before the city has run a single frame.
  ///
  /// A street with nothing parked on it does not look like a city, and there is
  /// a second reason: the only way a vehicle leaves the road is by parking, so
  /// starting every car in traffic starts the city over its own capacity and it
  /// jams before parking can ever drain it. Beginning at the equilibrium
  /// instead — most cars at the kerb, the rest driving between spaces — is both
  /// what a real street looks like and what keeps it moving.
  ///
  /// The expiry times are spread across a whole stay rather than drawn fresh,
  /// so they do not all come back to the road together.
  _parkStartingCars(rnd) {
    const wanted = Math.floor(this.cars.length * PARK_SHARE * START_PARKED);
    for (const v of this.cars) {
      if (this._parkedCars >= wanted) break;
      if (v.kind !== "car" || v.stop) continue;
      const bay = v.goal && !v.goal.taken && !v.goal.busStop && this._bayFree(v, v.goal)
        ? v.goal : null;
      if (!bay) continue;

      const from = v.lane.members.indexOf(v);
      if (from >= 0) v.lane.members.splice(from, 1);
      v.lane = bay.lane;
      v.axis = bay.lane.axis;
      v.dir = bay.lane.dir;
      v.fixed = bay.lane.fixed;
      v.lane.members.push(v);
      if (v.axis === "x") { v.x = bay.at; v.z = v.fixed; } else { v.z = bay.at; v.x = v.fixed; }
      v.heading = Math.atan2(City.forwardOf(v.axis, v.dir).z, City.forwardOf(v.axis, v.dir).x);
      v.speed = 0;
      v.arc = null;
      v.turn = 0;
      v.mustTurn = false;
      v.turnDecidedAt = -1;
      v.kerbOffset = PARK_OFFSET;
      v.kerbTarget = PARK_OFFSET;
      v.stop = {
        kind: "park",
        bay,
        bays: this._takeBay(v, bay),
        until: this._clock + PARK_MIN + rnd() * (PARK_MAX - PARK_MIN),
      };
      this._parkedCars++;
      this._holdAtKerb(v);
      v.goal = null;
    }
  }

  // MARK: - Destinations

  /// Somewhere to be going, preferably across town.
  ///
  /// A vehicle without a destination is not driving, it is milling about — and
  /// it showed, because the only thing that decided where anyone went was a
  /// coin toss at each junction. Every car now picks a parking space, drives to
  /// it, and stays for a while; the far-side preference is what puts traffic on
  /// the roads BETWEEN the two halves of the city rather than only near where
  /// it happened to start.
  _pickGoal(v) {
    v.goalSince = this._clock;
    if (!this.bayIndex || !this.bayIndex.length) return null;
    const far = this._span * GRID_RADIUS;         // roughly half the grid
    let fallback = null;
    // A handful of tries for somewhere far away, then whatever is free. Walking
    // the whole list sorted by distance would send every car in a district to
    // the same bay.
    for (let i = 0; i < 24; i++) {
      const bay = this.bayIndex[Math.floor(trueRandom() * this.bayIndex.length)];
      if (!bay || bay.busStop || bay.taken) continue;
      if (!fallback) fallback = bay;
      if (Math.hypot(bay.x - v.x, bay.z - v.z) >= far) return bay;
    }
    return fallback;
  }

  /// Where a bay sits on the grid: which junction a vehicle would be at when it
  /// draws level with it, and which lane it has to be in to do so.
  static cellOf(bay, roadA, roadB) {
    const along = bay.lane.axis === "x" ? roadA : roadB;
    // The junction just BEFORE the space, in the direction its lane runs — not
    // the nearest one. The nearest can be the junction beyond it, and a vehicle
    // routed there arrives having already driven past the space it came for,
    // which is a full lap of the block to try again.
    let best = -1;
    let closest = Infinity;
    for (let i = 0; i < along.length; i++) {
      const before = (bay.at - along[i]) * bay.lane.dir;
      if (before <= 0 || before >= closest) continue;
      closest = before;
      best = i;
    }
    if (best < 0) {
      best = 0;
      for (let i = 1; i < along.length; i++) {
        if (Math.abs(along[i] - bay.at) < Math.abs(along[best] - bay.at)) best = i;
      }
    }
    return bay.lane.axis === "x"
      ? { ix: best, iz: bay.lane.roadIndex }
      : { ix: bay.lane.roadIndex, iz: best };
  }

  /// How many junctions of driving still separate a vehicle from its
  /// destination, if it takes a given movement at the junction ahead.
  ///
  /// Manhattan distance on the grid, plus a step for still being on the wrong
  /// street when it gets there. That last part is what makes a vehicle turn
  /// onto its destination's road rather than run alongside it forever.
  _costAfter(v, junction, turn, goalCell, goalLane) {
    const last = this.roadX.length - 1;
    let axis = v.axis;
    let dir = v.dir;
    let ix = v.axis === "x" ? junction.index : v.lane.roadIndex;
    let iz = v.axis === "x" ? v.lane.roadIndex : junction.index;

    if (turn === 0) {
      if (axis === "x") ix += dir; else iz += dir;
    } else {
      const target = this._turnTarget({ axis, dir, fixed: v.lane.fixed, turn }, junction);
      if (!target) return Infinity;
      axis = target.newAxis;
      dir = target.newDir;
      if (axis === "x") ix += dir; else iz += dir;
    }
    if (ix < 0 || ix > last || iz < 0 || iz > last) return Infinity;

    const steps = Math.abs(ix - goalCell.ix) + Math.abs(iz - goalCell.iz);
    // On the destination's own street, pointing the right way, is worth a step:
    // a vehicle that is level with its space but on the far carriageway has to
    // go round the block to reach it.
    const aligned = axis === goalLane.axis && dir === goalLane.dir
      && (axis === "x" ? iz : ix) === goalLane.roadIndex;

    // Plus what it will cost to get through. Shortest-path routing on its own
    // was measurably worse than turning at random — every journey heading the
    // same way took the same streets and the grid stopped completely — because
    // a route that ignores congestion cannot route around any.
    const jx = v.axis === "x" ? junction.index : v.lane.roadIndex;
    const jz = v.axis === "x" ? v.lane.roadIndex : junction.index;
    const loads = this.turnLoads.get(`${v.axis}|${v.dir}|${jx}|${jz}`);
    const busy = loads && loads.has(turn) ? loads.get(turn) : 0;
    return steps + (aligned ? 0 : 1) + busy * ROUTE_CONGESTION;
  }

  /// Whether a vehicle is in the running lane, for the traffic behind it. A
  /// parked car is at the kerb and is driven past; a truck unloading and a bus
  /// at a stop are not, and the queue behind them is the point.
  static blocksLane(v) {
    // Asked of the vehicle's position, not of what it is doing there. This used
    // to name the kinds that counted as out of the way — parking did, loading
    // and calling at a stop did not — and that was right when loading meant an
    // artic standing in the running lane. Vans load at the kerb and buses pull
    // into laybys, so by kind they were still roadblocks: 38 vans at the kerb,
    // each closing the lane it was parked beside, and the city stopped dead at
    // 0.2 junction crossings a second.
    if (v.manoeuvre) return true;             // across the lane, reversing in
    if (!v.stop) return true;
    // Clear when its nearest edge is outside the room the widest thing on the
    // road needs to get past it.
    return (v.kerbOffset - v.width / 2) < LANE_CLEAR;
  }

  /// A car looks for a space, a truck stops where it stands, a bus calls at its
  /// stops. Called while driving, once the vehicle is clear of a junction.
  _considerStopping(v, dt) {
    // Not "has a turn pending": a turn is chosen two junctions' notice in
    // advance and is set two thirds of the time, so testing for it stopped
    // buses calling at 1492 of the 1502 stops they drove past. Being part-way
    // round one is the thing that matters, and the bays are already kept well
    // clear of the junctions.
    if (v.stop || v.stopTarget || v.arc) return;

    // An articulated lorry is passing through. It used to stand in the running
    // lane to load, which on a grid with one lane each way is a closed road for
    // ten minutes; that work belongs to the vans, which fit at the kerb.
    if (v.kind === "truck") return;
    void dt;

    const along = v.axis === "x" ? v.x : v.z;
    for (const bay of v.lane.bays) {
      const ahead = (bay.at - along) * v.dir;
      if (ahead < 2 || ahead > PARK_APPROACH) continue;
      if (bay.taken) continue;

      if (v.kind === "van") {
        // Any free space will do — a delivery is wherever the delivery is.
        if (bay.busStop) continue;
        if (trueRandom() >= UNLOAD_CHANCE) continue;
        if (!this._bayFree(v, bay) || !this._bayUsable(v, bay)) continue;
        v.stopTarget = { bay, kind: "unload", offset: VAN_OFFSET,
                         giveUp: this._clock + RESERVE_TTL,
                         reverse: this._gapNeedsReversing(v, bay),
                         bays: this._takeBay(v, bay) };
        return;
      }

      if (v.kind === "bus") {
        if (!bay.busStop || this._clock < v.busStopAfter) continue;
        if (!this._bayFree(v, bay)) continue;
        v.stopTarget = { bay, kind: "busstop", offset: BUS_STOP_OFFSET,
                         giveUp: this._clock + RESERVE_TTL,
                         bays: this._takeBay(v, bay) };
        return;
      }
      if (bay.busStop) continue;                            // not a parking space
      // Its OWN space, not just any space it drives past — the destination is
      // the whole reason it is on this street, and a car that took the first
      // free bay on its route never went anywhere.
      //
      // Until it has been looking too long. A driver who has spent a quarter of
      // an hour trying to reach one particular space takes what is going
      // instead, and that is also what keeps the city from seizing: the only
      // way off the road is to park, so a jam that stops vehicles reaching
      // their spaces is a jam that can never drain itself. With the destination
      // held to strictly, throughput fell to nothing and stayed there.
      const patient = this._clock - (v.goalSince || 0) < PARK_PATIENCE;
      if (bay !== v.goal && patient) continue;
      // Counting the ones already on their way in as well as the ones already
      // there. Without that, every car that happens to pass a free bay in the
      // same second reserves one while the count is still low, and they all
      // arrive: the cap said 53 and 94 cars parked.
      if (this._parkedCars + this._parkingSoon >= this.cars.length * PARK_SHARE) {
        v.goal = this._pickGoal(v);        // come back to it another time
        return;
      }
      if (!this._bayFree(v, bay) || !this._bayUsable(v, bay)) {
        v.goal = this._pickGoal(v);
        return;
      }
      this._parkingSoon++;
      v.stopTarget = { bay, kind: "park", offset: PARK_OFFSET,
                       giveUp: this._clock + RESERVE_TTL,
                       reverse: this._gapNeedsReversing(v, bay),
                       bays: this._takeBay(v, bay) };
      return;
    }
  }

  /// Reversing into the space, one frame at a time.
  ///
  /// The vehicle is off its lane centreline and at an angle to it for the whole
  /// manoeuvre, which no other part of the model expects, so this takes the
  /// vehicle over completely: it sets the position and the heading itself and
  /// nothing else touches them until it is parked.
  _runManoeuvre(v, dt) {
    const m = v.manoeuvre;
    v.speed = 0;
    v.braking = false;
    // Both indicators while manoeuvring, the same as any vehicle stopped in a
    // way that needs explaining to the traffic behind.
    v.indicate = ((this._clock * BLINK_HZ) % 1) < 0.55 ? 1 : 0;
    if (this._clock < m.waitUntil) return true;

    const step = (REVERSE_SPEED * dt) / REVERSE_RADIUS;
    m.angle += m.rising ? step : -step;
    if (m.rising && m.angle >= REVERSE_ANGLE) { m.angle = REVERSE_ANGLE; m.rising = false; }

    const done = !m.rising && m.angle <= 0;
    const pose = City.reversePose(m.from, Math.max(0, m.angle), m.rising);
    const side = City.kerbSide(v.axis, v.dir);
    const along = pose.along * v.dir;
    if (v.axis === "x") { v.x = along; v.z = v.fixed + side * pose.across; }
    else { v.z = along; v.x = v.fixed + side * pose.across; }
    // The nose swings away from the kerb as the tail swings into it. The kerb
    // is always ninety degrees to the left of the heading, whichever way round
    // the lane runs, so one sign covers all four.
    v.heading = m.base - pose.turn;
    v.kerbOffset = pose.across;
    v.kerbTarget = pose.across;

    if (!done) return true;

    v.heading = m.base;
    v.kerbOffset = PARK_OFFSET;
    v.kerbTarget = PARK_OFFSET;
    v.manoeuvre = null;
    this._settleIntoBay(v, m.kind, m.bay, m.bays);
    return true;
  }

  /// Coming to rest in a space, however the vehicle got into it.
  _settleIntoBay(v, kind, bay, bays) {
    v.speed = 0;
    v.indicate = 0;
    v.stop = {
      kind,
      bay,
      bays,
      until: this._clock + (kind === "unload"
        ? UNLOAD_MIN + trueRandom() * (UNLOAD_MAX - UNLOAD_MIN)
        : PARK_MIN + trueRandom() ** 2 * (PARK_MAX - PARK_MIN)),
    };
    if (kind === "park") { this._parkedCars++; this._parkingSoon--; }
    v.turn = 0;
    v.mustTurn = false;
    v.turnDecidedAt = -1;
    this._holdAtKerb(v);
  }

  /// Where every bus layby is, in world rectangles.
  ///
  /// A bus stop has to be a layby and not just a painted box: on a thirteen
  /// metre street a bus that pulls as far over as the kerb allows still has a
  /// metre of itself in the running lane, and everything behind it waits. Cut
  /// back into the pavement it stands completely clear, which is the whole
  /// point of building one.
  _laybyRects() {
    const out = [];
    for (const [, lane] of this.lanes) {
      const side = City.kerbSide(lane.axis, lane.dir);
      const inner = lane.fixed - City.laneOffset(lane.axis, lane.dir) + side * (ROAD_WIDTH / 2);
      const outer = inner + side * LAYBY_DEPTH;
      for (const bay of lane.bays) {
        if (!bay.busStop) continue;
        const half = BUS_LAYBY_LENGTH / 2;
        const a0 = bay.at - half;
        const a1 = bay.at + half;
        out.push(lane.axis === "x"
          ? { x0: a0, x1: a1, z0: Math.min(inner, outer), z1: Math.max(inner, outer) }
          : { x0: Math.min(inner, outer), x1: Math.max(inner, outer), z0: a0, z1: a1 });
      }
    }
    return out;
  }

  /// The paint along the kerb: a box for every parking space, and a coloured
  /// bed with BUS across it at every stop, so what a space is for is legible
  /// from the pavement rather than only from the code.
  _paintKerbside(flats, laybys) {
    const y = ROAD_Y + 0.02;
    // The laybys are road surface, not pavement — laid at road level in the
    // hole the pads left for them.
    // Each patch is laid a little LARGER than the piece cut out of the pavement
    // for it, so its side faces end up buried inside the pad rather than flush
    // with the cut edge. Flush is two surfaces at one depth along a face you
    // stand right next to, and it was 1158 of them across the city.
    const bury = 0.12;
    for (const r of laybys) {
      flats.add(boxMatrix((r.x0 + r.x1) / 2, ROAD_Y - KERB_HEIGHT / 2, (r.z0 + r.z1) / 2,
        (r.x1 - r.x0) + bury * 2, KERB_HEIGHT, (r.z1 - r.z0) + bury * 2), ASPHALT_COLOR);
    }

    for (const [, lane] of this.lanes) {
      const alongX = lane.axis === "x";
      const side = City.kerbSide(lane.axis, lane.dir);
      const kerb = lane.fixed - City.laneOffset(lane.axis, lane.dir) + side * (ROAD_WIDTH / 2);
      // A line laid ACROSS the lane direction, at a given distance along it.
      const tick = (at, from, to, colour) => {
        const mid = (from + to) / 2;
        const width = Math.abs(to - from);
        flats.add(alongX
          ? boxMatrix(at, y, mid, BAY_LINE_W, 0.04, width)
          : boxMatrix(mid, y, at, width, 0.04, BAY_LINE_W), colour);
      };
      const rail = (a0, a1, across, colour, thickness = BAY_LINE_W) => {
        const mid = (a0 + a1) / 2;
        const len = Math.abs(a1 - a0);
        flats.add(alongX
          ? boxMatrix(mid, y, across, len, 0.04, thickness)
          : boxMatrix(across, y, mid, thickness, 0.04, len), colour);
      };

      for (const bay of lane.bays) {
        if (bay.busStop) {
          // A bed of colour the length of the layby, with BUS laid along it.
          const half = BUS_LAYBY_LENGTH / 2 - 0.5;
          const nearEdge = kerb - side * (LAYBY_DEPTH * 0.02);
          const farEdge = kerb + side * (LAYBY_DEPTH - 0.25);
          const mid = (nearEdge + farEdge) / 2;
          const depth = Math.abs(farEdge - nearEdge);
          flats.add(alongX
            ? boxMatrix(bay.at, y - 0.004, mid, half * 2, 0.03, depth)
            : boxMatrix(mid, y - 0.004, bay.at, depth, 0.03, half * 2), BUS_BOX_COLOR);
          // No lettering. It was drawn as bars making out B, U and S, on the
          // theory that it would read as lettering without a font in the
          // bundle. It does not: at any angle you actually see a bus stop
          // from, it reads as white dashes scattered across the bay. The
          // coloured bed and the shape of the layby say what it is.
          continue;
        }
        // An ordinary space: a box open to the carriageway, as they are painted.
        const half = BAY_LENGTH / 2;
        const back = kerb - side * 0.12;
        const front = kerb - side * (LAYBY_DEPTH * 0 + PARK_BOX_DEPTH);
        // The rail stops short of both ticks. Run through them and the two
        // share a square of road at exactly one depth at each corner, which is
        // 912 z-fighting corners across the city.
        tick(bay.at - half, back, front, BAY_LINE_COLOR);
        tick(bay.at + half, back, front, BAY_LINE_COLOR);
        rail(bay.at - half + BAY_LINE_W, bay.at + half - BAY_LINE_W, front, BAY_LINE_COLOR);
      }
    }
  }

  /// Which way the kerb lies from a lane's centreline.
  static kerbSide(axis, dir) {
    return Math.sign(City.laneOffset(axis, dir));
  }

  /// Where a vehicle would be, part-way through reversing into a space.
  ///
  /// Two arcs of opposite lock, taken backwards: the first swings the tail
  /// towards the kerb, the second straightens up against it. `a` runs from zero
  /// up to REVERSE_ANGLE and back down, which is the steering wheel going one
  /// way and then the other.
  static reversePose(from, a, rising) {
    const R = REVERSE_RADIUS;
    if (rising) {
      return { along: from - R * Math.sin(a), across: R * (1 - Math.cos(a)), turn: a };
    }
    return {
      along: from - REVERSE_RUN + R * Math.sin(a),
      across: PARK_OFFSET - R * (1 - Math.cos(a)),
      turn: a,
    };
  }

  /// Is there a car parked directly in front of the space?
  ///
  /// That is the whole difference between the two manoeuvres. An open kerb is
  /// driven into forwards; a gap between two parked cars has to be reversed
  /// into, because there is no way to swing the nose in without clipping the
  /// one in front.
  _gapNeedsReversing(v, bay) {
    // BOTH neighbours, not just the one in front. Driving forward into a space
    // means easing sideways towards the kerb over the last few metres — which
    // is exactly the stretch of kerb the space BEHIND occupies, so a vehicle
    // pulling in over an occupied one drives diagonally through it. Reversing
    // starts from alongside instead and never crosses either neighbour.
    for (const step of [1, -1]) {
      const at = bay.at + v.dir * step * BAY_PITCH;
      for (const other of v.lane.bays) {
        if (Math.abs(other.at - at) > 0.5) continue;
        if (other.taken) return true;
      }
    }
    return false;
  }

  /// Whether a space can be taken at all.
  ///
  /// One with a vehicle in front of it has to be reversed into, and reversing
  /// needs the gap to be longer than the vehicle by about half a car — the same
  /// as it does in the street. Without this a van would back into a space four
  /// centimetres longer than itself and end up inside the car in front of it.
  _bayUsable(v, bay) {
    if (!this._gapNeedsReversing(v, bay)) return true;
    return v.length + REVERSE_SLACK <= BAY_PITCH;
  }

  /// Everything a stopped or stopping vehicle does. Returns true when it has
  /// taken over the vehicle for this frame.
  _handleStopping(v, dt) {
    // Easing towards the kerb, or back off it.
    if (v.kerbOffset !== v.kerbTarget) {
      const step = 1.6 * dt;
      v.kerbOffset += Math.max(-step, Math.min(step, v.kerbTarget - v.kerbOffset));
      if (Math.abs(v.kerbOffset - v.kerbTarget) < 0.01) v.kerbOffset = v.kerbTarget;
    }

    if (!v.stop) return false;

    if (this._clock < v.stop.until) {
      v.speed = 0;
      v.braking = false;
      // A bus at a stop and a truck unloading show hazards; a parked car does
      // not, because it is not on the road.
      v.indicate = v.stop.kind === "park" ? 0 : (((this._clock * BLINK_HZ) % 1) < 0.55 ? 1 : 0);
      return true;
    }

    // Time to go. Wait for a gap before pulling back out.
    if (v.stop.kind === "park") {
      // Indicating out, before anything moves. A parked car with its indicator
      // going is the only warning the traffic behind gets, and it goes on while
      // the driver is still waiting for a gap rather than as they pull away.
      v.indicate = ((this._clock * BLINK_HZ) % 1) < 0.55 ? CROSSING_TURN : 0;
      const leader = this._leader(v);
      if (leader && leader.gap < v.length + SAFE_GAP) {
        v.speed = 0;
        return true;
      }
      // And a gap behind big enough to merge into. It needs about a second and
      // a half to clear the kerb, from rest, so the vehicle coming up behind
      // must be far enough back to cover that at its own speed without
      // arriving early.
      const behind = this._follower(v);
      if (behind && behind.gap < SAFE_GAP + behind.follower.speed * 1.6) {
        v.speed = 0;
        return true;
      }
    }
    this._releaseBays(v);
    if (v.stop.kind === "park") this._parkedCars--;
    if (v.stop.kind === "busstop") v.busStopAfter = this._clock + BUS_STOP_COOLDOWN;
    if (v.stop.kind === "park") v.goal = this._pickGoal(v);
    v.stop = null;
    v.kerbTarget = 0;
    return false;
  }

  /// Which vehicle a particular instance of a vehicle mesh is. A raycast
  /// against an InstancedMesh reports the instance it hit but nothing about
  /// what that instance MEANS, so this is the translation — without it a
  /// paintball can tell it hit a car but not which car, and the splat has
  /// nowhere to live except world space, where the car promptly drives out
  /// from under it.
  vehicleForInstance(meshName, instanceId) {
    if (!this.vehicleMeshes || instanceId === undefined || instanceId === null) return null;
    const kind = String(meshName).replace("city-vehicles-", "");
    if (!this.vehicleMeshes[kind]) return null;
    for (const v of this.cars) {
      if (v.kind === kind && v.slot === instanceId) return v;
    }
    return null;
  }

  /// The world transform of one vehicle — the same one its body is drawn with,
  /// composed here rather than reconstructed by the caller so the two cannot
  /// drift apart.
  vehicleMatrix(v, into = null) {
    const ref = VEHICLE_REF[v.kind];
    return boxMatrix(v.x, ROAD_Y, v.z, v.length / ref.L, 1, 1, -v.heading, into || new THREE.Matrix4());
  }

  _writeCarMatrices() {
    if (!this.carParts || !this.vehicleMeshes) return;
    const { head, tail, brake, indicator } = this.carParts;
    const night = 1 - clamp01(this._dayAmount);
    const blinkOn = ((this._clock * BLINK_HZ) % 1) < 0.55;
    let heads = 0;
    let tails = 0;
    let brakes = 0;
    let indicators = 0;

    for (let i = 0; i < this.cars.length; i++) {
      const v = this.cars[i];
      const mesh = this.vehicleMeshes[v.kind];
      if (!mesh) continue;
      const ref = VEHICLE_REF[v.kind];
      const rotY = -v.heading;
      const fx = Math.cos(v.heading);
      const fz = Math.sin(v.heading);
      const rx = -fz;          // the vehicle's right-hand side
      const rz = fx;

      // The body is modelled at a reference length and stretched to this
      // vehicle's own; everything else about it is already in the mesh.
      mesh.setMatrixAt(v.slot, boxMatrix(
        v.x, ROAD_Y, v.z, v.length / ref.L, 1, 1, rotY, _m
      ));

      // Lamps, arranged the way a real car's are: a cluster at each of the
      // four corners. The white headlight and the red tail light sit outboard
      // where the corner is, and the amber indicator sits immediately inboard
      // of each — one housing, read as one unit. Nothing is drawn at zero
      // size; a lamp that is off is simply not written.
      const L = v.length;
      const W = v.width;
      const nose = L / 2 + 0.02;
      const back = -L / 2 - 0.02;
      const lampY = ROAD_Y + ref.lampY;
      const outer = W * 0.36;
      const inner = W * 0.19;

      // Headlights are ALWAYS lit — running lamps, as on any modern car. What
      // changes with the time of day is how bright they are, not whether they
      // exist.
      for (const s of [-1, 1]) {
        head.setMatrixAt(heads++, boxMatrix(
          v.x + fx * nose + rx * outer * s,
          lampY, v.z + fz * nose + rz * outer * s,
          0.16, 0.17, 0.30, rotY, _m
        ));
      }

      // The rear lamp is one housing at two brightnesses, which is how a real
      // one works: lit at its standard intensity all the time, jumping to the
      // bright filament only while the brakes are applied and dropping
      // straight back afterwards. Exactly one of the two meshes is written per
      // side, so they never stack in the same place.
      for (const s of [-1, 1]) {
        const m = boxMatrix(
          v.x + fx * back + rx * outer * s,
          lampY, v.z + fz * back + rz * outer * s,
          0.13, 0.19, v.braking ? 0.34 : 0.32, rotY, _m
        );
        if (v.braking) brake.setMatrixAt(brakes++, m);
        else tail.setMatrixAt(tails++, m);
      }
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

    for (const kind of Object.keys(this.vehicleMeshes)) {
      this.vehicleMeshes[kind].instanceMatrix.needsUpdate = true;
    }
    head.count = heads;
    tail.count = tails;
    brake.count = brakes;
    indicator.count = indicators;
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

    // The lights run whether or not anybody is driving, but what they run ON
    // is who is waiting — so the picture is taken first, then the signals, then
    // the turn arrows, and only then does anyone move.
    this._collectDemand();
    this._updateSignals(step);

    if (this.cars.length) {
      this._updateTurnControl();
      // Who is part-way round a turn. They belong to no lane while they are
      // crossing, so everyone else has to be told about them explicitly.
      this._turning.length = 0;
      for (const v of this.cars) if (v.arc) this._turning.push(v);
      for (const v of this.cars) this._driveVehicle(v, step);
      this._writeCarMatrices();
    }
    this._writeSignalLamps();
    this._writeTurnArrows();
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
    // Never fully off: these are running lamps. Bright enough to read against
    // daylight, far brighter after dark.
    if (this.headlights) this.headlights.material.emissiveIntensity = 0.6 + night * 2.2;
    if (this.carParts && this.carParts.tail) {
      this.carParts.tail.material.emissiveIntensity = 0.55 + night * 0.95;
    }
  }

  clear() {
    for (const d of this._disposables) {
      if (d && typeof d.dispose === "function") d.dispose();
    }
    this._disposables = [];
    this.group.clear();
    this.cars = [];
    this.carParts = null;
    this.vehicleMeshes = null;
    this.lanes = new Map();
    this.junctions = [];
    this.strays = 0;
    this._parkedCars = 0;
    this._parkingSoon = 0;
    this.signals = [];
    this.signalLamps = null;
    this.turnArrows = null;
    this.roadX = [];
    this.roadZ = [];
    this.drops = [];
    this.signals = [];
    this.signalLamps = null;
    this.turnArrows = null;
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
