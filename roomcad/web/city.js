// city.js — the stylised city the room stands in.
//
// It gives the 3D walkthrough a sense of scale and place, and it is what you see
// through a window. It is not scenery, though: it publishes `solids` for walk3d
// to collide against, it owns the city's lights — `lampPosts` and
// `collectLights` are the street lamps, headlamps and brake lights walk3d draws
// its light pool from — and `build(bounds, seed, floorLift)` is handed the
// room's own building envelope, so the neighbourhood is laid out around the room
// rather than around a fixed origin.
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
//
// The class is declared here with its constructor and its static helpers, and
// its instance methods are applied from roomcad/web/city/. They live on the
// prototype, so `this` is the city and every method reaches every other one
// exactly as it did inside one class body — which is why no group imports
// another. The constants are in city/constants.js and the module-level helpers
// have their own modules.
//
// A prototype split is what makes this possible: JavaScript cannot spread a
// class declaration over several files, and Object.assign composes one object,
// not a class body. It is behaviour-preserving here because nothing in this
// class is private — no `#field`, no `super`.

import * as THREE from "three";
import {
  BLOCK_SIZE,
  GRID_RADIUS,
  HOLE_MIN_PIECE,
  HOLE_REACH_DOWN,
  LANE_CLEAR,
  LANE_OFFSET,
  PARK_OFFSET,
  REVERSE_RADIUS,
  REVERSE_RUN,
  ROAD_WIDTH,
  SIDEWALK,
  VEHICLE_KINDS,
} from "./city/constants.js";
import { ground_blocks } from "./city/ground.js";
import { lighting } from "./city/lighting.js";
import { damage } from "./city/damage.js";
import { buildings } from "./city/buildings.js";
import { streets } from "./city/streets.js";
import { traffic } from "./city/traffic.js";
import { signals } from "./city/signals.js";
import { turns } from "./city/turns.js";
import { turn_arcs } from "./city/turn-arcs.js";
import { driving } from "./city/driving.js";
import { parking } from "./city/parking.js";
import { destinations } from "./city/destinations.js";
import { kerbside } from "./city/kerbside.js";
import { vehicles } from "./city/vehicles.js";
import { weather } from "./city/weather.js";

export {
  BLOCK_SIZE,
  ROAD_WIDTH,
  SIDEWALK,
  KERB_HEIGHT,
  ROOM_SLAB_THICKNESS,
  GRID_RADIUS,
  TERRAIN_FLAT_MARGIN,
  NEAR_SIDE_TURN,
  CROSSING_TURN,
  FLEET_SIZE,
  PARK_OFFSET,
  VAN_OFFSET,
  BUS_STOP_OFFSET,
  BAY_PITCH,
  RESERVE_TTL,
  PARK_CLEAR,
  PARK_SHARE,
  PARK_MIN,
  PARK_MAX,
  REVERSE_ANGLE,
  REVERSE_RADIUS,
  REVERSE_RUN,
  UNLOAD_MIN,
  UNLOAD_MAX,
  BUS_DWELL_MIN,
  BUS_DWELL_MAX,
  BUS_STOPS_PER_BLOCK,
  TURN_CONTROL_PERIOD,
  WEATHER_KINDS,
} from "./city/constants.js";
export { setTransportRandom, seedFromString } from "./city/helpers.js";

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
    this.darkWindows = null;
    this.roomsLit = null;
    this.roomsDark = null;
    this.crossings = null;
    this.litBulbs = null;
    this.litInBand = null;
    this.bulbs = null;
    this.lampHeads = null;
    this.headlights = null;
    this.terrain = null;
    this.precipitation = null;
    this.drops = [];
    this.junctions = [];
    this.turnControl = new Map();
    this.turnLoads = new Map();
    this._turnRevision = 0;
    this._arrowsDrawn = -1;
    this._extinguished = [];
    this.solids = [];
    this._turnControlAt = 0;
    this._turnLookahead = 0;
    this._junctionKeys = null;
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

  static keyFor(bounds, seed, floorLift) {
    return [
      seed,
      bounds.centerX.toFixed(2), bounds.centerZ.toFixed(2),
      bounds.width.toFixed(2), bounds.length.toFixed(2),
      floorLift.toFixed(2),
    ].join("|");
  }

  /// How far the neighbourhood reaches from its own centre, for a building of
  /// this size.
  ///
  /// A public fact rather than a local of build(), because something outside
  /// this file needs it: the sky dome has to contain everywhere the player can
  /// walk, and a dome sized from anything else — a fixed radius, say — leaves
  /// the outermost streets outside it, where the sky is seen from the wrong side
  /// of its back faces. walk3d asks for it here rather than repeating the
  /// arithmetic, so the two cannot drift apart.
  static reachFor(bounds) {
    const block = Math.max(BLOCK_SIZE, bounds.width + SIDEWALK * 4, bounds.length + SIDEWALK * 4);
    return GRID_RADIUS * (block + ROAD_WIDTH) + block / 2 + ROAD_WIDTH;
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

  /// The centre and size of one instance, read back out of its matrix.
  ///
  /// ONLY VALID FOR AN UNROTATED BOX. The size is taken off the matrix diagonal
  /// (e[0], e[5], e[10]), which a rotation about Y replaces with its cosine —
  /// so a box turned a quarter turn would read back as zero width and depth,
  /// and `punchHole` would bore its hole through the wrong piece of wall.
  /// `boxMatrix` puts the position in the last column and the size on the
  /// diagonal, and nothing else has to be remembered about the box.
  ///
  /// Every instance in `facadeSet` — the set `punchHole` and `_facadeAt`
  /// search — is added by `boxMatrix` with no rotation, because the streets
  /// they face are axis-aligned. That is a constraint, not an accident: a
  /// rotated facade must not be added to that set without teaching this
  /// function to decompose the matrix properly first.
  static boxOf(matrix) {
    const e = matrix.elements;
    return { x: e[12], y: e[13], z: e[14], w: e[0], h: e[5], d: e[10] };
  }

  /// A box with a square hole through it, as the pieces that are left.
  ///
  /// The hole runs the whole way through along `axis`, so what comes back is
  /// the wall under it, the wall over it, and the wall to each side. Slivers
  /// thinner than a few centimetres are dropped rather than drawn: they are
  /// invisible and they cost an instance each.
  static holePieces(box, axis, atA, atB, size) {
    // The two axes the hole is measured in — everything except the one it is
    // bored along.
    const across = axis === "x" ? "z" : "x";
    const half = size / 2;
    const a0 = box[across === "x" ? "x" : "z"] - box[across === "x" ? "w" : "d"] / 2;
    const a1 = box[across === "x" ? "x" : "z"] + box[across === "x" ? "w" : "d"] / 2;
    const y0 = box.y - box.h / 2;
    const y1 = box.y + box.h / 2;
    // Slid back inside the box rather than clipped by its edge. A shot near the
    // foot of a wall should take a whole metre out of it, sitting on the
    // pavement — which is a hole you can get through. Clipping it instead
    // leaves a letterbox a few centimetres tall with a sill under it, and the
    // whole point of the hole is to be a way in.
    const slide = (lo, hi, at) => {
      let s0 = at - half;
      let s1 = at + half;
      if (s1 - s0 >= hi - lo) return [lo, hi];        // the hole is the wall
      if (s0 < lo) { s1 += lo - s0; s0 = lo; }
      if (s1 > hi) { s0 -= s1 - hi; s1 = hi; }
      return [s0, s1];
    };
    const [hA0, hA1] = slide(a0, a1, atA);
    // A hit anywhere on the ground storey takes the wall out at pavement level
    // rather than leaving a metre-square window with a sill under it. A metre
    // is not tall enough to walk through upright whatever you do — you duck —
    // but a sill at knee height means you cannot get through at all, and
    // hunting for the exact spot that leaves the sill on the ground is not a
    // game. Higher up it stays where it was hit.
    const [hY0, hY1] = atB - y0 < HOLE_REACH_DOWN
      ? slide(y0, y1, y0 + half)
      : slide(y0, y1, atB);
    if (hA1 - hA0 <= HOLE_MIN_PIECE || hY1 - hY0 <= HOLE_MIN_PIECE) return null;

    const pieces = [];
    const push = (lo, hi, yLo, yHi) => {
      if (hi - lo <= HOLE_MIN_PIECE || yHi - yLo <= HOLE_MIN_PIECE) return;
      const mid = (lo + hi) / 2;
      pieces.push({
        x: across === "x" ? mid : box.x,
        y: (yLo + yHi) / 2,
        z: across === "x" ? box.z : mid,
        w: across === "x" ? hi - lo : box.w,
        h: yHi - yLo,
        d: across === "x" ? box.d : hi - lo,
      });
    };
    push(a0, a1, y0, hY0);      // under it
    push(a0, a1, hY1, y1);      // over it
    push(a0, hA0, hY0, hY1);    // beside it
    push(hA1, a1, hY0, hY1);
    return pieces;
  }

  static boxHolds(box, point, slack = 0) {
    return Math.abs(point.x - box.x) <= box.w / 2 + slack
      && Math.abs(point.y - box.y) <= box.h / 2 + slack
      && Math.abs(point.z - box.z) <= box.d / 2 + slack;
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

  /// Is this spot inside a bus layby, or close enough to be in the way of one?
  ///
  /// A layby is CUT OUT of the pavement — the pad has a hole where it goes — so
  /// anything placed on the pavement ring by position alone can end up standing
  /// in the middle of it, or hanging over it in mid-air. A bus also needs the
  /// kerb clear at both ends to swing in and out, which is why this is asked
  /// with a margin rather than about the rectangle alone.
  static _inLayby(laybys, x, z, margin = 0) {
    if (!laybys) return false;
    for (const r of laybys) {
      if (x >= r.x0 - margin && x <= r.x1 + margin
        && z >= r.z0 - margin && z <= r.z1 + margin) return true;
    }
    return false;
  }

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

  static pickKind(r) {
    let acc = 0;
    for (const spec of VEHICLE_KINDS) {
      acc += spec.share;
      if (r <= acc) return spec;
    }
    return VEHICLE_KINDS[0];
  }

  /// How far the vehicle has travelled along its lane, measured so that larger
  /// always means further ahead whichever way it is pointing.
  static progressOf(v) {
    return v.axis === "x" ? v.x * v.dir : v.z * v.dir;
  }

  /// How fast this vehicle can go round a bend of this radius.
  ///
  /// Cornering is the one place where mass does NOT set the limit — sliding is
  /// about grip, and grip scales with weight just as the sideways push does, so
  /// the two cancel. What does differ is what the vehicle is: a bus is tall
  /// enough that it tips before it slides, and is held to less.
  static corneringSpeed(v, radius) {
    return Math.sqrt(Math.max(0.5, v.grip) * Math.max(0.5, radius));
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
}

Object.assign(
  City.prototype,
  ground_blocks,
  lighting,
  damage,
  buildings,
  streets,
  traffic,
  signals,
  turns,
  turn_arcs,
  driving,
  parking,
  destinations,
  kerbside,
  vehicles,
  weather,
);
