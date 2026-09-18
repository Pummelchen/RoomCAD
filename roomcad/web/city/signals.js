// City: signal timing.
//
// Part of city.js; applied to `City.prototype` there, so `this` is the city
// and every method still reaches every other one.

import {
  GREEN_EXTEND,
  GREEN_MAX,
  GREEN_MIN,
  LIGHT_AMBER,
  LIGHT_CLEAR,
  LIGHT_CYCLE,
  QUEUE_REACH,
  QUEUE_SLOW,
  ROAD_WIDTH,
  STOP_LINE_AT,
} from "./constants.js";
import { City } from "../city.js";

export const signals = {

  // MARK: - Signal timing

  /// Every junction's own phase, started out of step with its neighbours.
  ///
  /// The timings used to be a pure function of the clock: a fixed thirty second
  /// cycle, split evenly, the same at every junction forever. That is a
  /// timetable rather than a controller, and it showed — in a measured run,
  /// EIGHTY PER CENT of green phases had nobody passing through them at all,
  /// while the queue on the cross street sat at red. Green given to an
  /// empty approach is throughput taken from a full one.
  _startSignals() {
    this.phases = new Map();
    for (let ix = 0; ix < this.roadX.length; ix++) {
      for (let iz = 0; iz < this.roadZ.length; iz++) {
        const offset = this._junctionOffset(ix, iz);
        this.phases.set(this._junctionKey(ix, iz), {
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
  },

  _phaseAt(ix, iz) {
    return this.phases ? this.phases.get(this._junctionKey(ix, iz)) : null;
  },

  /// The map key for a junction pair.
  ///
  /// Returns one of the strings interned at build time rather than making a new
  /// one, because this is asked once per vehicle per frame — by `_collectDemand`
  /// and, from the phase state, by `_isGreen` and `_timeToCrossGreen` through
  /// `_phaseAt`. A fresh `${ix}|${iz}` at each of those was several hundred
  /// throwaway keys a frame to reach at most one junction per road pair.
  _junctionKey(ix, iz) {
    return this._junctionKeys[ix * this.roadZ.length + iz];
  },

  /// Where an (axis, direction, junction) turn-control key lives in the interned
  /// table. Pure arithmetic, so the index and the string cannot disagree.
  _turnKeyIndex(axis, dir, ix, iz) {
    const which = (axis === "x" ? 0 : 1) * 2 + (dir < 0 ? 1 : 0);
    return which * (this.roadX.length * this.roadZ.length) + ix * this.roadZ.length + iz;
  },

  /// The interned turn-control key. Falls back to building one for coordinates
  /// off the grid, which the arithmetic index does not cover — a caller asking
  /// about a junction that does not exist still gets a miss rather than a
  /// collision with some other cell's answer.
  _turnKey(axis, dir, ix, iz) {
    const key = this._turnKeys[this._turnKeyIndex(axis, dir, ix, iz)];
    return key !== undefined ? key : `${axis}|${dir}|${ix}|${iz}`;
  },

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
      const junction = this._nextJunction(v, this._junctionScratch(v));
      if (!junction || junction.distance > QUEUE_REACH) continue;
      const ix = v.axis === "x" ? junction.index : v.lane.roadIndex;
      const iz = v.axis === "x" ? v.lane.roadIndex : junction.index;
      const key = this._junctionKey(ix, iz);
      let cell = this._demand.get(key);
      if (!cell) {
        cell = { x: { queue: 0, moving: 0 }, z: { queue: 0, moving: 0 } };
        this._demand.set(key, cell);
      }
      const side = cell[v.axis];
      if (v.speed < QUEUE_SLOW) side.queue++;
      else if (junction.distance < ROAD_WIDTH) side.moving++;
    }
  },

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
      const here = demand ? demand.get(this._junctionKey(phase.ix, phase.iz)) : null;
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
  },

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
  },

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
  },

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
  },

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
  },

  /// A junction as a particular vehicle meets it: the road on the grid AND the
  /// way the vehicle is crossing it.
  ///
  /// `turnDecidedAt` used to hold the bare road index, and an index is not a
  /// junction. With ten roads and two axes, index 0 names four different
  /// junctions, so a vehicle that decided to carry straight on through index 0
  /// while heading one way still counted as "already decided" when it came back
  /// to index 0 heading the other — where carrying on is not a road at all. It
  /// went through the last junction and off the grid at full cruise, 13 m out,
  /// until the safety net turned it round. Found by fuzzing; the seed that
  /// reproduces it is recorded in the tracker.
  ///
  /// Direction is part of the identity, so this encodes all three parts as one
  /// number: cheap to compare every frame, and impossible to collide with the
  /// `-1` that means "nothing decided".
  _junctionId(axis, dir, index) {
    const which = (axis === "x" ? 0 : 1) * 2 + (dir < 0 ? 1 : 0);
    return which * this.roadX.length + index;
  },

  /// A per-vehicle object for _nextJunction to fill in.
  ///
  /// The hot callers — the demand picture and the driver — run for every vehicle
  /// every frame, and one returned object per vehicle per frame is some forty
  /// thousand small allocations a second for values that are read immediately
  /// and dropped. The callers that HOLD a result across a later call — the
  /// two-second turn review, and the fuzz test — pass nothing and get a fresh
  /// object, because a shared one would be overwritten under them.
  _junctionScratch(v) {
    return v._junction || (v._junction = { index: 0, coord: 0, distance: 0 });
  },

  /// Distance from this vehicle's nose to the stop line of the next junction,
  /// plus which junction it is. Negative once it is inside the junction.
  ///
  /// Pass `out` to fill a reusable object rather than allocate — see
  /// _junctionScratch.
  _nextJunction(v, out = null) {
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
    const j = out || {};
    j.index = bestIndex;
    j.coord = coords[bestIndex];
    // To the painted stop line, less the vehicle's own nose — so the queue
    // pulls up where the paint says, leaving the crossing clear.
    j.distance = bestDist - STOP_LINE_AT - v.length / 2;
    return j;
  }
};
