// City: parking.
//
// Part of city.js; applied to `City.prototype` there, so `this` is the city
// and every method still reaches every other one.

import {
  BAY_CLEARANCE,
  BAY_PITCH,
  BUS_STOPS_PER_BLOCK,
  GRID_RADIUS,
  PARK_CLEAR,
  PARK_MAX,
  PARK_MIN,
  PARK_OFFSET,
  PARK_SHARE,
  START_PARKED,
} from "./constants.js";
import { City } from "../city.js";

export const parking = {

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
  },

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
  },

  /// Whether a vehicle can have that bay: it and everything its body would
  /// cover must be free.
  _bayFree(v, bay) {
    const reach = v.length / 2 + BAY_CLEARANCE;
    for (const other of v.lane.bays) {
      if (other !== bay && Math.abs(other.at - bay.at) > reach) continue;
      if (other.taken) return false;
    }
    return true;
  },

  _releaseBays(v) {
    if (!v.stop || !v.stop.bays) return;
    for (const bay of v.stop.bays) bay.taken = null;
  },

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
};
