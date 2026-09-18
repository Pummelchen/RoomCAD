// City: destinations.
//
// Part of city.js; applied to `City.prototype` there, so `this` is the city
// and every method still reaches every other one.

import {
  BAY_PITCH,
  BLINK_HZ,
  BUS_STOP_COOLDOWN,
  BUS_STOP_OFFSET,
  CROSSING_TURN,
  GRID_RADIUS,
  PARK_APPROACH,
  PARK_MAX,
  PARK_MIN,
  PARK_OFFSET,
  PARK_PATIENCE,
  PARK_SHARE,
  RESERVE_TTL,
  REVERSE_ANGLE,
  REVERSE_RADIUS,
  REVERSE_SLACK,
  REVERSE_SPEED,
  ROUTE_CONGESTION,
  SAFE_GAP,
  UNLOAD_CHANCE,
  UNLOAD_MAX,
  UNLOAD_MIN,
  VAN_OFFSET,
} from "./constants.js";
import { trueRandom } from "./helpers.js";
import { City } from "../city.js";

export const destinations = {

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

  /// Whether a space can be taken at all.
  ///
  /// One with a vehicle in front of it has to be reversed into, and reversing
  /// needs the gap to be longer than the vehicle by about half a car — the same
  /// as it does in the street. Without this a van would back into a space four
  /// centimetres longer than itself and end up inside the car in front of it.
  _bayUsable(v, bay) {
    if (!this._gapNeedsReversing(v, bay)) return true;
    return v.length + REVERSE_SLACK <= BAY_PITCH;
  },

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
};
